import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file: string) {
  return fs.existsSync(path.join(root, file));
}

function walk(dir: string, files: string[] = []) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return files;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(relative, files);
    else files.push(relative);
  }
  return files;
}

function checkStaticAcceptance() {
  if (exists("src/mastra/local-model.ts")) fail("A-1: src/mastra/local-model.ts still exists.");
  const sourceFiles = walk("src").filter((file) => /\.(ts|tsx)$/.test(file));
  for (const file of sourceFiles) {
    const content = read(file);
    for (const pattern of [/localMastraModel/, /NPC_AGENT_CONTEXT/, /npc-deterministic/]) {
      if (pattern.test(content)) fail(`A-1: forbidden stub marker ${pattern} found in ${file}.`);
    }
  }
  const evomap = read("src/mastra/runtime/evomap-model.ts");
  if (!evomap.includes("createOpenAI") || !evomap.includes(".chat(")) {
    fail("A-2: EVOMAP model is not configured for real Chat Completions HTTP calls.");
  }
  const collaboration = read("src/mastra/collaboration.ts");
  for (const marker of ["executeLocalTool", "planEditorialAgenda", "composeEditorialDrafts", "auditEditorialDrafts", "NPC_AGENT_CONTEXT"]) {
    if (collaboration.includes(marker)) fail(`B/C: old deterministic collaboration marker remains: ${marker}.`);
  }
  for (const marker of ["AbortSignal.timeout(30000)", "jsonOnlyPrompt", "parseStructuredText", "llm_step_error"]) {
    if (!collaboration.includes(marker)) fail(`Risk control: collaboration is missing ${marker}.`);
  }
  const schema = read("src/mastra/runtime/schemas.ts");
  for (const marker of ["contentZh: z.string().min(150).max(400)", "editorNoteSchema", "boardDirectiveSchema", "weeklyReportSchema"]) {
    if (!schema.includes(marker)) fail(`Schema: missing expected marker ${marker}.`);
  }
  const daily = read("src/mastra/workflows/daily-workflow.ts");
  for (const marker of ["runStructuredStep", "runTextStep", "runGrowthProtocol", "runGrowthDistributionIfAvailable", "generateWeeklyReportForBoard"]) {
    if (!daily.includes(marker)) fail(`Workflow: missing expected real-LLM marker ${marker}.`);
  }
}

function tableExists(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(table);
  return Boolean(row);
}

function columnExists(db: Database.Database, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

function one<T>(db: Database.Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).get(...params) as T | undefined;
}

function all<T>(db: Database.Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).all(...params) as T[];
}

function checkDatabaseAcceptance() {
  const dbPath = path.join(root, "sim.db");
  if (!fs.existsSync(dbPath)) {
    fail("DB: sim.db does not exist. Run a real 7-day acceptance flow first.");
    return;
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    checkSchema(db);
    checkArticles(db);
    checkEvents(db);
    checkMemory(db);
    checkGrowth(db);
    checkBoard(db);
    checkPortal(db);
    checkEndToEnd(db);
  } finally {
    db.close();
  }
}

function checkSchema(db: Database.Database) {
  if (!columnExists(db, "sim_days", "editor_note")) fail("G-1: sim_days.editor_note column missing.");
  if (!columnExists(db, "board_meetings", "auto_directive")) fail("F-2: board_meetings.auto_directive column missing.");
  if (!columnExists(db, "board_meetings", "auto_directive_reason")) fail("F-2: board_meetings.auto_directive_reason column missing.");
}

