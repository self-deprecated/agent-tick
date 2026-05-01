package approval

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
			CategoryID: pushCategoryID(request),
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
	if err := checkExpoPushTickets(resp.Body); err != nil {
		return err
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

type expoPushTicket struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

type expoPushResponse struct {
	Data []expoPushTicket `json:"data"`
}

func checkExpoPushTickets(body io.Reader) error {
	data, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}

	var wrapped expoPushResponse
	if err := json.Unmarshal(data, &wrapped); err == nil && wrapped.Data != nil {
		return firstExpoTicketError(wrapped.Data)
	}

	var tickets []expoPushTicket
	if err := json.Unmarshal(data, &tickets); err != nil {
		return err
	}
	return firstExpoTicketError(tickets)
}

func firstExpoTicketError(tickets []expoPushTicket) error {
	for _, ticket := range tickets {
		if ticket.Status == "error" {
			if ticket.Message == "" {
				return fmt.Errorf("expo push ticket error")
			}
			return fmt.Errorf("expo push ticket error: %s", ticket.Message)
		}
	}
	return nil
}

func pushCategoryID(request ApprovalRequest) string {
	if normalizeRequestType(request.RequestType) == RequestTypeApproval && hasChoice(request, "approve") && hasChoice(request, "deny") {
		return "approval-request"
	}
	return ""
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
	if request.RequestType == RequestTypeQuestionnaire && len(request.Questions) > 0 {
		return request.Questions[0].Question
	}
	if request.RequestType == RequestTypeSteer {
		return "Steering requested"
	}
	return "Approval requested"
}
