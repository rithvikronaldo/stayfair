// Package ledger enforces the double-entry invariant — Σ in = Σ out per currency
// — at the application layer. The same rule is enforced a second time by a
// Postgres AFTER INSERT DEFERRABLE constraint trigger (see migrations/002).
// The trigger is the last line of defence when app-level code has a bug.
package ledger

import "fmt"

type ImbalanceError struct {
	Currency string
	In       int64
	Out      int64
}

func (e ImbalanceError) Error() string {
	return fmt.Sprintf("ledger: unbalanced %s: in=%d out=%d diff=%d",
		e.Currency, e.In, e.Out, e.In-e.Out)
}

func CheckBalanced(entries []Entry) error {
	if len(entries) == 0 {
		return fmt.Errorf("ledger: no entries")
	}

	type totals struct{ in, out int64 }
	sums := map[string]*totals{}

	for _, e := range entries {
		if e.Amount < 0 {
			return fmt.Errorf("ledger: negative amount on %s", e.Account)
		}
		if e.Currency == "" {
			return fmt.Errorf("ledger: missing currency on %s", e.Account)
		}
		t, ok := sums[e.Currency]
		if !ok {
			t = &totals{}
			sums[e.Currency] = t
		}
		switch e.Direction {
		case DirIn:
			t.in += e.Amount
		case DirOut:
			t.out += e.Amount
		default:
			return fmt.Errorf("ledger: invalid direction %q on %s", e.Direction, e.Account)
		}
	}

	for cur, t := range sums {
		if t.in != t.out {
			return ImbalanceError{Currency: cur, In: t.in, Out: t.out}
		}
	}
	return nil
}
