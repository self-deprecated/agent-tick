package approval

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/smtp"
	"os"
	"strings"
	"time"
)

const (
	defaultSlackAPIBaseURL         = "https://slack.com/api"
	defaultNotificationTimeout     = 10 * time.Second
	defaultNotificationConcurrency = 16
)

var smtpSendMail = sendMailWithTimeout

type RequestNotifier struct {
	client           *http.Client
	publicURL        string
	requestTimeout   time.Duration
	deliverySlots    chan struct{}
	webhookURLs      []string
	slackWebhookURLs []string
	teamsWebhookURLs []string
	email            *emailNotifier
	slackDM          *slackDMNotifier
}

type emailNotifier struct {
	addr     string
	username string
	password string
	from     string
	to       []string
	timeout  time.Duration
}

type slackDMNotifier struct {
	botToken   string
	userIDs    []string
	apiBaseURL string
}

type requestCreatedWebhookPayload struct {
	Event        string          `json:"event"`
	DashboardURL string          `json:"dashboardUrl,omitempty"`
	Request      ApprovalRequest `json:"request"`
}

func NewRequestNotifierFromEnv(publicURL string) *RequestNotifier {
	notifier := &RequestNotifier{
		client:           &http.Client{Timeout: defaultNotificationTimeout},
		publicURL:        strings.TrimRight(strings.TrimSpace(publicURL), "/"),
		requestTimeout:   defaultNotificationTimeout,
		deliverySlots:    make(chan struct{}, defaultNotificationConcurrency),
		webhookURLs:      splitAndTrimCSV(os.Getenv("AGENT_TICK_WEBHOOK_URLS")),
		slackWebhookURLs: splitAndTrimCSV(os.Getenv("AGENT_TICK_SLACK_WEBHOOK_URLS")),
		teamsWebhookURLs: splitAndTrimCSV(os.Getenv("AGENT_TICK_TEAMS_WEBHOOK_URLS")),
	}

	smtpAddr := strings.TrimSpace(os.Getenv("AGENT_TICK_EMAIL_SMTP_ADDR"))
	from := sanitizeHeader(strings.TrimSpace(os.Getenv("AGENT_TICK_EMAIL_FROM")))
	to := sanitizeHeaderValues(splitAndTrimCSV(os.Getenv("AGENT_TICK_EMAIL_TO")))
	if smtpAddr != "" && from != "" && len(to) > 0 {
		notifier.email = &emailNotifier{
			addr:     smtpAddr,
			username: strings.TrimSpace(os.Getenv("AGENT_TICK_EMAIL_SMTP_USERNAME")),
			password: os.Getenv("AGENT_TICK_EMAIL_SMTP_PASSWORD"),
			from:     from,
			to:       to,
			timeout:  defaultNotificationTimeout,
		}
	}

	botToken := strings.TrimSpace(os.Getenv("AGENT_TICK_SLACK_BOT_TOKEN"))
	userIDs := splitAndTrimCSV(os.Getenv("AGENT_TICK_SLACK_DM_USER_IDS"))
	if botToken != "" && len(userIDs) > 0 {
		notifier.slackDM = &slackDMNotifier{
			botToken:   botToken,
			userIDs:    userIDs,
			apiBaseURL: defaultSlackAPIBaseURL,
		}
	}

	return notifier
}

func (n *RequestNotifier) Enabled() bool {
	return n != nil && (len(n.webhookURLs) > 0 || len(n.slackWebhookURLs) > 0 || len(n.teamsWebhookURLs) > 0 || n.email != nil || n.slackDM != nil)
}

func (n *RequestNotifier) NotifyRequestCreatedAsync(request ApprovalRequest) error {
	if !n.Enabled() {
		return nil
	}
	if n.deliverySlots == nil {
		return n.NotifyRequestCreated(request)
	}
	select {
	case n.deliverySlots <- struct{}{}:
		go func() {
			defer func() { <-n.deliverySlots }()
			if err := n.NotifyRequestCreated(request); err != nil {
				log.Printf("notify external sinks for request %s: %v", request.ID, err)
			}
		}()
		return nil
	default:
		return fmt.Errorf("notification delivery queue is full")
	}
}

