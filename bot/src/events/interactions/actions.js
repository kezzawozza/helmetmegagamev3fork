// Player-verb interaction handlers: Move, Speak, /message, Heal, Roll,
// Play and Shout.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  loadConcealment,
  loadForcedName,
  presentedIdentity,
} = require("@lifeweb/db/lib/presentedIdentity");
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
const { reconcileNarrowcastAccess } = require("@lifeweb/db/lib/locationMove");
const {
  syncCharacterRoomAccess,
  accessibleRooms,
  roomAccessKeys,
} = require("@lifeweb/db/lib/roomAccess");
const { settleCarry, deliverCarryDrop } = require("@lifeweb/db/lib/carry");
const { buildMoveModal } = require("../../lib/moveModal");
const { confirmMove } = require("../../lib/moveConfirm");
const { buildSpeakModal } = require("../../lib/speakModal");
const { canSpeakInTarget } = require("../../lib/speakTargets");
const { resolveActingMember, isGmMember, findAliveCharacter, actingCharacter } = require("../../lib/interactionGuild");
const { placeKeyForChannel, isScenePlaceKey } = require("@lifeweb/db/lib/placeKey");
const { playInstrument } = require("@lifeweb/db/lib/instrumentPlay");
const { postAsCharacterTo, loadVoiceState } = require("../../lib/proxy");
const { prepareSpeech, recordSpeech } = require("@lifeweb/db/lib/say");
const { touchCharacterActivity } = require("@lifeweb/db/lib/characterActivity");
const { dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { HEALTH_CATEGORY } = require("@lifeweb/db/lib/medicalVision");
const { moveWindow, epochSeconds } = require("@lifeweb/db/lib/turnClock");
const { castDie } = require("@lifeweb/db/lib/roll");
const { messageLink } = require("../../lib/mentions");
const { fileMove } = require("@lifeweb/db/lib/moves");
const { shout, deliverShout } = require("@lifeweb/db/lib/shout");
const { ooc, deliverOoc } = require("@lifeweb/db/lib/ooc");
const { oocRejectionDm } = require("@lifeweb/db/lib/oocGuard");
const { sendDm } = require("../../lib/dm");
const { movesOpen } = require("@lifeweb/db/lib/turnGate");
const { resolveChannelContext } = require("../../lib/channels");
const { ack, respond, scheduleDismiss } = require("../../lib/respond");

// Why this player cannot file a Move, or null when they can — db/lib/turnGate.js is the gate, shared with the web so the two
// faces refuse for the same reasons. The LOCKED case keeps its own Discord-flavoured wording, since <t:> tags let it name
// both times in the reader's own clock and a bare "Moves are locked" throws that away.
async function moveLockNotice() {
  const gate = await movesOpen(prisma);
  if (gate.ok || gate.reason === "NO_TURN") return null;
  if (gate.reason !== "LOCKED") return gate.message;
  const { cutoffAt, endsAt } = gate.window;
  return `Moves for this turn locked at <t:${epochSeconds(cutoffAt)}:t>. The next turn opens <t:${epochSeconds(endsAt)}:R>.`;
}


// A modal must be shown within 3 seconds and cannot be deferred first, so
// this is the only read before it — with an 800ms race so a slow pool
// doesn't cost the player the modal. Submit re-checks the cutoff.
async function handleMoveOpen(interaction) {
  const notice = await Promise.race([
    moveLockNotice().catch((err) => {
      console.error("Move lock check failed:", err);
      return null;
    }),
    new Promise((resolve) => setTimeout(() => resolve(null), 800)),
  ]);
  if (notice) {
    await respond(interaction, notice);
    return;
  }
  await interaction.showModal(buildMoveModal());
}


async function handleMoveSubmit(interaction) {
  // FIRST: this handler does easily enough DB work to pass three seconds
  // under load, and a late ack would make a committed Move look unsent.
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  const result = await fileMove(prisma, {
    character,
    actorDiscordUserId: interaction.user.id,
    // No picker on the modal any more — a Move is a Gambit (bot/src/lib/moveModal.js).
    moveKind: "GAMBIT",
    description: interaction.fields.getTextInputValue("move:body"),
  });
  if (!result.ok) {
    await respond(interaction, `${result.error}`);
    return;
  }

  const loaded = await prisma.action.findUnique({
    where: { id: result.action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });

  const { lines } = await confirmMove(loaded, interaction.user.id);
  await respond(interaction, lines.join("\n"));
}


// setRequired(false) fields may be absent from the submitted payload, and
// fields.getX() throws on a component it can't find.
function optionalText(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId) ?? "";
  } catch {
    return "";
  }
}


