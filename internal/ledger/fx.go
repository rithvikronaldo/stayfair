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

// Convert multiplies the given amount (in the source currency's minor units)
// by this rate and rounds to the nearest integer.
//
// The rate is stored as a NUMERIC string with up to 10 decimal places
// (e.g., "84.1000000000" or "0.0119000000"). We use integer arithmetic
// to avoid floating-point drift.
//
// Example: converting 10000 INR paise (100.00 INR) to USD at rate "0.0119"
// → 10000 * 0.0119 = 119.0 → 119 USD cents ($1.19).
//
// The conversion assumes both currencies use the same minor_unit_scale
// (typically 2 for cents/paise). If currencies have different scales,
// the caller must adjust.
func (fx *FXRate) Convert(amount int64) (int64, error) {
	// Parse the rate as a fixed-point number with 10 decimal places.
	// We'll represent the rate as an integer scaled by 10^10.
	const rateScale = 10000000000 // 10^10
	
	var wholePart int64
	var fracPartStr string
	
	// Try to parse as "whole.fractional"
	n, err := fmt.Sscanf(fx.Rate, "%d.%s", &wholePart, &fracPartStr)
	if err != nil && n == 0 {
		// Try parsing as just a whole number (no decimal point)
		n, err = fmt.Sscanf(fx.Rate, "%d", &wholePart)
		if err != nil || n != 1 {
			return 0, fmt.Errorf("invalid rate format: %s", fx.Rate)
		}
		fracPartStr = "0"
	} else if n == 1 {
		// Parsed whole part but no fractional part
		fracPartStr = "0"
	}
	
	// Parse the fractional part as an integer and pad/truncate to 10 digits
	var fracPart int64
	if len(fracPartStr) > 0 && fracPartStr != "0" {
		// Pad or truncate to exactly 10 digits
		if len(fracPartStr) < 10 {
			// Pad with zeros on the right
			for len(fracPartStr) < 10 {
				fracPartStr += "0"
			}
		} else if len(fracPartStr) > 10 {
			// Truncate to 10 digits
			fracPartStr = fracPartStr[:10]
		}
		
		_, err := fmt.Sscanf(fracPartStr, "%d", &fracPart)
		if err != nil {
			return 0, fmt.Errorf("invalid fractional part: %s", fracPartStr)
		}
	}
	
	// Combine whole and fractional parts
	rateInt := wholePart*rateScale + fracPart
	
	// Multiply amount by rate and divide by scale, with rounding
	product := amount * rateInt
	result := product / rateScale
	
	// Round to nearest: if remainder >= 0.5, round up
	remainder := product % rateScale
	if remainder*2 >= rateScale {
		result++
	}
	
	return result, nil
}
