package approval

import "time"

const (
	RequestTypeApproval      = "approval"
	RequestTypeQuestionnaire = "questionnaire"
	RequestTypeSteer         = "steer"

	SteerNoneChoiceID    = "none"
	SteerNoneChoiceLabel = "Do nothing / skip"
)

type Requester struct {
	Name             string `json:"name"`
	AgentID          string `json:"agentId"`
	Host             string `json:"host,omitempty"`
	WorkingDirectory string `json:"workingDirectory,omitempty"`
	ProjectName      string `json:"projectName,omitempty"`
	ProjectID        string `json:"projectId,omitempty"`
}

type Choice struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

type QuestionOption struct {
	Label string `json:"label"`
}

type Question struct {
	Header      string           `json:"header"`
	Question    string           `json:"question"`
	Options     []QuestionOption `json:"options"`
	MultiSelect bool             `json:"multiSelect"`
}

type CreateRequest struct {
	Requester          Requester         `json:"requester"`
	RequestType        string            `json:"requestType,omitempty"`
	Title              string            `json:"title"`
	Body               string            `json:"body,omitempty"`
	Command            string            `json:"command,omitempty"`
	Choices            []Choice          `json:"choices,omitempty"`
	Questions          []Question        `json:"questions,omitempty"`
	DefaultChoice      string            `json:"defaultChoice,omitempty"`
	AllowFreeformReply bool              `json:"allowFreeformReply"`
	ExpiresAt          *time.Time        `json:"expiresAt,omitempty"`
	Risk               string            `json:"risk,omitempty"`
	Metadata           map[string]string `json:"metadata,omitempty"`
}

type ApprovalRequest struct {
	ID                 string                  `json:"id"`
	UserID             string                  `json:"userId,omitempty"`
	Requester          Requester               `json:"requester"`
	RequestType        string                  `json:"requestType"`
	Title              string                  `json:"title"`
	Body               string                  `json:"body,omitempty"`
	Command            string                  `json:"command,omitempty"`
	Choices            []Choice                `json:"choices"`
	Questions          []Question              `json:"questions,omitempty"`
	DefaultChoice      string                  `json:"defaultChoice,omitempty"`
	AllowFreeformReply bool                    `json:"allowFreeformReply"`
	ExpiresAt          *time.Time              `json:"expiresAt,omitempty"`
	Risk               string                  `json:"risk,omitempty"`
	Metadata           map[string]string       `json:"metadata,omitempty"`
	Status             string                  `json:"status"`
	CreatedAt          time.Time               `json:"createdAt"`
	RespondedAt        *time.Time              `json:"respondedAt,omitempty"`
	Response           *Response               `json:"response,omitempty"`
	PolicyProgress     *ApprovalPolicyProgress `json:"policyProgress,omitempty"`
}

type Response struct {
	ChoiceID string              `json:"choiceId"`
	Message  string              `json:"message,omitempty"`
	Answers  map[string][]string `json:"answers,omitempty"`
}

type ApprovalVoteRecord struct {
	VoteID         string              `json:"voteId"`
	RequestID      string              `json:"requestId"`
	PolicyID       string              `json:"policyId,omitempty"`
	Step           int                 `json:"step"`
	ApproverUserID string              `json:"approverUserId"`
	Source         string              `json:"source"`
	ChoiceID       string              `json:"choiceId"`
	Message        string              `json:"message,omitempty"`
	Answers        map[string][]string `json:"answers,omitempty"`
	CreatedAt      time.Time           `json:"createdAt"`
}

type ApprovalPolicyProgress struct {
	PolicyID            string               `json:"policyId,omitempty"`
	State               string               `json:"state"`
	CurrentStep         int                  `json:"currentStep"`
	TotalSteps          int                  `json:"totalSteps"`
	RequiredApprovals   int                  `json:"requiredApprovals"`
	ReceivedApprovals   int                  `json:"receivedApprovals"`
	CurrentUserHasVoted bool                 `json:"currentUserHasVoted"`
	CurrentUserEligible bool                 `json:"currentUserEligible"`
	CurrentUserVote     *ApprovalVoteRecord  `json:"currentUserVote,omitempty"`
	WaitingFor          int                  `json:"waitingFor"`
	EligibleApproverIDs []string             `json:"eligibleApproverIds,omitempty"`
	Votes               []ApprovalVoteRecord `json:"votes,omitempty"`
}

