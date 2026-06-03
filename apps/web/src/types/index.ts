// ─── Core domain types ───────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  joined_at: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  description?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type WorkflowStatus = "draft" | "published" | "archived";
export type TriggerType = "manual" | "schedule" | "webhook" | "api";

export interface Workflow {
  id: string;
  project_id: string;
  org_id: string;
  name: string;
  description: string;
  version: number;
  status: WorkflowStatus;
  trigger_type: TriggerType;
  cron_expr?: string | null;
  definition: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  name: string;
  type: "task" | "webhook" | "script" | "notify";
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
  max_retries: number;
  retry_delay_secs: number;
  timeout_secs: number;
  created_at: string;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_id: string;
  target_id: string;
}

export type RunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  org_id: string;
  trigger_type: TriggerType;
  status: RunStatus;
  started_at?: string | null;
  finished_at?: string | null;
  created_by?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RunStep {
  id: string;
  run_id: string;
  node_id: string;
  status: StepStatus;
  attempt: number;
  started_at?: string | null;
  finished_at?: string | null;
  input_json?: Record<string, unknown> | null;
  output_json?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  id: number;
  run_id: string;
  step_id?: string | null;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata: Record<string, unknown>;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

// ─── Request types ────────────────────────────────────────────────────────────

export interface RegisterRequest {
  email: string;
  password: string;
  display_name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateOrgRequest {
  name: string;
  slug: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  trigger_type: TriggerType;
  cron_expr?: string;
}

export interface UpsertGraphRequest {
  nodes: Omit<WorkflowNode, "workflow_id" | "created_at">[];
  edges: Omit<WorkflowEdge, "id" | "workflow_id">[];
}

// ─── SSE event shapes ─────────────────────────────────────────────────────────

export interface StatusEvent {
  run_id: string;
  step_id?: string;
  workflow_id: string;
  org_id: string;
  status: RunStatus | StepStatus;
  timestamp: string;
  error?: string;
}

export interface LogEvent {
  run_id: string;
  step_id: string;
  level: string;
  message: string;
  time: string;
}
