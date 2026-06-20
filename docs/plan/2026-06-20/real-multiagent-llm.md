# 真实 Multi-Agent LLM 改造计划

**日期**：2026-06-20  
**状态**：待实施  
**优先级**：P0（核心架构缺陷，不改无法交付设计目标）

---

## 1. 背景

### 要解决什么问题

当前 Mastra Agent 架构是"表演性"的：所有业务决策（选题议程、文章筛选改写、审核、生长协议、董事会）均由 `collaboration.ts` 中的硬编码纯函数完成，LLM 只用于生成事先写好答案的旁白文字。根本原因是 `src/mastra/local-model.ts` 是一个完全确定性的 stub，它从 prompt 里提取预置文本并原样返回，从不调用任何外部 API。Agent 没有记忆，决策不积累，公司不生长。

### 现有问题清单

- 所有 Agent 行为完全可预测，两次运行结果相同
- 文章标题、摘要、正文由字符串模板生成，内容质量固定
- Agent 间"对话"只是写日志，总编不真正读稿，编辑不真正基于反馈修改
- 生长协议只返回一段文字，不触发新 Agent 进入工作流
- Agent 没有记忆，不知道昨天选了什么、哪类内容更受欢迎
- 董事会周报由固定函数生成，指令由人工填写，没有 LLM 参与推理
- 前台内容每天雷同，无法体现公司生长和内容演化

### 为什么现在全部处理

上述问题互相依赖：LLM 不通，记忆无意义；记忆不通，议程无法学习；议程不学习，生长协议没有判断依据；生长无依据，董事会没有有效输入。必须一次性全部打通，拆分迭代会导致各模块始终处于半工作状态。

---

## 2. 当前现状

### 核心假模型

```
src/mastra/local-model.ts
  doGenerate(options) {
    // 从 prompt 里提取 NPC_AGENT_CONTEXT:{responseText}
    // 直接返回 responseText，不调用任何 API
  }
```

### 业务逻辑流（现在）

```
runAgentStep()
  → executeLocalTool(kind, context)    ← 所有决策在这里用纯函数做完
  → responseFor(kind, data)            ← 预先拼好回复文本
  → agent.generate("...NPC_AGENT_CONTEXT:{responseText}")
  → localMastraModel 提取预置文本原样返回
  → 输出 = 预置字符串（与 LLM 无关）
```

### 业务逻辑流（目标）

```
runStructuredStep(agentHandle, prompt, schema)
  → mastraAgent.generate(prompt, { output: zodSchema })
  → 真实 HTTP 请求 → api.evomap.ai → Claude
  → 返回 { object: T, usage: { inputTokens, outputTokens } }
  → 写入 sim_events.content（LLM 真实输出）
  → 写入 work_events.cost_token（真实 token 消耗）
```

### 已有可复用基础设施

- `AgentFactory`：已能从 `employees` 表加载员工并注册 Mastra Agent 实例
- `roleTemplates`：总编/编辑/增长/商业/专栏 角色模板已定义
- `sim_events` / `work_events`：事件写入链路完整
- Zod 已在依赖中，可直接用于结构化输出
- `published_articles` 表结构完整
- `board_meetings` 表和挂起/恢复机制已存在

---

## 3. 目标

完成本计划后，系统应达到：

1. 所有 Agent 决策通过真实 Claude API 产生，连续两次相同条件运行结果不同
2. 文章由 Claude 读原文、写中文标题/摘要/正文，内容具有编辑视角
3. 总编真正读稿并给出有针对性的审核意见，编辑基于意见修改
4. Agent 有跨天记忆，每天议程基于过去表现数据做决策
5. 生长协议触发后新 Agent 写入 employees 并在下一天真正参与工作流
6. 董事会周报由总编 LLM 生成，董事会指令由 LLM 自动产出（人工仍可覆盖）
7. 前台每日主编按语由 LLM 生成，内容与当天选题相关，各期不同

不在本次处理范围：前台 Portal 视觉重设计、多语言支持、付费订阅流程。

---

## 4. 实现方案

### 4.1 LLM 接入配置

**新增依赖**
```
pnpm add @ai-sdk/openai @mastra/memory
```

**新建 `src/mastra/runtime/evomap-model.ts`**
```ts
import { createOpenAI } from "@ai-sdk/openai"

const client = createOpenAI({
  baseURL: process.env.EVOMAP_API_BASE ?? "https://api.evomap.ai/v1",
  apiKey: process.env.EVOMAP_API_KEY ?? "",
})

export const getEvomapModel = (modelId = process.env.NPC_LLM_MODEL ?? "claude-sonnet-4-6") =>
  client(modelId)
```

**`.env.local` 配置**
```
EVOMAP_API_KEY=sk-evomap-b30sfyvd2gly0rk8bdf0d861c5ef425d9e37e4825a7608c5
EVOMAP_API_BASE=https://api.evomap.ai/v1
NPC_LLM_MODEL=claude-sonnet-4-6
```

**修改 `agent-factory.ts`**：`model: localMastraModel as never` → `model: getEvomapModel()`

**删除 `src/mastra/local-model.ts`**

### 4.2 结构化输出 Schema

**新建 `src/mastra/schemas.ts`**

