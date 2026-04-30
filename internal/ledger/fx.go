package ledger

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNoRate is returned when no fx_rates row exists for the requested pair
// at or before the requested timestamp.
var ErrNoRate = errors.New("ledger: no fx rate available at or before requested time")

// FXRate is the observation selected by LookupRate. Rate is returned as a
// raw NUMERIC string (e.g. "84.1000000000") to preserve full precision —
// callers performing conversion arithmetic must parse it deliberately so that
// rounding mode is explicit, in keeping with the integer-minor-unit money
// model (DESIGN.md §2).
type FXRate struct {
	From string    `json:"from"`
	To   string    `json:"to"`
	Rate string    `json:"rate"`
	AsOf time.Time `json:"as_of"`
}

// LookupRate returns the most recent fx_rates row for from -> to whose as_of
// is on or before the requested timestamp. Same-currency lookups short-circuit
// to a rate of "1" without hitting the database.
//
// Returns ErrNoRate if no rate has been observed for the pair at or before
// asOf — callers must decide whether that's a 4xx (bad request) or a 5xx
// (we forgot to ingest rates).
func LookupRate(ctx context.Context, pool *pgxpool.Pool, from, to string, asOf time.Time) (*FXRate, error) {
	if from == to {
		return &FXRate{From: from, To: to, Rate: "1", AsOf: asOf}, nil
	}

	var rate string
	var rateAsOf time.Time
	err := pool.QueryRow(ctx, `
		SELECT rate::text, as_of
		FROM fx_rates
		WHERE from_currency = $1 AND to_currency = $2 AND as_of <= $3
		ORDER BY as_of DESC
		LIMIT 1
	`, from, to, asOf).Scan(&rate, &rateAsOf)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRate
	}
	if err != nil {
		return nil, fmt.Errorf("fx lookup %s->%s: %w", from, to, err)
	}
	return &FXRate{From: from, To: to, Rate: rate, AsOf: rateAsOf}, nil
}
