import { getArticleDb } from "@/db/connection";
import { articleSourceDate } from "@/lib/dates";
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

// Skip list for bad image URLs (icons, social buttons, pixel trackers etc.)
const IMG_SKIP = ["twitter", "facebook", "pixel", "1x1", "icon", "favicon", "badge", "share", "avatar", "logo"];
// Reddit thumbnail params that indicate a tiny image — prefer width=640+
const SMALL_THUMB = ["width=140", "width=120", "height=140", "crop=1:1"];

function extractCoverImage(html: string | null, markdown: string | null): string | null {
  // Try markdown images first: ![alt](url)
  if (markdown) {
    const mdMatch = markdown.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) return mdMatch[1];
  }

  if (!html) return null;

  // Extract all img src values from HTML
  const imgRe = /src=["']([^"']+(?:jpe?g|png|webp|gif)[^"']*?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const raw = m[1].replace(/&amp;/g, "&");
    if (!raw.startsWith("http")) continue;
    if (IMG_SKIP.some(s => raw.toLowerCase().includes(s))) continue;
    if (SMALL_THUMB.some(s => raw.includes(s))) continue;
    return raw;
  }

  // Second pass — allow small thumbnails if nothing better found
  const imgRe2 = /src=["']([^"']+(?:jpe?g|png|webp|gif)[^"']*?)["']/gi;
  while ((m = imgRe2.exec(html)) !== null) {
    const raw = m[1].replace(/&amp;/g, "&");
    if (!raw.startsWith("http")) continue;
    if (IMG_SKIP.some(s => raw.toLowerCase().includes(s))) continue;
    return raw;
  }

  return null;
}

/**
 * Query candidate articles from agidaily.db.
 * Uses the calendar date of the previous day relative to the simulation day,
 * so Day 1 (2026-06-01) pulls items published on 2026-05-31.
 */
export function queryArticles(options: { day: number; limit?: number; usedSourceIds?: string[] }) {
  const db = getArticleDb();
  const limit = options.limit ?? 30;
  const sourceDate = articleSourceDate(options.day); // e.g. "2026-05-31"
  const blocked = new Set(options.usedSourceIds ?? []);

  const rows = db
    .prepare(
      `SELECT id, url, source_url, title, summary, content, image_url, cover_img, tags, pub_date, translations
       FROM items
       WHERE source_url IS NOT NULL
         AND COALESCE(title, '') <> ''
         AND COALESCE(summary, content, '') <> ''
         AND LENGTH(COALESCE(summary, content, '')) > 60
         AND DATE(pub_date) = ?
       ORDER BY COALESCE(pub_date, fetched_at) DESC
       LIMIT ?`,
    )
    .all(sourceDate, limit + blocked.size + 20) as ArticleRow[];

  return rows
    .filter((row) => !blocked.has(row.id))
    .filter((row) => {
      const text = `${row.title ?? ""} ${row.summary ?? ""} ${row.content ?? ""}`.replace(/<[^>]+>/g, " ").trim();
      return text.length > 80 && !/^comments$/i.test(text);
    })
    .slice(0, limit)
    .map<ArticleSource>((row) => {
      const localized = extractLocalized(row);
      // Use dedicated image columns first, then extract from content HTML/markdown
      const imageUrl =
        row.cover_img ||
        row.image_url ||
        extractCoverImage(row.content, (localized.translations?.["zh-CN"] as Record<string,unknown> | undefined)?.content as string | null ?? null);
      return {
        id: row.id,
        sourceUrl: row.url || row.source_url,
        title: localized.title,
        summary: localized.summary,
        content: localized.content,
        imageUrl: imageUrl ?? null,
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
