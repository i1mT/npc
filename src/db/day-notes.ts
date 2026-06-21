import { dbFirst, dbRun } from "@/db/connection";

export async function updateDayEditorNote(day: number, editorNote: string) {
  await dbRun("UPDATE sim_days SET editor_note = ? WHERE day = ?", editorNote, day);
}

export async function getDayEditorNote(day: number) {
  const row = await dbFirst<{ editor_note: string | null }>("SELECT editor_note FROM sim_days WHERE day = ?", day);
  return row?.editor_note ?? null;
}
