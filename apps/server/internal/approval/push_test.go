package approval

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPushCategoryOnlyUsesQuickActionsForApproveDenyApprovals(t *testing.T) {
	if got := pushCategoryID(ApprovalRequest{RequestType: RequestTypeApproval, Choices: DefaultChoices()}); got != "approval-request" {
		t.Fatalf("pushCategoryID(default approval) = %q, want approval-request", got)
	}
	if got := pushCategoryID(ApprovalRequest{RequestType: RequestTypeSteer, Choices: []Choice{{ID: "run-tests", Label: "Run tests"}, {ID: SteerNoneChoiceID, Label: SteerNoneChoiceLabel}}}); got != "" {
		t.Fatalf("pushCategoryID(steer) = %q, want empty", got)
	}
	if got := pushCategoryID(ApprovalRequest{RequestType: RequestTypeApproval, Choices: []Choice{{ID: "stable", Label: "Stable"}}}); got != "" {
		t.Fatalf("pushCategoryID(custom approval) = %q, want empty", got)
	}
}

func TestPushSenderReturnsTicketErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"status":"error","message":"DeviceNotRegistered"}]}`))
	}))
	defer server.Close()

	sender := &PushSender{client: server.Client(), url: server.URL}

	err := sender.SendApprovalRequest([]string{"ExponentPushToken[test]"}, ApprovalRequest{ID: "req_1", Title: "Run?"})
	if err == nil || !strings.Contains(err.Error(), "DeviceNotRegistered") {
		t.Fatalf("SendApprovalRequest() error = %v, want ticket error", err)
	}
}

func TestPushSenderAcceptsSuccessfulTickets(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"status":"ok"}]}`))
	}))
	defer server.Close()

	sender := &PushSender{client: server.Client(), url: server.URL}

	if err := sender.SendApprovalRequest([]string{"ExponentPushToken[test]"}, ApprovalRequest{ID: "req_1", Title: "Run?"}); err != nil {
		t.Fatalf("SendApprovalRequest() error = %v", err)
	}
}
