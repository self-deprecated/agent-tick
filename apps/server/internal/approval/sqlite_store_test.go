package approval

import (
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
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

func TestSQLiteStoreBillingStatusTracksPlanAndUsage(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	if _, err := store.UpsertTeamMember(defaultOrganizationID, "missing", UpsertTeamMemberRequest{UserID: "usr_nope", Role: RoleApprover}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertTeamMember(missing) error = %v, want %v", err, ErrNotFound)
	}
	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Billing"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: "usr_billing", Role: RoleApprover}); err != nil {
		t.Fatalf("UpsertTeamMember() error = %v", err)
	}
	if _, err := store.CreateAgentTokenWithOptions(CreateAgentTokenRequest{Name: "billing-agent"}); err != nil {
		t.Fatalf("CreateAgentTokenWithOptions() error = %v", err)
	}
	if _, err := store.Create(CreateRequest{Title: "Billing approval"}); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	pairing, err := store.CreatePairingToken(time.Minute)
	if err != nil {
		t.Fatalf("CreatePairingToken() error = %v", err)
	}
	device, err := store.PairDevice(pairing.Token, "Phone")
	if err != nil {
		t.Fatalf("PairDevice() error = %v", err)
	}
	if err := store.SetDevicePushToken(device.DeviceID, "ExponentPushToken[billing]"); err != nil {
		t.Fatalf("SetDevicePushToken() error = %v", err)
	}

	status, err := store.BillingStatus(defaultOrganizationID)
	if err != nil {
		t.Fatalf("BillingStatus() error = %v", err)
	}
	if status.Plan != "self-hosted" || status.Limits.Seats != -1 || status.Limits.AuditRetentionDays != 365 {
		t.Fatalf("billing status = %#v, want self-hosted plan and default limits", status)
	}
	if status.Usage.ActiveUsers < 2 || status.Usage.Teams != 1 || status.Usage.ActiveAgents != 1 || status.Usage.ApprovalRequests30d != 1 || status.Usage.PushNotifications30d != 1 || status.Usage.AuditEventsRetained == 0 {
		t.Fatalf("billing usage = %#v, want active users, teams, agents, requests, push tokens, and retained audit events", status.Usage)
	}
	if status.UpgradeURL == "" {
		t.Fatalf("UpgradeURL = empty, want hosted-service upgrade contact")
	}
	retainedDefaultEvents := status.Usage.AuditEventsRetained
	otherOrg, err := store.CreateOrganizationForUser("usr_other_owner", "Other Billing Org")
	if err != nil {
		t.Fatalf("CreateOrganizationForUser(other) error = %v", err)
	}
	statusAfterOtherOrg, err := store.BillingStatus(defaultOrganizationID)
	if err != nil {
		t.Fatalf("BillingStatus(default after other org) error = %v", err)
	}
	if statusAfterOtherOrg.Usage.AuditEventsRetained != retainedDefaultEvents {
		t.Fatalf("default retained audit events = %d after other org events, want %d", statusAfterOtherOrg.Usage.AuditEventsRetained, retainedDefaultEvents)
	}
	otherStatus, err := store.BillingStatus(otherOrg.OrganizationID)
	if err != nil {
		t.Fatalf("BillingStatus(other) error = %v", err)
	}
	if otherStatus.Usage.AuditEventsRetained == 0 {
		t.Fatalf("other retained audit events = 0, want scoped organization audit events")
	}
	if _, err := store.BillingStatus("org_missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("BillingStatus(missing) error = %v, want %v", err, ErrNotFound)
	}
}