```ts
// 编辑起草 10 篇文章
export const articleDraftSchema = z.object({
  articles: z.array(z.object({
    sourceId: z.string(),
    titleZh: z.string().max(20),
    summaryZh: z.string().max(150),
    contentZh: z.string().min(100),
    qualityScore: z.number().min(1).max(10),
    qualityReason: z.string().min(10),
    tags: z.array(z.string()).min(1).max(5),
  })).length(10),
})

// 总编审核结果
export const reviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(20),
  averageScore: z.number().min(1).max(10),
  articleFeedback: z.array(z.object({
    sourceId: z.string(),
    issue: z.string().min(5),
  })).optional(),
})

// 选题议程
export const agendaSchema = z.object({
  focusTopics: z.array(z.string()).min(2).max(5),
  blockedTopics: z.array(z.string()).min(1),
  reasoning: z.string().min(20),
  note: z.string(),
})

// 生长协议决策
export const growthDecisionSchema = z.object({
  status: z.enum(["maintain", "expand", "contract"]),
  reason: z.string().min(20),
  newAgentRole: z.enum(["growth", "business", "column"]).optional(),
  newAgentName: z.string().optional(),
})

// 主编按语
export const editorNoteSchema = z.object({
  note: z.string().min(20).max(60),
})

// 董事会自动生成指令
export const boardDirectiveSchema = z.object({
  directive: z.enum(["ADJUST_OKR", "STRATEGIC_PIVOT", "INJECT_CAPITAL", "RESTRUCTURE", "AMEND_CONSTITUTION", "MAINTAIN"]),
  reason: z.string().min(30),
  detail: z.string().min(20),
})
```

### 4.3 重写 `collaboration.ts`

删除以下全部确定性函数：
- `executeLocalTool()` 及所有分支
- `planEditorialAgenda()`
- `composeEditorialDrafts()`
- `auditEditorialDrafts()`
- `improveEditorialDrafts()`
- `evaluateGrowthProtocol()`
- `titleZh()`、`summaryZh()`、`contentZh()`、`inferTopic()` 等字符串处理函数

新增两个核心调用函数：

```ts
// 结构化输出步骤——Agent 输出结构化 JSON
export async function runStructuredStep<T>(input: {
  agentHandle: string
  prompt: string
  schema: z.ZodSchema<T>
  day: number
  runtime: CollaborationRuntime
  eventType?: EventType
  replyTo?: SimEvent | null
}): Promise<{ data: T; text: string; event: SimEvent; inputTokens: number; outputTokens: number }>

// 纯文本步骤——Agent 自由输出（按语、议程说明等）
export async function runTextStep(input: {
  agentHandle: string
  prompt: string
  day: number
  runtime: CollaborationRuntime
  eventType?: EventType
  replyTo?: SimEvent | null
}): Promise<{ text: string; event: SimEvent; inputTokens: number; outputTokens: number }>
```

两个函数均须：
1. 调用真实 `mastraAgent.generate()`，传入 `threadId`（当天共享）和 `resourceId`（per-agent）
2. 将 `usage.promptTokens + usage.completionTokens` 写入对应 `work_events.cost_token`
3. 将 LLM 实际输出写入 `sim_events.content`（禁止写预置字符串）
4. 结构化步骤失败时 retry 一次，二次失败记录 `error` 事件并抛出

### 4.4 Mastra Memory 接入

**新建 `src/mastra/runtime/memory.ts`**

使用 `@mastra/memory` + LibSQL（指向本地 `memory.db`）：

```ts
import { Memory } from "@mastra/memory"
import { LibSQLStore, LibSQLVector } from "@mastra/memory/store"

export const agentMemory = new Memory({
  storage: new LibSQLStore({ url: "file:memory.db" }),
  vector: new LibSQLVector({ connectionUrl: "file:memory.db" }),
  options: {
    lastMessages: 20,        // 每次调用注入最近 20 条历史消息
    semanticRecall: {
      topK: 5,               // 语义检索最相关的 5 条记忆
      messageRange: { before: 2, after: 2 },
    },
  },
})
```

**修改 `agent-factory.ts`**，Agent 注册时注入 memory：

```ts
new Agent({
  id: handle,
  name: def.displayName,
  instructions: def.instructions,
  model: getEvomapModel(),
  memory: agentMemory,
})
```

**新建记忆查询工具 `src/db/memory-queries.ts`**

从 `published_articles` 聚合过去 7 天各话题质量均分，供议程步骤使用：

```ts
export function getTopicPerformanceLast7Days(currentDay: number): Array<{
  topic: string
  avgScore: number
  articleCount: number
  trend: "up" | "down" | "stable"
}>
```

议程步骤 prompt 中注入这份数据，让总编 Agent 基于真实历史表现制定今日方向。

### 4.5 重写 `daily-workflow.ts` 各步骤 prompt

**Step 1：议程（`set-agenda`，总编 Agent）**

