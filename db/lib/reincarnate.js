// Metempsychosis (a mastery, TAGS.md 4a): the soul does not wait for a body.
//
// A character holding the tag who dies is rolled straight into a new one — a
// random role with a free seat, the ordinary starting budget plus 6, and no
// Curse — instead of going back through the creation wizard as a Cursed
// re-roll limited to Migrant or Bum.
//
// It lives in db/lib rather than beside the wizard because EIGHT callers kill
// people (the dying, catatonic, ascension, nuke and turret passes, the rites,
// and the web's own killCharacter), and every one of them goes through
// db/lib/characterDeath.js#applyDeathToRow. Hanging this off the wizard would
// have covered exactly one of the eight.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { METEMPSYCHOSIS_SLUG } = require("./constants");
const { roleCapacity, isSpawnOnly } = require("./roleCapacity");
const { heldSeatsByRole } = require("./seatCount");
const { effectivePlayerCount } = require("./gameState");
const { parseStartingTag } = require("./startingTags");
const { expiryForGrant } = require("./grantExpiry");
const { seedMemories } = require("./locationVisits");
const { startingMemorySlugs } = require("./startingMemories");
const { formatCharacterName, formatBareName, AGE_MIN } = require("./characterName");
const { removeMemberRole, setGuildNickname } = require("./discordRest");
const { GHOST_ROLE_ID } = require("./roleIds");
const { randomCharacterName } = require("./nameCorpus");
const { GENDERS } = require("./titles");
const { isDynastyMember, DYNASTY_HEAD_SLUG } = require("./dynasty");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { sendDm } = require("./dm");

// What the tag is worth on top of the ordinary budget. Deliberately HALF the
// default `startingTagPoints` of 12 rather than a second full budget: coming
// back is meant to be a second life, not a better one.
const REINCARNATION_BONUS_POINTS = 6;

// The oldest a rolled body comes out. Deliberately SHORT of the catalog's own
// AGE_MAX of 90, which stays what the wizard allows a player to type: a roll
// uniform across the full 18-90 averages 54, and db/lib/concealedIdentity.js
// reads 55 and over as "Old", so half of all reincarnations would have woken
// up elderly where players choosing for themselves almost never do. 18-65
// averages 41 and lands most souls in the broad middle band that gets no age
// adjective at all.
const REINCARNATION_AGE_MAX = 65;

// The points arrive UNSPENT, on Character.tagPoints, because skipping the
// wizard means there is no menu in which to spend them. /store is that menu
// mid-game, and it already spends exactly this column.

// Who the new body turns out to be. A transmigrated soul wakes up as somebody
// ELSE — nothing here is inherited from the corpse, which still has its own
// name, age and gender on it and on its personal Discord role.
//
// Same three rolls web/app/actions.js#startAsLocalPlayer makes, which is the
// other programmatic character creator in the codebase: a uniform gender, then
// a name from db/lib/nameCorpus.js drawn out of the pool that gender names
// (NEUTRAL draws from both). No name-collision check, because the game has
// none: Character.name is a denormalized display mirror rather than a key, and
// the wizard lets two players be Otto today.
//
// Two things are NOT rolled, and both would be bugs if they were:
//
//   * `role.lockedGender` wins. Three reachable seats set it — Baroness
//     (WOMAN), Heir (MAN) and Successor (WOMAN); only the Baron is whitelisted
//     and already excluded by openRoles(). Roll over it and db/lib/titles.js
//     styles a male Baroness off the wrong word.
//   * The dynasty surname is FETCHED, not rolled. Those same three seats wear
//     the living Baron's last name (db/lib/dynasty.js) — "not theirs to type"
//     — so `lastNameLocked` makes the corpus return none and the Baron
//     supplies it. No living Baron, or one who never chose a name, means no
//     last name at all, which is what web/lib/dynasty.js#dynastyLastName
//     already answers in the same situation.
async function rollIdentity(prisma, role) {
  const gender = role.lockedGender ?? GENDERS[Math.floor(Math.random() * GENDERS.length)];
  const lastNameLocked = isDynastyMember(role.slug);
  const { firstName, lastName } = randomCharacterName({ gender, lastNameLocked });

  let surname = lastName;
  // Unreachable while openRoles() excludes the dynasty seats, and kept anyway:
  // it is correct, it is tested, and a GM re-seating somebody by hand is a
  // different door into the same rule.
  if (lastNameLocked) {
    const baron = await prisma.character.findFirst({
      where: { status: "ALIVE", role: { slug: DYNASTY_HEAD_SLUG } },
      select: { lastName: true },
    });
    surname = baron?.lastName ?? null;
  }

  const age = AGE_MIN + Math.floor(Math.random() * (REINCARNATION_AGE_MAX - AGE_MIN + 1));

  // No honorific: one is earned, never rolled.
  return {
    gender,
    age,
    firstName,
    lastName: surname,
    name: formatCharacterName({ honorific: null, firstName, title: null, lastName: surname }),
  };
}

