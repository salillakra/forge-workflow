"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { format, subDays, startOfDay } from "date-fns";
import { Settings, Users, GitBranch, Activity, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuthStore } from "@/store/auth";
import { orgsApi, runsApi, workflowsApi, projectsApi } from "@/lib/api";
import { initials, capitalize } from "@/lib/helpers";

export default function SettingsPage() {
  const { user, currentOrg } = useAuthStore();
  const orgId = currentOrg?.id ?? "";

  const { data: rawMembers, isLoading: membersLoading } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => orgsApi.listMembers(orgId),
    enabled: !!orgId,
  });
  const members = rawMembers || [];

  const { data: rawProjects } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => projectsApi.list(orgId),
    enabled: !!orgId,
  });
  const projects = rawProjects || [];
  const projectId = projects?.[0]?.id ?? "";

  const { data: rawWorkflows } = useQuery({
    queryKey: ["workflows", orgId, projectId],
    queryFn: () => workflowsApi.list(orgId, projectId),
    enabled: !!orgId && !!projectId,
  });
  const workflows = rawWorkflows || [];
  const workflowId = workflows?.[0]?.id ?? "";

  const { data: rawRuns, isLoading: runsLoading } = useQuery({
    queryKey: ["runs", orgId, workflowId],
    queryFn: () => runsApi.list(orgId, workflowId, 200),
    enabled: !!orgId && !!workflowId,
  });
  const runs = rawRuns || [];

  // Build 7-day run trend for recharts
  const chartData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = startOfDay(subDays(new Date(), 6 - i));
      return { date: format(d, "MMM d"), ts: d.getTime(), success: 0, failed: 0, total: 0 };
    });
    runs.forEach((r) => {
      const d = startOfDay(new Date(r.created_at)).getTime();
      const bucket = days.find((b) => b.ts === d);
      if (bucket) {
        bucket.total++;
        if (r.status === "success") bucket.success++;
        if (r.status === "failed")  bucket.failed++;
      }
    });
    return days;
  }, [runs]);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-[hsl(var(--accent))] flex items-center justify-center">
            <Settings className="w-4 h-4 text-[hsl(var(--primary))]" />
          </div>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))] ml-12">
          Workspace configuration, members, and usage metrics
        </p>
      </motion.div>

      {/* Profile */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[hsl(var(--primary))]" />
            Your account
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar className="w-12 h-12">
            <AvatarFallback className="bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] text-lg font-bold">
              {user ? initials(user.display_name) : "?"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold">{user?.display_name}</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{user?.email}</p>
          </div>
        </CardContent>
      </Card>

      {/* Workspace */}
      {currentOrg && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-[hsl(var(--primary))]" />
              Workspace
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">Name</p>
              <p className="font-medium">{currentOrg.name}</p>
            </div>
            <div>
              <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">Slug</p>
              <p className="font-mono text-sm">{currentOrg.slug}</p>
            </div>
            <div>
              <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">Plan</p>
              <Badge variant="outline" className="capitalize">{currentOrg.plan}</Badge>
            </div>
            <div>
              <p className="text-[hsl(var(--muted-foreground))] text-xs mb-1">Workspace ID</p>
              <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{currentOrg.id.slice(0, 16)}…</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Run trend — Recharts */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-[hsl(var(--primary))]" />
            Run activity — last 7 days
          </CardTitle>
          <CardDescription className="text-xs">Success and failure trend</CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(0 84% 60%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 16%)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(222 47% 9%)",
                    border: "1px solid hsl(222 35% 16%)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "hsl(213 31% 91%)",
                  }}
                  cursor={{ stroke: "hsl(263 90% 65% / 0.3)" }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="success" stroke="hsl(142 71% 45%)" strokeWidth={1.5} fill="url(#gSuccess)" name="Success" />
                <Area type="monotone" dataKey="failed"  stroke="hsl(0 84% 60%)"   strokeWidth={1.5} fill="url(#gFailed)"  name="Failed" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-[hsl(var(--primary))]" />
            Team members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No members found.</p>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="text-xs bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
                        {m.user_id.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <p className="text-sm font-mono text-[hsl(var(--muted-foreground))]">
                      {m.user_id.slice(0, 12)}…
                    </p>
                  </div>
                  <Badge
                    className={
                      m.role === "owner" ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" :
                      m.role === "admin" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                      "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    }
                  >
                    {capitalize(m.role)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
