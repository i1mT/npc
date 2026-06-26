一旦我所属的文件夹有所变化，请务必更新我。

# 工程文档

本目录保存项目长期维护所需的工程上下文，包括开发方式、测试策略、开发流程、部署环境、上下文机制和数据层约定。

- `development.md`：本地开发、依赖安装、启动方式、环境配置和已知工程注意事项。
- `test.md`：验证脚本、测试范围、执行要求和当前缺口。
- `workflow.md`：从需求到变更完成的标准开发流程。
- `deployment.md`：当前部署状态、环境划分和发布原则。
- `context.md`：GEB 仓库上下文文档机制。
- `database.md`：SQLite 数据库、schema、事件事实源和七层投影说明。

## 工程入口

- 页面入口：`app/`
- API 入口：`app/api/`
- Dashboard 模拟推进：`src/mastra/workflows/streamed-day/`
- Legacy 模拟引擎：`src/simulation/engine.ts`
- Mastra 工作流：`src/mastra/workflows/`
- 数据访问：`src/db/`
- 类型契约：`src/lib/types.ts`
- 本地脚本：`scripts/`

## 当前工程风险

- `src/db/sim.ts` 文件过长且职责较集中，后续数据层迭代应拆分。
- `src/mastra/workflows/agentic-day.ts` 是 legacy 长任务实现，文件过长；Dashboard 新增推进能力应放在 `src/mastra/workflows/streamed-day/`，保持单 turn stream 和分层文件结构。
- `npm run lint` 当前使用 `next lint`，在 Next.js 15 中不可用，应修正为项目可执行的 lint 命令。
- `sim.db-shm`、`sim.db-wal`、`.DS_Store` 这类本地运行产物不应进入版本控制。
