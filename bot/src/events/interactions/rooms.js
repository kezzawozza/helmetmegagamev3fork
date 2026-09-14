// Room-anchor interaction handlers: the Intercom, Quest interact, the
// Watchtower turret, the Bell Tower, and Prayer at the Shrine of an Old Man —
// each one's open (button/select) and submit (modal) pair.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  syncCharacterRoomAccess,
  accessibleRooms,
  roomAccessKeys,
} = require("@lifeweb/db/lib/roomAccess");
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../../lib/interactionGuild");
const { postAsCharacterTo, loadVoiceState } = require("../../lib/proxy");
const {
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
} = require("@lifeweb/db/lib/roomStarterRow");
const { INTERCOM_ROOM_SLUG, broadcastIntercom } = require("@lifeweb/db/lib/intercom");
const { INTERCOM_MODAL_PREFIX, buildIntercomModal } = require("../../lib/intercomModal");
const { buildQuestModal } = require("../../lib/questModal");
const {
  QUEST_INTERACT_PREFIX,
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  questInteract,
} = require("@lifeweb/db/lib/quests");
const {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  buildTurretModal,
  turretWordMatches,
} = require("../../lib/turretModal");
const { BELL_ROOM_SLUG, bellCooldown, broadcastBell } = require("@lifeweb/db/lib/bell");
const { XOM_SHRINE_ROOM_SLUG, grantXom } = require("@lifeweb/db/lib/xom");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");
const {
  BELL_MODAL_PREFIX,
  BELL_WORD_FIELD,
  buildBellModal,
  bellWordMatches,
} = require("../../lib/bellModal");
const {
  GATEHOUSE_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
  gatehouseTurretArmed,
} = require("@lifeweb/db/lib/gatehouseTurret");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ack, respond, scheduleDismiss } = require("../../lib/respond");

// The Council Room's Intercom button, and its modal.
//
// showModal IS the acknowledgement and must be the first thing that happens —
// a deferred interaction can no longer open one, and Discord allows three
// seconds. So the button does no database work at all, and every check waits
// for the submit. That is not a hole: an ephemeral modal outlives the player
// walking out of the Keep, so an open-time check would have to be re-run at
// submit anyway.
async function handleIntercomOpen(interaction, roomId) {
  await interaction.showModal(buildIntercomModal(roomId));
}


// A quest's Interact button (docs/systemdocs/QUESTS.md). The only work here is
// reading the quest's title for the modal's heading — everything that decides
// whether the press is allowed waits for the submit, because the modal outlives
// the player walking out of the cave. showModal IS the acknowledgement, so no
// ack() here.
async function handleQuestOpen(interaction, questId) {
  const quest = await prisma.quest.findUnique({
    where: { id: questId },
    select: { title: true, status: true },
  });
  if (!quest || quest.status !== "OPEN") {
    await respond(interaction, "That's over.");
    return;
  }
  await interaction.showModal(buildQuestModal(questId, quest.title));
}


// Every gate lives in db/lib/quests.js#questInteract, which both faces call:
// the quest is still open, they are still standing there, the door is still
// theirs, and they have not already moved. This handler's whole job is to hand
// it the typed intention and say what came back.
async function handleQuestSubmit(interaction, questId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const result = await questInteract(prisma, {
    questId,
    character,
    intention: interaction.fields.getTextInputValue(QUEST_INTENTION_FIELD),
    actorDiscordUserId: interaction.user.id,
  });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }
  await respond(interaction, "Your Gambit is filed. You'll hear how it went when the turn is pushed.");
}


// The big red button in the Censor's Office. Opening the modal is not the act
// — the typed word is — so this only has to find out which way the switch is
// currently thrown. showModal IS the acknowledgement, so no ack() here.
async function handleTurretOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "There's no button here.");
    return;
  }
  await interaction.showModal(buildTurretModal(roomId, await gatehouseTurretArmed(prisma)));
}


// The rope in the Bell Tower. Opening the modal is not the act — the typed
// word is — so nothing is checked here but the room. showModal IS the
// acknowledgement, so no ack().
async function handleBellOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== BELL_ROOM_SLUG) {
    await respond(interaction, "There's no bell here.");
    return;
  }
  await interaction.showModal(buildBellModal(roomId));
}


