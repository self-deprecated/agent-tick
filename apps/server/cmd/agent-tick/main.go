package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"agent-tick/apps/server/internal/approval"
	"github.com/charmbracelet/fang"
	qrterminal "github.com/mdp/qrterminal/v3"
	"github.com/spf13/cobra"
)

func main() {
	ctx := context.Background()
	if err := fang.Execute(ctx, newRootCmd()); err != nil {
		os.Exit(1)
	}
}

type clientConfig struct {
	Server string `json:"server"`
	Token  string `json:"token"`
}

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "agent-tick",
		Short: "Human-in-the-loop approval gateway for AI agents",
		Long: `agent-tick puts a human in the loop for AI agent actions. Agents submit
approval requests; a human reviews and approves or rejects them via the web
UI or mobile app before the action proceeds.`,
		Example: `  agent-tick server
  agent-tick setup --server https://tick.example.com --token <token>
  agent-tick request --title "Deploy to production?" --command "kubectl apply -f prod.yaml"`,
	}

	root.PersistentFlags().String("config", os.Getenv("AGENT_TICK_CONFIG"), "config file path [env: AGENT_TICK_CONFIG]")
	root.PersistentPreRunE = func(cmd *cobra.Command, args []string) error {
		if v, _ := cmd.Root().PersistentFlags().GetString("config"); v != "" {
			os.Setenv("AGENT_TICK_CONFIG", v)
		}
		return nil
	}

	root.AddCommand(
		newSetupCmd(),
		newServerCmd(),
		newRequestCmd(),
		newAbandonCmd(),
		newGuardCmd(),
		newPairCmd(),
		newAgentTokenCmd(),
		newAdapterCmd(),
	)
	return root
}

func newSetupCmd() *cobra.Command {
	var server, token string
	cmd := &cobra.Command{
		Use:   "setup",
		Short: "Configure client server URL and authentication token",
		Long: `setup saves a server URL and agent token to the local config file so that
client commands (request, guard, adapter, pair) can find the server without
requiring flags on every invocation.

See also: server, agent-token`,
		Example: `  agent-tick setup --server https://tick.example.com --token <your-token>
  agent-tick --config /etc/agent-tick/config.json setup \
    --server https://tick.example.com --token <your-token>`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(server) == "" {
				return fmt.Errorf("--server is required")
			}
			if strings.TrimSpace(token) == "" {
				return fmt.Errorf("--token is required")
			}
			path, err := saveClientConfig(clientConfig{
				Server: strings.TrimRight(strings.TrimSpace(server), "/"),
				Token:  strings.TrimSpace(token),
			})
			if err != nil {
				return err
			}
			fmt.Printf("saved Agent Tick config to %s\n", path)
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "Agent Tick server URL")
	cmd.Flags().StringVar(&token, "token", "", "Agent Tick agent token")
	return cmd
}

func newServerCmd() *cobra.Command {
	var addr, data, token, mode, publicURL string
	var requireSignature bool
	cmd := &cobra.Command{
		Use:   "server",
		Short: "Start the approval server",
		Long: `server starts the agent-tick approval HTTP server. The server stores approval
requests in a local SQLite database and exposes a REST API for agents and the
web/mobile UI to consume.

See also: setup, agent-token`,
		Example: `  agent-tick server
  agent-tick server --addr :9090 --data /var/lib/agent-tick/agent-tick.db
  agent-tick server --token <admin-token> --public-url https://tick.example.com`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if token == "" {
				log.Print("--token is not set; only localhost requests are allowed")
			}
			store, err := approval.NewSQLiteStore(data)
			if err != nil {
				return err
			}
			defer store.Close()

			api := approval.NewAPI(store, token)
			if err := api.SetMode(mode); err != nil {
				return err
			}
			api.SetPublicURL(publicURL)
			api.RequireSignatures(requireSignature)
			log.Printf("agent-tick listening on %s", addr)
			return http.ListenAndServe(addr, api.Handler())
		},
	}
	cmd.Flags().StringVar(&addr, "addr", ":8787", "address to listen on")
	cmd.Flags().StringVar(&data, "data", "./agent-tick.db", "path to SQLite data file")
	cmd.Flags().StringVar(&token, "token", os.Getenv("AGENT_TICK_TOKEN"), "admin auth token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().StringVar(&mode, "mode", getenv("AGENT_TICK_MODE", approval.ModeSingle), "API mode (single) [env: AGENT_TICK_MODE]")
	cmd.Flags().StringVar(&publicURL, "public-url", os.Getenv("AGENT_TICK_PUBLIC_URL"), "public server URL [env: AGENT_TICK_PUBLIC_URL]")
	cmd.Flags().BoolVar(&requireSignature, "require-signature", parseBoolEnv(os.Getenv("AGENT_TICK_REQUIRE_SIGNATURE")), "require request signatures [env: AGENT_TICK_REQUIRE_SIGNATURE]")
	return cmd
}

