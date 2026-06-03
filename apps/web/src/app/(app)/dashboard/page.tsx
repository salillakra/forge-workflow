"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  GitBranch,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  Zap,
  ArrowRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/store/auth";
import { workflowsApi, runsApi, projectsApi } from "@/lib/api";
import { getStatusBg, timeAgo, duration } from "@/lib/helpers";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: "easeOut" as const },
};

export default function DashboardPage() {
  const { currentOrg, user } = useAuthStore();
  const orgId = currentOrg?.id ?? "";

  const { data: rawProjects, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => projectsApi.list(orgId),
    enabled: !!orgId,
  });
  const projects = rawProjects || [];

  const projectId = projects?.[0]?.id ?? "";

  const { data: rawWorkflows, isLoading: wfLoading } = useQuery({
    queryKey: ["workflows", orgId, projectId],
    queryFn: () => workflowsApi.list(orgId, projectId),
    enabled: !!orgId && !!projectId,
  });
  const workflows = rawWorkflows || [];

  const workflowId = workflows?.[0]?.id ?? "";

  const { data: rawRecentRuns, isLoading: runsLoading } = useQuery({
    queryKey: ["runs", orgId, workflowId],
    queryFn: () => runsApi.list(orgId, workflowId, 5),
    enabled: !!orgId && !!workflowId,
    refetchInterval: 10_000,
  });
  const recentRuns = rawRecentRuns || [];

  const successRuns = recentRuns.filter((r) => r.status === "success").length;
  const failedRuns = recentRuns.filter((r) => r.status === "failed").length;
  const runningRuns = recentRuns.filter((r) => r.status === "running").length;

  const stats = [
    {
      label: "Workflows",
      value: workflows.length,
      icon: GitBranch,
      color: "text-violet-400",
    },
    {
      label: "Recent Runs",
      value: recentRuns.length,
      icon: Play,
      color: "text-sky-400",
    },
    {
      label: "Successful",
      value: successRuns,
      icon: CheckCircle2,
      color: "text-emerald-400",
    },
    {
      label: "Failed",
      value: failedRuns,
      icon: XCircle,
      color: "text-red-400",
    },
  ];

  const loading = projectsLoading || wfLoading || runsLoading;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div {...fadeUp}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Good {getGreeting()},{" "}
              <span className="text-primary text-xl">
                {user?.display_name?.split(" ")[0]}
              </span>
            </h1>
            <p className="text-[hsl(var(--muted-foreground))] text-sm mt-1">
              {currentOrg
                ? `Workspace: ${currentOrg.name}`
                : "Select a workspace from the sidebar to get started"}
            </p>
          </div>
          {currentOrg && (
            <div className="flex gap-2">
              <Link href="/workflows/new">
                <Button variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Workflow
                </Button>
              </Link>
            </div>
          )}
        </div>
      </motion.div>

      {!currentOrg ? (
        <EmptyState />
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07, duration: 0.35 }}
              >
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                        {stat.label}
                      </p>
                      <stat.icon className={`w-4 h-4 ${stat.color}`} />
                    </div>
                    {loading ? (
                      <Skeleton className="h-7 w-12 mt-2" />
                    ) : (
                      <p className="text-2xl font-bold mt-1">{stat.value}</p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent Runs */}
            <motion.div
              {...fadeUp}
              transition={{ delay: 0.2 }}
              className="lg:col-span-2"
            >
              <Card className="glass">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[hsl(var(--primary))]" />
                    Recent Runs
                    {runningRuns > 0 && (
                      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs animate-pulse">
                        {runningRuns} running
                      </Badge>
                    )}
                  </CardTitle>
                  <Link
                    href="/runs"
                    className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-1"
                  >
                    View all <ArrowRight className="w-3 h-3" />
                  </Link>
                </CardHeader>
                <CardContent className="space-y-2">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))
                  ) : recentRuns.length === 0 ? (
                    <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">
                      No runs yet. Trigger one from a workflow.
                    </p>
                  ) : (
                    recentRuns.map((run) => (
                      <Link key={run.id} href={`/runs/${run.id}`}>
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer group">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBg(run.status)}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {run.status}
                          </span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))] truncate flex-1 font-mono">
                            {run.id.slice(0, 8)}…
                          </span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            {duration(run.started_at, run.finished_at)}
                          </span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            {timeAgo(run.created_at)}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Workflows */}
            <motion.div {...fadeUp} transition={{ delay: 0.25 }}>
              <Card className="glass">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[hsl(var(--primary))]" />
                    Workflows
                  </CardTitle>
                  <Link
                    href="/workflows"
                    className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-1"
                  >
                    View all <ArrowRight className="w-3 h-3" />
                  </Link>
                </CardHeader>
                <CardContent className="space-y-2">
                  {wfLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))
                  ) : workflows.length === 0 ? (
                    <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">
                      No workflows yet.
                    </p>
                  ) : (
                    workflows.slice(0, 5).map((wf) => (
                      <Link key={wf.id} href={`/workflows/${wf.id}`}>
                        <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer">
                          <GitBranch className="w-3.5 h-3.5 text-[hsl(var(--primary))] shrink-0" />
                          <span className="text-sm truncate flex-1">
                            {wf.name}
                          </span>
                          <Badge
                            className={`text-[10px] px-1.5 py-0 ${
                              wf.status === "published"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                            }`}
                          >
                            {wf.status}
                          </Badge>
                        </div>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--accent))] flex items-center justify-center mb-4 glow-primary">
        <Zap className="w-8 h-8 text-[hsl(var(--primary))]" />
      </div>
      <h2 className="text-xl font-bold mb-2">No workspace selected</h2>
      <p className="text-[hsl(var(--muted-foreground))] text-sm max-w-sm mb-6">
        Create or select an organization from the sidebar to start building
        workflows.
      </p>
      <Link href="/orgs/new">
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Create workspace
        </Button>
      </Link>
    </motion.div>
  );
}
