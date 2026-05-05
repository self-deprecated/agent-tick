package approval

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAdminServesEmbeddedSvelteApp(t *testing.T) {
	api := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	)
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	api.SetPublicURL("https://tick.example")
	handler := api.Handler()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}
	body := rec.Body.String()
	if strings.Contains(body, "__MODE__") || !strings.Contains(body, `mode: "user"`) {
		t.Fatalf("admin mode config not rendered in body: %s", body)
	}
	if strings.Contains(body, "__PUBLIC_URL__") || !strings.Contains(body, `publicURL: "https://tick.example"`) {
		t.Fatalf("admin public URL config not rendered in body: %s", body)
	}

	assetPath, ok := embeddedAdminAssetPath(body)
	if !ok {
		t.Fatalf("admin asset path not found in body: %s", body)
	}
	assetReq := httptest.NewRequest(http.MethodGet, assetPath, nil)
	assetReq.RemoteAddr = "192.0.2.10:1234"
	assetRec := httptest.NewRecorder()
	handler.ServeHTTP(assetRec, assetReq)
	if assetRec.Code != http.StatusOK {
		t.Fatalf("admin asset status = %d body = %s, want %d", assetRec.Code, assetRec.Body.String(), http.StatusOK)
	}
	if assetRec.Body.Len() == 0 {
		t.Fatal("admin asset response is empty")
	}
}

func embeddedAdminAssetPath(body string) (string, bool) {
	marker := `src="/assets/`
	start := strings.Index(body, marker)
	if start == -1 {
		return "", false
	}
	start += len(`src="`)
	end := strings.Index(body[start:], `"`)
	if end == -1 {
		return "", false
	}
	return body[start : start+end], true
}

func TestAPICreateListRespond(t *testing.T) {
	handler := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	).Handler()

	created := request[ApprovalRequest](
		t,
		handler,
		http.MethodPost,
		"/v1/approval-requests",
		CreateRequest{Title: "Run command?", AllowFreeformReply: true},
	)
	if created.ID == "" {
		t.Fatal("created request has empty ID")
	}

	pending := request[[]ApprovalRequest](
		t,
		handler,
		http.MethodGet,
		"/v1/approval-requests?status=pending",
		nil,
	)
	if len(pending) != 1 {
		t.Fatalf("pending length = %d, want 1", len(pending))
	}

	responded := request[ApprovalRequest](
		t,
		handler,
		http.MethodPost,
		"/v1/approval-requests/"+created.ID+"/responses",
		Response{ChoiceID: "deny", Message: "not now"},
	)
	if responded.Response == nil || responded.Response.Message != "not now" {
		t.Fatalf("response = %#v, want message", responded.Response)
	}
}

func TestAPIRejectsResponseMessageWhenFreeformDisabled(t *testing.T) {
	handler := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	).Handler()

	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Run command?"})
	body, err := json.Marshal(Response{ChoiceID: "approve", Message: "typed reply"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusBadRequest)
	}
}

func TestAPISteerRequestOnlyAcceptsChoiceIDs(t *testing.T) {
	handler := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	).Handler()

	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{
		RequestType: RequestTypeSteer,
		Title:       "Choose next step",
		Choices:     []Choice{{ID: "run-tests", Label: "Run tests"}},
	})
	if created.DefaultChoice != SteerNoneChoiceID || !hasChoiceID(created.Choices, SteerNoneChoiceID) {
		t.Fatalf("created choices/default = %#v/%q, want built-in none", created.Choices, created.DefaultChoice)
	}

	badBody, err := json.Marshal(Response{ChoiceID: "run-tests", Message: "typed reply"})
	if err != nil {
		t.Fatalf("Marshal(bad) error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", bytes.NewReader(badBody))
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("message status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusBadRequest)
	}

	responded := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: SteerNoneChoiceID})
	if responded.Response == nil || responded.Response.ChoiceID != SteerNoneChoiceID {
		t.Fatalf("response = %#v, want none", responded.Response)
	}
}

