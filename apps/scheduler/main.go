package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/salillakra/forge/internal/executions"
	"github.com/salillakra/forge/internal/scheduler"
	"github.com/salillakra/forge/pkg/config"
	"github.com/salillakra/forge/pkg/db"
	"github.com/salillakra/forge/pkg/logger"
	"github.com/nats-io/nats.go"
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

	database := db.MustConnect(cfg.DatabaseURL, db.Options{
		MaxOpenConns:    cfg.DBMaxOpenConns,
		MaxIdleConns:    cfg.DBMaxIdleConns,
		ConnMaxLifetime: cfg.DBConnMaxLifetime,
	})
	defer database.Close()

	var nc *nats.Conn
	nc, err = nats.Connect(cfg.NatsURL)
	if err != nil {
		log.Fatal("scheduler requires NATS", zap.Error(err))
	}
	defer nc.Close()

	execSvc := executions.NewService(database, nc, log)
	sched := scheduler.New(database, execSvc, log)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := sched.Start(ctx); err != nil {
		log.Fatal("failed to start scheduler", zap.Error(err))
	}

	log.Info("standalone scheduler running")

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit
	sched.Stop()
	log.Info("scheduler stopped")
}
