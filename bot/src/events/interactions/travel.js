// Travel and movement interaction handlers: opening the travel picker,
// gate toggling and keyed-open prompts, and ending an Intercept/Attack hold.
const { prisma } = require("@lifeweb/db");
const { actingCharacter } = require("../../lib/interactionGuild");
const {
  MENU_OPTION_LIMIT,
  PICK_ID,
  BRING_ID,
  CONFIRM_PREFIX,
  EXERT_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildBringRow,
  applyBring,
  freeZoneMovesReason,
  buildConfirmRow,
  freeMovesLeft,
  exertRefusal,
  exertEdgeFor,
  exertEdgeSentence,
  exertResultLine,
  stowedMounts,
  performMove,
} = require("../../lib/locationTravel");
const {
  travelOptions,
  routesWithinZone,
  pathWithinZone,
  gateOperable,
  isHeldOpen,
  KEYED_OPEN_MS,
} = require("@lifeweb/db/lib/locationGraph");
const { knownLocations } = require("@lifeweb/db/lib/locationVisits");
const { heldReasonFor, INTERCEPT_RELEASE_PREFIX } = require("@lifeweb/db/lib/intercept");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { sendDm } = require("../../lib/dm");
const { escortCandidates, partyOf } = require("@lifeweb/db/lib/escort");
const { refreshLocationAnchor, refreshGateRooms } = require("@lifeweb/db/lib/syncZones");
const { GATE_CHARACTER_SELECT, toggleGate, holdKeyedOpen } = require("@lifeweb/db/lib/gates");
const { ack, respond, scheduleDismiss } = require("../../lib/respond");

// loc:open, and its /location twin. Offers the Locations connected to where
// the character stands — or, on a first placement, every Location outside the
// caves, because arriving is not travel.
async function handleTravelOpen(interaction) {
  await ack(interaction);

  const character = await loadMover(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const held = heldReasonFor(character); // INTERCEPT.md; the picker still draws, showing where they'd have gone

  let current = null;
  let destinations;
  let shut = [];
  let walks = [];
  if (!character.locationId) {
    destinations = await prisma.location.findMany({
      where: { retiredAt: null, zone: { kind: { not: "CAVE_GROUP" } } },
      include: { zone: true },
    });
    destinations.sort(
      (a, b) => (a.zone?.name ?? "").localeCompare(b.zone?.name ?? "") || a.name.localeCompare(b.name),
    );
  } else {
    current = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { zone: true },
    });
    const rows = await travelOptions(prisma, character, character.locationId);
    destinations = rows.filter((row) => row.passable).map((row) => row.location);
    shut = rows.filter((row) => !row.passable);

    // Farther in this zone, through places they already know (MAP.md §3c).
    // Appended AFTER the neighbours, which is the whole of the grouping Discord
    // gives us — so when the 25-option cap bites it eats the walks and never a
    // way out, which is the common case and the only way to leave the zone.
    const here = new Set(destinations.map((location) => location.id));
    const { seen } = await knownLocations(prisma, character.id);
    walks = (await routesWithinZone(prisma, character, { known: seen }))
      .filter((row) => row.hops > 1 && !here.has(row.location.id));
  }

  if (destinations.length === 0 && shut.length === 0 && walks.length === 0) {
    await respond(interaction, "Nowhere to go from here.");
    return;
  }

  const entries = [
    ...destinations.map((location) => ({ location, hops: null, through: null })),
    ...walks.map((row) => ({
      location: row.location,
      hops: row.hops,
      through: row.path.slice(0, -1).map((l) => l.name),
    })),
  ];
  const truncated = entries.length - Math.min(entries.length, MENU_OPTION_LIMIT);
  const shutLine =
    shut.length > 0
      ? `-# Closed to you right now: ${shut.map((row) => row.location.name).join(", ")}.`
      : null;
  await respond(interaction, {
    content: [
      held ? `» *${held}*` : null,
      entries.length > 0 ? "Where would you like to go?" : "» *Every way out of here is closed to you.*",
      shutLine,
      truncated > 0 ? `-# ${truncated} more not shown — Discord caps this list at 25.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    components: entries.length > 0 ? [buildLocationSelectRow(entries, current)] : [],
  });
}


// loc:gate:{linkId} — the Open/Close button on a modular gate's two anchors.
// Rendered only on the watchtower's starter post; `toggleGate` still
// re-checks the clicker is standing at the gate. The flip is a conditional
// updateMany against the state the clicker saw, so two watchmen clicking
// "Close" in the same second never double-toggle it back open.
async function handleGateToggle(interaction, linkId) {
  await ack(interaction);

  const character = await actingCharacter(interaction, {
    select: GATE_CHARACTER_SELECT,
  });
  const result = await toggleGate(prisma, {
    character,
    linkId,
    actorDiscordUserId: interaction.user.id,
  });
  if (!result.ok) {
    await respond(interaction, `${result.error}`);
    return;
  }

  // Both sides: the anchor lists the ways out (refreshLocationAnchor), the
  // button lives on the watchtower's starter (refreshGateRooms).
  for (const locationId of result.locationIds) {
    await refreshLocationAnchor(prisma, locationId).catch((err) =>
      console.error(`Gate anchor refresh failed for ${locationId}:`, err.message ?? err),
    );
    await refreshGateRooms(prisma, locationId).catch((err) =>
      console.error(`Gate room refresh failed for ${locationId}:`, err.message ?? err),
    );
  }

  await respond(interaction, `${result.line}`);
}


// loc:keyed:{linkId}:{yes|no} — the answer to "Leave open for the next 24
// hours?" on the DM a keyed crossing raised. Re-checked, not trusted: a DM is
// durable and the key can change hands between the crossing and the click.
// "Leave it open" is a conditional updateMany against the window shown, so
// two people propping the same door can't stack two windows.
async function handleKeyedPrompt(interaction, payload) {
  await ack(interaction, { update: true });

  const cut = payload.lastIndexOf(":");
  const result = await holdKeyedOpen(prisma, {
    discordUserId: interaction.user.id,
    linkId: payload.slice(0, cut),
    hold: payload.slice(cut + 1) === "yes",
  });
  if (!result.ok) {
    await respond(interaction, { content: `${result.error}`, components: [] });
    return;
  }
  await respond(interaction, {
    content: result.note ? `» *${result.line}*\n-# ${result.note}` : `» *${result.line}*`,
    components: [],
  });
}


