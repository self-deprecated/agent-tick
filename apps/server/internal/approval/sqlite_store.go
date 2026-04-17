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

	_ "modernc.org/sqlite"
)

type SQLiteStore struct {
	db *sql.DB
}

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

func (s *SQLiteStore) Create(input CreateRequest) (ApprovalRequest, error) {
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

	requesterJSON, err := marshalJSON(request.Requester)
	if err != nil {
		return ApprovalRequest{}, err
	}
	choicesJSON, err := marshalJSON(request.Choices)
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
			id, requester_json, title, body, command, choices_json,
			default_choice, allow_freeform_reply, expires_at, risk,
			metadata_json, status, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		request.ID,
		requesterJSON,
		request.Title,
		request.Body,
		request.Command,
		choicesJSON,
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
	if err := insertAudit(tx, "approval_request.created", request.ID, nil); err != nil {
		return ApprovalRequest{}, err
	}
	return request, tx.Commit()
}

func (s *SQLiteStore) List(status string) ([]ApprovalRequest, error) {
	if err := s.expirePendingRequests(); err != nil {
		return nil, err
	}

	query := `
		SELECT
			r.id, r.requester_json, r.title, r.body, r.command, r.choices_json,
			r.default_choice, r.allow_freeform_reply, r.expires_at, r.risk,
			r.metadata_json, r.status, r.created_at,
			resp.choice_id, resp.message, resp.created_at
		FROM approval_requests r
		LEFT JOIN approval_responses resp ON resp.request_id = r.id
	`
	args := []any{}
	if status != "" {
		query += " WHERE r.status = ?"
		args = append(args, status)
	}
	query += " ORDER BY r.created_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var requests []ApprovalRequest
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
	if err := s.expirePendingRequests(); err != nil {
		return ApprovalRequest{}, err
	}

	row := s.db.QueryRow(`
		SELECT
			r.id, r.requester_json, r.title, r.body, r.command, r.choices_json,
			r.default_choice, r.allow_freeform_reply, r.expires_at, r.risk,
			r.metadata_json, r.status, r.created_at,
			resp.choice_id, resp.message, resp.created_at
		FROM approval_requests r
		LEFT JOIN approval_responses resp ON resp.request_id = r.id
		WHERE r.id = ?
	`, id)

	request, err := scanRequest(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ApprovalRequest{}, ErrNotFound
	}
	return request, err
}

