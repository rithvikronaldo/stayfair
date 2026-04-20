package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

const Version = "0.1.0"

func New(pool *pgxpool.Pool) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:      "stayfair",
		DisableStartupMessage: true,
	})

	app.Get("/health", Health(pool))

	return app
}
