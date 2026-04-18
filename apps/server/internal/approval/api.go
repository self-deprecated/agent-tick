package approval

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"rsc.io/qr"
)

type API struct {
	store            Store
	scopedStore      UserScopedStore
	pairings         PairingStore
	scopedPairings   UserScopedPairingStore
	agents           AgentStore
	scopedAgents     UserScopedAgentStore
	push             *PushSender
	events           *EventHub
	userTokens       UserTokenStore
	accounts         UserAccountStore
	token            string
	mode             string
	publicURL        string
	requireSignature bool
}

const (
	ModeSingle = "single"
	ModeUser   = "user"
)

func NewAPI(store Store, token string) *API {
	api := &API{store: store, push: NewPushSender(), events: NewEventHub(), token: token, mode: ModeSingle}
	if scopedStore, ok := store.(UserScopedStore); ok {
		api.scopedStore = scopedStore
	}
	if pairings, ok := store.(PairingStore); ok {
		api.pairings = pairings
	}
	if scopedPairings, ok := store.(UserScopedPairingStore); ok {
		api.scopedPairings = scopedPairings
	}
	if agents, ok := store.(AgentStore); ok {
		api.agents = agents
	}
	if scopedAgents, ok := store.(UserScopedAgentStore); ok {
		api.scopedAgents = scopedAgents
	}
	if userTokens, ok := store.(UserTokenStore); ok {
		api.userTokens = userTokens
	}
	if accounts, ok := store.(UserAccountStore); ok {
		api.accounts = accounts
	}
	return api
}

const sessionCookieName = "agent_tick_session"

type authContext struct {
	UserID string
}

type authContextKey struct{}

func withAuthContext(r *http.Request, auth authContext) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), authContextKey{}, auth))
}

func currentAuth(r *http.Request) authContext {
	auth, ok := r.Context().Value(authContextKey{}).(authContext)
	if !ok || auth.UserID == "" {
		return authContext{UserID: defaultUserID}
	}
	return auth
}

func (a *API) createForUser(userID string, input CreateRequest) (ApprovalRequest, error) {
	if a.scopedStore != nil {
		return a.scopedStore.CreateForUser(userID, input)
	}
	return a.store.Create(input)
}

func (a *API) listForUser(userID string, status string) ([]ApprovalRequest, error) {
	if a.scopedStore != nil {
		return a.scopedStore.ListForUser(userID, status)
	}
	return a.store.List(status)
}

func (a *API) getForUser(userID string, id string) (ApprovalRequest, error) {
	if a.scopedStore != nil {
		return a.scopedStore.GetForUser(userID, id)
	}
	return a.store.Get(id)
}

func (a *API) respondForUser(userID string, id string, response Response) (ApprovalRequest, error) {
	if a.scopedStore != nil {
		return a.scopedStore.RespondForUser(userID, id, response)
	}
	return a.store.Respond(id, response)
}

func (a *API) createPairingTokenForUser(userID string, ttl time.Duration) (PairingToken, error) {
	if a.scopedPairings != nil {
		return a.scopedPairings.CreatePairingTokenForUser(userID, ttl)
	}
	return a.pairings.CreatePairingToken(ttl)
}

func (a *API) listDevicesForUser(userID string) ([]DeviceRecord, error) {
	if a.scopedPairings != nil {
		return a.scopedPairings.ListDevicesForUser(userID)
	}
	return a.pairings.ListDevices()
}

func (a *API) listDevicePushTokensForUser(userID string) ([]string, error) {
	if a.scopedPairings != nil {
		return a.scopedPairings.ListDevicePushTokensForUser(userID)
	}
	return a.pairings.ListDevicePushTokens()
}

func (a *API) createAgentTokenForUser(userID string, name string, scopes []string) (AgentCredential, error) {
	if a.scopedAgents != nil {
		return a.scopedAgents.CreateAgentTokenForUser(userID, name, scopes)
	}
	return a.agents.CreateAgentToken(name, scopes)
}

func (a *API) listAgentTokensForUser(userID string) ([]AgentTokenRecord, error) {
	if a.scopedAgents != nil {
		return a.scopedAgents.ListAgentTokensForUser(userID)
	}
	return a.agents.ListAgentTokens()
}

func (a *API) SetMode(mode string) error {
	switch strings.TrimSpace(mode) {
	case "", ModeSingle:
		a.mode = ModeSingle
	case ModeUser:
		a.mode = ModeUser
	default:
		return errors.New("invalid AGENT_TICK_MODE")
	}
	return nil
}

func (a *API) SetPublicURL(url string) {
	a.publicURL = strings.TrimRight(strings.TrimSpace(url), "/")
}

