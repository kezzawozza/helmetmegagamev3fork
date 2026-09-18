// The two halves of a decree — its title and its body — and the one string both
// faces carry them in. A GM's proclamation goes out to a zone's #summary as a
// Discord EMBED (db/lib/decree.js) and is written down as one ArchiveEntry per
// zone, and the feed row has only `content` to put both halves in: the wire
// shape a browser reads is `channelKind` plus `content` and nothing else
// (db/lib/archive.js#feedRowShape). So the row is the title, a blank line, then
// the body, and this module is the only thing that writes or reads that seam.
//
// ZERO REQUIRES, EVER — the same rule db/lib/dmKinds.js and db/lib/dmPolicy.js
// keep, and for the same reason: the decree dialog and web/app/(app)/chat/Feed.js
// are "use client" files, and one require of @lifeweb/db from here would drag
// PrismaClient into the browser bundle.

// Discord's own embed caps, which are what actually decides these. A title
// longer than 256 or a description longer than 4096 is rejected by the API, so
// the dialog counts against the same two numbers the action validates against
// and the composer builds to.
const DECREE_TITLE_MAX = 256;
const DECREE_BODY_MAX = 4096;

// The word under the heading on the web and in the embed's footer. One string,
// so the two faces cannot drift into "Decree" and "Proclamation".
const DECREE_LABEL = "Decree";

// A title is one line. Newlines pasted into it would become the body's first
// paragraph when the row is read back, which is how a heading silently eats a
// sentence.
function normalizeDecreeTitle(raw) {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DECREE_TITLE_MAX);
}

function normalizeDecreeBody(raw) {
  return String(raw ?? "").trim().slice(0, DECREE_BODY_MAX);
}

// The row's `content`. Title, blank line, body — readable as-is in /archive and
// in any reader that has never heard of a decree.
function composeDecree({ title, body } = {}) {
  const head = normalizeDecreeTitle(title);
  const text = normalizeDecreeBody(body);
  if (!head) return text;
  return text ? `${head}\n\n${text}` : head;
}

// The inverse, for a reader drawing the block: the FIRST line is the title and
// everything under it is the body. Split on the first newline rather than on the
// blank line, so a row hand-written with a single break still reads correctly.
function splitDecree(content) {
  const text = String(content ?? "");
  const cut = text.indexOf("\n");
  if (cut === -1) return { title: text.trim(), body: "" };
  return { title: text.slice(0, cut).trim(), body: text.slice(cut + 1).replace(/^\n+/, "") };
}

module.exports = {
  DECREE_TITLE_MAX,
  DECREE_BODY_MAX,
  DECREE_LABEL,
  normalizeDecreeTitle,
  normalizeDecreeBody,
  composeDecree,
  splitDecree,
};
