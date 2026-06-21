/**
 * Reader Agent — 独立于公司的读者视角 Agent
 * 每天在文章发布后运行，全并发对每篇文章打分并写评论。
 * 评分结果写入 article_reviews 表，并影响次日 DAU。
 * 实时通过 logEvent + emitAgentStream 推送到工作日志。
 */
import { z } from "zod";
import { listPublishedArticles, addLayerEvent } from "@/db/sim";
import { insertReview, avgReviewScoresByDay } from "@/db/feedback";
import { agentFactory } from "@/mastra/agent-factory";
import { logEvent } from "@/simulation/mock-apis";
import { emitAgentStream } from "@/simulation/event-bus";
import type { CollaborationRuntime } from "@/mastra/collaboration";

const REVIEW_TIMEOUT_MS = 90_000;

const READER_AGENT_ID   = "reader-agent";
const READER_AGENT_NAME = "读者 Agent";

const reviewSchema = z.object({
  info_density: z.number().min(0).max(10),
  readability:  z.number().min(0).max(10),
  timeliness:   z.number().min(0).max(10),
  uniqueness:   z.number().min(0).max(10),
  ai_relevance: z.number().min(0).max(10),
  overall:      z.number().min(0).max(10),
  comment:      z.string().min(5).max(200),
});
type ReviewScore = z.infer<typeof reviewSchema>;

function buildReaderPrompt(article: { titleZh: string; summaryZh: string; contentZh: string; tags: string[] }): string {
  const tags    = article.tags.join("、");
  const content = article.contentZh.slice(0, 800);
  return [
    "你是 AGI Daily 的读者 Agent，代表中文 AI 行业的专业读者视角。请认真阅读以下文章并给出评价。",
    "",
    `标题：${article.titleZh}`,
    `摘要：${article.summaryZh}`,
    `正文节选：${content}`,
    `标签：${tags}`,
    "",
    "请从以下6个维度评分（0-10），并用中文写一条有个性的评论（30-100字，可以赞美或批评，语气自然真实）：",
    "- info_density：信息密度（单位篇幅内有效信息量）",
    "- readability：可读性（流畅度，是否有机翻感）",
    "- timeliness：时效性（事件是否足够新鲜）",
    "- uniqueness：独特性（是否提供独特视角或深度分析）",
    "- ai_relevance：AI相关性（是否紧扣 AI 行业核心议题）",
    "- overall：整体满意度（综合以上维度）",
    "",
    "只输出 JSON，不要输出任何其他文字：",
    '{"info_density":8,"readability":7,"timeliness":6,"uniqueness":5,"ai_relevance":9,"overall":7.5,"comment":"这篇文章观点独到，但结尾论证略显仓促。"}',
  ].join("\n");
}

function extractJson(text: string): ReviewScore | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return reviewSchema.parse(JSON.parse(match[0]));
  } catch {
    return null;
  }
}

