import { subscribe } from "@/simulation/event-bus";
import { simClock } from "@/simulation/engine";
import { listEvents } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        request.signal.removeEventListener("abort", cleanup!);
      };

      const safeEnqueue = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cleanup?.();
        }
      };

      request.signal.addEventListener("abort", cleanup);

      const status = simClock.getStatus();
      safeEnqueue("event: ready\ndata: {}\n\n");
      safeEnqueue(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
      unsubscribe = subscribe((message) => {
        if (message.type === "event") {
          safeEnqueue(`event: event\ndata: ${JSON.stringify(message.event)}\n\n`);
          return;
        }
        if (message.type === "agent-stream") {
          safeEnqueue(`event: agent-stream\ndata: ${JSON.stringify(message.update)}\n\n`);
          return;
        }
        safeEnqueue(`event: status\ndata: ${JSON.stringify(message.status)}\n\n`);
      });
      if (status.status === "running") {
        for (const event of listEvents(status.day)) {
          safeEnqueue(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
        }
      }
      heartbeat = setInterval(() => {
        safeEnqueue("event: ping\ndata: {}\n\n");
      }, 15000);
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
