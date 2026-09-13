// What a written sheet is called, and what is scrubbed out of it first.
//
// WHAT A FAILURE HERE MEANS. Two different things, and the second is the one
// that bites.
//
// A sheet's name used to be the constant "A Note" and is now whatever the
// writer typed. `Tag.name` travels everywhere a tag does — the Transfer
// dialog, the Loot panel, a room's Storage readout, the bot's inspect embed,
// a noticeboard listing — and **none of those surfaces knows anything about
// literacy**. So the name is read by everyone who handles the sheet. Leaving
// it blank has to keep giving back the anonymous name, or every sheet written
// in a hurry starts advertising something.
//
// And a paper's name is interpolated straight into Discord messages the bot
// composes — `You put ${tag.name} up.` on a noticeboard, `The bird is away
// with ${tag.name}.` — so a title carrying an "@" is a mention with the
// guild's name on it. cleanCustomText is what takes that out, and the
// assertions below exist so nobody "simplifies" the call site back to a
// trim() the way the book title was written.
const test = require("node:test");
const assert = require("node:assert/strict");
const { paperName, bookName, sealedName, brokenSealName, TITLE_MAX } = require("../lib/paper");
const { cleanCustomText } = require("../lib/customText");

test("no title leaves the sheet anonymous", () => {
  assert.equal(paperName(), "A Note");
  assert.equal(paperName(null), "A Note");
  assert.equal(paperName(undefined), "A Note");
  assert.equal(paperName(""), "A Note");
  // Whitespace is not a title. Without the trim a sheet named " " would show
  // as an empty chip on every surface that renders a tag.
  assert.equal(paperName("   "), "A Note");
});

test("a title is worn bare", () => {
  // No suffix. bookName adds "(a book)" because a book is a kind of object you
  // name; a letter called this is just called this.
  assert.equal(paperName("Orders for the Watch"), "Orders for the Watch");
  assert.equal(paperName("  Orders for the Watch  "), "Orders for the Watch");
});

test("a letter and a book are named differently", () => {
  assert.equal(bookName("Orders"), "Orders (a book)");
  assert.equal(paperName("Orders"), "Orders");
  // And an unnamed one of each says so in its own words.
  assert.equal(bookName(""), "An Untitled Book");
  assert.equal(paperName(""), "A Note");
});

// ── What the action must scrub before it ever reaches paperName ─────────────

test("a mention cannot survive into a title", () => {
  // The failure this prevents: a letter called "@everyone", pinned to a
  // noticeboard, pings the guild from the bot's own confirmation line.
  assert.equal(cleanCustomText("@everyone", TITLE_MAX).includes("@"), false);
  assert.equal(cleanCustomText("ping @here now", TITLE_MAX).includes("@"), false);
});

test("a resource token cannot be formed in a title", () => {
  // {resource:…} bubbles are rendered from tag text on the web
  // (ResourceChip.js), so the braces come out for the same reason.
  const out = cleanCustomText("{resource:coin} for you", TITLE_MAX);
  assert.equal(out.includes("{"), false);
  assert.equal(out.includes("}"), false);
});

test("control characters and runaway whitespace are flattened", () => {
  assert.equal(cleanCustomText("Orders\u0000\u001bfor\tthe   Watch", TITLE_MAX), "Orders for the Watch");
});

test("a title is capped at the length the column and the pickers expect", () => {
  // Discord select-menu labels are sliced to 100 elsewhere; this is the
  // game's own cap and is what the input's maxLength mirrors.
  assert.equal(cleanCustomText("x".repeat(TITLE_MAX + 40), TITLE_MAX).length, TITLE_MAX);
});

test("a title that is nothing but scrubbed characters reads as no title", () => {
  // "@@@" cleans to "" — which must fall through to the anonymous name rather
  // than naming a sheet the empty string.
  assert.equal(paperName(cleanCustomText("@@@", TITLE_MAX) || null), "A Note");
});

// ── Through the wax and back ───────────────────────────────────────────────
//
// WHAT A FAILURE HERE MEANS. A player reported it before this existed: seal a
// letter and its title was gone, so a courier carrying two closed letters
// could only tell them apart by opening one — and opening one breaks the seal
// for good. sealedName now carries the title on the outside and paperName
// rebuilds it from Tag.paperTitle when the wax comes off.

test("a sealed letter wears its title and its wax", () => {
  assert.equal(
    sealedName("Three Cups", "Orders for the Watch"),
    "Orders for the Watch — Sealed Letter (Three Cups)",
  );
});

test("an untitled letter seals exactly as it always did", () => {
  assert.equal(sealedName("Three Cups"), "Sealed Letter (Three Cups)");
  assert.equal(sealedName("Three Cups", null), "Sealed Letter (Three Cups)");
  assert.equal(sealedName("Three Cups", "   "), "Sealed Letter (Three Cups)");
});

test("breaking the seal gives the writer's name back", () => {
  // What breakSeal writes: paperName(sealedTag.paperTitle). The round trip is
  // the whole feature — a title that survived the seal but not the opening
  // would be worse than the old behaviour, not better.
  const title = "Orders for the Watch";
  assert.equal(sealedName("Three Cups", title), `${title} — Sealed Letter (Three Cups)`);
  assert.equal(paperName(title), title);
  // And a letter that was never titled is still an anonymous note afterwards.
  assert.equal(paperName(null), "A Note");
});

test("the envelope left behind wears no title", () => {
  // Envelopes STACK — every one bearing the same wax must read identically, or
  // breakSeal mints a fresh row for every letter anybody opens.
  assert.equal(brokenSealName("Three Cups"), "Broken Seal (Three Cups)");
});
