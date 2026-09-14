// Travel and movement interaction handlers: opening the travel picker,
// gate toggling and keyed-open prompts, and ending an Intercept/Attack hold.
const { prisma } = require("@lifeweb/db");
const { actingCharacter } = require("../../lib/interactionGuild");
const {
  MENU_OPTION_LIMIT,
  PICK_ID,
  BRING_ID,
  CONFIRM_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildBringRow,
  applyBring,
  freeZoneMovesReason,
  buildConfirmRow,
  freeMovesLeft,
  stowedMounts,
  performMove,
} = require("../../lib/locationTravel");
const {
  travelOptions,
  gateOperable,
  isHeldOpen,
  KEYED_OPEN_MS,
} = require("@lifeweb/db/lib/locationGraph");
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

  // Somebody has hold of them (docs/systemdocs/INTERCEPT.md). The picker is
  // still worth drawing: travelOptions has marked every row unpassable, which
  // drops them into `shut` below with no work here, so a held player can see
  // where they would have gone.
  const held = heldReasonFor(character);

  let current = null;
  let destinations;
  let shut = [];
  if (!character.locationId) {
    destinations = await prisma.location.findMany({
      where: { zone: { kind: { not: "CAVE_GROUP" } } },
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
    // travelOptions has already dropped the hidden ways this character holds
    // no key to, and sorted the rest. A locked or shut one is still offered:
    // seeing the door and being told what opens it is the point of the locked
    // form, as against the hidden one.
    const rows = await travelOptions(prisma, character, character.locationId);
    destinations = rows.filter((row) => row.passable).map((row) => row.location);
    shut = rows.filter((row) => !row.passable);
  }

  if (destinations.length === 0 && shut.length === 0) {
    await respond(interaction, "Nowhere to go from here.");
    return;
  }

  // Never truncate silently: a missing destination reads as a broken map.
  const truncated = destinations.length - Math.min(destinations.length, MENU_OPTION_LIMIT);
  const shutLine =
    shut.length > 0
      ? `-# Closed to you right now: ${shut.map((row) => row.location.name).join(", ")}.`
      : null;
  await respond(interaction, {
    content: [
      held ? `» *${held}*` : null,
      destinations.length > 0 ? "Where would you like to go?" : "» *Every way out of here is closed to you.*",
      shutLine,
      truncated > 0 ? `-# ${truncated} more not shown — Discord caps this list at 25.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    components: destinations.length > 0 ? [buildLocationSelectRow(destinations, current)] : [],
  });
}


// loc:gate:{linkId} — the Open/Close button on a modular gate's two anchors.
//
// The button is only rendered on the watchtower's starter post, so getting
// into that room is the whole permission model — anyone who can see the
// winch may pull it. `toggleGate` still re-checks that the clicker is
// standing at the gate, because a thread member need not be.
//
// The flip is a conditional updateMany whose WHERE clause carries the state
// the clicker saw, the same shape the move cooldown and the mount claim use.
// Two watchmen clicking "Close" in the same second means one close and one
// "somebody just did", never a double toggle that lands back open.
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

  // Both sides. The anchor no longer carries the gate at all, but it still
  // lists the ways out, so it is redrawn; the button itself lives on the
  // watchtower's starter, which is what refreshGateRooms redraws. A gate with
  // a tower at only one end has nothing to redraw at the other, and that is
  // fine.
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
// hours?" on the DM a keyed crossing raised.
//
// Re-checked rather than trusted: the button was DM'd to a key-holder, but a
// DM is a durable surface and the key can change hands or be lost between the
// crossing and the click. Whoever presses it must still hold the key.
//
// "Leave it open" is a conditional updateMany against the window the clicker
// was shown, so two people propping the same door in the same moment cannot
// stack two windows — the second is told it is already held.
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


// Ending a hold you imposed, from the button on your own DM: Release for an
// old intercept (docs/systemdocs/INTERCEPT.md), Cancel attack for a fight
// (docs/systemdocs/ATTACK.md). The handleKeyedPrompt shape: update IS the ack,
// and the buttons come off whatever the answer was. The shared half — who may
// end whose hold, and the word owed to the other person — is
// db/lib/dmAnswer.js, so the web's own button cannot drift from this one.
async function handleHoldEnd(interaction, kind, targetId) {
  await ack(interaction, { update: true });

  const result = await answerDmAction(prisma, {
    action: { kind, id: targetId },
    choice: DM_CHOICE.ACCEPT,
    discordUserId: interaction.user.id,
  });
  await respond(interaction, { content: `${result.line}`, components: [] });
  // The gateway twin takes a User, not an id (ARCHITECTURE.md §3) — the
  // bot/src/lib/offers.js#fanOut shape.
  for (const dm of result.dms ?? []) {
    const user = await interaction.client.users.fetch(dm.discordUserId).catch(() => null);
    if (!user) continue;
    await sendDm(user, `» ${dm.content}`).catch((err) =>
      console.error(`Hold release DM to ${dm.discordUserId} failed:`, err.message ?? err),
    );
  }
}


// One message carries both the passenger list and the confirmation, because
// Discord cannot keep them on two: an ephemeral reply is a single editable
// surface, and a second message would leave the first one lying around with
// live buttons on it.
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

  // The cost model in one line, and — when they are about to walk a day's road
  // with a horse still in their pocket — a warning before the Confirm rather
  // than a regret after it (docs/systemdocs/CARRY.md §2).
  const crossing = Boolean(character.locationId) && character.zoneId !== target.zoneId;
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { freeZoneMovesPerTurn: true },
  });
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  const candidates = await escortCandidates(prisma, character, openTurn?.number ?? null);
  const bringRow = buildBringRow(candidates);
  const overflow = candidates.length - Math.min(candidates.length, MENU_OPTION_LIMIT);

  // The party is what decides whether the mount's extra crossing survives, so
  // the number quoted below has to count it (MAP.md §3a).
  const party = await partyOf(prisma, character.id);
  // THIS crossing's own count, not a flat one that ignores where it goes — a
  // boat's bonus is earned per crossing (db/lib/mounts.js#boatCrossing), so
  // Forest<->Hills or Hills<->Marshes has to show one more than a crossing
  // the water does nothing for. `crossing` above is only a boolean ("does
  // this leave the zone at all"); the actual zone slugs live here.
  const currentZone = character.zoneId
    ? await prisma.zone.findUnique({ where: { id: character.zoneId }, select: { slug: true } })
    : null;
  const left = crossing
    ? freeMovesLeft(character, config, openTurn, party.length, {
      fromZoneSlug: currentZone?.slug ?? null,
      toZoneSlug: target.zone?.slug ?? null,
    })
    : null;
  const seatWarning = crossing ? freeZoneMovesReason(character, party.length) : null;

  const cost = !character.locationId
    ? "-# Arriving costs you nothing."
    : !crossing
      ? "-# You have free zone moves left, so this is free."
      : left > 0
        ? `-# Crossing into ${target.zone.name} uses 1 of your ${left} free ${left === 1 ? "move" : "moves"} this turn.`
        : `-# You have no free moves left, so crossing into ${target.zone.name} spends your Move.`;

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
      components: [bringRow, buildConfirmRow(locationId)].filter(Boolean),
    },
    { fleeting: false },
  );
}


// The Bring select WRITES the party — an escort is a row, not a ten-minute
// memory of a click (bot/src/lib/locationTravel.js). Anyone ticked who could
// say no gets the Accept DM instead of being attached, and anyone unticked is
// put down. deferUpdate rather than an `update` payload because the work has
// to happen before there is anything to say about it.
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


async function handleTravelConfirm(interaction, locationId) {
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

  const result = await performMove(character, target);
  if (!result.ok) {
    await respond(interaction, { content: `${result.reason}`, components: [] });
    return;
  }

  const brought = result.moved
    .filter((entry) => entry.character.id !== character.id)
    .map((entry) => entry.character.name);
  const parts = [`» Moved to **${target.name}**.`];
  if (result.spentTurn) parts.push("Your Move is spent.");
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
  // "held" is the one reason the leader IS given, because it is plain to see:
  // somebody has hold of them (INTERCEPT.md). Every other reason stays unnamed
  // — a hidden crawl's refusal would announce that the crawl is there.
  const heldBack = (result.leftBehind ?? []).filter((e) => e.reason === "held").map((e) => e.character.name);
  if (heldBack.length > 0) parts.push(`Somebody has hold of ${listNames(heldBack)}.`);
  // The way was too narrow for what they had out — dismounted rather than
  // refused (db/lib/indoors.js#dismountForNarrowWay), already applied by
  // performLocationMove by the time this reads it.
  if (result.dismounted?.length > 0) {
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
