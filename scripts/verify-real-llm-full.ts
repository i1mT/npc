import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";

loadEnvConfig(process.cwd());

async function main() {
  const { resetSimDb, getSimDb } = await import("../src/db/connection");
  const { applyBoardDirective, runDailyWorkflow } = await import("../src/mastra");
  const { getBoardMeeting, setStatus } = await import("../src/db/sim");

  resetSimDb();
  setStatus("idle");

  for (let day = 1; day <= 7; day += 1) {
    await runDailyWorkflow(day);
  }

  const board = getBoardMeeting(7);
  if (!board?.autoDirective) throw new Error("Day 7 board auto directive was not generated.");
  applyBoardDirective(7, "INJECT_CAPITAL");

  getSimDb().prepare("UPDATE sim_days SET dau = 11000 WHERE day = 7").run();
  await runDailyWorkflow(8);
  const spawned = getSimDb()
    .prepare("SELECT agent_handle, joined_day FROM employees WHERE role_template = 'growth' AND status = 'active' ORDER BY joined_day DESC LIMIT 1")
    .get() as { agent_handle: string; joined_day: number } | undefined;
  if (!spawned || spawned.joined_day !== 9) {
    throw new Error("Growth threshold did not spawn an active growth Agent for Day 9.");
  }

  await runDailyWorkflow(9);
  const participated = getSimDb()
    .prepare("SELECT id FROM work_events WHERE day = 9 AND actor_id = ? LIMIT 1")
    .get(spawned.agent_handle);
  if (!participated) throw new Error("Growth Agent did not participate on Day 9.");

  execFileSync("npm", ["run", "verify:real-llm"], { stdio: "inherit" });
  console.log(JSON.stringify({ ok: true, boardAutoDirective: board.autoDirective, growthAgent: spawned.agent_handle }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
