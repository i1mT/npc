"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SimEvent } from "@/lib/types";

// ─── Agent role metadata ──────────────────────────────────────────────────────

const ROLE_META: Record<string, { color: string; label: string; initials: string; order: number }> = {
  "editor-in-chief": { color: "#254edb", label: "总编",   initials: "总", order: 0 },
  "editor":          { color: "#2e9e6b", label: "编辑",   initials: "编", order: 1 },
  "growth-agent":    { color: "#c05621", label: "增长",   initials: "增", order: 2 },
  "business-agent":  { color: "#7c3aed", label: "商业",   initials: "商", order: 3 },
  "column-agent":    { color: "#0891b2", label: "专栏",   initials: "专", order: 4 },
  "board":           { color: "#92400e", label: "董事会", initials: "董", order: 5 },
  "reader-agent":    { color: "#be185d", label: "读者",   initials: "读", order: 6 },
};

function roleMeta(id: string) {
  return ROLE_META[id] ?? { color: "#4b5563", label: id, initials: (id[0] ?? "?").toUpperCase(), order: 99 };
}

// ─── Graph types ─────────────────────────────────────────────────────────────

type GNode = {
  id: string;
  name: string;
  label: string;
  initials: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  addedAt: number;     // frame count when added (for entrance animation)
};

type GEdge = {
  from: string;
  to: string;
  count: number;
  updatedAt: number;   // frame count of last interaction
};

// ─── Physics constants ────────────────────────────────────────────────────────

const R         = 32;   // node radius
const REPULSION = 5000;
const SPRING_L  = 170;
const SPRING_K  = 0.05;
const GRAVITY   = 0.007;
const DAMPING   = 0.80;

// ─── Simulation step ──────────────────────────────────────────────────────────

function tick(nodes: GNode[], edges: GEdge[], w: number, h: number) {
  // Node–node repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!, b = nodes[j]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy || 1;
      const d  = Math.sqrt(d2);
      const f  = REPULSION / d2;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
    }
  }

  // Spring attraction along edges
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d  = Math.sqrt(dx * dx + dy * dy) || 1;
    const f  = (d - SPRING_L) * SPRING_K;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  // Gravity toward center
  const cx = w / 2, cy = h / 2;
  for (const n of nodes) {
    n.vx += (cx - n.x) * GRAVITY;
    n.vy += (cy - n.y) * GRAVITY;
    // Apply + damping + bounds
    n.vx *= DAMPING; n.vy *= DAMPING;
    n.x = Math.max(R + 2, Math.min(w - R - 2, n.x + n.vx));
    n.y = Math.max(R + 2, Math.min(h - R - 2, n.y + n.vy));
  }
}

// ─── Mention detection ────────────────────────────────────────────────────────

const SKIP = new Set(["simulation-engine", "system"]);

function detectMentions(content: string, fromId: string, allNodes: GNode[]): string[] {
  const targets: string[] = [];
  for (const n of allNodes) {
    if (n.id === fromId) continue;
    const meta = roleMeta(n.id);
    if (
      content.includes(`@${n.id}`) ||
      content.includes(`@${n.name}`) ||
      content.includes(`@${meta.label}`)
    ) {
      targets.push(n.id);
    }
  }
  return targets;
}

// ─── Graph builder from events ────────────────────────────────────────────────

