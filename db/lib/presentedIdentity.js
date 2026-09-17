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
  // The winning piece's own id, so concealmentFrom() can name the item a body
  // was wearing when it died (Character.deathMaskTagId, db/lib/characterDeath.js).
  id: true,
  name: true,
  concealsIdentity: true,
  concealSprite: true,
  forcesConceal: true,
  // Both halves of the ordering below. equipSlot alone is not enough (a robe
  // and a breastplate share it) and equipLayer alone is not either, now that
  // HEAD carries none.
  equipSlot: true,
  equipLayer: true,
};

// How outermost a concealing piece is, for picking the face the room sees.
//
// This used to be Tag.equipLayer alone, highest wins. That stopped working
// when HEAD became a single unlayered slot: every head piece now has a null
// layer, so all of them tied at 0 and the winner was whichever row the query
// happened to return first — a sprite that could change between two reloads.
//
// It asks the question it always meant: what is on the outside. A head piece
// beats a body one, because a hood covers a face and a breastplate does not,
// and within BODY the Over layer beats Mail.
function concealRank(tag) {
  if (tag?.equipSlot === "HEAD") return 100;
  const layer = Number.isInteger(tag?.equipLayer) ? tag.equipLayer : 0;
  return layer;
}

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

// Returns the OUTERMOST equipped concealing piece (highest concealRank);
// `forced` true if ANY equipped piece forces it. Null when nothing conceals.
// Ties break on name so the answer is stable across reloads rather than left
// to whatever order the rows arrived in.
function concealmentFrom(tags) {
  if (!Array.isArray(tags)) return null;
  let best = null;
  let forced = false;
  for (const entry of tags) {
    if (entry?.equipped !== true) continue;
    const tag = entry?.tag ?? entry;
    if (!tag?.concealsIdentity || !tag?.concealSprite) continue;
    if (tag.forcesConceal) forced = true;
    const rank = concealRank(tag);
    const name = tag.name ?? null;
    const wins = !best
      || rank > best.rank
      || (rank === best.rank && String(name ?? "").localeCompare(String(best.name ?? "")) < 0);
    // tagId is the piece itself, for the one caller that has to remember WHICH
    // item was over the face rather than just that something was.
    if (wins) best = { sprite: tag.concealSprite, rank, name, tagId: entry?.tagId ?? tag?.id ?? null };
  }
  return best ? { sprite: best.sprite, name: best.name ?? null, tagId: best.tagId ?? null, forced } : null;
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

// The columns presentedIdentity() reads, plus the tags it resolves against. Modelled on db/lib/whosHere.js#PRESENT_SELECT minus the role title — hearing somebody yell tells you their name, not what they do.
const PRESENTED_IDENTITY_SELECT = {
  id: true,
  name: true,
  age: true,
  gender: true,
  concealed: true,
  updatedAt: true,
  tags: {
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
    },
    select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// The subject's own row, RE-READ here rather than trusted from the caller — the web's actor() and the bot's selects carry neither age/gender/concealed nor the tags, and growing every call site is exactly what CONCEALMENT_TAG_FIELDS warns against. /ooc learned this the expensive way: it called presentedIdentity() correctly but handed it a four-column row, so the conceal branch never fired and a hooded player's OOC line printed their real name.
// Returns { row, identity } — the row too, because a caller that needs a different SPELLING of the same identity (db/lib/shout.js wants aliasSubject's "a young man", not the Title Case webhook username) would otherwise load it twice. Any failure returns nulls and logs, matching every other identity load: the words still go out, under the plain shape.
async function loadPresentedIdentity(prisma, characterId) {
  try {
    const row = await prisma.character.findUnique({
      where: { id: characterId },
      select: PRESENTED_IDENTITY_SELECT,
    });
    if (!row) return { row: null, identity: null };
    const identity = presentedIdentity(row, {
      forcedName: forcedNameFrom(row.tags),
      concealment: concealmentFrom(row.tags),
    });
    return { row, identity };
  } catch (err) {
    console.error("Presented identity load failed:", err?.message ?? err);
    return { row: null, identity: null };
  }
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
  // Same rule one step further out. `concealed` UNDEFINED means the caller
  // loaded a row without the column, not that the hood is down — and answering
  // that with the real name is how /ooc spent a while outing hooded players
  // (db/lib/ooc.js). Undefined specifically, never falsy: `false` is a real
  // answer, a hood owned and not pulled up, and must stay the real name.
  const unknown = character?.concealed === undefined;
  if (piece && unknown) {
    console.error(
      `presentedIdentity: character ${character?.id ?? "?"} loaded without \`concealed\`; concealing to be safe`,
    );
  }
  if (piece && (piece.forced || character.concealed || unknown)) {
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
  PRESENTED_IDENTITY_SELECT,
  loadPresentedIdentity,
  wasHooded,
  forcedNameFrom,
  rosterName,
  loadForcedName,
  concealmentFrom,
  loadConcealment,
  letterPlaqueFile,
  presentedIdentity,
};
