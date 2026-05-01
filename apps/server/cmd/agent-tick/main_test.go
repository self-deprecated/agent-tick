package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"agent-tick/apps/server/internal/approval"
)

func TestClientConfigDefaults(t *testing.T) {
	t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	t.Setenv("AGENT_TICK_SERVER", "")
	t.Setenv("AGENT_TICK_TOKEN", "")

	if _, err := saveClientConfig(clientConfig{Server: "http://example.test:8787", Token: "agent_test"}); err != nil {
		t.Fatalf("saveClientConfig() error = %v", err)
	}

	if got := defaultServerURL(); got != "http://example.test:8787" {
		t.Fatalf("defaultServerURL() = %q, want configured server", got)
	}
	if got := defaultToken(); got != "agent_test" {
		t.Fatalf("defaultToken() = %q, want configured token", got)
	}
}

func TestClientConfigEnvOverrides(t *testing.T) {
	t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	t.Setenv("AGENT_TICK_SERVER", "http://env.test:8787")
	t.Setenv("AGENT_TICK_TOKEN", "agent_env")

	if _, err := saveClientConfig(clientConfig{Server: "http://config.test:8787", Token: "agent_config"}); err != nil {
		t.Fatalf("saveClientConfig() error = %v", err)
	}

	if got := defaultServerURL(); got != "http://env.test:8787" {
		t.Fatalf("defaultServerURL() = %q, want env server", got)
	}
	if got := defaultToken(); got != "agent_env" {
		t.Fatalf("defaultToken() = %q, want env token", got)
	}
}

