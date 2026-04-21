package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

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

// PostTransaction handles POST /transactions. It honours the Idempotency-Key
// header: if the same key is replayed, the original response is returned
// rather than the transaction being written twice.
func PostTransaction(pool *pgxpool.Pool) fiber.Handler {
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

		if idemKey != "" {
			cached, err := lookupIdempotency(ctx, pool, demoOrgID, idemKey, reqHash)
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
			if err := reserveIdempotency(ctx, pool, demoOrgID, idemKey, reqHash); err != nil {
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
		posted, err := ledger.Post(ctx, pool, demoOrgID, tx)
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
			_ = completeIdempotency(ctx, pool, demoOrgID, idemKey, respBytes)
		}

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
// exists for (orgID, key) and the request hash matches. Returns nil if no
// record exists yet. Returns errHashMismatch if the same key was used with a
// different request body.
func lookupIdempotency(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, key, reqHash string) ([]byte, error) {
	var storedHash string
	var status string
	var response []byte
	err := pool.QueryRow(ctx, `
		SELECT request_hash, status, response
		FROM idempotency_keys
		WHERE org_id = $1 AND key = $2
	`, orgID, key).Scan(&storedHash, &status, &response)
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
func reserveIdempotency(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, key, reqHash string) error {
	tag, err := pool.Exec(ctx, `
		INSERT INTO idempotency_keys (org_id, key, request_hash, status)
		VALUES ($1, $2, $3, 'pending')
		ON CONFLICT (org_id, key) DO NOTHING
	`, orgID, key, reqHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var storedHash, status string
	err = pool.QueryRow(ctx, `
		SELECT request_hash, status FROM idempotency_keys
		WHERE org_id = $1 AND key = $2
	`, orgID, key).Scan(&storedHash, &status)
	if err != nil {
		return err
	}
	if storedHash != reqHash {
		return errHashMismatch
	}
	return errStillPending
}

func completeIdempotency(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, key string, response []byte) error {
	_, err := pool.Exec(ctx, `
		UPDATE idempotency_keys
		SET status = 'completed', response = $3
		WHERE org_id = $1 AND key = $2
	`, orgID, key, response)
	return err
}