function updateGraph(
  newEvents: SimEvent[],
  nodes: GNode[],
  edges: GEdge[],
  w: number,
  h: number,
  frame: number,
): { nodes: GNode[]; edges: GEdge[]; changed: boolean } {
  let changed = false;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edgeMap = new Map(edges.map(e => [e.from + "→" + e.to, e]));

  // Add new nodes
  for (const ev of newEvents) {
    if (SKIP.has(ev.agentId) || !ev.agentId) continue;
    if (!nodeMap.has(ev.agentId)) {
      const meta = roleMeta(ev.agentId);
      const count = nodeMap.size;
      // Place in a circle initially
      const angle = (meta.order / Math.max(7, Object.keys(ROLE_META).length)) * Math.PI * 2;
      const r0 = Math.min(w, h) * 0.28;
      nodeMap.set(ev.agentId, {
        id:       ev.agentId,
        name:     ev.agentName,
        label:    meta.label,
        initials: meta.initials,
        color:    meta.color,
        x:        w / 2 + Math.cos(angle) * r0 + (Math.random() - 0.5) * 20,
        y:        h / 2 + Math.sin(angle) * r0 + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0,
        addedAt: frame,
      });
      changed = true;
    } else {
      // Update display name if it changed
      const node = nodeMap.get(ev.agentId)!;
      if (node.name !== ev.agentName) { node.name = ev.agentName; changed = true; }
    }
  }

  const nodeArr = Array.from(nodeMap.values());

  // Add edges from explicit @mentions
  for (const ev of newEvents) {
    if (SKIP.has(ev.agentId) || !ev.agentId) continue;
    const targets = detectMentions(ev.content ?? "", ev.agentId, nodeArr);
    for (const to of targets) {
      const key = ev.agentId + "→" + to;
      const ex  = edgeMap.get(key);
      if (ex) { ex.count++; ex.updatedAt = frame; }
      else { edgeMap.set(key, { from: ev.agentId, to, count: 1, updatedAt: frame }); }
      changed = true;
    }
  }

  // Add edges from sequential conversation flow (A sends, B follows)
  const filtered = newEvents.filter(ev => !SKIP.has(ev.agentId) && ev.agentId);
  for (let i = 1; i < filtered.length; i++) {
    const a = filtered[i - 1]!, b = filtered[i]!;
    if (a.agentId === b.agentId) continue;
    if (a.eventType !== "message" && b.eventType !== "message") continue;
    const key = a.agentId + "→" + b.agentId;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { from: a.agentId, to: b.agentId, count: 1, updatedAt: frame });
      changed = true;
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    changed,
  };
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function curvedArrow(ax: number, ay: number, bx: number, by: number, bidirectional: boolean) {
  const dx = bx - ax, dy = by - ay;
  const d  = Math.sqrt(dx * dx + dy * dy) || 1;
  // Shorten by node radius
  const sx = ax + (dx / d) * (R + 2);
  const sy = ay + (dy / d) * (R + 2);
  const ex = bx - (dx / d) * (R + 8);
  const ey = by - (dy / d) * (R + 8);
  // Curve offset (if bidirectional, offset more)
  const offset = bidirectional ? 22 : 8;
  const mx = (sx + ex) / 2 - (dy / d) * offset;
  const my = (sy + ey) / 2 + (dx / d) * offset;
  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  events: SimEvent[];
  streamEvents: SimEvent[];
  activeAgentIds: string[];
}

