import { randomUUID } from "node:crypto";
import { getSimDb } from "@/db/connection";
import type { BoardMeeting, BoardMeetingStatus, DayState, DaySummary, EventType, LayerName, PublishedArticle, RuleDefinition, SimEvent, SimStatus, WorkEvent } from "@/lib/types";

type DayRow = {
  day: number;
  capital: number;
  reputation: number;
  dau: number;
  subscribers: number;
  ad_revenue: number;
  llm_cost: number;
  is_board_day: number;
  completed_at: string | null;
  article_count?: number;
};

type EventRow = {
  id: string;
  day: number;
  seq: number;
  agent_id: string;
  agent_name: string;
  event_type: EventType;
  content: string;
  metadata: string | null;
  created_at: string;
};

type WorkEventRow = {
  id: string;
  day: number;
  seq: number;
  ts: string;
  actor_id: string;
  actor_name: string;
  actor_type: "agent" | "board" | "system" | "ceo";
  layer: LayerName | "work";
  event_type: WorkEvent["eventType"];
  action: string;
  content: string | null;
  payload: string | null;
  refs: string | null;
  cost_token: number;
  cost_yuan: number;
  created_at: string;
};

type LayerChangeRow = {
  id: string;
  layer: LayerName;
  day: number;
  entity_table: string;
  entity_id: string;
  change_type: string;
  before_json: string | null;
  after_json: string | null;
  caused_by_event: string;
  summary: string;
  created_at: string;
};

type ArticleRow = {
  id: string;
  day: number;
  source_id: string;
  title_zh: string;
  summary_zh: string;
  content_zh: string;
  source_url: string;
  image_url: string | null;
  tags: string | null;
  quality_score: number;
  quality_reason: string;
  created_at: string;
};

type BoardMeetingRow = {
  day: number;
  status: BoardMeetingStatus;
  weekly_report: string;
  directive: string | null;
  suspended_at: string;
  resumed_at: string | null;
};

export const INITIAL_STATE: DayState = {
  day: 0,
  capital: 10000,
  reputation: 62,
  dau: 1200,
  subscribers: 260,
  adRevenue: 0,
  llmCost: 0,
  isBoardDay: false,
};

function mapDay(row: DayRow): DaySummary {
  return {
    day: row.day,
    capital: row.capital,
    reputation: row.reputation,
    dau: row.dau,
    subscribers: row.subscribers,
    adRevenue: row.ad_revenue,
    llmCost: row.llm_cost,
    isBoardDay: Boolean(row.is_board_day),
    articleCount: row.article_count ?? 0,
    completedAt: row.completed_at,
  };
}

function mapEvent(row: EventRow): SimEvent {
  return {
    id: row.id,
    day: row.day,
    seq: row.seq,
    agentId: row.agent_id,
    agentName: row.agent_name,
    eventType: row.event_type,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
  };
}

function safeJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapWorkEvent(row: WorkEventRow): WorkEvent {
  return {
    id: row.id,
    day: row.day,
    seq: row.seq,
    ts: row.ts,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorType: row.actor_type,
    layer: row.layer,
    eventType: row.event_type,
    action: row.action,
    content: row.content ?? "",
    payload: safeJson(row.payload),
    refs: safeJson(row.refs),
    costToken: row.cost_token,
    costYuan: row.cost_yuan,
    createdAt: row.created_at,
  };
}

function inferEventLayer(eventType: EventType, agentId: string): LayerName | "work" {
  if (agentId === "simulation-engine") return "resource";
  if (eventType === "tool_call" || eventType === "tool_result") return "environment";
  if (eventType === "board") return "growth";
  if (eventType === "decision" && agentId === "editor-in-chief") return "mission";
  if (eventType === "decision") return "rules";
  return "work";
}

function mapArticle(row: ArticleRow): PublishedArticle {
  return {
    id: row.id,
    day: row.day,
    sourceId: row.source_id,
    titleZh: row.title_zh,
    summaryZh: row.summary_zh,
    contentZh: row.content_zh,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    tags: row.tags ? JSON.parse(row.tags) : [],
    qualityScore: row.quality_score,
    qualityReason: row.quality_reason,
    createdAt: row.created_at,
  };
}

