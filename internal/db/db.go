package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	// Use simple protocol — disables server-side prepared statements. We
	// hit a real bug where pgx's named-statement cache + postgres' plan
	// cache mode (custom→generic after the 5th execute) made
	// just-committed rows invisible to GetBalance for the next ~5 reads,
	// then they'd appear. Simple protocol re-parses every time and dodges
	// the issue. The micro-cost of re-parsing is irrelevant for a demo
	// app at this volume; correctness is not negotiable.
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
