import { dbRun } from "@/db/connection";

export async function setBoardAutoDirective(day: number, directive: string, reason: string) {
  await dbRun("UPDATE board_meetings SET auto_directive = ?, auto_directive_reason = ? WHERE day = ?", directive, reason, day);
}
