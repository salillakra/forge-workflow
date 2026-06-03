import axios from "axios";
import type {
  AuthResponse,
  CreateOrgRequest,
  CreateProjectRequest,
  CreateWorkflowRequest,
  LogEntry,
  LoginRequest,
  Organization,
  OrgMember,
  Project,
  RegisterRequest,
  RunStep,
  UpsertGraphRequest,
  User,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRun,
} from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 30_000,
});

// ─── Request interceptor — attach Bearer token ────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("forge_access_token")
      : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Response interceptor — auto-refresh on 401 ───────────────────────────────
apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem("forge_refresh_token");
      if (refreshToken) {
        try {
          const { data } = await axios.post<AuthResponse>(
            `${BASE_URL}/api/auth/refresh`,
            { refresh_token: refreshToken }
          );
          localStorage.setItem("forge_access_token", data.access_token);
          localStorage.setItem("forge_refresh_token", data.refresh_token);
          original.headers.Authorization = `Bearer ${data.access_token}`;
          return apiClient(original);
        } catch {
          localStorage.clear();
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(err);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (data: RegisterRequest) =>
    apiClient.post<AuthResponse>("/api/auth/register", data).then((r) => r.data),
  login: (data: LoginRequest) =>
    apiClient.post<AuthResponse>("/api/auth/login", data).then((r) => r.data),
  refresh: (refreshToken: string) =>
    apiClient
      .post<AuthResponse>("/api/auth/refresh", { refresh_token: refreshToken })
      .then((r) => r.data),
  logout: (refreshToken: string) =>
    apiClient
      .post("/api/auth/logout", { refresh_token: refreshToken })
      .then((r) => r.data),
  me: () => apiClient.get<User>("/api/me").then((r) => r.data),
};

// ─── Organizations ────────────────────────────────────────────────────────────

export const orgsApi = {
  create: (data: CreateOrgRequest) =>
    apiClient.post<Organization>("/api/orgs", data).then((r) => r.data),
  list: () =>
    apiClient
      .get<{ orgs: Organization[] }>("/api/orgs")
      .then((r) => r.data.orgs),
  get: (orgId: string) =>
    apiClient.get<Organization>(`/api/orgs/${orgId}`).then((r) => r.data),
  listMembers: (orgId: string) =>
    apiClient
      .get<{ members: OrgMember[] }>(`/api/orgs/${orgId}/members`)
      .then((r) => r.data.members),
};

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projectsApi = {
  create: (orgId: string, data: CreateProjectRequest) =>
    apiClient
      .post<Project>(`/api/orgs/${orgId}/projects`, data)
      .then((r) => r.data),
  list: (orgId: string) =>
    apiClient
      .get<{ projects: Project[] }>(`/api/orgs/${orgId}/projects`)
      .then((r) => r.data.projects),
  get: (orgId: string, projectId: string) =>
    apiClient
      .get<Project>(`/api/orgs/${orgId}/projects/${projectId}`)
      .then((r) => r.data),
  delete: (orgId: string, projectId: string) =>
    apiClient.delete(`/api/orgs/${orgId}/projects/${projectId}`),
};

// ─── Workflows ────────────────────────────────────────────────────────────────

export const workflowsApi = {
  create: (orgId: string, projectId: string, data: CreateWorkflowRequest) =>
    apiClient
      .post<Workflow>(`/api/orgs/${orgId}/projects/${projectId}/workflows`, data)
      .then((r) => r.data),
  list: (orgId: string, projectId: string) =>
    apiClient
      .get<{ workflows: Workflow[] }>(
        `/api/orgs/${orgId}/projects/${projectId}/workflows`
      )
      .then((r) => r.data.workflows),
  get: (orgId: string, workflowId: string) =>
    apiClient
      .get<{ workflow: Workflow; nodes: WorkflowNode[]; edges: WorkflowEdge[] }>(
        `/api/orgs/${orgId}/workflows/${workflowId}`
      )
      .then((r) => r.data),
  update: (
    orgId: string,
    workflowId: string,
    data: Partial<CreateWorkflowRequest>
  ) =>
    apiClient
      .patch<Workflow>(`/api/orgs/${orgId}/workflows/${workflowId}`, data)
      .then((r) => r.data),
  upsertGraph: (orgId: string, workflowId: string, data: UpsertGraphRequest) =>
    apiClient
      .put(`/api/orgs/${orgId}/workflows/${workflowId}/graph`, data)
      .then((r) => r.data),
  validate: (orgId: string, workflowId: string) =>
    apiClient
      .post<{ valid: boolean; errors: string[] }>(
        `/api/orgs/${orgId}/workflows/${workflowId}/validate`
      )
      .then((r) => r.data),
  publish: (orgId: string, workflowId: string) =>
    apiClient
      .post<Workflow>(`/api/orgs/${orgId}/workflows/${workflowId}/publish`)
      .then((r) => r.data),
};

// ─── Runs ─────────────────────────────────────────────────────────────────────

export const runsApi = {
  trigger: (orgId: string, workflowId: string) =>
    apiClient
      .post<WorkflowRun>(`/api/orgs/${orgId}/workflows/${workflowId}/run`)
      .then((r) => r.data),
  list: (orgId: string, workflowId: string, limit = 20, offset = 0) =>
    apiClient
      .get<{ runs: WorkflowRun[] }>(
        `/api/orgs/${orgId}/workflows/${workflowId}/runs?limit=${limit}&offset=${offset}`
      )
      .then((r) => r.data.runs),
  get: (orgId: string, runId: string) =>
    apiClient
      .get<WorkflowRun>(`/api/orgs/${orgId}/runs/${runId}`)
      .then((r) => r.data),
  getSteps: (orgId: string, runId: string) =>
    apiClient
      .get<{ steps: RunStep[] }>(`/api/orgs/${orgId}/runs/${runId}/steps`)
      .then((r) => r.data.steps),
  getLogs: (orgId: string, runId: string, stepId?: string) =>
    apiClient
      .get<{ logs: LogEntry[] }>(
        `/api/orgs/${orgId}/runs/${runId}/logs${stepId ? `?step_id=${stepId}` : ""}`
      )
      .then((r) => r.data.logs),
  cancel: (orgId: string, runId: string) =>
    apiClient
      .post<WorkflowRun>(`/api/orgs/${orgId}/runs/${runId}/cancel`)
      .then((r) => r.data),
  retry: (orgId: string, runId: string) =>
    apiClient
      .post<WorkflowRun>(`/api/orgs/${orgId}/runs/${runId}/retry`)
      .then((r) => r.data),
  streamUrl: (orgId: string, runId: string) =>
    `${BASE_URL}/api/orgs/${orgId}/runs/${runId}/stream`,
};
