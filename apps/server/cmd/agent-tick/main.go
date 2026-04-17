package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"agent-tick/apps/server/internal/approval"
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
	default:
		usage()
		os.Exit(2)
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
	timeout := flags.Duration("timeout", 10*time.Minute, "time to wait for a response")
	_ = flags.Parse(args)

	if strings.TrimSpace(*title) == "" {
		log.Fatal("--title is required")
	}

	input := approval.CreateRequest{
		Requester: approval.Requester{
			Name:    getenv("AGENT_TICK_REQUESTER", "agent-tick-cli"),
			AgentID: getenv("AGENT_TICK_AGENT_ID", "local-agent"),
			Host:    hostname(),
		},
		Title:   *title,
		Body:    *body,
		Command: *command,
	}

	request, err := postJSON[approval.ApprovalRequest](*server+"/v1/approval-requests", input)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("approval request created: %s\n", request.ID)

	deadline := time.Now().Add(*timeout)
	for time.Now().Before(deadline) {
		current, err := getJSON[approval.ApprovalRequest](*server + "/v1/approval-requests/" + request.ID)
		if err != nil {
			log.Fatal(err)
		}
		if current.Response != nil {
			fmt.Printf("response: %s\n", current.Response.ChoiceID)
			if current.Response.Message != "" {
				fmt.Printf("message: %s\n", current.Response.Message)
			}
			if current.Response.ChoiceID == "approve" {
				return
			}
			os.Exit(1)
		}
		time.Sleep(2 * time.Second)
	}

	log.Fatal("timed out waiting for approval")
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

func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		return ""
	}
	return name
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: agent-tick <server|request> [flags]")
}
