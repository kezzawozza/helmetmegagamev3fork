// Taking a picture: a runtime authoring door onto the tag catalog, modelled on db/lib/paperMint.js. Every row carries `custom: true` (db:sync-tags/db:prune-tags skip it) and `ephemeral: true` (Restart Game sweeps it).
// A photo lives in the PAPER group for its chip colour only — it carries no `paperKind`, so it can never be written on, sealed, or pinned to a noticeboard.

const { PAPER_GROUP_SLUG, noteCode } = require("./paper");
const { TAG_CATEGORY } = require("./constants");
const { createWithRetry } = require("./paperMint");
const { photoName } = require("./photo");
const { addToStack } = require("./tagWrites");

// Same shape as paperMint.js's customSlug: uniquifier is owner+clock.
function photoSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-photo-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

const PHOTO_SHAPE = {
  category: TAG_CATEGORY.ITEMS,
  pointCost: 0,
  custom: true,
  ephemeral: true,
  tradeable: true,
  // Weightless like paperMint.js. One photo is one photo, so not stackable. Binnable like paper — Destroy is what you do with an unwanted item.
  weightLbs: 0,
  stackable: false,
  removable: true,
  purchasable: false,
  purchasableAfterStart: false,
  // WHO is in it is the secret; an Examine must not show the name.
  inspectVisibility: "HIDDEN",
};

async function photoGroupId(tx) {
  const group = await tx.tagGroup.findUnique({ where: { slug: PAPER_GROUP_SLUG }, select: { id: true } });
  return group?.id ?? null;
}

// createWithRetry is from db/lib/paperMint.js. **Everything below hands it the TOP-LEVEL client, never a transaction** — Postgres aborts on one failed statement, and a name collision here is the NORMAL case, not a freak.

// Second and later photos of the same face get a print code, not a "(2)" suffix — two shots of one man aren't the same as two different men, paperMint.js's reasoning.
function disambiguated(subject, attempt) {
  return attempt === 0 ? photoName(subject) : photoName(`${subject} · ${noteCode()}`);
}

// The row, and nothing else — `db` must be the top-level client. Creating it puts it in nobody's hands (`attachPhoto` does that); an orphaned row costs nothing since it's `ephemeral`.
async function createPhotoRow(db, ownerId, { name, caption, inspectVisibility, subjectCharacterId = null }) {
  const groupId = await photoGroupId(db);

  const tag = await createWithRetry(db, (attempt) => ({
    ...PHOTO_SHAPE,
    groupId,
    slug: photoSlug(ownerId, attempt),
    name: name(attempt),
    // Whose picture it is, for a rite needing "a photograph of the target" (db/lib/riteIngredients.js).
    photoOfCharacterId: subjectCharacterId ?? null,
    // Unlike paper, the description IS the content — no literacy gate on a picture.
    description: caption,
    ...(inspectVisibility ? { inspectVisibility } : {}),
  }));
  if (!tag) throw new Error("Could not name the photo.");
  return tag;
}

// Puts a created row into somebody's hands. Safe inside a transaction.
async function attachPhoto(tx, ownerId, tag) {
  await addToStack(tx, ownerId, tag.id, 1, {});
  return tag;
}

// The whole thing, for the 📸 reaction (spends nothing). `subject` is the PRESENTED name (db/lib/photo.js#photoSubject); `caption` is the frozen readout.
async function mintPhoto(db, ownerId, { subject, caption, subjectCharacterId = null }) {
  const tag = await createPhotoRow(db, ownerId, {
    name: (attempt) => disambiguated(subject, attempt),
    caption,
    subjectCharacterId,
  });
  return attachPhoto(db, ownerId, tag);
}

module.exports = {
  CAMERA_SLUG: "instant-camera",
  mintPhoto,
};
