package api

import (
	"encoding/json"
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/stayfair/internal/events"
	"github.com/rithvikronaldo/stayfair/internal/ledger"
)

// spawnAgentRequest is the JSON shape accepted by POST /agents.
type spawnAgentRequest struct {
	Name     string `json:"name"`
	Currency string `json:"currency"`
}

// PostAgent handles POST /agents — spawns a new agent and its primary
// asset account, atomically. Broadcasts agent_spawned on success.
func PostAgent(pool *pgxpool.Pool, broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req spawnAgentRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_json",
				"message": err.Error(),
			})
		}

		agent, err := ledger.SpawnAgent(c.Context(), pool, demoOrgID, req.Name, req.Currency)
		switch {
		case errors.Is(err, ledger.ErrAgentExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":   "agent_exists",
				"message": err.Error(),
			})
		case errors.Is(err, ledger.ErrUnknownCurrency):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "unknown_currency",
				"message": err.Error(),
			})
		case err != nil:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "spawn_failed",
				"message": err.Error(),
			})
		}

		_ = broadcaster.Publish("agent_spawned", agent)
		return c.Status(fiber.StatusCreated).JSON(agent)
	}
}

// GetAgents handles GET /agents — returns every agent for the demo org with
// its primary account's current balance.
func GetAgents(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		agents, err := ledger.ListAgents(c.Context(), pool, demoOrgID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "list_failed",
				"message": err.Error(),
			})
		}
		return c.JSON(fiber.Map{"agents": agents})
	}
}

// PostKillAgent handles POST /agents/:id/kill — flips the agent to 'killed'.
// Future authorize/capture/void calls against the agent's account still work
// (the ledger is decoupled); the simulator stops scheduling new spend.
// Broadcasts agent_killed.
func PostKillAgent(pool *pgxpool.Pool, broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		agentID, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid_agent_id",
				"message": err.Error(),
			})
		}

		if err := ledger.SetAgentStatus(c.Context(), pool, demoOrgID, agentID, ledger.AgentKilled); err != nil {
			if errors.Is(err, ledger.ErrAgentNotFound) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "agent_not_found",
				})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "kill_failed",
				"message": err.Error(),
			})
		}

		_ = broadcaster.Publish("agent_killed", fiber.Map{"agent_id": agentID})
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"agent_id": agentID,
			"status":   ledger.AgentKilled,
		})
	}
}
