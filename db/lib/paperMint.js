// Writing on a sheet, and the two rows that come out of a broken seal.
//
// This is the FOURTH runtime authoring door onto the tag catalog, beside
// docs/tags.yaml, the GM form at /gm/dev/tags, and the corpse/headstone/crate
// minters. Every row it writes carries `custom: true` so db:sync-tags never
// sees it and db:prune-tags skips it, plus `ephemeral: true` so a Restart Game
// sweeps it up — which is the flag a crate and a headstone were both missing
// until this landed. See docs/systemdocs/PAPERWORK.md.
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays off the @lifeweb/db barrel.

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

// Slugified with the `custom-` prefix that keeps a runtime row out of the
// YAML's namespace forever. Unlike a corpse, a sheet has no natural name to
// slugify — two notes by one hand on one day are genuinely different objects —
// so the uniquifier is the character and the clock rather than a suffix.
function customSlug(kind, characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-${kind}-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

const paperSlug = (characterId, attempt) => customSlug("paper", characterId, attempt);
const bookSlug = (characterId, attempt) => customSlug("book", characterId, attempt);
const sealSlug = (characterId, attempt) => customSlug("envelope", characterId, attempt);

// Every runtime paper row wears the same shape. Weightless on purpose: a sheet
// of paper against a carry cap measured in pounds is noise, and CARRY.md's
// band table has a 0 rung for exactly this.
const PAPER_SHAPE = {
  category: "items",
  pointCost: 0,
  custom: true,
  ephemeral: true,
  tradeable: true,
  weightLbs: 0,
  // One sheet is one sheet. Two notes are never the same object, so the
  // non-stackable pin in tagWrites.js is doing real work here.
  stackable: false,
  // Binnable, like every other item (docs/systemdocs/CRAFTING.md §5). This
  // used to be false, on the argument that burning a letter should be said
  // out loud in the fiction — but a player holding a note they cannot put
  // down has no verb for the ordinary case, so the ordinary case wins.
  removable: true,
  purchasable: false,
  purchasableAfterStart: false,
  // A letter in your hand is a letter anyone can see you holding. What it SAYS
  // is a different question, and paperDescription answers that one.
  inspectVisibility: "HIDDEN",
};

// Tag.slug is @unique across the whole catalog, so retry on the violation
// rather than checking first: two players writing in the same millisecond
// would both pass a pre-check and then one would throw. Six attempts is far
// past anything the game can produce. (Tag.name is NOT unique — see
// db/lib/paper.js#paperName — so only the slug is ever what collides.)
//
// Exported, because db/lib/photoMint.js mints runtime rows the same way and a
// second copy of this loop is exactly the drift a shared helper prevents.
//
// ONE TRAP, and it is the caller's to avoid: Postgres aborts an entire
// transaction the moment a statement in it fails, so passing a `tx` here means
// every attempt after the first raises 25P02 instead of retrying. It is safe
// inside a transaction only where a collision is vanishingly unlikely — a
// note's name carries a random waybill code, so paper gets away with it. A
// photo does not (`Photo (Young Man)` is a name the game makes over and over),
// which is why photoMint.js creates its row outside the transaction.
// The Paper group, looked up once per mint. It carries the chip colour, and it
// is also what any future "is this paper?" check should match on — the same
// reason corpses are grouped rather than flagged.
async function paperGroupId(tx) {
  const group = await tx.tagGroup.findUnique({ where: { slug: PAPER_GROUP_SLUG }, select: { id: true } });
  return group?.id ?? null;
}

async function createWithRetry(tx, buildData) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await tx.tag.create({ data: buildData(attempt) });
    } catch (err) {
      // P2002 is the @unique on slug. (Tag.name is no longer unique — see
      // db/lib/paper.js#paperName — so a name can never be what collides.)
      if (err?.code !== "P2002") throw err;
    }
  }
  return null;
}

// A blank sheet becomes a written one: one unit off the stack, one new row on
// the sheet. Returns the new Tag row.
//
// `character` needs { id, name } — the PRESENTED name, resolved by the caller
// through db/lib/presentedIdentity.js, so a Beast's letter is in the Beast's
// hand and a concealed writer does not sign their own name by accident.
async function writeNewPaper(tx, character, blankTagId, text, title = null) {
  await dropCharacterTag(tx, character.id, blankTagId, 1);
  return mintPaperRow(tx, character.id, character.name, text, title);
}