func TestAPIAbandonPendingRequest(t *testing.T) {
	handler := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	).Handler()

	created := request[ApprovalRequest](
		t,
		handler,
		http.MethodPost,
		"/v1/approval-requests",
		CreateRequest{Title: "Run command?"},
	)

	abandoned := request[ApprovalRequest](
		t,
		handler,
		http.MethodPost,
		"/v1/approval-requests/"+created.ID+"/abandon",
		nil,
	)
	if abandoned.Status != StatusAbandoned || abandoned.Response != nil {
		t.Fatalf("abandoned = %#v, want abandoned without response", abandoned)
	}

	pending := request[[]ApprovalRequest](
		t,
		handler,
		http.MethodGet,
		"/v1/approval-requests?status=pending",
		nil,
	)
	if len(pending) != 0 {
		t.Fatalf("pending length = %d, want 0", len(pending))
	}
}

func TestAPIRejectsSessionAbandon(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()
	auth := loginAuth(t, handler, "abandon@example.com")

	created := requestWithSession[ApprovalRequest](t, handler, auth, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Run command?"})
	rec := statusWithSession(t, handler, auth, http.MethodPost, "/v1/approval-requests/"+created.ID+"/abandon", nil, auth.csrf.Value)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusForbidden)
	}

	current, err := store.GetForUser(created.UserID, created.ID)
	if err != nil {
		t.Fatalf("GetForUser() error = %v", err)
	}
	if current.Status != StatusPending {
		t.Fatalf("Status = %q, want %q", current.Status, StatusPending)
	}
}

func TestAPIRejectsDeviceAbandon(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Run command?"})
	pairing := request[PairingToken](t, handler, http.MethodPost, "/v1/pairing-tokens", map[string]string{})
	device := requestWithoutAuth[DeviceCredential](t, handler, http.MethodPost, "/v1/devices/pair", PairDeviceRequest{Token: pairing.Token, DeviceName: "Phone"})

	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests/"+created.ID+"/abandon", nil)
	req.Header.Set("Authorization", "Bearer "+device.Token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusForbidden)
	}
	current, err := store.Get(created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if current.Status != StatusPending {
		t.Fatalf("Status = %q, want %q", current.Status, StatusPending)
	}
}

func TestAPIAbandonAlreadyRespondedRequestReturnsResponse(t *testing.T) {
	handler := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	).Handler()

	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Run command?", AllowFreeformReply: true})
	responded := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "deny", Message: "no"})
	abandoned := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests/"+created.ID+"/abandon", nil)

	if abandoned.Status != StatusResponded || abandoned.Response == nil || abandoned.Response.ChoiceID != "deny" {
		t.Fatalf("abandoned = %#v, want existing response", abandoned)
	}
	if abandoned.RespondedAt == nil || !abandoned.RespondedAt.Equal(*responded.RespondedAt) {
		t.Fatalf("RespondedAt = %v, want %v", abandoned.RespondedAt, responded.RespondedAt)
	}
}

func TestAPIQuestionnaireRespond(t *testing.T) {
	handler := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	).Handler()

	created := request[ApprovalRequest](
		t,
		handler,
		http.MethodPost,
		"/v1/approval-requests",
		CreateRequest{
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
					},
				},
			},
		},
	)
	if created.RequestType != RequestTypeQuestionnaire {
		t.Fatalf("RequestType = %q, want %q", created.RequestType, RequestTypeQuestionnaire)
	}

	responded := request[ApprovalRequest](
		t,
		handler,
		http.MethodPost,
		"/v1/approval-requests/"+created.ID+"/responses",
		Response{
			Answers: map[string][]string{
				"Which environment?":       []string{"prod"},
				"Which checks should run?": []string{"lint", "test"},
			},
		},
	)
	if responded.Response == nil || responded.Response.Answers["Which environment?"][0] != "prod" {
		t.Fatalf("response = %#v, want questionnaire answers", responded.Response)
	}
}

func TestAPIAbandonPublishesOnlyOnTransition(t *testing.T) {
	api := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	)
	events := &recordingEventBus{}
	api.events = events
	handler := api.Handler()

	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Run command?"})
	_ = request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests/"+created.ID+"/abandon", nil)
	events.assertEvents(
		t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.abandoned", RequestID: created.ID},
	)

	_ = request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests/"+created.ID+"/abandon", nil)
	events.assertEvents(
		t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.abandoned", RequestID: created.ID},
	)
}

