import { type RunStatus, type StepStatus } from "@/types";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";

// ─── Status helpers ───────────────────────────────────────────────────────────

export function getStatusColor(status: RunStatus | StepStatus | string): string {
  switch (status) {
    case "success":
      return "text-emerald-400";
    case "failed":
      return "text-red-400";
    case "running":
      return "text-amber-400";
    case "queued":
    case "pending":
      return "text-slate-400";
    case "cancelled":
    case "skipped":
      return "text-slate-500";
    default:
      return "text-slate-400";
  }
}

export function getStatusBg(status: RunStatus | StepStatus | string): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "failed":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "running":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "queued":
    case "pending":
      return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    case "cancelled":
    case "skipped":
      return "bg-slate-600/10 text-slate-500 border-slate-600/20";
    default:
      return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
}

export function getStatusDot(status: RunStatus | StepStatus | string): string {
  switch (status) {
    case "success":
      return "bg-emerald-400";
    case "failed":
      return "bg-red-400";
    case "running":
      return cn("bg-amber-400", "animate-pulse");
    case "queued":
    case "pending":
      return "bg-slate-400";
    case "cancelled":
    case "skipped":
      return "bg-slate-600";
    default:
      return "bg-slate-400";
  }
}

export function isTerminal(status: string): boolean {
  return ["success", "failed", "cancelled", "skipped"].includes(status);
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

export function timeAgo(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function formatDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), "MMM d, yyyy HH:mm:ss");
  } catch {
    return dateStr;
  }
}

export function duration(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const ms = e.getTime() - s.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ─── Log level color ──────────────────────────────────────────────────────────
export function logLevelColor(level: string): string {
  switch (level) {
    case "error":  return "text-red-400";
    case "warn":   return "text-amber-400";
    case "info":   return "text-sky-400";
    case "debug":  return "text-slate-500";
    default:       return "text-slate-400";
  }
}
