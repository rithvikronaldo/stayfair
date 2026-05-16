package api

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/ledger"
)

// tenantIDLocal is the c.Locals() key the auth middleware writes and
// every handler reads. Exported via TenantID(c).
const tenantIDLocal = "tenant_id"

const bearerPrefix = "Bearer "

// TenantAuth resolves the request's tenant before any handler runs.
//
// Behaviour:
//   - No Authorization header → resolves to the demo tenant (DemoTenantID).
//     This keeps the public dashboard working without signup. The demo
//     tenant is intentionally world-readable; mutations against it are
//     also allowed — that's the sandbox.
//   - Authorization: Bearer <key> → SHA-256 the key, look up the tenant,
//     scope the request to that tenant_id.
//   - Authorization present but malformed or unknown key → 401.
//
// Application-scoping over RLS:
// We deliberately do not use Postgres Row-Level Security. RLS ties the
// tenant_id predicate to a session variable (SET LOCAL ...) inside a
// transaction. Our pgx pool recycles connections across requests, so
// the session variable would have to be re-set on every checkout — a
// pattern with a known footgun: if a query escapes the transaction or
// runs on a leaked connection, RLS silently returns rows from the wrong
// tenant. App-scoping puts the tenant_id predicate in every SQL string,
// which is grep-able, code-reviewable, and lints with a custom analyzer
// if we ever feel like writing one.
func TenantAuth(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get(fiber.HeaderAuthorization)

		// Unauthenticated → default to demo tenant. Public dashboard reads
		// + sandbox writes from anonymous visitors land here.
		if header == "" {
			c.Locals(tenantIDLocal, ledger.DemoTenantID)
			return c.Next()
		}

		rawKey, ok := strings.CutPrefix(header, bearerPrefix)
		if !ok || strings.TrimSpace(rawKey) == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error":   "invalid_authorization_header",
				"message": "expected: Authorization: Bearer <api_key>",
			})
		}

		t, err := ledger.LookupTenantByAPIKey(c.Context(), pool, rawKey)
		if errors.Is(err, ledger.ErrTenantNotFound) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid_api_key",
			})
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "auth_lookup_failed",
				"message": err.Error(),
			})
		}

		c.Locals(tenantIDLocal, t.ID)
		return c.Next()
	}
}

// TenantID returns the resolved tenant_id from request context. Always
// safe to call after TenantAuth ran (which is every request once the
// middleware is wired in router.go). Returns uuid.Nil if the middleware
// is missing — a programmer error, not a runtime one.
func TenantID(c *fiber.Ctx) uuid.UUID {
	v := c.Locals(tenantIDLocal)
	if id, ok := v.(uuid.UUID); ok {
		return id
	}
	return uuid.Nil
}
