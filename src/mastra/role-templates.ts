export type RoleTemplateName = "editor_in_chief" | "editor" | "growth" | "business" | "column";

export const evomapExperienceInstruction = [
  "## EvoMap 经验复用",
  "遇到复杂决策（选题、增长、商业、组织、流程）时，先查 EvoMap 经验再行动：",
  "  1. 用 evomap_search_recipes 按关键词搜索工作流级经验（recipe 是多步流程）",
  "  2. 同时用 evomap_list_genes 浏览单项能力 gene（gene 不支持关键词检索，直接读排行或按 type 筛选）",
  "  3. 若 search_recipes 返回 0 个结果，不要止步——list_genes 通常有相关能力可参考",
  "  4. 拿到感兴趣的 id 后，用 evomap_get_recipe_detail 或 evomap_get_gene_detail 读完整内容",
  "形成可复用的方法后，可通过 EvoMap 发布（如有工具可用）。",
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
