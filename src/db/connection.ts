import { randomUUID } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    NPC_DB: D1Database;
  }
}

export type SqlParam = string | number | boolean | null;

export async function getDb() {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.NPC_DB) {
    throw new Error("Missing Cloudflare D1 binding NPC_DB.");
  }
  return env.NPC_DB;
}

export const getSimDb = getDb;
export const getArticleDb = getDb;

export async function dbFirst<T>(sql: string, ...params: SqlParam[]) {
  const db = await getDb();
  return db.prepare(sql).bind(...params).first<T>();
}

export async function dbAll<T>(sql: string, ...params: SqlParam[]) {
  const db = await getDb();
  const result = await db.prepare(sql).bind(...params).all<T>();
  if (!result.success) throw new Error(result.error ?? `D1 query failed: ${sql}`);
  return result.results ?? [];
}

export async function dbRun(sql: string, ...params: SqlParam[]) {
  const db = await getDb();
  const result = await db.prepare(sql).bind(...params).run();
  if (!result.success) throw new Error(result.error ?? `D1 statement failed: ${sql}`);
  return result;
}

export async function dbBatch(statements: D1PreparedStatement[]) {
  const db = await getDb();
  const results = await db.batch(statements);
  const failed = results.find((result) => !result.success);
  if (failed) throw new Error(failed.error ?? "D1 batch failed.");
  return results;
}

export async function dbExec(sql: string) {
  const db = await getDb();
  return db.exec(sql);
}

export async function upsertSoulSnapshot(employeeId: string, day: number, soulMd: string, memoryMd: string) {
  await dbRun(
    `INSERT INTO employee_soul_snapshots (id, employee_id, day, soul_md, memory_md, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(employee_id, day) DO UPDATE SET soul_md=excluded.soul_md, memory_md=excluded.memory_md`,
    randomUUID(),
    employeeId,
    day,
    soulMd,
    memoryMd,
  );
}

export async function getSoulSnapshots(employeeId: string) {
  return dbAll<{ day: number; soul_md: string; memory_md: string }>(
    "SELECT day, soul_md, memory_md FROM employee_soul_snapshots WHERE employee_id = ? ORDER BY day DESC",
    employeeId,
  );
}

export async function rollbackToDay(targetDay: number) {
  const tables = [
    "work_events",
    "published_articles",
    "daily_settlement",
    "settlement_drivers",
    "board_meetings",
    "board_directives",
    "article_reviews",
    "human_comments",
    "sim_llm_turns",
    "sim_day_runs",
    "layer_snapshots",
    "layer_changes",
    "employee_soul_snapshots",
    "growth_observations",
    "growth_proposals",
    "growth_signals",
    "sim_days",
  ];
  const db = await getDb();
  await dbBatch([
    ...tables.map((table) => db.prepare(`DELETE FROM ${table} WHERE day > ?`).bind(targetDay)),
    db.prepare("DELETE FROM growth_decisions WHERE decided_day > ?").bind(targetDay),
    db.prepare("DELETE FROM employees WHERE joined_day > ?").bind(targetDay),
  ]);

  const lastDay = await dbFirst<{
    capital: number;
    reputation: number;
    dau: number;
    subscribers: number;
    ad_revenue: number;
  }>("SELECT capital, reputation, dau, subscribers, ad_revenue FROM sim_days WHERE day = ?", targetDay);
  if (!lastDay) return;
  await dbBatch([
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)").bind("capital", lastDay.capital, targetDay),
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)").bind("reputation", lastDay.reputation, targetDay),
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)").bind("dau", lastDay.dau, targetDay),
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)").bind("subscribers", lastDay.subscribers, targetDay),
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)").bind("ad_revenue", lastDay.ad_revenue, targetDay),
  ]);
}

export async function resetSimDb() {
  await dbExec(`
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
    DELETE FROM sim_llm_turns;
    DELETE FROM sim_day_runs;
    DELETE FROM sim_days;
    DELETE FROM sim_settings;
  `);
}
