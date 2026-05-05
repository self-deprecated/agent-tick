package approval

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("approval request not found")
var ErrAlreadyResponded = errors.New("approval request already has a response")
var ErrInvalidChoice = errors.New("approval response choice is not allowed")
var ErrInvalidRequest = errors.New("approval request is invalid")
var ErrInvalidResponse = errors.New("approval response is invalid")
var ErrPlanLimitExceeded = errors.New("organization plan limit exceeded")
var ErrExpired = errors.New("approval request has expired")
var ErrAbandoned = errors.New("approval request has been abandoned")

type Store interface {
	Create(CreateRequest) (ApprovalRequest, error)
	List(status string) ([]ApprovalRequest, error)
	Get(id string) (ApprovalRequest, error)
	Respond(id string, response Response) (ApprovalRequest, error)
	Abandon(id string) (ApprovalRequest, bool, error)
}

type UserScopedStore interface {
	CreateForUser(userID string, input CreateRequest) (ApprovalRequest, error)
	ListForUser(userID string, status string) ([]ApprovalRequest, error)
	GetForUser(userID string, id string) (ApprovalRequest, error)
	RespondForUser(userID string, id string, response Response) (ApprovalRequest, error)
	AbandonForUser(userID string, id string) (ApprovalRequest, bool, error)
}

type StoreWithAbandonReason interface {
	AbandonWithReason(id string, reason string) (ApprovalRequest, bool, error)
}

type UserScopedStoreWithAbandonReason interface {
	AbandonForUserWithReason(userID string, id string, reason string) (ApprovalRequest, bool, error)
}

type PairingStore interface {
	CreatePairingToken(ttl time.Duration) (PairingToken, error)
	PairDevice(token string, deviceName string) (DeviceCredential, error)
	VerifyDeviceToken(token string) (bool, error)
	VerifyDeviceTokenForDevice(deviceID string, token string) (bool, error)
	SetDevicePushToken(deviceID string, token string) error
	ListDevices() ([]DeviceRecord, error)
	ListDevicePushTokens() ([]string, error)
	UnpairDevice(deviceID string) error
}

type UserScopedPairingStore interface {
	CreatePairingTokenForUser(userID string, ttl time.Duration) (PairingToken, error)
	ListDevicesForUser(userID string) ([]DeviceRecord, error)
	ListDevicePushTokensForUser(userID string) ([]string, error)
	UnpairDeviceForUser(userID string, deviceID string) error
}

type AgentStore interface {
	CreateAgentToken(name string, scopes []string) (AgentCredential, error)
	VerifyAgentToken(token string, scope string) (bool, error)
	ListAgentTokens() ([]AgentTokenRecord, error)
	RevokeAgentToken(agentID string) error
	RotateAgentToken(agentID string) (AgentCredential, error)
}

type UserScopedAgentStore interface {
	CreateAgentTokenForUser(userID string, name string, scopes []string) (AgentCredential, error)
	ListAgentTokensForUser(userID string) ([]AgentTokenRecord, error)
	RevokeAgentTokenForUser(userID string, agentID string) error
}

type AgentTokenOptionsStore interface {
	CreateAgentTokenWithOptions(input CreateAgentTokenRequest) (AgentCredential, error)
}

type UserScopedAgentTokenOptionsStore interface {
	CreateAgentTokenForUserWithOptions(userID string, input CreateAgentTokenRequest) (AgentCredential, error)
}

type AgentTokenAuthStore interface {
	AgentAuthForToken(token string, scope string) (AgentTokenAuth, bool, error)
}

type AgentRequestRecorder interface {
	RecordAgentRequest(agentID string, at time.Time) error
}

type PolicyResponseStore interface {
	RespondForUserWithAuth(auth authContext, id string, response Response) (ApprovalRequest, error)
}

type PolicyProgressStore interface {
	PolicyProgressForRequest(requestID string, currentUserID string) (*ApprovalPolicyProgress, error)
}

type EligiblePushTokenStore interface {
	ListEligibleDevicePushTokens(request ApprovalRequest) ([]string, error)
}

