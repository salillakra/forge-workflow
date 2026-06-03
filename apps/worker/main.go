package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/nats-io/nats.go"
	"github.com/salillakra/forge/internal/executions"
	"github.com/salillakra/forge/internal/queue"
	"github.com/salillakra/forge/pkg/config"
	"github.com/salillakra/forge/pkg/db"
	"github.com/salillakra/forge/pkg/events"
	"github.com/salillakra/forge/pkg/logger"
	"go.uber.org/zap"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}

	log := logger.Must(cfg.IsDevelopment())
	defer log.Sync() //nolint:errcheck

	// ─── Database ─────────────────────────────────────────────────────────────
	database := db.MustConnect(cfg.DatabaseURL, db.Options{
		MaxOpenConns:    cfg.DBMaxOpenConns,
		MaxIdleConns:    cfg.DBMaxIdleConns,
		ConnMaxLifetime: cfg.DBConnMaxLifetime,
	})
	defer database.Close()
	log.Info("worker connected to database")

	// ─── NATS ─────────────────────────────────────────────────────────────────
	nc, err := nats.Connect(cfg.NatsURL)
	if err != nil {
		log.Fatal("failed to connect to NATS", zap.Error(err))
	}
	defer nc.Close()
	log.Info("worker connected to NATS", zap.String("url", cfg.NatsURL))

	// ─── Execution service (needed for step status updates) ───────────────────
	execSvc := executions.NewService(database, nc, log)

	// ─── Start consumer ───────────────────────────────────────────────────────
	handler := buildJobHandler(database, nc, log, execSvc, cfg.WorkerID)
	consumer := queue.NewConsumer(nc, log, cfg.WorkerConcurrency, handler)

	sub, err := consumer.Subscribe()
	if err != nil {
		log.Fatal("failed to subscribe to job queue", zap.Error(err))
	}
	defer sub.Unsubscribe() //nolint:errcheck

	log.Info("worker ready",
		zap.String("worker_id", cfg.WorkerID),
		zap.Int("concurrency", cfg.WorkerConcurrency),
	)

	// ─── Graceful shutdown ────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit
	log.Info("worker shutting down")
}

// buildJobHandler constructs the job execution closure.
func buildJobHandler(
	database *sqlx.DB,
	nc *nats.Conn,
	log *zap.Logger,
	execSvc *executions.Service,
	workerID string,
) queue.JobHandler {
	return func(msg events.JobMessage) error {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		log.Info("executing step",
			zap.String("step_id", msg.StepID),
			zap.String("run_id", msg.RunID),
			zap.String("worker_id", workerID),
		)

		// Acquire lease
		leaseExpiry := time.Now().Add(10 * time.Minute)
		_, leaseErr := database.ExecContext(ctx, `
			INSERT INTO job_leases (run_id, step_id, worker_id, lease_expires_at, status)
			VALUES ($1, $2, $3, $4, 'active')
			ON CONFLICT (step_id) DO NOTHING
		`, msg.RunID, msg.StepID, workerID, leaseExpiry)
		if leaseErr != nil {
			log.Warn("failed to acquire lease (step may already be taken)", zap.String("step_id", msg.StepID), zap.Error(leaseErr))
			return nil // not an error — another worker already claimed it
		}
		defer releaseLease(ctx, database, msg.StepID)

		// Mark step as running
		if err := execSvc.UpdateStepStatus(ctx, msg.StepID, msg.RunID, msg.OrgID, "running", nil, nil); err != nil {
			log.Error("failed to mark step running", zap.Error(err))
			return err
		}

		// Emit log: step started
		stepID := msg.StepID
		_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
			fmt.Sprintf("[step:%s] execution started (attempt %d, worker %s)", msg.StepID, msg.Attempt, workerID),
			json.RawMessage(`{}`),
		)

		// ── Real execution happens here ────────────────────────────────────────
		output, execErr := executeStep(ctx, database, msg, execSvc, log)
		// ──────────────────────────────────────────────────────────────────────

		if execErr != nil {
			errMsg := execErr.Error()
			// Check retry policy
			var nodeConfig struct {
				MaxRetries     int `db:"max_retries"`
				RetryDelaySecs int `db:"retry_delay_secs"`
			}
			_ = database.GetContext(ctx, &nodeConfig, `SELECT max_retries, retry_delay_secs FROM workflow_nodes WHERE id=(SELECT node_id FROM workflow_run_steps WHERE id=$1)`, msg.StepID)

			if msg.Attempt < nodeConfig.MaxRetries+1 {
				delay := time.Duration(nodeConfig.RetryDelaySecs) * time.Second
				if delay == 0 {
					delay = 30 * time.Second
				}
				log.Info("scheduling retry",
					zap.String("step_id", msg.StepID),
					zap.Int("attempt", msg.Attempt+1),
					zap.Duration("delay", delay),
				)
				time.Sleep(delay)
				retryMsg := msg
				retryMsg.Attempt++
				data, _ := json.Marshal(retryMsg)
				_ = nc.Publish(events.TopicJobEnqueued, data)
				return nil
			}

			// Mark failed
			_ = execSvc.UpdateStepStatus(ctx, msg.StepID, msg.RunID, msg.OrgID, "failed", &errMsg, nil)
			_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "error",
				fmt.Sprintf("[step:%s] FAILED: %s", msg.StepID, errMsg),
				json.RawMessage(`{}`),
			)
			return execErr
		}

		// Mark success
		_ = execSvc.UpdateStepStatus(ctx, msg.StepID, msg.RunID, msg.OrgID, "success", nil, output)
		_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
			fmt.Sprintf("[step:%s] completed successfully", msg.StepID),
			json.RawMessage(`{}`),
		)

		return nil
	}
}

