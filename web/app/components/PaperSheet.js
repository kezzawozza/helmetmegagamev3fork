"use client";

import ChatMarkdown from "./ChatMarkdown";

// The one way a paper's words are drawn on the web (docs/systemdocs/PAPERWORK.md §3): a serif block with its own
// ground and the writer's markdown. `paper` is db/lib/paper.js#paperView's shape: { kind, text, plain }. When `plain`
// is set the text is ABOUT the paper and is drawn flat and italic, never as markdown, so a player cannot forge a
// refusal into a letter. The server decided that; this component only draws it.
export default function PaperSheet({ paper, className = "" }) {
  if (!paper?.text) return null;
  return (
    <div className={`paper-sheet ${className}`.trim()} data-kind={paper.kind ?? undefined}>
      {paper.plain ? <p className="paper-sheet-plain">{paper.text}</p> : <ChatMarkdown content={paper.text} />}
    </div>
  );
}
