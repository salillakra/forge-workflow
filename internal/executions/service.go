package executions

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/nats-io/nats.go"
	apierrors "github.com/salillakra/forge/pkg/errors"
	"github.com/salillakra/forge/pkg/events"
	"github.com/salillakra/forge/pkg/utils"
	"go.uber.org/zap"
)

// ─── Models ──────────────────────────────────────────────────────────────────

type Run struct {
	ID          string          `db:"id"           json:"id"`
	WorkflowID  string          `db:"workflow_id"  json:"workflow_id"`
	OrgID       string          `db:"org_id"       json:"org_id"`
	TriggerType string          `db:"trigger_type" json:"trigger_type"`
	Status      string          `db:"status"       json:"status"`
	StartedAt   *time.Time      `db:"started_at"   json:"started_at"`
	FinishedAt  *time.Time      `db:"finished_at"  json:"finished_at"`
	CreatedBy   *string         `db:"created_by"   json:"created_by"`
	Metadata    json.RawMessage `db:"metadata"     json:"metadata"`
	CreatedAt   time.Time       `db:"created_at"   json:"created_at"`
}

type Step struct {
	ID           string          `db:"id"            json:"id"`
	RunID        string          `db:"run_id"        json:"run_id"`
	NodeID       string          `db:"node_id"       json:"node_id"`
	Status       string          `db:"status"        json:"status"`
	Attempt      int             `db:"attempt"       json:"attempt"`
	StartedAt    *time.Time      `db:"started_at"    json:"started_at"`
	FinishedAt   *time.Time      `db:"finished_at"   json:"finished_at"`
	InputJSON    json.RawMessage `db:"input_json"    json:"input_json"`
	OutputJSON   json.RawMessage `db:"output_json"   json:"output_json"`
	ErrorMessage *string         `db:"error_message" json:"error_message"`
	CreatedAt    time.Time       `db:"created_at"    json:"created_at"`
	UpdatedAt    time.Time       `db:"updated_at"    json:"updated_at"`
}

type LogEntry struct {
	ID        int64           `db:"id"        json:"id"`
	RunID     string          `db:"run_id"    json:"run_id"`
	StepID    *string         `db:"step_id"   json:"step_id"`
	Timestamp time.Time       `db:"timestamp" json:"timestamp"`
	Level     string          `db:"level"     json:"level"`
	Message   string          `db:"message"   json:"message"`
	Metadata  json.RawMessage `db:"metadata"  json:"metadata"`
}

// ─── Service ─────────────────────────────────────────────────────────────────

type Service struct {
	db  *sqlx.DB
	nc  *nats.Conn
	log *zap.Logger
}

func NewService(db *sqlx.DB, nc *nats.Conn, log *zap.Logger) *Service {
	return &Service{db: db, nc: nc, log: log}
}

