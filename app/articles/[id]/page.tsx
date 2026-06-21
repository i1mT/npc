import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { getArticle, getDay, listPublishedArticles } from "@/db/sim";
import { dbAll } from "@/db/connection";
import { listReviewsByArticle, listHumanCommentsByArticle } from "@/db/feedback";
import { CommentBox } from "@/components/comment-box";
import { tagAccent } from "@/lib/cover";
import { dayToLongDate, dayToShortDate } from "@/lib/dates";
import { LOGO_PATH, SITE_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const article = await getArticle(id);
  if (!article) return { title: "文章未找到" };
  return {
    title: article.titleZh,
    description: article.summaryZh,
    openGraph: {
      title: article.titleZh,
      description: article.summaryZh,
      siteName: SITE_NAME,
      images: [{ url: article.imageUrl || LOGO_PATH, alt: article.titleZh }],
      type: "article",
    },
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

type AdPlacement = { id: string; advertiser: string; slotId: string; revenue: number; reason: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getDayAds(day: number): Promise<AdPlacement[]> {
  const rows = await dbAll<{ id: string; advertiser: string; slot_id: string; revenue: number; payload: string }>(
    "SELECT id, advertiser, slot_id, revenue, payload FROM ad_placements WHERE day = ? ORDER BY revenue DESC LIMIT 3",
    day,
  );
  return rows.map(r => {
    const p = JSON.parse(r.payload) as { reason?: string };
    return { id: r.id, advertiser: r.advertiser, slotId: r.slot_id, revenue: r.revenue, reason: p.reason ?? "" };
  });
}

// ─── Score bar ───────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = (value / 10) * 100;
  const color = value >= 8 ? "#4fbf87" : value >= 6 ? "#d97706" : "#9ca3af";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink/40">{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{value.toFixed(1)}</span>
      </div>
      <div className="h-px bg-rule overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticle(id);
  if (!article) notFound();

  const dayState = await getDay(article.day);
  const displayDate = dayToLongDate(article.day);
  const siblings = (await listPublishedArticles(article.day)).filter(a => a.id !== article.id).slice(0, 5);
  const agentReviews = await listReviewsByArticle(id);
  const humanComments = await listHumanCommentsByArticle(id);
  const ads = await getDayAds(article.day);
  const accent = tagAccent(article.tags);

  const avgScores = agentReviews.length > 0 ? {
    info_density: agentReviews.reduce((s, r) => s + r.scoreInfo, 0) / agentReviews.length,
    readability:  agentReviews.reduce((s, r) => s + r.scoreRead, 0) / agentReviews.length,
    timeliness:   agentReviews.reduce((s, r) => s + r.scoreTimeliness, 0) / agentReviews.length,
    uniqueness:   agentReviews.reduce((s, r) => s + r.scoreUnique, 0) / agentReviews.length,
    ai_relevance: agentReviews.reduce((s, r) => s + r.scoreAiRel, 0) / agentReviews.length,
    overall:      agentReviews.reduce((s, r) => s + r.scoreOverall, 0) / agentReviews.length,
  } : null;

  const paragraphs = article.contentZh
    .replace(/([。！？])\s*/g, "$1\n")
    .split("\n")
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return (
    <div className="min-h-screen bg-paper text-ink font-sans">

      {/* ── Site nav ── */}
      <nav className="sticky top-0 z-50 bg-ink text-paper border-b border-paper/8">
        <div className="mx-auto max-w-[1200px] px-6 py-3 flex items-center justify-between">
          <BrandLogo
            href="/"
            imageClassName="h-7 w-7 rounded-sm"
            textClassName="font-serif text-lg text-paper"
            className="hover:text-paper/70 transition-colors"
          />
          <div className="flex items-center gap-6">
            <Link
              href={`/?day=${article.day}`}
              className="text-[9px] font-bold uppercase tracking-[0.3em] text-paper/35 hover:text-paper/70 transition-colors"
            >
              ← {dayToShortDate(article.day)} 期刊
            </Link>
            <a href="/dashboard" className="hidden sm:block text-[9px] font-bold uppercase tracking-[0.3em] text-paper/20 hover:text-paper/50 transition-colors">
              后台
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero image ── */}
      <div className="w-full">
        {article.imageUrl ? (
          <div className="relative h-64 md:h-[440px] w-full overflow-hidden">
            <Image
              src={article.imageUrl}
              alt={article.titleZh}
              fill
              className="object-cover grayscale"
              priority
              unoptimized
            />
          </div>
        ) : (
          <div className="h-32 md:h-48 bg-rule w-full" />
        )}
      </div>

      {/* ── Article header ── */}
      <div className="border-b-2 border-ink">
        <div className="mx-auto max-w-[1200px] px-6 py-8">
          {/* Tags + date */}
          <div className="flex flex-wrap items-center gap-4 mb-5">
            {article.tags.slice(0, 3).map(t => (
              <span
                key={t}
                className="text-[9px] font-bold uppercase tracking-[0.32em]"
                style={{ color: tagAccent([t]) }}
              >
                {t}
              </span>
            ))}
            <span className="ml-auto text-[9px] text-ink/30 font-bold uppercase tracking-[0.2em]">
              {displayDate}
            </span>
          </div>

          {/* Title */}
          <h1 className="font-serif text-4xl md:text-6xl leading-tight max-w-4xl">
            {article.titleZh}
          </h1>

          {/* Meta bar */}
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[9px] font-bold uppercase tracking-[0.2em] text-ink/35">
            <span>AGI Daily 编辑部</span>
            <span>·</span>
            <span>{displayDate}</span>
            {dayState && <><span>·</span><span>DAU {dayState.dau.toLocaleString()}</span></>}
            <span>·</span>
            <span>
              质量
              <span
                className="ml-1.5"
                style={{ color: article.qualityScore >= 8 ? "#4fbf87" : article.qualityScore >= 7 ? "#d97706" : "#9ca3af" }}
              >
                {article.qualityScore.toFixed(1)}
              </span>
              {" "}/ 10
            </span>
            {article.sourceUrl && (
              <>
                <span>·</span>
                <a
                  href={article.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cobalt hover:underline"
                >
                  查看原文 ↗
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Body + sidebar ── */}
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="grid lg:grid-cols-[1fr_300px] gap-14">

          {/* ── Main column ── */}
          <article>
            {/* Summary pull quote */}
            <p className="pull-quote text-base md:text-lg mb-8">{article.summaryZh}</p>

            {/* Body */}
            <div className="article-body space-y-5 mb-12">
              {paragraphs.map((para, i) => (
                <p key={i} className="text-[17px] leading-[1.9] text-ink/80">{para}</p>
              ))}
            </div>

            {/* Editor note */}
            {article.qualityReason && (
              <div className="mb-10 border-l-2 pl-5 py-1" style={{ borderColor: accent }}>
                <p className="text-[9px] font-bold uppercase tracking-[0.32em] text-ink/30 mb-2">编辑按语</p>
                <p className="text-sm leading-7 text-ink/55 italic">{article.qualityReason}</p>
              </div>
            )}

            {/* Attribution */}
            <div className="border-t-2 border-ink pt-6 mb-10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BrandLogo href="/" showText={false} imageClassName="h-8 w-8 rounded-sm" />
                <div>
                  <p className="text-[10px] font-bold text-ink/70 uppercase tracking-[0.2em]">AGI Daily 编辑部</p>
                  <p className="text-[9px] text-ink/30 mt-0.5">{displayDate} · AI Agent 团队加工整理</p>
                </div>
              </div>
              {article.sourceUrl && (
                <a
                  href={article.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-cobalt border border-cobalt/25 px-4 py-2 hover:bg-cobalt/5 transition-colors"
                >
                  原始来源 ↗
                </a>
              )}
            </div>

            {/* Agent reviews */}
            {avgScores && (
              <div className="mb-10 border border-rule bg-white p-6">
                <p className="section-label">读者 Agent 评分</p>
                <div className="grid grid-cols-2 gap-5 mb-6">
                  {([
                    ["信息密度", avgScores.info_density],
                    ["可读性",   avgScores.readability],
                    ["时效性",   avgScores.timeliness],
                    ["独特性",   avgScores.uniqueness],
                    ["AI 相关",  avgScores.ai_relevance],
                    ["整体满意", avgScores.overall],
                  ] as [string, number][]).map(([label, score]) => (
                    <ScoreBar key={label} label={label} value={score} />
                  ))}
                </div>
                {agentReviews.length > 0 && (
                  <div className="border-t border-rule pt-4 space-y-3">
                    {agentReviews.slice(0, 3).map((r, i) => (
                      <p key={i} className="text-xs leading-6 text-ink/50 italic border-l border-rule pl-3">
                        「{r.comment}」
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Comments */}
            <CommentBox articleId={article.id} initialComments={humanComments} />
          </article>

          {/* ── Sidebar ── */}
          <aside className="space-y-8 lg:border-l lg:border-rule lg:pl-10">

            {/* Related articles */}
            {siblings.length > 0 && (
              <div>
                <p className="section-label">本期其他报道</p>
                <div className="space-y-5">
                  {siblings.map((s, idx) => (
                    <Link
                      key={s.id}
                      href={`/articles/${s.id}`}
                      className="group flex gap-3 border-b border-rule/40 pb-5 last:border-0 last:pb-0"
                    >
                      <span className="shrink-0 text-[10px] text-ink/20 pt-0.5 tabular-nums w-4">{idx + 1}</span>
                      <div className="min-w-0">
                        <p
                          className="text-[9px] font-bold uppercase tracking-[0.25em] mb-1"
                          style={{ color: tagAccent(s.tags) }}
                        >
                          {s.tags[0]}
                        </p>
                        <p className="font-serif text-sm leading-snug text-ink group-hover:text-ink/55 transition-colors line-clamp-3">
                          {s.titleZh}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Day metrics */}
            {dayState && (
              <div>
                <p className="section-label">本期数据</p>
                <div className="space-y-3">
                  {[
                    { label: "日活读者", value: dayState.dau.toLocaleString() },
                    { label: "声誉指数", value: `${dayState.reputation.toFixed(1)} / 100` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-baseline border-b border-rule/40 pb-2.5 last:border-0 last:pb-0">
                      <span className="text-[9px] text-ink/35 uppercase tracking-[0.2em] font-bold">{label}</span>
                      <span className="font-serif text-sm">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sponsors */}
            {ads.length > 0 && (
              <div>
                <p className="section-label">本期赞助商</p>
                <div className="space-y-4">
                  {ads.map(ad => (
                    <div key={ad.id} className="border-b border-rule/40 pb-4 last:border-0 last:pb-0">
                      <p className="text-[10px] font-bold text-ink uppercase tracking-[0.15em]">{ad.advertiser}</p>
                      {ad.reason && <p className="text-[9px] text-ink/35 italic mt-0.5 leading-4">{ad.reason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t-2 border-ink mt-8 py-10 bg-ink">
        <div className="mx-auto max-w-[1200px] px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <BrandLogo
            href="/"
            imageClassName="h-8 w-8 rounded-sm"
            textClassName="font-serif text-xl text-paper/60"
            className="hover:text-paper transition-colors"
          />
          <span className="text-[9px] font-bold uppercase tracking-[0.35em] text-paper/20">
            内容由 AI Agent 团队自动生成 · 仅供模拟演示
          </span>
          <Link href="/dashboard" className="text-[9px] font-bold uppercase tracking-[0.3em] text-paper/25 hover:text-paper/60 transition-colors">
            进入后台 →
          </Link>
        </div>
      </footer>
    </div>
  );
}
