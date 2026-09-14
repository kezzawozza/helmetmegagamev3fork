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

// showModal IS the acknowledgement and must be first — every check waits for the submit, since an
// open-time check would have to be re-run there anyway.
async function handleIntercomOpen(interaction, roomId) {
  await interaction.showModal(buildIntercomModal(roomId));
}


// A quest's Interact button (QUESTS.md). Only reads the title for the modal heading; everything
// that decides whether the press is allowed waits for the submit.
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


// Every gate lives in db/lib/quests.js#questInteract, which both faces call.
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


// Opening the modal isn't the act — the typed word is — so this only checks which way the switch is thrown.
async function handleTurretOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "There's no button here.");
    return;
  }
  await interaction.showModal(buildTurretModal(roomId, await gatehouseTurretArmed(prisma)));
}


// The typed word is the act, not opening the modal, so only the room is checked here.
async function handleBellOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== BELL_ROOM_SLUG) {
    await respond(interaction, "There's no bell here.");
    return;
  }
  await interaction.showModal(buildBellModal(roomId));
}


// A confirm, not the bell's type-the-word modal: praying disturbs nobody, but hands a permanent
// tag that can kill you, so the friction is being told the bargain.
const PRAY_CONFIRM_PREFIX = "room:pray:go:";

// Alive, standing here, admitted through the door. Re-run at confirm too, since the ephemeral
// outlives somebody climbing back out of the Chasm.
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

  // Witnessed only within the shrine — the tag is `catalog: secret` and never announced elsewhere.
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
  if (character.locationId !== room.locationId) { // decided at submit — reaching the rope is the only safeguard
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }
  if (!bellWordMatches(interaction.fields.getTextInputValue(BELL_WORD_FIELD))) {
    await respond(interaction, "You leave the rope alone.");
    return;
  }

  // Cooldown read AFTER the word, so an abandoned modal never reports a wait it wasn't going to trigger.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { bellRungAt: true } });
  const { ok, secondsLeft } = bellCooldown(state?.bellRungAt);
  if (!ok) {
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60)); // minutes, not raw seconds
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
  if (character.locationId !== room.locationId) { // decided at submit — reaching the switch is the only safeguard
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }

  const armed = await gatehouseTurretArmed(prisma); // re-read, not trusted from the modal: two people could open it at once
  if (!turretWordMatches(interaction.fields.getTextInputValue(TURRET_WORD_FIELD), armed)) {
    await respond(interaction, "You leave the button alone.");
    return;
  }

  const next = !armed;
  await prisma.gameState.update({ where: { id: 1 }, data: { gatehouseTurretArmed: next } });

  const gatehouse = await prisma.location // the yard's only warning; best-effort, switch throws either way
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
  const { sent, failed } = await broadcastIntercom(prisma, body); // writes its own SYSTEM row per zone (/chat + /archive)

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

  const note = failed.length > 0 ? `\n-# Nothing came through in ${failed.join(", ")}.` : ""; // a partial reach isn't a failure, but say which zones missed it
  await respond(interaction, `» *Your voice goes out across Ravenheart.*${note}`, { fleeting: true });
}

// Custom IDs below: "loc:" is the travel flow, "conv:" the Conversation flow, "move:"/"say:" the Move/Speak modals.


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
