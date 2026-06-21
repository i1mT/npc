import type { AgentDefinition, PublishedArticle } from "@/lib/types";
import { evomapExperienceInstruction } from "@/mastra/role-templates";

export const editorInChiefAgent: AgentDefinition = {
  name: "editor-in-chief",
  model: "evomap/openai-compatible-chat",
  tools: ["getSimState", "getMemory", "reviewArticles", "checkGrowthTrigger", "writeMemory"],
  instructions: [
    "你是 AGI Daily 的总编辑。",
    "使命：让中文读者用最少时间读懂全球 AI 最重要的进展。",
    "价值观优先级：用户信任 > 短期收入，内容质量 > 发布速度。",
    "每天制定选题方向、审核 10 篇稿件、判断生长/收缩协议。",
    evomapExperienceInstruction,
  ].join("\n"),
};

export type Agenda = {
  focusTopics: string[];
  blockedTopics: string[];
  note: string;
};

export type ReviewResult = {
  decision: "approve" | "reject";
  reason: string;
  averageScore: number;
};

export function createAgenda(day: number, reputation: number): Agenda {
  const focusByDay = [
    ["大模型推理效率", "AI 基础设施", "企业落地"],
    ["开源模型", "多模态产品", "开发者工具"],
    ["AI 芯片", "自动化工作流", "安全治理"],
  ];
  const focusTopics = focusByDay[(day - 1) % focusByDay.length];
  const blockedTopics = reputation < 55 ? ["未经证实融资传闻", "夸大替代人类表述"] : ["标题党预测", "无来源榜单"];
  return {
    focusTopics,
    blockedTopics,
    note: `Day ${day} 以 ${focusTopics.join("、")} 为主线，保持解释性和来源透明。`,
  };
}

export function reviewArticles(articles: PublishedArticle[]): ReviewResult {
  const averageScore = Number((articles.reduce((sum, article) => sum + article.qualityScore, 0) / Math.max(articles.length, 1)).toFixed(1));
  if (articles.length !== 10) {
    return { decision: "reject", reason: "每日发布量必须固定为 10 篇。", averageScore };
  }
  if (articles.some((article) => !article.sourceUrl)) {
    return { decision: "reject", reason: "存在缺少 source_url 的稿件。", averageScore };
  }
  if (averageScore < 7) {
    return { decision: "reject", reason: `平均质量分 ${averageScore} 低于 7.0，需要重写标题和摘要。`, averageScore };
  }
  return { decision: "approve", reason: `10 篇稿件来源完整，平均质量分 ${averageScore}，批准发布。`, averageScore };
}

export function growthProtocol(qualityScore: number, reputation: number) {
  if (qualityScore >= 8.2 && reputation >= 70) return "触发生长协议：提高社交分发权重，追加专题策划。";
  if (qualityScore < 6.8 || reputation < 50) return "触发收缩协议：减少实验性选题，优先解释性报道。";
  return "维持常规节奏：持续观察质量和留存。";
}
