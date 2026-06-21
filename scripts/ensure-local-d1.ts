import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const databaseName = "npc-db";
const schemaPath = path.join(root, "src/db/schema.sql");
const reset = process.argv.includes("--reset");
const allArticles = process.argv.includes("--all-articles");
const articleWindow = "DATE(pub_date) BETWEEN '2026-05-31' AND '2026-06-30'";
const rowSeparator = "__NPC_LOCAL_D1_ROW_SEPARATOR__";
const projectTables = [
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
  "items",
];

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

function executeLocalD1(args: string[]) {
  return wrangler(["d1", "execute", databaseName, "--local", ...args]);
}

function localD1Ready() {
  if (reset) return false;
  try {
    const out = executeLocalD1([
      "--json",
      "--command",
      `SELECT
        (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sim_days') AS has_sim_days,
        (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='items') AS has_items,
        (SELECT COUNT(*) FROM items) AS item_count`,
    ]);
    const parsed = JSON.parse(out) as Array<{ results?: Array<{ has_sim_days: number; has_items: number; item_count: number }> }>;
    const row = parsed[0]?.results?.[0];
    return Boolean(row?.has_sim_days && row.has_items && row.item_count > 0);
  } catch {
    return false;
  }
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

function insertStatements(dbPath: string, tables: string[], whereByTable: Record<string, string> = {}) {
  if (!existsSync(dbPath)) return [];
  const statements: string[] = [];
  for (const table of tables) {
    if (!tableExists(dbPath, table)) continue;
    const columns = tableColumns(dbPath, table).map((column) => column.name);
    if (!columns.length) continue;
    const quotedTable = sqlIdentifier(table);
    const quotedColumns = columns.map(sqlIdentifier).join(", ");
    const quotedValues = columns.map((column) => `quote(${sqlIdentifier(column)})`).join(` || ',' || `);
    const where = whereByTable[table] ? ` WHERE ${whereByTable[table]}` : "";
    const sql = `SELECT 'INSERT OR REPLACE INTO ${quotedTable} (${quotedColumns}) VALUES (' || ${quotedValues} || ');${rowSeparator}' FROM ${quotedTable}${where}`;
    const out = run("sqlite3", [dbPath, sql], { maxBuffer: 512 * 1024 * 1024 });
    statements.push(...out.split(rowSeparator).map((statement) => statement.trim()).filter(Boolean));
  }
  return statements;
}

function writeChunks(statements: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "npc-local-d1-"));
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
  return chunks.map((chunk, index) => {
    const file = path.join(dir, `chunk-${String(index + 1).padStart(3, "0")}.sql`);
    writeFileSync(file, chunk);
    return file;
  });
}

function importSqlFiles(files: string[]) {
  for (const file of files) {
    executeLocalD1(["--file", file]);
  }
}

function syncLocalD1() {
  const schema = readFileSync(schemaPath, "utf8");
  const dropSql = [
    "DROP VIEW IF EXISTS sim_events;",
    ...projectTables.map((table) => `DROP TABLE IF EXISTS "${table}";`),
  ].join("\n");
  const simDb = path.join(root, "sim.db");
  const articleDb = path.join(root, "agidaily.db");
  const simTables = projectTables.filter((table) => table !== "items");
  const statements = [
    dropSql,
    schema,
    ...insertStatements(simDb, simTables),
    ...insertStatements(articleDb, ["items"], allArticles ? {} : { items: articleWindow }),
  ];
  const files = writeChunks(statements);
  importSqlFiles(files);
  console.log(`Local Wrangler D1 '${databaseName}' is ready (${files.length} SQL chunk${files.length === 1 ? "" : "s"}).`);
}

if (localD1Ready()) {
  console.log(`Local Wrangler D1 '${databaseName}' is already initialized.`);
} else {
  syncLocalD1();
}
