package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"agent-tick/apps/server/internal/approval"
	"github.com/spf13/cobra"
)

const (
	mcpProtocolVersionLatest = "2025-11-25"
	mcpProtocolVersionLegacy = "2024-11-05"
)

var supportedMCPProtocolVersions = []string{mcpProtocolVersionLatest, mcpProtocolVersionLegacy}

type mcpServer struct {
	server         string
	token          string
	defaults       approval.Requester
	projectIDHint  string
	teamHint       string
	approvalPolicy string
}

type mcpJSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpJSONRPCSuccess struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Result  any    `json:"result"`
}

type mcpJSONRPCError struct {
	JSONRPC string       `json:"jsonrpc"`
	ID      any          `json:"id,omitempty"`
	Error   mcpErrorBody `json:"error"`
}

type mcpErrorBody struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type mcpToolResult struct {
	Content           []mcpTextContent `json:"content"`
	StructuredContent any              `json:"structuredContent,omitempty"`
	IsError           bool             `json:"isError,omitempty"`
}

type mcpTextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type mcpInitializeParams struct {
	ProtocolVersion string `json:"protocolVersion"`
}

type mcpToolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type mcpRequesterArgs struct {
	Name             string `json:"name"`
	AgentID          string `json:"agentId"`
	Host             string `json:"host"`
	WorkingDirectory string `json:"workingDirectory"`
	ProjectName      string `json:"projectName"`
	ProjectID        string `json:"projectId"`
}

type mcpApprovalToolArgs struct {
	Title            string           `json:"title"`
	Body             string           `json:"body"`
	Command          string           `json:"command"`
	TimeoutSeconds   *int             `json:"timeoutSeconds"`
	ExpiresInSeconds *int             `json:"expiresInSeconds"`
	Context          string           `json:"context"`
	Metadata         map[string]any   `json:"metadata"`
	Requester        mcpRequesterArgs `json:"requester"`
	Project          string           `json:"project"`
	ProjectDir       string           `json:"projectDir"`
	ProjectID        string           `json:"projectId"`
	Team             string           `json:"team"`
	ApprovalPolicy   string           `json:"approvalPolicy"`
	ClientRequestID  string           `json:"clientRequestId"`
	CorrelationToken string           `json:"correlationToken"`
}

type mcpSteerChoiceArgs struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type mcpSteerToolArgs struct {
	Title            string               `json:"title"`
	Body             string               `json:"body"`
	Options          []mcpSteerChoiceArgs `json:"options"`
	TimeoutSeconds   *int                 `json:"timeoutSeconds"`
	ExpiresInSeconds *int                 `json:"expiresInSeconds"`
	Context          string               `json:"context"`
	Metadata         map[string]any       `json:"metadata"`
	Requester        mcpRequesterArgs     `json:"requester"`
	Project          string               `json:"project"`
	ProjectDir       string               `json:"projectDir"`
	ProjectID        string               `json:"projectId"`
	Team             string               `json:"team"`
	ApprovalPolicy   string               `json:"approvalPolicy"`
	ClientRequestID  string               `json:"clientRequestId"`
	CorrelationToken string               `json:"correlationToken"`
}

type mcpAbandonToolArgs struct {
	RequestID       string `json:"requestId"`
	ClientRequestID string `json:"clientRequestId"`
	Reason          string `json:"reason"`
}

