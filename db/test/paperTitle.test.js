// What a written sheet is called, and what is scrubbed out of it first.
// `Tag.name` travels everywhere a tag does — Transfer, Loot, Storage, the
// bot's inspect embed, a noticeboard — and none of those surfaces knows
// anything about literacy, so a blank title must keep giving back "A Note".
// A paper's name is also interpolated straight into Discord messages the bot
// composes, so a title carrying an "@" is a mention with the guild's name on
// it; cleanCustomText takes that out, and these assertions guard against
// simplifying the call site back to a plain trim().
const test = require("node:test");
const assert = require("node:assert/strict");
const { paperName, bookName, sealedName, brokenSealName, TITLE_MAX } = require("../lib/paper");
const { cleanCustomText } = require("../lib/customText");

test("no title leaves the sheet anonymous", () => {
  assert.equal(paperName(), "A Note");
  assert.equal(paperName(null), "A Note");
  assert.equal(paperName(undefined), "A Note");
  assert.equal(paperName(""), "A Note");
  assert.equal(paperName("   "), "A Note"); // whitespace is not a title
});

test("a title is worn bare", () => {
  assert.equal(paperName("Orders for the Watch"), "Orders for the Watch");
  assert.equal(paperName("  Orders for the Watch  "), "Orders for the Watch");
});

test("a letter and a book are named differently", () => {
  assert.equal(bookName("Orders"), "Orders (a book)");
  assert.equal(paperName("Orders"), "Orders");
  assert.equal(bookName(""), "An Untitled Book");
  assert.equal(paperName(""), "A Note");
});

// ── What the action must scrub before it ever reaches paperName ─────────────

test("a mention cannot survive into a title", () => {
  assert.equal(cleanCustomText("@everyone", TITLE_MAX).includes("@"), false);
  assert.equal(cleanCustomText("ping @here now", TITLE_MAX).includes("@"), false);
});

test("a resource token cannot be formed in a title", () => {
  const out = cleanCustomText("{resource:coin} for you", TITLE_MAX);
  assert.equal(out.includes("{"), false);
  assert.equal(out.includes("}"), false);
});

test("control characters and runaway whitespace are flattened", () => {
  assert.equal(cleanCustomText("Orders\u0000\u001bfor\tthe   Watch", TITLE_MAX), "Orders for the Watch");
});

test("a title is capped at the length the column and the pickers expect", () => {
  assert.equal(cleanCustomText("x".repeat(TITLE_MAX + 40), TITLE_MAX).length, TITLE_MAX);
});

test("a title that is nothing but scrubbed characters reads as no title", () => {
  assert.equal(paperName(cleanCustomText("@@@", TITLE_MAX) || null), "A Note");
});

// ── Through the wax and back: sealedName carries the title on the outside,
// paperName rebuilds it from Tag.paperTitle when the wax comes off. ─────────

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
  const title = "Orders for the Watch";
  assert.equal(sealedName("Three Cups", title), `${title} — Sealed Letter (Three Cups)`);
  assert.equal(paperName(title), title);
  assert.equal(paperName(null), "A Note");
});

test("the envelope left behind wears no title", () => {
  assert.equal(brokenSealName("Three Cups"), "Broken Seal (Three Cups)"); // envelopes STACK
});
