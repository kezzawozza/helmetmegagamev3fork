// The Xom pass: what a plaything of the god of chance and disorder pays for
// the privilege, once per turn close, forever.
//
// Everyone holding {tag:old-ways-xom} rolls once on the weighted table in
// db/lib/xom.js. Half the time nothing happens; the rest of the time something
// does, and roughly one turn in a hundred it is fatal. Bascinet's numbers,
// unnormalised — see that file on why the table is code and not YAML.
//
// SLOT: right after "dawnAfflictions", before "carry". Every constraint lands
// on that one place, and they are all load-bearing:
//
//   - AFTER expirySweep, because the sweep is a blind deleteMany over
//     expiresTurn and a Seizure (1 turn) or Madness (2) granted before it
//     would be swept the moment it landed. Same rule hungerPass runs under.
//   - AFTER tagExpiry, so a tag that progressed this close is on the sheet
//     before this reads it.
//   - AFTER dyingDeath / catatonicDeath / nukeExplosion / ascension. Anyone
//     they killed is already DEAD, so the ALIVE filter drops them for free and
//     Xom cannot gib a corpse. The bomb wins ties, which is right: a blast is
//     a fact about the map and a god's whim is not.
//   - BEFORE carry. Five rats, a grenade and two bottles is about 11 kg of new
//     weight, and the carry pass has to see it in the same close or
//     Overburdened lands a day late.
//   - BEFORE mood, which pays the night for wherever a character is standing.
//     Somebody Xom moved should pay it where Xom put them.
//
// NOTHING HERE TALKS TO DISCORD (TURN-ENGINE.md §2). The tag grants ride the
// `notices` array into tagExpiryDms like the dawn afflictions do; the three
// outcomes that are Discord-shaped — the teleport, the conversation it opens,
// and the shout — come back as `teleports` / `conversations` / `shouts` for
// db/lib/turnSideEffects.js to carry out after the transaction commits.
//
// NOT IDEMPOTENT, by construction. resolvedPasses is what stops a resumed
// advance re-rolling the table, and it matters more here than anywhere else in
// the engine.
//
// Takes `prisma` as a parameter — see db/lib/dm.js.
const { CATATONIC_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");
const { grantTagSlugs, replaceLowerTiers } = require("./tagWrites");
const { applyDeathToRow } = require("./characterDeath");
const { ROLE_GROUPS } = require("./roleGroups");
const {
  OLD_WAYS_XOM_SLUG,
  FECES_SLUG,
  CAVE_RAT_SLUG,
  RAVENHEART_RED_SLUG,
  GRENADE_SLUG,
  SEIZURE_SLUG,
  MADNESS_SLUG,
  MELEE_LEGENDARY_SLUG,
  RAGE_SLUG,
  XOM_LONELY_LINE,
  XOM_FECES_LINE,
  XOM_MADNESS_LINE,
  pickXomOutcome,
  pickShout,
} = require("./xom");
const { alivePassCharacters } = require("./aliveCharacters");

// The Church and the Order of the Silver Cross, which is who "the Inquisition
// and the clergy" are: the inquisitor seat lives under the Order
// (docs/roles.yaml), and there is no Faction of either name to query. Read off
// ROLE_GROUPS rather than hardcoded here, so the day a third clerical faction
// is added the picker and this both learn about it at once.
const CLERGY_FACTION_SLUGS =
  ROLE_GROUPS.find((group) => group.slug === "clergy")?.factionSlugs ?? [];

// What the holder is told, per outcome. One line each, in the house style the
// dawn afflictions set — the tag in bold, no explanation of the mechanic. This
// is the ONE way a Xom event tells anybody anything: nothing is broadcast to a
// zone, because the tag is `catalog: secret` and a zone-wide post would
// reverse-engineer the whole thing inside two turns and hand the Church a list
// of names.
const NOTICES = {
  feces: XOM_FECES_LINE,
  rats: "Your pack is heavier. Five skinned cave rats, still warm.",
  red: "Two bottles of **Ravenheart Red** you did not buy.",
  grenade: "There is a **Fragmentation Grenade** in your hand.",
  seizure: "The world goes white and comes back wrong. You are having a **Seizure**.",
  rage: "Something opens behind your eyes and does not close. **Rage**.",
  melee: "Your hands know things they were never taught. **Melee (Legendary)**.",
  lonely: "You blink, and you are somewhere else entirely.",
  shout: "You hear your own voice before you decide to use it.",
};

const GIB_REASON = "Xom took an interest.";

async function runXomPass(prisma, turn, { rng = Math.random } = {}) {
  const empty = {
    turnNumber: turn.number,
    rolled: 0,
    outcomes: {},
    notices: [],
    deaths: [],
    teleports: [],
    conversations: [],
    shouts: [],
  };

  const holders = await alivePassCharacters(prisma, {
    where: {
      tags: { some: { tag: { slug: OLD_WAYS_XOM_SLUG } } },
      // A Catatonic character is a player who has stopped answering. Moving
      // them across the map and pinging a live player into a scene with a
      // mannequin produces a scene nobody can play, so the god loses interest
      // in them until they come back.
      NOT: { tags: { some: { tag: { slug: CATATONIC_SLUG } } } },
    },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      discordRoleId: true,
      locationId: true,
      zoneId: true,
      tags: {
        where: { tag: { slug: { in: [MELEE_LEGENDARY_SLUG, RAGE_SLUG] } } },
        select: { tag: { select: { slug: true } } },
      },
    },
  });
  if (holders.length === 0) return empty;

  const madnessTag = await prisma.tag.findUnique({
    where: { slug: MADNESS_SLUG },
    select: { id: true, defaultDurationTurns: true },
  });

  const notices = [];
  const deaths = [];
  const teleports = [];
  const conversations = [];
  const shouts = [];
  const outcomes = {};
  // Two holders can each roll a half-weight outcome in one close. Firing the
  // mass madness twice would double-DM two entire factions and read as a bug,
  // so the first one wins and the second falls through to nothing.
  let massMadnessFired = false;
  let rolled = 0;

  const tell = (character, content) => {
    if (character.discordUserId && content) {
      notices.push({ discordUserId: character.discordUserId, content });
    }
  };

  // `turn.number + 1` and not `turn.number`: this runs while that turn is being
  // CLOSED, and expiryFrom counts its argument as the tag's first LIVE turn.
  // Passing the closing turn would give a 1-turn Seizure zero of them.
  //
  // Returns true only when something actually landed. grantTagSlugs answers []
  // for a slug missing from the catalog and `{ added: 0 }` for a non-stackable
  // tag already held, and announcing either would be a letter about nothing.
  const grant = async (character, slugs) => {
    const granted = await prisma
      .$transaction((tx) => grantTagSlugs(tx, character.id, slugs, turn.number + 1))
      .catch((err) => {
        console.error(`runXomPass: grant ${slugs.join(",")} failed for ${character.id}:`, err.message ?? err);
        return null;
      });
    return Array.isArray(granted) && granted.some((row) => (row.added ?? 0) > 0);
  };

  // Sequential, never Promise.all: applyDeathToRow claims its row
  // conditionally, the teleport writes a locationId that the next holder's
  // target query may read, and massMadnessFired is mutable state.
  for (const character of holders) {
    rolled += 1;
    const held = new Set(character.tags.map((ct) => ct.tag.slug));
    let outcome = pickXomOutcome(rng);

    if (outcome === "madness" && (massMadnessFired || !madnessTag)) outcome = "nothing";

    switch (outcome) {
      case "nothing":
        break;

      case "feces":
        if (await grant(character, [FECES_SLUG])) tell(character, NOTICES.feces);
        else outcome = "nothing";
        break;

      case "rats":
        if (await grant(character, Array(5).fill(CAVE_RAT_SLUG))) tell(character, NOTICES.rats);
        else outcome = "nothing";
        break;

      case "red":
        if (await grant(character, [RAVENHEART_RED_SLUG, RAVENHEART_RED_SLUG])) tell(character, NOTICES.red);
        else outcome = "nothing";
        break;

      case "grenade":
        if (await grant(character, [GRENADE_SLUG])) tell(character, NOTICES.grenade);
        else outcome = "nothing";
        break;

      case "seizure":
        if (await grant(character, [SEIZURE_SLUG])) tell(character, NOTICES.seizure);
        else outcome = "nothing";
        break;

      case "rage":
        // Already Raging: the grant is a no-op on a non-stackable tag, so
        // announcing one would be a letter about nothing.
        if (held.has(RAGE_SLUG)) { outcome = "nothing"; break; }
        if (await grant(character, [RAGE_SLUG])) tell(character, NOTICES.rage);
        else outcome = "nothing";
        break;

      case "melee": {
        if (held.has(MELEE_LEGENDARY_SLUG)) { outcome = "nothing"; break; }
        const done = await prisma
          .$transaction(async (tx) => {
            const tag = await tx.tag.findUnique({
              where: { slug: MELEE_LEGENDARY_SLUG },
              select: { id: true },
            });
            if (!tag) return false;
            // The ladder's own rule (TAGS.md §3): the lower rungs come off, or
            // the sheet carries Melee (Expert) under Melee (Legendary) forever.
            await replaceLowerTiers(tx, character.id, tag.id);
            const granted = await grantTagSlugs(tx, character.id, [MELEE_LEGENDARY_SLUG], turn.number + 1);
            return granted.some((row) => (row.added ?? 0) > 0);
          })
          .catch((err) => {
            console.error(`runXomPass: melee grant failed for ${character.id}:`, err.message ?? err);
            return false;
          });
        if (done) tell(character, NOTICES.melee);
        else outcome = "nothing";
        break;
      }

      case "gib": {
        // Captured before applyDeathToRow nulls it — the thunk still owes
        // Discord this role's deletion.
        const discordRoleId = character.discordRoleId;
        const { claimed } = await applyDeathToRow(prisma, character, {
          turn,
          gib: true,
          content: `${character.name} came apart.`,
        }).catch((err) => {
          console.error(`runXomPass: gib failed for ${character.id}:`, err.message ?? err);
          return { claimed: false };
        });
        if (!claimed) { outcome = "nothing"; break; }
        // The god eats its own: vaporizeTags takes old-ways-xom with
        // everything else, so nobody rolls this table from beyond the grave.
        deaths.push({
          characterId: character.id,
          name: character.name,
          discordUserId: character.discordUserId,
          discordRoleId,
          zoneId: character.zoneId,
          reason: GIB_REASON,
        });
        break;
      }

      case "shout":
        if (!character.locationId) { outcome = "nothing"; break; }
        // The line is chosen here; shout() itself runs in the side-effect
        // thunk, because it claims an AuditLog row and hands back a fan-out
        // that has to be posted. Its gates stay intact — a Mute holder simply
        // does not shout, and one who shouted in the last five minutes has
        // nothing left in the throat.
        shouts.push({
          characterId: character.id,
          discordUserId: character.discordUserId,
          name: character.name,
          locationId: character.locationId,
          text: pickShout(rng),
        });
        tell(character, NOTICES.shout);
        break;

      case "lonely": {
        const target = await pickCompany(prisma, character.id, rng);
        // Nobody else standing anywhere: the god has nothing to work with.
        if (!target) { outcome = "nothing"; break; }
        const from = character.locationId;
        const moved = await prisma.character
          .update({ where: { id: character.id }, data: { locationId: target.locationId } })
          .catch((err) => {
            console.error(`runXomPass: teleport failed for ${character.id}:`, err.message ?? err);
            return null;
          });
        if (!moved) { outcome = "nothing"; break; }
        teleports.push({
          characterId: character.id,
          discordUserId: character.discordUserId,
          name: character.name,
          fromLocationId: from,
          toLocationId: target.locationId,
          toLocationName: target.locationName,
          alive: true,
        });
        conversations.push({
          locationId: target.locationId,
          characterIds: [character.id, target.id],
          name: `${character.name} & ${target.name}`.slice(0, 90),
          line: XOM_LONELY_LINE,
        });
        tell(character, NOTICES.lonely);
        break;
      }

      case "madness": {
        const struck = await strikeTheClergy(prisma, turn, madnessTag);
        if (struck.length === 0) { outcome = "nothing"; break; }
        massMadnessFired = true;
        for (const victim of struck) tell(victim, XOM_MADNESS_LINE);
        break;
      }

      default:
        break;
    }

    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  return { turnNumber: turn.number, rolled, outcomes, notices, deaths, teleports, conversations, shouts };
}

// A random other living character who is standing somewhere. Read fresh per
// teleport rather than from a snapshot taken at the top of the pass, so
// somebody gibbed a moment ago is already gone from the pool.
async function pickCompany(prisma, characterId, rng) {
  const candidates = await alivePassCharacters(prisma, {
    where: { id: { not: characterId }, locationId: { not: null } },
    select: { id: true, name: true, locationId: true, location: { select: { name: true } } },
  });
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(rng() * candidates.length)] ?? candidates[0];
  return { id: pick.id, name: pick.name, locationId: pick.locationId, locationName: pick.location?.name ?? null };
}