function checkArticles(db: Database.Database) {
  if (!tableExists(db, "published_articles")) return;
  const stats = one<{ total: number; uniqueTitles: number; maxTitle: number | null; minTitle: number | null; minContent: number | null; avgContent: number | null }>(
    db,
    "SELECT count(*) AS total, count(DISTINCT title_zh) AS uniqueTitles, max(length(title_zh)) AS maxTitle, min(length(title_zh)) AS minTitle, min(length(content_zh)) AS minContent, avg(length(content_zh)) AS avgContent FROM published_articles",
  );
  if (!stats || stats.total === 0) {
    fail("B/H: no published_articles rows. Run real LLM workflow first.");
    return;
  }
  if ((stats.maxTitle ?? 99) > 20 || (stats.minTitle ?? 0) < 4) fail("B-1: title length constraints failed.");
  if ((stats.minContent ?? 0) < 150 || (stats.avgContent ?? 0) < 150) fail("B-4: content length constraints failed.");
  if (stats.total >= 70 && stats.uniqueTitles !== stats.total) fail("H-3: 70 article titles are not all unique.");
  const oldTitle = one(db, "SELECT title_zh FROM published_articles WHERE title_zh LIKE '%押注%' OR title_zh LIKE '%新信号%' OR title_zh LIKE '%出现%' OR title_zh LIKE '%产业%' LIMIT 1");
  if (oldTitle) fail("B-2: old title template vocabulary found.");
  const oldSummary = one(db, "SELECT summary_zh FROM published_articles WHERE summary_zh LIKE '第 % 期关注%' LIMIT 1");
  if (oldSummary) fail("B-5: old summary template found.");
  const noEditorialView = one(db, "SELECT id FROM published_articles WHERE content_zh NOT LIKE '%编辑部%' AND content_zh NOT LIKE '%为什么%' AND content_zh NOT LIKE '%关注%' AND content_zh NOT LIKE '%判断%' AND content_zh NOT LIKE '%影响%' LIMIT 1");
  if (noEditorialView) fail("B-3: at least one article lacks editorial perspective language.");
}

function checkEvents(db: Database.Database) {
  if (!tableExists(db, "sim_events")) return;
  const missingThread = one(db, "SELECT day FROM sim_events GROUP BY day HAVING count(DISTINCT json_extract(metadata, '$.mastraThreadId')) != 1 LIMIT 1");
  if (missingThread) fail("C-4: a day does not have exactly one mastraThreadId.");
  const genericDraft = one(db, "SELECT id FROM sim_events WHERE content LIKE '提交 % 篇稿件%' OR content LIKE '工具返回 % 篇候选文章%' LIMIT 1");
  if (genericDraft) fail("C/H: old generic event content found.");
  const titleRows = all<{ title_zh: string }>(db, "SELECT title_zh FROM published_articles ORDER BY day, rowid LIMIT 20");
  const messages = all<{ content: string }>(db, "SELECT content FROM sim_events WHERE event_type='message' ORDER BY day, seq LIMIT 80");
  if (titleRows.length && !messages.some((event) => titleRows.some((row) => event.content.includes(row.title_zh.slice(0, 4))))) {
    fail("C-1: message events do not mention concrete article titles.");
  }
  const weakReview = one(db, "SELECT id FROM sim_events WHERE event_type='decision' AND length(content) >= 30 LIMIT 1");
  if (!weakReview) fail("C-2: no substantive review/decision event found.");
}

function checkMemory(db: Database.Database) {
  const memoryPath = path.join(root, "memory.db");
  if (!fs.existsSync(memoryPath) || fs.statSync(memoryPath).size <= 0) fail("D-1: memory.db missing or empty.");
  const day2Agenda = one<{ content: string }>(db, "SELECT content FROM sim_events WHERE event_type='decision' AND day=2 ORDER BY seq LIMIT 1");
  if (day2Agenda && !/[0-9]|均分|Day 1|第 1/.test(day2Agenda.content)) fail("D-2: Day 2 agenda does not cite historical topic data.");
  const day3Agenda = one<{ content: string }>(db, "SELECT content FROM sim_events WHERE event_type='decision' AND day=3 ORDER BY seq LIMIT 1");
  const topTag = one<{ tag: string }>(db, "SELECT json_extract(value, '$') AS tag FROM published_articles, json_each(published_articles.tags) GROUP BY tag ORDER BY avg(quality_score) DESC LIMIT 1");
  if (day3Agenda && topTag?.tag && !day3Agenda.content.includes(topTag.tag)) fail("D-3: Day 3 agenda does not reference the top-performing topic.");
}

