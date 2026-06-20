import { getSimDb } from "@/db/connection";

export function updateDayEditorNote(day: number, editorNote: string) {
  getSimDb().prepare("UPDATE sim_days SET editor_note = ? WHERE day = ?").run(editorNote, day);
}

export function getDayEditorNote(day: number) {
  const row = getSimDb().prepare("SELECT editor_note FROM sim_days WHERE day = ?").get(day) as { editor_note: string | null } | undefined;
  return row?.editor_note ?? null;
}
