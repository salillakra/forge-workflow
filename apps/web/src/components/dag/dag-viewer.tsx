/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeTypes,
  Panel,
  useNodesState,
  useEdgesState,
  MarkerType,
  addEdge,
  Handle,
  Position,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Webhook, Terminal, Bell, CheckSquare, RotateCcw, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNode, WorkflowEdge, StepStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { workflowsApi } from "@/lib/api";
import type { UpsertGraphRequest } from "@/types";

// ─── Status helpers ───────────────────────────────────────────────────────────

const statusStyles: Record<string, string> = {
  success: "border-emerald-500/60 shadow-[0_0_12px_hsl(142_71%_45%/0.25)]",
  failed:  "border-red-500/60   shadow-[0_0_12px_hsl(0_84%_60%/0.25)]",
  running: "border-amber-500/60  shadow-[0_0_12px_hsl(38_92%_55%/0.3)] animate-pulse",
  queued:  "border-slate-500/40",
  pending: "border-slate-500/30",
  skipped: "border-slate-600/30 opacity-60",
};

const statusDot: Record<string, string> = {
  success: "bg-emerald-400",
  failed:  "bg-red-400",
  running: "bg-amber-400 animate-pulse",
  queued:  "bg-slate-400",
  pending: "bg-slate-500",
  skipped: "bg-slate-600",
};

const typeColors: Record<string, { border: string; icon: string; bg: string }> = {
  task:    { border: "border-violet-500/30", icon: "text-violet-400", bg: "bg-violet-500/8" },
  webhook: { border: "border-sky-500/30",    icon: "text-sky-400",    bg: "bg-sky-500/8"    },
  script:  { border: "border-fuchsia-500/30",icon: "text-fuchsia-400",bg: "bg-fuchsia-500/8"},
  notify:  { border: "border-amber-500/30",  icon: "text-amber-400",  bg: "bg-amber-500/8"  },
};

const TypeIcon = ({ type, className }: { type: string; className?: string }) => {
  const cls = cn("w-3.5 h-3.5", typeColors[type]?.icon ?? "text-slate-400", className);
  switch (type) {
    case "webhook": return <Webhook className={cls} />;
    case "script":  return <Terminal className={cls} />;
    case "notify":  return <Bell className={cls} />;
    default:        return <CheckSquare className={cls} />;
  }
};

// ─── Custom node component ────────────────────────────────────────────────────

interface ForgeNodeData extends Record<string, unknown> {
  label: string;
  type: string;
  maxRetries: number;
  retryDelaySecs: number;
  timeoutSecs: number;
  status?: StepStatus | string;
  config?: Record<string, any>;
}

