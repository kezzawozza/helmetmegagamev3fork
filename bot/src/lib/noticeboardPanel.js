const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { readBlock } = require("@lifeweb/db/lib/reading");
const { paperDescription } = require("@lifeweb/db/lib/paper");
const { addToStack, dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { expiryFrom } = require("@lifeweb/db/lib/turnFormat");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");
const { mintUnownedPaper } = require("@lifeweb/db/lib/paperMint");
const { cleanCustomText } = require("@lifeweb/db/lib/customText");
const { TITLE_MAX, WRITE_MAX } = require("@lifeweb/db/lib/paper");
const {
  BOARD_OPTION_LIMIT,
  boardText,
  destroyNotice,
  hasNoticeboard,
  pinnedLine,
  tornLine,
} = require("@lifeweb/db/lib/noticeboard");
const { ack, respond } = require("./respond");
const { actingCharacter, isGmMember } = require("./interactionGuild");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { isDaylight } = require("@lifeweb/db/lib/turnClock");

// The Noticeboard button on a Location's anchor (docs/systemdocs/PAPERWORK.md). Everything is
// ephemeral except the ambient line a pin raises, so five people can read the same board at once.
// Three selects, not a button pair per notice: Discord's five-action-row cap would overflow the
// board at three notices.

const READ_PREFIX = "notice:read:";
const TEAR_PREFIX = "notice:tear:";
const PIN_PREFIX = "notice:pin:";
// The GM's two: the button that opens the writing modal, and the modal itself.
const POST_PREFIX = "notice:post:";
const POST_MODAL_PREFIX = "notice:postmodal:";

// One rule decides the panel: an alive character standing here acts as that character; otherwise
// a GM acts as a GM; otherwise "You're not here." `ctx.character` is null in GM mode, guarded by `ctx.gm`.
async function boardContext(interaction, locationId) {
  const character = await actingCharacter(interaction, {
    include: { tags: { include: { tag: true } } },
  });
  const [location, openTurn] = await Promise.all([
    prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, indoors: true, attributes: true, discordChannelId: true },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } }),
  ]);
  if (!location) return { error: "That place is gone." };
  if (!hasNoticeboard(location)) return { error: "There's no board here." };

  const here = Boolean(character && character.locationId === location.id); // the whole permission model for a player
  const gm = !here && isGmMember(interaction);
  if (!here && !gm) {
    return { error: "You're not here." };
  }

  const posts = await prisma.noticePost.findMany({
    where: { locationId: location.id },
    orderBy: { expiresTurn: "asc" },
    take: BOARD_OPTION_LIMIT,
    include: { tag: true },
  });

  return {
    location,
    character: here ? character : null,
    gm,
    openTurn,
    posts,
    where: { daylight: isDaylight(), indoors: location.indoors ?? true },
  };
}

function selectRow(customId, placeholder, options) {
  if (options.length === 0) return null;
  return {
    type: 1,
    components: [{ type: 3, custom_id: customId, placeholder, options }],
  };
}

async function handleNoticeboardOpen(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });

  const { location, character, gm, posts, openTurn } = ctx;

  // Never gated on whether they can read it — pinning a letter you can't read is fine. A GM holds
  // nothing, so their third row is a button instead: they write the notice on the spot.
  const holding = gm
    ? []
    : character.tags
        .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
        .slice(0, BOARD_OPTION_LIMIT);

  const noticeOptions = posts.map((p) => ({ label: p.tag.name.slice(0, 100), value: p.id }));
  const rows = [
    selectRow(`${READ_PREFIX}${location.id}`, "Read a notice…", noticeOptions),
    selectRow(`${TEAR_PREFIX}${location.id}`, "Tear one down…", noticeOptions),
    gm
      ? {
          type: 1,
          components: [
            { type: 2, style: 2, custom_id: `${POST_PREFIX}${location.id}`, label: "Post a notice" },
          ],
        }
      : selectRow(
          `${PIN_PREFIX}${location.id}`,
          "Pin a paper…",
          holding.map((ct) => ({
            label: ct.tag.name.slice(0, 100),
            value: ct.tagId,
            description: ct.tag.paperKind === "SEALED" ? "Sealed" : undefined,
          })),
        ),
  ].filter(Boolean);

  return respond(interaction, {
    content: boardText(location.name, posts, openTurn?.number ?? 0),
    components: rows,
  });
}

async function handleNoticeRead(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });

  const post = ctx.posts.find((p) => p.id === interaction.values?.[0]);
  if (!post) return respond(interaction, { content: "It's gone." });

  // Same predicate and sentence the tag chip uses — blind and illiterate get identical refusals.
  // A GM skips the gate entirely (they hold no tags, so readBlock would refuse everything).
  const text = ctx.gm
    ? (post.tag.paperText ?? "").trim()
    : paperDescription(post.tag, { tags: ctx.character.tags, ...ctx.where });
  const blocked = ctx.gm ? null : readBlock(ctx.character.tags, ctx.where);
  if (ctx.gm) {
    return respond(interaction, { content: text ? `\`\`\`\n${text}\n\`\`\`` : "It's blank." });
  }

  const content = blocked || post.tag.paperKind === "SEALED" ? text : `\`\`\`\n${text}\n\`\`\``; // code block stops markdown/pings
  return respond(interaction, { content });
}

