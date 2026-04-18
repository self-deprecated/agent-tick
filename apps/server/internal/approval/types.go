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
	UserID             string            `json:"userId,omitempty"`
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

type PairingToken struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type PairDeviceRequest struct {
	Token      string `json:"token"`
	DeviceName string `json:"deviceName"`
}

type DeviceCredential struct {
	DeviceID string `json:"deviceId"`
	Token    string `json:"token"`
}

type DeviceRecord struct {
	DeviceID          string    `json:"deviceId"`
	Name              string    `json:"name"`
	PushNotifications bool      `json:"pushNotifications"`
	CreatedAt         time.Time `json:"createdAt"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name,omitempty"`
}

type SessionCredential struct {
	UserID string    `json:"userId"`
	Email  string    `json:"email"`
	Name   string    `json:"name"`
	Token  string    `json:"token,omitempty"`
	Expiry time.Time `json:"expiry"`
}

type PushTokenRequest struct {
	Token string `json:"token"`
}

type AgentCredential struct {
	AgentID string   `json:"agentId"`
	Name    string   `json:"name"`
	Token   string   `json:"token"`
	Scopes  []string `json:"scopes"`
}

type AgentTokenRecord struct {
	AgentID   string     `json:"agentId"`
	Name      string     `json:"name"`
	Scopes    []string   `json:"scopes"`
	CreatedAt time.Time  `json:"createdAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

const (
	StatusPending   = "pending"
	StatusResponded = "responded"
	StatusExpired   = "expired"
)

func DefaultChoices() []Choice {
	return []Choice{
		{ID: "approve", Label: "Approve", Kind: "approve"},
		{ID: "deny", Label: "Deny", Kind: "deny"},
	}
}
