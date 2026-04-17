package approval

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var ErrNotFound = errors.New("approval request not found")
var ErrAlreadyResponded = errors.New("approval request already has a response")
var ErrInvalidChoice = errors.New("approval response choice is not allowed")
var ErrExpired = errors.New("approval request has expired")

type Store interface {
	Create(CreateRequest) (ApprovalRequest, error)
	List(status string) ([]ApprovalRequest, error)
	Get(id string) (ApprovalRequest, error)
	Respond(id string, response Response) (ApprovalRequest, error)
}

type PairingStore interface {
	CreatePairingToken(ttl time.Duration) (PairingToken, error)
	PairDevice(token string, deviceName string) (DeviceCredential, error)
	VerifyDeviceToken(token string) (bool, error)
	VerifyDeviceTokenForDevice(deviceID string, token string) (bool, error)
	SetDevicePushToken(deviceID string, token string) error
	ListDevicePushTokens() ([]string, error)
}

type AgentStore interface {
	CreateAgentToken(name string, scopes []string) (AgentCredential, error)
	VerifyAgentToken(token string, scope string) (bool, error)
	ListAgentTokens() ([]AgentTokenRecord, error)
	RevokeAgentToken(agentID string) error
	RotateAgentToken(agentID string) (AgentCredential, error)
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

	if len(input.Choices) == 0 {
		input.Choices = DefaultChoices()
	}

	now := time.Now().UTC()
	request := ApprovalRequest{
		ID:                 newID(),
		Requester:          input.Requester,
		Title:              input.Title,
		Body:               input.Body,
		Command:            input.Command,
		Choices:            input.Choices,
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
			if !hasChoice(requests[i], response.ChoiceID) {
				return ApprovalRequest{}, ErrInvalidChoice
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
