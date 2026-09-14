// Paper: what a sheet is, what it says, and who gets to find out. See docs/systemdocs/PAPERWORK.md. A written sheet is a Tag row (`custom: true`/`ephemeral: true`, same shape as a crate or corpse). Its text is PRIVATE — web/lib/referenceData.js#getVisibleTags ships the WHOLE catalog to every browser, so it stays on Tag.paperText (never selected by TAG_CHIP_FIELDS) and is composed here, per request. No Prisma import — both faces compose the same sentence.

const { readBlock } = require("./reading");

// The blank catalog tag. Stackable stock, not a document: carries no paperKind, unlike a written sheet (there is no rubbing out — writing is append-only).
const PAPER_SLUG = "paper";
// The craftable blank book (docs/tags.yaml); writing on one mints a BOOK row.
const BLANK_BOOK_SLUG = "blank-book";

// Where every paper row lives, catalog and runtime alike (same idiom as CORPSE_GROUP_SLUG): a written note is never in docs/tags.yaml, so the GROUP carries the colour.
const PAPER_GROUP_SLUG = "items-paper";


// What the text boxes will take. Here because BOTH faces need it (prisma-free, so a "use client" component may import it); WRITE_MAX is a per-pass cap, BOOK_MAX is the whole thing.
const WRITE_MAX = 2000;
const BOOK_MAX = 12000;
const TITLE_MAX = 60;

const BLANK_LINE = "*Blank paper.*";

// What a book says when you are not holding it — composing its full text for anyone who hasn't picked it up would publish the Library to the whole game.
const CLOSED_BOOK_LINE = "A bound book. You would have to pick it up to read it.";
const SEALED_LINE = "Opening it permanently breaks the seal. This one bears a seal:";
const BROKEN_LINE = "An envelope with a broken seal. The wax looks like:";

const UNMARKED_SEAL = "an unreadable smudge";

function isPaper(tag) {
  return Boolean(tag?.paperKind);
}

function isBook(tag) {
  return tag?.paperKind === "BOOK";
}

// Is this row a wax stamp? A spent envelope also keeps a sealMark (paperMint.js#breakSeal), so the mark alone isn't enough — it must also carry no paperKind (a stamp is stock, a document isn't), the same test isPaper()/isBook() read from the other side.
function isSeal(tag) {
  return Boolean(tag?.sealMark) && !tag?.paperKind;
}

function markOf(tag) {
  return tag?.sealMark || UNMARKED_SEAL;
}

// The sentence THIS viewer sees on THIS row. `viewer` is { tags, phase, indoors }; absent means unable to read — fail closed. A SEALED letter's text is never composed, literate or not — reading it means breaking it (a Consume).
function paperDescription(tag, viewer = null) {
  // The blank catalog tag carries no paperKind, so it falls through to its own authored description (IS BLANK_LINE), kept in docs/tags.yaml rather than special-cased by slug.
  if (!isPaper(tag)) return tag?.description ?? null;

  if (tag.paperKind === "SEALED") {
    return `${SEALED_LINE} ${markOf(tag)}`;
  }
  if (tag.paperKind === "BROKEN_SEAL") {
    return `${BROKEN_LINE} ${markOf(tag)}`;
  }

  const text = (tag.paperText ?? "").trim();
  // `holdsIt` is passed only by callers shipping the whole catalog (web/lib/referenceData.js); elsewhere the row IS the thing in hand, so absent means "yes".
  if (isBook(tag) && viewer?.holdsIt === false) return CLOSED_BOOK_LINE;
  if (!text) return BLANK_LINE;

  const blocked = readBlock(viewer?.tags ?? [], {
    phase: viewer?.phase ?? null,
    indoors: viewer?.indoors ?? true,
  });
  return blocked ?? text;
}

// The same decision as paperDescription, shaped for the web. `plain` says whether it's the paper's own words or a line ABOUT it (flat text, so a refusal can't be dressed up as a letter); PaperSheet.js is the one renderer. Returns null for a non-document.
function paperView(tag, viewer = null) {
  if (!isPaper(tag)) return null;
  const kind = tag.paperKind;
  if (kind === "SEALED") return { kind, text: `${SEALED_LINE} ${markOf(tag)}`, plain: true };
  if (kind === "BROKEN_SEAL") return { kind, text: `${BROKEN_LINE} ${markOf(tag)}`, plain: true };

  const text = (tag.paperText ?? "").trim();
  if (isBook(tag) && viewer?.holdsIt === false) return { kind, text: CLOSED_BOOK_LINE, plain: true };
  if (!text) return { kind, text: BLANK_LINE, plain: false };

  const blocked = readBlock(viewer?.tags ?? [], {
    phase: viewer?.phase ?? null,
    indoors: viewer?.indoors ?? true,
  });
  if (blocked) return { kind, text: blocked, plain: true };
  return { kind, text, plain: false };
}

