import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as mdastToString } from "mdast-util-to-string";

// GitHub's own heading-slug algorithm. Shared by DocumentMarkdown.js (which must produce the same
// id an authored `[x](#y)` link points at) and getDocumentHeadings below, so the two can never slug the same heading two different ways.
export function slugifyHeading(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      // Each space becomes its own hyphen — NOT collapsed with \s+ — so a removed "&" leaves two dashes.
      .replace(/ /g, "-")
  );
}

export function getDocumentHeadings(markdown, { maxDepth = 3 } = {}) {
  if (!markdown) return [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return tree.children
    .filter((node) => node.type === "heading" && node.depth <= maxDepth)
    .map((node) => {
      const text = mdastToString(node);
      return { depth: node.depth, text, id: slugifyHeading(text) };
    });
}
