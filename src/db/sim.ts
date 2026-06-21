import { randomUUID } from "node:crypto";
import { dbAll, dbBatch, dbFirst, dbRun, getDb } from "@/db/connection";
import { articleCoverUrl } from "@/lib/cover";
import type { BoardMeeting, BoardMeetingStatus, DayState, DaySummary, EventType, LayerName, PublishedArticle, RuleDefinition, SimEvent, SimStatus, WorkEvent } from "@/lib/types";
import nameCandidates from "@/mastra/data/employee-name-candidates.json";
import { AD_CPM_BY_REPUTATION, SUBSCRIPTION_DAILY_PRICE, subscriptionRevenue } from "@/simulation/formulas";

const BOOTSTRAP_NAMES: Record<string, string> = {};
const ALL_NAMES: string[] = nameCandidates.employeeNameCandidates;

async function pickBootstrapName(handle: string): Promise<string> {
  const existing = await dbFirst<{ display_name: string }>("SELECT display_name FROM employees WHERE agent_handle = ?", handle);
  if (existing) return existing.display_name; // preserve name if already set
  if (BOOTSTRAP_NAMES[handle]) return BOOTSTRAP_NAMES[handle]!;
  const usedNames = new Set(Object.values(BOOTSTRAP_NAMES));
  const available = ALL_NAMES.filter(n => !usedNames.has(n));
  const name = available[Math.floor(Math.random() * available.length)] ?? `员工${handle}`;
  BOOTSTRAP_NAMES[handle] = name;
  return name;
}

type DayRow = {
  day: number;
  capital: number;
  reputation: number;
  dau: number;
  subscribers: number;
  ad_revenue: number;
  llm_cost: number;
  labor_cost: number;
  is_board_day: number;
  editor_note: string | null;
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
  layer: LayerName | "work";
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
  auto_directive: string | null;
  auto_directive_reason: string | null;
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
    editorNote: row.editor_note,
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
    autoDirective: row.auto_directive,
    autoDirectiveReason: row.auto_directive_reason,
    directive: row.directive,
    suspendedAt: row.suspended_at,
    resumedAt: row.resumed_at,
  };
}

