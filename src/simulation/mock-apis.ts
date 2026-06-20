import { addEvent } from "@/db/sim";
import { emit } from "@/simulation/event-bus";
import type { SimEvent } from "@/lib/types";

export function logEvent(input: Omit<SimEvent, "id" | "seq" | "createdAt">) {
  const event = addEvent(input);
  emit(event);
  return event;
}

export function agentMeta(agentName: "总编" | "编辑" | "系统" | "董事会") {
  const map = {
    总编: { agentId: "editor-in-chief", agentName: "总编 Agent" },
    编辑: { agentId: "editor", agentName: "编辑 Agent" },
    系统: { agentId: "simulation-engine", agentName: "Simulation Engine" },
    董事会: { agentId: "board", agentName: "Board" },
  };
  return map[agentName];
}
