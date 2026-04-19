package approval

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
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

	tx, err := s.db.Begin()
	if err != nil {
		return ApprovalRequest{}, err
	}
	defer rollback(tx)

	_, err = tx.Exec(`
		INSERT INTO approval_requests (
			id, user_id, requester_json, request_type, title, body, command, choices_json, questions_json,
			default_choice, allow_freeform_reply, expires_at, risk,
			metadata_json, status, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		request.ID,
		userID,
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
	token := "pair_" + newID()
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	_, err := s.db.Exec(
		"INSERT INTO pairing_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
		userID,
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
	err = tx.QueryRow(`
		SELECT id, user_id
		FROM pairing_tokens
		WHERE token_hash = ? AND used_at = '' AND expires_at > ?
	`, tokenHash(token), timeText(&now)).Scan(&tokenID, &userID)
	if errors.Is(err, sql.ErrNoRows) {
		return DeviceCredential{}, ErrNotFound
	}
	if err != nil {
		return DeviceCredential{}, err
	}

	deviceID := "dev_" + newID()
	deviceToken := "device_" + newID()
	_, err = tx.Exec(
		"INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
		deviceID,
		userID,
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

func (s *SQLiteStore) CreateAgentTokenForUser(userID string, name string, scopes []string) (AgentCredential, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	if strings.TrimSpace(name) == "" {
		name = "agent"
	}
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
		"INSERT INTO agent_tokens (id, user_id, name, token_hash, scopes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		agentID,
		userID,
		name,
		tokenHash(token),
		scopesJSON,
		timeText(&now),
	)
	if err != nil {
		return AgentCredential{}, err
	}

	return AgentCredential{AgentID: agentID, Name: name, Token: token, Scopes: scopes}, nil
}

func (s *SQLiteStore) VerifyAgentToken(token string, scope string) (bool, error) {
	_, ok, err := s.UserIDForAgentToken(token, scope)
	return ok, err
}

func (s *SQLiteStore) UserIDForAgentToken(token string, scope string) (string, bool, error) {
	if strings.TrimSpace(token) == "" {
		return "", false, nil
	}

	var userID string
	var scopesJSON string
	err := s.db.QueryRow(
		"SELECT user_id, scopes_json FROM agent_tokens WHERE token_hash = ? AND revoked_at = '' LIMIT 1",
		tokenHash(token),
	).Scan(&userID, &scopesJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}

	var scopes []string
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return "", false, err
	}
	ok := slices.Contains(scopes, scope) || slices.Contains(scopes, "*")
	return userID, ok, nil
}

func (s *SQLiteStore) ListAgentTokens() ([]AgentTokenRecord, error) {
	return s.ListAgentTokensForUser(defaultUserID)
}

func (s *SQLiteStore) ListAgentTokensForUser(userID string) ([]AgentTokenRecord, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	rows, err := s.db.Query("SELECT id, name, scopes_json, created_at, revoked_at FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC", userID)
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
		if err := rows.Scan(&record.AgentID, &record.Name, &scopesJSON, &createdAt, &revokedAt); err != nil {
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

	var name string
	var scopesJSON string
	err = tx.QueryRow(
		"SELECT name, scopes_json FROM agent_tokens WHERE id = ? AND revoked_at = ''",
		agentID,
	).Scan(&name, &scopesJSON)
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

	return AgentCredential{AgentID: agentID, Name: name, Token: token, Scopes: scopes}, nil
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

		CREATE TABLE IF NOT EXISTS approval_requests (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
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
			token_hash TEXT NOT NULL UNIQUE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL,
			used_at TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
			name TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			expo_push_token TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS agent_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'usr_default',
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
	if err := s.addColumnIfMissing("approval_requests", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
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
	if err := s.addColumnIfMissing("devices", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("agent_tokens", "user_id", "TEXT NOT NULL DEFAULT 'usr_default'"); err != nil {
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

	_, err = s.db.Exec(`
		CREATE INDEX IF NOT EXISTS approval_requests_user_status_created_at_idx
			ON approval_requests (user_id, status, created_at);
		CREATE INDEX IF NOT EXISTS devices_user_created_at_idx
			ON devices (user_id, created_at);
		CREATE INDEX IF NOT EXISTS agent_tokens_user_created_at_idx
			ON agent_tokens (user_id, created_at);
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
