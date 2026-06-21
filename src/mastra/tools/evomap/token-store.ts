import { randomBytes } from "node:crypto";
import { dbAll, dbFirst, dbRun } from "@/db/connection";

const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_ID = "default";

let initialized = false;

export type EvoMapTokenRecord = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt: number;
  issuedAt: number;
  livemode?: boolean;
};

export type EvoMapOAuthStatus = {
  connected: boolean;
  expired: boolean;
  expiresAt: string | null;
  scope: string | null;
  livemode: boolean | null;
  hasRefreshToken: boolean;
};

export function createOAuthState() {
  return randomBytes(16).toString("base64url");
}

export async function savePendingState(state: string, verifier: string) {
  await ensureTables();
  await pruneExpiredStates();
  await dbRun(
    `INSERT OR REPLACE INTO evomap_oauth_states (state, verifier, created_at)
     VALUES (?, ?, ?)`,
    state,
    verifier,
    Date.now(),
  );
}

export async function consumePendingState(state: string) {
  await ensureTables();
  await pruneExpiredStates();
  const record = await dbFirst<{ verifier: string; created_at: number }>(
    "SELECT verifier, created_at FROM evomap_oauth_states WHERE state = ?",
    state,
  );
  await dbRun("DELETE FROM evomap_oauth_states WHERE state = ?", state);
  if (!record || Date.now() - record.created_at > STATE_TTL_MS) return null;
  return record.verifier;
}

export async function readToken() {
  await ensureTables();
  const row = await dbFirst<{ payload: string }>("SELECT payload FROM evomap_oauth_tokens WHERE id = ?", TOKEN_ID);
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as EvoMapTokenRecord;
  } catch {
    return null;
  }
}

export async function saveToken(token: EvoMapTokenRecord) {
  await ensureTables();
  await dbRun(
    `INSERT OR REPLACE INTO evomap_oauth_tokens (id, payload, updated_at)
     VALUES (?, ?, ?)`,
    TOKEN_ID,
    JSON.stringify(token),
    new Date().toISOString(),
  );
}

export async function clearToken() {
  await ensureTables();
  await dbRun("DELETE FROM evomap_oauth_tokens WHERE id = ?", TOKEN_ID);
}

export async function getOAuthStatus(): Promise<EvoMapOAuthStatus> {
  const token = await readToken();
  if (!token) {
    return {
      connected: false,
      expired: false,
      expiresAt: null,
      scope: null,
      livemode: null,
      hasRefreshToken: false,
    };
  }
  return {
    connected: true,
    expired: token.expiresAt <= Date.now(),
    expiresAt: new Date(token.expiresAt).toISOString(),
    scope: token.scope ?? null,
    livemode: token.livemode ?? null,
    hasRefreshToken: Boolean(token.refreshToken),
  };
}

async function ensureTables() {
  if (initialized) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS evomap_oauth_tokens (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS evomap_oauth_states (
      state TEXT PRIMARY KEY,
      verifier TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  initialized = true;
}

async function pruneExpiredStates() {
  await dbRun("DELETE FROM evomap_oauth_states WHERE created_at < ?", Date.now() - STATE_TTL_MS);
  const rows = await dbAll<{ state: string }>(
    "SELECT state FROM evomap_oauth_states ORDER BY created_at DESC LIMIT 100",
  );
  if (rows.length < 100) return;
  await dbRun(
    `DELETE FROM evomap_oauth_states
     WHERE state NOT IN (SELECT state FROM evomap_oauth_states ORDER BY created_at DESC LIMIT 100)`,
  );
}
