const { MessageType } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { findAliveCharacter } = require("../lib/interactionGuild");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("@lifeweb/db/lib/presentedIdentity");
const { sendAsCharacter } = require("../lib/proxy");
const { isDesignatedTupperChannel, resolveChannelContext } = require("../lib/channels");
const { sendDm } = require("../lib/dm");
const { maybeSendGmAutoReply } = require("@lifeweb/db/lib/gmAutoReply");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");
const { splitAttachments, buildInboundContent } = require("@lifeweb/db/lib/dmAttachments");
const { addConversationMember } = require("@lifeweb/db/lib/conversations");
const { placeKeyForChannel } = require("@lifeweb/db/lib/placeKey");
const { isDeadchatChannel } = require("@lifeweb/db/lib/deadchat");
const { ghostCharacterFor } = require("@lifeweb/db/lib/ghost");
const { charactersNamedNearby } = require("@lifeweb/db/lib/characterMentions");
const {
  canHearPing,
  messageLink,
  notifyMentioned,
  resolveMentionedCharacters,
} = require("../lib/mentions");

// How many character-role mentions one message may relay. Each one is a user
// fetch, a DM channel open, a send and a database insert, strictly serial —
// so an uncapped list is a fan-out anyone can trigger by pasting mentions.
const MAX_MENTION_RELAYS = 10;

module.exports = {
  name: "messageCreate",
  async execute(message) {
    // Discord narrates the bot's own housekeeping: pin notices, thread-created lines, and
    // "added X to the thread" (RecipientAdd/RecipientRemove — Discord's group-DM types reused for
    // thread membership). The last two DO NOT actually delete — Discord 400s a thread member-add
    // notice and there's no suppress flag — kept listed so nobody retries it believing it wasn't
    // tried. The real fix is not causing them: thread membership follows entitlement now
    // (db/lib/roomAccess.js). Scoped to bot-authored notices, so a human pin still leaves a trace;
    // placed above the bot guard on purpose since these ARE bot-authored.
    if (
      (message.type === MessageType.ChannelPinnedMessage ||
        message.type === MessageType.ThreadCreated ||
        message.type === MessageType.RecipientAdd ||
        message.type === MessageType.RecipientRemove) &&
      message.author?.id === message.client.user.id
    ) {
      await message.delete().catch((err) =>
        console.error(`Failed to clear a system notice in ${message.channelId}:`, err.message),
      );
      return;
    }

    if (message.author.bot || message.webhookId) return;

    if (!message.inGuild()) {
      const { images, otherNames } = splitAttachments(message.attachments.values());
      const content = buildInboundContent(message.content, otherNames);
      // Every inbound DM is mail for the GMs. Mechanic edits go through a button and modal
      // (bot/src/lib/editModal.js), so nothing a player types for a mechanic travels as a DM.
      // Loud on purpose: a failed insert here is a player's message to Bascinet vanishing silently (CHAT.md §2b).
      console.log(`[dm] inbound from ${message.author.id} (${content.length} chars, ${images.length} image(s))`);
      await prisma.directMessage
        .create({
          data: {
            discordUserId: message.author.id,
            direction: "INBOUND",
            content,
            source: "player",
            kind: DM_KIND.CONVERSATION, // no sendDm default reaches a raw create (db/lib/dmKinds.js)
            discordMessageId: message.id,
            meta: images.length ? { attachments: images } : undefined,
          },
        })
        .catch((err) => console.error(`[dm] inbound log failed for ${message.author.id}:`, err.message));
      // One quiet line back, at most once per 10 minutes (db/lib/gmAutoReply.js). Not awaited into
      // the return path: the player's own message is already filed, and nothing about this reply is
      // worth delaying or failing that.
      maybeSendGmAutoReply(prisma, message.author.id);
      return;
    }

    // #turns: the console channel (bot/src/lib/turnsConsole.js), so typed text is simply removed.
    const channelName = message.channel.name?.toLowerCase();
    if (channelName === "turns") {
      await message.delete().catch(() => { });
      return;
    }

    // A Location channel's own pinned anchor IS the open street, so someone talking there is
    // simply talking in public — nothing to sweep.
    if (!isDesignatedTupperChannel(message.channel)) return;

    // Activity clock for Conversations — informational, debounced to one write per thread per
    // turn. Runs before the character gate so a GM talking in a scene counts too.
    if (message.channel.isThread?.()) {
      touchThreadActivity(message.channel.id).catch((err) =>
        console.error("Thread activity write failed:", err),
      );
    }

    // Identity tags ride along on the busiest query the bot runs, rather than a second round trip.
    let character = await findAliveCharacter(message.author.id, {
      include: {
        tags: {
          where: {
            OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
          },
          select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
        },
      },
    });

    // A GHOST typing in Deadchat (db/lib/deadchat.js). Without this arm their raw message would sit
    // in the channel under their real Discord name, un-proxied and un-archived — the one failure the
    // proxy's header promises cannot happen. Scoped to that channel: a dead player has no business
    // speaking anywhere else, and prepareSpeech would refuse them there anyway.
    let ghost = false;
    if (!character && (await isDeadchatChannel(prisma, message.channel?.id))) {
      character = await ghostCharacterFor(prisma, message.author.id);
      ghost = Boolean(character);
    }
    if (!character) return;

    // Precedence forced > concealed > own (db/lib/presentedIdentity.js). A ghost skips all of it —
    // prepareSpeech composes "Solomon Baker (Pub Fries)" for them instead, and a hood their corpse is
    // still wearing has no business in an out-of-character room.
    const identity = ghost
      ? null
      : presentedIdentity(character, {
          forcedName: forcedNameFrom(character.tags),
          concealment: concealmentFrom(character.tags),
        });

    const mentionedRoleIds = [...message.mentions.roles.keys()]; // captured before proxying deletes the original
    const channel = message.channel;

    // sendAsCharacter owns the failure path: deletes the original on every route and DMs the
    // player their text back. Null means it refused.
    let proxied;
    try {
      proxied = await sendAsCharacter(channel, character, message, { identity, ghost });
    } catch (err) {
      console.error("Failed to proxy message:", err);
      return;
    }
    if (!proxied) return;

    // A concealed (or forced) message relays nothing — a DM naming the location would hand the
    // target a thread to pull on. A ghost relays nothing either: a mention typed in Deadchat that
    // DM'd a living player would be the dead reaching into the world.
    //
    // The role check is gone from this gate. A BARE NAME is a mention too now
    // (REDESIGN.md §2, §6), so a message with no `@` in it at all still has to be
    // looked at; handleMentions returns on its own when neither list holds
    // anybody. Same precedence as before — a hood beats everything.
    if (ghost || identity.concealed) return;

    await handleMentions({ message, channel, proxied, mentionedRoleIds, speakerId: character.id }).catch((err) =>
      console.error("Failed to handle mentions:", err),
    );
  },
};

