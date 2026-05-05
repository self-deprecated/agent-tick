package approval

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
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
	events           eventBus
	userTokens       UserTokenStore
	accounts         UserAccountStore
	organizations    OrganizationStore
	teamsProjects    TeamProjectStore
	policies         ApprovalPolicyStore
	presence         PresenceStore
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
	if organizations, ok := store.(OrganizationStore); ok {
		api.organizations = organizations
	}
	if teamsProjects, ok := store.(TeamProjectStore); ok {
		api.teamsProjects = teamsProjects
	}
	if policies, ok := store.(ApprovalPolicyStore); ok {
		api.policies = policies
	}
	if presence, ok := store.(PresenceStore); ok {
		api.presence = presence
	}
	return api
}

const sessionCookieName = "agent_tick_session"
const csrfCookieName = "agent_tick_csrf"
const csrfHeaderName = "X-Agent-Tick-CSRF"

type authContext struct {
	UserID                string
	OrganizationID        string
	Role                  string
	AgentID               string
	ProjectID             string
	OwnerUserID           string
	TeamID                string
	DefaultApprovalPolicy string
	FromSession           bool
	Source                string
}

const (
	authSourceAdmin    = "admin"
	authSourceAgent    = "agent"
	authSourceDevice   = "device"
	authSourceSession  = "session"
	authSourceLoopback = "loopback"
)

type authContextKey struct{}

func withAuthContext(r *http.Request, auth authContext) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), authContextKey{}, auth))
}

func currentAuth(r *http.Request) authContext {
	auth, ok := r.Context().Value(authContextKey{}).(authContext)
	if !ok || auth.UserID == "" {
		return authContext{UserID: defaultUserID, OrganizationID: defaultOrganizationID, Role: RoleOwner}
	}
	if strings.TrimSpace(auth.OrganizationID) == "" {
		auth.OrganizationID = defaultOrganizationID
	}
	if strings.TrimSpace(auth.Role) == "" {
		auth.Role = RoleOwner
	}
	return auth
}

func (a *API) authContextForUser(userID string, source string, fromSession bool) (authContext, error) {
	if strings.TrimSpace(userID) == "" {
		userID = defaultUserID
	}
	auth := authContext{UserID: userID, OrganizationID: defaultOrganizationID, Role: RoleOwner, FromSession: fromSession, Source: source}
	if a.organizations == nil {
		return auth, nil
	}
	membership, err := a.organizations.DefaultOrganizationForUser(userID)
	if errors.Is(err, ErrNotFound) {
		return auth, nil
	}
	if err != nil {
		return authContext{}, err
	}
	auth.OrganizationID = membership.OrganizationID
	auth.Role = membership.Role
	return auth, nil
}

func roleAllows(role string, required string) bool {
	return roleRank(role) >= roleRank(required)
}

