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

func TestFileStoreAbandonPendingAndAnsweredRequests(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	pending, err := store.Create(CreateRequest{Title: "Run command?"})
	if err != nil {
		t.Fatalf("Create() pending error = %v", err)
	}
	abandoned, changed, err := store.Abandon(pending.ID)
	if err != nil {
		t.Fatalf("Abandon() error = %v", err)
	}
	if !changed {
		t.Fatal("Abandon() changed = false, want true")
	}
	if abandoned.Status != StatusAbandoned || abandoned.Response != nil {
		t.Fatalf("Abandon() = %#v, want abandoned without response", abandoned)
	}
	if _, err := store.Respond(pending.ID, Response{ChoiceID: "approve"}); err != ErrAbandoned {
		t.Fatalf("Respond() after abandon error = %v, want %v", err, ErrAbandoned)
	}

	answered, err := store.Create(CreateRequest{Title: "Answered"})
	if err != nil {
		t.Fatalf("Create() answered error = %v", err)
	}
	if _, err := store.Respond(answered.ID, Response{ChoiceID: "approve"}); err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	current, changed, err := store.Abandon(answered.ID)
	if err != nil {
		t.Fatalf("Abandon() answered error = %v", err)
	}
	if changed {
		t.Fatal("Abandon() answered changed = true, want false")
	}
	if current.Status != StatusResponded || current.Response == nil || current.Response.ChoiceID != "approve" {
		t.Fatalf("Abandon() answered = %#v, want existing response", current)
	}
}

func TestFileStoreAbandonWithReasonRecordsMetadata(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	request, err := store.Create(CreateRequest{Title: "Run command?", Metadata: map[string]string{"clientRequestId": "piapr_abc"}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	abandoned, changed, err := store.AbandonWithReason(request.ID, "superseded")
	if err != nil {
		t.Fatalf("AbandonWithReason() error = %v", err)
	}
	if !changed || abandoned.Status != StatusAbandoned {
		t.Fatalf("AbandonWithReason() = %#v changed %v, want abandoned change", abandoned, changed)
	}
	if abandoned.Metadata["clientRequestId"] != "piapr_abc" || abandoned.Metadata["abandonReason"] != "superseded" {
		t.Fatalf("metadata = %#v, want clientRequestId and abandonReason", abandoned.Metadata)
	}
}

func TestFileStoreQuestionnaireResponse(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	request, err := store.Create(CreateRequest{
		RequestType: RequestTypeQuestionnaire,
		Title:       "Pre-flight questions",
		Questions: []Question{
			{
				Header:   "Environment",
				Question: "Which environment?",
				Options: []QuestionOption{
					{Label: "dev"},
					{Label: "prod"},
				},
			},
			{
				Header:      "Checks",
				Question:    "Which checks should run?",
				MultiSelect: true,
				Options: []QuestionOption{
					{Label: "lint"},
					{Label: "test"},
					{Label: "build"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if request.RequestType != RequestTypeQuestionnaire {
		t.Fatalf("RequestType = %q, want %q", request.RequestType, RequestTypeQuestionnaire)
	}
	if len(request.Choices) != 0 {
		t.Fatalf("Choices length = %d, want 0", len(request.Choices))
	}

	responded, err := store.Respond(request.ID, Response{
		Answers: map[string][]string{
			"Which environment?":       []string{"prod"},
			"Which checks should run?": []string{"lint", "test"},
		},
	})
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if responded.Response == nil || len(responded.Response.Answers["Which checks should run?"]) != 2 {
		t.Fatalf("Response = %#v, want questionnaire answers", responded.Response)
	}
}
