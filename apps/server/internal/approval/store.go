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
var ErrExpired = errors.New("approval request has expired")
var ErrAbandoned = errors.New("approval request has been abandoned")

type Store interface {
	Create(CreateRequest) (ApprovalRequest, error)
	List(status string) ([]ApprovalRequest, error)
	Get(id string) (ApprovalRequest, error)
	Respond(id string, response Response) (ApprovalRequest, error)
	Abandon(id string) (ApprovalRequest, error)
}

type UserScopedStore interface {
	CreateForUser(userID string, input CreateRequest) (ApprovalRequest, error)
	ListForUser(userID string, status string) ([]ApprovalRequest, error)
	GetForUser(userID string, id string) (ApprovalRequest, error)
	RespondForUser(userID string, id string, response Response) (ApprovalRequest, error)
	AbandonForUser(userID string, id string) (ApprovalRequest, error)
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

type UserTokenStore interface {
	UserIDForAgentToken(token string, scope string) (string, bool, error)
	UserIDForDeviceToken(token string) (string, bool, error)
	UserIDForDeviceTokenForDevice(deviceID string, token string) (string, bool, error)
}

type UserAccountStore interface {
	LoginOrCreateUser(email string, password string, name string, ttl time.Duration) (SessionCredential, error)
	UserIDForSessionToken(token string) (string, bool, error)
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

func (s *FileStore) Abandon(id string) (ApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	requests, err := s.load()
	if err != nil {
		return ApprovalRequest{}, err
	}
	requests = expireRequests(requests)

	for i := range requests {
		if requests[i].ID == id {
			if requests[i].Status == StatusPending && requests[i].Response == nil {
				requests[i].Status = StatusAbandoned
			}
			return requests[i], s.save(requests)
		}
	}
	return ApprovalRequest{}, ErrNotFound
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
		if strings.TrimSpace(input.DefaultChoice) != "" && !hasChoiceID(input.Choices, input.DefaultChoice) {
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
	default:
		return CreateRequest{}, fmt.Errorf("%w: unsupported requestType %q", ErrInvalidRequest, input.RequestType)
	}
	return input, nil
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
	switch normalizeRequestType(request.RequestType) {
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
		if response.Message != "" {
			return fmt.Errorf("%w: questionnaire requests do not accept message", ErrInvalidResponse)
		}
		return validateQuestionnaireAnswers(request.Questions, response.Answers)
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
