"use client";

import { useEffect, useState } from "react";
import { Network, PlugZap, Unplug } from "lucide-react";

type EvoMapStatus = {
  connected: boolean;
  expired: boolean;
  expiresAt: string | null;
  scope: string | null;
  livemode: boolean | null;
  hasRefreshToken: boolean;
};

export function EvoMapConnectPanel() {
  const [status, setStatus] = useState<EvoMapStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    const res = await fetch("/api/evomap/oauth/status", { cache: "no-store" });
    setStatus(await res.json() as EvoMapStatus);
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/evomap/oauth/disconnect", { method: "POST" });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connected && !status.expired;

  return (
    <section className="rounded-lg border border-[#67e8f9] bg-[#ecfeff] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0891b2] text-white">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-black text-[#155e75]">EvoMap Developer OAuth</h2>
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${connected ? "bg-mint text-white" : "bg-white text-[#155e75] border border-[#67e8f9]"}`}>
                {connected ? "已连接" : status?.connected ? "需刷新授权" : "未连接"}
              </span>
              {status?.livemode != null && (
                <span className="rounded bg-white px-2 py-0.5 text-[10px] font-bold text-[#155e75]">
                  {status.livemode ? "LIVE" : "TEST"}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-[#155e75]/75">
              Agent 可调用 EvoMap recipes、genes 和 reuse graph。Token 仅保存在本机服务端。
            </p>
            {status?.expiresAt && (
              <p className="mt-1 text-[11px] text-[#155e75]/55">
                过期时间：{new Date(status.expiresAt).toLocaleString()} · Scope：{status.scope ?? "unknown"}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <a
            href="/api/evomap/oauth/login"
            className="inline-flex items-center gap-1.5 rounded bg-[#0891b2] px-3 py-2 text-xs font-bold text-white hover:bg-[#0e7490]"
          >
            <PlugZap className="h-3.5 w-3.5" />
            Connect
          </a>
          {status?.connected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="inline-flex items-center gap-1.5 rounded border border-[#67e8f9] bg-white px-3 py-2 text-xs font-bold text-[#155e75] disabled:opacity-50"
            >
              <Unplug className="h-3.5 w-3.5" />
              Disconnect
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
