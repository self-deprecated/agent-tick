package approval

import "time"

type Requester struct {
	Name             string `json:"name"`
	AgentID          string `json:"agentId"`
	Host             string `json:"host,omitempty"`
	WorkingDirectory string `json:"workingDirectory,omitempty"`
}

type Choice struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

type CreateRequest struct {
	Requester          Requester         `json:"requester"`
	Title              string            `json:"title"`
	Body               string            `json:"body,omitempty"`
	Command            string            `json:"command,omitempty"`
	Choices            []Choice          `json:"choices,omitempty"`
	DefaultChoice      string            `json:"defaultChoice,omitempty"`
	AllowFreeformReply bool              `json:"allowFreeformReply"`
	ExpiresAt          *time.Time        `json:"expiresAt,omitempty"`
	Risk               string            `json:"risk,omitempty"`
	Metadata           map[string]string `json:"metadata,omitempty"`
}

type ApprovalRequest struct {
	ID                 string            `json:"id"`
	Requester          Requester         `json:"requester"`
	Title              string            `json:"title"`
	Body               string            `json:"body,omitempty"`
	Command            string            `json:"command,omitempty"`
	Choices            []Choice          `json:"choices"`
	DefaultChoice      string            `json:"defaultChoice,omitempty"`
	AllowFreeformReply bool              `json:"allowFreeformReply"`
	ExpiresAt          *time.Time        `json:"expiresAt,omitempty"`
	Risk               string            `json:"risk,omitempty"`
	Metadata           map[string]string `json:"metadata,omitempty"`
	Status             string            `json:"status"`
	CreatedAt          time.Time         `json:"createdAt"`
	RespondedAt        *time.Time        `json:"respondedAt,omitempty"`
	Response           *Response         `json:"response,omitempty"`
}

type Response struct {
	ChoiceID string `json:"choiceId"`
	Message  string `json:"message,omitempty"`
}

const (
	StatusPending   = "pending"
	StatusResponded = "responded"
)

func DefaultChoices() []Choice {
	return []Choice{
		{ID: "approve", Label: "Approve", Kind: "approve"},
		{ID: "deny", Label: "Deny", Kind: "deny"},
	}
}