func (a *API) RequireSignatures(required bool) {
	a.requireSignature = required
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", a.admin)
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("GET /v1/session", a.session)
	mux.HandleFunc("POST /v1/session", a.login)
	mux.HandleFunc("POST /v1/approval-requests", a.create)
	mux.HandleFunc("GET /v1/approval-requests", a.list)
	mux.HandleFunc("GET /v1/approval-requests/{id}", a.get)
	mux.HandleFunc("POST /v1/approval-requests/{id}/responses", a.respond)
	mux.HandleFunc("POST /v1/pairing-tokens", a.createPairingToken)
	mux.HandleFunc("GET /v1/devices", a.listDevices)
	mux.HandleFunc("POST /v1/devices/pair", a.pairDevice)
	mux.HandleFunc("POST /v1/devices/{id}/push-token", a.setDevicePushToken)
	mux.HandleFunc("POST /v1/devices/{id}/unpair", a.unpairDevice)
	mux.HandleFunc("GET /v1/agent-tokens", a.listAgentTokens)
	mux.HandleFunc("POST /v1/agent-tokens", a.createAgentToken)
	mux.HandleFunc("POST /v1/agent-tokens/{id}/revoke", a.revokeAgentToken)
	mux.HandleFunc("GET /v1/events", a.eventsSocket)
	return a.withAuth(a.withCORS(mux))
}

func (a *API) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) session(w http.ResponseWriter, r *http.Request) {
	if a.mode != ModeUser {
		writeError(w, http.StatusNotFound, "user login is disabled")
		return
	}
	if a.accounts == nil {
		writeError(w, http.StatusNotImplemented, "user accounts are not supported by this store")
		return
	}
	userID, ok, err := a.userIDFromSessionCookie(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "not signed in")
		return
	}
	writeJSON(w, http.StatusOK, SessionCredential{UserID: userID})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if a.mode != ModeUser {
		writeError(w, http.StatusNotFound, "user login is disabled")
		return
	}
	if a.accounts == nil {
		writeError(w, http.StatusNotImplemented, "user accounts are not supported by this store")
		return
	}
	var input LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid login JSON")
		return
	}
	session, err := a.accounts.LoginOrCreateUser(input.Email, input.Password, input.Name, 30*24*time.Hour)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    session.Token,
		Path:     "/",
		Expires:  session.Expiry,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	session.Token = ""
	writeJSON(w, http.StatusOK, session)
}