func TestAPIEventsPublishOnRespondNotGet(t *testing.T) {
	api := NewAPI(
		NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")),
		"test-token",
	)
	events := &recordingEventBus{}
	api.events = events
	handler := api.Handler()

	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Run command?"})
	events.assertEvents(t, Event{Type: "approval.created", RequestID: created.ID})

	_ = request[ApprovalRequest](t, handler, http.MethodGet, "/v1/approval-requests/"+created.ID, nil)
	events.assertEvents(t, Event{Type: "approval.created", RequestID: created.ID})

	_ = request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	events.assertEvents(
		t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.responded", RequestID: created.ID},
	)
}

func TestAPIRequiresAuthForRemoteRequests(t *testing.T) {
	handler := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token").Handler()
	req := httptest.NewRequest(http.MethodGet, "/v1/approval-requests", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAPIDashboardBundleHandlesDynamicChoiceButtons(t *testing.T) {
	handler := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token").Handler()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assetPath, ok := embeddedAdminAssetPath(rec.Body.String())
	if !ok {
		t.Fatalf("admin asset path not found in body: %s", rec.Body.String())
	}
	assetReq := httptest.NewRequest(http.MethodGet, assetPath, nil)
	assetRec := httptest.NewRecorder()
	handler.ServeHTTP(assetRec, assetReq)
	if assetRec.Code != http.StatusOK {
		t.Fatalf("admin asset status = %d body = %s, want %d", assetRec.Code, assetRec.Body.String(), http.StatusOK)
	}

	bundle := assetRec.Body.String()
	for _, snippet := range []string{"choices", "choiceId", "responses"} {
		if !strings.Contains(bundle, snippet) {
			t.Fatalf("dashboard bundle missing %q", snippet)
		}
	}
}

func TestAPIServesDashboardWithoutAuth(t *testing.T) {
	handler := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token").Handler()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestAPIDashboardUsesPublicURL(t *testing.T) {
	api := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token")
	api.SetPublicURL("http://192.0.2.10:8787")
	handler := api.Handler()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !strings.Contains(rec.Body.String(), `publicURL: "http://192.0.2.10:8787"`) {
		t.Fatalf("dashboard did not render public URL: %s", rec.Body.String())
	}
}

func TestAPIRejectsInvalidMode(t *testing.T) {
	api := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token")

	if err := api.SetMode("workspace"); err == nil {
		t.Fatal("SetMode() error = nil, want error")
	}
}

func TestAPIUserModeLoginScopesDashboardRequests(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(LoginRequest{Email: "jane@example.com", Password: "secret"}); err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	loginReq := httptest.NewRequest(http.MethodPost, "/v1/session", &body)
	loginRec := httptest.NewRecorder()
	handler.ServeHTTP(loginRec, loginReq)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d body = %s, want %d", loginRec.Code, loginRec.Body.String(), http.StatusOK)
	}
	var session SessionCredential
	if err := json.NewDecoder(loginRec.Body).Decode(&session); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if session.UserID == "" || session.Token != "" {
		t.Fatalf("session = %#v, want user without response token", session)
	}
	cookies := loginRec.Result().Cookies()
	sessionCookie := findCookie(cookies, sessionCookieName)
	csrfCookie := findCookie(cookies, csrfCookieName)
	if sessionCookie == nil || csrfCookie == nil || csrfCookie.HttpOnly {
		t.Fatalf("cookies = %#v, want session and readable CSRF cookies", cookies)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/devices", nil)
	req.AddCookie(sessionCookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/session", nil)
	req.AddCookie(sessionCookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("session status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}
}

func TestAPIUserModeLoginMarksSessionCookieSecureBehindHTTPS(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(LoginRequest{Email: "secure@example.com", Password: "secret"}); err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/session", &body)
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}

	cookies := rec.Result().Cookies()
	sessionCookie := findCookie(cookies, sessionCookieName)
	csrfCookie := findCookie(cookies, csrfCookieName)
	if sessionCookie == nil || csrfCookie == nil || !sessionCookie.Secure || !csrfCookie.Secure {
		t.Fatalf("cookies = %#v, want secure session cookie", cookies)
	}
}

func TestAPICookieAuthenticatedWritesRequireCSRF(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()
	auth := loginAuth(t, handler, "csrf@example.com")

	rec := statusWithSession(t, handler, auth, http.MethodPost, "/v1/pairing-tokens", map[string]string{}, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusForbidden)
	}

	rec = statusWithSession(t, handler, auth, http.MethodPost, "/v1/pairing-tokens", map[string]string{}, "wrong")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("invalid CSRF status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusForbidden)
	}

	rec = statusWithSession(t, handler, auth, http.MethodPost, "/v1/pairing-tokens", map[string]string{}, auth.csrf.Value)
	if rec.Code != http.StatusCreated {
		t.Fatalf("valid CSRF status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusCreated)
	}
}

func TestAPIUserModeCannotRevokeOtherUsersDevicesOrAgentTokens(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	aliceAuth := loginAuth(t, handler, "alice@example.com")
	bobAuth := loginAuth(t, handler, "bob@example.com")

	pairing := requestWithSession[PairingToken](t, handler, aliceAuth, http.MethodPost, "/v1/pairing-tokens", map[string]string{})
	device := requestWithoutAuth[DeviceCredential](t, handler, http.MethodPost, "/v1/devices/pair", PairDeviceRequest{Token: pairing.Token, DeviceName: "Alice Phone"})
	agent := requestWithSession[AgentCredential](t, handler, aliceAuth, http.MethodPost, "/v1/agent-tokens", CreateAgentTokenRequest{Name: "alice-agent"})

	rec := statusWithSession(t, handler, bobAuth, http.MethodPost, "/v1/devices/"+device.DeviceID+"/unpair", nil, bobAuth.csrf.Value)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unpair status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusNotFound)
	}
	ok, err := store.VerifyDeviceToken(device.Token)
	if err != nil {
		t.Fatalf("VerifyDeviceToken() error = %v", err)
	}
	if !ok {
		t.Fatal("other user's device token was revoked")
	}

	rec = statusWithSession(t, handler, bobAuth, http.MethodPost, "/v1/agent-tokens/"+agent.AgentID+"/revoke", nil, bobAuth.csrf.Value)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("revoke status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusNotFound)
	}
	ok, err = store.VerifyAgentToken(agent.Token, "approval:write")
	if err != nil {
		t.Fatalf("VerifyAgentToken() error = %v", err)
	}
	if !ok {
		t.Fatal("other user's agent token was revoked")
	}
}

func TestAPIPairsDeviceToken(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	pairing := request[PairingToken](
		t,
		handler,
		http.MethodPost,
		"/v1/pairing-tokens",
		map[string]string{},
	)
	if pairing.Token == "" {
		t.Fatal("pairing token is empty")
	}
	if !strings.HasPrefix(pairing.QRDataURL, "data:image/png;base64,") {
		t.Fatalf("pairing QR data URL = %q, want PNG data URL", pairing.QRDataURL)
	}

	credential := requestWithoutAuth[DeviceCredential](
		t,
		handler,
		http.MethodPost,
		"/v1/devices/pair",
		PairDeviceRequest{Token: pairing.Token, DeviceName: "iPhone"},
	)
	if credential.Token == "" {
		t.Fatal("device token is empty")
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/approval-requests", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}

	userID, ok, err := store.UserIDForDeviceToken(credential.Token)
	if err != nil {
		t.Fatalf("UserIDForDeviceToken() error = %v", err)
	}
	if !ok || userID != defaultUserID {
		t.Fatalf("device user = %q, %v, want %q, true", userID, ok, defaultUserID)
	}
}

func TestAPICreateReturnsBeforePushDeliveryCompletes(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	pairing, err := store.CreatePairingToken(time.Minute)
	if err != nil {
		t.Fatalf("CreatePairingToken() error = %v", err)
	}
	device, err := store.PairDevice(pairing.Token, "Phone")
	if err != nil {
		t.Fatalf("PairDevice() error = %v", err)
	}
	if err := store.SetDevicePushToken(device.DeviceID, "ExponentPushToken[test]"); err != nil {
		t.Fatalf("SetDevicePushToken() error = %v", err)
	}

	pushStarted := make(chan struct{})
	releasePush := make(chan struct{})
	pushServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(pushStarted)
		<-releasePush
		writeJSON(w, http.StatusOK, expoPushResponse{Data: []expoPushTicket{{Status: "ok"}}})
	}))
	defer pushServer.Close()
	defer close(releasePush)

	api := NewAPI(store, "test-token")
	api.push = &PushSender{client: pushServer.Client(), url: pushServer.URL}
	handler := api.Handler()

	body, err := json.Marshal(CreateRequest{Title: "Run command?"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		done <- rec
	}()

	select {
	case rec := <-done:
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusCreated)
		}
	case <-pushStarted:
		select {
		case rec := <-done:
			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusCreated)
			}
		case <-time.After(200 * time.Millisecond):
			t.Fatal("create response blocked on push delivery")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for create response or push attempt")
	}
}

