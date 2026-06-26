import { streamTurn } from "@/mastra/workflows/streamed-day/runner";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ turnId: string }> }) {
  const { turnId } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await streamTurn(turnId, (update) => {
          send("agent-stream", {
            streamId: update.turn.id,
            day: update.turn.day,
            agentId: update.turn.agentId,
            agentName: update.turn.agentName,
            eventType: "message",
            content: update.content,
            delta: update.delta,
            status: update.status,
            turn: update.turn.turnNo,
          });
        });
        send("done", { turnId });
      } catch (error) {
        send("error", { turnId, error: error instanceof Error ? error.message : "Unknown error" });
      } finally {
        controller.close();
      }
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