// The 🔊 Speak button is gone: its destination picker could never list a Room
// thread or a Conversation (bot/src/lib/speakTargets.js says why), so /message
// — run in the room you want to speak in — is the whole feature now.
//
// This stub stays because #turns is ONE ROLLING MESSAGE replaced each turn
// (db/lib/turnAnnouncement.js), so a console posted before the deploy keeps a
// live button for up to a real day, and an unrouted button answers "This
// application did not respond". Delete it once no such message survives.
async function handleSpeakOpen(interaction) {
  await ack(interaction);
  await respond(interaction, "Speak has moved — use /message in the room you want to speak in.");
}


async function handleSpeakSubmit(interaction, channelId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  // client.channels, not guild.channels: the destination may be a thread.
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!guild || !channel || !member || !canSpeakInTarget(channel, member)) {
    await respond(interaction, "You can't speak there any more.");
    return;
  }

  const body = optionalText(interaction, "say:body").trim();
  if (!body) {
    await respond(interaction, "Write something.");
    return;
  }

  // Read off the character, never off the modal: concealment (and a held
  // forcesName tag) are standing state, and a checkbox here would be a
  // second answer to a settled question.
  const forcedName = await loadForcedName(prisma, character.id);
  const concealment = await loadConcealment(prisma, character.id);
  const identity = presentedIdentity(character, { forcedName, concealment });

  // Refused here as well as inside postAsCharacterTo. The funnel is the
  // backstop; this is the courtesy, so a silenced player is told before the
  // bot goes and builds a webhook for a message it will not send.
  const voice = await loadVoiceState(character.id);
  if (voice.block) {
    await touchCharacterActivity(prisma, character.id);
    await respond(interaction, `You can't get the words out — you're ${voice.block.name}.`);
    return;
  }

  // The one write path (db/lib/say.js): decide, post, record. The same three
  // calls the proxy makes, in the same order, so the Speak modal and a typed
  // message are gated and transformed identically.
  const prepared = await prepareSpeech(prisma, {
    character,
    placeKey: await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id }),
    content: body,
    source: "DISCORD",
  });
  if (!prepared.ok) {
    // Nothing was posted and the modal is gone, so the words only exist in the
    // refusal. The DM hands them back (db/lib/oocGuard.js) — never allowed to
    // fail the reply, which is the answer either way.
    if (prepared.oocRejected) {
      await sendDm(interaction.user, { content: oocRejectionDm(prepared.original ?? body) }).catch((err) =>
        console.error("OOC rejection DM failed:", err?.message ?? err),
      );
    }
    await respond(interaction, `${prepared.refusal}`);
    return;
  }

  // Fetched once so the discriminator on a concealed send scopes to the open
  // turn (db/lib/concealedDiscriminator.js); the archive would look this up
  // again on the write below, but the modal is a cold path so one extra query
  // is cheaper than plumbing it through recordSpeech.
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  let posted;
  try {
    posted = await postAsCharacterTo(channel, character, {
      content: prepared.content,
      identity: prepared.identity,
      turnNumber: openTurn?.number ?? null,
      placeKey: prepared.placeKey,
    });
  } catch (err) {
    console.error("Failed to post a Speak message:", err);
    await respond(interaction, "Couldn't post that.");
    return;
  }

  await recordSpeech(prisma, prepared, {
    discordMessageId: posted.webhookMessage.id,
    ...resolveChannelContext(channel),
  });
  await touchCharacterActivity(prisma, character.id);

  await respond(interaction, `» *Sent.*\n${messageLink(guild.id, channel.id, posted.webhookMessage.id)}`);
}


