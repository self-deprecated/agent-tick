package approval

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
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