```
你是 AGI Daily 总编辑。今日是第 {day} 期。
当前公司状态：DAU {dau}，Reputation {reputation}，Capital ¥{capital}。

过去 7 天各话题质量均分（来自已发布文章统计）：
{topicHistory，格式：话题名: 均分 X.X（N 篇）趋势 ↑↓→}

根据以上数据，制定今天的选题方向。
使命：让中文读者用最少时间读懂全球 AI 最重要进展。
价值观：用户信任 > 短期收入，内容质量 > 发布速度。

reasoning 字段说明：为什么今天选这些话题（需引用上面的历史数据，不少于 20 字）。
```

**Step 2：起草（`select-and-write`，编辑 Agent）**

```
[总编 → @编辑] 今日议程：
重点话题：{focusTopics}
避开话题：{blockedTopics}
总编说明：{note}

以下是文章池候选原文（前 20 篇，请从中选最有价值的 10 篇）：
{sources，每篇含：序号、sourceId、原文标题、摘要前 200 字、标签}

任务：
1. 选出 10 篇（优先覆盖重点话题，保证多样性，避开禁忌话题）
2. 每篇生成：中文标题（≤20字，口语化，不用感叹号和问号）、中文摘要（≤150字）、中文正文（150-400字，必须包含"编辑部为什么今天关注这篇"的判断）
3. 每篇打分 1-10 分并给出具体理由（不少于 10 字）
4. 禁止机器直译，禁止标题党（不允许"震惊""重磅""颠覆"等词）
```

**Step 3：审核（`review`，总编 Agent）**

```
[编辑 → @总编] 今日 10 篇稿件如下：
{drafts，每篇含：序号、sourceId、titleZh、summaryZh、qualityScore、qualityReason}

请按以下标准审核：
- 必须恰好 10 篇
- 平均质量分 ≥ 7.0
- 无标题党（含感叹号、"震惊"、"重磅"、"颠覆"等关键词则 reject）
- 每篇必须有 sourceId（对应原文）
- 价值观对齐：用户信任 > 短期收入

如果 reject，必须在 articleFeedback 里指出具体哪篇（用 sourceId）有什么问题，给修改方向。
reason 字段不少于 20 字，不能只写"质量不达标"这类泛泛之词。
```

**Step 4：修稿（`revise`，编辑 Agent，仅 reject 时触发）**

```
[总编 → @编辑] 审核结果：reject。
总编意见：{review.reason}
具体问题（按 sourceId）：
{review.articleFeedback，每条：sourceId → 具体问题描述}

请根据以上意见修改对应文章。修改时：
- 针对每条反馈逐一改进
- 重新提交完整 10 篇（包含未修改的文章）
- 修改过的文章质量分应比初稿更高
```

**Step 5：主编按语（`editor-note`，总编 Agent，结算后）**

```
今天是 AGI Daily 第 {day} 期，刚完成发布。
实际发布话题分布：{topTags，前 5 个标签及各自文章数}
今日质量均分：{averageScore}，DAU：{dau}，Reputation：{reputation}。

请以总编身份写"主编按语"：
- 长度：20-60 字，一段话，不分项
- 风格：克制、有判断力，像 The Information 的编辑来信
- 内容：点评今天选题的核心判断（需提及今天实际涉及的 1-2 个具体话题）
- 禁止写套话（如"感谢读者""今天内容很精彩"等）
```

### 4.6 生长协议真正孵化新 Agent

**生长触发阈值**（固化为 `rules` 表硬规则）：

| 条件 | 触发角色 | 前置检查 |
|------|---------|---------|
| `dau > 10000` | 增长 Agent | `employees` 中无 `role_template='growth' AND status='active'` |
| 月广告收入 > ¥30000 | 商业 Agent | `employees` 中无 `role_template='business' AND status='active'` |
| `dau > 100000` | 专栏 Agent | `employees` 中无 `role_template='column' AND status='active'` |

**`growth-check` 步骤 prompt（总编 Agent）**

```
今日结算完成：DAU {dau}，Reputation {reputation}，Capital ¥{capital}，月广告收入 ¥{monthlyRevenue}。
当前员工：{activeEmployees，姓名和角色列表}

生长协议阈值：
- DAU > 10000 且无增长 Agent → 考虑孵化增长 Agent
- 月收入 > 30000 且无商业 Agent → 考虑孵化商业 Agent

请给出决策：maintain（维持）/ expand（扩张，并指定新角色）/ contract（收缩）。
reason 字段不少于 20 字，解释为什么做这个决定。
```

**孵化逻辑**（`daily-workflow.ts`，growth 步骤后）

```ts
if (growthDecision.status === "expand" && growthDecision.newAgentRole) {
  const alreadyExists = checkEmployeeExists(growthDecision.newAgentRole)
  if (!alreadyExists) {
    insertEmployee({
      displayName: growthDecision.newAgentName ?? `增长 Agent`,
      roleTemplate: growthDecision.newAgentRole,
      agentHandle: `${growthDecision.newAgentRole}-agent`,
      joinedDay: day + 1,
      systemPrompt: `我是第 ${day} 天孵化的 Agent。职责原因：${growthDecision.reason}`,
      status: "active",
    })
    addLayerEvent({
      layer: "structure", eventType: "org_change", action: "spawn_agent",
      content: `孵化 ${growthDecision.newAgentRole} Agent：${growthDecision.reason}`,
    })
  }
}
```