// /message is contextual: it speaks into the channel or thread you ran it in.
// There is no destination picker any more, so run it somewhere you cannot
// speak — a DM, or #turns — and it says where to run it instead.
//
// showModal IS the acknowledgement and a deferred interaction can no longer
// open one, so the speakable case must be tested BEFORE anything is acked, and
// only the refusal branch calls ack().
async function handleMessageCommand(interaction) {
  const channel = interaction.channel;
  if (interaction.inGuild() && interaction.member && channel && canSpeakInTarget(channel, interaction.member)) {
    await interaction.showModal(buildSpeakModal(channel.id, `#${channel.name}`));
    return;
  }
  await ack(interaction);
  await respond(interaction, "Run this in the channel or thread you want to speak in.");
}


// GM-only, and deliberately not the player medic path
// (web/app/(app)/character/requestActions.js#healCharacterRequest), which
// charges a payer and requires co-location. Category is the only filter.
async function handleHealCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "GMs only.");
    return;
  }
  await ack(interaction);

  const role = interaction.options.getRole("character", true);
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, "That isn't a living character's role.");
    return;
  }

  const afflictions = target.tags.filter((ct) => ct.tag.category === HEALTH_CATEGORY);
  if (afflictions.length === 0) {
    await respond(interaction, `${target.name} has nothing to treat.`);
    return;
  }

  // Discord caps a select menu at 25 options, and max_values must track the
  // slice or the whole component is rejected.
  const shown = afflictions.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`heal:pick:${target.id}`)
    .setPlaceholder("What to clear…")
    .setMinValues(1)
    .setMaxValues(shown.length)
    .addOptions(shown.map((ct) => ({ label: ct.tag.name, value: ct.tagId })));

  const truncated = afflictions.length > shown.length;
  await respond(interaction, {
    content:
      `Clear what from **${target.name}**?` +
      (truncated ? `\n-# Showing the first ${shown.length} of ${afflictions.length}.` : ""),
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}


async function handleHealPick(interaction, characterId) {
  if (!isGmMember(interaction)) {
    await interaction.update({ content: "» *GMs only.*", components: [] });
    scheduleDismiss(interaction);
    return;
  }
  await interaction.deferUpdate();

  const tagIds = interaction.values;
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, { content: "That character no longer exists.", components: [] });
    return;
  }

  const cleared = target.tags.filter((ct) => tagIds.includes(ct.tagId)).map((ct) => ct.tag.name);

  await prisma.$transaction(async (tx) => {
    for (const tagId of tagIds) {
      await dropCharacterTag(tx, characterId, tagId);
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "gm_heal",
      targetCharacterId: characterId,
      details: { tagIds, tagNames: cleared },
    },
  });

  // Clearing an affliction can change both narrowcast access and which
  // private Rooms this character belongs in — a key tag is a tag like any
  // other, and #cerberon is gated on tags too.
  await reconcileNarrowcastAccess(prisma, target.id, target.discordUserId).catch((err) =>
    console.error(`Heal: narrowcast reconcile failed for ${target.name}:`, err.message ?? err),
  );
  // Carry first (a cured tag can't change a cap, but the order is the rule
  // — CARRY.md), then the room doors.
  const carry = await settleCarry(prisma, target.id).catch((err) => {
    console.error(`Heal: carry settle failed for ${target.name}:`, err.message ?? err);
    return null;
  });
  await syncCharacterRoomAccess(prisma, target).catch((err) =>
    console.error(`Heal: room access sync failed for ${target.name}:`, err.message ?? err),
  );
  if (carry?.drop) await deliverCarryDrop(prisma, carry).catch(() => { });

  await respond(interaction, {
    content: `Cleared ${cleared.join(", ")} from ${target.name}.`,
    components: [],
  });
}


