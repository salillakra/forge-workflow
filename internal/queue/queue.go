package queue

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/salillakra/forge/pkg/events"
	"go.uber.org/zap"
)

// Publisher wraps a NATS connection with typed publishing helpers.
type Publisher struct {
	nc  *nats.Conn
	log *zap.Logger
}

func NewPublisher(nc *nats.Conn, log *zap.Logger) *Publisher {
	return &Publisher{nc: nc, log: log}
}

// PublishJob publishes a job message to NATS.
func (p *Publisher) PublishJob(msg events.JobMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal job: %w", err)
	}
	if err := p.nc.Publish(events.TopicJobEnqueued, data); err != nil {
		p.log.Error("failed to publish job", zap.Error(err), zap.String("step_id", msg.StepID))
		return err
	}
	p.log.Debug("job published", zap.String("step_id", msg.StepID), zap.String("run_id", msg.RunID))
	return nil
}

// PublishStatusEvent publishes a run/step status change.
func (p *Publisher) PublishStatusEvent(evt events.StatusEvent) error {
	data, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	return p.nc.Publish(events.TopicRunStatusChanged, data)
}

// ─── Consumer ─────────────────────────────────────────────────────────────────

// JobHandler is the function signature a worker must implement.
type JobHandler func(msg events.JobMessage) error

// Consumer subscribes to NATS topics and dispatches to handlers.
type Consumer struct {
	nc          *nats.Conn
	log         *zap.Logger
	jobHandler  JobHandler
	concurrency int
	sem         chan struct{}
}

func NewConsumer(nc *nats.Conn, log *zap.Logger, concurrency int, handler JobHandler) *Consumer {
	return &Consumer{
		nc:          nc,
		log:         log,
		jobHandler:  handler,
		concurrency: concurrency,
		sem:         make(chan struct{}, concurrency),
	}
}

// Subscribe starts listening for jobs on the job topic.
func (c *Consumer) Subscribe() (*nats.Subscription, error) {
	sub, err := c.nc.QueueSubscribe(events.TopicJobEnqueued, "forge-workers", func(m *nats.Msg) {
		c.sem <- struct{}{} // acquire concurrency slot
		go func() {
			defer func() { <-c.sem }() // release on exit
			c.dispatch(m)
		}()
	})
	if err != nil {
		return nil, fmt.Errorf("subscribe to job topic: %w", err)
	}
	c.log.Info("consumer subscribed", zap.String("topic", events.TopicJobEnqueued))
	return sub, nil
}

func (c *Consumer) dispatch(m *nats.Msg) {
	var msg events.JobMessage
	if err := json.Unmarshal(m.Data, &msg); err != nil {
		c.log.Error("failed to unmarshal job message", zap.Error(err))
		return
	}

	c.log.Info("processing job",
		zap.String("step_id", msg.StepID),
		zap.String("run_id", msg.RunID),
		zap.Int("attempt", msg.Attempt),
	)

	start := time.Now()
	if err := c.jobHandler(msg); err != nil {
		c.log.Error("job handler failed",
			zap.Error(err),
			zap.String("step_id", msg.StepID),
			zap.Duration("elapsed", time.Since(start)),
		)
		return
	}

	c.log.Info("job completed",
		zap.String("step_id", msg.StepID),
		zap.Duration("elapsed", time.Since(start)),
	)
}