func (s *SQLiteStore) Respond(id string, response Response) (ApprovalRequest, error) {
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
			r.id, r.requester_json, r.title, r.body, r.command, r.choices_json,
			r.default_choice, r.allow_freeform_reply, r.expires_at, r.risk,
			r.metadata_json, r.status, r.created_at,
			resp.choice_id, resp.message, resp.created_at
		FROM approval_requests r
		LEFT JOIN approval_responses resp ON resp.request_id = r.id
		WHERE r.id = ?
	`, id)

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
	if !hasChoice(request, response.ChoiceID) {
		return ApprovalRequest{}, ErrInvalidChoice
	}

	now := time.Now().UTC()
	_, err = tx.Exec(
		"INSERT INTO approval_responses (request_id, choice_id, message, created_at) VALUES (?, ?, ?, ?)",
		request.ID,
		response.ChoiceID,
		response.Message,
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
	if err := insertAudit(tx, "approval_request.responded", request.ID, response); err != nil {
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
	token := "pair_" + newID()
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	_, err := s.db.Exec(
		"INSERT INTO pairing_tokens (token_hash, expires_at, created_at) VALUES (?, ?, ?)",
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
	err = tx.QueryRow(`
		SELECT id
		FROM pairing_tokens
		WHERE token_hash = ? AND used_at = '' AND expires_at > ?
	`, tokenHash(token), timeText(&now)).Scan(&tokenID)
	if errors.Is(err, sql.ErrNoRows) {
		return DeviceCredential{}, ErrNotFound
	}
	if err != nil {
		return DeviceCredential{}, err
	}

	deviceID := "dev_" + newID()
	deviceToken := "device_" + newID()
	_, err = tx.Exec(
		"INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)",
		deviceID,
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
	if strings.TrimSpace(token) == "" {
		return false, nil
	}

	var exists int
	err := s.db.QueryRow(
		"SELECT 1 FROM devices WHERE token_hash = ? LIMIT 1",
		tokenHash(token),
	).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return exists == 1, nil
}

func (s *SQLiteStore) VerifyDeviceTokenForDevice(deviceID string, token string) (bool, error) {
	if strings.TrimSpace(deviceID) == "" || strings.TrimSpace(token) == "" {
		return false, nil
	}

	var exists int
	err := s.db.QueryRow(
		"SELECT 1 FROM devices WHERE id = ? AND token_hash = ? LIMIT 1",
		deviceID,
		tokenHash(token),
	).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return exists == 1, nil
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
	rows, err := s.db.Query("SELECT expo_push_token FROM devices WHERE expo_push_token != ''")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []string
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

func (s *SQLiteStore) CreateAgentToken(name string, scopes []string) (AgentCredential, error) {
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
		"INSERT INTO agent_tokens (id, name, token_hash, scopes_json, created_at) VALUES (?, ?, ?, ?, ?)",
		agentID,
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
	if strings.TrimSpace(token) == "" {
		return false, nil
	}

	var scopesJSON string
	err := s.db.QueryRow(
		"SELECT scopes_json FROM agent_tokens WHERE token_hash = ? AND revoked_at = '' LIMIT 1",
		tokenHash(token),
	).Scan(&scopesJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	var scopes []string
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return false, err
	}
	return slices.Contains(scopes, scope) || slices.Contains(scopes, "*"), nil
}

func (s *SQLiteStore) ListAgentTokens() ([]AgentTokenRecord, error) {
	rows, err := s.db.Query("SELECT id, name, scopes_json, created_at, revoked_at FROM agent_tokens ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []AgentTokenRecord
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
	now := time.Now().UTC()
	result, err := s.db.Exec(
		"UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND revoked_at = ''",
		timeText(&now),
		agentID,
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

		CREATE TABLE IF NOT EXISTS approval_requests (
			id TEXT PRIMARY KEY,
			requester_json TEXT NOT NULL,
			title TEXT NOT NULL,
			body TEXT NOT NULL DEFAULT '',
			command TEXT NOT NULL DEFAULT '',
			choices_json TEXT NOT NULL,
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
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS audit_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_type TEXT NOT NULL,
			request_id TEXT NOT NULL,
			payload_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS pairing_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			token_hash TEXT NOT NULL UNIQUE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL,
			used_at TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS devices (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			expo_push_token TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS agent_tokens (
			id TEXT PRIMARY KEY,
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

	if err := s.addColumnIfMissing("devices", "expo_push_token", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.addColumnIfMissing("agent_tokens", "revoked_at", "TEXT NOT NULL DEFAULT ''")
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
	var metadataJSON string
	var expiresAt string
	var createdAt string
	var responseChoice sql.NullString
	var responseMessage sql.NullString
	var respondedAt sql.NullString

	err := scanner.Scan(
		&request.ID,
		&requesterJSON,
		&request.Title,
		&request.Body,
		&request.Command,
		&choicesJSON,
		&request.DefaultChoice,
		&request.AllowFreeformReply,
		&expiresAt,
		&request.Risk,
		&metadataJSON,
		&request.Status,
		&createdAt,
		&responseChoice,
		&responseMessage,
		&respondedAt,
	)
	if err != nil {
		return ApprovalRequest{}, err
	}

	if err := json.Unmarshal([]byte(requesterJSON), &request.Requester); err != nil {
		return ApprovalRequest{}, err
	}
	if err := json.Unmarshal([]byte(choicesJSON), &request.Choices); err != nil {
		return ApprovalRequest{}, err
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
		if respondedAt.Valid {
			request.RespondedAt = parseOptionalTime(respondedAt.String)
		}
	}

	return request, nil
}

func insertAudit(tx *sql.Tx, eventType string, requestID string, payload any) error {
	payloadJSON, err := marshalJSON(payload)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_, err = tx.Exec(
		"INSERT INTO audit_events (event_type, request_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
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
