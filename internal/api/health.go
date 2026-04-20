package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Health(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		status := "ok"
		if err := pool.Ping(c.Context()); err != nil {
			status = "error"
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"db":      status,
				"version": Version,
				"error":   err.Error(),
			})
		}
		return c.JSON(fiber.Map{
			"db":      status,
			"version": Version,
		})
	}
}