func newMCPCmd() *cobra.Command {
	var server, token, requesterName, agentID, projectName, projectDir string
	var projectIDHint, teamHint, approvalPolicy string
	cmd := &cobra.Command{
		Use:   "mcp",
		Short: "Run an MCP stdio server for Agent Tick approval tools",
		Long: `mcp starts a minimal Model Context Protocol (MCP) stdio server that
exposes Agent Tick approval tools. MCP clients can discover the tools via
stdio, create approval requests, ask for constrained steering, and abandon
pending requests without shelling out to the CLI directly.`,
		Example: `  agent-tick mcp
  agent-tick mcp --server https://tick.example.com --token agent_...`,
		RunE: func(cmd *cobra.Command, args []string) error {
			broker := &mcpServer{
				server:         server,
				token:          token,
				defaults:       buildRequester(requesterName, agentID, projectName, projectDir),
				projectIDHint:  projectIDHint,
				teamHint:       teamHint,
				approvalPolicy: approvalPolicy,
			}
			return broker.serve(os.Stdin, os.Stdout)
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().StringVar(&requesterName, "requester", getenv("AGENT_TICK_REQUESTER", "agent-tick-mcp"), "default requester name [env: AGENT_TICK_REQUESTER]")
	cmd.Flags().StringVar(&agentID, "agent-id", getenv("AGENT_TICK_AGENT_ID", "mcp-agent"), "default agent ID [env: AGENT_TICK_AGENT_ID]")
	cmd.Flags().StringVar(&projectName, "project", os.Getenv("AGENT_TICK_PROJECT"), "default project display name [env: AGENT_TICK_PROJECT]")
	cmd.Flags().StringVar(&projectDir, "project-dir", os.Getenv("AGENT_TICK_PROJECT_DIR"), "default project directory [env: AGENT_TICK_PROJECT_DIR]")
	cmd.Flags().StringVar(&projectIDHint, "project-id", os.Getenv("AGENT_TICK_PROJECT_ID"), "default project ID routing hint [env: AGENT_TICK_PROJECT_ID]")
	cmd.Flags().StringVar(&teamHint, "team", os.Getenv("AGENT_TICK_TEAM"), "default team ID routing hint [env: AGENT_TICK_TEAM]")
	cmd.Flags().StringVar(&approvalPolicy, "approval-policy", os.Getenv("AGENT_TICK_APPROVAL_POLICY"), "default approval policy routing hint [env: AGENT_TICK_APPROVAL_POLICY]")
	return cmd
}

func (s *mcpServer) serve(in io.Reader, out io.Writer) error {
	decoder := json.NewDecoder(in)
	encoder := json.NewEncoder(out)
	for {
		var request mcpJSONRPCRequest
		if err := decoder.Decode(&request); err != nil {
			if err == io.EOF {
				return nil
			}
			_ = encoder.Encode(errorResponse(nil, -32700, "parse error", err.Error()))
			return err
		}
		response, ok := s.handle(request)
		if !ok {
			continue
		}
		if err := encoder.Encode(response); err != nil {
			return err
		}
	}
}

func (s *mcpServer) handle(request mcpJSONRPCRequest) (any, bool) {
	if request.JSONRPC != "" && request.JSONRPC != "2.0" {
		return errorResponse(request.ID, -32600, "invalid request", "jsonrpc must be 2.0"), request.ID != nil
	}

	switch request.Method {
	case "initialize":
		if request.ID == nil {
			return nil, false
		}
		return s.handleInitialize(request)
	case "notifications/initialized", "notifications/cancelled":
		return nil, false
	case "ping":
		if request.ID == nil {
			return nil, false
		}
		return successResponse(request.ID, map[string]any{}), true
	case "tools/list":
		if request.ID == nil {
			return nil, false
		}
		return successResponse(request.ID, map[string]any{"tools": s.tools()}), true
	case "tools/call":
		if request.ID == nil {
			return nil, false
		}
		return s.handleToolCall(request)
	default:
		if request.ID == nil {
			return nil, false
		}
		return errorResponse(request.ID, -32601, "method not found", request.Method), true
	}
}

func (s *mcpServer) handleInitialize(request mcpJSONRPCRequest) (any, bool) {
	var params mcpInitializeParams
	if len(request.Params) > 0 {
		if err := json.Unmarshal(request.Params, &params); err != nil {
			return errorResponse(request.ID, -32602, "invalid params", err.Error()), true
		}
	}
	return successResponse(request.ID, map[string]any{
		"protocolVersion": negotiatedMCPProtocolVersion(params.ProtocolVersion),
		"capabilities": map[string]any{
			"tools": map[string]any{},
		},
		"serverInfo": map[string]any{
			"name":    "agent-tick",
			"title":   "Agent Tick MCP",
			"version": "0.0.0",
		},
		"instructions": "Use request_approval for approve/deny gates, request_steer for constrained follow-up choices, and abandon_request to cancel pending requests.",
	}), true
}

func (s *mcpServer) handleToolCall(request mcpJSONRPCRequest) (any, bool) {
	var params mcpToolCallParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return errorResponse(request.ID, -32602, "invalid params", err.Error()), true
	}
	if strings.TrimSpace(params.Name) == "" {
		return errorResponse(request.ID, -32602, "invalid params", "tool name is required"), true
	}
	result, err := s.callTool(params.Name, params.Arguments)
	if err != nil {
		return errorResponse(request.ID, -32602, "invalid params", err.Error()), true
	}
	return successResponse(request.ID, result), true
}

func (s *mcpServer) callTool(name string, arguments map[string]any) (mcpToolResult, error) {
	switch name {
	case "request_approval":
		return s.callRequestApproval(arguments)
	case "request_steer":
		return s.callRequestSteer(arguments)
	case "abandon_request":
		return s.callAbandonRequest(arguments)
	default:
		return mcpToolResult{}, fmt.Errorf("unknown tool: %s", name)
	}
}

func (s *mcpServer) callRequestApproval(arguments map[string]any) (mcpToolResult, error) {
	var args mcpApprovalToolArgs
	if err := decodeMCPArguments(arguments, &args); err != nil {
		return mcpToolResult{}, err
	}
	if strings.TrimSpace(args.Title) == "" {
		return mcpToolResult{}, fmt.Errorf("title is required")
	}
	metadata, err := mcpMetadata(args.Context, args.Metadata, args.ClientRequestID, args.CorrelationToken)
	if err != nil {
		return mcpToolResult{}, err
	}
	requester := s.composeRequester(args.Requester, args.Project, args.ProjectDir, args.ProjectID)
	applyRoutingHints(metadata, &requester, firstNonEmpty(args.ProjectID, s.projectIDHint), firstNonEmpty(args.Team, s.teamHint), firstNonEmpty(args.ApprovalPolicy, s.approvalPolicy))

	created, err := createApprovalRequest(s.server, approval.CreateRequest{
		Requester:   requester,
		RequestType: approval.RequestTypeApproval,
		Title:       strings.TrimSpace(args.Title),
		Body:        strings.TrimSpace(args.Body),
		Command:     strings.TrimSpace(args.Command),
		ExpiresAt:   expiresAtPtr(durationFromSeconds(args.ExpiresInSeconds, 5*time.Minute)),
		Risk:        classifyRisk(strings.TrimSpace(args.Command)),
		Metadata:    metadata,
	}, s.token)
	if err != nil {
		return newMCPToolResult(map[string]any{"status": "failed", "error": err.Error()}, true), nil
	}
	current, waitErr := waitForApproval(s.server, created.ID, durationFromSeconds(args.TimeoutSeconds, 10*time.Minute), s.token)
	current = requestWithEventFallback(current, created)
	status := mcpApprovalStatus(current, waitErr)
	structured := map[string]any{
		"requestId": created.ID,
		"status":    status,
		"approved":  current.Response != nil && current.Response.ChoiceID == "approve",
		"request":   current,
	}
	if current.Response != nil {
		structured["response"] = current.Response
	}
	if waitErr != nil {
		structured["error"] = waitErr.Error()
		return newMCPToolResult(structured, true), nil
	}
	if current.Response == nil {
		structured["error"] = "approval request completed without a response"
		return newMCPToolResult(structured, true), nil
	}
	if current.Response.ChoiceID != "approve" {
		structured["error"] = "approval denied"
		return newMCPToolResult(structured, true), nil
	}
	return newMCPToolResult(structured, false), nil
}

func (s *mcpServer) callRequestSteer(arguments map[string]any) (mcpToolResult, error) {
	var args mcpSteerToolArgs
	if err := decodeMCPArguments(arguments, &args); err != nil {
		return mcpToolResult{}, err
	}
	if strings.TrimSpace(args.Title) == "" {
		return mcpToolResult{}, fmt.Errorf("title is required")
	}
	if len(args.Options) == 0 {
		return mcpToolResult{}, fmt.Errorf("options are required")
	}
	choices := make([]approval.Choice, 0, len(args.Options))
	for _, option := range args.Options {
		id := strings.TrimSpace(option.ID)
		label := strings.TrimSpace(option.Label)
		if id == "" || label == "" {
			return mcpToolResult{}, fmt.Errorf("each option requires id and label")
		}
		if !validSteerOptionID(id) {
			return mcpToolResult{}, fmt.Errorf("option id %q must match [A-Za-z0-9_-]{1,64}", id)
		}
		choices = append(choices, approval.Choice{ID: id, Label: label, Kind: approval.RequestTypeSteer})
	}
	metadata, err := mcpMetadata(args.Context, args.Metadata, args.ClientRequestID, args.CorrelationToken)
	if err != nil {
		return mcpToolResult{}, err
	}
	requester := s.composeRequester(args.Requester, args.Project, args.ProjectDir, args.ProjectID)
	applyRoutingHints(metadata, &requester, firstNonEmpty(args.ProjectID, s.projectIDHint), firstNonEmpty(args.Team, s.teamHint), firstNonEmpty(args.ApprovalPolicy, s.approvalPolicy))

	created, err := createApprovalRequest(s.server, approval.CreateRequest{
		Requester:     requester,
		RequestType:   approval.RequestTypeSteer,
		Title:         strings.TrimSpace(args.Title),
		Body:          strings.TrimSpace(args.Body),
		Choices:       choices,
		DefaultChoice: approval.SteerNoneChoiceID,
		ExpiresAt:     expiresAtPtr(durationFromSeconds(args.ExpiresInSeconds, 30*time.Minute)),
		Metadata:      metadata,
	}, s.token)
	if err != nil {
		return newMCPToolResult(map[string]any{"status": "failed", "choiceId": approval.SteerNoneChoiceID, "error": err.Error()}, true), nil
	}
	current, waitErr := waitForApproval(s.server, created.ID, durationFromSeconds(args.TimeoutSeconds, 30*time.Minute), s.token)
	current = requestWithEventFallback(current, created)
	choiceID := approval.SteerNoneChoiceID
	if current.Response != nil && strings.TrimSpace(current.Response.ChoiceID) != "" {
		choiceID = strings.TrimSpace(current.Response.ChoiceID)
	}
	structured := map[string]any{
		"requestId": created.ID,
		"status":    mcpSteerStatus(current, waitErr, choiceID),
		"choiceId":  choiceID,
		"request":   current,
	}
	if current.Response != nil {
		structured["response"] = current.Response
	}
	if waitErr != nil {
		structured["error"] = waitErr.Error()
		return newMCPToolResult(structured, true), nil
	}
	return newMCPToolResult(structured, false), nil
}

func (s *mcpServer) callAbandonRequest(arguments map[string]any) (mcpToolResult, error) {
	var args mcpAbandonToolArgs
	if err := decodeMCPArguments(arguments, &args); err != nil {
		return mcpToolResult{}, err
	}
	if strings.TrimSpace(args.RequestID) == "" {
		return mcpToolResult{}, fmt.Errorf("requestId is required")
	}
	request, err := abandonApproval(s.server, strings.TrimSpace(args.RequestID), s.token, strings.TrimSpace(args.ClientRequestID), strings.TrimSpace(args.Reason))
	if err != nil {
		return newMCPToolResult(map[string]any{"requestId": strings.TrimSpace(args.RequestID), "status": "failed", "error": err.Error()}, true), nil
	}
	structured := map[string]any{
		"requestId": request.ID,
		"status":    request.Status,
		"abandoned": request.Status == approval.StatusAbandoned && request.Response == nil,
		"request":   request,
	}
	return newMCPToolResult(structured, false), nil
}

func (s *mcpServer) composeRequester(args mcpRequesterArgs, projectName string, projectDir string, projectIDHint string) approval.Requester {
	host := firstNonEmpty(args.Host, s.defaults.Host)
	workingDir := strings.TrimSpace(projectDir)
	if workingDir == "" {
		workingDir = firstNonEmpty(args.WorkingDirectory, s.defaults.WorkingDirectory)
	}
	if workingDir == "" {
		workingDir = workingDirectory()
	}
	name := firstNonEmpty(args.Name, s.defaults.Name)
	agentID := firstNonEmpty(args.AgentID, s.defaults.AgentID)
	project := strings.TrimSpace(projectName)
	if project == "" {
		project = firstNonEmpty(args.ProjectName, s.defaults.ProjectName)
	}
	if project == "" {
		project = filepath.Base(workingDir)
	}
	if project == "." || project == string(filepath.Separator) {
		project = workingDir
	}
	requester := approval.Requester{
		Name:             name,
		AgentID:          agentID,
		Host:             host,
		WorkingDirectory: workingDir,
		ProjectName:      project,
		ProjectID:        firstNonEmpty(projectIDHint, args.ProjectID),
	}
	if requester.ProjectID == "" {
		requester.ProjectID = projectID(host, workingDir)
	}
	return requester
}

func (s *mcpServer) tools() []map[string]any {
	tools := []map[string]any{
		{
			"name":        "request_approval",
			"title":       "Request Approval",
			"description": "Create an Agent Tick approval request and wait for approve or deny.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":            map[string]any{"type": "string", "description": "Short approval title shown to the human reviewer."},
					"body":             map[string]any{"type": "string", "description": "Optional short body text."},
					"command":          map[string]any{"type": "string", "description": "Optional command summary to review."},
					"timeoutSeconds":   map[string]any{"type": "integer", "minimum": 0, "description": "How long to wait for a response. 0 waits indefinitely. Defaults to 600."},
					"expiresInSeconds": map[string]any{"type": "integer", "minimum": 0, "description": "Request expiry. 0 disables expiry. Defaults to 300."},
					"context":          map[string]any{"type": "string", "description": "Extra context attached to request metadata."},
					"metadata":         map[string]any{"type": "object", "description": "Extra scalar metadata to attach.", "additionalProperties": true},
					"requester":        mcpRequesterSchema(),
					"project":          map[string]any{"type": "string", "description": "Optional project display name override."},
					"projectDir":       map[string]any{"type": "string", "description": "Optional project directory override."},
					"projectId":        map[string]any{"type": "string", "description": "Optional project routing hint override."},
					"team":             map[string]any{"type": "string", "description": "Optional team routing hint override."},
					"approvalPolicy":   map[string]any{"type": "string", "description": "Optional approval policy routing hint override."},
					"clientRequestId":  map[string]any{"type": "string"},
					"correlationToken": map[string]any{"type": "string"},
				},
				"required":             []string{"title"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "request_steer",
			"title":       "Request Steering",
			"description": "Ask a human to choose one of the supplied follow-up options. A built-in none option is always available.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":            map[string]any{"type": "string", "description": "Steering title shown to the human reviewer."},
					"body":             map[string]any{"type": "string", "description": "Optional short body text."},
					"options":          mcpSteerOptionsSchema(),
					"timeoutSeconds":   map[string]any{"type": "integer", "minimum": 0, "description": "How long to wait for a response. 0 waits indefinitely. Defaults to 1800."},
					"expiresInSeconds": map[string]any{"type": "integer", "minimum": 0, "description": "Request expiry. 0 disables expiry. Defaults to 1800."},
					"context":          map[string]any{"type": "string", "description": "Extra context attached to request metadata."},
					"metadata":         map[string]any{"type": "object", "description": "Extra scalar metadata to attach.", "additionalProperties": true},
					"requester":        mcpRequesterSchema(),
					"project":          map[string]any{"type": "string"},
					"projectDir":       map[string]any{"type": "string"},
					"projectId":        map[string]any{"type": "string"},
					"team":             map[string]any{"type": "string"},
					"approvalPolicy":   map[string]any{"type": "string"},
					"clientRequestId":  map[string]any{"type": "string"},
					"correlationToken": map[string]any{"type": "string"},
				},
				"required":             []string{"title", "options"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "abandon_request",
			"title":       "Abandon Pending Request",
			"description": "Cancel a pending approval request that is no longer needed.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"requestId":       map[string]any{"type": "string", "description": "The Agent Tick request ID to abandon."},
					"clientRequestId": map[string]any{"type": "string", "description": "Optional client-side request ID guard."},
					"reason":          map[string]any{"type": "string", "description": "Optional abandonment reason for audit metadata."},
				},
				"required":             []string{"requestId"},
				"additionalProperties": false,
			},
		},
	}
	sort.Slice(tools, func(i, j int) bool {
		return fmt.Sprint(tools[i]["name"]) < fmt.Sprint(tools[j]["name"])
	})
	return tools
}

func mcpRequesterSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":             map[string]any{"type": "string"},
			"agentId":          map[string]any{"type": "string"},
			"host":             map[string]any{"type": "string"},
			"workingDirectory": map[string]any{"type": "string"},
			"projectName":      map[string]any{"type": "string"},
			"projectId":        map[string]any{"type": "string"},
		},
		"additionalProperties": false,
	}
}

func mcpSteerOptionsSchema() map[string]any {
	return map[string]any{
		"type": "array",
		"items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":    map[string]any{"type": "string"},
				"label": map[string]any{"type": "string"},
			},
			"required":             []string{"id", "label"},
			"additionalProperties": false,
		},
	}
}

func decodeMCPArguments(input map[string]any, out any) error {
	if input == nil {
		input = map[string]any{}
	}
	data, err := json.Marshal(input)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func mcpMetadata(context string, metadata map[string]any, clientRequestID string, correlationToken string) (map[string]string, error) {
	result := map[string]string{}
	for key, raw := range metadata {
		key = strings.TrimSpace(key)
		if key == "" {
			return nil, fmt.Errorf("metadata keys must be non-empty strings")
		}
		scalar, err := stringifyMetadataScalar(raw)
		if err != nil {
			return nil, fmt.Errorf("metadata[%q]: %w", key, err)
		}
		result[key] = scalar
	}
	if strings.TrimSpace(context) != "" {
		result["context"] = context
	}
	if clientRequestID = strings.TrimSpace(clientRequestID); clientRequestID != "" {
		result["clientRequestId"] = clientRequestID
		result["piBrokerRequestId"] = clientRequestID
	}
	if correlationToken = strings.TrimSpace(correlationToken); correlationToken != "" {
		result["correlationToken"] = correlationToken
	}
	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}

func stringifyMetadataScalar(value any) (string, error) {
	switch typed := value.(type) {
	case string:
		return typed, nil
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64), nil
	case bool:
		return strconv.FormatBool(typed), nil
	case nil:
		return "null", nil
	default:
		return "", fmt.Errorf("must be string, number, boolean, or null")
	}
}

