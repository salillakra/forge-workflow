# forge

**Distributed workflow orchestration platform** — define, schedule, execute and monitor DAG workflows with real-time observability.

![Forge CI/CD Pipeline](apps/web/public/forge-logo.png)

---

## What is Forge?

Forge is a self-hosted workflow automation platform built for developers. You define workflows as directed acyclic graphs (DAGs), compose nodes of different types (scripts, webhooks, notifications), publish them, and trigger runs manually, on a schedule, or via webhook — all from a clean web UI with live log streaming.

### Key features

- **Visual DAG Builder** — drag-and-drop React Flow canvas to compose workflows
- **Node types** — `script` (bash), `webhook` (HTTP), `notify` (message), `task` (generic)
- **Real-time execution logs** — SSE stream from worker → browser with live tail
- **Retry & timeout policies** — per-node configurable retries, delay, and timeout
- **Multi-org workspaces** — team isolation with org-scoped projects and workflows
- **Publish/validate gate** — DAG cycle detection and consistency checks before a workflow can run
- **Cron scheduler** — trigger workflows on a schedule without a CI system
- **JWT auth** — access + refresh token pair, stored in localStorage

---

## Architecture

```
┌─────────────────┐     HTTP/REST      ┌──────────────────────┐
│   Next.js Web   │ ◄────────────────► │   Go API (Fiber)     │
│   (port 3000)   │                    │   (port 8080)        │
└─────────────────┘                    └──────┬───────────────┘
                                              │ NATS pub/sub
                              ┌───────────────┼───────────────┐
                              │               │               │
                    ┌─────────▼──────┐ ┌──────▼──────┐ ┌─────▼──────────┐
                    │   Worker       │ │  Scheduler  │ │   PostgreSQL   │
                    │ (job executor) │ │ (cron jobs) │ │   (state)      │
                    └────────────────┘ └─────────────┘ └────────────────┘
                              │
                         NATS subjects
                     forge.jobs.enqueued
                     forge.run.status
                     forge.step.log
```

### Service responsibilities

| Service | Role |
|---|---|
| **API** (`apps/api`) | REST handlers, auth, DAG CRUD, run triggering, SSE streaming |
| **Worker** (`apps/worker`) | Consumes NATS job queue, executes steps (bash/webhook/notify), writes logs, unlocks downstream steps |
| **Scheduler** (`apps/scheduler`) | Polls cron-triggered workflows, emits run triggers on schedule |
| **Web** (`apps/web`) | Next.js 16 App Router frontend, React Flow DAG canvas, TanStack Query data fetching |

---

## Repository structure

```
forge/
├── apps/
│   ├── api/            # Go Fiber API server entrypoint
│   ├── worker/         # NATS job consumer & step executor
│   ├── scheduler/      # Cron-based run trigger service
│   └── web/            # Next.js 16 frontend
│       └── src/
│           ├── app/    # Next.js App Router pages
│           ├── components/  # UI components (DAG viewer, sidebar, etc.)
│           ├── lib/    # API client (Axios), helpers
│           ├── store/  # Zustand auth store
│           └── types/  # TypeScript type definitions
├── internal/
│   ├── auth/           # JWT auth service & handlers
│   ├── common/         # Shared project handlers
│   ├── executions/     # Run, step, and log service + handlers
│   ├── orgs/           # Organization service & handlers
│   ├── queue/          # NATS consumer wrapper
│   ├── realtime/       # SSE hub for live log streaming
│   ├── scheduler/      # Cron job registration & dispatch
│   └── workflows/      # Workflow & DAG service + handlers
├── pkg/
│   ├── config/         # Environment config (envconfig)
│   ├── db/             # PostgreSQL connection helper
│   ├── errors/         # Typed API error helpers
│   ├── events/         # NATS topic constants & message types
│   ├── logger/         # Zap logger factory
│   └── utils/          # UUID generation, shared utilities
├── migrations/
│   └── 001_initial_schema.sql   # Full DB schema
├── docs/
│   ├── api.md              # API endpoint reference
│   ├── architecture.md     # Detailed architecture notes
│   ├── data-model.md       # Database schema docs
│   └── sequence-diagrams.md
├── scripts/
│   └── manual_test_nats.go  # Dev utility to publish test NATS events
├── docker-compose.yml       # PostgreSQL + NATS for local dev
├── Makefile                 # Dev shortcuts
├── .env.example             # Environment variable template
├── go.mod
└── go.sum
```

---

## Getting started

### Prerequisites

- **Go** ≥ 1.22
- **Node.js** ≥ 20 + npm
- **Docker** + Docker Compose (for PostgreSQL and NATS)

### 1. Clone and configure

```bash
git clone https://github.com/salillakra/forge.git
cd forge
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
DATABASE_URL=postgres://forge:forge@localhost:5432/forge?sslmode=disable
NATS_URL=nats://localhost:4222
JWT_SECRET=change-me-in-production
```

### 2. Start infrastructure

```bash
make dev-infra
# Starts PostgreSQL on :5432 and NATS on :4222 via Docker Compose
```

### 3. Run database migrations

```bash
make migrate
# or manually:
psql $DATABASE_URL -f migrations/001_initial_schema.sql
```

### 4. Start all services

Open three terminals:

```bash
# Terminal 1 — API server (port 8080)
make dev-api

# Terminal 2 — Worker (processes jobs from NATS)
make dev-worker

# Terminal 3 — Scheduler (optional, for cron workflows)
make dev-scheduler
```

### 5. Start the frontend

