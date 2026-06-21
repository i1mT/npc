import Link from "next/link";
import Image from "next/image";
import { listDays, listPublishedArticles, getDay } from "@/db/sim";
import type { PublishedArticle } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─── Category tabs ────────────────────────────────────────────────────────────

const CATS = ["全部", "算力", "算法", "数据", "人物", "日报"] as const;
type Cat = (typeof CATS)[number];

function matchCat(a: PublishedArticle, cat: Cat) {
  if (cat === "全部" || cat === "日报") return true;
  return a.tags.some(t => t.includes(cat) || cat.includes(t));
}

// ─── Bento card ───────────────────────────────────────────────────────────────

function BentoCard({
  article,
  large,
  className = "",
}: {
  article: PublishedArticle;
  large?: boolean;
  className?: string;
}) {
  return (
    <a
      href={`/articles/${article.id}`}
      className={`group relative overflow-hidden bg-neutral-800 block ${className}`}
    >
      {article.imageUrl && (
        <Image
          src={article.imageUrl}
          alt=""
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          unoptimized
          priority={large}
        />
      )}
      {/* Dark gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      {/* Category badge */}
      <span className="absolute top-3 left-3 text-[11px] font-medium text-white/70">
        {article.tags[0] ?? "AI"}
      </span>
      {/* Title */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h2
          className={`text-white font-bold leading-snug group-hover:text-white/80 transition-colors ${
            large ? "text-lg md:text-2xl line-clamp-4" : "text-sm md:text-base line-clamp-3"
          }`}
        >
          {article.titleZh}
        </h2>
      </div>
    </a>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────

function RecommendCard({ article }: { article: PublishedArticle }) {
  return (
    <a href={`/articles/${article.id}`} className="group flex gap-3">
      <div className="relative w-24 h-16 shrink-0 overflow-hidden bg-rule">
        {article.imageUrl && (
          <Image
            src={article.imageUrl}
            alt=""
            fill
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug text-ink group-hover:text-ink/55 transition-colors line-clamp-2">
          {article.titleZh}
        </p>
        <p className="mt-1.5 text-[11px] text-ink/35">
          {article.tags[0] ?? "AI"} · 今天
        </p>
      </div>
    </a>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; cat?: string }>;
}) {
  const query = await searchParams;
  const days = await listDays();
  const selectedDay = query.day ? Number(query.day) : (days[0]?.day ?? 1);
  const selectedCat = (query.cat as Cat) ?? "全部";
  const dayState = await getDay(selectedDay);

  const allArticles: PublishedArticle[] = await listPublishedArticles(selectedDay);
  const articles =
    selectedCat === "全部" || selectedCat === "日报"
      ? allArticles
      : allArticles.filter(a => matchCat(a, selectedCat));

  const bentoArticles = articles.slice(0, 5);
  // Feature: first article not in bento, fallback to first
  const featureArticle = articles.length > 5 ? articles[5] : (articles[1] ?? articles[0]);
  const sidebarArticles = articles
    .filter(a => a.id !== featureArticle?.id)
    .slice(1, 6);

  function tabHref(cat: Cat) {
    const p = new URLSearchParams();
    if (query.day) p.set("day", query.day);
    if (cat !== "全部") p.set("cat", cat);
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  }

  return (
    <div className="min-h-screen bg-white text-ink font-sans">

      {/* ── Header ── */}
      <header className="border-b border-rule">
        <div className="mx-auto max-w-[1200px] px-6">

          {/* Masthead */}
          <div className="text-center py-6">
            <Link href="/" className="inline-block">
              <h1 className="font-serif text-[42px] md:text-[52px] font-bold leading-none tracking-tight">
                AGI Daily
              </h1>
            </Link>
            <p className="mt-1.5 text-sm text-ink/45">跟踪世界 AGI 进展</p>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.45em] text-ink/22">
              AGI Intelligence · Daily
            </p>
          </div>

          {/* Category tabs */}
          <nav className="flex items-center justify-center">
            {CATS.map(cat => (
              <Link
                key={cat}
                href={tabHref(cat)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  cat === selectedCat
                    ? "border-accent text-ink"
                    : "border-transparent text-ink/38 hover:text-ink/70"
                }`}
              >
                {cat}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="mx-auto max-w-[1200px] px-6 py-6">

        {!articles.length ? (
          <div className="flex flex-col items-center gap-4 py-24 text-center text-ink/30">
            <p className="text-base">第 {selectedDay} 期暂无已发布文章</p>
            <a href="/dashboard" className="text-sm text-cobalt hover:underline">
              进入后台运行模拟 →
            </a>
          </div>
        ) : (
          <>
            {/* ── Bento hero grid ── */}
            {bentoArticles.length > 0 && (
              <div
                className="grid gap-[3px] mb-10"
                style={{
                  gridTemplateColumns: "1.65fr 1fr 1fr",
                  gridTemplateRows: "148px 148px",
                }}
              >
                {/* Large left card — spans both rows */}
                {bentoArticles[0] && (
                  <BentoCard
                    article={bentoArticles[0]}
                    large
                    className="row-span-2"
                  />
                )}
                {/* Four smaller right cards */}
                {bentoArticles.slice(1, 5).map(a => (
                  <BentoCard key={a.id} article={a} />
                ))}
              </div>
            )}

            {/* ── Feature article + recommendations ── */}
            {featureArticle && (
              <div className="grid lg:grid-cols-[1fr_300px] gap-12 border-t border-rule pt-8">

                {/* Feature article */}
                <article>
                  <div className="flex items-center gap-3 text-sm text-ink/38 mb-4">
                    <span>{featureArticle.tags[0] ?? "AI"}</span>
                    <span className="w-6 h-px bg-ink/15 inline-block" />
                    <span>今天</span>
                  </div>

                  <a href={`/articles/${featureArticle.id}`} className="group block">
                    <h2 className="font-serif text-3xl md:text-[40px] leading-snug text-ink group-hover:text-ink/60 transition-colors mb-5">
                      {featureArticle.titleZh}
                    </h2>
                  </a>

                  <p className="text-[15px] leading-relaxed text-ink/50 mb-7 line-clamp-4">
                    {featureArticle.summaryZh}
                  </p>

                  {featureArticle.imageUrl && (
                    <a href={`/articles/${featureArticle.id}`} className="block">
                      <div className="relative aspect-[16/9] overflow-hidden">
                        <Image
                          src={featureArticle.imageUrl}
                          alt={featureArticle.titleZh}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    </a>
                  )}
                </article>

                {/* Sidebar */}
                <aside>
                  <div className="border-t-2 border-ink pt-4 mb-5">
                    <h3 className="text-sm font-bold">推荐</h3>
                  </div>
                  <div className="space-y-0">
                    {sidebarArticles.map(a => (
                      <div
                        key={a.id}
                        className="py-5 border-b border-rule last:border-0"
                      >
                        <RecommendCard article={a} />
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            )}

            {/* Day navigation — subtle, below main content */}
            {days.length > 1 && (
              <div className="mt-12 pt-6 border-t border-rule flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/25">
                  {dayState ? `第 ${selectedDay} 期 · DAU ${dayState.dau.toLocaleString()}` : `第 ${selectedDay} 期`}
                </p>
                <div className="flex items-center gap-0">
                  {days.slice(0, 8).map(d => (
                    <Link
                      key={d.day}
                      href={`/?day=${d.day}${selectedCat !== "全部" ? `&cat=${selectedCat}` : ""}`}
                      className={`px-3 py-1 text-[11px] font-bold border-b-2 transition-colors ${
                        d.day === selectedDay
                          ? "border-ink text-ink"
                          : "border-transparent text-ink/28 hover:text-ink/55"
                      }`}
                    >
                      {d.day === days[0]?.day ? "最新" : `D${d.day}`}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-rule mt-8 py-6">
        <div className="mx-auto max-w-[1200px] px-6 flex items-center justify-between">
          <Link href="/" className="font-serif text-lg font-bold">AGI Daily</Link>
          <span className="text-[9px] text-ink/20 uppercase tracking-[0.3em]">AI Agent 团队驱动</span>
          <a href="/dashboard" className="text-[9px] text-ink/25 hover:text-ink/55 transition-colors uppercase tracking-[0.25em]">
            后台 →
          </a>
        </div>
      </footer>
    </div>
  );
}
