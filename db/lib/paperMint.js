// Writing on a sheet, and the rows a broken seal produces. Every row carries
// `custom: true` so db:sync-tags never sees it, plus `ephemeral: true` so a
// Restart Game sweeps it up (docs/systemdocs/PAPERWORK.md). Takes `prisma` (or a tx), stays off the @lifeweb/db barrel.

const { TAG_CATEGORY } = require("./constants");
const {
  PAPER_GROUP_SLUG,
  paperName,
  sealedName,
  brokenSealName,
  appendText,
  sealLabel,
  bookName,
} = require("./paper");
const { addToStack, dropCharacterTag } = require("./tagWrites");

// `custom-` prefix keeps a runtime row out of the YAML's namespace forever;
// uniquified by character and clock, since a sheet has no natural name.
function customSlug(kind, characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-${kind}-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

const paperSlug = (characterId, attempt) => customSlug("paper", characterId, attempt);
const bookSlug = (characterId, attempt) => customSlug("book", characterId, attempt);
const sealSlug = (characterId, attempt) => customSlug("envelope", characterId, attempt);

// Every runtime paper row wears the same shape. Weightless on purpose (CARRY.md's band table has a 0 rung).
const PAPER_SHAPE = {
  category: TAG_CATEGORY.ITEMS,
  pointCost: 0,
  custom: true,
  ephemeral: true,
  tradeable: true,
  weightLbs: 0,
  stackable: false, // one sheet is one sheet; two notes are never the same object.
  removable: true, // binnable, like every other item (docs/systemdocs/CRAFTING.md §5).
  purchasable: false,
  purchasableAfterStart: false,
  inspectVisibility: "HIDDEN", // holding it is visible; what it SAYS is paperDescription's question.
};

// Tag.slug is @unique, so retry on the violation rather than checking first. ONE TRAP: passing a `tx`
// makes every attempt after the first raise 25P02 — safe only where a collision is vanishingly unlikely.
async function paperGroupId(tx) {
  const group = await tx.tagGroup.findUnique({ where: { slug: PAPER_GROUP_SLUG }, select: { id: true } });
  return group?.id ?? null;
}

async function createWithRetry(tx, buildData) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await tx.tag.create({ data: buildData(attempt) });
    } catch (err) {
      if (err?.code !== "P2002") throw err; // P2002 is the @unique on slug.
    }
  }
  return null;
}

// `character` needs { id, name } — the PRESENTED name (db/lib/presentedIdentity.js), so a concealed writer doesn't sign their own name by accident.
async function writeNewPaper(tx, character, blankTagId, text, title = null) {
  await dropCharacterTag(tx, character.id, blankTagId, 1);
  return mintPaperRow(tx, character.id, character.name, text, title);
}

// The GM letter's minter (BIRD.md §9) — no blank stack to spend; `authorName` is free text, never checked against the roster.
async function mintLetterFor(tx, recipientId, authorName, text) {
  return mintPaperRow(tx, recipientId, authorName, text);
}

// Mints and puts it in `ownerId`'s hands; deliberately does NOT spend anything.
async function mintPaperRow(tx, ownerId, authorName, text, title = null) {
  const tag = await mintUnownedPaper(tx, ownerId, authorName, text, title);
  await addToStack(tx, ownerId, tag.id, 1, {});
  return tag;
}

// In nobody's hands (a room stash, a noticeboard). `title` null/blank leaves the sheet anonymous (db/lib/paper.js#paperName).
async function mintUnownedPaper(tx, seed, authorName, text, title = null) {
  const groupId = await paperGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PAPER_SHAPE,
    groupId,
    slug: paperSlug(seed, attempt),
    name: paperName(title), // only the SLUG must be unique; two letters may share a title.
    paperTitle: (title ?? "").trim() || null, // `name` doesn't survive sealing; this is the copy it's rebuilt from.
    description: null, // never the text — paperDescription composes what a given reader may see.
    paperKind: "PAPER",
    paperText: (text ?? "").trim(),
    paperAuthor: authorName,
  }));
  if (!tag) throw new Error("Could not name the paper.");

  return tag;
}