func (n *RequestNotifier) NotifyRequestCreated(request ApprovalRequest) error {
	if !n.Enabled() {
		return nil
	}

	var errs []error
	if err := n.sendGenericWebhooks(request); err != nil {
		err = fmt.Errorf("generic webhook: %w", err)
		errs = append(errs, err)
	}
	if err := n.sendSlackWebhooks(request); err != nil {
		err = fmt.Errorf("slack webhook: %w", err)
		errs = append(errs, err)
	}
	if err := n.sendTeamsWebhooks(request); err != nil {
		err = fmt.Errorf("teams webhook: %w", err)
		errs = append(errs, err)
	}
	if err := n.sendEmail(request); err != nil {
		err = fmt.Errorf("email: %w", err)
		errs = append(errs, err)
	}
	if err := n.sendSlackDM(request); err != nil {
		err = fmt.Errorf("slack dm: %w", err)
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func (n *RequestNotifier) dashboardURL() string {
	if n == nil || n.publicURL == "" {
		return ""
	}
	return n.publicURL + "/#approvals"
}

func (n *RequestNotifier) sendGenericWebhooks(request ApprovalRequest) error {
	if len(n.webhookURLs) == 0 {
		return nil
	}
	payload := requestCreatedWebhookPayload{
		Event:        "approval.created",
		DashboardURL: n.dashboardURL(),
		Request:      request,
	}
	var errs []error
	for _, webhookURL := range n.webhookURLs {
		if err := postJSON(n.client, n.requestTimeout, webhookURL, payload, nil); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", webhookURL, err))
		}
	}
	return errors.Join(errs...)
}

func (n *RequestNotifier) sendSlackWebhooks(request ApprovalRequest) error {
	if len(n.slackWebhookURLs) == 0 {
		return nil
	}
	payload := slackWebhookPayload(request, n.dashboardURL())
	var errs []error
	for _, webhookURL := range n.slackWebhookURLs {
		if err := postJSON(n.client, n.requestTimeout, webhookURL, payload, nil); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", webhookURL, err))
		}
	}
	return errors.Join(errs...)
}

func (n *RequestNotifier) sendTeamsWebhooks(request ApprovalRequest) error {
	if len(n.teamsWebhookURLs) == 0 {
		return nil
	}
	payload := teamsWebhookPayload(request, n.dashboardURL())
	var errs []error
	for _, webhookURL := range n.teamsWebhookURLs {
		if err := postJSON(n.client, n.requestTimeout, webhookURL, payload, nil); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", webhookURL, err))
		}
	}
	return errors.Join(errs...)
}

func (n *RequestNotifier) sendEmail(request ApprovalRequest) error {
	if n == nil || n.email == nil {
		return nil
	}
	return n.email.send(request, n.dashboardURL())
}

func (n *RequestNotifier) sendSlackDM(request ApprovalRequest) error {
	if n == nil || n.slackDM == nil {
		return nil
	}
	return n.slackDM.send(n.client, n.requestTimeout, request, n.dashboardURL())
}

func (e *emailNotifier) send(request ApprovalRequest, dashboardURL string) error {
	host := smtpHost(e.addr)
	var auth smtp.Auth
	if e.username != "" {
		auth = smtp.PlainAuth("", e.username, e.password, host)
	}
	message := buildSMTPMessage(e.from, e.to, request, dashboardURL)
	return smtpSendMail(e.addr, auth, e.from, e.to, []byte(message), e.timeout)
}

