// What each rite DOES once it fires (docs/systemdocs/THANATI.md §4). One
// handler per rite key, run by db/lib/riteSweep.js AFTER the attempt is
// claimed and its floor eaten, on the top-level client (not inside that
// transaction) since a rite kills, revives, teleports and mints, each its
// own guarded write with Discord calls beside it. Every line the room or a
// player hears is Bascinet's, verbatim and unsigned. A handler returns
// { result }, or { awaiting: "zone" } when unfinished until the room answers
// (Panic). Takes `db` as a parameter, the db/lib/dm.js convention.
const { createGuildRole } = require("./discordRest");
const { roomLine, locationLine } = require("./placeLine");
const { sendDm } = require("./dm");
const { aliasSubject } = require("./concealedIdentity");
const { applyDeathToRow } = require("./characterDeath");
const { applyDeathTeardown } = require("./deathTeardown");
const { deleteCorpseFor } = require("./corpseMint");
const { pickRandomPublicRoom } = require("./roomStash");
const { record, BURN } = require("./economyLedger");
const { characterRoleAppearance } = require("./characterRoleAppearance");
const { formatBareName } = require("./characterName");
const { STUPID_SLUG } = require("./babble");
const { HUNGERLESS_SLUG } = require("./constants");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { grantTagSlugs, addToRoomStack, dropRoomTag, dropCharacterTag, clampEquippedQuantity, recordSpentTagMoney } = require("./tagWrites");
const { createWithRetry } = require("./paperMint");
const { resolveSeatConflicts, describeSeatConflicts } = require("./seatConflicts");
const { listObjectives, fulfillObjectives } = require("./objectives");
const { setMood, MOOD_MIN } = require("./mood");
const { normalizeChant, containsPhrase } = require("./rites");
const { closeDeadchatTo } = require("./deadchat");
const { BOUND_SLUG, onHallowedGround } = require("./riteIngredients");
const { broadcastToZones } = require("./worldBroadcast");
// roomStash's addRoomResources, NOT resourceStack's. The bare stack writer moves
// the ⬢ and books nothing; this one records the ledger row and the CLAMP
// shortfall. A rite minting ⬢ onto a floor is real money appearing out of
// nowhere, and reconciliation checks every account against its ledger sum —
// unbooked, it reads as that floor drifting.
const { addRoomResources } = require("./roomStash");
const {
  THANATI_SLUG,
  THANATI_LEADER_SLUG,
  SCRYING_EYE_SLUG,
  SHIMMERING_ROBES_SLUG,
  GHOUL_SLUG,
  SERVANT_SLUG,
  RAGE_SLUG,
  BULLET,
} = require("./thanati");

const FLESH_SLUG = "flesh-of-tzchernobog";
const MADNESS_SLUG = "madness";
// Fulfillment's rate and Ascension's fuse — matched on purpose: two turns is
// how long the town gets to stop a doomsday before.
const FULFILLMENT_PER_OBJECTIVE = 100;
const ASCENSION_DELAY_TURNS = 2;
// What a sacrifice or Judgement leaves behind (db/lib/mutilate.js's part list).
const REMAINS_SLUGS = Object.freeze(["eye", "tongue", "hand", "foot", "stomach", "heart"]);
// Universal line for a rite with nothing more interesting to say. Flavoured
// lines (eyeball, shimmering robes, rising corpse) stay — those are what the
// rite made, not the floor going.
const INGREDIENTS_CONSUMED = "The ingredients evaporate into dust.";

// What the two gibbing rites tell their victim — kept here so Bascinet can
// rewrite them in one place.
const SACRIFICE_DEATH_REASON =
  "You were laid out on the cult's floor and opened up. Your body burst into a puddle of organs and gore.";
const JUDGEMENT_DEATH_REASON =
  "Something looked at your likeness and decided against you. You exploded into mist.";
const ANIMATED_LINE = "This weapon is animated! It is indestructible, it cuts through armor, and it heals its targets whenever it harms someone.";

const log = (what) => (err) => console.error(`Rite: ${what} failed:`, err?.message ?? err);
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// ---- Lines -----------------------------------------------------------------

// roomLine/locationLine live in db/lib/placeLine.js (also used by kissing),
// re-exported below so callers here and in riteChant.js are unchanged. Both
// halves are catch-wrapped there: the floor is eaten by the time a handler
// speaks, so a throw would cost the circle its ingredients — Panic worse
// still, since it speaks and only then returns `awaiting`.