```bash
cd apps/web
npm install
npm run dev
# Frontend at http://localhost:3000
```

Open `http://localhost:3000`, register an account, create an organization, and start building workflows.

---

## Make targets

| Command | Description |
|---|---|
| `make dev-infra` | Start PostgreSQL + NATS via Docker Compose |
| `make dev-api` | Run the API server with live reload |
| `make dev-worker` | Run the job worker |
| `make dev-scheduler` | Run the cron scheduler |
| `make build` | Build all Go binaries to `bin/` |
| `make migrate` | Apply SQL migrations |
| `make lint` | Run golangci-lint |
| `make test` | Run all Go tests |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `JWT_SECRET` | — | HMAC secret for JWT signing |
| `JWT_ACCESS_TOKEN_TTL` | `15m` | Access token lifetime |
| `JWT_REFRESH_TOKEN_TTL` | `7d` | Refresh token lifetime |
| `WORKER_CONCURRENCY` | `10` | Max parallel steps per worker |
| `WORKER_ID` | `worker-1` | Unique identifier for this worker |
| `PORT` | `8080` | API server listen port |
| `OTEL_SERVICE_NAME` | `forge-api` | OpenTelemetry service name |
| `PROMETHEUS_PORT` | `9090` | Prometheus metrics port |

---

## API overview

Base URL: `http://localhost:8080/api`

All endpoints (except auth) require `Authorization: Bearer <access_token>`.

### Auth
| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Register new user |
| `POST` | `/auth/login` | Login, returns access + refresh tokens |
| `POST` | `/auth/refresh` | Refresh access token |
| `GET` | `/auth/me` | Get current user |

### Organizations
| Method | Path | Description |
|---|---|---|
| `POST` | `/orgs` | Create organization |
| `GET` | `/orgs` | List user's organizations |
| `GET` | `/orgs/:orgId` | Get organization |

### Workflows
| Method | Path | Description |
|---|---|---|
| `POST` | `/orgs/:orgId/workflows` | Create workflow |
| `GET` | `/orgs/:orgId/workflows` | List workflows |
| `GET` | `/orgs/:orgId/workflows/:id` | Get workflow + nodes + edges |
| `PATCH` | `/orgs/:orgId/workflows/:id` | Update workflow metadata |
| `PUT` | `/orgs/:orgId/workflows/:id/graph` | Save DAG nodes + edges |
| `POST` | `/orgs/:orgId/workflows/:id/validate` | Validate DAG (cycle check) |
| `POST` | `/orgs/:orgId/workflows/:id/publish` | Publish workflow |
| `POST` | `/orgs/:orgId/workflows/:id/run` | Trigger a manual run |

### Runs
| Method | Path | Description |
|---|---|---|
| `GET` | `/orgs/:orgId/workflows/:wfId/runs` | List runs |
| `GET` | `/orgs/:orgId/runs/:runId` | Get run detail |
| `GET` | `/orgs/:orgId/runs/:runId/steps` | Get step statuses |
| `GET` | `/orgs/:orgId/runs/:runId/logs` | Get run logs |
| `POST` | `/orgs/:orgId/runs/:runId/cancel` | Cancel a running run |
| `POST` | `/orgs/:orgId/runs/:runId/retry` | Retry a failed run |
| `GET` | `/orgs/:orgId/runs/:runId/stream` | SSE live log stream |

---

## Workflow node types

| Type | Config fields | Behavior |
|---|---|---|
| `script` | `script: string` | Executes the script via `bash -c` |
| `webhook` | `url: string`, `method: string` | Makes an outbound HTTP request |
| `notify` | `message: string` | Logs a notification message |
| `task` | _(none required)_ | Generic step with simulated execution |

**Per-node settings:**
- `max_retries` — how many times to retry on failure (default: 3)
- `retry_delay_secs` — delay between retries in seconds (default: 10)
- `timeout_secs` — step timeout in seconds (default: 300)

---

## Execution model

```
1. User triggers run  →  API creates workflow_run (status: queued)
2. API finds entry nodes (no incoming edges)
3. For each entry node → creates workflow_run_step + publishes to NATS (forge.jobs.enqueued)
4. Worker picks up job → marks step "running" → executes node logic
5. Worker writes logs to DB + broadcasts via NATS (forge.step.log)
6. On step success → worker checks downstream nodes, unlocks any whose all upstreams are done
7. When all steps terminal → run marked success/failed
```

Real-time logs are streamed to the browser via **Server-Sent Events** at `/orgs/:orgId/runs/:runId/stream`.

---

## Tech stack

### Backend
- [Go 1.22](https://go.dev) — all services
- [Fiber v3](https://gofiber.io) — HTTP framework
- [sqlx](https://github.com/jmoiron/sqlx) + [PostgreSQL](https://postgresql.org) — persistence
- [NATS](https://nats.io) — async job queue and event bus
- [Zap](https://github.com/uber-go/zap) — structured logging
- [golang-jwt/jwt](https://github.com/golang-jwt/jwt) — JWT auth

### Frontend
- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [React Flow](https://reactflow.dev) — DAG canvas
- [TanStack Query](https://tanstack.com/query) — server state & caching
- [Zustand](https://zustand-demo.pmnd.rs) — client auth state
- [Framer Motion](https://www.framer.com/motion) — animations
- [shadcn/ui](https://ui.shadcn.com) — component primitives
- [Tailwind CSS](https://tailwindcss.com) — styling

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit changes: `git commit -m "feat: add my feature"`
4. Push and open a Pull Request

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

---

## License

MIT © Salil Lakra
