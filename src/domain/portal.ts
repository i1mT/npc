import { getDay, getLayerDay, getWorkEventImpact, listEvents, listPublishedArticles, listWorkEvents, listDays } from "@/db/sim";
import type { LayerName } from "@/lib/types";

const layers: LayerName[] = ["mission", "environment", "memory", "structure", "rules", "resource", "growth"];

export async function getPortalDays() {
  const days = await listDays();
  return { days: days.map((day) => ({ day: day.day, dau: day.dau, reputation: day.reputation, articleCount: day.articleCount, isBoardDay: day.isBoardDay, editorNote: day.editorNote })) };
}

export async function getPortalDay(day: number) {
  const [resourceLayer, missionLayer, memoryLayer, structureLayer, layerDtos, articles, dayState] = await Promise.all([
    getLayerDay("resource", day),
    getLayerDay("mission", day),
    getLayerDay("memory", day),
    getLayerDay("structure", day),
    Promise.all(layers.map((layer) => getLayerDay(layer, day))),
    listPublishedArticles(day),
    getDay(day),
  ]);
  const resource = resourceLayer.snapshot;
  const mission = missionLayer.snapshot;
  const memory = memoryLayer.snapshot;
  const mappedArticles = articles.map((article) => ({
    id: article.id,
    titleZh: article.titleZh,
    summaryZh: article.summaryZh,
    contentZh: article.contentZh,
    tags: article.tags,
    qualityScore: article.qualityScore,
    sourceUrl: article.sourceUrl,
    imageUrl: article.imageUrl,
    memoryHighlights: summarizeSnapshot(memory),
    behindUrl: `/api/portal/day/${day}/behind?articleId=${encodeURIComponent(article.id)}`,
  }));
  return {
    day,
    editorNote: dayState?.editorNote ?? null,
    mission: summarizeSnapshot(mission),
    metrics: summarizeSnapshot(resource),
    articles: mappedArticles,
    articleGroups: groupArticlesByPrimaryTag(mappedArticles),
    contributors: summarizeSnapshot(structureLayer.snapshot),
    changeSummary: Object.fromEntries(layerDtos.map((dto) => [dto.layer, dto.changes.length])),
  };
}

export async function getPortalBehind(day: number, articleId?: string) {
  if (articleId) return getArticleBehind(day, articleId);
  const events = await listWorkEvents(day);
  const layerDtos = await Promise.all(layers.map((layer) => getLayerDay(layer, day)));
  const impacts = await Promise.all(events.slice(0, 20).map((event) => getWorkEventImpact(event.id)));
  return {
    day,
    articleId: articleId ?? null,
    traces: events,
    layers: Object.fromEntries(layerDtos.map((dto) => [dto.layer, dto])),
    impacts,
    legacyEvents: await listEvents(day),
  };
}

async function getArticleBehind(day: number, articleId: string) {
  const [articles, allEvents] = await Promise.all([listPublishedArticles(day), listWorkEvents(day)]);
  const article = articles.find((item) => item.id === articleId);
  const articleEvents = allEvents.filter((event) => {
    const refs = event.refs ?? {};
    const payload = event.payload ?? {};
    if (refs.target_article_id === articleId) return true;
    if (Array.isArray(refs.article_ids) && refs.article_ids.includes(articleId)) return true;
    if (payload.articleId === articleId) return true;
    return false;
  });
  const fallbackEvents = articleEvents.length ? articleEvents : allEvents.filter((event) => event.layer === "memory").slice(0, 1);
  const impacts = await Promise.all(fallbackEvents.map((event) => getWorkEventImpact(event.id)));
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
    impacts,
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

function groupArticlesByPrimaryTag<T extends { tags: string[] }>(articles: T[]) {
  const groups = new Map<string, T[]>();
  for (const article of articles) {
    const tag = article.tags[0] || "AI";
    groups.set(tag, [...(groups.get(tag) ?? []), article]);
  }
  return Array.from(groups.entries()).map(([tag, items]) => ({ tag, articles: items }));
}
