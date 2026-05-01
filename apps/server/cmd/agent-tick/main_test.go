package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
	for _, name := range []string{"json-events", "timeout", "expires-in"} {
		if cmd.Flags().Lookup(name) == nil {
			t.Fatalf("--%s flag not found on request command", name)
		}
	}

	abandon := newAbandonCmd()
	if abandon.Flags().Lookup("json") == nil {
		t.Fatal("--json flag not found on abandon command")
	}

	root := newRootCmd()
	if found, _, err := root.Find([]string{"abandon"}); err != nil || found == nil || found.Name() != "abandon" {
		t.Fatalf("root.Find(abandon) = %v, %v, want abandon command", found, err)
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
