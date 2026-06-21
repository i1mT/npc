# AGI Daily NPC

AGI Daily NPC 是一个基于 Next.js 与 Mastra 的“无人成长型公司”模拟项目。当前实现以内容公司 AGI Daily 为案例，通过 Agent 工作流、SQLite 状态库、事件流和前后台页面，演示一个由 Agent 运营的组织如何在使命、能力、记忆、组织、规则、资源和生长协议七层约束下持续运行。

## 技术栈

- TypeScript
- Next.js 15 App Router
- React 19
- Tailwind CSS
- Mastra Agent / Workflow
- better-sqlite3
- Server-Sent Events
- lucide-react

## 目录结构

```txt
app/                    Next.js 页面与 API Routes
  api/                  模拟控制、事件、天级数据、七层资产和前台聚合接口
  dashboard/            后台运行中心、七层资产、董事会和回放页面
  replay/               前台日报回放页面
src/
  components/           前后台 UI 组件和后台通用壳层
  db/                   SQLite 连接、schema、模拟库读写、文章源读取
  domain/               面向页面/API 的领域 DTO 聚合
  lib/                  通用类型与工具函数
  mastra/               Agent 定义、工作流、工具、真实 LLM 协作、Memory 和角色工厂
  simulation/           SimClock、模拟公式、事件总线和 Mock API
scripts/                本地验证和模拟重置脚本
docs/                   长期维护上下文，按产品、工程、设计、计划拆分
NPC_*.md                早期产品、架构、技术和 UI 设计原始文档
```

## 核心运行模型

- 前台 Portal：`/` 与 `/replay` 展示按天生成的 AGI Daily 日报内容。
- 后台 Dashboard：`/dashboard` 展示模拟状态、事件流、资源织网、规则库和七层入口。
- 模拟引擎：`src/simulation/engine.ts` 管理 `idle/running/paused` 状态，并推进每日工作流。
- Agent 工作流：`src/mastra/workflows/daily-workflow.ts` 驱动总编、编辑、工具调用、发布、结算、增长协议和董事会日逻辑。
- 真实 LLM 协作：`src/mastra/runtime/evomap-model.ts` 通过 EVOMAP OpenAI-compatible Chat Completions 接入模型，`src/mastra/collaboration.ts` 负责 Mastra Agent 对话、结构化输出、重试、token/cost 记录和错误事件。
- EvoMap 进化能力：`src/mastra/tools/evomap/` 通过 Developer OAuth2 + PKCE 读取 EvoMap recipes、genes 和 reuse graph，工具页 `/dashboard/tools` 负责连接状态与授权入口。
- Agent 记忆：`src/mastra/runtime/memory.ts` 使用 Mastra Memory、LibSQLStore 和 LibSQLVector 持久化线程上下文，默认落在 `memory.db`。
- 组织增长：每日增长协议会根据 DAU 和收入阈值触发增长、商业化或栏目角色扩编，并从下一天起纳入 Agent 协作。
- 数据层：`sim.db` 保存模拟状态、`work_events`、文章、董事会、七层快照和变更；外部文章源由 `src/db/articles.ts` 读取。
- 事件追踪：`work_events` 是七层状态变化的事实源，后台页面通过事件、变更和快照解释每日结果。

## 文档系统

`/docs` 保存长期维护上下文：

- 产品文档：`docs/product/AGENTS.md`
- 工程文档：`docs/engineering/AGENTS.md`
- 设计文档：`docs/design/AGENTS.md`
- 计划文档：`docs/plan/AGENTS.md`

历史设计材料保留在根目录的 `NPC_Design.md`、`NPC_Tech_Design.md`、`NPC_Arch_Layered.md`、`NPC_UI_IA.md`、`NPC_Case_ContentCompany.md`，作为更完整的方案背景。长期协作时，以 `docs` 中的上下文为入口，必要时再读取这些原始文档。

## GEB 文档管理机制

GEB 用于维护仓库级上下文，让项目长期迭代中仍然可理解、可接手、可追踪。详细规范见 `docs/engineering/context.md`。

- `G`：Global，全局项目上下文，即当前文件。
- `E`：Entry，目录级入口说明，例如各级 `AGENTS.md`。
- `B`：Block，代码文件头部说明，记录单个文件在局部系统中的输入、输出和位置。

## 开发与验证

- 安装依赖：`npm install`
- 本地启动：`npm run dev`
- 构建验证：`npm run build`
- 重置模拟库：`npm run sim:reset`
- 三天流程验证：`npm run verify:3days`
- 董事会流程验证：`npm run verify:board`
- 真实 LLM 验收：`npm run verify:real-llm`
- 完整真实 LLM 验收：`npm run verify:real-llm-full`

当前 `npm run lint` 脚本指向 `next lint`，而 Next.js 15 已移除该命令，不能作为有效质量门槛；需要改为 ESLint CLI 或其他项目约定命令。

## 架构注意事项

- 代码文件应遵守动态语言单文件尽量不超过 400 行的约束。
- 当前 `src/db/sim.ts` 已超过该上限，并聚合了多类数据库职责；后续涉及数据层改造时，应优先拆分为状态、事件、文章、七层、董事会等模块。
- 每层文件夹尽量不超过 8 个直接文件；超过时应继续按领域或职责分层。
- 任何功能、目录、核心约定或数据结构变更，都要同步更新受影响的 `AGENTS.md` 和 `docs` 文档。
