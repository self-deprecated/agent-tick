package approval

import (
	"path/filepath"
	"testing"
)

func TestFileStoreCreateListRespond(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	request, err := store.Create(CreateRequest{Title: "Run command?"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if request.ID == "" {
		t.Fatal("Create() returned empty ID")
	}
	if request.Status != StatusPending {
		t.Fatalf("Status = %q, want %q", request.Status, StatusPending)
	}
	if len(request.Choices) != 2 {
		t.Fatalf("Choices length = %d, want 2", len(request.Choices))
	}

	pending, err := store.List(StatusPending)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("pending length = %d, want 1", len(pending))
	}

	responded, err := store.Respond(request.ID, Response{ChoiceID: "approve"})
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if responded.Response == nil || responded.Response.ChoiceID != "approve" {
		t.Fatalf("Response = %#v, want approve", responded.Response)
	}

	pending, err = store.List(StatusPending)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("pending length = %d, want 0", len(pending))
	}
}

func TestFileStoreRejectsInvalidAndDuplicateResponses(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

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
