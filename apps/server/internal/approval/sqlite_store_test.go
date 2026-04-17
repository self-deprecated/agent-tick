package approval

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestSQLiteStoreCreateListRespond(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	request, err := store.Create(CreateRequest{
		Requester: Requester{Name: "codex", AgentID: "local-agent", Host: "overton"},
		Title:     "Run command?",
		Command:   "npm install",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	pending, err := store.List(StatusPending)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("pending length = %d, want 1", len(pending))
	}
	if pending[0].Command != "npm install" {
		t.Fatalf("Command = %q, want npm install", pending[0].Command)
	}

	responded, err := store.Respond(request.ID, Response{ChoiceID: "approve", Message: "ok"})
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if responded.Response == nil || responded.Response.Message != "ok" {
		t.Fatalf("Response = %#v, want message", responded.Response)
	}

	pending, err = store.List(StatusPending)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("pending length = %d, want 0", len(pending))
	}
}

func TestSQLiteStoreExpiresPendingRequests(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	expiredAt := time.Now().UTC().Add(-time.Minute)
	request, err := store.Create(CreateRequest{
		Title:     "Expired",
		ExpiresAt: &expiredAt,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	pending, err := store.List(StatusPending)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("pending length = %d, want 0", len(pending))
	}

	found, err := store.Get(request.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if found.Status != StatusExpired {
		t.Fatalf("Status = %q, want %q", found.Status, StatusExpired)
	}
	if _, err := store.Respond(request.ID, Response{ChoiceID: "approve"}); err != ErrExpired {
		t.Fatalf("Respond() error = %v, want %v", err, ErrExpired)
	}
}

func TestSQLiteStorePersistsRequests(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-tick.db")
	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("NewSQLiteStore() error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Persist me"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	store, err = NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("NewSQLiteStore() reopen error = %v", err)
	}
	defer store.Close()

	found, err := store.Get(request.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if found.Title != "Persist me" {
		t.Fatalf("Title = %q, want Persist me", found.Title)
	}
}

func TestSQLiteStoreRejectsInvalidAndDuplicateResponses(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	request, err := store.Create(CreateRequest{Title: "Run command?"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := store.Respond(request.ID, Response{ChoiceID: "maybe"}); err != ErrInvalidChoice {
		t.Fatalf("Respond() error = %v, want %v", err, ErrInvalidChoice)
	}
	if _, err := store.Respond(request.ID, Response{ChoiceID: "approve"}); err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if _, err := store.Respond(request.ID, Response{ChoiceID: "deny"}); err != ErrAlreadyResponded {
		t.Fatalf("Respond() error = %v, want %v", err, ErrAlreadyResponded)
	}
}

func TestSQLiteStoreWritesAuditEvents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-tick.db")
	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("NewSQLiteStore() error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Audit me"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := store.Respond(request.ID, Response{ChoiceID: "approve"}); err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM audit_events").Scan(&count); err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if count != 2 {
		t.Fatalf("audit count = %d, want 2", count)
	}
}

func newTestSQLiteStore(t *testing.T) *SQLiteStore {
	t.Helper()

	store, err := NewSQLiteStore(filepath.Join(t.TempDir(), "agent-tick.db"))
	if err != nil {
		t.Fatalf("NewSQLiteStore() error = %v", err)
	}
	return store
}
