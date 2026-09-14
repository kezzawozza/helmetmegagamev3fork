// The Xom pass: what a plaything of the god of chance and disorder pays for
// the privilege, once per turn close, forever. Everyone holding
// {tag:old-ways-xom} rolls once on the weighted table in db/lib/xom.js —
// unnormalised, see that file on why the table is code not YAML.
//
// SLOT: right after "dawnAfflictions", before "carry" — all load-bearing:
//   - AFTER expirySweep (a blind deleteMany over expiresTurn would sweep a
//     Seizure/Madness the moment it landed; same rule hungerPass runs under).
//   - AFTER tagExpiry, so a tag progressed this close is on the sheet already.
//   - AFTER dyingDeath/catatonicDeath/nukeExplosion/ascension, so Xom cannot gib a corpse.
//   - BEFORE carry, so new weight is seen the same close.
//   - BEFORE mood, so a moved character pays the night where Xom put them.
//
// NOTHING HERE TALKS TO DISCORD (TURN-ENGINE.md §2). Tag grants ride the
// `notices` array into tagExpiryDms; teleport/conversation/shout come back as
// `teleports`/`conversations`/`shouts` for db/lib/turnSideEffects.js to carry
// out after the transaction commits.
//
// NOT IDEMPOTENT, by construction — resolvedPasses stops a resumed advance
// re-rolling the table. Takes `prisma` as a parameter — see db/lib/dm.js.
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

// The Church and the Order of the Silver Cross, who "the Inquisition and the
// clergy" are — no Faction of either name to query, so read off ROLE_GROUPS.
const CLERGY_FACTION_SLUGS =
  ROLE_GROUPS.find((group) => group.slug === "clergy")?.factionSlugs ?? [];

// What the holder is told, per outcome — the ONE way a Xom event tells
// anybody anything. Nothing broadcasts to a zone: the tag is `catalog:
// secret`, and a zone-wide post would hand the Church a list of names.
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
      // Catatonic characters stopped answering — the god loses interest until they come back.
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
  // Firing mass madness twice would double-DM two entire factions; the first wins.
  let massMadnessFired = false;
  let rolled = 0;

  const tell = (character, content) => {
    if (character.discordUserId && content) {
      notices.push({ discordUserId: character.discordUserId, content });
    }
  };

  // `turn.number + 1`, not `turn.number`: this runs while that turn is being
  // CLOSED, and expiryFrom counts its argument as the first LIVE turn.
  // Returns true only when something actually landed — announcing a no-op
  // grant would be a letter about nothing.
  const grant = async (character, slugs) => {
    const granted = await prisma
      .$transaction((tx) => grantTagSlugs(tx, character.id, slugs, turn.number + 1))
      .catch((err) => {
        console.error(`runXomPass: grant ${slugs.join(",")} failed for ${character.id}:`, err.message ?? err);
        return null;
      });
    return Array.isArray(granted) && granted.some((row) => (row.added ?? 0) > 0);
  };

  // Sequential, never Promise.all: applyDeathToRow claims conditionally, a
  // teleport writes locationId the next holder's query may read, massMadnessFired is mutable.
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
        // Already Raging: a no-op grant on a non-stackable tag.
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
            // The ladder's own rule (TAGS.md §3): lower rungs come off, or Melee (Expert) sits under Legendary forever.
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
        // Captured before applyDeathToRow nulls it — the thunk still owes Discord this role's deletion.
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
        // The god eats its own: vaporizeTags takes old-ways-xom too, so nobody rolls this from beyond the grave.
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
        // Line chosen here; shout() itself runs in the side-effect thunk (it claims an AuditLog row). Gates stay intact — Mute or a recent shout still blocks it.
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
        // Nobody else standing anywhere.
        const target = await pickCompany(prisma, character.id, rng);
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

// A random other living character standing somewhere. Read fresh per
// teleport, not from a snapshot, so a just-gibbed character is already gone.
async function pickCompany(prisma, characterId, rng) {
  const candidates = await alivePassCharacters(prisma, {
    where: { id: { not: characterId }, locationId: { not: null } },
    select: { id: true, name: true, locationId: true, location: { select: { name: true } } },
  });
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(rng() * candidates.length)] ?? candidates[0];
  return { id: pick.id, name: pick.name, locationId: pick.locationId, locationName: pick.location?.name ?? null };
}

// Madness on every living clergy character at once, roller included — the
// god does not check sides. Two arms because a character's own faction can
// drift from their seat's. NOT stackable, so a second dose on someone who
// already has it is a documented no-op leaving expiresTurn alone. Don't "fix" it.
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
