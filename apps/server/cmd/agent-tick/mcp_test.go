package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"agent-tick/apps/server/internal/approval"
)

func TestRootIncludesMCPCommand(t *testing.T) {
	root := newRootCmd()
	found, _, err := root.Find([]string{"mcp"})
	if err != nil || found == nil || found.Name() != "mcp" {
		t.Fatalf("root.Find(mcp) = %v, %v, want mcp command", found, err)
	}
}

func TestMCPServerInitializeAndToolsList(t *testing.T) {
	broker := &mcpServer{server: "http://example.test", defaults: buildRequester("agent-tick-mcp", "mcp-agent", "", "")}
	input := strings.NewReader(strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"ping"}`,
	}, "\n"))
	var out bytes.Buffer
	if err := broker.serve(input, &out); err != nil {
		t.Fatalf("serve() error = %v", err)
	}
	responses := decodeJSONLines(t, out.Bytes())
	if len(responses) != 3 {
		t.Fatalf("response count = %d, want 3 (%s)", len(responses), out.String())
	}
	if got := responses[0]["result"].(map[string]any)["protocolVersion"]; got != mcpProtocolVersionLatest {
		t.Fatalf("initialize protocolVersion = %#v, want %s", got, mcpProtocolVersionLatest)
	}
	toolList, ok := responses[1]["result"].(map[string]any)["tools"].([]any)
	if !ok || len(toolList) != 3 {
		t.Fatalf("tools/list tools = %#v, want 3 tools", responses[1]["result"])
	}
	gotNames := []string{}
	for _, raw := range toolList {
		tool := raw.(map[string]any)
		gotNames = append(gotNames, tool["name"].(string))
	}
	wantNames := []string{"abandon_request", "request_approval", "request_steer"}
	for i := range wantNames {
		if gotNames[i] != wantNames[i] {
			t.Fatalf("tool[%d] = %q, want %q (tools=%#v)", i, gotNames[i], wantNames[i], gotNames)
		}
	}
	if _, ok := responses[2]["result"].(map[string]any); !ok {
		t.Fatalf("ping result = %#v, want object", responses[2]["result"])
	}
}

func TestMCPRequestApprovalToolApproved(t *testing.T) {
	var created approval.CreateRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			if err := json.NewDecoder(r.Body).Decode(&created); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_mcp", Status: approval.StatusPending, Metadata: created.Metadata})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_mcp":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_mcp", Status: approval.StatusResponded, Metadata: created.Metadata, Response: &approval.Response{ChoiceID: "approve"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	broker := &mcpServer{server: server.URL, token: "agent_test", defaults: buildRequester("agent-tick-mcp", "mcp-agent", "", "")}
	input := strings.NewReader(strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"request_approval","arguments":{"title":"Deploy production?","command":"kubectl apply -f prod.yaml","context":"github run 123","metadata":{"source":"mcp","attempt":2},"clientRequestId":"piapr_1","correlationToken":"corr_1"}}}`,
	}, "\n"))
	var out bytes.Buffer
	if err := broker.serve(input, &out); err != nil {
		t.Fatalf("serve() error = %v", err)
	}
	responses := decodeJSONLines(t, out.Bytes())
	if len(responses) != 2 {
		t.Fatalf("response count = %d, want 2 (%s)", len(responses), out.String())
	}
	result := responses[1]["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	if structured["status"] != "approved" {
		t.Fatalf("approval status = %#v, want approved", structured["status"])
	}
	if approved, _ := structured["approved"].(bool); !approved {
		t.Fatalf("approved = %#v, want true", structured["approved"])
	}
	if created.Metadata["context"] != "github run 123" || created.Metadata["source"] != "mcp" || created.Metadata["attempt"] != "2" {
		t.Fatalf("created metadata = %#v", created.Metadata)
	}
	if created.Metadata["clientRequestId"] != "piapr_1" || created.Metadata["correlationToken"] != "corr_1" {
		t.Fatalf("correlation metadata = %#v", created.Metadata)
	}
	if created.Risk == "" {
		t.Fatal("created risk is empty, want classified risk")
	}
}

func TestMCPRequestSteerToolReturnsChoice(t *testing.T) {
	var created approval.CreateRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/approval-requests":
			if err := json.NewDecoder(r.Body).Decode(&created); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_steer_mcp", Status: approval.StatusPending, Metadata: created.Metadata})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/approval-requests/req_steer_mcp":
			_ = json.NewEncoder(w).Encode(approval.ApprovalRequest{ID: "req_steer_mcp", Status: approval.StatusResponded, Metadata: created.Metadata, Response: &approval.Response{ChoiceID: "run-tests"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	broker := &mcpServer{server: server.URL, token: "agent_test", defaults: buildRequester("agent-tick-mcp", "mcp-agent", "", "")}
	input := strings.NewReader(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"request_steer","arguments":{"title":"How should I continue?","options":[{"id":"run-tests","label":"Run tests and fix failures"},{"id":"update-docs","label":"Update docs"}]}}}`)
	var out bytes.Buffer
	if err := broker.serve(input, &out); err != nil {
		t.Fatalf("serve() error = %v", err)
	}
	responses := decodeJSONLines(t, out.Bytes())
	if len(responses) != 1 {
		t.Fatalf("response count = %d, want 1 (%s)", len(responses), out.String())
	}
	result := responses[0]["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	if structured["choiceId"] != "run-tests" {
		t.Fatalf("choiceId = %#v, want run-tests", structured["choiceId"])
	}
	if structured["status"] != "responded" {
		t.Fatalf("status = %#v, want responded", structured["status"])
	}
	if created.DefaultChoice != approval.SteerNoneChoiceID {
		t.Fatalf("DefaultChoice = %q, want %q", created.DefaultChoice, approval.SteerNoneChoiceID)
	}
}

func decodeJSONLines(t *testing.T, data []byte) []map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	responses := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var response map[string]any
		if err := json.Unmarshal([]byte(line), &response); err != nil {
			t.Fatalf("unmarshal response line %q: %v", line, err)
		}
		responses = append(responses, response)
	}
	return responses
}
