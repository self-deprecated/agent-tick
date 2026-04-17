package approval

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

const expoPushURL = "https://exp.host/--/api/v2/push/send"

type PushSender struct {
	client *http.Client
	url    string
}

func NewPushSender() *PushSender {
	return &PushSender{client: http.DefaultClient, url: expoPushURL}
}

func (s *PushSender) SendApprovalRequest(tokens []string, request ApprovalRequest) error {
	if len(tokens) == 0 {
		return nil
	}

	messages := make([]expoPushMessage, 0, len(tokens))
	for _, token := range tokens {
		messages = append(messages, expoPushMessage{
			To:         token,
			Sound:      "default",
			Title:      pushTitle(request),
			Body:       pushBody(request),
			CategoryID: "approval-request",
			Data: map[string]string{
				"approvalRequestID": request.ID,
			},
		})
	}

	body, err := json.Marshal(messages)
	if err != nil {
		return err
	}

	resp, err := s.client.Post(s.url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("expo push service returned %s", resp.Status)
	}
	return nil
}

type expoPushMessage struct {
	To         string            `json:"to"`
	Sound      string            `json:"sound"`
	Title      string            `json:"title"`
	Body       string            `json:"body"`
	CategoryID string            `json:"categoryId,omitempty"`
	Data       map[string]string `json:"data"`
}

func pushTitle(request ApprovalRequest) string {
	if request.Command != "" {
		return "Run Command?"
	}
	return request.Title
}

func pushBody(request ApprovalRequest) string {
	if request.Command != "" {
		host := request.Requester.Host
		if host == "" {
			host = request.Requester.Name
		}
		if host == "" {
			host = "Agent"
		}
		return host + ": " + request.Command
	}
	if request.Body != "" {
		return request.Body
	}
	return "Approval requested"
}