async function dmParticipants(db, participants, text) {
  for (const p of participants) {
    if (!p.discordUserId) continue;
    await sendDm(db, p.discordUserId, text, { source: "rite" }).catch(log(`DM to ${p.name}`));
  }
}

// ---- Bodies ----------------------------------------------------------------

// A death by rite: the row (db/lib/characterDeath.js) then the same Discord
// teardown as an automatic death. Returns `{ claimed, corpse }`: `claimed:
// false` means somebody else killed them first (e.g. inside the two-minute
// grace) so the rite must not take credit; `corpse: null` with `claimed:
// true` just means minting failed, and the kill still counts.
async function killByRite(db, character, { turn = null, reason = null, content = null, gib = false } = {}) {
  const roleId = character.discordRoleId;
  const { claimed, corpse } = await applyDeathToRow(db, character, {
    turn,
    gib,
    content: content ?? `${character.name} died.`,
  });
  if (!claimed) return { claimed: false, corpse: null };
  // roleId is passed rather than read off `character`, which applyDeathToRow just nulled.
  const { member } = await applyDeathTeardown(db, { ...character, discordRoleId: roleId });
  if (member) {
    // The reason matters here more than anywhere else: a rite kills off-screen.
    await sendDm(db, character.discordUserId, `You have died.${reason ? `\n${reason}` : ""}`, {
      source: "rite",
    }).catch(log(`death DM for ${character.name}`));
  }
  return { claimed: true, corpse: corpse ?? null };
}

// Reanimation's other half: the dead stand up as a Ghoul in the rite room's
// Location, and get Discord presence back like a spawn does
// (db/lib/threatSpawn.js#applySpawnSideEffects).
async function reviveByRite(db, dead, { location, turnNumber }) {
  await db.$transaction(async (tx) => {
    await tx.character.update({
      where: { id: dead.id },
      data: { status: "ALIVE", buriedAt: null, deathMaskTagId: null, locationId: location.id, zoneId: location.zoneId },
    });
    await grantTagSlugs(tx, dead.id, [GHOUL_SLUG, SERVANT_SLUG, HUNGERLESS_SLUG], turnNumber);
  });
  await deleteCorpseFor(db, dead.id).catch(log(`corpse cleanup for ${dead.name}`));
  // The BARE name (db/lib/characterName.js) — a title would rename the role out of its signature.
  try {
    const { name, color } = characterRoleAppearance(formatBareName(dead));
    const role = await createGuildRole({ name, color, hoist: false, mentionable: true, permissions: "0" });
    await db.character.update({ where: { id: dead.id }, data: { discordRoleId: role.id } });
  } catch (err) {
    log(`role for ${dead.name}`)(err);
  }
  await closeDeadchatTo(db, dead.discordUserId).catch(() => {});
  // No nickname write here: the game never touches a member's Discord nickname.
  await applyLocationMoveSideEffects(db, { characterId: dead.id, fromLocationId: null, toLocationId: location.id }).catch(
    log(`placement for ${dead.name}`),
  );
}

// 2–7 parts, 1–2 Flesh, 2–5 ⬢ — what a body comes apart into. `room` needs { id }.
async function spawnRemains(db, room, { flesh = true, resources = true } = {}) {
  const slugs = [...REMAINS_SLUGS, FLESH_SLUG];
  const tags = await db.tag.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const byId = new Map(tags.map((t) => [t.slug, t.id]));
  const spawned = {};
  await db.$transaction(async (tx) => {
    const parts = rand(2, 7);
    for (let i = 0; i < parts; i += 1) {
      const slug = REMAINS_SLUGS[Math.floor(Math.random() * REMAINS_SLUGS.length)];
      if (!byId.has(slug)) continue;
      await addToRoomStack(tx, room.id, byId.get(slug), 1);
      spawned[slug] = (spawned[slug] ?? 0) + 1;
    }
    if (flesh && byId.has(FLESH_SLUG)) {
      const n = rand(1, 2);
      await addToRoomStack(tx, room.id, byId.get(FLESH_SLUG), n);
      spawned[FLESH_SLUG] = n;
    }
    if (resources) {
      const n = rand(2, 5);
      // ⬢ on the floor are a stack like the parts and the Flesh beside them,
      // so this is the same kind of write as the addToRoomStack calls above.
      await addRoomResources(tx, room.id, n, { reason: "RITE_GRANT" });
      spawned.resources = n;
    }
  });
  return spawned;
}

