package orgs

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

// CreateOrg godoc: POST /api/orgs
func (h *Handler) CreateOrg(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	var req CreateOrgRequest
	if err := c.Bind().JSON(&req); err != nil {
		return respondError(c, apierrors.BadRequest("invalid request body"))
	}
	org, err := h.svc.CreateOrg(c.Context(), userID, req)
	if err != nil {
		return respondError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(org)
}

// ListOrgs godoc: GET /api/orgs
func (h *Handler) ListOrgs(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	orgs, err := h.svc.ListOrgs(c.Context(), userID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"orgs": orgs})
}

// GetOrg godoc: GET /api/orgs/:orgId
func (h *Handler) GetOrg(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	orgID := c.Params("orgId")
	org, err := h.svc.GetOrg(c.Context(), orgID, userID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(org)
}

// ListMembers godoc: GET /api/orgs/:orgId/members
func (h *Handler) ListMembers(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	orgID := c.Params("orgId")
	members, err := h.svc.ListMembers(c.Context(), orgID, userID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"members": members})
}

func respondError(c fiber.Ctx, err error) error {
	if apiErr, ok := err.(*apierrors.APIError); ok {
		return c.Status(apiErr.Code).JSON(fiber.Map{"error": apiErr.Message, "detail": apiErr.Detail})
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
}
