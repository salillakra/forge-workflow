package workflows

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	apierrors "github.com/salillakra/forge/pkg/errors"
	"github.com/salillakra/forge/pkg/utils"
)

// ─── Models ──────────────────────────────────────────────────────────────────

type Workflow struct {
	ID          string          `db:"id"           json:"id"`
	ProjectID   string          `db:"project_id"   json:"project_id"`
	OrgID       string          `db:"org_id"       json:"org_id"`
	Name        string          `db:"name"         json:"name"`
	Description string          `db:"description"  json:"description"`
	Version     int             `db:"version"      json:"version"`
	Status      string          `db:"status"       json:"status"`
	TriggerType string          `db:"trigger_type" json:"trigger_type"`
	CronExpr    *string         `db:"cron_expr"    json:"cron_expr"`
	Definition  json.RawMessage `db:"definition"   json:"definition"`
	CreatedBy   string          `db:"created_by"   json:"created_by"`
	CreatedAt   time.Time       `db:"created_at"   json:"created_at"`
	UpdatedAt   time.Time       `db:"updated_at"   json:"updated_at"`
}

type Node struct {
	ID           string          `db:"id"             json:"id"`
	WorkflowID   string          `db:"workflow_id"    json:"workflow_id"`
	Name         string          `db:"name"           json:"name"`
	Type         string          `db:"type"           json:"type"`
	Config       json.RawMessage `db:"config"         json:"config"`
	PositionX    float64         `db:"position_x"     json:"position_x"`
	PositionY    float64         `db:"position_y"     json:"position_y"`
	MaxRetries   int             `db:"max_retries"    json:"max_retries"`
	RetryDelaySecs int           `db:"retry_delay_secs" json:"retry_delay_secs"`
	TimeoutSecs  int             `db:"timeout_secs"   json:"timeout_secs"`
	CreatedAt    time.Time       `db:"created_at"     json:"created_at"`
}

type Edge struct {
	ID         string `db:"id"          json:"id"`
	WorkflowID string `db:"workflow_id" json:"workflow_id"`
	SourceID   string `db:"source_id"   json:"source_id"`
	TargetID   string `db:"target_id"   json:"target_id"`
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type CreateWorkflowRequest struct {
	Name        string `json:"name"         validate:"required,min=1,max=128"`
	Description string `json:"description"`
	TriggerType string `json:"trigger_type" validate:"required,oneof=manual schedule webhook api"`
	CronExpr    string `json:"cron_expr"`
}

type UpdateWorkflowRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	CronExpr    *string `json:"cron_expr"`
}

type UpsertNodesEdgesRequest struct {
	Nodes []NodeInput `json:"nodes" validate:"required"`
	Edges []EdgeInput `json:"edges"`
}

type NodeInput struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"           validate:"required"`
	Type           string          `json:"type"           validate:"required"`
	Config         json.RawMessage `json:"config"`
	PositionX      float64         `json:"position_x"`
	PositionY      float64         `json:"position_y"`
	MaxRetries     int             `json:"max_retries"`
	RetryDelaySecs int             `json:"retry_delay_secs"`
	TimeoutSecs    int             `json:"timeout_secs"`
}

type EdgeInput struct {
	SourceID string `json:"source_id" validate:"required"`
	TargetID string `json:"target_id" validate:"required"`
}

// ─── Service ─────────────────────────────────────────────────────────────────

type Service struct {
	db *sqlx.DB
}

func NewService(db *sqlx.DB) *Service {
	return &Service{db: db}
}

