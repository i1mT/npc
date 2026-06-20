# 测试规范

测试用于保障模拟流程、数据读写、Agent 工作流和前后台关键路径在持续迭代中不回归。

## 当前可用验证

```bash
npm run build
npm run verify:3days
npm run verify:board
```

- `build`：验证 Next.js 编译、类型和页面/API 基础契约。
- `verify:3days`：验证模拟能连续推进 3 天，事件和日结数据可写入。
- `verify:board`：验证董事会日暂停、指令和恢复流程。

## 当前缺口

- `npm run lint` 当前不可用，因为脚本使用了 Next.js 15 已移除的 `next lint`。
- 仓库暂未看到正式单元测试框架配置。
- 数据层和模拟公式缺少可隔离的单元测试。

## 执行要求

1. 修改模拟引擎、Mastra 工作流、数据层或 API 后，至少运行相关验证脚本。
2. 修改页面和组件后，至少运行 `npm run build`。
3. 修改董事会、Growth Protocol 或七层变更逻辑后，应运行 `npm run verify:board`。
4. 测试失败时，不通过跳过脚本、删除断言或降低检查范围规避问题。

## 后续建议

- 引入 Vitest 或项目认可的测试框架，优先覆盖 `src/simulation/formulas.ts`、DTO 聚合和数据映射。
- 修复 lint 脚本，恢复静态检查作为合并门槛。
