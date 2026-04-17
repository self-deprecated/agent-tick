package approval

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

type API struct {
	store    Store
	pairings PairingStore
	agents   AgentStore
	push     *PushSender
	token    string
}

func NewAPI(store Store, token string) *API {
	api := &API{store: store, push: NewPushSender(), token: token}
	if pairings, ok := store.(PairingStore); ok {
		api.pairings = pairings
	}
	if agents, ok := store.(AgentStore); ok {
		api.agents = agents
	}
	return api
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("POST /v1/approval-requests", a.create)
	mux.HandleFunc("GET /v1/approval-requests", a.list)
	mux.HandleFunc("GET /v1/approval-requests/{id}", a.get)
	mux.HandleFunc("POST /v1/approval-requests/{id}/responses", a.respond)
	mux.HandleFunc("POST /v1/pairing-tokens", a.createPairingToken)
	mux.HandleFunc("POST /v1/devices/pair", a.pairDevice)
	mux.HandleFunc("POST /v1/devices/{id}/push-token", a.setDevicePushToken)
	return a.withAuth(a.withCORS(mux))
}

func (a *API) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var input CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request JSON")
		return
	}
	if strings.TrimSpace(input.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	request, err := a.store.Create(input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.sendPush(request)
	writeJSON(w, http.StatusCreated, request)
}

func (a *API) list(w http.ResponseWriter, r *http.Request) {
	requests, err := a.store.List(r.URL.Query().Get("status"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, requests)
}

func (a *API) get(w http.ResponseWriter, r *http.Request) {
	request, err := a.store.Get(r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "approval request not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, request)
}

func (a *API) respond(w http.ResponseWriter, r *http.Request) {
	var response Response
	if err := json.NewDecoder(r.Body).Decode(&response); err != nil {
		writeError(w, http.StatusBadRequest, "invalid response JSON")
		return
	}
	if strings.TrimSpace(response.ChoiceID) == "" {
		writeError(w, http.StatusBadRequest, "choiceId is required")
		return
	}

	request, err := a.store.Respond(r.PathValue("id"), response)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "approval request not found")
		return
	}
	if errors.Is(err, ErrInvalidChoice) {
		writeError(w, http.StatusBadRequest, "choiceId is not allowed for this request")
		return
	}
	if errors.Is(err, ErrAlreadyResponded) {
		writeError(w, http.StatusConflict, "approval request already has a response")
		return
	}
	if errors.Is(err, ErrExpired) {
		writeError(w, http.StatusConflict, "approval request has expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, request)
}

func (a *API) createPairingToken(w http.ResponseWriter, _ *http.Request) {
	if a.pairings == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not supported by this store")
		return
	}

	token, err := a.pairings.CreatePairingToken(10 * time.Minute)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, token)
}

func (a *API) pairDevice(w http.ResponseWriter, r *http.Request) {
	if a.pairings == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not supported by this store")
		return
	}

	var input PairDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid pairing JSON")
		return
	}

	credential, err := a.pairings.PairDevice(input.Token, input.DeviceName)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusUnauthorized, "invalid or expired pairing token")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, credential)
}

func (a *API) setDevicePushToken(w http.ResponseWriter, r *http.Request) {
	if a.pairings == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not supported by this store")
		return
	}

	var input PushTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid push token JSON")
		return
	}
	if strings.TrimSpace(input.Token) == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	deviceID := r.PathValue("id")
	if !a.canManageDevice(r, deviceID) {
		writeError(w, http.StatusUnauthorized, "missing or invalid bearer token")
		return
	}

	if err := a.pairings.SetDevicePushToken(deviceID, input.Token); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "device not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) sendPush(request ApprovalRequest) {
	if a.pairings == nil || a.push == nil {
		return
	}
	tokens, err := a.pairings.ListDevicePushTokens()
	if err != nil {
		return
	}
	_ = a.push.SendApprovalRequest(tokens, request)
}

func (a *API) canManageDevice(r *http.Request, deviceID string) bool {
	token := bearerToken(r)
	if a.token != "" && tokenMatches(token, a.token) {
		return true
	}
	if a.pairings == nil {
		return false
	}
	ok, err := a.pairings.VerifyDeviceTokenForDevice(deviceID, token)
	return err == nil && ok
}

func (a *API) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions || r.URL.Path == "/healthz" || r.URL.Path == "/v1/devices/pair" {
			next.ServeHTTP(w, r)
			return
		}
		if a.token == "" && isLoopback(r.RemoteAddr) {
			next.ServeHTTP(w, r)
			return
		}

		token := bearerToken(r)
		if a.token != "" && tokenMatches(token, a.token) {
			next.ServeHTTP(w, r)
			return
		}
		if a.agents != nil {
			ok, err := a.agents.VerifyAgentToken(token, requiredScope(r))
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			if ok {
				next.ServeHTTP(w, r)
				return
			}
		}
		if a.pairings != nil && token != "" {
			ok, err := a.pairings.VerifyDeviceToken(token)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			if ok {
				next.ServeHTTP(w, r)
				return
			}
		}
		writeError(w, http.StatusUnauthorized, "missing or invalid bearer token")
	})
}

func requiredScope(r *http.Request) string {
	if r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests" {
		return "approval:write"
	}
	if strings.HasPrefix(r.URL.Path, "/v1/approval-requests") && r.Method == http.MethodGet {
		return "approval:read"
	}
	return "admin"
}

func bearerToken(r *http.Request) string {
	value := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(value, "Bearer ")
	if !ok {
		return ""
	}
	return token
}

func tokenMatches(got string, want string) bool {
	if got == "" || want == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (a *API) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