// Every role a soul could land in. Whitelisted seats are excluded (that gate is
// a Discord role the dead player may not hold), and so are spawn-only seats,
// which "can only be spawned, never assigned" — the same two exclusions the
// assignment roll makes.
async function openRoles(prisma, config, state) {
  const roles = await prisma.role.findMany({
    where: { requiresWhitelist: false },
    include: { startingLocation: { include: { zone: true } } },
  });
  // Three exclusions, not two. Whitelisted seats are gated on a Discord role
  // the dead player may not hold, and spawn-only seats "can only be spawned,
  // never assigned" — those two match the assignment roll. The DYNASTY seats
  // are this file's own: Baroness, Heir and Successor are not whitelisted, so
  // without this a coin flip could seat a random dead player in the ruling
  // family, complete with the Baron's surname and the seat's key. That is the
  // largest political event in the game, and it does not get to happen with no
  // human in the loop.
  const selectable = roles.filter((r) => !isSpawnOnly(r) && !isDynastyMember(r.slug));
  const heldById = await heldSeatsByRole(prisma, selectable);
  const playerCount = effectivePlayerCount(config, state);
  return selectable.filter((r) => (heldById.get(r.id) ?? 0) < roleCapacity(r, playerCount));
}

// Returns the new Character row, or null when nothing happened — no tag, no
// Discord user to give the body to, or no seat left in the whole game. Every
// null is a normal outcome, not an error: a player whose soul finds nowhere to
// go is simply dead the ordinary way.
//
// THE CALLER OWNS THE TAG CHECK. db/lib/characterDeath.js counts the holding
// before it flips the status — it has to, because a gib deletes the tag rows
// outright and there would be nothing left to find by the time we got here —
// so re-testing it in this file only ever meant the caller fabricating a `tags`
// array to satisfy a guard it had already passed. Same posture as db/lib/dm.js.
async function reincarnate(prisma, deadCharacter, { turn = null } = {}) {
  const discordUserId = deadCharacter.discordUserId;
  if (!discordUserId) return null;

  // Somebody who already has another living character does not need a body.
  const living = await prisma.character.count({ where: { discordUserId, status: "ALIVE" } });
  if (living > 0) return null;

  // Read off the DATABASE, not off `deadCharacter`: the eight callers pass
  // Character rows of every shape and most select only what they need, so a
  // web-only player would otherwise be read as `undefined` and silently moved
  // onto Discord by dying.
  const previous = await prisma.character
    .findUnique({ where: { id: deadCharacter.id }, select: { webOnly: true } })
    .catch(() => null);

  const [config, state] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { startingTagPoints: true, playerCount: true } }),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { playerCount: true } }).catch(() => null),
  ]);

  const candidates = await openRoles(prisma, config, state);
  if (candidates.length === 0) return null;
  const role = candidates[Math.floor(Math.random() * candidates.length)];

  // The seat's own bonus counts, exactly as it does in the wizard
  // (web/lib/characterCreation.js#computeBudget) — reborn as an Outsider you
  // still get the +4 that role carries. The Cursed penalty deliberately does
  // NOT apply: the soul found a body, so there is no curse to pay for.
  const budget =
    (config?.startingTagPoints ?? 12) + (role.extraStartingPoints ?? 0) + REINCARNATION_BONUS_POINTS;

  // The role's own kit, resolved the way the wizard resolves it: an entry may
  // carry a count ("obol x5"), and the lookup is a set query, so duplicates
  // have to be summed rather than repeated.
  const wanted = new Map();
  for (const entry of role.startingTagSlugs ?? []) {
    const { slug, quantity } = parseStartingTag(entry);
    wanted.set(slug, (wanted.get(slug) ?? 0) + quantity);
  }
  const startingTags = wanted.size
    ? await prisma.tag.findMany({ where: { slug: { in: [...wanted.keys()] } } })
    : [];

  const identity = await rollIdentity(prisma, role);

  // The same row lock the wizard takes, and for the same reason: two deaths
  // resolving in one turn pass must not both land in the last seat.
  const createInSeat = async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role.id} FOR UPDATE`;
    const held = await heldSeatsByRole(tx, [role]);
    if ((held.get(role.id) ?? 0) >= roleCapacity(role, effectivePlayerCount(config, state))) {
      throw new Error("ROLE_FULL");
    }

    const character = await tx.character.create({
      data: {
        discordUserId,
        // A rolled name, gender and age — a new person, not the dead one
        // renamed. See rollIdentity.
        firstName: identity.firstName,
        lastName: identity.lastName,
        name: identity.name,
        gender: identity.gender,
        age: identity.age,
        // Carried across, not defaulted: a player who reads and writes the
        // game on the web must not be silently moved onto Discord by dying.
        webOnly: previous?.webOnly ?? false,
        roleId: role.id,
        roleTitle: role.name,
        factionId: role.factionId,
        // The denormalization contract: every writer of locationId writes
        // location.zoneId in the same statement.
        locationId: role.startingLocationId ?? null,
        zoneId: role.startingLocation?.zoneId ?? null,
        resources: role.startingResources,
        // Unspent, on purpose — see the note on the bonus above.
        tagPoints: budget,
        isLeader: role.grantsLeader,
        isTreasurer: role.grantsTreasurer,
      },
    });

    // expiresTurn has to arrive STAMPED. Nothing backfills it later — the
    // expiry sweep matches on the column — so a timed kit tag written without
    // one is permanent, and would have been permanent only for reincarnated
    // characters. Same expiryForGrant the wizard uses.
    for (const tag of startingTags) {
      await tx.characterTag.create({
        data: {
          characterId: character.id,
          tagId: tag.id,
          source: "GM_GRANT",
          quantity: tag.stackable ? (wanted.get(tag.slug) ?? 1) : 1,
          expiresTurn: await expiryForGrant(tx, tag, turn, {
            characterId: character.id,
            where: "reincarnate",
          }),
        },
      });
    }
    return character;
  };

  let created;
  try {
    // Most callers pass the bare `prisma` singleton, which opens its own
    // transaction here. The staged-arbitration push (db/lib/stagedPush.js)
    // instead passes its own row's transaction client straight through
    // applyDeathToRow — and a transaction client has no `.$transaction` of
    // its own, so `typeof prisma.$transaction` tells the two apart. Reusing
    // the existing transaction is correct, not a fallback: the seat claim and
    // the character/tag rows land atomically with the rest of that staged
    // row either way.
    created =
      typeof prisma.$transaction === "function"
        ? await prisma.$transaction(createInSeat)
        : await createInSeat(prisma);
  } catch (err) {
    if (err.message === "ROLE_FULL") return null;
    throw err;
  }

  // Discord and placement side effects, best-effort — a body that already
  // exists must never be undone by a failed REST call. The personal character
  // role is deliberately NOT minted here: it is a mentionable name token that
  // grants nothing (PROXYING.md 6), the placeholder name is about to be
  // changed anyway, and the channel doctor mints any missing one on the next
  // bot start.
  if (created.locationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: created.id,
      fromLocationId: null,
      toLocationId: created.locationId,
    }).catch((err) => console.error(`Reincarnation placement failed for ${created.id}:`, err.message ?? err));
  }

  // The map this seat wakes up with (db/lib/startingMemories.js). After the
  // transaction so it can read the tags just granted, and after placement,
  // which has already recorded the Location they are standing in — otherwise a
  // reborn character wakes with a fogged map of the town under their feet.
  await seedMemories(
    prisma,
    created,
    startingMemorySlugs(role.slug, new Set(startingTags.map((t) => t.slug))),
  ).catch((err) => console.error(`Reincarnation memories failed for ${created.id}:`, err.message ?? err));

  // Alive again, so the ghost seat comes off and the guild sees the new name —
  // the same two steps db/lib/threatSpawn.js takes when a spawned character
  // brings a dead player back. Both death teardowns already skip a player who
  // is alive again (db/lib/deathTeardown.js#stillAlive), so this is the belt to
  // that braces: the web's killCharacter revokes access BEFORE it writes the
  // death row, which no ordering can guard.
  //
  // The curse itself needs no write — db/lib/curse.js derives it, and this
  // character being ALIVE is already the answer.
  await removeMemberRole(discordUserId, GHOST_ROLE_ID).catch(() => {});
  await setGuildNickname(discordUserId, formatBareName(created)).catch(() => {});

  // Plain, not `-#`: sendDm prefixes every DM with `»` (CLAUDE.md), and a
  // `» -#` line renders as neither — Discord only reads subtext at the start
  // of a line. The chevron IS the DM convention, so this goes out bare.
  await sendDm(
    prisma,
    discordUserId,
    `Your soul automatically found a new body. You feel blessed. You wake as ${created.name}, ` +
      `${identity.age}, the ${role.name} — with ${budget} tag points still to spend.`,
  ).catch((err) => console.error(`Reincarnation DM failed for ${discordUserId}:`, err.message ?? err));

  console.log(
    `Metempsychosis: ${deadCharacter.name} died and came back as ${created.name} (${role.slug}), turn ${turn?.number ?? "?"}.`,
  );
  return created;
}

module.exports = { reincarnate, REINCARNATION_BONUS_POINTS, REINCARNATION_AGE_MAX };
