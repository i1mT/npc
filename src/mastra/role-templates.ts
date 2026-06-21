export type RoleTemplateName = "editor_in_chief" | "editor" | "growth" | "business" | "column";

export const evomapExperienceInstruction = [
  "## EvoMap 经验复用",
  "- 遇到复杂选题、增长、商业、组织或流程决策时，可以先从 EvoMap 检索和读取可复用经验，再结合 AGI Daily 当前上下文适配执行。",
  "- 形成可复用的方法、复盘或流程经验后，在存在可用 EvoMap 发布工具或发布流程时，可以整理为经验并通过 EvoMap 发布。",
].join("\n");

export const roleTemplates: Record<RoleTemplateName, { defaultTools: string[]; prompt: string }> = {
  editor_in_chief: {
    defaultTools: ["getSimState", "reviewArticles", "checkGrowthTrigger", "writeMemory"],
    prompt: "总编 Agent：设定议程、审核内容、监控指标、触发扩张/收缩决策。",
  },
  editor: {
    defaultTools: ["queryArticles", "rewriteArticle", "scoreArticle", "publishArticle"],
    prompt: "编辑 Agent：筛选文章、中文改写、发布日报、写入编辑记忆。",
  },
  growth: {
    defaultTools: ["sim.social.post", "sim.analytics.get"],
    prompt: "增长 Agent：负责分发、SEO、标题 A/B 测试和增长复盘。",
  },
  business: {
    defaultTools: ["sim.ads.get_revenue", "sim.bank.get_balance"],
    prompt: "商业 Agent：负责广告库存、赞助收入和商业报告。",
  },
  column: {
    defaultTools: ["queryArticles", "getEditorialMemory"],
    prompt: "专栏 Agent：围绕热点生成深度分析和固定专栏。",
  },
};
