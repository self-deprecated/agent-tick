package approval

import (
	"errors"
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

func TestClassifyCommandRiskUsesCommandBoundaries(t *testing.T) {
	cases := []struct {
		command string
		want    string
	}{
		{command: "ls", want: "low"},
		{command: "ls -la", want: "low"},
		{command: "lsystemctl reboot", want: "medium"},
		{command: "pwd", want: "low"},
		{command: "pwd -P", want: "low"},
		{command: "pwdelete everything", want: "medium"},
		{command: "git status --short", want: "low"},
		{command: "git statusfoo", want: "medium"},
		{command: "rm -rf /tmp/agent-tick", want: "high"},
	}
	for _, tc := range cases {
		if got := ClassifyCommandRisk(tc.command); got != tc.want {
			t.Fatalf("ClassifyCommandRisk(%q) = %q, want %q", tc.command, got, tc.want)
		}
	}
}

func TestEffectiveCreateRequestRiskPreventsDowngradesAndAllowsEscalation(t *testing.T) {
	cases := []struct {
		name  string
		input CreateRequest
		want  string
	}{
		{name: "server low without client risk", input: CreateRequest{Command: "ls"}, want: "low"},
		{name: "untrusted client low without command", input: CreateRequest{Risk: "low"}, want: ""},
		{name: "client escalation wins", input: CreateRequest{Command: "ls", Risk: "medium"}, want: "medium"},
		{name: "server high blocks client low", input: CreateRequest{Command: "sudo reboot", Risk: "low"}, want: "high"},
	}
	for _, tc := range cases {
		if got := effectiveCreateRequestRisk(tc.input); got != tc.want {
			t.Fatalf("%s: effectiveCreateRequestRisk(%#v) = %q, want %q", tc.name, tc.input, got, tc.want)
		}
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

func TestFileStoreRejectsMessagesWhenFreeformDisabled(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	request, err := store.Create(CreateRequest{Title: "Run command?"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	_, err = store.Respond(request.ID, Response{ChoiceID: "approve", Message: "typed reply"})
	if err == nil || !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("Respond() error = %v, want %v", err, ErrInvalidResponse)
	}
}

func TestFileStoreSteerRequest(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	request, err := store.Create(CreateRequest{
		RequestType: RequestTypeSteer,
		Title:       "Choose next step",
		Choices: []Choice{
			{ID: "run-tests", Label: "Run tests"},
			{ID: "update_docs", Label: "Update docs"},
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if request.RequestType != RequestTypeSteer {
		t.Fatalf("RequestType = %q, want %q", request.RequestType, RequestTypeSteer)
	}
	if request.DefaultChoice != SteerNoneChoiceID || !hasChoiceID(request.Choices, SteerNoneChoiceID) {
		t.Fatalf("steer choices/default = %#v/%q, want built-in none", request.Choices, request.DefaultChoice)
	}
	if request.AllowFreeformReply {
		t.Fatal("AllowFreeformReply = true, want false")
	}

	if _, err := store.Respond(request.ID, Response{ChoiceID: "run-tests", Message: "extra"}); err == nil || !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("Respond(message) error = %v, want %v", err, ErrInvalidResponse)
	}
	responded, err := store.Respond(request.ID, Response{ChoiceID: "run-tests"})
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if responded.Response == nil || responded.Response.ChoiceID != "run-tests" {
		t.Fatalf("Response = %#v, want run-tests", responded.Response)
	}
}

func TestFileStoreRejectsLegacyRawApprovalPayloads(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	invalid := []CreateRequest{
		{Title: "Approve-AI approval required", Body: `Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: brokerRequestId: piapr_123 correlationToken: piapr_corr_456`},
		{Title: "Run command?", Body: `Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: brokerRequestId: piapr_123`},
		{Title: "Run command?", Body: `Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: brokerRequestId: piapr_123`, Command: "echo structured"},
		{Title: "Run command?", Command: `Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: brokerRequestId: piapr_123`},
		{Title: "Run command?", Command: `Tool: bash { "command":"echo simple-only-ok" } --- Pi approval metadata: brokerRequestId: piapr_123`},
		{Title: "Run command?", Body: "Tool: bash {\"command\":\"echo simple-only-ok\"}\nPi approval metadata:\nbrokerRequestId: piapr_123\ncorrelationToken: piapr_corr_456"},
		{Title: `Tool: bash {"command":"echo simple-only-ok"}`, Body: "Pi approval metadata:\nbrokerRequestId: piapr_123"},
		{Title: `Tool: bash {"command":"echo simple-only-ok"}`, Body: "Pi approval metadata:\nbrokerRequestId: piapr_123", Command: "echo structured"},
		{Title: "Run command?", Body: `Tool: bash {"command":"echo simple-only-ok"}`, Command: "Pi approval metadata: brokerRequestId: piapr_123"},
		{Title: "Run command?", Body: "Tool: bash {\"command\":\"echo simple-only-ok\"}\nPi approval metadata:\nbrokerRequestId: piapr_123\n---\ncorrelationToken: piapr_corr_456"},
		{Title: "Run command?", Body: `Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: call_uuid: 019de7c4 actionFingerprint: sha256:abc`},
		{Title: "Run command?", Body: `- Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: brokerRequestId: piapr_123`},
		{Title: "Run command?", Body: `* Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: brokerRequestId: piapr_123`},
		{Title: "Run command?", Body: `tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: BrokerRequestId: piapr_123`},
		{Title: "Run command?", Body: `Please review: Tool: bash {"command":"echo simple-only-ok"} --- Pi approval metadata: BrokerRequestId: piapr_123`},
		{Title: "Run command?", Body: "1. Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata:\nnoop\nSessionId: 123E4567-E89B-12D3-A456-426614174000"},
		{Title: "Run command?", Body: "10. Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata:\nSessionId: 123e4567-e89b-12d3-a456-426614174000"},
		{Title: "Run command?", Body: "Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata:\nSessionId: \"123e4567-e89b-12d3-a456-426614174000\""},
		{Title: "Run command?", Body: "Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata:\nbrokerRequestId : PIAPR_123"},
		{Title: "Run command?", Body: "Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata:\nbrokerRequestId: 12345"},
		{Title: "Run command?", Body: "Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata:\n\nbrokerRequestId: piapr_123"},
		{Title: "Run command?", Body: "Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata: mybrokerRequestId: docs, brokerRequestId: piapr_123"},
		{Title: "Run command?", Body: "- 99. Tool: bash {\"cmd\":\"echo simple-only-ok\"}\nPi approval metadata:\nSessionId: 123e4567-e89b-12d3-a456-426614174000"},
		{Title: "Run command?", Body: "> Tool: bash\nPi approval metadata:\ncorrelationToken: piapr_corr_456"},
	}
	for _, input := range invalid {
		if _, err := store.Create(input); err == nil || !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("Create(%#v) error = %v, want %v", input, err, ErrInvalidRequest)
		}
	}
}

func TestFileStoreAllowsStructuredPayloadsWithIncidentalLegacyWords(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	valid := []CreateRequest{
		{Title: "Approve-AI approval required", Body: "Approve a structured request with a normal command field.", Command: "echo ok"},
		{Title: "Run command?", Body: "See Tool: deployment docs and the brokerRequestId spec.", Command: "echo ok"},
		{Title: "Run command?", Body: "Tool: bash", Command: "echo ok"},
		{Title: "Run command?", Body: "Docs mention Pi approval metadata: as a heading without legacy fields.", Command: "echo ok"},
		{Title: "Run command?", Body: "Pi approval metadata: docs header only\n\nSessionId is used in API docs.", Command: "echo ok"},
		{Title: "Run command?", Body: "Pi approval metadata: docs header only\nSessionId: see API docs", Command: "echo ok"},
		{Title: "Run command?", Body: "Pi approval metadata: docs header only\nsessionId: abcdefgh", Command: "echo ok"},
		{Title: "Run command?", Body: "Tool: bash is mentioned in our deployment docs\nPi approval metadata: docs header only\nsessionId: production", Command: "echo ok"},
		{Title: `Tool: bash {"command":"example from docs"}`, Body: "Pi approval metadata:\nsessionId: see API docs", Command: "echo structured"},
		{Title: "Run command?", Body: "Pi approval metadata: docs mention mybrokerRequestId: piapr_123", Command: "echo ok"},
		{Title: "Run command?", Body: "Tool: bash {\"command\":\"echo ok\"}\nPi approval metadata: docs mention mybrokerRequestId: piapr_123", Command: "echo ok"},
		{Title: "Run command?", Body: "Tool: see brokerRequestId mapping at {example}", Command: "echo ok"},
		{Title: "Pi approval metadata: docs header only", Body: "SessionId is used in API docs.", Command: "echo ok"}, 
		{Title: "Run command?", Body: "Structured request", Command: "echo ok", Requester: Requester{Name: `Tool: bash {"command":"echo ok"} brokerRequestId: piapr_123`}},
		{Title: "Run command?", Body: "Structured request", Command: "echo ok", Metadata: map[string]string{"audit": `Tool: bash {"command":"echo ok"} brokerRequestId: piapr_123`}},
		{RequestType: RequestTypeSteer, Title: "Choose", Body: "Tool: docs mention brokerRequestId", Choices: []Choice{{ID: "next", Label: "Next"}}},
		{RequestType: RequestTypeSteer, Title: "Choose", Body: "Pi approval metadata: docs example", Choices: []Choice{{ID: "next", Label: "Next"}}},
		{RequestType: RequestTypeQuestionnaire, Title: "Questions", Questions: []Question{{Question: "Metadata?", Options: []QuestionOption{{Label: "Yes"}}}}, Body: "Pi approval metadata:\nbrokerRequestId: piapr_123"},
	}
	for _, input := range valid {
		if _, err := store.Create(input); err != nil {
			t.Fatalf("Create(%#v) error = %v, want nil", input, err)
		}
	}
}

func TestFileStoreRejectsInvalidSteerRequests(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json"))

	invalid := []CreateRequest{
		{RequestType: RequestTypeSteer, Title: "Choose", Choices: nil},
		{RequestType: RequestTypeSteer, Title: "Choose", AllowFreeformReply: true, Choices: []Choice{{ID: "next", Label: "Next"}}},
		{RequestType: RequestTypeSteer, Title: "Choose", Command: "npm test", Choices: []Choice{{ID: "next", Label: "Next"}}},
		{RequestType: RequestTypeSteer, Title: "Choose", Choices: []Choice{{ID: SteerNoneChoiceID, Label: "Pretend"}}},
		{RequestType: RequestTypeSteer, Title: "Choose", Choices: []Choice{{ID: "not allowed", Label: "Bad ID"}}},
	}
	for _, input := range invalid {
		if _, err := store.Create(input); err == nil || !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("Create(%#v) error = %v, want %v", input, err, ErrInvalidRequest)
		}
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
