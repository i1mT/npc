"use client";

import { useRouter, useSearchParams } from "next/navigation";

type DaySwitcherProps = {
  days: { day: number }[];
  selectedDay: number;
};

export function DaySwitcher({ days, selectedDay }: DaySwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", e.target.value);
    router.push(`/?${params.toString()}`);
  }

  if (days.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-ink/30 uppercase tracking-[0.2em] hidden sm:inline">期数</span>
      <select
        value={selectedDay}
        onChange={onChange}
        className="text-[11px] text-ink/55 bg-transparent border border-rule rounded px-2 py-1 cursor-pointer hover:border-ink/30 focus:outline-none focus:border-ink/40 transition-colors"
      >
        {days.map((d, i) => (
          <option key={d.day} value={d.day}>
            {i === 0 ? `第 ${d.day} 期（最新）` : `第 ${d.day} 期`}
          </option>
        ))}
      </select>
    </div>
  );
}