// Take the one thing a rite spends off whoever holds it, and REFUSE if it's
// gone — the resolve ran two minutes ago and somebody may have picked it up
// since. Throwing inside the caller's transaction rolls the whole effect back.
async function spendFromHolder(tx, holder, tagId, what) {
  if (holder.kind === "room") {
    // dropRoomTag returns an OBJECT with ok:false, not a throw — test the field, not the call.
    if (!(await dropRoomTag(tx, holder.id, tagId, 1)).ok) throw new Error(`the ${what} is gone`);
    return;
  }
  // dropCharacterTag is fire-and-forget, so the guarded decrement is done by hand here.
  const { count } = await tx.characterTag.updateMany({
    where: { characterId: holder.id, tagId, quantity: { gte: 1 } },
    data: { quantity: { decrement: 1 } },
  });
  if (count === 0) throw new Error(`the ${what} is gone`);
  await tx.characterTag.deleteMany({ where: { characterId: holder.id, tagId, quantity: { lte: 0 } } });
  await clampEquippedQuantity(tx, holder.id, tagId);
  // Booked by hand since the guarded decrement above skipped dropCharacterTag's ledger hook.
  await recordSpentTagMoney(tx, { kind: "character", id: holder.id, name: holder.name ?? null }, tagId, 1, {
    reason: "RITE_COST",
    secret: true,
  });
}

async function grantToFloor(db, room, slug, quantity = 1) {
  const tag = await db.tag.findUnique({ where: { slug }, select: { id: true } });
  if (!tag) throw new Error(`no ${slug} tag — run db:sync-tags`);
  await addToRoomStack(db, room.id, tag.id, quantity);
}

// ---- The handlers ----------------------------------------------------------

