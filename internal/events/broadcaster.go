// Package events provides a tiny in-process pub/sub broadcaster used by the
// API layer to fan ledger mutations out to SSE subscribers.
//
// This is deliberately not a queue, not a persistent log, not a Kafka. It's a
// "shout to whoever's listening right now" channel. If no one is subscribed,
// the event is dropped. If a subscriber's buffer is full (slow client), the
// event is dropped *for that subscriber only* — fast subscribers are not
// blocked by slow ones.
//
// For the agent treasury this is exactly the right tradeoff: the dashboard
// reconnects on disconnect and re-fetches state via REST, so missing a few
// events during a stall is fine. Durability would add operational cost we
// don't need.
package events

import (
	"encoding/json"
	"sync"
	"time"
)

// Event is the wire format for SSE messages.
type Event struct {
	Type      string          `json:"type"`
	Timestamp time.Time       `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

// Broadcaster fans events out to N subscribers concurrently.
type Broadcaster struct {
	mu          sync.RWMutex
	subscribers map[chan Event]struct{}
	bufSize     int
}

// New returns a Broadcaster where each Subscribe() yields a buffered channel.
// bufSize controls how many events a single subscriber can lag before its
// events start being dropped. 32 is a comfortable default for a UI client.
func New(bufSize int) *Broadcaster {
	if bufSize <= 0 {
		bufSize = 32
	}
	return &Broadcaster{
		subscribers: make(map[chan Event]struct{}),
		bufSize:     bufSize,
	}
}

// Subscribe registers a new subscriber. Returns the channel to receive on
// and an unsubscribe function. The unsubscribe function is idempotent and
// must be called when the subscriber is done (typically via defer in the
// connection handler).
func (b *Broadcaster) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, b.bufSize)

	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			b.mu.Lock()
			delete(b.subscribers, ch)
			b.mu.Unlock()
			close(ch)
		})
	}
	return ch, unsubscribe
}

// Publish marshals payload to JSON and sends an Event to every subscriber.
// Sends are non-blocking: if a subscriber's buffer is full, the event is
// dropped for *that* subscriber and Publish moves on. Publish itself never
// blocks.
//
// Returns an error only if the payload cannot be marshalled.
func (b *Broadcaster) Publish(eventType string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	ev := Event{
		Type:      eventType,
		Timestamp: time.Now().UTC(),
		Payload:   raw,
	}

	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subscribers {
		select {
		case ch <- ev:
		default:
			// subscriber's buffer is full; drop this event for them
		}
	}
	return nil
}

// SubscriberCount returns the number of currently connected subscribers.
// Useful for the /health endpoint or debug tooling.
func (b *Broadcaster) SubscriberCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subscribers)
}
