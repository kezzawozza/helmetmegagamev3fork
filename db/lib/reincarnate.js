// Metempsychosis (a mastery, TAGS.md 4a): a character holding the tag who
// dies is rolled straight into a new one — random role with a free seat, the
// ordinary budget plus 4.
//
// What the tag BUYS is the burial. Everybody else who dies is Cursed until
// somebody puts the body in the ground or carves the name in stone, and a
// cursed player makes no character at all (db/lib/curse.js). This one leaves
// no body to bury and never waits on a mourner. The seat is whatever is
// actually open, same as everyone else gets — in a full game Bum or Migrant,
// since those are the only two that reopen on a death (db/lib/roleCapacity.js).
//
// The new body is granted Metempsychosis again, so the loop never breaks on
// its own, and one more stack of Heightened Psychosis — a pure counter, never
// touched anywhere else, that makes quantity the number of past lives.
// Lives in db/lib because EIGHT callers kill people, all through
// db/lib/characterDeath.js#applyDeathToRow. Takes `prisma` as a parameter and
// stays off the @lifeweb/db barrel, the db/lib/dm.js convention; require it by path.
const { METEMPSYCHOSIS_SLUG, HEIGHTENED_PSYCHOSIS_SLUG } = require("./constants");
const { roleCapacity, isSpawnOnly } = require("./roleCapacity");
const { heldSeatsByRole } = require("./seatCount");
const { effectivePlayerCount } = require("./gameState");
const { parseStartingTag } = require("./startingTags");
const { expiryForGrant } = require("./grantExpiry");
const { seedMemories } = require("./locationVisits");
const { startingMemorySlugs } = require("./startingMemories");
const { formatCharacterName, AGE_MIN } = require("./characterName");
const { closeDeadchatTo } = require("./deadchat");
const { randomCharacterName } = require("./nameCorpus");
const { GENDERS } = require("./titles");
const { isDynastyMember, DYNASTY_HEAD_SLUG } = require("./dynasty");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { sendDm } = require("./dm");

// Half the default `startingTagPoints` of 8, not a second full budget: a
// second life, not a better one.
const REINCARNATION_BONUS_POINTS = 4;

// Short of the catalog's own AGE_MAX of 90 on purpose: a uniform 18-90 roll
// averages 54, and db/lib/concealedIdentity.js reads 55+ as "Old", so half of
// all reincarnations would wake up elderly. 18-49 averages 33 and stays a
// comfortable margin below "Old", landing every soul in the middle band with
// no age adjective.
const REINCARNATION_AGE_MAX = 49;

// Points arrive UNSPENT on Character.tagPoints — no wizard menu to spend
// them in, but /store already spends this column mid-game.

