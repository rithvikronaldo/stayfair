package api

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/ledger"
)

// GetAccountBalance handles GET /accounts/:code/balance.
// Optional query params:
//   - ?as_of=2026-03-15T00:00:00Z (RFC3339 timestamp)
//     If as_of is set, the balance reflects only transactions with occurred_at <= as_of.
//   - ?in=USD (currency code)
//     If in is set, the balance is converted from the account's native currency
//     to the requested currency using the FX rate current at as_of (or now).
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

		targetCurrency := c.Query("in")

		// Known issue: a GET /balance arriving in the ~100ms window after a
		// just-committed Capture/Post can momentarily see the older entries
		// state (the auths table updates land first; the entries inserts
		// surface a few hundred ms later through this exact path). Suspected
		// pgx pool / pgxpool snapshot/visibility quirk specific to multi-
		// statement reads on freshly-cycled connections under HTTP request
		// load. Did not reproduce in single-process direct calls. The
		// dashboard works around this by listening on /events/stream — the
		// SSE auth_captured event ships the freshly-posted transaction's
		// entries inline so the UI never has to poll into the stale window.
		b, err := ledger.GetBalance(c.Context(), pool, demoOrgID, TenantID(c), code, asOf)
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

		// If a target currency is requested and differs from the native currency,
		// convert the balance using the FX rate at the same point in time.
		if targetCurrency != "" && targetCurrency != b.Currency {
			converted, err := ledger.ConvertBalance(c.Context(), pool, b, targetCurrency)
			if errors.Is(err, ledger.ErrNoRate) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error":   "no_fx_rate",
					"message": "no exchange rate available for the requested conversion",
					"from":    b.Currency,
					"to":      targetCurrency,
				})
			}
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error":   "fx_conversion_failed",
					"message": err.Error(),
				})
			}
			b = converted
		}

		return c.JSON(b)
	}
}