type ExpiringStore interface {
	ExpirePendingRequests() ([]string, error)
}

type UserTokenStore interface {
	UserIDForAgentToken(token string, scope string) (string, bool, error)
	UserIDForDeviceToken(token string) (string, bool, error)
	UserIDForDeviceTokenForDevice(deviceID string, token string) (string, bool, error)
}

type UserAccountStore interface {
	LoginOrCreateUser(email string, password string, name string, ttl time.Duration) (SessionCredential, error)
	UserIDForSessionToken(token string) (string, bool, error)
}

type OrganizationStore interface {
	ListOrganizationsForUser(userID string) ([]OrganizationMembershipRecord, error)
	CreateOrganizationForUser(userID string, name string) (OrganizationRecord, error)
	OrganizationRoleForUser(userID string, organizationID string) (string, bool, error)
	DefaultOrganizationForUser(userID string) (OrganizationMembershipRecord, error)
}

type BillingStore interface {
	BillingStatus(organizationID string) (BillingStatus, error)
}

type BillingProvider interface {
	PortalURL(organizationID string) string
	HandleWebhook(payload []byte, signature string) error
}

type PresenceStore interface {
	RecordHeartbeat(userID string, deviceID string, client string) (UserAvailabilityRecord, error)
	GetAvailability(userID string) (UserAvailabilityRecord, error)
	SetAvailability(userID string, input AvailabilityRequest) (UserAvailabilityRecord, error)
	ListTeamAvailability(organizationID string, teamID string) ([]UserAvailabilityRecord, error)
	GetTeamCoverage(organizationID string, teamID string) (TeamCoverageRecord, error)
	ListOnCallSchedules(organizationID string, teamID string) ([]OnCallScheduleRecord, error)
	UpsertOnCallSchedule(organizationID string, teamID string, input UpsertOnCallScheduleRequest) (OnCallScheduleRecord, error)
}

type TeamProjectStore interface {
	ListTeams(organizationID string) ([]TeamRecord, error)
	CreateTeam(organizationID string, input CreateTeamRequest) (TeamRecord, error)
	GetTeam(organizationID string, teamID string) (TeamRecord, error)
	UpdateTeam(organizationID string, teamID string, input UpdateTeamRequest) (TeamRecord, error)
	ListTeamMembers(organizationID string, teamID string) ([]TeamMemberRecord, error)
	UpsertTeamMember(organizationID string, teamID string, input UpsertTeamMemberRequest) (TeamMemberRecord, error)
	RemoveTeamMember(organizationID string, teamID string, userID string) error
	ListProjects(organizationID string) ([]ProjectRecord, error)
	CreateProject(organizationID string, input CreateProjectRequest) (ProjectRecord, error)
	GetProject(organizationID string, projectID string) (ProjectRecord, error)
	UpdateProject(organizationID string, projectID string, input UpdateProjectRequest) (ProjectRecord, error)
}

type TeamProjectActorStore interface {
	CreateTeamForUser(actorUserID string, organizationID string, input CreateTeamRequest) (TeamRecord, error)
	UpdateTeamForUser(actorUserID string, organizationID string, teamID string, input UpdateTeamRequest) (TeamRecord, error)
	UpsertTeamMemberForUser(actorUserID string, organizationID string, teamID string, input UpsertTeamMemberRequest) (TeamMemberRecord, error)
	RemoveTeamMemberForUser(actorUserID string, organizationID string, teamID string, userID string) error
	CreateProjectForUser(actorUserID string, organizationID string, input CreateProjectRequest) (ProjectRecord, error)
	UpdateProjectForUser(actorUserID string, organizationID string, projectID string, input UpdateProjectRequest) (ProjectRecord, error)
}

