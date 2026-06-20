import { getArticleDb } from "@/db/connection";
import type { ArticleSource } from "@/lib/types";

type ArticleRow = {
  id: string;
  url: string;
  source_url: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  image_url: string | null;
  cover_img: string | null;
  tags: string | null;
  pub_date: string | null;
  translations: string | null;
};

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeTags(value: string | null) {
  const parsed = safeJson<unknown>(value, []);
  if (Array.isArray(parsed)) return parsed.map(String).slice(0, 6);
  if (typeof parsed === "string") return parsed.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 6);
  return [];
}

function extractLocalized(row: ArticleRow) {
  const translations = safeJson<Record<string, unknown> | null>(row.translations, null);
  const zh = translations?.["zh-CN"];
  if (zh && typeof zh === "object") {
    const data = zh as Record<string, unknown>;
    return {
      title: typeof data.title === "string" ? data.title : row.title || "未命名文章",
      summary: typeof data.summary === "string" ? data.summary : row.summary || "",
      content: typeof data.content === "string" ? data.content : row.content || row.summary || "",
      translations,
    };
  }
  return {
    title: row.title || "未命名文章",
    summary: row.summary || "",
    content: row.content || row.summary || "",
    translations,
  };
}

export function queryArticles(options: { day: number; limit?: number; usedSourceIds?: string[] }) {
  const db = getArticleDb();
  const limit = options.limit ?? 30;
  const offset = Math.max(0, (options.day - 1) * 15);
  const blocked = new Set(options.usedSourceIds ?? []);
  const rows = db
    .prepare(
      `SELECT id, url, source_url, title, summary, content, image_url, cover_img, tags, pub_date, translations
       FROM items
       WHERE source_url IS NOT NULL
         AND COALESCE(title, '') <> ''
         AND COALESCE(summary, content, '') <> ''
         AND LENGTH(COALESCE(summary, content, '')) > 60
       ORDER BY COALESCE(pub_date, fetched_at) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit + blocked.size + 20, offset) as ArticleRow[];

  return rows
    .filter((row) => !blocked.has(row.id))
    .filter((row) => {
      const text = `${row.title ?? ""} ${row.summary ?? ""} ${row.content ?? ""}`.replace(/<[^>]+>/g, " ").trim();
      return text.length > 80 && !/^comments$/i.test(text);
    })
    .slice(0, limit)
    .map<ArticleSource>((row) => {
      const localized = extractLocalized(row);
      return {
        id: row.id,
        sourceUrl: row.url || row.source_url,
        title: localized.title,
        summary: localized.summary,
        content: localized.content,
        imageUrl: row.cover_img || row.image_url,
        tags: normalizeTags(row.tags),
        pubDate: row.pub_date,
        translations: localized.translations,
      };
    });
}

export function countSourceArticles() {
  const db = getArticleDb();
  return (db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number }).count;
}
