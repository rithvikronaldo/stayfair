// Command snapshot computes per-account end-of-day balance snapshots for a
// given date and writes them to account_snapshots. Intended to be run nightly
// (or manually via `make snapshot DATE=YYYY-MM-DD`) so point-in-time balance
// queries can roll forward from a recent snapshot instead of summing every
// entry from time zero.
//
// Default date is yesterday in UTC. Pass --date=YYYY-MM-DD to override.
// Operates on the demo org for now; once real auth lands, the worker will
// loop over every active org instead.
package main

import (
	"context"
	"flag"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/rithvikronaldo/acta/internal/config"
	"github.com/rithvikronaldo/acta/internal/db"
	"github.com/rithvikronaldo/acta/internal/ledger"
)

const demoOrgID = "00000000-0000-0000-0000-000000000001"

func main() {
	var dateStr string
	flag.StringVar(&dateStr, "date", "", "as_of_date in YYYY-MM-DD (default: yesterday UTC)")
	flag.Parse()

	asOfDate, err := parseDate(dateStr)
	if err != nil {
		log.Fatalf("invalid --date: %v", err)
	}

	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DBURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	orgID := uuid.MustParse(demoOrgID)
	if err := ledger.ComputeSnapshots(ctx, pool, orgID, asOfDate); err != nil {
		log.Fatalf("compute snapshots: %v", err)
	}

	log.Printf("snapshots computed: org=%s as_of=%s", orgID, asOfDate.Format("2006-01-02"))
}

func parseDate(s string) (time.Time, error) {
	if s == "" {
		return time.Now().UTC().AddDate(0, 0, -1), nil
	}
	return time.Parse("2006-01-02", s)
}
