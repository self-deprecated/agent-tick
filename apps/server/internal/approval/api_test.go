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

func TestAPICORSAllowsConfiguredOriginOnly(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	api.SetPublicURL("https://tick.example.com/app")
	handler := api.Handler()

	allowedReq := httptest.NewRequest(http.MethodOptions, "/v1/approval-requests", nil)
	allowedReq.Host = "tick.example.com"
	allowedReq.Header.Set("Origin", "https://tick.example.com")
	allowedReq.Header.Set("Access-Control-Request-Method", http.MethodPost)
	allowedRec := httptest.NewRecorder()
	handler.ServeHTTP(allowedRec, allowedReq)
	if allowedRec.Code != http.StatusNoContent || allowedRec.Header().Get("Access-Control-Allow-Origin") != "https://tick.example.com" {
		t.Fatalf("allowed CORS status/origin = %d/%q, want no-content configured origin", allowedRec.Code, allowedRec.Header().Get("Access-Control-Allow-Origin"))
	}

	blockedReq := httptest.NewRequest(http.MethodOptions, "/v1/approval-requests", nil)
	blockedReq.Host = "tick.example.com"
	blockedReq.Header.Set("Origin", "https://evil.example")
	blockedReq.Header.Set("Access-Control-Request-Method", http.MethodPost)
	blockedRec := httptest.NewRecorder()
	handler.ServeHTTP(blockedRec, blockedReq)
	if blockedRec.Code != http.StatusForbidden || blockedRec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("blocked CORS status/origin = %d/%q, want forbidden without wildcard", blockedRec.Code, blockedRec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestAPIRateLimitsByClientIP(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	api.rateLimiter = newRateLimiter(time.Minute, 1, 1)
	handler := api.Handler()

	first := statusWithBearer(t, handler, "test-token", http.MethodGet, "/v1/approval-requests", nil)
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d body = %s, want %d", first.Code, first.Body.String(), http.StatusOK)
	}
	second := statusWithBearer(t, handler, "test-token", http.MethodGet, "/v1/approval-requests", nil)
	if second.Code != http.StatusTooManyRequests || !strings.Contains(second.Body.String(), "rate limit") {
		t.Fatalf("second status/body = %d/%s, want rate limit", second.Code, second.Body.String())
	}
}

func TestAPIRejectsOversizedRequestBodies(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	req := httptest.NewRequest(http.MethodPost, "/v1/approval-requests", strings.NewReader(strings.Repeat("x", int(maxRequestBodyBytes)+1)))
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "too large") {
		t.Fatalf("oversized request status/body = %d/%s, want 413", rec.Code, rec.Body.String())
	}
}

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

