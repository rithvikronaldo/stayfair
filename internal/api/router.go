package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/stayfair/internal/events"
)

const Version = "0.1.0"

// New wires the HTTP layer. The broadcaster is injected so handlers can fan
// ledger mutations out to /events/stream subscribers.
func New(pool *pgxpool.Pool, broadcaster *events.Broadcaster) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:               "stayfair",
		DisableStartupMessage: true,
		// SSE responses must stream — disable Fiber's default body buffering.
		StreamRequestBody: true,
	})

	// Permissive CORS for the demo: the dashboard runs on Vercel while the
	// API runs elsewhere. Tighten before any real auth lands.
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Origin,Content-Type,Accept,Authorization,Idempotency-Key",
	}))

	// Resolve tenant_id from Bearer token (or default to demo tenant when
	// the header is absent — keeps the public dashboard working). Every
	// handler downstream reads it via api.TenantID(c).
	app.Use(TenantAuth(pool))

	app.Get("/health", Health(pool))
	app.Get("/events/stream", StreamEvents(broadcaster))

	app.Post("/transactions", PostTransaction(pool, broadcaster))
	app.Get("/transactions", GetTransactions(pool))
	app.Get("/accounts/:code/balance", GetAccountBalance(pool))

	app.Post("/authorizations", PostAuthorization(pool, broadcaster))
	app.Post("/authorizations/:id/capture", PostCapture(pool, broadcaster))
	app.Post("/authorizations/:id/void", PostVoid(pool, broadcaster))

	app.Post("/agents", PostAgent(pool, broadcaster))
	app.Get("/agents", GetAgents(pool))
	app.Post("/agents/:id/kill", PostKillAgent(pool, broadcaster))

	return app
}