func durationFromSeconds(seconds *int, fallback time.Duration) time.Duration {
	if seconds == nil {
		return fallback
	}
	if *seconds <= 0 {
		return 0
	}
	return time.Duration(*seconds) * time.Second
}

func negotiatedMCPProtocolVersion(requested string) string {
	requested = strings.TrimSpace(requested)
	for _, candidate := range supportedMCPProtocolVersions {
		if requested == candidate {
			return candidate
		}
	}
	return mcpProtocolVersionLatest
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func successResponse(id any, result any) mcpJSONRPCSuccess {
	return mcpJSONRPCSuccess{JSONRPC: "2.0", ID: id, Result: result}
}

func errorResponse(id any, code int, message string, data any) mcpJSONRPCError {
	return mcpJSONRPCError{JSONRPC: "2.0", ID: id, Error: mcpErrorBody{Code: code, Message: message, Data: data}}
}

func newMCPToolResult(structured map[string]any, isError bool) mcpToolResult {
	text := "{}"
	if data, err := json.Marshal(structured); err == nil {
		text = string(data)
	}
	return mcpToolResult{
		Content:           []mcpTextContent{{Type: "text", Text: text}},
		StructuredContent: structured,
		IsError:           isError,
	}
}

func mcpApprovalStatus(request approval.ApprovalRequest, waitErr error) string {
	if waitErr != nil {
		switch request.Status {
		case approval.StatusExpired:
			return "expired"
		case approval.StatusAbandoned:
			return "abandoned"
		case approval.StatusPending:
			return "timed_out"
		default:
			return firstNonEmpty(request.Status, "failed")
		}
	}
	if request.Response == nil {
		return firstNonEmpty(request.Status, "responded")
	}
	if request.Response.ChoiceID == "approve" {
		return "approved"
	}
	if request.Response.ChoiceID == "deny" {
		return "denied"
	}
	return "responded"
}

func mcpSteerStatus(request approval.ApprovalRequest, waitErr error, choiceID string) string {
	if waitErr != nil {
		switch request.Status {
		case approval.StatusExpired:
			return "expired"
		case approval.StatusAbandoned:
			return "abandoned"
		case approval.StatusPending:
			return "timed_out"
		default:
			return firstNonEmpty(request.Status, "failed")
		}
	}
	if choiceID == approval.SteerNoneChoiceID {
		return "none"
	}
	return "responded"
}
