package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	apierrors "github.com/salillakra/forge/pkg/errors"
	"github.com/salillakra/forge/pkg/utils"
	"golang.org/x/crypto/bcrypt"
)

// ─── Models ──────────────────────────────────────────────────────────────────

// User represents a registered user.
type User struct {
	ID           string     `db:"id"           json:"id"`
	Email        string     `db:"email"        json:"email"`
	PasswordHash string     `db:"password_hash" json:"-"`
	DisplayName  string     `db:"display_name"  json:"display_name"`
	AvatarURL    *string    `db:"avatar_url"   json:"avatar_url"`
	IsActive     bool       `db:"is_active"    json:"is_active"`
	CreatedAt    time.Time  `db:"created_at"   json:"created_at"`
	UpdatedAt    time.Time  `db:"updated_at"   json:"updated_at"`
}

// Claims are the JWT payload fields.
type Claims struct {
	jwt.RegisteredClaims
	UserID string `json:"uid"`
	Email  string `json:"email"`
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type RegisterRequest struct {
	Email       string `json:"email"        validate:"required,email"`
	Password    string `json:"password"     validate:"required,min=8"`
	DisplayName string `json:"display_name" validate:"required"`
}

type LoginRequest struct {
	Email    string `json:"email"    validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

type AuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         *User  `json:"user"`
}

// ─── Service ─────────────────────────────────────────────────────────────────

// Service handles auth business logic.
type Service struct {
	db             *sqlx.DB
	jwtSecret      []byte
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

func NewService(db *sqlx.DB, jwtSecret string, atTTL, rtTTL time.Duration) *Service {
	return &Service{
		db:              db,
		jwtSecret:       []byte(jwtSecret),
		accessTokenTTL:  atTTL,
		refreshTokenTTL: rtTTL,
	}
}

// Register creates a new user account.
func (s *Service) Register(ctx context.Context, req RegisterRequest) (*AuthResponse, error) {
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	// Check for existing user
	var count int
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM users WHERE email=$1`, req.Email); err != nil {
		return nil, apierrors.Internal("failed to check email uniqueness")
	}
	if count > 0 {
		return nil, apierrors.Conflict("email already registered")
	}

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, apierrors.Internal("failed to hash password")
	}

	user := &User{
		ID:           utils.NewID(),
		Email:        req.Email,
		PasswordHash: string(hash),
		DisplayName:  req.DisplayName,
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1,$2,$3,$4)`,
		user.ID, user.Email, user.PasswordHash, user.DisplayName,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to create user")
	}

	return s.buildAuthResponse(ctx, user)
}

// Login validates credentials and returns tokens.
func (s *Service) Login(ctx context.Context, req LoginRequest) (*AuthResponse, error) {
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	var user User
	if err := s.db.GetContext(ctx, &user, `SELECT * FROM users WHERE email=$1`, req.Email); err != nil {
		return nil, apierrors.Unauthorized("invalid email or password")
	}

	if !user.IsActive {
		return nil, apierrors.Forbidden("account is disabled")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, apierrors.Unauthorized("invalid email or password")
	}

	return s.buildAuthResponse(ctx, &user)
}

// RefreshAccessToken validates a refresh token and issues a new access token.
func (s *Service) RefreshAccessToken(ctx context.Context, refreshToken string) (*AuthResponse, error) {
	hash := hashToken(refreshToken)

	var rt struct {
		ID        string    `db:"id"`
		UserID    string    `db:"user_id"`
		ExpiresAt time.Time `db:"expires_at"`
		Revoked   bool      `db:"revoked"`
	}
	if err := s.db.GetContext(ctx, &rt, `SELECT * FROM refresh_tokens WHERE token_hash=$1`, hash); err != nil {
		return nil, apierrors.Unauthorized("invalid refresh token")
	}

	if rt.Revoked || time.Now().After(rt.ExpiresAt) {
		return nil, apierrors.Unauthorized("refresh token expired or revoked")
	}

	var user User
	if err := s.db.GetContext(ctx, &user, `SELECT * FROM users WHERE id=$1`, rt.UserID); err != nil {
		return nil, apierrors.Unauthorized("user not found")
	}

	// Rotate: revoke old token
	_, _ = s.db.ExecContext(ctx, `UPDATE refresh_tokens SET revoked=TRUE WHERE id=$1`, rt.ID)

	return s.buildAuthResponse(ctx, &user)
}

// Logout revokes a refresh token.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	hash := hashToken(refreshToken)
	_, err := s.db.ExecContext(ctx, `UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1`, hash)
	return err
}

// GetUserByID fetches a user by primary key.
func (s *Service) GetUserByID(ctx context.Context, id string) (*User, error) {
	var user User
	if err := s.db.GetContext(ctx, &user, `SELECT * FROM users WHERE id=$1`, id); err != nil {
		return nil, apierrors.NotFound("user")
	}
	return &user, nil
}

// ValidateAccessToken parses and validates a JWT access token.
func (s *Service) ValidateAccessToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return nil, apierrors.Unauthorized("invalid or expired token")
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, apierrors.Unauthorized("invalid token claims")
	}
	return claims, nil
}

// ─── Internal helpers ────────────────────────────────────────────────────────

func (s *Service) buildAuthResponse(ctx context.Context, user *User) (*AuthResponse, error) {
	accessToken, err := s.generateAccessToken(user)
	if err != nil {
		return nil, apierrors.Internal("failed to generate access token")
	}

	rawRefresh, err := utils.RandomHex(32)
	if err != nil {
		return nil, apierrors.Internal("failed to generate refresh token")
	}

	expiresAt := time.Now().Add(s.refreshTokenTTL)
	hash := hashToken(rawRefresh)

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
		uuid.New().String(), user.ID, hash, expiresAt,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to store refresh token")
	}

	return &AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		User:         user,
	}, nil
}

func (s *Service) generateAccessToken(user *User) (string, error) {
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTokenTTL)),
		},
		UserID: user.ID,
		Email:  user.Email,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