type ApprovalPolicyStore interface {
	ListApprovalPolicies(organizationID string) ([]ApprovalPolicyRecord, error)
	CreateApprovalPolicy(organizationID string, input CreateApprovalPolicyRequest) (ApprovalPolicyRecord, error)
	GetApprovalPolicy(organizationID string, policyID string) (ApprovalPolicyRecord, error)
	UpdateApprovalPolicy(organizationID string, policyID string, input UpdateApprovalPolicyRequest) (ApprovalPolicyRecord, error)
	DeleteApprovalPolicy(organizationID string, policyID string) error
	PreviewApprovalPolicy(organizationID string, policyID string) (ApprovalPolicyPreview, error)
	ResolveApprovalPolicy(organizationID string, projectID string, hint string) (string, error)
}

type FileStore struct {
	path string
	mu   sync.Mutex
}

func NewFileStore(path string) *FileStore {
	return &FileStore{path: path}
}

func (s *FileStore) Create(input CreateRequest) (ApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	requests, err := s.load()
	if err != nil {
		return ApprovalRequest{}, err
	}

	input, err = normalizeCreateRequest(input)
	if err != nil {
		return ApprovalRequest{}, err
	}

	now := time.Now().UTC()
	request := ApprovalRequest{
		ID:                 newID(),
		Requester:          input.Requester,
		RequestType:        input.RequestType,
		Title:              input.Title,
		Body:               input.Body,
		Command:            input.Command,
		Choices:            input.Choices,
		Questions:          input.Questions,
		DefaultChoice:      input.DefaultChoice,
		AllowFreeformReply: input.AllowFreeformReply,
		ExpiresAt:          input.ExpiresAt,
		Risk:               input.Risk,
		Metadata:           input.Metadata,
		Status:             StatusPending,
		CreatedAt:          now,
	}

	requests = append(requests, request)
	return request, s.save(requests)
}

func (s *FileStore) List(status string) ([]ApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	requests, err := s.load()
	if err != nil {
		return nil, err
	}
	requests = expireRequests(requests)
	if err := s.save(requests); err != nil {
		return nil, err
	}

	if status == "" {
		return requests, nil
	}

	filtered := make([]ApprovalRequest, 0, len(requests))
	for _, request := range requests {
		if request.Status == status {
			filtered = append(filtered, request)
		}
	}
	return filtered, nil
}

func (s *FileStore) Get(id string) (ApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	requests, err := s.load()
	if err != nil {
		return ApprovalRequest{}, err
	}
	requests = expireRequests(requests)
	if err := s.save(requests); err != nil {
		return ApprovalRequest{}, err
	}

	for _, request := range requests {
		if request.ID == id {
			return request, nil
		}
	}
	return ApprovalRequest{}, ErrNotFound
}

func (s *FileStore) Respond(id string, response Response) (ApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	requests, err := s.load()
	if err != nil {
		return ApprovalRequest{}, err
	}
	requests = expireRequests(requests)

	for i := range requests {
		if requests[i].ID == id {
			if requests[i].Response != nil {
				return ApprovalRequest{}, ErrAlreadyResponded
			}
			if requests[i].Status == StatusExpired {
				return ApprovalRequest{}, ErrExpired
			}
			if requests[i].Status == StatusAbandoned {
				return ApprovalRequest{}, ErrAbandoned
			}
			if err := validateResponseForRequest(requests[i], response); err != nil {
				return ApprovalRequest{}, err
			}

			now := time.Now().UTC()
			requests[i].Status = StatusResponded
			requests[i].RespondedAt = &now
			requests[i].Response = &response
			return requests[i], s.save(requests)
		}
	}
	return ApprovalRequest{}, ErrNotFound
}

func (s *FileStore) Abandon(id string) (ApprovalRequest, bool, error) {
	return s.AbandonWithReason(id, "")
}

func (s *FileStore) AbandonWithReason(id string, reason string) (ApprovalRequest, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	requests, err := s.load()
	if err != nil {
		return ApprovalRequest{}, false, err
	}
	requests = expireRequests(requests)

	for i := range requests {
		if requests[i].ID == id {
			changed := false
			if requests[i].Status == StatusPending && requests[i].Response == nil {
				requests[i].Status = StatusAbandoned
				if reason = strings.TrimSpace(reason); reason != "" {
					if requests[i].Metadata == nil {
						requests[i].Metadata = map[string]string{}
					}
					requests[i].Metadata["abandonReason"] = reason
				}
				changed = true
			}
			return requests[i], changed, s.save(requests)
		}
	}
	return ApprovalRequest{}, false, ErrNotFound
}

