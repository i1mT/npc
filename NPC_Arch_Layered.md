# NPC 架构设计：七层领域模型与存储 / API / Mastra Agent 运行
### 配套文档：基于 `NPC_Case_ContentCompany.md` 的硬范围补充

> 本文回答产品方案提出的硬约束：
> 1. 七层每一层都有独立模型 / 视图，不挂一张大表
> 2. 每层都能"按天快照 + 当天变更日志 + 变更来源事件"三种方式查看
> 3. 状态变化都能从 work_event 反查到来源
> 4. 创建员工 Agent 有一条完整接口链路
> 5. 前台每一天的呈现，可以解释为当天七层共同作用的结果

---

## 0. 设计骨架

整套系统采用 **"事件溯源 + 按层投影"** 模式：

```
        Mastra Agent / Workflow / Tool                    Dashboard
                  │                                          ▲
        ┌─────────▼─────────┐                                │
        │   EventLogger      │  ── write ──┐                 │
        │  (OTEL Exporter)   │             │                 │
        └────────────────────┘             ▼                 │
                                ┌───────────────────┐        │
                                │   work_events     │ ◀───── SSE
                                │ (single source of │
                                │      truth)       │
                                └─────────┬─────────┘
                                          │ projector
              ┌────────────┬──────────┬───┴──────┬─────────────┬────────────┐
              ▼            ▼          ▼          ▼             ▼            ▼
        mission_*    environment_*  memory_*  structure_* rules_*  resource_*  growth_*
        (snapshot + change_log per day per layer)
                                          │
                                          ▼
                              ┌───────────────────┐
                              │   Read API 三件套 │
                              │ /snapshot /changes/events
                              └───────────────────┘
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                  Dashboard 七层入口             Portal 当日聚合 DTO
```

要点：

- **work_events** 是单一事实源。任何状态变更都必须先有事件。
- **projector** 是纯函数：(event) → (layer change_log row + snapshot delta)。每次 day 结算时，把当天 change_log 合并写入 `*_snapshots` 表。
- **每层都有同一套表前缀**：`<layer>_state` (当前态) / `<layer>_snapshots` (按日切片) / `<layer>_changes` (按日变更日志)。
- **三件套 API** 强制契约：`/api/layer/{layer}/snapshot/:day`、`/changes/:day`、`/events/:day`。前台和后台都走同一套读 API。

---

## 1. 通用基础表

### 1.1 work_events （取代现 `sim_events`，向后兼容映射）

```sql
CREATE TABLE work_events (
  id          TEXT PRIMARY KEY,
  day         INTEGER NOT NULL,
  seq         INTEGER NOT NULL,             -- 当天内序号
  ts          TEXT    NOT NULL,             -- ISO-8601
  actor_id    TEXT    NOT NULL,             -- employee_id / 'board' / 'system' / 'ceo'
  actor_type  TEXT    NOT NULL,             -- agent | board | system
  layer       TEXT    NOT NULL,             -- mission | environment | memory | structure | rules | resource | growth | work
  event_type  TEXT    NOT NULL,             -- 见枚举
  action      TEXT    NOT NULL,             -- 业务动作名（如 review_article / okr_step_up）
  content     TEXT,
  payload     TEXT,                         -- JSON：参数 / 结果
  refs        TEXT,                         -- JSON：{parent_event_id, related_employee_id, target_entity_id, target_table, ...}
  cost_token  INTEGER DEFAULT 0,
  cost_yuan   REAL    DEFAULT 0,
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_work_events_day_seq ON work_events(day, seq);
CREATE INDEX idx_work_events_actor   ON work_events(actor_id);
CREATE INDEX idx_work_events_layer   ON work_events(layer, day);

-- event_type 枚举：
--   thinking | message | tool_call | tool_result | decision | board
--   mission_update | memory_write | memory_read | rule_trigger
--   org_change | settlement | growth_trigger | strategy_amend
```

