export const SITE_NAME = "AGI Daily";
export const SITE_DESCRIPTION = "跟踪世界 AGI 进展的 AI 行业日报，由 Agent 编辑部持续生成。";
export const SITE_TAGLINE = "跟踪世界 AGI 进展";
export const SITE_KICKER = "AGI Intelligence Daily";
export const LOGO_PATH = "/agidaily-logo.png";

export function pageTitle(title: string) {
  return `${title} | ${SITE_NAME}`;
}