func roleRank(role string) int {
	switch strings.TrimSpace(role) {
	case RoleOwner:
		return 4
	case RoleAdmin:
		return 3
	case RoleApprover:
		return 2
	case RoleViewer:
		return 1
	default:
		return 0
	}
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

func (a *API) respondForUser(auth authContext, id string, response Response) (ApprovalRequest, error) {
	if policyStore, ok := a.store.(PolicyResponseStore); ok {
		return policyStore.RespondForUserWithAuth(auth, id, response)
	}
	if a.scopedStore != nil {
		return a.scopedStore.RespondForUser(auth.UserID, id, response)
	}
	return a.store.Respond(id, response)
}

func (a *API) abandonForUser(userID string, id string, reason string) (ApprovalRequest, bool, error) {
	if a.scopedStore != nil {
		if store, ok := a.scopedStore.(UserScopedStoreWithAbandonReason); ok {
			return store.AbandonForUserWithReason(userID, id, reason)
		}
		return a.scopedStore.AbandonForUser(userID, id)
	}
	if store, ok := a.store.(StoreWithAbandonReason); ok {
		return store.AbandonWithReason(id, reason)
	}
	return a.store.Abandon(id)
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

func (a *API) unpairDeviceForUser(userID string, deviceID string) error {
	if a.scopedPairings != nil {
		return a.scopedPairings.UnpairDeviceForUser(userID, deviceID)
	}
	return a.pairings.UnpairDevice(deviceID)
}

func (a *API) createAgentTokenForUser(userID string, input CreateAgentTokenRequest) (AgentCredential, error) {
	if options, ok := a.scopedAgents.(UserScopedAgentTokenOptionsStore); ok {
		return options.CreateAgentTokenForUserWithOptions(userID, input)
	}
	if a.scopedAgents != nil {
		return a.scopedAgents.CreateAgentTokenForUser(userID, input.Name, input.Scopes)
	}
	if options, ok := a.agents.(AgentTokenOptionsStore); ok {
		return options.CreateAgentTokenWithOptions(input)
	}
	return a.agents.CreateAgentToken(input.Name, input.Scopes)
}

func (a *API) listAgentTokensForUser(userID string) ([]AgentTokenRecord, error) {
	if a.scopedAgents != nil {
		return a.scopedAgents.ListAgentTokensForUser(userID)
	}
	return a.agents.ListAgentTokens()
}

func (a *API) revokeAgentTokenForUser(userID string, agentID string) error {
	if a.scopedAgents != nil {
		return a.scopedAgents.RevokeAgentTokenForUser(userID, agentID)
	}
	return a.agents.RevokeAgentToken(agentID)
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
	mux.HandleFunc("GET /assets/", a.adminAsset)
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("GET /v1/session", a.session)
	mux.HandleFunc("POST /v1/session", a.login)
	mux.HandleFunc("POST /v1/approval-requests", a.create)
	mux.HandleFunc("GET /v1/approval-requests", a.list)
	mux.HandleFunc("GET /v1/approval-requests/{id}", a.get)
	mux.HandleFunc("POST /v1/approval-requests/{id}/responses", a.respond)
	mux.HandleFunc("POST /v1/approval-requests/{id}/abandon", a.abandon)
	mux.HandleFunc("POST /v1/pairing-tokens", a.createPairingToken)
	mux.HandleFunc("GET /v1/devices", a.listDevices)
	mux.HandleFunc("GET /v1/organizations", a.listOrganizations)
	mux.HandleFunc("POST /v1/organizations", a.createOrganization)
	mux.HandleFunc("GET /v1/teams", a.listTeams)
	mux.HandleFunc("POST /v1/teams", a.createTeam)
	mux.HandleFunc("GET /v1/teams/{id}", a.getTeam)
	mux.HandleFunc("POST /v1/teams/{id}", a.updateTeam)
	mux.HandleFunc("GET /v1/teams/{id}/members", a.listTeamMembers)
	mux.HandleFunc("POST /v1/teams/{id}/members", a.upsertTeamMember)
	mux.HandleFunc("DELETE /v1/teams/{id}/members/{userID}", a.removeTeamMember)
	mux.HandleFunc("GET /v1/teams/{id}/availability", a.listTeamAvailability)
	mux.HandleFunc("GET /v1/teams/{id}/coverage", a.getTeamCoverage)
	mux.HandleFunc("GET /v1/teams/{id}/on-call", a.listOnCallSchedules)
	mux.HandleFunc("POST /v1/teams/{id}/on-call", a.upsertOnCallSchedule)
	mux.HandleFunc("POST /v1/heartbeat", a.recordHeartbeat)
	mux.HandleFunc("GET /v1/availability", a.getAvailability)
	mux.HandleFunc("POST /v1/availability", a.setAvailability)
	mux.HandleFunc("GET /v1/projects", a.listProjects)
	mux.HandleFunc("POST /v1/projects", a.createProject)
	mux.HandleFunc("GET /v1/projects/{id}", a.getProject)
	mux.HandleFunc("POST /v1/projects/{id}", a.updateProject)
	mux.HandleFunc("GET /v1/policies", a.listPolicies)
	mux.HandleFunc("POST /v1/policies", a.createPolicy)
	mux.HandleFunc("GET /v1/policies/{id}", a.getPolicy)
	mux.HandleFunc("POST /v1/policies/{id}", a.updatePolicy)
	mux.HandleFunc("DELETE /v1/policies/{id}", a.deletePolicy)
	mux.HandleFunc("GET /v1/policies/{id}/preview", a.previewPolicy)
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
	csrfToken := "csrf_" + newID()
	secureCookie := secureSessionCookie(r, a.publicURL)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    session.Token,
		Path:     "/",
		Expires:  session.Expiry,
		HttpOnly: true,
		Secure:   secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    csrfToken,
		Path:     "/",
		Expires:  session.Expiry,
		Secure:   secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
	session.Token = ""
	writeJSON(w, http.StatusOK, session)
}

func (a *API) resolveRequestPolicy(auth authContext, input *CreateRequest) error {
	if a.policies == nil {
		return nil
	}
	if input.Metadata == nil {
		input.Metadata = map[string]string{}
	}
	projectID := strings.TrimSpace(input.Metadata["projectId"])
	if projectID == "" && strings.HasPrefix(strings.TrimSpace(input.Requester.ProjectID), "prj_") {
		projectID = strings.TrimSpace(input.Requester.ProjectID)
	}
	hint := strings.TrimSpace(input.Metadata["approvalPolicy"])
	policyID, err := a.policies.ResolveApprovalPolicy(auth.OrganizationID, projectID, hint)
	if err != nil {
		return err
	}
	if policyID != "" {
		input.Metadata["effectiveApprovalPolicy"] = policyID
		if hint == "" {
			input.Metadata["approvalPolicy"] = policyID
		}
	}
	return nil
}

func applyAgentRouting(input *CreateRequest, auth authContext) error {
	if auth.Source != authSourceAgent || strings.TrimSpace(auth.AgentID) == "" {
		return nil
	}
	if input.Metadata == nil {
		input.Metadata = map[string]string{}
	}
	if auth.ProjectID != "" {
		requestedProjectID := strings.TrimSpace(input.Metadata["projectId"])
		if requestedProjectID == "" && strings.HasPrefix(strings.TrimSpace(input.Requester.ProjectID), "prj_") {
			requestedProjectID = strings.TrimSpace(input.Requester.ProjectID)
		}
		if requestedProjectID != "" && requestedProjectID != auth.ProjectID {
			return errors.New("agent token cannot route approvals to this project")
		}
		if input.Requester.ProjectID != "" && input.Requester.ProjectID != auth.ProjectID {
			input.Metadata["clientProjectId"] = input.Requester.ProjectID
		}
		input.Requester.ProjectID = auth.ProjectID
		input.Metadata["projectId"] = auth.ProjectID
	}

	requestedOwnerUserID := strings.TrimSpace(input.Metadata["ownerUserId"])
	if auth.OwnerUserID != "" {
		if requestedOwnerUserID != "" && requestedOwnerUserID != auth.OwnerUserID {
			return errors.New("agent token cannot route approvals to this owner")
		}
		input.Metadata["ownerUserId"] = auth.OwnerUserID
	} else if requestedOwnerUserID != "" {
		return errors.New("agent token cannot route approvals to an owner")
	}

	requestedTeamID := strings.TrimSpace(input.Metadata["teamId"])
	if requestedTeamID == "" {
		requestedTeamID = strings.TrimSpace(input.Metadata["team"])
	}
	if auth.TeamID != "" {
		if requestedTeamID != "" && requestedTeamID != auth.TeamID {
			return errors.New("agent token cannot route approvals to this team")
		}
		input.Metadata["teamId"] = auth.TeamID
	} else if requestedTeamID != "" {
		return errors.New("agent token cannot route approvals to a team")
	}

	requestedPolicy := strings.TrimSpace(input.Metadata["approvalPolicy"])
	if auth.DefaultApprovalPolicy != "" {
		if requestedPolicy != "" && requestedPolicy != auth.DefaultApprovalPolicy {
			return errors.New("agent token cannot use this approval policy")
		}
		input.Metadata["approvalPolicy"] = auth.DefaultApprovalPolicy
	} else if requestedPolicy != "" {
		return errors.New("agent token cannot use an approval policy")
	}
	return nil
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

	auth := currentAuth(r)
	if err := applyAgentRouting(&input, auth); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.resolveRequestPolicy(auth, &input); err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalidRequest) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	request, err := a.createForUser(auth.UserID, input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.sendPush(request)
	if auth.AgentID != "" {
		if recorder, ok := a.agents.(AgentRequestRecorder); ok {
			if err := recorder.RecordAgentRequest(auth.AgentID, request.CreatedAt); err != nil {
				log.Printf("record agent request for %s: %v", auth.AgentID, err)
			}
		}
	}
	a.events.Publish(Event{Type: "approval.created", RequestID: request.ID})
	writeJSON(w, http.StatusCreated, a.withPolicyProgress(request, auth.UserID))
}

func (a *API) list(w http.ResponseWriter, r *http.Request) {
	a.publishExpiredRequests()
	auth := currentAuth(r)
	requests, err := a.listForUser(auth.UserID, r.URL.Query().Get("status"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for i := range requests {
		requests[i] = a.withPolicyProgress(requests[i], auth.UserID)
	}
	writeJSON(w, http.StatusOK, requests)
}

func (a *API) get(w http.ResponseWriter, r *http.Request) {
	a.publishExpiredRequests()
	auth := currentAuth(r)
	request, err := a.getForUser(auth.UserID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "approval request not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.withPolicyProgress(request, auth.UserID))
}

func (a *API) withPolicyProgress(request ApprovalRequest, currentUserID string) ApprovalRequest {
	request.PolicyProgress = a.policyProgressForRequest(request.ID, currentUserID)
	return request
}

func (a *API) publishExpiredRequests() {
	expiring, ok := a.store.(ExpiringStore)
	if !ok {
		return
	}
	expiredIDs, err := expiring.ExpirePendingRequests()
	if err != nil {
		log.Printf("expire pending approval requests: %v", err)
		return
	}
	for _, requestID := range expiredIDs {
		a.events.Publish(Event{Type: "approval.expired", RequestID: requestID})
	}
}

func (a *API) policyProgressForRequest(requestID string, currentUserID string) *ApprovalPolicyProgress {
	progressStore, ok := a.store.(PolicyProgressStore)
	if !ok || strings.TrimSpace(requestID) == "" {
		return nil
	}
	progress, err := progressStore.PolicyProgressForRequest(requestID, currentUserID)
	if err != nil {
		log.Printf("load policy progress for request %s: %v", requestID, err)
		return nil
	}
	return progress
}

func (a *API) eventsSocket(w http.ResponseWriter, r *http.Request) {
	_ = a.events.Subscribe(w, r)
}

func (a *API) respond(w http.ResponseWriter, r *http.Request) {
	a.publishExpiredRequests()
	var response Response
	if err := json.NewDecoder(r.Body).Decode(&response); err != nil {
		writeError(w, http.StatusBadRequest, "invalid response JSON")
		return
	}
	if strings.TrimSpace(response.ChoiceID) == "" && len(response.Answers) == 0 {
		writeError(w, http.StatusBadRequest, "choiceId or answers is required")
		return
	}

	auth := currentAuth(r)
	previousProgress := a.policyProgressForRequest(r.PathValue("id"), auth.UserID)
	request, err := a.respondForUser(auth, r.PathValue("id"), response)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "approval request not found")
		return
	}
	if errors.Is(err, ErrInvalidChoice) {
		writeError(w, http.StatusBadRequest, "choiceId is not allowed for this request")
		return
	}
	if errors.Is(err, ErrInvalidResponse) || errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
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
	if errors.Is(err, ErrAbandoned) {
		writeError(w, http.StatusConflict, "approval request has been abandoned")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	request = a.withPolicyProgress(request, auth.UserID)
	if request.PolicyProgress != nil && request.PolicyProgress.PolicyID != "" {
		a.events.Publish(Event{Type: "approval.vote_recorded", RequestID: request.ID})
		if request.Status == StatusPending && previousProgress != nil && request.PolicyProgress.CurrentStep > previousProgress.CurrentStep {
			a.events.Publish(Event{Type: "approval.step_advanced", RequestID: request.ID})
			a.sendPush(request)
		}
	}
	if request.Status == StatusResponded {
		if request.PolicyProgress != nil && request.PolicyProgress.PolicyID != "" {
			a.events.Publish(Event{Type: "approval.final_decision", RequestID: request.ID})
		}
		a.events.Publish(Event{Type: "approval.responded", RequestID: request.ID})
	}
	writeJSON(w, http.StatusOK, request)
}

func (a *API) abandon(w http.ResponseWriter, r *http.Request) {
	a.publishExpiredRequests()
	auth := currentAuth(r)
	if auth.FromSession || auth.Source == authSourceDevice {
		writeError(w, http.StatusForbidden, "only the request creator can abandon approval requests")
		return
	}

	var input struct {
		Reason          string `json:"reason,omitempty"`
		ClientRequestID string `json:"clientRequestId,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid abandon JSON")
		return
	}
	if strings.TrimSpace(input.Reason) != "" {
		log.Printf("approval request %s abandoned by creator: %s", r.PathValue("id"), strings.TrimSpace(input.Reason))
	}

	request, changed, err := a.abandonForUser(auth.UserID, r.PathValue("id"), input.Reason)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "approval request not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if changed {
		a.events.Publish(Event{Type: "approval.abandoned", RequestID: request.ID})
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

func (a *API) listOrganizations(w http.ResponseWriter, r *http.Request) {
	if a.organizations == nil {
		writeError(w, http.StatusNotImplemented, "organizations are not supported by this store")
		return
	}
	memberships, err := a.organizations.ListOrganizationsForUser(currentAuth(r).UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, memberships)
}

func (a *API) createOrganization(w http.ResponseWriter, r *http.Request) {
	if a.organizations == nil {
		writeError(w, http.StatusNotImplemented, "organizations are not supported by this store")
		return
	}
	var input CreateOrganizationRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid organization JSON")
		return
	}
	organization, err := a.organizations.CreateOrganizationForUser(currentAuth(r).UserID, input.Name)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, organization)
}

func (a *API) listTeams(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	teams, err := a.teamsProjects.ListTeams(currentAuth(r).OrganizationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, teams)
}

func (a *API) createTeam(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleAdmin) {
		return
	}
	var input CreateTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid team JSON")
		return
	}
	team, err := a.teamsProjects.CreateTeam(currentAuth(r).OrganizationID, input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, team)
}

func (a *API) getTeam(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	team, err := a.teamsProjects.GetTeam(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (a *API) updateTeam(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleAdmin) {
		return
	}
	var input UpdateTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid team JSON")
		return
	}
	team, err := a.teamsProjects.UpdateTeam(currentAuth(r).OrganizationID, r.PathValue("id"), input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (a *API) listTeamMembers(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	members, err := a.teamsProjects.ListTeamMembers(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (a *API) upsertTeamMember(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleOwner) {
		return
	}
	var input UpsertTeamMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid team member JSON")
		return
	}
	member, err := a.teamsProjects.UpsertTeamMember(currentAuth(r).OrganizationID, r.PathValue("id"), input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, member)
}

func (a *API) removeTeamMember(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleOwner) {
		return
	}
	err := a.teamsProjects.RemoveTeamMember(currentAuth(r).OrganizationID, r.PathValue("id"), r.PathValue("userID"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team member not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) recordHeartbeat(w http.ResponseWriter, r *http.Request) {
	if a.presence == nil {
		writeError(w, http.StatusNotImplemented, "presence is not supported")
		return
	}
	var input HeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid heartbeat JSON")
		return
	}
	auth := currentAuth(r)
	record, err := a.presence.RecordHeartbeat(auth.UserID, input.DeviceID, input.Client)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *API) getAvailability(w http.ResponseWriter, r *http.Request) {
	if a.presence == nil {
		writeError(w, http.StatusNotImplemented, "presence is not supported")
		return
	}
	record, err := a.presence.GetAvailability(currentAuth(r).UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *API) setAvailability(w http.ResponseWriter, r *http.Request) {
	if a.presence == nil {
		writeError(w, http.StatusNotImplemented, "presence is not supported")
		return
	}
	var input AvailabilityRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid availability JSON")
		return
	}
	record, err := a.presence.SetAvailability(currentAuth(r).UserID, input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *API) listTeamAvailability(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	if a.presence == nil {
		writeError(w, http.StatusNotImplemented, "presence is not supported")
		return
	}
	records, err := a.presence.ListTeamAvailability(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, records)
}

func (a *API) getTeamCoverage(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	if a.presence == nil {
		writeError(w, http.StatusNotImplemented, "presence is not supported")
		return
	}
	coverage, err := a.presence.GetTeamCoverage(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, coverage)
}

func (a *API) listOnCallSchedules(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	if a.presence == nil {
		writeError(w, http.StatusNotImplemented, "presence is not supported")
		return
	}
	schedules, err := a.presence.ListOnCallSchedules(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, schedules)
}

func (a *API) upsertOnCallSchedule(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleAdmin) {
		return
	}
	if a.presence == nil {
		writeError(w, http.StatusNotImplemented, "presence is not supported")
		return
	}
	var input UpsertOnCallScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid on-call JSON")
		return
	}
	schedule, err := a.presence.UpsertOnCallSchedule(currentAuth(r).OrganizationID, r.PathValue("id"), input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, schedule)
}

func (a *API) listProjects(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	projects, err := a.teamsProjects.ListProjects(currentAuth(r).OrganizationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleAdmin) {
		return
	}
	var input CreateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid project JSON")
		return
	}
	project, err := a.teamsProjects.CreateProject(currentAuth(r).OrganizationID, input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, project)
}

func (a *API) getProject(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleViewer) {
		return
	}
	project, err := a.teamsProjects.GetProject(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (a *API) updateProject(w http.ResponseWriter, r *http.Request) {
	if !a.authorizeOrg(w, r, RoleAdmin) {
		return
	}
	var input UpdateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid project JSON")
		return
	}
	project, err := a.teamsProjects.UpdateProject(currentAuth(r).OrganizationID, r.PathValue("id"), input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (a *API) listPolicies(w http.ResponseWriter, r *http.Request) {
	if !a.authorizePolicy(w, r, RoleViewer) {
		return
	}
	policies, err := a.policies.ListApprovalPolicies(currentAuth(r).OrganizationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, policies)
}

func (a *API) createPolicy(w http.ResponseWriter, r *http.Request) {
	if !a.authorizePolicy(w, r, RoleAdmin) {
		return
	}
	var input CreateApprovalPolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid policy JSON")
		return
	}
	policy, err := a.policies.CreateApprovalPolicy(currentAuth(r).OrganizationID, input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "project or team not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, policy)
}

func (a *API) getPolicy(w http.ResponseWriter, r *http.Request) {
	if !a.authorizePolicy(w, r, RoleViewer) {
		return
	}
	policy, err := a.policies.GetApprovalPolicy(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "policy not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, policy)
}

func (a *API) updatePolicy(w http.ResponseWriter, r *http.Request) {
	if !a.authorizePolicy(w, r, RoleAdmin) {
		return
	}
	var input UpdateApprovalPolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid policy JSON")
		return
	}
	policy, err := a.policies.UpdateApprovalPolicy(currentAuth(r).OrganizationID, r.PathValue("id"), input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "policy not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, policy)
}

func (a *API) deletePolicy(w http.ResponseWriter, r *http.Request) {
	if !a.authorizePolicy(w, r, RoleAdmin) {
		return
	}
	err := a.policies.DeleteApprovalPolicy(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "policy not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) previewPolicy(w http.ResponseWriter, r *http.Request) {
	if !a.authorizePolicy(w, r, RoleViewer) {
		return
	}
	preview, err := a.policies.PreviewApprovalPolicy(currentAuth(r).OrganizationID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "policy not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

func (a *API) authorizeOrg(w http.ResponseWriter, r *http.Request, requiredRole string) bool {
	if a.teamsProjects == nil {
		writeError(w, http.StatusNotImplemented, "teams and projects are not supported by this store")
		return false
	}
	if !roleAllows(currentAuth(r).Role, requiredRole) {
		writeError(w, http.StatusForbidden, "insufficient organization role")
		return false
	}
	return true
}

func (a *API) authorizePolicy(w http.ResponseWriter, r *http.Request, requiredRole string) bool {
	if a.policies == nil {
		writeError(w, http.StatusNotImplemented, "approval policies are not supported by this store")
		return false
	}
	if !roleAllows(currentAuth(r).Role, requiredRole) {
		writeError(w, http.StatusForbidden, "insufficient organization role")
		return false
	}
	return true
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
	credential, err := a.createAgentTokenForUser(currentAuth(r).UserID, input)
	if errors.Is(err, ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "project, team, or owner not found")
		return
	}
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
	if err := a.unpairDeviceForUser(currentAuth(r).UserID, deviceID); errors.Is(err, ErrNotFound) {
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
	if err := a.revokeAgentTokenForUser(currentAuth(r).UserID, agentID); errors.Is(err, ErrNotFound) {
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
	var tokens []string
	var err error
	if eligible, ok := a.pairings.(EligiblePushTokenStore); ok {
		tokens, err = eligible.ListEligibleDevicePushTokens(request)
	} else {
		tokens, err = a.listDevicePushTokensForUser(request.UserID)
	}
	if err != nil {
		log.Printf("list push tokens for request %s: %v", request.ID, err)
		return
	}
	if len(tokens) == 0 {
		return
	}
	// Push delivery is intentionally fire-and-forget so request creation can
	// return the request ID to CLI/automation clients without waiting on Expo.
	go func() {
		if err := a.push.SendApprovalRequest(tokens, request); err != nil {
			log.Printf("send push for request %s: %v", request.ID, err)
		}
	}()
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
		if r.Method == http.MethodOptions || r.URL.Path == "/healthz" || r.URL.Path == "/v1/devices/pair" || r.URL.Path == "/v1/session" || (r.Method == http.MethodGet && (r.URL.Path == "/" || strings.HasPrefix(r.URL.Path, "/assets/"))) {
			next.ServeHTTP(w, withAuthContext(r, authContext{UserID: defaultUserID, OrganizationID: defaultOrganizationID, Role: RoleOwner}))
			return
		}
		if a.mode == ModeUser && a.accounts != nil {
			userID, ok, err := a.userIDFromSessionCookie(r)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			if ok {
				if !validCSRF(r) {
					writeError(w, http.StatusForbidden, "missing or invalid CSRF token")
					return
				}
				auth, err := a.authContextForUser(userID, authSourceSession, true)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				next.ServeHTTP(w, withAuthContext(r, auth))
				return
			}
		}
		if a.token == "" && isLoopback(r.RemoteAddr) {
			auth, err := a.authContextForUser(defaultUserID, authSourceLoopback, false)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			next.ServeHTTP(w, withAuthContext(r, auth))
			return
		}

		token := bearerToken(r)
		if a.token != "" && tokenMatches(token, a.token) {
			auth, err := a.authContextForUser(defaultUserID, authSourceAdmin, false)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			next.ServeHTTP(w, withAuthContext(r, auth))
			return
		}
		if a.userTokens != nil {
			if a.agents != nil {
				if authStore, ok := a.userTokens.(AgentTokenAuthStore); ok {
					agentAuth, ok, err := authStore.AgentAuthForToken(token, requiredScope(r))
					if err != nil {
						writeError(w, http.StatusInternalServerError, err.Error())
						return
					}
					if ok {
						auth := authContext{
							UserID:                agentAuth.UserID,
							OrganizationID:        agentAuth.OrganizationID,
							Role:                  RoleViewer,
							AgentID:               agentAuth.AgentID,
							ProjectID:             agentAuth.ProjectID,
							OwnerUserID:           agentAuth.OwnerUserID,
							TeamID:                agentAuth.TeamID,
							DefaultApprovalPolicy: agentAuth.DefaultApprovalPolicy,
							Source:                authSourceAgent,
						}
						next.ServeHTTP(w, withAuthContext(r, auth))
						return
					}
				}
				userID, ok, err := a.userTokens.UserIDForAgentToken(token, requiredScope(r))
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				if ok {
					auth, err := a.authContextForUser(userID, authSourceAgent, false)
					if err != nil {
						writeError(w, http.StatusInternalServerError, err.Error())
						return
					}
					next.ServeHTTP(w, withAuthContext(r, auth))
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
					auth, err := a.authContextForUser(userID, authSourceDevice, false)
					if err != nil {
						writeError(w, http.StatusInternalServerError, err.Error())
						return
					}
					next.ServeHTTP(w, withAuthContext(r, auth))
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
				auth, err := a.authContextForUser(defaultUserID, authSourceAgent, false)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				next.ServeHTTP(w, withAuthContext(r, auth))
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
				auth, err := a.authContextForUser(defaultUserID, authSourceDevice, false)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				next.ServeHTTP(w, withAuthContext(r, auth))
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

func validCSRF(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return true
	}
	cookie, err := r.Cookie(csrfCookieName)
	if err != nil {
		return false
	}
	return tokenMatches(r.Header.Get(csrfHeaderName), cookie.Value)
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
	if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/approval-requests/") && strings.HasSuffix(r.URL.Path, "/abandon") {
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

func secureSessionCookie(r *http.Request, publicURL string) bool {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(publicURL)), "https://") {
		return true
	}
	if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return r.TLS != nil
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
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, "+csrfHeaderName)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
