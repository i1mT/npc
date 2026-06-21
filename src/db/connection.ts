import { randomUUID } from "node:crypto";
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
    migrateAddedColumns(simDb);
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

function migrateAddedColumns(db: Database.Database) {
  addColumnIfMissing(db, "sim_days", "editor_note", "TEXT");
  addColumnIfMissing(db, "board_meetings", "auto_directive", "TEXT");
  addColumnIfMissing(db, "board_meetings", "auto_directive_reason", "TEXT");
  addColumnIfMissing(db, "employees", "soul", "TEXT");
  addColumnIfMissing(db, "employees", "tools_granted", "TEXT");
  addColumnIfMissing(db, "employees", "memory", "TEXT");
  addColumnIfMissing(db, "employees", "daily_salary", "REAL NOT NULL DEFAULT 300");
  addColumnIfMissing(db, "sim_days", "labor_cost", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sim_days", "avg_quality", "REAL NOT NULL DEFAULT 0");
}

export function upsertSoulSnapshot(employeeId: string, day: number, soulMd: string, memoryMd: string) {
  const db = getSimDb();
  db.prepare(`
    INSERT INTO employee_soul_snapshots (id, employee_id, day, soul_md, memory_md, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(employee_id, day) DO UPDATE SET soul_md=excluded.soul_md, memory_md=excluded.memory_md
  `).run(randomUUID(), employeeId, day, soulMd, memoryMd);
}

export function getSoulSnapshots(employeeId: string) {
  return getSimDb()
    .prepare("SELECT day, soul_md, memory_md FROM employee_soul_snapshots WHERE employee_id = ? ORDER BY day DESC")
    .all(employeeId) as { day: number; soul_md: string; memory_md: string }[];
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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

export function rollbackToDay(targetDay: number) {
  const db = getSimDb();
  db.exec(`
    DELETE FROM work_events WHERE day > ${targetDay};
    DELETE FROM published_articles WHERE day > ${targetDay};
    DELETE FROM daily_settlement WHERE day > ${targetDay};
    DELETE FROM settlement_drivers WHERE day > ${targetDay};
    DELETE FROM board_meetings WHERE day > ${targetDay};
    DELETE FROM board_directives WHERE day > ${targetDay};
    DELETE FROM article_reviews WHERE day > ${targetDay};
    DELETE FROM human_comments WHERE day > ${targetDay};
    DELETE FROM layer_snapshots WHERE day > ${targetDay};
    DELETE FROM layer_changes WHERE day > ${targetDay};
    DELETE FROM employee_soul_snapshots WHERE day > ${targetDay};
    DELETE FROM growth_observations WHERE day > ${targetDay};
    DELETE FROM growth_decisions WHERE decided_day > ${targetDay};
    DELETE FROM growth_proposals WHERE day > ${targetDay};
    DELETE FROM growth_signals WHERE day > ${targetDay};
    DELETE FROM sim_days WHERE day > ${targetDay};
    DELETE FROM employees WHERE joined_day > ${targetDay};
  `);
  // Restore resource_metrics to values at targetDay
  const lastDay = db
    .prepare("SELECT capital, reputation, dau, subscribers, ad_revenue FROM sim_days WHERE day = ?")
    .get(targetDay) as { capital: number; reputation: number; dau: number; subscribers: number; ad_revenue: number } | undefined;
  if (lastDay) {
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)")
      .run("capital", lastDay.capital, targetDay);
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)")
      .run("reputation", lastDay.reputation, targetDay);
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)")
      .run("dau", lastDay.dau, targetDay);
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)")
      .run("subscribers", lastDay.subscribers, targetDay);
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)")
      .run("ad_revenue", lastDay.ad_revenue, targetDay);
  }
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
    DELETE FROM article_reviews;
    DELETE FROM human_comments;
    DELETE FROM sim_days;
    DELETE FROM sim_settings;
  `);
}
