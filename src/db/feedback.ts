import { randomUUID } from "node:crypto";
import { dbAll, dbFirst, dbRun } from "@/db/connection";

export type ArticleReview = {
  id: string;
  articleId: string;
  day: number;
  scoreInfo: number;
  scoreRead: number;
  scoreTimeliness: number;
  scoreUnique: number;
  scoreAiRel: number;
  scoreOverall: number;
  comment: string;
  createdAt: string;
};

export type HumanComment = {
  id: string;
  articleId: string;
  day: number;
  authorName: string;
  content: string;
  createdAt: string;
};

export type FeedbackContext = {
  avgOverall: number;
  topComments: string[];
  humanComments: { articleTitle: string; authorName: string; content: string }[];
  bestArticleTitle: string;
  worstArticleTitle: string;
};

export async function insertReview(input: Omit<ArticleReview, "id" | "createdAt">) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO article_reviews (id, article_id, day, score_info, score_read, score_timeliness, score_unique, score_ai_rel, score_overall, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.articleId,
    input.day,
    input.scoreInfo,
    input.scoreRead,
    input.scoreTimeliness,
    input.scoreUnique,
    input.scoreAiRel,
    input.scoreOverall,
    input.comment,
    now,
  );
  return id;
}

export async function insertHumanComment(input: Omit<HumanComment, "id" | "createdAt">) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO human_comments (id, article_id, day, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.articleId,
    input.day,
    input.authorName,
    input.content,
    now,
  );
  return id;
}

export async function listReviewsByArticle(articleId: string): Promise<ArticleReview[]> {
  const rows = await dbAll<{ id: string; article_id: string; day: number; score_info: number; score_read: number; score_timeliness: number; score_unique: number; score_ai_rel: number; score_overall: number; comment: string; created_at: string }>(
    "SELECT * FROM article_reviews WHERE article_id = ? ORDER BY created_at ASC",
    articleId,
  );
  return rows.map(r => ({
    id: r.id, articleId: r.article_id, day: r.day,
    scoreInfo: r.score_info, scoreRead: r.score_read, scoreTimeliness: r.score_timeliness,
    scoreUnique: r.score_unique, scoreAiRel: r.score_ai_rel, scoreOverall: r.score_overall,
    comment: r.comment, createdAt: r.created_at,
  }));
}

export async function listHumanCommentsByArticle(articleId: string): Promise<HumanComment[]> {
  const rows = await dbAll<{ id: string; article_id: string; day: number; author_name: string; content: string; created_at: string }>(
    "SELECT * FROM human_comments WHERE article_id = ? ORDER BY created_at ASC",
    articleId,
  );
  return rows.map(r => ({ id: r.id, articleId: r.article_id, day: r.day, authorName: r.author_name, content: r.content, createdAt: r.created_at }));
}

export async function avgReviewScoresByDay(day: number): Promise<{ avgOverall: number; count: number }> {
  const row = await dbFirst<{ avg_overall: number | null; cnt: number }>(
    "SELECT AVG(score_overall) AS avg_overall, COUNT(*) AS cnt FROM article_reviews WHERE day = ?",
    day,
  );
  return { avgOverall: row?.avg_overall ?? 0, count: row?.cnt ?? 0 };
}

export async function getYesterdayFeedbackContext(day: number): Promise<FeedbackContext | null> {
  const scoreRow = await dbFirst<{ avg: number | null }>("SELECT AVG(score_overall) AS avg FROM article_reviews WHERE day = ?", day);
  if (scoreRow?.avg === null || scoreRow?.avg === undefined) return null;

  const topReviews = await dbAll<{ comment: string; title_zh: string }>(
    `SELECT ar.comment, pa.title_zh
     FROM article_reviews ar
     JOIN published_articles pa ON pa.id = ar.article_id
     WHERE ar.day = ?
     ORDER BY ar.score_overall DESC
     LIMIT 3`,
    day,
  );

  const bestRow = await dbFirst<{ title_zh: string }>(
    `SELECT pa.title_zh FROM article_reviews ar JOIN published_articles pa ON pa.id = ar.article_id
     WHERE ar.day = ? ORDER BY ar.score_overall DESC LIMIT 1`,
    day,
  );

  const worstRow = await dbFirst<{ title_zh: string }>(
    `SELECT pa.title_zh FROM article_reviews ar JOIN published_articles pa ON pa.id = ar.article_id
     WHERE ar.day = ? ORDER BY ar.score_overall ASC LIMIT 1`,
    day,
  );

  const humanRows = await dbAll<{ author_name: string; content: string; title_zh: string }>(
    `SELECT hc.author_name, hc.content, pa.title_zh
     FROM human_comments hc
     JOIN published_articles pa ON pa.id = hc.article_id
     WHERE hc.day = ?
     ORDER BY hc.created_at DESC
     LIMIT 5`,
    day,
  );

  return {
    avgOverall: Number((scoreRow.avg ?? 0).toFixed(1)),
    topComments: topReviews.map(r => r.comment),
    humanComments: humanRows.map(r => ({ articleTitle: r.title_zh, authorName: r.author_name, content: r.content })),
    bestArticleTitle: bestRow?.title_zh ?? "",
    worstArticleTitle: worstRow?.title_zh ?? "",
  };
}
