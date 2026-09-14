// Discord's `-#` subtext, as its own plugin — this is Discord's SYNTAX, not a styling choice, so every surface
// that reads text written for Discord needs it. Separate from remarkDiscord because it must run block-level on
// RAW text, before any inline pass cuts a paragraph into element children — so it goes first in every plugin list.

// The prefix, at the start of a line. Discord treats `-#` per LINE not per block, so every line of a
// multi-line paragraph is stripped, not just the first — same rule db/lib/ambientLine.js writes by.
const SUBTEXT_LINE = /^-#[ \t]?/;

// A tiny walk of our own rather than unist-util-visit, which is here only as a transitive dependency.
function walk(node, visit) {
  visit(node);
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walk(child, visit);
}

// True when this paragraph opens with `-#`, judged on the FIRST text child only.
function opensAsSubtext(node) {
  const first = node.children?.[0];
  return first?.type === "text" && SUBTEXT_LINE.test(first.value ?? "");
}

export default function remarkSubtext() {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type !== "paragraph" || !opensAsSubtext(node)) return;
      for (const child of node.children ?? []) {
        if (child.type !== "text" || typeof child.value !== "string") continue;
        child.value = child.value
          .split("\n")
          .map((line) => line.replace(SUBTEXT_LINE, ""))
          .join("\n");
      }
      node.data = {
        ...(node.data ?? {}),
        hName: "div",
        hProperties: { className: "chat-subtext" },
      };
    });
  };
}
