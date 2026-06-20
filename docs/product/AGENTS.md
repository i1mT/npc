一旦我所属的文件夹有所变化，请务必更新我。

# 产品文档

本目录保存 AGI Daily NPC 的产品上下文，包括项目定位、用户角色、核心体验和长期产品边界。

## 项目定位

AGI Daily NPC 是一个“Agent 运营内容公司”的模拟系统。它不是普通 CMS，也不是单纯的多 Agent demo，而是用 AGI Daily 这家虚拟内容公司验证 NPC（No Person Company）组织模型：一家公司可以没有人，但不能没有结构。

当前产品目标是让用户能同时看到两件事：

1. 前台结果：某一天 AGI Daily 对外发布了什么内容，质量如何，给业务指标带来什么影响。
2. 后台因果：这些结果由哪些 Agent、工具调用、规则、资源变化、董事会指令和七层资产共同导致。

## 目标用户

- 产品和技术决策者：理解 Agent 公司如何被结构化约束，而不是只依赖提示词。
- AI Agent 系统设计者：观察多 Agent 协作、事件溯源、资源约束、治理和增长协议的产品化形态。
- 项目维护者：通过前后台页面、事件流和文档系统持续迭代 NPC 模拟能力。

## 核心概念

- NPC：No Person Company，由 Agent 运行、由结构约束的公司形态。
- 七层模型：使命层、能力层、记忆层、组织层、规则层、资源织网、生长协议。
- AGI Daily：当前案例公司，定位为中文 AI 日报内容产品。
- Board：董事会，不是 Agent，而是外部治理主体；每 7 天介入一次，给出不可由 Agent 自行决定的方向性指令。
- Work Event：所有 Agent 行动、工具调用、决策、结算和治理动作的事实源。

## 主要体验

- `/`：默认展示最新或指定天的前台日报回放。
- `/replay`：前台按天回放 AGI Daily 的内容结果。
- `/dashboard`：后台公司总览，可运行 3 天、推进一天、暂停模拟、查看资源和事件流。
- `/dashboard/events`：查看工作事件流，理解某一天 Agent 协作过程。
- `/dashboard/layers/[layer]`：查看七层资产的快照、变更和来源事件。
- `/dashboard/board`：查看董事会日记录和指令。
- `/dashboard/org`：查看员工 Agent 与组织关系。
- `/dashboard/growth`：查看 Growth Protocol 触发与控制台。

## 当前产品边界

- 重点是本地模拟和可解释性展示，不是线上生产内容发布系统。
- 文章内容来自本地或外部文章源读取层，模拟发布到 `sim.db`。
- 业务指标由模拟公式和 Agent 行为共同驱动，不能理解为真实商业预测。
- 董事会目前以本地输入指令推进，不涉及真实权限系统。

## 参考原始文档

- `NPC_Design.md`：NPC 抽象设计。
- `NPC_Case_ContentCompany.md`：AGI Daily 内容公司案例。
- `NPC_Arch_Layered.md`：七层领域模型、事件溯源和 API 设计。
- `NPC_UI_IA.md`：后台页面 IA、交互状态和验收单。
- `NPC_Tech_Design.md`：早期技术设计方案。
