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
	"strconv"
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
		newSteerCmd(),
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
	var server, token, title, body, command, contextFile, requesterName, agentID, projectName, projectDir, defaultChoice string
	var projectIDHint, teamHint, approvalPolicy string
	var clientRequestID, correlationToken, metadataJSON string
	var choiceSpecs []string
	var allowFreeformReply bool
	var jsonEvents bool
	var noTimeout, noExpiry bool
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
			if noTimeout {
				timeout = 0
			}
			if noExpiry {
				expiresIn = 0
			}
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
			metadata, err := requestMetadata(contextFile, metadataJSON, clientRequestID, correlationToken)
			if err != nil {
				return err
			}
			requester := buildRequester(requesterName, agentID, projectName, projectDir)
			applyRoutingHints(metadata, &requester, projectIDHint, teamHint, approvalPolicy)
			input := approval.CreateRequest{
				Requester:          requester,
				Title:              title,
				Body:               body,
				Command:            command,
				Choices:            choices,
				DefaultChoice:      strings.TrimSpace(defaultChoice),
				AllowFreeformReply: allowFreeformReply,
				ExpiresAt:          expiresAtPtr(expiresIn),
				Risk:               classifyRisk(command),
				Metadata:           metadata,
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
	cmd.Flags().StringVar(&projectName, "project", os.Getenv("AGENT_TICK_PROJECT"), "project display name [env: AGENT_TICK_PROJECT]")
	cmd.Flags().StringVar(&projectDir, "project-dir", os.Getenv("AGENT_TICK_PROJECT_DIR"), "project directory for grouping; defaults to current directory [env: AGENT_TICK_PROJECT_DIR]")
	cmd.Flags().StringVar(&projectIDHint, "project-id", os.Getenv("AGENT_TICK_PROJECT_ID"), "project ID routing hint [env: AGENT_TICK_PROJECT_ID]")
	cmd.Flags().StringVar(&teamHint, "team", os.Getenv("AGENT_TICK_TEAM"), "team ID routing hint [env: AGENT_TICK_TEAM]")
	cmd.Flags().StringVar(&approvalPolicy, "approval-policy", os.Getenv("AGENT_TICK_APPROVAL_POLICY"), "approval policy routing hint [env: AGENT_TICK_APPROVAL_POLICY]")
	cmd.Flags().StringVar(&title, "title", "", "approval title (required)")
	cmd.Flags().StringVar(&body, "body", "", "approval body")
	cmd.Flags().StringVar(&command, "command", "", "command being requested")
	cmd.Flags().StringArrayVar(&choiceSpecs, "choice", nil, "response choice in id:label[:kind] format; repeat to add more")
	cmd.Flags().StringVar(&defaultChoice, "default-choice", "", "default choice ID for the request")
	cmd.Flags().BoolVar(&allowFreeformReply, "allow-reply", false, "allow an optional text reply with the selected choice")
	cmd.Flags().BoolVar(&jsonEvents, "json-events", false, "stream newline-delimited JSON lifecycle events to stdout")
	cmd.Flags().StringVar(&contextFile, "context-file", "", "path to extra context to attach")
	cmd.Flags().StringVar(&clientRequestID, "client-request-id", "", "client-side/broker request ID to echo in metadata and JSON events")
	cmd.Flags().StringVar(&correlationToken, "correlation-token", "", "opaque correlation token to echo in metadata and JSON events")
	cmd.Flags().StringVar(&metadataJSON, "metadata", "", "JSON object of scalar metadata values to attach to the request")
	cmd.Flags().DurationVar(&timeout, "timeout", 10*time.Minute, "time to wait for a response; 0 waits indefinitely")
	cmd.Flags().BoolVar(&noTimeout, "no-timeout", false, "alias for --timeout 0; wait indefinitely")
	cmd.Flags().DurationVar(&expiresIn, "expires-in", 5*time.Minute, "approval expiry duration; 0 disables expiry")
	cmd.Flags().BoolVar(&noExpiry, "no-expiry", false, "alias for --expires-in 0; disable request expiry")
	return cmd
}

