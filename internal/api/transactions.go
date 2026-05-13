package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/stayfair/internal/events"
	"github.com/rithvikronaldo/stayfair/internal/ledger"
)

// demoOrgID is the sentinel org from testdata/seed.sql. Until we wire real
// auth (Week 2+), every request is treated as belonging to this org.
var demoOrgID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

// postTransactionRequest is the JSON shape accepted by POST /transactions.
type postTransactionRequest struct {
	Description string         `json:"description"`
	OccurredAt  time.Time      `json:"occurred_at"`
	Entries     []ledger.Entry `json:"entries"`
}

// GetTransactions handles GET /transactions. Supports ?account=, ?from=,
// ?to=, ?limit=, ?cursor=. Returns a page of transactions newest-first with
// each transaction's full entries inline, plus a next_cursor when more pages
// exist. The dashboard's stream panel uses this to backfill on connect.
func GetTransactions(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		f := ledger.ListTransactionsFilter{
			AccountCode: c.Query("account"),
			Cursor:      c.Query("cursor"),
		}

		if raw := c.Query("from"); raw != "" {
			t, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid_from", "message": "from must be RFC3339",
				})
			}
			f.From = &t
		}
		if raw := c.Query("to"); raw != "" {
			t, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid_to", "message": "to must be RFC3339",
				})
			}
			f.To = &t
		}
		if raw := c.Query("limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid_limit", "message": "limit must be an integer",
				})
			}
			f.Limit = n
		}

		page, err := ledger.ListTransactions(c.Context(), pool, demoOrgID, TenantID(c), f)
		if err != nil {
			if errors.Is(err, ledger.ErrUnknownAccount) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error":   "unknown_account",
					"message": err.Error(),
				})
			}
			// Distinguish bad cursor from internal failure.
			if strings.HasPrefix(err.Error(), "invalid cursor") {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error":   "invalid_cursor",
					"message": err.Error(),
				})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "list_failed",
				"message": err.Error(),
			})
		}
		return c.JSON(page)
	}
}

// PostTransaction handles POST /transactions. It honours the Idempotency-Key
// header: if the same key is replayed, the original response is returned
// rather than the transaction being written twice. On a fresh successful
// post, broadcasts a `transaction_posted` event for live dashboards.
func PostTransaction(pool *pgxpool.Pool, broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ctx := c.Context()
		body := c.Body()

		var req postTransactionRequest
		if err := json.Unmarshal(body, &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_json",
				"message": err.Error(),
			})
		}

		idemKey := c.Get("Idempotency-Key")
		reqHash := hashBody(body)

		tenantID := TenantID(c)
		if idemKey != "" {
			cached, err := lookupIdempotency(ctx, pool, demoOrgID, tenantID, idemKey, reqHash)
			if errors.Is(err, errHashMismatch) {
				return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
					"error":   "idempotency_hash_mismatch",
					"message": "this idempotency key was used for a different request body",
				})
			}
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error":   "idempotency_lookup_failed",
					"message": err.Error(),
				})
			}
			if cached != nil {
				c.Set("Idempotent-Replay", "true")
				return c.Status(fiber.StatusOK).Send(cached)
			}
			if err := reserveIdempotency(ctx, pool, demoOrgID, tenantID, idemKey, reqHash); err != nil {
				if errors.Is(err, errHashMismatch) {
					return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
						"error":   "idempotency_hash_mismatch",
						"message": "this idempotency key was used for a different request body",
					})
				}
				if errors.Is(err, errStillPending) {
					return c.Status(fiber.StatusConflict).JSON(fiber.Map{
						"error":   "idempotency_pending",
						"message": "a request with this key is still processing",
					})
				}
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error":   "idempotency_reserve_failed",
					"message": err.Error(),
				})
			}
		}

		tx := ledger.Transaction{
			Description: req.Description,
			OccurredAt:  req.OccurredAt,
			Entries:     req.Entries,
		}
		posted, err := ledger.Post(ctx, pool, demoOrgID, tenantID, tx)
		if err != nil {
			status, payload := mapLedgerError(err)
			return c.Status(status).JSON(payload)
		}

		resp := fiber.Map{
			"transaction_id": posted.ID,
			"status":         "posted",
			"occurred_at":    posted.OccurredAt,
			"created_at":     posted.CreatedAt,
			"entries":        posted.Entries,
		}
		respBytes, _ := json.Marshal(resp)

		if idemKey != "" {
			_ = completeIdempotency(ctx, pool, demoOrgID, tenantID, idemKey, respBytes)
		}

		_ = broadcaster.Publish("transaction_posted", posted)
		return c.Status(fiber.StatusCreated).Send(respBytes)
	}
}