async function handleNoticeTear(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });

  const post = ctx.posts.find((p) => p.id === interaction.values?.[0]);
  if (!post) return respond(interaction, { content: "It's gone." });

  // The delete IS the claim, so two people can't both walk away with it. A GM has no hands to take
  // it into, so the paper goes with the post — same as a notice that expires on its own clock.
  const claimed = ctx.gm
    ? await destroyNotice(prisma, post)
    : await prisma.noticePost.deleteMany({ where: { id: post.id } });
  if (claimed.count === 0) {
    return respond(interaction, { content: "Somebody got there first." });
  }
  if (!ctx.gm) await addToStack(prisma, ctx.character.id, post.tagId, 1, {});

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => { }); // unreachable channel must never undo a committed tear (ARCHITECTURE.md §5)
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name) }); // beside the post, so Chat sees it too
  return respond(interaction, { content: `You take ${post.tag.name} down.` });
}

async function handleNoticePin(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });
  if (!ctx.openTurn) return respond(interaction, { content: "Nothing is happening yet." });

  if (ctx.gm) return respond(interaction, { content: "You aren't holding that." }); // a customId is a string anybody can send back

  const tagId = interaction.values?.[0];
  const held = ctx.character.tags.find((ct) => ct.tagId === tagId);
  // Same two kinds the picker offers — "has a paperKind" isn't the check: an envelope and a book both have one.
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return respond(interaction, { content: "You aren't holding that." });
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { noticeExpiryTurns: true },
  });
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10); // N turns counting the one it went up in

  try {
    await prisma.$transaction(async (tx) => {
      // NoticePost.tagId is @unique: on a board or in hands, never both. Creating first means a
      // paper pinned elsewhere fails here rather than being silently lost.
      await tx.noticePost.create({
        data: {
          locationId: ctx.location.id,
          tagId: held.tagId,
          postedById: ctx.character.id,
          postedTurn: ctx.openTurn.number,
          expiresTurn,
        },
      });
      await dropCharacterTag(tx, ctx.character.id, held.tagId, 1);
    });
  } catch (err) {
    if (err?.code === "P2002") {
      return respond(interaction, { content: "That one is already up somewhere." });
    }
    throw err;
  }

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(held.tag.name))).catch(() => { });
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(held.tag.name) });
  return respond(interaction, {
    content: `You put ${held.tag.name} up. Anyone here can read it, or take it down.`,
  });
}

// showModal IS the acknowledgement, so it's the first thing here — no ack(). Permission is decided
// at SUBMIT instead, the way the Intercom's modal does.
async function handleNoticePost(interaction, locationId) {
  if (!isGmMember(interaction)) {
    return respond(interaction, { content: "You're not here." });
  }
  const modal = new ModalBuilder()
    .setCustomId(`${POST_MODAL_PREFIX}${locationId}`)
    .setTitle("Post a notice")
    .addLabelComponents(
      new LabelBuilder().setLabel("Title").setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("notice:title")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(TITLE_MAX)
          .setRequired(false),
      ),
      new LabelBuilder().setLabel("Body").setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("notice:body")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(WRITE_MAX)
          .setRequired(true),
      ),
    );
  return interaction.showModal(modal).catch((err) => {
    console.error("Failed to open the notice modal:", err);
  });
}

async function handleNoticePostSubmit(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  // The whole gate again, at submit: a modal outlives everything it was opened against.
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });
  if (!ctx.gm) return respond(interaction, { content: "You're not here." });
  if (!ctx.openTurn) return respond(interaction, { content: "Nothing is happening yet." });

  // Title CLEANED, body only trimmed — same as the player's own Write (web/app/(app)/character/paperActions.js).
  const title = cleanCustomText(interaction.fields.getTextInputValue("notice:title"), TITLE_MAX) || null;
  const body = (interaction.fields.getTextInputValue("notice:body") ?? "").trim().slice(0, WRITE_MAX);
  if (!body) return respond(interaction, { content: "Write something first." });

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { noticeExpiryTurns: true },
  });
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  // Minted outside a transaction: createWithRetry re-rolls the slug on a unique collision, and
  // Postgres aborts a whole transaction on the first failed statement (db/lib/paperMint.js).
  const paper = await mintUnownedPaper(
    prisma,
    `gm-notice-${locationId}`,
    interaction.user.id,
    body,
    title,
  );

  try {
    await prisma.noticePost.create({
      data: {
        locationId: ctx.location.id,
        tagId: paper.id,
        postedById: null, // nobody pinned it; same shape a Wanted poster lands in
        postedTurn: ctx.openTurn.number,
        expiresTurn,
      },
    });
  } catch (err) {
    await prisma.tag.deleteMany({ where: { id: paper.id, ephemeral: true } }).catch(() => {}); // the board rejected it; don't leave an orphan
    if (err?.code === "P2002") {
      return respond(interaction, { content: "That one is already up somewhere." });
    }
    throw err;
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "gm_post_notice",
        details: {
          locationId: ctx.location.id,
          locationName: ctx.location.name,
          tagId: paper.id,
          tagName: paper.name,
          face: "discord",
        },
      },
    })
    .catch((err) => console.error("Notice audit log failed:", err));

  // Same line a player's pin raises — names the paper, never the person, so nobody can tell it's a GM's.
  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(paper.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(paper.name) });
  return respond(interaction, {
    content: `You put ${paper.name} up. Anyone here can read it, or take it down.`,
  });
}

module.exports = {
  READ_PREFIX,
  TEAR_PREFIX,
  PIN_PREFIX,
  POST_PREFIX,
  POST_MODAL_PREFIX,
  handleNoticeboardOpen,
  handleNoticeRead,
  handleNoticeTear,
  handleNoticePin,
  handleNoticePost,
  handleNoticePostSubmit,
};