func TestAPIPairingTokenIsSingleUse(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	pairing := request[PairingToken](
		t,
		handler,
		http.MethodPost,
		"/v1/pairing-tokens",
		map[string]string{},
	)
	_ = requestWithoutAuth[DeviceCredential](
		t,
		handler,
		http.MethodPost,
		"/v1/devices/pair",
		PairDeviceRequest{Token: pairing.Token, DeviceName: "iPhone"},
	)

	reqBody, err := json.Marshal(PairDeviceRequest{Token: pairing.Token, DeviceName: "iPad"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/devices/pair", bytes.NewReader(reqBody))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusUnauthorized)
	}
}

func TestAPIListsPairedDevices(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	pairing := request[PairingToken](
		t,
		handler,
		http.MethodPost,
		"/v1/pairing-tokens",
		map[string]string{},
	)
	credential := requestWithoutAuth[DeviceCredential](
		t,
		handler,
		http.MethodPost,
		"/v1/devices/pair",
		PairDeviceRequest{Token: pairing.Token, DeviceName: "iPhone"},
	)

	devices := request[[]DeviceRecord](t, handler, http.MethodGet, "/v1/devices", nil)

	if len(devices) != 1 {
		t.Fatalf("len(devices) = %d, want 1", len(devices))
	}
	if devices[0].DeviceID != credential.DeviceID || devices[0].Name != "iPhone" {
		t.Fatalf("devices[0] = %#v, want paired iPhone", devices[0])
	}
}

func TestAPIRegistersDevicePushToken(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	pairing := request[PairingToken](
		t,
		handler,
		http.MethodPost,
		"/v1/pairing-tokens",
		map[string]string{},
	)
	credential := requestWithoutAuth[DeviceCredential](
		t,
		handler,
		http.MethodPost,
		"/v1/devices/pair",
		PairDeviceRequest{Token: pairing.Token, DeviceName: "iPhone"},
	)

	reqBody, err := json.Marshal(PushTokenRequest{Token: "ExponentPushToken[test]"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/devices/"+credential.DeviceID+"/push-token",
		bytes.NewReader(reqBody),
	)
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}

	tokens, err := store.ListDevicePushTokens()
	if err != nil {
		t.Fatalf("ListDevicePushTokens() error = %v", err)
	}
	if len(tokens) != 1 || tokens[0] != "ExponentPushToken[test]" {
		t.Fatalf("tokens = %#v, want ExponentPushToken[test]", tokens)
	}
}

func TestAPIAcceptsScopedAgentTokenForApprovalRequests(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	credential, err := store.CreateAgentToken("codex", []string{"approval:write"})
	if err != nil {
		t.Fatalf("CreateAgentToken() error = %v", err)
	}
	handler := NewAPI(store, "admin-token").Handler()

	body, err := json.Marshal(CreateRequest{Title: "Run command?"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests", bytes.NewReader(body))
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusCreated)
	}

	var created ApprovalRequest
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	req = httptest.NewRequest(http.MethodGet, "/v1/approval-requests/"+created.ID, nil)
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec = httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/approval-requests/"+created.ID+"/abandon", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec = httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("abandon status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}
	var abandoned ApprovalRequest
	if err := json.NewDecoder(rec.Body).Decode(&abandoned); err != nil {
		t.Fatalf("Decode(abandoned) error = %v", err)
	}
	if abandoned.Status != StatusAbandoned {
		t.Fatalf("abandoned status = %q, want %q", abandoned.Status, StatusAbandoned)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/approval-requests", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec = httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("list status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusUnauthorized)
	}
}