func TestSQLiteStoreRunRetentionCleanup(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	now := time.Now().UTC()
	old := now.AddDate(0, 0, -10)
	if _, err := store.db.Exec("UPDATE organizations SET audit_retention_days = 1, approval_retention_days = 1 WHERE id = ?", defaultOrganizationID); err != nil {
		t.Fatalf("update retention error = %v", err)
	}
	if _, err := store.db.Exec("INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)", defaultUserID, tokenHash("expired"), timeText(&old), timeText(&old)); err != nil {
		t.Fatalf("insert expired session error = %v", err)
	}
	if _, err := store.db.Exec("INSERT INTO pairing_tokens (user_id, organization_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", defaultUserID, defaultOrganizationID, tokenHash("expired-pair"), timeText(&old), timeText(&old)); err != nil {
		t.Fatalf("insert expired pairing token error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Old request"})
	if err != nil {
		t.Fatalf("Create(old request) error = %v", err)
	}
	if _, err := store.db.Exec("UPDATE approval_requests SET created_at = ? WHERE id = ?", timeText(&old), request.ID); err != nil {
		t.Fatalf("age request error = %v", err)
	}
	if _, err := store.db.Exec("UPDATE audit_events SET created_at = ? WHERE organization_id = ?", timeText(&old), defaultOrganizationID); err != nil {
		t.Fatalf("age audit events error = %v", err)
	}
	agent, err := store.CreateAgentTokenWithOptions(CreateAgentTokenRequest{Name: "old revoked"})
	if err != nil {
		t.Fatalf("CreateAgentTokenWithOptions() error = %v", err)
	}
	if err := store.RevokeAgentToken(agent.AgentID); err != nil {
		t.Fatalf("RevokeAgentToken() error = %v", err)
	}
	if _, err := store.db.Exec("UPDATE agent_tokens SET revoked_at = ? WHERE id = ?", timeText(&old), agent.AgentID); err != nil {
		t.Fatalf("age revoked token error = %v", err)
	}

	result, err := store.RunRetentionCleanup(now)
	if err != nil {
		t.Fatalf("RunRetentionCleanup() error = %v", err)
	}
	if result.ExpiredSessions != 1 || result.ExpiredPairingCodes != 1 || result.ApprovalRequests != 1 || result.AuditEvents == 0 || result.RevokedAgentTokens != 1 {
		t.Fatalf("cleanup result = %#v, want expired session/pairing/request/audit/revoked token removals", result)
	}
}

func TestSQLiteStoreListsAuditEventsByOrganization(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	defaultTeam, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Default Audit"})
	if err != nil {
		t.Fatalf("CreateTeam(default) error = %v", err)
	}
	otherOrg, err := store.CreateOrganizationForUser("usr_audit_other", "Other Audit")
	if err != nil {
		t.Fatalf("CreateOrganizationForUser(other) error = %v", err)
	}
	if _, err := store.CreateTeam(otherOrg.OrganizationID, CreateTeamRequest{Name: "Other Audit"}); err != nil {
		t.Fatalf("CreateTeam(other) error = %v", err)
	}

	events, err := store.ListAuditEvents(defaultOrganizationID, ListAuditEventsRequest{Limit: 50})
	if err != nil {
		t.Fatalf("ListAuditEvents(default) error = %v", err)
	}
	if len(events) == 0 {
		t.Fatal("default audit events empty, want team.created event")
	}
	for _, event := range events {
		if event.OrganizationID != defaultOrganizationID {
			t.Fatalf("event org = %q, want %q in event %#v", event.OrganizationID, defaultOrganizationID, event)
		}
	}
	filtered, err := store.ListAuditEvents(defaultOrganizationID, ListAuditEventsRequest{EventType: "team.created", Limit: 10})
	if err != nil {
		t.Fatalf("ListAuditEvents(filtered) error = %v", err)
	}
	if len(filtered) == 0 || filtered[0].TargetID != defaultTeam.TeamID {
		t.Fatalf("filtered events = %#v, want default team.created target", filtered)
	}
}

