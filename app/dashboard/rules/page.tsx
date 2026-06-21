import { listRules } from "@/db/sim";
import Link from "next/link";
import { ArrowLeft, Shield, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

const GROUP_STYLE: Record<string, { icon: string; bg: string; badge: string; badgeText: string }> = {
  "选题规则": { icon: "🎯", bg: "#f0f4ff", badge: "bg-cobalt/15 text-cobalt",       badgeText: "选题" },
  "发布规则": { icon: "📤", bg: "#f0faf5", badge: "bg-mint/20 text-green-700",       badgeText: "发布" },
  "审核规则": { icon: "✅", bg: "#fefce8", badge: "bg-signal/30 text-amber-700",     badgeText: "审核" },
  "因果公式": { icon: "⚡", bg: "#fafaf8", badge: "bg-rule text-ink/60",             badgeText: "公式" },
  "董事会":   { icon: "⬡",  bg: "#fffbe8", badge: "bg-[#d97706]/15 text-amber-800",  badgeText: "治理" },
};

function ParamTag({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-ink/5 px-2 py-0.5 text-xs font-mono">
      <span className="text-ink/40">{label}:</span>
      <span className="font-bold text-ink">{String(value)}</span>
    </span>
  );
}

export default function RulesPage() {
  const rules = listRules();
  const grouped = rules.reduce<Record<string, typeof rules>>((acc, rule) => {
    (acc[rule.group] ??= []).push(rule);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-rule bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-xs text-ink/50 hover:text-ink flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> 控制台
          </Link>
          <div className="h-4 w-px bg-rule" />
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-ink/50" />
            <h1 className="font-black text-lg">运营规则</h1>
          </div>
          <span className="text-xs text-ink/40">{rules.length} 条规则</span>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
        {Object.entries(grouped).map(([group, items]) => {
          const style = GROUP_STYLE[group] ?? { icon: "◉", bg: "#fafaf8", badge: "bg-rule text-ink/60", badgeText: group };
          return (
            <section key={group}>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-lg">{style.icon}</span>
                <h2 className="font-black">{group}</h2>
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{items.length}</span>
              </div>
              <div className="space-y-3">
                {items.map((rule) => (
                  <div key={rule.id} className="rounded-lg border border-rule p-4" style={{ backgroundColor: style.bg }}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <h3 className="font-bold text-sm">{rule.title}</h3>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
                        {style.badgeText}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-ink/75">{rule.description}</p>
                    {Object.keys(rule.parameters).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-rule/50 pt-3">
                        {Object.entries(rule.parameters).map(([k, v]) => (
                          <ParamTag key={k} label={k} value={v} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {/* Rules source info */}
        <div className="rounded-lg border border-rule bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-ink/50">
            <Zap className="h-4 w-4" />
            <span>规则由 <code className="text-xs bg-ink/5 px-1 rounded">src/db/sim.ts listRules()</code> 提供，实时从 <code className="text-xs bg-ink/5 px-1 rounded">sim.db rules</code> 表读取。</span>
          </div>
        </div>
      </div>
    </div>
  );
}
