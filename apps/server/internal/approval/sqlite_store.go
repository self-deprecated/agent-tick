package approval

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

type SQLiteStore struct {
	db *sql.DB
}

const defaultUserID = "usr_default"

func NewSQLiteStore(path string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	store := &SQLiteStore{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

func (s *SQLiteStore) LoginOrCreateUser(email string, password string, name string, ttl time.Duration) (SessionCredential, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	password = strings.TrimSpace(password)
	if email == "" || password == "" {
		return SessionCredential{}, ErrNotFound
	}
	if strings.TrimSpace(name) == "" {
		name = email
	}

	tx, err := s.db.Begin()
	if err != nil {
		return SessionCredential{}, err
	}
	defer rollback(tx)

	now := time.Now().UTC()
	var userID string
	var storedName string
	var passwordHash string
	err = tx.QueryRow("SELECT id, name, password_hash FROM users WHERE email = ?", email).Scan(&userID, &storedName, &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		userID = "usr_" + newID()
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return SessionCredential{}, err
		}
		passwordHash = string(hashedPassword)
		storedName = name
		_, err = tx.Exec(
			"INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
			userID,
			email,
			storedName,
			passwordHash,
			timeText(&now),
		)
		if err != nil {
			return SessionCredential{}, err
		}
	} else if err != nil {
		return SessionCredential{}, err
	} else if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) != nil {
		return SessionCredential{}, ErrNotFound
	}
	if err := ensurePersonalOrganizationForUserTx(tx, userID, storedName); err != nil {
		return SessionCredential{}, err
	}

	sessionToken := "session_" + newID()
	expiresAt := now.Add(ttl)
	_, err = tx.Exec(
		"INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
		userID,
		tokenHash(sessionToken),
		timeText(&expiresAt),
		timeText(&now),
	)
	if err != nil {
		return SessionCredential{}, err
	}
	if err := tx.Commit(); err != nil {
		return SessionCredential{}, err
	}

	return SessionCredential{UserID: userID, Email: email, Name: storedName, Token: sessionToken, Expiry: expiresAt}, nil
}

