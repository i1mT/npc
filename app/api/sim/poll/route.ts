import { NextResponse } from "next/server";
import { getStatus, listEvents, listEventsSince, listActiveAgentStreams } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const day = Number(url.searchParams.get("day") ?? 0);
  const afterSeq = Number(url.searchParams.get("afterSeq") ?? -1);

  const { day: latestDay, status, state } = await getStatus();
  const effectiveDay = day > 0 ? day : latestDay;

  const events = afterSeq >= 0
    ? await listEventsSince(effectiveDay, afterSeq)
    : await listEvents(effectiveDay);

  const agentStreamRows = await listActiveAgentStreams(effectiveDay);

  const agentStreams = agentStreamRows.map(r => ({
    streamId: r.stream_id,
    day: r.day,
    agentId: r.agent_id,
    agentName: r.agent_name,
    eventType: r.event_type as "message",
    content: r.content,
    delta: "",
    status: r.status as "start" | "delta" | "done" | "error",
    turn: r.turn ?? undefined,
  }));

  return NextResponse.json({ status, day: effectiveDay, state, events, agentStreams });
}