**下一天工作流**：`agentFactory.loadActiveEmployees()` 自动加载新员工。若检测到增长 Agent，在 publish 步骤后新增 `social-distribute` 步骤，让增长 Agent 执行 `sim.social.post`，其 `socialReach` 写入当日结算公式。

### 4.7 董事会 LLM 化

**当前机制**：总编生成固定结构周报 → workflow 挂起 → 人工在 Dashboard 填写指令 → resume。

**目标机制**：总编 LLM 生成周报 → Board Agent（另一个 Claude 实例）自动生成指令 → 写入 `board_meetings.auto_directive` → Dashboard 展示并允许人工覆盖 → resume。

**`board-meeting.ts` 改造**

新增 Board Agent（不入 `employees` 表，是系统级角色）：

```ts
const boardAgent = new Agent({
  id: "board",
  name: "董事会",
  instructions: `
    你是 AGI Daily 的董事会。你的职责是审阅 CEO 周报并给出战略指令。
    宪法层（不可违反）：
      使命：让中文读者用最少时间读懂全球 AI 最重要进展
      价值观 1：用户信任 > 短期收入
      价值观 2：内容质量 > 发布速度
      价值观 3：长期 Reputation > 单次广告收益
    你只能从以下指令中选择一个：
      ADJUST_OKR / STRATEGIC_PIVOT / INJECT_CAPITAL / RESTRUCTURE / AMEND_CONSTITUTION / MAINTAIN
  `,
  model: getEvomapModel(),
})
```

**周报 prompt（总编 Agent）**

```
请生成本周（Day {startDay}-{endDay}）经营周报，用于董事会审阅。

本周数据：
- DAU 均值：{avgDau}，趋势：{dauTrend}
- 广告收入：¥{weeklyRevenue}，Capital 余额：¥{capital}
- Newsletter 打开率：{openRate}%
- Reputation 变化：{reputationStart} → {reputationEnd}
- 发布文章数：{articleCount} 篇

重大决策（请逐条列出）：
{majorDecisions，来自 work_events 的 decision 类型事件}

需要董事会审议的事项：
{pendingItems，来自超出 Agent 权限的请求，若无则写"无"}
```

**董事会审议 prompt（Board Agent）**

```
以下是 CEO 本周经营周报：
{weeklyReport}

请审阅并给出一条董事会指令。
- 指令必须从以下选项中选一个：ADJUST_OKR / STRATEGIC_PIVOT / INJECT_CAPITAL / RESTRUCTURE / AMEND_CONSTITUTION / MAINTAIN
- reason（不少于 30 字）：为什么给这条指令，需引用周报中的具体数据
- detail（不少于 20 字）：指令的具体执行要求

注意：任何指令都不得违背宪法层（用户信任 > 短期收入；内容质量 > 发布速度）。
```

**自动指令写入 `board_meetings`**：新增 `auto_directive TEXT`、`auto_directive_reason TEXT` 字段。Dashboard 展示自动指令，人工可在 24h 内覆盖；超时则自动执行 `auto_directive`。

### 4.8 前台 Portal 每日内容演化

- `sim_days` 表增加 `editor_note TEXT` 列
- 主编按语在 `editor-note` 步骤生成后写入该列
- `/api/portal/day/[day]` 接口返回 `editorNote` 字段
- `Portal` 组件在每期报头下方展示主编按语
- 文章列表按 `tags` 字段中最高频 tag 分组，分组标题动态生成

### 4.9 改造文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/mastra/local-model.ts` | **删除** | 假模型废弃 |
| `src/mastra/runtime/evomap-model.ts` | **新建** | 真实 LLM 接入 |
| `src/mastra/schemas.ts` | **新建** | 全部 Zod schema |
| `src/mastra/runtime/memory.ts` | **新建** | Mastra Memory 实例 |
| `src/mastra/agent-factory.ts` | **修改** | 换模型 + 注入 memory |
| `src/mastra/collaboration.ts` | **重写** | 删除所有确定性函数 |
| `src/mastra/workflows/daily-workflow.ts` | **修改** | 真实 prompt + growth spawn |
| `src/mastra/workflows/board-meeting.ts` | **修改** | Board Agent + LLM 周报 + 自动指令 |
| `src/db/memory-queries.ts` | **新建** | 话题表现历史查询 |
| `src/db/sim.ts` | **修改** | `editor_note` 写入、growth spawn |
| `src/db/schema.sql` | **修改** | `sim_days.editor_note`、`board_meetings.auto_directive` |
| `app/api/portal/day/[day]/route.ts` | **修改** | 返回 `editorNote` |
| `src/components/portal.tsx` | **修改** | 展示按语、话题分组 |
| `.env.local` | **修改** | EVOMAP 配置 |
| `package.json` | **修改** | `@ai-sdk/openai`、`@mastra/memory` |

---

## 5. 验收标准

每条验收项均标注：**验证命令/步骤**、**通过条件**、**失败判定**。

---

### A 组：LLM 真实接入

**A-1：模型不再是 stub**

```bash
# 验证方式
ls src/mastra/local-model.ts
grep -r "localMastraModel\|NPC_AGENT_CONTEXT\|npc-deterministic" src/

# 通过条件
ls 命令返回 "No such file or directory"
grep 命令零结果

# 失败判定
文件仍存在，或 grep 找到任意引用
```

