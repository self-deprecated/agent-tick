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
		Requester:          Requester{Name: "codex", AgentID: "local-agent", Host: "overton"},
		Title:              "Run command?",
		Command:            "npm install",
		AllowFreeformReply: true,
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

func TestSQLiteStoreAbandonPendingAndAnsweredRequests(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

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

	answered, err := store.Create(CreateRequest{Title: "Answered", AllowFreeformReply: true})
	if err != nil {
		t.Fatalf("Create() answered error = %v", err)
	}
	if _, err := store.Respond(answered.ID, Response{ChoiceID: "deny", Message: "no"}); err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	current, changed, err := store.Abandon(answered.ID)
	if err != nil {
		t.Fatalf("Abandon() answered error = %v", err)
	}
	if changed {
		t.Fatal("Abandon() answered changed = true, want false")
	}
	if current.Status != StatusResponded || current.Response == nil || current.Response.ChoiceID != "deny" || current.Response.Message != "no" {
		t.Fatalf("Abandon() answered = %#v, want existing response", current)
	}
}

func TestSQLiteStoreAbandonWithReasonRecordsMetadataAndAudit(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

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

	var payload string
	if err := store.db.QueryRow("SELECT payload_json FROM audit_events WHERE event_type = 'approval_request.abandoned' AND request_id = ?", request.ID).Scan(&payload); err != nil {
		t.Fatalf("Scan() audit payload error = %v", err)
	}
	if payload != `{"reason":"superseded"}` {
		t.Fatalf("audit payload = %s, want reason", payload)
	}
}

