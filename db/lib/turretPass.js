// The turret ENGINE: everything about an automated gun that doesn't depend on
// which gun it is. Two exist — the Merchant's (db/lib/depotPass.js) and the
// Baron's (db/lib/gatehouseTurret.js) — differing only in where they are, what
// turns them on, and who they spare. Everything else — the turn-end sweep,
// the arrival roll, what a bullet does — lives here once. Severity ladder,
// armour curve and weighted draw stay in db/lib/depotTurret.js: that file is
// the ballistics, this one is the trigger. `rollTurret(tags, source)` ignores
// `source`: one shipped severity table for every turret. Takes `prisma` as a
// parameter; see db/lib/dm.js for why.
const { rollTurret } = require("./depotTurret");
const { ARMOR_TAG_FIELDS } = require("./armorValue");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { expiryFrom } = require("./turnFormat");
// Death is decided in one place so this can't drift from the other death paths. Required by path: deliberately off the barrel.
const { applyDeathToRow } = require("./characterDeath");
const { applyMood } = require("./mood");
const { alivePassCharacters } = require("./aliveCharacters");
const { addToStack } = require("./tagWrites");
const { logSystemTagChange } = require("./tagAudit");

// Everything a shot needs off a character. Shared so the sweep and arrival
// roll judge the same sheet. Miss the armour fields and combineArmor sees
// undefined on every piece, shooting everyone as if naked — the one silent
// failure mode, which is why both field sets are spread from their owning modules.
const TURRET_CHARACTER_SELECT = {
  id: true,
  name: true,
  discordUserId: true,
  concealed: true,
  // Captured here because applyDeathToRow nulls discordRoleId out from under us.
  discordRoleId: true,
  zoneId: true,
  tags: {
    select: {
      equipped: true,
      tag: { select: { slug: true, forcedName: true, ...CONCEALMENT_TAG_FIELDS, ...ARMOR_TAG_FIELDS } },
    },
  },
};

// What the gun sees: PRESENTED name, not papers. Concealment works against a
// machine same as a person — see depotTurret's header on why being shot by
// your own gun is the feature.
function presentedNameOf(character) {
  return presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  }).name;
}

// Turn-end sweep over everyone in one location. `spares` is a predicate over
// the presented name; omit it and the turret shoots everyone it can see.
async function sweepTurretAt(prisma, { locationSlug, tableSource = null, spares = null }) {
  const location = await prisma.location.findUnique({
    where: { slug: locationSlug },
    select: { id: true },
  });
  if (!location) return { shots: [], locationId: null };

  const present = await alivePassCharacters(prisma, {
    where: { locationId: location.id },
    select: TURRET_CHARACTER_SELECT,
  });

  const shots = [];
  for (const character of present) {
    if (spares && spares(presentedNameOf(character))) continue;
    shots.push({ character, ...rollTurret(character.tags, tableSource) });
  }

  return { shots, locationId: location.id };
}

