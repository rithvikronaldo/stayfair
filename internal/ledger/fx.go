package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"
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

// halfRat is a precomputed ½ used by Convert's rounding step.
var halfRat = big.NewRat(1, 2)

// Convert multiplies amount (in the source currency's minor units) by this
// rate and rounds half-away-from-zero to the nearest integer minor unit.
//
// Example: 10000 INR paise (₹100.00) at rate "0.0119" → 119 USD cents ($1.19).
//
// The implementation uses math/big.Rat for the multiplication so that neither
// integer overflow nor floating-point drift is possible — a balance of
// 10^9 paise crossed with an 84.x rate would overflow a naive int64 product,
// and IEEE 754 floats accumulate cents of error over millions of conversions.
// big.Rat allocates, but balance queries aren't hot enough to care.
//
// Sign handling: half-away-from-zero means a refund of -X rounds the same
// number of cents as the original +X did, so reversing entries cancel
// exactly. Standard half-up would mis-round liabilities and equity accounts
// (which carry negative balances by convention).
//
// Returns an error if the rate string is unparseable, or if the rounded
// result doesn't fit in int64 (only reachable for absurd inputs).
func (fx *FXRate) Convert(amount int64) (int64, error) {
	rate, ok := new(big.Rat).SetString(fx.Rate)
	if !ok {
		return 0, fmt.Errorf("ledger: invalid rate %q", fx.Rate)
	}

	product := new(big.Rat).Mul(rate, new(big.Rat).SetInt64(amount))

	// Nudge by ±½ then truncate toward zero — yields half-away-from-zero.
	if product.Sign() < 0 {
		product.Sub(product, halfRat)
	} else {
		product.Add(product, halfRat)
	}

	// big.Int.Quo truncates toward zero, which is what we want post-nudge.
	quotient := new(big.Int).Quo(product.Num(), product.Denom())
	if !quotient.IsInt64() {
		return 0, fmt.Errorf("ledger: conversion overflow: amount=%d rate=%s", amount, fx.Rate)
	}
	return quotient.Int64(), nil
}
