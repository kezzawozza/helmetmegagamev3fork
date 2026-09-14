"use client";

// A synopsis, rendered. See docs/systemdocs/ORACLE.md. Third renderer built
// on MESSAGE_PLUGINS, after MarkdownContent (a DM) and DocumentMarkdown (a
// document), same plugins/vocabulary, its own `richtoken` component. Here
// `{char:…}` renders a CONTROL, not a face+name, since clicking pulls
// somebody into the inspector — the click goes through context, not a prop,
// since react-markdown gives no way to thread props to a nested renderer.

import { createContext, useContext, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { MESSAGE_PLUGINS, DISCORD_COMPONENTS, escapeTokenBars } from "@/app/components/markdownPlugins";
import { splitCharPayload } from "@/app/components/messageTokens";
import InfoIcon from "@/app/components/InfoIcon";

const InspectContext = createContext(null);

function CharButton({ payload }) {
  const onInspect = useContext(InspectContext);
  const { id, frozenName } = splitCharPayload(payload);

  // Frozen at write time — a later rename must not rewrite what a past turn's record said.
  const name = frozenName ?? id;

  // No callback (or no id) means no control — fails to a plain word.
  if (!onInspect || !id) return <span>{name}</span>;

  return (
    <button type="button" className="oracle-name" onClick={() => onInspect(id, name, "Moves")}>
      {name}
    </button>
  );
}

function OracleToken({ kind, payload, raw }) {
  if (kind === "char") return <CharButton payload={payload} />;
  if (kind === "info") return <InfoIcon text={payload.trim()} />;
  return raw; // anything else left as written
}

const COMPONENTS = { richtoken: OracleToken, ...DISCORD_COMPONENTS };

export default function OracleMarkdown({ text, onInspect, className }) {
  // Memoised so the whole tree doesn't re-render on every inspector click.
  const value = useMemo(() => onInspect ?? null, [onInspect]);
  if (!text) return null;

  return (
    <InspectContext.Provider value={value}>
      <div className={className}>
        <ReactMarkdown remarkPlugins={MESSAGE_PLUGINS} components={COMPONENTS}>
          {escapeTokenBars(text)}
        </ReactMarkdown>
      </div>
    </InspectContext.Provider>
  );
}
