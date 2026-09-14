// The extension is spelled out, unlike every other import here, so plain node
// can load this file: db/test/chatFormatting.test.js runs the two passes with
// no bundler and no build step.
import wrapRuns from "./chatRuns.js";

// The two things a chat line does that a document never does, as one remark plugin alongside remark-gfm,
// remarkTokens and remarkDiscord in ChatMarkdown.js — `||like this||` a spoiler, `"like this"` quoted speech
// (tinted with --speech, since the words somebody SAID are what a reader scans a wall of narration for).
// BOTH PASSES SCAN SIBLINGS, not one text node — chatRuns.js says why (so `he said "*get out*"` still tints).

// Not greedy, no newlines, capped: an unmatched quote must not swallow the rest of a long message looking for a
// partner. Both curly and straight marks (phone keyboards produce the curly pair without asking).
// `openTight`: a quote opens on a real character, since `he said " ` mid-sentence is punctuation, not speech.
const SPEECH = {
  open: /["“]/,
  close: /["”]/,
  forbidden: /["“”\n]/,
  openTight: true,
  keepDelimiters: true,
  build: (children) => element("span", "speech", children),
};

// Discord's own delimiter. Double pipes, nothing empty inside, and the bars
// themselves are not part of what is hidden.
const SPOILER = {
  open: /\|\|/,
  close: /\|\|/,
  forbidden: /[|\n]/,
  build: (children) => element("chatspoiler", "chat-spoiler", children),
};

function element(hName, className, children) {
  return {
    type: "chatSpan",
    data: { hName, hProperties: { className } },
    children,
  };
}

export default function remarkChat() {
  return (tree) => {
    // Spoilers before speech, so a quote inside a hidden line is still a quote once revealed.
    wrapRuns(tree, SPOILER);
    wrapRuns(tree, SPEECH);
  };
}
