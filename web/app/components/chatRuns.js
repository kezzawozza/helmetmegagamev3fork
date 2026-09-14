// Finding a delimited run that has FORMATTING inside it — e.g. `he said
// "*get out*"` — by scanning a parent's CHILD LIST rather than one string, so
// sibling nodes between opener and closer pass through untouched. A tiny walk
// of our own rather than unist-util-visit, for the reason remarkSubtext.js
// gives — this file imports NOTHING, which is also what lets
// db/test/chatFormatting.test.js load it with no build step.

// Inside code the whole point of the text is that it is literal.
const OPAQUE = new Set(["code", "inlineCode"]);

const text = (value) => ({ type: "text", value });

// How much text a sibling contributes, so a nested emphasis still counts against the length cap.
function textLength(node) {
  if (node.type === "text") return node.value.length;
  if (!Array.isArray(node.children)) return 0;
  let total = 0;
  for (const child of node.children) total += textLength(child);
  return total;
}

// The first closer at or after `startOffset` in child `from`, or null. Gives
// up on a forbidden character, a hard break, or the cap, so one unmatched quote can't swallow the rest.
function findClose(children, from, startOffset, spec) {
  const close = new RegExp(spec.close.source, "g");
  let inner = 0;

  for (let i = from; i < children.length; i += 1) {
    const node = children[i];
    const begin = i === from ? startOffset : 0;

    if (node.type === "text") {
      close.lastIndex = begin;
      const hit = close.exec(node.value);
      const chunk = node.value.slice(begin, hit ? hit.index : node.value.length);
      if (spec.forbidden.test(chunk)) return null;
      inner += chunk.length;
      if (inner > spec.maxInner) return null;
      if (hit) {
        // Nothing between the marks is two marks, not a quote.
        if (inner < 1) return null;
        return { index: i, start: hit.index, end: hit.index + hit[0].length };
      }
      continue;
    }

    if (node.type === "break") return null;

    inner += textLength(node);
    if (inner > spec.maxInner) return null;
  }

  return null;
}

// Speech wants the mark followed by a real character, possibly in the NEXT sibling (never whitespace).
function opensHere(children, index, end, spec) {
  if (!spec.openTight) return true;
  const value = children[index].value;
  if (end < value.length) return !/\s/.test(value[end]);
  return index + 1 < children.length;
}

// The wrapper's children. `keepDelimiters` decides whether the marks go in — speech keeps quotes, a spoiler drops bars.
function runChildren(children, from, open, close, spec) {
  const start = spec.keepDelimiters ? open.start : open.end;
  const end = spec.keepDelimiters ? close.end : close.start;

  if (from === close.index) {
    const only = children[from].value.slice(start, end);
    return only ? [text(only)] : [];
  }

  const inner = [];
  const head = children[from].value.slice(start);
  if (head) inner.push(text(head));
  for (let i = from + 1; i < close.index; i += 1) inner.push(children[i]);
  const tail = children[close.index].value.slice(0, end);
  if (tail) inner.push(text(tail));
  return inner;
}

// One parent's children, with every run wrapped.
function scan(children, spec) {
  const open = new RegExp(spec.open.source, "g");
  const out = [];
  let i = 0;
  let from = 0;

  while (i < children.length) {
    const node = children[i];
    if (node.type !== "text") {
      out.push(node);
      i += 1;
      from = 0;
      continue;
    }

    open.lastIndex = from;
    const mark = open.exec(node.value);
    const hit = mark ? { start: mark.index, end: mark.index + mark[0].length } : null;

    if (!hit) {
      const rest = node.value.slice(from);
      if (rest) out.push(text(rest));
      i += 1;
      from = 0;
      continue;
    }

    const close = opensHere(children, i, hit.end, spec) ? findClose(children, i, hit.end, spec) : null;

    // An opener with no partner is just a character; carry on looking.
    if (!close) {
      out.push(text(node.value.slice(from, hit.end)));
      from = hit.end;
      continue;
    }

    const before = node.value.slice(from, hit.start);
    if (before) out.push(text(before));
    out.push(spec.build(runChildren(children, i, hit, close, spec)));

    i = close.index;
    from = close.end;
    if (from >= children[i].value.length) {
      i += 1;
      from = 0;
    }
  }

  return out;
}

// Walk and wrap every run of `spec` in place. Depth first, children before the parent, so a run built here is never scanned again.
export default function wrapRuns(tree, spec) {
  const full = { maxInner: 400, keepDelimiters: false, openTight: false, ...spec };

  (function walk(node) {
    if (!node || !Array.isArray(node.children) || node.children.length === 0) return;
    if (OPAQUE.has(node.type)) return;
    for (const child of node.children) walk(child);
    node.children = scan(node.children, full);
  })(tree);
}
