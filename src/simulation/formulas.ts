export const AD_CPM_BY_REPUTATION = {
  low: 30,
  mid: 60,
  high: 120,
} as const;

export const SUBSCRIPTION_DAILY_PRICE = 1.8;

export function nextDAU(current: number, qualityScore: number, socialReach: number, readerOverallScore?: number) {
  const effectiveQuality = readerOverallScore !== undefined
    ? readerOverallScore * 0.6 + qualityScore * 0.4
    : qualityScore;
  const churn = current * 0.005;
  const organic = current * (effectiveQuality / 10) * 0.03;
  const social = socialReach * 0.1;
  return Math.max(0, Math.round(current - churn + organic + social));
}

export function adRevenue(dau: number, reputation: number): number {
  // CPM 三档：声誉越高广告主出价越高
  const cpm = reputation >= 75
    ? AD_CPM_BY_REPUTATION.high
    : reputation >= 45
      ? AD_CPM_BY_REPUTATION.mid
      : AD_CPM_BY_REPUTATION.low;
  return Number(((dau * cpm) / 1000).toFixed(2));
}

export function nextReputation(current: number, qualityScore: number, isOnTime: boolean): number {
  const qualityDelta     = (qualityScore - 6) * 0.5;
  const timelinessDelta  = isOnTime ? 0.2 : -1;
  // 9分以上的突破性内容获得额外声誉背书
  const breakthroughBonus = qualityScore >= 9 ? 0.5 : 0;
  return Number(Math.min(100, Math.max(0, current + qualityDelta + timelinessDelta + breakthroughBonus)).toFixed(1));
}

export function nextSubscribers(current: number, dau: number, qualityScore: number): number {
  const conversion = qualityScore >= 8.5 ? 0.012 : qualityScore >= 7 ? 0.007 : 0.003;
  const newSubs    = Math.round(dau * conversion);
  // 低质量内容加剧流失（日流失率 0.3%），正常约 0.1%
  const dailyChurn = qualityScore < 6 ? 0.003 : 0.001;
  const churn      = Math.round(current * dailyChurn);
  return Math.max(0, current + newSubs - churn);
}

export function llmCost(articleCount: number, usedRemoteModel: boolean) {
  const base = usedRemoteModel ? 0.42 : 0.05;
  return Number((articleCount * base).toFixed(2));
}

export function socialReach(qualityScore: number, reputation: number, articleCount: number) {
  return Math.round(articleCount * 40 + qualityScore * 22 + reputation * 3);
}

export function nextCapital(current: number, revenue: number, cost: number, articleCount: number) {
  const opsCost = 18 + articleCount * 1.2;
  return Number((current + revenue - cost - opsCost).toFixed(2));
}

export function laborCost(employees: { daily_salary: number }[]): number {
  return employees.reduce((sum, e) => sum + e.daily_salary, 0);
}

export function grossRevenue(adRev: number, subscribers: number, sponsorship = 0): number {
  return Number((adRev + subscriptionRevenue(subscribers) + sponsorship).toFixed(2));
}

export function subscriptionRevenue(subscribers: number): number {
  return Number((subscribers * SUBSCRIPTION_DAILY_PRICE).toFixed(2));
}

export function netRevenue(gross: number, llmCostVal: number, laborCostVal: number, fixed = 18, newsletter = 12): number {
  return Number((gross - llmCostVal - laborCostVal - fixed - newsletter).toFixed(2));
}

export function scoreArticle(input: { title: string; summary: string; content: string; tags: string[]; index: number }) {
  const lengthBonus = Math.min(1.2, (input.summary.length + input.content.length / 8) / 600);
  const topicBonus = Math.min(0.8, input.tags.length * 0.12);
  const clarityBonus = /AI|人工智能|模型|agent|Agent|OpenAI|Google|NVIDIA|机器人|芯片|推理/i.test(`${input.title} ${input.summary}`) ? 0.7 : 0.2;
  const freshnessVariance = ((input.index * 17) % 9) / 20;
  return Number(Math.min(9.4, 6.4 + lengthBonus + topicBonus + clarityBonus + freshnessVariance).toFixed(1));
}