// The text is fixed there and then — appendToPaper refuses a BOOK (PAPERWORK.md). Book's NAME is its title.
async function bindBook(tx, character, blankTagId, title, text) {
  await dropCharacterTag(tx, character.id, blankTagId, 1); // one blank book, not ten sheets.
  const groupId = await paperGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PAPER_SHAPE,
    groupId,
    slug: bookSlug(character.id, attempt),
    name: attempt ? `${bookName(title)} (${attempt + 1})` : bookName(title),
    paperTitle: (title ?? "").trim() || null,
    weightLbs: 1.5, // a book has real heft, unlike a sheet.
    inspectVisibility: "ALWAYS", // title visible too; what it SAYS is still paperDescription's question.
    description: null,
    paperKind: "BOOK",
    paperText: (text ?? "").trim(),
    paperAuthor: character.name,
  }));
  if (!tag) throw new Error("Could not name the book.");

  await addToStack(tx, character.id, tag.id, 1, {});
  return tag;
}

// Append-only, always — no path anywhere in the game shortens paperText.
async function appendToPaper(tx, tagId, existingText, addition) {
  return tx.tag.update({
    where: { id: tagId },
    data: { paperText: appendText(existingText, addition) },
  });
}

// Sealing RENAMES THE ROW IN PLACE (like a corpse rotting). The stamp is NOT consumed.
async function sealPaper(tx, paperTag, stampTag, { title = null } = {}) {
  return sealWithMark(tx, paperTag, {
    label: sealLabel(stampTag),
    mark: stampTag.sealMark ?? null,
    title,
  });
}

// The same seal, pressed with wax nobody owns — a GM letter has no stamp, so it says outright what the wax carries.
async function sealWithMark(tx, paperTag, { label, mark, title = null }) {
  // Untitled may be labelled here, and only here — once titled, a second hand does not get to rename it.
  const kept = (paperTag.paperTitle ?? "").trim();
  const finalTitle = kept || (title ?? "").trim() || null;

  // No retry loop: touches the name, not the slug, and Tag.name is no longer unique.
  return tx.tag.update({
    where: { id: paperTag.id },
    data: {
      name: sealedName(label, finalTitle), // rebuilt from paperTitle, and again when the seal is broken.
      paperTitle: finalTitle,
      paperKind: "SEALED",
      sealMark: mark ?? null,
      consumable: true, // consuming a sealed letter is how you break the seal.
    },
  });
}

// Envelopes STACK — a second one bearing the same wax merges into this character's existing holding. Returns { paper, envelope }.
async function breakSeal(tx, characterId, sealedTag) {
  const label = sealLabel(sealedTag);
  const sealMark = sealedTag.sealMark ?? null;

  // No retry loop: touches the name, not the slug, and Tag.name is no longer unique.
  const paper = await tx.tag.update({
    where: { id: sealedTag.id },
    data: {
      name: paperName(sealedTag.paperTitle), // back to what the writer called it; who sealed it stays on the envelope.
      paperKind: "PAPER",
      sealMark: null,
      consumable: false,
    },
  });

  let envelope = await tx.tag.findFirst({
    where: { paperKind: "BROKEN_SEAL", sealMark, characters: { some: { characterId } } },
  });

  if (envelope) {
    await addToStack(tx, characterId, envelope.id, 1, { stackable: true });
  } else {
    const envelopeGroupId = await paperGroupId(tx);
    envelope = await createWithRetry(tx, (attempt) => ({
      ...PAPER_SHAPE,
      groupId: envelopeGroupId,
      slug: sealSlug(characterId, attempt),
      name: brokenSealName(label), // two envelopes bearing the same wax SHOULD read alike.
      description: null,
      paperKind: "BROKEN_SEAL",
      sealMark,
      stackable: true, // overrides PAPER_SHAPE's false — two envelopes off the same wax are the same object.
    }));
    if (envelope) await addToStack(tx, characterId, envelope.id, 1, { stackable: true });
  }

  return { paper, envelope };
}

module.exports = {
  PAPER_SHAPE,
  createWithRetry,
  writeNewPaper,
  bindBook,
  mintLetterFor,
  // The titled twin of mintLetterFor, which is only this with the title left
  // off. The Slave's contract needs one (db/lib/slaveContract.js).
  mintPaperRow,
  mintUnownedPaper,
  sealWithMark,
  appendToPaper,
  sealPaper,
  breakSeal,
};
