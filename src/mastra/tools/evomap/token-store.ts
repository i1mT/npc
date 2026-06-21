import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const STORE_DIR = path.join(process.cwd(), ".evomap");
const TOKEN_PATH = path.join(STORE_DIR, "oauth-token.json");
const STATE_PATH = path.join(STORE_DIR, "oauth-state.json");
const STATE_TTL_MS = 10 * 60 * 1000;

export type EvoMapTokenRecord = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt: number;
  issuedAt: number;
  livemode?: boolean;
};

type PendingStateRecord = {
  verifier: string;
  createdAt: number;
};

type PendingStateStore = Record<string, PendingStateRecord>;

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
  const states = await readPendingStates();
  states[state] = { verifier, createdAt: Date.now() };
  await writeJson(STATE_PATH, pruneStates(states));
}

export async function consumePendingState(state: string) {
  const states = await readPendingStates();
  const record = states[state];
  delete states[state];
  await writeJson(STATE_PATH, pruneStates(states));
  if (!record || Date.now() - record.createdAt > STATE_TTL_MS) return null;
  return record.verifier;
}

export async function readToken() {
  try {
    return JSON.parse(await readFile(TOKEN_PATH, "utf8")) as EvoMapTokenRecord;
  } catch {
    return null;
  }
}

export async function saveToken(token: EvoMapTokenRecord) {
  await writeJson(TOKEN_PATH, token);
}

export async function clearToken() {
  await rm(TOKEN_PATH, { force: true });
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

async function readPendingStates(): Promise<PendingStateStore> {
  try {
    return pruneStates(JSON.parse(await readFile(STATE_PATH, "utf8")) as PendingStateStore);
  } catch {
    return {};
  }
}

function pruneStates(states: PendingStateStore) {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(states).filter(([, item]) => now - item.createdAt <= STATE_TTL_MS),
  );
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => undefined);
}
