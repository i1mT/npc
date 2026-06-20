import React from "react";

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1]) parts.push(<code key={match.index}>{match[1]}</code>);
    else if (match[2]) parts.push(<strong key={match.index}>{match[2]}</strong>);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function MarkdownView({ content, className = "" }: { content: string; className?: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (!listItems.length) return;
    nodes.push(
      <ul key={key++}>
        {listItems.map((item, i) => (
          <li key={i}>
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/35" />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    );
    listItems = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    if (trimmed.startsWith("### ")) {
      flushList();
      nodes.push(<h3 key={key++}>{trimmed.slice(4)}</h3>);
    } else if (trimmed.startsWith("## ")) {
      flushList();
      nodes.push(<h2 key={key++}>{trimmed.slice(3)}</h2>);
    } else if (trimmed.startsWith("# ")) {
      flushList();
      nodes.push(<h1 key={key++}>{trimmed.slice(2)}</h1>);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2));
    } else if (trimmed === "---") {
      flushList();
      nodes.push(<hr key={key++} />);
    } else if (trimmed === "") {
      flushList();
    } else {
      flushList();
      nodes.push(<p key={key++}>{renderInline(trimmed)}</p>);
    }
    i++;
  }
  flushList();

  return <div className={`md-view ${className}`}>{nodes}</div>;
}