func sendMailWithTimeout(addr string, auth smtp.Auth, from string, to []string, msg []byte, timeout time.Duration) error {
	host := smtpHost(addr)
	ctx := context.Background()
	var cancel context.CancelFunc
	if timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	defer conn.Close()
	if timeout > 0 {
		_ = conn.SetDeadline(time.Now().Add(timeout))
	}

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return err
		}
	}
	if auth != nil {
		if ok, _ := client.Extension("AUTH"); !ok {
			return errors.New("smtp server does not support AUTH")
		}
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	for _, recipient := range to {
		if err := client.Rcpt(recipient); err != nil {
			return err
		}
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(msg); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func buildSMTPMessage(from string, to []string, request ApprovalRequest, dashboardURL string) string {
	headers := []string{
		fmt.Sprintf("From: %s", sanitizeHeader(from)),
		fmt.Sprintf("To: %s", sanitizeHeader(strings.Join(sanitizeHeaderValues(to), ", "))),
		fmt.Sprintf("Subject: [Agent Tick] %s", sanitizeHeader(notificationTitle(request))),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
	}
	return strings.Join(headers, "\r\n") + "\r\n\r\n" + renderPlainNotification(request, dashboardURL) + "\r\n"
}

func (s *slackDMNotifier) send(client *http.Client, timeout time.Duration, request ApprovalRequest, dashboardURL string) error {
	var errs []error
	for _, userID := range s.userIDs {
		channelID, err := s.openConversation(client, timeout, userID)
		if err != nil {
			errs = append(errs, fmt.Errorf("open %s: %w", userID, err))
			continue
		}
		if err := s.postMessage(client, timeout, channelID, request, dashboardURL); err != nil {
			errs = append(errs, fmt.Errorf("post %s: %w", userID, err))
		}
	}
	return errors.Join(errs...)
}

func (s *slackDMNotifier) openConversation(client *http.Client, timeout time.Duration, userID string) (string, error) {
	var response struct {
		OK      bool   `json:"ok"`
		Error   string `json:"error,omitempty"`
		Channel struct {
			ID string `json:"id"`
		} `json:"channel"`
	}
	if err := postJSON(client, timeout, s.apiBaseURL+"/conversations.open", map[string]string{"users": userID}, slackBearerHeader(s.botToken), &response); err != nil {
		return "", err
	}
	if !response.OK || strings.TrimSpace(response.Channel.ID) == "" {
		if response.Error == "" {
			response.Error = "slack conversations.open failed"
		}
		return "", errors.New(response.Error)
	}
	return response.Channel.ID, nil
}

func (s *slackDMNotifier) postMessage(client *http.Client, timeout time.Duration, channelID string, request ApprovalRequest, dashboardURL string) error {
	var response struct {
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}
	payload := slackWebhookPayload(request, dashboardURL)
	payload["channel"] = channelID
	if err := postJSON(client, timeout, s.apiBaseURL+"/chat.postMessage", payload, slackBearerHeader(s.botToken), &response); err != nil {
		return err
	}
	if !response.OK {
		if response.Error == "" {
			response.Error = "slack chat.postMessage failed"
		}
		return errors.New(response.Error)
	}
	return nil
}

func slackWebhookPayload(request ApprovalRequest, dashboardURL string) map[string]any {
	text := renderCompactNotification(request, dashboardURL)
	blocks := []map[string]any{
		{
			"type": "section",
			"text": map[string]any{
				"type": "mrkdwn",
				"text": slackMarkdownNotification(request, dashboardURL),
			},
		},
	}
	if dashboardURL != "" {
		blocks = append(blocks, map[string]any{
			"type": "actions",
			"elements": []map[string]any{{
				"type": "button",
				"text": map[string]any{
					"type": "plain_text",
					"text": "Open Agent Tick",
				},
				"url": dashboardURL,
			}},
		})
	}
	return map[string]any{"text": text, "blocks": blocks}
}

func teamsWebhookPayload(request ApprovalRequest, dashboardURL string) map[string]any {
	payload := map[string]any{
		"@type":      "MessageCard",
		"@context":   "https://schema.org/extensions",
		"summary":    renderCompactNotification(request, dashboardURL),
		"themeColor": "2563EB",
		"title":      fmt.Sprintf("Agent Tick: %s", notificationTitle(request)),
		"text":       teamsMarkdownNotification(request, dashboardURL),
	}
	if dashboardURL != "" {
		payload["potentialAction"] = []map[string]any{{
			"@type": "OpenUri",
			"name":  "Open Agent Tick",
			"targets": []map[string]string{{
				"os":  "default",
				"uri": dashboardURL,
			}},
		}}
	}
	return payload
}

func postJSON(client *http.Client, timeout time.Duration, endpoint string, payload any, headers http.Header, out ...any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	ctx := context.Background()
	var cancel context.CancelFunc
	if timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, values := range headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return fmt.Errorf("unexpected status %s", resp.Status)
	}
	if len(out) == 0 || out[0] == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out[0])
}

