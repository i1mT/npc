import { dbAll, dbFirst } from "@/db/connection";
import {
  addLayerEvent,
  getLatestDay,
  getDay,
  listPublishedArticles,
  projectDay,
  recordDailySettlement,
  suspendBoardMeeting,
  upsertDay,
} from "@/db/sim";
import { updateDayEditorNote } from "@/db/day-notes";
import { avgReviewScoresByDay } from "@/db/feedback";
import { logEvent } from "@/simulation/mock-apis";
import { adRevenue, laborCost, nextCapital, nextDAU, nextReputation, nextSubscribers, socialReach, subscriptionRevenue } from "@/simulation/formulas";
import type { CollaborationRuntime } from "@/mastra/collaboration";
import type { StreamedDayRun } from "./types";

export async function settleRunDay(run: StreamedDayRun, runtime: CollaborationRuntime) {
  const previous = await getLatestDay();
  const base = previous
    ? previous
    : { day: 0, capital: 10000, reputation: 62, dau: 1200, subscribers: 260, adRevenue: 0, llmCost: 0, isBoardDay: false };
  const articles = await listPublishedArticles(run.day);
  const averageQuality = articles.length ? articles.reduce((s, a) => s + a.qualityScore, 0) / articles.length : 6.5;
  const pastDays = await dbAll<{ avg_quality: number }>("SELECT avg_quality FROM sim_days WHERE day < ? AND avg_quality > 0 ORDER BY day DESC LIMIT 3", run.day);
  const qualityMomentum = pastDays.length ? pastDays.reduce((s, r) => s + r.avg_quality, 0) / pastDays.length : averageQuality;
  const effectiveQuality = averageQuality * 0.4 + qualityMomentum * 0.6;
  const reader = await avgReviewScoresByDay(run.day);
  const baseReach = socialReach(effectiveQuality, base.reputation, articles.length || 5);
  const growthBoost = runtime.agents.some(a => a.roleTemplate === "growth")
    ? Math.round(baseReach * 0.35 * Math.min(1.25, qualityMomentum / 7))
    : 0;
  const reach = baseReach + growthBoost;
  const dau = nextDAU(base.dau, effectiveQuality, reach, reader.avgOverall || undefined);
  const reputation = nextReputation(base.reputation, averageQuality, articles.length >= 8);
  const placementRow = await dbFirst<{ total: number }>("SELECT COALESCE(SUM(revenue), 0) AS total FROM ad_placements WHERE day = ?", run.day);
  const contractAdRevenue = Number((placementRow?.total ?? 0).toFixed(2));
  const organicAdRevenue = adRevenue(dau, reputation);
  const totalAdRevenue = Number((contractAdRevenue + organicAdRevenue).toFixed(2));
  const tokenTotal = run.totalInputTokens + run.totalOutputTokens;
  const llmCost = Number(Math.max(0.01, tokenTotal * 0.000002).toFixed(2));
  const subscribers = nextSubscribers(base.subscribers, dau, averageQuality);
  const salaries = await dbAll<{ daily_salary: number }>("SELECT daily_salary FROM employees WHERE status = 'active'");
  const laborCostAmount = laborCost(salaries);
  const capital = nextCapital(base.capital, totalAdRevenue + subscriptionRevenue(subscribers), llmCost + laborCostAmount, articles.length);
  const nextState = { day: run.day, capital, reputation, dau, subscribers, adRevenue: totalAdRevenue, llmCost, isBoardDay: run.day % 7 === 0 };
  await upsertDay({ ...nextState, laborCost: laborCostAmount, avgQuality: averageQuality });
  const chiefName = runtime.agents.find(a => a.handle === "editor-in-chief")?.displayName ?? "总编 Agent";
  const settlementEvent = await addLayerEvent({
    day: run.day,
    actorId: "editor-in-chief",
    actorName: chiefName,
    layer: "resource",
    eventType: "settlement",
    action: "daily_settlement",
    content: `资源织网结算：发布 ${articles.length} 篇，DAU ${dau}，声誉 ${reputation.toFixed(1)}，广告收入 ¥${totalAdRevenue.toFixed(2)}。`,
    payload: { averageQuality, qualityMomentum, socialReach: reach, capital, subscribers, tokenTotal, contractAdRevenue, organicAdRevenue },
  });
  await logEvent({
    day: run.day,
    agentId: "editor-in-chief",
    agentName: chiefName,
    eventType: "settlement",
    content: `今日结算完成：发布 ${articles.length} 篇，DAU ${dau.toLocaleString()}，声誉 ${reputation.toFixed(1)}，资金 ¥${Math.round(capital).toLocaleString()}。`,
    metadata: { source: "streamed-day", settlementEventId: settlementEvent.id },
  });
  await recordDailySettlement(
    { ...nextState, laborCost: laborCostAmount, contractAdRevenue, organicAdRevenue },
    previous,
    settlementEvent.id,
    { averageQuality, socialReach: reach, readerScore: reader.avgOverall || undefined },
  );
  return { state: nextState, settlementEventId: settlementEvent.id, averageQuality };
}