// Pray, in the Shrine of an Old Man (docs/zones.yaml, under depths-chasm).
//
// A confirm, not the bell's type-the-word modal, and the difference is
// deliberate. RING is a speed bump on a LOUD act — typing it says "you are
// about to disturb a hundred people". Pressing this disturbs nobody; what it
// does is hand you a permanent tag that can kill you and shut every goal on
// your sheet but one. The right friction for that is being told what the
// bargain is, so the confirm says it.
const PRAY_CONFIRM_PREFIX = "room:pray:go:";


// Alive, standing in the shrine's Location, and admitted through the door.
// Re-run at confirm as well as at open: the ephemeral outlives somebody
// climbing back out of the Chasm, and reaching the shrine is the only
// safeguard on it.
async function prayGate(interaction, roomId) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) return { error: "You don't have a living character." };
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true, accessTagSlugs: true },
  });
  if (!room || room.slug !== XOM_SHRINE_ROOM_SLUG) return { error: "There's no shrine here." };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more.` };
  }
  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return { error: "You can't get in there." };
  }
  return { character, room };
}


async function handlePrayOpen(interaction, roomId) {
  await ack(interaction);
  const gate = await prayGate(interaction, roomId);
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  await respond(interaction, {
    content:
      "The face is waiting. Praying here is permanent, it takes whatever you believed in now, " +
      "and what happens to you afterwards is not up to you.",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PRAY_CONFIRM_PREFIX}${roomId}`)
          .setLabel("Pray")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}


async function handlePrayConfirm(interaction, roomId) {
  await ack(interaction);
  const gate = await prayGate(interaction, roomId);
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  const { character, room } = gate;

  const result = await grantXom(prisma, { characterId: character.id });
  if (result.already) {
    await respond(interaction, "The face is already watching you.");
    return;
  }
  if (result.spoken) {
    await respond(interaction, "Something else has you already, and it does not share.");
    return;
  }
  if (!result.ok) {
    await respond(interaction, "Nothing answers. Tell a GM.");
    return;
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "xom_prayed",
        targetCharacterId: character.id,
        details: { characterName: character.name, room: room.name, replaced: result.replaced },
      },
    })
    .catch((err) => console.error("Pray audit log failed:", err));

  // Anybody else standing in the shrine sees it happen, and nothing leaves the
  // room — the tag is `catalog: secret` and this is the only place it is ever
  // announced at all.
  const witnessed = `${character.name} kneels, and the face seems to lean down.`;
  await sceneLineAt(prisma, { roomId: room.id, text: witnessed }).catch(() => {});
  const thread = await prisma.room
    .findUnique({ where: { id: room.id }, select: { discordThreadId: true } })
    .catch(() => null);
  if (thread?.discordThreadId) {
    await postMessage(thread.discordThreadId, ambientLine(witnessed)).catch(() => {});
  }

  await respond(
    interaction,
    result.replaced
      ? `It takes your ${result.replaced} off you and does not offer anything back.`
      : "Something old and amused turns its attention on you.",
  );
}


