# 部署规范

当前项目可部署到 Cloudflare Workers/OpenNext，生产数据使用 Cloudflare D1 `npc-db`，绑定名为 `NPC_DB`。

## 当前状态

- 运行方式：Next.js 本地开发服务；Cloudflare 预览/生产通过 OpenNext 产物运行。
- 数据状态：本地开发和预览使用 Wrangler local D1；生产使用 Cloudflare remote D1。
- 外部服务：Mastra 与模型配置位于 `src/mastra/`，实际生产接入需确认环境变量和 provider。
- 生产发布：`npm run deploy` 构建并部署 Cloudflare Worker。

## D1 数据推送

- 推送生产数据使用 `npm run db:push`，脚本会优先读取 `.wrangler/state/v3/d1` 下的本地 Wrangler D1；只有加 `--from-root-sqlite` 时才从根目录 `sim.db` 导出。
- 默认同时推送模拟数据、`published_articles` 和近 30 天 `items` 源文章；全量源文章使用 `npm run db:push:all`。
- 推送前脚本会打印每天文章数。若最新 Day 的 `published_articles` 为 0，首页默认选择最新 Day 时会显示空文章列表，必须先修复或重新生成数据。
- 线上表检查：

```bash
npx wrangler d1 execute npc-db --remote --json --command \
  "SELECT d.day, COUNT(a.id) AS article_count FROM sim_days d LEFT JOIN published_articles a ON a.day=d.day GROUP BY d.day ORDER BY d.day;"
```

- 线上源文章表检查：

```bash
npx wrangler d1 execute npc-db --remote --json --command \
  "SELECT COUNT(*) AS items_count FROM items;"
```

## 发布前必须确认

1. `npm run build` 通过。
2. 数据库文件和本地运行产物不会被发布为生产资产。
3. `npm run db:push:dry` 输出的模拟天数、事件数、每日文章数符合预期。
4. 生产 D1 `sim_days`、`published_articles`、`items` 表存在且行数符合预期。
5. 模型 API Key、数据库路径、外部文章源路径等敏感或环境相关配置通过环境变量管理。
6. 董事会输入、模拟重置、连续运行等后台能力在生产环境有权限和隔离策略。

## 未来环境建议

- 本地环境：用于开发和模拟验证，可使用本地 SQLite。
- 预览环境：用于演示固定 seed 或固定快照，不应污染生产数据。
- 生产环境：如果要对外开放，应引入持久数据库、身份认证、后台权限、日志与回滚机制。

## 部署原则

- 不把本地模拟数据库当作唯一生产事实源。
- 不在代码中硬编码密钥、私有路径或生产配置。
- 涉及数据迁移、Agent 权限、模型成本和外部发布能力时，必须提供回滚或降级方案。
