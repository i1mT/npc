import { NextResponse } from "next/server";
import { getSimDb } from "@/db/connection";
import { subscriptionRevenue } from "@/simulation/formulas";

export const dynamic = "force-dynamic";

export type AgentTokenRow = {
  actorId: string;
  actorName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costYuan: number;
};

export type EmployeeSalaryRow = {
  id: string;
  displayName: string;
  roleTemplate: string;
  agentHandle: string;
  dailySalary: number;
  joinedDay: number;
};

export type DayFinance = {
  day: number;
  // Revenue
  adRevenue: number;
  subscriptionRevenue: number;
  sponsorRevenue: number;
  grossRevenue: number;
  // Costs
  llmCost: number;
  laborCost: number;
  fixedCost: number;
  newsletterCost: number;
  totalCost: number;
  // Net
  netRevenue: number;
  // Metrics
  capital: number;
  capitalDelta: number;
  dau: number;
  dauDelta: number;
  reputation: number;
  reputationDelta: number;
  subscribers: number;
  subscribersDelta: number;
  // Details
  tokenPrice: number;      // yuan per token
  totalTokens: number;
  agentTokens: AgentTokenRow[];
  employees: EmployeeSalaryRow[];
  articleCount: number;
  averageQuality: number;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ day: string }> },
) {
  const { day: rawDay } = await params;
  const day = Number(rawDay);
  if (!Number.isFinite(day)) {
    return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  }

  const db = getSimDb();

  const dayRow = db
    .prepare(
      `SELECT d.day, d.capital, d.reputation, d.dau, d.subscribers,
              d.ad_revenue, d.llm_cost, d.labor_cost,
              COUNT(pa.id) AS article_count
       FROM sim_days d
       LEFT JOIN published_articles pa ON pa.day = d.day
       WHERE d.day = ?
       GROUP BY d.day`,
    )
    .get(day) as {
    day: number; capital: number; reputation: number; dau: number;
    subscribers: number; ad_revenue: number; llm_cost: number;
    labor_cost: number; article_count: number;
  } | undefined;

  if (!dayRow) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }

  const prevRow = db
    .prepare("SELECT capital, reputation, dau, subscribers FROM sim_days WHERE day = ?")
    .get(day - 1) as { capital: number; reputation: number; dau: number; subscribers: number } | undefined;

  // Settlement breakdown (JSON stored during recordDailySettlement)
  const settlementRow = db
    .prepare("SELECT revenue_breakdown, cost_breakdown FROM daily_settlement WHERE day = ?")
    .get(day) as { revenue_breakdown: string; cost_breakdown: string } | undefined;

  const revBD = settlementRow ? (JSON.parse(settlementRow.revenue_breakdown) as {
    ad: number; subscription: number; sponsorship: number; gross: number;
  }) : null;
  const costBD = settlementRow ? (JSON.parse(settlementRow.cost_breakdown) as {
    llm: number; fixed: number; newsletter: number; labor: number; net: number;
  }) : null;

  // Per-agent token usage
  const agentTokenRows = db
    .prepare(
      `SELECT actor_id, actor_name,
              SUM(cost_token) AS total_tokens,
              SUM(cost_yuan)  AS cost_yuan
       FROM work_events
       WHERE day = ? AND cost_token > 0
       GROUP BY actor_id, actor_name
       ORDER BY total_tokens DESC`,
    )
    .all(day) as { actor_id: string; actor_name: string; total_tokens: number; cost_yuan: number }[];

  const TOKEN_PRICE = 0.000002; // yuan per token (flat simulation rate)
  const agentTokens: AgentTokenRow[] = agentTokenRows.map(r => ({
    actorId: r.actor_id,
    actorName: r.actor_name,
    totalTokens: r.total_tokens,
    inputTokens: 0,   // not separated at storage level
    outputTokens: 0,
    costYuan: r.cost_yuan > 0 ? r.cost_yuan : Number((r.total_tokens * TOKEN_PRICE).toFixed(4)),
  }));

  const totalTokens = agentTokens.reduce((s, r) => s + r.totalTokens, 0);

  // Active employees at this day
  const empRows = db
    .prepare(
      `SELECT id, display_name, role_template, agent_handle, daily_salary, joined_day
       FROM employees
       WHERE joined_day <= ? AND status = 'active'
       ORDER BY joined_day`,
    )
    .all(day) as {
    id: string; display_name: string; role_template: string;
    agent_handle: string; daily_salary: number; joined_day: number;
  }[];

  const employees: EmployeeSalaryRow[] = empRows.map(e => ({
    id: e.id,
    displayName: e.display_name,
    roleTemplate: e.role_template,
    agentHandle: e.agent_handle,
    dailySalary: e.daily_salary,
    joinedDay: e.joined_day,
  }));

  // Average quality from settlement drivers
  const qualityDriver = db
    .prepare("SELECT delta FROM settlement_drivers WHERE day = ? AND metric = 'dau' AND factor = 'quality_score'")
    .get(day) as { delta: number } | undefined;

  const adRevenue     = revBD?.ad          ?? dayRow.ad_revenue;
  const subscRev      = revBD?.subscription ?? subscriptionRevenue(dayRow.subscribers);
  const sponsorRev    = revBD?.sponsorship  ?? 0;
  const grossRevenue  = revBD?.gross        ?? Number((adRevenue + subscRev).toFixed(2));
  const llmCost       = costBD?.llm         ?? dayRow.llm_cost;
  const laborCost     = costBD?.labor       ?? dayRow.labor_cost;
  const fixedCost     = costBD?.fixed       ?? 18;
  const newsletterCost= costBD?.newsletter  ?? 12;
  const totalCost     = Number((llmCost + laborCost + fixedCost + newsletterCost).toFixed(2));
  const netRevenue    = costBD?.net         ?? Number((grossRevenue - totalCost).toFixed(2));

  const result: DayFinance = {
    day,
    adRevenue,
    subscriptionRevenue: subscRev,
    sponsorRevenue: sponsorRev,
    grossRevenue,
    llmCost,
    laborCost,
    fixedCost,
    newsletterCost,
    totalCost,
    netRevenue,
    capital: dayRow.capital,
    capitalDelta: prevRow ? Number((dayRow.capital - prevRow.capital).toFixed(2)) : dayRow.capital,
    dau: dayRow.dau,
    dauDelta: prevRow ? dayRow.dau - prevRow.dau : 0,
    reputation: dayRow.reputation,
    reputationDelta: prevRow ? Number((dayRow.reputation - prevRow.reputation).toFixed(1)) : 0,
    subscribers: dayRow.subscribers,
    subscribersDelta: prevRow ? dayRow.subscribers - prevRow.subscribers : 0,
    tokenPrice: TOKEN_PRICE,
    totalTokens,
    agentTokens,
    employees,
    articleCount: dayRow.article_count,
    averageQuality: qualityDriver?.delta ?? 0,
  };

  return NextResponse.json(result);
}
