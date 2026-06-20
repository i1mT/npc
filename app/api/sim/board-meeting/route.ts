import { NextResponse } from "next/server";
import { getSimDb } from "@/db/connection";

export const dynamic = "force-dynamic";

type BoardMeetingRow = {
  day: number;
  status: string;
  weekly_report: string | null;
  auto_directive: string | null;
  auto_directive_reason: string | null;
  directive: string | null;
  suspended_at: string;
  resumed_at: string | null;
};

export async function GET() {
  const db = getSimDb();
  const row = db
    .prepare("SELECT * FROM board_meetings WHERE status = 'pending' ORDER BY day DESC LIMIT 1")
    .get() as BoardMeetingRow | undefined;

  if (!row) return NextResponse.json({ meeting: null });

  let weeklyReport: Record<string, unknown> = {};
  try { weeklyReport = JSON.parse(row.weekly_report ?? "{}") as Record<string, unknown>; } catch { /* empty */ }

  return NextResponse.json({
    meeting: {
      day: row.day,
      weeklyReport,
      autoDirective: row.auto_directive,
      autoDirectiveReason: row.auto_directive_reason,
      suspendedAt: row.suspended_at,
    },
  });
}
