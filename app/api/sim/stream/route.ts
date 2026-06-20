import { subscribe } from "@/simulation/event-bus";

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

      safeEnqueue("event: ready\ndata: {}\n\n");
      unsubscribe = subscribe((event) => {
        safeEnqueue(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
      });
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