// CreateWorkflow creates a new draft workflow.
func (s *Service) CreateWorkflow(ctx context.Context, projectID, orgID, userID string, req CreateWorkflowRequest) (*Workflow, error) {
	wf := &Workflow{
		ID:          utils.NewID(),
		ProjectID:   projectID,
		OrgID:       orgID,
		Name:        req.Name,
		Description: req.Description,
		Version:     1,
		Status:      "draft",
		TriggerType: req.TriggerType,
		Definition:  json.RawMessage("{}"),
		CreatedBy:   userID,
	}
	if req.CronExpr != "" {
		wf.CronExpr = &req.CronExpr
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO workflows (id, project_id, org_id, name, description, version, status, trigger_type, cron_expr, definition, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		wf.ID, wf.ProjectID, wf.OrgID, wf.Name, wf.Description, wf.Version,
		wf.Status, wf.TriggerType, wf.CronExpr, wf.Definition, wf.CreatedBy,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to create workflow")
	}
	return wf, nil
}

// GetWorkflow returns a workflow by ID.
func (s *Service) GetWorkflow(ctx context.Context, workflowID, orgID string) (*Workflow, error) {
	var wf Workflow
	err := s.db.GetContext(ctx, &wf, `SELECT * FROM workflows WHERE id=$1 AND org_id=$2`, workflowID, orgID)
	if err != nil {
		return nil, apierrors.NotFound("workflow")
	}
	return &wf, nil
}

// ListWorkflows returns workflows for a project.
func (s *Service) ListWorkflows(ctx context.Context, projectID, orgID string) ([]Workflow, error) {
	wfs := make([]Workflow, 0)
	err := s.db.SelectContext(ctx, &wfs, `
		SELECT * FROM workflows WHERE project_id=$1 AND org_id=$2 ORDER BY created_at DESC
	`, projectID, orgID)
	if err != nil {
		return nil, apierrors.Internal("failed to list workflows")
	}
	return wfs, nil
}

// UpdateWorkflow patches workflow metadata.
func (s *Service) UpdateWorkflow(ctx context.Context, workflowID, orgID string, req UpdateWorkflowRequest) (*Workflow, error) {
	wf, err := s.GetWorkflow(ctx, workflowID, orgID)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		wf.Name = *req.Name
	}
	if req.Description != nil {
		wf.Description = *req.Description
	}
	if req.CronExpr != nil {
		wf.CronExpr = req.CronExpr
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE workflows SET name=$1, description=$2, cron_expr=$3 WHERE id=$4
	`, wf.Name, wf.Description, wf.CronExpr, wf.ID)
	if err != nil {
		return nil, apierrors.Internal("failed to update workflow")
	}
	return wf, nil
}

// UpsertNodesEdges replaces the full DAG graph for a workflow.
func (s *Service) UpsertNodesEdges(ctx context.Context, workflowID, orgID string, req UpsertNodesEdgesRequest) error {
	// Verify workflow exists in this org
	if _, err := s.GetWorkflow(ctx, workflowID, orgID); err != nil {
		return err
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return apierrors.Internal("failed to begin transaction")
	}
	defer tx.Rollback() //nolint:errcheck

	// Remove existing nodes (cascades to edges)
	if _, err := tx.ExecContext(ctx, `DELETE FROM workflow_nodes WHERE workflow_id=$1`, workflowID); err != nil {
		return apierrors.Internal("failed to clear nodes")
	}

	// Insert nodes
	for _, n := range req.Nodes {
		if n.ID == "" {
			n.ID = utils.NewID()
		}
		cfg := n.Config
		if cfg == nil {
			cfg = json.RawMessage("{}")
		}
		if n.TimeoutSecs == 0 {
			n.TimeoutSecs = 600
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO workflow_nodes (id, workflow_id, name, type, config, position_x, position_y, max_retries, retry_delay_secs, timeout_secs)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			n.ID, workflowID, n.Name, n.Type, cfg, n.PositionX, n.PositionY, n.MaxRetries, n.RetryDelaySecs, n.TimeoutSecs,
		)
		if err != nil {
			return apierrors.Internal("failed to insert node: " + n.Name)
		}
	}

	// Insert edges
	for _, e := range req.Edges {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO workflow_edges (id, workflow_id, source_id, target_id) VALUES ($1,$2,$3,$4)`,
			utils.NewID(), workflowID, e.SourceID, e.TargetID,
		)
		if err != nil {
			return apierrors.Internal("failed to insert edge")
		}
	}

	return tx.Commit()
}

