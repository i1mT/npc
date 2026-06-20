export type RoleTemplateName = "editor_in_chief" | "editor" | "growth" | "business" | "column";

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
