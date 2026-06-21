import { getSimDb } from "@/db/connection";
import nameCandidates from "@/mastra/data/employee-name-candidates.json";

const NAMES: string[] = nameCandidates.employeeNameCandidates;

export function pickEmployeeName(): string {
  const db = getSimDb();
  const usedRows = db
    .prepare("SELECT display_name FROM employees")
    .all() as { display_name: string }[];
  const used = new Set(usedRows.map(r => r.display_name));
  const available = NAMES.filter(n => !used.has(n));
  if (available.length === 0) {
    // All names taken — generate a fallback
    return `员工${(Math.random() * 1000).toFixed(0)}`;
  }
  return available[Math.floor(Math.random() * available.length)]!;
}