func TestAPIRejectsAgentTokenForApprovalResponses(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	credential, err := store.CreateAgentToken("codex", []string{"approval:write", "approval:read"})
	if err != nil {
		t.Fatalf("CreateAgentToken() error = %v", err)
	}
	handler := NewAPI(store, "test-token").Handler()

	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Run command?"})
	body, err := json.Marshal(Response{ChoiceID: "approve"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", bytes.NewReader(body))
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusUnauthorized)
	}
	current, err := store.Get(created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if current.Response != nil || current.Status != StatusPending {
		t.Fatalf("request = %#v, want still pending without response", current)
	}
}

func TestAPIRejectsAgentTokenForAdminEndpoints(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	credential, err := store.CreateAgentToken("codex", []string{"approval:write", "approval:read"})
	if err != nil {
		t.Fatalf("CreateAgentToken() error = %v", err)
	}
	handler := NewAPI(store, "admin-token").Handler()

	req := httptest.NewRequest(http.MethodPost, "/v1/pairing-tokens", bytes.NewReader([]byte("{}")))
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusUnauthorized)
	}
}

func TestAPIRequiresSignedCreateRequestsWhenEnabled(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	api.RequireSignatures(true)
	handler := api.Handler()

	body, err := json.Marshal(CreateRequest{Title: "Run command?"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	timestamp := time.Now().Unix()
	message := append([]byte(strconv.FormatInt(timestamp, 10)+"."), body...)
	signature := ed25519.Sign(privateKey, message)

	req = httptest.NewRequest(http.MethodPost, "/v1/approval-requests", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set(timestampHeader, strconv.FormatInt(timestamp, 10))
	req.Header.Set(publicKeyHeader, base64.StdEncoding.EncodeToString(publicKey))
	req.Header.Set(signatureHeader, base64.StdEncoding.EncodeToString(signature))
	rec = httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("signed status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusCreated)
	}
}

func TestAPITeamProjectEndpointsAuthorizeByOrganizationRole(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	team := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Platform"})
	project := request[ProjectRecord](t, handler, http.MethodPost, "/v1/projects", CreateProjectRequest{Name: "Control Plane", TeamID: team.TeamID})
	if project.TeamID != team.TeamID {
		t.Fatalf("project.TeamID = %q, want %q", project.TeamID, team.TeamID)
	}

	viewer := loginAuth(t, handler, "viewer@example.com")
	viewerUserID, ok, err := store.UserIDForSessionToken(viewer.session.Value)
	if err != nil || !ok {
		t.Fatalf("UserIDForSessionToken() = %q/%v/%v, want viewer", viewerUserID, ok, err)
	}
	joinedAt := time.Now().UTC().Add(time.Second)
	_, err = store.db.Exec(
		`INSERT INTO organization_memberships (organization_id, user_id, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, created_at = excluded.created_at, updated_at = excluded.updated_at`,
		defaultOrganizationID,
		viewerUserID,
		RoleViewer,
		timeText(&joinedAt),
		timeText(&joinedAt),
	)
	if err != nil {
		t.Fatalf("insert viewer membership error = %v", err)
	}

	listRec := statusWithSession(t, handler, viewer, http.MethodGet, "/v1/teams", nil, "")
	if listRec.Code != http.StatusOK {
		t.Fatalf("viewer list teams status = %d body = %s, want %d", listRec.Code, listRec.Body.String(), http.StatusOK)
	}
	createRec := statusWithSession(t, handler, viewer, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Restricted"}, viewer.csrf.Value)
	if createRec.Code != http.StatusForbidden {
		t.Fatalf("viewer create team status = %d body = %s, want %d", createRec.Code, createRec.Body.String(), http.StatusForbidden)
	}

	member := request[TeamMemberRecord](t, handler, http.MethodPost, "/v1/teams/"+team.TeamID+"/members", UpsertTeamMemberRequest{UserID: viewerUserID, Role: RoleApprover})
	if member.Role != RoleApprover {
		t.Fatalf("member role = %q, want %q", member.Role, RoleApprover)
	}
}

func request[T any](t *testing.T, handler http.Handler, method string, path string, input any) T {
	t.Helper()

	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}

	req := httptest.NewRequest(method, path, &body)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code < 200 || rec.Code >= 300 {
		t.Fatalf("%s %s status = %d body = %s", method, path, rec.Code, rec.Body.String())
	}

	var output T
	if err := json.NewDecoder(rec.Body).Decode(&output); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	return output
}

func TestAPIUnpairsDevice(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	pairing := request[PairingToken](t, handler, http.MethodPost, "/v1/pairing-tokens", map[string]string{})
	credential := requestWithoutAuth[DeviceCredential](t, handler, http.MethodPost, "/v1/devices/pair", PairDeviceRequest{Token: pairing.Token, DeviceName: "iPhone"})

	req := httptest.NewRequest(http.MethodPost, "/v1/devices/"+credential.DeviceID+"/unpair", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unpair status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}

	devices := request[[]DeviceRecord](t, handler, http.MethodGet, "/v1/devices", nil)
	if len(devices) != 1 {
		t.Fatalf("len(devices) = %d, want 1", len(devices))
	}
	if devices[0].UnpairedAt == nil {
		t.Fatal("devices[0].UnpairedAt is nil, want non-nil after unpair")
	}

	ok, err := store.VerifyDeviceToken(credential.Token)
	if err != nil {
		t.Fatalf("VerifyDeviceToken() error = %v", err)
	}
	if ok {
		t.Fatal("VerifyDeviceToken() = true after unpair, want false")
	}
}

func TestAPIUnpairDeviceRequiresAuth(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	req := httptest.NewRequest(http.MethodPost, "/v1/devices/dev_123/unpair", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAPIRevokeAgentTokenEndpoint(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	credential := request[AgentCredential](t, handler, http.MethodPost, "/v1/agent-tokens", CreateAgentTokenRequest{Name: "bot"})

	req := httptest.NewRequest(http.MethodPost, "/v1/agent-tokens/"+credential.AgentID+"/revoke", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}

	ok, err := store.VerifyAgentToken(credential.Token, "approval:write")
	if err != nil {
		t.Fatalf("VerifyAgentToken() error = %v", err)
	}
	if ok {
		t.Fatal("VerifyAgentToken() = true after revoke, want false")
	}
}

func TestAPIRevokeAgentTokenEndpointRequiresAuth(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	req := httptest.NewRequest(http.MethodPost, "/v1/agent-tokens/agent_123/revoke", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func requestWithoutAuth[T any](t *testing.T, handler http.Handler, method string, path string, input any) T {
	t.Helper()

	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}

	req := httptest.NewRequest(method, path, &body)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code < 200 || rec.Code >= 300 {
		t.Fatalf("%s %s status = %d body = %s", method, path, rec.Code, rec.Body.String())
	}

	var output T
	if err := json.NewDecoder(rec.Body).Decode(&output); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	return output
}

type sessionAuth struct {
	session *http.Cookie
	csrf    *http.Cookie
}

func loginAuth(t *testing.T, handler http.Handler, email string) sessionAuth {
	t.Helper()

	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(LoginRequest{Email: email, Password: "secret"}); err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/session", &body)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusOK)
	}
	cookies := rec.Result().Cookies()
	auth := sessionAuth{
		session: findCookie(cookies, sessionCookieName),
		csrf:    findCookie(cookies, csrfCookieName),
	}
	if auth.session == nil || auth.csrf == nil {
		t.Fatalf("cookies = %#v, want session and CSRF cookies", cookies)
	}
	return auth
}

func requestWithSession[T any](t *testing.T, handler http.Handler, auth sessionAuth, method string, path string, input any) T {
	t.Helper()

	rec := statusWithSession(t, handler, auth, method, path, input, auth.csrf.Value)
	if rec.Code < 200 || rec.Code >= 300 {
		t.Fatalf("%s %s status = %d body = %s", method, path, rec.Code, rec.Body.String())
	}

	var output T
	if err := json.NewDecoder(rec.Body).Decode(&output); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	return output
}

func statusWithSession(t *testing.T, handler http.Handler, auth sessionAuth, method string, path string, input any, csrf string) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &body)
	req.AddCookie(auth.session)
	req.AddCookie(auth.csrf)
	if csrf != "" {
		req.Header.Set(csrfHeaderName, csrf)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func findCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

type recordingEventBus struct {
	events []Event
}

func (b *recordingEventBus) Subscribe(w http.ResponseWriter, _ *http.Request) error {
	w.WriteHeader(http.StatusSwitchingProtocols)
	return nil
}

func (b *recordingEventBus) Publish(event Event) {
	b.events = append(b.events, event)
}

func (b *recordingEventBus) assertEvents(t *testing.T, want ...Event) {
	t.Helper()
	if len(b.events) != len(want) {
		t.Fatalf("events = %#v, want %#v", b.events, want)
	}
	for i := range want {
		if b.events[i] != want[i] {
			t.Fatalf("events = %#v, want %#v", b.events, want)
		}
	}
}
