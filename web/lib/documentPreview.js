import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as mdastToString } from "mdast-util-to-string";

// A plain-text taste of a Markdown document's prose, for the /documents card preview — a <button>,
// so it can't hold DocumentMarkdown.js's interactive chips/links/tables. Tables are dropped, not
// flattened, to avoid noise. {tag:...}/{resource:...} tokens are left literal; ChipText resolves them.
export function toDocumentPreviewText(markdown) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return tree.children
    .filter((node) => node.type !== "table")
    .map((node) => mdastToString(node))
    .join("\n\n");
}
