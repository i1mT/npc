import { createHash, randomUUID } from "node:crypto";
import type { ArticleSource, EventType, PublishedArticle, SimEvent } from "@/lib/types";
import { agentFactory, type RuntimeAgentDef } from "@/mastra/agent-factory";
import { scoreArticle } from "@/simulation/formulas";
import { logEvent } from "@/simulation/mock-apis";

type Mention = { agentId: string; agentName: string };
type ToolSummary = { tool: string; input: string; result: string };
type StepKind = "agenda" | "query-report" | "draft" | "review" | "revise" | "publish-summary" | "settlement" | "rule-check" | "structure-rollup" | "growth-check";

export type CollaborationRuntime = {
  threadId: string;
  runtimeId: string;
  agents: RuntimeAgentDef[];
};

export type AgentStepResult<T> = {
  data: T;
  text: string;
  event: SimEvent;
  trace: Record<string, unknown>;
};

export function startDailyCollaboration(day: number): CollaborationRuntime {
  const agents = agentFactory.loadActiveEmployees();
  agentFactory.getMastraInstance();
  return {
    threadId: `day-${day}-mastra-${randomUUID().slice(0, 8)}`,
    runtimeId: agents[0]?.mastraRuntimeId ?? `mastra-runtime-${process.pid}`,
    agents,
  };
}

export function say(input: {
  day: number;
  runtime: CollaborationRuntime;
  agentHandle: string;
  eventType?: EventType;
  content: string;
  replyTo?: SimEvent | string | null;
  mentions?: Mention[];
  toolSummary?: ToolSummary;
  extra?: Record<string, unknown>;
}) {
  const agent = input.runtime.agents.find((item) => item.handle === input.agentHandle) ?? input.runtime.agents[0];
  const replyTo = typeof input.replyTo === "string" ? input.replyTo : input.replyTo?.id ?? null;
  return logEvent({
    day: input.day,
    agentId: agent?.handle ?? input.agentHandle,
    agentName: agent?.displayName ?? input.agentHandle,
    eventType: input.eventType ?? "message",
    content: input.content,
    metadata: {
      source: "mastra-agent-runtime",
      mastraRuntimeId: input.runtime.runtimeId,
      mastraThreadId: input.runtime.threadId,
      mastraAgent: agent ? {
        handle: agent.handle,
        roleTemplate: agent.roleTemplate,
        instructionHash: agent.instructionHash,
        tools: agent.tools,
      } : null,
      replyTo,
      mentions: input.mentions ?? [],
      toolSummary: input.toolSummary ?? null,
      messageFingerprint: fingerprint(`${input.runtime.threadId}:${agent?.handle}:${replyTo ?? ""}:${input.content}`),
      ...input.extra,
    },
  });
}

export async function runAgentStep<T>(input: {
  day: number;
  runtime: CollaborationRuntime;
  agentHandle: string;
  kind: StepKind;
  eventType?: EventType;
  replyTo?: SimEvent | string | null;
  mentions?: Mention[];
  toolSummary?: ToolSummary;
  context: Record<string, unknown>;
}) {
  const agent = input.runtime.agents.find((item) => item.handle === input.agentHandle) ?? input.runtime.agents[0];
  if (!agent) throw new Error("No Mastra agents loaded.");
  const traceId = `mastra-step-${randomUUID()}`;
  const data = executeLocalTool<T>(input.kind, input.context);
  const responseText = responseFor(input.kind, data, input.context);
  const mastraAgent = agentFactory.getMastraAgent(agent.handle);
  const output = await mastraAgent.generate([
    {
      role: "user",
      content: [
        `执行 AGI Daily Day ${input.day} 的 ${input.kind} 步骤。`,
        "必须基于工具结果输出业务对话，不要输出 JSON。",
        `NPC_AGENT_CONTEXT:${JSON.stringify({ traceId, responseText })}`,
      ].join("\n"),
    },
  ], {
    resourceId: `npc-day-${input.day}`,
    threadId: input.runtime.threadId,
  } as never);
  const text = String((output as { text?: string }).text ?? responseText);
  const event = say({
    day: input.day,
    runtime: input.runtime,
    agentHandle: agent.handle,
    eventType: input.eventType ?? "message",
    content: text,
    replyTo: input.replyTo,
    mentions: input.mentions,
    toolSummary: input.toolSummary,
    extra: {
      stepKind: input.kind,
      mastraExecution: {
        method: "Agent.generate",
        traceId,
        resourceId: `npc-day-${input.day}`,
        threadId: input.runtime.threadId,
      },
      stepResult: summarizeStepResult(data),
    },
  });
  return {
    data,
    text,
    event,
    trace: buildMastraTrace(input.runtime, agent.handle, traceId, event.id),
  };
}

