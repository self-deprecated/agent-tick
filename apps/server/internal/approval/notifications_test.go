package approval

import (
	"encoding/json"
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
	if notifier.client == nil || notifier.client.Timeout != defaultNotificationTimeout {
		t.Fatalf("client timeout = %#v, want %v", notifier.client, defaultNotificationTimeout)
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
