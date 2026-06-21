export type SimStatus = "idle" | "running" | "paused" | "error";

export type EventType =
  | "thinking"
  | "message"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "board"
  | "settlement"
  | "memory_write"
  | "memory_read"
  | "org_change"
  | "growth_trigger"
  | "rule_trigger"
  | "error";

export type DayState = {
  day: number;
  capital: number;
  reputation: number;
  dau: number;
  subscribers: number;
  adRevenue: number;
  llmCost: number;
  isBoardDay: boolean;
};

export type SimEvent = {
  id: string;
  day: number;
  seq: number;
  agentId: string;
  agentName: string;
  eventType: EventType;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type LayerName = "mission" | "environment" | "memory" | "structure" | "rules" | "resource" | "growth";

export type WorkEvent = {
  id: string;
  day: number;
  seq: number;
  ts: string;
  actorId: string;
  actorName: string;
  actorType: "agent" | "board" | "system" | "ceo";
  layer: LayerName | "work";
  eventType: EventType | "mission_update" | "memory_write" | "memory_read" | "rule_trigger" | "org_change" | "settlement" | "growth_trigger" | "strategy_amend";
  action: string;
  content: string;
  payload: Record<string, unknown> | null;
  refs: Record<string, unknown> | null;
  costToken: number;
  costYuan: number;
  createdAt: string;
};

export type LayerChange = {
  id: string;
  layer: LayerName;
  day: number;
  entityTable: string;
  entityId: string;
  changeType: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: string;
  causedBy: WorkEvent | null;
  createdAt: string;
};

export type LayerDayDTO = {
  layer: LayerName;
  day: number;
  snapshot: Record<string, unknown>;
  changes: LayerChange[];
  events: WorkEvent[];
};

export type PublishedArticle = {
  id: string;
  day: number;
  sourceId: string;
  titleZh: string;
  summaryZh: string;
  contentZh: string;
  sourceUrl: string;
  imageUrl: string | null;
  tags: string[];
  qualityScore: number;
  qualityReason: string;
  createdAt: string;
};

export type ArticleSource = {
  id: string;
  sourceUrl: string;
  title: string;
  summary: string;
  content: string;
  imageUrl: string | null;
  tags: string[];
  pubDate: string | null;
  translations: Record<string, unknown> | null;
};

export type DaySummary = DayState & {
  articleCount: number;
  completedAt: string | null;
  editorNote: string | null;
};

export type RuleDefinition = {
  id: string;
  group: string;
  title: string;
  description: string;
  parameters: Record<string, string | number | boolean>;
};

export type BoardMeetingStatus = "pending" | "resumed";

export type BoardMeeting = {
  day: number;
  status: BoardMeetingStatus;
  weeklyReport: Record<string, unknown>;
  autoDirective: string | null;
  autoDirectiveReason: string | null;
  directive: string | null;
  suspendedAt: string;
  resumedAt: string | null;
};

export type ToolDefinition<TArgs = unknown, TResult = unknown> = {
  name: string;
  description: string;
  execute: (args: TArgs) => TResult | Promise<TResult>;
};

export type AgentDefinition = {
  name: string;
  instructions: string;
  tools: string[];
  model: string;
};

export type WorkflowDefinition = {
  name: string;
  steps: { name: string; agent?: string; executor?: string; suspend?: boolean }[];
};
