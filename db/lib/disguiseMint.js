// The Disguise Kit's one verb: for three turns you wear a name that isn't yours. FIFTH runtime
// authoring door onto the tag catalog (alongside docs/tags.yaml, /gm/dev/tags, the corpse/headstone/
// crate minters, and db/lib/paperMint.js, whose row shape and retry loop this borrows wholesale).
// A MINTED ROW, not a column: Tag.forcedName already does this job (db/lib/presentedIdentity.js#forcedNameFrom),
// so every identity surface picks it up free and the expiry sweep in db/index.js clears it later.
// Consequence: the character posts under a letter plaque, and /conceal refuses while it's on.
// ONE EDGE, not worth a mechanism: forcedNameFrom takes the FIRST tag with a forcedName, so Apex Form
// + a disguise together is undefined. Takes `prisma` (or a tx), db/lib/dm.js convention, off the barrel.

const { PAPER_SHAPE, createWithRetry } = require("./paperMint");
const { addToStack } = require("./tagWrites");
const { NAME_LIMITS } = require("./characterName");
const { noteCode } = require("./paper");
const { expiryForGrant } = require("./grantExpiry");

const DISGUISE_KIT_SLUG = "disguise-kit";
const DISGUISE_TURNS = 3;

// Same uniquifier paperMint uses: Tag.slug is @unique, and the `custom-` prefix keeps a runtime row
// out of the YAML's namespace, so db:sync-tags never sees it and db:prune-tags skips it.
function disguiseSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-disguise-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

// The name a player typed, trimmed and capped like every other first name. Null for anything unusable
// — a server action is a public endpoint and the dialog's maxlength is a hint, not a lock.
function normalizeDisguiseName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return name.slice(0, NAME_LIMITS.firstName);
}

// Every disguise row wears the paper shape with three changes: not tradeable, removable (a player can
// drop the act early), and carries the forcedName that does the actual work. The NAME varies per
// attempt too (not forced by a constraint, kept for GM readability — db/lib/photoMint.js#disambiguated
// is the same answer); a retry appends a note code, not "(2)". inspectVisibility is HIDDEN, so nobody
// reads the real name off a 🔍.
function disguiseData(characterId, name, attempt) {
  const label = attempt === 0 ? name : `${name} · ${noteCode()}`;
  return {
    ...PAPER_SHAPE,
    tradeable: false,
    removable: true,
    weightLbs: null,
    slug: disguiseSlug(characterId, attempt),
    name: `Disguised (${label})`,
    description: `You're disguised as ${name}.`,
    forcedName: name,
    defaultDurationTurns: DISGUISE_TURNS,
  };
}

// Mint the row and put it on the character. `openTurn` is the open Turn row — expiryForGrant stamps
// the absolute turn the sweep matches on; WITHOUT it the disguise is PERMANENT (TAGS.md §5: every
// grant path must stamp expiresTurn). Runs OUTSIDE a transaction — Postgres aborts on the first failed
// statement, so a retry loop inside a `tx` raises 25P02 instead of retrying (see paperMint.js).
async function mintDisguise(prisma, characterId, name, openTurn) {
  const tag = await createWithRetry(prisma, (attempt) => disguiseData(characterId, name, attempt));
  if (!tag) return null;
  await addToStack(prisma, characterId, tag.id, 1, {
    source: "GM_GRANT",
    expiresTurn: await expiryForGrant(prisma, tag, openTurn, {
      characterId,
      where: "mintDisguise",
    }),
  });
  return tag;
}

// What the caller checks before offering the button: a disguise already live. One at a time — a
// second would leave two forcedName rows racing.
async function activeDisguise(prisma, characterId) {
  return prisma.characterTag.findFirst({
    where: { characterId, tag: { forcedName: { not: null }, slug: { startsWith: "custom-disguise-" } } },
    select: { id: true, tagId: true, tag: { select: { id: true, name: true, forcedName: true } } },
  });
}

module.exports = {
  DISGUISE_KIT_SLUG,
  DISGUISE_TURNS,
  normalizeDisguiseName,
  mintDisguise,
  activeDisguise,
};