func TestParseBoolEnv(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{"1", true},
		{"true", true},
		{"yes", true},
		{"TRUE", true},
		{"YES", true},
		{"True", true},
		{"0", false},
		{"false", false},
		{"", false},
		{"no", false},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			if got := parseBoolEnv(tt.value); got != tt.want {
				t.Fatalf("parseBoolEnv(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

func TestFlagEnvPrecedence(t *testing.T) {
	t.Run("server env overrides hardcoded default", func(t *testing.T) {
		t.Setenv("AGENT_TICK_SERVER", "http://env.test:8787")
		t.Setenv("AGENT_TICK_TOKEN", "")
		t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
		cmd := newRequestCmd()
		flag := cmd.Flags().Lookup("server")
		if flag == nil {
			t.Fatal("--server flag not found on request command")
		}
		if flag.DefValue != "http://env.test:8787" {
			t.Errorf("--server default = %q, want env value %q", flag.DefValue, "http://env.test:8787")
		}
	})
	t.Run("server uses localhost when env and config absent", func(t *testing.T) {
		t.Setenv("AGENT_TICK_SERVER", "")
		t.Setenv("AGENT_TICK_TOKEN", "")
		t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
		cmd := newRequestCmd()
		flag := cmd.Flags().Lookup("server")
		if flag == nil {
			t.Fatal("--server flag not found on request command")
		}
		if flag.DefValue != "http://localhost:8787" {
			t.Errorf("--server default = %q, want localhost default", flag.DefValue)
		}
	})
}

func TestRequestAutomationFlagsExist(t *testing.T) {
	cmd := newRequestCmd()
	for _, name := range []string{"json-events", "timeout", "no-timeout", "expires-in", "no-expiry", "metadata", "client-request-id", "correlation-token"} {
		if cmd.Flags().Lookup(name) == nil {
			t.Fatalf("--%s flag not found on request command", name)
		}
	}

	steer := newSteerCmd()
	for _, name := range []string{"option", "timeout", "no-timeout", "expires-in", "no-expiry", "metadata", "client-request-id", "correlation-token"} {
		if steer.Flags().Lookup(name) == nil {
			t.Fatalf("--%s flag not found on steer command", name)
		}
	}

	abandon := newAbandonCmd()
	for _, name := range []string{"json", "client-request-id", "reason"} {
		if abandon.Flags().Lookup(name) == nil {
			t.Fatalf("--%s flag not found on abandon command", name)
		}
	}

	root := newRootCmd()
	if found, _, err := root.Find([]string{"abandon"}); err != nil || found == nil || found.Name() != "abandon" {
		t.Fatalf("root.Find(abandon) = %v, %v, want abandon command", found, err)
	}
	if found, _, err := root.Find([]string{"steer"}); err != nil || found == nil || found.Name() != "steer" {
		t.Fatalf("root.Find(steer) = %v, %v, want steer command", found, err)
	}
}

func TestExpiresAtPtrZeroDisablesExpiry(t *testing.T) {
	if got := expiresAtPtr(0); got != nil {
		t.Fatalf("expiresAtPtr(0) = %v, want nil", got)
	}
	if got := expiresAtPtr(time.Second); got == nil {
		t.Fatal("expiresAtPtr(time.Second) = nil, want timestamp")
	}
}

func TestRequestMetadataMergesCorrelationFields(t *testing.T) {
	metadata, err := requestMetadata("", `{"actionFingerprint":"sha256:abc","attempt":2,"dryRun":true}`, "piapr_abc", "piapr_corr_456")
	if err != nil {
		t.Fatalf("requestMetadata() error = %v", err)
	}
	want := map[string]string{
		"actionFingerprint": "sha256:abc",
		"attempt":           "2",
		"dryRun":            "true",
		"clientRequestId":   "piapr_abc",
		"piBrokerRequestId": "piapr_abc",
		"correlationToken":  "piapr_corr_456",
	}
	for key, value := range want {
		if metadata[key] != value {
			t.Fatalf("metadata[%q] = %q, want %q (metadata = %#v)", key, metadata[key], value, metadata)
		}
	}
}

func TestRequestMetadataRejectsNonObjectAndNestedValues(t *testing.T) {
	for _, raw := range []string{`[]`, `{"nested":{"nope":true}}`} {
		if _, err := requestMetadata("", raw, "", ""); err == nil {
			t.Fatalf("requestMetadata(%s) error = nil, want error", raw)
		}
	}
}

func TestRequestNoExpiryAliasDisablesExpiry(t *testing.T) {
	var createdInput approval.CreateRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			if err := json.NewDecoder(r.Body).Decode(&createdInput); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_no_expiry", Status: approval.StatusPending, Metadata: createdInput.Metadata})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_no_expiry":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_no_expiry", Status: approval.StatusResponded, Metadata: createdInput.Metadata, Response: &approval.Response{ChoiceID: "approve"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := runRootCommandCapturingStdout(t, "request", "--server", server.URL, "--title", "Run command?", "--json-events", "--expires-in", "1ns", "--no-expiry")
	if err != nil {
		t.Fatalf("request command error = %v", err)
	}
	if createdInput.ExpiresAt != nil {
		t.Fatalf("ExpiresAt = %v, want nil from --no-expiry", createdInput.ExpiresAt)
	}
}

func TestRequestNoTimeoutAliasWaitsIndefinitely(t *testing.T) {
	oldPollInterval := approvalPollInterval
	approvalPollInterval = time.Millisecond
	defer func() { approvalPollInterval = oldPollInterval }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_no_timeout", Status: approval.StatusPending})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_no_timeout":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_no_timeout", Status: approval.StatusResponded, Response: &approval.Response{ChoiceID: "approve"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := runRootCommandCapturingStdout(t, "request", "--server", server.URL, "--title", "Run command?", "--json-events", "--timeout", "1ns", "--no-timeout")
	if err != nil {
		t.Fatalf("request command error = %v; want --no-timeout to override expired --timeout", err)
	}
}

func TestSteerCommandOutputsSelectedIDOnly(t *testing.T) {
	var createdInput approval.CreateRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			if err := json.NewDecoder(r.Body).Decode(&createdInput); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
				ID:            "req_steer",
				Status:        approval.StatusPending,
				RequestType:   createdInput.RequestType,
				Choices:       steerChoicesForTest(createdInput.Choices),
				DefaultChoice: approval.SteerNoneChoiceID,
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_steer":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
				ID:          "req_steer",
				Status:      approval.StatusResponded,
				RequestType: approval.RequestTypeSteer,
				Choices:     steerChoicesForTest(createdInput.Choices),
				Response:    &approval.Response{ChoiceID: "run-tests"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stdout, err := runRootCommandCapturingStdout(t, "steer", "--server", server.URL, "--option", "run-tests:Run tests", "--option", "update-docs:Update docs", "--timeout", "1s")
	if err != nil {
		t.Fatalf("steer command error = %v", err)
	}
	if string(stdout) != "run-tests\n" {
		t.Fatalf("stdout = %q, want selected ID only", string(stdout))
	}
	if createdInput.RequestType != approval.RequestTypeSteer || createdInput.AllowFreeformReply || createdInput.DefaultChoice != approval.SteerNoneChoiceID {
		t.Fatalf("created input = %#v, want secure steer request", createdInput)
	}
}

func TestSteerCommandDoesNotReturnServerAddedChoice(t *testing.T) {
	serverChoices := []approval.Choice{
		{ID: "run-tests", Label: "Run tests", Kind: approval.RequestTypeSteer},
		{ID: "server-added", Label: "Server-added text", Kind: approval.RequestTypeSteer},
		{ID: approval.SteerNoneChoiceID, Label: approval.SteerNoneChoiceLabel, Kind: approval.SteerNoneChoiceID},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_steer_injected", Status: approval.StatusPending, Choices: serverChoices})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_steer_injected":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_steer_injected", Status: approval.StatusResponded, Choices: serverChoices, Response: &approval.Response{ChoiceID: "server-added"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stdout, err := runRootCommandCapturingStdout(t, "steer", "--server", server.URL, "--option", "run-tests:Run tests", "--timeout", "1s")
	if err != nil {
		t.Fatalf("steer command error = %v", err)
	}
	if string(stdout) != approval.SteerNoneChoiceID+"\n" {
		t.Fatalf("stdout = %q, want none for server-added choice", string(stdout))
	}
}

func TestSteerCommandOutputsNoneOnTimeout(t *testing.T) {
	oldPollInterval := approvalPollInterval
	approvalPollInterval = time.Millisecond
	defer func() { approvalPollInterval = oldPollInterval }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_steer_timeout", Status: approval.StatusPending, Choices: steerChoicesForTest(nil)})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_steer_timeout":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_steer_timeout", Status: approval.StatusPending, Choices: steerChoicesForTest(nil)})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stdout, err := runRootCommandCapturingStdout(t, "steer", "--server", server.URL, "--option", "run-tests:Run tests", "--timeout", "1ns")
	if err != nil {
		t.Fatalf("steer command error = %v, want fail-closed none", err)
	}
	if string(stdout) != approval.SteerNoneChoiceID+"\n" {
		t.Fatalf("stdout = %q, want none", string(stdout))
	}
}

func TestSteerCommandRejectsReservedNoneOption(t *testing.T) {
	stdout, err := runRootCommandCapturingStdout(t, "steer", "--option", "none:Do nothing")
	if err == nil || !strings.Contains(err.Error(), "reserved") {
		t.Fatalf("steer command error = %v, want reserved option error", err)
	}
	if len(stdout) != 0 {
		t.Fatalf("stdout = %q, want empty output on invalid local options", string(stdout))
	}
}

func steerChoicesForTest(input []approval.Choice) []approval.Choice {
	choices := append([]approval.Choice{}, input...)
	choices = append(choices, approval.Choice{ID: approval.SteerNoneChoiceID, Label: approval.SteerNoneChoiceLabel, Kind: approval.SteerNoneChoiceID})
	return choices
}

func TestRequestJSONEventsEmitsIDImmediatelyAndTerminalLater(t *testing.T) {
	oldPollInterval := approvalPollInterval
	approvalPollInterval = 10 * time.Millisecond
	defer func() { approvalPollInterval = oldPollInterval }()

	responded := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
				ID:        "req_json",
				Title:     "Run command?",
				Status:    approval.StatusPending,
				CreatedAt: time.Now().UTC(),
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_json":
			request := approval.ApprovalRequest{
				ID:        "req_json",
				Title:     "Run command?",
				Status:    approval.StatusPending,
				CreatedAt: time.Now().UTC(),
			}
			select {
			case <-responded:
				request.Status = approval.StatusResponded
				request.Response = &approval.Response{ChoiceID: "approve"}
			default:
			}
			_ = json.NewEncoder(w).Encode(request)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	reader, writer := io.Pipe()
	done := make(chan error, 1)
	go func() {
		_, err := requestApprovalJSONEvents(
			server.URL,
			approval.CreateRequest{Title: "Run command?"},
			0,
			"",
			writer,
		)
		_ = writer.Close()
		done <- err
	}()

	decoder := json.NewDecoder(reader)
	var created requestJSONEvent
	if err := decoder.Decode(&created); err != nil {
		t.Fatalf("Decode(created) error = %v", err)
	}
	if created.Type != "request.created" || created.RequestID != "req_json" || created.Status != approval.StatusPending {
		t.Fatalf("created event = %#v, want immediate request ID", created)
	}

	close(responded)
	var terminal requestJSONEvent
	if err := decoder.Decode(&terminal); err != nil {
		t.Fatalf("Decode(terminal) error = %v", err)
	}
	if terminal.Type != "request.terminal" || terminal.RequestID != "req_json" || terminal.Status != approval.StatusResponded {
		t.Fatalf("terminal event = %#v, want responded terminal", terminal)
	}
	if terminal.Response == nil || terminal.Response.ChoiceID != "approve" {
		t.Fatalf("terminal response = %#v, want approve", terminal.Response)
	}

	if err := <-done; err != nil {
		t.Fatalf("requestApprovalJSONEvents() error = %v", err)
	}
}

func TestRequestJSONEventsEchoCorrelationMetadata(t *testing.T) {
	metadata, err := requestMetadata("", `{"actionFingerprint":"sha256:abc"}`, "piapr_abc", "piapr_corr_456")
	if err != nil {
		t.Fatalf("requestMetadata() error = %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			var input approval.CreateRequest
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
				ID:       "req_corr",
				Title:    input.Title,
				Status:   approval.StatusPending,
				Metadata: input.Metadata,
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_corr":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
				ID:       "req_corr",
				Title:    "Run command?",
				Status:   approval.StatusResponded,
				Metadata: metadata,
				Response: &approval.Response{ChoiceID: "approve", Message: "ok"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	var output bytes.Buffer
	_, err = requestApprovalJSONEvents(server.URL, approval.CreateRequest{Title: "Run command?", Metadata: metadata}, time.Minute, "", &output)
	if err != nil {
		t.Fatalf("requestApprovalJSONEvents() error = %v", err)
	}
	events := decodeRequestJSONEvents(t, output.Bytes())
	if len(events) != 2 {
		t.Fatalf("events = %#v, want created and terminal", events)
	}
	for _, event := range events {
		if event.ClientRequestID != "piapr_abc" {
			t.Fatalf("%s clientRequestId = %q, want piapr_abc", event.Type, event.ClientRequestID)
		}
		if event.CorrelationToken != "piapr_corr_456" {
			t.Fatalf("%s correlationToken = %q, want piapr_corr_456", event.Type, event.CorrelationToken)
		}
		if event.Request == nil || event.Request.Metadata["piBrokerRequestId"] != "piapr_abc" || event.Request.Metadata["correlationToken"] != "piapr_corr_456" || event.Request.Metadata["actionFingerprint"] != "sha256:abc" {
			t.Fatalf("%s request metadata = %#v, want broker metadata", event.Type, event.Request)
		}
	}
	if events[1].Response == nil || events[1].Response.ChoiceID != "approve" {
		t.Fatalf("terminal response = %#v, want approve", events[1].Response)
	}
}

func TestRequestCommandJSONEventsStdoutIsNDJSONOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_stdout", Status: approval.StatusPending})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_stdout":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_stdout", Status: approval.StatusResponded, Response: &approval.Response{ChoiceID: "approve"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stdout, err := runRootCommandCapturingStdout(t, "request", "--server", server.URL, "--title", "Run command?", "--json-events", "--timeout", "1s")
	if err != nil {
		t.Fatalf("request command error = %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(stdout)), "\n")
	if len(lines) != 2 {
		t.Fatalf("stdout = %q, want exactly two NDJSON lines", string(stdout))
	}
	for _, line := range lines {
		if !json.Valid([]byte(line)) {
			t.Fatalf("stdout line is not JSON: %q (full stdout %q)", line, string(stdout))
		}
	}
	events := decodeRequestJSONEvents(t, stdout)
	if events[0].Type != "request.created" || events[1].Type != "request.terminal" {
		t.Fatalf("events = %#v, want created then terminal", events)
	}
}

func TestRequestJSONEventsEmitsTerminalErrorStatuses(t *testing.T) {
	for _, tt := range []struct {
		status  string
		wantErr string
	}{
		{status: approval.StatusAbandoned, wantErr: "abandoned"},
		{status: approval.StatusExpired, wantErr: "expired"},
	} {
		t.Run(tt.status, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
					_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
						ID:        "req_" + tt.status,
						Title:     "Run command?",
						Status:    approval.StatusPending,
						CreatedAt: time.Now().UTC(),
					})
				case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_"+tt.status:
					_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
						ID:        "req_" + tt.status,
						Title:     "Run command?",
						Status:    tt.status,
						CreatedAt: time.Now().UTC(),
					})
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			var output bytes.Buffer
			_, err := requestApprovalJSONEvents(server.URL, approval.CreateRequest{Title: "Run command?"}, time.Minute, "", &output)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("requestApprovalJSONEvents() error = %v, want substring %q", err, tt.wantErr)
			}

			events := decodeRequestJSONEvents(t, output.Bytes())
			if len(events) != 2 {
				t.Fatalf("events = %#v, want created and terminal", events)
			}
			if events[0].Type != "request.created" || events[0].RequestID != "req_"+tt.status {
				t.Fatalf("created event = %#v, want request ID", events[0])
			}
			if events[1].Type != "request.terminal" || events[1].Status != tt.status || !strings.Contains(events[1].Error, tt.wantErr) {
				t.Fatalf("terminal event = %#v, want status %q and error substring %q", events[1], tt.status, tt.wantErr)
			}
		})
	}
}

func TestRequestJSONEventsEmitsTimeoutTerminalEvent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
				ID:        "req_timeout",
				Title:     "Run command?",
				Status:    approval.StatusPending,
				CreatedAt: time.Now().UTC(),
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_timeout":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{
				ID:        "req_timeout",
				Title:     "Run command?",
				Status:    approval.StatusPending,
				CreatedAt: time.Now().UTC(),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	var output bytes.Buffer
	_, err := requestApprovalJSONEvents(server.URL, approval.CreateRequest{Title: "Run command?"}, time.Nanosecond, "", &output)
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("requestApprovalJSONEvents() error = %v, want timeout", err)
	}

	events := decodeRequestJSONEvents(t, output.Bytes())
	if len(events) != 2 {
		t.Fatalf("events = %#v, want created and terminal", events)
	}
	if events[1].Type != "request.terminal" || events[1].RequestID != "req_timeout" || events[1].Status != approval.StatusPending || !strings.Contains(events[1].Error, "timed out") {
		t.Fatalf("terminal event = %#v, want pending timeout", events[1])
	}
}

func TestAbandonPendingRequestReturnsJSONWithClientRequestID(t *testing.T) {
	postCalled := false
	metadata := map[string]string{"clientRequestId": "piapr_abc", "piBrokerRequestId": "piapr_abc"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_abandon":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_abandon", Status: approval.StatusPending, Metadata: metadata})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests/req_abandon/abandon":
			postCalled = true
			var input abandonRequest
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if input.Reason != "superseded" || input.ClientRequestID != "piapr_abc" {
				http.Error(w, "missing abandon metadata", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_abandon", Status: approval.StatusAbandoned, Metadata: metadata})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stdout, err := runRootCommandCapturingStdout(t, "abandon", "req_abandon", "--server", server.URL, "--client-request-id", "piapr_abc", "--reason", "superseded", "--json")
	if err != nil {
		t.Fatalf("abandon command error = %v", err)
	}
	if !postCalled {
		t.Fatal("abandon endpoint was not called")
	}
	var output abandonJSONOutput
	if err := json.Unmarshal(stdout, &output); err != nil {
		t.Fatalf("Unmarshal(stdout) error = %v; stdout = %s", err, stdout)
	}
	if output.RequestID != "req_abandon" || output.ClientRequestID != "piapr_abc" || output.Status != approval.StatusAbandoned || !output.Abandoned {
		t.Fatalf("abandon output = %#v, want abandoned with client request ID", output)
	}
}

func TestAbandonAlreadyRespondedRequestReturnsResponseJSON(t *testing.T) {
	metadata := map[string]string{"clientRequestId": "piapr_abc"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_responded":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_responded", Status: approval.StatusResponded, Metadata: metadata, Response: &approval.Response{ChoiceID: "deny", Message: "no"}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests/req_responded/abandon":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_responded", Status: approval.StatusResponded, Metadata: metadata, Response: &approval.Response{ChoiceID: "deny", Message: "no"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stdout, err := runRootCommandCapturingStdout(t, "abandon", "req_responded", "--server", server.URL, "--client-request-id", "piapr_abc", "--json")
	if err != nil {
		t.Fatalf("abandon command error = %v", err)
	}
	var output abandonJSONOutput
	if err := json.Unmarshal(stdout, &output); err != nil {
		t.Fatalf("Unmarshal(stdout) error = %v; stdout = %s", err, stdout)
	}
	if output.RequestID != "req_responded" || output.ClientRequestID != "piapr_abc" || output.Status != approval.StatusResponded || output.Abandoned {
		t.Fatalf("abandon output = %#v, want responded with abandoned false", output)
	}
	if output.Response == nil || output.Response.ChoiceID != "deny" || output.Response.Message != "no" {
		t.Fatalf("response = %#v, want deny/no", output.Response)
	}
}

func TestAbandonMismatchedClientRequestIDFailsClosed(t *testing.T) {
	postCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_mismatch":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_mismatch", Status: approval.StatusPending, Metadata: map[string]string{"clientRequestId": "piapr_actual"}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests/req_mismatch/abandon":
			postCalls++
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_mismatch", Status: approval.StatusAbandoned})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := abandonApproval(server.URL, "req_mismatch", "", "piapr_other", "")
	if err == nil || !strings.Contains(err.Error(), "client request ID") {
		t.Fatalf("abandonApproval() error = %v, want client request ID mismatch", err)
	}
	if postCalls != 0 {
		t.Fatalf("postCalls = %d, want 0", postCalls)
	}
}

func TestRootHasNoAgentSideApproveOrDenyCommands(t *testing.T) {
	for _, name := range []string{"approve", "deny"} {
		found, _, err := newRootCmd().Find([]string{name})
		if err == nil && found != nil && found.Name() == name {
			t.Fatalf("unexpected agent-side %q command", name)
		}
	}
}

func decodeRequestJSONEvents(t *testing.T, data []byte) []requestJSONEvent {
	t.Helper()

	decoder := json.NewDecoder(bytes.NewReader(data))
	events := []requestJSONEvent{}
	for {
		var event requestJSONEvent
		err := decoder.Decode(&event)
		if err == io.EOF {
			return events
		}
		if err != nil {
			t.Fatalf("Decode() error = %v; data = %s", err, string(data))
		}
		events = append(events, event)
	}
}

func runRootCommandCapturingStdout(t *testing.T, args ...string) ([]byte, error) {
	t.Helper()
	t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	t.Setenv("AGENT_TICK_SERVER", "")
	t.Setenv("AGENT_TICK_TOKEN", "")

	oldStdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() error = %v", err)
	}
	os.Stdout = writer

	outputCh := make(chan []byte, 1)
	go func() {
		var output bytes.Buffer
		_, _ = io.Copy(&output, reader)
		outputCh <- output.Bytes()
	}()

	cmd := newRootCmd()
	cmd.SetArgs(args)
	err = cmd.Execute()

	_ = writer.Close()
	os.Stdout = oldStdout
	output := <-outputCh
	_ = reader.Close()
	return output, err
}

func TestParseChoices(t *testing.T) {
	tests := []struct {
		name    string
		specs   []string
		want    []approval.Choice
		wantErr string
	}{
		{
			name:  "empty",
			specs: nil,
		},
		{
			name:  "custom kind default",
			specs: []string{"stable:Stable", "beta:Beta"},
			want: []approval.Choice{
				{ID: "stable", Label: "Stable", Kind: "custom"},
				{ID: "beta", Label: "Beta", Kind: "custom"},
			},
		},
		{
			name:  "explicit kind",
			specs: []string{"approve:Approve:approve", "deny:Deny:deny"},
			want: []approval.Choice{
				{ID: "approve", Label: "Approve", Kind: "approve"},
				{ID: "deny", Label: "Deny", Kind: "deny"},
			},
		},
		{
			name:    "missing label",
			specs:   []string{"stable"},
			wantErr: "want id:label[:kind]",
		},
		{
			name:    "duplicate id",
			specs:   []string{"stable:Stable", "stable:Still stable"},
			wantErr: "duplicate id",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseChoices(tt.specs)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("parseChoices() error = %v, want substring %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseChoices() error = %v", err)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("parseChoices() len = %d, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("parseChoices()[%d] = %#v, want %#v", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestParseSteerOptions(t *testing.T) {
	choices, err := parseSteerOptions([]string{"run-tests:Run tests: include integration", "update_docs:Update docs"})
	if err != nil {
		t.Fatalf("parseSteerOptions() error = %v", err)
	}
	if len(choices) != 2 || choices[0].ID != "run-tests" || choices[0].Label != "Run tests: include integration" || choices[0].Kind != approval.RequestTypeSteer {
		t.Fatalf("choices = %#v, want steer choices with colon-preserving label", choices)
	}
	for _, specs := range [][]string{{}, {"none:No"}, {"bad id:Bad"}, {"x:One", "x:Two"}} {
		if _, err := parseSteerOptions(specs); err == nil {
			t.Fatalf("parseSteerOptions(%#v) error = nil, want error", specs)
		}
	}
}

func TestMergeRequesterPreservesExplicitFields(t *testing.T) {
	current := approval.Requester{
		Name:             "Claude Code",
		WorkingDirectory: "/tmp/project/subdir",
	}
	defaults := approval.Requester{
		Name:             "agent-tick-cli",
		AgentID:          "local-agent",
		Host:             "workstation",
		WorkingDirectory: "/tmp/project",
	}

	got := mergeRequester(current, defaults)

	if got.Name != "Claude Code" {
		t.Fatalf("Name = %q, want Claude Code", got.Name)
	}
	if got.AgentID != "local-agent" {
		t.Fatalf("AgentID = %q, want local-agent", got.AgentID)
	}
	if got.Host != "workstation" {
		t.Fatalf("Host = %q, want workstation", got.Host)
	}
	if got.WorkingDirectory != "/tmp/project/subdir" {
		t.Fatalf("WorkingDirectory = %q, want /tmp/project/subdir", got.WorkingDirectory)
	}
}