async function handleBellSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== BELL_ROOM_SLUG) {
    await respond(interaction, "There's no bell here.");
    return;
  }
  // Decided at submit, never at open: the modal outlives somebody walking back
  // down the tower stairs, and reaching the rope is the only safeguard on it.
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }
  if (!bellWordMatches(interaction.fields.getTextInputValue(BELL_WORD_FIELD))) {
    await respond(interaction, "You leave the rope alone.");
    return;
  }

  // The cooldown is read AFTER the word, so a modal somebody abandoned never
  // reports a wait they were not going to trigger anyway.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { bellRungAt: true } });
  const { ok, secondsLeft } = bellCooldown(state?.bellRungAt);
  if (!ok) {
    // Minutes, not the raw seconds this used to print: at a half-hour cooldown
    // "1487s" is arithmetic homework rather than an answer.
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    await respond(
      interaction,
      `The bell is on cooldown. About ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    );
    return;
  }

  await prisma.gameState.update({ where: { id: 1 }, data: { bellRungAt: new Date() } });

  const { sent, failed } = await broadcastBell(prisma);

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "bell_rung",
        targetCharacterId: character.id,
        details: { characterName: character.name, sent, failed },
      },
    })
    .catch((err) => console.error("Bell audit log failed:", err));

  await respond(
    interaction,
    failed.length
      ? "The bell sounds."
      : "The bell sounds.",
  );
}


async function handleTurretSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "There's no button here.");
    return;
  }
  // Decided at submit, never at open: the modal outlives somebody walking out
  // of the Garrison, and reaching the switch is the only safeguard on it.
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }

  // Re-read rather than trusting what the modal was built against — two people
  // in the office can open it at the same moment, and the word they were asked
  // to type is what says which way they meant to throw it.
  const armed = await gatehouseTurretArmed(prisma);
  if (!turretWordMatches(interaction.fields.getTextInputValue(TURRET_WORD_FIELD), armed)) {
    await respond(interaction, "You leave the button alone.");
    return;
  }

  const next = !armed;
  await prisma.gameState.update({ where: { id: 1 }, data: { gatehouseTurretArmed: next } });

  // The yard hears it, and that is the only warning anybody in it gets. Best
  // effort — the switch is thrown either way.
  const gatehouse = await prisma.location
    .findUnique({ where: { slug: GATEHOUSE_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (gatehouse?.discordChannelId) {
    const line = next ? TURRET_ARMED_LINE : TURRET_DISARMED_LINE;
    await postMessage(gatehouse.discordChannelId, ambientLine(line.text, [], { signed: line.signed })).catch(
      (err) => console.error("Gatehouse turret line failed:", err),
    );
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "gatehouse_turret_toggled",
        details: { armed: next, characterId: character.id, characterName: character.name },
      },
    })
    .catch((err) => console.error("Gatehouse turret audit log failed:", err));

  await respond(
    interaction,
    next
      ? "The button toggles on."
      : "The button toggles off.",
  );
}


async function handleIntercomSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== INTERCOM_ROOM_SLUG) {
    await respond(interaction, "There's no intercom here.");
    return;
  }
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }

  const body = interaction.fields.getTextInputValue("intercom:body").trim();
  if (!body) {
    await respond(interaction, "Say something first.");
    return;
  }

  const voice = await loadVoiceState(character.id);
  if (voice.block) {
    await respond(interaction, `You can't get the words out — you're ${voice.block.name}.`);
    return;
  }
  const { sent, failed } = await broadcastIntercom(prisma, body);

  // The transcript is broadcastIntercom's own job since phase 4: it writes one
  // SYSTEM row per zone it reached, so the announcement lands in each zone's
  // feed on /chat as well as in /archive. The single row that used to be
  // written here had no place key and so was invisible in Chat.

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "intercom_broadcast",
        targetCharacterId: character.id,
        details: { body, zonesReached: sent, zonesFailed: failed },
      },
    })
    .catch((err) => console.error("Intercom audit failed:", err.message ?? err));

  // Say what actually happened. A PA that reached four zones out of five is
  // not a failure, but the speaker has to know which one nobody heard. One
  // for the whole message, riding the last line rather than the first.
  const note = failed.length > 0 ? `\n-# Nothing came through in ${failed.join(", ")}.` : "";
  await respond(interaction, `» *Your voice goes out across Ravenheart.*${note}`, { fleeting: true });
}

// Custom IDs below are "loc:"-namespaced for the travel flow off the Travel
// button on the #turns console (bot/src/lib/turnsConsole.js, whose button
// keeps its historical "loc:open" id) and off the three buttons on every
// Location channel's anchor; "conv:" is the Conversation flow; "move:" and
// "say:" are the unrelated Move and Speak modals.


module.exports = {
  PRAY_CONFIRM_PREFIX,
  handleIntercomOpen,
  handleQuestOpen,
  handleQuestSubmit,
  handleTurretOpen,
  handleBellOpen,
  handlePrayOpen,
  handlePrayConfirm,
  handleBellSubmit,
  handleTurretSubmit,
  handleIntercomSubmit,
};