type PairingToken struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	QRDataURL string    `json:"qrDataUrl,omitempty"`
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
	DeviceID          string     `json:"deviceId"`
	Name              string     `json:"name"`
	PushNotifications bool       `json:"pushNotifications"`
	CreatedAt         time.Time  `json:"createdAt"`
	UnpairedAt        *time.Time `json:"unpairedAt,omitempty"`
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
	AgentID               string   `json:"agentId"`
	Name                  string   `json:"name"`
	Token                 string   `json:"token"`
	Scopes                []string `json:"scopes"`
	OrganizationID        string   `json:"organizationId,omitempty"`
	ProjectID             string   `json:"projectId,omitempty"`
	OwnerUserID           string   `json:"ownerUserId,omitempty"`
	TeamID                string   `json:"teamId,omitempty"`
	DefaultApprovalPolicy string   `json:"defaultApprovalPolicy,omitempty"`
}

type CreateAgentTokenRequest struct {
	Name                  string   `json:"name"`
	Scopes                []string `json:"scopes,omitempty"`
	ProjectID             string   `json:"projectId,omitempty"`
	OwnerUserID           string   `json:"ownerUserId,omitempty"`
	TeamID                string   `json:"teamId,omitempty"`
	DefaultApprovalPolicy string   `json:"defaultApprovalPolicy,omitempty"`
}

