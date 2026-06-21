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
