import { getLayerDay, getWorkEventImpact, listEvents, listPublishedArticles, listWorkEvents, listDays } from "@/db/sim";
import type { LayerName } from "@/lib/types";

const layers: LayerName[] = ["mission", "environment", "memory", "structure", "rules", "resource", "growth"];

export function getPortalDays() {
  return { days: listDays().map((day) => ({ day: day.day, dau: day.dau, reputation: day.reputation, articleCount: day.articleCount, isBoardDay: day.isBoardDay })) };
}

export function getPortalDay(day: number) {
  const resource = getLayerDay("resource", day).snapshot;
  const mission = getLayerDay("mission", day).snapshot;
  const memory = getLayerDay("memory", day).snapshot;
  const articles = listPublishedArticles(day);
  return {
    day,
    mission: summarizeSnapshot(mission),
    metrics: summarizeSnapshot(resource),
    articles: articles.map((article) => ({
      id: article.id,
      titleZh: article.titleZh,
      summaryZh: article.summaryZh,
      tags: article.tags,
      qualityScore: article.qualityScore,
      sourceUrl: article.sourceUrl,
      imageUrl: article.imageUrl,
      memoryHighlights: summarizeSnapshot(memory),
      behindUrl: `/api/portal/day/${day}/behind?articleId=${encodeURIComponent(article.id)}`,
    })),
    contributors: summarizeSnapshot(getLayerDay("structure", day).snapshot),
    changeSummary: Object.fromEntries(layers.map((layer) => [layer, getLayerDay(layer, day).changes.length])),
  };
}

export function getPortalBehind(day: number, articleId?: string) {
  if (articleId) return getArticleBehind(day, articleId);
  const events = listWorkEvents(day);
  return {
    day,
    articleId: articleId ?? null,
    traces: events,
    layers: Object.fromEntries(layers.map((layer) => [layer, getLayerDay(layer, day)])),
    impacts: events.slice(0, 20).map((event) => getWorkEventImpact(event.id)),
    legacyEvents: listEvents(day),
  };
}

function getArticleBehind(day: number, articleId: string) {
  const article = listPublishedArticles(day).find((item) => item.id === articleId);
  const allEvents = listWorkEvents(day);
  const articleEvents = allEvents.filter((event) => {
    const refs = event.refs ?? {};
    const payload = event.payload ?? {};
    if (refs.target_article_id === articleId) return true;
    if (Array.isArray(refs.article_ids) && refs.article_ids.includes(articleId)) return true;
    if (payload.articleId === articleId) return true;
    return false;
  });
  const fallbackEvents = articleEvents.length ? articleEvents : allEvents.filter((event) => event.layer === "memory").slice(0, 1);
  return {
    day,
    articleId,
    article: article ?? null,
    memory: {
      highlights: article
        ? [
            `选题标签：${article.tags.join(" / ") || "AI"}`,
            `质量分：${article.qualityScore}`,
            article.qualityReason,
          ]
        : [],
      writes: fallbackEvents.filter((event) => event.layer === "memory"),
    },
    events: fallbackEvents,
    impacts: fallbackEvents.map((event) => getWorkEventImpact(event.id)),
    explanation: article
      ? `这篇文章进入 Day ${day} 是因为编辑 Agent 将 ${article.tags.slice(0, 3).join("、") || "AI 产业"} 识别为当天组合的一部分，并写入文章级记忆 ${article.qualityScore} 分。`
      : `Day ${day} 未找到 articleId=${articleId} 的文章。`,
  };
}

function summarizeSnapshot(snapshot: Record<string, unknown>) {
  const entries = Object.entries(snapshot);
  if (!entries.length) return null;
  return entries.length === 1 ? entries[0][1] : snapshot;
}