> 现有 `sim_events` 改为 view 或一次性迁移：
> ```sql
> CREATE VIEW sim_events AS
> SELECT id, day, seq, actor_id agent_id, actor_id agent_name,
>        event_type, content, payload metadata, created_at
> FROM work_events;
> ```

### 1.2 layer_changes （每层一份，结构相同）

每层的 `<layer>_changes` 表统一字段：

```sql
CREATE TABLE <layer>_changes (
  id              TEXT PRIMARY KEY,
  day             INTEGER NOT NULL,
  entity_table    TEXT NOT NULL,        -- 例：mission_okr
  entity_id       TEXT NOT NULL,
  change_type     TEXT NOT NULL,        -- create | update | delete | trigger | violate | inherit
  before_json     TEXT,
  after_json      TEXT,
  caused_by_event TEXT NOT NULL,        -- work_events.id
  summary         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_<layer>_changes_day ON <layer>_changes(day);
```

### 1.3 layer_snapshots （每层一份，按 day 切片）

每层的 `<layer>_snapshots(day, payload_json)`：

```sql
CREATE TABLE <layer>_snapshots (
  day         INTEGER NOT NULL,
  entity_id   TEXT    NOT NULL,
  payload     TEXT    NOT NULL,         -- 整体序列化，便于按天回放
  PRIMARY KEY (day, entity_id)
);
```

> 这样每层只需关心自己的 `_state` 表与 projector，三件套查询契约由通用模板生成。

---

## 2. 七层逐层模型

下面只列每层独有的实体表，通用的 `_changes` / `_snapshots` 不再重复。

### 2.1 使命层 Mission

```sql
CREATE TABLE mission_charter (         -- 宪法层，锁定
  id         TEXT PRIMARY KEY,
  statement  TEXT NOT NULL,
  values_json TEXT NOT NULL,           -- 三条价值观
  locked     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE mission_strategy (        -- 战略层，可被董事会改
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  effective_from INTEGER NOT NULL,     -- day
  effective_to   INTEGER,
  status        TEXT NOT NULL,         -- active | archived | superseded
  superseded_by TEXT
);

CREATE TABLE mission_okr (             -- OKR 层
  id            TEXT PRIMARY KEY,
  stage         INTEGER NOT NULL,      -- 1=初始, 2=增长, 3=规模
  metric        TEXT NOT NULL,         -- dau | monthly_revenue | open_rate ...
  target        REAL NOT NULL,
  upper_bound   REAL,                  -- 触发下一步进的阈值
  effective_from INTEGER NOT NULL,
  status        TEXT NOT NULL          -- active | reached | archived
);

CREATE TABLE mission_okr_progress (    -- 按日完成度快照
  day        INTEGER NOT NULL,
  okr_id     TEXT NOT NULL,
  current    REAL NOT NULL,
  gap        REAL NOT NULL,
  PRIMARY KEY (day, okr_id)
);

CREATE TABLE mission_amendments (      -- 修改记录
  id              TEXT PRIMARY KEY,
  day             INTEGER NOT NULL,
  scope           TEXT NOT NULL,       -- charter | strategy | okr
  proposed_by     TEXT NOT NULL,
  approved_by     TEXT NOT NULL,
  before_json     TEXT,
  after_json      TEXT,
  reason          TEXT NOT NULL,
  caused_by_event TEXT NOT NULL
);
```

projector 行为：
- 任何 `event_type = mission_update | board_directive` 写入 `mission_amendments` 并刷新 `mission_strategy` / `mission_okr`。
- 每日 settle 时把当日 `current` 值算出，写入 `mission_okr_progress`。

### 2.2 能力层 Environment