async function reviewOneArticle(
  article: { id: string; day: number; titleZh: string; summaryZh: string; contentZh: string; tags: string[] },
  idx: number,
): Promise<ReviewScore | null> {
  const streamId = `reader-stream-${article.id}`;

  // Emit stream start for this article
  emitAgentStream({
    streamId,
    day: article.day,
    agentId: READER_AGENT_ID,
    agentName: READER_AGENT_NAME,
    eventType: "message",
    content: "",
    delta: "",
    status: "start",
    turn: idx + 1,
  });

  try {
    const agent = agentFactory.getMastraAgent("editor-in-chief");
    const prompt = buildReaderPrompt(article);
    const output = await (agent as { generate: (p: string, o: unknown) => Promise<unknown> }).generate(prompt, {
      abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    } as never);

    const text = (() => {
      const r = output as { text?: string; steps?: { text?: string }[] };
      if (typeof r.text === "string" && r.text.trim()) return r.text.trim();
      for (const step of r.steps ?? []) {
        if (typeof step.text === "string" && step.text.trim()) return step.text.trim();
      }
      return "";
    })();

    const score = extractJson(text);

    if (score) {
      // Emit stream done with formatted result
      const scoreStr = `总分 ${score.overall}/10 · 信息密度 ${score.info_density} · 可读性 ${score.readability} · 时效性 ${score.timeliness} · 独特性 ${score.uniqueness} · AI相关 ${score.ai_relevance}`;
      const resultContent = `《${article.titleZh}》\n${scoreStr}\n\n> ${score.comment}`;

      emitAgentStream({
        streamId,
        day: article.day,
        agentId: READER_AGENT_ID,
        agentName: READER_AGENT_NAME,
        eventType: "message",
        content: resultContent,
        delta: "",
        status: "done",
        turn: idx + 1,
      });

      // Persist to DB and emit as stored event
      await logEvent({
        day: article.day,
        agentId: READER_AGENT_ID,
        agentName: READER_AGENT_NAME,
        eventType: "message",
        content: resultContent,
        metadata: {
          source: "reader-agent",
          articleId: article.id,
          articleTitle: article.titleZh,
          scores: {
            info_density: score.info_density,
            readability: score.readability,
            timeliness: score.timeliness,
            uniqueness: score.uniqueness,
            ai_relevance: score.ai_relevance,
            overall: score.overall,
          },
        },
      });
    } else {
      emitAgentStream({ streamId, day: article.day, agentId: READER_AGENT_ID, agentName: READER_AGENT_NAME, eventType: "message", content: "", delta: "", status: "error", turn: idx + 1 });
    }

    return score;
  } catch (err) {
    console.warn(`[reader-agent] article ${article.id} failed:`, err instanceof Error ? err.message : err);
    emitAgentStream({ streamId, day: article.day, agentId: READER_AGENT_ID, agentName: READER_AGENT_NAME, eventType: "message", content: "", delta: "", status: "error", turn: idx + 1 });
    return null;
  }
}

export async function runReaderAgent(
  day: number,
  runtime: CollaborationRuntime,
): Promise<{ avgOverall: number; reviewCount: number }> {
  const articles = await listPublishedArticles(day);
  if (articles.length === 0) return { avgOverall: 0, reviewCount: 0 };

  // Announce start
  await logEvent({
    day,
    agentId: READER_AGENT_ID,
    agentName: READER_AGENT_NAME,
    eventType: "message",
    content: `开始阅读今日 ${articles.length} 篇文章…`,
    metadata: { source: "reader-agent", articleCount: articles.length },
  });

  // Full concurrency — all articles at once
  const results = await Promise.all(articles.map((a, i) => reviewOneArticle(a, i)));

  let reviewed = 0;
  for (let j = 0; j < articles.length; j++) {
    const score = results[j];
    const article = articles[j];
    if (!score || !article) continue;
    await insertReview({
      articleId: article.id,
      day,
      scoreInfo: score.info_density,
      scoreRead: score.readability,
      scoreTimeliness: score.timeliness,
      scoreUnique: score.uniqueness,
      scoreAiRel: score.ai_relevance,
      scoreOverall: score.overall,
      comment: score.comment,
    });
    reviewed++;
  }

  const { avgOverall } = await avgReviewScoresByDay(day);

  if (reviewed > 0) {
    const summaryContent = `完成 ${reviewed} 篇文章评读，整体满意度均值 ${avgOverall.toFixed(1)}/10`;
    await logEvent({
      day,
      agentId: READER_AGENT_ID,
      agentName: READER_AGENT_NAME,
      eventType: "settlement",
      content: summaryContent,
      metadata: { source: "reader-agent", reviewCount: reviewed, avgOverall, threadId: runtime.threadId },
    });
    await addLayerEvent({
      day,
      actorId: READER_AGENT_ID,
      actorName: READER_AGENT_NAME,
      actorType: "system",
      layer: "resource",
      eventType: "settlement",
      action: "reader_feedback",
      content: summaryContent,
      payload: { reviewCount: reviewed, avgOverall },
    });
  }

  return { avgOverall, reviewCount: reviewed };
}
