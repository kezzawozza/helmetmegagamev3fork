// The turret ENGINE: everything about an automated gun that does not depend on
// which gun it is. Two of them exist now — the Merchant's, in the Depot ceiling
// (db/lib/depotPass.js), and the Baron's, on the rotor in the Gatehouse yard
// (db/lib/gatehouseTurret.js) — and they differ in only three ways:
//
//   * where they are (a Location slug),
//   * what turns them on (the Depot's needs its generator running too),
//   * and who they spare (the Depot reads the Merchant's face; the Gatehouse
//     spares nobody, which is the whole character of the thing).
//
// Everything else — the sweep at turn end, the roll on arrival, and what a
// bullet actually does to a sheet — is identical, so it lives here once. The
// severity ladder, the armour curve and the weighted draw stay in
// db/lib/depotTurret.js: that file is the ballistics, this one is the trigger.
//
// `rollTurret(tags, source)` ignores `source` entirely now: there is one
// shipped severity table and every turret rolls against it. The Gatehouse
// passing `null` has always worked for that reason, and the Depot's editable
// copy is gone — what a bullet does to a person is a rule, not a knob.
//
// Takes `prisma` as a parameter; see db/lib/dm.js for why.
const { rollTurret } = require("./depotTurret");
const { ARMOR_TAG_FIELDS } = require("./armorValue");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { expiryFrom } = require("./turnFormat");
// Death is decided in one place so the existing death paths and this one cannot
// drift on what it means — the corpse, the archive row, the unequip, the voided
// offers. Required by path: it is deliberately off the barrel.
const { applyDeathToRow } = require("./characterDeath");
const { applyMood } = require("./mood");
const { alivePassCharacters } = require("./aliveCharacters");
const { addToStack } = require("./tagWrites");

// Everything a shot needs off a character. Shared because the sweep and the
// arrival roll must judge the same sheet — `equipped` plus ARMOR_TAG_FIELDS is
// what the armour curve reads, and the concealment fields decide the face.
//
// Miss the armour fields here and combineArmor sees undefined on every piece,
// so the whole guard shoots everyone as if they were naked. It is the one
// silent way this can fail, which is why both field sets are spread from their
// owning modules rather than listed by hand.
const TURRET_CHARACTER_SELECT = {
  id: true,
  name: true,
  discordUserId: true,
  concealed: true,
  // Both owed to the side-effect thunk the moment a shot kills: the personal
  // role has to be deleted and the zone named. Captured here because
  // applyDeathToRow nulls discordRoleId out from under us.
  discordRoleId: true,
  zoneId: true,
  tags: {
    select: {
      equipped: true,
      tag: { select: { slug: true, forcedName: true, ...CONCEALMENT_TAG_FIELDS, ...ARMOR_TAG_FIELDS } },
    },
  },
};

// What the gun sees when it looks at somebody: their PRESENTED name, not their
// papers. Concealment is meant to work against a machine exactly as well as it
// works against a person, which for the Depot means badly — see depotTurret's
// header on why being shot by your own gun is the feature.
function presentedNameOf(character) {
  return presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  }).name;
}

// The turn-end sweep over everyone standing in one location.
//
// `spares` is a predicate over the presented name; omit it and the turret
// shoots everyone it can see, which is the honest default for a gun nobody
// taught to recognise anybody.
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