```sql
CREATE TABLE tool_registry (
  id            TEXT PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  kind          TEXT NOT NULL,         -- real_data | mock_api | internal
  scope         TEXT NOT NULL,         -- public | restricted
  description   TEXT NOT NULL,
  schema_json   TEXT NOT NULL,         -- 入参/出参 JSONSchema
  status        TEXT NOT NULL,         -- active | deprecated
  created_at    TEXT NOT NULL
);

CREATE TABLE tool_grants (             -- 员工 → 工具授权
  employee_id   TEXT NOT NULL,
  tool_id       TEXT NOT NULL,
  budget_yuan   REAL,                  -- 单次/单日上限
  granted_at    TEXT NOT NULL,
  revoked_at    TEXT,
  PRIMARY KEY (employee_id, tool_id)
);

CREATE TABLE tool_calls (              -- 与 work_events 1:1 镜像，便于聚合
  event_id      TEXT PRIMARY KEY,      -- 指向 work_events.id
  day           INTEGER NOT NULL,
  employee_id   TEXT NOT NULL,
  tool_id       TEXT NOT NULL,
  args_json     TEXT NOT NULL,
  result_json   TEXT,
  ok            INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  cost_yuan     REAL NOT NULL
);

CREATE TABLE tool_daily_usage (        -- 每日聚合
  day              INTEGER NOT NULL,
  tool_id          TEXT NOT NULL,
  call_count       INTEGER NOT NULL,
  unique_callers   INTEGER NOT NULL,
  total_cost_yuan  REAL NOT NULL,
  PRIMARY KEY (day, tool_id)
);
```

projector 行为：每条 `tool_call` 事件 → 写 `tool_calls`、累加 `tool_daily_usage`、写入 `environment_changes`（仅在工具上下线 / 授权变更时）。

### 2.3 记忆层 Memory

```sql
CREATE TABLE memory_entries (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,        -- editorial_log | content_perf | source_quality | audience | advertiser
  key            TEXT NOT NULL,        -- 业务键（如 source_id, topic_tag）
  body_json      TEXT NOT NULL,
  weight         REAL NOT NULL,        -- 强度 0~1
  status         TEXT NOT NULL,        -- active | deprecated | refuted
  first_seen_day INTEGER NOT NULL,
  last_used_day  INTEGER,
  origin_event   TEXT NOT NULL         -- 首次写入事件
);

CREATE TABLE memory_writes (
  event_id     TEXT PRIMARY KEY,       -- = work_events.id
  day          INTEGER NOT NULL,
  employee_id  TEXT NOT NULL,
  entry_id     TEXT NOT NULL,
  op           TEXT NOT NULL,          -- create | reinforce | refute | deprecate
  delta_json   TEXT NOT NULL
);

CREATE TABLE memory_reads (
  event_id     TEXT PRIMARY KEY,
  day          INTEGER NOT NULL,
  employee_id  TEXT NOT NULL,
  entry_id     TEXT NOT NULL,
  context      TEXT NOT NULL           -- 例：select_articles / strategy_review
);

CREATE TABLE memory_links (            -- 跨实体引用（如某文章引用了某条记忆）
  day          INTEGER NOT NULL,
  entry_id     TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  relation     TEXT NOT NULL,          -- supports | refutes | informs
  caused_by    TEXT NOT NULL
);
```

Projector 行为：所有 `memory_write` / `memory_read` 事件即时落表；`memory_changes` 仅在 entry 状态变化 / 新增 / 否决时写。`memory_snapshots(day)` 按日序列化 active entries 数量、权重直方图。

### 2.4 组织层 Structure

```sql
CREATE TABLE employees (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  role_template   TEXT NOT NULL,       -- editor_in_chief | editor | growth | business | column ...
  status          TEXT NOT NULL,       -- onboarding | active | observing | suspended | offboarded
  joined_day      INTEGER NOT NULL,
  left_day        INTEGER,
  system_prompt   TEXT NOT NULL,
  agent_handle    TEXT NOT NULL,       -- Mastra agent name，用于 runtime 注册
  caused_by_event TEXT NOT NULL
);

CREATE TABLE org_relations (           -- 汇报关系（按日生效）
  id              TEXT PRIMARY KEY,
  superior_id     TEXT NOT NULL,
  subordinate_id  TEXT NOT NULL,
  effective_from  INTEGER NOT NULL,
  effective_to    INTEGER
);

CREATE TABLE employee_responsibilities (
  employee_id     TEXT NOT NULL,
  responsibility  TEXT NOT NULL,
  effective_from  INTEGER NOT NULL,
  effective_to    INTEGER,
  PRIMARY KEY (employee_id, responsibility, effective_from)
);

CREATE TABLE employee_daily_contribution (
  day              INTEGER NOT NULL,
  employee_id      TEXT NOT NULL,
  summary          TEXT NOT NULL,      -- 当日工作摘要（由日结生成）
  decisions        INTEGER NOT NULL,
  tool_calls       INTEGER NOT NULL,
  cost_yuan        REAL    NOT NULL,
  output_refs      TEXT,               -- JSON: 文章 id / 广告投放 id
  PRIMARY KEY (day, employee_id)
);
```

