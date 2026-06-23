# 数据库规范

本项目当前通过 `src/db/connection.ts` 访问 Cloudflare D1。开发和预览环境使用 Wrangler local D1，生产环境使用 Cloudflare remote D1；schema 定义位于 `src/db/schema.sql`，主要读写逻辑目前集中在 `src/db/sim.ts`。

## 数据库角色

- Wrangler local D1：本地模拟状态库，保存天级指标、工作事件、发布文章、董事会记录、七层快照和变更。
- Cloudflare remote D1 `npc-db`：生产数据源，绑定名为 `NPC_DB`。
- `items`：源文章表，由 `src/db/articles.ts` 读取，用于从已有文章池中选择并发布内容。
- 根目录 `sim.db` / `agidaily.db`：历史或导入源文件；生产推送默认不再以 `sim.db` 为准，除非显式使用 `--from-root-sqlite`。
- `sim.db-shm`、`sim.db-wal`：SQLite 运行时附属文件，不应作为业务资产维护。

## 核心表

- `sim_days`：每日状态快照，包括 Capital、Reputation、DAU、订阅数、收入、LLM 成本和董事会日标记。
- `work_events`：统一事实源，记录 Agent、董事会、系统和 CEO 的动作。
- `published_articles`：每日发布内容。
- `board_meetings` / `board_directives`：董事会暂停、恢复和指令。
- `layer_snapshots`：七层按天快照。
- `layer_changes`：七层按天变更日志，关联来源事件。
- `employees`、`org_relations`、`employee_responsibilities`：员工 Agent 与组织结构。
- `tool_registry`、`tool_grants`、`tool_calls`：能力层工具和调用记录。
- `memory_entries`、`memory_writes`、`memory_reads`、`memory_links`：记忆层读写与引用链。

## 日结口径

- 广告收入、订阅收入和净收入的核心参数统一放在 `src/simulation/formulas.ts`。
- 有机广告按声誉分档 CPM 结算，当前低/中/高声誉 CPM 分别为 ¥30、¥60、¥120。
- 订阅收入按订阅用户数 × ¥1.8/天计算，`daily_settlement.revenue_breakdown.subscription` 和 Capital 变更必须使用同一函数。

## 数据原则

1. `work_events` 是状态变化的事实源；能解释的变化应能追溯到事件。
2. 七层页面读取时应优先走快照、变更、事件三件套，而不是直接拼 UI 私有结构。
3. Schema 修改必须同步更新 `src/db/schema.sql`、相关 TypeScript 类型和读写函数。
4. 新增高风险数据写入时，应补充验证脚本或至少提供可重复手动验证路径。
5. 后续应把 `src/db/sim.ts` 拆分为更小模块，避免继续扩大单文件职责。
