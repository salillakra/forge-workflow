"use client";

import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getStatusBg, getStatusDot, timeAgo, duration } from "@/lib/helpers";
import type { WorkflowRun } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  runs: WorkflowRun[];
  orgId: string;
  isLoading?: boolean;
}

export function RunsTable({ runs, orgId, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const safeRuns = runs ?? [];

  if (safeRuns.length === 0) {
    return (
      <div className="text-center py-16 text-[hsl(var(--muted-foreground))] text-sm">
        No runs yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-[hsl(var(--muted)/0.5)] hover:bg-[hsl(var(--muted)/0.5)]">
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Run ID</TableHead>
            <TableHead className="text-xs">Trigger</TableHead>
            <TableHead className="text-xs">Duration</TableHead>
            <TableHead className="text-xs">Started</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {safeRuns.map((run) => (
            <TableRow
              key={run.id}
              className="hover:bg-[hsl(var(--muted)/0.3)] cursor-pointer transition-colors"
            >
              <TableCell>
                <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border", getStatusBg(run.status))}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", getStatusDot(run.status))} />
                  {run.status}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
                <Link href={`/runs/${run.id}`} className="hover:text-[hsl(var(--foreground))] transition-colors">
                  {run.id.slice(0, 8)}…
                </Link>
              </TableCell>
              <TableCell className="text-xs capitalize text-[hsl(var(--muted-foreground))]">
                {run.trigger_type}
              </TableCell>
              <TableCell className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                {duration(run.started_at, run.finished_at)}
              </TableCell>
              <TableCell className="text-xs text-[hsl(var(--muted-foreground))]">
                {timeAgo(run.created_at)}
              </TableCell>
              <TableCell>
                <Link href={`/runs/${run.id}`}>
                  <ArrowRight className="w-4 h-4 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
