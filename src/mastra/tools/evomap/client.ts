import { createHash, randomBytes } from "node:crypto";
import {
  clearToken,
  consumePendingState,
  createOAuthState,
  readToken,
  savePendingState,
  saveToken,
  type EvoMapTokenRecord,
} from "@/mastra/tools/evomap/token-store";

const DEFAULT_BASE = "https://evomap.ai";
const DEFAULT_SCOPE = "recipe:read gene:read reuse:query";
const REFRESH_SKEW_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  livemode?: boolean;
};

export class EvoMapConnectRequiredError extends Error {
  code = "connect_required";

  constructor(message = "EvoMap OAuth connection is required.") {
    super(message);
  }
}

export class EvoMapApiError extends Error {
  code: string;
  status: number;
  upstream: unknown;

  constructor(status: number, code: string, upstream: unknown) {
    super(code);
    this.status = status;
    this.code = code;
    this.upstream = upstream;
  }
}

export async function buildAuthorizeUrl() {
  const config = getConfig();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = createOAuthState();
  await savePendingState(state, verifier);
  return `${config.base}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: DEFAULT_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })}`;
}

export async function exchangeAuthorizationCode(code: string, state: string) {
  const verifier = await consumePendingState(state);
  if (!verifier) {
    throw new EvoMapApiError(400, "invalid_oauth_state", { error: "invalid_oauth_state" });
  }
  const config = getConfig();
  const token = await requestToken(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  }));
  await saveToken(toTokenRecord(token));
  return token;
}

export async function getEvoMapAccessToken() {
  const token = await readToken();
  if (!token) throw new EvoMapConnectRequiredError();
  if (token.expiresAt > Date.now() + REFRESH_SKEW_MS) return token.accessToken;
  if (!token.refreshToken) {
    await clearToken();
    throw new EvoMapConnectRequiredError("EvoMap token expired and no refresh token was issued.");
  }
  try {
    const refreshed = await refreshAccessToken(token.refreshToken);
    await saveToken(toTokenRecord(refreshed, token));
    return refreshed.access_token ?? "";
  } catch (error) {
    await clearToken();
    if (error instanceof EvoMapApiError) throw new EvoMapConnectRequiredError("EvoMap token refresh failed.");
    throw error;
  }
}

export async function searchRecipes(input: { q?: string; limit?: number; cursor?: string }) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  params.set("limit", String(input.limit ?? 5));
  if (input.cursor) params.set("cursor", input.cursor);
  return developerGet(`/developer/oauth/recipes?${params}`);
}

export async function getRecipeDetail(id: string) {
  return developerGet(`/developer/oauth/recipes?${new URLSearchParams({ id })}`);
}

export async function listGenes(input: { type?: string; limit?: number; cursor?: string }) {
  const params = new URLSearchParams();
  if (input.type) params.set("type", input.type);
  params.set("limit", String(input.limit ?? 5));
  if (input.cursor) params.set("cursor", input.cursor);
  return developerGet(`/developer/oauth/genes?${params}`);
}

export async function getGeneDetail(id: string) {
  return developerGet(`/developer/oauth/genes?${new URLSearchParams({ id })}`);
}

export async function queryReuse(input: { recipeId?: string; assetId?: string }) {
  const params = new URLSearchParams();
  if (input.recipeId) params.set("recipe_id", input.recipeId);
  if (input.assetId) params.set("asset_id", input.assetId);
  return developerGet(`/developer/oauth/reuse?${params}`);
}

async function developerGet(pathAndQuery: string) {
  const token = await getEvoMapAccessToken();
  const res = await fetch(`${getConfig().base}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await parseJson(res);
  if (res.status === 401) {
    await clearToken();
    throw new EvoMapConnectRequiredError("EvoMap token was rejected. Reconnect EvoMap.");
  }
  if (!res.ok) throw new EvoMapApiError(res.status, "evomap_api_error", data);
  return data;
}

async function refreshAccessToken(refreshToken: string) {
  const config = getConfig();
  return requestToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  }));
}

async function requestToken(body: URLSearchParams) {
  const res = await fetch(`${getConfig().base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await parseJson(res) as TokenResponse | null;
  if (!res.ok || !data?.access_token) {
    throw new EvoMapApiError(res.status, "token_exchange_failed", data);
  }
  return data;
}

async function parseJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { nonJson: true, status: res.status, preview: text.slice(0, 240) };
  }
}

function toTokenRecord(token: TokenResponse, previous?: EvoMapTokenRecord): EvoMapTokenRecord {
  const now = Date.now();
  return {
    accessToken: token.access_token ?? previous?.accessToken ?? "",
    refreshToken: token.refresh_token ?? previous?.refreshToken,
    tokenType: token.token_type ?? previous?.tokenType ?? "Bearer",
    scope: token.scope ?? previous?.scope ?? DEFAULT_SCOPE,
    expiresAt: now + Math.max(1, token.expires_in ?? 3600) * 1000,
    issuedAt: now,
    livemode: token.livemode ?? previous?.livemode,
  };
}

function getConfig() {
  const clientId = process.env.EVOMAP_DEVELOPER_CLIENT_ID;
  const clientSecret = process.env.EVOMAP_DEVELOPER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new EvoMapConnectRequiredError("EvoMap Developer OAuth client is not configured.");
  }
  return {
    clientId,
    clientSecret,
    base: process.env.EVOMAP_DEVELOPER_BASE ?? DEFAULT_BASE,
    redirectUri: process.env.EVOMAP_OAUTH_REDIRECT_URI ?? "http://localhost:3000/api/evomap/oauth/callback",
  };
}