func slackBearerHeader(token string) http.Header {
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+token)
	return headers
}

func smtpHost(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err == nil && host != "" {
		return host
	}
	return addr
}

func splitAndTrimCSV(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n' || r == ';'
	})
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return cleaned
}

func sanitizeHeader(value string) string {
	replacer := strings.NewReplacer("\r", " ", "\n", " ")
	return replacer.Replace(strings.TrimSpace(value))
}

func sanitizeHeaderValues(values []string) []string {
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = sanitizeHeader(value)
		if value != "" {
			cleaned = append(cleaned, value)
		}
	}
	return cleaned
}

func notificationTitle(request ApprovalRequest) string {
	if strings.TrimSpace(request.Title) != "" {
		return strings.TrimSpace(request.Title)
	}
	if strings.TrimSpace(request.Command) != "" {
		return "Run command?"
	}
	return "Approval requested"
}

func notificationRequester(request ApprovalRequest) string {
	if v := strings.TrimSpace(request.Requester.ProjectName); v != "" {
		return v
	}
	if v := strings.TrimSpace(request.Requester.Host); v != "" {
		return v
	}
	if v := strings.TrimSpace(request.Requester.Name); v != "" {
		return v
	}
	if v := strings.TrimSpace(request.Requester.WorkingDirectory); v != "" {
		return v
	}
	return "Agent"
}

func notificationDetails(request ApprovalRequest) string {
	if v := strings.TrimSpace(request.Command); v != "" {
		return truncateNotification(v, 280)
	}
	if v := strings.TrimSpace(request.Body); v != "" {
		return truncateNotification(v, 280)
	}
	if request.RequestType == RequestTypeQuestionnaire && len(request.Questions) > 0 {
		return truncateNotification(request.Questions[0].Question, 280)
	}
	if request.RequestType == RequestTypeSteer {
		return "Steering requested"
	}
	return "Approval requested"
}

func truncateNotification(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	if limit == 1 {
		return "…"
	}
	return strings.TrimSpace(string(runes[:limit-1])) + "…"
}

func renderPlainNotification(request ApprovalRequest, dashboardURL string) string {
	lines := []string{
		"Agent Tick approval request",
		"",
		"Title: " + notificationTitle(request),
		"Requester: " + notificationRequester(request),
		"Details: " + notificationDetails(request),
	}
	if dashboardURL != "" {
		lines = append(lines, "", "Open: "+dashboardURL)
	}
	return strings.Join(lines, "\n")
}

func renderCompactNotification(request ApprovalRequest, dashboardURL string) string {
	message := fmt.Sprintf("Agent Tick: %s — %s", notificationTitle(request), notificationRequester(request))
	if dashboardURL != "" {
		message += " — " + dashboardURL
	}
	return message
}

func slackMarkdownNotification(request ApprovalRequest, dashboardURL string) string {
	lines := []string{
		fmt.Sprintf("*:bell: Agent Tick approval request*"),
		fmt.Sprintf("*Title:* %s", notificationTitle(request)),
		fmt.Sprintf("*Requester:* %s", notificationRequester(request)),
		fmt.Sprintf("*Details:* %s", notificationDetails(request)),
	}
	if dashboardURL != "" {
		lines = append(lines, fmt.Sprintf("*Open:* <%s|Open in Agent Tick>", dashboardURL))
	}
	return strings.Join(lines, "\n")
}

func teamsMarkdownNotification(request ApprovalRequest, dashboardURL string) string {
	lines := []string{
		"**Agent Tick approval request**",
		"",
		"**Title:** " + notificationTitle(request),
		"**Requester:** " + notificationRequester(request),
		"**Details:** " + notificationDetails(request),
	}
	if dashboardURL != "" {
		lines = append(lines, "", "**Open:** "+dashboardURL)
	}
	return strings.Join(lines, "\n")
}