`structure_snapshots(day)` 序列化当日组织图（节点 + 关系 + 状态）。`structure_changes(day)` 记录 onboarding / role change / offboarding。

### 2.5 规则层 Rules

```sql
CREATE TABLE rules (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,    -- 例：HARD_SOURCE_URL_REQUIRED
  category    TEXT NOT NULL,           -- hard | soft | authorization
  text        TEXT NOT NULL,
  threshold_json TEXT,                 -- 数值类规则的阈值
  effective_from INTEGER NOT NULL,
  status      TEXT NOT NULL            -- active | archived
);

CREATE TABLE rule_executions (
  event_id    TEXT PRIMARY KEY,        -- = work_events.id
  day         INTEGER NOT NULL,
  rule_id     TEXT NOT NULL,
  outcome     TEXT NOT NULL,           -- triggered | passed | violated | approved
  target_ref  TEXT,                    -- 关联文章 / 广告 / 决策
  notes       TEXT
);

CREATE TABLE rule_daily_summary (
  day            INTEGER NOT NULL,
  rule_id        TEXT NOT NULL,
  triggered      INTEGER NOT NULL,
  violated       INTEGER NOT NULL,
  approved       INTEGER NOT NULL,
  PRIMARY KEY (day, rule_id)
);
```

Projector：rule_trigger 事件 → 写 `rule_executions` 并累加 `rule_daily_summary`。

### 2.6 资源织网 Resource Fabric

```sql
CREATE TABLE resource_metrics (        -- 当前态（替换 sim_days 当前行）
  metric    TEXT PRIMARY KEY,          -- capital | reputation | dau | subscribers | ad_revenue ...
  value     REAL NOT NULL,
  updated_day INTEGER NOT NULL
);

CREATE TABLE daily_settlement (
  day               INTEGER PRIMARY KEY,
  revenue_breakdown TEXT NOT NULL,     -- JSON: ad / subscription / sponsorship
  cost_breakdown    TEXT NOT NULL,     -- JSON: llm / fixed / newsletter / promotion
  capital_delta     REAL NOT NULL,
  reputation_delta  REAL NOT NULL,
  dau_delta         INTEGER NOT NULL,
  subscribers_delta INTEGER NOT NULL,
  settled_at        TEXT NOT NULL
);

CREATE TABLE settlement_drivers (      -- 因子：哪条事件 / 哪条决策导致变化
  day            INTEGER NOT NULL,
  metric         TEXT NOT NULL,
  factor         TEXT NOT NULL,        -- quality_score | social_reach | ad_density ...
  delta          REAL NOT NULL,
  caused_by_event TEXT NOT NULL,
  PRIMARY KEY (day, metric, factor)
);

CREATE TABLE ad_inventory (
  id          TEXT PRIMARY KEY,
  slot_code   TEXT NOT NULL,
  cpm_base    REAL NOT NULL
);

CREATE TABLE ad_placements (
  id          TEXT PRIMARY KEY,
  day         INTEGER NOT NULL,
  slot_id     TEXT NOT NULL,
  advertiser  TEXT NOT NULL,
  payload     TEXT NOT NULL,           -- 落地内容
  revenue     REAL NOT NULL,
  caused_by_event TEXT NOT NULL
);
```

