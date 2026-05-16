package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"

	"github.com/rithvikronaldo/acta/internal/events"
)

// StreamEvents returns a Server-Sent Events handler that publishes ledger
// events (auth/capture/void/transaction) as they happen.
//
// Wire format follows the SSE spec:
//
//	event: <type>\n
//	data: <json>\n
//	\n
//
// A heartbeat comment ":\n\n" is sent every 15s so intermediate proxies don't
// close the connection on idle.
//
// Reconnection: SSE clients (EventSource) auto-reconnect on disconnect with a
// 3s default. We don't ship Last-Event-ID replay because the dashboard
// re-fetches state via REST on connect — events are a "live tail," not a log.
func StreamEvents(broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Set(fiber.HeaderContentType, "text/event-stream")
		c.Set(fiber.HeaderCacheControl, "no-cache")
		c.Set(fiber.HeaderConnection, "keep-alive")
		c.Set(fiber.HeaderTransferEncoding, "chunked")
		c.Set("X-Accel-Buffering", "no") // disable nginx buffering

		c.Status(fiber.StatusOK).Context().SetBodyStreamWriter(
			fasthttp.StreamWriter(func(w *bufio.Writer) {
				sub, unsub := broadcaster.Subscribe()
				defer unsub()

				// Send an initial "connected" event so the client knows the
				// stream is alive. Useful for UI loading states.
				_, _ = fmt.Fprintf(w, "event: connected\ndata: {\"at\":%q}\n\n",
					time.Now().UTC().Format(time.RFC3339))
				if err := w.Flush(); err != nil {
					return
				}

				heartbeat := time.NewTicker(15 * time.Second)
				defer heartbeat.Stop()

				for {
					select {
					case ev, ok := <-sub:
						if !ok {
							return
						}
						if err := writeSSE(w, ev); err != nil {
							return
						}
					case <-heartbeat.C:
						if _, err := fmt.Fprint(w, ":\n\n"); err != nil {
							return
						}
						if err := w.Flush(); err != nil {
							return
						}
					}
				}
			}),
		)
		return nil
	}
}

func writeSSE(w *bufio.Writer, ev events.Event) error {
	data, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, data); err != nil {
		return err
	}
	return w.Flush()
}
