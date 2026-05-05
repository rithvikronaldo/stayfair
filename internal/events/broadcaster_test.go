package events

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBroadcasterFansOutToAllSubscribers(t *testing.T) {
	b := New(8)

	ch1, unsub1 := b.Subscribe()
	defer unsub1()
	ch2, unsub2 := b.Subscribe()
	defer unsub2()

	if err := b.Publish("test", map[string]int{"x": 1}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	for i, ch := range []<-chan Event{ch1, ch2} {
		select {
		case ev := <-ch:
			if ev.Type != "test" {
				t.Errorf("sub %d: want type=test, got %q", i, ev.Type)
			}
			var p map[string]int
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				t.Fatalf("sub %d: unmarshal: %v", i, err)
			}
			if p["x"] != 1 {
				t.Errorf("sub %d: want x=1, got %d", i, p["x"])
			}
		case <-time.After(100 * time.Millisecond):
			t.Errorf("sub %d: timed out waiting for event", i)
		}
	}
}

func TestUnsubscribeStopsReceiving(t *testing.T) {
	b := New(8)
	ch, unsub := b.Subscribe()

	unsub()

	// publish is a no-op for this subscriber (channel removed before send)
	_ = b.Publish("test", nil)

	// reading from a closed channel returns the zero value immediately
	select {
	case _, ok := <-ch:
		if ok {
			t.Error("expected closed channel after unsubscribe")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("expected immediate zero-read on closed channel")
	}

	if b.SubscriberCount() != 0 {
		t.Errorf("subscriber count: want 0, got %d", b.SubscriberCount())
	}
}

func TestUnsubscribeIsIdempotent(t *testing.T) {
	b := New(8)
	_, unsub := b.Subscribe()
	unsub()
	unsub() // must not panic
	unsub()
}

// TestSlowSubscriberCapsAtBuffer asserts the non-blocking publish behaviour:
// a subscriber that never reads has its events bounded by the buffer size.
// This is the invariant that lets the SSE layer ignore backpressure.
func TestSlowSubscriberCapsAtBuffer(t *testing.T) {
	const bufSize = 4
	b := New(bufSize)

	slow, unsub := b.Subscribe()
	defer unsub()

	// Publish 100 events; never read from slow.
	for range 100 {
		_ = b.Publish("test", 0)
	}

	// Slow has at most bufSize events queued.
	drained := 0
	timer := time.After(50 * time.Millisecond)
drainLoop:
	for {
		select {
		case <-slow:
			drained++
		case <-timer:
			break drainLoop
		}
	}
	if drained > bufSize {
		t.Errorf("slow subscriber should hold at most %d, got %d", bufSize, drained)
	}
	if drained == 0 {
		t.Error("slow subscriber should hold at least one event")
	}
}

// TestFastSubscriberKeepsUpWhileSlowDrops asserts that, with a buffer big
// enough for normal lag, an actively-draining subscriber receives every
// published event even when another subscriber sits idle and drops them.
//
// We synchronise publish→receive with a per-event acknowledgement channel so
// the test isn't sensitive to scheduler timing.
func TestFastSubscriberKeepsUpWhileSlowDrops(t *testing.T) {
	b := New(8)

	_, unsubSlow := b.Subscribe() // never read; should drop events past buffer
	defer unsubSlow()
	fast, unsubFast := b.Subscribe()
	defer unsubFast()

	const total = 100
	var seen atomic.Int64
	done := make(chan struct{})

	go func() {
		for range fast {
			if seen.Add(1) == total {
				close(done)
				return
			}
		}
	}()

	// Publish in lockstep: send one, yield until fast's count advances.
	for i := range total {
		prev := seen.Load()
		_ = b.Publish("test", i)

		// wait for the fast subscriber to acknowledge this event
		deadline := time.Now().Add(500 * time.Millisecond)
		for seen.Load() == prev {
			if time.Now().After(deadline) {
				t.Fatalf("fast subscriber stalled at event %d (seen=%d)", i, seen.Load())
			}
			time.Sleep(50 * time.Microsecond)
		}
	}

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("fast subscriber finished publishing but didn't reach %d (seen=%d)", total, seen.Load())
	}
}

func TestConcurrentSubscribeAndPublish(t *testing.T) {
	b := New(64)

	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			_, unsub := b.Subscribe()
			defer unsub()
			time.Sleep(10 * time.Millisecond)
		})
	}

	for i := range 100 {
		_ = b.Publish("noise", i)
	}

	wg.Wait()
	if b.SubscriberCount() != 0 {
		t.Errorf("after all unsubscribes, count should be 0, got %d", b.SubscriberCount())
	}
}

func TestPublishReturnsErrorOnUnmarshallablePayload(t *testing.T) {
	b := New(8)
	// channels are not JSON-marshallable
	err := b.Publish("bad", make(chan int))
	if err == nil {
		t.Error("expected error for non-marshallable payload, got nil")
	}
}
