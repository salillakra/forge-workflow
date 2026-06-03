"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  XCircle,
  Loader2,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/store/auth";
import { runsApi, workflowsApi } from "@/lib/api";
import {
  getStatusBg,
  getStatusDot,
  duration,
  formatDate,
  logLevelColor,
  isTerminal,
} from "@/lib/helpers";
import { DagViewer } from "@/components/dag/dag-viewer";
import { cn } from "@/lib/utils";
import type { LogEntry, RunStep } from "@/types";

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const { currentOrg } = useAuthStore();
  const orgId = currentOrg?.id ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ["run", orgId, runId],
    queryFn: () => runsApi.get(orgId, runId),
    enabled: !!orgId && !!runId,
    refetchInterval: 3_000,
  });

  const { data: stepsRaw, isLoading: stepsLoading } = useQuery({
    queryKey: ["run-steps", orgId, runId],
    queryFn: () => runsApi.getSteps(orgId, runId),
    enabled: !!orgId && !!runId,
    refetchInterval: run && isTerminal(run.status) ? false : 3_000,
  });

  const { data: logsRaw } = useQuery({
    queryKey: ["run-logs", orgId, runId],
    queryFn: () => runsApi.getLogs(orgId, runId),
    enabled: !!orgId && !!runId && !!run,
    refetchInterval: run && isTerminal(run.status) ? false : 2_000,
  });

  const { data: wfData } = useQuery({
    queryKey: ["workflow-for-run", orgId, run?.workflow_id],
    queryFn: () => workflowsApi.get(orgId, run!.workflow_id),
    enabled: !!orgId && !!run?.workflow_id,
  });

  // ── Derived values (must come before any hooks that use them) ──────────────
  const steps: RunStep[] = stepsRaw ?? [];
  const logs: LogEntry[] = logsRaw ?? [];

  const completedSteps = steps.filter((s) => s.status === "success").length;
  const totalSteps = steps.length;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const stepStatusMap = Object.fromEntries(
    steps
      .map((s) => {
        const node = wfData?.nodes?.find((n) => n.id === s.node_id);
        return node ? [node.id, s.status] : null;
      })
      .filter(Boolean) as [string, string][]
  );

  const displayLogs = [...logs, ...liveLogs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // ── Effects ────────────────────────────────────────────────────────────────
  // SSE live stream
  useEffect(() => {
    if (!orgId || !runId || !run || isTerminal(run.status)) return;
    const url = runsApi.streamUrl(orgId, runId);
    const token = localStorage.getItem("forge_access_token");
    const evtSrc = new EventSource(`${url}${token ? `?token=${token}` : ""}`);

    evtSrc.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.message) {
          setLiveLogs((prev) => [
            ...prev.slice(-500),
            {
              id: Date.now(),
              run_id: runId,
              step_id: payload.step_id,
              timestamp: payload.time ?? new Date().toISOString(),
              level: payload.level ?? "info",
              message: payload.message,
              metadata: {},
            },
          ]);
        }
        if (payload.status) {
          qc.invalidateQueries({ queryKey: ["run", orgId, runId] });
          qc.invalidateQueries({ queryKey: ["run-steps", orgId, runId] });
        }
      } catch {
        /* ignore parse errors */
      }
    };

    return () => evtSrc.close();
  }, [orgId, runId, run, qc]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveLogs, logs]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: () => runsApi.cancel(orgId, runId),
    onSuccess: () => {
      toast.success("Run cancelled");
      qc.invalidateQueries({ queryKey: ["run", orgId, runId] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => runsApi.retry(orgId, runId),
    onSuccess: (newRun) => {
      toast.success("Retry triggered!");
      router.push(`/runs/${newRun.id}`);
    },
  });

  // ── Loading state ──────────────────────────────────────────────────────────
  if (runLoading) {
    return (
      <div className="space-y-4 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
        <Link href="/runs" className="hover:text-[hsl(var(--foreground))] flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Runs
        </Link>
        <span>/</span>
        <span className="font-mono text-xs text-[hsl(var(--foreground))]">{runId.slice(0, 8)}…</span>
      </div>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium border",
                  run ? getStatusBg(run.status) : ""
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", run ? getStatusDot(run.status) : "")} />
                {run?.status}
              </span>
              <span className="text-[hsl(var(--muted-foreground))] text-sm capitalize">
                {run?.trigger_type} trigger
              </span>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Started {run?.started_at ? formatDate(run.started_at) : "—"} ·
              Duration: {duration(run?.started_at, run?.finished_at)}
            </p>
          </div>

          <div className="flex gap-2">
            {run && !isTerminal(run.status) && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <XCircle className="w-3.5 h-3.5 mr-1" />}
                Cancel
              </Button>
            )}
            {run && isTerminal(run.status) && run.status !== "success" && (
              <Button
                size="sm"
                className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
              >
                {retryMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                Retry
              </Button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {totalSteps > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
              <span>{completedSteps}/{totalSteps} steps complete</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
      </motion.div>

      <Separator />

      {/* Steps overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stepsLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)
          : steps.map((step) => (
              <StepCard key={step.id} step={step} nodes={wfData?.nodes ?? []} />
            ))}
      </div>

      <Tabs defaultValue="dag">
        <TabsList className="bg-[hsl(var(--muted))]">
          <TabsTrigger value="dag">DAG View</TabsTrigger>
          <TabsTrigger value="logs">
            Logs
            {!isTerminal(run?.status ?? "") && (
              <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dag" className="mt-4">
          <Card className="glass">
            <CardContent className="p-0">
              {wfData ? (
                <DagViewer
                  nodes={wfData.nodes}
                  edges={wfData.edges}
                  workflowId={run?.workflow_id ?? ""}
                  orgId={orgId}
                  stepStatuses={stepStatusMap}
                  readOnly
                />
              ) : (
                <Skeleton className="h-64 w-full rounded-lg" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card className="glass">
            <CardHeader className="pb-2 flex flex-row items-center gap-2">
              <Terminal className="w-4 h-4 text-[hsl(var(--primary))]" />
              <CardTitle className="text-sm">Execution logs</CardTitle>
              {!isTerminal(run?.status ?? "") && (
                <Badge className="ml-auto bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs animate-pulse">
                  Live
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <div className="log-panel bg-[hsl(222_47%_5%)] rounded-md p-4 h-100 overflow-y-auto text-xs space-y-0.5">
                {displayLogs.length === 0 ? (
                  <p className="text-[hsl(var(--muted-foreground))]">Waiting for logs…</p>
                ) : (
                  displayLogs.map((log, i) => (
                    <div key={i} className="flex gap-3 hover:bg-white/5 px-1 py-0.5 rounded">
                      <span className="text-[hsl(var(--muted-foreground))] shrink-0 select-none">
                        {new Date(log.timestamp).toTimeString().slice(0, 8)}
                      </span>
                      <span className={cn("shrink-0 w-10 uppercase font-bold", logLevelColor(log.level))}>
                        {log.level}
                      </span>
                      <span className="text-[hsl(var(--foreground)/0.85)] break-all">{log.message}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StepCard({
  step,
  nodes,
}: {
  step: RunStep;
  nodes: { id: string; name: string; type: string }[];
}) {
  const node = nodes.find((n) => n.id === step.node_id);
  return (
    <Card
      className={cn(
        "glass transition-colors",
        step.status === "running" && "border-amber-500/40",
        step.status === "success" && "border-emerald-500/30",
        step.status === "failed" && "border-red-500/30"
      )}
    >
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium truncate">{node?.name ?? "Step"}</span>
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full border font-medium",
              getStatusBg(step.status)
            )}
          >
            {step.status}
          </span>
        </div>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
          Attempt {step.attempt} · {duration(step.started_at, step.finished_at)}
        </p>
        {step.error_message && (
          <p className="text-[10px] text-red-400 truncate">{step.error_message}</p>
        )}
      </CardContent>
    </Card>
  );
}
