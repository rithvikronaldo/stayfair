package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rithvikronaldo/acta/internal/api"
	"github.com/rithvikronaldo/acta/internal/config"
	"github.com/rithvikronaldo/acta/internal/db"
	"github.com/rithvikronaldo/acta/internal/events"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DBURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	broadcaster := events.New(64)
	app := api.New(pool, broadcaster)

	// Self-healing demo bootstrap: if the demo tenant has no agents yet
	// (fresh production DB, restored snapshot, etc.) run SeedNewTenant
	// against it so the simulator has funded same-currency pairs to work
	// with. Idempotent on subsequent boots.
	bootstrapCtx, bootstrapCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := api.BootstrapDemoTenant(bootstrapCtx, pool); err != nil {
		log.Printf("warning: demo bootstrap failed: %v (simulator may produce no activity)", err)
	}
	bootstrapCancel()

	// Server-side demo simulator: continuously animates the demo tenant so
	// anonymous visitors of the public dashboard see live activity within
	// seconds of landing. Runs until simCtx is cancelled by shutdown.
	simCtx, simCancel := context.WithCancel(context.Background())
	defer simCancel()
	api.StartDemoSimulator(simCtx, pool, broadcaster)

	go func() {
		log.Printf("listening on :%s", cfg.Port)
		if err := app.Listen(":" + cfg.Port); err != nil {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("shutting down")
	simCancel()
	_ = app.ShutdownWithTimeout(5 * time.Second)
}