func (s *SQLiteStore) UserIDForSessionToken(token string) (string, bool, error) {
	if strings.TrimSpace(token) == "" {
		return "", false, nil
	}
	now := time.Now().UTC()
	var userID string
	err := s.db.QueryRow(
		"SELECT user_id FROM user_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1",
		tokenHash(token),
		timeText(&now),
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return userID, true, nil
}

func (s *SQLiteStore) Create(input CreateRequest) (ApprovalRequest, error) {
	return s.CreateForUser(defaultUserID, input)
}

func (s *SQLiteStore) CreateForUser(userID string, input CreateRequest) (ApprovalRequest, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	input, err := normalizeCreateRequest(input)
	if err != nil {
		return ApprovalRequest{}, err
	}

	now := time.Now().UTC()
	request := ApprovalRequest{
		ID:                 newID(),
		UserID:             userID,
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

	requesterJSON, err := marshalJSON(request.Requester)
	if err != nil {
		return ApprovalRequest{}, err
	}
	choicesJSON, err := marshalJSON(request.Choices)
	if err != nil {
		return ApprovalRequest{}, err
	}
	questionsJSON, err := marshalJSON(request.Questions)
	if err != nil {
		return ApprovalRequest{}, err
	}
	metadataJSON, err := marshalJSON(request.Metadata)
	if err != nil {
		return ApprovalRequest{}, err
	}
	organizationID, projectID, err := s.defaultOrganizationAndProjectForUser(userID)
	if err != nil {
		return ApprovalRequest{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return ApprovalRequest{}, err
	}
	defer rollback(tx)

	_, err = tx.Exec(`
		INSERT INTO approval_requests (
			id, user_id, organization_id, project_id, requester_json, request_type, title, body, command, choices_json, questions_json,
			default_choice, allow_freeform_reply, expires_at, risk,
			metadata_json, status, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		request.ID,
		userID,
		organizationID,
		projectID,
		requesterJSON,
		request.RequestType,
		request.Title,
		request.Body,
		request.Command,
		choicesJSON,
		questionsJSON,
		request.DefaultChoice,
		request.AllowFreeformReply,
		timeText(request.ExpiresAt),
		request.Risk,
		metadataJSON,
		request.Status,
		timeText(&request.CreatedAt),
	)
	if err != nil {
		return ApprovalRequest{}, err
	}
	if err := insertAuditForUser(tx, userID, "approval_request.created", request.ID, nil); err != nil {
		return ApprovalRequest{}, err
	}
	return request, tx.Commit()
}

func (s *SQLiteStore) List(status string) ([]ApprovalRequest, error) {
	return s.ListForUser(defaultUserID, status)
}

func (s *SQLiteStore) ListForUser(userID string, status string) ([]ApprovalRequest, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	if err := s.expirePendingRequests(); err != nil {
		return nil, err
	}

	query := `
		SELECT
			r.id, r.user_id, r.requester_json, r.request_type, r.title, r.body, r.command, r.choices_json, r.questions_json,
			r.default_choice, r.allow_freeform_reply, r.expires_at, r.risk,
			r.metadata_json, r.status, r.created_at,
			resp.choice_id, resp.message, resp.answers_json, resp.created_at
		FROM approval_requests r
		LEFT JOIN approval_responses resp ON resp.request_id = r.id
		WHERE r.user_id = ?
	`
	args := []any{userID}
	if status != "" {
		query += " AND r.status = ?"
		args = append(args, status)
	}
	query += " ORDER BY r.created_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	requests := []ApprovalRequest{}
	for rows.Next() {
		request, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func (s *SQLiteStore) Get(id string) (ApprovalRequest, error) {
	return s.GetForUser(defaultUserID, id)
}

func (s *SQLiteStore) GetForUser(userID string, id string) (ApprovalRequest, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	if err := s.expirePendingRequests(); err != nil {
		return ApprovalRequest{}, err
	}

	row := s.db.QueryRow(`
		SELECT
			r.id, r.user_id, r.requester_json, r.request_type, r.title, r.body, r.command, r.choices_json, r.questions_json,
			r.default_choice, r.allow_freeform_reply, r.expires_at, r.risk,
			r.metadata_json, r.status, r.created_at,
			resp.choice_id, resp.message, resp.answers_json, resp.created_at
		FROM approval_requests r
		LEFT JOIN approval_responses resp ON resp.request_id = r.id
		WHERE r.id = ? AND r.user_id = ?
	`, id, userID)

	request, err := scanRequest(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ApprovalRequest{}, ErrNotFound
	}
	return request, err
}

func (s *SQLiteStore) Respond(id string, response Response) (ApprovalRequest, error) {
	return s.RespondForUser(defaultUserID, id, response)
}

func (s *SQLiteStore) RespondForUser(userID string, id string, response Response) (ApprovalRequest, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	if err := s.expirePendingRequests(); err != nil {
		return ApprovalRequest{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return ApprovalRequest{}, err
	}
	defer rollback(tx)

	// Acquire the row write lock before reading so a concurrent abandon cannot be
	// overwritten by a response based on a stale pending snapshot.
	if _, err := tx.Exec("UPDATE approval_requests SET status = status WHERE id = ? AND user_id = ?", id, userID); err != nil {
		return ApprovalRequest{}, err
	}

	row := tx.QueryRow(`
		SELECT
			r.id, r.user_id, r.requester_json, r.request_type, r.title, r.body, r.command, r.choices_json, r.questions_json,
			r.default_choice, r.allow_freeform_reply, r.expires_at, r.risk,
			r.metadata_json, r.status, r.created_at,
			resp.choice_id, resp.message, resp.answers_json, resp.created_at
		FROM approval_requests r
		LEFT JOIN approval_responses resp ON resp.request_id = r.id
		WHERE r.id = ? AND r.user_id = ?
	`, id, userID)

	request, err := scanRequest(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ApprovalRequest{}, ErrNotFound
	}
	if err != nil {
		return ApprovalRequest{}, err
	}
	if request.Response != nil {
		return ApprovalRequest{}, ErrAlreadyResponded
	}
	if request.Status == StatusExpired {
		return ApprovalRequest{}, ErrExpired
	}
	if request.Status == StatusAbandoned {
		return ApprovalRequest{}, ErrAbandoned
	}
	if err := validateResponseForRequest(request, response); err != nil {
		return ApprovalRequest{}, err
	}

	now := time.Now().UTC()
	answersJSON, err := marshalJSON(response.Answers)
	if err != nil {
		return ApprovalRequest{}, err
	}
	_, err = tx.Exec(
		"INSERT INTO approval_responses (request_id, choice_id, message, answers_json, created_at) VALUES (?, ?, ?, ?, ?)",
		request.ID,
		response.ChoiceID,
		response.Message,
		answersJSON,
		timeText(&now),
	)
	if err != nil {
		return ApprovalRequest{}, err
	}
	_, err = tx.Exec(
		"UPDATE approval_requests SET status = ?, responded_at = ? WHERE id = ?",
		StatusResponded,
		timeText(&now),
		request.ID,
	)
	if err != nil {
		return ApprovalRequest{}, err
	}
	if err := insertAuditForUser(tx, userID, "approval_request.responded", request.ID, response); err != nil {
		return ApprovalRequest{}, err
	}
	if err := tx.Commit(); err != nil {
		return ApprovalRequest{}, err
	}

	request.Status = StatusResponded
	request.RespondedAt = &now
	request.Response = &response
	return request, nil
}

func (s *SQLiteStore) Abandon(id string) (ApprovalRequest, bool, error) {
	return s.AbandonForUser(defaultUserID, id)
}

func (s *SQLiteStore) AbandonWithReason(id string, reason string) (ApprovalRequest, bool, error) {
	return s.AbandonForUserWithReason(defaultUserID, id, reason)
}

func (s *SQLiteStore) AbandonForUser(userID string, id string) (ApprovalRequest, bool, error) {
	return s.AbandonForUserWithReason(userID, id, "")
}

func (s *SQLiteStore) AbandonForUserWithReason(userID string, id string, reason string) (ApprovalRequest, bool, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	if err := s.expirePendingRequests(); err != nil {
		return ApprovalRequest{}, false, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return ApprovalRequest{}, false, err
	}
	defer rollback(tx)

	result, err := tx.Exec(`
		UPDATE approval_requests
		SET status = ?
		WHERE id = ?
			AND user_id = ?
			AND status = ?
			AND NOT EXISTS (
				SELECT 1 FROM approval_responses WHERE request_id = approval_requests.id
			)
	`, StatusAbandoned, id, userID, StatusPending)
	if err != nil {
		return ApprovalRequest{}, false, err
	}
	abandonedRows, err := result.RowsAffected()
	if err != nil {
		return ApprovalRequest{}, false, err
	}
	changed := abandonedRows > 0
	if changed {
		reason = strings.TrimSpace(reason)
		if reason != "" {
			if err := updateRequestMetadata(tx, userID, id, func(metadata map[string]string) {
				metadata["abandonReason"] = reason
			}); err != nil {
				return ApprovalRequest{}, false, err
			}
		}
		var payload any
		if reason != "" {
			payload = map[string]string{"reason": reason}
		}
		if err := insertAuditForUser(tx, userID, "approval_request.abandoned", id, payload); err != nil {
			return ApprovalRequest{}, false, err
		}
	}

	row := tx.QueryRow(`
		SELECT
			r.id, r.user_id, r.requester_json, r.request_type, r.title, r.body, r.command, r.choices_json, r.questions_json,
			r.default_choice, r.allow_freeform_reply, r.expires_at, r.risk,
			r.metadata_json, r.status, r.created_at,
			resp.choice_id, resp.message, resp.answers_json, resp.created_at
		FROM approval_requests r
		LEFT JOIN approval_responses resp ON resp.request_id = r.id
		WHERE r.id = ? AND r.user_id = ?
	`, id, userID)

	request, err := scanRequest(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ApprovalRequest{}, false, ErrNotFound
	}
	if err != nil {
		return ApprovalRequest{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return ApprovalRequest{}, false, err
	}
	return request, changed, nil
}

func (s *SQLiteStore) expirePendingRequests() error {
	now := time.Now().UTC()
	_, err := s.db.Exec(
		"UPDATE approval_requests SET status = ? WHERE status = ? AND expires_at != '' AND expires_at <= ?",
		StatusExpired,
		StatusPending,
		timeText(&now),
	)
	return err
}

func (s *SQLiteStore) CreatePairingToken(ttl time.Duration) (PairingToken, error) {
	return s.CreatePairingTokenForUser(defaultUserID, ttl)
}

func (s *SQLiteStore) CreatePairingTokenForUser(userID string, ttl time.Duration) (PairingToken, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	organizationID, _, err := s.defaultOrganizationAndProjectForUser(userID)
	if err != nil {
		return PairingToken{}, err
	}
	token := "pair_" + newID()
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	_, err = s.db.Exec(
		"INSERT INTO pairing_tokens (user_id, organization_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
		userID,
		organizationID,
		tokenHash(token),
		timeText(&expiresAt),
		timeText(&now),
	)
	if err != nil {
		return PairingToken{}, err
	}

	return PairingToken{Token: token, ExpiresAt: expiresAt}, nil
}

func (s *SQLiteStore) PairDevice(token string, deviceName string) (DeviceCredential, error) {
	if strings.TrimSpace(token) == "" {
		return DeviceCredential{}, ErrNotFound
	}
	if strings.TrimSpace(deviceName) == "" {
		deviceName = "Phone"
	}

	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return DeviceCredential{}, err
	}
	defer rollback(tx)

	var tokenID int64
	var userID string
	var organizationID string
	err = tx.QueryRow(`
		SELECT id, user_id, organization_id
		FROM pairing_tokens
		WHERE token_hash = ? AND used_at = '' AND expires_at > ?
	`, tokenHash(token), timeText(&now)).Scan(&tokenID, &userID, &organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return DeviceCredential{}, ErrNotFound
	}
	if err != nil {
		return DeviceCredential{}, err
	}

	deviceID := "dev_" + newID()
	deviceToken := "device_" + newID()
	_, err = tx.Exec(
		"INSERT INTO devices (id, user_id, organization_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		deviceID,
		userID,
		organizationID,
		deviceName,
		tokenHash(deviceToken),
		timeText(&now),
	)
	if err != nil {
		return DeviceCredential{}, err
	}
	_, err = tx.Exec(
		"UPDATE pairing_tokens SET used_at = ? WHERE id = ?",
		timeText(&now),
		tokenID,
	)
	if err != nil {
		return DeviceCredential{}, err
	}
	if err := tx.Commit(); err != nil {
		return DeviceCredential{}, err
	}

	return DeviceCredential{DeviceID: deviceID, Token: deviceToken}, nil
}

func (s *SQLiteStore) VerifyDeviceToken(token string) (bool, error) {
	_, ok, err := s.UserIDForDeviceToken(token)
	return ok, err
}

func (s *SQLiteStore) UserIDForDeviceToken(token string) (string, bool, error) {
	if strings.TrimSpace(token) == "" {
		return "", false, nil
	}

	var userID string
	err := s.db.QueryRow(
		"SELECT user_id FROM devices WHERE token_hash = ? AND unpaired_at = '' LIMIT 1",
		tokenHash(token),
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return userID, true, nil
}

func (s *SQLiteStore) VerifyDeviceTokenForDevice(deviceID string, token string) (bool, error) {
	_, ok, err := s.UserIDForDeviceTokenForDevice(deviceID, token)
	return ok, err
}

func (s *SQLiteStore) UserIDForDeviceTokenForDevice(deviceID string, token string) (string, bool, error) {
	if strings.TrimSpace(deviceID) == "" || strings.TrimSpace(token) == "" {
		return "", false, nil
	}

	var userID string
	err := s.db.QueryRow(
		"SELECT user_id FROM devices WHERE id = ? AND token_hash = ? AND unpaired_at = '' LIMIT 1",
		deviceID,
		tokenHash(token),
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return userID, true, nil
}

func (s *SQLiteStore) SetDevicePushToken(deviceID string, token string) error {
	if strings.TrimSpace(deviceID) == "" || strings.TrimSpace(token) == "" {
		return ErrNotFound
	}

	result, err := s.db.Exec(
		"UPDATE devices SET expo_push_token = ? WHERE id = ?",
		token,
		deviceID,
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *SQLiteStore) ListDevicePushTokens() ([]string, error) {
	return s.ListDevicePushTokensForUser(defaultUserID)
}

func (s *SQLiteStore) ListDevicePushTokensForUser(userID string) ([]string, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	rows, err := s.db.Query("SELECT expo_push_token FROM devices WHERE user_id = ? AND expo_push_token != '' AND unpaired_at = ''", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tokens := []string{}
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

func (s *SQLiteStore) ListDevices() ([]DeviceRecord, error) {
	return s.ListDevicesForUser(defaultUserID)
}

func (s *SQLiteStore) ListDevicesForUser(userID string) ([]DeviceRecord, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	rows, err := s.db.Query("SELECT id, name, expo_push_token, created_at, unpaired_at FROM devices WHERE user_id = ? ORDER BY created_at DESC", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := []DeviceRecord{}
	for rows.Next() {
		var device DeviceRecord
		var pushToken string
		var createdAt string
		var unpairedAt string
		if err := rows.Scan(&device.DeviceID, &device.Name, &pushToken, &createdAt, &unpairedAt); err != nil {
			return nil, err
		}
		parsedCreatedAt, err := time.Parse(time.RFC3339, createdAt)
		if err != nil {
			return nil, err
		}
		device.CreatedAt = parsedCreatedAt
		device.PushNotifications = pushToken != "" && unpairedAt == ""
		device.UnpairedAt = parseOptionalTime(unpairedAt)
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (s *SQLiteStore) CreateAgentToken(name string, scopes []string) (AgentCredential, error) {
	return s.CreateAgentTokenForUser(defaultUserID, name, scopes)
}

func (s *SQLiteStore) CreateAgentTokenWithOptions(input CreateAgentTokenRequest) (AgentCredential, error) {
	return s.CreateAgentTokenForUserWithOptions(defaultUserID, input)
}

func (s *SQLiteStore) CreateAgentTokenForUser(userID string, name string, scopes []string) (AgentCredential, error) {
	return s.CreateAgentTokenForUserWithOptions(userID, CreateAgentTokenRequest{Name: name, Scopes: scopes})
}

func (s *SQLiteStore) CreateAgentTokenForUserWithOptions(userID string, input CreateAgentTokenRequest) (AgentCredential, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	organizationID, defaultProjectID, err := s.defaultOrganizationAndProjectForUser(userID)
	if err != nil {
		return AgentCredential{}, err
	}
	projectID := strings.TrimSpace(input.ProjectID)
	if projectID == "" {
		projectID = defaultProjectID
	} else if err := s.ensureProjectExists(organizationID, projectID); err != nil {
		return AgentCredential{}, err
	}
	teamID := strings.TrimSpace(input.TeamID)
	if teamID != "" {
		if err := s.ensureTeamExists(organizationID, teamID); err != nil {
			return AgentCredential{}, err
		}
	}
	defaultPolicy := strings.TrimSpace(input.DefaultApprovalPolicy)
	if defaultPolicy != "" {
		if err := s.ensurePolicyExists(organizationID, defaultPolicy); err != nil {
			return AgentCredential{}, err
		}
	}
	ownerUserID := strings.TrimSpace(input.OwnerUserID)
	if ownerUserID == "" {
		ownerUserID = userID
	}
	if _, ok, err := s.OrganizationRoleForUser(ownerUserID, organizationID); err != nil {
		return AgentCredential{}, err
	} else if !ok {
		return AgentCredential{}, ErrNotFound
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "agent"
	}
	scopes := input.Scopes
	if len(scopes) == 0 {
		scopes = []string{"approval:write", "approval:read"}
	}
	now := time.Now().UTC()
	agentID := "agent_" + newID()
	token := "agent_" + newID()
	scopesJSON, err := marshalJSON(scopes)
	if err != nil {
		return AgentCredential{}, err
	}

	_, err = s.db.Exec(
		`INSERT INTO agent_tokens (
			id, user_id, organization_id, project_id, owner_user_id, team_id, default_approval_policy,
			name, token_hash, scopes_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		agentID,
		userID,
		organizationID,
		projectID,
		ownerUserID,
		teamID,
		defaultPolicy,
		name,
		tokenHash(token),
		scopesJSON,
		timeText(&now),
	)
	if err != nil {
		return AgentCredential{}, err
	}

	return AgentCredential{
		AgentID:               agentID,
		Name:                  name,
		Token:                 token,
		Scopes:                scopes,
		OrganizationID:        organizationID,
		ProjectID:             projectID,
		OwnerUserID:           ownerUserID,
		TeamID:                teamID,
		DefaultApprovalPolicy: defaultPolicy,
	}, nil
}

func (s *SQLiteStore) VerifyAgentToken(token string, scope string) (bool, error) {
	_, ok, err := s.UserIDForAgentToken(token, scope)
	return ok, err
}

func (s *SQLiteStore) UserIDForAgentToken(token string, scope string) (string, bool, error) {
	auth, ok, err := s.AgentAuthForToken(token, scope)
	return auth.UserID, ok, err
}

func (s *SQLiteStore) AgentAuthForToken(token string, scope string) (AgentTokenAuth, bool, error) {
	if strings.TrimSpace(token) == "" {
		return AgentTokenAuth{}, false, nil
	}

	var auth AgentTokenAuth
	var scopesJSON string
	err := s.db.QueryRow(`
		SELECT id, user_id, organization_id, project_id, owner_user_id, team_id, default_approval_policy, scopes_json
		FROM agent_tokens
		WHERE token_hash = ? AND revoked_at = ''
		LIMIT 1
	`, tokenHash(token)).Scan(
		&auth.AgentID,
		&auth.UserID,
		&auth.OrganizationID,
		&auth.ProjectID,
		&auth.OwnerUserID,
		&auth.TeamID,
		&auth.DefaultApprovalPolicy,
		&scopesJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return AgentTokenAuth{}, false, nil
	}
	if err != nil {
		return AgentTokenAuth{}, false, err
	}

	var scopes []string
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return AgentTokenAuth{}, false, err
	}
	ok := slices.Contains(scopes, scope) || slices.Contains(scopes, "*")
	return auth, ok, nil
}

func (s *SQLiteStore) ListAgentTokens() ([]AgentTokenRecord, error) {
	return s.ListAgentTokensForUser(defaultUserID)
}

func (s *SQLiteStore) ListAgentTokensForUser(userID string) ([]AgentTokenRecord, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	rows, err := s.db.Query(`
		SELECT id, name, scopes_json, organization_id, project_id, owner_user_id, team_id,
			default_approval_policy, last_request_at, created_at, revoked_at
		FROM agent_tokens
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []AgentTokenRecord{}
	for rows.Next() {
		var record AgentTokenRecord
		var scopesJSON string
		var createdAt string
		var revokedAt string
		var lastRequestAt string
		if err := rows.Scan(
			&record.AgentID,
			&record.Name,
			&scopesJSON,
			&record.OrganizationID,
			&record.ProjectID,
			&record.OwnerUserID,
			&record.TeamID,
			&record.DefaultApprovalPolicy,
			&lastRequestAt,
			&createdAt,
			&revokedAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(scopesJSON), &record.Scopes); err != nil {
			return nil, err
		}
		parsedCreatedAt, err := parseTime(createdAt)
		if err != nil {
			return nil, err
		}
		record.CreatedAt = parsedCreatedAt
		record.LastRequestAt = parseOptionalTime(lastRequestAt)
		record.RevokedAt = parseOptionalTime(revokedAt)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *SQLiteStore) RevokeAgentToken(agentID string) error {
	return s.RevokeAgentTokenForUser(defaultUserID, agentID)
}

func (s *SQLiteStore) RevokeAgentTokenForUser(userID string, agentID string) error {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	now := time.Now().UTC()
	result, err := s.db.Exec(
		"UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at = ''",
		timeText(&now),
		agentID,
		userID,
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *SQLiteStore) UnpairDevice(deviceID string) error {
	return s.UnpairDeviceForUser(defaultUserID, deviceID)
}

func (s *SQLiteStore) UnpairDeviceForUser(userID string, deviceID string) error {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	now := time.Now().UTC()
	result, err := s.db.Exec(
		"UPDATE devices SET unpaired_at = ? WHERE id = ? AND user_id = ? AND unpaired_at = ''",
		timeText(&now),
		deviceID,
		userID,
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *SQLiteStore) RotateAgentToken(agentID string) (AgentCredential, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return AgentCredential{}, err
	}
	defer rollback(tx)

	var credential AgentCredential
	var scopesJSON string
	err = tx.QueryRow(`
		SELECT id, name, scopes_json, organization_id, project_id, owner_user_id, team_id, default_approval_policy
		FROM agent_tokens
		WHERE id = ? AND revoked_at = ''
	`, agentID).Scan(
		&credential.AgentID,
		&credential.Name,
		&scopesJSON,
		&credential.OrganizationID,
		&credential.ProjectID,
		&credential.OwnerUserID,
		&credential.TeamID,
		&credential.DefaultApprovalPolicy,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return AgentCredential{}, ErrNotFound
	}
	if err != nil {
		return AgentCredential{}, err
	}

	var scopes []string
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return AgentCredential{}, err
	}

	token := "agent_" + newID()
	_, err = tx.Exec(
		"UPDATE agent_tokens SET token_hash = ? WHERE id = ?",
		tokenHash(token),
		agentID,
	)
	if err != nil {
		return AgentCredential{}, err
	}
	if err := tx.Commit(); err != nil {
		return AgentCredential{}, err
	}

	credential.Token = token
	credential.Scopes = scopes
	return credential, nil
}

func (s *SQLiteStore) ListOrganizationsForUser(userID string) ([]OrganizationMembershipRecord, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	rows, err := s.db.Query(`
		SELECT m.organization_id, o.name, m.user_id, m.role, m.created_at
		FROM organization_memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = ?
		ORDER BY m.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memberships := []OrganizationMembershipRecord{}
	for rows.Next() {
		membership, err := scanOrganizationMembership(rows)
		if err != nil {
			return nil, err
		}
		memberships = append(memberships, membership)
	}
	return memberships, rows.Err()
}

func (s *SQLiteStore) DefaultOrganizationForUser(userID string) (OrganizationMembershipRecord, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	row := s.db.QueryRow(`
		SELECT m.organization_id, o.name, m.user_id, m.role, m.created_at
		FROM organization_memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = ?
		ORDER BY m.created_at DESC
		LIMIT 1
	`, userID)
	membership, err := scanOrganizationMembership(row)
	if errors.Is(err, sql.ErrNoRows) {
		return OrganizationMembershipRecord{}, ErrNotFound
	}
	return membership, err
}

func (s *SQLiteStore) OrganizationRoleForUser(userID string, organizationID string) (string, bool, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	var role string
	err := s.db.QueryRow(
		"SELECT role FROM organization_memberships WHERE user_id = ? AND organization_id = ? LIMIT 1",
		userID,
		organizationID,
	).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return role, true, nil
}

func (s *SQLiteStore) CreateOrganizationForUser(userID string, name string) (OrganizationRecord, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return OrganizationRecord{}, ErrInvalidRequest
	}

	tx, err := s.db.Begin()
	if err != nil {
		return OrganizationRecord{}, err
	}
	defer rollback(tx)

	organization, err := createOrganizationForUserTx(tx, userID, name, "org_"+newID(), "prj_"+newID())
	if err != nil {
		return OrganizationRecord{}, err
	}
	if err := insertAuditForUser(tx, userID, "organization.created", organization.OrganizationID, map[string]string{"name": organization.Name}); err != nil {
		return OrganizationRecord{}, err
	}
	if err := insertAuditForUser(tx, userID, "organization_membership.upserted", organization.OrganizationID, map[string]string{"userId": userID, "role": RoleOwner}); err != nil {
		return OrganizationRecord{}, err
	}
	projectID, err := defaultProjectForOrganizationTx(tx, organization.OrganizationID)
	if err != nil {
		return OrganizationRecord{}, err
	}
	if err := insertAuditForUser(tx, userID, "project.created", projectID, map[string]string{"organizationId": organization.OrganizationID, "name": "Default Project"}); err != nil {
		return OrganizationRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return OrganizationRecord{}, err
	}
	return organization, nil
}

func (s *SQLiteStore) ListTeams(organizationID string) ([]TeamRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	rows, err := s.db.Query(`
		SELECT id, organization_id, name, description, created_at, updated_at
		FROM teams
		WHERE organization_id = ?
		ORDER BY name COLLATE NOCASE ASC
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	teams := []TeamRecord{}
	for rows.Next() {
		team, err := scanTeam(rows)
		if err != nil {
			return nil, err
		}
		teams = append(teams, team)
	}
	return teams, rows.Err()
}

func (s *SQLiteStore) CreateTeam(organizationID string, input CreateTeamRequest) (TeamRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return TeamRecord{}, ErrInvalidRequest
	}
	now := time.Now().UTC()
	team := TeamRecord{
		TeamID:         "team_" + newID(),
		OrganizationID: organizationID,
		Name:           name,
		Description:    strings.TrimSpace(input.Description),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	tx, err := s.db.Begin()
	if err != nil {
		return TeamRecord{}, err
	}
	defer rollback(tx)
	if err := ensureOrganizationExistsTx(tx, organizationID); err != nil {
		return TeamRecord{}, err
	}
	_, err = tx.Exec(
		"INSERT INTO teams (id, organization_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		team.TeamID,
		team.OrganizationID,
		team.Name,
		team.Description,
		timeText(&team.CreatedAt),
		timeText(&team.UpdatedAt),
	)
	if err != nil {
		return TeamRecord{}, err
	}
	if err := insertAuditForUser(tx, defaultUserID, "team.created", team.TeamID, team); err != nil {
		return TeamRecord{}, err
	}
	return team, tx.Commit()
}

func (s *SQLiteStore) GetTeam(organizationID string, teamID string) (TeamRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	row := s.db.QueryRow(`
		SELECT id, organization_id, name, description, created_at, updated_at
		FROM teams
		WHERE organization_id = ? AND id = ?
	`, organizationID, teamID)
	team, err := scanTeam(row)
	if errors.Is(err, sql.ErrNoRows) {
		return TeamRecord{}, ErrNotFound
	}
	return team, err
}

func (s *SQLiteStore) UpdateTeam(organizationID string, teamID string, input UpdateTeamRequest) (TeamRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return TeamRecord{}, ErrInvalidRequest
	}
	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return TeamRecord{}, err
	}
	defer rollback(tx)
	result, err := tx.Exec(
		"UPDATE teams SET name = ?, description = ?, updated_at = ? WHERE organization_id = ? AND id = ?",
		name,
		strings.TrimSpace(input.Description),
		timeText(&now),
		organizationID,
		teamID,
	)
	if err != nil {
		return TeamRecord{}, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return TeamRecord{}, err
	}
	if rows == 0 {
		return TeamRecord{}, ErrNotFound
	}
	if err := insertAuditForUser(tx, defaultUserID, "team.updated", teamID, input); err != nil {
		return TeamRecord{}, err
	}
	team, err := scanTeam(tx.QueryRow(`
		SELECT id, organization_id, name, description, created_at, updated_at
		FROM teams
		WHERE organization_id = ? AND id = ?
	`, organizationID, teamID))
	if err != nil {
		return TeamRecord{}, err
	}
	return team, tx.Commit()
}

func (s *SQLiteStore) ListTeamMembers(organizationID string, teamID string) ([]TeamMemberRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	if err := s.ensureTeamExists(organizationID, teamID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT team_id, user_id, role, created_at
		FROM team_members
		WHERE team_id = ?
		ORDER BY created_at ASC
	`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []TeamMemberRecord{}
	for rows.Next() {
		member, err := scanTeamMember(rows)
		if err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *SQLiteStore) UpsertTeamMember(organizationID string, teamID string, input UpsertTeamMemberRequest) (TeamMemberRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	userID := strings.TrimSpace(input.UserID)
	role, err := normalizeRole(input.Role)
	if err != nil || userID == "" {
		return TeamMemberRecord{}, ErrInvalidRequest
	}
	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return TeamMemberRecord{}, err
	}
	defer rollback(tx)
	if err := ensureTeamExistsTx(tx, organizationID, teamID); err != nil {
		return TeamMemberRecord{}, err
	}
	if err := upsertOrganizationMembershipTx(tx, organizationID, userID, role, now); err != nil {
		return TeamMemberRecord{}, err
	}
	_, err = tx.Exec(`
		INSERT INTO team_members (team_id, user_id, role, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
	`, teamID, userID, role, timeText(&now), timeText(&now))
	if err != nil {
		return TeamMemberRecord{}, err
	}
	if err := insertAuditForUser(tx, defaultUserID, "organization_membership.upserted", organizationID, map[string]string{"userId": userID, "role": role}); err != nil {
		return TeamMemberRecord{}, err
	}
	if err := insertAuditForUser(tx, defaultUserID, "team_member.upserted", teamID, map[string]string{"userId": userID, "role": role}); err != nil {
		return TeamMemberRecord{}, err
	}
	member := TeamMemberRecord{TeamID: teamID, UserID: userID, Role: role, CreatedAt: now}
	if err := tx.Commit(); err != nil {
		return TeamMemberRecord{}, err
	}
	return member, nil
}

func (s *SQLiteStore) RemoveTeamMember(organizationID string, teamID string, userID string) error {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer rollback(tx)
	if err := ensureTeamExistsTx(tx, organizationID, teamID); err != nil {
		return err
	}
	result, err := tx.Exec("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", teamID, strings.TrimSpace(userID))
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	if err := insertAuditForUser(tx, defaultUserID, "team_member.removed", teamID, map[string]string{"userId": strings.TrimSpace(userID)}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SQLiteStore) ListProjects(organizationID string) ([]ProjectRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	rows, err := s.db.Query(`
		SELECT id, organization_id, team_id, name, slug, description, default_policy_id, created_at, updated_at
		FROM projects
		WHERE organization_id = ?
		ORDER BY name COLLATE NOCASE ASC
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projects := []ProjectRecord{}
	for rows.Next() {
		project, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *SQLiteStore) CreateProject(organizationID string, input CreateProjectRequest) (ProjectRecord, error) {
	return s.createOrUpdateProject("", organizationID, input.Name, input.TeamID, input.Description, input.DefaultPolicyID)
}

func (s *SQLiteStore) GetProject(organizationID string, projectID string) (ProjectRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	row := s.db.QueryRow(`
		SELECT id, organization_id, team_id, name, slug, description, default_policy_id, created_at, updated_at
		FROM projects
		WHERE organization_id = ? AND id = ?
	`, organizationID, projectID)
	project, err := scanProject(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectRecord{}, ErrNotFound
	}
	return project, err
}

func (s *SQLiteStore) UpdateProject(organizationID string, projectID string, input UpdateProjectRequest) (ProjectRecord, error) {
	return s.createOrUpdateProject(projectID, organizationID, input.Name, input.TeamID, input.Description, input.DefaultPolicyID)
}

func (s *SQLiteStore) createOrUpdateProject(projectID string, organizationID string, name string, teamID string, description string, defaultPolicyID string) (ProjectRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	name = strings.TrimSpace(name)
	teamID = strings.TrimSpace(teamID)
	defaultPolicyID = strings.TrimSpace(defaultPolicyID)
	if name == "" {
		return ProjectRecord{}, ErrInvalidRequest
	}
	now := time.Now().UTC()
	creating := strings.TrimSpace(projectID) == ""
	if creating {
		projectID = "prj_" + newID()
	}
	project := ProjectRecord{
		ProjectID:       projectID,
		OrganizationID:  organizationID,
		TeamID:          teamID,
		Name:            name,
		Slug:            slugify(name),
		Description:     strings.TrimSpace(description),
		DefaultPolicyID: defaultPolicyID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	tx, err := s.db.Begin()
	if err != nil {
		return ProjectRecord{}, err
	}
	defer rollback(tx)
	if err := ensureOrganizationExistsTx(tx, organizationID); err != nil {
		return ProjectRecord{}, err
	}
	if teamID != "" {
		if err := ensureTeamExistsTx(tx, organizationID, teamID); err != nil {
			return ProjectRecord{}, err
		}
	}
	if defaultPolicyID != "" {
		if err := ensurePolicyExistsTx(tx, organizationID, defaultPolicyID); err != nil {
			return ProjectRecord{}, err
		}
	}
	if creating {
		_, err = tx.Exec(
			"INSERT INTO projects (id, organization_id, team_id, name, slug, description, default_policy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			project.ProjectID,
			project.OrganizationID,
			project.TeamID,
			project.Name,
			project.Slug,
			project.Description,
			project.DefaultPolicyID,
			timeText(&project.CreatedAt),
			timeText(&project.UpdatedAt),
		)
		if err != nil {
			return ProjectRecord{}, err
		}
		if err := insertAuditForUser(tx, defaultUserID, "project.created", project.ProjectID, project); err != nil {
			return ProjectRecord{}, err
		}
		return project, tx.Commit()
	}
	result, err := tx.Exec(
		"UPDATE projects SET team_id = ?, name = ?, slug = ?, description = ?, default_policy_id = ?, updated_at = ? WHERE organization_id = ? AND id = ?",
		project.TeamID,
		project.Name,
		project.Slug,
		project.Description,
		project.DefaultPolicyID,
		timeText(&now),
		organizationID,
		projectID,
	)
	if err != nil {
		return ProjectRecord{}, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return ProjectRecord{}, err
	}
	if rows == 0 {
		return ProjectRecord{}, ErrNotFound
	}
	if err := insertAuditForUser(tx, defaultUserID, "project.updated", projectID, project); err != nil {
		return ProjectRecord{}, err
	}
	project, err = scanProject(tx.QueryRow(`
		SELECT id, organization_id, team_id, name, slug, description, default_policy_id, created_at, updated_at
		FROM projects
		WHERE organization_id = ? AND id = ?
	`, organizationID, projectID))
	if err != nil {
		return ProjectRecord{}, err
	}
	return project, tx.Commit()
}

func (s *SQLiteStore) ListApprovalPolicies(organizationID string) ([]ApprovalPolicyRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	rows, err := s.db.Query(`
		SELECT id, organization_id, project_id, team_id, name, template, summary, settings_json, created_at, updated_at
		FROM approval_policies
		WHERE organization_id = ? AND deleted_at = ''
		ORDER BY name COLLATE NOCASE ASC
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	policies := []ApprovalPolicyRecord{}
	for rows.Next() {
		policy, err := scanPolicy(rows)
		if err != nil {
			return nil, err
		}
		policy.Steps, err = s.loadPolicySteps(policy.PolicyID)
		if err != nil {
			return nil, err
		}
		policies = append(policies, policy)
	}
	return policies, rows.Err()
}

func (s *SQLiteStore) CreateApprovalPolicy(organizationID string, input CreateApprovalPolicyRequest) (ApprovalPolicyRecord, error) {
	return s.createOrUpdatePolicy("", organizationID, UpdateApprovalPolicyRequest(input))
}

func (s *SQLiteStore) GetApprovalPolicy(organizationID string, policyID string) (ApprovalPolicyRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	policy, err := scanPolicy(s.db.QueryRow(`
		SELECT id, organization_id, project_id, team_id, name, template, summary, settings_json, created_at, updated_at
		FROM approval_policies
		WHERE organization_id = ? AND id = ? AND deleted_at = ''
	`, organizationID, policyID))
	if errors.Is(err, sql.ErrNoRows) {
		return ApprovalPolicyRecord{}, ErrNotFound
	}
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	policy.Steps, err = s.loadPolicySteps(policy.PolicyID)
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	return policy, nil
}

func (s *SQLiteStore) UpdateApprovalPolicy(organizationID string, policyID string, input UpdateApprovalPolicyRequest) (ApprovalPolicyRecord, error) {
	return s.createOrUpdatePolicy(policyID, organizationID, input)
}

func (s *SQLiteStore) DeleteApprovalPolicy(organizationID string, policyID string) error {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	now := time.Now().UTC()
	result, err := s.db.Exec("UPDATE approval_policies SET deleted_at = ?, updated_at = ? WHERE organization_id = ? AND id = ? AND deleted_at = ''", timeText(&now), timeText(&now), organizationID, policyID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *SQLiteStore) PreviewApprovalPolicy(organizationID string, policyID string) (ApprovalPolicyPreview, error) {
	policy, err := s.GetApprovalPolicy(organizationID, policyID)
	if err != nil {
		return ApprovalPolicyPreview{}, err
	}
	preview := ApprovalPolicyPreview{PolicyID: policy.PolicyID, Summary: policy.Summary}
	switch policy.Template {
	case PolicyTemplateOwnerOnly:
		preview.Notifies = []string{"owner user"}
	case PolicyTemplateAnyTeamMember, PolicyTemplateQuorum:
		preview.Notifies = []string{teamPreviewLabel(policy.TeamID)}
	case PolicyTemplateOnCall:
		preview.Notifies = []string{"current on-call person"}
		preview.Limitations = append(preview.Limitations, "on-call schedules are not connected yet; this uses the configured escalation target")
	case PolicyTemplateRecentlyActive:
		preview.Notifies = []string{"most recently active approver"}
		preview.Limitations = append(preview.Limitations, "presence is not connected yet; this falls back to team members")
	case PolicyTemplateSequence, PolicyTemplateRiskBased:
		for _, step := range policy.Steps {
			preview.Notifies = append(preview.Notifies, policyStepSummary(step))
		}
	default:
		preview.Notifies = []string{"configured approvers"}
	}
	if len(preview.Notifies) == 0 {
		preview.Notifies = []string{"configured approvers"}
	}
	return preview, nil
}

func (s *SQLiteStore) ResolveApprovalPolicy(organizationID string, projectID string, hint string) (string, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	hint = strings.TrimSpace(hint)
	if hint != "" {
		if err := s.ensurePolicyExists(organizationID, hint); err != nil {
			return "", err
		}
		return hint, nil
	}
	projectID = strings.TrimSpace(projectID)
	if projectID != "" {
		var policyID string
		err := s.db.QueryRow("SELECT default_policy_id FROM projects WHERE organization_id = ? AND id = ?", organizationID, projectID).Scan(&policyID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if strings.TrimSpace(policyID) != "" {
			return policyID, nil
		}
	}
	var policyID string
	err := s.db.QueryRow("SELECT default_policy_id FROM organizations WHERE id = ?", organizationID).Scan(&policyID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	return strings.TrimSpace(policyID), nil
}

func (s *SQLiteStore) createOrUpdatePolicy(policyID string, organizationID string, input UpdateApprovalPolicyRequest) (ApprovalPolicyRecord, error) {
	if strings.TrimSpace(organizationID) == "" {
		organizationID = defaultOrganizationID
	}
	creating := strings.TrimSpace(policyID) == ""
	if creating {
		policyID = "pol_" + newID()
	}
	policy, err := s.policyFromInput(policyID, organizationID, input)
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	now := time.Now().UTC()
	policy.CreatedAt = now
	policy.UpdatedAt = now
	settingsJSON, err := marshalJSON(policy.Settings)
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	defer rollback(tx)
	if err := ensureOrganizationExistsTx(tx, organizationID); err != nil {
		return ApprovalPolicyRecord{}, err
	}
	if policy.ProjectID != "" {
		if err := ensureProjectExistsTx(tx, organizationID, policy.ProjectID); err != nil {
			return ApprovalPolicyRecord{}, err
		}
	}
	if policy.TeamID != "" {
		if err := ensureTeamExistsTx(tx, organizationID, policy.TeamID); err != nil {
			return ApprovalPolicyRecord{}, err
		}
	}
	if creating {
		_, err = tx.Exec(`
			INSERT INTO approval_policies (id, organization_id, project_id, team_id, name, template, summary, settings_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, policy.PolicyID, policy.OrganizationID, policy.ProjectID, policy.TeamID, policy.Name, policy.Template, policy.Summary, settingsJSON, timeText(&now), timeText(&now))
	} else {
		_, err = tx.Exec(`
			UPDATE approval_policies
			SET project_id = ?, team_id = ?, name = ?, template = ?, summary = ?, settings_json = ?, updated_at = ?
			WHERE organization_id = ? AND id = ? AND deleted_at = ''
		`, policy.ProjectID, policy.TeamID, policy.Name, policy.Template, policy.Summary, settingsJSON, timeText(&now), organizationID, policyID)
	}
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	if !creating {
		if err := ensurePolicyExistsTx(tx, organizationID, policyID); err != nil {
			return ApprovalPolicyRecord{}, err
		}
		if _, err := tx.Exec("DELETE FROM approval_policy_steps WHERE policy_id = ?", policyID); err != nil {
			return ApprovalPolicyRecord{}, err
		}
	}
	for i := range policy.Steps {
		step := policy.Steps[i]
		if strings.TrimSpace(step.StepID) == "" {
			step.StepID = "step_" + newID()
			policy.Steps[i].StepID = step.StepID
		}
		if step.Position == 0 {
			step.Position = i + 1
			policy.Steps[i].Position = step.Position
		}
		_, err = tx.Exec(`
			INSERT INTO approval_policy_steps (id, policy_id, position, step_type, team_id, quorum, timeout_seconds, escalation_target, deny_veto, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, step.StepID, policy.PolicyID, step.Position, step.StepType, step.TeamID, step.Quorum, step.TimeoutSeconds, step.EscalationTarget, step.DenyVeto, timeText(&now), timeText(&now))
		if err != nil {
			return ApprovalPolicyRecord{}, err
		}
	}
	if err := insertAuditForUser(tx, defaultUserID, map[bool]string{true: "approval_policy.created", false: "approval_policy.updated"}[creating], policy.PolicyID, policy); err != nil {
		return ApprovalPolicyRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return ApprovalPolicyRecord{}, err
	}
	return policy, nil
}

func (s *SQLiteStore) policyFromInput(policyID string, organizationID string, input UpdateApprovalPolicyRequest) (ApprovalPolicyRecord, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return ApprovalPolicyRecord{}, ErrInvalidRequest
	}
	template, err := normalizePolicyTemplate(input.Template)
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	settings := input.Settings
	if settings == nil {
		settings = map[string]string{}
	}
	policy := ApprovalPolicyRecord{
		PolicyID:       policyID,
		OrganizationID: organizationID,
		ProjectID:      strings.TrimSpace(input.ProjectID),
		TeamID:         strings.TrimSpace(input.TeamID),
		Name:           name,
		Template:       template,
		Settings:       settings,
		Steps:          normalizedPolicySteps(template, strings.TrimSpace(input.TeamID), input.Steps, settings),
	}
	if err := validatePolicy(policy); err != nil {
		return ApprovalPolicyRecord{}, err
	}
	policy.Summary = summarizePolicy(policy)
	return policy, nil
}

func (s *SQLiteStore) loadPolicySteps(policyID string) ([]ApprovalPolicyStep, error) {
	rows, err := s.db.Query(`
		SELECT id, position, step_type, team_id, quorum, timeout_seconds, escalation_target, deny_veto
		FROM approval_policy_steps
		WHERE policy_id = ?
		ORDER BY position ASC
	`, policyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []ApprovalPolicyStep{}
	for rows.Next() {
		step, err := scanPolicyStep(rows)
		if err != nil {
			return nil, err
		}
		steps = append(steps, step)
	}
	return steps, rows.Err()
}

func (s *SQLiteStore) ensurePolicyExists(organizationID string, policyID string) error {
	return ensurePolicyExistsDB(s.db, organizationID, policyID)
}

func (s *SQLiteStore) RecordAgentRequest(agentID string, at time.Time) error {
	if strings.TrimSpace(agentID) == "" {
		return ErrNotFound
	}
	result, err := s.db.Exec("UPDATE agent_tokens SET last_request_at = ? WHERE id = ?", timeText(&at), agentID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *SQLiteStore) ensureTeamExists(organizationID string, teamID string) error {
	return ensureTeamExistsDB(s.db, organizationID, teamID)
}

func (s *SQLiteStore) ensureProjectExists(organizationID string, projectID string) error {
	return ensureProjectExistsDB(s.db, organizationID, projectID)
}

func (s *SQLiteStore) defaultOrganizationAndProjectForUser(userID string) (string, string, error) {
	membership, err := s.DefaultOrganizationForUser(userID)
	if errors.Is(err, ErrNotFound) {
		tx, txErr := s.db.Begin()
		if txErr != nil {
			return "", "", txErr
		}
		defer rollback(tx)
		name := "Personal Organization"
		if strings.TrimSpace(userID) == defaultUserID {
			name = "Default Organization"
		}
		organization, createErr := createOrganizationForUserTx(tx, userID, name, "org_"+newID(), "prj_"+newID())
		if createErr != nil {
			return "", "", createErr
		}
		projectID, projectErr := defaultProjectForOrganizationTx(tx, organization.OrganizationID)
		if projectErr != nil {
			return "", "", projectErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return "", "", commitErr
		}
		return organization.OrganizationID, projectID, nil
	}
	if err != nil {
		return "", "", err
	}
	projectID, err := defaultProjectForOrganizationDB(s.db, membership.OrganizationID)
	if err != nil {
		return "", "", err
	}
	return membership.OrganizationID, projectID, nil
}

func ensurePersonalOrganizationForUserTx(tx *sql.Tx, userID string, name string) error {
	var count int
	err := tx.QueryRow("SELECT COUNT(*) FROM organization_memberships WHERE user_id = ?", userID).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	organizationName := strings.TrimSpace(name)
	if organizationName == "" {
		organizationName = "Personal Organization"
	}
	_, err = createOrganizationForUserTx(tx, userID, organizationName, "org_"+newID(), "prj_"+newID())
	return err
}

func createOrganizationForUserTx(tx *sql.Tx, userID string, name string, organizationID string, projectID string) (OrganizationRecord, error) {
	now := time.Now().UTC()
	organization := OrganizationRecord{OrganizationID: organizationID, Name: strings.TrimSpace(name), CreatedAt: now}
	if organization.Name == "" {
		return OrganizationRecord{}, ErrInvalidRequest
	}
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	_, err := tx.Exec(
		"INSERT INTO organizations (id, name, default_policy_id, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
		organization.OrganizationID,
		organization.Name,
		timeText(&now),
		timeText(&now),
	)
	if err != nil {
		return OrganizationRecord{}, err
	}
	if err := upsertOrganizationMembershipTx(tx, organization.OrganizationID, userID, RoleOwner, now); err != nil {
		return OrganizationRecord{}, err
	}
	_, err = tx.Exec(
		"INSERT INTO projects (id, organization_id, team_id, name, slug, description, default_policy_id, created_at, updated_at) VALUES (?, ?, '', ?, ?, '', '', ?, ?)",
		projectID,
		organization.OrganizationID,
		"Default Project",
		"default-project",
		timeText(&now),
		timeText(&now),
	)
	if err != nil {
		return OrganizationRecord{}, err
	}
	return organization, nil
}

func upsertOrganizationMembershipTx(tx *sql.Tx, organizationID string, userID string, role string, now time.Time) error {
	role, err := normalizeRole(role)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`
		INSERT INTO organization_memberships (organization_id, user_id, role, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
	`, organizationID, userID, role, timeText(&now), timeText(&now))
	return err
}

func ensureOrganizationExistsTx(tx *sql.Tx, organizationID string) error {
	var id string
	err := tx.QueryRow("SELECT id FROM organizations WHERE id = ?", organizationID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func ensureTeamExistsTx(tx *sql.Tx, organizationID string, teamID string) error {
	return ensureTeamExistsDB(tx, organizationID, teamID)
}

type rowQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

func ensureTeamExistsDB(db rowQuerier, organizationID string, teamID string) error {
	if strings.TrimSpace(teamID) == "" {
		return ErrNotFound
	}
	var id string
	err := db.QueryRow("SELECT id FROM teams WHERE organization_id = ? AND id = ?", organizationID, teamID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func ensureProjectExistsTx(tx *sql.Tx, organizationID string, projectID string) error {
	return ensureProjectExistsDB(tx, organizationID, projectID)
}

func ensureProjectExistsDB(db rowQuerier, organizationID string, projectID string) error {
	if strings.TrimSpace(projectID) == "" {
		return ErrNotFound
	}
	var id string
	err := db.QueryRow("SELECT id FROM projects WHERE organization_id = ? AND id = ?", organizationID, projectID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func defaultProjectForOrganizationDB(db rowQuerier, organizationID string) (string, error) {
	var projectID string
	err := db.QueryRow("SELECT id FROM projects WHERE organization_id = ? ORDER BY created_at ASC LIMIT 1", organizationID).Scan(&projectID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return projectID, err
}

func defaultProjectForOrganizationTx(tx *sql.Tx, organizationID string) (string, error) {
	return defaultProjectForOrganizationDB(tx, organizationID)
}

func scanOrganizationMembership(scanner requestScanner) (OrganizationMembershipRecord, error) {
	var membership OrganizationMembershipRecord
	var createdAt string
	err := scanner.Scan(&membership.OrganizationID, &membership.Name, &membership.UserID, &membership.Role, &createdAt)
	if err != nil {
		return OrganizationMembershipRecord{}, err
	}
	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return OrganizationMembershipRecord{}, err
	}
	membership.CreatedAt = parsedCreatedAt
	return membership, nil
}

func scanTeam(scanner requestScanner) (TeamRecord, error) {
	var team TeamRecord
	var createdAt string
	var updatedAt string
	err := scanner.Scan(&team.TeamID, &team.OrganizationID, &team.Name, &team.Description, &createdAt, &updatedAt)
	if err != nil {
		return TeamRecord{}, err
	}
	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return TeamRecord{}, err
	}
	parsedUpdatedAt, err := parseTime(updatedAt)
	if err != nil {
		return TeamRecord{}, err
	}
	team.CreatedAt = parsedCreatedAt
	team.UpdatedAt = parsedUpdatedAt
	return team, nil
}

func scanTeamMember(scanner requestScanner) (TeamMemberRecord, error) {
	var member TeamMemberRecord
	var createdAt string
	err := scanner.Scan(&member.TeamID, &member.UserID, &member.Role, &createdAt)
	if err != nil {
		return TeamMemberRecord{}, err
	}
	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return TeamMemberRecord{}, err
	}
	member.CreatedAt = parsedCreatedAt
	return member, nil
}

func scanProject(scanner requestScanner) (ProjectRecord, error) {
	var project ProjectRecord
	var createdAt string
	var updatedAt string
	err := scanner.Scan(
		&project.ProjectID,
		&project.OrganizationID,
		&project.TeamID,
		&project.Name,
		&project.Slug,
		&project.Description,
		&project.DefaultPolicyID,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return ProjectRecord{}, err
	}
	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return ProjectRecord{}, err
	}
	parsedUpdatedAt, err := parseTime(updatedAt)
	if err != nil {
		return ProjectRecord{}, err
	}
	project.CreatedAt = parsedCreatedAt
	project.UpdatedAt = parsedUpdatedAt
	return project, nil
}

func normalizeRole(role string) (string, error) {
	switch strings.TrimSpace(role) {
	case RoleOwner:
		return RoleOwner, nil
	case RoleAdmin:
		return RoleAdmin, nil
	case RoleApprover:
		return RoleApprover, nil
	case RoleViewer, "":
		return RoleViewer, nil
	default:
		return "", ErrInvalidRequest
	}
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	slug := strings.Trim(builder.String(), "-")
	if slug == "" {
		return "project"
	}
	return slug
}

func ensurePolicyExistsTx(tx *sql.Tx, organizationID string, policyID string) error {
	return ensurePolicyExistsDB(tx, organizationID, policyID)
}

func ensurePolicyExistsDB(db rowQuerier, organizationID string, policyID string) error {
	if strings.TrimSpace(policyID) == "" {
		return ErrNotFound
	}
	var id string
	err := db.QueryRow("SELECT id FROM approval_policies WHERE organization_id = ? AND id = ? AND deleted_at = ''", organizationID, policyID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func scanPolicy(scanner requestScanner) (ApprovalPolicyRecord, error) {
	var policy ApprovalPolicyRecord
	var settingsJSON string
	var createdAt string
	var updatedAt string
	err := scanner.Scan(
		&policy.PolicyID,
		&policy.OrganizationID,
		&policy.ProjectID,
		&policy.TeamID,
		&policy.Name,
		&policy.Template,
		&policy.Summary,
		&settingsJSON,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	if strings.TrimSpace(settingsJSON) == "" {
		settingsJSON = "{}"
	}
	if err := json.Unmarshal([]byte(settingsJSON), &policy.Settings); err != nil {
		return ApprovalPolicyRecord{}, err
	}
	if policy.Settings == nil {
		policy.Settings = map[string]string{}
	}
	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	parsedUpdatedAt, err := parseTime(updatedAt)
	if err != nil {
		return ApprovalPolicyRecord{}, err
	}
	policy.CreatedAt = parsedCreatedAt
	policy.UpdatedAt = parsedUpdatedAt
	return policy, nil
}

func scanPolicyStep(scanner requestScanner) (ApprovalPolicyStep, error) {
	var step ApprovalPolicyStep
	err := scanner.Scan(
		&step.StepID,
		&step.Position,
		&step.StepType,
		&step.TeamID,
		&step.Quorum,
		&step.TimeoutSeconds,
		&step.EscalationTarget,
		&step.DenyVeto,
	)
	return step, err
}

func normalizePolicyTemplate(template string) (string, error) {
	switch strings.TrimSpace(template) {
	case PolicyTemplateOwnerOnly, "just-me", "":
		return PolicyTemplateOwnerOnly, nil
	case PolicyTemplateAnyTeamMember:
		return PolicyTemplateAnyTeamMember, nil
	case PolicyTemplateOnCall:
		return PolicyTemplateOnCall, nil
	case PolicyTemplateRecentlyActive:
		return PolicyTemplateRecentlyActive, nil
	case PolicyTemplateQuorum:
		return PolicyTemplateQuorum, nil
	case PolicyTemplateSequence:
		return PolicyTemplateSequence, nil
	case PolicyTemplateRiskBased:
		return PolicyTemplateRiskBased, nil
	default:
		return "", ErrInvalidRequest
	}
}

func normalizedPolicySteps(template string, teamID string, steps []ApprovalPolicyStep, settings map[string]string) []ApprovalPolicyStep {
	if len(steps) > 0 {
		for i := range steps {
			if steps[i].Position == 0 {
				steps[i].Position = i + 1
			}
			if strings.TrimSpace(steps[i].StepType) == "" {
				steps[i].StepType = template
			}
			if steps[i].TeamID == "" {
				steps[i].TeamID = teamID
			}
		}
		return steps
	}
	quorum := atoiDefault(settings["quorum"], 0)
	if quorum == 0 && template == PolicyTemplateQuorum {
		quorum = 2
	}
	return []ApprovalPolicyStep{{
		Position:         1,
		StepType:         template,
		TeamID:           teamID,
		Quorum:           quorum,
		TimeoutSeconds:   atoiDefault(settings["timeoutSeconds"], 3600),
		EscalationTarget: strings.TrimSpace(settings["escalationTarget"]),
		DenyVeto:         settings["denyVeto"] != "false",
	}}
}

func validatePolicy(policy ApprovalPolicyRecord) error {
	switch policy.Template {
	case PolicyTemplateAnyTeamMember, PolicyTemplateQuorum, PolicyTemplateRecentlyActive:
		if strings.TrimSpace(policy.TeamID) == "" {
			return ErrInvalidRequest
		}
	}
	for _, step := range policy.Steps {
		if policy.Template == PolicyTemplateOnCall && strings.TrimSpace(step.EscalationTarget) == "" {
			return ErrInvalidRequest
		}
		if step.Quorum < 0 {
			return ErrInvalidRequest
		}
		if policy.Template == PolicyTemplateQuorum && step.Quorum < 2 {
			return ErrInvalidRequest
		}
		if step.TimeoutSeconds < 0 {
			return ErrInvalidRequest
		}
		if strings.TrimSpace(step.TeamID) == "" && (step.StepType == PolicyTemplateAnyTeamMember || step.StepType == PolicyTemplateQuorum || step.StepType == PolicyTemplateRecentlyActive) {
			return ErrInvalidRequest
		}
	}
	return nil
}

func summarizePolicy(policy ApprovalPolicyRecord) string {
	switch policy.Template {
	case PolicyTemplateOwnerOnly:
		return "Requires approval from the owner user."
	case PolicyTemplateAnyTeamMember:
		return "Requires one approval from the selected team."
	case PolicyTemplateOnCall:
		return "Notifies the on-call approver, with best-effort escalation."
	case PolicyTemplateRecentlyActive:
		return "Notifies the most recently active approver for the selected team."
	case PolicyTemplateQuorum:
		quorum := 2
		if len(policy.Steps) > 0 && policy.Steps[0].Quorum > 0 {
			quorum = policy.Steps[0].Quorum
		}
		return fmt.Sprintf("Requires %d approvals from the selected team; any denial blocks the command.", quorum)
	case PolicyTemplateSequence:
		return fmt.Sprintf("Runs %d approval steps in order; any denial blocks the command.", len(policy.Steps))
	case PolicyTemplateRiskBased:
		return "Chooses an approval path based on request risk."
	default:
		return "Uses the configured approval policy."
	}
}

func policyStepSummary(step ApprovalPolicyStep) string {
	if step.TeamID != "" {
		return teamPreviewLabel(step.TeamID)
	}
	return step.StepType
}

func teamPreviewLabel(teamID string) string {
	if strings.TrimSpace(teamID) == "" {
		return "configured approvers"
	}
	return "members of " + teamID
}

func atoiDefault(value string, fallback int) int {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func (s *SQLiteStore) migrate() error {
	_, err := s.db.Exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;

		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL DEFAULT '' UNIQUE,
			name TEXT NOT NULL,
			password_hash TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS user_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS organizations (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			default_policy_id TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS organization_memberships (
			organization_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (organization_id, user_id)
		);

		CREATE TABLE IF NOT EXISTS teams (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS team_members (
			team_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (team_id, user_id)
		);

		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL,
			team_id TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL,
			slug TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			default_policy_id TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS approval_policies (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL,
			project_id TEXT NOT NULL DEFAULT '',
			team_id TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL,
			template TEXT NOT NULL,
			summary TEXT NOT NULL,
			settings_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS approval_policy_steps (
			id TEXT PRIMARY KEY,
			policy_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			step_type TEXT NOT NULL,
			team_id TEXT NOT NULL DEFAULT '',
			quorum INTEGER NOT NULL DEFAULT 0,
			timeout_seconds INTEGER NOT NULL DEFAULT 0,
			escalation_target TEXT NOT NULL DEFAULT '',
			deny_veto INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS organization_invites (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL,
			email TEXT NOT NULL,
			role TEXT NOT NULL,
			team_id TEXT NOT NULL DEFAULT '',
			token_hash TEXT NOT NULL DEFAULT '',
			expires_at TEXT NOT NULL DEFAULT '',
			accepted_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS approval_requests (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
			organization_id TEXT NOT NULL DEFAULT 'org_default',
			project_id TEXT NOT NULL DEFAULT 'prj_default',
			requester_json TEXT NOT NULL,
			request_type TEXT NOT NULL DEFAULT 'approval',
			title TEXT NOT NULL,
			body TEXT NOT NULL DEFAULT '',
			command TEXT NOT NULL DEFAULT '',
			choices_json TEXT NOT NULL,
			questions_json TEXT NOT NULL DEFAULT '[]',
			default_choice TEXT NOT NULL DEFAULT '',
			allow_freeform_reply INTEGER NOT NULL DEFAULT 0,
			expires_at TEXT NOT NULL DEFAULT '',
			risk TEXT NOT NULL DEFAULT '',
			metadata_json TEXT NOT NULL DEFAULT '{}',
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			responded_at TEXT NOT NULL DEFAULT ''
		);

		CREATE INDEX IF NOT EXISTS approval_requests_status_created_at_idx
			ON approval_requests (status, created_at);

		CREATE TABLE IF NOT EXISTS approval_responses (
			request_id TEXT PRIMARY KEY REFERENCES approval_requests(id) ON DELETE CASCADE,
			choice_id TEXT NOT NULL,
			message TEXT NOT NULL DEFAULT '',
			answers_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS audit_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
			event_type TEXT NOT NULL,
			request_id TEXT NOT NULL,
			payload_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS pairing_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
			organization_id TEXT NOT NULL DEFAULT 'org_default',
			token_hash TEXT NOT NULL UNIQUE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL,
			used_at TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
			organization_id TEXT NOT NULL DEFAULT 'org_default',
			name TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			expo_push_token TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS agent_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
			organization_id TEXT NOT NULL DEFAULT 'org_default',
			project_id TEXT NOT NULL DEFAULT 'prj_default',
			owner_user_id TEXT NOT NULL DEFAULT 'usr_default',
			team_id TEXT NOT NULL DEFAULT '',
			default_approval_policy TEXT NOT NULL DEFAULT '',
			last_request_at TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			scopes_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			revoked_at TEXT NOT NULL DEFAULT ''
		);
	`)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(
		"INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, '', ?, ?)",
		defaultUserID,
		"Single User",
		timeText(&now),
	); err != nil {
		return err
	}
	if _, err := s.db.Exec(
		"INSERT OR IGNORE INTO organizations (id, name, default_policy_id, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
		defaultOrganizationID,
		"Default Organization",
		timeText(&now),
		timeText(&now),
	); err != nil {
		return err
	}
	if _, err := s.db.Exec(
		"INSERT OR IGNORE INTO organization_memberships (organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		defaultOrganizationID,
		defaultUserID,
		RoleOwner,
		timeText(&now),
		timeText(&now),
	); err != nil {
		return err
	}
	if _, err := s.db.Exec(
		"INSERT OR IGNORE INTO projects (id, organization_id, team_id, name, slug, description, default_policy_id, created_at, updated_at) VALUES (?, ?, '', ?, ?, '', '', ?, ?)",
		defaultProjectID,
		defaultOrganizationID,
		"Default Project",
		"default-project",
		timeText(&now),
		timeText(&now),
	); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("organizations", "default_policy_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("projects", "default_policy_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("approval_requests", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("approval_requests", "organization_id", "TEXT NOT NULL DEFAULT 'org_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("approval_requests", "project_id", "TEXT NOT NULL DEFAULT 'prj_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("approval_requests", "request_type", "TEXT NOT NULL DEFAULT 'approval'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("approval_requests", "questions_json", "TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("users", "password_hash", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("audit_events", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("pairing_tokens", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("pairing_tokens", "organization_id", "TEXT NOT NULL DEFAULT 'org_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("devices", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("devices", "organization_id", "TEXT NOT NULL DEFAULT 'org_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "organization_id", "TEXT NOT NULL DEFAULT 'org_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "project_id", "TEXT NOT NULL DEFAULT 'prj_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "owner_user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "team_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "default_approval_policy", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "last_request_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("devices", "expo_push_token", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "revoked_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("devices", "unpaired_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("approval_responses", "answers_json", "TEXT NOT NULL DEFAULT '{}'"); err != nil {
		return err
	}

	if _, err := s.db.Exec(`
		UPDATE approval_requests SET organization_id = 'org_default' WHERE organization_id = '';
		UPDATE approval_requests SET project_id = 'prj_default' WHERE project_id = '';
		UPDATE pairing_tokens SET organization_id = 'org_default' WHERE organization_id = '';
		UPDATE devices SET organization_id = 'org_default' WHERE organization_id = '';
		UPDATE agent_tokens SET organization_id = 'org_default' WHERE organization_id = '';
		UPDATE agent_tokens SET project_id = 'prj_default' WHERE project_id = '';
		UPDATE agent_tokens SET owner_user_id = user_id WHERE owner_user_id = '' OR (owner_user_id = 'usr_default' AND user_id != 'usr_default');
	`); err != nil {
		return err
	}

	_, err = s.db.Exec(`
		CREATE INDEX IF NOT EXISTS approval_requests_user_status_created_at_idx
			ON approval_requests (user_id, status, created_at);
		CREATE INDEX IF NOT EXISTS approval_requests_org_project_created_at_idx
			ON approval_requests (organization_id, project_id, created_at);
		CREATE INDEX IF NOT EXISTS devices_user_created_at_idx
			ON devices (user_id, created_at);
		CREATE INDEX IF NOT EXISTS devices_org_created_at_idx
			ON devices (organization_id, created_at);
		CREATE INDEX IF NOT EXISTS agent_tokens_user_created_at_idx
			ON agent_tokens (user_id, created_at);
		CREATE INDEX IF NOT EXISTS agent_tokens_org_project_created_at_idx
			ON agent_tokens (organization_id, project_id, created_at);
		CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
			ON organization_memberships (user_id, created_at);
		CREATE INDEX IF NOT EXISTS teams_org_name_idx
			ON teams (organization_id, name);
		CREATE INDEX IF NOT EXISTS team_members_user_idx
			ON team_members (user_id);
		CREATE INDEX IF NOT EXISTS projects_org_name_idx
			ON projects (organization_id, name);
		CREATE INDEX IF NOT EXISTS approval_policies_org_name_idx
			ON approval_policies (organization_id, name);
		CREATE INDEX IF NOT EXISTS approval_policy_steps_policy_position_idx
			ON approval_policy_steps (policy_id, position);
		CREATE INDEX IF NOT EXISTS organization_invites_org_email_idx
			ON organization_invites (organization_id, email);
	`)
	return err
}

func (s *SQLiteStore) addColumnIfMissing(table string, column string, definition string) error {
	rows, err := s.db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	_, err = s.db.Exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition)
	return err
}

type requestScanner interface {
	Scan(dest ...any) error
}

func scanRequest(scanner requestScanner) (ApprovalRequest, error) {
	var request ApprovalRequest
	var requesterJSON string
	var choicesJSON string
	var questionsJSON string
	var metadataJSON string
	var expiresAt string
	var createdAt string
	var responseChoice sql.NullString
	var responseMessage sql.NullString
	var responseAnswers sql.NullString
	var respondedAt sql.NullString

	err := scanner.Scan(
		&request.ID,
		&request.UserID,
		&requesterJSON,
		&request.RequestType,
		&request.Title,
		&request.Body,
		&request.Command,
		&choicesJSON,
		&questionsJSON,
		&request.DefaultChoice,
		&request.AllowFreeformReply,
		&expiresAt,
		&request.Risk,
		&metadataJSON,
		&request.Status,
		&createdAt,
		&responseChoice,
		&responseMessage,
		&responseAnswers,
		&respondedAt,
	)
	if err != nil {
		return ApprovalRequest{}, err
	}
	request.RequestType = normalizeRequestType(request.RequestType)

	if err := json.Unmarshal([]byte(requesterJSON), &request.Requester); err != nil {
		return ApprovalRequest{}, err
	}
	if err := json.Unmarshal([]byte(choicesJSON), &request.Choices); err != nil {
		return ApprovalRequest{}, err
	}
	if questionsJSON != "" {
		if err := json.Unmarshal([]byte(questionsJSON), &request.Questions); err != nil {
			return ApprovalRequest{}, err
		}
	}
	if metadataJSON != "" {
		if err := json.Unmarshal([]byte(metadataJSON), &request.Metadata); err != nil {
			return ApprovalRequest{}, err
		}
	}

	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return ApprovalRequest{}, err
	}
	request.CreatedAt = parsedCreatedAt
	request.ExpiresAt = parseOptionalTime(expiresAt)

	if responseChoice.Valid {
		request.Response = &Response{
			ChoiceID: responseChoice.String,
			Message:  responseMessage.String,
		}
		if responseAnswers.Valid && responseAnswers.String != "" {
			if err := json.Unmarshal([]byte(responseAnswers.String), &request.Response.Answers); err != nil {
				return ApprovalRequest{}, err
			}
		}
		if respondedAt.Valid {
			request.RespondedAt = parseOptionalTime(respondedAt.String)
		}
	}

	return request, nil
}

func updateRequestMetadata(tx *sql.Tx, userID string, requestID string, update func(map[string]string)) error {
	var metadataJSON string
	err := tx.QueryRow("SELECT metadata_json FROM approval_requests WHERE id = ? AND user_id = ?", requestID, userID).Scan(&metadataJSON)
	if err != nil {
		return err
	}
	metadata := map[string]string{}
	if strings.TrimSpace(metadataJSON) != "" {
		if err := json.Unmarshal([]byte(metadataJSON), &metadata); err != nil {
			return err
		}
	}
	if metadata == nil {
		metadata = map[string]string{}
	}
	update(metadata)
	updatedJSON, err := marshalJSON(metadata)
	if err != nil {
		return err
	}
	_, err = tx.Exec("UPDATE approval_requests SET metadata_json = ? WHERE id = ? AND user_id = ?", updatedJSON, requestID, userID)
	return err
}

func insertAudit(tx *sql.Tx, eventType string, requestID string, payload any) error {
	return insertAuditForUser(tx, defaultUserID, eventType, requestID, payload)
}

func insertAuditForUser(tx *sql.Tx, userID string, eventType string, requestID string, payload any) error {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	payloadJSON, err := marshalJSON(payload)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_, err = tx.Exec(
		"INSERT INTO audit_events (user_id, event_type, request_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
		userID,
		eventType,
		requestID,
		payloadJSON,
		timeText(&now),
	)
	return err
}

func marshalJSON(value any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func timeText(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func tokenHash(token string) string {
	hash := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", hash[:])
}

func parseOptionalTime(value string) *time.Time {
	if value == "" {
		return nil
	}
	parsed, err := parseTime(value)
	if err != nil {
		return nil
	}
	return &parsed
}

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse time %q: %w", value, err)
	}
	return parsed, nil
}

func rollback(tx *sql.Tx) {
	_ = tx.Rollback()
}
