package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"agent-tick/apps/server/internal/approval"
	qrterminal "github.com/mdp/qrterminal/v3"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "server":
		runServer(os.Args[2:])
	case "request":
		runRequest(os.Args[2:])
	case "guard":
		runGuard(os.Args[2:])
	case "pair":
		runPair(os.Args[2:])
	case "agent-token":
		runAgentToken(os.Args[2:])
	case "adapter":
		runAdapter(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

func runAdapter(args []string) {
	flags := flag.NewFlagSet("adapter", flag.ExitOnError)
	server := flags.String("server", getenv("AGENT_TICK_SERVER", "http://localhost:8787"), "Agent Tick server URL")
	timeout := flags.Duration("timeout", 10*time.Minute, "time to wait for a response")
	_ = flags.Parse(args)

	var input approval.CreateRequest
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		log.Fatal(err)
	}
	if input.Requester.AgentID == "" {
		input.Requester = requester()
	}
	if input.Title == "" {
		input.Title = "Approval requested"
	}
	if input.ExpiresAt == nil {
		expiresAt := time.Now().UTC().Add(5 * time.Minute)
		input.ExpiresAt = &expiresAt
	}
	if input.Risk == "" {
		input.Risk = classifyRisk(input.Command)
	}

	response, err := requestApproval(*server, input, *timeout)
	if err != nil {
		log.Fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
		log.Fatal(err)
	}
}

func runServer(args []string) {
	flags := flag.NewFlagSet("server", flag.ExitOnError)
	addr := flags.String("addr", ":8787", "address to listen on")
	data := flags.String("data", "./agent-tick.db", "path to SQLite data file")
	_ = flags.Parse(args)

	token := os.Getenv("AGENT_TICK_TOKEN")
	if token == "" {
		log.Print("AGENT_TICK_TOKEN is not set; only localhost requests are allowed")
	}

	store, err := approval.NewSQLiteStore(*data)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	api := approval.NewAPI(store, token)
	if err := api.SetMode(getenv("AGENT_TICK_MODE", approval.ModeSingle)); err != nil {
		log.Fatal(err)
	}
	api.SetPublicURL(os.Getenv("AGENT_TICK_PUBLIC_URL"))
	api.RequireSignatures(os.Getenv("AGENT_TICK_REQUIRE_SIGNATURE") == "1")
	log.Printf("agent-tick listening on %s", *addr)
	if err := http.ListenAndServe(*addr, api.Handler()); err != nil {
		log.Fatal(err)
	}
}

func runRequest(args []string) {
	flags := flag.NewFlagSet("request", flag.ExitOnError)
	server := flags.String("server", getenv("AGENT_TICK_SERVER", "http://localhost:8787"), "Agent Tick server URL")
	title := flags.String("title", "", "approval title")
	body := flags.String("body", "", "approval body")
	command := flags.String("command", "", "command being requested")
	contextFile := flags.String("context-file", "", "path to extra context to attach")
	timeout := flags.Duration("timeout", 10*time.Minute, "time to wait for a response")
	expiresIn := flags.Duration("expires-in", 5*time.Minute, "approval expiry duration")
	_ = flags.Parse(args)

	if strings.TrimSpace(*title) == "" {
		log.Fatal("--title is required")
	}

	expiresAt := time.Now().UTC().Add(*expiresIn)
	input := approval.CreateRequest{
		Requester: requester(),
		Title:     *title,
		Body:      *body,
		Command:   *command,
		ExpiresAt: &expiresAt,
		Risk:      classifyRisk(*command),
		Metadata:  requestMetadata(*contextFile),
	}

	current, err := requestApproval(*server, input, *timeout)
	if err != nil {
		log.Fatal(err)
	}

	printResponse(current.Response)
	if current.Response != nil && current.Response.ChoiceID == "approve" {
		return
	}
	os.Exit(1)
}

func runGuard(args []string) {
	flags := flag.NewFlagSet("guard", flag.ExitOnError)
	server := flags.String("server", getenv("AGENT_TICK_SERVER", "http://localhost:8787"), "Agent Tick server URL")
	title := flags.String("title", "Run command?", "approval title")
	body := flags.String("body", "", "approval body")
	contextFile := flags.String("context-file", "", "path to extra context to attach")
	timeout := flags.Duration("timeout", 10*time.Minute, "time to wait for a response")
	expiresIn := flags.Duration("expires-in", 5*time.Minute, "approval expiry duration")
	_ = flags.Parse(args)

	command := flags.Args()
	if len(command) == 0 {
		log.Fatal("guard requires a command after --")
	}

	commandText := strings.Join(command, " ")
	requestBody := *body
	if strings.TrimSpace(requestBody) == "" {
		requestBody = "Approve running this command?"
	}

	expiresAt := time.Now().UTC().Add(*expiresIn)
	current, err := requestApproval(*server, approval.CreateRequest{
		Requester: requester(),
		Title:     *title,
		Body:      requestBody,
		Command:   commandText,
		ExpiresAt: &expiresAt,
		Risk:      classifyRisk(commandText),
		Metadata:  requestMetadata(*contextFile),
	}, *timeout)
	if err != nil {
		log.Fatal(err)
	}

	printResponse(current.Response)
	if current.Response == nil || current.Response.ChoiceID != "approve" {
		os.Exit(1)
	}

	cmd := exec.Command(command[0], command[1:]...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		log.Fatal(err)
	}
}