`resource_snapshots(day)` = `daily_settlement(day)` + `resource_metrics` 当日值快照。`resource_changes(day)` 来自 `settlement_drivers`。

### 2.7 生长协议 Growth Protocol

```sql
CREATE TABLE growth_signals (
  id            TEXT PRIMARY KEY,
  day           INTEGER NOT NULL,
  type          TEXT NOT NULL,         -- bottleneck | crisis | excess_capacity
  metric_refs   TEXT NOT NULL,         -- JSON: 哪些指标触发
  description   TEXT NOT NULL,
  caused_by_event TEXT NOT NULL
);

CREATE TABLE growth_proposals (
  id            TEXT PRIMARY KEY,
  day           INTEGER NOT NULL,
  signal_id     TEXT,
  proposer_id   TEXT NOT NULL,         -- employee_id 或 board
  scope         TEXT NOT NULL,         -- create_role | restructure | shrink | adjust_okr
  payload_json  TEXT NOT NULL,         -- 含 role_template、reports_to 等
  status        TEXT NOT NULL          -- proposed | approved | rejected | executed
);

CREATE TABLE growth_decisions (
  proposal_id   TEXT PRIMARY KEY,
  decided_by    TEXT NOT NULL,
  decided_day   INTEGER NOT NULL,
  outcome       TEXT NOT NULL,
  notes         TEXT,
  caused_by_event TEXT NOT NULL
);

CREATE TABLE growth_observations (     -- 观察期数据
  employee_id   TEXT NOT NULL,
  day           INTEGER NOT NULL,
  kpi_json      TEXT NOT NULL,         -- 当日核心 KPI
  status        TEXT NOT NULL,         -- on_track | warning | failed | graduated
  PRIMARY KEY (employee_id, day)
);
```

Projector：`growth_trigger` 事件 → 写 signal；CEO/Board `decision` 事件 → 写 proposals/decisions；新员工每日产出会写 observation。

---

## 3. "按天快照 / 变更日志 / 来源事件追溯" 统一契约

每层都需实现的三件套（read API + projector + UI 入口）：

| 契约 | API | 数据来源 |
|------|------|----------|
| 按天快照 | `GET /api/layer/:layer/snapshot/:day` | `<layer>_snapshots` |
| 当天变更 | `GET /api/layer/:layer/changes/:day` | `<layer>_changes` JOIN `work_events` |
| 来源事件 | `GET /api/layer/:layer/events/:day` | `work_events WHERE layer=?` |

返回结构通用：
```ts
type LayerDayDTO = {
  layer: string
  day: number
  snapshot: any                       // 整体序列化
  changes: Array<{
    id: string
    change_type: 'create'|'update'|'delete'|'trigger'|'violate'|'inherit'
    entity: { table: string, id: string }
    before?: any
    after?: any
    summary: string
    causedBy: WorkEventLite           // 关键：每条变更都能跳回事件
  }>
  events: WorkEventLite[]
}
```

并提供反向追溯：
- `GET /api/work-events/:id` → 列出该事件触发的所有 `<layer>_changes`、`tool_calls`、`memory_writes`、`rule_executions`、`settlement_drivers`。

> **强约束**：projector 写任何 `<layer>_changes` 时必须填 `caused_by_event`，否则拒绝写入。这是"事件→状态→前后台结果"闭环的执行点。

---

## 4. 创建员工 Agent 接口

### 4.1 接口

```
POST /api/employees
Content-Type: application/json
{
  "displayName":   "增长 Agent",
  "roleTemplate":  "growth",
  "reportsTo":     "<employee_id of editor_in_chief>",
  "responsibilities": [
    "SEO 优化历史文章",
    "Twitter 摘要发布",
    "A/B 测试标题"
  ],
  "toolGrants": [
    { "tool": "sim.social.post",    "budgetYuan": 500 },
    { "tool": "sim.analytics.get",  "budgetYuan": null }
  ],
  "authLimits": {
    "promotion_budget_per_day": 500
  },
  "memoryInherit": [
    { "type": "content_perf" },
    { "type": "audience" }
  ],
  "systemPromptTemplate": "growth_v1",
  "observationDays": 14,
  "trigger": {
    "kind":  "board_directive",      // 或 ceo_decision / growth_proposal
    "refId": "<growth_proposal.id>"
  },
  "effectiveFromDay": 12
}
```