func TestSQLiteStoreQuestionnaireResponse(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

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

	found, err := store.Get(request.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if found.Response == nil || found.Response.Answers["Which environment?"][0] != "prod" {
		t.Fatalf("Stored response = %#v, want persisted answers", found.Response)
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

func TestSQLiteStoreCreatesDefaultUser(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	if _, err := store.Create(CreateRequest{Title: "User scoped"}); err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	var count int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM users WHERE id = ?", defaultUserID).Scan(&count); err != nil {
		t.Fatalf("Scan() users error = %v", err)
	}
	if count != 1 {
		t.Fatalf("default users = %d, want 1", count)
	}

	var userID string
	if err := store.db.QueryRow("SELECT user_id FROM approval_requests LIMIT 1").Scan(&userID); err != nil {
		t.Fatalf("Scan() approval user error = %v", err)
	}
	if userID != defaultUserID {
		t.Fatalf("approval user_id = %q, want %q", userID, defaultUserID)
	}
}

func TestSQLiteStoreScopesRequestsByUser(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	defaultRequest, err := store.CreateForUser(defaultUserID, CreateRequest{Title: "Default"})
	if err != nil {
		t.Fatalf("CreateForUser(default) error = %v", err)
	}
	otherRequest, err := store.CreateForUser("usr_other", CreateRequest{Title: "Other"})
	if err != nil {
		t.Fatalf("CreateForUser(other) error = %v", err)
	}

	defaultRequests, err := store.ListForUser(defaultUserID, "")
	if err != nil {
		t.Fatalf("ListForUser(default) error = %v", err)
	}
	if len(defaultRequests) != 1 || defaultRequests[0].ID != defaultRequest.ID {
		t.Fatalf("default requests = %#v, want only %s", defaultRequests, defaultRequest.ID)
	}

	if _, err := store.GetForUser(defaultUserID, otherRequest.ID); err != ErrNotFound {
		t.Fatalf("GetForUser(default, other) error = %v, want %v", err, ErrNotFound)
	}
}

func TestSQLiteStoreScopesPairingByUser(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	pairing, err := store.CreatePairingTokenForUser("usr_other", time.Minute)
	if err != nil {
		t.Fatalf("CreatePairingTokenForUser() error = %v", err)
	}
	credential, err := store.PairDevice(pairing.Token, "iPhone")
	if err != nil {
		t.Fatalf("PairDevice() error = %v", err)
	}

	defaultDevices, err := store.ListDevicesForUser(defaultUserID)
	if err != nil {
		t.Fatalf("ListDevicesForUser(default) error = %v", err)
	}
	if len(defaultDevices) != 0 {
		t.Fatalf("default devices = %#v, want none", defaultDevices)
	}

	otherDevices, err := store.ListDevicesForUser("usr_other")
	if err != nil {
		t.Fatalf("ListDevicesForUser(other) error = %v", err)
	}
	if len(otherDevices) != 1 || otherDevices[0].DeviceID != credential.DeviceID {
		t.Fatalf("other devices = %#v, want %s", otherDevices, credential.DeviceID)
	}
}

func TestSQLiteStoreManagesAgentTokens(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	emptyRecords, err := store.ListAgentTokens()
	if err != nil {
		t.Fatalf("ListAgentTokens() empty error = %v", err)
	}
	if emptyRecords == nil {
		t.Fatal("ListAgentTokens() empty = nil, want empty slice")
	}

	credential, err := store.CreateAgentToken("codex", []string{"approval:write"})
	if err != nil {
		t.Fatalf("CreateAgentToken() error = %v", err)
	}
	ok, err := store.VerifyAgentToken(credential.Token, "approval:write")
	if err != nil {
		t.Fatalf("VerifyAgentToken() error = %v", err)
	}
	if !ok {
		t.Fatal("VerifyAgentToken() = false, want true")
	}

	records, err := store.ListAgentTokens()
	if err != nil {
		t.Fatalf("ListAgentTokens() error = %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("records length = %d, want 1", len(records))
	}

	rotated, err := store.RotateAgentToken(credential.AgentID)
	if err != nil {
		t.Fatalf("RotateAgentToken() error = %v", err)
	}
	if rotated.Token == credential.Token {
		t.Fatal("RotateAgentToken() returned same token")
	}
	ok, err = store.VerifyAgentToken(credential.Token, "approval:write")
	if err != nil {
		t.Fatalf("VerifyAgentToken() old error = %v", err)
	}
	if ok {
		t.Fatal("old token still verifies after rotation")
	}

	if err := store.RevokeAgentToken(credential.AgentID); err != nil {
		t.Fatalf("RevokeAgentToken() error = %v", err)
	}
	ok, err = store.VerifyAgentToken(rotated.Token, "approval:write")
	if err != nil {
		t.Fatalf("VerifyAgentToken() revoked error = %v", err)
	}
	if ok {
		t.Fatal("revoked token still verifies")
	}
}

func TestSQLiteStoreCreatesDefaultOrganizationProjectAndMembership(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	membership, err := store.DefaultOrganizationForUser(defaultUserID)
	if err != nil {
		t.Fatalf("DefaultOrganizationForUser() error = %v", err)
	}
	if membership.OrganizationID != defaultOrganizationID || membership.Role != RoleOwner {
		t.Fatalf("membership = %#v, want default owner", membership)
	}

	projects, err := store.ListProjects(defaultOrganizationID)
	if err != nil {
		t.Fatalf("ListProjects() error = %v", err)
	}
	if len(projects) != 1 || projects[0].ProjectID != defaultProjectID {
		t.Fatalf("projects = %#v, want default project", projects)
	}

	request, err := store.Create(CreateRequest{Title: "Scoped request"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	var organizationID string
	var projectID string
	if err := store.db.QueryRow("SELECT organization_id, project_id FROM approval_requests WHERE id = ?", request.ID).Scan(&organizationID, &projectID); err != nil {
		t.Fatalf("Scan() approval org/project error = %v", err)
	}
	if organizationID != defaultOrganizationID || projectID != defaultProjectID {
		t.Fatalf("approval org/project = %q/%q, want defaults", organizationID, projectID)
	}
}

func TestSQLiteStoreBackfillsExistingSingleUserRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-tick.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	now := time.Now().UTC()
	_, err = db.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL DEFAULT '' UNIQUE,
			name TEXT NOT NULL,
			password_hash TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);
		CREATE TABLE approval_requests (
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
		INSERT INTO users (id, email, name, created_at) VALUES ('usr_default', '', 'Single User', ?);
		INSERT INTO approval_requests (id, user_id, requester_json, title, choices_json, status, created_at)
		VALUES ('req_existing', 'usr_default', '{}', 'Existing', '[]', 'pending', ?);
	`, timeText(&now), timeText(&now))
	if err != nil {
		t.Fatalf("seed old schema error = %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("seed db Close() error = %v", err)
	}

	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("NewSQLiteStore() migration error = %v", err)
	}
	defer store.Close()

	var organizationID string
	var projectID string
	if err := store.db.QueryRow("SELECT organization_id, project_id FROM approval_requests WHERE id = 'req_existing'").Scan(&organizationID, &projectID); err != nil {
		t.Fatalf("Scan() migrated approval error = %v", err)
	}
	if organizationID != defaultOrganizationID || projectID != defaultProjectID {
		t.Fatalf("migrated approval org/project = %q/%q, want defaults", organizationID, projectID)
	}
	if _, err := store.DefaultOrganizationForUser(defaultUserID); err != nil {
		t.Fatalf("DefaultOrganizationForUser() after migration error = %v", err)
	}
}

func TestSQLiteStoreManagesTeamsProjectsMembersAndAudit(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Platform", Description: "Core agents"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	member, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: "usr_reviewer", Role: RoleApprover})
	if err != nil {
		t.Fatalf("UpsertTeamMember() error = %v", err)
	}
	if member.Role != RoleApprover {
		t.Fatalf("member role = %q, want %q", member.Role, RoleApprover)
	}
	role, ok, err := store.OrganizationRoleForUser("usr_reviewer", defaultOrganizationID)
	if err != nil {
		t.Fatalf("OrganizationRoleForUser() error = %v", err)
	}
	if !ok || role != RoleApprover {
		t.Fatalf("role/ok = %q/%v, want approver true", role, ok)
	}

	project, err := store.CreateProject(defaultOrganizationID, CreateProjectRequest{Name: "Website", TeamID: team.TeamID, Description: "Marketing"})
	if err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}
	if project.Slug != "website" || project.TeamID != team.TeamID {
		t.Fatalf("project = %#v, want website on team", project)
	}

	updated, err := store.UpdateProject(defaultOrganizationID, project.ProjectID, UpdateProjectRequest{Name: "Docs Site"})
	if err != nil {
		t.Fatalf("UpdateProject() error = %v", err)
	}
	if updated.Slug != "docs-site" || updated.TeamID != "" {
		t.Fatalf("updated project = %#v, want docs-site without team", updated)
	}

	var auditCount int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM audit_events WHERE event_type IN ('team.created', 'team_member.upserted', 'project.created', 'project.updated')").Scan(&auditCount); err != nil {
		t.Fatalf("Scan() audit count error = %v", err)
	}
	if auditCount != 4 {
		t.Fatalf("audit count = %d, want 4", auditCount)
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
