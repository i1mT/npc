"use client";

import { useState } from "react";
import type { HumanComment } from "@/db/feedback";

type Props = {
  articleId: string;
  initialComments: HumanComment[];
};

export function CommentBox({ articleId, initialComments }: Props) {
  const [comments, setComments] = useState<HumanComment[]>(initialComments);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || !content.trim()) { setError("请填写昵称和评论内容"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/articles/${articleId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName: name.trim(), content: content.trim() }),
      });
      if (!res.ok) { setError("提交失败，请重试"); return; }
      const newComment: HumanComment = {
        id: (await res.json() as { id: string }).id,
        articleId,
        day: 0,
        authorName: name.trim(),
        content: content.trim(),
        createdAt: new Date().toISOString(),
      };
      setComments(prev => [...prev, newComment]);
      setName("");
      setContent("");
      setOpen(false);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/35">读者留言 ({comments.length})</p>
        <button
          onClick={() => setOpen(true)}
          className="rounded border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink/60 hover:border-ink/50 hover:text-ink transition-colors"
        >
          写评论
        </button>
      </div>

      {comments.length > 0 && (
        <div className="space-y-3">
          {comments.map(c => (
            <div key={c.id} className="rounded-lg border border-rule bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-ink/70">{c.authorName}</span>
                <span className="text-[10px] text-ink/30">{new Date(c.createdAt).toLocaleDateString("zh-CN")}</span>
              </div>
              <p className="text-sm leading-6 text-ink/75">{c.content}</p>
            </div>
          ))}
        </div>
      )}

      {comments.length === 0 && (
        <p className="text-sm text-ink/35 italic">还没有读者留言，来写第一条吧。</p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="w-full max-w-md rounded-xl border border-rule bg-[#f5f3ee] p-6 shadow-2xl mx-4">
            <h3 className="font-black text-lg mb-4">写评论</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-ink/50 mb-1">你的昵称</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={30}
                  placeholder="随便起个名字"
                  className="w-full rounded border border-rule bg-white px-3 py-2 text-sm focus:outline-none focus:border-ink/40"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink/50 mb-1">评论内容</label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="写下你对这篇文章的看法..."
                  className="w-full rounded border border-rule bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:border-ink/40"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-ink/50 hover:text-ink transition-colors">取消</button>
              <button
                onClick={submit}
                disabled={loading}
                className="rounded bg-ink px-4 py-2 text-sm font-bold text-paper disabled:opacity-50 hover:bg-ink/80 transition-colors"
              >
                {loading ? "提交中..." : "提交"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