// Turn a roll into an actual wound. Both triggers land here, so "what a bullet
// does" has one definition; `deathContent` is the only per-turret part, because
// the archive line has to say which gun it was.
async function applyTurretShot(prisma, shot, turn, { deathContent, deathReason }) {
  const { character, severity, tagSlug } = shot;

  if (severity === "dead") {
    // The full death, not a status flip: a corpse on the floor, the archive
    // line, the Discord role owed back. `claimed` is false if something else
    // already killed them this turn, which a resumed pass can legitimately hit.
    const roleId = character.discordRoleId;
    const { claimed } = await applyDeathToRow(prisma, character, { turn, content: deathContent });
    // The `death` entry is the Discord half this pass owes and used to drop on
    // the floor: a turret kill wrote DEAD on the sheet and then left the
    // character holding their personal role, every channel overwrite and their
    // nickname, with no ghost seat. Handed up to db/index.js's side-effect
    // thunk in the same shape the other death passes use.
    return {
      kind: claimed ? "dead" : "graze",
      discordUserId: character.discordUserId,
      death: claimed
        ? {
            characterId: character.id,
            // `id` as well as `characterId`: the turn engine's loop reads the
            // latter, and applyDeathTeardown -> revokeAllCharacterAccess reads
            // the former to clear their private-Room door grants. Missing it
            // is silent — the deleteMany just matches nothing.
            id: character.id,
            name: character.name,
            discordUserId: character.discordUserId,
            discordRoleId: roleId,
            zoneId: character.zoneId,
            // Third person, for the #leave line — the gun's own DM is the
            // second-person half and has already gone out.
            reason: deathReason,
            ownDm: true,
          }
        : null,
    };
  }

  // Being shot at and living is frightening whatever landed (MOOD.md) — a
  // graze is still a machinegun going off at you. Wrapped: the gun must fire
  // whether or not the dial moves.
  await applyMood(prisma, character.id, { kind: "TURRET" }).catch((err) =>
    console.error(`Turret mood failed for ${character.id}:`, err.message ?? err),
  );

  if (!tagSlug) return { kind: "graze", discordUserId: character.discordUserId };

  const tag = await prisma.tag.findUnique({
    where: { slug: tagSlug },
    // `name` so the DM can say what landed. "It does not check who you are
    // first" is good flavour and tells a player nothing about whether they are
    // walking or bleeding out, and they should not have to open the web app to
    // find out which.
    select: { id: true, name: true, defaultDurationTurns: true, stackable: true },
  });
  if (!tag) return { kind: "graze", discordUserId: character.discordUserId };

  const expiresTurn = tag.defaultDurationTurns
    ? expiryFrom(turn.number, tag.defaultDurationTurns)
    : null;

  // The wound ladder is non-stackable, so a second bullet on the same turn does
  // not become "Deep Wound x2" — the existing row stands. addToStack is the
  // shared creator, and it is what charges the wound to the mood (MOOD.md) when, and
  // only when, the row is new.
  await addToStack(prisma, character.id, tag.id, 1, { source: "EVENT", expiresTurn, stackable: false });

  return { kind: "hit", severity, wound: tag.name, discordUserId: character.discordUserId };
}

// The DM one victim gets: the gun's own flavour line, then the plain mechanical
// fact under it.
//
// Those two want to be separate sentences. "It does not check who you are
// first" is the right thing for a machinegun to say and tells a player nothing
// about whether they are walking away or bleeding out — which they then had to
// open the web app to discover. Naming the wound is not flavour, so it does not
// get dressed up as any.
function turretDmFor(lines, outcome) {
  const flavour = lines[outcome.kind === "hit" ? "hit" : outcome.kind] ?? lines.hit;
  if (!outcome.wound) return flavour;
  return `${flavour}\n**${outcome.wound}.**`;
}

// The OTHER trigger: walking in while it is hot.
//
// Called from db/lib/locationMove.js on every arrival, the way
// rollCavingOnArrival is, and deliberately BEFORE that function's
// DISCORD_TOKEN guard — being shot is a database fact and must not depend on
// there being a token to announce it with.
//
// The location check comes FIRST and is deliberately the cheapest thing here:
// this runs on every arrival anywhere in the game, and at 100+ players a turret
// that loaded its own config row first would have every move in Ravenheart
// contending on it. `armed` is a THUNK for the same reason — the Depot's answer
// is a database read, and it must not happen until we know we are at the Depot.
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
  // null, not a { number: null } stand-in: that object is truthy, so
  // corpseMint's `turn ? expiryFrom(turn.number + 1, …)` would take it and rot
  // the body off turn 1.
  const outcome = await applyTurretShot(prisma, shot, turn ?? null, { deathContent, deathReason });
  // `locationId` rides back so the caller can make the noise — announcing is
  // Discord work and lives above the token guard in locationMove.js, well away
  // from the roll itself.
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
