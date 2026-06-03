package orgs

import (
	"context"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	apierrors "github.com/salillakra/forge/pkg/errors"
	"github.com/salillakra/forge/pkg/utils"
)

// ─── Models ──────────────────────────────────────────────────────────────────

type Organization struct {
	ID        string    `db:"id"         json:"id"`
	Slug      string    `db:"slug"       json:"slug"`
	Name      string    `db:"name"       json:"name"`
	OwnerID   string    `db:"owner_id"   json:"owner_id"`
	Plan      string    `db:"plan"       json:"plan"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

type OrgMember struct {
	ID       string    `db:"id"        json:"id"`
	OrgID    string    `db:"org_id"    json:"org_id"`
	UserID   string    `db:"user_id"   json:"user_id"`
	Role     string    `db:"role"      json:"role"`
	JoinedAt time.Time `db:"joined_at" json:"joined_at"`
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type CreateOrgRequest struct {
	Name string `json:"name" validate:"required,min=2,max=64"`
	Slug string `json:"slug" validate:"required,min=2,max=64,alphanum"`
}

type UpdateOrgRequest struct {
	Name string `json:"name" validate:"omitempty,min=2,max=64"`
}

// ─── Service ─────────────────────────────────────────────────────────────────

type Service struct {
	db *sqlx.DB
}

func NewService(db *sqlx.DB) *Service {
	return &Service{db: db}
}

// CreateOrg creates a new organization and adds the creator as owner.
func (s *Service) CreateOrg(ctx context.Context, userID string, req CreateOrgRequest) (*Organization, error) {
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))

	// Ensure slug is unique
	var count int
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM organizations WHERE slug=$1`, req.Slug); err != nil {
		return nil, apierrors.Internal("failed to check slug uniqueness")
	}
	if count > 0 {
		return nil, apierrors.Conflict("slug already taken")
	}

	org := &Organization{
		ID:      utils.NewID(),
		Slug:    req.Slug,
		Name:    req.Name,
		OwnerID: userID,
		Plan:    "free",
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, apierrors.Internal("failed to begin transaction")
	}
	defer tx.Rollback() //nolint:errcheck

	_, err = tx.ExecContext(ctx,
		`INSERT INTO organizations (id, slug, name, owner_id, plan) VALUES ($1,$2,$3,$4,$5)`,
		org.ID, org.Slug, org.Name, org.OwnerID, org.Plan,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to create organization")
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO org_members (id, org_id, user_id, role) VALUES ($1,$2,$3,'owner')`,
		utils.NewID(), org.ID, userID,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to add owner member")
	}

	// Create a default project
	_, err = tx.ExecContext(ctx,
		`INSERT INTO projects (id, org_id, name, description, created_by) VALUES ($1,$2,$3,$4,$5)`,
		utils.NewID(), org.ID, "Default Project", "Primary project for your workflows", userID,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to create default project")
	}

	if err := tx.Commit(); err != nil {
		return nil, apierrors.Internal("failed to commit transaction")
	}

	return org, nil
}

// ListOrgs returns all organizations a user belongs to.
func (s *Service) ListOrgs(ctx context.Context, userID string) ([]Organization, error) {
	var orgs []Organization
	err := s.db.SelectContext(ctx, &orgs, `
		SELECT o.* FROM organizations o
		INNER JOIN org_members m ON m.org_id = o.id
		WHERE m.user_id = $1
		ORDER BY o.created_at DESC
	`, userID)
	if err != nil {
		return nil, apierrors.Internal("failed to list organizations")
	}
	return orgs, nil
}

// GetOrg returns a single org by ID, verifying user membership.
func (s *Service) GetOrg(ctx context.Context, orgID, userID string) (*Organization, error) {
	var org Organization
	err := s.db.GetContext(ctx, &org, `
		SELECT o.* FROM organizations o
		INNER JOIN org_members m ON m.org_id = o.id
		WHERE o.id = $1 AND m.user_id = $2
	`, orgID, userID)
	if err != nil {
		return nil, apierrors.NotFound("organization")
	}
	return &org, nil
}

// GetOrgBySlug fetches org by slug.
func (s *Service) GetOrgBySlug(ctx context.Context, slug, userID string) (*Organization, error) {
	var org Organization
	err := s.db.GetContext(ctx, &org, `
		SELECT o.* FROM organizations o
		INNER JOIN org_members m ON m.org_id = o.id
		WHERE o.slug = $1 AND m.user_id = $2
	`, slug, userID)
	if err != nil {
		return nil, apierrors.NotFound("organization")
	}
	return &org, nil
}

// ListMembers returns the members of an org.
func (s *Service) ListMembers(ctx context.Context, orgID, callerID string) ([]OrgMember, error) {
	// Verify caller is a member
	if _, err := s.GetOrg(ctx, orgID, callerID); err != nil {
		return nil, err
	}
	var members []OrgMember
	err := s.db.SelectContext(ctx, &members, `
		SELECT * FROM org_members WHERE org_id=$1 ORDER BY joined_at
	`, orgID)
	if err != nil {
		return nil, apierrors.Internal("failed to list members")
	}
	return members, nil
}

// CheckMembership verifies the user is a member of the org and returns their role.
func (s *Service) CheckMembership(ctx context.Context, orgID, userID string) (string, error) {
	var role string
	err := s.db.GetContext(ctx, &role, `
		SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2
	`, orgID, userID)
	if err != nil {
		return "", apierrors.Forbidden("not a member of this organization")
	}
	return role, nil
}

// RequireRole asserts the caller has at least the given role level.
func (s *Service) RequireRole(ctx context.Context, orgID, userID string, allowedRoles ...string) error {
	role, err := s.CheckMembership(ctx, orgID, userID)
	if err != nil {
		return err
	}
	if !utils.Contains(allowedRoles, role) {
		return apierrors.Forbidden("insufficient permissions")
	}
	return nil
}