**A-2：真实 HTTP 请求发出**

```bash
# 验证方式
# 在 .env.local 中临时改为错误 API Key，运行一天
EVOMAP_API_KEY=invalid-key pnpm run verify:3days 2>&1 | head -50

# 通过条件
日志中出现 "401" 或 "Unauthorized" 或 "authentication" 错误（证明真的发了 HTTP 请求）

# 失败判定
运行成功无报错（说明仍用 stub，根本没发请求）
```

**A-3：两次运行结果不同（LLM 非确定性）**

```bash
# 验证步骤
1. pnpm run sim:reset
2. curl -X POST http://localhost:3000/api/sim/advance
3. sqlite3 sim.db "SELECT title_zh FROM published_articles WHERE day=1 ORDER BY rowid LIMIT 3" > /tmp/run1.txt
4. pnpm run sim:reset
5. curl -X POST http://localhost:3000/api/sim/advance
6. sqlite3 sim.db "SELECT title_zh FROM published_articles WHERE day=1 ORDER BY rowid LIMIT 3" > /tmp/run2.txt
7. diff /tmp/run1.txt /tmp/run2.txt

# 通过条件
diff 输出至少 1 行差异（3 篇标题中至少 1 篇不同）

# 失败判定
diff 无差异（所有标题完全相同，说明仍是确定性输出）
```

**A-4：build 无报错**

```bash
# 验证方式
pnpm run build 2>&1 | tail -20

# 通过条件
最后几行出现 "✓ Compiled" 或 "Route (app)" 列表，无 "Error" 或 "Type error"

# 失败判定
出现任何 TypeScript 编译错误或 Module not found
```

---

### B 组：文章内容由 LLM 真正生成

**B-1：标题符合规则约束**

```bash
# 验证方式（运行 1 天后）
sqlite3 sim.db "SELECT max(length(title_zh)), min(length(title_zh)), count(*) FROM published_articles WHERE day=1"

# 通过条件
max(length) ≤ 20，min(length) ≥ 4，count = 10

# 失败判定
max > 20（Zod 约束未生效或 LLM 未遵守）
```

**B-2：标题不包含模板词汇**

```bash
# 验证方式
sqlite3 sim.db "SELECT title_zh FROM published_articles WHERE day=1" | grep -E "押注|新信号|出现|产业"

# 通过条件
grep 零结果（这些是旧 titleZh() 函数的固定词汇）

# 失败判定
grep 找到任意一条（说明仍在用字符串模板）
```

**B-3：正文包含编辑视角**

```bash
# 验证方式
sqlite3 sim.db "SELECT content_zh FROM published_articles WHERE day=1 LIMIT 3" | grep -E "编辑部|关注|为什么|判断|影响"

# 通过条件
grep 找到至少 2 处匹配（3 篇中有 2 篇包含编辑视角词汇）

# 失败判定
grep 零结果（正文仍是"原文要点：...中文解读：它属于..."模板）
```

**B-4：正文长度符合要求**

```bash
# 验证方式
sqlite3 sim.db "SELECT min(length(content_zh)), avg(length(content_zh)) FROM published_articles WHERE day=1"

# 通过条件
min(length) ≥ 100，avg(length) ≥ 150

# 失败判定
min < 100（说明 LLM 输出被截断或 schema min(100) 约束未生效）
```

**B-5：summaryZh 不是 "第 N 期关注 X：..." 模板**

```bash
# 验证方式
sqlite3 sim.db "SELECT summary_zh FROM published_articles WHERE day=1 LIMIT 5" | grep -E "^第 [0-9]+ 期关注"

# 通过条件
grep 零结果

# 失败判定
grep 找到任意一条（说明旧模板函数仍在运行）
```

---

### C 组：Agent 间真实 A2A 对话

**C-1：draft 事件包含真实文章标题**

```bash
# 验证方式
sqlite3 sim.db "SELECT content FROM sim_events WHERE event_type='message' AND day=1 ORDER BY seq LIMIT 5"

# 通过条件
至少 1 条 content 中包含 published_articles.title_zh 里的某个词（不少于 4 个汉字）
用 Python 或 shell 对比两个查询结果进行验证

# 失败判定
所有 message 事件的 content 是"提交 N 篇稿件"这类泛化字符串，不含具体标题词
```

**C-2：review 事件包含针对具体稿件的评价**

```bash
# 验证方式
sqlite3 sim.db "SELECT content FROM sim_events WHERE event_type='decision' AND day=1 ORDER BY seq"

# 通过条件
至少 1 条 decision 事件的 content 长度 ≥ 30 字，且不是"10 篇稿件来源完整，平均质量分 X，批准发布"这个固定字符串

# 失败判定
所有 decision 事件 content 与旧代码 `reviewArticles()` 函数的输出模板完全一致
```

**C-3：revision 事件引用了 review 的具体反馈**

