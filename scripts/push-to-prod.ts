/**
 * push-to-prod.ts
 *
 * 将本地 SQLite 数据（sim.db + agidaily.db）推送到 Cloudflare D1 远程生产环境。
 * 基于 ensure-local-d1.ts 的导出逻辑，使用 --remote 而非 --local。
 *
 * 用法:
 *   tsx scripts/push-to-prod.ts               # 推送模拟数据 + 近 30 天文章
 *   tsx scripts/push-to-prod.ts --sim-only    # 仅推送模拟数据
 *   tsx scripts/push-to-prod.ts --all-articles # 推送全量文章
 *   tsx scripts/push-to-prod.ts --dry-run     # 仅生成 SQL 文件不执行
 */

import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const databaseName = "npc-db";
const schemaPath = path.join(root, "src/db/schema.sql");
const simDb = path.join(root, "sim.db");
const articleDb = path.join(root, "agidaily.db");

const simOnly = process.argv.includes("--sim-only");
const allArticles = process.argv.includes("--all-articles");
const dryRun = process.argv.includes("--dry-run");
// 默认推送近 30 天的文章
const articleWindow = "DATE(pub_date) >= DATE('now', '-30 days')";
const rowSeparator = "__NPC_PUSH_ROW_SEPARATOR__";

const simTables = [
  "sim_days",
  "work_events",
  "published_articles",
  "sim_settings",
  "board_directives",
  "board_meetings",
  "layer_snapshots",
  "layer_changes",
  "mission_charter",
  "mission_strategy",
  "mission_okr",
  "mission_okr_progress",
  "tool_registry",
  "tool_grants",
  "tool_calls",
  "memory_entries",
  "memory_writes",
  "memory_reads",
  "memory_links",
  "employees",
  "org_relations",
  "employee_responsibilities",
  "employee_daily_contribution",
  "rules",
  "rule_executions",
  "resource_metrics",
  "daily_settlement",
  "settlement_drivers",
  "ad_inventory",
  "ad_placements",
  "growth_signals",
  "growth_proposals",
  "growth_decisions",
  "growth_observations",
  "employee_soul_snapshots",
  "article_reviews",
  "human_comments",
  "evomap_oauth_tokens",
  "evomap_oauth_states",
];

// 注意：不推送 evomap_oauth_tokens / evomap_oauth_states（含敏感凭证）
const safeProdSimTables = simTables.filter(
  (t) => t !== "evomap_oauth_tokens" && t !== "evomap_oauth_states",
);

type SqlValue = string | number | boolean | null;

