import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getArticle, getDay, listPublishedArticles } from "@/db/sim";
import { getSimDb } from "@/db/connection";
import { listReviewsByArticle, listHumanCommentsByArticle } from "@/db/feedback";
import { CommentBox } from "@/components/comment-box";
import { tagGradient, tagAccent } from "@/lib/cover";
import { dayToLongDate, dayToShortDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────

type AdPlacement = { id: string; advertiser: string; slotId: string; revenue: number; reason: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDayAds(day: number): AdPlacement[] {
  const db = getSimDb();
  const rows = db
    .prepare("SELECT id, advertiser, slot_id, revenue, payload FROM ad_placements WHERE day = ? ORDER BY revenue DESC LIMIT 3")
    .all(day) as { id: string; advertiser: string; slot_id: string; revenue: number; payload: string }[];
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
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-ink/50">{label}</span>
        <span className="text-xs font-black" style={{ color }}>{value.toFixed(1)}</span>
      </div>
      <div className="h-1 bg-rule rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = getArticle(id);
  if (!article) notFound();

  const dayState = getDay(article.day);
  const displayDate = dayToLongDate(article.day);
  const siblings = listPublishedArticles(article.day).filter(a => a.id !== article.id).slice(0, 4);
  const agentReviews = listReviewsByArticle(id);
  const humanComments = listHumanCommentsByArticle(id);
  const ads = getDayAds(article.day);
  const accent = tagAccent(article.tags);

  const avgScores = agentReviews.length > 0 ? {
    info_density: agentReviews.reduce((s, r) => s + r.scoreInfo, 0) / agentReviews.length,
    readability:  agentReviews.reduce((s, r) => s + r.scoreRead, 0) / agentReviews.length,
    timeliness:   agentReviews.reduce((s, r) => s + r.scoreTimeliness, 0) / agentReviews.length,
    uniqueness:   agentReviews.reduce((s, r) => s + r.scoreUnique, 0) / agentReviews.length,
    ai_relevance: agentReviews.reduce((s, r) => s + r.scoreAiRel, 0) / agentReviews.length,
    overall:      agentReviews.reduce((s, r) => s + r.scoreOverall, 0) / agentReviews.length,
  } : null;

  // Split body into paragraphs
  const paragraphs = article.contentZh
    .replace(/([。！？])\s*/g, "$1\n")
    .split("\n")
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return (
    <div className="min-h-screen bg-paper text-ink font-sans">

      {/* ── Site nav ── */}
      <header className="sticky top-0 z-50 bg-midnight text-paper border-b border-paper/10">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Link href="/" className="journal-masthead text-xl text-paper hover:text-signal transition-colors">AGI Daily</Link>
          <div className="flex items-center gap-4">
            <Link href={`/?day=${article.day}`} className="text-[11px] text-paper/45 hover:text-paper/80 transition-colors uppercase tracking-widest font-bold">
              ← {dayToShortDate(article.day)} 期刊
            </Link>
            <a href="/dashboard" className="hidden sm:block text-[11px] text-paper/30 hover:text-paper/60 transition-colors uppercase tracking-widest font-bold">后台</a>
          </div>
        </div>
      </header>

      {/* ── Cover hero ── */}
      <div className="relative">
        {article.imageUrl ? (
          <div className="relative h-64 md:h-[420px] w-full">
            <Image src={article.imageUrl} alt={article.titleZh} fill className="object-cover" priority unoptimized />
            <div className="absolute inset-0 bg-gradient-to-t from-midnight/90 via-midnight/40 to-transparent" />
          </div>
        ) : (
          <div className="relative h-64 md:h-[420px]" style={{ background: tagGradient(article.tags) }}>
            <div className="absolute inset-0 bg-gradient-to-t from-midnight/90 via-midnight/30 to-transparent" />
          </div>
        )}

        {/* Accent line */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: accent }} />

        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 pb-8 md:pb-12">
          <div className="mx-auto max-w-4xl px-4">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {article.tags.map(t => (
                <span key={t} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-paper/75 backdrop-blur-sm"
                  style={{ borderBottom: `1px solid ${tagAccent([t])}60` }}>
                  {t}
                </span>
              ))}
              <span className="ml-auto text-[10px] text-paper/40 font-bold uppercase tracking-wider">{displayDate}</span>
            </div>
            <h1 className="journal-masthead text-3xl md:text-5xl leading-tight text-paper max-w-3xl">
              {article.titleZh}
            </h1>
          </div>
        </div>
      </div>

      {/* ── Article body + sidebar ── */}
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid lg:grid-cols-12 gap-10">

          {/* ── Main column ── */}
          <article className="lg:col-span-8">

            {/* Summary lead */}
            <p className="pull-quote text-base md:text-lg mb-8">
              {article.summaryZh}
            </p>

            {/* Meta bar */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/40 mb-8 pb-6 border-b-2 border-ink">
              <span className="font-black text-ink/70 uppercase tracking-wide">AGI Daily 编辑部</span>
              <span>·</span>
              <span>{displayDate}</span>
              {dayState && <><span>·</span><span>DAU {dayState.dau.toLocaleString()}</span></>}
              <span>·</span>
              <span>
                质量评分
                <span className={`ml-1 font-black ${article.qualityScore >= 8 ? "text-mint" : article.qualityScore >= 7 ? "text-amber-600" : "text-ink/40"}`}>
                  {article.qualityScore.toFixed(1)}
                </span>
                {" "}/ 10
              </span>
              {article.sourceUrl && (
                <>
                  <span>·</span>
                  <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer"
                    className="font-bold text-cobalt hover:underline">查看原文 ↗</a>
                </>
              )}
            </div>

            {/* Body */}
            <div className="article-body space-y-5 mb-10">
              {paragraphs.map((para, i) => (
                <p key={i} className="text-[17px] leading-[1.9] text-ink/85">{para}</p>
              ))}
            </div>

            {/* Editor note */}
            {article.qualityReason && (
              <div className="mb-8 border-l-4 pl-5 py-2" style={{ borderColor: accent }}>
                <p className="text-[10px] font-black uppercase tracking-widest text-ink/35 mb-2">编辑按语</p>
                <p className="text-sm leading-7 text-ink/65 italic">{article.qualityReason}</p>
              </div>
            )}

            {/* Attribution */}
            <div className="border-t-2 border-ink pt-5 mb-10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-midnight flex items-center justify-center">
                  <span className="text-paper text-xs font-black">A</span>
                </div>
                <div>
                  <p className="text-xs font-black text-ink/80 uppercase tracking-wide">AGI Daily 编辑部</p>
                  <p className="text-[10px] text-ink/35">{displayDate} · AI Agent 团队加工整理</p>
                </div>
              </div>
              {article.sourceUrl && (
                <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-bold text-cobalt border border-cobalt/30 px-3 py-1.5 hover:bg-cobalt/5 transition-colors uppercase tracking-wider">
                  原始来源 ↗
                </a>
              )}
            </div>

            {/* AI Reader Reviews */}
            {avgScores && (
              <div className="mb-10 border border-rule bg-white p-6">
                <span className="section-label">读者 Agent 评分</span>
                <div className="grid grid-cols-2 gap-4 mb-5">
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
                  <div className="border-t border-rule pt-4 space-y-2">
                    {agentReviews.slice(0, 3).map((r, i) => (
                      <p key={i} className="text-xs leading-6 text-ink/60 italic border-l-2 border-rule pl-3">
                        「{r.comment}」
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Human Comments */}
            <CommentBox articleId={article.id} initialComments={humanComments} />
          </article>

          {/* ── Sidebar ── */}
          <aside className="lg:col-span-4 space-y-6">

            {/* Suggested reading */}
            {siblings.length > 0 && (
              <div className="border border-rule bg-white p-5">
                <span className="section-label">本期其他报道</span>
                <div className="space-y-4">
                  {siblings.map(s => (
                    <Link key={s.id} href={`/articles/${s.id}`}
                      className="group flex gap-3 border-b border-rule/50 pb-4 last:border-0 last:pb-0">
                      <div className="relative w-16 h-16 shrink-0 overflow-hidden">
                        {s.imageUrl ? (
                          <Image src={s.imageUrl} alt="" fill className="object-cover" unoptimized />
                        ) : (
                          <div className="w-full h-full" style={{ background: tagGradient(s.tags) }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide mb-1"
                          style={{ color: tagAccent(s.tags) }}>{s.tags[0]}</p>
                        <p className="font-serif font-bold text-xs leading-snug text-ink group-hover:text-cobalt transition-colors line-clamp-3">
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
              <div className="border border-rule bg-white p-5">
                <span className="section-label">本期数据</span>
                <div className="space-y-3">
                  {[
                    { label: "日活读者", value: dayState.dau.toLocaleString() },
                    { label: "声誉指数", value: `${dayState.reputation.toFixed(1)} / 100` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-baseline border-b border-rule/40 pb-2 last:border-0 last:pb-0">
                      <span className="text-[10px] text-ink/45 uppercase tracking-wide font-bold">{label}</span>
                      <span className="font-serif font-black text-sm">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sponsors */}
            {ads.length > 0 && (
              <div className="border border-rule bg-white p-5">
                <span className="section-label">本期赞助商</span>
                <div className="space-y-3">
                  {ads.map(ad => (
                    <div key={ad.id} className="border-b border-rule/40 pb-3 last:border-0 last:pb-0">
                      <p className="text-[11px] font-black text-ink uppercase tracking-wide">{ad.advertiser}</p>
                      {ad.reason && <p className="text-[10px] text-ink/45 italic mt-0.5 leading-4">{ad.reason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t-2 border-ink mt-8 py-8 bg-midnight">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link href="/" className="journal-masthead text-xl text-paper/60 hover:text-paper transition-colors">AGI Daily</Link>
          <span className="text-[10px] text-paper/25 uppercase tracking-widest font-bold">内容由 AI Agent 团队自动生成 · 仅供模拟演示</span>
          <Link href="/dashboard" className="text-[10px] text-paper/30 hover:text-paper/60 transition-colors uppercase tracking-widest font-bold">进入后台 →</Link>
        </div>
      </footer>
    </div>
  );
}
