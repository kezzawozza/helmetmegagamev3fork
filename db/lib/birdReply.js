// Answering a bird's letter — the half both faces share.
//
// This used to live entirely inside bot/src/lib/birdReply.js, which meant the
// Reply button was a Discord-only affordance: a web-only player could be
// written to, take the paper, and then watch the window shut with nothing they
// could do about it. That is the same gap db/lib/dmActions.js exists to close
// for offers and seats, and the Bird was the last family still on the wrong
// side of it.
//
// So the rules live here — the window, literacy, the one-reply claim, what a
// sealed answer shows — and the two faces keep only their own transport. See
// docs/systemdocs/BIRD.md.
//
// IT IS A PICKER, NOT A MODAL. Replying means handing the bird a letter you
// are already holding; you write it with the Write button, which has a real
// text box and no three-second clock on it. That also means a reply can go out
// sealed, which a typed box could never have expressed.
//
// Returned side effects, the ARCHITECTURE.md §5 pattern: the DM that has to
// reach the sender is described, never sent. Each face sends it through its
// own sendDm twin. The GM-letter row is a plain database write with no
// transport in it, so it is done here rather than handed back.
const { addToStack, dropCharacterTag } = require("./tagWrites");
const { DM_KIND, GM_LETTER_REPLY_SOURCE } = require("./dmKinds");
const { TOO_LATE_REPLY, canReadLetters, STUPID_SLUG, replyDm } = require("./bird");