// THE GM's COPY. Same shape as paperView, no gate at all (PAPERWORK.md §"A GM works the same board": a GM holds no tags, so the ordinary gate would call them illiterate). A separate function rather than a `gm` flag on `viewer` — an absent viewer already means "fail closed" — so it cannot be reached by accident.
function paperViewGm(tag) {
  if (!isPaper(tag)) return null;
  const text = (tag.paperText ?? "").trim();
  // `plain: false` even when blank: BLANK_LINE is markdown italics, drawn on a sheet; a GM never sees a refusal.
  return { kind: tag.paperKind, text: text || BLANK_LINE, plain: false };
}

function paperDescriptionGm(tag) {
  if (!isPaper(tag)) return tag?.description ?? null;
  const text = (tag.paperText ?? "").trim();
  return text || BLANK_LINE;
}

// The title a freshly written sheet wears, or "A Note" if nothing. ANONYMOUS BY DEFAULT, NOT BY FORCE: Tag.name travels everywhere with no literacy check, so the CONTENT stays behind the literacy gate (paperDescription) instead. The caller cleans the text (web/lib/customCraft.js#cleanCustomText) first, since it reaches Discord where an unscrubbed "@everyone" would be a mention.
function paperName(title) {
  const clean = (title ?? "").trim();
  return clean || "A Note";
}

// Two letters, four digits — same shape as a Depot shipment id, so it reads like something stamped on the object rather than a database key. Used by a disguise (db/lib/disguiseMint.js) and a photograph (photoMint.js), where identically named rows in a list are confusing.
const NOTE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

function noteCode(rng = Math.random) {
  const a = NOTE_LETTERS[Math.floor(rng() * NOTE_LETTERS.length)];
  const b = NOTE_LETTERS[Math.floor(rng() * NOTE_LETTERS.length)];
  return `${a}${b}-${String(Math.floor(rng() * 9000) + 1000)}`;
}

// A stamp's SHORT label, for titling letters it closes. The mark is a whole sentence, so this pulls the short form from the stamp's own name: "Wax Seal (Three Cups)" -> "Three Cups". Derived rather than a third authored field.
function sealLabel(stampTag) {
  const name = stampTag?.name ?? "";
  const paren = name.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  const possessive = name.match(/^(.+?)'s\s+Wax\s+Stamp$/i);
  if (possessive) return possessive[1].trim();
  return name.trim() || "an unknown seal";
}

// A book wears its title, unlike a deliberately anonymous note; contents stay gated by paperDescription regardless.
function bookName(title) {
  const clean = (title ?? "").trim();
  return clean ? `${clean} (a book)` : "An Untitled Book";
}

// A closed letter's name: title first, wax after — so a courier with two sealed letters can tell them apart without breaking a seal. Untitled seals to "Sealed Letter (<wax>)".
function sealedName(label, title) {
  const clean = (title ?? "").trim();
  const sealed = `Sealed Letter (${label})`;
  return clean ? `${clean} — ${sealed}` : sealed;
}

// The spent envelope wears NO title: every envelope of one wax reads alike so they can stack (paperMint.js#breakSeal).
function brokenSealName(label) {
  return `Broken Seal (${label})`;
}

// Appending is the only way a sheet ever changes; a blank line between passages keeps two hands (or two days) from running together.
function appendText(existing, addition) {
  const before = (existing ?? "").trim();
  const after = (addition ?? "").trim();
  if (!before) return after;
  if (!after) return before;
  return `${before}\n\n${after}`;
}

module.exports = {
  PAPER_SLUG,
  BLANK_BOOK_SLUG,
  PAPER_GROUP_SLUG,
  WRITE_MAX,
  BOOK_MAX,
  TITLE_MAX,
  CLOSED_BOOK_LINE,
  isPaper,
  isBook,
  isSeal,
  sealLabel,
  bookName,
  paperDescription,
  paperView,
  paperViewGm,
  paperDescriptionGm,
  paperName,
  noteCode,
  sealedName,
  brokenSealName,
  appendText,
};
