// Answering a bird's letter — the half both faces share: the window,
// literacy, the one-reply claim, what a sealed answer shows (BIRD.md). Each
// face keeps only its own transport, closing the same web/Discord gap
// db/lib/dmActions.js closes for offers and seats. IT IS A PICKER, NOT A
// MODAL: replying hands the bird a letter already held, written via Write's
// real text box with no three-second clock, which is why a reply can go out
// sealed. Returned side effects (ARCHITECTURE.md §5): the DM to the sender is
// described, never sent — each face sends it through its own sendDm twin. The
// GM-letter row is a plain database write with no transport, so it's done here.
const { addToStack, dropCharacterTag } = require("./tagWrites");
const { DM_KIND, GM_LETTER_REPLY_SOURCE } = require("./dmKinds");
const { TOO_LATE_REPLY, canReadLetters, STUPID_SLUG, replyDm } = require("./bird");

// THE WINDOW IS THE WHOLE MECHANIC: answerable the turn it arrived and the
// one after, then the bird is gone. `actingCharacterId` is who the caller
// believes is answering; the bot may omit it (Discord already checked, since
// Reply only exists on the recipient's own DM) but a web server action is a
// public endpoint and must pass it, or anyone can answer any birdMessageId.
async function birdReplyWindow(prisma, birdMessageId, { actingCharacterId = null } = {}) {
  const message = await prisma.birdMessage.findUnique({ where: { id: String(birdMessageId ?? "") } });
  if (!message) return { ok: false, reason: TOO_LATE_REPLY };
  if (actingCharacterId && message.recipientId !== actingCharacterId) {
    // Deliberately the same line as a letter that never existed — "that isn't yours" would confirm one exists.
    return { ok: false, reason: TOO_LATE_REPLY };
  }
  if (message.repliedAt) return { ok: false, reason: "You already sent your answer." };
  if (!message.delivered || message.replyDeadlineTurn == null) {
    return { ok: false, reason: TOO_LATE_REPLY };
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  // Between turns: the bird is waiting, not gone — refusing here would burn a reply on a technicality.
  if (!openTurn) return { ok: false, reason: "The bird is restless. Try again when the turn opens." };
  if (openTurn.number > message.replyDeadlineTurn) return { ok: false, reason: TOO_LATE_REPLY };

  // Literacy is only a hint on either face — a GM can strip the tag between letter and answer.
  // Read last, so the cheap refusals above stay cheap.
  const replier = await prisma.character.findUnique({
    where: { id: message.recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!replier || !canReadLetters(replier.tags) || replier.tags.some((ct) => ct.tag.slug === STUPID_SLUG)) {
    return { ok: false, reason: "You cannot write. The bird leaves without an answer." };
  }

  return { ok: true, message, replier };
}

// Not filtered by whether the replier can READ it — handing on a sealed
// letter you can't open is a legitimate move. `limit` is Discord's string-select cap; web passes none.
function sendableLetters(replier, { limit = null } = {}) {
  const rows = replier.tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .filter((ct) => ct.tag.paperKind === "SEALED" || (ct.tag.paperText ?? "").trim());
  return limit == null ? rows : rows.slice(0, limit);
}

// Hand the bird one of your papers. Re-checks everything birdReplyWindow
// checked, since the panel can sit on screen across a turn boundary. `dm` is
// null for a GM letter (no sender Character); `characterIds` is every sheet
// the paper moved on/off — both parties for a player letter, replier alone for a GM's.
async function sendBirdReply(prisma, birdMessageId, tagId, { actingCharacterId = null } = {}) {
  const state = await birdReplyWindow(prisma, birdMessageId, { actingCharacterId });
  if (!state.ok) return state;
  const { message, replier } = state;

  // Resolved against what they actually hold, never against what was posted.
  const held = replier.tags.find((ct) => ct.tagId === String(tagId ?? ""));
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return { ok: false, reason: "You aren't holding that." };
  }

  // A GM letter has no sender Character (BIRD.md §9); everything below branches on this.
  const gmSender = message.gmSenderDiscordUserId ?? null;

  if (!gmSender && !message.senderDiscordUserId) {
    return { ok: false, reason: "The bird can't find who sent it." };
  }

  // The claim IS the check — two picks on one panel both pass a read-then-write.
  const claimed = await prisma.birdMessage.updateMany({
    where: { id: message.id, repliedAt: null },
    data: {
      repliedAt: new Date(),
      // Snapshot for the GM desk, null on a sealed reply — except a GM letter, where the GM IS
      // the addressee and opens what's addressed to them.
      replyBody:
        !gmSender && held.tag.paperKind === "SEALED" ? null : (held.tag.paperText ?? "").trim(),
    },
  });
  if (claimed.count === 0) return { ok: false, reason: "You already sent your answer." };

  // A reply to someone since dead goes nowhere; letter stays in the replier's
  // hands. Skipped for a GM letter — that lookup would run against a null id
  // and refuse every answer a GM letter ever got.
  if (!gmSender) {
    const senderAlive = await prisma.character.findFirst({
      where: { id: message.senderId, status: "ALIVE" },
      select: { id: true },
    });
    if (!senderAlive) {
      return { ok: false, reason: "The bird will not go. Something has happened to whoever sent it." };
    }
  }

  // Same as an outbound send; answering a GM has no hands to change into, so the paper simply leaves.
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, replier.id, held.tagId, 1);
    if (!gmSender) await addToStack(tx, message.senderId, held.tagId, 1, {});
  });

  const line = `The bird is away with ${held.tag.name}.`;

  if (gmSender) {
    // Filed on the REPLIER's conversation — the desk keys a thread on the
    // player's discordUserId; a row on the GM's own id would open a
    // conversation with themselves nothing on /gm/players shows.
    if (message.recipientDiscordUserId) {
      await prisma.directMessage
        .create({
          data: {
            discordUserId: message.recipientDiscordUserId,
            direction: "INBOUND",
            content: (held.tag.paperText ?? "").trim() || "(blank)",
            source: GM_LETTER_REPLY_SOURCE,
            // The one letter row that is conversation — grey it and a GM never learns they were
            // replied to. Outgoing half is a NOTICE, since they already know they sent it.
            kind: DM_KIND.CONVERSATION,
            meta: {
              birdMessageId: message.id,
              letterName: held.tag.name,
              replierName: message.recipientName,
              sealed: held.tag.paperKind === "SEALED", // the GM is the addressee, so shown regardless
              sealMark: held.tag.sealMark ?? null,
              gmSenderDiscordUserId: gmSender,
            },
          },
        })
        .catch((err) => console.error(`GM letter reply row for ${message.recipientId} failed:`, err));
    }
    return { ok: true, line, dm: null, characterIds: [replier.id] };
  }

  return {
    ok: true,
    line,
    characterIds: [replier.id, message.senderId],
    dm: {
      discordUserId: message.senderDiscordUserId,
      content: replyDm({ replierName: message.recipientName, letterName: held.tag.name }),
      opts: {
        source: "bird",
        meta: { kind: "bird_reply", birdMessageId: message.id, letterName: held.tag.name },
      },
    },
  };
}

module.exports = { birdReplyWindow, sendableLetters, sendBirdReply };