func expireRequests(requests []ApprovalRequest) []ApprovalRequest {
	now := time.Now().UTC()
	for i := range requests {
		if requests[i].Status == StatusPending && requests[i].ExpiresAt != nil && !requests[i].ExpiresAt.After(now) {
			requests[i].Status = StatusExpired
		}
	}
	return requests
}

func hasChoice(request ApprovalRequest, choiceID string) bool {
	for _, choice := range request.Choices {
		if choice.ID == choiceID {
			return true
		}
	}
	return false
}

func normalizeCreateRequest(input CreateRequest) (CreateRequest, error) {
	input.RequestType = normalizeRequestType(input.RequestType)
	switch input.RequestType {
	case RequestTypeApproval:
		if len(input.Questions) > 0 {
			return CreateRequest{}, fmt.Errorf("%w: approval requests do not support questions", ErrInvalidRequest)
		}
		if len(input.Choices) == 0 {
			input.Choices = DefaultChoices()
		}
		choices, err := normalizeChoices(input.Choices, false)
		if err != nil {
			return CreateRequest{}, err
		}
		input.Choices = choices
		input.DefaultChoice = strings.TrimSpace(input.DefaultChoice)
		if input.DefaultChoice != "" && !hasChoiceID(input.Choices, input.DefaultChoice) {
			return CreateRequest{}, fmt.Errorf("%w: defaultChoice is not in choices", ErrInvalidRequest)
		}
	case RequestTypeQuestionnaire:
		if len(input.Choices) > 0 {
			return CreateRequest{}, fmt.Errorf("%w: questionnaire requests do not support choices", ErrInvalidRequest)
		}
		if strings.TrimSpace(input.DefaultChoice) != "" {
			return CreateRequest{}, fmt.Errorf("%w: questionnaire requests do not support defaultChoice", ErrInvalidRequest)
		}
		if input.AllowFreeformReply {
			return CreateRequest{}, fmt.Errorf("%w: questionnaire requests do not support allowFreeformReply", ErrInvalidRequest)
		}
		questions, err := normalizeQuestions(input.Questions)
		if err != nil {
			return CreateRequest{}, err
		}
		input.Questions = questions
	case RequestTypeSteer:
		if len(input.Questions) > 0 {
			return CreateRequest{}, fmt.Errorf("%w: steer requests do not support questions", ErrInvalidRequest)
		}
		if strings.TrimSpace(input.Command) != "" {
			return CreateRequest{}, fmt.Errorf("%w: steer requests do not support command", ErrInvalidRequest)
		}
		if input.AllowFreeformReply {
			return CreateRequest{}, fmt.Errorf("%w: steer requests do not support allowFreeformReply", ErrInvalidRequest)
		}
		if defaultChoice := strings.TrimSpace(input.DefaultChoice); defaultChoice != "" && defaultChoice != SteerNoneChoiceID {
			return CreateRequest{}, fmt.Errorf("%w: steer defaultChoice must be %q", ErrInvalidRequest, SteerNoneChoiceID)
		}
		choices, err := normalizeSteerChoices(input.Choices)
		if err != nil {
			return CreateRequest{}, err
		}
		input.Choices = choices
		input.DefaultChoice = SteerNoneChoiceID
		input.AllowFreeformReply = false
	default:
		return CreateRequest{}, fmt.Errorf("%w: unsupported requestType %q", ErrInvalidRequest, input.RequestType)
	}
	return input, nil
}

