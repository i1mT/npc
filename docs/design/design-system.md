# 设计系统

本项目当前视觉语言来自 AGI Daily 的“报纸杂志 + 运营控制台”混合气质。前台偏内容出版物，后台偏可解释的公司运行系统。

## Brand System

### Keywords

- Agent 公司
- 事件溯源
- 七层组织模型
- 日报出版
- 治理与生长

### Emotion

- 克制
- 清晰
- 可追踪
- 有编辑部质感
- 有运营中台效率

### Inspiration

- 报纸版式
- 编辑部工作台
- 数据运营后台
- 系统审计日志

## Color System

### 已配置 Tailwind 色值

- `ink`：`#161616`，主文字、深色背景、强边框。
- `paper`：`#f7f3ea`，前台纸张背景。
- `rule`：`#d8d0c2`，分隔线和弱边框。
- `cobalt`：`#254edb`，使命、链接、重点信息。
- `signal`：`#f6c445`，董事会、提示、重点动作。
- `mint`：`#4fbf87`，资源进度、正向状态。
- `coral`：`#e45c3a`，异常、警告或强调。

### 背景

- 前台页面：`paper` 或近似纸色。
- 后台主背景：`#f4f6f1`。
- 后台深色导航：`ink`。
- 数据卡片：白色或 `#f8f8f4`。

## Typography System

### 字体

- Sans：`Arial, Helvetica, Inter, system-ui, sans-serif`
- Serif：`Georgia, Times New Roman, serif`

### 使用原则

- 后台主体用 sans，保持扫描效率。
- 前台标题或出版物气质区域可用 serif。
- 后台卡片标题保持紧凑，不使用过大的 hero 字号。
- 不使用负 letter spacing。

## Layout System

### 后台

- 桌面端常用左侧导航 + 主内容布局。
- `/dashboard` 当前使用三列：期次侧栏、事件主区、资源与规则侧栏。
- 后台信息密度高，优先表格、列表、时间轴、定义列表。

### 前台

- 使用报纸网格纹理 `.newspaper-grid`。
- 内容以日为单位组织，突出文章标题、摘要、来源和质量评分。

## Radius System

- 当前按钮和卡片多为直角或极小圆角。
- 导航 hover 可使用 `rounded-sm`。
- 不引入大圆角卡片风格，避免削弱报纸/中台气质。

## Component System

### Button

- 控制类按钮使用图标 + 短文本。
- 主要动作可用 `signal` 底色。
- 次要动作使用边框按钮。

### Card / Panel

- 边框清晰，背景克制。
- 事件卡片通过左侧粗边框表达类型。
- 数据卡片优先展示标签、主值、必要上下文。

### Event Card

- `thinking`：灰白，默认可弱化。
- `message`：mint 浅底。
- `tool_call` / `tool_result`：类代码卡片，可展开工具摘要。
- `decision`：cobalt 浅底，突出关键决策。
- `board`：signal 浅底，突出治理事件。

### Data Rendering

- 复杂对象统一用 `HumanData` 展示。
- JSON 原文只在调试或影响面中保留，面向用户优先翻译成字段标签和摘要。

## Visual Effects

- 使用边框、色线、徽标和进度条表达状态。
- 避免装饰性渐变、发光球、过度阴影。
- 动画只用于运行状态、实时事件追加和告警变化。