// TriggerRun creates a workflow_run record and enqueues entry nodes.
func (s *Service) TriggerRun(ctx context.Context, workflowID, orgID string, callerID *string, triggerType string) (*Run, error) {
	// Verify workflow exists and is published
	var wf struct {
		ID     string `db:"id"`
		Status string `db:"status"`
	}
	if err := s.db.GetContext(ctx, &wf, `SELECT id, status FROM workflows WHERE id=$1 AND org_id=$2`, workflowID, orgID); err != nil {
		return nil, apierrors.NotFound("workflow")
	}
	if wf.Status != "published" {
		return nil, apierrors.BadRequest("workflow must be published before it can be run")
	}

	run := &Run{
		ID:          utils.NewID(),
		WorkflowID:  workflowID,
		OrgID:       orgID,
		TriggerType: triggerType,
		Status:      "queued",
		CreatedBy:   callerID,
		Metadata:    json.RawMessage("{}"),
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, apierrors.Internal("failed to start transaction")
	}
	defer tx.Rollback() //nolint:errcheck

	_, err = tx.ExecContext(ctx, `
		INSERT INTO workflow_runs (id, workflow_id, org_id, trigger_type, status, created_by, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		run.ID, run.WorkflowID, run.OrgID, run.TriggerType, run.Status, run.CreatedBy, run.Metadata,
	)
	if err != nil {
		return nil, apierrors.Internal("failed to create run")
	}

	// Find entry nodes (nodes with no incoming edges)
	var entryNodes []struct {
		ID             string `db:"id"`
		MaxRetries     int    `db:"max_retries"`
		RetryDelaySecs int    `db:"retry_delay_secs"`
		TimeoutSecs    int    `db:"timeout_secs"`
	}
	err = s.db.SelectContext(ctx, &entryNodes, `
		SELECT id, max_retries, retry_delay_secs, timeout_secs
		FROM workflow_nodes
		WHERE workflow_id=$1
		  AND id NOT IN (SELECT target_id FROM workflow_edges WHERE workflow_id=$1)
	`, workflowID)
	if err != nil || len(entryNodes) == 0 {
		return nil, apierrors.Unprocessable("no entry nodes found in workflow DAG")
	}

	// Create step records and publish jobs
	for _, node := range entryNodes {
		stepID := utils.NewID()
		_, err = tx.ExecContext(ctx, `
			INSERT INTO workflow_run_steps (id, run_id, node_id, status)
			VALUES ($1,$2,$3,'queued')`,
			stepID, run.ID, node.ID,
		)
		if err != nil {
			return nil, apierrors.Internal("failed to create step")
		}

		// Publish to NATS
		msg := events.JobMessage{
			JobID:      utils.NewID(),
			RunID:      run.ID,
			StepID:     stepID,
			WorkflowID: workflowID,
			OrgID:      orgID,
			Attempt:    1,
			Priority:   5,
		}
		data, _ := json.Marshal(msg)
		if s.nc != nil {
			if pubErr := s.nc.Publish(events.TopicJobEnqueued, data); pubErr != nil {
				s.log.Warn("failed to publish job to NATS", zap.Error(pubErr))
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, apierrors.Internal("failed to commit run")
	}

	// Emit run status event
	s.emitRunStatus(run.ID, workflowID, orgID, "queued", "")

	s.log.Info("run triggered",
		zap.String("run_id", run.ID),
		zap.String("workflow_id", workflowID),
		zap.Int("entry_nodes", len(entryNodes)),
	)

	return run, nil
}

// GetRun returns a run by ID.
func (s *Service) GetRun(ctx context.Context, runID, orgID string) (*Run, error) {
	var run Run
	if err := s.db.GetContext(ctx, &run, `SELECT * FROM workflow_runs WHERE id=$1 AND org_id=$2`, runID, orgID); err != nil {
		return nil, apierrors.NotFound("run")
	}
	return &run, nil
}

// ListRuns lists runs for a workflow.
func (s *Service) ListRuns(ctx context.Context, workflowID, orgID string, limit, offset int) ([]Run, error) {
	runs := make([]Run, 0)
	err := s.db.SelectContext(ctx, &runs, `
		SELECT * FROM workflow_runs
		WHERE workflow_id=$1 AND org_id=$2
		ORDER BY created_at DESC
		LIMIT $3 OFFSET $4
	`, workflowID, orgID, limit, offset)
	if err != nil {
		return nil, apierrors.Internal("failed to list runs")
	}
	return runs, nil
}

// GetRunSteps returns all steps for a run.
func (s *Service) GetRunSteps(ctx context.Context, runID, orgID string) ([]Step, error) {
	if _, err := s.GetRun(ctx, runID, orgID); err != nil {
		return nil, err
	}
	steps := make([]Step, 0)
	if err := s.db.SelectContext(ctx, &steps, `SELECT * FROM workflow_run_steps WHERE run_id=$1 ORDER BY created_at`, runID); err != nil {
		return nil, apierrors.Internal("failed to fetch steps")
	}
	return steps, nil
}

// CancelRun marks a run as cancelled.
func (s *Service) CancelRun(ctx context.Context, runID, orgID string) (*Run, error) {
	run, err := s.GetRun(ctx, runID, orgID)
	if err != nil {
		return nil, err
	}
	if run.Status == "success" || run.Status == "failed" || run.Status == "cancelled" {
		return nil, apierrors.BadRequest("run is already in a terminal state")
	}

	now := time.Now()
	_, err = s.db.ExecContext(ctx, `
		UPDATE workflow_runs SET status='cancelled', finished_at=$1 WHERE id=$2
	`, now, runID)
	if err != nil {
		return nil, apierrors.Internal("failed to cancel run")
	}

	run.Status = "cancelled"
	run.FinishedAt = &now

	s.emitRunStatus(runID, run.WorkflowID, orgID, "cancelled", "")
	return run, nil
}

// RetryRun creates a new run from the same workflow.
func (s *Service) RetryRun(ctx context.Context, runID, orgID, callerID string) (*Run, error) {
	run, err := s.GetRun(ctx, runID, orgID)
	if err != nil {
		return nil, err
	}
	return s.TriggerRun(ctx, run.WorkflowID, orgID, &callerID, "api")
}

// GetLogs returns log lines for a run, optionally filtered by step.
func (s *Service) GetLogs(ctx context.Context, runID, orgID string, stepID *string, limit int) ([]LogEntry, error) {
	if _, err := s.GetRun(ctx, runID, orgID); err != nil {
		return nil, err
	}

	logs := make([]LogEntry, 0)
	var err error
	if stepID != nil && *stepID != "" {
		err = s.db.SelectContext(ctx, &logs, `
			SELECT * FROM logs WHERE run_id=$1 AND step_id=$2 ORDER BY timestamp DESC LIMIT $3
		`, runID, stepID, limit)
	} else {
		err = s.db.SelectContext(ctx, &logs, `
			SELECT * FROM logs WHERE run_id=$1 ORDER BY timestamp DESC LIMIT $2
		`, runID, limit)
	}
	if err != nil {
		return nil, apierrors.Internal("failed to fetch logs")
	}
	return logs, nil
}

// AppendLog saves a log entry to the DB and broadcasts to NATS.
func (s *Service) AppendLog(ctx context.Context, runID string, stepID *string, level, message string, meta json.RawMessage) error {
	if meta == nil {
		meta = json.RawMessage("{}")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO logs (run_id, step_id, level, message, metadata) VALUES ($1,$2,$3,$4,$5)
	`, runID, stepID, level, message, meta)
	if err != nil {
		return err
	}

	// Broadcast via NATS for real-time streaming
	if s.nc != nil {
		evt := events.LogEvent{
			RunID:   runID,
			Level:   level,
			Message: message,
			Time:    time.Now().UTC().Format(time.RFC3339),
		}
		if stepID != nil {
			evt.StepID = *stepID
		}
		data, _ := json.Marshal(evt)
		_ = s.nc.Publish(events.TopicStepLog, data)
	}
	return nil
}

