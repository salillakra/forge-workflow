package common

import (
	"context"
	"time"

	"github.com/jmoiron/sqlx"
	apierrors "github.com/salillakra/forge/pkg/errors"
	"github.com/salillakra/forge/pkg/utils"
)

// ─── Projects ────────────────────────────────────────────────────────────────

type Project struct {
	ID          string    `db:"id"          json:"id"`
	OrgID       string    `db:"org_id"      json:"org_id"`
	Name        string    `db:"name"        json:"name"`
	Description *string   `db:"description" json:"description"`
	CreatedBy   string    `db:"created_by"  json:"created_by"`
	CreatedAt   time.Time `db:"created_at"  json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"  json:"updated_at"`
}

type CreateProjectRequest struct {
	Name        string `json:"name"        validate:"required,min=2,max=128"`
	Description string `json:"description"`
}

// ProjectService manages project CRUD.
type ProjectService struct {
	db *sqlx.DB
}

func NewProjectService(db *sqlx.DB) *ProjectService {
	return &ProjectService{db: db}
}

func (s *ProjectService) Create(ctx context.Context, orgID, userID string, req CreateProjectRequest) (*Project, error) {
	p := &Project{
		ID:        utils.NewID(),
		OrgID:     orgID,
		Name:      req.Name,
		CreatedBy: userID,
	}
	if req.Description != "" {
		p.Description = &req.Description
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO projects (id, org_id, name, description, created_by)
		VALUES ($1,$2,$3,$4,$5)`,
		p.ID, p.OrgID, p.Name, p.Description, p.CreatedBy,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to create project")
	}
	return p, nil
}

func (s *ProjectService) List(ctx context.Context, orgID string) ([]Project, error) {
	var projects []Project
	err := s.db.SelectContext(ctx, &projects, `
		SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at DESC
	`, orgID)
	if err != nil {
		return nil, apierrors.Internal("failed to list projects")
	}
	return projects, nil
}

func (s *ProjectService) Get(ctx context.Context, projectID, orgID string) (*Project, error) {
	var p Project
	if err := s.db.GetContext(ctx, &p, `SELECT * FROM projects WHERE id=$1 AND org_id=$2`, projectID, orgID); err != nil {
		return nil, apierrors.NotFound("project")
	}
	return &p, nil
}

func (s *ProjectService) Delete(ctx context.Context, projectID, orgID string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM projects WHERE id=$1 AND org_id=$2`, projectID, orgID)
	if err != nil {
		return apierrors.Internal("failed to delete project")
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return apierrors.NotFound("project")
	}
	return nil
}