func newSteerCmd() *cobra.Command {
	var server, token, title, body, contextFile, requesterName, agentID, projectName, projectDir string
	var projectIDHint, teamHint, approvalPolicy string
	var clientRequestID, correlationToken, metadataJSON string
	var optionSpecs []string
	var noTimeout, noExpiry bool
	var timeout, expiresIn time.Duration
	cmd := &cobra.Command{
		Use:     "steer",
		Aliases: []string{"follow-up", "followup"},
		Short:   "Ask a human to choose one agent-generated follow-up option",
		Args:    cobra.NoArgs,
		Long: `steer submits a constrained steering request and prints only the selected
option ID. The human cannot type a reply. A built-in none option is always
available, and timeouts, expiry, abandonment, or delivery errors all resolve to
none so callers fail closed.

See also: request, guard`,
		Example: `  agent-tick steer --title "How should I continue?" \
    --option run-tests:"Run tests and fix failures" \
    --option update-docs:"Update README/docs"
  selected="$(agent-tick steer --option stop:'Do nothing else' --option tests:'Run tests')"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if noTimeout {
				timeout = 0
			}
			if noExpiry {
				expiresIn = 0
			}
			choices, err := parseSteerOptions(optionSpecs)
			if err != nil {
				return err
			}
			if strings.TrimSpace(title) == "" {
				title = "Choose next step"
			}
			metadata, err := requestMetadata(contextFile, metadataJSON, clientRequestID, correlationToken)
			if err != nil {
				return err
			}
			requester := buildRequester(requesterName, agentID, projectName, projectDir)
			applyRoutingHints(metadata, &requester, projectIDHint, teamHint, approvalPolicy)
			selected := requestSteer(server, approval.CreateRequest{
				Requester:     requester,
				RequestType:   approval.RequestTypeSteer,
				Title:         title,
				Body:          body,
				Choices:       choices,
				DefaultChoice: approval.SteerNoneChoiceID,
				ExpiresAt:     expiresAtPtr(expiresIn),
				Metadata:      metadata,
			}, timeout, token)
			fmt.Fprintln(os.Stdout, selected)
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().StringVar(&requesterName, "requester", getenv("AGENT_TICK_REQUESTER", "agent-tick-cli"), "requester name [env: AGENT_TICK_REQUESTER]")
	cmd.Flags().StringVar(&agentID, "agent-id", getenv("AGENT_TICK_AGENT_ID", "local-agent"), "agent ID [env: AGENT_TICK_AGENT_ID]")
	cmd.Flags().StringVar(&projectName, "project", os.Getenv("AGENT_TICK_PROJECT"), "project display name [env: AGENT_TICK_PROJECT]")
	cmd.Flags().StringVar(&projectDir, "project-dir", os.Getenv("AGENT_TICK_PROJECT_DIR"), "project directory for grouping; defaults to current directory [env: AGENT_TICK_PROJECT_DIR]")
	cmd.Flags().StringVar(&projectIDHint, "project-id", os.Getenv("AGENT_TICK_PROJECT_ID"), "project ID routing hint [env: AGENT_TICK_PROJECT_ID]")
	cmd.Flags().StringVar(&teamHint, "team", os.Getenv("AGENT_TICK_TEAM"), "team ID routing hint [env: AGENT_TICK_TEAM]")
	cmd.Flags().StringVar(&approvalPolicy, "approval-policy", os.Getenv("AGENT_TICK_APPROVAL_POLICY"), "approval policy routing hint [env: AGENT_TICK_APPROVAL_POLICY]")
	cmd.Flags().StringVar(&title, "title", "", "steering title")
	cmd.Flags().StringVar(&body, "body", "", "steering body")
	cmd.Flags().StringArrayVar(&optionSpecs, "option", nil, "steering option in id:label format; repeat to add more")
	cmd.Flags().StringVar(&contextFile, "context-file", "", "path to extra context to attach")
	cmd.Flags().StringVar(&clientRequestID, "client-request-id", "", "client-side/broker request ID to echo in metadata")
	cmd.Flags().StringVar(&correlationToken, "correlation-token", "", "opaque correlation token to echo in metadata")
	cmd.Flags().StringVar(&metadataJSON, "metadata", "", "JSON object of scalar metadata values to attach to the request")
	cmd.Flags().DurationVar(&timeout, "timeout", 30*time.Minute, "time to wait for a response; 0 waits indefinitely")
	cmd.Flags().BoolVar(&noTimeout, "no-timeout", false, "alias for --timeout 0; wait indefinitely")
	cmd.Flags().DurationVar(&expiresIn, "expires-in", 30*time.Minute, "steering request expiry duration; 0 disables expiry")
	cmd.Flags().BoolVar(&noExpiry, "no-expiry", false, "alias for --expires-in 0; disable request expiry")
	return cmd
}

func newAbandonCmd() *cobra.Command {
	var server, token, clientRequestID, reason string
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "abandon <request-id>",
		Short: "Cancel a pending approval request created by an agent",
		Long: `abandon performs creator-side cancellation of a pending approval request.
It does not approve or deny the request. If the request was already answered,
the server returns the existing responded state unchanged.

See also: request`,
		Example: `  agent-tick abandon req_abc123
  agent-tick abandon req_abc123 --json
  agent-tick abandon req_abc123 --client-request-id piapr_abc --reason "tool call superseded" --json`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			request, err := abandonApproval(server, args[0], token, clientRequestID, reason)
			if err != nil {
				return err
			}
			if jsonOutput {
				return json.NewEncoder(os.Stdout).Encode(newAbandonJSONOutput(request, clientRequestID))
			}
			fmt.Printf("request %s status: %s\n", request.ID, request.Status)
			printResponse(request.Response)
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", defaultServerURL(), "Agent Tick server URL [env: AGENT_TICK_SERVER]")
	cmd.Flags().StringVar(&token, "token", defaultToken(), "authentication token [env: AGENT_TICK_TOKEN]")
	cmd.Flags().StringVar(&clientRequestID, "client-request-id", "", "verify the target request metadata matches this client/broker request ID")
	cmd.Flags().StringVar(&reason, "reason", "", "human-readable reason for abandoning the request")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "write the resulting request state as JSON")
	return cmd
}

func newGuardCmd() *cobra.Command {
	var server, token, title, body, contextFile, requesterName, agentID, projectName, projectDir string
	var projectIDHint, teamHint, approvalPolicy string
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
			metadata, err := requestMetadata(contextFile, "", "", "")
			if err != nil {
				return err
			}
			requester := buildRequester(requesterName, agentID, projectName, projectDir)
			applyRoutingHints(metadata, &requester, projectIDHint, teamHint, approvalPolicy)
			current, err := requestApproval(server, approval.CreateRequest{
				Requester: requester,
				Title:     title,
				Body:      requestBody,
				Command:   commandText,
				ExpiresAt: expiresAtPtr(expiresIn),
				Risk:      classifyRisk(commandText),
				Metadata:  metadata,
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
	cmd.Flags().StringVar(&projectName, "project", os.Getenv("AGENT_TICK_PROJECT"), "project display name [env: AGENT_TICK_PROJECT]")
	cmd.Flags().StringVar(&projectDir, "project-dir", os.Getenv("AGENT_TICK_PROJECT_DIR"), "project directory for grouping; defaults to current directory [env: AGENT_TICK_PROJECT_DIR]")
	cmd.Flags().StringVar(&projectIDHint, "project-id", os.Getenv("AGENT_TICK_PROJECT_ID"), "project ID routing hint [env: AGENT_TICK_PROJECT_ID]")
	cmd.Flags().StringVar(&teamHint, "team", os.Getenv("AGENT_TICK_TEAM"), "team ID routing hint [env: AGENT_TICK_TEAM]")
	cmd.Flags().StringVar(&approvalPolicy, "approval-policy", os.Getenv("AGENT_TICK_APPROVAL_POLICY"), "approval policy routing hint [env: AGENT_TICK_APPROVAL_POLICY]")
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
	var server, token, requesterName, agentID, projectName, projectDir string
	var projectIDHint, teamHint, approvalPolicy string
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
			if input.Metadata == nil {
				input.Metadata = map[string]string{}
			}
			input.Requester = mergeRequester(input.Requester, buildRequester(requesterName, agentID, projectName, projectDir))
			applyRoutingHints(input.Metadata, &input.Requester, projectIDHint, teamHint, approvalPolicy)
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
	cmd.Flags().StringVar(&projectName, "project", os.Getenv("AGENT_TICK_PROJECT"), "project display name [env: AGENT_TICK_PROJECT]")
	cmd.Flags().StringVar(&projectDir, "project-dir", os.Getenv("AGENT_TICK_PROJECT_DIR"), "project directory for grouping; defaults to current directory [env: AGENT_TICK_PROJECT_DIR]")
	cmd.Flags().StringVar(&projectIDHint, "project-id", os.Getenv("AGENT_TICK_PROJECT_ID"), "project ID routing hint [env: AGENT_TICK_PROJECT_ID]")
	cmd.Flags().StringVar(&teamHint, "team", os.Getenv("AGENT_TICK_TEAM"), "team ID routing hint [env: AGENT_TICK_TEAM]")
	cmd.Flags().StringVar(&approvalPolicy, "approval-policy", os.Getenv("AGENT_TICK_APPROVAL_POLICY"), "approval policy routing hint [env: AGENT_TICK_APPROVAL_POLICY]")
	cmd.Flags().DurationVar(&timeout, "timeout", 10*time.Minute, "time to wait for a response")
	return cmd
}

func parseBoolEnv(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower == "1" || lower == "true" || lower == "yes"
}

func buildRequester(name, agentID string, projectName string, projectDir string) approval.Requester {
	host := hostname()
	cwd := workingDirectory()
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		projectDir = cwd
	}
	projectName = strings.TrimSpace(projectName)
	if projectName == "" {
		projectName = filepath.Base(projectDir)
	}
	if projectName == "." || projectName == string(filepath.Separator) {
		projectName = projectDir
	}
	return approval.Requester{
		Name:             name,
		AgentID:          agentID,
		Host:             host,
		WorkingDirectory: projectDir,
		ProjectName:      projectName,
		ProjectID:        projectID(host, projectDir),
	}
}

func projectID(host string, projectDir string) string {
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		return strings.TrimSpace(host)
	}
	if strings.TrimSpace(host) == "" {
		return projectDir
	}
	return strings.TrimSpace(host) + ":" + projectDir
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
	if strings.TrimSpace(current.ProjectName) == "" {
		current.ProjectName = defaults.ProjectName
	}
	if strings.TrimSpace(current.ProjectID) == "" {
		current.ProjectID = defaults.ProjectID
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
	Type             string                    `json:"type"`
	RequestID        string                    `json:"requestId"`
	ClientRequestID  string                    `json:"clientRequestId,omitempty"`
	CorrelationToken string                    `json:"correlationToken,omitempty"`
	Status           string                    `json:"status,omitempty"`
	Response         *approval.Response        `json:"response,omitempty"`
	Request          *approval.ApprovalRequest `json:"request,omitempty"`
	Error            string                    `json:"error,omitempty"`
}

type abandonRequest struct {
	Reason          string `json:"reason,omitempty"`
	ClientRequestID string `json:"clientRequestId,omitempty"`
}

type abandonJSONOutput struct {
	approval.ApprovalRequest
	RequestID       string `json:"requestId"`
	ClientRequestID string `json:"clientRequestId,omitempty"`
	Abandoned       bool   `json:"abandoned"`
}

func requestApproval(server string, input approval.CreateRequest, timeout time.Duration, token string) (approval.ApprovalRequest, error) {
	request, err := createApprovalRequest(server, input, token)
	if err != nil {
		return approval.ApprovalRequest{}, err
	}
	fmt.Printf("approval request created: %s\n", request.ID)
	return waitForApproval(server, request.ID, timeout, token)
}

func requestSteer(server string, input approval.CreateRequest, timeout time.Duration, token string) string {
	request, err := createApprovalRequest(server, input, token)
	if err != nil {
		return approval.SteerNoneChoiceID
	}
	current, err := waitForApproval(server, request.ID, timeout, token)
	if err != nil || current.Response == nil {
		return approval.SteerNoneChoiceID
	}
	choiceID := strings.TrimSpace(current.Response.ChoiceID)
	if !hasChoiceID(localSteerChoices(input.Choices), choiceID) {
		return approval.SteerNoneChoiceID
	}
	return choiceID
}

func localSteerChoices(input []approval.Choice) []approval.Choice {
	choices := append([]approval.Choice{}, input...)
	choices = append(choices, approval.Choice{ID: approval.SteerNoneChoiceID, Label: approval.SteerNoneChoiceLabel, Kind: approval.SteerNoneChoiceID})
	return choices
}

func requestApprovalJSONEvents(server string, input approval.CreateRequest, timeout time.Duration, token string, writer io.Writer) (approval.ApprovalRequest, error) {
	request, err := createApprovalRequest(server, input, token)
	if err != nil {
		return approval.ApprovalRequest{}, err
	}
	if err := writeRequestJSONEvent(writer, newRequestJSONEvent("request.created", request)); err != nil {
		return approval.ApprovalRequest{}, err
	}

	current, err := waitForApproval(server, request.ID, timeout, token)
	current = requestWithEventFallback(current, request)
	terminalEvent := newRequestJSONEvent("request.terminal", current)
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

func newRequestJSONEvent(eventType string, request approval.ApprovalRequest) requestJSONEvent {
	if request.Status == "" {
		request.Status = approval.StatusPending
	}
	return requestJSONEvent{
		Type:             eventType,
		RequestID:        request.ID,
		ClientRequestID:  clientRequestIDForRequest(request),
		CorrelationToken: correlationTokenForRequest(request),
		Status:           request.Status,
		Response:         request.Response,
		Request:          &request,
	}
}

func requestWithEventFallback(current approval.ApprovalRequest, fallback approval.ApprovalRequest) approval.ApprovalRequest {
	if current.ID == "" {
		current.ID = fallback.ID
	}
	if current.Status == "" {
		current.Status = fallback.Status
	}
	if current.Status == "" {
		current.Status = approval.StatusPending
	}
	if len(fallback.Metadata) > 0 {
		if current.Metadata == nil {
			current.Metadata = map[string]string{}
		}
		for key, value := range fallback.Metadata {
			if _, exists := current.Metadata[key]; !exists {
				current.Metadata[key] = value
			}
		}
	}
	return current
}

func abandonApproval(server string, requestID string, token string, clientRequestID string, reason string) (approval.ApprovalRequest, error) {
	clientRequestID = strings.TrimSpace(clientRequestID)
	if clientRequestID != "" {
		current, err := getJSON[approval.ApprovalRequest](server+"/v1/approval-requests/"+requestID, token)
		if err != nil {
			return approval.ApprovalRequest{}, err
		}
		if !requestMatchesClientRequestID(current, clientRequestID) {
			return approval.ApprovalRequest{}, fmt.Errorf("client request ID does not match approval request metadata")
		}
	}
	return postJSON[approval.ApprovalRequest](server+"/v1/approval-requests/"+requestID+"/abandon", abandonRequest{
		Reason:          strings.TrimSpace(reason),
		ClientRequestID: clientRequestID,
	}, token)
}

func newAbandonJSONOutput(request approval.ApprovalRequest, clientRequestID string) abandonJSONOutput {
	if strings.TrimSpace(clientRequestID) == "" {
		clientRequestID = clientRequestIDForRequest(request)
	}
	return abandonJSONOutput{
		ApprovalRequest: request,
		RequestID:       request.ID,
		ClientRequestID: strings.TrimSpace(clientRequestID),
		Abandoned:       request.Status == approval.StatusAbandoned && request.Response == nil,
	}
}

func requestMatchesClientRequestID(request approval.ApprovalRequest, clientRequestID string) bool {
	clientRequestID = strings.TrimSpace(clientRequestID)
	if clientRequestID == "" {
		return true
	}
	for _, key := range []string{"clientRequestId", "piBrokerRequestId"} {
		if strings.TrimSpace(request.Metadata[key]) == clientRequestID {
			return true
		}
	}
	return false
}

func clientRequestIDForRequest(request approval.ApprovalRequest) string {
	if value := strings.TrimSpace(request.Metadata["clientRequestId"]); value != "" {
		return value
	}
	return strings.TrimSpace(request.Metadata["piBrokerRequestId"])
}

func correlationTokenForRequest(request approval.ApprovalRequest) string {
	return strings.TrimSpace(request.Metadata["correlationToken"])
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

func parseSteerOptions(specs []string) ([]approval.Choice, error) {
	if len(specs) == 0 {
		return nil, fmt.Errorf("at least one --option is required")
	}
	choices := make([]approval.Choice, 0, len(specs))
	seen := make(map[string]struct{}, len(specs))
	for _, raw := range specs {
		spec := strings.TrimSpace(raw)
		parts := strings.SplitN(spec, ":", 2)
		if len(parts) < 2 {
			return nil, fmt.Errorf("invalid --option %q: want id:label", raw)
		}
		id := strings.TrimSpace(parts[0])
		label := strings.TrimSpace(parts[1])
		if id == "" || label == "" {
			return nil, fmt.Errorf("invalid --option %q: id and label are required", raw)
		}
		if id == approval.SteerNoneChoiceID {
			return nil, fmt.Errorf("--option id %q is reserved", approval.SteerNoneChoiceID)
		}
		if !validSteerOptionID(id) {
			return nil, fmt.Errorf("--option id %q must match [A-Za-z0-9_-]{1,64}", id)
		}
		if _, exists := seen[id]; exists {
			return nil, fmt.Errorf("invalid --option %q: duplicate id %q", raw, id)
		}
		seen[id] = struct{}{}
		choices = append(choices, approval.Choice{ID: id, Label: label, Kind: approval.RequestTypeSteer})
	}
	return choices, nil
}

func validSteerOptionID(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
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

func applyRoutingHints(metadata map[string]string, requester *approval.Requester, projectID string, team string, approvalPolicy string) {
	if metadata == nil {
		return
	}
	if projectID = strings.TrimSpace(projectID); projectID != "" {
		metadata["projectId"] = projectID
		requester.ProjectID = projectID
	}
	if team = strings.TrimSpace(team); team != "" {
		metadata["teamId"] = team
	}
	if approvalPolicy = strings.TrimSpace(approvalPolicy); approvalPolicy != "" {
		metadata["approvalPolicy"] = approvalPolicy
	}
}

func requestMetadata(contextFile string, metadataJSON string, clientRequestID string, correlationToken string) (map[string]string, error) {
	metadata := map[string]string{}
	if strings.TrimSpace(contextFile) != "" {
		data, err := os.ReadFile(contextFile)
		if err != nil {
			return nil, err
		}
		metadata["context"] = string(data)
		metadata["contextFile"] = contextFile
	}
	extra, err := parseMetadataJSON(metadataJSON)
	if err != nil {
		return nil, err
	}
	for key, value := range extra {
		metadata[key] = value
	}
	if clientRequestID = strings.TrimSpace(clientRequestID); clientRequestID != "" {
		metadata["clientRequestId"] = clientRequestID
		metadata["piBrokerRequestId"] = clientRequestID
	}
	if correlationToken = strings.TrimSpace(correlationToken); correlationToken != "" {
		metadata["correlationToken"] = correlationToken
	}
	return metadata, nil
}

func parseMetadataJSON(value string) (map[string]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.UseNumber()
	var parsed any
	if err := decoder.Decode(&parsed); err != nil {
		return nil, fmt.Errorf("--metadata must be a JSON object: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("--metadata must contain a single JSON object")
		}
		return nil, fmt.Errorf("--metadata must be a JSON object: %w", err)
	}
	object, ok := parsed.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("--metadata must be a JSON object")
	}
	metadata := make(map[string]string, len(object))
	for key, raw := range object {
		if strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("--metadata keys must be non-empty strings")
		}
		switch value := raw.(type) {
		case string:
			metadata[key] = value
		case json.Number:
			metadata[key] = value.String()
		case bool:
			metadata[key] = strconv.FormatBool(value)
		case nil:
			metadata[key] = "null"
		default:
			return nil, fmt.Errorf("--metadata value for %q must be a scalar string, number, boolean, or null", key)
		}
	}
	return metadata, nil
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