func TestSQLiteStoreEnforcesOrganizationPlanLimits(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	_, err := store.db.Exec(`
		UPDATE organizations
		SET seat_limit = 1, team_limit = 1, agent_limit = 1, request_limit = 1
		WHERE id = ?
	`, defaultOrganizationID)
	if err != nil {
		t.Fatalf("update limits error = %v", err)
	}

	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Allowed"})
	if err != nil {
		t.Fatalf("CreateTeam(first) error = %v", err)
	}
	if _, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Blocked"}); !errors.Is(err, ErrPlanLimitExceeded) {
		t.Fatalf("CreateTeam(second) error = %v, want %v", err, ErrPlanLimitExceeded)
	}

	if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: defaultUserID, Role: RoleOwner}); err != nil {
		t.Fatalf("UpsertTeamMember(existing org member) error = %v", err)
	}
	if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: "usr_new", Role: RoleViewer}); !errors.Is(err, ErrPlanLimitExceeded) {
		t.Fatalf("UpsertTeamMember(new seat) error = %v, want %v", err, ErrPlanLimitExceeded)
	}

	if _, err := store.CreateAgentTokenWithOptions(CreateAgentTokenRequest{Name: "allowed"}); err != nil {
		t.Fatalf("CreateAgentToken(first) error = %v", err)
	}
	if _, err := store.CreateAgentTokenWithOptions(CreateAgentTokenRequest{Name: "blocked"}); !errors.Is(err, ErrPlanLimitExceeded) {
		t.Fatalf("CreateAgentToken(second) error = %v, want %v", err, ErrPlanLimitExceeded)
	}

	if _, err := store.Create(CreateRequest{Title: "Allowed request"}); err != nil {
		t.Fatalf("Create(first) error = %v", err)
	}
	if _, err := store.Create(CreateRequest{Title: "Blocked request"}); !errors.Is(err, ErrPlanLimitExceeded) {
		t.Fatalf("Create(second) error = %v, want %v", err, ErrPlanLimitExceeded)
	}
}

func TestSQLiteStoreApprovalPolicyCRUDValidationAndDefaults(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	if _, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Bad quorum", Template: PolicyTemplateQuorum}); err != ErrInvalidRequest {
		t.Fatalf("CreateApprovalPolicy() error = %v, want %v", err, ErrInvalidRequest)
	}
	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Backend"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{
		Name:     "Backend quorum",
		Template: PolicyTemplateQuorum,
		TeamID:   team.TeamID,
		Settings: map[string]string{"quorum": "2", "denyVeto": "true"},
	})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	if policy.PolicyID == "" || policy.Summary == "" || len(policy.Steps) != 1 {
		t.Fatalf("policy = %#v, want id summary and one step", policy)
	}
	preview, err := store.PreviewApprovalPolicy(defaultOrganizationID, policy.PolicyID)
	if err != nil {
		t.Fatalf("PreviewApprovalPolicy() error = %v", err)
	}
	if len(preview.Notifies) == 0 || preview.Summary == "" {
		t.Fatalf("preview = %#v, want summary and notify targets", preview)
	}

	updated, err := store.UpdateApprovalPolicy(defaultOrganizationID, policy.PolicyID, UpdateApprovalPolicyRequest{Name: "Backend one", Template: PolicyTemplateAnyTeamMember, TeamID: team.TeamID})
	if err != nil {
		t.Fatalf("UpdateApprovalPolicy() error = %v", err)
	}
	if updated.Template != PolicyTemplateAnyTeamMember {
		t.Fatalf("updated template = %q, want any-team-member", updated.Template)
	}

	project, err := store.CreateProject(defaultOrganizationID, CreateProjectRequest{Name: "API", DefaultPolicyID: policy.PolicyID})
	if err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}
	resolved, err := store.ResolveApprovalPolicy(defaultOrganizationID, project.ProjectID, "")
	if err != nil {
		t.Fatalf("ResolveApprovalPolicy() error = %v", err)
	}
	if resolved != policy.PolicyID {
		t.Fatalf("resolved = %q, want %q", resolved, policy.PolicyID)
	}

	if err := store.DeleteApprovalPolicy(defaultOrganizationID, policy.PolicyID); err != nil {
		t.Fatalf("DeleteApprovalPolicy() error = %v", err)
	}
	if _, err := store.GetApprovalPolicy(defaultOrganizationID, policy.PolicyID); err != ErrNotFound {
		t.Fatalf("GetApprovalPolicy() after delete error = %v, want %v", err, ErrNotFound)
	}
}