```bash
# 验证步骤（需先制造一次 reject 场景）
1. sqlite3 sim.db "UPDATE published_articles SET quality_score=4.0 WHERE day=1"
2. 重新触发 Day 1（pnpm run sim:reset 后 advance）
3. sqlite3 sim.db "SELECT content FROM sim_events WHERE event_type IN ('decision','message') AND day=1 ORDER BY seq" | less

# 通过条件
能看到：
  - 一条 decision 事件 content 含 "reject" 字样
  - 其后一条 message 事件 content 中引用了 reject 事件里提到的具体问题词汇（不是通用回复）

# 失败判定
revision 事件 content 是"完成一次修订并重新提交"这类固定字符串
```

**C-4：同一天内 threadId 一致**

```bash
# 验证方式
sqlite3 sim.db "SELECT DISTINCT json_extract(metadata, '$.mastraThreadId') FROM sim_events WHERE day=1"

# 通过条件
查询结果只有 1 个非 null 值（同一天所有步骤共享同一 threadId）

# 失败判定
结果为 null 或多个不同值（thread 未正确传递）
```

---

### D 组：Mastra Memory 真正生效

**D-1：memory.db 文件生成**

```bash
# 验证方式（运行第 1 天后）
ls -la memory.db

# 通过条件
文件存在，大小 > 0 bytes

# 失败判定
文件不存在（Memory 未初始化或未写入）
```

**D-2：Day 2 议程 reasoning 引用了 Day 1 话题数据**

```bash
# 验证方式
sqlite3 sim.db "SELECT content FROM sim_events WHERE event_type='decision' AND day=2 ORDER BY seq LIMIT 1"

# 通过条件
该 content（议程步骤的 decision 事件）长度 ≥ 50 字，且包含数字（如话题均分）或 Day 1 的具体话题词

# 失败判定
content 是"制定今日议程：X、Y、Z。@编辑 请按这个方向..."这类旧模板，不含历史数据引用
```

**D-3：话题均分影响 Day 3+ 的选题**

```bash
# 验证步骤
1. 运行 3 天
2. sqlite3 sim.db "SELECT tags, avg(quality_score) FROM published_articles GROUP BY tags ORDER BY avg(quality_score) DESC LIMIT 3"
3. sqlite3 sim.db "SELECT content FROM sim_events WHERE event_type='decision' AND day=3 ORDER BY seq LIMIT 1"

# 通过条件
Day 3 议程 content 中出现了 Step 2 查出的高分话题的相关词汇（说明 Agent 学到了什么话题效果好）

# 失败判定
Day 3 议程与 Day 1 议程用词模式完全相同，不体现历史学习
```

---

### E 组：生长协议真正孵化新 Agent

**E-1：触发条件正确判断**

```bash
# 验证步骤
1. sqlite3 sim.db "UPDATE sim_days SET dau=11000 WHERE day=(SELECT max(day) FROM sim_days)"
2. curl -X POST http://localhost:3000/api/sim/advance
3. sqlite3 sim.db "SELECT content FROM work_events WHERE event_type='org_change' ORDER BY created_at DESC LIMIT 1"

# 通过条件
查询结果 content 包含"孵化"二字，且不为空

# 失败判定
查询无结果，或 content 是"维持常规节奏"这类旧 evaluateGrowthProtocol() 返回值
```

**E-2：employees 表新增正确记录**

```bash
# 验证方式（接 E-1 之后）
sqlite3 sim.db "SELECT display_name, role_template, agent_handle, joined_day, status FROM employees ORDER BY joined_day DESC LIMIT 3"

# 通过条件
最新一行：
  - role_template = 'growth'
  - joined_day = (触发天 + 1)
  - status = 'active'
  - agent_handle 非空

# 失败判定
无新增行，或 joined_day 不等于触发天+1
```

**E-3：下一天增长 Agent 真正出现在事件流**

```bash
# 验证方式（接 E-2，再 advance 一天）
sqlite3 sim.db "SELECT DISTINCT actor_id FROM work_events WHERE day=(SELECT max(day) FROM sim_days)"

# 通过条件
结果中包含 'growth-agent'（增长 Agent 的 handle）

# 失败判定
只有 'editor-in-chief' 和 'editor'，无 growth-agent（新 Agent 未被加载到工作流）
```

**E-4：DAU 公式反映增长 Agent 贡献**

```bash
# 验证方式
sqlite3 sim.db """
SELECT d1.day, d1.dau, d2.day, d2.dau, d2.dau - d1.dau as dau_delta
FROM sim_days d1
JOIN sim_days d2 ON d2.day = d1.day + 1
ORDER BY d1.day
"""

# 通过条件
有增长 Agent 参与的那天（joined_day+1 对应的天），dau_delta 应 ≥ 前两天 dau_delta 的均值
（说明 social reach 带来了额外增长）

# 失败判定
增长 Agent 参与当天的 dau_delta 与其他天无显著差异（公式未接入 social reach）
```

**E-5：Dashboard 展示新 Agent 卡片**

```bash
# 验证方式
# 浏览器打开 http://localhost:3000/dashboard/org
# 或检查接口返回

curl http://localhost:3000/api/employees | python3 -m json.tool | grep -A5 "growth"

# 通过条件
页面/接口中显示增长 Agent 卡片，包含"第 N 天孵化"字样

# 失败判定
org 页面只显示总编和编辑两个固定员工，增长 Agent 不显示
```

---

### F 组：董事会 LLM 化

**F-1：周报由 LLM 生成（非固定函数）**

