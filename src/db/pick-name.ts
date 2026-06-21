import { dbAll } from "@/db/connection";
import nameCandidates from "@/mastra/data/employee-name-candidates.json";

const NAMES: string[] = nameCandidates.employeeNameCandidates;

export async function pickEmployeeName(): Promise<string> {
  const usedRows = await dbAll<{ display_name: string }>("SELECT display_name FROM employees");
  const used = new Set(usedRows.map(r => r.display_name));
  const available = NAMES.filter(n => !used.has(n));
  if (available.length === 0) {
    // All names taken — generate a fallback
    return `员工${(Math.random() * 1000).toFixed(0)}`;
  }
  return available[Math.floor(Math.random() * available.length)]!;
}