// Madness on every living clergy character at once, the roller included — the
// god does not check whose side anybody is on.
//
// Two arms because a character's own faction can drift from the one their seat
// belongs to, and a Set because the two overlap for most people.
//
// Madness is NOT stackable, so a second dose on somebody who already has it is
// a documented no-op that leaves their existing expiresTurn alone. That is the
// right behaviour and deliberate: a second helping of the same madness should
// not extend the first. Don't "fix" it.
async function strikeTheClergy(prisma, turn, madnessTag) {
  if (CLERGY_FACTION_SLUGS.length === 0 || !madnessTag) return [];
  const victims = await alivePassCharacters(prisma, {
    where: {
      OR: [
        { faction: { slug: { in: CLERGY_FACTION_SLUGS } } },
        { role: { faction: { slug: { in: CLERGY_FACTION_SLUGS } } } },
      ],
    },
    select: { id: true, name: true, discordUserId: true },
  });
  if (victims.length === 0) return [];

  const expiresTurn = expiryFrom(turn.number + 1, madnessTag.defaultDurationTurns ?? 2);
  const struck = [];
  for (const victim of victims) {
    const written = await prisma.characterTag
      .createMany({
        data: [{ characterId: victim.id, tagId: madnessTag.id, source: "EVENT", quantity: 1, expiresTurn }],
        skipDuplicates: true,
      })
      .catch((err) => {
        console.error(`runXomPass: madness on ${victim.id} failed:`, err.message ?? err);
        return null;
      });
    if (written) struck.push(victim);
  }
  return struck;
}

module.exports = { runXomPass, CLERGY_FACTION_SLUGS, NOTICES, GIB_REASON };
