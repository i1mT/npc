"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Dashboard } from "@/components/dashboard";
import { pageTitle } from "@/lib/brand";
import type { DaySummary } from "@/lib/types";

function WorkInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const dayParam = searchParams.get("day");
  const [days, setDays] = useState<DaySummary[] | null>(null);

  useEffect(() => {
    document.title = pageTitle("工作日志");
    fetch("/api/days", { cache: "no-store" })
      .then(r => r.json())
      .then((data) => setDays(((data as { days: DaySummary[] }).days) ?? []));
  }, []);

  if (days === null) {
    return (
      <div className="flex h-full items-center justify-center text-ink/40">
        <p className="text-sm">连接中…</p>
      </div>
    );
  }

  const initialDay = dayParam ? Number(dayParam) : (days[0]?.day ?? 1);

  function handleNewDay(day: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", String(day));
    router.push(`${pathname}?${params.toString()}`);
  }

  return <Dashboard initialDays={days} initialSelectedDay={initialDay} onNewDay={handleNewDay} />;
}

export default function WorkPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-ink/40 text-sm">连接中…</div>}>
      <WorkInner />
    </Suspense>
  );
}
