package executions

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
	apierrors "github.com/salillakra/forge/pkg/errors"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// TriggerRun godoc: POST /api/orgs/:orgId/workflows/:workflowId/run
func (h *Handler) TriggerRun(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	orgID := c.Params("orgId")
	workflowID := c.Params("workflowId")

	run, err := h.svc.TriggerRun(c.Context(), workflowID, orgID, &userID, "manual")
	if err != nil {
		return respondError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(run)
}

// GetRun godoc: GET /api/orgs/:orgId/runs/:runId
func (h *Handler) GetRun(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	runID := c.Params("runId")

	run, err := h.svc.GetRun(c.Context(), runID, orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(run)
}

// ListRuns godoc: GET /api/orgs/:orgId/workflows/:workflowId/runs
func (h *Handler) ListRuns(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	workflowID := c.Params("workflowId")

	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	if limit > 100 {
		limit = 100
	}

	runs, err := h.svc.ListRuns(c.Context(), workflowID, orgID, limit, offset)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"runs": runs})
}

// GetRunSteps godoc: GET /api/orgs/:orgId/runs/:runId/steps
func (h *Handler) GetRunSteps(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	runID := c.Params("runId")

	steps, err := h.svc.GetRunSteps(c.Context(), runID, orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"steps": steps})
}

// CancelRun godoc: POST /api/orgs/:orgId/runs/:runId/cancel
func (h *Handler) CancelRun(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	runID := c.Params("runId")

	run, err := h.svc.CancelRun(c.Context(), runID, orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(run)
}

// RetryRun godoc: POST /api/orgs/:orgId/runs/:runId/retry
func (h *Handler) RetryRun(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	orgID := c.Params("orgId")
	runID := c.Params("runId")

	run, err := h.svc.RetryRun(c.Context(), runID, orgID, userID)
	if err != nil {
		return respondError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(run)
}

// GetLogs godoc: GET /api/orgs/:orgId/runs/:runId/logs
func (h *Handler) GetLogs(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	runID := c.Params("runId")

	stepID := c.Query("step_id")
	limit, _ := strconv.Atoi(c.Query("limit", "200"))
	if limit > 1000 {
		limit = 1000
	}

	var stepIDPtr *string
	if stepID != "" {
		stepIDPtr = &stepID
	}

	logs, err := h.svc.GetLogs(c.Context(), runID, orgID, stepIDPtr, limit)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"logs": logs})
}

func respondError(c fiber.Ctx, err error) error {
	if apiErr, ok := err.(*apierrors.APIError); ok {
		return c.Status(apiErr.Code).JSON(fiber.Map{"error": apiErr.Message, "detail": apiErr.Detail})
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
}
