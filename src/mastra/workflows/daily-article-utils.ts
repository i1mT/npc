import { addLayerEvent } from "@/db/sim";
import type { ArticleSource, PublishedArticle } from "@/lib/types";

export type DraftArticle = {
  sourceId: string;
  titleZh: string;
  summaryZh: string;
  contentZh: string;
  qualityScore: number;
  qualityReason: string;
  tags: string[];
};

export function normalizeDrafts(day: number, drafts: DraftArticle[], sources: ArticleSource[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  return drafts.map((draft, index) => {
    const source = sourceById.get(draft.sourceId) ?? sources[index];
    if (!source) throw new Error(`Missing source for draft ${draft.sourceId}`);
    if (seen.has(source.id)) throw new Error(`Duplicate sourceId from LLM draft: ${source.id}`);
    seen.add(source.id);
    const titleZh = normalizeTitle(day, source.id, draft.titleZh);
    return {
      day,
      sourceId: source.id,
      titleZh,
      summaryZh: draft.summaryZh,
      contentZh: draft.contentZh,
      sourceUrl: source.sourceUrl,
      imageUrl: source.imageUrl,
      tags: draft.tags.length ? draft.tags : source.tags,
      qualityScore: Number(draft.qualityScore.toFixed(1)),
      qualityReason: draft.qualityReason,
    };
  });
}

export async function writeArticleMemory(day: number, articles: PublishedArticle[], trace: Record<string, unknown>) {
  await Promise.all(articles.map((article) =>
    addLayerEvent({
      day,
      actorId: "editor",
      actorName: "编辑 Agent",
      layer: "memory",
      eventType: "memory_write",
      action: "write_editorial_memory",
      content: `写入文章记忆：${article.titleZh}`,
      payload: { ...trace, articleId: article.id, sourceId: article.sourceId, tags: article.tags, qualityScore: article.qualityScore, reason: article.qualityReason },
      refs: { target_table: "published_articles", target_article_id: article.id },
    }),
  ));
}

export function averageScore(articles: Omit<PublishedArticle, "id" | "createdAt">[]) {
  return Number((articles.reduce((sum, article) => sum + article.qualityScore, 0) / Math.max(articles.length, 1)).toFixed(1));
}

export function stepTokens(step: { inputTokens: number; outputTokens: number }) {
  return step.inputTokens + step.outputTokens;
}

export function formatTopTags(articles: PublishedArticle[]) {
  const counts = new Map<string, number>();
  for (const tag of articles.flatMap((article) => article.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => `${tag} ${count} 篇`).join("、");
}

function normalizeTitle(day: number, sourceId: string, title: string) {
  const clean = title.replace(/[!?！？]/g, "").trim();
  if (clean.length <= 20 && clean === title.trim()) return clean;
  const normalized = clean.slice(0, 20);
  void addLayerEvent({
    day,
    actorId: "editor",
    actorName: "编辑 Agent",
    layer: "rules",
    eventType: "rule_trigger",
    action: "normalize_article_title",
    content: `标题归一化：${sourceId} 的标题被调整为 20 字以内且移除问号/感叹号。`,
    payload: { sourceId, originalTitle: title, normalizedTitle: normalized },
    refs: { target_table: "published_articles" },
  });
  return normalized;
}
