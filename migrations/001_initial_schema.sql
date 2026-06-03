-- Forge: complete schema migration
-- Run once against a fresh Postgres database.

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive text

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT      NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    display_name  TEXT        NOT NULL DEFAULT '',
    avatar_url    TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);

-- ============================================================
-- Organizations
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        CITEXT      NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    owner_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan        TEXT        NOT NULL DEFAULT 'free',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orgs_slug ON organizations (slug);
CREATE INDEX idx_orgs_owner ON organizations (owner_id);

-- ============================================================
-- Organization Members
-- ============================================================
CREATE TABLE IF NOT EXISTS org_members (
    id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role     TEXT        NOT NULL DEFAULT 'member',  -- owner | admin | member | viewer
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_members_org  ON org_members (org_id);
CREATE INDEX idx_org_members_user ON org_members (user_id);

-- ============================================================
-- Projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT,
    created_by  UUID        NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_org ON projects (org_id);

-- ============================================================
-- Workflows
-- ============================================================
CREATE TABLE IF NOT EXISTS workflows (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT,
    version     INT         NOT NULL DEFAULT 1,
    status      TEXT        NOT NULL DEFAULT 'draft',  -- draft | published | archived
    trigger_type TEXT       NOT NULL DEFAULT 'manual', -- manual | schedule | webhook | api
    cron_expr   TEXT,                                   -- for schedule triggers
    definition  JSONB       NOT NULL DEFAULT '{}',      -- full DAG snapshot at publish time
    created_by  UUID        NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_project ON workflows (project_id);
CREATE INDEX idx_workflows_org     ON workflows (org_id);
CREATE INDEX idx_workflows_status  ON workflows (status);

-- ============================================================
-- Workflow Nodes (steps in the DAG)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_nodes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    type        TEXT        NOT NULL DEFAULT 'task',  -- task | webhook | script | notify
    config      JSONB       NOT NULL DEFAULT '{}',
    position_x  FLOAT       NOT NULL DEFAULT 0,
    position_y  FLOAT       NOT NULL DEFAULT 0,
    -- Retry policy
    max_retries INT         NOT NULL DEFAULT 0,
    retry_delay_secs INT    NOT NULL DEFAULT 30,
    timeout_secs INT        NOT NULL DEFAULT 600,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_nodes_workflow ON workflow_nodes (workflow_id);

-- ============================================================
-- Workflow Edges (dependencies between nodes)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_edges (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_id   UUID        NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    target_id   UUID        NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    UNIQUE (workflow_id, source_id, target_id)
);

CREATE INDEX idx_workflow_edges_workflow ON workflow_edges (workflow_id);

-- ============================================================
-- Workflow Runs
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_runs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id  UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    trigger_type TEXT        NOT NULL DEFAULT 'manual',
    status       TEXT        NOT NULL DEFAULT 'queued', -- queued | running | success | failed | cancelled
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    created_by   UUID        REFERENCES users(id),
    metadata     JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runs_workflow ON workflow_runs (workflow_id);
CREATE INDEX idx_runs_org      ON workflow_runs (org_id);
CREATE INDEX idx_runs_status   ON workflow_runs (status);
CREATE INDEX idx_runs_created  ON workflow_runs (created_at DESC);

-- ============================================================
-- Workflow Run Steps
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_run_steps (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    node_id       UUID        NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    status        TEXT        NOT NULL DEFAULT 'pending',  -- pending | queued | running | success | failed | skipped
    attempt       INT         NOT NULL DEFAULT 0,
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    input_json    JSONB,
    output_json   JSONB,
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_run_steps_run    ON workflow_run_steps (run_id);
CREATE INDEX idx_run_steps_node   ON workflow_run_steps (node_id);
CREATE INDEX idx_run_steps_status ON workflow_run_steps (status);

-- ============================================================
-- Job Leases (worker locking mechanism)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_leases (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id          UUID        NOT NULL REFERENCES workflow_run_steps(id) ON DELETE CASCADE,
    worker_id        TEXT        NOT NULL,
    leased_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'active', -- active | released | expired
    UNIQUE (step_id)
);

CREATE INDEX idx_leases_step   ON job_leases (step_id);
CREATE INDEX idx_leases_worker ON job_leases (worker_id);
CREATE INDEX idx_leases_expiry ON job_leases (lease_expires_at);

-- ============================================================
-- Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
    id            BIGSERIAL   PRIMARY KEY,
    run_id        UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id       UUID        REFERENCES workflow_run_steps(id) ON DELETE CASCADE,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level         TEXT        NOT NULL DEFAULT 'info',
    message       TEXT        NOT NULL,
    metadata      JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_logs_run  ON logs (run_id, timestamp DESC);
CREATE INDEX idx_logs_step ON logs (step_id, timestamp DESC);

-- ============================================================
-- Artifacts
-- ============================================================
CREATE TABLE IF NOT EXISTS artifacts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id     UUID        REFERENCES workflow_run_steps(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    type        TEXT        NOT NULL DEFAULT 'file',
    storage_url TEXT        NOT NULL,
    size_bytes  BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifacts_run  ON artifacts (run_id);
CREATE INDEX idx_artifacts_step ON artifacts (step_id);

-- ============================================================
-- Audit Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id            BIGSERIAL   PRIMARY KEY,
    org_id        UUID        REFERENCES organizations(id) ON DELETE SET NULL,
    actor_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
    action        TEXT        NOT NULL,
    target_type   TEXT,
    target_id     TEXT,
    metadata      JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org    ON audit_logs (org_id, created_at DESC);
CREATE INDEX idx_audit_actor  ON audit_logs (actor_user_id);
CREATE INDEX idx_audit_action ON audit_logs (action);

-- ============================================================
-- Refresh Tokens (for JWT refresh flow)
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- ============================================================
-- Org Invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS org_invitations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       CITEXT      NOT NULL,
    role        TEXT        NOT NULL DEFAULT 'member',
    token       TEXT        NOT NULL UNIQUE,
    invited_by  UUID        NOT NULL REFERENCES users(id),
    accepted_at TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_org   ON org_invitations (org_id);
CREATE INDEX idx_invitations_email ON org_invitations (email);
CREATE INDEX idx_invitations_token ON org_invitations (token);

-- ============================================================
-- Triggers to auto-update updated_at columns
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orgs_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_run_steps_updated_at
    BEFORE UPDATE ON workflow_run_steps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
