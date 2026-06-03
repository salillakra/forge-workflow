"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import { ArrowUpDown, Play, ChevronUp, ChevronDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/store/auth";
import { runsApi, projectsApi, workflowsApi } from "@/lib/api";
import { getStatusBg, getStatusDot, timeAgo, duration } from "@/lib/helpers";
import type { WorkflowRun } from "@/types";

const col = createColumnHelper<WorkflowRun>();

const columns = [
  col.accessor("status", {
    header: "Status",
    cell: (info) => (
      <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border", getStatusBg(info.getValue()))}>
        <span className={cn("w-1.5 h-1.5 rounded-full", getStatusDot(info.getValue()))} />
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor("id", {
    header: "Run ID",
    cell: (info) => (
      <Link href={`/runs/${info.getValue()}`} className="font-mono text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors">
        {info.getValue().slice(0, 8)}…
      </Link>
    ),
  }),
  col.accessor("trigger_type", {
    header: "Trigger",
    cell: (info) => <span className="capitalize text-xs text-[hsl(var(--muted-foreground))]">{info.getValue()}</span>,
  }),
  col.accessor("started_at", {
    header: ({ column }) => (
      <button className="flex items-center gap-1 text-xs" onClick={() => column.toggleSorting()}>
        Duration
        {column.getIsSorted() === "asc" ? <ChevronUp className="w-3 h-3" /> :
         column.getIsSorted() === "desc" ? <ChevronDown className="w-3 h-3" /> :
         <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    ),
    cell: (info) => (
      <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
        {duration(info.getValue(), info.row.original.finished_at)}
      </span>
    ),
    sortingFn: (a, b) => {
      const aMs = a.original.started_at ? new Date(a.original.started_at).getTime() : 0;
      const bMs = b.original.started_at ? new Date(b.original.started_at).getTime() : 0;
      return aMs - bMs;
    },
  }),
  col.accessor("created_at", {
    header: ({ column }) => (
      <button className="flex items-center gap-1 text-xs" onClick={() => column.toggleSorting()}>
        Started
        {column.getIsSorted() === "asc" ? <ChevronUp className="w-3 h-3" /> :
         column.getIsSorted() === "desc" ? <ChevronDown className="w-3 h-3" /> :
         <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    ),
    cell: (info) => <span className="text-xs text-[hsl(var(--muted-foreground))]">{timeAgo(info.getValue())}</span>,
    sortingFn: "datetime",
  }),
];

export default function RunsPage() {
  const router = useRouter();
  const { currentOrg } = useAuthStore();
  const orgId = currentOrg?.id ?? "";
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);

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

  // Fetch runs for every workflow, then flatten + sort
  const workflowIds = workflows.map((w) => w.id);
  const { data: rawRuns, isLoading } = useQuery({
    queryKey: ["runs-all", orgId, workflowIds],
    queryFn: async () => {
      const results = await Promise.all(
        workflowIds.map((wid) => runsApi.list(orgId, wid, 100))
      );
      return results
        .flat()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    enabled: !!orgId && workflowIds.length > 0,
    refetchInterval: 10_000,
  });
  const runs = rawRuns || [];

  const table = useReactTable({
    data: runs,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // Summary badges
  const summary = useMemo(() => ({
    total:   runs.length,
    running: runs.filter((r) => r.status === "running").length,
    success: runs.filter((r) => r.status === "success").length,
    failed:  runs.filter((r) => r.status === "failed").length,
  }), [runs]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-[hsl(var(--accent))] flex items-center justify-center">
            <Play className="w-4 h-4 text-[hsl(var(--primary))]" />
          </div>
          <h1 className="text-2xl font-bold">Runs</h1>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))] ml-12">
          All workflow execution history · auto-refreshes every 10s
        </p>
      </motion.div>

      {/* Summary chips */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline">{summary.total} total</Badge>
        {summary.running > 0 && (
          <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse">
            {summary.running} running
          </Badge>
        )}
        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
          {summary.success} succeeded
        </Badge>
        {summary.failed > 0 && (
          <Badge className="bg-red-500/10 text-red-400 border-red-500/20">
            {summary.failed} failed
          </Badge>
        )}
      </div>

      {/* Filter */}
      <Input
        placeholder="Filter runs by status, ID, trigger…"
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        className="max-w-sm"
      />

      {/* TanStack Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-[hsl(var(--muted)/0.5)] hover:bg-[hsl(var(--muted)/0.5)]">
                  {hg.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center py-16 text-[hsl(var(--muted-foreground))] text-sm">
                    {runs.length === 0 ? "No runs yet." : "No runs match your filter."}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="hover:bg-[hsl(var(--muted)/0.3)] transition-colors cursor-pointer"
                    onClick={() => router.push(`/runs/${row.original.id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