func TestSQLiteStorePresenceRecentlyActiveAndOnCallRouting(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Coverage"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	sessionA, err := store.LoginOrCreateUser("a@example.com", "secret", "Alice", time.Hour)
	if err != nil {
		t.Fatalf("LoginOrCreateUser(a) error = %v", err)
	}
	sessionB, err := store.LoginOrCreateUser("b@example.com", "secret", "Bob", time.Hour)
	if err != nil {
		t.Fatalf("LoginOrCreateUser(b) error = %v", err)
	}
	for _, userID := range []string{sessionA.UserID, sessionB.UserID} {
		if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: userID, Role: RoleApprover}); err != nil {
			t.Fatalf("UpsertTeamMember(%s) error = %v", userID, err)
		}
	}
	if _, err := store.SetAvailability(sessionA.UserID, AvailabilityRequest{State: AvailabilityBusy}); err != nil {
		t.Fatalf("SetAvailability() error = %v", err)
	}
	if _, err := store.RecordHeartbeat(sessionA.UserID, "", "mobile"); err != nil {
		t.Fatalf("RecordHeartbeat(a) error = %v", err)
	}
	if _, err := store.RecordHeartbeat(sessionB.UserID, "", "mobile"); err != nil {
		t.Fatalf("RecordHeartbeat(b) error = %v", err)
	}

	recentPolicy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Recent", Template: PolicyTemplateRecentlyActive, TeamID: team.TeamID})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy(recent) error = %v", err)
	}
	recentRequest, err := store.Create(CreateRequest{Title: "Route recent", Metadata: map[string]string{"effectiveApprovalPolicy": recentPolicy.PolicyID}})
	if err != nil {
		t.Fatalf("Create(recent) error = %v", err)
	}
	recentProgress, err := store.PolicyProgressForRequest(recentRequest.ID, sessionB.UserID)
	if err != nil {
		t.Fatalf("PolicyProgressForRequest(recent) error = %v", err)
	}
	if recentProgress == nil || len(recentProgress.EligibleApproverIDs) != 1 || recentProgress.EligibleApproverIDs[0] != sessionB.UserID || !recentProgress.CurrentUserEligible {
		t.Fatalf("recent progress = %#v, want Bob as the recently active available approver", recentProgress)
	}

	if _, err := store.UpsertOnCallSchedule(defaultOrganizationID, team.TeamID, UpsertOnCallScheduleRequest{PrimaryUserID: sessionA.UserID, SecondaryUserID: sessionB.UserID}); err != nil {
		t.Fatalf("UpsertOnCallSchedule() error = %v", err)
	}
	onCallPolicy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "On-call", Template: PolicyTemplateOnCall, TeamID: team.TeamID, Settings: map[string]string{"timeoutSeconds": "1", "escalationTarget": sessionB.UserID}})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy(on-call) error = %v", err)
	}
	onCallRequest, err := store.Create(CreateRequest{Title: "Route on-call", Metadata: map[string]string{"effectiveApprovalPolicy": onCallPolicy.PolicyID}})
	if err != nil {
		t.Fatalf("Create(on-call) error = %v", err)
	}
	past := time.Now().UTC().Add(-2 * time.Minute)
	if _, err := store.db.Exec("UPDATE approval_requests SET created_at = ? WHERE id = ?", timeText(&past), onCallRequest.ID); err != nil {
		t.Fatalf("backdate request error = %v", err)
	}
	onCallProgress, err := store.PolicyProgressForRequest(onCallRequest.ID, sessionB.UserID)
	if err != nil {
		t.Fatalf("PolicyProgressForRequest(on-call) error = %v", err)
	}
	if onCallProgress == nil || len(onCallProgress.EligibleApproverIDs) != 1 || onCallProgress.EligibleApproverIDs[0] != sessionB.UserID {
		t.Fatalf("on-call progress = %#v, want secondary after timeout", onCallProgress)
	}
	coverage, err := store.GetTeamCoverage(defaultOrganizationID, team.TeamID)
	if err != nil {
		t.Fatalf("GetTeamCoverage() error = %v", err)
	}
	if coverage.SecondaryUserID != sessionB.UserID || coverage.SelectedApproverID != sessionB.UserID {
		t.Fatalf("coverage = %#v, want secondary selected because primary is busy", coverage)
	}
}