type AgentTokenRecord struct {
	AgentID               string     `json:"agentId"`
	Name                  string     `json:"name"`
	Scopes                []string   `json:"scopes"`
	OrganizationID        string     `json:"organizationId,omitempty"`
	ProjectID             string     `json:"projectId,omitempty"`
	OwnerUserID           string     `json:"ownerUserId,omitempty"`
	TeamID                string     `json:"teamId,omitempty"`
	DefaultApprovalPolicy string     `json:"defaultApprovalPolicy,omitempty"`
	LastRequestAt         *time.Time `json:"lastRequestAt,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	RevokedAt             *time.Time `json:"revokedAt,omitempty"`
}

type AgentTokenAuth struct {
	UserID                string
	AgentID               string
	OrganizationID        string
	ProjectID             string
	OwnerUserID           string
	TeamID                string
	DefaultApprovalPolicy string
}

const (
	StatusPending   = "pending"
	StatusResponded = "responded"
	StatusExpired   = "expired"
	StatusAbandoned = "abandoned"
)

const (
	RoleOwner    = "owner"
	RoleAdmin    = "admin"
	RoleApprover = "approver"
	RoleViewer   = "viewer"
)

const (
	defaultOrganizationID = "org_default"
	defaultProjectID      = "prj_default"
)

type OrganizationRecord struct {
	OrganizationID  string    `json:"organizationId"`
	Name            string    `json:"name"`
	DefaultPolicyID string    `json:"defaultPolicyId,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}

type OrganizationMembershipRecord struct {
	OrganizationID string    `json:"organizationId"`
	Name           string    `json:"name"`
	UserID         string    `json:"userId"`
	Role           string    `json:"role"`
	CreatedAt      time.Time `json:"createdAt"`
}

type CreateOrganizationRequest struct {
	Name string `json:"name"`
}

type TeamRecord struct {
	TeamID         string    `json:"teamId"`
	OrganizationID string    `json:"organizationId"`
	Name           string    `json:"name"`
	Description    string    `json:"description,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CreateTeamRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type UpdateTeamRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type TeamMemberRecord struct {
	TeamID    string    `json:"teamId"`
	UserID    string    `json:"userId"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
}

type UpsertTeamMemberRequest struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

type ProjectRecord struct {
	ProjectID       string    `json:"projectId"`
	OrganizationID  string    `json:"organizationId"`
	TeamID          string    `json:"teamId,omitempty"`
	Name            string    `json:"name"`
	Slug            string    `json:"slug"`
	Description     string    `json:"description,omitempty"`
	DefaultPolicyID string    `json:"defaultPolicyId,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type CreateProjectRequest struct {
	Name            string `json:"name"`
	TeamID          string `json:"teamId,omitempty"`
	Description     string `json:"description,omitempty"`
	DefaultPolicyID string `json:"defaultPolicyId,omitempty"`
}

type UpdateProjectRequest struct {
	Name            string `json:"name"`
	TeamID          string `json:"teamId,omitempty"`
	Description     string `json:"description,omitempty"`
	DefaultPolicyID string `json:"defaultPolicyId,omitempty"`
}

type InviteRecord struct {
	InviteID       string     `json:"inviteId"`
	OrganizationID string     `json:"organizationId"`
	Email          string     `json:"email"`
	Role           string     `json:"role"`
	TeamID         string     `json:"teamId,omitempty"`
	ExpiresAt      *time.Time `json:"expiresAt,omitempty"`
	AcceptedAt     *time.Time `json:"acceptedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

const (
	PolicyTemplateOwnerOnly      = "owner-only"
	PolicyTemplateAnyTeamMember  = "any-team-member"
	PolicyTemplateOnCall         = "on-call"
	PolicyTemplateRecentlyActive = "recently-active"
	PolicyTemplateQuorum         = "quorum"
	PolicyTemplateSequence       = "sequence"
	PolicyTemplateRiskBased      = "risk-based"
)

type ApprovalPolicyRecord struct {
	PolicyID       string               `json:"policyId"`
	OrganizationID string               `json:"organizationId"`
	ProjectID      string               `json:"projectId,omitempty"`
	TeamID         string               `json:"teamId,omitempty"`
	Name           string               `json:"name"`
	Template       string               `json:"template"`
	Summary        string               `json:"summary"`
	Settings       map[string]string    `json:"settings"`
	Steps          []ApprovalPolicyStep `json:"steps"`
	CreatedAt      time.Time            `json:"createdAt"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}

type ApprovalPolicyStep struct {
	StepID           string `json:"stepId,omitempty"`
	Position         int    `json:"position"`
	StepType         string `json:"stepType"`
	TeamID           string `json:"teamId,omitempty"`
	Quorum           int    `json:"quorum,omitempty"`
	TimeoutSeconds   int    `json:"timeoutSeconds,omitempty"`
	EscalationTarget string `json:"escalationTarget,omitempty"`
	DenyVeto         bool   `json:"denyVeto"`
}

type CreateApprovalPolicyRequest struct {
	Name      string               `json:"name"`
	Template  string               `json:"template"`
	ProjectID string               `json:"projectId,omitempty"`
	TeamID    string               `json:"teamId,omitempty"`
	Settings  map[string]string    `json:"settings,omitempty"`
	Steps     []ApprovalPolicyStep `json:"steps,omitempty"`
}

type UpdateApprovalPolicyRequest struct {
	Name      string               `json:"name"`
	Template  string               `json:"template"`
	ProjectID string               `json:"projectId,omitempty"`
	TeamID    string               `json:"teamId,omitempty"`
	Settings  map[string]string    `json:"settings,omitempty"`
	Steps     []ApprovalPolicyStep `json:"steps,omitempty"`
}

type ApprovalPolicyPreview struct {
	PolicyID    string   `json:"policyId"`
	Summary     string   `json:"summary"`
	Notifies    []string `json:"notifies"`
	Limitations []string `json:"limitations,omitempty"`
}

func DefaultChoices() []Choice {
	return []Choice{
		{ID: "approve", Label: "Approve", Kind: "approve"},
		{ID: "deny", Label: "Deny", Kind: "deny"},
	}
}