// UpdateStepStatus sets the status of a step and handles downstream unlocking.
func (s *Service) UpdateStepStatus(ctx context.Context, stepID, runID, orgID, status string, errMsg *string, output json.RawMessage) error {
	now := time.Now()
	switch status {
	case "running":
		_, err := s.db.ExecContext(ctx, `
			UPDATE workflow_run_steps SET status='running', started_at=$1, attempt=attempt+1 WHERE id=$2
		`, now, stepID)
		return err

	case "success":
		_, err := s.db.ExecContext(ctx, `
			UPDATE workflow_run_steps SET status='success', finished_at=$1, output_json=$2 WHERE id=$3
		`, now, output, stepID)
		if err != nil {
			return err
		}
		return s.unlockDownstreamSteps(ctx, stepID, runID, orgID)

	case "failed":
		_, err := s.db.ExecContext(ctx, `
			UPDATE workflow_run_steps SET status='failed', finished_at=$1, error_message=$2 WHERE id=$3
		`, now, errMsg, stepID)
		if err != nil {
			return err
		}
		return s.checkRunCompletion(ctx, runID, orgID)
	}
	return nil
}

// ─── Internal ────────────────────────────────────────────────────────────────

// unlockDownstreamSteps checks if any downstream steps can now be started.
func (s *Service) unlockDownstreamSteps(ctx context.Context, stepID, runID, orgID string) error {
	// Get the node for this step
	var nodeID string
	if err := s.db.GetContext(ctx, &nodeID, `SELECT node_id FROM workflow_run_steps WHERE id=$1`, stepID); err != nil {
		return err
	}

	// Get downstream nodes
	var downstreamNodeIDs []string
	if err := s.db.SelectContext(ctx, &downstreamNodeIDs, `
		SELECT target_id FROM workflow_edges WHERE source_id=$1
	`, nodeID); err != nil {
		return err
	}

	for _, targetNodeID := range downstreamNodeIDs {
		// Check if all upstream steps for this node are complete
		var pendingUpstream int
		err := s.db.GetContext(ctx, &pendingUpstream, `
			SELECT COUNT(*) FROM workflow_run_steps s
			INNER JOIN workflow_edges e ON e.source_id = s.node_id
			WHERE e.target_id = $1
			  AND s.run_id = $2
			  AND s.status != 'success'
		`, targetNodeID, runID)
		if err != nil || pendingUpstream > 0 {
			continue
		}

		// All upstream complete — create and enqueue this step
		newStepID := utils.NewID()
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO workflow_run_steps (id, run_id, node_id, status)
			VALUES ($1,$2,$3,'queued')
			ON CONFLICT DO NOTHING
		`, newStepID, runID, targetNodeID)
		if err != nil {
			continue
		}

		// Get run details for the message
		var wfID string
		_ = s.db.GetContext(ctx, &wfID, `SELECT workflow_id FROM workflow_runs WHERE id=$1`, runID)

		msg := events.JobMessage{
			JobID:      utils.NewID(),
			RunID:      runID,
			StepID:     newStepID,
			WorkflowID: wfID,
			OrgID:      orgID,
			Attempt:    1,
			Priority:   5,
		}
		data, _ := json.Marshal(msg)
		if s.nc != nil {
			_ = s.nc.Publish(events.TopicJobEnqueued, data)
		}
	}

	return s.checkRunCompletion(ctx, runID, orgID)
}

// checkRunCompletion marks the run succeeded or failed if all steps are terminal.
func (s *Service) checkRunCompletion(ctx context.Context, runID, orgID string) error {
	var pending int
	err := s.db.GetContext(ctx, &pending, `
		SELECT COUNT(*) FROM workflow_run_steps
		WHERE run_id=$1 AND status NOT IN ('success','failed','skipped')
	`, runID)
	if err != nil || pending > 0 {
		return err
	}

	var failed int
	_ = s.db.GetContext(ctx, &failed, `
		SELECT COUNT(*) FROM workflow_run_steps WHERE run_id=$1 AND status='failed'
	`, runID)

	finalStatus := "success"
	if failed > 0 {
		finalStatus = "failed"
	}

	now := time.Now()
	_, err = s.db.ExecContext(ctx, `
		UPDATE workflow_runs SET status=$1, finished_at=$2 WHERE id=$3
	`, finalStatus, now, runID)

	var wfID string
	_ = s.db.GetContext(ctx, &wfID, `SELECT workflow_id FROM workflow_runs WHERE id=$1`, runID)
	s.emitRunStatus(runID, wfID, orgID, finalStatus, "")

	return err
}

func (s *Service) emitRunStatus(runID, workflowID, orgID, status, errMsg string) {
	if s.nc == nil {
		return
	}
	evt := events.StatusEvent{
		RunID:      runID,
		WorkflowID: workflowID,
		OrgID:      orgID,
		Status:     status,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Error:      errMsg,
	}
	data, _ := json.Marshal(evt)
	_ = s.nc.Publish(events.TopicRunStatusChanged, data)
}