**Response** `201`：
```json
{
  "employeeId": "...",
  "agentHandle": "growth-agent-2",
  "status": "onboarding",
  "createdEventId": "evt-..."
}
```

### 4.2 服务端处理链（事务）

```
1. 校验授权
   - trigger.kind == board_directive  → 必须存在已通过的 board_directives 行
   - trigger.kind == ceo_decision     → 必须存在 actor=ceo 的 decision 事件
   - trigger.kind == growth_proposal  → 必须 status=approved
2. 写 work_event:
   { layer:'structure', event_type:'org_change',
     action:'create_employee', actor=trigger.refId, payload=入参 }
3. INSERT employees(status='onboarding', caused_by_event=evt.id)
4. INSERT org_relations(superior=reportsTo, effective_from=effectiveFromDay)
5. INSERT employee_responsibilities × N
6. INSERT tool_grants × N
7. memoryInherit:
   - 查 memory_entries by type
   - 为每条写 memory_links(target=employee, relation='inherit', caused_by=evt.id)
8. 编译 system prompt:
   = mission_charter.statement + values
   + 当前 mission_strategy.active
   + role_template 文案
   + responsibilities 列表
   + 工具清单 + 授权额度
   + memoryInherit 摘要（最多 N 条，按 weight 排序）
9. 注册 Mastra Agent:
   agentFactory.register(agentHandle, {
     instructions: system_prompt,
     tools:        toolGrants → 解析为 Mastra tools,
     model:        anthropic('claude-sonnet-4-6')
   })
10. INSERT growth_observations(day=effectiveFromDay, status='on_track')
11. 推送 structure_changes(day, change_type='create',
       entity_table='employees', after_json=..., caused_by_event=evt.id)
12. SSE 广播 employee_created
```

### 4.3 在日工作流中自动接入

`daily-workflow` 重构为 **由组织图动态生成步骤**：

```ts
function buildDailyWorkflow(day: number): Workflow {
  const org = loadOrgGraph(day)          // 来自 employees + org_relations
  const root = org.find(e => e.role === 'editor_in_chief')
  const wf = new Workflow({ name: `daily-${day}` })

  wf.step('set-agenda', { agent: agentFactory.get(root.handle) })
  for (const child of org.childrenOf(root.id)) {
    wf.step(`work:${child.handle}`, { agent: agentFactory.get(child.handle) })
  }
  wf.step('review',     { agent: agentFactory.get(root.handle) })
  wf.step('settle-day', { executor: projectorService.settleDay })
  return wf
}
```

> 新员工从 `effectiveFromDay` 开始自然进入下一轮 daily-workflow，无需改 workflow 代码。

---

## 5. Mastra Agent 运行设计

### 5.1 Agent Factory

`src/mastra/agent-factory.ts`：

```ts
class AgentFactory {
  private agents = new Map<string, Agent>()

  register(handle: string, def: AgentDef): Agent { ... }
  get(handle: string): Agent { ... }
  hotReload(handle: string): void { ... }
  list(): AgentDef[] { ... }
}
```

- 程序启动时从 `employees WHERE status IN ('active','onboarding','observing')` 一次性 register。
- 创建员工接口在事务末尾调用 `register`；删除时调用 `unregister`。

### 5.2 RoleTemplate 抽象

`src/mastra/role-templates/`：

```
editor_in_chief.ts
editor.ts
growth.ts
business.ts
column.ts
```

每个 template 导出：
```ts
export const growthTemplate = {
  code: 'growth',
  defaultTools: ['sim.social.post', 'sim.analytics.get', 'queryArticles'],
  promptBuilder(ctx: PromptCtx): string { ... },
  responsibilitiesHint: [...],
}
```

