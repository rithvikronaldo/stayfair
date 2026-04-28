package api

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/stayfair/internal/ledger"
)

// GetAccountBalance handles GET /accounts/:code/balance.
// Optional query param: ?as_of=2026-03-15T00:00:00Z (RFC3339 timestamp).
// If as_of is set, the balance reflects only transactions with
// occurred_at <= as_of.
func GetAccountBalance(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		code := c.Params("code")
		if code == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing_account_code",
			})
		}

		var asOf *time.Time
		if raw := c.Query("as_of"); raw != "" {
			parsed, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error":   "invalid_as_of",
					"message": "as_of must be RFC3339 (e.g. 2026-03-15T00:00:00Z)",
				})
			}
			asOf = &parsed
		}

		b, err := ledger.GetBalance(c.Context(), pool, demoOrgID, code, asOf)
		if errors.Is(err, ledger.ErrUnknownAccount) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error":   "unknown_account",
				"account": code,
			})
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "balance_query_failed",
				"message": err.Error(),
			})
		}

		return c.JSON(b)
	}
}
