"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, Gauge, Newspaper, RefreshCw, Users } from "lucide-react";
import Image from "next/image";
import type { DaySummary, PublishedArticle } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Portal({ initialDays }: { initialDays: DaySummary[] }) {
  const [days, setDays] = useState(initialDays);
  const [selectedDay, setSelectedDay] = useState(initialDays[0]?.day ?? 1);
  const [articles, setArticles] = useState<PublishedArticle[]>([]);
  const selected = useMemo(() => days.find((day) => day.day === selectedDay) ?? days[0], [days, selectedDay]);

  async function refresh() {
    const dayResponse = await fetch("/api/days", { cache: "no-store" });
    const dayJson = (await dayResponse.json()) as { days: DaySummary[] };
    setDays(dayJson.days);
    const nextDay = selectedDay || dayJson.days[0]?.day || 1;
    setSelectedDay(nextDay);
    if (nextDay) {
      const articleResponse = await fetch(`/api/days/${nextDay}/articles`, { cache: "no-store" });
      const articleJson = (await articleResponse.json()) as { articles: PublishedArticle[] };
      setArticles(articleJson.articles);
    }
  }

  useEffect(() => {
    if (!selectedDay) return;
    fetch(`/api/days/${selectedDay}/articles`, { cache: "no-store" })
      .then((response) => response.json())
      .then((json: { articles: PublishedArticle[] }) => setArticles(json.articles));
  }, [selectedDay]);

  if (!days.length) {
    return (
      <main className="min-h-screen bg-paper text-ink newspaper-grid">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">
          <Newspaper className="mb-6 h-12 w-12 text-cobalt" />
          <h1 className="font-serif text-5xl">AGI DAILY</h1>
          <p className="mt-4 max-w-xl text-lg text-ink/70">还没有已发布期次。请先在后台运行模拟，生成内容后这里会按日期展示。</p>
          <a className="mt-8 border border-ink px-5 py-3 text-sm font-bold uppercase tracking-wide hover:bg-ink hover:text-paper" href="/dashboard">
            打开后台
          </a>
        </div>
      </main>
    );
  }

  const lead = articles[0];
  const rest = articles.slice(1);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="border-b-2 border-ink px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-coral">AI industry newspaper</p>
            <h1 className="font-serif text-5xl leading-none md:text-7xl">AGI DAILY</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> 第 {selected?.day} 期</span>
            <span className="flex items-center gap-2"><Users className="h-4 w-4" /> DAU {selected?.dau.toLocaleString()}</span>
            <span className="flex items-center gap-2"><Gauge className="h-4 w-4" /> Reputation {selected?.reputation}</span>
            <button onClick={refresh} className="border border-ink px-3 py-2 text-xs font-bold hover:bg-ink hover:text-paper">
              <RefreshCw className="mr-2 inline h-3.5 w-3.5" />刷新
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 md:grid-cols-[190px_1fr]">
        <aside className="border-b border-rule bg-[#efe7d8] p-3 md:min-h-[calc(100vh-116px)] md:border-b-0 md:border-r">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
            {days.map((day) => (
              <button
                key={day.day}
                onClick={() => setSelectedDay(day.day)}
                className={cn(
                  "flex items-center justify-between border px-3 py-3 text-left text-sm transition",
                  selectedDay === day.day ? "border-ink bg-ink text-paper" : "border-rule bg-paper hover:border-ink",
                )}
              >
                <span>{day.isBoardDay ? "★ " : ""}Day {day.day}</span>
                <span>{day.articleCount}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="p-4 md:p-8">
          {lead ? (
            <article className="grid gap-6 border-b-2 border-ink pb-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="relative h-[320px] w-full overflow-hidden bg-rule">
                <Image className="object-cover grayscale" src={lead.imageUrl || "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80"} alt="" fill sizes="(min-width: 1024px) 50vw, 100vw" unoptimized />
              </div>
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {lead.tags.slice(0, 4).map((tag) => <span className="border border-ink px-2 py-1 text-xs" key={tag}>{tag}</span>)}
                </div>
                <h2 className="font-serif text-4xl leading-tight md:text-6xl">{lead.titleZh}</h2>
                <p className="mt-5 text-lg leading-8 text-ink/78">{lead.summaryZh}</p>
                <a className="mt-5 inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-bold" href={lead.sourceUrl} target="_blank">
                  查看来源 <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </article>
          ) : null}

          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rest.map((article) => (
              <article key={article.id} className="border-t-4 border-ink bg-[#fbf8f0] p-4">
                <div className="flex items-center justify-between text-xs text-ink/60">
                  <span>{article.tags.slice(0, 2).join(" / ") || "AI"}</span>
                  <span>Score {article.qualityScore}</span>
                </div>
                <h3 className="mt-3 font-serif text-2xl leading-tight">{article.titleZh}</h3>
                <p className="mt-3 line-clamp-4 text-sm leading-6 text-ink/75">{article.summaryZh}</p>
                <a className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase" href={article.sourceUrl} target="_blank">
                  Source <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