// The one die a player rolls for themselves. db/lib/roll.js#castDie is the
// shared implementation, as it is for the web's Chat composer — it writes the
// die as a SYSTEM archive row and posts the same sentence to Discord, rather
// than a public interaction reply, which would carry Discord's "@account used
// /roll" header and out the player behind the character (PROXYING.md).
//
// This handler used to post `» *A die is cast* — **N**` and record nothing, so
// a die rolled on Discord was a die Chat and /archive never saw. It is also
// why the roller is named now: a die is an act, not a noise, and a concealed
// roller is named by their alias.
async function handleRollCommand(interaction) {
  await ack(interaction);

  // A die is cast in front of people, so the same gate the other two
  // moment-to-moment verbs use: a Room or a Conversation and nowhere else
  // (db/lib/placeKey.js#isScenePlaceKey). castDie does not ask this — it takes
  // any place key — so the gate stays here, where it was. Without it a die
  // rolls into whatever channel it was typed in: the street, a zone #summary,
  // #turns.
  const channel = interaction.channel;
  const placeKey = channel
    ? await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id })
    : null;
  if (!isScenePlaceKey(placeKey)) {
    await respond(interaction, "There's nobody here to see it.");
    return;
  }

  // The whole row: castDie needs age, gender, concealed and discordMirrored to work
  // out what to call the roller.
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const result = await castDie(prisma, character, placeKey);
  await respond(interaction, result.ok ? result.line : result.error);
}


// /play: plays with an instrument in hand, sings without one.
// db/lib/instrumentPlay.js is the shared implementation — the web's Chat
// composer offers the same command (COMMANDS.md), and a cooldown or a mood
// soothe that only one face knew about would be a performance a player could
// dodge by switching apps.
async function handlePlayCommand(interaction) {
  await ack(interaction);

  const character = await actingCharacter(interaction, {
    include: { tags: { include: { tag: true } } },
  });
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  // Where: a Room or a Conversation, and nowhere else (db/lib/placeKey.js
  // #isScenePlaceKey). That refuses a zone #summary and #cerberon, which are
  // not places anyone is standing — and the open street too: a Location
  // channel is scenery with no Send on it, so playing into one would be
  // performing to a room the game says nobody is talking in.
  const channel = interaction.channel;
  const placeKey = channel
    ? await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id })
    : null;
  if (!isScenePlaceKey(placeKey)) {
    await respond(interaction, "There's nobody here to hear it.");
    return;
  }

  const result = await playInstrument(prisma, character, placeKey);
  await respond(interaction, result.ok ? result.line : result.error);
}


