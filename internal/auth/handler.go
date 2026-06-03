package auth

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	apierrors "github.com/salillakra/forge/pkg/errors"
)

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register godoc: POST /api/auth/register
func (h *Handler) Register(c fiber.Ctx) error {
	var req RegisterRequest
	if err := c.Bind().JSON(&req); err != nil {
		return respondError(c, apierrors.BadRequest("invalid request body"))
	}

	resp, err := h.svc.Register(c.Context(), req)
	if err != nil {
		return respondError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(resp)
}

// Login godoc: POST /api/auth/login
func (h *Handler) Login(c fiber.Ctx) error {
	var req LoginRequest
	if err := c.Bind().JSON(&req); err != nil {
		return respondError(c, apierrors.BadRequest("invalid request body"))
	}

	resp, err := h.svc.Login(c.Context(), req)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(resp)
}

// Refresh godoc: POST /api/auth/refresh
func (h *Handler) Refresh(c fiber.Ctx) error {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.Bind().JSON(&body); err != nil || body.RefreshToken == "" {
		return respondError(c, apierrors.BadRequest("refresh_token is required"))
	}

	resp, err := h.svc.RefreshAccessToken(c.Context(), body.RefreshToken)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(resp)
}

// Logout godoc: POST /api/auth/logout
func (h *Handler) Logout(c fiber.Ctx) error {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.Bind().JSON(&body); err != nil || body.RefreshToken == "" {
		return respondError(c, apierrors.BadRequest("refresh_token is required"))
	}
	_ = h.svc.Logout(c.Context(), body.RefreshToken)
	return c.JSON(fiber.Map{"success": true})
}

// Me godoc: GET /api/me
func (h *Handler) Me(c fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	user, err := h.svc.GetUserByID(c.Context(), userID)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(user)
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// Middleware extracts and validates the Bearer JWT from incoming requests.
func (s *Service) Middleware(c fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		return respondError(c, apierrors.Unauthorized("missing or malformed Authorization header"))
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := s.ValidateAccessToken(tokenStr)
	if err != nil {
		return respondError(c, err)
	}

	c.Locals("user_id", claims.UserID)
	c.Locals("user_email", claims.Email)
	c.Locals("claims", claims)
	return c.Next()
}

// ─── shared helper ────────────────────────────────────────────────────────────

func respondError(c fiber.Ctx, err error) error {
	if apiErr, ok := err.(*apierrors.APIError); ok {
		return c.Status(apiErr.Code).JSON(fiber.Map{
			"error":   apiErr.Message,
			"detail":  apiErr.Detail,
		})
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
		"error": "internal server error",
	})
}