func normalizeChoices(input []Choice, steerIDs bool) ([]Choice, error) {
	choices := make([]Choice, 0, len(input))
	seen := make(map[string]struct{}, len(input))
	for _, choice := range input {
		id := strings.TrimSpace(choice.ID)
		label := strings.TrimSpace(choice.Label)
		kind := strings.TrimSpace(choice.Kind)
		if id == "" || label == "" {
			return nil, fmt.Errorf("%w: choice id and label are required", ErrInvalidRequest)
		}
		if _, exists := seen[id]; exists {
			return nil, fmt.Errorf("%w: duplicate choice id %q", ErrInvalidRequest, id)
		}
		if steerIDs && !validSteerChoiceID(id) {
			return nil, fmt.Errorf("%w: steer choice id %q must match [A-Za-z0-9_-]{1,64}", ErrInvalidRequest, id)
		}
		seen[id] = struct{}{}
		choices = append(choices, Choice{ID: id, Label: label, Kind: kind})
	}
	return choices, nil
}

func normalizeSteerChoices(input []Choice) ([]Choice, error) {
	if len(input) == 0 {
		return nil, fmt.Errorf("%w: steer requests need at least one option", ErrInvalidRequest)
	}
	choices, err := normalizeChoices(input, true)
	if err != nil {
		return nil, err
	}
	for i := range choices {
		if choices[i].ID == SteerNoneChoiceID {
			return nil, fmt.Errorf("%w: steer option id %q is reserved", ErrInvalidRequest, SteerNoneChoiceID)
		}
		choices[i].Kind = RequestTypeSteer
	}
	choices = append(choices, Choice{ID: SteerNoneChoiceID, Label: SteerNoneChoiceLabel, Kind: SteerNoneChoiceID})
	return choices, nil
}

