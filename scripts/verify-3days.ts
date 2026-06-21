import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { resetSimDb } = await import("../src/db/connection");
  const { countSourceArticles } = await import("../src/db/articles");
  const { listDays, listEvents, listPublishedArticles, setStatus } = await import("../src/db/sim");
  const { runDailyWorkflow } = await import("../src/mastra");

  await resetSimDb();
  await setStatus("idle");
  const sourceCount = await countSourceArticles();
  if (sourceCount < 30) throw new Error(`Expected at least 30 source articles, got ${sourceCount}`);

  for (let day = 1; day <= 3; day += 1) {
    console.log(`[verify:3days] starting day ${day}`);
    await runDailyWorkflow(day);
    console.log(`[verify:3days] completed day ${day}`);
  }

  const days = (await listDays()).sort((a, b) => a.day - b.day);
  if (days.length !== 3) throw new Error(`Expected 3 days, got ${days.length}`);

  for (const day of days) {
    const articles = await listPublishedArticles(day.day);
    const events = await listEvents(day.day);
    if (articles.length !== 10) throw new Error(`Day ${day.day} expected 10 articles, got ${articles.length}`);
    if (!events.some((event) => event.eventType === "decision")) throw new Error(`Day ${day.day} missing decision events`);
    if (!events.some((event) => event.eventType === "tool_call")) throw new Error(`Day ${day.day} missing tool call events`);
  }

  console.log(JSON.stringify({ ok: true, sourceCount, days }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
