package common

import (
	"github.com/gofiber/fiber/v3"
	apierrors "github.com/salillakra/forge/pkg/errors"
)

// ProjectHandler handles project HTTP routes.
type ProjectHandler struct {
	svc *ProjectService
}

func NewProjectHandler(svc *ProjectService) *ProjectHandler {
	return &ProjectHandler{svc: svc}
}

func (h *ProjectHandler) Create(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	orgID := c.Params("orgId")

	var req CreateProjectRequest
	if err := c.Bind().JSON(&req); err != nil {
		return respondError(c, apierrors.BadRequest("invalid request body"))
	}

	p, err := h.svc.Create(c.Context(), orgID, userID, req)
	if err != nil {
		return respondError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(p)
}

func (h *ProjectHandler) List(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	projects, err := h.svc.List(c.Context(), orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"projects": projects})
}

func (h *ProjectHandler) Get(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	projectID := c.Params("projectId")

	p, err := h.svc.Get(c.Context(), projectID, orgID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(p)
}

func (h *ProjectHandler) Delete(c fiber.Ctx) error {
	orgID := c.Params("orgId")
	projectID := c.Params("projectId")

	if err := h.svc.Delete(c.Context(), projectID, orgID); err != nil {
		return respondError(c, err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func respondError(c fiber.Ctx, err error) error {
	if apiErr, ok := err.(*apierrors.APIError); ok {
		return c.Status(apiErr.Code).JSON(fiber.Map{"error": apiErr.Message, "detail": apiErr.Detail})
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
}