func validSteerChoiceID(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func normalizeQuestions(input []Question) ([]Question, error) {
	if len(input) == 0 {
		return nil, fmt.Errorf("%w: questionnaire requests need at least one question", ErrInvalidRequest)
	}
	questions := make([]Question, 0, len(input))
	seen := make(map[string]struct{}, len(input))
	for _, question := range input {
		text := strings.TrimSpace(question.Question)
		if text == "" {
			return nil, fmt.Errorf("%w: question text is required", ErrInvalidRequest)
		}
		header := strings.TrimSpace(question.Header)
		if header == "" {
			header = text
		}
		if _, exists := seen[text]; exists {
			return nil, fmt.Errorf("%w: duplicate question %q", ErrInvalidRequest, text)
		}
		seen[text] = struct{}{}
		if len(question.Options) == 0 {
			return nil, fmt.Errorf("%w: question %q needs options", ErrInvalidRequest, text)
		}
		options := make([]QuestionOption, 0, len(question.Options))
		labels := make(map[string]struct{}, len(question.Options))
		for _, option := range question.Options {
			label := strings.TrimSpace(option.Label)
			if label == "" {
				return nil, fmt.Errorf("%w: question %q has an empty option", ErrInvalidRequest, text)
			}
			if _, exists := labels[label]; exists {
				return nil, fmt.Errorf("%w: question %q has duplicate option %q", ErrInvalidRequest, text, label)
			}
			labels[label] = struct{}{}
			options = append(options, QuestionOption{Label: label})
		}
		questions = append(questions, Question{
			Header:      header,
			Question:    text,
			Options:     options,
			MultiSelect: question.MultiSelect,
		})
	}
	return questions, nil
}

func validateResponseForRequest(request ApprovalRequest, response Response) error {
	requestType := normalizeRequestType(request.RequestType)
	if strings.TrimSpace(response.Message) != "" && !request.AllowFreeformReply {
		return fmt.Errorf("%w: request does not allow freeform replies", ErrInvalidResponse)
	}
	switch requestType {
	case RequestTypeApproval:
		if strings.TrimSpace(response.ChoiceID) == "" {
			return fmt.Errorf("%w: choiceId is required", ErrInvalidResponse)
		}
		if !hasChoice(request, response.ChoiceID) {
			return ErrInvalidChoice
		}
		if len(response.Answers) > 0 {
			return fmt.Errorf("%w: approval requests do not accept answers", ErrInvalidResponse)
		}
		return nil
	case RequestTypeQuestionnaire:
		if strings.TrimSpace(response.ChoiceID) != "" {
			return fmt.Errorf("%w: questionnaire requests do not accept choiceId", ErrInvalidResponse)
		}
		if strings.TrimSpace(response.Message) != "" {
			return fmt.Errorf("%w: questionnaire requests do not accept message", ErrInvalidResponse)
		}
		return validateQuestionnaireAnswers(request.Questions, response.Answers)
	case RequestTypeSteer:
		if strings.TrimSpace(response.ChoiceID) == "" {
			return fmt.Errorf("%w: choiceId is required", ErrInvalidResponse)
		}
		if !hasChoice(request, response.ChoiceID) {
			return ErrInvalidChoice
		}
		if len(response.Answers) > 0 {
			return fmt.Errorf("%w: steer requests do not accept answers", ErrInvalidResponse)
		}
		if strings.TrimSpace(response.Message) != "" {
			return fmt.Errorf("%w: steer requests do not accept message", ErrInvalidResponse)
		}
		return nil
	default:
		return fmt.Errorf("%w: unsupported requestType %q", ErrInvalidRequest, request.RequestType)
	}
}

func validateQuestionnaireAnswers(questions []Question, answers map[string][]string) error {
	if len(questions) == 0 {
		return fmt.Errorf("%w: questionnaire request has no questions", ErrInvalidRequest)
	}
	if len(answers) == 0 {
		return fmt.Errorf("%w: answers are required", ErrInvalidResponse)
	}
	for _, question := range questions {
		selected, ok := answers[question.Question]
		if !ok || len(selected) == 0 {
			return fmt.Errorf("%w: question %q needs an answer", ErrInvalidResponse, question.Question)
		}
		if !question.MultiSelect && len(selected) != 1 {
			return fmt.Errorf("%w: question %q needs exactly one answer", ErrInvalidResponse, question.Question)
		}
		allowed := make(map[string]struct{}, len(question.Options))
		for _, option := range question.Options {
			allowed[option.Label] = struct{}{}
		}
		seen := make(map[string]struct{}, len(selected))
		for _, answer := range selected {
			label := strings.TrimSpace(answer)
			if _, exists := allowed[label]; !exists {
				return fmt.Errorf("%w: answer %q is not allowed for question %q", ErrInvalidResponse, answer, question.Question)
			}
			if _, exists := seen[label]; exists {
				return fmt.Errorf("%w: duplicate answer %q for question %q", ErrInvalidResponse, answer, question.Question)
			}
			seen[label] = struct{}{}
		}
	}
	for question := range answers {
		if !hasQuestion(questions, question) {
			return fmt.Errorf("%w: answer for unknown question %q", ErrInvalidResponse, question)
		}
	}
	return nil
}

func hasChoiceID(choices []Choice, choiceID string) bool {
	for _, choice := range choices {
		if choice.ID == strings.TrimSpace(choiceID) {
			return true
		}
	}
	return false
}

func hasQuestion(questions []Question, prompt string) bool {
	for _, question := range questions {
		if question.Question == prompt {
			return true
		}
	}
	return false
}

func normalizeRequestType(value string) string {
	switch strings.TrimSpace(value) {
	case "", RequestTypeApproval:
		return RequestTypeApproval
	case RequestTypeQuestionnaire:
		return RequestTypeQuestionnaire
	case RequestTypeSteer:
		return RequestTypeSteer
	default:
		return strings.TrimSpace(value)
	}
}

func (s *FileStore) load() ([]ApprovalRequest, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return []ApprovalRequest{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return []ApprovalRequest{}, nil
	}

	var requests []ApprovalRequest
	if err := json.Unmarshal(data, &requests); err != nil {
		return nil, err
	}
	if requests == nil {
		return []ApprovalRequest{}, nil
	}
	return requests, nil
}

func (s *FileStore) save(requests []ApprovalRequest) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(requests, "", "  ")
	if err != nil {
		return err
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes[:])
}
