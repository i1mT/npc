"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Plus, Users } from "lucide-react";

// ─── Role catalog ─────────────────────────────────────────────────────────────

const ROLES = [
  {
    id: "editor",
    label: "编辑 Agent",
    emoji: "✍️",
    desc: "负责每日文章筛选、中文改写、质量评分与发布，向总编汇报。",
    tools: ["queryArticles()", "rewriteArticle()", "scoreArticle()", "publishArticle()"],
    when: "内容量增大，需要多位编辑并行处理不同话题",
    color: "#2e9e6b",
    initial: "编",
  },
  {
    id: "business",
    label: "商业 Agent",
    emoji: "💼",
    desc: "负责广告库存管理、赞助商关系与商业报告，向总编汇报。",
    tools: ["sim.ads.get_revenue()", "sim.bank.get_balance()"],
    when: "月广告收入 > ¥30,000，需要专职商业运营",
    color: "#92400e",
    initial: "B",
  },
  {
    id: "growth",
    label: "增长 Agent",
    emoji: "📈",
    desc: "负责分发、SEO、标题 A/B 测试与增长复盘，向总编汇报。",
    tools: ["sim.social.post()", "sim.analytics.get()"],
    when: "DAU 突破 10,000，需要专职增长策略",
    color: "#c05621",
    initial: "G",
  },
  {
    id: "column",
    label: "专栏 Agent",
    emoji: "📰",
    desc: "围绕某个垂直主题生成深度分析和固定专栏，向总编或编辑汇报。",
    tools: ["queryArticles()", "getEditorialMemory()"],
    when: "特定话题持续高流量，需要深度内容支撑",
    color: "#5b21b6",
    initial: "专",
  },
];

// ─── Hire form ────────────────────────────────────────────────────────────────

function HireForm({ role, onSuccess, onCancel }: {
  role: typeof ROLES[0];
  onSuccess: (result: { id: string; joinDay: number }) => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(`${role.label.replace(" Agent", "")} ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`);
  const [mandate, setMandate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mandate.trim()) { setError("请填写使命说明"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sim/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleTemplate: role.id, displayName: displayName.trim(), mandate: mandate.trim() }),
      });
      const data = await res.json() as { id?: string; joinDay?: number; error?: string };
      if (!res.ok || data.error) { setError(data.error ?? "招募失败"); return; }
      onSuccess({ id: data.id!, joinDay: data.joinDay! });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-lg border-2 border-cobalt/30 bg-[#f4f6ff] p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-cobalt">招募 {role.label}</p>

      <div>
        <label className="block mb-1 text-xs font-bold text-ink/60">显示名称</label>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          className="w-full rounded border border-rule px-3 py-2 text-sm focus:border-cobalt focus:outline-none"
          required
        />
      </div>

      <div>
        <label className="block mb-1 text-xs font-bold text-ink/60">使命说明（成为该 Agent 的核心指令）</label>
        <textarea
          value={mandate}
          onChange={e => setMandate(e.target.value)}
          rows={4}
          placeholder={`例如：你是 AGI Daily 的${role.label}，专注于${role.desc.slice(0, 30)}...`}
          className="w-full resize-none rounded border border-rule px-3 py-2 text-sm focus:border-cobalt focus:outline-none"
          required
        />
        <p className="mt-1 text-[10px] text-ink/40">此内容将作为 Mastra Agent 的 system prompt，驱动该 Agent 的决策与行为。</p>
      </div>

      {error && <p className="rounded bg-coral/10 px-3 py-2 text-sm text-coral">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink/80 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          确认招募
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-rule px-4 py-2 text-sm text-ink/60 hover:border-ink/40">
          取消
        </button>
      </div>
    </form>
  );
}

// ─── Success card ─────────────────────────────────────────────────────────────

function SuccessCard({ result, roleName }: { result: { id: string; joinDay: number }; roleName: string }) {
  return (
    <div className="mt-4 rounded-lg border-2 border-mint/50 bg-[#f0faf5] p-4">
      <div className="flex items-center gap-2 text-mint">
        <Check className="h-5 w-5" />
        <span className="font-bold text-sm">招募成功！</span>
      </div>
      <p className="mt-2 text-sm text-ink/70">
        <strong>{roleName}</strong> 将从 <strong>Day {result.joinDay}</strong> 起正式加入团队，开始参与每日工作流。
      </p>
      <Link href={`/dashboard/employees/${result.id}`} className="mt-2 inline-block text-xs text-cobalt hover:underline">
        查看 Agent 详情 →
      </Link>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HRPage() {
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [hired, setHired] = useState<Record<string, { id: string; joinDay: number }>>({});

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-rule bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-xs text-ink/50 hover:text-ink flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> 控制台
          </Link>
          <div className="h-4 w-px bg-rule" />
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-ink/50" />
            <h1 className="font-black text-lg">人才市场</h1>
          </div>
          <p className="text-xs text-ink/40">招募新 Agent，扩展组织能力</p>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Intro */}
        <div className="mb-8 rounded-lg border border-rule bg-white p-5">
          <p className="text-sm leading-7 text-ink/70">
            在这里，CEO（你）可以主动招募新的 Agent 加入 AGI Daily 团队。
            招募后，Mastra 将自动创建新 Agent，从下一个运行日起参与协作。
            新 Agent 的<strong>使命说明</strong>将成为其核心 system prompt，驱动其决策。
          </p>
        </div>

        {/* Role cards */}
        <div className="space-y-4">
          {ROLES.map((role) => {
            const isActive = activeRole === role.id;
            const didHire = !!hired[role.id];
            return (
              <div key={role.id} className="rounded-lg border border-rule bg-white overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
                      style={{ backgroundColor: role.color }}
                    >
                      {role.initial}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{role.emoji}</span>
                        <h3 className="font-bold">{role.label}</h3>
                        {didHire && (
                          <span className="rounded bg-mint/15 px-2 py-0.5 text-[10px] font-bold text-green-700">已招募 · Day {hired[role.id].joinDay} 入职</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-ink/65">{role.desc}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {role.tools.map(t => (
                          <code key={t} className="rounded bg-ink/5 px-2 py-0.5 text-[10px] font-mono">{t}</code>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-ink/45">💡 {role.when}</p>
                    </div>
                    {/* Hire button */}
                    <button
                      onClick={() => setActiveRole(isActive ? null : role.id)}
                      className={`shrink-0 rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                        isActive ? "bg-rule text-ink/60" : "bg-ink text-paper hover:bg-ink/80"
                      }`}
                    >
                      {isActive ? "收起" : "招募"}
                    </button>
                  </div>

                  {/* Hire form or success */}
                  {isActive && !didHire && (
                    <HireForm
                      role={role}
                      onSuccess={(result) => {
                        setHired(prev => ({ ...prev, [role.id]: result }));
                        setActiveRole(null);
                      }}
                      onCancel={() => setActiveRole(null)}
                    />
                  )}
                  {didHire && <SuccessCard result={hired[role.id]} roleName={role.label} />}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-lg border border-rule bg-white p-4 text-xs text-ink/50">
          <strong className="text-ink/70">技术说明：</strong>招募触发 <code>POST /api/sim/hire</code>，
          在 <code>employees</code> 表写入新行，Mastra AgentFactory 立即加载并注册新 Agent。
          新 Agent 从 <code>joined_day + 1</code> 起参与 daily-workflow。
        </div>
      </div>
    </div>
  );
}
