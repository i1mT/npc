import Link from "next/link";
import Image from "next/image";
import { listDays, listPublishedArticles, getDay } from "@/db/sim";
import { tagGradient } from "@/lib/cover";
import { dayToLongDate, dayToShortDate } from "@/lib/dates";
import type { PublishedArticle } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─── Cover image with gradient fallback ───────────────────────────────────────

function Cover({
  article, className, priority,
}: {
  article: Pick<PublishedArticle, "imageUrl" | "tags">;
  className?: string;
  priority?: boolean;
}) {
  if (article.imageUrl) {
    return (
      <div className={`relative overflow-hidden ${className ?? ""}`}>
        <Image
          src={article.imageUrl}
          alt=""
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 50vw"
          priority={priority}
          unoptimized
        />
      </div>
    );
  }
  return (
    <div
      className={className}
      style={{ background: tagGradient(article.tags) }}
      aria-hidden
    />
  );
}

// ─── Tag badge ────────────────────────────────────────────────────────────────

function TagBadge({ tag, light }: { tag: string; light?: boolean }) {
  return (
    <span className={`inline-block rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${light ? "bg-paper/15 text-paper/80" : "bg-ink/8 text-ink/55"}`}>
      {tag}
    </span>
  );
}

// ─── Hero article ─────────────────────────────────────────────────────────────

function HeroArticle({ article }: { article: PublishedArticle }) {
  return (
    <a href={`/articles/${article.id}`} className="group block">
      <div className="grid md:grid-cols-5 gap-0 overflow-hidden rounded-xl border border-rule">
        {/* Cover - 2/5 width on desktop */}
        <div className="md:col-span-2 relative">
          <Cover article={article} className="h-48 md:h-full min-h-[200px]" priority />
        </div>
        {/* Content - 3/5 width */}
        <div className="md:col-span-3 bg-white p-6 md:p-8 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {article.tags.slice(0, 3).map(t => <TagBadge key={t} tag={t} />)}
              <span className="ml-auto text-xs text-ink/35">质量 {article.qualityScore.toFixed(1)}</span>
            </div>
            <h2 className="font-serif text-2xl md:text-3xl leading-tight text-ink group-hover:text-cobalt transition-colors">
              {article.titleZh}
            </h2>
            <p className="mt-4 text-sm md:text-base leading-7 text-ink/65 line-clamp-3">
              {article.summaryZh}
            </p>
          </div>
          <div className="mt-6 flex items-center gap-2 text-xs text-ink/40">
            <span className="font-bold text-cobalt">阅读全文 →</span>
          </div>
        </div>
      </div>
    </a>
  );
}

// ─── Article card ─────────────────────────────────────────────────────────────

function ArticleCard({ article }: { article: PublishedArticle }) {
  return (
    <a href={`/articles/${article.id}`} className="group flex flex-col">
      <Cover article={article} className="h-40 rounded-t-lg relative" />
      <div className="flex flex-1 flex-col border border-t-0 border-rule rounded-b-lg bg-white p-4">
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {article.tags.slice(0, 2).map(t => <TagBadge key={t} tag={t} />)}
        </div>
        <h3 className="font-bold text-base leading-snug text-ink group-hover:text-cobalt transition-colors line-clamp-2">
          {article.titleZh}
        </h3>
        <p className="mt-2 text-xs leading-5 text-ink/55 line-clamp-3 flex-1">
          {article.summaryZh}
        </p>
        <div className="mt-3 flex items-center justify-between text-[10px] text-ink/35">
          <span>AGI DAILY 编辑部</span>
          <span className={`font-bold ${article.qualityScore >= 8 ? "text-mint" : article.qualityScore >= 7 ? "text-amber-600" : "text-ink/40"}`}>
            ★ {article.qualityScore.toFixed(1)}
          </span>
        </div>
      </div>
    </a>
  );
}

// ─── Day navigation ───────────────────────────────────────────────────────────

function DayNav({ days, currentDay }: { days: { day: number; articleCount?: number }[]; currentDay: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
      {days.map(d => (
        <Link
          key={d.day}
          href={`/?day=${d.day}`}
          className={`shrink-0 rounded px-3 py-1.5 text-xs font-bold transition-colors ${
            d.day === currentDay
              ? "bg-paper text-ink"
              : "text-paper/50 hover:text-paper/80"
          }`}
        >
          {d.day === days[0]?.day ? "最新" : dayToShortDate(d.day)}
        </Link>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const query = await searchParams;
  const days = listDays(); // DESC order
  const selectedDay = query.day ? Number(query.day) : (days[0]?.day ?? 1);
  const dayState = getDay(selectedDay);
  const articles: PublishedArticle[] = listPublishedArticles(selectedDay);

  const [hero, ...rest] = articles;

  return (
    <div className="min-h-screen bg-[#f5f3ee] text-ink">
      {/* ── Site header ── */}
      <header className="sticky top-0 z-50 bg-ink text-paper border-b border-paper/10">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-black text-xl tracking-[0.2em] text-signal uppercase">AGI Daily</span>
              <span className="text-paper/30 text-xs hidden sm:block">AI 行业资讯站</span>
            </Link>
            <div className="flex items-center gap-4">
              <DayNav days={days} currentDay={selectedDay} />
              <a href="/dashboard" className="hidden sm:block text-xs text-paper/35 hover:text-paper/70 transition-colors">
                后台 →
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* ── Issue banner ── */}
      <div className="bg-ink text-paper pb-8 pt-6">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-paper/35">
                {dayToLongDate(selectedDay)} · AI 行业日报
              </p>
              <h1 className="mt-2 font-serif text-4xl md:text-5xl text-paper leading-tight">
                今日 AGI 资讯
              </h1>
              {dayState?.editorNote && (
                <p className="mt-3 text-sm text-paper/55 italic max-w-xl leading-6">
                  {dayState.editorNote}
                </p>
              )}
            </div>
            <div className="hidden md:flex flex-col items-end gap-1 text-xs text-paper/35 pb-1">
              <span>共 {articles.length} 篇</span>
              {dayState && <span>DAU {dayState.dau.toLocaleString()}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        {!articles.length ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center text-ink/40">
            <p className="text-4xl">📰</p>
            <p className="text-base">第 {selectedDay} 期暂无已发布文章</p>
            <a href="/dashboard" className="text-sm text-cobalt hover:underline">进入后台运行模拟 →</a>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Hero */}
            {hero && (
              <section>
                <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.3em] text-ink/35">今日头条</p>
                <HeroArticle article={hero} />
              </section>
            )}

            {/* Grid */}
            {rest.length > 0 && (
              <section>
                <div className="mb-5 flex items-center gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/35">更多报道</p>
                  <div className="flex-1 border-t border-rule/60" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map(article => (
                    <ArticleCard key={article.id} article={article} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="mt-12 border-t border-rule py-8">
        <div className="mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink/35">
          <span className="font-bold uppercase tracking-widest text-ink/25">AGI Daily NPC</span>
          <span>内容由 AI Agent 团队自动生成 · 仅供模拟演示</span>
          <a href="/dashboard" className="hover:text-ink transition-colors">进入后台 →</a>
        </div>
      </footer>
    </div>
  );
}
