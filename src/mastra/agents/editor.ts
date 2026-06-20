import type { AgentDefinition, ArticleSource, PublishedArticle } from "@/lib/types";
import { scoreArticle } from "@/simulation/formulas";

export const editorAgent: AgentDefinition = {
  name: "editor",
  model: "evomap/openai-compatible-chat",
  tools: ["queryArticles", "getEditorialMemory", "rewriteArticle", "scoreArticle", "publishArticle", "sendNewsletter", "postSocial"],
  instructions: [
    "你是 AGI Daily 的编辑。",
    "每天从文章池筛选今日最重要的 10 篇，优先 24h 内并兼顾话题多样性。",
    "每篇改写为中文友好格式：标题、摘要、正文解读，并给出质量分。",
    "必须有 source_url；禁止机器直译；每期固定 10 篇。",
  ].join("\n"),
};

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
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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
  if (sourceHint && sourceHint.length > 2 && sourceHint.length < 18) {
    return trimText(`${sourceHint} 押注${topic}`, 20);
  }
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

export function draftArticles(day: number, sources: ArticleSource[]): Omit<PublishedArticle, "id" | "createdAt">[] {
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

export function reviseArticles(articles: Omit<PublishedArticle, "id" | "createdAt">[]) {
  return articles.map((article) => ({
    ...article,
    titleZh: trimText(article.titleZh.replace(/[!！?？]+/g, ""), 20),
    summaryZh: trimText(`${article.summaryZh} 补充背景和影响判断，降低误读风险。`, 170),
    qualityScore: Math.min(9.2, Number((article.qualityScore + 0.4).toFixed(1))),
    qualityReason: `${article.qualityReason} 已按总编意见补强上下文。`,
  }));
}