// Who the new body turns out to be: a transmigrated soul wakes up as somebody
// ELSE, nothing inherited from the corpse. A coin flip between MAN and WOMAN —
// a reincarnated soul lands in a body that reads as one or the other, never
// the third pool NEUTRAL draws from. Then a name from db/lib/nameCorpus.js
// gendered off that roll. No name-collision check — Character.name is a
// denormalized display mirror, not a key.
// Two things are NOT rolled: `role.lockedGender` wins (Baroness/Heir/Successor
// set it; rolling over it would style a male Baroness off the wrong word), and
// the dynasty surname is FETCHED from the living Baron (db/lib/dynasty.js),
// never rolled — no living Baron means no last name at all
// (web/lib/dynasty.js#dynastyLastName answers the same way).
const REINCARNATION_GENDERS = GENDERS.filter((g) => g !== "NEUTRAL");
async function rollIdentity(prisma, role) {
  const gender =
    role.lockedGender ??
    REINCARNATION_GENDERS[Math.floor(Math.random() * REINCARNATION_GENDERS.length)];
  const lastNameLocked = isDynastyMember(role.slug);
  const { firstName, lastName } = randomCharacterName({ gender, lastNameLocked });

  let surname = lastName;
  // Unreachable while openRoles() excludes dynasty seats; kept for a GM re-seating by hand.
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

// A role's "starting package" is normally one fixed kit (docs/systemdocs/
// CHARACTERS.md "The starting package"). Commoner is the one seat today that
// offers a CHOICE of kit instead — three tags gated `onlyRoles: [commoner]`
// that all `conflictsWith` each other (docs/tags.yaml). This finds any such
// group generically, off the catalog rather than a hardcoded slug list, so it
// covers Commoner today and whatever role gets a second one tomorrow with no
// code change here.
//
// A lone `onlyRoleSlugs` tag with no conflicting sibling is a role-locked
// PERK, not a package choice, and is left alone — there is nothing to pick
// between, and the wizard doesn't force it on anyone either.
async function pickPackageTags(prisma, roleSlug) {
  const candidates = await prisma.tag.findMany({
    where: { onlyRoleSlugs: { has: roleSlug } },
    select: { id: true, slug: true, pointCost: true, conflictsWith: { select: { id: true } } },
  });
  const seen = new Set();
  const picks = [];
  for (const tag of candidates) {
    if (seen.has(tag.id)) continue;
    const conflictIds = new Set(tag.conflictsWith.map((c) => c.id));
    const group = candidates.filter((t) => t.id === tag.id || conflictIds.has(t.id));
    for (const t of group) seen.add(t.id);
    if (group.length < 2) continue; // nothing to choose between
    picks.push(group[Math.floor(Math.random() * group.length)]);
  }
  return picks;
}

// Heightened Psychosis's whole point (docs/tags.yaml): each stack costs the
// new body 2 points of drawbacks, picked at random from whatever the catalog
// allows for this role and doesn't clash with what it already holds. Granted
// `GM_GRANT` like the rest of the kit, so — same lane TAGS.md 4a already
// describes for the Meister's free Frail — it never touches the player's own
// budget and is invisible to `maxDrawbackTags`/`maxDrawbackPoints`, which only
// count `POINT_BUY` rows.
//
// One random pass, taking whatever still fits and is still compatible: a
// single greedy pass can undershoot `targetPoints` when nothing left fits the
// remainder, but it can never overshoot it, which mirrors how
// `maxDrawbackPoints` itself treats the number — a ceiling, not a quota to
// force. There is no precedent anywhere in this catalog for hunting down an
// exact-sum combination, and inventing one here would be solving a harder
// problem than the tag stops actually need.
async function rollDrawbackTags(prisma, { roleSlug, grantedIds, targetPoints }) {
  if (!(targetPoints > 0)) return [];

  const candidates = await prisma.tag.findMany({
    where: { pointCost: { lt: 0 }, purchasable: true },
    select: {
      id: true,
      slug: true,
      pointCost: true,
      stackable: true,
      exclusive: true,
      groupId: true,
      requiredTagId: true,
      defaultDurationTurns: true,
      onlyRoleSlugs: true,
      excludedRoleSlugs: true,
      conflictsWith: { select: { id: true } },
    },
  });

  // Same two gates the wizard's own point-buy menu applies
  // (web/lib/characterCreation.js#roleExcluded): onlyRoleSlugs is an
  // allowlist when set, excludedRoleSlugs a blocklist, and a tag uses only one.
  const roleOk = (t) =>
    (t.onlyRoleSlugs.length === 0 || t.onlyRoleSlugs.includes(roleSlug)) &&
    !t.excludedRoleSlugs.includes(roleSlug);

  // Held grows as picks land, so a later candidate is checked against
  // everything granted so far — the role kit, Metempsychosis, Heightened
  // Psychosis, any package tag, AND every drawback already accepted this pass.
  const held = new Set(grantedIds);
  const exclusiveGroupsUsed = new Set();
  const picked = [];
  let remaining = targetPoints;

  const shuffled = candidates.filter(roleOk).sort(() => Math.random() - 0.5);
  for (const tag of shuffled) {
    if (remaining <= 0) break;
    const cost = Math.abs(tag.pointCost);
    if (cost > remaining) continue;
    if (held.has(tag.id)) continue; // already granted, or already picked this pass
    if (tag.conflictsWith.some((c) => held.has(c.id))) continue;
    if (tag.requiredTagId && !held.has(tag.requiredTagId)) continue;
    // Same-group exclusivity (web/lib/characterCreation.js#exclusiveConflict),
    // simplified: two exclusive tags in one group never coexist here, chained
    // or not — a soul picking up a second vice mid-creation has no story
    // explaining why the first one was an upgrade rather than a relapse.
    if (tag.exclusive && tag.groupId && exclusiveGroupsUsed.has(tag.groupId)) continue;

    picked.push(tag);
    held.add(tag.id);
    remaining -= cost;
    if (tag.exclusive && tag.groupId) exclusiveGroupsUsed.add(tag.groupId);
  }
  return picked;
}

// Every role a soul could land in: whitelisted and spawn-only seats excluded,
// same as the assignment roll.
async function openRoles(prisma, config, state) {
  const roles = await prisma.role.findMany({
    where: { requiresWhitelist: false },
    include: { startingLocation: { include: { zone: true } } },
  });
  // DYNASTY seats are excluded too: Baroness, Heir and Successor aren't
  // whitelisted, so without this a coin flip could seat a random dead player
  // in the ruling family with no human in the loop.
  const selectable = roles.filter((r) => !isSpawnOnly(r) && !isDynastyMember(r.slug));
  const heldById = await heldSeatsByRole(prisma, selectable);
  const playerCount = effectivePlayerCount(config, state);
  return selectable.filter((r) => (heldById.get(r.id) ?? 0) < roleCapacity(r, playerCount));
}

// Returns the new Character row, or null when nothing happened — no tag, no
// Discord user, or no seat left anywhere. Every null is a normal outcome, not
// an error.
// THE CALLER OWNS THE TAG CHECK: db/lib/characterDeath.js counts the holding
// before it flips the status, since a gib deletes the tag rows outright. Same
// story for `priorPsychosisCount` — it is the dying character's OWN stack,
// read at that same moment for that same reason, and handed in rather than
// re-queried here.
// Same posture as db/lib/dm.js.
async function reincarnate(prisma, deadCharacter, { turn = null, priorPsychosisCount = 0 } = {}) {
  const discordUserId = deadCharacter.discordUserId;
  if (!discordUserId) return null;

  // Somebody who already has another living character does not need a body.
  const living = await prisma.character.count({ where: { discordUserId, status: "ALIVE" } });
  if (living > 0) return null;

  // Read off the DATABASE, not `deadCharacter`: callers pass rows of every
  // shape, so a non-mirrored player could read as `undefined` and be silently moved onto Discord.
  const previous = await prisma.character
    .findUnique({ where: { id: deadCharacter.id }, select: { discordMirrored: true } })
    .catch(() => null);

  const [config, state] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { startingTagPoints: true, playerCount: true } }),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { playerCount: true } }).catch(() => null),
  ]);

  const candidates = await openRoles(prisma, config, state);
  if (candidates.length === 0) return null;
  const role = candidates[Math.floor(Math.random() * candidates.length)];

  // Seat's own bonus counts (web/lib/characterCreation.js#computeBudget), plus
  // the tag's own 4 on top. `let`, because a randomly picked starting package
  // is charged against it further down.
  let budget =
    (config?.startingTagPoints ?? 8) + (role.extraStartingPoints ?? 0) + REINCARNATION_BONUS_POINTS;

  // Role's own kit, resolved like the wizard: entries may carry a count ("obol x5"), summed not repeated.
  const wanted = new Map();
  for (const entry of role.startingTagSlugs ?? []) {
    const { slug, quantity } = parseStartingTag(entry);
    wanted.set(slug, (wanted.get(slug) ?? 0) + quantity);
  }

  // A role that offers a package CHOICE (Commoner's three trade kits today)
  // gets one picked at random rather than left empty — the wizard's own
  // fallback only ever covers Commoner specifically (CHARACTERS.md "The
  // starting package"), and a random pick generalizes it to any future role
  // shaped the same way. Its cost comes straight off the budget, same as a
  // player spending on it themselves; only Commoner's kits are priced today
  // (0/1/2), so `Math.max` is just a floor against a package ever costing
  // more than the base budget, not a rule the current data can trigger.
  const packageTags = await pickPackageTags(prisma, role.slug);
  for (const tag of packageTags) wanted.set(tag.slug, (wanted.get(tag.slug) ?? 0) + 1);
  budget = Math.max(0, budget - packageTags.reduce((sum, t) => sum + t.pointCost, 0));

  // The soul carries two things no role's kit ever lists, which is why these
  // overwrite rather than add: Metempsychosis renewing itself is what makes
  // the loop infinite, and Heightened Psychosis's count is the number of
  // lives spent, not a quantity any role kit gets a vote on.
  const psychosisStacks = priorPsychosisCount + 1;
  wanted.set(METEMPSYCHOSIS_SLUG, 1);
  wanted.set(HEIGHTENED_PSYCHOSIS_SLUG, psychosisStacks);

  const baseTags = await prisma.tag.findMany({ where: { slug: { in: [...wanted.keys()] } } });

  // 2 points of free drawbacks per stack (docs/tags.yaml `heightened-psychosis`).
  const drawbackTags = await rollDrawbackTags(prisma, {
    roleSlug: role.slug,
    grantedIds: baseTags.map((t) => t.id),
    targetPoints: 2 * psychosisStacks,
  });
  const startingTags = [...baseTags, ...drawbackTags];

  const identity = await rollIdentity(prisma, role);

  // Same row lock the wizard takes: two deaths in one turn pass must not both land in the last seat.
  const createInSeat = async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role.id} FOR UPDATE`;
    const held = await heldSeatsByRole(tx, [role]);
    if ((held.get(role.id) ?? 0) >= roleCapacity(role, effectivePlayerCount(config, state))) {
      throw new Error("ROLE_FULL");
    }

    const character = await tx.character.create({
      data: {
        discordUserId,
        // A rolled name, gender, age — a new person, not the dead one renamed. See rollIdentity.
        firstName: identity.firstName,
        lastName: identity.lastName,
        name: identity.name,
        gender: identity.gender,
        age: identity.age,
        // Carried across, not defaulted: dying must not silently move a non-mirrored player onto Discord.
        discordMirrored: previous?.discordMirrored ?? false,
        roleId: role.id,
        roleTitle: role.name,
        // Denormalization contract: every locationId writer also writes zoneId.
        locationId: role.startingLocationId ?? null,
        zoneId: role.startingLocation?.zoneId ?? null,
        // Unspent, on purpose — see the bonus note above.
        tagPoints: budget,
      },
    });

    // expiresTurn must arrive STAMPED — nothing backfills it, and the expiry
    // sweep matches on the column. Same expiryForGrant the wizard uses.
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
    // Most callers pass the bare `prisma` singleton, opening a transaction
    // here. db/lib/stagedPush.js passes its own row's transaction client
    // through instead — it has no `.$transaction`, so `typeof
    // prisma.$transaction` tells the two apart, and reusing it lands the seat
    // claim atomically with the rest of that staged row.
    created =
      typeof prisma.$transaction === "function"
        ? await prisma.$transaction(createInSeat)
        : await createInSeat(prisma);
  } catch (err) {
    if (err.message === "ROLE_FULL") return null;
    throw err;
  }

  // Discord/placement side effects, best-effort — a body must never be undone
  // by a failed REST call. The personal character role is NOT minted here
  // (PROXYING.md 6); the channel doctor mints any missing one at next bot start.
  if (created.locationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: created.id,
      fromLocationId: null,
      toLocationId: created.locationId,
    }).catch((err) => console.error(`Reincarnation placement failed for ${created.id}:`, err.message ?? err));
  }

  // The map this seat wakes with (db/lib/startingMemories.js). After the
  // transaction (reads the tags just granted) and after placement, or the
  // character wakes with a fogged map of the town under their feet.
  await seedMemories(
    prisma,
    created,
    startingMemorySlugs(role.slug, new Set(startingTags.map((t) => t.slug))),
  ).catch((err) => console.error(`Reincarnation memories failed for ${created.id}:`, err.message ?? err));

  // Alive again, so the ghost seat comes off. Belt to
  // db/lib/deathTeardown.js#stillAlive's brace, since the web's killCharacter
  // revokes access BEFORE writing the death row. The curse itself needs no
  // write — db/lib/curse.js derives it from this character being ALIVE.
  await closeDeadchatTo(prisma, discordUserId).catch(() => {});

  // Plain, not `-#`: sendDm's `»` prefix (CLAUDE.md) makes a `» -#` line render as neither.
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

module.exports = {
  reincarnate,
  REINCARNATION_AGE_MAX,
  // Exported for db/test/reincarnateDrawbacks.test.js — both take `prisma` as
  // their first argument, so a test doubles it with a bare `{ tag: { findMany } }`.
  pickPackageTags,
  rollDrawbackTags,
};
