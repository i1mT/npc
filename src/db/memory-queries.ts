import { getSimDb } from "@/db/connection";

export type TopicPerformance = {
  topic: string;
  avgScore: number;
  articleCount: number;
  trend: "up" | "down" | "stable";
};

export function getTopicPerformanceLast7Days(currentDay: number): TopicPerformance[] {
  const rows = getSimDb()
    .prepare(
      `SELECT day, tags, quality_score
       FROM published_articles
       WHERE day >= ? AND day < ?
       ORDER BY day ASC`,
    )
    .all(Math.max(1, currentDay - 7), currentDay) as { day: number; tags: string | null; quality_score: number }[];
  const byTopic = new Map<string, { scores: number[]; early: number[]; late: number[] }>();
  for (const row of rows) {
    const tags = safeTags(row.tags);
    for (const tag of tags) {
      const bucket = byTopic.get(tag) ?? { scores: [], early: [], late: [] };
      bucket.scores.push(row.quality_score);
      if (row.day < currentDay - 3) bucket.early.push(row.quality_score);
      else bucket.late.push(row.quality_score);
      byTopic.set(tag, bucket);
    }
  }
  return Array.from(byTopic.entries())
    .map(([topic, bucket]) => {
      const avgScore = average(bucket.scores);
      const delta = average(bucket.late) - average(bucket.early);
      return {
        topic,
        avgScore,
        articleCount: bucket.scores.length,
        trend: delta > 0.3 ? "up" : delta < -0.3 ? "down" : "stable",
      } satisfies TopicPerformance;
    })
    .sort((a, b) => b.avgScore - a.avgScore || b.articleCount - a.articleCount)
    .slice(0, 12);
}

function safeTags(value: string | null) {
  if (!value) return ["AI"];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : ["AI"];
  } catch {
    return ["AI"];
  }
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}
