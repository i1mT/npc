"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, CheckCircle2, Undo2 } from "lucide-react";
import type { DaySummary } from "@/lib/types";

export default function SystemPage() {
  const router = useRouter();

  // ── State ────────────────────────────────────────────────────────────────────
  const [days, setDays] = useState<DaySummary[]>([]);

  // Reset state
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [resetError, setResetError] = useState("");

  // Rollback state
  const [rollbackDay, setRollbackDay] = useState<number>(0);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackDone, setRollbackDone] = useState(false);
  const [rollbackError, setRollbackError] = useState("");

  useEffect(() => {
    fetch("/api/days", { cache: "no-store" })
      .then(r => r.json())
      .then((data) => {
        const dayData = data as { days: DaySummary[] };
        const d = dayData.days ?? [];
        setDays(d);
        if (d.length > 0) setRollbackDay(d[d.length - 1]!.day); // default = earliest completed day
      });
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleReset() {
    setResetLoading(true);
    setResetError("");
    try {
      const res = await fetch("/api/sim/reset", { method: "POST" });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setResetError(data.error ?? "重置失败"); return; }
      setResetDone(true);
      setResetConfirm(false);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setResetLoading(false);
    }
  }

  async function handleRollback() {
    setRollbackLoading(true);
    setRollbackError("");
    try {
      const res = await fetch("/api/sim/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDay: rollbackDay }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setRollbackError(data.error ?? "回退失败"); return; }
      setRollbackDone(true);
      setRollbackConfirm(false);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (e) {
      setRollbackError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setRollbackLoading(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-rule bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <RotateCcw className="h-5 w-5 text-ink/50" />
          <div>
            <h1 className="font-black text-lg">系统管理</h1>
            <p className="text-xs text-ink/50">数据维护、回退与重置</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">

        {/* Success banners */}
        {(resetDone || rollbackDone) && (
          <div className="flex items-center gap-3 rounded-lg border border-mint/30 bg-mint/10 p-4 text-sm text-green-700">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{resetDone ? "重置成功" : `已回退到 Day ${rollbackDay}`}，正在跳转到总览…</span>
          </div>
        )}

        {/* ── Rollback card ── */}
        <div className="rounded-lg border border-rule bg-white">
          <div className="border-b border-rule px-5 py-4">
            <div className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-cobalt" />
              <h2 className="font-bold text-sm">回退到指定天</h2>
            </div>
            <p className="mt-1 text-xs text-ink/50">
              删除选定天之后的所有数据（文章、工作事件、结算记录等），并将模拟状态回退到该天结束时的快照。
            </p>
          </div>

          <div className="p-5 space-y-4">
            {rollbackError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{rollbackError}</div>
            )}

            {days.length === 0 ? (
              <p className="text-xs text-ink/40">暂无历史数据可回退。</p>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-ink/60">选择回退目标天</label>
                  <div className="flex flex-wrap gap-2">
                    {days.map(d => (
                      <button
                        key={d.day}
                        onClick={() => { setRollbackDay(d.day); setRollbackConfirm(false); }}
                        className={`rounded border px-3 py-1.5 text-xs font-bold transition-colors ${
                          rollbackDay === d.day
                            ? "border-cobalt bg-cobalt text-white"
                            : "border-rule bg-white text-ink/60 hover:border-cobalt/50"
                        }`}
                      >
                        Day {d.day}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-ink/40">
                    → 保留 Day {rollbackDay} 及之前的数据，删除 Day {rollbackDay + 1} 起的所有记录
                  </p>
                </div>

                {!rollbackConfirm ? (
                  <button
                    onClick={() => setRollbackConfirm(true)}
                    className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    回退到 Day {rollbackDay}
                  </button>
                ) : (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
                    <p className="text-sm font-bold text-amber-800">确认回退到 Day {rollbackDay}？</p>
                    <p className="text-xs text-amber-700">
                      Day {rollbackDay + 1} 及之后的数据将被永久删除，包括文章、工作日志、结算记录、员工变动等。
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleRollback}
                        disabled={rollbackLoading}
                        className="rounded bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                      >
                        {rollbackLoading ? "回退中…" : `确认回退到 Day ${rollbackDay}`}
                      </button>
                      <button
                        onClick={() => setRollbackConfirm(false)}
                        disabled={rollbackLoading}
                        className="rounded border border-rule px-4 py-2 text-xs text-ink/60 hover:text-ink transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Reset card ── */}
        <div className="rounded-lg border border-rule bg-white">
          <div className="border-b border-rule px-5 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="font-bold text-sm">清除历史数据 · 回到第 0 天</h2>
            </div>
            <p className="mt-1 text-xs text-ink/50">
              删除所有模拟数据，包括文章、员工、工作事件、评论、结算记录等，公司将重新从第 0 天出发。
            </p>
          </div>

          <div className="p-5 space-y-3">
            {resetError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{resetError}</div>
            )}

            <ul className="text-xs text-ink/55 space-y-1 ml-3 list-disc">
              <li>所有已发布文章与读者评论</li>
              <li>员工记录（Agent 团队）</li>
              <li>工作事件与日志</li>
              <li>每日模拟状态（DAU、资金、声誉）</li>
              <li>董事会会议记录与财务结算</li>
            </ul>
            <p className="text-xs font-bold text-red-600">⚠ 此操作不可撤销，将删除全部数据。</p>

            {!resetConfirm ? (
              <button
                onClick={() => setResetConfirm(true)}
                className="mt-2 rounded border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition-colors"
              >
                清除全部数据并重置
              </button>
            ) : (
              <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-4 space-y-3">
                <p className="text-sm font-bold text-red-700">确认清除全部历史数据？</p>
                <p className="text-xs text-red-600">点击下方按钮后数据立即删除，无法恢复。</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    disabled={resetLoading}
                    className="rounded bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {resetLoading ? "重置中…" : "确认清除并重置"}
                  </button>
                  <button
                    onClick={() => setResetConfirm(false)}
                    disabled={resetLoading}
                    className="rounded border border-rule px-4 py-2 text-xs text-ink/60 hover:text-ink transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