export async function applyEditorNote(day: number, text: string) {
  const note = text.trim().replace(/^["“]|["”]$/g, "").slice(0, 120);
  if (note) await updateDayEditorNote(day, note);
}

export async function applyGrowthDecision(day: number, text: string) {
  const decision = parseJson(text) ?? { status: "maintain", reason: "指标正常" };
  await addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "growth",
    eventType: "growth_trigger",
    action: "growth_protocol_check",
    content: String(decision.reason ?? "增长协议检查完成"),
    payload: decision,
  });
  await logEvent({
    day,
    agentId: "editor-in-chief",
    agentName: "总编 Agent",
    eventType: "decision",
    content: JSON.stringify(decision),
    metadata: { source: "growth-protocol" },
  });
}

export async function finishRunDay(run: StreamedDayRun, runtime: CollaborationRuntime, settlementEventId?: string) {
  await addLayerEvent({
    day: run.day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "rules",
    eventType: "rule_trigger",
    action: "daily_rule_check",
    content: `规则执行：per-turn stream 模式完成，agentic loop 上限内结束。`,
    payload: { mode: "per_turn_stream" },
  });
  await addLayerEvent({
    day: run.day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "structure",
    eventType: "org_change",
    action: "daily_contribution_rollup",
    content: `Agentic 协作完成：${runtime.agents.map(a => a.displayName).join("、")}。`,
    payload: { employees: runtime.agents.map(a => a.handle) },
    refs: settlementEventId ? { reply_to: settlementEventId } : undefined,
  });
  await projectDay(run.day);
  if (run.day % 7 === 0) await suspendBoardDay(run.day);
}

export function buildEditorNotePrompt(day: number, titles: string[], avgQuality: number, dau: number, reputation: number) {
  return [
    `Day ${day} 已完成。今日发布文章：${titles.slice(0, 5).join("、")}。`,
    `平均质量 ${avgQuality.toFixed(1)}，DAU ${dau}，声誉 ${reputation.toFixed(1)}。`,
    "用一两句话写下今日编辑按语（读者视角，不超过 80 字）。只输出按语本身。",
  ].join("\n");
}

export function buildGrowthPrompt(day: number, metrics: { dau: number; reputation: number; capital: number; monthlyRevenue: number }, team: string) {
  return [
    `请判断今日增长协议（Day ${day}）：`,
    `DAU=${metrics.dau} 声誉=${metrics.reputation.toFixed(1)} 资金=¥${Math.round(metrics.capital)} 月收入=¥${metrics.monthlyRevenue.toFixed(2)}`,
    `当前团队：${team}`,
    "输出 JSON：{\"status\":\"expand\"|\"maintain\"|\"contract\",\"reason\":\"...\",\"newAgentRole\":\"growth\"|\"business\"|\"column\"|null,\"newAgentName\":\"...\"}",
  ].join("\n");
}

function parseJson(text: string) {
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function suspendBoardDay(day: number) {
  const metrics = await getDay(day);
  if (!metrics) return;
  const weeklyReport = {
    day,
    dau: metrics.dau,
    capital: metrics.capital,
    reputation: metrics.reputation,
    subscribers: metrics.subscribers,
    adRevenue: metrics.adRevenue,
    articleCount: metrics.articleCount,
    summary: `Day ${day} 周报：DAU ${metrics.dau}，Reputation ${metrics.reputation.toFixed(1)}，Capital ¥${Math.round(metrics.capital)}。`,
    autoDirective: "MAINTAIN",
    autoDirectiveReason: "per-turn stream 模式下使用确定性周报，等待人类董事会决策。",
  };
  await suspendBoardMeeting(day, weeklyReport);
  await logEvent({
    day,
    agentId: "board",
    agentName: "董事会",
    eventType: "board",
    content: "workflow.suspend：进入董事会日，等待人类决策。",
    metadata: { day, workflow: "board-meeting", step: "await-board-input", status: "pending", weeklyReport },
  });
}
