import Link from "next/link";
import Image from "next/image";
import { listDays, listPublishedArticles, getDay } from "@/db/sim";
import { getSimDb } from "@/db/connection";
import { tagGradient, tagAccent } from "@/lib/cover";
import { dayToLongDate, dayToShortDate } from "@/lib/dates";
import type { PublishedArticle } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────

type AdPlacement = { id: string; advertiser: string; slotId: string; revenue: number; reason: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDayAds(day: number): AdPlacement[] {
  const db = getSimDb();
  const rows = db
    .prepare("SELECT id, advertiser, slot_id, revenue, payload FROM ad_placements WHERE day = ? ORDER BY revenue DESC")
    .all(day) as { id: string; advertiser: string; slot_id: string; revenue: number; payload: string }[];
  return rows.map(r => {
    const p = JSON.parse(r.payload) as { reason?: string };
    return { id: r.id, advertiser: r.advertiser, slotId: r.slot_id, revenue: r.revenue, reason: p.reason ?? "" };
  });
}

function groupByTag(articles: PublishedArticle[]): { tag: string; items: PublishedArticle[] }[] {
  const map = new Map<string, PublishedArticle[]>();
  for (const a of articles) {
    const tag = a.tags[0] ?? "其他";
    if (!map.has(tag)) map.set(tag, []);
    map.get(tag)!.push(a);
  }
  return Array.from(map.entries())
    .map(([tag, items]) => ({ tag, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

// ─── Cover ───────────────────────────────────────────────────────────────────

function Cover({ article, className, priority }: { article: Pick<PublishedArticle, "imageUrl" | "tags">; className?: string; priority?: boolean }) {
  if (article.imageUrl) {
    return (
      <div className={`relative overflow-hidden ${className ?? ""}`}>
        <Image src={article.imageUrl} alt="" fill className="object-cover" sizes="(max-width:768px) 100vw,50vw" priority={priority} unoptimized />
      </div>
    );
  }
  return <div className={className} style={{ background: tagGradient(article.tags) }} aria-hidden />;
}

// ─── Quality dot ─────────────────────────────────────────────────────────────

function QDot({ score }: { score: number }) {
  const cls = score >= 8 ? "quality-dot-high" : score >= 7 ? "quality-dot-mid" : "quality-dot-low";
  return <span className={`quality-dot ${cls} text-[10px] font-bold text-ink/40`}>{score.toFixed(1)}</span>;
}

// ─── Tag badge ────────────────────────────────────────────────────────────────

function Tag({ tag, light }: { tag: string; light?: boolean }) {
  const accent = tagAccent([tag]);
  return (
    <span
      className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={light
        ? { color: "rgba(245,243,238,0.7)", borderBottom: `1px solid rgba(245,243,238,0.25)` }
        : { color: accent, borderBottom: `1px solid ${accent}40` }}
    >
      {tag}
    </span>
  );
}

// ─── Hero (full-width top story) ──────────────────────────────────────────────

function Hero({ article }: { article: PublishedArticle }) {
  return (
    <a href={`/articles/${article.id}`} className="group block">
      <div className="grid lg:grid-cols-12 gap-0 border-b-2 border-ink pb-6 mb-6">
        {/* Cover 7/12 */}
        <div className="lg:col-span-7 relative overflow-hidden" style={{ aspectRatio: "16/9" }}>
          <Cover article={article} className="absolute inset-0 w-full h-full" priority />
          {/* Accent line at bottom of image */}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
        </div>
        {/* Content 5/12 */}
        <div className="lg:col-span-5 lg:pl-8 pt-4 lg:pt-0 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              {article.tags.slice(0, 3).map(t => <Tag key={t} tag={t} />)}
            </div>
            <h2 className="journal-masthead text-2xl md:text-3xl lg:text-4xl leading-tight text-ink group-hover:text-cobalt transition-colors">
              {article.titleZh}
            </h2>
            <p className="mt-4 text-sm md:text-base leading-7 text-ink/65 line-clamp-4 font-sans">
              {article.summaryZh}
            </p>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="text-[11px] text-ink/40 font-bold uppercase tracking-wider">AGI Daily 编辑部</span>
            <QDot score={article.qualityScore} />
          </div>
        </div>
      </div>
    </a>
  );
}

// ─── Secondary story (horizontal compact) ─────────────────────────────────────

function SecondaryCard({ article }: { article: PublishedArticle }) {
  return (
    <a href={`/articles/${article.id}`} className="group flex gap-4 border-b border-rule pb-4 mb-4 last:border-0 last:pb-0 last:mb-0">
      <div className="relative w-20 h-20 shrink-0 overflow-hidden">
        <Cover article={article} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex gap-2 mb-1">
          {article.tags.slice(0, 1).map(t => <Tag key={t} tag={t} />)}
        </div>
        <h3 className="font-serif font-bold text-sm leading-snug text-ink group-hover:text-cobalt transition-colors line-clamp-2">
          {article.titleZh}
        </h3>
        <p className="mt-1 text-xs text-ink/45 line-clamp-2 leading-5">{article.summaryZh}</p>
      </div>
    </a>
  );
}

// ─── Grid card ────────────────────────────────────────────────────────────────

function GridCard({ article }: { article: PublishedArticle }) {
  return (
    <a href={`/articles/${article.id}`} className="group flex flex-col border-b border-rule pb-5">
      <div className="relative overflow-hidden mb-3" style={{ aspectRatio: "4/3" }}>
        <Cover article={article} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="flex gap-2 mb-2">
        {article.tags.slice(0, 2).map(t => <Tag key={t} tag={t} />)}
      </div>
      <h3 className="font-serif font-bold text-base leading-snug text-ink group-hover:text-cobalt transition-colors line-clamp-3">
        {article.titleZh}
      </h3>
      <p className="mt-2 text-xs leading-5 text-ink/50 line-clamp-2 flex-1">{article.summaryZh}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-ink/30 uppercase tracking-wider font-bold">编辑部</span>
        <QDot score={article.qualityScore} />
      </div>
    </a>
  );
}

// ─── Sidebar sponsor block ────────────────────────────────────────────────────

function SponsorBlock({ ads }: { ads: AdPlacement[] }) {
  return (
    <div className="border border-rule p-4 bg-white">
      <span className="section-label">合作伙伴</span>
      {ads.length === 0 ? (
        <p className="text-xs text-ink/35 italic leading-5">AGI Daily 广告位开放申请中，联系编辑部了解详情。</p>
      ) : (
        <div className="space-y-3">
          {ads.slice(0, 3).map(ad => (
            <div key={ad.id} className="border-b border-rule/50 pb-3 last:border-0 last:pb-0">
              <p className="text-[11px] font-black text-ink uppercase tracking-wide">{ad.advertiser}</p>
              {ad.reason && <p className="text-[10px] text-ink/50 leading-4 mt-0.5 italic">{ad.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar metrics ─────────────────────────────────────────────────────────

function MetricsBlock({ dau, reputation, subscribers }: { dau: number; reputation: number; subscribers: number }) {
  return (
    <div className="border border-rule p-4 bg-white">
      <span className="section-label">今日数据</span>
      <div className="space-y-3">
        {[
          { label: "日活读者", value: dau.toLocaleString() },
          { label: "声誉指数", value: `${reputation.toFixed(1)} / 100` },
          { label: "订阅用户", value: subscribers.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between items-baseline border-b border-rule/40 pb-2 last:border-0 last:pb-0">
            <span className="text-[10px] text-ink/45 uppercase tracking-wide font-bold">{label}</span>
            <span className="font-serif font-black text-sm text-ink">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Day navigation ───────────────────────────────────────────────────────────

function DayNav({ days, currentDay }: { days: { day: number }[]; currentDay: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {days.slice(0, 8).map(d => (
        <Link
          key={d.day}
          href={`/?day=${d.day}`}
          className={`shrink-0 px-3 py-1.5 text-[11px] font-bold transition-colors border-b-2 ${
            d.day === currentDay
              ? "border-signal text-paper"
              : "border-transparent text-paper/40 hover:text-paper/70"
          }`}
        >
          {d.day === days[0]?.day ? "最新" : dayToShortDate(d.day)}
        </Link>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function Page({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const query = await searchParams;
  const days = listDays();
  const selectedDay = query.day ? Number(query.day) : (days[0]?.day ?? 1);
  const dayState = getDay(selectedDay);
  const articles: PublishedArticle[] = listPublishedArticles(selectedDay);
  const ads = getDayAds(selectedDay);

  const [hero, second, third, ...rest] = articles;
  const tagGroups = groupByTag(rest.slice(2));

  // Category labels for nav (extracted from articles)
  const allTags = [...new Set(articles.flatMap(a => a.tags))].slice(0, 6);

  return (
    <div className="min-h-screen bg-paper text-ink font-sans">

      {/* ── Masthead ── */}
      <header className="bg-midnight text-paper">
        <div className="mx-auto max-w-7xl px-4">
          {/* Top strip */}
          <div className="flex items-center justify-between border-b border-paper/10 py-1.5">
            <p className="text-[10px] text-paper/35 font-bold uppercase tracking-widest hidden sm:block">
              {dayToLongDate(selectedDay)} · 第 {selectedDay} 期
            </p>
            <div className="flex items-center gap-4">
              <DayNav days={days} currentDay={selectedDay} />
              <a href="/dashboard" className="hidden sm:block text-[10px] text-paper/30 hover:text-paper/60 transition-colors uppercase tracking-widest font-bold">后台</a>
            </div>
          </div>
          {/* Main masthead */}
          <div className="py-5 md:py-7 text-center border-b border-paper/10">
            <Link href="/" className="inline-block">
              <h1 className="journal-masthead text-5xl md:text-7xl text-paper tracking-tight">AGI Daily</h1>
            </Link>
            <p className="mt-1 text-[11px] text-paper/35 font-bold uppercase tracking-[0.4em]">人工智能行业深度资讯</p>
          </div>
          {/* Category nav */}
          {allTags.length > 0 && (
            <nav className="flex items-center justify-center gap-6 py-2 overflow-x-auto">
              {allTags.map(tag => (
                <span key={tag} className="shrink-0 text-[11px] font-bold text-paper/50 hover:text-paper/80 cursor-default uppercase tracking-wider transition-colors">
                  {tag}
                </span>
              ))}
            </nav>
          )}
        </div>
      </header>

      {/* ── Editor note banner ── */}
      {dayState?.editorNote && (
        <div className="bg-cobalt/5 border-b border-cobalt/15 py-2.5">
          <div className="mx-auto max-w-7xl px-4">
            <p className="text-[11px] text-cobalt/80 italic leading-5">
              <span className="font-black text-cobalt not-italic mr-2">编辑按语</span>
              {dayState.editorNote}
            </p>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        {!articles.length ? (
          <div className="flex flex-col items-center gap-4 py-24 text-center text-ink/40">
            <p className="journal-masthead text-6xl text-ink/10">AGI Daily</p>
            <p className="text-base">第 {selectedDay} 期暂无已发布文章</p>
            <a href="/dashboard" className="text-sm text-cobalt hover:underline">进入后台运行模拟 →</a>
          </div>
        ) : (
          <div className="grid lg:grid-cols-12 gap-8">

            {/* ── Left: main stories ── */}
            <div className="lg:col-span-8">

              {/* Top: hero + secondaries */}
              <div className="grid md:grid-cols-12 gap-8 mb-10">
                {/* Hero */}
                <div className="md:col-span-8">
                  <span className="section-label">今日头条</span>
                  {hero && <Hero article={hero} />}
                </div>
                {/* Secondary stack */}
                {(second || third) && (
                  <div className="md:col-span-4">
                    <span className="section-label">深度报道</span>
                    {second && <SecondaryCard article={second} />}
                    {third  && <SecondaryCard article={third} />}
                  </div>
                )}
              </div>

              {/* Tag-grouped sections */}
              {tagGroups.map(({ tag, items }) => (
                <section key={tag} className="mb-10">
                  <span className="section-label">{tag}</span>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {items.map(a => <GridCard key={a.id} article={a} />)}
                  </div>
                </section>
              ))}

              {/* Remaining ungrouped articles */}
              {rest.slice(tagGroups.reduce((s, g) => s + g.items.length, 0)).map(a => (
                <div key={a.id} className="mb-4 border-b border-rule pb-4">
                  <div className="flex gap-2 mb-1">{a.tags.slice(0, 1).map(t => <Tag key={t} tag={t} />)}</div>
                  <a href={`/articles/${a.id}`} className="group">
                    <h3 className="font-serif font-bold text-base text-ink group-hover:text-cobalt transition-colors">{a.titleZh}</h3>
                  </a>
                </div>
              ))}
            </div>

            {/* ── Right: sidebar ── */}
            <aside className="lg:col-span-4 space-y-6">
              {dayState && (
                <MetricsBlock dau={dayState.dau} reputation={dayState.reputation} subscribers={dayState.subscribers} />
              )}
              <SponsorBlock ads={ads} />

              {/* About */}
              <div className="border border-rule p-4 bg-white">
                <span className="section-label">关于本刊</span>
                <p className="text-xs text-ink/55 leading-5">
                  AGI Daily 由 AI Agent 团队驱动，每日自动采集、编辑、发布 AI 行业深度资讯。读者评分系统由独立读者 Agent 提供支持。
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t-2 border-ink mt-12 py-8 bg-midnight">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="journal-masthead text-2xl text-paper/70">AGI Daily</span>
          <span className="text-[10px] text-paper/30 uppercase tracking-widest font-bold">内容由 AI Agent 团队自动生成 · 仅供模拟演示</span>
          <a href="/dashboard" className="text-[10px] text-paper/30 hover:text-paper/60 transition-colors uppercase tracking-widest font-bold">进入后台 →</a>
        </div>
      </footer>
    </div>
  );
}