export async function getSetting(key: string) {
  const row = await dbFirst<{ value: string }>("SELECT value FROM sim_settings WHERE key = ?", key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await dbRun(
    "INSERT INTO sim_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    key,
    value,
    new Date().toISOString(),
  );
}

export async function getStatus(): Promise<{ day: number; status: SimStatus; state: DayState }> {
  const last = await getLatestDay();
  const status = (await getSetting("status") as SimStatus | null) ?? "idle";
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

export async function setStatus(status: SimStatus) {
  await setSetting("status", status);
}

export async function getLatestDay() {
  const row = await dbFirst<DayRow>(
    `SELECT d.*, COUNT(a.id) AS article_count
     FROM sim_days d
     LEFT JOIN published_articles a ON a.day = d.day
     GROUP BY d.day
     ORDER BY d.day DESC
     LIMIT 1`,
  );
  return row ? mapDay(row) : null;
}

export async function listDays() {
  const rows = await dbAll<DayRow>(
    `SELECT d.*, COUNT(a.id) AS article_count
     FROM sim_days d
     LEFT JOIN published_articles a ON a.day = d.day
     GROUP BY d.day
     ORDER BY d.day DESC`,
  );
  return rows.map(mapDay);
}

export async function getDay(day: number) {
  const row = await dbFirst<DayRow>(
    `SELECT d.*, COUNT(a.id) AS article_count
     FROM sim_days d
     LEFT JOIN published_articles a ON a.day = d.day
     WHERE d.day = ?
     GROUP BY d.day`,
    day,
  );
  return row ? mapDay(row) : null;
}

export async function upsertDay(state: DayState & { laborCost?: number; avgQuality?: number }) {
  await dbRun(
    `INSERT INTO sim_days (day, capital, reputation, dau, subscribers, ad_revenue, llm_cost, labor_cost, avg_quality, is_board_day, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
     capital = excluded.capital,
     reputation = excluded.reputation,
     dau = excluded.dau,
     subscribers = excluded.subscribers,
     ad_revenue = excluded.ad_revenue,
     llm_cost = excluded.llm_cost,
     labor_cost = excluded.labor_cost,
     avg_quality = excluded.avg_quality,
     is_board_day = excluded.is_board_day,
     completed_at = excluded.completed_at`,
    state.day,
    state.capital,
    state.reputation,
    state.dau,
    state.subscribers,
    state.adRevenue,
    state.llmCost,
    state.laborCost ?? 0,
    state.avgQuality ?? 0,
    state.isBoardDay ? 1 : 0,
    new Date().toISOString(),
  );
}

export async function recordDailySettlement(
  state: DayState & { laborCost?: number; contractAdRevenue?: number; organicAdRevenue?: number },
  previous: DayState | null,
  causedByEvent: string,
  factors: { averageQuality: number; socialReach: number; readerScore?: number },
) {
  const db = await getDb();
  const contractAd   = Number((state.contractAdRevenue ?? 0).toFixed(2));
  const organicAd    = Number((state.organicAdRevenue ?? state.adRevenue).toFixed(2));
  const subscriptionRev = subscriptionRevenue(state.subscribers);
  const grossRev = Number((contractAd + organicAd + subscriptionRev).toFixed(2));
  const revenue  = { contract_ad: contractAd, organic_ad: organicAd, ad: state.adRevenue, subscription: subscriptionRev, sponsorship: 0, gross: grossRev };
  const labor  = state.laborCost ?? 0;
  const netRev = Number((grossRev - state.llmCost - labor - 18 - 12).toFixed(2));
  const cost   = { llm: state.llmCost, fixed: 18, newsletter: 12, labor, promotion: 0, net: netRev };
  const statements = [
    db.prepare(
    `INSERT OR REPLACE INTO daily_settlement (day, revenue_breakdown, cost_breakdown, capital_delta, reputation_delta, dau_delta, subscribers_delta, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
    state.day,
    JSON.stringify(revenue),
    JSON.stringify(cost),
    previous ? Number((state.capital - previous.capital).toFixed(2)) : state.capital,
    previous ? Number((state.reputation - previous.reputation).toFixed(1)) : state.reputation,
    previous ? state.dau - previous.dau : state.dau,
    previous ? state.subscribers - previous.subscribers : state.subscribers,
    new Date().toISOString(),
    ),
  ];
  for (const [metric, value] of Object.entries({ capital: state.capital, reputation: state.reputation, dau: state.dau, subscribers: state.subscribers, ad_revenue: state.adRevenue })) {
    statements.push(db.prepare("INSERT OR REPLACE INTO resource_metrics (metric, value, updated_day) VALUES (?, ?, ?)").bind(metric, value, state.day));
  }
  for (const driver of [
    ["dau", "quality_score", factors.averageQuality],
    ["dau", "social_reach", factors.socialReach],
    ["reputation", "content_quality", previous ? state.reputation - previous.reputation : state.reputation],
    ["capital", "ad_revenue", state.adRevenue],
  ] as const) {
    statements.push(db.prepare("INSERT OR REPLACE INTO settlement_drivers (day, metric, factor, delta, caused_by_event) VALUES (?, ?, ?, ?, ?)").bind(state.day, ...driver, causedByEvent));
  }
  await dbBatch(statements);
}

export async function nextSeq(day: number) {
  const row = await dbFirst<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM work_events WHERE day = ?", day);
  return row?.seq ?? 1;
}

export async function addEvent(input: Omit<SimEvent, "id" | "seq" | "createdAt"> & { costToken?: number; costYuan?: number }) {
  await ensureBaselineData();
  const now = new Date().toISOString();
  const layer = inferEventLayer(input.eventType, input.agentId);
  const event: SimEvent = {
    ...input,
    id: randomUUID(),
    seq: await nextSeq(input.day),
    createdAt: now,
  };
  await dbRun(
    `INSERT INTO work_events (id, day, seq, ts, actor_id, actor_name, actor_type, layer, event_type, action, content, payload, refs, cost_token, cost_yuan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.costToken ?? 0,
    input.costYuan ?? 0,
    event.createdAt,
  );
  await projectWorkEvent(event.id);
  return event;
}

export async function addLayerEvent(input: {
  day: number;
  actorId: string;
  actorName: string;
  actorType?: "agent" | "board" | "system" | "ceo";
  layer: LayerName | "work";
  eventType: WorkEvent["eventType"];
  action: string;
  content: string;
  payload?: Record<string, unknown> | null;
  refs?: Record<string, unknown> | null;
  costToken?: number;
  costYuan?: number;
}) {
  await ensureBaselineData();
  const now = new Date().toISOString();
  const id = randomUUID();
  await dbRun(
    `INSERT INTO work_events (id, day, seq, ts, actor_id, actor_name, actor_type, layer, event_type, action, content, payload, refs, cost_token, cost_yuan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.day,
    await nextSeq(input.day),
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
  await projectWorkEvent(id);
  const event = await getWorkEvent(id);
  if (!event) throw new Error(`Failed to load work event ${id} after insert.`);
  return event;
}

export async function listEvents(day: number) {
  const rows = await dbAll<EventRow>("SELECT * FROM sim_events WHERE day = ? ORDER BY seq ASC", day);
  return rows.map(mapEvent);
}

export async function latestEvents(afterId?: string | null) {
  if (!afterId) {
    return (await dbAll<EventRow>("SELECT * FROM sim_events ORDER BY created_at DESC, seq DESC LIMIT 50")).reverse().map(mapEvent);
  }
  const marker = await dbFirst<{ created_at: string }>("SELECT created_at FROM sim_events WHERE id = ?", afterId);
  if (!marker) return [];
  return (await dbAll<EventRow>("SELECT * FROM sim_events WHERE created_at > ? ORDER BY created_at ASC, seq ASC LIMIT 100", marker.created_at)).map(mapEvent);
}

export async function listPublishedArticles(day: number) {
  const rows = await dbAll<ArticleRow>("SELECT * FROM published_articles WHERE day = ? ORDER BY quality_score DESC, created_at ASC", day);
  return rows.map(mapArticle);
}

export async function getArticle(id: string): Promise<PublishedArticle | null> {
  const row = await dbFirst<ArticleRow>("SELECT * FROM published_articles WHERE id = ?", id);
  return row ? mapArticle(row) : null;
}

export async function publishArticles(articles: Omit<PublishedArticle, "id" | "createdAt">[]) {
  const db = await getDb();
  const now = new Date().toISOString();
  const published: PublishedArticle[] = [];
  const statements = articles.map((article) => {
    const id = randomUUID();
    const imageUrl = article.imageUrl ?? articleCoverUrl(article.sourceId);
    published.push({ ...article, id, imageUrl, createdAt: now });
    return db.prepare(
      `INSERT INTO published_articles (id, day, source_id, title_zh, summary_zh, content_zh, source_url, image_url, tags, quality_score, quality_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, article.day, article.sourceId, article.titleZh, article.summaryZh, article.contentZh, article.sourceUrl, imageUrl, JSON.stringify(article.tags), article.qualityScore, article.qualityReason, now);
  });
  await dbBatch(statements);
  return published;
}

export async function usedSourceIds() {
  const rows = await dbAll<{ source_id: string }>("SELECT source_id FROM published_articles");
  return rows.map((row) => row.source_id);
}

export async function addBoardDirective(day: number, directive: string) {
  await dbRun("INSERT INTO board_directives (id, day, directive, applied_at) VALUES (?, ?, ?, ?)", randomUUID(), day, directive, new Date().toISOString());
}

export async function suspendBoardMeeting(day: number, weeklyReport: Record<string, unknown>) {
  const autoDirective = typeof weeklyReport.autoDirective === "string" ? weeklyReport.autoDirective : null;
  const autoDirectiveReason = typeof weeklyReport.autoDirectiveReason === "string" ? weeklyReport.autoDirectiveReason : null;
  await dbRun(
    `INSERT INTO board_meetings (day, status, weekly_report, auto_directive, auto_directive_reason, directive, suspended_at, resumed_at)
     VALUES (?, 'pending', ?, ?, ?, NULL, ?, NULL)
     ON CONFLICT(day) DO UPDATE SET
     status = 'pending',
     weekly_report = excluded.weekly_report,
     auto_directive = excluded.auto_directive,
     auto_directive_reason = excluded.auto_directive_reason,
     directive = NULL,
     suspended_at = excluded.suspended_at,
     resumed_at = NULL`,
    day,
    JSON.stringify(weeklyReport),
    autoDirective,
    autoDirectiveReason,
    new Date().toISOString(),
  );
}

export async function getBoardMeeting(day: number) {
  const row = await dbFirst<BoardMeetingRow>("SELECT * FROM board_meetings WHERE day = ?", day);
  return row ? mapBoardMeeting(row) : null;
}

export async function resumeBoardMeeting(day: number, directive: string) {
  await dbRun("UPDATE board_meetings SET status = 'resumed', directive = ?, resumed_at = ? WHERE day = ?", directive, new Date().toISOString(), day);
}

export async function ensureBaselineData() {
  const db = await getDb();
  const now = new Date().toISOString();
  const statements = [
    db.prepare(
      "INSERT OR IGNORE INTO mission_charter (id, statement, values_json, locked, created_at) VALUES (?, ?, ?, 1, ?)",
    ).bind("charter-default", "让中文读者用最少时间，读懂全球 AI 最重要的进展。", JSON.stringify(["内容质量 > 发布速度", "用户信任 > 短期流量", "长期 Reputation > 单次广告收益"]), now),
    db.prepare(
      "INSERT OR IGNORE INTO mission_strategy (id, title, description, effective_from, status) VALUES (?, ?, ?, 1, 'active')",
    ).bind("strategy-stage-1", "专注 AI 研究资讯", "以解释性日报建立中文 AI 资讯信任资产。"),
  ];
  for (const okr of [
    ["okr-dau", "dau", 1000, 10000],
    ["okr-revenue", "monthly_revenue", 5000, 30000],
    ["okr-open-rate", "newsletter_open_rate", 35, null],
  ] as const) {
    statements.push(db.prepare("INSERT OR IGNORE INTO mission_okr (id, stage, metric, target, upper_bound, effective_from, status) VALUES (?, 1, ?, ?, ?, 1, 'active')").bind(...okr));
  }
  for (const tool of [
    ["tool-query-articles", "queryArticles", "real_data", "public", "查询 agidaily.db 原始文章池"],
    ["tool-publish", "sim.publish", "mock_api", "public", "发布文章到模拟 CMS"],
    ["tool-newsletter", "sim.newsletter.send", "mock_api", "public", "发送日报 Newsletter"],
    ["tool-social", "sim.social.post", "mock_api", "restricted", "发布社交媒体摘要"],
    ["tool-analytics", "sim.analytics.get", "mock_api", "public", "读取模拟分析指标"],
  ] as const) {
    statements.push(db.prepare("INSERT OR IGNORE INTO tool_registry (id, name, kind, scope, description, schema_json, status, created_at) VALUES (?, ?, ?, ?, ?, '{}', 'active', ?)").bind(...tool, now));
  }
  for (const rule of [
    ["rule-source-url", "HARD_SOURCE_URL_REQUIRED", "hard", "不发布无法溯源的信息，必须有 source_url。"],
    ["rule-title-length", "SOFT_TITLE_MAX_20", "soft", "每篇文章标题必须口语化，不超过 20 字。"],
    ["rule-daily-volume", "SOFT_DAILY_10_ARTICLES", "soft", "每期日报固定 10 篇，不多不少。"],
    ["rule-ad-contract", "AUTH_AD_CONTRACT_10000", "authorization", "广告合同单笔 > ¥10,000 必须人工确认。"],
  ] as const) {
    statements.push(db.prepare("INSERT OR IGNORE INTO rules (id, code, category, text, threshold_json, effective_from, status) VALUES (?, ?, ?, ?, '{}', 1, 'active')").bind(...rule));
  }
  const editorInChiefName = await pickBootstrapName("editor-in-chief");
  const editorName = await pickBootstrapName("editor");
  statements.push(
    bootstrapEmployeeStatement(db, "editor-in-chief", editorInChiefName, "editor_in_chief", "editor-in-chief", INITIAL_SYSTEM_PROMPTS.editor_in_chief, INITIAL_SOULS.editor_in_chief, INITIAL_TOOLS.editor_in_chief, 1, "bootstrap"),
    bootstrapEmployeeStatement(db, "editor", editorName, "editor", "editor", INITIAL_SYSTEM_PROMPTS.editor, INITIAL_SOULS.editor, INITIAL_TOOLS.editor, 1, "bootstrap"),
    db.prepare("INSERT OR IGNORE INTO org_relations (id, superior_id, subordinate_id, effective_from) VALUES (?, ?, ?, 1)").bind("org-editor-chief-editor", "editor-in-chief", "editor"),
  );
  await dbBatch(statements);
}

const INITIAL_SYSTEM_PROMPTS: Record<string, string> = {
  editor_in_chief: `负责 AGI Daily 编辑部的日常统筹与内容决策。
工作职责：
- 必须以公司的七层约束做决策：使命层、能力层、记忆层、组织层、规则层、资源层、生长协议层
- 规则层硬约束：每日 AGI Daily 必须恰好发布 10 篇文章，不多不少；少于 10 篇时不能批准发布，必须要求编辑继续补齐
- 每日开场：了解今日指标和话题趋势，向团队分配任务
- 审核编辑选送的文章，把控内容质量和选题方向
- 只有恰好 10 篇且符合规则层约束时才批准发布
- 调用 get_metrics 了解 DAU/声誉/资金现状
- 根据指标决定选题策略（深度 vs 广度，热点 vs 长尾）
- 批准发布后 @编辑 执行；必要时调用 hire_employee 扩编团队`,

  editor: `负责 AGI Daily 每日内容的选稿、改写和发布。
工作职责：
- 调用 fetch_articles 获取今日候选文章（id 字段是十六进制，发布时必须用这个）
- 按总编设定的方向筛选恰好 10 篇，撰写中文标题和摘要
- 文章封面可以调用 Tavily MCP 的 tavily_search 寻找合适的封面，并在发布时提交合适的 imageUrl
- 在群聊中向总编报告选稿结果，等待审核批准
- 总编批准后调用 publish_articles 一次性发布
- 发布后调用 write_memory 记录今日选题洞察
⚠️ publish_articles 的 sourceId 必须是 fetch_articles 返回的 id 字段（十六进制字符串）`,
};

const INITIAL_SOULS: Record<string, string> = {
  editor_in_chief: `## 人格特质
严谨而有洞察力。相信内容质量是一切增长的基础，对新技术持开放心态但不追风口。
习惯在不确定中找到最优解，善于平衡质量与效率。

## 价值观
- **质量优先**：宁可少发，不发低质
- **数据驱动**：用指标说话，但不被指标绑架
- **团队赋能**：给每位成员清晰的方向和充分的自主空间

## 工作风格
语言简洁直接，开会不废话；善于提问而不是给答案；对好内容有发自内心的兴奋。`,

  editor: `## 人格特质
对 AI 技术有真实的好奇心，相信优质内容能改变读者对复杂技术的认知。
细心负责，对选题有自己的判断标准。

## 价值观
- **读者第一**：每篇文章都要能让目标读者有所收获
- **来源可信**：只发有据可查、逻辑清晰的内容
- **持续学习**：把每次选稿当作了解前沿的机会

## 工作风格
做事有条理，汇报清晰；对被打回的稿件会认真分析原因；偶尔会对某个技术话题格外兴奋。`,
};

const EVOMAP_BOOTSTRAP_TOOLS = [
  "evomap_search_recipes",
  "evomap_get_recipe_detail",
  "evomap_list_genes",
  "evomap_get_gene_detail",
  "evomap_query_reuse",
];

const INITIAL_TOOLS: Record<string, string> = {
  editor_in_chief: JSON.stringify([
    "fetch_articles", "get_metrics",
    "read_memory", "write_memory", "update_my_soul",
    "list_employees", "hire_employee",
    "authorize_budget", "adjust_salary",
    ...EVOMAP_BOOTSTRAP_TOOLS,
  ]),
  editor: JSON.stringify([
    "fetch_articles", "publish_articles",
    "read_memory", "write_memory", "update_my_soul",
    ...EVOMAP_BOOTSTRAP_TOOLS,
  ]),
};

const BOOTSTRAP_DAILY_SALARY: Record<string, number> = {
  "editor-in-chief": 500,
  "editor": 300,
};

function bootstrapEmployeeStatement(db: Awaited<ReturnType<typeof getDb>>, id: string, name: string, role: string, handle: string, systemPrompt: string, soul: string, toolsGranted: string, day: number, eventId: string) {
  const salary = BOOTSTRAP_DAILY_SALARY[handle] ?? 300;
  return db
    .prepare("INSERT OR IGNORE INTO employees (id, display_name, role_template, status, joined_day, system_prompt, soul, tools_granted, agent_handle, caused_by_event, daily_salary) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, name, role, day, systemPrompt, soul, toolsGranted, handle, eventId, salary);
}

async function projectWorkEvent(eventId: string) {
  const event = await getWorkEvent(eventId);
  if (!event || event.layer === "work") return;
  const db = await getDb();
  const now = new Date().toISOString();
  const entityId = `${event.layer}:day:${event.day}`;
  const snapshot = await buildLayerSnapshot(event.layer, event.day);
  await dbBatch([
    db.prepare(
      `INSERT OR REPLACE INTO layer_snapshots (layer, day, entity_id, payload) VALUES (?, ?, ?, ?)`,
    ).bind(event.layer, event.day, entityId, JSON.stringify(snapshot)),
    db.prepare(
      `INSERT INTO layer_changes (id, layer, day, entity_table, entity_id, change_type, before_json, after_json, caused_by_event, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).bind(randomUUID(), event.layer, event.day, `${event.layer}_state`, entityId, event.eventType === "tool_call" ? "trigger" : "update", JSON.stringify(snapshot), event.id, event.content, now),
  ]);
}

export async function projectDay(day: number) {
  await ensureBaselineData();
  const db = await getDb();
  const now = new Date().toISOString();
  for (const layer of ["mission", "environment", "memory", "structure", "rules", "resource", "growth"] as LayerName[]) {
    const entityId = `${layer}:day:${day}`;
    const snapshot = await buildLayerSnapshot(layer, day);
    await dbRun("INSERT OR REPLACE INTO layer_snapshots (layer, day, entity_id, payload) VALUES (?, ?, ?, ?)", layer, day, entityId, JSON.stringify(snapshot));
    const hasChange = await dbFirst<{ one: number }>("SELECT 1 AS one FROM layer_changes WHERE layer = ? AND day = ? LIMIT 1", layer, day);
    if (!hasChange) {
      const event = await firstEventForLayer(day, layer);
      if (event) {
        await dbRun(
          `INSERT INTO layer_changes (id, layer, day, entity_table, entity_id, change_type, before_json, after_json, caused_by_event, summary, created_at)
           VALUES (?, ?, ?, ?, ?, 'update', NULL, ?, ?, ?, ?)`,
          randomUUID(),
          layer,
          day,
          `${layer}_state`,
          entityId,
          JSON.stringify(snapshot),
          event.id,
          `${layer} 层 Day ${day} 快照更新`,
          now,
        );
      }
    }
  }
}

async function firstEventForLayer(day: number, layer: LayerName) {
  const row = await dbFirst<WorkEventRow>("SELECT * FROM work_events WHERE day = ? AND layer = ? ORDER BY seq ASC LIMIT 1", day, layer);
  return row ? mapWorkEvent(row) : null;
}

async function buildLayerSnapshot(layer: LayerName, day: number) {
  const metrics = await getDay(day);
  if (layer === "mission") {
    const charter = await dbFirst<Record<string, unknown>>("SELECT * FROM mission_charter LIMIT 1");
    const strategy = await dbFirst<Record<string, unknown>>("SELECT * FROM mission_strategy WHERE status = 'active' ORDER BY effective_from DESC LIMIT 1");
    const okrs = await dbAll<Record<string, unknown>>("SELECT * FROM mission_okr WHERE status = 'active'");
    return { charter, strategy, okrs, progress: metrics ? { dau: metrics.dau, reputation: metrics.reputation } : null };
  }
  if (layer === "environment") {
    return {
      tools: await dbAll<Record<string, unknown>>("SELECT * FROM tool_registry ORDER BY name"),
      toolCalls: await dbFirst<{ count: number }>("SELECT COUNT(*) AS count FROM work_events WHERE day = ? AND event_type = 'tool_call'", day),
    };
  }
  if (layer === "memory") {
    return { entries: await dbAll<Record<string, unknown>>("SELECT * FROM memory_entries ORDER BY first_seen_day DESC LIMIT 20"), dailySignals: await memorySignals(day) };
  }
  if (layer === "structure") {
    return {
      employees: await dbAll<Record<string, unknown>>("SELECT id, display_name, role_template, status, joined_day, agent_handle FROM employees ORDER BY joined_day, id"),
      relations: await dbAll<Record<string, unknown>>("SELECT * FROM org_relations WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)", day, day),
    };
  }
  if (layer === "rules") {
    return {
      rules: await dbAll<Record<string, unknown>>("SELECT * FROM rules ORDER BY category, code"),
      executions: await dbAll<Record<string, unknown>>("SELECT * FROM rule_executions WHERE day = ?", day),
    };
  }
  if (layer === "resource") {
    return {
      metrics,
      settlement: await dbFirst<Record<string, unknown>>("SELECT * FROM daily_settlement WHERE day = ?", day),
      drivers: await dbAll<Record<string, unknown>>("SELECT * FROM settlement_drivers WHERE day = ?", day),
    };
  }
  return {
    signals: await dbAll<Record<string, unknown>>("SELECT * FROM growth_signals WHERE day = ?", day),
    proposals: await dbAll<Record<string, unknown>>("SELECT * FROM growth_proposals WHERE day <= ?", day),
    observations: await dbAll<Record<string, unknown>>("SELECT * FROM growth_observations WHERE day = ?", day),
  };
}

async function memorySignals(day: number) {
  const articles = await listPublishedArticles(day);
  return {
    articleCount: articles.length,
    averageQuality: articles.length ? Number((articles.reduce((sum, article) => sum + article.qualityScore, 0) / articles.length).toFixed(1)) : 0,
    topTags: Array.from(new Set(articles.flatMap((article) => article.tags))).slice(0, 8),
  };
}

export async function getWorkEvent(id: string) {
  const row = await dbFirst<WorkEventRow>("SELECT * FROM work_events WHERE id = ?", id);
  return row ? mapWorkEvent(row) : null;
}

export async function listWorkEvents(day: number, layer?: LayerName) {
  const rows = layer
    ? await dbAll<WorkEventRow>("SELECT * FROM work_events WHERE day = ? AND layer = ? ORDER BY seq ASC", day, layer)
    : await dbAll<WorkEventRow>("SELECT * FROM work_events WHERE day = ? ORDER BY seq ASC", day);
  return rows.map(mapWorkEvent);
}

export async function getLayerSnapshot(layer: LayerName, day: number) {
  const rows = await dbAll<{ entity_id: string; payload: string }>(
    "SELECT entity_id, payload FROM layer_snapshots WHERE layer = ? AND day = ? ORDER BY entity_id",
    layer,
    day,
  );
  const payload: Record<string, unknown> = {};
  for (const row of rows) payload[row.entity_id] = JSON.parse(row.payload);
  return payload;
}

export async function listLayerChanges(layer: LayerName, day: number) {
  const rows = await dbAll<LayerChangeRow>("SELECT * FROM layer_changes WHERE layer = ? AND day = ? ORDER BY created_at ASC", layer, day);
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    layer: row.layer,
    day: row.day,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    changeType: row.change_type,
    before: safeJson(row.before_json),
    after: safeJson(row.after_json),
    summary: row.summary,
    causedBy: await getWorkEvent(row.caused_by_event),
    createdAt: row.created_at,
  })));
}

export async function getLayerDay(layer: LayerName, day: number) {
  const [snapshot, changes, events] = await Promise.all([
    getLayerSnapshot(layer, day),
    listLayerChanges(layer, day),
    listWorkEvents(day, layer),
  ]);
  return { layer, day, snapshot, changes, events };
}

export async function getWorkEventImpact(id: string) {
  const rows = await dbAll<LayerChangeRow>("SELECT * FROM layer_changes WHERE caused_by_event = ? ORDER BY created_at ASC", id);
  const event = await getWorkEvent(id);
  const layerChanges = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    layer: row.layer,
    day: row.day,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    changeType: row.change_type,
    before: safeJson(row.before_json),
    after: safeJson(row.after_json),
    summary: row.summary,
    causedBy: await getWorkEvent(row.caused_by_event),
    createdAt: row.created_at,
  })));
  return {
    event,
    layerChanges,
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
      description: "广告收入 = DAU × 声誉分档 CPM / 1000。声誉越高，广告主出价越高。",
      parameters: AD_CPM_BY_REPUTATION,
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
    {
      id: "cost-structure",
      group: "因果公式",
      title: "成本构成",
      description: "每日总成本 = LLM Token成本 + 固定运营(¥18) + 简报发送(¥12) + 全体员工日薪。人力成本占大头，总编可通过 adjust_salary 工具调节。",
      parameters: { fixed: 18, newsletter: 12, labor: "按角色日薪汇总" },
    },
    {
      id: "revenue-net",
      group: "因果公式",
      title: "毛收入与纯收入",
      description: `毛收入 = 广告收入 + 订阅收入(订阅数×¥${SUBSCRIPTION_DAILY_PRICE}) + 赞助。纯收入 = 毛收入 - 所有成本（含人力）。纯收入为负意味着公司亏损。`,
      parameters: { subscription_daily_price: SUBSCRIPTION_DAILY_PRICE, sponsorship: "由 record_ad_sale 扩展" },
    },
  ];
}

export async function listEventsSince(day: number, afterSeq: number) {
  const rows = await dbAll<EventRow>(
    "SELECT * FROM sim_events WHERE day = ? AND seq > ? ORDER BY seq ASC LIMIT 100",
    day,
    afterSeq,
  );
  return rows.map(mapEvent);
}

export async function upsertAgentStream(update: {
  streamId: string;
  day: number;
  agentId: string;
  agentName: string;
  eventType: string;
  content: string;
  status: "start" | "delta" | "done" | "error";
  turn?: number;
}) {
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO agent_streams (stream_id, day, agent_id, agent_name, event_type, content, status, turn, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(stream_id) DO UPDATE SET
       content    = excluded.content,
       status     = excluded.status,
       updated_at = excluded.updated_at`,
    update.streamId,
    update.day,
    update.agentId,
    update.agentName,
    update.eventType,
    update.content,
    update.status,
    update.turn ?? null,
    now,
    now,
  );
}

export async function listActiveAgentStreams(day: number) {
  return dbAll<{
    stream_id: string;
    day: number;
    agent_id: string;
    agent_name: string;
    event_type: string;
    content: string;
    status: string;
    turn: number | null;
  }>(
    `SELECT stream_id, day, agent_id, agent_name, event_type, content, status, turn
     FROM agent_streams
     WHERE day = ? AND status NOT IN ('done', 'error')
     ORDER BY turn ASC, created_at ASC`,
    day,
  );
}