// /shout — the one thing a character can say that leaves the room they said
// it in. db/lib/shout.js is the shared implementation, the way
// handlePlayCommand above uses db/lib/instrumentPlay.js: the voice gate, the
// five-minute cooldown, a soundproof room, a gag, the shouter's presented name
// and the delivery all live there, so the two faces cannot drift.
//
// They had. This handler kept its own copy for a while — a cooldown in a Map
// that died on every restart, no soundproofing, nobody named, and no archive
// row at all — which meant a shout made on Discord reached nobody on the web
// and was missing from /archive.
async function handleShoutCommand(interaction) {
  await ack(interaction);

  // shout() refuses an empty body too, but asking here keeps the better
  // ordering: somebody who typed nothing should be told to say something
  // rather than that there is nobody to hear it.
  const text = interaction.options.getString("message")?.trim();
  if (!text) {
    await respond(interaction, "Say something.");
    return;
  }

  const character = await actingCharacter(interaction, {
    // discordUserId because shout() stamps the cooldown's AuditLog row with
    // it. Without it the row is written with an empty actor and /gm/audit
    // cannot read a shout back to a person.
    select: { id: true, locationId: true, discordUserId: true },
  });
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  // Where the CHARACTER stands is what the shout is anchored to, not the
  // channel it was typed in — the two can disagree, and only one of them is a
  // place a voice comes from. But the channel still has to be a scene you are
  // in: a Room or a Conversation (db/lib/placeKey.js#isScenePlaceKey), never a
  // zone #summary, a DM, or the open street, which takes no voice at all.
  const shoutChannel = interaction.channel;
  const placeKey = shoutChannel
    ? await placeKeyForChannel(prisma, { channelId: shoutChannel.id, parentId: shoutChannel.parent?.id })
    : null;
  if (!isScenePlaceKey(placeKey)) {
    await respond(interaction, "There's nobody here to hear it.");
    return;
  }

  // Every refusal past this point is shout()'s, in finished sentences respond()
  // prints as they stand — the empty body, no living character, nowhere to
  // stand, a mute, and the cooldown with its minutes already counted.
  const result = await shout(prisma, character, text, { placeKey, source: "DISCORD" });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }

  // Delivery, and it cannot fail the shout: the cooldown is already spent, so
  // a dead channel is one audience short rather than a refusal. That is why
  // the old `posted === 0` check had to go with it — a shout from a soundproof
  // room posts to zero Location channels BY DESIGN, and reporting failure on
  // one was telling the player nothing happened when it had and had cost them
  // five minutes of throat.
  await deliverShout(prisma, { placeKey, here: result.here, heard: result.heard });

  await respond(interaction, result.line);
}


// /ooc. The player talking rather than the character, so this is deliberately
// thinner than handleShoutCommand above: no sound range, no muffling, and no
// voice gate — a gag is something done to a character, and the person behind
// one can still ask a question about the rules.
async function handleOocCommand(interaction) {
  await ack(interaction);

  // ooc() refuses an empty body too; asking here keeps the better ordering, so
  // somebody who typed nothing is told to say something rather than that this
  // is the wrong channel for it.
  const text = interaction.options.getString("message")?.trim();
  if (!text) {
    await respond(interaction, "Say something.");
    return;
  }

  const character = await actingCharacter(interaction, {
    // discordUserId because ooc() stamps the rate-limit AuditLog row with it,
    // and /gm/turns's OOC lens reads those rows back to a person. `name`
    // because the presented identity used for the label falls back to it when
    // nothing conceals or forces (db/lib/presentedIdentity.js).
    select: { id: true, name: true, locationId: true, discordUserId: true },
  });
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  // Unlike a shout, this is anchored to the CHANNEL and not to where the
  // character stands — an OOC line is addressed to the people reading the same
  // place you are reading, which is a fact about the channel. And it is a wider
  // set of channels than a shout takes: a zone #summary and a radio net count
  // too (db/lib/placeKey.js#isOocPlaceKey), since none of this is the character
  // talking. ooc() is what refuses; nothing is checked here.
  const channel = interaction.channel;
  const placeKey = channel
    ? await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id })
    : null;

  // Every refusal past here is ooc()'s, in finished sentences respond() prints
  // as they stand — the wrong place, the length cap, and the rate limit.
  // `source: "DISCORD"` so ooc() knows to fold <@&roleId> into {char:id} tokens
  // for the archive spelling, matching db/lib/say.js#prepareSpeech.
  const result = await ooc(prisma, character, text, { placeKey, source: "DISCORD" });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }

  // Cannot fail the send: the rate-limit row is already claimed, so a dead
  // channel is one audience short rather than a refusal (db/lib/ooc.js).
  await deliverOoc(prisma, {
    placeKey,
    text: result.text,
    rowContent: result.rowContent,
    name: result.name,
    auditId: result.auditId,
  });

  await respond(interaction, "Sent.");
}

module.exports = {
  handleMoveOpen,
  handleMoveSubmit,
  handleSpeakOpen,
  handleSpeakSubmit,
  handleMessageCommand,
  handleHealCommand,
  handleHealPick,
  handleRollCommand,
  handlePlayCommand,
  handleShoutCommand,
  handleOocCommand,
};
