package workflows

import (
	"github.com/gofiber/fiber/v3"
	apierrors "github.com/salillakra/forge/pkg/errors"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Create(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	orgID := c.Params("orgId")
	projectID := c.Params("projectId")

	var req CreateWorkflowRequest
	if err := c.Bind().JSON(&req); err != nil {
		return respondError(c, apierrors.BadRequest("invalid request body"))
	}

	wf, err := h.svc.CreateWorkflow(c.Context(), projectID, orgID, userID, req)
	if err != nil {
		return respondError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(wf)
}

func (h *Handler) List(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	projectID := c.Params("projectId")

	wfs, err := h.svc.ListWorkflows(c.Context(), projectID, orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"workflows": wfs})
}

func (h *Handler) Get(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	workflowID := c.Params("workflowId")

	wf, err := h.svc.GetWorkflow(c.Context(), workflowID, orgID)
	if err != nil {
		return respondError(c, err)
	}

	nodes, edges, err := h.svc.GetNodesAndEdges(c.Context(), workflowID, orgID)
	if err != nil {
		return respondError(c, err)
	}

	return c.JSON(fiber.Map{"workflow": wf, "nodes": nodes, "edges": edges})
}

func (h *Handler) Update(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	workflowID := c.Params("workflowId")

	var req UpdateWorkflowRequest
	if err := c.Bind().JSON(&req); err != nil {
		return respondError(c, apierrors.BadRequest("invalid request body"))
	}

	wf, err := h.svc.UpdateWorkflow(c.Context(), workflowID, orgID, req)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(wf)
}

func (h *Handler) UpsertGraph(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	workflowID := c.Params("workflowId")

	var req UpsertNodesEdgesRequest
	if err := c.Bind().JSON(&req); err != nil {
		return respondError(c, apierrors.BadRequest("invalid request body"))
	}

	if err := h.svc.UpsertNodesEdges(c.Context(), workflowID, orgID, req); err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) Validate(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	workflowID := c.Params("workflowId")

	errs, err := h.svc.ValidateDAG(c.Context(), workflowID, orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"valid": len(errs) == 0, "errors": errs})
}

func (h *Handler) Publish(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	workflowID := c.Params("workflowId")

	wf, err := h.svc.PublishWorkflow(c.Context(), workflowID, orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(wf)
}

func respondError(c fiber.Ctx, err error) error {
	if apiErr, ok := err.(*apierrors.APIError); ok {
		return c.Status(apiErr.Code).JSON(fiber.Map{"error": apiErr.Message, "detail": apiErr.Detail})
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
}
