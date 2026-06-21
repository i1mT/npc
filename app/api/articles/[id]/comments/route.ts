import { NextRequest, NextResponse } from "next/server";
import { getArticle } from "@/db/sim";
import { insertHumanComment, listHumanCommentsByArticle, listReviewsByArticle } from "@/db/feedback";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = getArticle(id);
  if (!article) return NextResponse.json({ error: "not found" }, { status: 404 });

  const humanComments = listHumanCommentsByArticle(id);
  const agentReviews = listReviewsByArticle(id);

  const avgScores = agentReviews.length > 0
    ? {
        info_density: agentReviews.reduce((s, r) => s + r.scoreInfo, 0) / agentReviews.length,
        readability: agentReviews.reduce((s, r) => s + r.scoreRead, 0) / agentReviews.length,
        timeliness: agentReviews.reduce((s, r) => s + r.scoreTimeliness, 0) / agentReviews.length,
        uniqueness: agentReviews.reduce((s, r) => s + r.scoreUnique, 0) / agentReviews.length,
        ai_relevance: agentReviews.reduce((s, r) => s + r.scoreAiRel, 0) / agentReviews.length,
        overall: agentReviews.reduce((s, r) => s + r.scoreOverall, 0) / agentReviews.length,
      }
    : null;

  return NextResponse.json({ humanComments, agentReviews, avgScores });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = getArticle(id);
  if (!article) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { authorName?: string; content?: string };
  try {
    body = await req.json() as { authorName?: string; content?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const authorName = (body.authorName ?? "").trim().slice(0, 30);
  const content = (body.content ?? "").trim().slice(0, 500);
  if (!authorName || !content) return NextResponse.json({ error: "authorName and content are required" }, { status: 400 });

  const commentId = insertHumanComment({ articleId: id, day: article.day, authorName, content });
  return NextResponse.json({ ok: true, id: commentId });
}