// Turn a roll into an actual wound. Both triggers land here, so "what a
// bullet does" has one definition; `deathContent` is the only per-turret
// part, since the archive line has to say which gun it was.
async function applyTurretShot(prisma, shot, turn, { deathContent, deathReason }) {
  const { character, severity, tagSlug } = shot;

  if (severity === "dead") {
    // Full death, not a status flip: corpse, archive line, Discord role owed
    // back. `claimed` is false if something else already killed them this
    // turn, which a resumed pass can legitimately hit.
    const roleId = character.discordRoleId;
    const { claimed } = await applyDeathToRow(prisma, character, { turn, content: deathContent });
    // Handed up to db/index.js's side-effect thunk, same shape as other death passes.
    return {
      kind: claimed ? "dead" : "graze",
      discordUserId: character.discordUserId,
      death: claimed
        ? {
            characterId: character.id,
            // `id` too: applyDeathTeardown -> revokeAllCharacterAccess reads it for private-Room door grants; missing it silently matches nothing.
            id: character.id,
            name: character.name,
            discordUserId: character.discordUserId,
            discordRoleId: roleId,
            zoneId: character.zoneId,
            // Third person, for the #leave line — the gun's own DM already went out second-person.
            reason: deathReason,
            ownDm: true,
          }
        : null,
    };
  }

  // Being shot at and living is frightening whatever landed (MOOD.md). Wrapped: the gun must fire whether or not the dial moves.
  await applyMood(prisma, character.id, { kind: "TURRET" }).catch((err) =>
    console.error(`Turret mood failed for ${character.id}:`, err.message ?? err),
  );

  if (!tagSlug) return { kind: "graze", discordUserId: character.discordUserId };

  // name so the DM can say what landed.
  const tag = await prisma.tag.findUnique({
    where: { slug: tagSlug },
    select: { id: true, name: true, defaultDurationTurns: true, stackable: true },
  });
  if (!tag) return { kind: "graze", discordUserId: character.discordUserId };

  const expiresTurn = tag.defaultDurationTurns
    ? expiryFrom(turn.number, tag.defaultDurationTurns)
    : null;

  // Non-stackable wound ladder: a second bullet doesn't become "Deep Wound
  // x2". addToStack charges the wound to mood (MOOD.md) only when the row is new.
  await addToStack(prisma, character.id, tag.id, 1, { source: "EVENT", expiresTurn, stackable: false });
  await logSystemTagChange(prisma, {
    system: "turret",
    targetCharacterId: character.id,
    applied: [{ tagId: tag.id, tagName: tag.name, op: "add", quantity: 1 }],
  }).catch((err) => console.error(`Turret pass: tag-change audit failed for ${character.id}:`, err.message ?? err));

  return { kind: "hit", severity, wound: tag.name, discordUserId: character.discordUserId };
}

// The DM one victim gets: the gun's flavour line, then the plain mechanical
// fact under it — kept as separate sentences since naming the wound is not
// flavour and shouldn't be dressed up as any.
function turretDmFor(lines, outcome) {
  const flavour = lines[outcome.kind === "hit" ? "hit" : outcome.kind] ?? lines.hit;
  if (!outcome.wound) return flavour;
  return `${flavour}\n**${outcome.wound}.**`;
}

// The OTHER trigger: walking in while it is hot. Called from
// db/lib/locationMove.js on every arrival, deliberately BEFORE the
// DISCORD_TOKEN guard — being shot is a database fact, not dependent on a
// token to announce it. Location check comes FIRST and is the cheapest thing
// here: this runs on every arrival at 100+ players. `armed` is a THUNK for
// the same reason — the Depot's own database read must wait until we know we're there.
async function rollTurretOnArrivalAt(
  prisma,
  { characterId, toLocationId, turn, locationSlug, armed, tableSource = null, spares = null, deathContent, deathReason },
) {
  const location = await prisma.location.findUnique({
    where: { id: toLocationId },
    select: { slug: true },
  });
  if (location?.slug !== locationSlug) return null;

  const state = typeof armed === "function" ? await armed() : armed;
  if (!state || state.armed === false) return null;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { ...TURRET_CHARACTER_SELECT, status: true },
  });
  if (!character || character.status !== "ALIVE") return null;

  if (spares && spares(presentedNameOf(character), state)) return null;

  const shot = { character, ...rollTurret(character.tags, state.tableSource ?? tableSource) };
  // null, not { number: null }: that object is truthy and would let corpseMint rot the body off turn 1.
  const outcome = await applyTurretShot(prisma, shot, turn ?? null, { deathContent, deathReason });
  // locationId rides back so the caller can announce — Discord work lives above the token guard in locationMove.js.
  return { ...outcome, severity: shot.severity, protection: shot.protection, locationId: toLocationId };
}

module.exports = {
  TURRET_CHARACTER_SELECT,
  presentedNameOf,
  turretDmFor,
  sweepTurretAt,
  applyTurretShot,
  rollTurretOnArrivalAt,
};
