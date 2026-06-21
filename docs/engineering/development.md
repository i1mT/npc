# 项目开发

项目开发以可重复启动、环境一致、最小上下文切换和模拟状态可重置为原则。

## 依赖安装

当前仓库使用 `package-lock.json`，默认包管理器为 npm：

```bash
npm install
```

新增依赖前应确认必要性、维护状态、类型支持和对本地模拟启动速度的影响。

## 本地启动

```bash
npm run dev
```

默认启动 Next.js 开发服务。前台入口为 `/` 和 `/replay`，后台入口为 `/dashboard`。

## 常用脚本

```bash
npm run build
npm run sim:reset
npm run verify:3days
npm run verify:real-llm
npm run verify:real-llm-full
npm run verify:board
```

- `sim:reset`：重置本地模拟状态。
- `verify:3days`：推进 3 天真实 LLM 流程并验证基础流程。
- `verify:real-llm`：检查当前数据库是否已有 A-H 验收证据，不负责推进模拟。
- `verify:real-llm-full`：重置数据库并跑完整真实 LLM 验收流，覆盖 7 天、董事会人工覆盖、增长阈值孵化和最终 A-H 数据库检查。
- `verify:board`：验证董事会日流程和自动指令。

## 环境与运行数据

- 本地模拟依赖 SQLite 文件和已有文章源。
- 真实 Agent 协作依赖 EVOMAP OpenAI-compatible 接口。`.env.local` 至少需要配置：

```bash
EVOMAP_API_KEY=...
EVOMAP_API_BASE=https://api.evomap.ai/v1
NPC_LLM_MODEL=claude-sonnet-4-6
NPC_EMBEDDING_MODEL=text-embedding-3-small
```

- 黑客松 EvoMap 进化能力接入使用 Developer OAuth2 + PKCE，`.env.local` 需要额外配置：

```bash
EVOMAP_DEVELOPER_CLIENT_ID=...
EVOMAP_DEVELOPER_CLIENT_SECRET=...
EVOMAP_DEVELOPER_BASE=https://evomap.ai
EVOMAP_OAUTH_REDIRECT_URI=http://localhost:3000/api/evomap/oauth/callback
```

- Tavily MCP 封面图能力是可选配置，用于让编辑 Agent 通过只读搜索寻找候选文章封面图。未配置时流程会继续运行，并回退到原文图或 deterministic fallback：

```bash
TAVILY_API_KEY=...
```

- 本地 OAuth token 保存于 `.evomap/oauth-token.json`，该目录已加入 `.gitignore`，不得提交。
- 工具页 `/dashboard/tools` 提供 EvoMap Connect / Disconnect；Agent 工具只使用 `recipe:read gene:read reuse:query` 只读 scope。
- Tavily MCP 只在编辑 Agent 回合动态注入；`publish_articles` 会优先使用原文 `cover_img/image_url/content img`，只有原文缺图时才接受编辑提交的 HTTPS `imageUrl`。
- `src/mastra/runtime/evomap-model.ts` 使用 Chat Completions；如果外部网关不支持 Responses API，不要改回默认 `createOpenAI()(model)`。
- `src/mastra/runtime/memory.ts` 默认使用 `memory.db` 保存 Mastra Memory 和向量索引，可通过 `NPC_MEMORY_DB_URL` 切换。
- 无效 LLM token 应让流程失败并记录 `error` 事件，不能回退到本地模板或伪造内容。
- 不要把本地数据库临时文件、缓存文件、系统文件作为长期上下文提交。
- 涉及模拟状态的调试应优先使用重置脚本恢复可重复状态。

## 开发原则

1. 保持单次变更范围清晰，避免混入无关重构。
2. 优先遵循现有 App Router、`src/domain`、`src/db`、`src/mastra`、`src/simulation` 的分层。
3. 新增 API 应同步补充类型、数据访问函数和必要文档。
4. 新增页面应复用 `src/components/admin-shell.tsx` 中的后台壳层和数据展示组件。
5. 发现超过文件行数或目录文件数量上限时，应提示并规划拆分。