// Ending a hold you imposed: Release for an intercept (INTERCEPT.md), Cancel
// attack for a fight (ATTACK.md). Update IS the ack. The shared half lives in
// db/lib/dmAnswer.js so the web's button cannot drift from this one.
async function handleHoldEnd(interaction, kind, targetId) {
  await ack(interaction, { update: true });

  const result = await answerDmAction(prisma, {
    action: { kind, id: targetId },
    choice: DM_CHOICE.ACCEPT,
    discordUserId: interaction.user.id,
  });
  await respond(interaction, { content: `${result.line}`, components: [] });
  for (const dm of result.dms ?? []) { // gateway twin takes a User, not an id (ARCHITECTURE.md §3)
    const user = await interaction.client.users.fetch(dm.discordUserId).catch(() => null);
    if (!user) continue;
    await sendDm(user, `» ${dm.content}`).catch((err) =>
      console.error(`Hold release DM to ${dm.discordUserId} failed:`, err.message ?? err),
    );
  }
}


// One message carries both the passenger list and the confirmation — an
// ephemeral reply is a single editable surface.
async function handleTravelPick(interaction) {
  await ack(interaction, { update: true });

  const locationId = interaction.values[0];

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  if (!target) {
    await respond(interaction, { content: "That place no longer exists.", components: [] });
    return;
  }
  if (!character) {
    await respond(interaction, { content: "You don't have a living character.", components: [] });
    return;
  }

  // Cost model, and a warning before Confirm rather than a regret after (CARRY.md §2).
  const crossing = Boolean(character.locationId) && character.zoneId !== target.zoneId;
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { freeZoneMovesPerTurn: true },
  });
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  const candidates = await escortCandidates(prisma, character, openTurn?.number ?? null);
  const bringRow = buildBringRow(candidates);
  const overflow = candidates.length - Math.min(candidates.length, MENU_OPTION_LIMIT);

  const party = await partyOf(prisma, character.id); // decides whether the mount's extra crossing survives (MAP.md §3a)
  // THIS crossing's own count: a boat's bonus is per-crossing
  // (db/lib/mounts.js#boatCrossing), so the zone slugs matter, not just the boolean above.
  const currentZone = character.zoneId
    ? await prisma.zone.findUnique({ where: { id: character.zoneId }, select: { slug: true } })
    : null;
  const left = crossing
    ? freeMovesLeft(character, config, openTurn, party.length, {
      fromZoneSlug: currentZone?.slug ?? null,
      toZoneSlug: target.zone?.slug ?? null,
    })
    : null;
  const seatWarning = crossing ? freeZoneMovesReason(character, party.length, { config, openTurn }) : null;
  // Push on: the crossing on a die instead of the Move (MAP.md §3), offered
  // only where performLocationMove would say yes.
  const acted =
    crossing && openTurn
      ? Boolean(await prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id }, select: { id: true } }))
      : false;
  const exertWhy =
    crossing && left === 0
      ? exertRefusal(character, config, openTurn, {
        crossing: { fromZoneSlug: currentZone?.slug ?? null, toZoneSlug: target.zone?.slug ?? null },
        left,
        acted,
      })
      : null;
  const canExert = crossing && left === 0 && exertWhy === null;
  // Once the Move is spent a crossing with no free move left has no Confirm
  // to offer — the web surfaces drop Go the same way (MAP.md §3).
  const spent = crossing && left === 0 && acted;

  // The same sentence the web confirm carries about which way the die leans,
  // when it does — the picker is the only place a Discord player reads the
  // odds before committing.
  const exertNote = canExert ? exertEdgeSentence(exertEdgeFor(character.tags ?? [])) : null;

  // Farther in this zone, so a walk of several hops (MAP.md §3c). Asked only
  // where it could be one — inside the zone, and somewhere they are not already
  // standing beside — and the stops are NAMED, because which way you are about
  // to go is the thing worth knowing before you press Confirm.
  const walk =
    character.locationId && !crossing
      ? await pathWithinZone(prisma, character, target.id, {
        known: (await knownLocations(prisma, character.id)).seen,
      })
      : null;
  const walkLine =
    walk?.ok && walk.hops > 1
      ? `-# ${walk.hops} hops, through ${listNames(walk.path.slice(0, -1).map((l) => l.name))}. Nothing to pay.${walk.dismounts ? " One of the ways is too narrow for what you're riding." : ""}`
      : null;

  const cost = !character.locationId
    ? "-# Arriving costs you nothing."
    : !crossing
      ? walkLine ?? "-# You have free zone moves left, so this is free."
      : left > 0
        ? `-# Crossing into ${target.zone.name} uses 1 of your ${left} free ${left === 1 ? "move" : "moves"} this turn.`
        : !acted
          ? `-# You have no free moves left, so crossing into ${target.zone.name} spends your Move.`
          : canExert
            ? `-# You have no free moves left and your Move is spent, so crossing into ${target.zone.name} means pushing on, risking exhaustion and possible injury.${exertNote ? ` ${exertNote}` : ""}`
            : `-# You have no free moves left and your Move is spent, so you can't cross into ${target.zone.name} this turn.${exertWhy ? ` ${exertWhy}` : ""}`;

  const stowed = crossing ? stowedMounts(character.tags) : [];
  const stowedLine =
    stowed.length > 0
      ? `-# Your ${listNames(stowed)} ${stowed.length === 1 ? "isn't" : "aren't"} equipped, so ${stowed.length === 1 ? "it does" : "they do"} nothing for you.`
      : null;

  await respond(
    interaction,
    {
      content: [
        `Move to **${target.name}**?`,
        cost,
        seatWarning ? `-# ${seatWarning}` : null,
        stowedLine,
        overflow > 0 ? `-# ${overflow} more not shown — Discord caps this list at 25.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      components: [bringRow, buildConfirmRow(locationId, { exert: canExert, go: !spent })].filter(Boolean),
    },
    { fleeting: false },
  );
}


// The Bring select WRITES the party — an escort is a row, not a click memory
// (bot/src/lib/locationTravel.js). Anyone who could say no gets the Accept
// DM instead of being attached. deferUpdate since the work must happen
// before there's anything to say.
async function handleTravelBring(interaction) {
  await interaction.deferUpdate();

  const character = await loadMover(interaction.user.id);
  if (!character) return;
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const outcome = await applyBring(character, interaction.values ?? [], openTurn);

  for (const dm of outcome.dms) {
    const user = await interaction.client.users.fetch(dm.discordUserId).catch(() => null);
    if (!user) continue;
    await sendDm(user, { content: `» ${dm.content}`, components: dm.components }, { meta: dm.meta }).catch((err) =>
      console.error("Escort ask DM failed:", err.message ?? err),
    );
  }

  const notes = [];
  if (outcome.attached.length > 0) notes.push(`Bringing: ${outcome.attached.join(", ")}`);
  if (outcome.asked.length > 0) notes.push(`Asked: ${outcome.asked.join(", ")}`);
  if (outcome.dropped.length > 0) notes.push(`Left: ${outcome.dropped.join(", ")}`);

  const lines = interaction.message.content
    .split("\n")
    .filter((line) => !line.startsWith("-# Bringing:") && !line.startsWith("-# Asked:") && !line.startsWith("-# Left:"));
  for (const note of notes) lines.push(`-# ${note}`);

  await interaction.editReply({ content: lines.join("\n") }).catch((err) =>
    console.error("Failed to show the party:", err),
  );
}


// `exert` is the Push on button: the same move with a die in it (MAP.md §3).
async function handleTravelConfirm(interaction, locationId, { exert = false } = {}) {
  await interaction.deferUpdate();

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  if (!character) {
    await respond(interaction, { content: "You don't have a living character.", components: [] });
    return;
  }
  if (!target) {
    await respond(interaction, { content: "That place no longer exists.", components: [] });
    return;
  }

  const result = await performMove(character, target, { exert });
  if (!result.ok) {
    await respond(interaction, { content: `${result.reason}`, components: [] });
    return;
  }

  const brought = result.moved
    .filter((entry) => entry.character.id !== character.id)
    .map((entry) => entry.character.name);
  // Where they ACTUALLY got to. A walk of several hops can be stopped on the
  // road — an ambush, a gate shut behind somebody, the gun at the Depot — and
  // the ground they covered is real, so the line names it rather than the place
  // they picked (MAP.md §3c).
  const landed = result.arrivedAt ?? target;
  const parts = [
    result.complete === false
      ? `» You got as far as **${landed.name}**.`
      : `» Moved to **${landed.name}**.`,
  ];
  // Always the mover's own sentence, never one written here — a refusal reworded
  // at the surface is how a hidden crawl gets announced (MAP.md §2a).
  if (result.stoppedBy?.reason) parts.push(result.stoppedBy.reason);
  if (result.spentTurn) parts.push("Your Move is spent.");
  if (result.exert) parts.push(exertResultLine(result.exert));
  if (result.usedFreeMove) {
    parts.push(
      result.freeMovesLeft > 0
        ? `${result.freeMovesLeft} free ${result.freeMovesLeft === 1 ? "move" : "moves"} left this turn.`
        : "That was your last free move this turn.",
    );
  }
  if (brought.length > 0) parts.push(`Bringing ${listNames(brought)}.`);
  const stranded = (result.leftBehind ?? []).filter((e) => e.reason !== "held").map((e) => e.character.name);
  if (stranded.length > 0) parts.push(`${listNames(stranded)} couldn't follow.`);
  // "held" is the only reason given, since it's plain to see (INTERCEPT.md).
  const heldBack = (result.leftBehind ?? []).filter((e) => e.reason === "held").map((e) => e.character.name);
  if (heldBack.length > 0) parts.push(`Somebody has hold of ${listNames(heldBack)}.`);
  if (result.dismounted?.length > 0) { // dismounted, not refused (db/lib/indoors.js#dismountForNarrowWay)
    parts.push(
      `Too narrow for your ${listNames(result.dismounted)} — you leave ${result.dismounted.length === 1 ? "it" : "them"} and go on foot.`,
    );
  }

  await respond(interaction, { content: parts.join(" "), components: [] });
}


async function handleTravelCancel(interaction) {
  await interaction.update({ content: "» *Canceled.*", components: [] });
  scheduleDismiss(interaction);
}


module.exports = {
  handleTravelOpen,
  handleGateToggle,
  handleKeyedPrompt,
  handleHoldEnd,
  handleTravelPick,
  handleTravelBring,
  handleTravelConfirm,
  handleTravelCancel,
};