func TestAPIExpiredRequestsPublishOnAccess(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	events := &recordingEventBus{}
	api.events = events
	handler := api.Handler()

	expiresAt := time.Now().UTC().Add(-time.Minute)
	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Too late", ExpiresAt: &expiresAt})
	events.assertEvents(t, Event{Type: "approval.created", RequestID: created.ID})

	got := request[ApprovalRequest](t, handler, http.MethodGet, "/v1/approval-requests/"+created.ID, nil)
	if got.Status != StatusExpired {
		t.Fatalf("status = %q, want expired", got.Status)
	}
	events.assertEvents(t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.expired", RequestID: created.ID},
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

func TestAPIUserModeRejectsLoopbackWithoutSession(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	req := httptest.NewRequest(http.MethodGet, "/v1/teams", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("loopback user-mode status = %d body = %s, want %d", rec.Code, rec.Body.String(), http.StatusUnauthorized)
	}
}

func TestAPIDashboardBundleHandlesDynamicChoiceButtons(t *testing.T) {
	handler := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token").Handler()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	html := rec.Body.String()
	assetPath, ok := embeddedAdminAssetPath(html)
	if !ok {
		t.Fatalf("admin asset path not found in body: %s", html)
	}
	if !strings.HasPrefix(assetPath, "/assets/") {
		t.Fatalf("admin asset path = %q, want /assets/ scoped asset", assetPath)
	}
	for _, placeholder := range []string{"__MODE__", "__PUBLIC_URL__"} {
		if strings.Contains(html, placeholder) {
			t.Fatalf("admin HTML still contains placeholder %q: %s", placeholder, html)
		}
	}
	assetReq := httptest.NewRequest(http.MethodGet, assetPath, nil)
	assetRec := httptest.NewRecorder()
	handler.ServeHTTP(assetRec, assetReq)
	if assetRec.Code != http.StatusOK {
		t.Fatalf("admin asset status = %d body = %s, want %d", assetRec.Code, assetRec.Body.String(), http.StatusOK)
	}

	bundle := assetRec.Body.String()
	for _, snippet := range []string{"choices", "choiceId", "/v1/approval-requests/", "/responses"} {
		if !strings.Contains(bundle, snippet) {
			t.Fatalf("dashboard bundle missing %q", snippet)
		}
	}
}

func TestAPIDashboardAssetsAllowHEADAndAvoidCaching404s(t *testing.T) {
	handler := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token").Handler()
	indexReq := httptest.NewRequest(http.MethodGet, "/", nil)
	indexRec := httptest.NewRecorder()
	handler.ServeHTTP(indexRec, indexReq)
	assetPath, ok := embeddedAdminAssetPath(indexRec.Body.String())
	if !ok {
		t.Fatalf("admin asset path not found in body: %s", indexRec.Body.String())
	}

	headReq := httptest.NewRequest(http.MethodHead, assetPath, nil)
	headReq.RemoteAddr = "192.0.2.1:1234"
	headRec := httptest.NewRecorder()
	handler.ServeHTTP(headRec, headReq)
	if headRec.Code != http.StatusOK {
		t.Fatalf("HEAD asset status = %d body = %s, want %d", headRec.Code, headRec.Body.String(), http.StatusOK)
	}
	if got := headRec.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("HEAD asset Cache-Control = %q, want immutable cache header", got)
	}

	missingReq := httptest.NewRequest(http.MethodGet, "/assets/missing-dashboard-asset.js", nil)
	missingReq.RemoteAddr = "192.0.2.1:1234"
	missingRec := httptest.NewRecorder()
	handler.ServeHTTP(missingRec, missingReq)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d body = %s, want %d", missingRec.Code, missingRec.Body.String(), http.StatusNotFound)
	}
	if got := missingRec.Header().Get("Cache-Control"); got != "" {
		t.Fatalf("missing asset Cache-Control = %q, want no long-lived cache header", got)
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

func TestAPIDeviceTokenCannotAccessAdminEndpoints(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	pairing := request[PairingToken](t, handler, http.MethodPost, "/v1/pairing-tokens", map[string]string{})
	device := requestWithoutAuth[DeviceCredential](t, handler, http.MethodPost, "/v1/devices/pair", PairDeviceRequest{Token: pairing.Token, DeviceName: "Phone"})

	listRec := statusWithBearer(t, handler, device.Token, http.MethodGet, "/v1/approval-requests?status=pending", nil)
	if listRec.Code != http.StatusOK {
		t.Fatalf("device approval list status = %d body = %s, want %d", listRec.Code, listRec.Body.String(), http.StatusOK)
	}

	for _, path := range []string{
		"/v1/agent-tokens",
		"/v1/approval-requests/../agent-tokens",
		"/v1/approval-requests/%2e%2e/agent-tokens",
		"/v1/approval-requests//../agent-tokens",
	} {
		createAgentRec := statusWithBearer(t, handler, device.Token, http.MethodPost, path, CreateAgentTokenRequest{Name: "device-created"})
		if createAgentRec.Code != http.StatusForbidden {
			t.Fatalf("device create agent via %s status = %d body = %s, want %d", path, createAgentRec.Code, createAgentRec.Body.String(), http.StatusForbidden)
		}
	}
	if agents := request[[]AgentTokenRecord](t, handler, http.MethodGet, "/v1/agent-tokens", nil); len(agents) != 0 {
		t.Fatalf("agent tokens = %#v, want none created by device token", agents)
	}
}

func TestAPIDeviceTokenCanSelfUnpairOnly(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	pairingOne := request[PairingToken](t, handler, http.MethodPost, "/v1/pairing-tokens", map[string]string{})
	deviceOne := requestWithoutAuth[DeviceCredential](t, handler, http.MethodPost, "/v1/devices/pair", PairDeviceRequest{Token: pairingOne.Token, DeviceName: "Phone 1"})
	pairingTwo := request[PairingToken](t, handler, http.MethodPost, "/v1/pairing-tokens", map[string]string{})
	deviceTwo := requestWithoutAuth[DeviceCredential](t, handler, http.MethodPost, "/v1/devices/pair", PairDeviceRequest{Token: pairingTwo.Token, DeviceName: "Phone 2"})

	otherRec := statusWithBearer(t, handler, deviceOne.Token, http.MethodPost, "/v1/devices/"+deviceTwo.DeviceID+"/unpair", nil)
	if otherRec.Code != http.StatusForbidden {
		t.Fatalf("device unpair other status = %d body = %s, want %d", otherRec.Code, otherRec.Body.String(), http.StatusForbidden)
	}
	selfRec := statusWithBearer(t, handler, deviceOne.Token, http.MethodPost, "/v1/devices/"+deviceOne.DeviceID+"/unpair", nil)
	if selfRec.Code != http.StatusOK {
		t.Fatalf("device self-unpair status = %d body = %s, want %d", selfRec.Code, selfRec.Body.String(), http.StatusOK)
	}
	ok, err := store.VerifyDeviceToken(deviceOne.Token)
	if err != nil {
		t.Fatalf("VerifyDeviceToken(self) error = %v", err)
	}
	if ok {
		t.Fatal("self-unpaired device token still verifies")
	}
	ok, err = store.VerifyDeviceToken(deviceTwo.Token)
	if err != nil {
		t.Fatalf("VerifyDeviceToken(other) error = %v", err)
	}
	if !ok {
		t.Fatal("other device token was unpaired")
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

func TestAPIPresenceHeartbeatAvailabilityAndCoverage(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	team := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Support"})
	auth := loginAuth(t, handler, "support@example.com")
	userID, _, _ := store.UserIDForSessionToken(auth.session.Value)
	if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: userID, Role: RoleApprover}); err != nil {
		t.Fatalf("UpsertTeamMember() error = %v", err)
	}

	heartbeat := requestWithSession[UserAvailabilityRecord](t, handler, auth, http.MethodPost, "/v1/heartbeat", HeartbeatRequest{Client: "mobile"})
	if heartbeat.UserID != userID || heartbeat.LastSeenAt == nil {
		t.Fatalf("heartbeat = %#v, want last seen for current user", heartbeat)
	}
	availability := requestWithSession[UserAvailabilityRecord](t, handler, auth, http.MethodPost, "/v1/availability", AvailabilityRequest{State: AvailabilityDoNotDisturb, OverrideSeconds: 60})
	if availability.State != AvailabilityDoNotDisturb || availability.OverrideUntil == nil {
		t.Fatalf("availability = %#v, want DND override", availability)
	}
	schedule := request[OnCallScheduleRecord](t, handler, http.MethodPost, "/v1/teams/"+team.TeamID+"/on-call", UpsertOnCallScheduleRequest{PrimaryUserID: userID})
	if schedule.PrimaryUserID != userID {
		t.Fatalf("schedule = %#v, want current user primary", schedule)
	}
	coverage := request[TeamCoverageRecord](t, handler, http.MethodGet, "/v1/teams/"+team.TeamID+"/coverage", nil)
	if coverage.TeamID != team.TeamID || len(coverage.Members) != 1 {
		t.Fatalf("coverage = %#v, want team member coverage", coverage)
	}
}

func TestAPIPolicyResponsesReturnProgress(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	team := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Approvers"})
	userA := loginAuth(t, handler, "a@example.com")
	userAID, _, _ := store.UserIDForSessionToken(userA.session.Value)
	userB := loginAuth(t, handler, "b@example.com")
	userBID, _, _ := store.UserIDForSessionToken(userB.session.Value)
	for _, userID := range []string{userAID, userBID} {
		if _, err := store.UpsertTeamMember(defaultOrganizationID, team.TeamID, UpsertTeamMemberRequest{UserID: userID, Role: RoleApprover}); err != nil {
			t.Fatalf("UpsertTeamMember(%s) error = %v", userID, err)
		}
	}
	policy := request[ApprovalPolicyRecord](t, handler, http.MethodPost, "/v1/policies", CreateApprovalPolicyRequest{Name: "Two people", Template: PolicyTemplateQuorum, TeamID: team.TeamID, Settings: map[string]string{"quorum": "2"}})
	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Ship?", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})

	visible := requestWithSession[ApprovalRequest](t, handler, userA, http.MethodGet, "/v1/approval-requests/"+created.ID, nil)
	if visible.PolicyProgress == nil || visible.PolicyProgress.RequiredApprovals != 2 || !visible.PolicyProgress.CurrentUserEligible {
		t.Fatalf("visible progress = %#v, want quorum progress for eligible approver", visible.PolicyProgress)
	}
	listed := requestWithSession[[]ApprovalRequest](t, handler, userA, http.MethodGet, "/v1/approval-requests", nil)
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("listed = %#v, want eligible policy request", listed)
	}

	first := requestWithSession[ApprovalRequest](t, handler, userA, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	if first.Status != StatusPending || first.PolicyProgress == nil || !first.PolicyProgress.CurrentUserHasVoted || first.PolicyProgress.CurrentUserVote == nil || first.PolicyProgress.WaitingFor != 1 {
		t.Fatalf("first = %#v progress %#v, want pending progress after vote", first, first.PolicyProgress)
	}
	final := requestWithSession[ApprovalRequest](t, handler, userB, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	if final.Status != StatusResponded || final.Response == nil || final.PolicyProgress == nil || final.PolicyProgress.State != "approved" {
		t.Fatalf("final = %#v progress %#v, want approved final", final, final.PolicyProgress)
	}
}

func TestAPIPolicySequencePublishesVoteStepAndFinalEvents(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	events := &recordingEventBus{}
	api.events = events
	handler := api.Handler()

	teamOne := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "One"})
	teamTwo := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Two"})
	userOne := loginAuth(t, handler, "one@example.com")
	userOneID, _, _ := store.UserIDForSessionToken(userOne.session.Value)
	userTwo := loginAuth(t, handler, "two@example.com")
	userTwoID, _, _ := store.UserIDForSessionToken(userTwo.session.Value)
	_, _ = store.UpsertTeamMember(defaultOrganizationID, teamOne.TeamID, UpsertTeamMemberRequest{UserID: userOneID, Role: RoleApprover})
	_, _ = store.UpsertTeamMember(defaultOrganizationID, teamTwo.TeamID, UpsertTeamMemberRequest{UserID: userTwoID, Role: RoleApprover})
	policy := request[ApprovalPolicyRecord](t, handler, http.MethodPost, "/v1/policies", CreateApprovalPolicyRequest{
		Name:     "Two-step",
		Template: PolicyTemplateSequence,
		Steps: []ApprovalPolicyStep{
			{Position: 1, StepType: PolicyTemplateAnyTeamMember, TeamID: teamOne.TeamID, Quorum: 1, DenyVeto: true},
			{Position: 2, StepType: PolicyTemplateAnyTeamMember, TeamID: teamTwo.TeamID, Quorum: 1, DenyVeto: true},
		},
	})
	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Ship sequence?", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})
	events.assertEvents(t, Event{Type: "approval.created", RequestID: created.ID})

	advanced := requestWithSession[ApprovalRequest](t, handler, userOne, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	if advanced.Status != StatusPending || advanced.PolicyProgress == nil || advanced.PolicyProgress.CurrentStep != 2 {
		t.Fatalf("advanced = %#v progress %#v, want step 2 pending", advanced, advanced.PolicyProgress)
	}
	events.assertEvents(t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.step_advanced", RequestID: created.ID},
	)

	final := requestWithSession[ApprovalRequest](t, handler, userTwo, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	if final.Status != StatusResponded || final.Response == nil || final.PolicyProgress == nil || final.PolicyProgress.State != "approved" {
		t.Fatalf("final = %#v progress %#v, want approved final", final, final.PolicyProgress)
	}
	events.assertEvents(t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.step_advanced", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.final_decision", RequestID: created.ID},
		Event{Type: "approval.responded", RequestID: created.ID},
	)
}

func TestAPIPolicyStepAdvancedOnlyPublishesOnStepChange(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	events := &recordingEventBus{}
	api.events = events
	handler := api.Handler()

	teamOne := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Gate one"})
	teamTwo := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Gate two"})
	userOne := loginAuth(t, handler, "gate-one@example.com")
	userOneID, _, _ := store.UserIDForSessionToken(userOne.session.Value)
	userTwo := loginAuth(t, handler, "gate-two-a@example.com")
	userTwoID, _, _ := store.UserIDForSessionToken(userTwo.session.Value)
	userThree := loginAuth(t, handler, "gate-two-b@example.com")
	userThreeID, _, _ := store.UserIDForSessionToken(userThree.session.Value)
	_, _ = store.UpsertTeamMember(defaultOrganizationID, teamOne.TeamID, UpsertTeamMemberRequest{UserID: userOneID, Role: RoleApprover})
	_, _ = store.UpsertTeamMember(defaultOrganizationID, teamTwo.TeamID, UpsertTeamMemberRequest{UserID: userTwoID, Role: RoleApprover})
	_, _ = store.UpsertTeamMember(defaultOrganizationID, teamTwo.TeamID, UpsertTeamMemberRequest{UserID: userThreeID, Role: RoleApprover})
	policy := request[ApprovalPolicyRecord](t, handler, http.MethodPost, "/v1/policies", CreateApprovalPolicyRequest{
		Name:     "Second-step quorum",
		Template: PolicyTemplateSequence,
		Steps: []ApprovalPolicyStep{
			{Position: 1, StepType: PolicyTemplateAnyTeamMember, TeamID: teamOne.TeamID, Quorum: 1, DenyVeto: true},
			{Position: 2, StepType: PolicyTemplateQuorum, TeamID: teamTwo.TeamID, Quorum: 2, DenyVeto: true},
		},
	})
	created := request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Ship gated sequence?", Metadata: map[string]string{"effectiveApprovalPolicy": policy.PolicyID}})

	advanced := requestWithSession[ApprovalRequest](t, handler, userOne, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	if advanced.Status != StatusPending || advanced.PolicyProgress == nil || advanced.PolicyProgress.CurrentStep != 2 {
		t.Fatalf("advanced progress = %#v status %s, want step 2 pending", advanced.PolicyProgress, advanced.Status)
	}
	events.assertEvents(t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.step_advanced", RequestID: created.ID},
	)

	stillStepTwo := requestWithSession[ApprovalRequest](t, handler, userTwo, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	if stillStepTwo.Status != StatusPending || stillStepTwo.PolicyProgress == nil || stillStepTwo.PolicyProgress.CurrentStep != 2 || stillStepTwo.PolicyProgress.WaitingFor != 1 {
		t.Fatalf("stillStepTwo progress = %#v status %s, want step 2 waiting for one", stillStepTwo.PolicyProgress, stillStepTwo.Status)
	}
	events.assertEvents(t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.step_advanced", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
	)

	final := requestWithSession[ApprovalRequest](t, handler, userThree, http.MethodPost, "/v1/approval-requests/"+created.ID+"/responses", Response{ChoiceID: "approve"})
	if final.Status != StatusResponded || final.PolicyProgress == nil || final.PolicyProgress.State != "approved" {
		t.Fatalf("final = %#v progress %#v, want approved final", final, final.PolicyProgress)
	}
	events.assertEvents(t,
		Event{Type: "approval.created", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.step_advanced", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.vote_recorded", RequestID: created.ID},
		Event{Type: "approval.final_decision", RequestID: created.ID},
		Event{Type: "approval.responded", RequestID: created.ID},
	)
}

func TestAPIRotatesAgentTokenAndInvalidatesOldSecret(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	credential := request[AgentCredential](t, handler, http.MethodPost, "/v1/agent-tokens", CreateAgentTokenRequest{Name: "rotate-me"})
	rotated := request[AgentCredential](t, handler, http.MethodPost, "/v1/agent-tokens/"+credential.AgentID+"/rotate", nil)
	if rotated.Token == "" || rotated.Token == credential.Token || rotated.AgentID != credential.AgentID {
		t.Fatalf("rotated credential = %#v, original token %q", rotated, credential.Token)
	}

	oldRec := statusWithBearer(t, handler, credential.Token, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Old token"})
	if oldRec.Code != http.StatusUnauthorized {
		t.Fatalf("old token status = %d body = %s, want %d", oldRec.Code, oldRec.Body.String(), http.StatusUnauthorized)
	}
	newRec := statusWithBearer(t, handler, rotated.Token, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "New token"})
	if newRec.Code != http.StatusCreated {
		t.Fatalf("new token status = %d body = %s, want %d", newRec.Code, newRec.Body.String(), http.StatusCreated)
	}
}

func TestAPIAgentTokenRoutingHintsAreRestricted(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	team := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Platform"})
	otherTeam := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Other"})
	project := request[ProjectRecord](t, handler, http.MethodPost, "/v1/projects", CreateProjectRequest{Name: "Platform Project", TeamID: team.TeamID})
	otherProject := request[ProjectRecord](t, handler, http.MethodPost, "/v1/projects", CreateProjectRequest{Name: "Other Project", TeamID: otherTeam.TeamID})
	policy := request[ApprovalPolicyRecord](t, handler, http.MethodPost, "/v1/policies", CreateApprovalPolicyRequest{Name: "Team quorum", Template: PolicyTemplateQuorum, TeamID: team.TeamID})
	credential := request[AgentCredential](t, handler, http.MethodPost, "/v1/agent-tokens", CreateAgentTokenRequest{
		Name:                  "platform-agent",
		Scopes:                []string{"approval:write"},
		ProjectID:             project.ProjectID,
		TeamID:                team.TeamID,
		DefaultApprovalPolicy: policy.PolicyID,
	})

	badProjectRec := statusWithBearer(t, handler, credential.Token, http.MethodPost, "/v1/approval-requests", CreateRequest{
		Title:    "Wrong project",
		Metadata: map[string]string{"projectId": otherProject.ProjectID},
	})
	if badProjectRec.Code != http.StatusBadRequest {
		t.Fatalf("bad project status = %d body = %s, want %d", badProjectRec.Code, badProjectRec.Body.String(), http.StatusBadRequest)
	}

	badTeamRec := statusWithBearer(t, handler, credential.Token, http.MethodPost, "/v1/approval-requests", CreateRequest{
		Title:    "Wrong team",
		Metadata: map[string]string{"teamId": otherTeam.TeamID},
	})
	if badTeamRec.Code != http.StatusBadRequest {
		t.Fatalf("bad team status = %d body = %s, want %d", badTeamRec.Code, badTeamRec.Body.String(), http.StatusBadRequest)
	}

	badOwnerRec := statusWithBearer(t, handler, credential.Token, http.MethodPost, "/v1/approval-requests", CreateRequest{
		Title:    "Wrong owner",
		Metadata: map[string]string{"ownerUserId": "usr_other"},
	})
	if badOwnerRec.Code != http.StatusBadRequest {
		t.Fatalf("bad owner status = %d body = %s, want %d", badOwnerRec.Code, badOwnerRec.Body.String(), http.StatusBadRequest)
	}

	created := requestWithBearer[ApprovalRequest](t, handler, credential.Token, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Allowed"})
	if created.Metadata["projectId"] != project.ProjectID || created.Metadata["ownerUserId"] != defaultUserID || created.Metadata["teamId"] != team.TeamID || created.Metadata["approvalPolicy"] != policy.PolicyID || created.Metadata["effectiveApprovalPolicy"] != policy.PolicyID {
		t.Fatalf("metadata = %#v, want token routing defaults", created.Metadata)
	}
	var storedOrganizationID string
	var storedProjectID string
	if err := store.db.QueryRow("SELECT organization_id, project_id FROM approval_requests WHERE id = ?", created.ID).Scan(&storedOrganizationID, &storedProjectID); err != nil {
		t.Fatalf("query stored request route error = %v", err)
	}
	if storedOrganizationID != defaultOrganizationID || storedProjectID != project.ProjectID {
		t.Fatalf("stored org/project = %q/%q, want %q/%q", storedOrganizationID, storedProjectID, defaultOrganizationID, project.ProjectID)
	}

	records := request[[]AgentTokenRecord](t, handler, http.MethodGet, "/v1/agent-tokens", nil)
	if len(records) == 0 || records[0].ProjectID == "" || records[0].LastRequestAt == nil {
		t.Fatalf("agent records = %#v, want project and last request", records)
	}
}

func TestAPICreateRejectsUnknownOrCrossOrganizationProjectID(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	missingRec := statusWithBearer(t, handler, "test-token", http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Missing project", Metadata: map[string]string{"projectId": "prj_missing"}})
	if missingRec.Code != http.StatusBadRequest || !strings.Contains(missingRec.Body.String(), "organization or project not found") {
		t.Fatalf("missing project status/body = %d/%s, want bad request project error", missingRec.Code, missingRec.Body.String())
	}

	otherOrg, err := store.CreateOrganizationForUser("usr_project_other", "Other Project Org")
	if err != nil {
		t.Fatalf("CreateOrganizationForUser() error = %v", err)
	}
	otherProject, err := store.CreateProject(otherOrg.OrganizationID, CreateProjectRequest{Name: "Other Project"})
	if err != nil {
		t.Fatalf("CreateProject(other) error = %v", err)
	}
	crossOrgRec := statusWithBearer(t, handler, "test-token", http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Cross org project", Metadata: map[string]string{"projectId": otherProject.ProjectID}})
	if crossOrgRec.Code != http.StatusBadRequest || !strings.Contains(crossOrgRec.Body.String(), "organization or project not found") {
		t.Fatalf("cross-org project status/body = %d/%s, want bad request project error", crossOrgRec.Code, crossOrgRec.Body.String())
	}
}

func TestAPIBillingWebhookDelegatesToProviderWithoutAuth(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	provider := &fakeBillingProvider{portalURL: "https://billing.example/portal"}
	api.SetBillingProvider(provider)
	handler := api.Handler()

	webhookReq := httptest.NewRequest(http.MethodPost, "/v1/billing/webhook", strings.NewReader(`{"event":"invoice.paid"}`))
	webhookReq.Header.Set("X-Agent-Tick-Billing-Signature", "signed")
	webhookRec := httptest.NewRecorder()
	handler.ServeHTTP(webhookRec, webhookReq)
	if webhookRec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body = %s, want %d", webhookRec.Code, webhookRec.Body.String(), http.StatusOK)
	}
	if string(provider.payload) != `{"event":"invoice.paid"}` || provider.signature != "signed" {
		t.Fatalf("provider payload/signature = %q/%q", provider.payload, provider.signature)
	}

	status := request[BillingStatus](t, handler, http.MethodGet, "/v1/billing", nil)
	if status.PortalURL != provider.portalURL {
		t.Fatalf("PortalURL = %q, want provider URL %q", status.PortalURL, provider.portalURL)
	}
}

func TestAPIBillingStatusShowsPlanUsageAndLinks(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	_ = request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Billing"})
	_ = request[AgentCredential](t, handler, http.MethodPost, "/v1/agent-tokens", CreateAgentTokenRequest{Name: "billing-agent"})
	_ = request[ApprovalRequest](t, handler, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Billable approval"})

	status := request[BillingStatus](t, handler, http.MethodGet, "/v1/billing", nil)
	if status.OrganizationID != defaultOrganizationID || status.Plan != "self-hosted" || status.Limits.Agents != -1 || status.Limits.Requests != -1 {
		t.Fatalf("status = %#v, want default self-hosted plan", status)
	}
	if status.Usage.Teams != 1 || status.Usage.ActiveAgents != 1 || status.Usage.ApprovalRequests30d != 1 {
		t.Fatalf("usage = %#v, want team, active agent, and approval counters", status.Usage)
	}
	if status.UpgradeURL == "" {
		t.Fatal("UpgradeURL is empty, want hosted-service contact action")
	}
}

func TestAPIBillingDoesNotRequireTeamProjectStore(t *testing.T) {
	store := &billingOnlyStore{
		FileStore: NewFileStore(filepath.Join(t.TempDir(), "billing-only.json")),
		status: BillingStatus{
			OrganizationID: defaultOrganizationID,
			Plan:           "external",
			Limits:         BillingLimits{Seats: 10},
		},
	}
	handler := NewAPI(store, "test-token").Handler()

	status := request[BillingStatus](t, handler, http.MethodGet, "/v1/billing", nil)
	if status.Plan != "external" || status.Limits.Seats != 10 {
		t.Fatalf("status = %#v, want fake billing status without TeamProjectStore", status)
	}
}

func TestAPIBillingHandlesUnsupportedAndMissingOrganization(t *testing.T) {
	unsupported := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "no-billing.json")), "test-token").Handler()
	unsupportedRec := statusWithBearer(t, unsupported, "test-token", http.MethodGet, "/v1/billing", nil)
	if unsupportedRec.Code != http.StatusNotImplemented {
		t.Fatalf("unsupported billing status = %d body = %s, want %d", unsupportedRec.Code, unsupportedRec.Body.String(), http.StatusNotImplemented)
	}

	missingStore := &billingOnlyStore{FileStore: NewFileStore(filepath.Join(t.TempDir(), "missing-billing.json")), err: ErrNotFound}
	missing := NewAPI(missingStore, "test-token").Handler()
	missingRec := statusWithBearer(t, missing, "test-token", http.MethodGet, "/v1/billing", nil)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("missing billing status = %d body = %s, want %d", missingRec.Code, missingRec.Body.String(), http.StatusNotFound)
	}
}

func TestAPIAuditEventsListAndExportAreOrganizationScoped(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()

	defaultTeam := request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Default Audit"})
	otherOrg, err := store.CreateOrganizationForUser("usr_audit_other", "Other Audit Org")
	if err != nil {
		t.Fatalf("CreateOrganizationForUser(other) error = %v", err)
	}
	if _, err := store.CreateTeam(otherOrg.OrganizationID, CreateTeamRequest{Name: "Other Audit"}); err != nil {
		t.Fatalf("CreateTeam(other) error = %v", err)
	}

	events := request[[]AuditEventRecord](t, handler, http.MethodGet, "/v1/audit-events?limit=50", nil)
	if len(events) == 0 {
		t.Fatal("audit events empty, want default organization events")
	}
	seenDefaultTeam := false
	for _, event := range events {
		if event.OrganizationID != defaultOrganizationID {
			t.Fatalf("event org = %q, want %q in event %#v", event.OrganizationID, defaultOrganizationID, event)
		}
		seenDefaultTeam = seenDefaultTeam || event.TargetID == defaultTeam.TeamID
	}
	if !seenDefaultTeam {
		t.Fatalf("events = %#v, want default team target", events)
	}

	rec := statusWithBearer(t, handler, "test-token", http.MethodGet, "/v1/audit-events/export?limit=50", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "team.created") || strings.Contains(rec.Body.String(), otherOrg.OrganizationID) {
		t.Fatalf("audit export status/body = %d/%s, want scoped CSV", rec.Code, rec.Body.String())
	}
}

func TestAPIPlanLimitErrorsUsePaymentRequired(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	handler := NewAPI(store, "test-token").Handler()
	_, err := store.db.Exec(`
		UPDATE organizations
		SET team_limit = 0, agent_limit = 0, request_limit = 0
		WHERE id = ?
	`, defaultOrganizationID)
	if err != nil {
		t.Fatalf("update limits error = %v", err)
	}

	for _, tc := range []struct {
		name  string
		path  string
		input any
	}{
		{name: "team", path: "/v1/teams", input: CreateTeamRequest{Name: "Blocked"}},
		{name: "agent", path: "/v1/agent-tokens", input: CreateAgentTokenRequest{Name: "blocked"}},
		{name: "request", path: "/v1/approval-requests", input: CreateRequest{Title: "Blocked"}},
	} {
		rec := statusWithBearer(t, handler, "test-token", http.MethodPost, tc.path, tc.input)
		if rec.Code != http.StatusPaymentRequired || !strings.Contains(rec.Body.String(), "limit") {
			t.Fatalf("%s status/body = %d/%s, want payment required plan-limit error", tc.name, rec.Code, rec.Body.String())
		}
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

func TestAPIMissingMembershipGetsPersonalOrganizationNotDefaultOwner(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()
	_ = request[TeamRecord](t, handler, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Default team"})

	auth := loginAuth(t, handler, "orphan@example.com")
	userID, ok, err := store.UserIDForSessionToken(auth.session.Value)
	if err != nil || !ok {
		t.Fatalf("UserIDForSessionToken() = %q/%v/%v, want orphan", userID, ok, err)
	}
	if _, err := store.db.Exec("DELETE FROM organization_memberships WHERE user_id = ?", userID); err != nil {
		t.Fatalf("delete memberships error = %v", err)
	}

	teams := requestWithSession[[]TeamRecord](t, handler, auth, http.MethodGet, "/v1/teams", nil)
	if len(teams) != 0 {
		t.Fatalf("orphan teams = %#v, want no access to default org teams", teams)
	}
	membership, err := store.DefaultOrganizationForUser(userID)
	if err != nil {
		t.Fatalf("DefaultOrganizationForUser(orphan) error = %v", err)
	}
	if membership.OrganizationID == defaultOrganizationID || membership.Role != RoleOwner {
		t.Fatalf("membership = %#v, want owner of a personal non-default organization", membership)
	}
}

func TestAPITenantIsolationAcrossOrganizations(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()

	ownerA := loginAuth(t, handler, "owner-a@example.com")
	teamA := requestWithSession[TeamRecord](t, handler, ownerA, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Tenant A"})
	policyA := requestWithSession[ApprovalPolicyRecord](t, handler, ownerA, http.MethodPost, "/v1/policies", CreateApprovalPolicyRequest{Name: "Tenant A policy", Template: PolicyTemplateAnyTeamMember, TeamID: teamA.TeamID})
	agentA := requestWithSession[AgentCredential](t, handler, ownerA, http.MethodPost, "/v1/agent-tokens", CreateAgentTokenRequest{Name: "tenant-a-agent"})
	pairingA := requestWithSession[PairingToken](t, handler, ownerA, http.MethodPost, "/v1/pairing-tokens", map[string]string{})
	deviceA := requestWithoutAuth[DeviceCredential](t, handler, http.MethodPost, "/v1/devices/pair", PairDeviceRequest{Token: pairingA.Token, DeviceName: "Tenant A phone"})
	approvalA := requestWithSession[ApprovalRequest](t, handler, ownerA, http.MethodPost, "/v1/approval-requests", CreateRequest{Title: "Tenant A request"})
	_ = requestWithSession[[]AuditEventRecord](t, handler, ownerA, http.MethodGet, "/v1/audit-events?limit=10", nil)

	ownerB := loginAuth(t, handler, "owner-b@example.com")
	if teams := requestWithSession[[]TeamRecord](t, handler, ownerB, http.MethodGet, "/v1/teams", nil); len(teams) != 0 {
		t.Fatalf("tenant B teams = %#v, want no tenant A teams", teams)
	}
	if policies := requestWithSession[[]ApprovalPolicyRecord](t, handler, ownerB, http.MethodGet, "/v1/policies", nil); len(policies) != 0 {
		t.Fatalf("tenant B policies = %#v, want no tenant A policies", policies)
	}
	if agents := requestWithSession[[]AgentTokenRecord](t, handler, ownerB, http.MethodGet, "/v1/agent-tokens", nil); len(agents) != 0 {
		t.Fatalf("tenant B agents = %#v, want no tenant A agents", agents)
	}
	if devices := requestWithSession[[]DeviceRecord](t, handler, ownerB, http.MethodGet, "/v1/devices", nil); len(devices) != 0 {
		t.Fatalf("tenant B devices = %#v, want no tenant A devices", devices)
	}
	if approvals := requestWithSession[[]ApprovalRequest](t, handler, ownerB, http.MethodGet, "/v1/approval-requests", nil); len(approvals) != 0 {
		t.Fatalf("tenant B approvals = %#v, want no tenant A approvals", approvals)
	}
	for _, event := range requestWithSession[[]AuditEventRecord](t, handler, ownerB, http.MethodGet, "/v1/audit-events?limit=50", nil) {
		if event.OrganizationID == teamA.OrganizationID || event.TargetID == teamA.TeamID || event.TargetID == policyA.PolicyID || event.TargetID == approvalA.ID {
			t.Fatalf("tenant B audit event = %#v, want no tenant A audit events", event)
		}
	}

	for _, tc := range []struct {
		name string
		path string
	}{
		{name: "team", path: "/v1/teams/" + teamA.TeamID},
		{name: "policy", path: "/v1/policies/" + policyA.PolicyID},
		{name: "approval", path: "/v1/approval-requests/" + approvalA.ID},
	} {
		rec := statusWithSession(t, handler, ownerB, http.MethodGet, tc.path, nil, "")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("tenant B get %s status = %d body = %s, want %d", tc.name, rec.Code, rec.Body.String(), http.StatusNotFound)
		}
	}
	revokeRec := statusWithSession(t, handler, ownerB, http.MethodPost, "/v1/agent-tokens/"+agentA.AgentID+"/revoke", nil, ownerB.csrf.Value)
	if revokeRec.Code != http.StatusNotFound {
		t.Fatalf("tenant B revoke agent status = %d body = %s, want %d", revokeRec.Code, revokeRec.Body.String(), http.StatusNotFound)
	}
	unpairRec := statusWithSession(t, handler, ownerB, http.MethodPost, "/v1/devices/"+deviceA.DeviceID+"/unpair", nil, ownerB.csrf.Value)
	if unpairRec.Code != http.StatusNotFound {
		t.Fatalf("tenant B unpair device status = %d body = %s, want %d", unpairRec.Code, unpairRec.Body.String(), http.StatusNotFound)
	}
}

func TestAPITeamProjectAuditUsesActingUser(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()
	api := NewAPI(store, "test-token")
	if err := api.SetMode(ModeUser); err != nil {
		t.Fatalf("SetMode() error = %v", err)
	}
	handler := api.Handler()
	auth := loginAuth(t, handler, "admin@example.com")
	adminUserID, ok, err := store.UserIDForSessionToken(auth.session.Value)
	if err != nil || !ok {
		t.Fatalf("UserIDForSessionToken() = %q/%v/%v, want admin", adminUserID, ok, err)
	}
	joinedAt := time.Now().UTC().Add(-time.Hour)
	_, err = store.db.Exec(
		`INSERT INTO organization_memberships (organization_id, user_id, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
		defaultOrganizationID,
		adminUserID,
		RoleAdmin,
		timeText(&joinedAt),
		timeText(&joinedAt),
	)
	if err != nil {
		t.Fatalf("upsert admin membership error = %v", err)
	}

	team := requestWithSession[TeamRecord](t, handler, auth, http.MethodPost, "/v1/teams", CreateTeamRequest{Name: "Audited"})
	project := requestWithSession[ProjectRecord](t, handler, auth, http.MethodPost, "/v1/projects", CreateProjectRequest{Name: "Audited Project", TeamID: team.TeamID})
	if project.TeamID != team.TeamID {
		t.Fatalf("project.TeamID = %q, want %q", project.TeamID, team.TeamID)
	}
	policy := requestWithSession[ApprovalPolicyRecord](t, handler, auth, http.MethodPost, "/v1/policies", CreateApprovalPolicyRequest{Name: "Audited Policy", Template: PolicyTemplateOwnerOnly})
	_ = requestWithSession[map[string]string](t, handler, auth, http.MethodDelete, "/v1/policies/"+policy.PolicyID, nil)
	_ = requestWithSession[OnCallScheduleRecord](t, handler, auth, http.MethodPost, "/v1/teams/"+team.TeamID+"/on-call", UpsertOnCallScheduleRequest{PrimaryUserID: adminUserID})
	for _, eventType := range []string{"team.created", "project.created", "approval_policy.created", "approval_policy.deleted", "team_on_call.upserted"} {
		var actor string
		if err := store.db.QueryRow("SELECT user_id FROM audit_events WHERE event_type = ? ORDER BY id DESC LIMIT 1", eventType).Scan(&actor); err != nil {
			t.Fatalf("query audit %s error = %v", eventType, err)
		}
		if actor != adminUserID {
			t.Fatalf("audit %s user_id = %q, want acting user %q", eventType, actor, adminUserID)
		}
	}
}

func request[T any](t *testing.T, handler http.Handler, method string, path string, input any) T {
	t.Helper()
	return requestWithBearer[T](t, handler, "test-token", method, path, input)
}

func requestWithBearer[T any](t *testing.T, handler http.Handler, token string, method string, path string, input any) T {
	t.Helper()

	rec := statusWithBearer(t, handler, token, method, path, input)
	if rec.Code < 200 || rec.Code >= 300 {
		t.Fatalf("%s %s status = %d body = %s", method, path, rec.Code, rec.Body.String())
	}

	var output T
	if err := json.NewDecoder(rec.Body).Decode(&output); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	return output
}

func statusWithBearer(t *testing.T, handler http.Handler, token string, method string, path string, input any) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}

	req := httptest.NewRequest(method, path, &body)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
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

type billingOnlyStore struct {
	*FileStore
	status BillingStatus
	err    error
}

func (s *billingOnlyStore) BillingStatus(string) (BillingStatus, error) {
	if s.err != nil {
		return BillingStatus{}, s.err
	}
	return s.status, nil
}

type fakeBillingProvider struct {
	portalURL string
	payload   []byte
	signature string
}

func (p *fakeBillingProvider) PortalURL(string) string {
	return p.portalURL
}

func (p *fakeBillingProvider) HandleWebhook(payload []byte, signature string) error {
	p.payload = append([]byte(nil), payload...)
	p.signature = signature
	return nil
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
