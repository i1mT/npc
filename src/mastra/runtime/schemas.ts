import { z } from "zod";

const emptyToUndefined = (value: unknown) => value === "" || value === null ? undefined : value;
const limitArray = (max: number) => (value: unknown) => Array.isArray(value) ? value.slice(0, max) : value;

export const articleDraftSchema = z.object({
  articles: z.preprocess(limitArray(10), z.array(z.object({
    sourceId: z.string().min(1),
    titleZh: z.string().min(4).max(30),
    summaryZh: z.string().min(20).max(200),
    contentZh: z.string().min(400).max(1200),
    qualityScore: z.number().min(1).max(10),
    qualityReason: z.string().min(10),
    tags: z.preprocess(limitArray(5), z.array(z.string().min(1)).min(1).max(5)),
  }).superRefine((article, context) => {
    if (/[!?！？]/.test(article.titleZh)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["titleZh"], message: "title cannot contain question or exclamation marks" });
    }
    if (/震惊|重磅|颠覆/.test(article.titleZh)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["titleZh"], message: "title cannot use clickbait words" });
    }
  })).length(10)),
});

export const reviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(20),
  averageScore: z.number().min(1).max(10),
  articleFeedback: z.array(z.object({
    sourceId: z.string().min(1),
    issue: z.string().min(5),
  })).optional(),
});

export const agendaSchema = z.object({
  focusTopics: z.preprocess(limitArray(5), z.array(z.string().min(1)).min(2).max(5)),
  blockedTopics: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(20),
  note: z.string().min(1),
});

export const growthDecisionSchema = z.object({
  status: z.enum(["maintain", "expand", "contract"]),
  reason: z.string().min(20),
  newAgentRole: z.preprocess(emptyToUndefined, z.enum(["growth", "business", "column"]).optional()),
  newAgentName: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export const editorNoteSchema = z.object({
  note: z.string().min(20).max(60),
});

export const boardDirectiveSchema = z.object({
  directive: z.enum(["ADJUST_OKR", "STRATEGIC_PIVOT", "INJECT_CAPITAL", "RESTRUCTURE", "AMEND_CONSTITUTION", "MAINTAIN"]),
  reason: z.string().min(30),
  detail: z.string().min(20),
});

export const weeklyReportSchema = z.object({
  summary: z.string().min(50),
  majorDecisions: z.array(z.string()),
  pendingItems: z.array(z.string()),
  risks: z.array(z.string()),
});

export type ArticleDraftOutput = z.infer<typeof articleDraftSchema>;
export type ReviewOutput = z.infer<typeof reviewSchema>;
export type AgendaOutput = z.infer<typeof agendaSchema>;
export type GrowthDecisionOutput = z.infer<typeof growthDecisionSchema>;
export type EditorNoteOutput = z.infer<typeof editorNoteSchema>;
export type BoardDirectiveOutput = z.infer<typeof boardDirectiveSchema>;
export type WeeklyReportOutput = z.infer<typeof weeklyReportSchema>;