```bash
# 验证方式（运行 7 天后，触发董事会）
sqlite3 sim.db "SELECT json_extract(weekly_report, '$.summary') FROM board_meetings ORDER BY day DESC LIMIT 1"

# 通过条件
summary 长度 ≥ 50 字，包含具体数字（DAU、Capital 等），不是"共发布 N 篇文章"这类固定模板

# 失败判定
summary 是 weeklyReportForBoard() 函数生成的固定格式字符串（如 "Day 1-7 共 70 篇"）
```

**F-2：Board Agent 自动生成指令**

```bash
# 验证方式
sqlite3 sim.db "SELECT auto_directive, auto_directive_reason FROM board_meetings ORDER BY day DESC LIMIT 1"

# 通过条件
- auto_directive 为以下之一：ADJUST_OKR / STRATEGIC_PIVOT / INJECT_CAPITAL / RESTRUCTURE / AMEND_CONSTITUTION / MAINTAIN
- auto_directive_reason 长度 ≥ 30 字，包含周报中出现过的具体数据词（如 DAU 数值或话题名）

# 失败判定
- auto_directive 为 null（Board Agent 未运行）
- reason 是通用模板文字，不引用周报数据
```

**F-3：Board Agent 指令符合宪法约束**

```bash
# 验证方式（人工审阅）
sqlite3 sim.db "SELECT auto_directive, auto_directive_reason FROM board_meetings"

# 通过条件（人工逐条判断）
所有历史指令的 reason 中不出现以下违宪方向：
  - "为提高 CTR 允许标题夸大"
  - "牺牲内容质量换取广告收入"
  - "允许未经证实信息"

# 失败判定
任意一条 reason 中出现违反"用户信任 > 短期收入"或"内容质量 > 发布速度"的表述
```

**F-4：人工可覆盖 Board 指令**

```bash
# 验证步骤
1. 触发 Day 7（董事会日）
2. 确认 auto_directive 已写入
3. curl -X POST http://localhost:3000/api/sim/board-decision \
     -H "Content-Type: application/json" \
     -d '{"day":7,"directive":"INJECT_CAPITAL"}'
4. sqlite3 sim.db "SELECT directive FROM board_meetings WHERE day=7"

# 通过条件
directive = 'INJECT_CAPITAL'（人工覆盖成功，不是 auto_directive 的值）

# 失败判定
directive 仍等于 auto_directive，人工输入未生效
```

---

### G 组：前台 Portal 内容演化

**G-1：主编按语存在且有实质内容**

```bash
# 验证方式（运行 3 天后）
sqlite3 sim.db "SELECT day, length(editor_note), editor_note FROM sim_days ORDER BY day"

# 通过条件
每行 length ≥ 20，每行 editor_note 非空，3 行内容各不相同

# 失败判定
editor_note 为 null，或 length < 20，或 3 天内容完全相同
```

**G-2：按语内容与当天话题相关**

```bash
# 验证方式（人工验证）
sqlite3 sim.db """
SELECT s.day, s.editor_note, group_concat(a.tags, ', ') as day_tags
FROM sim_days s
JOIN published_articles a ON a.day = s.day
GROUP BY s.day
ORDER BY s.day
"""

# 通过条件（人工逐行对比）
每天的 editor_note 中至少提到 day_tags 中出现过的 1 个具体话题词（如"大模型""推理""Agent"等）

# 失败判定
editor_note 是"今天发布了 10 篇精选内容，感谢读者关注"这类与话题无关的套话
```

**G-3：前台按语正常渲染**

```bash
# 验证方式
curl http://localhost:3000/api/portal/day/1 | python3 -m json.tool | grep "editorNote"

# 通过条件
返回 JSON 中 "editorNote" 字段非空、非 null，值与 sim_days.editor_note 一致

# 失败判定
editorNote 字段不存在或值为 null（接口未返回该字段）
```

**G-4：前台文章分组展示**

```bash
# 验证方式（浏览器手动 + API 验证）
curl http://localhost:3000/api/portal/day/1 | python3 -m json.tool | grep -A2 "group\|tags"

# 通过条件
接口返回的文章列表按 tag 分组，或 Portal 页面文章有明显的分类标签展示

# 失败判定
所有文章平铺排列，无分组，与当前实现完全相同
```

---

### H 组：整体 7 天端到端

**H-1：7 天全部完成**

```bash
sqlite3 sim.db "SELECT day, completed_at IS NOT NULL as done FROM sim_days ORDER BY day"

# 通过条件
输出 7 行，每行第二列为 1

# 失败判定
行数 < 7，或存在 done=0 的行
```

**H-2：每天事件类型覆盖完整**

```bash
sqlite3 sim.db "SELECT day, count(distinct event_type) as types FROM work_events GROUP BY day ORDER BY day"

# 通过条件
每行 types ≥ 6

# 失败判定
任意一天 types < 6（说明某个 Agent 步骤未执行或未记录）
```

**H-3：70 篇文章标题各不相同**

```bash
sqlite3 sim.db "SELECT count(*) as total, count(distinct title_zh) as unique_titles FROM published_articles"

# 通过条件
total = 70，unique_titles = 70

# 失败判定
unique_titles < 70（有重复标题，说明仍有确定性生成逻辑）
```