export function buildMastraTrace(runtime: CollaborationRuntime, agentHandle: string, traceId: string, sourceEventId?: string) {
  const agent = runtime.agents.find((item) => item.handle === agentHandle);
  return {
    source: "mastra-agent-runtime",
    mastraRuntimeId: runtime.runtimeId,
    mastraThreadId: runtime.threadId,
    mastraAgent: agent ? {
      handle: agent.handle,
      roleTemplate: agent.roleTemplate,
      instructionHash: agent.instructionHash,
      tools: agent.tools,
    } : null,
    mastraExecution: {
      method: "Agent.generate",
      traceId,
      sourceEventId,
    },
  };
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function executeLocalTool<T>(kind: StepKind, context: Record<string, unknown>) {
  if (kind === "agenda") return planEditorialAgenda(Number(context.day), Number(context.reputation)) as T;
  if (kind === "query-report") return { count: context.count, firstIds: context.firstIds, focusTopics: context.focusTopics } as T;
  if (kind === "draft") return composeEditorialDrafts(Number(context.day), context.sources as ArticleSource[]) as T;
  if (kind === "review") return auditEditorialDrafts(context.articles as PublishedArticle[]) as T;
  if (kind === "revise") return improveEditorialDrafts(context.drafts as Omit<PublishedArticle, "id" | "createdAt">[]) as T;
  if (kind === "publish-summary") return { count: context.count, articleIds: context.articleIds } as T;
  if (kind === "settlement") return {
    averageQuality: context.averageQuality,
    socialReach: context.socialReach,
    capital: context.capital,
    subscribers: context.subscribers,
    protocol: evaluateGrowthProtocol(Number(context.averageQuality), Number(context.reputation)),
  } as T;
  if (kind === "rule-check") return {
    articleCount: context.articleCount,
    rules: ["HARD_SOURCE_URL_REQUIRED", "SOFT_DAILY_10_ARTICLES", "SOFT_TITLE_MAX_20"],
    outcome: "passed",
  } as T;
  if (kind === "structure-rollup") return {
    employees: ["editor-in-chief", "editor"],
    articleCount: context.articleCount,
    summary: "总编完成议程/审核，编辑完成选题/发布。",
  } as T;
  return {
    averageQuality: context.averageQuality,
    reputation: context.reputation,
    dau: context.dau,
    capital: context.capital,
    decision: evaluateGrowthProtocol(Number(context.averageQuality), Number(context.reputation)),
  } as T;
}

function responseFor(kind: StepKind, data: unknown, context: Record<string, unknown>) {
  if (kind === "agenda") {
    const agenda = data as { focusTopics: string[]; blockedTopics: string[]; note: string };
    return `制定今日议程：${agenda.focusTopics.join("、")}。@编辑 请按这个方向查询候选源，并避开 ${agenda.blockedTopics.join("、")}。`;
  }
  if (kind === "draft") {
    const drafts = data as Omit<PublishedArticle, "id" | "createdAt">[];
    return `提交 ${drafts.length} 篇稿件给 @总编 复核，覆盖 ${Array.from(new Set(drafts.flatMap((article) => article.tags))).slice(0, 8).join("、")}。`;
  }
  if (kind === "query-report") return `工具返回 ${String(context.count)} 篇候选文章。我会从中选 10 篇，优先保证来源完整和主题差异。`;
  if (kind === "review") {
    const review = data as { decision: "approve" | "reject"; reason: string; averageScore: number };
    return `${review.decision === "approve" ? "批准" : "打回"}：${review.reason}`;
  }
  if (kind === "revise") {
    const drafts = data as Omit<PublishedArticle, "id" | "createdAt">[];
    return `完成一次修订并重新提交，修订稿 ${drafts.length} 篇。`;
  }
  if (kind === "publish-summary") return `发布工具已执行，写入 ${String(context.count)} 篇文章，日报、Newsletter 和社交摘要进入分发队列。`;
  if (kind === "settlement") return `@编辑 @总编 今日结算完成：DAU ${String(context.dau)}，Reputation ${String(context.reputation)}，广告收入 ¥${String(context.revenue)}。`;
  if (kind === "rule-check") return "规则执行：source_url 完整、每日 10 篇、标题长度约束已检查。";
  if (kind === "structure-rollup") return "组织层日贡献汇总：总编完成议程/审核，编辑完成选题/发布。";
  const growth = data as { decision?: string };
  return String(growth.decision ?? "维持常规节奏：持续观察质量和留存。");
}

function summarizeStepResult(data: unknown) {
  if (Array.isArray(data)) return { count: data.length };
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return { value: data };
}

function planEditorialAgenda(day: number, reputation: number) {
  const focusByDay = [
    ["大模型推理效率", "AI 基础设施", "企业落地"],
    ["开源模型", "多模态产品", "开发者工具"],
    ["AI 芯片", "自动化工作流", "安全治理"],
  ];
  const focusTopics = focusByDay[(day - 1) % focusByDay.length];
  const blockedTopics = reputation < 55 ? ["未经证实融资传闻", "夸大替代人类表述"] : ["标题党预测", "无来源榜单"];
  return {
    focusTopics,
    blockedTopics,
    note: `Day ${day} 以 ${focusTopics.join("、")} 为主线，保持解释性和来源透明。`,
  };
}

function composeEditorialDrafts(day: number, sources: ArticleSource[]): Omit<PublishedArticle, "id" | "createdAt">[] {
  return sources.slice(0, 10).map((source, index) => {
    const qualityScore = scoreArticle({ title: source.title, summary: source.summary, content: source.content, tags: source.tags, index });
    return {
      day,
      sourceId: source.id,
      titleZh: titleZh(source),
      summaryZh: summaryZh(source, day),
      contentZh: contentZh(source, qualityScore),
      sourceUrl: source.sourceUrl,
      imageUrl: source.imageUrl || fallbackImages[index % fallbackImages.length],
      tags: source.tags.length ? source.tags : ["AI", "行业"],
      qualityScore,
      qualityReason: qualityScore >= 8 ? "来源完整、主题清晰、解释价值高。" : "信息有效，适合纳入当天资讯组合。",
    };
  });
}

function auditEditorialDrafts(articles: PublishedArticle[]) {
  const averageScore = Number((articles.reduce((sum, article) => sum + article.qualityScore, 0) / Math.max(articles.length, 1)).toFixed(1));
  if (articles.length !== 10) return { decision: "reject" as const, reason: "每日发布量必须固定为 10 篇。", averageScore };
  if (articles.some((article) => !article.sourceUrl)) return { decision: "reject" as const, reason: "存在缺少 source_url 的稿件。", averageScore };
  if (averageScore < 7) return { decision: "reject" as const, reason: `平均质量分 ${averageScore} 低于 7.0，需要重写标题和摘要。`, averageScore };
  return { decision: "approve" as const, reason: `10 篇稿件来源完整，平均质量分 ${averageScore}，批准发布。`, averageScore };
}

function improveEditorialDrafts(articles: Omit<PublishedArticle, "id" | "createdAt">[]) {
  return articles.map((article) => ({
    ...article,
    titleZh: trimText(article.titleZh.replace(/[!！?？]+/g, ""), 20),
    summaryZh: trimText(`${article.summaryZh} 补充背景和影响判断，降低误读风险。`, 170),
    qualityScore: Math.min(9.2, Number((article.qualityScore + 0.4).toFixed(1))),
    qualityReason: `${article.qualityReason} 已按总编意见补强上下文。`,
  }));
}

function evaluateGrowthProtocol(qualityScore: number, reputation: number) {
  if (qualityScore >= 8.2 && reputation >= 70) return "触发生长协议：提高社交分发权重，追加专题策划。";
  if (qualityScore < 6.8 || reputation < 50) return "触发收缩协议：减少实验性选题，优先解释性报道。";
  return "维持常规节奏：持续观察质量和留存。";
}

const fallbackImages = [
  "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80",
];

function trimText(value: string, max: number) {
  const clean = stripHtml(value).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function inferTopic(source: ArticleSource) {
  const text = `${source.title} ${source.summary} ${source.tags.join(" ")}`.toLowerCase();
  if (/inference|gpu|nvidia|chip|compute|baseten|elastic/.test(text)) return "推理算力";
  if (/agent|workflow|automation|coding|developer|software|bug/.test(text)) return "AI Agent";
  if (/openai|anthropic|google|deepmind|xai|meta/.test(text)) return "大模型公司";
  if (/robot|device|hardware/.test(text)) return "智能硬件";
  if (/security|safety|policy|regulation|copyright/.test(text)) return "AI 治理";
  if (/funding|startup|yc|venture|billion|million/.test(text)) return "AI 创业";
  if (/image|video|audio|multimodal|voice/.test(text)) return "多模态";
  return "AI 产业";
}

function titleZh(source: ArticleSource) {
  const base = source.title.replace(/\s+/g, " ").trim();
  if (/[\u4e00-\u9fa5]/.test(base)) return trimText(base, 20);
  const topic = inferTopic(source);
  const sourceHint = stripHtml(base).split(/[,:：\-–—|]/)[0]?.trim();
  if (sourceHint && sourceHint.length > 2 && sourceHint.length < 18) return trimText(`${sourceHint} 押注${topic}`, 20);
  return `${topic}出现新信号`;
}

function summaryZh(source: ArticleSource, day: number) {
  const text = trimText(source.summary || source.content || source.title, 180);
  const topic = inferTopic(source);
  if (/[\u4e00-\u9fa5]/.test(text)) return trimText(`第 ${day} 期关注：${text}`, 150);
  return trimText(`第 ${day} 期关注 ${topic}：原文指出「${text}」。编辑部将其纳入今日观察，是因为它可能影响产品、资本或基础设施决策。`, 170);
}

function contentZh(source: ArticleSource, score: number) {
  const body = trimText(source.content || source.summary, 620);
  const topic = inferTopic(source);
  const why = score >= 8 ? "这条新闻值得放在今天的重点位，因为它会影响产品路线、算力配置或企业采用节奏。" : "这条新闻提供了观察 AI 产业变化的一个可靠切面。";
  const sourceDigest = /[\u4e00-\u9fa5]/.test(body) ? body : `原文要点：${body}`;
  return `${sourceDigest}\n\n中文解读：它属于「${topic}」方向。${why}读者需要关注的是：谁获得了新的能力或资源、这会改变哪类产品成本，以及是否会影响接下来一周的行业叙事。`;
}