func TestSQLiteStorePolicyQuorumVoteFlow(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Backend"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	for _, userID := range []string{"usr_a", "usr_b"} {
		if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: userID, Role: RoleApprover}); err != nil {
			t.Fatalf("UpsertTeamMember(%s) error = %v", userID, err)
		}
	}
	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Two approvers", Template: PolicyTemplateQuorum, TeamID: team.TeamID, Settings: map[string]string{"quorum": "2"}})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Deploy?", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := store.RespondForUserWithAuth(authContext{UserID: "usr_intruder", OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("ineligible vote error = %v, want %v", err, ErrInvalidRequest)
	}

	first, err := store.RespondForUserWithAuth(authContext{UserID: "usr_a", OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"})
	if err != nil {
		t.Fatalf("first RespondForUserWithAuth() error = %v", err)
	}
	if first.Status != StatusPending || first.Response != nil || first.PolicyProgress == nil || first.PolicyProgress.WaitingFor != 1 {
		t.Fatalf("first response = %#v progress %#v, want pending waiting for one", first, first.PolicyProgress)
	}
	if _, err := store.RespondForUserWithAuth(authContext{UserID: "usr_a", OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"}); err != ErrAlreadyResponded {
		t.Fatalf("duplicate vote error = %v, want %v", err, ErrAlreadyResponded)
	}

	final, err := store.RespondForUserWithAuth(authContext{UserID: "usr_b", OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"})
	if err != nil {
		t.Fatalf("final RespondForUserWithAuth() error = %v", err)
	}
	if final.Status != StatusResponded || final.Response == nil || final.Response.ChoiceID != "approve" {
		t.Fatalf("final response = %#v, want approved responded", final)
	}
	if final.PolicyProgress == nil || final.PolicyProgress.State != "approved" || final.PolicyProgress.ReceivedApprovals != 2 {
		t.Fatalf("final progress = %#v, want approved with two votes", final.PolicyProgress)
	}
	if _, err := store.RespondForUserWithAuth(authContext{UserID: "usr_a", OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"}); !errors.Is(err, ErrAlreadyResponded) {
		t.Fatalf("post-final vote error = %v, want %v", err, ErrAlreadyResponded)
	}
}

func TestSQLiteStorePolicyProgressIsOrganizationScoped(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	otherOrg, err := store.CreateOrganizationForUser("usr_other", "Other Org")
	if err != nil {
		t.Fatalf("CreateOrganizationForUser() error = %v", err)
	}
	foreignPolicy, err := store.CreateApprovalPolicy(otherOrg.OrganizationID, CreateApprovalPolicyRequest{Name: "Foreign", Template: PolicyTemplateOwnerOnly})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy(foreign) error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Spoofed policy", Metadata: map[string]string{"effectiveApprovalPolicy": foreignPolicy.PolicyID}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	progress, err := store.PolicyProgressForRequest(request.ID, defaultUserID)
	if err != nil {
		t.Fatalf("PolicyProgressForRequest() error = %v", err)
	}
	if progress != nil {
		t.Fatalf("progress = %#v, want nil for cross-organization policy metadata", progress)
	}
}

func TestSQLiteStorePolicyApprovalCoercesFinalChoice(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Owner", Template: PolicyTemplateOwnerOnly})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	request, err := store.Create(CreateRequest{
		Title: "Custom approval",
		Choices: []Choice{
			{ID: "lgtm", Label: "Looks good", Kind: "custom"},
			{ID: "deny", Label: "Deny", Kind: "deny"},
		},
		Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	final, err := store.RespondForUserWithAuth(authContext{UserID: defaultUserID, OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "lgtm"})
	if err != nil {
		t.Fatalf("RespondForUserWithAuth() error = %v", err)
	}
	if final.Status != StatusResponded || final.Response == nil || final.Response.ChoiceID != "approve" {
		t.Fatalf("final = %#v, want approved policy response coerced to approve", final)
	}
}

func TestSQLiteStorePolicyDenyCoercesFinalChoice(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Owner", Template: PolicyTemplateOwnerOnly})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	request, err := store.Create(CreateRequest{
		Title: "Custom deny",
		Choices: []Choice{
			{ID: "approve", Label: "Approve", Kind: "approve"},
			{ID: "Deny", Label: "Escalate denial", Kind: "deny"},
		},
		Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	final, err := store.RespondForUserWithAuth(authContext{UserID: defaultUserID, OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "Deny"})
	if err != nil {
		t.Fatalf("RespondForUserWithAuth() error = %v", err)
	}
	if final.Status != StatusResponded || final.Response == nil || final.Response.ChoiceID != "deny" {
		t.Fatalf("final = %#v, want denied policy response coerced to deny", final)
	}
}

func TestSQLiteStorePolicyDenyVetoAndSequence(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	teamOne, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "One"})
	if err != nil {
		t.Fatalf("CreateTeam(one) error = %v", err)
	}
	teamTwo, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Two"})
	if err != nil {
		t.Fatalf("CreateTeam(two) error = %v", err)
	}
	_, _ = store.UpsertTeamMember(defaultOrganizationID, teamOne.TeamID, UpsertTeamMemberRequest{UserID: "usr_one", Role: RoleApprover})
	_, _ = store.UpsertTeamMember(defaultOrganizationID, teamTwo.TeamID, UpsertTeamMemberRequest{UserID: "usr_two", Role: RoleApprover})

	denyPolicy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Deny veto", Template: PolicyTemplateQuorum, TeamID: teamOne.TeamID, Settings: map[string]string{"quorum": "2", "denyVeto": "true"}})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy(deny) error = %v", err)
	}
	denyRequest, err := store.Create(CreateRequest{Title: "Danger", Metadata: map[string]string{"effectiveApprovalPolicy": denyPolicy.PolicyID}})
	if err != nil {
		t.Fatalf("Create(deny) error = %v", err)
	}
	denied, err := store.RespondForUserWithAuth(authContext{UserID: "usr_one", OrganizationID: defaultOrganizationID, Source: authSourceSession}, denyRequest.ID, Response{ChoiceID: "deny"})
	if err != nil {
		t.Fatalf("deny vote error = %v", err)
	}
	if denied.Status != StatusResponded || denied.Response == nil || denied.Response.ChoiceID != "deny" || denied.PolicyProgress.State != "denied" {
		t.Fatalf("denied = %#v progress %#v, want final denied", denied, denied.PolicyProgress)
	}

	sequencePolicy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{
		Name:     "Two-step",
		Template: PolicyTemplateSequence,
		Steps: []ApprovalPolicyStep{
			{Position: 1, StepType: PolicyTemplateAnyTeamMember, TeamID: teamOne.TeamID, Quorum: 1, DenyVeto: true},
			{Position: 2, StepType: PolicyTemplateAnyTeamMember, TeamID: teamTwo.TeamID, Quorum: 1, DenyVeto: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy(sequence) error = %v", err)
	}
	sequenceRequest, err := store.Create(CreateRequest{Title: "Ship", Metadata: map[string]string{"effectiveApprovalPolicy": sequencePolicy.PolicyID}})
	if err != nil {
		t.Fatalf("Create(sequence) error = %v", err)
	}
	advanced, err := store.RespondForUserWithAuth(authContext{UserID: "usr_one", OrganizationID: defaultOrganizationID, Source: authSourceSession}, sequenceRequest.ID, Response{ChoiceID: "approve"})
	if err != nil {
		t.Fatalf("sequence first vote error = %v", err)
	}
	if advanced.Status != StatusPending || advanced.PolicyProgress == nil || advanced.PolicyProgress.CurrentStep != 2 {
		t.Fatalf("advanced progress = %#v status %s, want step 2 pending", advanced.PolicyProgress, advanced.Status)
	}
	complete, err := store.RespondForUserWithAuth(authContext{UserID: "usr_two", OrganizationID: defaultOrganizationID, Source: authSourceSession}, sequenceRequest.ID, Response{ChoiceID: "approve"})
	if err != nil {
		t.Fatalf("sequence second vote error = %v", err)
	}
	if complete.Status != StatusResponded || complete.PolicyProgress == nil || complete.PolicyProgress.State != "approved" {
		t.Fatalf("complete = %#v progress %#v, want approved", complete, complete.PolicyProgress)
	}
}

func TestSQLiteStorePolicyProgressTracksExpiredAndAbandoned(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Owner", Template: PolicyTemplateOwnerOnly})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	expiredAt := time.Now().UTC().Add(-time.Minute)
	expiredRequest, err := store.Create(CreateRequest{Title: "Expired", ExpiresAt: &expiredAt, Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})
	if err != nil {
		t.Fatalf("Create(expired) error = %v", err)
	}
	if _, err := store.Get(expiredRequest.ID); err != nil {
		t.Fatalf("Get(expired) error = %v", err)
	}
	expiredProgress, err := store.PolicyProgressForRequest(expiredRequest.ID, defaultUserID)
	if err != nil {
		t.Fatalf("PolicyProgressForRequest(expired) error = %v", err)
	}
	if expiredProgress == nil || expiredProgress.State != StatusExpired {
		t.Fatalf("expired progress = %#v, want expired state", expiredProgress)
	}

	abandonedRequest, err := store.Create(CreateRequest{Title: "Abandoned", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})
	if err != nil {
		t.Fatalf("Create(abandoned) error = %v", err)
	}
	if _, changed, err := store.Abandon(abandonedRequest.ID); err != nil || !changed {
		t.Fatalf("Abandon() changed=%v error=%v, want changed", changed, err)
	}
	abandonedProgress, err := store.PolicyProgressForRequest(abandonedRequest.ID, defaultUserID)
	if err != nil {
		t.Fatalf("PolicyProgressForRequest(abandoned) error = %v", err)
	}
	if abandonedProgress == nil || abandonedProgress.State != StatusAbandoned {
		t.Fatalf("abandoned progress = %#v, want abandoned state", abandonedProgress)
	}
}

func TestSQLiteStorePolicyQuorumRaceStopsAfterFinalDecision(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Single quorum"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	for _, userID := range []string{"usr_a", "usr_b"} {
		if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: userID, Role: RoleApprover}); err != nil {
			t.Fatalf("UpsertTeamMember(%s) error = %v", userID, err)
		}
	}
	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "One wins", Template: PolicyTemplateAnyTeamMember, TeamID: team.TeamID})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Race one", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, userID := range []string{"usr_a", "usr_b"} {
		wg.Add(1)
		go func(userID string) {
			defer wg.Done()
			_, err := store.RespondForUserWithAuth(authContext{UserID: userID, OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"})
			errs <- err
		}(userID)
	}
	wg.Wait()
	close(errs)
	successes := 0
	alreadyResponded := 0
	for err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrAlreadyResponded):
			alreadyResponded++
		default:
			t.Fatalf("concurrent quorum-one vote error = %v", err)
		}
	}
	if successes != 1 || alreadyResponded != 1 {
		t.Fatalf("successes=%d alreadyResponded=%d, want one final decision and one conflict", successes, alreadyResponded)
	}
	progress, err := store.PolicyProgressForRequest(request.ID, "usr_a")
	if err != nil {
		t.Fatalf("PolicyProgressForRequest() error = %v", err)
	}
	if progress == nil || len(progress.Votes) != 1 || progress.State != "approved" {
		t.Fatalf("progress = %#v, want one recorded vote and approved final state", progress)
	}
}

