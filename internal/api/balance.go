package api

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/stayfair/internal/ledger"
)

// GetAccountBalance handles GET /accounts/:code/balance.
// Returns the current balance for the account, scoped to the demo org until
// real auth lands.
func GetAccountBalance(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		code := c.Params("code")
		if code == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing_account_code",
			})
		}

		b, err := ledger.GetBalance(c.Context(), pool, demoOrgID, code)
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
