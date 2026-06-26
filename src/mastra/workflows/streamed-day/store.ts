import { randomUUID } from "node:crypto";
import { dbAll, dbFirst, dbRun } from "@/db/connection";
import { listEvents } from "@/db/sim";
import type { LlmTurn, LlmTurnKind, LlmTurnStatus, RunSnapshot, StreamedDayRun, StreamedRunPhase, StreamedRunStatus } from "./types";

type RunRow = {
  id: string; day: number; status: StreamedRunStatus; phase: StreamedRunPhase; target_days: number;
  thread_id: string; runtime_id: string; agent_queue: string; next_turn_no: number;
  total_input_tokens: number; total_output_tokens: number; error: string | null;
  created_at: string; updated_at: string;
};

type TurnRow = {
  id: string; run_id: string; day: number; kind: LlmTurnKind; status: LlmTurnStatus;
  agent_id: string; agent_name: string; role_template: string; turn_no: number; prompt: string;
  mentioned_by: string | null; output_text: string | null; input_tokens: number; output_tokens: number;
  metadata: string | null; error: string | null; created_at: string; updated_at: string;
};

let ensured = false;

export async function ensureStreamedDayTables() {
  if (ensured) return;
  await dbRun(`CREATE TABLE IF NOT EXISTS sim_day_runs (
    id TEXT PRIMARY KEY, day INTEGER NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL,
    target_days INTEGER NOT NULL DEFAULT 1, thread_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
    agent_queue TEXT NOT NULL, next_turn_no INTEGER NOT NULL DEFAULT 1,
    total_input_tokens INTEGER NOT NULL DEFAULT 0, total_output_tokens INTEGER NOT NULL DEFAULT 0,
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS sim_llm_turns (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, day INTEGER NOT NULL, kind TEXT NOT NULL,
    status TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, role_template TEXT NOT NULL,
    turn_no INTEGER NOT NULL, prompt TEXT NOT NULL, mentioned_by TEXT, output_text TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    metadata TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_sim_day_runs_status ON sim_day_runs(status, day)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_sim_llm_turns_run ON sim_llm_turns(run_id, status, turn_no)");
  ensured = true;
}

export async function createRun(input: {
  day: number; targetDays: number; threadId: string; runtimeId: string; agentQueue: string[];
}) {
  await ensureStreamedDayTables();
  const now = new Date().toISOString();
  const id = randomUUID();
  await dbRun(
    `INSERT INTO sim_day_runs (id, day, status, phase, target_days, thread_id, runtime_id, agent_queue, created_at, updated_at)
     VALUES (?, ?, 'running', 'chat', ?, ?, ?, ?, ?, ?)`,
    id, input.day, input.targetDays, input.threadId, input.runtimeId, JSON.stringify(input.agentQueue), now, now,
  );
  return getRun(id);
}

export async function getRun(id: string) {
  await ensureStreamedDayTables();
  const row = await dbFirst<RunRow>("SELECT * FROM sim_day_runs WHERE id = ?", id);
  return row ? mapRun(row) : null;
}

export async function getActiveRun() {
  await ensureStreamedDayTables();
  const row = await dbFirst<RunRow>(
    "SELECT * FROM sim_day_runs WHERE status = 'running' ORDER BY day DESC, created_at DESC LIMIT 1",
  );
  return row ? mapRun(row) : null;
}

export async function updateRun(id: string, patch: Partial<Pick<StreamedDayRun, "status" | "phase" | "nextTurnNo" | "totalInputTokens" | "totalOutputTokens" | "error">>) {
  const current = await getRun(id);
  if (!current) throw new Error(`Run not found: ${id}`);
  await dbRun(
    `UPDATE sim_day_runs SET status = ?, phase = ?, next_turn_no = ?, total_input_tokens = ?,
     total_output_tokens = ?, error = ?, updated_at = ? WHERE id = ?`,
    patch.status ?? current.status,
    patch.phase ?? current.phase,
    patch.nextTurnNo ?? current.nextTurnNo,
    patch.totalInputTokens ?? current.totalInputTokens,
    patch.totalOutputTokens ?? current.totalOutputTokens,
    patch.error === undefined ? current.error : patch.error,
    new Date().toISOString(),
    id,
  );
  return getRun(id);
}

export async function createTurn(input: {
  runId: string; day: number; kind: LlmTurnKind; agentId: string; agentName: string;
  roleTemplate: string; turnNo: number; prompt: string; mentionedBy?: string | null; metadata?: Record<string, unknown>;
}) {
  await ensureStreamedDayTables();
  const now = new Date().toISOString();
  const id = randomUUID();
  await dbRun(
    `INSERT INTO sim_llm_turns (id, run_id, day, kind, status, agent_id, agent_name, role_template, turn_no,
      prompt, mentioned_by, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.runId, input.day, input.kind, input.agentId, input.agentName, input.roleTemplate,
    input.turnNo, input.prompt, input.mentionedBy ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null, now, now,
  );
  return getTurn(id);
}

export async function getTurn(id: string) {
  await ensureStreamedDayTables();
  const row = await dbFirst<TurnRow>("SELECT * FROM sim_llm_turns WHERE id = ?", id);
  return row ? mapTurn(row) : null;
}

export async function listTurns(runId: string, status?: LlmTurnStatus) {
  await ensureStreamedDayTables();
  const rows = status
    ? await dbAll<TurnRow>("SELECT * FROM sim_llm_turns WHERE run_id = ? AND status = ? ORDER BY turn_no, created_at", runId, status)
    : await dbAll<TurnRow>("SELECT * FROM sim_llm_turns WHERE run_id = ? ORDER BY turn_no, created_at", runId);
  return rows.map(mapTurn);
}

export async function updateTurn(id: string, patch: Partial<Pick<LlmTurn, "status" | "outputText" | "inputTokens" | "outputTokens" | "metadata" | "error">>) {
  const current = await getTurn(id);
  if (!current) throw new Error(`Turn not found: ${id}`);
  await dbRun(
    `UPDATE sim_llm_turns SET status = ?, output_text = ?, input_tokens = ?, output_tokens = ?,
     metadata = ?, error = ?, updated_at = ? WHERE id = ?`,
    patch.status ?? current.status,
    patch.outputText === undefined ? current.outputText : patch.outputText,
    patch.inputTokens ?? current.inputTokens,
    patch.outputTokens ?? current.outputTokens,
    patch.metadata === undefined ? (current.metadata ? JSON.stringify(current.metadata) : null) : JSON.stringify(patch.metadata),
    patch.error === undefined ? current.error : patch.error,
    new Date().toISOString(),
    id,
  );
  return getTurn(id);
}

export async function getSnapshot(runId: string): Promise<RunSnapshot> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  return { run, pendingTurns: await listTurns(runId, "pending"), events: await listEvents(run.day) };
}

function mapRun(row: RunRow): StreamedDayRun {
  return {
    id: row.id, day: row.day, status: row.status, phase: row.phase, targetDays: row.target_days,
    threadId: row.thread_id, runtimeId: row.runtime_id, agentQueue: JSON.parse(row.agent_queue) as string[],
    nextTurnNo: row.next_turn_no, totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapTurn(row: TurnRow): LlmTurn {
  return {
    id: row.id, runId: row.run_id, day: row.day, kind: row.kind, status: row.status,
    agentId: row.agent_id, agentName: row.agent_name, roleTemplate: row.role_template,
    turnNo: row.turn_no, prompt: row.prompt, mentionedBy: row.mentioned_by, outputText: row.output_text,
    inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
