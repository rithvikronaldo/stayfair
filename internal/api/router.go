package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/events"
)

const Version = "0.1.0"

// New wires the HTTP layer. The broadcaster is injected so handlers can fan
// ledger mutations out to /events/stream subscribers.
func New(pool *pgxpool.Pool, broadcaster *events.Broadcaster) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:               "acta",
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

	// Read paths stay open to anonymous visitors so the public dashboard
	// can render demo-tenant data without signup.
	app.Get("/transactions", GetTransactions(pool))
	app.Get("/accounts/:code/balance", GetAccountBalance(pool))
	app.Get("/authorizations", GetAuthorizations(pool))
	app.Get("/agents", GetAgents(pool))

	// Mutating paths require a valid Bearer token. The demo-tenant fallback
	// in TenantAuth is read-only territory — anonymous visitors of the
	// public dashboard cannot stress-test, post, capture, void, spawn, or
	// kill against the demo tenant. RequireAuth 401s on the no-header path.
	// Per-route (rather than app.Group("", RequireAuth())) because the
	// empty-prefix group leaked the middleware onto routes registered after
	// it, including POST /tenants signup.
	requireAuth := RequireAuth()
	app.Post("/transactions", requireAuth, PostTransaction(pool, broadcaster))
	app.Post("/authorizations", requireAuth, PostAuthorization(pool, broadcaster))
	app.Post("/authorizations/:id/capture", requireAuth, PostCapture(pool, broadcaster))
	app.Post("/authorizations/:id/void", requireAuth, PostVoid(pool, broadcaster))
	app.Post("/agents", requireAuth, PostAgent(pool, broadcaster))
	app.Post("/agents/:id/kill", requireAuth, PostKillAgent(pool, broadcaster))
	app.Post("/stress", requireAuth, PostStress(pool, broadcaster))

	// Signup — anyone can hit this without a Bearer token; the handler
	// upserts on email and returns a fresh API key. NOT gated by
	// RequireAuth because new users have no key yet.
	app.Post("/tenants", PostTenant(pool))

	// Current tenant — returns the tenant the middleware resolved (demo
	// when no header, the user's when Bearer is valid). Frontend uses
	// this on mount to validate a stored key still points somewhere.
	app.Get("/tenants/me", GetCurrentTenant(pool))

	return app
}
