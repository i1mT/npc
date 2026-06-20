export function nextDAU(current: number, qualityScore: number, socialReach: number) {
  const churn = current * 0.005;
  const organic = current * (qualityScore / 10) * 0.03;
  const social = socialReach * 0.1;
  return Math.max(0, Math.round(current - churn + organic + social));
}

export function adRevenue(dau: number, reputation: number) {
  const baseCPM = 5;
  const reputationMult = reputation / 50;
  return Number(((dau * baseCPM) / 1000 * reputationMult).toFixed(2));
}

export function nextReputation(current: number, qualityScore: number, isOnTime: boolean) {
  const qualityDelta = (qualityScore - 6) * 0.5;
  const timelinessDelta = isOnTime ? 0.2 : -1;
  return Number(Math.min(100, Math.max(0, current + qualityDelta + timelinessDelta)).toFixed(1));
}

export function nextSubscribers(current: number, dau: number, qualityScore: number) {
  const conversion = qualityScore >= 8 ? 0.009 : qualityScore >= 7 ? 0.006 : 0.003;
  return current + Math.round(dau * conversion);
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

export function scoreArticle(input: { title: string; summary: string; content: string; tags: string[]; index: number }) {
  const lengthBonus = Math.min(1.2, (input.summary.length + input.content.length / 8) / 600);
  const topicBonus = Math.min(0.8, input.tags.length * 0.12);
  const clarityBonus = /AI|人工智能|模型|agent|Agent|OpenAI|Google|NVIDIA|机器人|芯片|推理/i.test(`${input.title} ${input.summary}`) ? 0.7 : 0.2;
  const freshnessVariance = ((input.index * 17) % 9) / 20;
  return Number(Math.min(9.4, 6.4 + lengthBonus + topicBonus + clarityBonus + freshnessVariance).toFixed(1));
}