// mapLedgerError translates a domain error into the right HTTP response.
func mapLedgerError(err error) (int, fiber.Map) {
	var imb ledger.ImbalanceError
	if errors.As(err, &imb) {
		return fiber.StatusUnprocessableEntity, fiber.Map{
			"error":    "unbalanced",
			"currency": imb.Currency,
			"in":       imb.In,
			"out":      imb.Out,
			"diff":     imb.In - imb.Out,
		}
	}
	if errors.Is(err, ledger.ErrUnknownAccount) {
		return fiber.StatusUnprocessableEntity, fiber.Map{
			"error":   "unknown_account",
			"message": err.Error(),
		}
	}
	return fiber.StatusBadRequest, fiber.Map{
		"error":   "invalid_transaction",
		"message": err.Error(),
	}
}

// -- idempotency helpers --

var (
	errHashMismatch = errors.New("idempotency hash mismatch")
	errStillPending = errors.New("idempotency still pending")
)

func hashBody(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

// lookupIdempotency returns the stored response bytes if a completed record
// exists for (orgID, tenantID, key) and the request hash matches. Returns nil
// if no record exists yet. Returns errHashMismatch if the same key was used
// with a different request body.
func lookupIdempotency(ctx context.Context, pool *pgxpool.Pool, orgID, tenantID uuid.UUID, key, reqHash string) ([]byte, error) {
	var storedHash string
	var status string
	var response []byte
	err := pool.QueryRow(ctx, `
		SELECT request_hash, status, response
		FROM idempotency_keys
		WHERE org_id = $1 AND tenant_id = $2 AND key = $3
	`, orgID, tenantID, key).Scan(&storedHash, &status, &response)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedHash != reqHash {
		return nil, errHashMismatch
	}
	if status == "completed" {
		return response, nil
	}
	return nil, nil
}

// reserveIdempotency inserts a pending row. If a row already exists, returns
// errHashMismatch or errStillPending depending on the conflict.
func reserveIdempotency(ctx context.Context, pool *pgxpool.Pool, orgID, tenantID uuid.UUID, key, reqHash string) error {
	tag, err := pool.Exec(ctx, `
		INSERT INTO idempotency_keys (org_id, tenant_id, key, request_hash, status)
		VALUES ($1, $2, $3, $4, 'pending')
		ON CONFLICT (org_id, key) DO NOTHING
	`, orgID, tenantID, key, reqHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var storedHash, status string
	err = pool.QueryRow(ctx, `
		SELECT request_hash, status FROM idempotency_keys
		WHERE org_id = $1 AND tenant_id = $2 AND key = $3
	`, orgID, tenantID, key).Scan(&storedHash, &status)
	if err != nil {
		return err
	}
	if storedHash != reqHash {
		return errHashMismatch
	}
	return errStillPending
}

func completeIdempotency(ctx context.Context, pool *pgxpool.Pool, orgID, tenantID uuid.UUID, key string, response []byte) error {
	_, err := pool.Exec(ctx, `
		UPDATE idempotency_keys
		SET status = 'completed', response = $4
		WHERE org_id = $1 AND tenant_id = $2 AND key = $3
	`, orgID, tenantID, key, response)
	return err
}
