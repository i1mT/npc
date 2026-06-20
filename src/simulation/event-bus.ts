import type { SimEvent } from "@/lib/types";

type Listener = (event: SimEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event: SimEvent) {
  for (const listener of listeners) {
    listener(event);
  }
}