function run(command: string, args: string[], options: { maxBuffer?: number } = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    env: {
      ...process.env,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function wrangler(args: string[]) {
  return run("npx", ["wrangler", ...args]);
}

function executeRemoteD1(args: string[]) {
  return wrangler(["d1", "execute", databaseName, "--remote", ...args]);
}

function sqlLiteral(value: SqlValue | boolean | undefined) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqliteJson<T>(dbPath: string, sql: string) {
  const out = run("sqlite3", ["-json", dbPath, sql]);
  return JSON.parse(out || "[]") as T[];
}

function sqlIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

function tableExists(dbPath: string, table: string) {
  const rows = sqliteJson<{ found: number }>(
    dbPath,
    `SELECT COUNT(*) AS found FROM sqlite_master WHERE type='table' AND name=${sqlLiteral(table)}`,
  );
  return Boolean(rows[0]?.found);
}

function tableColumns(dbPath: string, table: string) {
  return sqliteJson<{ name: string }>(dbPath, `PRAGMA table_info(${sqlIdentifier(table)})`);
}

function rowCount(dbPath: string, table: string, where?: string) {
  const whereClause = where ? ` WHERE ${where}` : "";
  const rows = sqliteJson<{ n: number }>(dbPath, `SELECT COUNT(*) AS n FROM ${sqlIdentifier(table)}${whereClause}`);
  return rows[0]?.n ?? 0;
}

function insertStatements(dbPath: string, tables: string[], whereByTable: Record<string, string> = {}) {
  if (!existsSync(dbPath)) return [];
  const statements: string[] = [];
  for (const table of tables) {
    if (!tableExists(dbPath, table)) continue;
    const columns = tableColumns(dbPath, table).map((col) => col.name);
    if (!columns.length) continue;
    const quotedTable = sqlIdentifier(table);
    const quotedColumns = columns.map(sqlIdentifier).join(", ");
    const quotedValues = columns.map((col) => `quote(${sqlIdentifier(col)})`).join(` || ',' || `);
    const where = whereByTable[table] ? ` WHERE ${whereByTable[table]}` : "";
    const sql = `SELECT 'INSERT OR REPLACE INTO ${quotedTable} (${quotedColumns}) VALUES (' || ${quotedValues} || ');${rowSeparator}' FROM ${quotedTable}${where}`;
    const out = run("sqlite3", [dbPath, sql], { maxBuffer: 512 * 1024 * 1024 });
    statements.push(...out.split(rowSeparator).map((s) => s.trim()).filter(Boolean));
  }
  return statements;
}

function writeChunks(statements: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "npc-push-prod-"));
  const chunks: string[] = [];
  let current = "";
  const maxBytes = 3_500_000;
  for (const statement of statements) {
    if (Buffer.byteLength(current) + Buffer.byteLength(statement) + 2 > maxBytes && current) {
      chunks.push(current);
      current = "";
    }
    current += `${statement}\n`;
  }
  if (current) chunks.push(current);
  const files = chunks.map((chunk, index) => {
    const file = path.join(dir, `chunk-${String(index + 1).padStart(3, "0")}.sql`);
    writeFileSync(file, chunk);
    return file;
  });
  console.log(`  生成 SQL 文件目录: ${dir}`);
  return files;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function printPlan() {
  console.log("\n===== 推送计划 =====");

  if (!existsSync(simDb)) {
    console.warn(`  [警告] sim.db 不存在: ${simDb}`);
  } else {
    const days = rowCount(simDb, "sim_days");
    const events = rowCount(simDb, "work_events");
    const articles = rowCount(simDb, "published_articles");
    console.log(`  sim.db        → ${days} 天模拟数据 / ${events} 条事件 / ${articles} 篇文章`);
  }

  if (!simOnly) {
    if (!existsSync(articleDb)) {
      console.warn(`  [警告] agidaily.db 不存在: ${articleDb}`);
    } else {
      const where = allArticles ? undefined : articleWindow;
      const items = rowCount(articleDb, "items", where);
      console.log(`  agidaily.db   → ${items} 条文章${allArticles ? "（全量）" : "（近 30 天）"}`);
    }
  }

  console.log(`  目标数据库    → Cloudflare D1 远程: ${databaseName}`);
  console.log(`  操作方式      → 先重建 Schema，再 INSERT OR REPLACE（不删除 OAuth token）`);
  if (dryRun) console.log("  模式          → Dry Run（只生成 SQL 文件，不执行）");
  console.log("====================\n");
}

async function main() {
  await printPlan();

  if (!dryRun) {
    const ok = await confirm("确认将本地数据推送到生产 D1？这会覆盖生产数据。[y/N] ");
    if (!ok) {
      console.log("已取消。");
      process.exit(0);
    }
  }

  console.log("\n[1/3] 读取本地数据，生成 INSERT 语句...");
  const schema = readFileSync(schemaPath, "utf8");
  const dropSql = [
    "DROP VIEW IF EXISTS sim_events;",
    ...safeProdSimTables.map((t) => `DROP TABLE IF EXISTS ${sqlIdentifier(t)};`),
    ...(simOnly ? [] : [`DROP TABLE IF EXISTS "items";`]),
  ].join("\n");

  const statements: string[] = [dropSql, schema];

  if (existsSync(simDb)) {
    const simStatements = insertStatements(simDb, safeProdSimTables);
    console.log(`  sim.db: ${simStatements.length} 条 INSERT`);
    statements.push(...simStatements);
  }

  if (!simOnly && existsSync(articleDb)) {
    const where: Record<string, string> = allArticles ? {} : { items: articleWindow };
    const articleStatements = insertStatements(articleDb, ["items"], where);
    console.log(`  agidaily.db: ${articleStatements.length} 条 INSERT`);
    statements.push(...articleStatements);
  }

  console.log("\n[2/3] 切分 SQL 为多个 chunk 文件...");
  const files = writeChunks(statements);
  console.log(`  共 ${files.length} 个 chunk`);

  if (dryRun) {
    console.log("\n[Dry Run] SQL 文件已生成，跳过执行。文件列表:");
    for (const f of files) console.log(`  ${f}`);
    console.log("\nDry Run 完成。");
    return;
  }

  console.log("\n[3/3] 上传到 Cloudflare D1 远程...");
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const label = path.basename(file);
    process.stdout.write(`  执行 ${label} (${i + 1}/${files.length})...`);
    try {
      executeRemoteD1(["--file", file]);
      console.log(" ✓");
    } catch (err) {
      console.log(" ✗");
      console.error(`  上传失败: ${file}`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  console.log("\n推送完成！生产 D1 已更新。");
}

main().catch((err) => {
  console.error("推送失败:", err);
  process.exit(1);
});