function ForgeNode({ data, selected }: { data: ForgeNodeData; selected?: boolean }) {
  const status = data.status;
  const tc = typeColors[data.type] ?? typeColors.task;

  return (
    <div
      className={cn(
        "relative w-44 rounded-xl border-2 px-3 py-2.5 cursor-pointer transition-all duration-200",
        "bg-[hsl(222_47%_9%)] backdrop-blur-sm",
        tc.border,
        status && statusStyles[status],
        selected && "ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--background))]"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-2.5 h-2.5 bg-[hsl(var(--muted-foreground))] border-[hsl(var(--background))] border-2"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2.5 h-2.5 bg-[hsl(var(--muted-foreground))] border-[hsl(var(--background))] border-2"
      />
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0", tc.bg)}>
          <TypeIcon type={data.type} />
        </div>
        <span className="text-xs font-semibold text-[hsl(var(--foreground))] truncate leading-tight">
          {data.label}
        </span>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] capitalize text-[hsl(var(--muted-foreground))]">
          {data.type}
        </span>

        {data.maxRetries > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            <RotateCcw className="w-2.5 h-2.5" />
            {data.maxRetries}
          </span>
        )}

        <span className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground))] ml-auto">
          <Clock className="w-2.5 h-2.5" />
          {data.timeoutSecs}s
        </span>
      </div>

      {/* Status pill */}
      {status && (
        <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-[hsl(var(--border)/0.4)]">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDot[status] ?? "bg-slate-400")} />
          <span className={cn("text-[10px] capitalize font-medium",
            status === "success" ? "text-emerald-400" :
            status === "failed"  ? "text-red-400" :
            status === "running" ? "text-amber-400" :
            "text-slate-400"
          )}>
            {status}
          </span>
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { forge: ForgeNode };

// ─── Layout: Sugiyama-style column layout ─────────────────────────────────────

function topoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  stepStatuses: Record<string, string>
): { rfNodes: Node[]; rfEdges: Edge[] } {
  const COL_W = 220;
  const ROW_H = 110;

  // Compute columns via BFS from entry nodes
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => {
    inDegree.set(e.target_id, (inDegree.get(e.target_id) ?? 0) + 1);
    adj.get(e.source_id)?.push(e.target_id);
  });

  const col = new Map<string, number>();
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  queue.forEach((n) => col.set(n.id, 0));
  const bfs = [...queue.map((n) => n.id)];
  while (bfs.length) {
    const cur = bfs.shift()!;
    for (const next of adj.get(cur) ?? []) {
      col.set(next, Math.max(col.get(next) ?? 0, (col.get(cur) ?? 0) + 1));
      bfs.push(next);
    }
  }

  // Group by column, assign row
  const byCol = new Map<number, string[]>();
  nodes.forEach((n) => {
    const c = col.get(n.id) ?? 0;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(n.id);
  });

  const pos = new Map<string, { x: number; y: number }>();
  byCol.forEach((ids, c) => {
    const totalH = ids.length * ROW_H;
    ids.forEach((id, row) => {
      pos.set(id, { x: c * COL_W, y: row * ROW_H - totalH / 2 });
    });
  });

  const rfNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    type: "forge",
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data: {
      label: n.name,
      type: n.type,
      maxRetries: n.max_retries,
      retryDelaySecs: n.retry_delay_secs,
      timeoutSecs: n.timeout_secs,
      status: stepStatuses[n.id],
      config: n.config,
    } satisfies ForgeNodeData,
  }));

  const rfEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: "smoothstep",
    animated: !stepStatuses[e.source_id] || stepStatuses[e.source_id] === "running",
    style: { stroke: "hsl(263 90% 65% / 0.5)", strokeWidth: 1.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "hsl(263 90% 65% / 0.7)",
      width: 16,
      height: 16,
    },
  }));

  return { rfNodes, rfEdges };
}

// ─── Public component ─────────────────────────────────────────────────────────

interface Props {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  workflowId: string;
  orgId: string;
  stepStatuses?: Record<string, string>;
  readOnly?: boolean;
  className?: string;
}

const EMPTY_STATUSES: Record<string, string> = {};

