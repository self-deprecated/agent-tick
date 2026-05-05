package approval

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

type Event struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
}

type eventBus interface {
	Subscribe(w http.ResponseWriter, r *http.Request) error
	Publish(event Event)
}

type EventHub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
}

func NewEventHub() *EventHub {
	return &EventHub{clients: map[*websocket.Conn]struct{}{}}
}

func (h *EventHub) Subscribe(w http.ResponseWriter, r *http.Request) error {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return err
	}

	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		if _, _, err := conn.Read(r.Context()); err != nil {
			return nil
		}
	}
}

func (h *EventHub) Publish(event Event) {
	// The websocket stream is a coarse invalidation signal. Avoid broadcasting
	// request IDs to every connected client; clients reload their scoped lists.
	data, err := json.Marshal(struct {
		Type string `json:"type"`
	}{Type: event.Type})
	if err != nil {
		return
	}

	h.mu.Lock()
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for conn := range h.clients {
		clients = append(clients, conn)
	}
	h.mu.Unlock()

	for _, conn := range clients {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = conn.Write(ctx, websocket.MessageText, data)
		cancel()
	}
}
