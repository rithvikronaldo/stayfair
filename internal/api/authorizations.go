package api

import (
	"encoding/json"
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/events"
	"github.com/rithvikronaldo/acta/internal/ledger"
)

// authorizeRequest is the JSON shape accepted by POST /authorizations.
type authorizeRequest struct {
	Source      string `json:"source"`
	Dest        string `json:"dest"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	Description string `json:"description"`
}

// captureRequest is the JSON shape accepted by POST /authorizations/:id/capture.
type captureRequest struct {
	Amount int64 `json:"amount"`
}

// PostAuthorization handles POST /authorizations.
//
// Reserves `amount` from `source` for an eventual transfer to `dest`. Returns
// the new pending Authorization. On success, broadcasts an `auth_created`
// event so connected dashboards can show the yellow pending row.
func PostAuthorization(pool *pgxpool.Pool, broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req authorizeRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_json",
				"message": err.Error(),
			})
		}

		auth, err := ledger.Authorize(
			c.Context(), pool, demoOrgID, TenantID(c),
			req.Source, req.Dest, req.Amount, req.Currency, req.Description,
		)
		if status, payload, ok := mapAuthError(err); ok {
			return c.Status(status).JSON(payload)
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "authorize_failed",
				"message": err.Error(),
			})
		}

		_ = broadcaster.Publish("auth_created", auth)
		return c.Status(fiber.StatusCreated).JSON(auth)
	}
}

// GetAuthorizations handles GET /authorizations.
//
// Returns the tenant's authorizations newest-first. Optional ?status= filter
// (pending|captured|voided|expired) and ?limit=. The guided new-user flow
// calls this with ?status=pending to locate the seeded hold for The Catch.
func GetAuthorizations(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		status := c.Query("status")
		limit := c.QueryInt("limit", 50)

		auths, err := ledger.ListAuthorizations(
			c.Context(), pool, demoOrgID, TenantID(c), status, limit,
		)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "list_authorizations_failed",
				"message": err.Error(),
			})
		}

		return c.JSON(fiber.Map{"authorizations": auths})
	}
}

// PostCapture handles POST /authorizations/:id/capture.
//
// Settles a pending authorization by creating a balanced transaction for
// `amount` (which must be > 0 and <= the original auth amount). Broadcasts
// an `auth_captured` event with both auth_id and the resulting transaction.
func PostCapture(pool *pgxpool.Pool, broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		authID, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_auth_id",
				"message": err.Error(),
			})
		}

		var req captureRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_json",
				"message": err.Error(),
			})
		}

		posted, err := ledger.Capture(c.Context(), pool, TenantID(c), authID, req.Amount)
		if status, payload, ok := mapAuthError(err); ok {
			return c.Status(status).JSON(payload)
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "capture_failed",
				"message": err.Error(),
			})
		}

		resp := fiber.Map{
			"authorization_id": authID,
			"transaction":      posted,
		}
		_ = broadcaster.Publish("auth_captured", resp)
		return c.Status(fiber.StatusOK).JSON(resp)
	}
}

// PostVoid handles POST /authorizations/:id/void.
//
// Releases a pending authorization without creating any entries. Broadcasts
// an `auth_voided` event with the auth ID.
func PostVoid(pool *pgxpool.Pool, broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		authID, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_auth_id",
				"message": err.Error(),
			})
		}

		if err := ledger.Void(c.Context(), pool, TenantID(c), authID); err != nil {
			if status, payload, ok := mapAuthError(err); ok {
				return c.Status(status).JSON(payload)
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "void_failed",
				"message": err.Error(),
			})
		}

		_ = broadcaster.Publish("auth_voided", fiber.Map{"authorization_id": authID})
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"authorization_id": authID,
			"status":           ledger.AuthVoided,
		})
	}
}

// mapAuthError maps domain errors to HTTP responses. Returns ok=false if the
// error is not one of the known domain errors (caller should treat as 5xx).
func mapAuthError(err error) (int, fiber.Map, bool) {
	switch {
	case err == nil:
		return 0, nil, false
	case errors.Is(err, ledger.ErrAuthNotFound):
		return fiber.StatusNotFound, fiber.Map{"error": "auth_not_found", "message": err.Error()}, true
	case errors.Is(err, ledger.ErrAuthNotPending):
		return fiber.StatusConflict, fiber.Map{"error": "auth_not_pending", "message": err.Error()}, true
	case errors.Is(err, ledger.ErrAuthExpired):
		return fiber.StatusConflict, fiber.Map{"error": "auth_expired", "message": err.Error()}, true
	case errors.Is(err, ledger.ErrCaptureExceedsAuth):
		return fiber.StatusUnprocessableEntity, fiber.Map{"error": "capture_exceeds_auth", "message": err.Error()}, true
	case errors.Is(err, ledger.ErrCurrencyMismatch):
		return fiber.StatusUnprocessableEntity, fiber.Map{"error": "currency_mismatch", "message": err.Error()}, true
	case errors.Is(err, ledger.ErrUnknownAccount):
		return fiber.StatusUnprocessableEntity, fiber.Map{"error": "unknown_account", "message": err.Error()}, true
	}
	return 0, nil, false
}