export function DagViewer({
  nodes,
  edges,
  stepStatuses = EMPTY_STATUSES,
  readOnly = false,
  className,
  workflowId,
  orgId,
}: Props) {
  const qc = useQueryClient();
  const { rfNodes, rfEdges } = useMemo(
    () => topoLayout(nodes ?? [], edges ?? [], stepStatuses),
    [nodes, edges, stepStatuses]
  );

  const [flowNodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync whenever parent data changes (e.g. after save/refetch)
  useEffect(() => {
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, type: "smoothstep", style: { stroke: "hsl(var(--primary) / 0.5)", strokeWidth: 1.5 } } as Edge, eds)),
    [setEdges]
  );

  const addNode = (type: "task" | "webhook" | "script" | "notify") => {
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "00000000-0000-0000-0000-" + String(Date.now()).padStart(12, "0");
    const defaultConfigs = {
      script: { script: "console.log('Hello from Node.js!');\nconst date = new Date();\nconsole.log('Current time is: ' + date.toISOString());" },
      webhook: { url: "https://httpbin.org/post", method: "POST", headers: {} },
      notify: { message: "Workflow step completed!" },
      task: {},
    };

    const newNode: Node = {
      id,
      type: "forge",
      position: { x: Math.random() * 200, y: Math.random() * 200 },
      data: {
        label: `New ${type}`,
        type,
        maxRetries: 3,
        retryDelaySecs: 10,
        timeoutSecs: 300,
        config: defaultConfigs[type],
      } as ForgeNodeData,
    };
    setNodes((nds) => [...nds, newNode]);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: UpsertGraphRequest = {
        nodes: flowNodes.map(n => ({
          id: n.id,
          name: (n.data as ForgeNodeData).label,
          type: (n.data as ForgeNodeData).type as any,
          config: (n.data as ForgeNodeData).config || {},
          position_x: n.position.x,
          position_y: n.position.y,
          max_retries: (n.data as ForgeNodeData).maxRetries,
          retry_delay_secs: (n.data as ForgeNodeData).retryDelaySecs,
          timeout_secs: (n.data as ForgeNodeData).timeoutSecs,
        })),
        edges: flowEdges.map(e => ({
          source_id: e.source,
          target_id: e.target,
        })),
      };
      return workflowsApi.upsertGraph(orgId, workflowId, payload);
    },
    onSuccess: () => {
      toast.success("DAG saved successfully!");
      qc.invalidateQueries({ queryKey: ["workflow", orgId, workflowId] });
    },
    onError: () => toast.error("Failed to save DAG"),
  });

  const selectedNode = flowNodes.find((n) => n.selected);

  const updateSelectedNode = (field: string, value: any) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNode.id) {
          return {
            ...n,
            data: {
              ...n.data,
              [field]: value,
            },
          };
        }
        return n;
      })
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
  };

  return (
    <div className={cn("h-130 w-full rounded-lg overflow-hidden flex border border-[hsl(var(--border))]", className)}>
      <div className="flex-1 h-full relative">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          elementsSelectable={!readOnly}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
          className="bg-[hsl(var(--background))]"
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: true,
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="hsl(var(--border))"
          />
          <Controls
            className="bg-[hsl(var(--card))]! border-[hsl(var(--border))]! [&>button]:bg-[hsl(var(--card))]! [&>button]:border-[hsl(var(--border))]! [&>button]:text-[hsl(var(--foreground))]! [&>button:hover]:bg-[hsl(var(--muted))]!"
            showInteractive={false}
          />
          {/* Toolbar */}
          {!readOnly && (
            <Panel position="top-left" className="flex items-center gap-2 p-2 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg shadow-sm">
              <Button size="sm" variant="outline" onClick={() => addNode("task")}>+ Task</Button>
              <Button size="sm" variant="outline" onClick={() => addNode("webhook")}>+ Webhook</Button>
              <Button size="sm" variant="outline" onClick={() => addNode("script")}>+ Script</Button>
              <Button size="sm" className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                Save Graph
              </Button>
            </Panel>
          )}

          <MiniMap
            className="bg-[hsl(var(--card))]! border-[hsl(var(--border))]!"
            nodeColor={(n) => {
              const status = (n.data as ForgeNodeData).status;
              if (status === "success") return "hsl(142 71% 45%)";
              if (status === "failed")  return "hsl(0 84% 60%)";
              if (status === "running") return "hsl(38 92% 55%)";
              return "hsl(26 30% 28% / 0.4)";
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />

          {/* Legend */}
          <Panel position="top-right" className="flex flex-col gap-1.5 p-2 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg text-[10px] shadow-sm">
            {[
              { label: "Task",    color: "bg-violet-400" },
              { label: "Webhook", color: "bg-sky-400" },
              { label: "Script",  color: "bg-fuchsia-400" },
              { label: "Notify",  color: "bg-amber-400" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                <span className={cn("w-2 h-2 rounded-sm", color)} />
                {label}
              </div>
            ))}
          </Panel>

          {/* Status legend (only when viewing a run) */}
          {Object.keys(stepStatuses).length > 0 && (
            <Panel position="bottom-right" className="flex flex-col gap-1 p-2 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg text-[10px] shadow-sm">
              {[
                { s: "success", label: "Success", cls: "bg-emerald-400" },
                { s: "running", label: "Running",  cls: "bg-amber-400 animate-pulse" },
                { s: "failed",  label: "Failed",   cls: "bg-red-400" },
                { s: "pending", label: "Pending",  cls: "bg-slate-500" },
              ].map(({ s, label, cls }) => (
                <div key={s} className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                  <span className={cn("w-2 h-2 rounded-full", cls)} />
                  {label}
                </div>
              ))}
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Node Settings Sidebar */}
      {!readOnly && selectedNode && (
        <div className="w-80 border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex flex-col gap-4 overflow-y-auto animate-in slide-in-from-right duration-200">
          <div>
            <h3 className="text-sm font-semibold">Node Settings</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Configure execution properties.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold mb-1 block">Label / Name</label>
              <input
                type="text"
                className="w-full text-xs px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                value={(selectedNode.data as ForgeNodeData).label}
                onChange={(e) => updateSelectedNode("label", e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-semibold mb-1 block">Type</label>
              <select
                className="w-full text-xs px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                value={(selectedNode.data as ForgeNodeData).type}
                onChange={(e) => updateSelectedNode("type", e.target.value)}
              >
                <option value="task">Task</option>
                <option value="webhook">Webhook</option>
                <option value="script">Script</option>
                <option value="notify">Notify</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold mb-1 block">Max Retries</label>
                <input
                  type="number"
                  className="w-full text-xs px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none"
                  value={(selectedNode.data as ForgeNodeData).maxRetries}
                  onChange={(e) => updateSelectedNode("maxRetries", parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Delay (s)</label>
                <input
                  type="number"
                  className="w-full text-xs px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none"
                  value={(selectedNode.data as ForgeNodeData).retryDelaySecs}
                  onChange={(e) => updateSelectedNode("retryDelaySecs", parseInt(e.target.value) || 0)}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold mb-1 block">Timeout (s)</label>
              <input
                type="number"
                className="w-full text-xs px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none"
                value={(selectedNode.data as ForgeNodeData).timeoutSecs}
                onChange={(e) => updateSelectedNode("timeoutSecs", parseInt(e.target.value) || 0)}
              />
            </div>

            {/* Custom Configuration Section */}
            <div className="pt-2 border-t border-[hsl(var(--border))]">
              <label className="text-xs font-semibold mb-1.5 block">Step Configuration Payload</label>
              
              {((selectedNode.data as ForgeNodeData).type === "script") && (
                <div className="space-y-1">
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Shell command / script to execute:</span>
                  <textarea
                    rows={4}
                    className="w-full font-mono text-[11px] p-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none"
                    value={((selectedNode.data as ForgeNodeData).config as any)?.script || ""}
                    onChange={(e) => {
                      const prevConfig = (selectedNode.data as ForgeNodeData).config || {};
                      updateSelectedNode("config", { ...prevConfig, script: e.target.value });
                    }}
                    placeholder="e.g. echo 'Hello from worker!'"
                  />
                </div>
              )}

              {((selectedNode.data as ForgeNodeData).type === "webhook") && (
                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Webhook Destination URL:</span>
                    <input
                      type="text"
                      className="w-full text-xs px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none"
                      value={((selectedNode.data as ForgeNodeData).config as any)?.url || ""}
                      onChange={(e) => {
                        const prevConfig = (selectedNode.data as ForgeNodeData).config || {};
                        updateSelectedNode("config", { ...prevConfig, url: e.target.value });
                      }}
                      placeholder="https://api.example.com/endpoint"
                    />
                  </div>
                </div>
              )}

              {((selectedNode.data as ForgeNodeData).type === "notify") && (
                <div className="space-y-1">
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Notification Message:</span>
                  <textarea
                    rows={2}
                    className="w-full text-xs p-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none"
                    value={((selectedNode.data as ForgeNodeData).config as any)?.message || ""}
                    onChange={(e) => {
                      const prevConfig = (selectedNode.data as ForgeNodeData).config || {};
                      updateSelectedNode("config", { ...prevConfig, message: e.target.value });
                    }}
                    placeholder="Step finished executing successfully."
                  />
                </div>
              )}

              {!["script", "webhook", "notify"].includes((selectedNode.data as ForgeNodeData).type) && (
                <div className="space-y-1">
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Custom JSON config payload:</span>
                  <textarea
                    rows={4}
                    className="w-full font-mono text-[11px] p-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none"
                    value={JSON.stringify((selectedNode.data as ForgeNodeData).config || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        updateSelectedNode("config", parsed);
                      } catch {
                        // Let them type invalid JSON temporarily
                      }
                    }}
                    placeholder="{}"
                  />
                </div>
              )}
            </div>

            <div className="pt-2">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                💡 Select edges and press <kbd className="bg-[hsl(var(--muted))] px-1 py-0.5 rounded text-[9px]">Backspace</kbd> or <kbd className="bg-[hsl(var(--muted))] px-1 py-0.5 rounded text-[9px]">Delete</kbd> to remove connections.
              </span>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-[hsl(var(--border))]">
            <Button
              variant="destructive"
              size="sm"
              className="w-full text-xs"
              onClick={deleteSelectedNode}
            >
              Delete Node
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