// In-memory debounce: threadId -> turn number already recorded. A restart losing this map costs
// nothing — the sweep re-derives activity from each thread's last_message_id snowflake.
const activityWritten = new Map();

async function touchThreadActivity(threadId) {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  const turnNumber = openTurn?.number ?? null;
  if (turnNumber !== null && activityWritten.get(threadId) === turnNumber) return;

  const updated = await prisma.playerThread.updateMany({
    where: { threadId },
    data: { lastActivityTurn: turnNumber ?? undefined, lastActivityAt: new Date() },
  });
  if (updated.count > 0 && turnNumber !== null) activityWritten.set(threadId, turnNumber); // only threads we actually track
}

// Two independent things a character-role mention does: notify the player, and — in a
// Conversation — let them in.
async function handleMentions({ message, channel, proxied, mentionedRoleIds, speakerId = null }) {
  const context = resolveChannelContext(channel);
  const mentioned = await resolveMentionedCharacters(mentionedRoleIds);

  // The place this channel is, for the bare-name lookup and for the relay's own
  // deep link. Memoised, already warm.
  const placeKey = await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id }).catch(() => null);

  // A BARE NAME is a mention (REDESIGN.md §2, §6): "Marrow, get down" names
  // Marrow exactly as `@Marrow` would. db/lib/mentions.js is the predicate and
  // db/lib/characterMentions.js#charactersNamedNearby the earshot query, and the
  // web's send path asks both the same way (bot/src/lib/feedOutbox.js), so one
  // rule answers on both faces.
  //
  // NOTIFY-ONLY, and kept apart from `mentioned` for exactly that reason: a role
  // mention inside a Conversation is also an invite, and a bare name must never
  // be, or saying "Marrow told me" in a private conversation would pull her in.
  // The message text is untouched either way — nothing is rewritten into a ping.
  const named = placeKey
    ? await charactersNamedNearby(prisma, {
        placeKey,
        content: message.content ?? "",
        speakerId,
      }).catch((err) => {
        console.error("Bare-name mention lookup failed:", err?.message ?? err);
        return [];
      })
    : [];

  // The proxy suppresses the role ping itself, so a swallowed mention looks delivered — log it.
  console.log(
    `[mentions] roles=${mentionedRoleIds.join(",")} resolved=${mentioned.length} named=${named.length} ` +
    `location=${context.locationId ?? "none"} kind=${context.channelKind ?? "none"}`,
  );
  if (mentioned.length === 0 && named.length === 0) return;

  // Each target costs a user fetch, a DM open, a send and a DB insert, all serialized. Ten is well
  // past any legitimate ping, and the refusal names who was dropped.
  // Token targets first, so a name that is BOTH tokened and typed keeps its
  // invite; deduped, then capped across the pair.
  const wanted = [];
  const seenIds = new Set();
  for (const entry of [
    ...mentioned.map((target) => ({ target, invite: true })),
    ...named.map((target) => ({ target, invite: false })),
  ]) {
    if (!entry.target?.id || seenIds.has(entry.target.id)) continue;
    seenIds.add(entry.target.id);
    wanted.push(entry);
  }
  const relayed = wanted.slice(0, MAX_MENTION_RELAYS);
  const dropped = wanted.slice(MAX_MENTION_RELAYS).map((entry) => entry.target);
  if (dropped.length > 0) {
    console.log(`[mentions] capped at ${MAX_MENTION_RELAYS}, skipped ${dropped.length}`);
    await sendDm(
      message.author,
      `» *That named ${wanted.length} people at once, so only the first ${MAX_MENTION_RELAYS} were told. ` +
      `Not notified: ${dropped.map((t) => t.name).join(", ")}.*`,
      { kind: DM_KIND.QUIET },
    ).catch(() => { });
  }

  const link = messageLink(message.guildId, channel.id, proxied.id);
  // A mention only becomes an invite inside a Conversation — a private Room is gated on a key tag
  // instead (db/lib/roomAccess.js); a ping would route straight around that lock.
  const conversation = await prisma.playerThread
    .findUnique({ where: { threadId: channel.id }, select: { id: true, locationId: true } })
    .catch((err) => {
      console.error("Conversation lookup failed for a mention:", err);
      return null;
    });

  const notHere = []; // collected, so the author gets one DM instead of one per absent person named

  for (const { target, invite } of relayed) {
    if (conversation && invite) {
      // Same contract as /add: recorded, applied now if the target already stands here, replayed
      // by applyPendingInvites otherwise. Membership is a DB row; Discord's list is its projection.
      await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: target.id });
      await prisma.playerThreadInvite
        .upsert({
          where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
          update: {},
          create: { threadId: channel.id, characterId: target.id },
        })
        .catch((err) => console.error("Failed to record thread invite:", err));
      if (target.locationId === conversation.locationId && target.discordMirrored) { // not-mirrored has no Discord presence to add (CHAT.md §6)
        await channel.members.add(target.discordUserId).catch((err) =>
          console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err),
        );
        await notifyMentioned(message.client, target, context, link, { placeKey });
      } else {
        console.log(`[mentions] ${target.name}: not in ${context.locationName ?? "this location"}, invite recorded`);
        notHere.push(target.name);
      }
      continue;
    }

    // A bare-name target came out of the earshot query itself, so it has already
    // passed this; a role target has not, and a ping must not carry further than
    // a voice would (PROXYING.md §6).
    const heard = !invite || (await canHearPing(target, context));
    console.log(`[mentions] ${target.name}: ${heard ? "notified" : "out of earshot, no DM"}`);
    if (heard) {
      await notifyMentioned(message.client, target, context, link, { placeKey });
    }
  }

  if (notHere.length > 0) {
    const where = context.locationName ?? context.zoneName ?? "this place";
    await sendDm(
      message.author,
      notHere.length === 1
        ? `» *${notHere[0]} isn't in ${where}. They'll see this conversation when they arrive.*`
        : `» *${notHere.join(", ")} aren't in ${where}. They'll see this conversation when they arrive.*`,
      { kind: DM_KIND.QUIET },
    ).catch(() => { });
  }
}