func TestSQLiteStorePolicyConcurrentDuplicateVoteFromSameUser(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Duplicate"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	for _, userID := range []string{"usr_a", "usr_b"} {
		if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: userID, Role: RoleApprover}); err != nil {
			t.Fatalf("UpsertTeamMember(%s) error = %v", userID, err)
		}
	}
	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Two needed", Template: PolicyTemplateQuorum, TeamID: team.TeamID, Settings: map[string]string{"quorum": "2"}})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Duplicate", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.RespondForUserWithAuth(authContext{UserID: "usr_a", OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	successes := 0
	duplicates := 0
	for err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrAlreadyResponded):
			duplicates++
		default:
			t.Fatalf("duplicate concurrent vote error = %v", err)
		}
	}
	if successes != 1 || duplicates != 1 {
		t.Fatalf("successes=%d duplicates=%d, want one recorded vote and one duplicate", successes, duplicates)
	}
	progress, err := store.PolicyProgressForRequest(request.ID, "usr_a")
	if err != nil {
		t.Fatalf("PolicyProgressForRequest() error = %v", err)
	}
	if progress == nil || len(progress.Votes) != 1 || progress.WaitingFor != 1 {
		t.Fatalf("progress = %#v, want one vote waiting for one more", progress)
	}
}

func TestSQLiteStorePolicyQuorumConcurrentVotes(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	team, err := store.CreateTeam(defaultOrganizationID, CreateTeamRequest{Name: "Race"})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	for _, userID := range []string{"usr_a", "usr_b"} {
		if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: userID, Role: RoleApprover}); err != nil {
			t.Fatalf("UpsertTeamMember(%s) error = %v", userID, err)
		}
	}
	policy, err := store.CreateApprovalPolicy(defaultOrganizationID, CreateApprovalPolicyRequest{Name: "Race quorum", Template: PolicyTemplateQuorum, TeamID: team.TeamID, Settings: map[string]string{"quorum": "2"}})
	if err != nil {
		t.Fatalf("CreateApprovalPolicy() error = %v", err)
	}
	request, err := store.Create(CreateRequest{Title: "Race", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, userID := range []string{"usr_a", "usr_b"} {
		wg.Add(1)
		go func(userID string) {
			defer wg.Done()
			_, err := store.RespondForUserWithAuth(authContext{UserID: userID, OrganizationID: defaultOrganizationID, Source: authSourceSession}, request.ID, Response{ChoiceID: "approve"})
			errs <- err
		}(userID)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent vote error = %v", err)
		}
	}
	final, err := store.Get(request.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if final.Status != StatusResponded || final.Response == nil || final.Response.ChoiceID != "approve" {
		t.Fatalf("final = %#v, want approved response", final)
	}
	progress, err := store.PolicyProgressForRequest(request.ID, "usr_a")
	if err != nil {
		t.Fatalf("PolicyProgressForRequest() error = %v", err)
	}
	if progress == nil || len(progress.Votes) != 2 || progress.State != "approved" {
		t.Fatalf("progress = %#v, want two approved votes", progress)
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
