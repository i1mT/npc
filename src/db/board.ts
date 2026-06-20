import { getSimDb } from "@/db/connection";

export function setBoardAutoDirective(day: number, directive: string, reason: string) {
  getSimDb()
    .prepare("UPDATE board_meetings SET auto_directive = ?, auto_directive_reason = ? WHERE day = ?")
    .run(directive, reason, day);
}
