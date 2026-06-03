package realtime

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/nats-io/nats.go"
	"github.com/salillakra/forge/pkg/events"
	"go.uber.org/zap"
)

// ─── SSE Hub ─────────────────────────────────────────────────────────────────
// We use Server-Sent Events (SSE) because Fiber v3 does not yet ship a stable
// WebSocket upgrade helper in its core contrib module.  SSE is simpler and
// works well for server → client streaming (run status, live logs).

// Client is a connected SSE subscriber for a specific run.
type Client struct {
	RunID  string
	SendCh chan []byte
}

// Hub manages all SSE clients and broadcasts NATS events to them.
type Hub struct {
	mu      sync.RWMutex
	clients map[string][]*Client // keyed by run_id

	nc  *nats.Conn
	log *zap.Logger

	subs []*nats.Subscription
}

// NewHub creates and starts the hub. Call Close() when done.
func NewHub(nc *nats.Conn, log *zap.Logger) *Hub {
	h := &Hub{
		clients: make(map[string][]*Client),
		nc:      nc,
		log:     log,
	}
	if nc != nil {
		h.subscribeNATS()
	}
	return h
}

// Subscribe registers a new SSE client for the given runID.
func (h *Hub) Subscribe(runID string) *Client {
	c := &Client{RunID: runID, SendCh: make(chan []byte, 64)}
	h.mu.Lock()
	h.clients[runID] = append(h.clients[runID], c)
	h.mu.Unlock()
	return c
}

// Unsubscribe removes a client.
func (h *Hub) Unsubscribe(runID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := h.clients[runID]
	for i, cl := range list {
		if cl == c {
			h.clients[runID] = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(h.clients[runID]) == 0 {
		delete(h.clients, runID)
	}
	close(c.SendCh)
}

// Broadcast sends a JSON payload to all clients watching a run.
func (h *Hub) Broadcast(runID string, payload []byte) {
	h.mu.RLock()
	clients := h.clients[runID]
	h.mu.RUnlock()
	for _, c := range clients {
		select {
		case c.SendCh <- payload:
		default:
			// slow client – drop message
		}
	}
}

// Close drains all NATS subscriptions.
func (h *Hub) Close() {
	for _, s := range h.subs {
		_ = s.Unsubscribe()
	}
}

// subscribeNATS listens for status and log events from NATS and fans them out.
func (h *Hub) subscribeNATS() {
	topics := []string{
		events.TopicRunStatusChanged,
		events.TopicStepStatusChanged,
		events.TopicStepLog,
	}
	for _, topic := range topics {
		t := topic
		sub, err := h.nc.Subscribe(t, func(m *nats.Msg) {
			// Extract run_id from message for routing
			var base struct {
				RunID string `json:"run_id"`
			}
			if err := json.Unmarshal(m.Data, &base); err != nil || base.RunID == "" {
				return
			}
			h.Broadcast(base.RunID, m.Data)
		})
		if err != nil {
			h.log.Error("failed to subscribe to NATS topic",
				zap.String("topic", t), zap.Error(err))
			continue
		}
		h.subs = append(h.subs, sub)
	}
}

// ─── HTTP Handler (SSE endpoint) ─────────────────────────────────────────────

type Handler struct {
	hub *Hub
}

func NewHandler(hub *Hub) *Handler {
	return &Handler{hub: hub}
}

// StreamRun godoc: GET /api/orgs/:orgId/runs/:runId/stream
// Uses Server-Sent Events to push live updates to the client.
func (h *Handler) StreamRun(c fiber.Ctx) error {
	runID := c.Params("runId")

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	client := h.hub.Subscribe(runID)
	defer h.hub.Unsubscribe(runID, client)

	// Heartbeat to prevent proxy timeouts
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	ctx := c.Context()

	for {
		select {
		case <-ctx.Done():
			return nil
		case payload, ok := <-client.SendCh:
			if !ok {
				return nil
			}
			if _, err := c.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
				return err
			}
		case <-ticker.C:
			if _, err := c.Write([]byte(": heartbeat\n\n")); err != nil {
				return err
			}
		}
	}
}
