// Cover utilities: deterministic picsum photo + tag-based gradient fallback

const PALETTES = [
  // cobalt / 大模型 / AI研究
  ["#0a1628", "#1a3a6b", "#254edb"],
  // emerald / 商业 / 融资
  ["#052318", "#0f4c2e", "#1a8a52"],
  // violet / 创业 / 生态
  ["#180a2e", "#3b1065", "#7c3aed"],
  // amber / 监管 / 政策
  ["#1c0f00", "#7c3a00", "#d97706"],
  // rose / 就业 / 招聘
  ["#1a0814", "#6b1033", "#e11d48"],
  // teal / 产品 / 应用
  ["#031a1c", "#0f4a52", "#0d9488"],
  // slate / 芯片 / 算力
  ["#0c1422", "#1e3050", "#3b6eb5"],
  // coral / 数据 / 隐私
  ["#1c0a06", "#7c2010", "#e45c3a"],
];

function tagHash(tag: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < tag.length; i++) {
    h = Math.imul(h ^ tag.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  return Math.abs(h);
}

export function tagGradient(tags: string[]): string {
  const tag = tags[0] ?? "AI";
  const [c0, c1, c2] = PALETTES[tagHash(tag) % PALETTES.length]!;
  return `linear-gradient(135deg, ${c0} 0%, ${c1} 55%, ${c2} 100%)`;
}

// Accent color for the first tag (for badges/links)
export function tagAccent(tags: string[]): string {
  const tag = tags[0] ?? "AI";
  return PALETTES[tagHash(tag) % PALETTES.length]![2]!;
}

/**
 * Deterministic cover photo URL based on sourceId.
 * Uses picsum.photos — stable per article, no external API key needed.
 * Width 800, height 450 (16:9).
 */
export function articleCoverUrl(sourceId: string): string {
  // Use first 12 hex chars of the UUID (digits + a-f only) as seed
  const seed = sourceId.replace(/-/g, "").slice(0, 12);
  return `https://picsum.photos/seed/${seed}/800/450`;
}