### 5.3 EventLogger + Projector

`src/mastra/event-logger.ts`：实现 OpenTelemetry SpanExporter。
- 每个 span end → 转换为 `work_events` 行。
- agent message / tool call / tool result / decision 全部覆盖。

`src/simulation/projector.ts`：纯函数 `project(event) → ChangeRow[]`
- 由订阅 `EventBus` 触发，落到对应 `<layer>_changes`。
- 每日 settle 阶段批量将变更卷成 `<layer>_snapshots`。

### 5.4 记忆接入

`src/mastra/memory-adapter.ts`：包装 Mastra Memory，实际读写经由 `memory_entries` + 触发 `memory_read/memory_write` 事件。

```ts
class MemoryAdapter implements MastraMemory {
  async read(query) {
    const entries = ...
    await emit({event_type:'memory_read', payload:{ entry_ids: ids }})
    return entries
  }
  async write(entry) {
    await emit({event_type:'memory_write', ...})
    await db.insert(memory_entries).values(...)
  }
}
```

### 5.5 工具调用统一包装

所有 sim.* 工具用 `withToolCallLogging(tool)` 包装：
- 记录 `tool_call` 事件（含入参）
- 执行原工具
- 记录 `tool_result` 事件（含结果 + 耗时 + 估算成本）

---

## 6. 前台动态渲染数据链路

### 6.1 数据契约

```
GET /api/portal/day/:day
→ PageDayDTO
```

```ts
type PageDayDTO = {
  day: number
  date: string
  edition: number
  mission: {
    statement: string
    values: string[]
    strategy: { title: string, description: string }
    okr: Array<{ metric: string, target: number, current: number, gap: number, stage: number }>
  }
  metrics: {                    // 来自 daily_settlement + resource_metrics
    capital: number
    capitalDelta: number
    reputation: number
    reputationDelta: number
    dau: number
    dauDelta: number
    subscribers: number
    adRevenue: number
  }
  articles: Array<{
    id: string
    titleZh: string
    summaryZh: string
    contentZh: string
    sourceUrl: string
    imageUrl?: string
    tags: string[]
    qualityScore: number
    byline: { editor: string, editorInChief: string }
    memoryHighlights: Array<{   // 解释"为什么这天发这篇"
      entryId: string
      type: string
      reason: string
    }>
    causedByEventIds: string[]  // 跳转后台事件流
  }>
  ads: Array<{ slotCode: string, advertiser: string, payload: any, revenue: number }>
  contributors: Array<{ employeeId: string, displayName: string, role: string, summary: string }>
  changeSummary: {              // 当日七层变更摘要
    mission: number
    memory: number
    structure: number
    rules: number
    growth: number
  }
}
```

### 6.2 服务端聚合（伪代码）

```ts
async function getPortalDay(day: number): PageDayDTO {
  const [
    missionSnap, missionOkr,
    settlement,  metrics,
    articles,    ads,
    contributors,
    memoryLinks, changesByLayer
  ] = await Promise.all([
    db.query('SELECT * FROM mission_snapshots WHERE day=?', day),
    db.query('SELECT * FROM mission_okr_progress WHERE day=?', day),
    db.query('SELECT * FROM daily_settlement WHERE day=?', day),
    db.query('SELECT * FROM resource_metrics'),
    db.query('SELECT * FROM published_articles WHERE day=?', day),
    db.query('SELECT * FROM ad_placements WHERE day=?', day),
    db.query('SELECT * FROM employee_daily_contribution WHERE day=?', day),
    db.query('SELECT * FROM memory_links WHERE day=? AND target_table=?', day, 'published_articles'),
    aggregateLayerChangeCounts(day),
  ])
  return assemble(...)
}
```

### 6.3 渲染策略

