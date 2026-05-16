package api

import (
	"encoding/json"
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/ledger"
)

// signupRequest is the JSON shape accepted by POST /tenants. No password,
// no verification — API key only. The MVP is intentionally thin: pivot
// non-goals exclude auth ceremony.
type signupRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

// PostTenant handles POST /tenants — the signup endpoint.
//
// Generates a fresh API key, stores its SHA-256 hash, returns the raw key
// in the response ONCE. The caller (frontend or curl) must surface it to
// the user with a "copy this now, you can't see it again" affordance.
//
// 409 on duplicate email. 400 on invalid JSON. 500 on backend trouble.
func PostTenant(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req signupRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_json",
				"message": err.Error(),
			})
		}

		tenant, rawKey, err := ledger.CreateTenant(c.Context(), pool, req.Email, req.Name)
		if errors.Is(err, ledger.ErrTenantExists) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":   "email_taken",
				"message": err.Error(),
			})
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "signup_failed",
				"message": err.Error(),
			})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"tenant":          tenant,
			"api_key":         rawKey,
			"api_key_warning": "store this now — it cannot be retrieved later",
		})
	}
}

// GetCurrentTenant handles GET /tenants/me — returns the tenant resolved
// from the request's Authorization header (or the demo tenant if no
// header was sent). Used by the frontend on mount to validate that a
// stored API key still maps to a real tenant; a 401 from the middleware
// upstream is the signal to clear localStorage.
func GetCurrentTenant(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		t, err := ledger.LookupTenantByID(c.Context(), pool, TenantID(c))
		if errors.Is(err, ledger.ErrTenantNotFound) {
			// Should never happen — middleware would have 401'd already —
			// but treat as not-authorised so the frontend clears state.
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "tenant_not_found",
			})
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "tenant_lookup_failed",
				"message": err.Error(),
			})
		}
		return c.JSON(t)
	}
}