**H-4：Token 消耗被记录**

```bash
sqlite3 sim.db "SELECT day, sum(cost_token) as tokens FROM work_events GROUP BY day ORDER BY day"

# 通过条件
每天 tokens > 0（说明每天都有真实 LLM 调用并记录了消耗）

# 失败判定
任意一天 tokens = 0 或 null
```

**H-5：事件内容为真实 LLM 输出**

```bash
sqlite3 sim.db "SELECT content FROM sim_events WHERE event_type='message' ORDER BY random() LIMIT 5"

# 通过条件（人工阅读）
5 条内容均不包含以下旧占位字符串：
  - "已执行当前 Mastra Agent 步骤"
  - "提交 N 篇稿件给 @总编"
  - "工具返回 N 篇候选文章"
内容应为具体、有实质信息的对话文字

# 失败判定
任意一条 content 与上述旧模板完全一致
```

**H-6：董事会日完整触发**

```bash
sqlite3 sim.db "SELECT day, status, auto_directive, directive FROM board_meetings"

# 通过条件
存在至少 1 行，status='pending' 或 'resumed'，auto_directive 非空

# 失败判定
表为空，或 auto_directive 为 null
```

**H-7：前台 7 期可正常切换浏览**

```bash
# 验证方式（浏览器手动）
# 打开 http://localhost:3000
# 在左侧侧边栏依次点击 Day 1 至 Day 7

# 通过条件
每期切换后：
  - 展示 10 篇文章，每篇有标题（中文）、摘要
  - 报头下方有主编按语文字
  - 7 期的主编按语文字各不相同

# 失败判定
任意一期报错、白屏、无文章，或所有期按语相同
```

---

## 6. 实现步骤（有序）

每步完成后必须运行 `pnpm run build` 确认无报错，再进入下一步。

```
Step 1  安装依赖（@ai-sdk/openai、@mastra/memory）
        新建 evomap-model.ts，配置 .env.local
        修改 agent-factory.ts 换模型，删除 local-model.ts
        → 验收：A-1、A-2、A-4

Step 2  新建 schemas.ts（全部 Zod schema）
        新建 memory.ts（Mastra Memory 实例）
        修改 agent-factory.ts 注入 memory

Step 3  重写 collaboration.ts
        删除所有确定性函数，实现 runStructuredStep / runTextStep
        → 验收：B-5（grep 旧模板零结果）

Step 4  新建 db/memory-queries.ts（话题表现历史查询）
        重写 daily-workflow.ts 各步骤 prompt
        → 验收：A-3、B-1、B-2、B-3、B-4、C-1、C-2、D-1

Step 5  实现 revision 逻辑（reject → 反馈传回编辑 → revise）
        → 验收：C-3

Step 6  验证 Memory 跨天学习
        → 验收：C-4、D-2、D-3

Step 7  实现生长协议孵化逻辑（employees 写入 + 下日加载 + social 步骤）
        → 验收：E-1、E-2、E-3、E-4、E-5

Step 8  改造 board-meeting.ts（Board Agent + LLM 周报 + 自动指令）
        修改 schema.sql 增加 board_meetings 字段
        → 验收：F-1、F-2、F-3、F-4

Step 9  实现主编按语生成（editor-note 步骤 + sim_days.editor_note 写入）
        修改 Portal 接口和组件（editorNote + 话题分组）
        → 验收：G-1、G-2、G-3、G-4

Step 10 端到端 7 天运行
        → 验收：H-1 至 H-7（全部通过方视为完成）
```

---

## 7. 风险控制

| 风险 | 预防措施 |
|------|---------|
| LLM 返回 JSON 不符合 Zod schema | `runStructuredStep` retry 一次，二次失败记录 error 事件 + 跳过该步骤（不中断当天结算） |
| API 超时（>30s）导致工作流挂起 | `agent.generate` 设置 `abortSignal: AbortSignal.timeout(30000)`，超时记录 error 并用安全默认值继续 |
| LLM 生成标题超过 20 字 | Zod `.max(20)` 校验，失败时截断为前 19 字 + "…"，记录 warning 事件 |
| 生长 Agent 重复孵化 | 孵化前 `SELECT count(*) FROM employees WHERE role_template=? AND status='active'`，count > 0 则跳过 |
| `editor_note` 列或 `auto_directive` 列缺失 | `engine.ts` 启动时执行 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，幂等迁移 |
| Board Agent 生成违宪指令 | `runStructuredStep` 后校验 reason 不含违禁词（标题党、牺牲质量等），违反则 fallback 到 MAINTAIN |
| memory.db 体积随运行天数增长 | Mastra Memory 配置 `lastMessages: 20` + 语义检索 `topK: 5` 限制注入量，不影响性能 |

---

## 8. 交付动作

- **代码**：所有变更见 4.9 文件清单（新建 5 个文件，修改 10 个文件，删除 1 个文件）
- **文档**：完成后更新 `docs/engineering/development.md`（EVOMAP 配置说明）、`AGENTS.md`（Mastra 架构更新描述）
- **验证**：依次通过 A 至 H 组所有验收项（共 35 条），最后运行 `pnpm run sim:reset && pnpm run verify:3days` 无报错