- **静态化**：每天 settle 完成后触发 ISR revalidate，确保前台是该天最终结果。
- **回放**：侧边栏选择某天 → 直接命中缓存。
- **可解释**：文章卡片可展开"幕后"抽屉：展示 `memoryHighlights` + `causedByEventIds`，点击跳到后台事件流定位。
- **使命/指标顶栏**：使用 `mission` + `metrics` 渲染（不是写死）。
- **变更摘要**：在每期顶部显示"今日七层变化数"，引导回看后台。

> 这是产品方案验收第 5 条"某一天的前台页面，能被解释为这七层在当天共同作用后的结果"的落地点。

---

## 7. API 总览（新增/改造）

### 七层三件套
```
GET /api/layer/:layer/snapshot/:day
GET /api/layer/:layer/changes/:day
GET /api/layer/:layer/events/:day
GET /api/work-events/:id/impact
```

### 员工 / 组织 / 生长
```
POST /api/employees
GET  /api/employees
GET  /api/employees/:id
PATCH /api/employees/:id        # 角色 / 状态调整（仅 CEO/Board）
GET  /api/org-graph?day=N

POST /api/growth/signals
POST /api/growth/proposals
POST /api/growth/decisions
```

### 记忆 / 工具 / 规则 浏览
```
GET /api/memory?type=...&day=...
GET /api/memory/:id
GET /api/tools
GET /api/tools/:id/usage?day=...
GET /api/rules
GET /api/rules/:id/executions?day=...
```

### 经营 / 董事会
```
GET  /api/settlement/:day
POST /api/sim/board-decision    # 已有
GET  /api/board/meetings
GET  /api/board/meetings/:day
```

### 前台
```
GET /api/portal/day/:day
GET /api/portal/days            # 已发布天列表（含使命与指标摘要）
```

### 既有 SSE 扩展
```
GET /api/sim/stream
事件类型: event | day_complete | board_triggered | employee_created
        | strategy_amended | growth_signal | rule_violated
```

---

## 8. 实现路径（建议拆分）

> 工程实现等本文档与"后台页面 IA、交互状态与逐页验收单"双方对齐后启动。

| 阶段 | 范围 | 关键产物 |
|------|------|---------|
| A. 数据基线 | 重写 `schema.sql`、迁移现 `sim_events`/`sim_days`、生成 projector 模板 | 新表 + 单元测试 + 历史数据迁移脚本 |
| B. 事件层 | EventLogger / EventBus / projector 接入七层 | `work_events` 全链路、三件套 API 联调 |
| C. Agent runtime | Agent Factory + role templates + 动态 daily-workflow | `POST /api/employees` 可创建新员工，日工作流自动接入 |
| D. 记忆/规则/资源 | MemoryAdapter、ruleEngine、settlement breakdown | 记忆条目可见、规则执行可见、收支拆解可见 |
| E. 生长协议 | 信号 / 提案 / 决议 / 观察期 | 董事会可发起扩张/收缩，新员工自动落地 |
| F. 前台聚合 | `/api/portal/day/:day` + 杂志页改造 | 当日页面来自七层动态聚合，含可解释抽屉 |
| G. 后台 UI | 七层各页 + 工作事件流 + 组织/员工 + 日结 + 董事会 + 前台回放 | 与视觉设计师 IA 对齐后并行 |

---

## 9. 与产品方案的逐条对齐

| 产品要求 | 对应方案 |
|----------|----------|
| 每层有独立查看入口 | 七层独立表 + `/api/layer/:layer/*` 三件套 |
| 每层按日变化 | `<layer>_snapshots` + `<layer>_changes` + 通用契约 |
| 每层数据来源可说明 | `caused_by_event` 强制不可空 + `work-events/:id/impact` |
| 任意争议决策可追溯规则 | `rule_executions.target_ref` + 决策事件 `refs` |
| 新员工有真实背景与入职记录 | `POST /api/employees` 强制 `trigger` 字段 + `growth_observations` |
| 前台是七层共同作用的结果 | `PageDayDTO` 聚合七层 + 文章"幕后"抽屉 |

---

*版本：架构稿 v0.1 · 待与视觉设计师 IA 文档对齐后进入工程实现*
