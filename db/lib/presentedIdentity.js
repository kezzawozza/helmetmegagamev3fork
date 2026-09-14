// forced (Tag.forcedName; posts under that initial, never their own face, and
// cannot conceal), concealed (equipped item's alias+sprite), or own. DERIVED, never stored.
const { concealedAlias, isConcealedAlias } = require("./concealedIdentity");

// Fallback plaque: the caller here is a Discord webhook avatar
// (db/lib/discordRest.js), which cannot render the web's question-mark plate.
const UNSLOTTED = { sprite: null, forced: false };
const BLANK_PLAQUE = "/assets/letters/_default.webp";
const HELM_PREFIX = "/assets/helms/"; // a hood's face; see wasHooded.

// Exported so every call site resolving an identity selects the same fields.
const CONCEALMENT_TAG_FIELDS = {
  name: true,
  concealsIdentity: true,
  concealSprite: true,
  forcesConceal: true,
  equipLayer: true,
};

// Forced name off a character's tags; first one wins.
function forcedNameFrom(tags) {
  if (!Array.isArray(tags)) return null;
  for (const entry of tags) {
    const tag = entry?.tag ?? entry;
    const name = tag?.forcedName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

// Label for a roster row already excluding hoods; not a hood-safe helper.
function rosterName(row) {
  return forcedNameFrom(row?.tags) ?? row?.name ?? null;
}

async function loadForcedName(prisma, characterId) {
  const held = await prisma.characterTag.findFirst({
    where: { characterId, tag: { forcedName: { not: null } } },
    select: { tag: { select: { forcedName: true } } },
  });
  return forcedNameFrom(held ? [held] : []);
}

// Returns the OUTERMOST equipped concealing piece (highest Tag.equipLayer);
// `forced` true if ANY equipped piece forces it. Null when nothing conceals.
function concealmentFrom(tags) {
  if (!Array.isArray(tags)) return null;
  let best = null;
  let forced = false;
  for (const entry of tags) {
    if (entry?.equipped !== true) continue;
    const tag = entry?.tag ?? entry;
    if (!tag?.concealsIdentity || !tag?.concealSprite) continue;
    if (tag.forcesConceal) forced = true;
    const layer = Number.isInteger(tag.equipLayer) ? tag.equipLayer : 0;
    if (!best || layer > best.layer) best = { sprite: tag.concealSprite, layer, name: tag.name ?? null };
  }
  return best ? { sprite: best.sprite, name: best.name ?? null, forced } : null;
}

async function loadConcealment(prisma, characterId) {
  const held = await prisma.characterTag.findMany({
    where: { characterId, equipped: true, tag: { concealsIdentity: true } },
    select: {
      equipped: true,
      tag: { select: { ...CONCEALMENT_TAG_FIELDS } },
    },
  });
  return concealmentFrom(held);
}

// The letters/ tile for a name: its upper-cased first letter, or blank plaque.
function letterPlaqueFile(name) {
  const initial = (name?.trim()?.[0] ?? "").toUpperCase();
  return /^[A-Z]$/.test(initial) ? `${initial}.webp` : "_default.webp";
}

// avatarPath is site-relative; the bot prefixes WEB_BASE_URL.
function presentedIdentity(character, { forcedName = null, concealment = undefined } = {}) {
  if (forcedName) {
    return {
      name: forcedName,
      avatarPath: `/assets/letters/${letterPlaqueFile(forcedName)}`,
      alias: forcedName,
      concealed: false,
      forced: true,
    };
  }
  // Fall back to the column alone — errs toward hiding, never toward exposing.
  const piece = concealment === undefined ? (character.concealed ? UNSLOTTED : null) : concealment;
  if (piece && (piece.forced || character.concealed)) {
    const alias = concealedAlias(character);
    return {
      name: alias,
      // The sprite says WHAT is over the face, never who is behind it.
      avatarPath: piece.sprite ? `/assets/helms/${piece.sprite}.webp` : BLANK_PLAQUE,
      alias,
      concealed: true,
      forced: false,
    };
  }
  const version = character.updatedAt?.getTime?.() ?? "";
  return {
    name: character.name,
    avatarPath: `/api/avatar/${character.id}?v=${version}`,
    alias: null,
    concealed: false,
    forced: false,
  };
}

// Hood vs. forced name for an ARCHIVED line, from signals frozen at send time
// (presentedAvatarPath, alias shape); ambiguous reads as a hood, safe to be wrong.
function wasHooded(row, { forcedName = null } = {}) {
  const alias = row?.concealedAlias;
  if (!alias) return false;
  const path = row?.presentedAvatarPath;
  if (typeof path === "string" && path.startsWith(HELM_PREFIX)) return true;
  if (!isConcealedAlias(alias)) return false;
  return forcedName !== alias;
}

module.exports = {
  CONCEALMENT_TAG_FIELDS,
  wasHooded,
  forcedNameFrom,
  rosterName,
  loadForcedName,
  concealmentFrom,
  loadConcealment,
  letterPlaqueFile,
  presentedIdentity,
};
