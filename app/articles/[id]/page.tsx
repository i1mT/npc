import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getArticle, getDay, listPublishedArticles } from "@/db/sim";
import { tagGradient } from "@/lib/cover";
import { dayToLongDate, dayToShortDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = getArticle(id);
  if (!article) notFound();

  const dayState = getDay(article.day);
  const displayDate = dayToLongDate(article.day);

  // Suggested reading: other articles from same day
  const siblings = listPublishedArticles(article.day)
    .filter(a => a.id !== article.id)
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-[#f5f3ee] text-ink">
      {/* Site nav */}
      <header className="sticky top-0 z-50 bg-ink text-paper border-b border-paper/10">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
          <Link href="/" className="font-black text-lg tracking-[0.2em] text-signal uppercase">AGI Daily</Link>
          <Link href={`/?day=${article.day}`} className="text-xs text-paper/50 hover:text-paper transition-colors">
            ← {dayToShortDate(article.day)} 期刊
          </Link>
        </div>
      </header>

      {/* Article cover + header */}
      <div className="relative">
        {/* Cover: real image or gradient fallback */}
        {article.imageUrl ? (
          <div className="relative h-64 md:h-96 w-full">
            <Image
              src={article.imageUrl}
              alt={article.titleZh}
              fill
              className="object-cover"
              priority
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/30 to-transparent" />
          </div>
        ) : (
          <div className="relative h-64 md:h-96" style={{ background: tagGradient(article.tags) }}>
            <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/20 to-transparent" />
          </div>
        )}

        {/* Title overlay on cover */}
        <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-4xl px-4 pb-8 md:pb-12">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {article.tags.map(t => (
              <span key={t} className="rounded-sm bg-paper/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-paper/80 backdrop-blur-sm">
                {t}
              </span>
            ))}
            <span className="ml-auto text-xs text-paper/50">{displayDate}</span>
          </div>
          <h1 className="font-serif text-3xl md:text-5xl leading-tight text-paper max-w-3xl">
            {article.titleZh}
          </h1>
        </div>
      </div>

      {/* Article body */}
      <main className="mx-auto max-w-3xl px-4 py-10 md:py-14">
        {/* Summary lead */}
        <p className="text-lg md:text-xl leading-8 text-ink/80 font-medium border-l-4 border-ink pl-5 mb-8">
          {article.summaryZh}
        </p>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-ink/40 mb-10 pb-6 border-b border-rule">
          <span className="font-bold text-ink/60">AGI Daily 编辑部</span>
          <span>·</span>
          <span>{displayDate}</span>
          <span>·</span>
          <span>质量评分
            <span className={`ml-1 font-bold ${article.qualityScore >= 8 ? "text-mint" : article.qualityScore >= 7 ? "text-amber-600" : "text-ink/40"}`}>
              {article.qualityScore.toFixed(1)}
            </span>
            {" "}/ 10
          </span>
          {dayState && (
            <>
              <span>·</span>
              <span>DAU {dayState.dau.toLocaleString()}</span>
            </>
          )}
        </div>

        {/* Full article body */}
        <div className="space-y-5">
          {article.contentZh
            .replace(/([。！？])\s*/g, "$1\n")
            .split("\n")
            .filter(p => p.trim().length > 0)
            .map((para, i) => (
              <p key={i} className="text-[17px] leading-[1.9] text-ink/85">
                {para.trim()}
              </p>
            ))}
        </div>

        {/* Quality note / editor's reason */}
        {article.qualityReason && (
          <div className="mt-12 rounded-lg border border-rule bg-white p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-ink/35 mb-2">编辑按语</p>
            <p className="text-sm leading-7 text-ink/60 italic">{article.qualityReason}</p>
          </div>
        )}

        {/* Attribution */}
        <div className="mt-10 border-t border-rule pt-6 flex items-center justify-between text-xs text-ink/35">
          <div>
            <span className="font-bold text-ink/50">AGI Daily 编辑部</span>
            <span className="ml-2">· {displayDate}</span>
          </div>
          <span>本文由 AI Agent 团队加工整理</span>
        </div>

        {/* Suggested reading */}
        {siblings.length > 0 && (
          <section className="mt-12">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/35 mb-4">本期其他报道</p>
            <div className="space-y-3">
              {siblings.map(s => (
                <Link key={s.id} href={`/articles/${s.id}`}
                  className="flex items-center gap-4 rounded-lg border border-rule bg-white p-4 group hover:border-ink/30 transition-colors">
                  <div className="relative h-12 w-12 shrink-0 rounded overflow-hidden">
                    {s.imageUrl ? (
                      <Image src={s.imageUrl} alt="" fill className="object-cover" unoptimized />
                    ) : (
                      <div className="h-full w-full" style={{ background: tagGradient(s.tags) }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex gap-1 mb-1">
                      {s.tags.slice(0, 1).map(t => (
                        <span key={t} className="text-[10px] font-bold text-ink/40 uppercase">{t}</span>
                      ))}
                    </div>
                    <p className="font-bold text-sm text-ink group-hover:text-cobalt transition-colors line-clamp-1">
                      {s.titleZh}
                    </p>
                    <p className="text-xs text-ink/50 mt-0.5 line-clamp-1">{s.summaryZh}</p>
                  </div>
                  <span className="shrink-0 text-xs text-ink/30 group-hover:text-cobalt">→</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-rule py-8">
        <div className="mx-auto max-w-4xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink/35">
          <Link href="/" className="font-bold uppercase tracking-widest text-ink/25 hover:text-ink transition-colors">AGI Daily</Link>
          <span>内容由 AI Agent 团队自动生成 · 仅供模拟演示</span>
          <Link href="/dashboard" className="hover:text-ink transition-colors">进入后台 →</Link>
        </div>
      </footer>
    </div>
  );
}
