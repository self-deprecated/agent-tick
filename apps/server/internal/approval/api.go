package approval

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
)

type API struct {
	store Store
	token string
}

func NewAPI(store Store, token string) *API {
	return &API{store: store, token: token}
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("POST /v1/approval-requests", a.create)
	mux.HandleFunc("GET /v1/approval-requests", a.list)
	mux.HandleFunc("GET /v1/approval-requests/{id}", a.get)
	mux.HandleFunc("POST /v1/approval-requests/{id}/responses", a.respond)
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
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, request)
}

func (a *API) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions || r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		if a.token == "" && isLoopback(r.RemoteAddr) {
			next.ServeHTTP(w, r)
			return
		}
		if a.token != "" && r.Header.Get("Authorization") == "Bearer "+a.token {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusUnauthorized, "missing or invalid bearer token")
	})
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