function checkGrowth(db: Database.Database) {
  const thresholdHit = one(
    db,
    "SELECT day FROM sim_days WHERE dau > 10000 OR ad_revenue > 30000 ORDER BY day LIMIT 1",
  );
  if (!thresholdHit) return;
  const spawn = one(db, "SELECT id FROM work_events WHERE event_type='org_change' AND action='spawn_agent' LIMIT 1");
  if (!spawn) fail("E-1: no growth spawn_agent org_change event found.");
  const employee = one<{ agent_handle: string; joined_day: number; status: string }>(db, "SELECT agent_handle, joined_day, status FROM employees WHERE role_template IN ('growth','business','column') AND joined_day > 1 ORDER BY joined_day LIMIT 1");
  if (!employee || employee.status !== "active") {
    fail("E-2: no active spawned growth/business/column employee found.");
    return;
  }
  const participation = one(db, "SELECT id FROM work_events WHERE actor_id=? AND day>=? LIMIT 1", employee.agent_handle, employee.joined_day);
  if (!participation) fail("E-3: spawned Agent does not appear in later event flow.");
}

function checkBoard(db: Database.Database) {
  const meeting = one<{ day: number; status: string; auto_directive: string | null; auto_directive_reason: string | null; directive: string | null; weekly_report: string }>(
    db,
    "SELECT day, status, auto_directive, auto_directive_reason, directive, weekly_report FROM board_meetings ORDER BY day DESC LIMIT 1",
  );
  if (!meeting) {
    fail("F/H-6: no board meeting row found.");
    return;
  }
  const summary = safeJson(meeting.weekly_report).summary;
  if (typeof summary !== "string" || summary.length < 50 || !/[0-9]/.test(summary)) fail("F-1: weekly report summary is not substantive LLM output.");
  if (!meeting.auto_directive || !["ADJUST_OKR", "STRATEGIC_PIVOT", "INJECT_CAPITAL", "RESTRUCTURE", "AMEND_CONSTITUTION", "MAINTAIN"].includes(meeting.auto_directive)) fail("F-2: auto_directive missing or invalid.");
  if (!meeting.auto_directive_reason || meeting.auto_directive_reason.length < 30 || !/[0-9]|DAU|Capital|Reputation/.test(meeting.auto_directive_reason)) fail("F-2: auto_directive_reason lacks concrete report data.");
  if (/夸大|牺牲内容质量|未经证实/.test(meeting.auto_directive_reason ?? "")) fail("F-3: auto directive reason violates constitutional constraints.");
}

function checkPortal(db: Database.Database) {
  const notes = all<{ day: number; editor_note: string | null; length: number | null }>(db, "SELECT day, editor_note, length(editor_note) AS length FROM sim_days ORDER BY day");
  if (!notes.length) return;
  if (notes.some((row) => !row.editor_note || (row.length ?? 0) < 20)) fail("G-1: editor_note missing or too short.");
  if (new Set(notes.map((row) => row.editor_note)).size !== notes.length) fail("G-1: editor notes are not unique across days.");
  const unrelated = one(db, "SELECT s.day FROM sim_days s WHERE s.editor_note IS NOT NULL AND NOT EXISTS (SELECT 1 FROM published_articles a, json_each(a.tags) tag WHERE a.day=s.day AND s.editor_note LIKE '%' || tag.value || '%') LIMIT 1");
  if (unrelated) fail("G-2: at least one editor_note does not mention a same-day tag.");
}

function checkEndToEnd(db: Database.Database) {
  const days = all<{ day: number; done: number }>(db, "SELECT day, completed_at IS NOT NULL AS done FROM sim_days ORDER BY day");
  if (days.length < 7 || days.some((day) => day.done !== 1)) fail("H-1: 7 completed days are required.");
  const articleTotal = one<{ total: number }>(db, "SELECT count(*) AS total FROM published_articles");
  if ((articleTotal?.total ?? 0) < 70) fail("H-3: 70 published articles are required.");
  const thinEvents = one(db, "SELECT day FROM work_events GROUP BY day HAVING count(DISTINCT event_type) < 6 LIMIT 1");
  if (thinEvents) fail("H-2: at least one day has fewer than 6 event types.");
  const zeroToken = one(db, "SELECT day FROM work_events GROUP BY day HAVING sum(cost_token) <= 0 LIMIT 1");
  if (zeroToken) fail("H-4: at least one day has no recorded token usage.");
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

checkStaticAcceptance();
checkDatabaseAcceptance();

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true }, null, 2));