func (a *API) create(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read request body")
		return
	}
	if a.requireSignature {
		if err := verifySignature(r, body, time.Now().UTC()); err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
	}

	var input CreateRequest
	if err := json.Unmarshal(body, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request JSON")
		return
	}
	if strings.TrimSpace(input.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	request, err := a.createForUser(currentAuth(r).UserID, input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.sendPush(request)
	a.events.Publish(Event{Type: "approval.created", RequestID: request.ID})
	writeJSON(w, http.StatusCreated, request)
}

func (a *API) list(w http.ResponseWriter, r *http.Request) {
	requests, err := a.listForUser(currentAuth(r).UserID, r.URL.Query().Get("status"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, requests)
}

func (a *API) get(w http.ResponseWriter, r *http.Request) {
	request, err := a.getForUser(currentAuth(r).UserID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "approval request not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.events.Publish(Event{Type: "approval.responded", RequestID: request.ID})
	writeJSON(w, http.StatusOK, request)
}

func (a *API) eventsSocket(w http.ResponseWriter, r *http.Request) {
	_ = a.events.Subscribe(w, r)
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

	request, err := a.respondForUser(currentAuth(r).UserID, r.PathValue("id"), response)
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

func (a *API) createPairingToken(w http.ResponseWriter, r *http.Request) {
	if a.pairings == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not supported by this store")
		return
	}

	token, err := a.createPairingTokenForUser(currentAuth(r).UserID, 10*time.Minute)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	token.QRDataURL = a.pairingQRDataURL(r, token.Token)
	writeJSON(w, http.StatusCreated, token)
}

func (a *API) listDevices(w http.ResponseWriter, r *http.Request) {
	if a.pairings == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not supported by this store")
		return
	}
	devices, err := a.listDevicesForUser(currentAuth(r).UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, devices)
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

func (a *API) listAgentTokens(w http.ResponseWriter, r *http.Request) {
	if a.agents == nil {
		writeError(w, http.StatusNotImplemented, "agent tokens are not supported by this store")
		return
	}
	records, err := a.listAgentTokensForUser(currentAuth(r).UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, records)
}

func (a *API) createAgentToken(w http.ResponseWriter, r *http.Request) {
	if a.agents == nil {
		writeError(w, http.StatusNotImplemented, "agent tokens are not supported by this store")
		return
	}
	var input CreateAgentTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent token JSON")
		return
	}
	if len(input.Scopes) == 0 {
		input.Scopes = []string{"approval:write"}
	}
	credential, err := a.createAgentTokenForUser(currentAuth(r).UserID, input.Name, input.Scopes)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, credential)
}

func (a *API) unpairDevice(w http.ResponseWriter, r *http.Request) {
	if a.pairings == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not supported by this store")
		return
	}
	deviceID := r.PathValue("id")
	if err := a.pairings.UnpairDevice(deviceID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "device not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) revokeAgentToken(w http.ResponseWriter, r *http.Request) {
	if a.agents == nil {
		writeError(w, http.StatusNotImplemented, "agent tokens are not supported by this store")
		return
	}
	agentID := r.PathValue("id")
	if err := a.agents.RevokeAgentToken(agentID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "agent token not found")
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
	tokens, err := a.listDevicePushTokensForUser(request.UserID)
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
	if a.userTokens != nil {
		userID, ok, err := a.userTokens.UserIDForDeviceTokenForDevice(deviceID, token)
		return err == nil && ok && userID == currentAuth(r).UserID
	}
	ok, err := a.pairings.VerifyDeviceTokenForDevice(deviceID, token)
	return err == nil && ok
}

func (a *API) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions || r.URL.Path == "/healthz" || r.URL.Path == "/v1/devices/pair" || r.URL.Path == "/v1/session" || (r.Method == http.MethodGet && r.URL.Path == "/") {
			next.ServeHTTP(w, withAuthContext(r, authContext{UserID: defaultUserID}))
			return
		}
		if a.mode == ModeUser && a.accounts != nil {
			userID, ok, err := a.userIDFromSessionCookie(r)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			if ok {
				next.ServeHTTP(w, withAuthContext(r, authContext{UserID: userID}))
				return
			}
		}
		if a.token == "" && isLoopback(r.RemoteAddr) {
			next.ServeHTTP(w, withAuthContext(r, authContext{UserID: defaultUserID}))
			return
		}

		token := bearerToken(r)
		if a.token != "" && tokenMatches(token, a.token) {
			next.ServeHTTP(w, withAuthContext(r, authContext{UserID: defaultUserID}))
			return
		}
		if a.userTokens != nil {
			if a.agents != nil {
				userID, ok, err := a.userTokens.UserIDForAgentToken(token, requiredScope(r))
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				if ok {
					next.ServeHTTP(w, withAuthContext(r, authContext{UserID: userID}))
					return
				}
			}
			if a.pairings != nil && token != "" {
				userID, ok, err := a.userTokens.UserIDForDeviceToken(token)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				if ok {
					next.ServeHTTP(w, withAuthContext(r, authContext{UserID: userID}))
					return
				}
			}
		}
		if a.agents != nil {
			ok, err := a.agents.VerifyAgentToken(token, requiredScope(r))
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			if ok {
				next.ServeHTTP(w, withAuthContext(r, authContext{UserID: defaultUserID}))
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
				next.ServeHTTP(w, withAuthContext(r, authContext{UserID: defaultUserID}))
				return
			}
		}
		writeError(w, http.StatusUnauthorized, "missing or invalid bearer token")
	})
}

func (a *API) userIDFromSessionCookie(r *http.Request) (string, bool, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return "", false, nil
	}
	return a.accounts.UserIDForSessionToken(cookie.Value)
}

func requiredScope(r *http.Request) string {
	if r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests" {
		return "approval:write"
	}
	if r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests" {
		return "approval:read"
	}
	if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/approval-requests/") {
		return "approval:write"
	}
	return "admin"
}

func bearerToken(r *http.Request) string {
	value := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(value, "Bearer ")
	if !ok {
		return r.URL.Query().Get("token")
	}
	return token
}

func (a *API) pairingQRDataURL(r *http.Request, pairingCode string) string {
	serverURL := a.publicURL
	if serverURL == "" {
		serverURL = publicServerURL(r)
	}
	payload, err := json.Marshal(map[string]string{
		"serverURL":   serverURL,
		"pairingCode": pairingCode,
	})
	if err != nil {
		return ""
	}
	code, err := qr.Encode(string(payload), qr.M)
	if err != nil {
		return ""
	}
	code.Scale = 6
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(code.PNG())
}

func publicServerURL(r *http.Request) string {
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return proto + "://" + host
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
