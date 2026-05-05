package approval

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func TestEventHubPublishOmitsRequestIDFromBroadcast(t *testing.T) {
	hub := NewEventHub()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = hub.Subscribe(w, r)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatalf("websocket Dial() error = %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(time.Second)
	for {
		hub.mu.Lock()
		clients := len(hub.clients)
		hub.mu.Unlock()
		if clients > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("websocket client was not registered")
		}
		time.Sleep(10 * time.Millisecond)
	}

	hub.Publish(Event{Type: "approval.created", RequestID: "req_secret"})
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("websocket Read() error = %v", err)
	}
	body := string(data)
	if strings.Contains(body, "req_secret") || strings.Contains(body, "requestId") {
		t.Fatalf("broadcast body = %s, want no request ID", body)
	}
	if !strings.Contains(body, "approval.created") {
		t.Fatalf("broadcast body = %s, want event type", body)
	}
}