// A sheet out of nowhere, landing in somebody's hands. The GM letter's minter
// (docs/systemdocs/BIRD.md §9) — a God-King has no sheet to take a page off,
// so unlike writeNewPaper there is no blank stack to spend.
//
// `authorName` is free text the GM typed, and it goes on paperAuthor exactly
// like a writer's presented name would. That is the whole feature: the letter
// is FROM somebody, and who that somebody is was never checked against the
// roster in the first place.
async function mintLetterFor(tx, recipientId, authorName, text) {
  return mintPaperRow(tx, recipientId, authorName, text);
}

// The shared core. Mints the row and puts it in `ownerId`'s hands; what it
// deliberately does NOT do is spend anything, so each caller decides what the
// paper cost.
async function mintPaperRow(tx, ownerId, authorName, text, title = null) {
  const tag = await mintUnownedPaper(tx, ownerId, authorName, text, title);
  await addToStack(tx, ownerId, tag.id, 1, {});
  return tag;
}

// The same row, in nobody's hands. A sheet that lands in a room stash or on a
// noticeboard never touches a character, so the owner half of mintPaperRow
// would be a write it then has to undo. `seed` is only the slug's uniquifier —
// any stable-ish string does, and a caller with no character passes whatever
// it has.
// `title` is what the writer called it, already cleaned by the caller. Null or
// blank leaves the sheet anonymous — see db/lib/paper.js#paperName. The two
// callers that mint a sheet with nobody at the keyboard (the GM letter and the
// Research pass) pass none, so those stay "A Note" as they always have.
async function mintUnownedPaper(tx, seed, authorName, text, title = null) {
  const groupId = await paperGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PAPER_SHAPE,
    groupId,
    slug: paperSlug(seed, attempt),
    // What the writer called it, or "A Note". Only the SLUG has to be unique
    // and paperSlug re-rolls it per attempt, so two letters may share a title
    // — which is the point, since two people may both write "Orders".
    name: paperName(title),
    // Kept separately too, because `name` does not survive the sheet's own
    // life: sealing rewrites it and breaking the seal rewrites it again. This
    // is the one copy the title is rebuilt from either way.
    paperTitle: (title ?? "").trim() || null,
    // Never the text. The description column is broadcast to every browser;
    // paperDescription composes what a given reader is allowed to see.
    description: null,
    paperKind: "PAPER",
    paperText: (text ?? "").trim(),
    paperAuthor: authorName,
  }));
  if (!tag) throw new Error("Could not name the paper.");

  return tag;
}

// Writing a blank book: one off the stack, one titled row back, and the text
// is fixed there and then. That last part is the only rule a book has
// that a sheet does not — appendToPaper refuses a BOOK, so what is bound in is
// what it says forever. See docs/systemdocs/PAPERWORK.md.
//
// Unlike a note, a book's NAME is its title and is meant to be read off the
// shelf. That is not the leak a note's title would be: a title is what the
// writer chose to advertise, and the contents still sit behind the literacy
// gate in paperDescription.
//
// `character` needs { id, name } — the PRESENTED name, same as writeNewPaper.
async function bindBook(tx, character, blankTagId, title, text) {
  // One blank book, not ten sheets: the sheets were spent at the craft
  // (docs/tags.yaml `blank-book`).
  await dropCharacterTag(tx, character.id, blankTagId, 1);
  const groupId = await paperGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PAPER_SHAPE,
    groupId,
    slug: bookSlug(character.id, attempt),
    name: attempt ? `${bookName(title)} (${attempt + 1})` : bookName(title),
    paperTitle: (title ?? "").trim() || null,
    // A book has real heft, unlike a sheet — ten of them bound between boards
    // is the first thing in the paper group a carry cap should notice.
    weightLbs: 1.5,
    // And unlike a note, a book is something anyone can see you carrying, the
    // title included. What it SAYS is still paperDescription's question.
    inspectVisibility: "ALWAYS",
    description: null,
    paperKind: "BOOK",
    paperText: (text ?? "").trim(),
    paperAuthor: character.name,
  }));
  if (!tag) throw new Error("Could not name the book.");

  await addToStack(tx, character.id, tag.id, 1, {});
  return tag;
}