const EFFECTS = {
  async initial({ db, participants }) {
    const objectives = await listObjectives(db, { partyKey: "thanati" });
    const lines = objectives.map((o, i) => `Objective ${i + 1}: ${o.description}. ${o.done ? "Success!" : "Incomplete"}`);
    const text = ["These are the objectives of the cult.", ...lines].join(" ");
    await dmParticipants(db, participants, text);
    return { result: { told: participants.length, objectives: objectives.length } };
  },

  async conversion({ db, room, resolved, openTurn }) {
    const target = resolved.boundPerson;
    const thanati = await db.tag.findUnique({ where: { slug: THANATI_SLUG }, select: { id: true } });
    // An Assign by another road, so it gets the same clear-out (THREATS.md §3) — and must TELL them.
    let conflicts = null;
    await db.$transaction(async (tx) => {
      await grantTagSlugs(tx, target.id, [THANATI_SLUG], openTurn?.number ?? null);
      if (thanati) conflicts = await resolveSeatConflicts(tx, target.id, [thanati.id]);
      await fulfillObjectives(tx, { partyKey: "thanati", kinds: ["convert-character", "convert-leader"], targetCharacterId: target.id });
    });
    await sendDm(
      db,
      target.discordUserId,
      [
        "This reality is cursed! You are now loyal to the Thanati and must follow the cult's orders. Read your Documents for more information.",
        conflicts && describeSeatConflicts(conflicts),
      ].filter(Boolean).join("\n"),
      { source: "rite" },
    ).catch(log(`conversion DM to ${target.name}`));
    await roomLine(db, room, `${aliasSubject(target)}'s eyes widen as they begin to understand…`);
    return { result: { converted: target.name, characterId: target.id } };
  },

  async sacrifice({ db, room, resolved, openTurn }) {
    const victim = resolved.boundPerson;
    // KILL FIRST, then bank: `claimed: false` means someone else already killed them (e.g. the grace window), so the cult isn't paid twice.
    const { claimed } = await killByRite(db, victim, {
      turn: openTurn,
      gib: true,
      content: `${victim.name} was sacrificed on the Thanati floor.`,
      reason: SACRIFICE_DEATH_REASON,
    });
    if (!claimed) {
      await roomLine(db, room, INGREDIENTS_CONSUMED);
      return { result: { sacrificed: null, characterId: victim.id, alreadyDead: true } };
    }
    await fulfillObjectives(db, {
      partyKey: "thanati",
      kinds: ["sacrifice-living", "sacrifice-leader", "sacrifice-inquisitor-or-baron"],
      targetCharacterId: victim.id,
    });
    // The gib minted no corpse, so the organs on the floor are all that's left of them.
    const spawned = await spawnRemains(db, room);
    await roomLine(db, room, "The sacrifice explodes into a puddle of organs and gore!");
    return { result: { sacrificed: victim.name, characterId: victim.id, spawned } };
  },

  async scrying({ db, room }) {
    await grantToFloor(db, room, SCRYING_EYE_SLUG, 1);
    await roomLine(db, room, "The food transforms into a cursed eyeball…");
    return { result: { yielded: SCRYING_EYE_SLUG } };
  },

  async possession({ db, room, resolved }) {
    const source = resolved.weapon;
    const animated = await createWithRetry(db, (attempt) => ({
      slug: `custom-animated-${source.slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${attempt ? `-${attempt}` : ""}`,
      name: `${source.name} (Animated)`,
      description: `${source.description ?? ""} ${ANIMATED_LINE}`.trim(),
      category: source.category,
      groupId: source.groupId,
      pointCost: 0,
      custom: true,
      ephemeral: true,
      tradeable: source.tradeable,
      weightLbs: source.weightLbs,
      equippable: source.equippable,
      equipSlot: source.equipSlot,
      equipLayer: source.equipLayer,
      twoHanded: source.twoHanded,
      requiredTagId: source.requiredTagId,
      miningBonus: source.miningBonus ?? undefined,
      inspectVisibility: source.inspectVisibility,
      meleeArmor: source.meleeArmor,
      ballisticArmor: source.ballisticArmor,
      stackable: false,
      removable: false,
      purchasable: false,
      purchasableAfterStart: false,
    }));
    if (!animated) throw new Error("could not name the animated weapon");
    // Checked drop: without it a player who grabbed the weapon during the grace window keeps the original AND gets an indestructible copy.
    await db.$transaction(async (tx) => {
      await spendFromHolder(tx, { kind: "room", id: room.id }, source.id, "weapon");
      await addToRoomStack(tx, room.id, animated.id, 1);
    });
    await roomLine(db, room, `${source.name} shimmers brilliantly!`);
    return { result: { animated: animated.name, from: source.slug } };
  },

  async reanimation({ db, room, location, resolved, openTurn }) {
    const { dead } = resolved.corpse;
    await reviveByRite(db, dead, { location, turnNumber: openTurn?.number ?? null });
    await roomLine(db, room, "The corpse rises, ready to fight!");
    return { result: { risen: dead.name, characterId: dead.id } };
  },

  async stupidity({ db, room, resolved, grantTurnNumber }) {
    const { target, holder, tag } = resolved.photograph;
    await db.$transaction(async (tx) => {
      await grantTagSlugs(tx, target.id, [STUPID_SLUG], grantTurnNumber);
      await spendFromHolder(tx, holder, tag.id, "photograph");
    });
    await roomLine(db, room, INGREDIENTS_CONSUMED);
    return { result: { target: target.name, characterId: target.id } };
  },

  async omniscience({ db, room, resolved, participants }) {
    const { target, holder, tag } = resolved.photograph;
    const subject = await db.character.findUnique({
      where: { id: target.id },
      select: { name: true, tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { name: true } } } } },
    });
    const names = (subject?.tags ?? []).map((ct) => ct.tag.name).sort((a, b) => a.localeCompare(b));
    const text = `Their name is ${subject?.name ?? target.name}.\nTheir tags are: ${names.length ? names.join(BULLET) : "Nothing."}`;
    await dmParticipants(db, participants, text);
    await db.$transaction(async (tx) => {
      await spendFromHolder(tx, holder, tag.id, "photograph");
    });
    await roomLine(db, room, INGREDIENTS_CONSUMED);
    return { result: { target: target.name, told: participants.length, tags: names.length } };
  },

  async summoning({ db, location }) {
    // Ropes or shackles (db/lib/bind.js#RESTRAINT_SLUGS): a summoned cultist comes out of either.
    const restraints = await db.tag.findMany({ where: { slug: { in: [BOUND_SLUG, "shackled"] } }, select: { id: true } });
    const cultists = await db.character.findMany({
      where: { status: "ALIVE", tags: { some: { quantity: { gt: 0 }, tag: { slug: THANATI_SLUG } } } },
      select: { id: true, name: true, locationId: true, location: { select: { slug: true } } },
    });
    const moved = [];
    for (const c of cultists) {
      if (c.locationId === location.id || onHallowedGround(c.location)) continue;
      await db.$transaction(async (tx) => {
        await tx.character.update({ where: { id: c.id }, data: { locationId: location.id, zoneId: location.zoneId, escortedById: null } });
        for (const r of restraints) await dropCharacterTag(tx, c.id, r.id);
      });
      await applyLocationMoveSideEffects(db, { characterId: c.id, fromLocationId: c.locationId, toLocationId: location.id }).catch(
        log(`summoning placement for ${c.name}`),
      );
      moved.push(c.name);
    }
    return { result: { summoned: moved } };
  },

  async panic({ db, room }) {
    await roomLine(db, room, `${INGREDIENTS_CONSUMED} Name a zone.`);
    return { awaiting: "zone", result: { awaiting: "zone" } };
  },

  async reflection({ db, room }) {
    await grantToFloor(db, room, SHIMMERING_ROBES_SLUG, 1);
    await roomLine(db, room, "These dark robes shimmer. They are nearly indestructible…");
    return { result: { yielded: SHIMMERING_ROBES_SLUG } };
  },

  async rage({ db, room, participants, openTurn }) {
    await db.$transaction(async (tx) => {
      for (const p of participants) await grantTagSlugs(tx, p.characterId, [RAGE_SLUG], openTurn?.number ?? null);
    });
    await roomLine(db, room, INGREDIENTS_CONSUMED);
    return { result: { enraged: participants.map((p) => p.name) } };
  },

  async judgement({ db, resolved, openTurn }) {
    const { target, holder, tag } = resolved.photograph;
    const full = await db.character.findUnique({
      where: { id: target.id },
      select: { id: true, name: true, discordUserId: true, discordRoleId: true, locationId: true, zoneId: true, location: { select: { id: true, name: true, discordChannelId: true } } },
    });
    if (!full) throw new Error("the target is gone");
    await db.$transaction(async (tx) => {
      await spendFromHolder(tx, holder, tag.id, "photograph");
    });
    const { claimed } = await killByRite(db, full, {
      turn: openTurn,
      gib: true,
      content: `${full.name} was judged.`,
      reason: JUDGEMENT_DEATH_REASON,
    });
    // Already dead: the print was spent above, but nothing explodes here.
    if (!claimed) return { result: { judged: null, characterId: full.id, alreadyDead: true } };
    // Same as sacrifice: the gib left no body, so the mist drops somewhere chosen.
    const where = await pickRandomPublicRoom(db, full.locationId);
    const spawned = where ? await spawnRemains(db, where, { flesh: false, resources: false }) : {};
    await locationLine(db, full.location, `${full.name} explodes into mist!`);
    return { result: { judged: full.name, characterId: full.id, spawned } };
  },

  // Judgement's shape without the killing. The Pious/hallowed refusal lives in
  // riteIngredients.js with Judgement's, so a rite that can't land never eats
  // its floor. Uses `grantTurnNumber`, not `openTurn?.number`: Madness is the
  // only rite that grants a TIMED tag, and this fires off a minute cron that
  // often lands with nothing OPEN. See db/lib/riteSweep.js.
  async madness({ db, room, resolved, grantTurnNumber }) {
    const { target, holder, tag } = resolved.photograph;
    await db.$transaction(async (tx) => {
      await grantTagSlugs(tx, target.id, [MADNESS_SLUG], grantTurnNumber);
      await spendFromHolder(tx, holder, tag.id, "photograph");
    });
    await roomLine(db, room, INGREDIENTS_CONSUMED);
    return { result: { maddened: target.name, characterId: target.id } };
  },

  // The cult cashes out. Leader-present and once-a-game rules live in
  // riteIngredients.js; the claim here is the race guard against two circles
  // chanting the same minute.
  async fulfillment({ db, room }) {
    // Counted BEFORE the claim: the count is a read, the claim is the one shot.
    const objectives = await listObjectives(db, { partyKey: "thanati" });
    const completed = objectives.filter((o) => o.done).length;
    const granted = completed * FULFILLMENT_PER_OBJECTIVE;

    // Claim and pay in one transaction — riteIngredients.js refuses every later attempt once the stamp is set, so a failure between them would burn the one shot for nothing.
    let claimed = false;
    await db.$transaction(async (tx) => {
      const { count } = await tx.gameState.updateMany({
        where: { id: 1, fulfillmentFiredAt: null },
        data: { fulfillmentFiredAt: new Date() },
      });
      if (count === 0) return;
      if (granted > 0) {
        await addRoomResources(tx, room.id, granted, { reason: "RITE_GRANT" });
      }
      claimed = true;
    });
    if (!claimed) return { result: { alreadyPerformed: true } };

    await roomLine(db, room, "Bounty! What success!");
    return { result: { completed, granted } };
  },

  // The end of the world, armed: two turns, and killing the leader inside
  // that window is the only thing that calls it off (db/lib/ascensionPass.js).
  async ascension({ db, room, participants, openTurn }) {
    // Whose death calls this off: the leader here if present, else the leader wherever they are.
    const here = participants.map((p) => p.characterId);
    const isLeader = { tags: { some: { quantity: { gt: 0 }, tag: { slug: THANATI_LEADER_SLUG } } } };
    const chosen =
      (await db.character.findFirst({ where: { status: "ALIVE", id: { in: here }, ...isLeader }, select: { id: true, name: true } })) ??
      (await db.character.findFirst({ where: { status: "ALIVE", ...isLeader }, orderBy: { id: "asc" }, select: { id: true, name: true } }));

    // No open turn may exist between a close and the next open, so fall back to the newest turn number.
    const base =
      openTurn?.number ??
      (await db.turn.findFirst({ orderBy: { number: "desc" }, select: { number: true } }))?.number ??
      0;

    const { count } = await db.gameState.updateMany({
      where: { id: 1, ascensionArmedTurn: null, ascensionFiredTurn: null },
      data: {
        ascensionArmedTurn: base + ASCENSION_DELAY_TURNS,
        ascensionLeaderCharacterId: chosen?.id ?? null,
      },
    });
    // Already counting down or already happened — no need to tell the world twice.
    if (count === 0) return { result: { alreadyRunning: true } };

    await broadcastToZones(
      db,
      `The ground begins to shake. The cultists are planning something terrible in ${room.name}! Stop them!`,
    );
    return { result: { firesOn: base + ASCENSION_DELAY_TURNS, leader: chosen?.name ?? null } };
  },
};

