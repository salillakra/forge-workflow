package events

// Event topic names for NATS JetStream.
const (
	// Job lifecycle
	TopicJobEnqueued  = "forge.jobs.enqueued"
	TopicJobStarted   = "forge.jobs.started"
	TopicJobCompleted = "forge.jobs.completed"
	TopicJobFailed    = "forge.jobs.failed"
	TopicJobRetry     = "forge.jobs.retry"
	TopicJobCancelled = "forge.jobs.cancelled"

	// Step status
	TopicStepStatusChanged = "forge.steps.status"

	// Run status
	TopicRunStatusChanged = "forge.runs.status"

	// Logs
	TopicStepLog = "forge.logs.step"

	// Dead-letter
	TopicDeadLetter = "forge.jobs.dead"

	// Scheduler
	TopicScheduledTrigger = "forge.scheduler.trigger"
)

// JobMessage is the message published to NATS for each job.
type JobMessage struct {
	JobID      string `json:"job_id"`
	RunID      string `json:"run_id"`
	StepID     string `json:"step_id"`
	WorkflowID string `json:"workflow_id"`
	OrgID      string `json:"org_id"`
	Attempt    int    `json:"attempt"`
	Priority   int    `json:"priority"`
	ScheduledFor string `json:"scheduled_for,omitempty"`
}

// StatusEvent is published when a run or step changes state.
type StatusEvent struct {
	RunID      string `json:"run_id"`
	StepID     string `json:"step_id,omitempty"`
	WorkflowID string `json:"workflow_id"`
	OrgID      string `json:"org_id"`
	Status     string `json:"status"`
	Timestamp  string `json:"timestamp"`
	Error      string `json:"error,omitempty"`
}

// LogEvent is a streamed log line from a worker.
type LogEvent struct {
	RunID   string `json:"run_id"`
	StepID  string `json:"step_id"`
	Level   string `json:"level"`
	Message string `json:"message"`
	Time    string `json:"time"`
}
