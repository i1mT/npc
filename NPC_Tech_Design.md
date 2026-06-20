# AGI Daily NPC — 技术设计方案
### 基于 Mastra + Next.js 的全模拟推演系统

---

## 技术栈

| 层 | 技术 | 理由 |
|----|------|------|
| Agent 框架 | **Mastra** | TypeScript 原生，内置 Workflow、Memory、A2A 协议 |
| Web 框架 | **Next.js 15** (App Router) | 前后台同构，API Routes 即服务层 |
| 数据库 | **better-sqlite3** | 轻量，适合本地模拟；agidaily.db 直接读取 |
| UI | **Tailwind CSS + shadcn/ui** | 快速出杂志风格 |
| 实时推送 | **SSE (Server-Sent Events)** | 运行时事件流推送到后台 Dashboard |
| LLM | **Anthropic Claude** (via Mastra) | 通过 Mastra 的 model router 接入 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js App                         │
│                                                         │
│  ┌─────────────────┐      ┌──────────────────────────┐  │
│  │   前台 Portal    │      │    后台 Dashboard         │  │
│  │  /              │      │    /dashboard             │  │
│  │  杂志式内容展示  │      │    Agent 事件流 + 控制台  │  │
│  └─────────────────┘      └──────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │                   API Routes                        ││
│  │  /api/sim/*   /api/days/*   /api/sim/stream (SSE)  ││
│  └──────────────────────┬──────────────────────────────┘│
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                  Simulation Engine                       │
│                                                         │
│  SimClock ──→ DailyWorkflow (Mastra)                    │
│                    ├── EditorInChiefAgent                │
│                    └── EditorAgent                       │
│                                                         │
│  MockAPILayer ──→ sim.analytics / sim.ads / sim.bank    │
│  EventLogger  ──→ 所有 agent 动作写入 sim.db            │
└──────────────┬────────────────────────────┬─────────────┘
               │                            │
    ┌──────────▼──────────┐     ┌───────────▼──────────┐
    │     agidaily.db      │     │       sim.db          │
    │  (只读，真实文章池)   │     │  (模拟状态 + 事件日志) │
    └─────────────────────┘     └──────────────────────┘
```

---

## 目录结构

```
agidaily-npc/
├── src/
│   ├── mastra/
│   │   ├── agents/
│   │   │   ├── editor-in-chief.ts    # 总编 Agent
│   │   │   └── editor.ts             # 编辑 Agent
│   │   ├── tools/
│   │   │   ├── article-tools.ts      # 查询 agidaily.db
│   │   │   └── sim-tools.ts          # 所有模拟 API 工具
│   │   ├── workflows/
│   │   │   ├── daily-workflow.ts     # 每日主循环
│   │   │   └── board-meeting.ts      # 每7天董事会
│   │   └── index.ts                  # Mastra 实例导出
│   ├── simulation/
│   │   ├── engine.ts                 # SimClock 状态机
│   │   ├── mock-apis.ts              # 模拟环境实现
│   │   └── formulas.ts               # 因果公式（非随机）
│   └── db/
│       ├── articles.ts               # agidaily.db 查询层
│       ├── sim.ts                    # sim.db 读写层
│       └── schema.sql                # sim.db 建表语句
├── app/
│   ├── page.tsx                      # 前台 Portal
│   ├── dashboard/
│   │   └── page.tsx                  # 后台 Dashboard
│   └── api/
│       ├── sim/
│       │   ├── start/route.ts
│       │   ├── stop/route.ts
│       │   ├── status/route.ts
│       │   └── stream/route.ts       # SSE 实时事件流
│       └── days/
│           ├── route.ts              # 所有已完成的天列表
│           └── [day]/
│               ├── events/route.ts
│               ├── articles/route.ts
│               └── metrics/route.ts
└── package.json
```

---

## 数据库设计

### agidaily.db（只读，已有）
直接读取 `items` 表，关键字段：`id`, `title`, `summary`, `content`, `source_url`, `tags`, `pub_date`, `translations`（含 zh-CN）

### sim.db（新建，模拟状态）

```sql
-- 每日状态快照
CREATE TABLE sim_days (
  day           INTEGER PRIMARY KEY,
  capital       REAL    NOT NULL,
  reputation    REAL    NOT NULL,   -- 0~100
  dau           INTEGER NOT NULL,
  subscribers   INTEGER NOT NULL,
  ad_revenue    REAL    NOT NULL,
  llm_cost      REAL    NOT NULL,
  is_board_day  INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT
);

-- Agent 事件流（后台 Dashboard 的数据源）
CREATE TABLE sim_events (
  id          TEXT    PRIMARY KEY,
  day         INTEGER NOT NULL,
  seq         INTEGER NOT NULL,   -- 当天内的顺序
  agent_id    TEXT    NOT NULL,
  agent_name  TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,   -- 见下方枚举
  content     TEXT    NOT NULL,
  metadata    TEXT,               -- JSON: tool args/result/from/to
  created_at  TEXT    NOT NULL
);
-- event_type 枚举:
--   'thinking'     agent 内部推理
--   'message'      agent 间消息
--   'tool_call'    调用工具
--   'tool_result'  工具返回
--   'decision'     关键决策（高亮展示）
--   'board'        董事会发言/指令

-- 每日发布的文章
CREATE TABLE published_articles (
  id           TEXT    PRIMARY KEY,
  day          INTEGER NOT NULL,
  source_id    TEXT    NOT NULL,  -- 对应 agidaily.db items.id
  title_zh     TEXT    NOT NULL,
  summary_zh   TEXT    NOT NULL,
  content_zh   TEXT    NOT NULL,
  tags         TEXT,              -- JSON array
  quality_score REAL   NOT NULL,  -- agent 评分 0~10
  created_at   TEXT    NOT NULL
);

CREATE INDEX idx_events_day ON sim_events(day, seq);
CREATE INDEX idx_articles_day ON published_articles(day);
```

---

## 模拟引擎设计

### SimClock（engine.ts）

状态机，持久化到 sim.db，重启不丢失：

```typescript
type SimStatus = 'idle' | 'running' | 'paused'

class SimClock {
  async start(): Promise<void>       // 开始连续推进天数
  async stop(): Promise<void>        // 暂停（当天跑完再停）
  async advanceOneDay(): Promise<void> // 手动推进一天
  getStatus(): { day: number; status: SimStatus; state: DayState }

  private async runDay(day: number): Promise<void> {
    // 1. 触发 Mastra daily workflow
    // 2. workflow 完成后结算 mock API
    // 3. 更新 sim_days
    // 4. 若 day % 7 === 0 → 触发 board meeting workflow
    // 5. 通过 SSE 推送完成信号
  }
}
```

### 因果公式（formulas.ts）

模拟值**不是随机数**，由 agent 行为决定：

```typescript
// DAU：受内容质量分和社交曝光量影响
function nextDAU(current: number, qualityScore: number, socialReach: number): number {
  const churn     = current * 0.005                    // 固定 0.5% 日流失
  const organic   = current * (qualityScore / 10) * 0.03  // 质量越高增长越快
  const social    = socialReach * 0.1                  // 每条转发带来 0.1 个新用户
  return Math.round(current - churn + organic + social)
}

// 广告收入：DAU × CPM，CPM 受 Reputation 影响
function adRevenue(dau: number, reputation: number): number {
  const baseCPM = 5                          // ¥5 / 千次展示
  const reputationMult = reputation / 50     // 50分 = 1x，100分 = 2x
  return (dau * baseCPM / 1000) * reputationMult
}

// Reputation：发布高质量文章 +，发布延误或差稿 -
function nextReputation(current: number, qualityScore: number, isOnTime: boolean): number {
  const qualityDelta = (qualityScore - 6) * 0.5   // 6分以上加分，以下扣分
  const timelinessDelta = isOnTime ? 0.2 : -1.0
  return Math.min(100, Math.max(0, current + qualityDelta + timelinessDelta))
}
```

---

## Mastra Agent 设计

### 总编 Agent（editor-in-chief.ts）

```typescript
const editorInChiefAgent = new Agent({
  name: 'editor-in-chief',
  instructions: `
    你是 AGI Daily 的总编辑。
    使命：让中文读者用最少时间读懂全球 AI 最重要的进展。
    价值观优先级：用户信任 > 短期收入，内容质量 > 发布速度。

    每天你需要：
    1. 读取今日 OKR 状态和资源情况
    2. 制定今日选题方向（重点话题、禁忌话题）
    3. 审核编辑 Agent 提交的 10 篇稿件
    4. 批准发布或打回修改（最多打回一次）
    5. 判断是否触发生长/收缩协议
  `,
  tools: {
    getSimState,       // 读取当日 Capital/DAU/Reputation
    getMemory,         // 读取历史表现和编辑经验
    reviewArticles,    // 审核稿件列表，返回 approve/reject + 理由
    checkGrowthTrigger, // 检查是否触发生长协议
    writeMemory,       // 写入今日决策摘要
  },
  model: anthropic('claude-sonnet-4-6'),
})
```

### 编辑 Agent（editor.ts）

```typescript
const editorAgent = new Agent({
  name: 'editor',
  instructions: `
    你是 AGI Daily 的编辑。
    每天你需要：
    1. 从文章池中筛选今日最重要的 10 篇（优先 24h 内，兼顾话题多样性）
    2. 每篇改写为中文友好格式：口语化标题（≤20字）+ 摘要 + 正文
    3. 给每篇文章打质量分（1-10分）并附理由
    4. 提交给总编审核
    5. 根据总编反馈修改后发布
    规则：必须有 source_url；禁止机器直译；每期固定 10 篇。
  `,
  tools: {
    queryArticles,     // 查询 agidaily.db，按时间/标签/质量过滤
    getEditorialMemory, // 读取历史点击表现，辅助选题
    rewriteArticle,    // 调用 LLM 改写单篇
    scoreArticle,      // 给稿件打分
    publishArticle,    // 写入 published_articles + sim.publish()
    sendNewsletter,    // sim.newsletter.send()
    postSocial,        // sim.social.post()
  },
  model: anthropic('claude-sonnet-4-6'),
})
```

### 每日工作流（daily-workflow.ts）

```typescript
const dailyWorkflow = new Workflow({ name: 'daily-run' })
  .step('set-agenda', {
    agent: editorInChiefAgent,
    prompt: '制定今日选题方向，输出：重点话题列表 + 禁忌话题列表'
  })
  .step('select-and-write', {
    agent: editorAgent,
    prompt: '根据总编议程，从文章池筛选并改写今日 10 篇稿件'
  })
  .step('review', {
    agent: editorInChiefAgent,
    prompt: '审核编辑提交的 10 篇稿件，输出：approve 或 reject + 具体意见'
  })
  .branch({
    condition: (ctx) => ctx.review.decision === 'approve',
    onTrue: [
      { step: 'publish', agent: editorAgent },
      { step: 'update-memory', agent: editorInChiefAgent },
    ],
    onFalse: [
      { step: 'revise', agent: editorAgent },
      { step: 'publish', agent: editorAgent },
    ]
  })
  .step('settle-day', executor: settleDay)   // 纯函数，结算 mock API，更新 sim_days
```

### 董事会工作流（board-meeting.ts）

每 7 天触发，不用 LLM 生成报告，由 CEO Agent 总结后**以结构化数据呈现**，Board 指令通过 Dashboard UI 手动输入：

```typescript
const boardWorkflow = new Workflow({ name: 'board-meeting' })
  .step('weekly-report', {
    agent: editorInChiefAgent,
    prompt: '生成本周经营周报：DAU趋势、Capital变化、重大决策、待审议项'
  })
  .step('await-board-input', executor: waitForBoardDecision)
  // waitForBoardDecision 挂起 workflow，等待 /api/sim/board-decision 接口收到 Board 指令后继续
  .step('execute-board-directive', executor: applyBoardDirective)
```

---

## API 设计

```
GET  /api/sim/status
     → { day: number, status: 'idle'|'running'|'paused', state: DayState }

POST /api/sim/start
     → 开始连续推进，每天完成后自动推进下一天

POST /api/sim/stop
     → 设置停止标志，当前天跑完后停止

POST /api/sim/advance
     → 手动推进一天（status 必须为 idle/paused）

GET  /api/sim/stream
     → SSE，推送实时事件 { type: 'event'|'day_complete'|'board_triggered', data }

POST /api/sim/board-decision
     → body: { directive: BoardDirective }
     → 解除 boardWorkflow 的挂起状态

GET  /api/days
     → 所有已完成天的列表 [{ day, dau, capital, reputation, articleCount }]

GET  /api/days/[day]/events
     → 该天所有事件，按 seq 排序

GET  /api/days/[day]/articles
     → 该天发布的 10 篇文章

GET  /api/days/[day]/metrics
     → 该天资源织网快照
```

---

## 前端设计

### 前台 Portal（`/`）

杂志/报纸风格，内容展示：

```
┌──────────────────────────────────────────────────────┐
│  AGI DAILY          第 N 期 · 2026年X月X日           │
├──────────────────────────────────────────────────────┤
│         │                                            │
│  Day 1  │   [ 头版大图文章 ]                          │
│  Day 2  │                                            │
│  Day 3  │   [ 文章卡片 ] [ 文章卡片 ] [ 文章卡片 ]    │
│  ▶Day 4 │                                            │
│  Day 5  │   [ 文章卡片 ] [ 文章卡片 ] [ 文章卡片 ]    │
│  ...    │                                            │
│  侧边栏  │   底部：当日指标 DAU / Reputation          │
└──────────────────────────────────────────────────────┘
```

- 侧边栏：已发布的天列表，点击切换"期"
- 主区域：该天 10 篇文章的杂志排版（shadcn Card + 封面图）
- 每期顶部显示当日 Reputation 分和 DAU

### 后台 Dashboard（`/dashboard`）

Agent 事件流 + 运行控制：

```
┌──────────────────────────────────────────────────────┐
│  Day 12 正在运行  [▶ 运行] [⏸ 暂停]  Cap:¥8,420  DAU:3,201  Rep:72 │
├────────────┬─────────────────────────────┬────────────┤
│            │                             │            │
│  Day 1     │  📅 Day 12 事件流           │ 资源织网   │
│  Day 2     │                             │            │
│  Day 3     │  [总编] 今日议题：重点关注  │ Capital    │
│  ★Day 7   │  大模型推理效率方向...      │ ████░ 84%  │
│  Day 8     │                             │            │
│  Day 9     │  [编辑] 工具调用:           │ Reputation │
│  Day 10    │  queryArticles({tags:       │ ██████ 72  │
│  Day 11    │  "inference", limit: 30})   │            │
│  ▶Day 12  │                             │ DAU        │
│            │  [编辑→总编] 提交稿件:     │ ████ 3,201 │
│  ★ = 董事会│  "今日10篇质量分均值7.8"   │            │
│            │                             │ Subscribers│
│            │  [总编] 决策: ✅ 批准发布  │ ██ 891     │
│            │                             │            │
└────────────┴─────────────────────────────┴────────────┘
```

**事件卡片类型：**

| 类型 | 样式 |
|------|------|
| `thinking` | 灰色气泡，折叠展开 |
| `message` (A→B) | 双栏对话气泡，左右分别是发送/接收方 |
| `tool_call` | 代码风格卡片，显示工具名+入参 |
| `tool_result` | 代码风格卡片，显示返回值 |
| `decision` | 高亮边框卡片（蓝色），标注"决策" |
| `board` | 全宽黄色卡片，标注"董事会" |

**董事会 Day（侧边栏星标）：** 点击后在事件流最顶部显示 Board 指令输入面板，允许手动输入董事会决定。

---

## 实施阶段（建议黑客松排期）

### Phase 1：数据 + 模拟骨架（4h）
- [ ] 初始化 Next.js + Mastra 项目
- [ ] 建 sim.db，写 schema
- [ ] 实现 `formulas.ts`（因果公式）
- [ ] 实现 `SimClock` 骨架（无 LLM，用 mock 数据跑通一天循环）
- [ ] `/api/sim/start|stop|status` 接口

### Phase 2：Agent 核心（6h）
- [ ] 编辑 Agent + `queryArticles` 工具（读 agidaily.db）
- [ ] 总编 Agent + `reviewArticles` 工具
- [ ] `daily-workflow` 跑通（总编→编辑→审核→发布）
- [ ] EventLogger 接入 Mastra telemetry，写入 sim_events

### Phase 3：后台 Dashboard（4h）
- [ ] `/api/days/*` 接口
- [ ] SSE 实时推送
- [ ] Dashboard UI：侧边栏天列表 + 事件流 + 资源织网面板
- [ ] 运行/暂停按钮联通 SimClock

### Phase 4：前台 Portal（3h）
- [ ] 杂志排版页面
- [ ] 天列表侧边栏 + 切换
- [ ] 文章卡片组件

### Phase 5：董事会（2h）
- [ ] `board-meeting.ts` workflow
- [ ] Dashboard 董事会输入面板
- [ ] `/api/sim/board-decision` 接口

---

## 关键技术决策说明

**1. 为什么用 SSE 不用 WebSocket**
Dashboard 只需要服务端→客户端单向推送（事件流），SSE 更简单，Next.js App Router 原生支持。

**2. EventLogger 怎么接入 Mastra**
Mastra 1.0 支持 OpenTelemetry。在 Mastra 初始化时注册自定义 Exporter，将 span 写入 sim_events 表。工具调用、agent 消息均会产生 span。

**3. BoardWorkflow 怎么"等待"人工输入**
Mastra Workflow 支持 `suspend/resume`。`await-board-input` 步骤调用 `workflow.suspend()`，前端发 `/api/sim/board-decision` 后调用 `workflow.resume(directive)`。

**4. agidaily.db 和 sim.db 分离**
agidaily.db 只读，不污染原始数据。所有模拟状态写 sim.db，可以随时删掉 sim.db 重新开始推演。

---

*技术方案版本：v0.1 · 黑客松设计稿*
