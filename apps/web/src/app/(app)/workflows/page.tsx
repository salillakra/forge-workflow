"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Plus,
  GitBranch,
  Play,
  ArrowRight,
  Upload,
  Loader2,
  Search,
  Filter,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/store/auth";
import { workflowsApi, projectsApi, runsApi } from "@/lib/api";
import { timeAgo, getStatusBg } from "@/lib/helpers";
import type { Workflow } from "@/types";

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  trigger_type: z.enum(["manual", "schedule", "webhook", "api"]),
  cron_expr: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

export default function WorkflowsPage() {
  const { currentOrg } = useAuthStore();
  const orgId = currentOrg?.id ?? "";
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => projectsApi.list(orgId),
    enabled: !!orgId,
  });
  const projectId = projects?.[0]?.id ?? "";

  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ["workflows", orgId, projectId],
    queryFn: () => workflowsApi.list(orgId, projectId),
    enabled: !!orgId && !!projectId,
  });

  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { trigger_type: "manual" },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateForm) =>
      workflowsApi.create(orgId, projectId, data),
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Workflow created!");
      reset();
      setOpen(false);
      router.push(`/workflows/${wf.id}`);
    },
    onError: () => toast.error("Failed to create workflow"),
  });

  const createProjectMutation = useMutation({
    mutationFn: () => projectsApi.create(orgId, { name: "Default Project", description: "Default project" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Default project created!");
    },
    onError: () => toast.error("Failed to create project"),
  });

  const triggerMutation = useMutation({
    mutationFn: (workflowId: string) => runsApi.trigger(orgId, workflowId),
    onSuccess: (run) => {
      toast.success("Run triggered!");
      qc.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${run.id}`);
    },
    onError: () => toast.error("Failed to trigger run"),
  });

  const triggerType = watch("trigger_type");

  const safeWorkflows = workflows || [];
  const filtered = safeWorkflows.filter((wf) => {
    const matchSearch = wf.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || wf.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
            Define and manage your workflow DAGs
          </p>
        </div>
        {projectId ? (
          <Button
            className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] glow-primary"
            onClick={() => setOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" /> New workflow
          </Button>
        ) : (
          <Button
            className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] glow-primary"
            onClick={() => createProjectMutation.mutate()}
            disabled={createProjectMutation.isPending}
          >
            <Plus className="w-4 h-4 mr-2" /> Initialize Project
          </Button>
        )}
      </div>

      {/* Create Workflow Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create workflow</DialogTitle>
            <DialogDescription>
              Define a new workflow DAG. You can add steps after creation.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="My workflow" {...register("name")} />
              {errors.name && <p className="text-xs text-[hsl(var(--destructive))]">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="Optional description" {...register("description")} />
            </div>
            <div className="space-y-2">
              <Label>Trigger</Label>
              <Select defaultValue="manual" onValueChange={(v) => setValue("trigger_type", v as CreateForm["trigger_type"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="schedule">Schedule (cron)</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {triggerType === "schedule" && (
              <div className="space-y-2">
                <Label>Cron expression</Label>
                <Input placeholder="0 */6 * * *" {...register("cron_expr")} />
              </div>
            )}
            <Button type="submit" className="w-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" disabled={createMutation.isPending}>
              {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Create workflow"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <Input
            placeholder="Search workflows…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="bg-[hsl(var(--muted))]">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <GitBranch className="w-10 h-10 text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-[hsl(var(--muted-foreground))]">
            {search ? "No workflows match your search" : "No workflows yet — create one to get started"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((wf, i) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              index={i}
              onTrigger={() => triggerMutation.mutate(wf.id)}
              isTriggering={triggerMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({
  workflow,
  index,
  onTrigger,
  isTriggering,
}: {
  workflow: Workflow;
  index: number;
  onTrigger: () => void;
  isTriggering: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="h-full"
    >
      <Card className="glass h-full flex flex-col justify-between hover:border-[hsl(var(--primary)/0.4)] transition-colors group">
        <CardHeader className="pb-3 flex-1 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-md bg-[hsl(var(--accent))] flex items-center justify-center shrink-0">
                <GitBranch className="w-4 h-4 text-[hsl(var(--primary))]" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{workflow.name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">v{workflow.version}</p>
              </div>
            </div>
            <Badge className={`text-[10px] shrink-0 ${workflow.status === "published"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-slate-500/10 text-slate-400 border-slate-500/20"}`}>
              {workflow.status}
            </Badge>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2 line-clamp-2 flex-grow">
            {workflow.description || <span className="text-[hsl(var(--muted-foreground)/0.4)] italic">No description provided</span>}
          </p>
        </CardHeader>
        <CardContent className="pt-0 mt-auto">
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] mb-3">
            <span className="capitalize">{workflow.trigger_type}</span>
            {workflow.cron_expr && (
              <span className="font-mono text-[10px] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded">
                {workflow.cron_expr}
              </span>
            )}
            <span className="ml-auto">{timeAgo(workflow.updated_at)}</span>
          </div>
          <div className="flex gap-2">
            <Link href={`/workflows/${workflow.id}`} className="flex-grow flex">
              <Button variant="outline" size="sm" className="w-full text-xs flex-1">
                View <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
            {workflow.status === "published" && (
              <Button
                size="sm"
                className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-xs shrink-0"
                onClick={onTrigger}
                disabled={isTriggering}
              >
                {isTriggering ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
