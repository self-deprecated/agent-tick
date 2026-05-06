package approval

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestSplitAndTrimCSV(t *testing.T) {
	got := splitAndTrimCSV(" one, two ; three\n four ,, ")
	want := []string{"one", "two", "three", "four"}
	if len(got) != len(want) {
		t.Fatalf("len(splitAndTrimCSV) = %d, want %d (%#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("splitAndTrimCSV[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestNewRequestNotifierFromEnvRequiresCompleteSMTPConfig(t *testing.T) {
	t.Setenv("AGENT_TICK_EMAIL_SMTP_ADDR", "smtp.example.com:587")
	t.Setenv("AGENT_TICK_EMAIL_FROM", "")
	t.Setenv("AGENT_TICK_EMAIL_TO", "ops@example.com")
	notifier := NewRequestNotifierFromEnv("https://tick.example.com")
	if notifier.email != nil {
		t.Fatalf("email notifier = %#v, want nil without complete SMTP config", notifier.email)
	}

	t.Setenv("AGENT_TICK_EMAIL_FROM", "tick@example.com\r\nBcc:evil@example.com")
	t.Setenv("AGENT_TICK_EMAIL_TO", "ops@example.com\r\noncall@example.com")
	notifier = NewRequestNotifierFromEnv("https://tick.example.com")
	if notifier.email == nil {
		t.Fatal("email notifier = nil, want configured notifier")
	}
	if strings.ContainsAny(notifier.email.from, "\r\n") {
		t.Fatalf("email from = %q, want sanitized header value", notifier.email.from)
	}
	for _, recipient := range notifier.email.to {
		if strings.ContainsAny(recipient, "\r\n") {
			t.Fatalf("recipient = %q, want sanitized header value", recipient)
		}
	}
	if notifier.requestTimeout != defaultNotificationTimeout {
		t.Fatalf("requestTimeout = %v, want %v", notifier.requestTimeout, defaultNotificationTimeout)
	}
	if notifier.client == nil || notifier.client.Timeout != 0 {
		t.Fatalf("client timeout = %#v, want zero client timeout with per-request context", notifier.client)
	}
	if notifier.deliverySlots == nil || cap(notifier.deliverySlots) != defaultNotificationConcurrency {
		t.Fatalf("deliverySlots = %#v, want capacity %d", notifier.deliverySlots, defaultNotificationConcurrency)
	}
}

func TestBuildSMTPMessageIncludesDashboardURLAndSanitizesHeaders(t *testing.T) {
	message := buildSMTPMessage("tick@example.com\r\nBcc:evil@example.com", []string{"ops@example.com\r\nCc:evil@example.com"}, sampleNotificationRequest(), "https://tick.example.com/#approvals")
	for _, fragment := range []string{
		"From: tick@example.com  Bcc:evil@example.com",
		"To: ops@example.com  Cc:evil@example.com",
		"Subject: [Agent Tick] Deploy production?",
		"Agent Tick approval request",
		"Title: Deploy production?",
		"Open: https://tick.example.com/#approvals",
	} {
		if !strings.Contains(message, fragment) {
			t.Fatalf("SMTP message missing %q\n%s", fragment, message)
		}
	}
	if strings.Contains(message, "\r\nBcc:") || strings.Contains(message, "\r\nCc:") {
		t.Fatalf("SMTP message contains injected headers:\n%s", message)
	}
}

func TestRequestNotifierAsyncRejectsWhenQueueIsFull(t *testing.T) {
	notifier := &RequestNotifier{
		deliverySlots: make(chan struct{}, 1),
		webhookURLs:   []string{"https://example.test"},
	}
	notifier.deliverySlots <- struct{}{}
	if err := notifier.NotifyRequestCreatedAsync(sampleNotificationRequest()); err == nil || !strings.Contains(err.Error(), "queue is full") {
		t.Fatalf("NotifyRequestCreatedAsync() error = %v, want queue full error", err)
	}
}

func TestRequestNotifierAsyncSuccessReleasesSlot(t *testing.T) {
	delivered := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		delivered <- struct{}{}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	notifier := &RequestNotifier{
		client:         server.Client(),
		requestTimeout: time.Second,
		deliverySlots:  make(chan struct{}, 1),
		webhookURLs:    []string{server.URL},
	}
	if err := notifier.NotifyRequestCreatedAsync(sampleNotificationRequest()); err != nil {
		t.Fatalf("NotifyRequestCreatedAsync() error = %v", err)
	}
	select {
	case <-delivered:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async webhook delivery")
	}
	deadline := time.Now().Add(time.Second)
	for {
		select {
		case notifier.deliverySlots <- struct{}{}:
			<-notifier.deliverySlots
			return
		default:
			if time.Now().After(deadline) {
				t.Fatal("delivery slot was not released after async delivery")
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestRequestNotifierAsyncWithoutQueueStillReturnsQuickly(t *testing.T) {
	requestStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestStarted <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	defer close(release)

	notifier := &RequestNotifier{
		client:         server.Client(),
		requestTimeout: time.Second,
		webhookURLs:    []string{server.URL},
	}
	started := time.Now()
	if err := notifier.NotifyRequestCreatedAsync(sampleNotificationRequest()); err != nil {
		t.Fatalf("NotifyRequestCreatedAsync() error = %v", err)
	}
	if elapsed := time.Since(started); elapsed > 200*time.Millisecond {
		t.Fatalf("NotifyRequestCreatedAsync() elapsed = %v, want under 200ms", elapsed)
	}
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("async request never started")
	}
}

func TestRequestNotifierSendsEmail(t *testing.T) {
	original := smtpSendMail
	defer func() { smtpSendMail = original }()

	var gotAddr string
	var gotFrom string
	var gotTo []string
	var gotMessage string
	var gotTimeout time.Duration
	smtpSendMail = func(addr string, _ smtp.Auth, from string, to []string, msg []byte, timeout time.Duration) error {
		gotAddr = addr
		gotFrom = from
		gotTo = append([]string{}, to...)
		gotMessage = string(msg)
		gotTimeout = timeout
		return nil
	}

	notifier := &RequestNotifier{
		publicURL: "https://tick.example.com",
		email: &emailNotifier{
			addr:    "smtp.example.com:587",
			from:    "tick@example.com",
			to:      []string{"ops@example.com", "oncall@example.com"},
			timeout: 3 * time.Second,
		},
	}
	if err := notifier.NotifyRequestCreated(sampleNotificationRequest()); err != nil {
		t.Fatalf("NotifyRequestCreated error = %v", err)
	}
	if gotAddr != "smtp.example.com:587" || gotFrom != "tick@example.com" {
		t.Fatalf("smtp args = %q/%q, want smtp.example.com:587/tick@example.com", gotAddr, gotFrom)
	}
	if len(gotTo) != 2 || gotTo[0] != "ops@example.com" || gotTo[1] != "oncall@example.com" {
		t.Fatalf("smtp recipients = %#v", gotTo)
	}
	if gotTimeout != 3*time.Second {
		t.Fatalf("smtp timeout = %v, want %v", gotTimeout, 3*time.Second)
	}
	if !strings.Contains(gotMessage, "Open: https://tick.example.com/#approvals") {
		t.Fatalf("smtp message = %q, want dashboard URL", gotMessage)
	}
}

func TestRequestNotifierSendsConfiguredWebhooks(t *testing.T) {
	var genericPayload map[string]any
	var slackPayload map[string]any
	var teamsPayload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode %s payload: %v", r.URL.Path, err)
		}
		switch r.URL.Path {
		case "/generic":
			genericPayload = payload
		case "/slack":
			slackPayload = payload
		case "/teams":
			teamsPayload = payload
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	notifier := &RequestNotifier{
		client:           server.Client(),
		publicURL:        "https://tick.example.com",
		requestTimeout:   time.Second,
		webhookURLs:      []string{server.URL + "/generic"},
		slackWebhookURLs: []string{server.URL + "/slack"},
		teamsWebhookURLs: []string{server.URL + "/teams"},
	}
	if err := notifier.NotifyRequestCreated(sampleNotificationRequest()); err != nil {
		t.Fatalf("NotifyRequestCreated error = %v", err)
	}

	if genericPayload["event"] != "approval.created" {
		t.Fatalf("generic event = %#v, want approval.created", genericPayload["event"])
	}
	if genericPayload["dashboardUrl"] != "https://tick.example.com/#approvals" {
		t.Fatalf("generic dashboardUrl = %#v", genericPayload["dashboardUrl"])
	}
	requestMap, ok := genericPayload["request"].(map[string]any)
	if !ok || requestMap["id"] != "req_notify" {
		t.Fatalf("generic request payload = %#v, want request id req_notify", genericPayload["request"])
	}

	if text, _ := slackPayload["text"].(string); !strings.Contains(text, "Deploy production?") {
		t.Fatalf("slack text = %#v, want title", slackPayload["text"])
	}
	blocks, ok := slackPayload["blocks"].([]any)
	if !ok || len(blocks) == 0 {
		t.Fatalf("slack blocks = %#v, want non-empty", slackPayload["blocks"])
	}

	if title, _ := teamsPayload["title"].(string); !strings.Contains(title, "Deploy production?") {
		t.Fatalf("teams title = %#v, want title", teamsPayload["title"])
	}
	if text, _ := teamsPayload["text"].(string); !strings.Contains(text, "**Open:** https://tick.example.com/#approvals") {
		t.Fatalf("teams text = %#v, want dashboard url", teamsPayload["text"])
	}
}

func TestRequestNotifierSendsSlackDM(t *testing.T) {
	var openAuth string
	var openedUsers any
	var postedChannel string
	var postedText string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		openAuth = r.Header.Get("Authorization")
		switch r.URL.Path {
		case "/conversations.open":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode conversations.open payload: %v", err)
			}
			openedUsers = payload["users"]
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "channel": map[string]any{"id": "D123"}})
		case "/chat.postMessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode chat.postMessage payload: %v", err)
			}
			postedChannel, _ = payload["channel"].(string)
			postedText, _ = payload["text"].(string)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			t.Fatalf("unexpected slack API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	notifier := &RequestNotifier{
		client:         server.Client(),
		publicURL:      "https://tick.example.com",
		requestTimeout: time.Second,
		slackDM: &slackDMNotifier{
			botToken:   "xoxb-test",
			userIDs:    []string{"U123"},
			apiBaseURL: server.URL,
		},
	}
	if err := notifier.NotifyRequestCreated(sampleNotificationRequest()); err != nil {
		t.Fatalf("NotifyRequestCreated error = %v", err)
	}
	if openAuth != "Bearer xoxb-test" {
		t.Fatalf("Authorization = %q, want Bearer xoxb-test", openAuth)
	}
	if openedUsers != "U123" {
		t.Fatalf("opened users = %#v, want string U123", openedUsers)
	}
	if postedChannel != "D123" {
		t.Fatalf("posted channel = %q, want D123", postedChannel)
	}
	if !strings.Contains(postedText, "Deploy production?") {
		t.Fatalf("posted text = %q, want title", postedText)
	}
}

func TestTruncateNotificationPreservesUTF8(t *testing.T) {
	truncated := truncateNotification("ééééé", 4)
	if !utf8.ValidString(truncated) {
		t.Fatalf("truncateNotification() produced invalid UTF-8: %q", truncated)
	}
	if truncated != "ééé…" {
		t.Fatalf("truncateNotification() = %q, want %q", truncated, "ééé…")
	}
}

func TestAPINotifyRequestCreatedLogsQueueFull(t *testing.T) {
	var logs bytes.Buffer
	oldWriter := log.Writer()
	oldFlags := log.Flags()
	oldPrefix := log.Prefix()
	log.SetOutput(&logs)
	log.SetFlags(0)
	log.SetPrefix("")
	defer func() {
		log.SetOutput(oldWriter)
		log.SetFlags(oldFlags)
		log.SetPrefix(oldPrefix)
	}()

	notifier := &RequestNotifier{
		deliverySlots: make(chan struct{}, 1),
		webhookURLs:   []string{"https://example.test"},
	}
	notifier.deliverySlots <- struct{}{}

	api := &API{}
	api.SetRequestNotifier(notifier)
	api.notifyRequestCreated(sampleNotificationRequest())

	if !strings.Contains(logs.String(), "queue is full") {
		t.Fatalf("notifyRequestCreated logs = %q, want queue-full message", logs.String())
	}
}

func TestSendMailWithTimeoutSucceedsWithoutAuth(t *testing.T) {
	message := buildSMTPMessage("tick@example.com", []string{"ops@example.com"}, sampleNotificationRequest(), "https://tick.example.com/#approvals")
	addr, done := startFakeSMTPServer(t, func(conn net.Conn) error {
		rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
		if err := writeSMTPLine(rw.Writer, "220 smtp.example.test ESMTP"); err != nil {
			return err
		}
		line, err := readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "EHLO ") && !strings.HasPrefix(line, "HELO ") {
			return fmt.Errorf("greeting command = %q, want EHLO/HELO", line)
		}
		if err := writeSMTPLines(rw.Writer, "250-smtp.example.test", "250 OK"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "MAIL FROM:") {
			return fmt.Errorf("MAIL command = %q", line)
		}
		if err := writeSMTPLine(rw.Writer, "250 OK"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "RCPT TO:") {
			return fmt.Errorf("RCPT command = %q", line)
		}
		if err := writeSMTPLine(rw.Writer, "250 OK"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if line != "DATA" {
			return fmt.Errorf("DATA command = %q, want DATA", line)
		}
		if err := writeSMTPLine(rw.Writer, "354 End data with <CR><LF>.<CR><LF>"); err != nil {
			return err
		}
		data, err := readSMTPData(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.Contains(data, "Subject: [Agent Tick] Deploy production?") {
			return fmt.Errorf("smtp data missing subject: %q", data)
		}
		if err := writeSMTPLine(rw.Writer, "250 queued"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if line != "QUIT" {
			return fmt.Errorf("QUIT command = %q, want QUIT", line)
		}
		return writeSMTPLine(rw.Writer, "221 bye")
	})

	if err := sendMailWithTimeout(addr, nil, "tick@example.com", []string{"ops@example.com"}, []byte(message), time.Second); err != nil {
		t.Fatalf("sendMailWithTimeout() error = %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("fake smtp server error = %v", err)
	}
}

func TestSendMailWithTimeoutRequiresSTARTTLSForAuth(t *testing.T) {
	auth := smtp.PlainAuth("", "agent-tick", "secret", "127.0.0.1")
	addr, done := startFakeSMTPServer(t, func(conn net.Conn) error {
		rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
		if err := writeSMTPLine(rw.Writer, "220 smtp.example.test ESMTP"); err != nil {
			return err
		}
		line, err := readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "EHLO ") && !strings.HasPrefix(line, "HELO ") {
			return fmt.Errorf("greeting command = %q, want EHLO/HELO", line)
		}
		if err := writeSMTPLines(rw.Writer, "250-smtp.example.test", "250-AUTH PLAIN", "250 OK"); err != nil {
			return err
		}
		_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		_, _ = rw.Reader.ReadString('\n')
		return nil
	})

	err := sendMailWithTimeout(addr, auth, "tick@example.com", []string{"ops@example.com"}, []byte("test"), time.Second)
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("sendMailWithTimeout() error = %v, want STARTTLS requirement", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("fake smtp server error = %v", err)
	}
}

func TestSendMailWithTimeoutSucceedsWithSTARTTLSAndAuth(t *testing.T) {
	originalTLSConfig := smtpTLSConfig
	smtpTLSConfig = func(string) *tls.Config { return &tls.Config{InsecureSkipVerify: true} }
	defer func() { smtpTLSConfig = originalTLSConfig }()

	certificate := testSMTPCertificate(t)
	auth := smtp.PlainAuth("", "agent-tick", "secret", "127.0.0.1")
	message := buildSMTPMessage("tick@example.com", []string{"ops@example.com"}, sampleNotificationRequest(), "https://tick.example.com/#approvals")
	addr, done := startFakeSMTPServer(t, func(conn net.Conn) error {
		rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
		if err := writeSMTPLine(rw.Writer, "220 smtp.example.test ESMTP"); err != nil {
			return err
		}
		line, err := readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "EHLO ") && !strings.HasPrefix(line, "HELO ") {
			return fmt.Errorf("greeting command = %q, want EHLO/HELO", line)
		}
		if err := writeSMTPLines(rw.Writer, "250-smtp.example.test", "250-STARTTLS", "250 OK"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if line != "STARTTLS" {
			return fmt.Errorf("STARTTLS command = %q, want STARTTLS", line)
		}
		if err := writeSMTPLine(rw.Writer, "220 Ready to start TLS"); err != nil {
			return err
		}
		tlsConn := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{certificate}})
		if err := tlsConn.Handshake(); err != nil {
			return err
		}
		rw = bufio.NewReadWriter(bufio.NewReader(tlsConn), bufio.NewWriter(tlsConn))
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "EHLO ") && !strings.HasPrefix(line, "HELO ") {
			return fmt.Errorf("tls greeting command = %q, want EHLO/HELO", line)
		}
		if err := writeSMTPLines(rw.Writer, "250-smtp.example.test", "250-AUTH PLAIN", "250 OK"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "AUTH PLAIN ") {
			return fmt.Errorf("AUTH command = %q, want AUTH PLAIN", line)
		}
		if err := writeSMTPLine(rw.Writer, "235 Authenticated"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "MAIL FROM:") {
			return fmt.Errorf("MAIL command = %q", line)
		}
		if err := writeSMTPLine(rw.Writer, "250 OK"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(line, "RCPT TO:") {
			return fmt.Errorf("RCPT command = %q", line)
		}
		if err := writeSMTPLine(rw.Writer, "250 OK"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if line != "DATA" {
			return fmt.Errorf("DATA command = %q, want DATA", line)
		}
		if err := writeSMTPLine(rw.Writer, "354 End data with <CR><LF>.<CR><LF>"); err != nil {
			return err
		}
		data, err := readSMTPData(rw.Reader)
		if err != nil {
			return err
		}
		if !strings.Contains(data, "Subject: [Agent Tick] Deploy production?") {
			return fmt.Errorf("smtp data missing subject: %q", data)
		}
		if err := writeSMTPLine(rw.Writer, "250 queued"); err != nil {
			return err
		}
		line, err = readSMTPLine(rw.Reader)
		if err != nil {
			return err
		}
		if line != "QUIT" {
			return fmt.Errorf("QUIT command = %q, want QUIT", line)
		}
		if err := writeSMTPLine(rw.Writer, "221 bye"); err != nil {
			return err
		}
		return tlsConn.Close()
	})

	if err := sendMailWithTimeout(addr, auth, "tick@example.com", []string{"ops@example.com"}, []byte(message), time.Second); err != nil {
		t.Fatalf("sendMailWithTimeout() error = %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("fake smtp server error = %v", err)
	}
}

func TestSendMailWithTimeoutHonorsDeadline(t *testing.T) {
	addr, done := startFakeSMTPServer(t, func(conn net.Conn) error {
		time.Sleep(150 * time.Millisecond)
		return nil
	})

	started := time.Now()
	err := sendMailWithTimeout(addr, nil, "tick@example.com", []string{"ops@example.com"}, []byte("test"), 50*time.Millisecond)
	if err == nil {
		t.Fatal("sendMailWithTimeout() error = nil, want timeout")
	}
	if elapsed := time.Since(started); elapsed > 120*time.Millisecond {
		t.Fatalf("sendMailWithTimeout() elapsed = %v, want under 120ms", elapsed)
	}
	if err := <-done; err != nil {
		t.Fatalf("fake smtp server error = %v", err)
	}
}

func TestSendMailWithTimeoutFallsBackForZeroTimeout(t *testing.T) {
	originalFallback := notificationTimeoutFallback
	notificationTimeoutFallback = 50 * time.Millisecond
	defer func() { notificationTimeoutFallback = originalFallback }()

	addr, done := startFakeSMTPServer(t, func(conn net.Conn) error {
		time.Sleep(150 * time.Millisecond)
		return nil
	})

	started := time.Now()
	err := sendMailWithTimeout(addr, nil, "tick@example.com", []string{"ops@example.com"}, []byte("test"), 0)
	if err == nil {
		t.Fatal("sendMailWithTimeout() error = nil, want fallback timeout")
	}
	if elapsed := time.Since(started); elapsed > 120*time.Millisecond {
		t.Fatalf("sendMailWithTimeout() elapsed = %v, want under 120ms with fallback timeout", elapsed)
	}
	if err := <-done; err != nil {
		t.Fatalf("fake smtp server error = %v", err)
	}
}

func TestPostJSONFallsBackForZeroTimeout(t *testing.T) {
	originalFallback := notificationTimeoutFallback
	notificationTimeoutFallback = 50 * time.Millisecond
	defer func() { notificationTimeoutFallback = originalFallback }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(150 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	started := time.Now()
	var response map[string]any
	err := postJSON(server.Client(), 0, server.URL, map[string]string{"hello": "world"}, nil, &response)
	if err == nil {
		t.Fatal("postJSON() error = nil, want fallback timeout")
	}
	if elapsed := time.Since(started); elapsed > 120*time.Millisecond {
		t.Fatalf("postJSON() elapsed = %v, want under 120ms with fallback timeout", elapsed)
	}
}

func startFakeSMTPServer(t *testing.T, handler func(net.Conn) error) (string, <-chan error) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	done := make(chan error, 1)
	go func() {
		defer ln.Close()
		conn, err := ln.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		done <- handler(conn)
	}()
	return ln.Addr().String(), done
}

func writeSMTPLine(w *bufio.Writer, line string) error {
	_, err := w.WriteString(line + "\r\n")
	if err != nil {
		return err
	}
	return w.Flush()
}

func writeSMTPLines(w *bufio.Writer, lines ...string) error {
	for _, line := range lines {
		if err := writeSMTPLine(w, line); err != nil {
			return err
		}
	}
	return nil
}

func readSMTPLine(r *bufio.Reader) (string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func readSMTPData(r *bufio.Reader) (string, error) {
	var builder strings.Builder
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return builder.String(), err
		}
		if line == ".\r\n" {
			return builder.String(), nil
		}
		builder.WriteString(line)
	}
}

func testSMTPCertificate(t *testing.T) tls.Certificate {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey() error = %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	certificateDER, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatalf("x509.CreateCertificate() error = %v", err)
	}
	return tls.Certificate{Certificate: [][]byte{certificateDER}, PrivateKey: privateKey, Leaf: template}
}

func sampleNotificationRequest() ApprovalRequest {
	return ApprovalRequest{
		ID:          "req_notify",
		RequestType: RequestTypeApproval,
		Title:       "Deploy production?",
		Command:     "kubectl apply -f prod.yaml",
		Requester: Requester{
			Name:        "codex",
			Host:        "build-host",
			ProjectName: "release-bot",
		},
		CreatedAt: time.Unix(1700000000, 0).UTC(),
	}
}