func newRequestCmd() *cobra.Command {
	var server, token, title, body, command, contextFile, requesterName, agentID, defaultChoice string
	var choiceSpecs []string
	var allowFreeformReply bool
	var jsonEvents bool
	var timeout, expiresIn time.Duration
	cmd := &cobra.Command{
		Use:   "request",
		Short: "Create an approval request and wait for a response",
		Long: `request submits a human approval request to the server and blocks until the
request is approved, rejected, abandoned, expired, or times out. Exit code 0
means approved; exit code 1 means denied, abandoned, expired, or timed out.
When custom --choice flags are provided, the command exits 0 for any valid
response and prints the selected choice ID.

Use --json-events to stream newline-delimited JSON events to stdout: a created
entry with the request ID immediately, then a terminal entry when the request
is answered, abandoned, expired, or times out.

See also: guard, adapter, abandon`,
		Example: `  agent-tick request --title "Deploy to production?" --command "kubectl apply -f prod.yaml"
  agent-tick request --title "Pick a release channel" \
    --choice stable:Stable --choice beta:Beta --choice nightly:Nightly
  agent-tick request --title "Send customer email" --body "To: alice@example.com" \
    --timeout 30m --expires-in 15m
  agent-tick request --title "Wait forever" --json-events --timeout 0 --expires-in 0`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(title) == "" {
				return fmt.Errorf("--title is required")
			}
			choices, err := parseChoices(choiceSpecs)
			if err != nil {
				return err
			}
			if strings.TrimSpace(defaultChoice) != "" && !hasChoiceID(choices, defaultChoice) {
				return fmt.Errorf("--default-choice %q must match one of the provided --choice IDs", defaultChoice)
			}
			input := approval.CreateRequest{
				Requester:          buildRequester(requesterName, agentID),
				Title:              title,
				Body:               body,
				Command:            command,
				Choices:            choices,
				DefaultChoice:      strings.TrimSpace(defaultChoice),
				AllowFreeformReply: allowFreeformReply,
				ExpiresAt:          expiresAtPtr(expiresIn),
				Risk:               classifyRisk(command),
				Metadata:           requestMetadata(contextFile),
			}
			var current approval.ApprovalRequest
			if jsonEvents {
				current, err = requestApprovalJSONEvents(server, input, timeout, token, os.Stdout)
			} else {
				current, err = requestApproval(server, input, timeout, token)
			}
			if err != nil {
				return err
			}
			if !jsonEvents {
				printResponse(current.Response)
			}
			if len(choices) > 0 {
				return nil
			}
			if current.Response == nil || current.Response.ChoiceID != "approve" {
				os.Exit(1)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().StringVar(&requesterName, "requester", getenv("AGENT_TICK_REQUESTER", "agent-tick-cli"), "requester name [env: AGENT_TICK_REQUESTER]")
	cmd.Flags().StringVar(&agentID, "agent-id", getenv("AGENT_TICK_AGENT_ID", "local-agent"), "agent ID [env: AGENT_TICK_AGENT_ID]")
	cmd.Flags().StringVar(&title, "title", "", "approval title (required)")
	cmd.Flags().StringVar(&body, "body", "", "approval body")
	cmd.Flags().StringVar(&command, "command", "", "command being requested")
	cmd.Flags().StringArrayVar(&choiceSpecs, "choice", nil, "response choice in id:label[:kind] format; repeat to add more")
	cmd.Flags().StringVar(&defaultChoice, "default-choice", "", "default choice ID for the request")
	cmd.Flags().BoolVar(&allowFreeformReply, "allow-reply", false, "allow an optional text reply with the selected choice")
	cmd.Flags().BoolVar(&jsonEvents, "json-events", false, "stream newline-delimited JSON lifecycle events to stdout")
	cmd.Flags().StringVar(&contextFile, "context-file", "", "path to extra context to attach")
	cmd.Flags().DurationVar(&timeout, "timeout", 10*time.Minute, "time to wait for a response; 0 waits indefinitely")
	cmd.Flags().DurationVar(&expiresIn, "expires-in", 5*time.Minute, "approval expiry duration; 0 disables expiry")
	return cmd
}

func newAbandonCmd() *cobra.Command {
	var server, token string
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "abandon <request-id>",
		Short: "Cancel a pending approval request created by an agent",
		Long: `abandon performs creator-side cancellation of a pending approval request.
It does not approve or deny the request. If the request was already answered,
the server returns the existing responded state unchanged.

See also: request`,
		Example: `  agent-tick abandon req_abc123
  agent-tick abandon req_abc123 --json`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			request, err := abandonApproval(server, args[0], token)
			if err != nil {
				return err
			}
			if jsonOutput {
				return json.NewEncoder(os.Stdout).Encode(request)
			}
			fmt.Printf("request %s status: %s\n", request.ID, request.Status)
			printResponse(request.Response)
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "write the resulting request state as JSON")
	return cmd
}

func newGuardCmd() *cobra.Command {
	var server, token, title, body, contextFile, requesterName, agentID string
	var timeout, expiresIn time.Duration
	cmd := &cobra.Command{
		Use:   "guard [-- command...]",
		Short: "Request approval before running a command",
		Long: `guard requests human approval then, if approved, executes the supplied command.
Separate guard's flags from the guarded command with --. Exit code mirrors the
guarded command; exits 1 if the request is denied or times out.

See also: request, adapter`,
		Example: `  agent-tick guard -- rm -rf /tmp/old-data
  agent-tick guard --title "Deploy to prod?" --timeout 30m -- kubectl apply -f prod.yaml`,
		Args: cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return fmt.Errorf("guard requires a command after --")
			}
			commandText := strings.Join(args, " ")
			requestBody := body
			if strings.TrimSpace(requestBody) == "" {
				requestBody = "Approve running this command?"
			}
			current, err := requestApproval(server, approval.CreateRequest{
				Requester: buildRequester(requesterName, agentID),
				Title:     title,
				Body:      requestBody,
				Command:   commandText,
				ExpiresAt: expiresAtPtr(expiresIn),
				Risk:      classifyRisk(commandText),
				Metadata:  requestMetadata(contextFile),
			}, timeout, token)
			if err != nil {
				return err
			}
			printResponse(current.Response)
			if current.Response == nil || current.Response.ChoiceID != "approve" {
				os.Exit(1)
			}
			c := exec.Command(args[0], args[1:]...)
			c.Stdin = os.Stdin
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			if err := c.Run(); err != nil {
				if exitErr, ok := err.(*exec.ExitError); ok {
					os.Exit(exitErr.ExitCode())
				}
				return err
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().StringVar(&requesterName, "requester", getenv("AGENT_TICK_REQUESTER", "agent-tick-cli"), "requester name [env: AGENT_TICK_REQUESTER]")
	cmd.Flags().StringVar(&agentID, "agent-id", getenv("AGENT_TICK_AGENT_ID", "local-agent"), "agent ID [env: AGENT_TICK_AGENT_ID]")
	cmd.Flags().StringVar(&title, "title", "Run command?", "approval title")
	cmd.Flags().StringVar(&body, "body", "", "approval body")
	cmd.Flags().StringVar(&contextFile, "context-file", "", "path to extra context to attach")
	cmd.Flags().DurationVar(&timeout, "timeout", 10*time.Minute, "time to wait for a response")
	cmd.Flags().DurationVar(&expiresIn, "expires-in", 5*time.Minute, "approval expiry duration")
	return cmd
}

func newPairCmd() *cobra.Command {
	var server, token string
	var qr, qrLarge bool
	cmd := &cobra.Command{
		Use:   "pair",
		Short: "Generate a pairing code to register a mobile device",
		Long: `pair creates a short-lived pairing token and prints a QR code so a mobile
device can register itself with the server. The QR code encodes both the
server URL and the pairing token.

See also: agent-token, setup`,
		Example: `  agent-tick pair
  agent-tick pair --qr-large
  agent-tick pair --server https://tick.example.com --no-qr`,
		RunE: func(cmd *cobra.Command, args []string) error {
			pToken, err := postJSON[approval.PairingToken](server+"/v1/pairing-tokens", map[string]string{}, token)
			if err != nil {
				return err
			}
			fmt.Printf("pairing code: %s\n", pToken.Token)
			fmt.Printf("expires at: %s\n", pToken.ExpiresAt.Format(time.RFC3339))
			fmt.Printf("server: %s\n", server)
			if qr {
				fmt.Println()
				printPairingQR(pairingPayload(server, pToken.Token), qrLarge)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().BoolVar(&qr, "qr", true, "print a terminal QR code")
	cmd.Flags().BoolVar(&qrLarge, "qr-large", false, "print a larger terminal QR code")
	return cmd
}

func newAgentTokenCmd() *cobra.Command {
	var data, name, scopes string
	cmd := &cobra.Command{
		Use:   "agent-token",
		Short: "Create and manage agent authentication tokens",
		Long: `agent-token creates, lists, revokes, and rotates agent credentials stored in
the server database. These tokens are given to agents as AGENT_TICK_TOKEN so
they can submit approval requests.

See also: setup, pair`,
		Example: `  agent-tick agent-token --name my-agent --scopes approval:write,approval:read
  agent-tick agent-token list
  agent-tick agent-token revoke <agent-id>
  agent-tick agent-token rotate <agent-id>`,
		RunE: func(cmd *cobra.Command, args []string) error {
			store, err := approval.NewSQLiteStore(data)
			if err != nil {
				return err
			}
			defer store.Close()
			credential, err := store.CreateAgentToken(name, splitScopes(scopes))
			if err != nil {
				return err
			}
			fmt.Printf("agent id: %s\n", credential.AgentID)
			fmt.Printf("name: %s\n", credential.Name)
			fmt.Printf("token: %s\n", credential.Token)
			fmt.Printf("scopes: %s\n", strings.Join(credential.Scopes, ","))
			return nil
		},
	}
	cmd.Flags().StringVar(&data, "data", "./agent-tick.db", "path to SQLite data file")
	cmd.Flags().StringVar(&name, "name", "agent", "agent token name")
	cmd.Flags().StringVar(&scopes, "scopes", "approval:write,approval:read", "comma-separated scopes")
	cmd.AddCommand(
		newAgentTokenListCmd(),
		newAgentTokenRevokeCmd(),
		newAgentTokenRotateCmd(),
	)
	return cmd
}

func newAgentTokenListCmd() *cobra.Command {
	var data string
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List all agent tokens",
		Long:  "See also: agent-token, revoke, rotate",
		Example: `  agent-tick agent-token list
  agent-tick agent-token list --data /var/lib/agent-tick/agent-tick.db`,
		RunE: func(cmd *cobra.Command, args []string) error {
			store := openSQLiteStore(data)
			defer store.Close()
			records, err := store.ListAgentTokens()
			if err != nil {
				return err
			}
			for _, record := range records {
				status := "active"
				if record.RevokedAt != nil {
					status = "revoked"
				}
				fmt.Printf("%s\t%s\t%s\t%s\n", record.AgentID, record.Name, status, strings.Join(record.Scopes, ","))
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&data, "data", "./agent-tick.db", "path to SQLite data file")
	return cmd
}

func newAgentTokenRevokeCmd() *cobra.Command {
	var data string
	cmd := &cobra.Command{
		Use:     "revoke <agent-id>",
		Short:   "Revoke an agent token by agent ID",
		Long:    "See also: agent-token, list, rotate",
		Args:    cobra.ExactArgs(1),
		Example: `  agent-tick agent-token revoke abc123def456`,
		RunE: func(cmd *cobra.Command, args []string) error {
			store := openSQLiteStore(data)
			defer store.Close()
			if err := store.RevokeAgentToken(args[0]); err != nil {
				return err
			}
			fmt.Println("revoked")
			return nil
		},
	}
	cmd.Flags().StringVar(&data, "data", "./agent-tick.db", "path to SQLite data file")
	return cmd
}

func newAgentTokenRotateCmd() *cobra.Command {
	var data string
	cmd := &cobra.Command{
		Use:     "rotate <agent-id>",
		Short:   "Rotate (regenerate) an agent token by agent ID",
		Long:    "See also: agent-token, list, revoke",
		Args:    cobra.ExactArgs(1),
		Example: `  agent-tick agent-token rotate abc123def456`,
		RunE: func(cmd *cobra.Command, args []string) error {
			store := openSQLiteStore(data)
			defer store.Close()
			credential, err := store.RotateAgentToken(args[0])
			if err != nil {
				return err
			}
			fmt.Printf("agent id: %s\n", credential.AgentID)
			fmt.Printf("name: %s\n", credential.Name)
			fmt.Printf("token: %s\n", credential.Token)
			fmt.Printf("scopes: %s\n", strings.Join(credential.Scopes, ","))
			return nil
		},
	}
	cmd.Flags().StringVar(&data, "data", "./agent-tick.db", "path to SQLite data file")
	return cmd
}

func newAdapterCmd() *cobra.Command {
	var server, token, requesterName, agentID string
	var timeout time.Duration
	cmd := &cobra.Command{
		Use:   "adapter",
		Short: "Request approval from a JSON payload on stdin",
		Long: `adapter reads a JSON approval request from stdin and blocks until the request
is approved, rejected, or times out. It writes the approval response JSON to
stdout. Designed for use in automated pipelines.

See also: request, guard`,
		Example: `  echo '{"title":"Deploy?","command":"kubectl apply"}' | agent-tick adapter
  cat request.json | agent-tick adapter --timeout 30m`,
		RunE: func(cmd *cobra.Command, args []string) error {
			var input approval.CreateRequest
			if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
				return err
			}
			input.Requester = mergeRequester(input.Requester, buildRequester(requesterName, agentID))
			if input.Title == "" {
				input.Title = "Approval requested"
			}
			if input.ExpiresAt == nil {
				t := time.Now().UTC().Add(5 * time.Minute)
				input.ExpiresAt = &t
			}
			if input.Risk == "" {
				input.Risk = classifyRisk(input.Command)
			}
			response, err := requestApproval(server, input, timeout, token)
			if err != nil {
				return err
			}
			return json.NewEncoder(os.Stdout).Encode(response)
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().StringVar(&requesterName, "requester", getenv("AGENT_TICK_REQUESTER", "agent-tick-cli"), "requester name [env: AGENT_TICK_REQUESTER]")
	cmd.Flags().StringVar(&agentID, "agent-id", getenv("AGENT_TICK_AGENT_ID", "local-agent"), "agent ID [env: AGENT_TICK_AGENT_ID]")
	cmd.Flags().DurationVar(&timeout, "timeout", 10*time.Minute, "time to wait for a response")
	return cmd
}

func parseBoolEnv(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower == "1" || lower == "true" || lower == "yes"
}

func buildRequester(name, agentID string) approval.Requester {
	return approval.Requester{
		Name:             name,
		AgentID:          agentID,
		Host:             hostname(),
		WorkingDirectory: workingDirectory(),
	}
}

func mergeRequester(current approval.Requester, defaults approval.Requester) approval.Requester {
	if strings.TrimSpace(current.Name) == "" {
		current.Name = defaults.Name
	}
	if strings.TrimSpace(current.AgentID) == "" {
		current.AgentID = defaults.AgentID
	}
	if strings.TrimSpace(current.Host) == "" {
		current.Host = defaults.Host
	}
	if strings.TrimSpace(current.WorkingDirectory) == "" {
		current.WorkingDirectory = defaults.WorkingDirectory
	}
	return current
}

func expiresAtPtr(d time.Duration) *time.Time {
	if d == 0 {
		return nil
	}
	t := time.Now().UTC().Add(d)
	return &t
}

var approvalPollInterval = 2 * time.Second

type requestJSONEvent struct {
	Type      string             `json:"type"`
	RequestID string             `json:"requestId"`
	Status    string             `json:"status,omitempty"`
	Response  *approval.Response `json:"response,omitempty"`
	Error     string             `json:"error,omitempty"`
}

func requestApproval(server string, input approval.CreateRequest, timeout time.Duration, token string) (approval.ApprovalRequest, error) {
	request, err := createApprovalRequest(server, input, token)
	if err != nil {
		return approval.ApprovalRequest{}, err
	}
	fmt.Printf("approval request created: %s\n", request.ID)
	return waitForApproval(server, request.ID, timeout, token)
}

func requestApprovalJSONEvents(server string, input approval.CreateRequest, timeout time.Duration, token string, writer io.Writer) (approval.ApprovalRequest, error) {
	request, err := createApprovalRequest(server, input, token)
	if err != nil {
		return approval.ApprovalRequest{}, err
	}
	if err := writeRequestJSONEvent(writer, requestJSONEvent{
		Type:      "request.created",
		RequestID: request.ID,
		Status:    request.Status,
	}); err != nil {
		return approval.ApprovalRequest{}, err
	}

	current, err := waitForApproval(server, request.ID, timeout, token)
	if current.ID == "" {
		current = request
	}
	terminalEvent := requestJSONEvent{
		Type:      "request.terminal",
		RequestID: current.ID,
		Status:    current.Status,
		Response:  current.Response,
	}
	if terminalEvent.Status == "" {
		terminalEvent.Status = approval.StatusPending
	}
	if err != nil {
		terminalEvent.Error = err.Error()
	}
	if writeErr := writeRequestJSONEvent(writer, terminalEvent); writeErr != nil {
		return current, writeErr
	}
	return current, err
}

func createApprovalRequest(server string, input approval.CreateRequest, token string) (approval.ApprovalRequest, error) {
	return postJSON[approval.ApprovalRequest](server+"/v1/approval-requests", input, token)
}

func waitForApproval(server string, requestID string, timeout time.Duration, token string) (approval.ApprovalRequest, error) {
	var deadline time.Time
	if timeout > 0 {
		deadline = time.Now().Add(timeout)
	}
	var current approval.ApprovalRequest
	for {
		if timeout > 0 && !time.Now().Before(deadline) {
			if current.ID == "" {
				current.ID = requestID
				current.Status = approval.StatusPending
			}
			return current, fmt.Errorf("timed out waiting for approval")
		}

		var err error
		current, err = getJSON[approval.ApprovalRequest](server+"/v1/approval-requests/"+requestID, token)
		if err != nil {
			return current, err
		}
		if current.Response != nil || current.Status == approval.StatusResponded {
			return current, nil
		}
		switch current.Status {
		case approval.StatusExpired:
			return current, fmt.Errorf("approval request expired")
		case approval.StatusAbandoned:
			return current, fmt.Errorf("approval request abandoned")
		}

		sleepFor := approvalPollInterval
		if timeout > 0 {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				continue
			}
			if remaining < sleepFor {
				sleepFor = remaining
			}
		}
		time.Sleep(sleepFor)
	}
}

func writeRequestJSONEvent(writer io.Writer, event requestJSONEvent) error {
	return json.NewEncoder(writer).Encode(event)
}

func abandonApproval(server string, requestID string, token string) (approval.ApprovalRequest, error) {
	return postJSON[approval.ApprovalRequest](server+"/v1/approval-requests/"+requestID+"/abandon", map[string]string{}, token)
}

func printResponse(response *approval.Response) {
	if response == nil {
		return
	}
	fmt.Printf("response: %s\n", response.ChoiceID)
	if response.Message != "" {
		fmt.Printf("message: %s\n", response.Message)
	}
}

func postJSON[T any](url string, input any, token string) (T, error) {
	var output T
	body, err := json.Marshal(input)
	if err != nil {
		return output, err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return output, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return output, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return output, fmt.Errorf("server returned %s", resp.Status)
	}
	return output, json.NewDecoder(resp.Body).Decode(&output)
}

func getJSON[T any](url string, token string) (T, error) {
	var output T
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return output, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return output, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return output, fmt.Errorf("server returned %s", resp.Status)
	}
	return output, json.NewDecoder(resp.Body).Decode(&output)
}

func defaultServerURL() string {
	if value := os.Getenv("AGENT_TICK_SERVER"); value != "" {
		return value
	}
	if config, err := loadClientConfig(); err == nil && config.Server != "" {
		return config.Server
	}
	return "http://localhost:8787"
}

func defaultToken() string {
	if value := os.Getenv("AGENT_TICK_TOKEN"); value != "" {
		return value
	}
	if config, err := loadClientConfig(); err == nil {
		return config.Token
	}
	return ""
}

func loadClientConfig() (clientConfig, error) {
	var config clientConfig
	path, err := clientConfigPath()
	if err != nil {
		return config, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return config, err
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return config, err
	}
	config.Server = strings.TrimRight(strings.TrimSpace(config.Server), "/")
	config.Token = strings.TrimSpace(config.Token)
	return config, nil
}

func saveClientConfig(config clientConfig) (string, error) {
	path, err := clientConfigPath()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func clientConfigPath() (string, error) {
	if path := os.Getenv("AGENT_TICK_CONFIG"); path != "" {
		return path, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "agent-tick", "config.json"), nil
}

func getenv(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func splitScopes(value string) []string {
	parts := strings.Split(value, ",")
	scopes := make([]string, 0, len(parts))
	for _, part := range parts {
		scope := strings.TrimSpace(part)
		if scope != "" {
			scopes = append(scopes, scope)
		}
	}
	return scopes
}

func parseChoices(specs []string) ([]approval.Choice, error) {
	if len(specs) == 0 {
		return nil, nil
	}
	choices := make([]approval.Choice, 0, len(specs))
	seen := make(map[string]struct{}, len(specs))
	for _, raw := range specs {
		spec := strings.TrimSpace(raw)
		parts := strings.SplitN(spec, ":", 3)
		if len(parts) < 2 {
			return nil, fmt.Errorf("invalid --choice %q: want id:label[:kind]", raw)
		}
		id := strings.TrimSpace(parts[0])
		label := strings.TrimSpace(parts[1])
		kind := "custom"
		if len(parts) == 3 && strings.TrimSpace(parts[2]) != "" {
			kind = strings.TrimSpace(parts[2])
		}
		if id == "" || label == "" {
			return nil, fmt.Errorf("invalid --choice %q: id and label are required", raw)
		}
		if _, exists := seen[id]; exists {
			return nil, fmt.Errorf("invalid --choice %q: duplicate id %q", raw, id)
		}
		seen[id] = struct{}{}
		choices = append(choices, approval.Choice{ID: id, Label: label, Kind: kind})
	}
	return choices, nil
}

func hasChoiceID(choices []approval.Choice, id string) bool {
	for _, choice := range choices {
		if choice.ID == id {
			return true
		}
	}
	return false
}

func classifyRisk(command string) string {
	command = strings.TrimSpace(command)
	if command == "" {
		return ""
	}
	lower := strings.ToLower(command)
	if strings.Contains(lower, "rm -rf") ||
		strings.Contains(lower, "sudo ") ||
		strings.Contains(lower, "chmod 777") ||
		strings.Contains(lower, "git reset --hard") ||
		strings.Contains(lower, "kubectl delete") {
		return "high"
	}
	if strings.Contains(lower, "npm install") ||
		strings.Contains(lower, "curl ") ||
		strings.Contains(lower, "wget ") ||
		strings.Contains(lower, "go get") ||
		strings.Contains(lower, "cargo install") {
		return "medium"
	}
	if strings.HasPrefix(lower, "ls") ||
		strings.HasPrefix(lower, "pwd") ||
		strings.HasPrefix(lower, "git status") {
		return "low"
	}
	return "medium"
}

func requestMetadata(contextFile string) map[string]string {
	metadata := map[string]string{}
	if strings.TrimSpace(contextFile) == "" {
		return metadata
	}
	data, err := os.ReadFile(contextFile)
	if err != nil {
		log.Fatal(err)
	}
	metadata["context"] = string(data)
	metadata["contextFile"] = contextFile
	return metadata
}

func pairingPayload(server string, token string) string {
	payload := map[string]string{
		"serverURL":   server,
		"pairingCode": token,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return token
	}
	return string(data)
}

func printPairingQR(payload string, large bool) {
	config := qrterminal.Config{
		Level:          qrterminal.L,
		Writer:         os.Stdout,
		HalfBlocks:     true,
		BlackChar:      " ",
		WhiteBlackChar: "▀",
		WhiteChar:      "█",
		BlackWhiteChar: "▄",
		QuietZone:      1,
	}
	if large {
		config.HalfBlocks = false
		config.BlackChar = "  "
		config.WhiteChar = "██"
		config.QuietZone = 2
	}
	qrterminal.GenerateWithConfig(payload, config)
}

func openSQLiteStore(path string) *approval.SQLiteStore {
	store, err := approval.NewSQLiteStore(path)
	if err != nil {
		log.Fatal(err)
	}
	return store
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		return ""
	}
	return name
}

func workingDirectory() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return cwd
}
