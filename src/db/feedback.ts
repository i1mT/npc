import { randomUUID } from "node:crypto";
import { getSimDb } from "@/db/connection";

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

export function insertReview(input: Omit<ArticleReview, "id" | "createdAt">) {
  const db = getSimDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO article_reviews (id, article_id, day, score_info, score_read, score_timeliness, score_unique, score_ai_rel, score_overall, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.articleId, input.day, input.scoreInfo, input.scoreRead, input.scoreTimeliness, input.scoreUnique, input.scoreAiRel, input.scoreOverall, input.comment, now);
  return id;
}

export function insertHumanComment(input: Omit<HumanComment, "id" | "createdAt">) {
  const db = getSimDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO human_comments (id, article_id, day, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.articleId, input.day, input.authorName, input.content, now);
  return id;
}

export function listReviewsByArticle(articleId: string): ArticleReview[] {
  const rows = getSimDb()
    .prepare("SELECT * FROM article_reviews WHERE article_id = ? ORDER BY created_at ASC")
    .all(articleId) as { id: string; article_id: string; day: number; score_info: number; score_read: number; score_timeliness: number; score_unique: number; score_ai_rel: number; score_overall: number; comment: string; created_at: string }[];
  return rows.map(r => ({
    id: r.id, articleId: r.article_id, day: r.day,
    scoreInfo: r.score_info, scoreRead: r.score_read, scoreTimeliness: r.score_timeliness,
    scoreUnique: r.score_unique, scoreAiRel: r.score_ai_rel, scoreOverall: r.score_overall,
    comment: r.comment, createdAt: r.created_at,
  }));
}

export function listHumanCommentsByArticle(articleId: string): HumanComment[] {
  const rows = getSimDb()
    .prepare("SELECT * FROM human_comments WHERE article_id = ? ORDER BY created_at ASC")
    .all(articleId) as { id: string; article_id: string; day: number; author_name: string; content: string; created_at: string }[];
  return rows.map(r => ({ id: r.id, articleId: r.article_id, day: r.day, authorName: r.author_name, content: r.content, createdAt: r.created_at }));
}

export function avgReviewScoresByDay(day: number): { avgOverall: number; count: number } {
  const row = getSimDb()
    .prepare("SELECT AVG(score_overall) AS avg_overall, COUNT(*) AS cnt FROM article_reviews WHERE day = ?")
    .get(day) as { avg_overall: number | null; cnt: number };
  return { avgOverall: row.avg_overall ?? 0, count: row.cnt };
}

export function getYesterdayFeedbackContext(day: number): FeedbackContext | null {
  const db = getSimDb();

  const scoreRow = db.prepare("SELECT AVG(score_overall) AS avg FROM article_reviews WHERE day = ?").get(day) as { avg: number | null };
  if (scoreRow.avg === null) return null;

  const topReviews = db.prepare(
    `SELECT ar.comment, pa.title_zh
     FROM article_reviews ar
     JOIN published_articles pa ON pa.id = ar.article_id
     WHERE ar.day = ?
     ORDER BY ar.score_overall DESC
     LIMIT 3`,
  ).all(day) as { comment: string; title_zh: string }[];

  const bestRow = db.prepare(
    `SELECT pa.title_zh FROM article_reviews ar JOIN published_articles pa ON pa.id = ar.article_id
     WHERE ar.day = ? ORDER BY ar.score_overall DESC LIMIT 1`,
  ).get(day) as { title_zh: string } | undefined;

  const worstRow = db.prepare(
    `SELECT pa.title_zh FROM article_reviews ar JOIN published_articles pa ON pa.id = ar.article_id
     WHERE ar.day = ? ORDER BY ar.score_overall ASC LIMIT 1`,
  ).get(day) as { title_zh: string } | undefined;

  const humanRows = db.prepare(
    `SELECT hc.author_name, hc.content, pa.title_zh
     FROM human_comments hc
     JOIN published_articles pa ON pa.id = hc.article_id
     WHERE hc.day = ?
     ORDER BY hc.created_at DESC
     LIMIT 5`,
  ).all(day) as { author_name: string; content: string; title_zh: string }[];

  return {
    avgOverall: Number((scoreRow.avg ?? 0).toFixed(1)),
    topComments: topReviews.map(r => r.comment),
    humanComments: humanRows.map(r => ({ articleTitle: r.title_zh, authorName: r.author_name, content: r.content })),
    bestArticleTitle: bestRow?.title_zh ?? "",
    worstArticleTitle: worstRow?.title_zh ?? "",
  };
}