// executeStep runs the actual node step based on type
func executeStep(ctx context.Context, database *sqlx.DB, msg events.JobMessage, execSvc *executions.Service, log *zap.Logger) (json.RawMessage, error) {
	stepID := msg.StepID

	// Fetch node type & config
	var node struct {
		Type   string `db:"type"`
		Config string `db:"config"`
		Name   string `db:"name"`
	}
	err := database.GetContext(ctx, &node, `
		SELECT n.type, n.config, n.name 
		FROM workflow_nodes n
		INNER JOIN workflow_run_steps s ON s.node_id = n.id
		WHERE s.id = $1`, stepID)
	if err != nil {
		log.Error("failed to fetch node details for step execution", zap.Error(err))
		return nil, err
	}

	_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
		fmt.Sprintf("[step:%s] started execution for node '%s' (type: %s)", stepID, node.Name, node.Type),
		json.RawMessage(`{}`),
	)

	switch node.Type {
	case "script":
		// Parse config
		var cfg struct {
			Script string `json:"script"`
		}
		if err := json.Unmarshal([]byte(node.Config), &cfg); err != nil {
			return nil, fmt.Errorf("invalid script config: %w", err)
		}

		if cfg.Script == "" {
			return nil, fmt.Errorf("script configuration is empty")
		}

		_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
			fmt.Sprintf("[step:%s] executing script:\n%s", stepID, cfg.Script),
			json.RawMessage(`{}`),
		)

		// Execute via bash so any shell command works
		cmd := exec.CommandContext(ctx, "bash", "-c", cfg.Script)
		cmd.Env = append(os.Environ(), "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		execErr := cmd.Run()

		// Log stdout/stderr line-by-line
		for _, line := range strings.Split(stdout.String(), "\n") {
			if strings.TrimSpace(line) != "" {
				_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info", line, json.RawMessage(`{}`))
			}
		}
		for _, line := range strings.Split(stderr.String(), "\n") {
			if strings.TrimSpace(line) != "" {
				_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "error", line, json.RawMessage(`{}`))
			}
		}

		if execErr != nil {
			return nil, fmt.Errorf("script execution failed: %w (stderr: %s)", execErr, stderr.String())
		}

		return json.RawMessage(fmt.Sprintf(`{"status":"success","stdout":%q}`, stdout.String())), nil

	case "webhook":
		// Parse config
		var cfg struct {
			URL    string `json:"url"`
			Method string `json:"method"`
		}
		if err := json.Unmarshal([]byte(node.Config), &cfg); err != nil {
			return nil, fmt.Errorf("invalid webhook config: %w", err)
		}

		if cfg.URL == "" {
			return nil, fmt.Errorf("webhook URL is empty")
		}

		method := strings.ToUpper(cfg.Method)
		if method == "" {
			method = "POST"
		}

		_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
			fmt.Sprintf("[step:%s] sending HTTP %s request to %s", stepID, method, cfg.URL),
			json.RawMessage(`{}`),
		)

		// Perform outbound request
		req, err := http.NewRequestWithContext(ctx, method, cfg.URL, strings.NewReader(`{"triggered_by":"forge"}`))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("HTTP request failed: %w", err)
		}
		defer resp.Body.Close()

		bodyBytes, _ := io.ReadAll(resp.Body)
		bodyStr := string(bodyBytes)

		_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
			fmt.Sprintf("[step:%s] HTTP status: %s", stepID, resp.Status),
			json.RawMessage(`{}`),
		)

		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("webhook returned error status %d: %s", resp.StatusCode, bodyStr)
		}

		// return response payload
		return json.RawMessage(fmt.Sprintf(`{"status":"success","code":%d,"response":%q}`, resp.StatusCode, bodyStr)), nil

	case "notify":
		var cfg struct {
			Message string `json:"message"`
		}
		if err := json.Unmarshal([]byte(node.Config), &cfg); err != nil {
			return nil, fmt.Errorf("invalid notify config: %w", err)
		}

		msgText := cfg.Message
		if msgText == "" {
			msgText = "Workflow execution notification!"
		}

		_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
			fmt.Sprintf("[step:%s] NOTIFICATION: %s", stepID, msgText),
			json.RawMessage(`{}`),
		)

		return json.RawMessage(fmt.Sprintf(`{"status":"success","message":%q}`, msgText)), nil

	default:
		// Simulated wait
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}

		_ = execSvc.AppendLog(ctx, msg.RunID, &stepID, "info",
			fmt.Sprintf("[step:%s] finished generic task execution", stepID),
			json.RawMessage(`{}`),
		)

		return json.RawMessage(`{"status":"success","result":"generic"}`), nil
	}
}

// releaseLease marks the lease as released.
func releaseLease(ctx context.Context, database *sqlx.DB, stepID string) {
	_, _ = database.ExecContext(ctx, `UPDATE job_leases SET status='released' WHERE step_id=$1`, stepID)
}
