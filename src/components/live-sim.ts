"use client";

import { useEffect, useRef } from "react";
import type { DayState, SimEvent, SimStatus } from "@/lib/types";

export type SimStatusSnapshot = {
  day: number;
  status: SimStatus;
  state: DayState;
  runningDay: number | null;
  activeRunId?: string | null;
  reason?: string;
};

export type AgentStreamUpdate = {
  streamId: string;
  day: number;
  agentId: string;
  agentName: string;
  eventType: SimEvent["eventType"];
  content: string;
  delta: string;
  status: "start" | "delta" | "done" | "error";
  turn?: number;
};

type LlmTurn = {
  id: string;
  day: number;
  status: "pending" | "running" | "completed" | "error";
};

type RunSnapshot = {
  run: {
    id: string;
    day: number;
    status: "running" | "completed" | "paused" | "error";
  };
  pendingTurns: LlmTurn[];
  events: SimEvent[];
};

type SimStreamHandlers = {
  onEvent?: (event: SimEvent) => void;
  onStatus?: (status: SimStatusSnapshot) => void;
  onAgentStream?: (update: AgentStreamUpdate) => void;
  onReady?: () => void;
};

const eventTarget = new EventTarget();
const runningLoops = new Set<string>();
const seenEventIds = new Set<string>();

export function useSimStream(handlers: SimStreamHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onEvent = (event: Event) => handlersRef.current.onEvent?.((event as CustomEvent<SimEvent>).detail);
    const onStatus = (event: Event) => handlersRef.current.onStatus?.((event as CustomEvent<SimStatusSnapshot>).detail);
    const onAgentStream = (event: Event) => handlersRef.current.onAgentStream?.((event as CustomEvent<AgentStreamUpdate>).detail);
    eventTarget.addEventListener("event", onEvent);
    eventTarget.addEventListener("status", onStatus);
    eventTarget.addEventListener("agent-stream", onAgentStream);
    handlersRef.current.onReady?.();

    let stopped = false;
    const refresh = async () => {
      const status = await fetchStatus();
      if (stopped || !status) return;
      dispatchStatus(status);
      if (status.status === "running" && status.activeRunId) void orchestrateRun(status.activeRunId);
    };
    void refresh();
    const timer = setInterval(refresh, 3000);

    return () => {
      stopped = true;
      clearInterval(timer);
      eventTarget.removeEventListener("event", onEvent);
      eventTarget.removeEventListener("status", onStatus);
      eventTarget.removeEventListener("agent-stream", onAgentStream);
    };
  }, []);
}

export async function runSimDays(days: number) {
  const response = await fetch("/api/sim/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
  if (!response.ok) throw new Error(await response.text());
  const snapshot = await response.json() as RunSnapshot;
  dispatchSnapshot(snapshot);
  const status = await fetchStatus();
  if (status) dispatchStatus(status);
  await orchestrateRun(snapshot.run.id);
}

async function orchestrateRun(runId: string) {
  if (runningLoops.has(runId)) return;
  runningLoops.add(runId);
  try {
    while (true) {
      const snapshot = await advanceRun(runId);
      dispatchSnapshot(snapshot);
      const status = await fetchStatus();
      if (status) dispatchStatus(status);
      if (snapshot.run.status !== "running") break;
      if (snapshot.pendingTurns.length === 0) {
        await delay(400);
        continue;
      }
      await Promise.all(snapshot.pendingTurns.map(turn => streamTurn(turn.id)));
    }
  } finally {
    runningLoops.delete(runId);
  }
}

async function advanceRun(runId: string) {
  const response = await fetch(`/api/sim/runs/${runId}/advance`, { method: "POST", cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<RunSnapshot>;
}

async function streamTurn(turnId: string) {
  const response = await fetch(`/api/sim/turns/${turnId}/stream`, { cache: "no-store" });
  if (!response.body) throw new Error("Turn stream response has no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) dispatchSseEvent(chunk);
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatchSseEvent(buffer);
  } finally {
    reader.releaseLock();
  }
}

function dispatchSseEvent(rawEvent: string) {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
  }
  const data = dataLines.join("\n");
  if (!data) return;
  const payload = JSON.parse(data) as unknown;
  if (eventName === "agent-stream") dispatchAgentStream(payload as AgentStreamUpdate);
}

function dispatchSnapshot(snapshot: RunSnapshot) {
  for (const event of snapshot.events) {
    if (seenEventIds.has(event.id)) continue;
    seenEventIds.add(event.id);
    eventTarget.dispatchEvent(new CustomEvent("event", { detail: event }));
  }
}

function dispatchStatus(status: SimStatusSnapshot) {
  eventTarget.dispatchEvent(new CustomEvent("status", { detail: status }));
}

function dispatchAgentStream(update: AgentStreamUpdate) {
  eventTarget.dispatchEvent(new CustomEvent("agent-stream", { detail: update }));
}

async function fetchStatus() {
  const response = await fetch("/api/sim/status", { cache: "no-store" });
  return response.ok ? response.json() as Promise<SimStatusSnapshot> : null;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