// ---- The Rite of Panic's answer --------------------------------------------

// The room named a place — Zones first, then Locations, matched the way a
// chant is. Everyone alive there goes to the top of the dial. Returns what
// was struck, or null when the line named nothing.
async function answerPanic(db, { attempt, content }) {
  const text = normalizeChant(content);
  if (!text) return null;
  const [zones, locations] = await Promise.all([
    db.zone.findMany({ select: { id: true, name: true } }),
    db.location.findMany({ select: { id: true, name: true, zoneId: true } }),
  ]);
  // More specific name wins: "the Cathedral in Town" haunts the Cathedral.
  const location = locations.find((l) => containsPhrase(text, normalizeChant(l.name)));
  const zone = location ? null : zones.find((z) => containsPhrase(text, normalizeChant(z.name)));
  if (!zone && !location) return null;

  // CLAIM THE ANSWER FIRST: two participants can both reach here in the same
  // second, and without this both would strike. Same shape as the READY claim
  // in db/lib/riteChant.js.
  const { count } = await db.riteAttempt.updateMany({
    where: { id: attempt.id, status: "AWAITING" },
    data: { status: "FIRED", firedAt: new Date() },
  });
  if (count === 0) return null;

  // Rage does not become afraid (db/lib/mood.js) — exemption applied here by hand since this write bypasses the multiplier table.
  const struck = await db.character.findMany({
    where: {
      status: "ALIVE",
      ...(zone ? { zoneId: zone.id } : { locationId: location.id }),
      NOT: { tags: { some: { quantity: { gt: 0 }, tag: { slug: RAGE_SLUG } } } },
    },
    select: { id: true, name: true },
  });
  for (const c of struck) {
    await db.$transaction(async (tx) => {
      await setMood(tx, c.id, MOOD_MIN);
    }).catch(log(`panic for ${c.name}`));
  }
  // Status/clock were written by the claim above; this just records the result.
  await db.riteAttempt.update({
    where: { id: attempt.id },
    data: {
      result: { ...(attempt.result ?? {}), haunted: zone?.name ?? location?.name, struck: struck.map((c) => c.name) },
    },
  });
  return { place: zone?.name ?? location?.name, struck: struck.length };
}

module.exports = {
  EFFECTS,
  roomLine,
  locationLine,
  killByRite,
  reviveByRite,
  answerPanic,
};