// THE WINDOW IS THE WHOLE MECHANIC. A letter can be answered during the turn
// it arrived in and the one after, and then the bird is gone.
//
// `actingCharacterId` is the caller saying who it believes is answering. The
// bot may omit it — the Reply button only ever exists on the recipient's own
// DM, so Discord has already done that check. A web server action is a public
// endpoint and must pass it, or somebody else's birdMessageId is answerable by
// anyone who can read one off a page.
async function birdReplyWindow(prisma, birdMessageId, { actingCharacterId = null } = {}) {
  const message = await prisma.birdMessage.findUnique({ where: { id: String(birdMessageId ?? "") } });
  if (!message) return { ok: false, reason: TOO_LATE_REPLY };
  if (actingCharacterId && message.recipientId !== actingCharacterId) {
    // Deliberately the same line as a letter that never existed. "That isn't
    // yours" confirms that it is somebody's.
    return { ok: false, reason: TOO_LATE_REPLY };
  }
  // One reply, never a chain.
  if (message.repliedAt) return { ok: false, reason: "You already sent your answer." };
  if (!message.delivered || message.replyDeadlineTurn == null) {
    return { ok: false, reason: TOO_LATE_REPLY };
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  // No open turn means the game is between turns; the bird is not gone, it is
  // simply waiting, and refusing here would burn a reply on a technicality.
  if (!openTurn) return { ok: false, reason: "The bird is restless. Try again when the turn opens." };
  if (openTurn.number > message.replyDeadlineTurn) return { ok: false, reason: TOO_LATE_REPLY };

  // Working the bird is a literate act, the same one the sender needed. An
  // illiterate recipient is never offered Reply on either face, but that is
  // only a hint: a GM can strip the tag between the letter landing and the
  // answer going out. Read last, so the cheap refusals above stay cheap.
  const replier = await prisma.character.findUnique({
    where: { id: message.recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!replier || !canReadLetters(replier.tags) || replier.tags.some((ct) => ct.tag.slug === STUPID_SLUG)) {
    return { ok: false, reason: "You cannot write. The bird leaves without an answer." };
  }

  return { ok: true, message, replier };
}

// What the replier could send back: anything written or sealed that they are
// holding. Deliberately not filtered by whether they can READ it — handing on
// a sealed letter you cannot open is a legitimate and interesting move.
//
// `limit` is Discord's cap on a string select's options. The web has no such
// cap and passes none.
function sendableLetters(replier, { limit = null } = {}) {
  const rows = replier.tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .filter((ct) => ct.tag.paperKind === "SEALED" || (ct.tag.paperText ?? "").trim());
  return limit == null ? rows : rows.slice(0, limit);
}

// Hand the bird one of your papers. Re-checks everything birdReplyWindow
// checked — the panel can sit on screen across a turn boundary, and this is
// the check that cannot be outrun.
//
// Returns `{ ok: false, reason }` for every refusal, so both faces say the
// same words, and `{ ok: true, line, dm, characterIds }` on success. `dm` is
// null for a GM letter, which has no sender Character to write to, and
// `characterIds` is every sheet the paper moved on or off — both parties for
// a player letter, the replier alone for a GM's.
async function sendBirdReply(prisma, birdMessageId, tagId, { actingCharacterId = null } = {}) {
  const state = await birdReplyWindow(prisma, birdMessageId, { actingCharacterId });
  if (!state.ok) return state;
  const { message, replier } = state;

  // Resolved against what they actually hold, never against what was posted.
  const held = replier.tags.find((ct) => ct.tagId === String(tagId ?? ""));
  // The two kinds the picker offers, named rather than "has a paperKind" — a
  // bird carries letters, not spent envelopes or books.
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return { ok: false, reason: "You aren't holding that." };
  }

  // A GM letter has no sender Character (BIRD.md §9). Everything below that
  // reaches for one branches on this, and the DM target is the GM's own id.
  const gmSender = message.gmSenderDiscordUserId ?? null;

  if (!gmSender && !message.senderDiscordUserId) {
    return { ok: false, reason: "The bird can't find who sent it." };
  }

  // The claim IS the check, the same shape every other race in this codebase
  // uses: two picks on one panel both pass a read-then-write.
  const claimed = await prisma.birdMessage.updateMany({
    where: { id: message.id, repliedAt: null },
    data: {
      repliedAt: new Date(),
      // A snapshot for the GM desk, null on a sealed reply — the bird did not
      // open that one either. A GM letter is the exception: there the GM IS
      // the addressee, and a letter addressed to you is one you open.
      replyBody:
        !gmSender && held.tag.paperKind === "SEALED" ? null : (held.tag.paperText ?? "").trim(),
    },
  });
  if (claimed.count === 0) return { ok: false, reason: "You already sent your answer." };

  // A reply to somebody who has since died goes nowhere, and the letter stays
  // in the replier's hands rather than vanishing into an empty sheet. Skipped
  // for a GM letter, which has no sender Character to be dead — as written,
  // that lookup would run against a null id, find nothing, and refuse every
  // answer a GM letter ever got.
  if (!gmSender) {
    const senderAlive = await prisma.character.findFirst({
      where: { id: message.senderId, status: "ALIVE" },
      select: { id: true },
    });
    if (!senderAlive) {
      return { ok: false, reason: "The bird will not go. Something has happened to whoever sent it." };
    }
  }

  // The letter changes hands for real — same as an outbound send. Answering a
  // GM has no hands to change it into, so the paper simply leaves: the bird
  // carried it off, which is what the replier was told would happen.
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, replier.id, held.tagId, 1);
    if (!gmSender) await addToStack(tx, message.senderId, held.tagId, 1, {});
  });

  const line = `The bird is away with ${held.tag.name}.`;

  if (gmSender) {
    // The answer itself, filed on the REPLIER's conversation — the desk keys a
    // thread on the player's discordUserId, so that is where a GM reads it. A
    // row keyed on the GM's own id would open a conversation with themselves
    // that nothing on /gm/players ever shows.
    //
    // The letter's WORDS have to arrive somewhere. For a player sender that is
    // the paper landing on their sheet; a GM has no sheet, so it is this row.
    if (message.recipientDiscordUserId) {
      await prisma.directMessage
        .create({
          data: {
            discordUserId: message.recipientDiscordUserId,
            direction: "INBOUND",
            content: (held.tag.paperText ?? "").trim() || "(blank)",
            source: GM_LETTER_REPLY_SOURCE,
            // The one letter row that is conversation. A GM wrote the letter
            // and this is the answer to it, addressed to them — grey it and a
            // GM never learns they were replied to. The outgoing half is a
            // NOTICE, because they already know they sent it.
            kind: DM_KIND.CONVERSATION,
            meta: {
              birdMessageId: message.id,
              letterName: held.tag.name,
              replierName: message.recipientName,
              // A sealed reply's words ARE shown here. The bird's "it did not
              // open this either" rule protects a third party; a GM letter's
              // GM is the addressee, and you open a letter addressed to you.
              sealed: held.tag.paperKind === "SEALED",
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
