"use client";

import { useState } from "react";
import { HumanData } from "@/components/admin-shell";
import type { PublishedArticle } from "@/lib/types";

type ReplayDay = {
  day: number;
  mission: unknown;
  metrics: unknown;
  articles: (Pick<PublishedArticle, "id" | "titleZh" | "summaryZh" | "tags" | "qualityScore" | "sourceUrl" | "imageUrl"> & {
    memoryHighlights: unknown;
    behindUrl: string;
  })[];
  changeSummary: Record<string, number>;
};

export function Replay({ data }: { data: ReplayDay }) {
  const [behind, setBehind] = useState<Record<string, unknown>>({});

  async function load(articleId: string, url: string) {
    if (behind[articleId]) return;
    const response = await fetch(url, { cache: "no-store" });
    const payload = response.ok ? await response.json() : { error: "load failed" };
    setBehind((current) => ({ ...current, [articleId]: payload }));
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="border-b-2 border-ink px-5 py-6">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-coral">daily replay</p>
        <h1 className="font-serif text-5xl">AGI DAILY · Day {data.day}</h1>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Info title="使命" value={data.mission} />
          <Info title="指标" value={data.metrics} />
          <Info title="七层变更" value={data.changeSummary} />
        </div>
      </header>
      <section className="mx-auto grid max-w-7xl gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
        {data.articles.map((article) => (
          <article key={article.id} className="border-t-4 border-ink bg-[#fbf8f0] p-4">
            <div className="flex justify-between text-xs text-ink/60">
              <span>{article.tags.slice(0, 2).join(" / ") || "AI"}</span>
              <span>Score {article.qualityScore}</span>
            </div>
            <h2 className="mt-3 font-serif text-2xl leading-tight">{article.titleZh}</h2>
            <p className="mt-3 text-sm leading-6 text-ink/75">{article.summaryZh}</p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold">
              <a href={article.sourceUrl} target="_blank">原文</a>
              <button className="border-b border-ink" onClick={() => load(article.id, article.behindUrl)}>幕后</button>
            </div>
            {behind[article.id] ? (
              <div className="mt-4 border border-ink bg-white p-3">
                <p className="mb-2 text-xs font-bold uppercase text-cobalt">幕后抽屉</p>
                <BehindPanel value={behind[article.id]} />
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}

function Info({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="border border-rule bg-white p-3">
      <p className="text-xs font-bold text-cobalt">{title}</p>
      <div className="mt-2 line-clamp-5"><HumanData value={value} compact /></div>
    </div>
  );
}

function BehindPanel({ value }: { value: unknown }) {
  const data = value as {
    explanation?: string;
    memory?: { highlights?: string[]; writes?: { content?: string }[] };
    events?: { actorName?: string; content?: string; eventType?: string }[];
    impacts?: { layerChanges?: { layer?: string; summary?: string }[] }[];
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="leading-6">{data.explanation ?? "暂无幕后解释。"}</p>
      <section>
        <p className="text-xs font-bold text-ink/50">引用/写入的记忆</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {(data.memory?.highlights ?? []).map((item, index) => <li key={index}>{item}</li>)}
          {(data.memory?.writes ?? []).map((item, index) => <li key={`write-${index}`}>{item.content}</li>)}
        </ul>
      </section>
      <section>
        <p className="text-xs font-bold text-ink/50">相关协作事件</p>
        <div className="mt-1 space-y-2">
          {(data.events ?? []).map((event, index) => (
            <div key={index} className="border border-rule bg-[#f8f8f4] p-2">
              <strong>{event.actorName}</strong> <span className="text-xs text-ink/50">{event.eventType}</span>
              <p>{event.content}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <p className="text-xs font-bold text-ink/50">影响到的层</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {(data.impacts ?? []).flatMap((impact) => impact.layerChanges ?? []).map((change, index) => (
            <span key={index} className="border border-rule bg-white px-2 py-1 text-xs">{change.layer}: {change.summary}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