export function TopologyTab({ events, streamEvents, activeAgentIds }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const rafRef        = useRef<number | null>(null);
  const frameRef      = useRef(0);
  const nodesRef      = useRef<GNode[]>([]);
  const edgesRef      = useRef<GEdge[]>([]);
  const processedRef  = useRef<Set<string>>(new Set());
  const sizeRef       = useRef({ w: 800, h: 500 });

  // Rendered snapshot for React
  const [snapshot, setSnapshot] = useState<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });
  const [frame, setFrame]       = useState(0);

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) sizeRef.current = { w: e.contentRect.width, h: e.contentRect.height };
    });
    ro.observe(el);
    const { width, height } = el.getBoundingClientRect();
    sizeRef.current = { w: width || 800, h: height || 500 };
    return () => ro.disconnect();
  }, []);

  // Process new events
  useEffect(() => {
    const allEvs = [...events, ...streamEvents];
    const newEvs = allEvs.filter(ev => !processedRef.current.has(ev.id));
    if (newEvs.length === 0) return;
    for (const ev of newEvs) processedRef.current.add(ev.id);

    const { w, h } = sizeRef.current;
    const { nodes, edges, changed } = updateGraph(
      newEvs, nodesRef.current, edgesRef.current, w, h, frameRef.current
    );
    if (changed) {
      nodesRef.current = nodes;
      edgesRef.current = edges;
    }
  }, [events, streamEvents]);

  // Animation loop
  const animate = useCallback(() => {
    frameRef.current++;
    const { w, h } = sizeRef.current;
    const nodes = nodesRef.current;
    const edges = edgesRef.current;

    if (nodes.length > 0) {
      tick(nodes, edges, w, h);
      // Snapshot every 2 frames to avoid excessive re-renders
      if (frameRef.current % 2 === 0) {
        setSnapshot({ nodes: nodes.map(n => ({ ...n })), edges: [...edges] });
        setFrame(frameRef.current);
      }
    }

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [animate]);

  const { w, h } = sizeRef.current;
  const { nodes, edges } = snapshot;

  const nodeMap      = new Map(nodes.map(n => [n.id, n]));
  const activeSet    = new Set(activeAgentIds);
  const edgeKeySet   = new Set(edges.map(e => e.from + "→" + e.to));
  const maxCount     = Math.max(1, ...edges.map(e => e.count));

  if (nodes.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center text-sm text-ink/30 select-none">
        等待 Agent 开始工作…
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-[#0d1117]">
      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          {/* Arrowhead markers per color */}
          {nodes.map(n => (
            <marker
              key={`arrow-${n.id}`}
              id={`arrow-${n.id}`}
              markerWidth="8" markerHeight="8"
              refX="6" refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill={n.color} fillOpacity="0.8" />
            </marker>
          ))}
          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-strong">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ── Edges ── */}
        {edges.map(e => {
          const a = nodeMap.get(e.from);
          const b = nodeMap.get(e.to);
          if (!a || !b) return null;
          const hasBidi = edgeKeySet.has(e.to + "→" + e.from);
          const d       = curvedArrow(a.x, a.y, b.x, b.y, hasBidi);
          const opacity = 0.25 + (e.count / maxCount) * 0.6;
          const sw      = 1 + (e.count / maxCount) * 2.5;
          const isRecent = frame - e.updatedAt < 60; // flash recently updated
          return (
            <path
              key={e.from + "→" + e.to}
              d={d}
              fill="none"
              stroke={a.color}
              strokeWidth={isRecent ? sw + 1 : sw}
              strokeOpacity={isRecent ? Math.min(1, opacity + 0.3) : opacity}
              markerEnd={`url(#arrow-${e.from})`}
              strokeLinecap="round"
            />
          );
        })}

        {/* ── Nodes ── */}
        {nodes.map(n => {
          const isActive   = activeSet.has(n.id);
          const isNew      = frame - n.addedAt < 30;
          const entrScale  = isNew ? Math.min(1, (frame - n.addedAt) / 30) : 1;

          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y}) scale(${entrScale})`}
              style={{ transformOrigin: `${n.x}px ${n.y}px` }}
            >
              {/* Active pulse rings */}
              {isActive && (
                <>
                  <circle r={R + 14} fill="none" stroke={n.color} strokeWidth="1.5"
                    strokeOpacity={0.25 + 0.25 * Math.sin(frame * 0.04)} />
                  <circle r={R + 7} fill="none" stroke={n.color} strokeWidth="2"
                    strokeOpacity={0.4 + 0.35 * Math.sin(frame * 0.06 + 1)} />
                </>
              )}

              {/* Glow backdrop for active */}
              {isActive && (
                <circle r={R + 4} fill={n.color} fillOpacity="0.15" filter="url(#glow-strong)" />
              )}

              {/* Main circle */}
              <circle
                r={R}
                fill={n.color}
                fillOpacity={isActive ? 1 : 0.85}
                stroke={isActive ? "#ffffff" : n.color}
                strokeWidth={isActive ? 2.5 : 1}
                strokeOpacity={isActive ? 0.9 : 0.4}
              />

              {/* Role initials */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={R * 0.62}
                fontWeight="900"
                fontFamily="var(--font-serif, Georgia, serif)"
                y={-2}
              >
                {n.initials}
              </text>

              {/* Name label above */}
              <text
                textAnchor="middle"
                y={-R - 8}
                fill={n.color}
                fontSize={11}
                fontWeight="700"
                fontFamily="var(--font-sans, system-ui)"
                paintOrder="stroke"
                stroke="#0d1117"
                strokeWidth="3"
                strokeLinejoin="round"
              >
                {n.name}
              </text>

              {/* Role label below */}
              <text
                textAnchor="middle"
                y={R + 14}
                fill="rgba(245,243,238,0.4)"
                fontSize={9}
                fontWeight="600"
                fontFamily="var(--font-sans, system-ui)"
                paintOrder="stroke"
                stroke="#0d1117"
                strokeWidth="3"
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1">
        {nodes.map(n => (
          <div key={n.id} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
            <span className="text-[10px] font-bold" style={{ color: n.color }}>{n.label}</span>
            <span className="text-[10px] text-paper/30">{n.name}</span>
          </div>
        ))}
      </div>

      {/* Edge count badge */}
      <div className="absolute top-3 right-3 text-[10px] text-paper/25 font-bold uppercase tracking-wider">
        {edges.length} 条关系线 · {nodes.length} 个节点
      </div>
    </div>
  );
}
