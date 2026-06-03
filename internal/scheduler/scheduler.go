package scheduler

import (
	"context"

	"github.com/jmoiron/sqlx"
	"github.com/robfig/cron/v3"
	"github.com/salillakra/forge/internal/executions"
	"go.uber.org/zap"
)

// Scheduler polls published workflows with cron triggers and fires runs.
type Scheduler struct {
	db   *sqlx.DB
	exec *executions.Service
	cron *cron.Cron
	log  *zap.Logger
}

func New(db *sqlx.DB, exec *executions.Service, log *zap.Logger) *Scheduler {
	c := cron.New(cron.WithSeconds())
	return &Scheduler{
		db:   db,
		exec: exec,
		cron: c,
		log:  log,
	}
}

// Start loads all scheduled workflows from the DB and registers cron entries.
func (s *Scheduler) Start(ctx context.Context) error {
	if err := s.registerAll(ctx); err != nil {
		return err
	}
	s.cron.Start()
	s.log.Info("scheduler started")
	return nil
}

// Stop gracefully shuts the cron scheduler down.
func (s *Scheduler) Stop() {
	s.cron.Stop()
	s.log.Info("scheduler stopped")
}

// registerAll fetches published schedule workflows and registers cron entries.
func (s *Scheduler) registerAll(ctx context.Context) error {
	var workflows []struct {
		ID    string  `db:"id"`
		OrgID string  `db:"org_id"`
		Cron  *string `db:"cron_expr"`
	}

	err := s.db.SelectContext(ctx, &workflows, `
		SELECT id, org_id, cron_expr
		FROM workflows
		WHERE status='published' AND trigger_type='schedule' AND cron_expr IS NOT NULL
	`)
	if err != nil {
		return err
	}

	for _, wf := range workflows {
		if wf.Cron == nil {
			continue
		}
		wfID := wf.ID
		orgID := wf.OrgID
		expr := *wf.Cron

		_, err := s.cron.AddFunc(expr, func() {
			s.log.Info("scheduler firing run", zap.String("workflow_id", wfID))
			if _, err := s.exec.TriggerRun(context.Background(), wfID, orgID, nil, "schedule"); err != nil {
				s.log.Error("scheduler failed to trigger run",
					zap.String("workflow_id", wfID),
					zap.Error(err),
				)
			}
		})
		if err != nil {
			s.log.Warn("invalid cron expression",
				zap.String("workflow_id", wfID),
				zap.String("cron", expr),
				zap.Error(err),
			)
		}
	}

	s.log.Info("cron jobs registered", zap.Int("count", len(s.cron.Entries())))
	return nil
}
