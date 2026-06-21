"use client";

import { useEffect, useRef } from "react";
import type { DayState, SimEvent, SimStatus } from "@/lib/types";

export type SimStatusSnapshot = {
  day: number;
  status: SimStatus;
  state: DayState;
  runningDay: number | null;
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

type SimStreamHandlers = {
  onEvent?: (event: SimEvent) => void;
  onStatus?: (status: SimStatusSnapshot) => void;
  onAgentStream?: (update: AgentStreamUpdate) => void;
  onReady?: () => void;
};

export function useSimStream(handlers: SimStreamHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = async () => {
      try {
        const response = await fetch("/api/sim/stream", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.body) throw new Error("Simulation stream response has no body.");
        await readSseStream(response.body);
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        console.warn("[sim-stream] disconnected, reconnecting", error);
        reconnectTimer = setTimeout(connect, 800);
      }
    };

    const readSseStream = async (body: ReadableStream<Uint8Array>) => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const rawEvent of events) dispatchSseEvent(rawEvent, handlersRef.current);
        }
        buffer += decoder.decode();
        if (buffer.trim()) dispatchSseEvent(buffer, handlersRef.current);
      } finally {
        reader.releaseLock();
      }
    };

    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);
}

const DEFAULT_STATE: DayState = {
  day: 0,
  capital: 10000,
  reputation: 62,
  dau: 1200,
  subscribers: 260,
  adRevenue: 0,
  llmCost: 0,
  isBoardDay: false,
};

type PollResponse = {
  status: string;
  day: number;
  runningDay?: number | null;
  state: DayState | null;
  events: SimEvent[];
  agentStreams: AgentStreamUpdate[];
};

export function useSimPoll(handlers: SimStreamHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const cursorRef = useRef<{ day: number; afterSeq: number }>({ day: 0, afterSeq: -1 });
  const prevStreamIdsRef = useRef(new Set<string>());
  const lastStreamUpdatesRef = useRef(new Map<string, AgentStreamUpdate>());
  const readyFiredRef = useRef(false);
  const lastStatusRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (stopped) return;
      const { day, afterSeq } = cursorRef.current;
      const params = new URLSearchParams();
      if (day > 0) params.set("day", String(day));
      params.set("afterSeq", String(afterSeq));

      try {
        const res = await fetch(`/api/sim/poll?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`poll ${res.status}`);
        const data = await res.json() as PollResponse;
        if (stopped) return;

        if (!readyFiredRef.current) {
          readyFiredRef.current = true;
          handlersRef.current.onReady?.();
        }

        const statusSnap: SimStatusSnapshot = {
          day: data.day,
          status: data.status as SimStatus,
          state: data.state ?? DEFAULT_STATE,
          runningDay: data.runningDay ?? null,
        };
        if (lastStatusRef.current !== data.status) {
          lastStatusRef.current = data.status;
          handlersRef.current.onStatus?.(statusSnap);
        }

        // day 切换时重置 cursor
        const targetDay = data.runningDay ?? data.day;
        if (cursorRef.current.day === 0) {
          cursorRef.current = { day: targetDay, afterSeq: -1 };
        } else if (data.runningDay && data.runningDay !== cursorRef.current.day) {
          cursorRef.current = { day: data.runningDay, afterSeq: -1 };
        }

        if (data.events.length > 0) {
          const maxSeq = Math.max(...data.events.map(e => e.seq));
          cursorRef.current = { ...cursorRef.current, afterSeq: maxSeq };
          for (const ev of data.events) handlersRef.current.onEvent?.(ev);
        }

        // 检测消失的 stream，合成 done 事件
        const currentIds = new Set(data.agentStreams.map(s => s.streamId));
        for (const prevId of prevStreamIdsRef.current) {
          if (!currentIds.has(prevId)) {
            const last = lastStreamUpdatesRef.current.get(prevId);
            if (last) {
              handlersRef.current.onAgentStream?.({ ...last, status: "done", delta: "" });
              lastStreamUpdatesRef.current.delete(prevId);
            }
          }
        }
        prevStreamIdsRef.current = currentIds;

        for (const stream of data.agentStreams) {
          lastStreamUpdatesRef.current.set(stream.streamId, stream);
          handlersRef.current.onAgentStream?.(stream);
        }
      } catch (err) {
        if (!stopped) console.warn("[sim-poll]", err);
      }

      if (!stopped) timer = setTimeout(poll, 1000);
    }

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
}

function dispatchSseEvent(rawEvent: string, handlers: SimStreamHandlers) {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const data = dataLines.join("\n");
  if (eventName === "ready") {
    handlers.onReady?.();
    return;
  }
  if (eventName === "ping" || !data) return;

  const payload = JSON.parse(data) as unknown;
  if (eventName === "event") {
    handlers.onEvent?.(payload as SimEvent);
  } else if (eventName === "status") {
    handlers.onStatus?.(payload as SimStatusSnapshot);
  } else if (eventName === "agent-stream") {
    handlers.onAgentStream?.(payload as AgentStreamUpdate);
  }
}
