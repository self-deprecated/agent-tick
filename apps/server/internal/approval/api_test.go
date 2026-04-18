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
	"testing"
	"time"
)

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
		CreateRequest{Title: "Run command?"},
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

func TestAPIRejectsInvalidMode(t *testing.T) {
	api := NewAPI(NewFileStore(filepath.Join(t.TempDir(), "agent-tick.json")), "test-token")

	if err := api.SetMode("workspace"); err == nil {
		t.Fatal("SetMode() error = nil, want error")
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
	credential, err := store.CreateAgentToken("codex", []string{"approval:write", "approval:read"})
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
