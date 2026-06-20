import { resetSimDb } from "../src/db/connection";
import { countSourceArticles } from "../src/db/articles";
import { listDays, listEvents, listPublishedArticles, setStatus } from "../src/db/sim";
import { runDailyWorkflow } from "../src/mastra";

async function main() {
  resetSimDb();
  setStatus("idle");
  const sourceCount = countSourceArticles();
  if (sourceCount < 30) throw new Error(`Expected at least 30 source articles, got ${sourceCount}`);

  for (let day = 1; day <= 3; day += 1) {
    await runDailyWorkflow(day);
  }

  const days = listDays().sort((a, b) => a.day - b.day);
  if (days.length !== 3) throw new Error(`Expected 3 days, got ${days.length}`);

  for (const day of days) {
    const articles = listPublishedArticles(day.day);
    const events = listEvents(day.day);
    if (articles.length !== 10) throw new Error(`Day ${day.day} expected 10 articles, got ${articles.length}`);
    if (!events.some((event) => event.eventType === "decision")) throw new Error(`Day ${day.day} missing decision events`);
    if (!events.some((event) => event.eventType === "tool_call")) throw new Error(`Day ${day.day} missing tool call events`);
  }

  console.log(JSON.stringify({ ok: true, sourceCount, days }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