// GetNodesAndEdges returns the DAG for a workflow.
func (s *Service) GetNodesAndEdges(ctx context.Context, workflowID, orgID string) ([]Node, []Edge, error) {
	if _, err := s.GetWorkflow(ctx, workflowID, orgID); err != nil {
		return nil, nil, err
	}

	nodes := make([]Node, 0)
	if err := s.db.SelectContext(ctx, &nodes, `SELECT * FROM workflow_nodes WHERE workflow_id=$1 ORDER BY created_at`, workflowID); err != nil {
		return nil, nil, apierrors.Internal("failed to fetch nodes")
	}

	edges := make([]Edge, 0)
	if err := s.db.SelectContext(ctx, &edges, `SELECT * FROM workflow_edges WHERE workflow_id=$1`, workflowID); err != nil {
		return nil, nil, apierrors.Internal("failed to fetch edges")
	}

	return nodes, edges, nil
}

// ValidateDAG checks the graph for cycles and consistency errors.
func (s *Service) ValidateDAG(ctx context.Context, workflowID, orgID string) ([]string, error) {
	nodes, edges, err := s.GetNodesAndEdges(ctx, workflowID, orgID)
	if err != nil {
		return nil, err
	}

	errs := make([]string, 0)
	if len(nodes) == 0 {
		errs = append(errs, "workflow has no nodes")
		return errs, nil
	}

	// Build adjacency map
	nodeSet := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		nodeSet[n.ID] = true
	}

	adj := make(map[string][]string)
	for _, e := range edges {
		if !nodeSet[e.SourceID] {
			errs = append(errs, fmt.Sprintf("edge references unknown source node: %s", e.SourceID))
			continue
		}
		if !nodeSet[e.TargetID] {
			errs = append(errs, fmt.Sprintf("edge references unknown target node: %s", e.TargetID))
			continue
		}
		adj[e.SourceID] = append(adj[e.SourceID], e.TargetID)
	}

	// Cycle detection via DFS coloring
	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := make(map[string]int, len(nodes))
	var dfs func(n string) bool
	dfs = func(n string) bool {
		color[n] = gray
		for _, neighbor := range adj[n] {
			if color[neighbor] == gray {
				return true // cycle detected
			}
			if color[neighbor] == white {
				if dfs(neighbor) {
					return true
				}
			}
		}
		color[n] = black
		return false
	}

	for _, n := range nodes {
		if color[n.ID] == white {
			if dfs(n.ID) {
				errs = append(errs, "workflow DAG contains a cycle")
				break
			}
		}
	}

	return errs, nil
}

// PublishWorkflow bumps version and marks the workflow as published.
func (s *Service) PublishWorkflow(ctx context.Context, workflowID, orgID string) (*Workflow, error) {
	errs, err := s.ValidateDAG(ctx, workflowID, orgID)
	if err != nil {
		return nil, err
	}
	if len(errs) > 0 {
		return nil, apierrors.Unprocessable("DAG validation failed: " + errs[0])
	}

	wf, err := s.GetWorkflow(ctx, workflowID, orgID)
	if err != nil {
		return nil, err
	}

	// Build definition snapshot
	nodes, edges, _ := s.GetNodesAndEdges(ctx, workflowID, orgID)
	defn, _ := json.Marshal(map[string]any{"nodes": nodes, "edges": edges})

	_, err = s.db.ExecContext(ctx, `
		UPDATE workflows SET status='published', version=version+1, definition=$1 WHERE id=$2
	`, defn, workflowID)
	if err != nil {
		return nil, apierrors.Internal("failed to publish workflow")
	}

	wf.Status = "published"
	wf.Version++
	wf.Definition = defn
	return wf, nil
}
