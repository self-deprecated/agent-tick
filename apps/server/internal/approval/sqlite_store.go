package approval

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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
	`)
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
