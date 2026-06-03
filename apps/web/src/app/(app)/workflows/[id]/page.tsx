"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Play,
  Upload,
  CheckCircle,
  AlertCircle,
  GitBranch,
  Clock,
  ArrowLeft,
  Loader2,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/store/auth";
import { workflowsApi, runsApi } from "@/lib/api";
import { getStatusBg, timeAgo, duration } from "@/lib/helpers";
import { DagViewer } from "@/components/dag/dag-viewer";
import { RunsTable } from "@/components/runs/runs-table";

export default function WorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;
  const { currentOrg } = useAuthStore();
  const orgId = currentOrg?.id ?? "";
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["workflow", orgId, workflowId],
    queryFn: () => workflowsApi.get(orgId, workflowId),
    enabled: !!orgId && !!workflowId,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ["runs", orgId, workflowId],
    queryFn: () => runsApi.list(orgId, workflowId, 10),
    enabled: !!orgId && !!workflowId,
    refetchInterval: 10_000,
  });

  const publishMutation = useMutation({
    mutationFn: () => workflowsApi.publish(orgId, workflowId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", orgId, workflowId] });
      toast.success("Workflow published!");
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? "Failed to publish");
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => workflowsApi.validate(orgId, workflowId),
    onSuccess: (result) => {
      if (result.valid) toast.success("DAG is valid ✓");
      else toast.error(`Validation failed: ${result.errors.join(", ")}`);
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => runsApi.trigger(orgId, workflowId),
    onSuccess: (run) => {
      toast.success("Run started!");
      qc.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${run.id}`);
    },
    onError: () => toast.error("Failed to trigger run"),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const wf = data?.workflow;
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
        <Link href="/workflows" className="hover:text-[hsl(var(--foreground))] flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Workflows
        </Link>
        <span>/</span>
        <span className="text-[hsl(var(--foreground))]">{wf?.name}</span>
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center gap-4"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[hsl(var(--accent))] flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-[hsl(var(--primary))]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{wf?.name}</h1>
              {wf?.description && (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{wf.description}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={wf?.status === "published"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-slate-500/10 text-slate-400 border-slate-500/20"}>
            {wf?.status}
          </Badge>
          <Badge variant="outline" className="text-xs">v{wf?.version}</Badge>

          <Button
            variant="outline"
            size="sm"
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending}
          >
            {validateMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
            Validate
          </Button>

          {wf?.status !== "published" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Upload className="w-3.5 h-3.5 mr-1" />}
              Publish
            </Button>
          )}

          {wf?.status === "published" && (
            <Button
              size="sm"
              className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] glow-primary"
              onClick={() => triggerMutation.mutate()}
              disabled={triggerMutation.isPending}
            >
              {triggerMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Play className="w-3.5 h-3.5 mr-1.5" />}
              Run now
            </Button>
          )}
        </div>
      </motion.div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="dag">
        <TabsList className="bg-[hsl(var(--muted))]">
          <TabsTrigger value="dag">DAG Builder</TabsTrigger>
          <TabsTrigger value="runs">Run History</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dag" className="mt-4">
          <Card className="glass">
            <CardContent className="p-0">
              <DagViewer key={workflowId} nodes={nodes} edges={edges} workflowId={workflowId} orgId={orgId} readOnly={wf?.status === "published"} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <RunsTable runs={runs} orgId={orgId} isLoading={runsLoading} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="w-4 h-4" />Workflow settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[hsl(var(--muted-foreground))] text-xs">Trigger type</p>
                  <p className="capitalize font-medium">{wf?.trigger_type}</p>
                </div>
                {wf?.cron_expr && (
                  <div>
                    <p className="text-[hsl(var(--muted-foreground))] text-xs">Schedule</p>
                    <p className="font-mono text-xs">{wf.cron_expr}</p>
                  </div>
                )}
                <div>
                  <p className="text-[hsl(var(--muted-foreground))] text-xs">Created</p>
                  <p>{wf?.created_at ? timeAgo(wf.created_at) : "—"}</p>
                </div>
                <div>
                  <p className="text-[hsl(var(--muted-foreground))] text-xs">Last updated</p>
                  <p>{wf?.updated_at ? timeAgo(wf.updated_at) : "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