// Writing more on a sheet that already has words on it. Append-only, always —
// there is no path anywhere in the game that shortens paperText.
async function appendToPaper(tx, tagId, existingText, addition) {
  return tx.tag.update({
    where: { id: tagId },
    data: { paperText: appendText(existingText, addition) },
  });
}

// Sealing RENAMES THE ROW IN PLACE, the same move a corpse makes when it rots
// (db/lib/corpseRotPass.js). A second row would mean a letter somebody is
// carrying changing hands mid-seal, and a holding to reconcile; renaming means
// the sheet in your hand is the sheet that was always in your hand.
//
// The stamp is NOT consumed. A wax stamp presses as many letters as you have
// wax for, and metering the wax is a system nobody asked for.
async function sealPaper(tx, paperTag, stampTag, { title = null } = {}) {
  return sealWithMark(tx, paperTag, {
    label: sealLabel(stampTag),
    mark: stampTag.sealMark ?? null,
    title,
  });
}

// The same seal, pressed with wax nobody owns. Every mark in the game
// otherwise comes off a real stamp Tag, and that is right for players — a seal
// is a physical object you can be robbed of. A GM letter has no stamp, so it
// says outright what the wax carries, and the mark then flows through
// paperDescription like any other.
async function sealWithMark(tx, paperTag, { label, mark, title = null }) {
  // A sheet that reached the sealer untitled may be labelled here, and only
  // here — once it has a title, the title is the writer's and a second hand
  // does not get to rename it. Same "set once" rule the Write dialog has.
  const kept = (paperTag.paperTitle ?? "").trim();
  const finalTitle = kept || (title ?? "").trim() || null;

  // No retry loop. This touches the name and not the slug, and Tag.name lost
  // its @unique in 20260913010000_paper_name_not_unique, so two letters may
  // share a name and there is nothing left here that can collide.
  return tx.tag.update({
    where: { id: paperTag.id },
    data: {
      // Whose wax is on it is PUBLIC — that is the whole point of sealing a
      // letter — and so is what the writer called it. The name is REBUILT
      // here rather than replaced, and rebuilt again from paperTitle when the
      // seal is broken. It used to be replaced outright, which deleted the
      // title: a courier carrying two sealed letters could then only tell
      // them apart by opening one, and opening one is permanent.
      name: sealedName(label, finalTitle),
      paperTitle: finalTitle,
      paperKind: "SEALED",
      sealMark: mark ?? null,
      // Consuming a sealed letter is how you break the seal.
      consumable: true,
    },
  });
}

// Breaking one. Two writes, and both matter: the letter comes back exactly as
// it was written, and the spent envelope stays behind as evidence that
// somebody opened it and whose wax was on it.
//
// Envelopes STACK. Every envelope bearing the same wax reads identically (no
// "(2)" suffix, and paperDescription composes nothing per-instance — it's
// mark and paperKind, nothing else), so a second one merges into this
// character's existing holding of that mark rather than minting a fresh row
// for every letter they open. Scoped to what THIS character already holds:
// an envelope somebody else is carrying, or one sitting in a room stash, is
// a different object and never matched.
//
// Returns { paper, envelope }.
async function breakSeal(tx, characterId, sealedTag) {
  const label = sealLabel(sealedTag);
  const sealMark = sealedTag.sealMark ?? null;

  // No retry loop: this touches the name and not the slug, and Tag.name is no
  // longer unique (db/lib/paper.js#paperName), so there is nothing left here
  // that can collide.
  const paper = await tx.tag.update({
    where: { id: sealedTag.id },
    data: {
      // Back to whatever the writer called it — or "A Note" if they called it
      // nothing, which is the same anonymous sheet it was before the wax. Who
      // sealed it survives on the envelope, not on the paper.
      name: paperName(sealedTag.paperTitle),
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
      // No "(2)" suffix on a retry: the attempt only re-rolls the slug, which is
      // the unique one, and two envelopes bearing the same wax SHOULD read
      // alike — which is also why the next one merges into this row's stack
      // instead of minting its own.
      name: brokenSealName(label),
      description: null,
      paperKind: "BROKEN_SEAL",
      sealMark,
      // The one paper shape that overrides PAPER_SHAPE's stackable: false —
      // unlike a sheet or a letter, nothing about an envelope varies by which
      // letter it came off, so two of them are the same object.
      stackable: true,
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
  mintUnownedPaper,
  sealWithMark,
  appendToPaper,
  sealPaper,
  breakSeal,
};
