"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { useSimStream } from "@/components/live-sim";

const ActiveAgentsContext = createContext<Set<string>>(new Set());

function removeStream(streamIds: string[] | undefined, streamId: string) {
  return (streamIds ?? []).filter((id) => id !== streamId);
}

export function OrgWorkStatusProvider({ children }: { children: React.ReactNode }) {
  const [streamsByAgent, setStreamsByAgent] = useState<Record<string, string[]>>({});

  useSimStream({
    onStatus: (status) => {
      if (status.status !== "running") setStreamsByAgent({});
    },
    onAgentStream: (update) => {
      setStreamsByAgent((current) => {
        const next = { ...current };
        if (update.status === "done" || update.status === "error") {
          const remaining = removeStream(next[update.agentId], update.streamId);
          if (remaining.length) next[update.agentId] = remaining;
          else delete next[update.agentId];
          return next;
        }

        const existing = next[update.agentId] ?? [];
        next[update.agentId] = existing.includes(update.streamId)
          ? existing
          : [...existing, update.streamId];
        return next;
      });
    },
  });

  const activeAgents = useMemo(() => new Set(Object.keys(streamsByAgent)), [streamsByAgent]);
  return (
    <ActiveAgentsContext.Provider value={activeAgents}>
      {children}
    </ActiveAgentsContext.Provider>
  );
}

export function AgentWorkLabel({ agentHandle }: { agentHandle: string }) {
  const activeAgents = useContext(ActiveAgentsContext);
  if (!activeAgents.has(agentHandle)) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-cobalt/10 px-1.5 py-0.5 text-[10px] font-bold text-cobalt">
      <span className="h-1.5 w-1.5 rounded-full bg-cobalt animate-pulse" />
      工作中
    </span>
  );
}