function mapBoardMeeting(row: BoardMeetingRow): BoardMeeting {
  return {
    day: row.day,
    status: row.status,
    weeklyReport: JSON.parse(row.weekly_report),
    directive: row.directive,
    suspendedAt: row.suspended_at,
    resumedAt: row.resumed_at,
  };
}

export function getSetting(key: string) {
  const row = getSimDb().prepare("SELECT value FROM sim_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getSimDb()
    .prepare("INSERT INTO sim_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value, new Date().toISOString());
}

export function getStatus(): { day: number; status: SimStatus; state: DayState } {
  const last = getLatestDay();
  const status = (getSetting("status") as SimStatus | null) ?? "idle";
  const state = last
    ? {
        day: last.day,
        capital: last.capital,
        reputation: last.reputation,
        dau: last.dau,
        subscribers: last.subscribers,
        adRevenue: last.adRevenue,
        llmCost: last.llmCost,
        isBoardDay: last.isBoardDay,
      }
    : INITIAL_STATE;
  return { day: state.day, status, state };
}

export function setStatus(status: SimStatus) {
  setSetting("status", status);
}

export function getLatestDay() {
  const row = getSimDb()
    .prepare(
      `SELECT d.*, COUNT(a.id) AS article_count
       FROM sim_days d
       LEFT JOIN published_articles a ON a.day = d.day
       GROUP BY d.day
       ORDER BY d.day DESC
       LIMIT 1`,
    )
    .get() as DayRow | undefined;
  return row ? mapDay(row) : null;
}

export function listDays() {
  const rows = getSimDb()
    .prepare(
      `SELECT d.*, COUNT(a.id) AS article_count
       FROM sim_days d
       LEFT JOIN published_articles a ON a.day = d.day
       GROUP BY d.day
       ORDER BY d.day DESC`,
    )
    .all() as DayRow[];
  return rows.map(mapDay);
}

export function getDay(day: number) {
  const row = getSimDb()
    .prepare(
      `SELECT d.*, COUNT(a.id) AS article_count
       FROM sim_days d
       LEFT JOIN published_articles a ON a.day = d.day
       WHERE d.day = ?
       GROUP BY d.day`,
    )
    .get(day) as DayRow | undefined;
  return row ? mapDay(row) : null;
}

export function upsertDay(state: DayState) {
  getSimDb()
    .prepare(
      `INSERT INTO sim_days (day, capital, reputation, dau, subscribers, ad_revenue, llm_cost, is_board_day, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
       capital = excluded.capital,
       reputation = excluded.reputation,
       dau = excluded.dau,
       subscribers = excluded.subscribers,
       ad_revenue = excluded.ad_revenue,
       llm_cost = excluded.llm_cost,
       is_board_day = excluded.is_board_day,
       completed_at = excluded.completed_at`,
    )
    .run(state.day, state.capital, state.reputation, state.dau, state.subscribers, state.adRevenue, state.llmCost, state.isBoardDay ? 1 : 0, new Date().toISOString());
}

export function recordDailySettlement(state: DayState, previous: DayState | null, causedByEvent: string, factors: { averageQuality: number; socialReach: number }) {
  const db = getSimDb();
  const revenue = { ad: state.adRevenue, subscription: Number((state.subscribers * 0.03).toFixed(2)), sponsorship: 0 };
  const cost = { llm: state.llmCost, fixed: 18, newsletter: 12, promotion: 0 };
  db.prepare(
    `INSERT OR REPLACE INTO daily_settlement (day, revenue_breakdown, cost_breakdown, capital_delta, reputation_delta, dau_delta, subscribers_delta, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    state.day,
    JSON.stringify(revenue),
    JSON.stringify(cost),
    previous ? Number((state.capital - previous.capital).toFixed(2)) : state.capital,
    previous ? Number((state.reputation - previous.reputation).toFixed(1)) : state.reputation,
    previous ? state.dau - previous.dau : state.dau,
    previous ? state.subscribers - previous.subscribers : state.subscribers,
    new Date().toISOString(),
  );
  for (const [metric, value] of Object.entries({ capital: state.capital, reputation: state.reputation, dau: state.dau, subscribers: state.subscribers, ad_revenue: state.adRevenue })) {
    db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)").run(metric, value, state.day);
  }
  for (const driver of [
    ["dau", "quality_score", factors.averageQuality],
    ["dau", "social_reach", factors.socialReach],
    ["reputation", "content_quality", previous ? state.reputation - previous.reputation : state.reputation],
    ["capital", "ad_revenue", state.adRevenue],
  ] as const) {
    db.prepare("INSERT OR REPLACE INTO settlement_drivers (day, metric, factor, delta, caused_by_event) VALUES (?, ?, ?, ?, ?)").run(state.day, ...driver, causedByEvent);
  }
}

export function nextSeq(day: number) {
  const row = getSimDb().prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM work_events WHERE day = ?").get(day) as { seq: number };
  return row.seq;
}

export function addEvent(input: Omit<SimEvent, "id" | "seq" | "createdAt">) {
  ensureBaselineData();
  const now = new Date().toISOString();
  const layer = inferEventLayer(input.eventType, input.agentId);
  const event: SimEvent = {
    ...input,
    id: randomUUID(),
    seq: nextSeq(input.day),
    createdAt: now,
  };
  getSimDb()
    .prepare(
      `INSERT INTO work_events (id, day, seq, ts, actor_id, actor_name, actor_type, layer, event_type, action, content, payload, refs, cost_token, cost_yuan, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.day,
      event.seq,
      now,
      event.agentId,
      event.agentName,
      event.agentId === "board" ? "board" : event.agentId === "simulation-engine" ? "system" : "agent",
      layer,
      event.eventType,
      event.eventType,
      event.content,
      event.metadata ? JSON.stringify(event.metadata) : null,
      null,
      0,
      0,
      event.createdAt,
    );
  projectWorkEvent(event.id);
  return event;
}

export function addLayerEvent(input: {
  day: number;
  actorId: string;
  actorName: string;
  actorType?: "agent" | "board" | "system" | "ceo";
  layer: LayerName;
  eventType: WorkEvent["eventType"];
  action: string;
  content: string;
  payload?: Record<string, unknown> | null;
  refs?: Record<string, unknown> | null;
  costToken?: number;
  costYuan?: number;
}) {
  ensureBaselineData();
  const now = new Date().toISOString();
  const id = randomUUID();
  getSimDb()
    .prepare(
      `INSERT INTO work_events (id, day, seq, ts, actor_id, actor_name, actor_type, layer, event_type, action, content, payload, refs, cost_token, cost_yuan, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.day,
      nextSeq(input.day),
      now,
      input.actorId,
      input.actorName,
      input.actorType ?? "agent",
      input.layer,
      input.eventType,
      input.action,
      input.content,
      input.payload ? JSON.stringify(input.payload) : null,
      input.refs ? JSON.stringify(input.refs) : null,
      input.costToken ?? 0,
      input.costYuan ?? 0,
      now,
    );
  projectWorkEvent(id);
  return getWorkEvent(id)!;
}

export function listEvents(day: number) {
  const rows = getSimDb().prepare("SELECT * FROM sim_events WHERE day = ? ORDER BY seq ASC").all(day) as EventRow[];
  return rows.map(mapEvent);
}

export function latestEvents(afterId?: string | null) {
  const db = getSimDb();
  if (!afterId) {
    return (db.prepare("SELECT * FROM sim_events ORDER BY created_at DESC, seq DESC LIMIT 50").all() as EventRow[]).reverse().map(mapEvent);
  }
  const marker = db.prepare("SELECT created_at FROM sim_events WHERE id = ?").get(afterId) as { created_at: string } | undefined;
  if (!marker) return [];
  return (db.prepare("SELECT * FROM sim_events WHERE created_at > ? ORDER BY created_at ASC, seq ASC LIMIT 100").all(marker.created_at) as EventRow[]).map(mapEvent);
}

export function listPublishedArticles(day: number) {
  const rows = getSimDb().prepare("SELECT * FROM published_articles WHERE day = ? ORDER BY quality_score DESC, created_at ASC").all(day) as ArticleRow[];
  return rows.map(mapArticle);
}

export function publishArticles(articles: Omit<PublishedArticle, "id" | "createdAt">[]) {
  const db = getSimDb();
  const stmt = db.prepare(
    `INSERT INTO published_articles (id, day, source_id, title_zh, summary_zh, content_zh, source_url, image_url, tags, quality_score, quality_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const published: PublishedArticle[] = [];
  const tx = db.transaction(() => {
    for (const article of articles) {
      const id = randomUUID();
      stmt.run(id, article.day, article.sourceId, article.titleZh, article.summaryZh, article.contentZh, article.sourceUrl, article.imageUrl, JSON.stringify(article.tags), article.qualityScore, article.qualityReason, now);
      published.push({ ...article, id, createdAt: now });
    }
  });
  tx();
  return published;
}

export function usedSourceIds() {
  const rows = getSimDb().prepare("SELECT source_id FROM published_articles").all() as { source_id: string }[];
  return rows.map((row) => row.source_id);
}

export function addBoardDirective(day: number, directive: string) {
  getSimDb()
    .prepare("INSERT INTO board_directives (id, day, directive, applied_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), day, directive, new Date().toISOString());
}

export function suspendBoardMeeting(day: number, weeklyReport: Record<string, unknown>) {
  getSimDb()
    .prepare(
      `INSERT INTO board_meetings (day, status, weekly_report, directive, suspended_at, resumed_at)
       VALUES (?, 'pending', ?, NULL, ?, NULL)
       ON CONFLICT(day) DO UPDATE SET
       status = 'pending',
       weekly_report = excluded.weekly_report,
       directive = NULL,
       suspended_at = excluded.suspended_at,
       resumed_at = NULL`,
    )
    .run(day, JSON.stringify(weeklyReport), new Date().toISOString());
}

export function getBoardMeeting(day: number) {
  const row = getSimDb().prepare("SELECT * FROM board_meetings WHERE day = ?").get(day) as BoardMeetingRow | undefined;
  return row ? mapBoardMeeting(row) : null;
}

export function resumeBoardMeeting(day: number, directive: string) {
  getSimDb()
    .prepare("UPDATE board_meetings SET status = 'resumed', directive = ?, resumed_at = ? WHERE day = ?")
    .run(directive, new Date().toISOString(), day);
}

export function ensureBaselineData() {
  const db = getSimDb();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO mission_charter (id, statement, values_json, locked, created_at) VALUES (?, ?, ?, 1, ?)",
  ).run("charter-default", "让中文读者用最少时间，读懂全球 AI 最重要的进展。", JSON.stringify(["内容质量 > 发布速度", "用户信任 > 短期流量", "长期 Reputation > 单次广告收益"]), now);
  db.prepare(
    "INSERT OR IGNORE INTO mission_strategy (id, title, description, effective_from, status) VALUES (?, ?, ?, 1, 'active')",
  ).run("strategy-stage-1", "专注 AI 研究资讯", "以解释性日报建立中文 AI 资讯信任资产。");
  for (const okr of [
    ["okr-dau", "dau", 1000, 10000],
    ["okr-revenue", "monthly_revenue", 5000, 30000],
    ["okr-open-rate", "newsletter_open_rate", 35, null],
  ] as const) {
    db.prepare("INSERT OR IGNORE INTO mission_okr (id, stage, metric, target, upper_bound, effective_from, status) VALUES (?, 1, ?, ?, ?, 1, 'active')").run(...okr);
  }
  for (const tool of [
    ["tool-query-articles", "queryArticles", "real_data", "public", "查询 agidaily.db 原始文章池"],
    ["tool-publish", "sim.publish", "mock_api", "public", "发布文章到模拟 CMS"],
    ["tool-newsletter", "sim.newsletter.send", "mock_api", "public", "发送日报 Newsletter"],
    ["tool-social", "sim.social.post", "mock_api", "restricted", "发布社交媒体摘要"],
    ["tool-analytics", "sim.analytics.get", "mock_api", "public", "读取模拟分析指标"],
  ] as const) {
    db.prepare("INSERT OR IGNORE INTO tool_registry (id, name, kind, scope, description, schema_json, status, created_at) VALUES (?, ?, ?, ?, ?, '{}', 'active', ?)").run(...tool, now);
  }
  for (const rule of [
    ["rule-source-url", "HARD_SOURCE_URL_REQUIRED", "hard", "不发布无法溯源的信息，必须有 source_url。"],
    ["rule-title-length", "SOFT_TITLE_MAX_20", "soft", "每篇文章标题必须口语化，不超过 20 字。"],
    ["rule-daily-volume", "SOFT_DAILY_10_ARTICLES", "soft", "每期日报固定 10 篇，不多不少。"],
    ["rule-ad-contract", "AUTH_AD_CONTRACT_10000", "authorization", "广告合同单笔 > ¥10,000 必须人工确认。"],
  ] as const) {
    db.prepare("INSERT OR IGNORE INTO rules (id, code, category, text, threshold_json, effective_from, status) VALUES (?, ?, ?, ?, '{}', 1, 'active')").run(...rule);
  }
  bootstrapEmployee("editor-in-chief", "总编 Agent", "editor_in_chief", "editor-in-chief", 1, "bootstrap");
  bootstrapEmployee("editor", "编辑 Agent", "editor", "editor", 1, "bootstrap");
  db.prepare("INSERT OR IGNORE INTO org_relations (id, superior_id, subordinate_id, effective_from) VALUES (?, ?, ?, 1)").run("org-editor-chief-editor", "editor-in-chief", "editor");
}

function bootstrapEmployee(id: string, name: string, role: string, handle: string, day: number, eventId: string) {
  getSimDb()
    .prepare("INSERT OR IGNORE INTO employees (id, display_name, role_template, status, joined_day, system_prompt, agent_handle, caused_by_event) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)")
    .run(id, name, role, day, `${name} / ${role}。外部 LLM 配置只从环境变量读取。`, handle, eventId);
}

function projectWorkEvent(eventId: string) {
  const event = getWorkEvent(eventId);
  if (!event || event.layer === "work") return;
  const db = getSimDb();
  const now = new Date().toISOString();
  const entityId = `${event.layer}:day:${event.day}`;
  const snapshot = buildLayerSnapshot(event.layer, event.day);
  db.prepare(
    `INSERT OR REPLACE INTO layer_snapshots (layer, day, entity_id, payload) VALUES (?, ?, ?, ?)`,
  ).run(event.layer, event.day, entityId, JSON.stringify(snapshot));
  db.prepare(
    `INSERT INTO layer_changes (id, layer, day, entity_table, entity_id, change_type, before_json, after_json, caused_by_event, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(randomUUID(), event.layer, event.day, `${event.layer}_state`, entityId, event.eventType === "tool_call" ? "trigger" : "update", JSON.stringify(snapshot), event.id, event.content, now);
}

export function projectDay(day: number) {
  ensureBaselineData();
  const db = getSimDb();
  const now = new Date().toISOString();
  for (const layer of ["mission", "environment", "memory", "structure", "rules", "resource", "growth"] as LayerName[]) {
    const entityId = `${layer}:day:${day}`;
    const snapshot = buildLayerSnapshot(layer, day);
    db.prepare("INSERT OR REPLACE INTO layer_snapshots (layer, day, entity_id, payload) VALUES (?, ?, ?, ?)").run(layer, day, entityId, JSON.stringify(snapshot));
    const hasChange = db.prepare("SELECT 1 FROM layer_changes WHERE layer = ? AND day = ? LIMIT 1").get(layer, day);
    if (!hasChange) {
      const event = firstEventForLayer(day, layer);
      if (event) {
        db.prepare(
          `INSERT INTO layer_changes (id, layer, day, entity_table, entity_id, change_type, before_json, after_json, caused_by_event, summary, created_at)
           VALUES (?, ?, ?, ?, ?, 'update', NULL, ?, ?, ?, ?)`,
        ).run(randomUUID(), layer, day, `${layer}_state`, entityId, JSON.stringify(snapshot), event.id, `${layer} 层 Day ${day} 快照更新`, now);
      }
    }
  }
}

function firstEventForLayer(day: number, layer: LayerName) {
  const row = getSimDb().prepare("SELECT * FROM work_events WHERE day = ? AND layer = ? ORDER BY seq ASC LIMIT 1").get(day, layer) as WorkEventRow | undefined;
  return row ? mapWorkEvent(row) : null;
}

function buildLayerSnapshot(layer: LayerName, day: number) {
  const db = getSimDb();
  const metrics = getDay(day);
  if (layer === "mission") {
    const charter = db.prepare("SELECT * FROM mission_charter LIMIT 1").get();
    const strategy = db.prepare("SELECT * FROM mission_strategy WHERE status = 'active' ORDER BY effective_from DESC LIMIT 1").get();
    const okrs = db.prepare("SELECT * FROM mission_okr WHERE status = 'active'").all();
    return { charter, strategy, okrs, progress: metrics ? { dau: metrics.dau, reputation: metrics.reputation } : null };
  }
  if (layer === "environment") {
    return { tools: db.prepare("SELECT * FROM tool_registry ORDER BY name").all(), toolCalls: db.prepare("SELECT COUNT(*) AS count FROM work_events WHERE day = ? AND event_type = 'tool_call'").get(day) };
  }
  if (layer === "memory") {
    return { entries: db.prepare("SELECT * FROM memory_entries ORDER BY first_seen_day DESC LIMIT 20").all(), dailySignals: memorySignals(day) };
  }
  if (layer === "structure") {
    return { employees: db.prepare("SELECT id, display_name, role_template, status, joined_day, agent_handle FROM employees ORDER BY joined_day, id").all(), relations: db.prepare("SELECT * FROM org_relations WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)").all(day, day) };
  }
  if (layer === "rules") {
    return { rules: db.prepare("SELECT * FROM rules ORDER BY category, code").all(), executions: db.prepare("SELECT * FROM rule_executions WHERE day = ?").all(day) };
  }
  if (layer === "resource") {
    return { metrics, settlement: db.prepare("SELECT * FROM daily_settlement WHERE day = ?").get(day), drivers: db.prepare("SELECT * FROM settlement_drivers WHERE day = ?").all(day) };
  }
  return { signals: db.prepare("SELECT * FROM growth_signals WHERE day = ?").all(day), proposals: db.prepare("SELECT * FROM growth_proposals WHERE day <= ?").all(day), observations: db.prepare("SELECT * FROM growth_observations WHERE day = ?").all(day) };
}

function memorySignals(day: number) {
  const articles = listPublishedArticles(day);
  return {
    articleCount: articles.length,
    averageQuality: articles.length ? Number((articles.reduce((sum, article) => sum + article.qualityScore, 0) / articles.length).toFixed(1)) : 0,
    topTags: Array.from(new Set(articles.flatMap((article) => article.tags))).slice(0, 8),
  };
}

export function getWorkEvent(id: string) {
  const row = getSimDb().prepare("SELECT * FROM work_events WHERE id = ?").get(id) as WorkEventRow | undefined;
  return row ? mapWorkEvent(row) : null;
}

export function listWorkEvents(day: number, layer?: LayerName) {
  const rows = layer
    ? (getSimDb().prepare("SELECT * FROM work_events WHERE day = ? AND layer = ? ORDER BY seq ASC").all(day, layer) as WorkEventRow[])
    : (getSimDb().prepare("SELECT * FROM work_events WHERE day = ? ORDER BY seq ASC").all(day) as WorkEventRow[]);
  return rows.map(mapWorkEvent);
}

export function getLayerSnapshot(layer: LayerName, day: number) {
  const rows = getSimDb().prepare("SELECT entity_id, payload FROM layer_snapshots WHERE layer = ? AND day = ? ORDER BY entity_id").all(layer, day) as { entity_id: string; payload: string }[];
  const payload: Record<string, unknown> = {};
  for (const row of rows) payload[row.entity_id] = JSON.parse(row.payload);
  return payload;
}

export function listLayerChanges(layer: LayerName, day: number) {
  const rows = getSimDb().prepare("SELECT * FROM layer_changes WHERE layer = ? AND day = ? ORDER BY created_at ASC").all(layer, day) as LayerChangeRow[];
  return rows.map((row) => ({
    id: row.id,
    layer: row.layer,
    day: row.day,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    changeType: row.change_type,
    before: safeJson(row.before_json),
    after: safeJson(row.after_json),
    summary: row.summary,
    causedBy: getWorkEvent(row.caused_by_event),
    createdAt: row.created_at,
  }));
}

export function getLayerDay(layer: LayerName, day: number) {
  return { layer, day, snapshot: getLayerSnapshot(layer, day), changes: listLayerChanges(layer, day), events: listWorkEvents(day, layer) };
}

export function getWorkEventImpact(id: string) {
  const rows = getSimDb().prepare("SELECT * FROM layer_changes WHERE caused_by_event = ? ORDER BY created_at ASC").all(id) as LayerChangeRow[];
  return {
    event: getWorkEvent(id),
    layerChanges: rows.map((row) => ({
      id: row.id,
      layer: row.layer,
      day: row.day,
      entityTable: row.entity_table,
      entityId: row.entity_id,
      changeType: row.change_type,
      before: safeJson(row.before_json),
      after: safeJson(row.after_json),
      summary: row.summary,
      causedBy: getWorkEvent(row.caused_by_event),
      createdAt: row.created_at,
    })),
  };
}

export function listRules(): RuleDefinition[] {
  return [
    {
      id: "editorial-priority",
      group: "选题规则",
      title: "信任优先",
      description: "总编议程按用户信任、内容质量、发布速度的顺序排序，不追逐短期广告收入。",
      parameters: { trust: 1, quality: 2, speed: 3 },
    },
    {
      id: "daily-volume",
      group: "发布规则",
      title: "每日固定 10 篇",
      description: "编辑 Agent 每天必须提交 10 篇带来源链接的中文稿件，审核通过后发布。",
      parameters: { articles_per_day: 10, require_source_url: true },
    },
    {
      id: "quality-gate",
      group: "审核规则",
      title: "质量门槛",
      description: "平均质量分低于 7.0 时总编会打回一次；二审后仍发布但记录风险。",
      parameters: { minimum_average_score: 7, max_revision: 1 },
    },
    {
      id: "dau-formula",
      group: "因果公式",
      title: "DAU 增长",
      description: "DAU 由当前用户、质量分和社交曝光决定，固定 0.5% 日流失。",
      parameters: { churn_rate: "0.5%", organic_quality_factor: "3%", social_conversion: 0.1 },
    },
    {
      id: "revenue-formula",
      group: "因果公式",
      title: "广告收入",
      description: "广告收入 = DAU × CPM / 1000 × Reputation / 50。",
      parameters: { base_cpm_yuan: 5, reputation_baseline: 50 },
    },
    {
      id: "board-cadence",
      group: "董事会",
      title: "每 7 天触发",
      description: "第 7、14、21 天进入董事会日，工作流生成周报后挂起，等待后台输入董事会指令后 resume。",
      parameters: { cadence_days: 7, suspend_until_directive: true },
    },
    {
      id: "board-decision-validation",
      group: "董事会",
      title: "董事会指令校验",
      description: "只接受已存在且标记为董事会日、状态为 pending 的 day；非董事会日、不存在 day、重复提交都会被拒绝。",
      parameters: { require_existing_day: true, require_board_day: true, require_pending_meeting: true },
    },
  ];
}
