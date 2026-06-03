package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/compress"
	"github.com/gofiber/fiber/v3/middleware/cors"
	fiberlogger "github.com/gofiber/fiber/v3/middleware/logger"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/nats-io/nats.go"
	"github.com/salillakra/forge/internal/auth"
	"github.com/salillakra/forge/internal/common"
	"github.com/salillakra/forge/internal/executions"
	"github.com/salillakra/forge/internal/orgs"
	"github.com/salillakra/forge/internal/realtime"
	"github.com/salillakra/forge/internal/scheduler"
	"github.com/salillakra/forge/internal/workflows"
	"github.com/salillakra/forge/pkg/config"
	"github.com/salillakra/forge/pkg/db"
	"github.com/salillakra/forge/pkg/logger"
	"go.uber.org/zap"
)

func main() {
	// ─── Config ────────────────────────────────────────────────────────────────
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
	log.Info("connected to database")

	// ─── NATS (optional — API works without it in dev) ────────────────────────
	var nc *nats.Conn
	nc, err = nats.Connect(cfg.NatsURL)
	if err != nil {
		log.Warn("NATS unavailable — realtime features disabled", zap.Error(err))
		nc = nil
	} else {
		defer nc.Close()
		log.Info("connected to NATS", zap.String("url", cfg.NatsURL))
	}

	// ─── Services ─────────────────────────────────────────────────────────────
	authSvc := auth.NewService(database, cfg.JWTSecret, cfg.JWTAccessTokenTTL, cfg.JWTRefreshTokenTTL)
	orgSvc := orgs.NewService(database)
	projectSvc := common.NewProjectService(database)
	workflowSvc := workflows.NewService(database)
	execSvc := executions.NewService(database, nc, log)
	hub := realtime.NewHub(nc, log)
	defer hub.Close()

	// ─── Start scheduler (embedded in API process for simplicity) ─────────────
	sched := scheduler.New(database, execSvc, log)
	if err := sched.Start(context.Background()); err != nil {
		log.Warn("scheduler start failed", zap.Error(err))
	}
	defer sched.Stop()

	// ─── HTTP Handlers ────────────────────────────────────────────────────────
	authHandler := auth.NewHandler(authSvc)
	orgHandler := orgs.NewHandler(orgSvc)
	projectHandler := common.NewProjectHandler(projectSvc)
	workflowHandler := workflows.NewHandler(workflowSvc)
	execHandler := executions.NewHandler(execSvc)
	rtHandler := realtime.NewHandler(hub)

	// ─── Fiber app ────────────────────────────────────────────────────────────
	app := fiber.New(fiber.Config{
		AppName:               "Forge API v1",
		ServerHeader:          "Forge",
		CaseSensitive:         true,
		StrictRouting:         false,
		ReadTimeout:           30 * time.Second,
		WriteTimeout:          60 * time.Second,
		IdleTimeout:           5 * time.Minute,
	})

	// ─── Global middleware ────────────────────────────────────────────────────
	app.Use(recover.New())
	app.Use(compress.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowHeaders: []string{"Origin", "Content-Type", "Authorization"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
	}))
	app.Use(fiberlogger.New(fiberlogger.Config{
		Format: "${time} ${status} ${method} ${path} ${latency}\n",
	}))

	// ─── Routes ───────────────────────────────────────────────────────────────
	api := app.Group("/api")

	// Health
	api.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "service": "forge-api"})
	})

	// Auth (public)
	authGroup := api.Group("/auth")
	authGroup.Post("/register", authHandler.Register)
	authGroup.Post("/login", authHandler.Login)
	authGroup.Post("/refresh", authHandler.Refresh)
	authGroup.Post("/logout", authHandler.Logout)

	// Protected routes — require JWT
	protected := api.Group("", authSvc.Middleware)

	// Me
	protected.Get("/me", authHandler.Me)

	// Organizations
	orgGroup := protected.Group("/orgs")
	orgGroup.Post("/", orgHandler.CreateOrg)
	orgGroup.Get("/", orgHandler.ListOrgs)
	orgGroup.Get("/:orgId", orgHandler.GetOrg)
	orgGroup.Get("/:orgId/members", orgHandler.ListMembers)

	// Projects (nested under org)
	projGroup := orgGroup.Group("/:orgId/projects")
	projGroup.Post("/", projectHandler.Create)
	projGroup.Get("/", projectHandler.List)
	projGroup.Get("/:projectId", projectHandler.Get)
	projGroup.Delete("/:projectId", projectHandler.Delete)

	// Workflows (nested under org + project)
	wfBase := projGroup.Group("/:projectId/workflows")
	wfBase.Post("/", workflowHandler.Create)
	wfBase.Get("/", workflowHandler.List)

	wfItem := orgGroup.Group("/:orgId/workflows/:workflowId")
	wfItem.Get("/", workflowHandler.Get)
	wfItem.Patch("/", workflowHandler.Update)
	wfItem.Put("/graph", workflowHandler.UpsertGraph)
	wfItem.Post("/validate", workflowHandler.Validate)
	wfItem.Post("/publish", workflowHandler.Publish)

	// Run triggers
	wfItem.Post("/run", execHandler.TriggerRun)
	wfItem.Get("/runs", execHandler.ListRuns)

	// Runs
	runGroup := orgGroup.Group("/:orgId/runs/:runId")
	runGroup.Get("/", execHandler.GetRun)
	runGroup.Get("/steps", execHandler.GetRunSteps)
	runGroup.Get("/logs", execHandler.GetLogs)
	runGroup.Post("/cancel", execHandler.CancelRun)
	runGroup.Post("/retry", execHandler.RetryRun)
	runGroup.Get("/stream", rtHandler.StreamRun) // SSE

	// ─── Start server ─────────────────────────────────────────────────────────
	addr := cfg.ServerAddr()
	log.Info("starting API server", zap.String("addr", addr))

	go func() {
		if err := app.Listen(addr); err != nil {
			log.Error("server error", zap.Error(err))
		}
	}()

	// ─── Graceful shutdown ────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	log.Info("shutting down API server")
	if err := app.ShutdownWithTimeout(10 * time.Second); err != nil {
		log.Error("shutdown error", zap.Error(err))
	}
	log.Info("server stopped")
}
