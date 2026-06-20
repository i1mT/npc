import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const simDbPath = path.join(root, "sim.db");
const agiDailyDbPath = path.join(root, "agidaily.db");

let simDb: Database.Database | null = null;
let articleDb: Database.Database | null = null;

export function getSimDb() {
  if (!simDb) {
    simDb = new Database(simDbPath);
    simDb.pragma("journal_mode = WAL");
    simDb.pragma("foreign_keys = ON");
    migrateSimEventsTable(simDb);
    const schema = fs.readFileSync(path.join(root, "src/db/schema.sql"), "utf8");
    simDb.exec(schema);
  }
  return simDb;
}

function migrateSimEventsTable(db: Database.Database) {
  const row = db.prepare("SELECT type FROM sqlite_master WHERE name = 'sim_events'").get() as { type: string } | undefined;
  if (row?.type !== "table") return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_events (
      id TEXT PRIMARY KEY,
      day INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      layer TEXT NOT NULL,
      event_type TEXT NOT NULL,
      action TEXT NOT NULL,
      content TEXT,
      payload TEXT,
      refs TEXT,
      cost_token INTEGER NOT NULL DEFAULT 0,
      cost_yuan REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO work_events (id, day, seq, ts, actor_id, actor_name, actor_type, layer, event_type, action, content, payload, refs, cost_token, cost_yuan, created_at)
    SELECT id, day, seq, created_at, agent_id, agent_name, 'agent', 'work', event_type, event_type, content, metadata, NULL, 0, 0, created_at
    FROM sim_events;
    DROP TABLE sim_events;
  `);
}

export function getArticleDb() {
  if (!articleDb) {
    if (!fs.existsSync(agiDailyDbPath)) {
      throw new Error(`Missing agidaily.db at ${agiDailyDbPath}`);
    }
    articleDb = new Database(agiDailyDbPath, { readonly: true, fileMustExist: true });
  }
  return articleDb;
}

export function resetSimDb() {
  const db = getSimDb();
  db.exec(`
    DELETE FROM board_meetings;
    DELETE FROM board_directives;
    DELETE FROM growth_observations;
    DELETE FROM growth_decisions;
    DELETE FROM growth_proposals;
    DELETE FROM growth_signals;
    DELETE FROM ad_placements;
    DELETE FROM settlement_drivers;
    DELETE FROM daily_settlement;
    DELETE FROM resource_metrics;
    DELETE FROM rule_executions;
    DELETE FROM employee_daily_contribution;
    DELETE FROM employee_responsibilities;
    DELETE FROM org_relations;
    DELETE FROM employees;
    DELETE FROM memory_links;
    DELETE FROM memory_reads;
    DELETE FROM memory_writes;
    DELETE FROM memory_entries;
    DELETE FROM tool_calls;
    DELETE FROM tool_grants;
    DELETE FROM layer_changes;
    DELETE FROM layer_snapshots;
    DELETE FROM work_events;
    DELETE FROM published_articles;
    DELETE FROM sim_days;
    DELETE FROM sim_settings;
  `);
}