func runPair(args []string) {
	flags := flag.NewFlagSet("pair", flag.ExitOnError)
	server := flags.String("server", getenv("AGENT_TICK_SERVER", "http://localhost:8787"), "Agent Tick server URL")
	qr := flags.Bool("qr", true, "print a terminal QR code")
	qrLarge := flags.Bool("qr-large", false, "print a larger terminal QR code")
	_ = flags.Parse(args)

	token, err := postJSON[approval.PairingToken](*server+"/v1/pairing-tokens", map[string]string{})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("pairing code: %s\n", token.Token)
	fmt.Printf("expires at: %s\n", token.ExpiresAt.Format(time.RFC3339))
	fmt.Printf("server: %s\n", *server)
	if *qr {
		fmt.Println()
		printPairingQR(pairingPayload(*server, token.Token), *qrLarge)
	}
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

func runAgentToken(args []string) {
	if len(args) > 0 {
		switch args[0] {
		case "list":
			runAgentTokenList(args[1:])
			return
		case "revoke":
			runAgentTokenRevoke(args[1:])
			return
		case "rotate":
			runAgentTokenRotate(args[1:])
			return
		}
	}

	flags := flag.NewFlagSet("agent-token", flag.ExitOnError)
	data := flags.String("data", "./agent-tick.db", "path to SQLite data file")
	name := flags.String("name", "agent", "agent token name")
	scopesValue := flags.String("scopes", "approval:write,approval:read", "comma-separated scopes")
	_ = flags.Parse(args)

	store, err := approval.NewSQLiteStore(*data)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	credential, err := store.CreateAgentToken(*name, splitScopes(*scopesValue))
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("agent id: %s\n", credential.AgentID)
	fmt.Printf("name: %s\n", credential.Name)
	fmt.Printf("token: %s\n", credential.Token)
	fmt.Printf("scopes: %s\n", strings.Join(credential.Scopes, ","))
}

func runAgentTokenList(args []string) {
	flags := flag.NewFlagSet("agent-token list", flag.ExitOnError)
	data := flags.String("data", "./agent-tick.db", "path to SQLite data file")
	_ = flags.Parse(args)

	store := openSQLiteStore(*data)
	defer store.Close()

	records, err := store.ListAgentTokens()
	if err != nil {
		log.Fatal(err)
	}
	for _, record := range records {
		status := "active"
		if record.RevokedAt != nil {
			status = "revoked"
		}
		fmt.Printf("%s\t%s\t%s\t%s\n", record.AgentID, record.Name, status, strings.Join(record.Scopes, ","))
	}
}

func runAgentTokenRevoke(args []string) {
	flags := flag.NewFlagSet("agent-token revoke", flag.ExitOnError)
	data := flags.String("data", "./agent-tick.db", "path to SQLite data file")
	_ = flags.Parse(args)
	if flags.NArg() != 1 {
		log.Fatal("agent-token revoke requires an agent id")
	}

	store := openSQLiteStore(*data)
	defer store.Close()

	if err := store.RevokeAgentToken(flags.Arg(0)); err != nil {
		log.Fatal(err)
	}
	fmt.Println("revoked")
}

func runAgentTokenRotate(args []string) {
	flags := flag.NewFlagSet("agent-token rotate", flag.ExitOnError)
	data := flags.String("data", "./agent-tick.db", "path to SQLite data file")
	_ = flags.Parse(args)
	if flags.NArg() != 1 {
		log.Fatal("agent-token rotate requires an agent id")
	}

	store := openSQLiteStore(*data)
	defer store.Close()

	credential, err := store.RotateAgentToken(flags.Arg(0))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("agent id: %s\n", credential.AgentID)
	fmt.Printf("name: %s\n", credential.Name)
	fmt.Printf("token: %s\n", credential.Token)
	fmt.Printf("scopes: %s\n", strings.Join(credential.Scopes, ","))
}

func openSQLiteStore(path string) *approval.SQLiteStore {
	store, err := approval.NewSQLiteStore(path)
	if err != nil {
		log.Fatal(err)
	}
	return store
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

func requestApproval(server string, input approval.CreateRequest, timeout time.Duration) (approval.ApprovalRequest, error) {
	request, err := postJSON[approval.ApprovalRequest](server+"/v1/approval-requests", input)
	if err != nil {
		return approval.ApprovalRequest{}, err
	}
	fmt.Printf("approval request created: %s\n", request.ID)

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		current, err := getJSON[approval.ApprovalRequest](server + "/v1/approval-requests/" + request.ID)
		if err != nil {
			return approval.ApprovalRequest{}, err
		}
		if current.Response != nil {
			return current, nil
		}
		if current.Status == approval.StatusExpired {
			return approval.ApprovalRequest{}, fmt.Errorf("approval request expired")
		}
		time.Sleep(2 * time.Second)
	}

	return approval.ApprovalRequest{}, fmt.Errorf("timed out waiting for approval")
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

func postJSON[T any](url string, input any) (T, error) {
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
	setAuth(req)

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

func getJSON[T any](url string) (T, error) {
	var output T
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return output, err
	}
	setAuth(req)

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

func setAuth(req *http.Request) {
	if token := os.Getenv("AGENT_TICK_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
}

func getenv(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func requester() approval.Requester {
	return approval.Requester{
		Name:             getenv("AGENT_TICK_REQUESTER", "agent-tick-cli"),
		AgentID:          getenv("AGENT_TICK_AGENT_ID", "local-agent"),
		Host:             hostname(),
		WorkingDirectory: workingDirectory(),
	}
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

func usage() {
	fmt.Fprintln(os.Stderr, "usage: agent-tick <server|request|guard|pair|agent-token|adapter> [flags]")
}
