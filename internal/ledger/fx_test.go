package ledger

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// TestLookupRateSameCurrencyIdentity asserts USD->USD short-circuits to a
// rate of "1" without requiring any seed row.
func TestLookupRateSameCurrencyIdentity(t *testing.T) {
	pool := openTestDB(t)

	r, err := LookupRate(context.Background(), pool, "USD", "USD", time.Now())
	if err != nil {
		t.Fatalf("identity lookup: %v", err)
	}
	if r.Rate != "1" {
		t.Fatalf("USD->USD rate: want %q, got %q", "1", r.Rate)
	}
}

// TestLookupRatePicksLatestBeforeAsOf is the headline guarantee of LookupRate:
// among multiple rates for a pair, it returns the row with the largest as_of
// that is <= the requested timestamp.
//
// Seed has three USD->INR observations: 2026-01-01 (82.50), 2026-03-01 (83.25),
// 2026-04-15 (84.10). We probe between, on, and after each boundary.
func TestLookupRatePicksLatestBeforeAsOf(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	jan := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	mar := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	apr := time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		asOf       time.Time
		wantPrefix string // prefix to tolerate NUMERIC trailing-zero formatting
		wantAsOf   time.Time
	}{
		{
			name:       "between Jan and Mar picks Jan",
			asOf:       time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC),
			wantPrefix: "82.5",
			wantAsOf:   jan,
		},
		{
			name:       "exactly on Mar boundary picks Mar",
			asOf:       mar,
			wantPrefix: "83.25",
			wantAsOf:   mar,
		},
		{
			name:       "between Mar and Apr picks Mar",
			asOf:       time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC),
			wantPrefix: "83.25",
			wantAsOf:   mar,
		},
		{
			name:       "after latest observation picks latest",
			asOf:       time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC),
			wantPrefix: "84.1",
			wantAsOf:   apr,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, err := LookupRate(ctx, pool, "USD", "INR", tc.asOf)
			if err != nil {
				t.Fatalf("lookup: %v", err)
			}
			if !strings.HasPrefix(r.Rate, tc.wantPrefix) {
				t.Fatalf("rate: want prefix %q, got %q", tc.wantPrefix, r.Rate)
			}
			if !r.AsOf.Equal(tc.wantAsOf) {
				t.Fatalf("as_of: want %v, got %v", tc.wantAsOf, r.AsOf)
			}
		})
	}
}

// TestLookupRateBeforeAnyObservationReturnsErrNoRate asserts that probing a
// timestamp earlier than every seeded rate yields ErrNoRate. The lookup must
// not silently fall back to the earliest rate — that would invent FX history.
func TestLookupRateBeforeAnyObservationReturnsErrNoRate(t *testing.T) {
	pool := openTestDB(t)

	veryOld := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err := LookupRate(context.Background(), pool, "USD", "INR", veryOld)
	if !errors.Is(err, ErrNoRate) {
		t.Fatalf("expected ErrNoRate, got %v", err)
	}
}


func TestFXRate_Convert(t *testing.T) {
	tests := []struct {
		name     string
		rate     string
		amount   int64
		expected int64
	}{
		{
			name:     "identity rate",
			rate:     "1.0000000000",
			amount:   10000,
			expected: 10000,
		},
		{
			name:     "USD to INR (84.1)",
			rate:     "84.1000000000",
			amount:   10000, // $100.00
			expected: 841000, // ₹8410.00
		},
		{
			name:     "INR to USD (0.0119)",
			rate:     "0.0119000000",
			amount:   10000, // ₹100.00
			expected: 119, // $1.19
		},
		{
			name:     "rounding up",
			rate:     "0.0119500000",
			amount:   10000,
			expected: 120, // 119.5 rounds to 120
		},
		{
			name:     "rounding down",
			rate:     "0.0119400000",
			amount:   10000,
			expected: 119, // 119.4 rounds to 119
		},
		{
			name:     "whole number rate",
			rate:     "100",
			amount:   1234,
			expected: 123400,
		},
		{
			// Liabilities and equity accounts carry negative balances. The old
			// implementation rounded these toward zero, which silently lost a
			// minor unit on every fractional conversion. big.Rat-based Convert
			// rounds half-away-from-zero so +X and -X round symmetrically.
			name:     "negative amount mirrors positive",
			rate:     "84.1000000000",
			amount:   -10000,
			expected: -841000,
		},
		{
			name:     "negative amount rounds away from zero (down -> -120)",
			rate:     "0.0119500000",
			amount:   -10000,
			expected: -120,
		},
		{
			name:     "negative amount rounds away from zero (down -> -119)",
			rate:     "0.0119400000",
			amount:   -10000,
			expected: -119,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := &FXRate{
				From: "XXX",
				To:   "YYY",
				Rate: tt.rate,
			}
			result, err := fx.Convert(tt.amount)
			if err != nil {
				t.Fatalf("Convert() error = %v", err)
			}
			if result != tt.expected {
				t.Errorf("Convert() = %d, want %d", result, tt.expected)
			}
		})
	}
}
