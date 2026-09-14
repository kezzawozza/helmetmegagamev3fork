"use client";

import ReactMarkdown from "react-markdown";
import { MESSAGE_PLUGINS, DISCORD_COMPONENTS, escapeTokenBars } from "./markdownPlugins";
import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import { useDocuments } from "./DocumentsProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";
import DocumentChip from "./DocumentChip";
import InfoIcon from "./InfoIcon";
import { toString as mdastToString } from "mdast-util-to-string";
import { slugifyHeading } from "@/lib/documentHeadings";

// Renders a <richtoken> node (see remarkTokens.js) the same way RichText renders
// a {kind:payload} token: {tag:...} -> hoverable TagChip, {resource:field:tier} -> ResourceChip.
function RichTokenRenderer({ kind, payload, raw }) {
  const { tagsById, tagsBySlug } = useTags();
  const { rates } = useProductionRates();
  const { docsByKey } = useDocuments();

  if (kind === "tag") {
    const key = payload.trim();
    const tag = tagsById.get(key) ?? tagsBySlug.get(key);
    return tag ? <TagChip tag={tag} /> : raw;
  }

  if (kind === "resource") {
    const [field, tier] = payload.split(":").map((p) => p.trim());
    const rate = rates[field]?.[tier];
    if (!rate) return raw;
    return <ResourceChip value={rate.display} />;
  }

  if (kind === "document") {
    const doc = docsByKey.get(payload.trim());
    return doc ? <DocumentChip doc={doc} /> : raw;
  }

  // {info:some sentence} — a "?" glyph whose payload is the tooltip prose itself, for a footnote.
  if (kind === "info") return <InfoIcon text={payload.trim()} />;

  // {cmd:play} — a slash command as literal text to type. See RichText.js.
  if (kind === "cmd") return <code className="cmd-chip">/{payload.trim()}</code>;

  // {word:crudux cruo} — a Grimoire Word of the Circle (web/lib/grimoire.js) worn as a chip.
  if (kind === "word") return <span className="chip word-chip">{payload.trim()}</span>;

  return raw;
}

function TableRenderer({ node, ...props }) {
  // The page body never scrolls sideways (DESIGN-SYSTEM.md §9). Plain overflow-x-auto, not
  // .table-scroll — that class also clips vertically and pins the header, wrong for a short table.
  return (
    <div className="overflow-x-auto">
      <table className="data-table" {...props} />
    </div>
  );
}

// h1/h2/h3 -> a GitHub-style id, so an authored `[x](#y)` link and the generated sheet
// ToC (documentHeadings.js) land on a real target. Slugged off the mdast node's text,
// not the rendered children, so it matches documentHeadings.js's slug exactly.
function makeHeading(Tag) {
  return function Heading({ node, children, ...props }) {
    const id = node ? slugifyHeading(mdastToString(node)) : undefined;
    return (
      <Tag id={id} {...props}>
        {children}
      </Tag>
    );
  };
}

// A same-document `#anchor` link scrolls the sheet itself by default; this stops the
// browser's own jump (which would move the page behind the modal) and hands off to scrollIntoView.
function AnchorLink({ href, children, ...props }) {
  if (!href?.startsWith("#")) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      {...props}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(href.slice(1))?.scrollIntoView({ block: "start" });
      }}
    >
      {children}
    </a>
  );
}

// Full GFM Markdown plus the {tag:...}/{resource:...} inline tokens, folded into the
// same tree by remarkTokens.js so a token inside a table cell resolves like in prose.
// Never rendered inside a <button> (see DocumentsBoard.js's card preview, which uses
// documentPreview.js's plain-text extraction instead) — TagChip/ResourceChip are
// focusable, and Markdown itself can emit <a>/<table>, none legal inside interactive content.
export default function DocumentMarkdown({ text }) {
  if (!text) return null;

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={MESSAGE_PLUGINS}
        disallowedElements={["img"]}
        unwrapDisallowed
        components={{
          ...DISCORD_COMPONENTS,
          richtoken: RichTokenRenderer,
          table: TableRenderer,
          h1: makeHeading("h1"),
          h2: makeHeading("h2"),
          h3: makeHeading("h3"),
          a: AnchorLink,
        }}
      >
        {escapeTokenBars(text)}
      </ReactMarkdown>
    </div>
  );
}
