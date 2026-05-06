package approval

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSplitAndTrimCSV(t *testing.T) {
	got := splitAndTrimCSV(" one, two ; three\n four ,, ")
	want := []string{"one", "two", "three", "four"}
	if len(got) != len(want) {
		t.Fatalf("len(splitAndTrimCSV) = %d, want %d (%#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("splitAndTrimCSV[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestBuildSMTPMessageIncludesDashboardURL(t *testing.T) {
	message := buildSMTPMessage("tick@example.com", []string{"ops@example.com"}, sampleNotificationRequest(), "https://tick.example.com/#approvals")
	for _, fragment := range []string{
		"From: tick@example.com",
		"To: ops@example.com",
		"Subject: [Agent Tick] Deploy production?",
		"Agent Tick approval request",
		"Title: Deploy production?",
		"Open: https://tick.example.com/#approvals",
	} {
		if !strings.Contains(message, fragment) {
			t.Fatalf("SMTP message missing %q\n%s", fragment, message)
		}
	}
}

func TestRequestNotifierSendsConfiguredWebhooks(t *testing.T) {
	var genericPayload map[string]any
	var slackPayload map[string]any
	var teamsPayload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode %s payload: %v", r.URL.Path, err)
		}
		switch r.URL.Path {
		case "/generic":
			genericPayload = payload
		case "/slack":
			slackPayload = payload
		case "/teams":
			teamsPayload = payload
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	notifier := &RequestNotifier{
		client:           server.Client(),
		publicURL:        "https://tick.example.com",
		webhookURLs:      []string{server.URL + "/generic"},
		slackWebhookURLs: []string{server.URL + "/slack"},
		teamsWebhookURLs: []string{server.URL + "/teams"},
	}
	if err := notifier.NotifyRequestCreated(sampleNotificationRequest()); err != nil {
		t.Fatalf("NotifyRequestCreated error = %v", err)
	}

	if genericPayload["event"] != "approval.created" {
		t.Fatalf("generic event = %#v, want approval.created", genericPayload["event"])
	}
	if genericPayload["dashboardUrl"] != "https://tick.example.com/#approvals" {
		t.Fatalf("generic dashboardUrl = %#v", genericPayload["dashboardUrl"])
	}
	requestMap, ok := genericPayload["request"].(map[string]any)
	if !ok || requestMap["id"] != "req_notify" {
		t.Fatalf("generic request payload = %#v, want request id req_notify", genericPayload["request"])
	}

	if text, _ := slackPayload["text"].(string); !strings.Contains(text, "Deploy production?") {
		t.Fatalf("slack text = %#v, want title", slackPayload["text"])
	}
	blocks, ok := slackPayload["blocks"].([]any)
	if !ok || len(blocks) == 0 {
		t.Fatalf("slack blocks = %#v, want non-empty", slackPayload["blocks"])
	}

	if title, _ := teamsPayload["title"].(string); !strings.Contains(title, "Deploy production?") {
		t.Fatalf("teams title = %#v, want title", teamsPayload["title"])
	}
	if text, _ := teamsPayload["text"].(string); !strings.Contains(text, "**Open:** https://tick.example.com/#approvals") {
		t.Fatalf("teams text = %#v, want dashboard url", teamsPayload["text"])
	}
}

func TestRequestNotifierSendsSlackDM(t *testing.T) {
	var openAuth string
	var openedUsers []string
	var postedChannel string
	var postedText string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		openAuth = r.Header.Get("Authorization")
		switch r.URL.Path {
		case "/conversations.open":
			var payload map[string][]string
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode conversations.open payload: %v", err)
			}
			openedUsers = payload["users"]
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "channel": map[string]any{"id": "D123"}})
		case "/chat.postMessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode chat.postMessage payload: %v", err)
			}
			postedChannel, _ = payload["channel"].(string)
			postedText, _ = payload["text"].(string)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			t.Fatalf("unexpected slack API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	notifier := &RequestNotifier{
		client:    server.Client(),
		publicURL: "https://tick.example.com",
		slackDM: &slackDMNotifier{
			botToken:   "xoxb-test",
			userIDs:    []string{"U123"},
			apiBaseURL: server.URL,
		},
	}
	if err := notifier.NotifyRequestCreated(sampleNotificationRequest()); err != nil {
		t.Fatalf("NotifyRequestCreated error = %v", err)
	}
	if openAuth != "Bearer xoxb-test" {
		t.Fatalf("Authorization = %q, want Bearer xoxb-test", openAuth)
	}
	if len(openedUsers) != 1 || openedUsers[0] != "U123" {
		t.Fatalf("opened users = %#v, want U123", openedUsers)
	}
	if postedChannel != "D123" {
		t.Fatalf("posted channel = %q, want D123", postedChannel)
	}
	if !strings.Contains(postedText, "Deploy production?") {
		t.Fatalf("posted text = %q, want title", postedText)
	}
}

func sampleNotificationRequest() ApprovalRequest {
	return ApprovalRequest{
		ID:          "req_notify",
		RequestType: RequestTypeApproval,
		Title:       "Deploy production?",
		Command:     "kubectl apply -f prod.yaml",
		Requester: Requester{
			Name:        "codex",
			Host:        "build-host",
			ProjectName: "release-bot",
		},
		CreatedAt: time.Unix(1700000000, 0).UTC(),
	}
}
