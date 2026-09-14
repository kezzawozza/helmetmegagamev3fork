const { EmbedBuilder } = require("discord.js");
const { prisma, formatTagRequirement, formatTagArmor, turnsLeft, formatTurnsLeft } = require("@lifeweb/db");
const { gmRoleIds } = require("@lifeweb/db/lib/roleIds");
const { VIEWER_SELECT, examineRow } = require("@lifeweb/db/lib/examineRow"); // 🔍 readout is shared with the web's
const { deleteSpeech, EDIT_WINDOW_MS, WINDOW_REFUSAL } = require("@lifeweb/db/lib/say");
const { proxyRowFor } = require("../lib/proxy");
const { findAliveCharacter } = require("../lib/interactionGuild");
const { resolveChannelContext } = require("../lib/channels");
const { forcedNameFrom, presentedIdentity } = require("@lifeweb/db/lib/presentedIdentity");
const { photoCaption } = require("@lifeweb/db/lib/photo");
const { CAMERA_SLUG, mintPhoto } = require("@lifeweb/db/lib/photoMint");

// Discord embed limits: a breach rejects the whole embed silently. Trim with
// fitField/fitDescription below before adding a field.
const EMBED_FIELD_LIMIT = 1024;
const EMBED_DESCRIPTION_LIMIT = 4096;

function fitField(value) {
  const text = String(value ?? "");
  return text.length > EMBED_FIELD_LIMIT ? `${text.slice(0, EMBED_FIELD_LIMIT - 14)}… (+more)` : text;
}

function fitDescription(value) {
  const text = String(value ?? "");
  return text.length > EMBED_DESCRIPTION_LIMIT ? `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…` : text;
}
const { sendDm } = require("../lib/dm");
const { buildEditPrompt, stashEdit } = require("../lib/editModal");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");
const { tagDisplayName } = require("@lifeweb/db/lib/tagDisplayName");

const DELETE_EMOJI = "❌";
const EDIT_EMOJIS = ["✏️", "📝"];
const INSPECT_EMOJIS = ["🔍", "🔎"];
const STAR_EMOJI = "⭐";
const FOG_EMOJI = "🌫️";
const DOSSIER_EMOJI = "⚜️"; // GM only
const CAMERA_EMOJIS = ["📸", "📷"]; // nobody can tell them apart in a picker

const KNOWN_EMOJIS = new Set([ // every emoji this file acts on; an unrecognised one is dropped before fetch
  DELETE_EMOJI,
  STAR_EMOJI,
  FOG_EMOJI,
  DOSSIER_EMOJI,
  ...EDIT_EMOJIS,
  ...INSPECT_EMOJIS,
  ...CAMERA_EMOJIS,
]);

// Saves the message to the reactor's personal Notes. `proxy` falls back to ArchiveEntry, then the
// poster's display name for a bot-as-itself post.
async function handleStarReaction(reaction, proxy, user) {
  const message = reaction.message;

  let characterId = null;
  let characterName = null;
  let avatarPath = null;
  let zoneId = null;

  if (proxy) {
    const character = await prisma.character.findUnique({ where: { id: proxy.characterId } });
    if (!character) return;
    characterId = character.id;
    characterName = proxy.alias ?? character.name; // filed under the alias, so a note never hands back what concealment hid
    avatarPath = proxy.alias ? (proxy.avatarPath ?? null) : null; // same gate for the face
    zoneId = character.zoneId ?? null;
  } else {
    const archived = await prisma.archiveEntry.findUnique({ where: { discordMessageId: message.id } });
    if (archived && archived.characterId) {
      characterId = archived.characterId;
      characterName = archived.concealedAlias ?? archived.characterName ?? "Unknown";
      avatarPath = archived.concealedAlias ? (archived.presentedAvatarPath ?? null) : null;
      zoneId = archived.zoneId ?? null;
    } else {
      characterName = message.member?.displayName ?? message.author?.displayName ?? message.author?.username ??
        "Bascinet";
      zoneId = resolveChannelContext(message.channel).zoneId;
    }
  }

  const content = message.content || message.embeds?.[0]?.description || message.embeds?.[0]?.title || ""; // fallback is only for a 🌫️ fog repost
  if (!content && message.attachments?.size === 0) return;

  await prisma.note.upsert({
    where: { discordMessageId_discordUserId: { discordMessageId: message.id, discordUserId: user.id } },
    create: {
      discordMessageId: message.id,
      discordChannelId: message.channelId,
      characterId,
      characterName,
      presentedAvatarPath: avatarPath,
      zoneId,
      content,
      sentAt: message.createdAt,
      discordUserId: user.id,
    },
    update: {},
  });
}

// GM-only, no vision gates, concealment ignored. No channel fallback if the DM bounces — that
// would hand the room the tags and Desire, so it logs and drops.
async function handleDossierReaction(reaction, proxy, user) {
  const [character, openTurn] = await Promise.all([
    prisma.character.findUnique({
      where: { id: proxy.characterId },
      include: {
        tags: { include: { tag: true } },
        faction: { select: { name: true } },
        location: { select: { name: true } },
        zone: { select: { name: true } },
      },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }),
  ]);
  if (!character) return;

  const [action, desires] = await Promise.all([
    openTurn
      ? prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id } })
      : null,
    prisma.desire.findMany({ // last fulfilled Desire, claimed retroactively (DESIRES.md §1)
      where: { characterId: character.id, status: "FULFILLED" },
      orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
      take: 1,
      select: { text: true, points: true },
    }),
  ]);

  const identity = presentedIdentity(character, { forcedName: forcedNameFrom(character.tags) }); // GM eyes: real name/face, mask noted not worn
  const where = [character.location?.name, character.zone?.name].filter(Boolean).join(" · ") || "nowhere";
  const embed = new EmbedBuilder()
    .setTitle(character.name)
    .setDescription(fitDescription(character.appearance || "No visible appearance."))
    .addFields({
      name: "Standing",
      value: [
        where,
        character.faction?.name ?? "Unaffiliated",
        `${character.resources} ⬢`,
        proxy.concealed ? `concealed as ${proxy.alias ?? "Unknown"}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  if (identity.forced) {
    embed.addFields({ name: "Presents as ", value: identity.name, inline: true });
  }

  if (character.tags.length > 0) { // fitField trims to Discord's 1024-char embed field cap
    const rendered = character.tags.map((ct) => {
      const bits = [
        formatTagRequirement(ct.tag),
        formatTagArmor(ct.tag),
        formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurn?.number)),
        ct.equipped ? "worn" : null,
        ct.quantity > 1 ? `x${ct.quantity}` : null,
      ].filter(Boolean);
      const shown = tagDisplayName(ct.tag);
      return bits.length > 0 ? `${shown} (${bits.join(" · ")})` : shown;
    });
    embed.addFields({ name: "Tags", value: fitField(rendered.join(", ")) });
  }

  embed.addFields({
    name: "This turn",
    value: action
      ? [
        action.moveKind ? (action.moveKind === "GAMBIT" ? "Gambit" : "Routine") : "Move",
        action.moveReviewStatus,
        action.diceRoll != null
          ? `🎲 ${action.diceRoll}${action.diceModifier ? ` (${action.diceModifier > 0 ? "+" : ""}${action.diceModifier})` : ""}`
          : null,
        action.resourceDelta != null ? `${action.resourceDelta > 0 ? "+" : ""}${action.resourceDelta} ⬢` : null,
      ]
        .filter(Boolean)
        .join(" · ")
      : "Has not acted.",
  });

  if (desires.length > 0) {
    embed.addFields({
      name: "Last Desire",
      value: fitField(desires.map((d) => `» ${d.text} (+${d.points})`).join("\n")),
    });
  }

  if (process.env.WEB_BASE_URL) {
    embed.setThumbnail(`${process.env.WEB_BASE_URL}/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`);
  }

  await sendDm(user, { embeds: [embed] });
}

// Behind both 🔍 and 📸 (and the web's eyes too): db/lib/examineRow.js is the one implementation.
// Pressed against the row's seq, not its character id, so only the server ever knows who's under the hood.
async function readoutForReaction(proxy, user, { bystander = false } = {}) {
  const viewer = await findAliveCharacter(user.id, { select: VIEWER_SELECT });
  if (!viewer) return null;
  return examineRow(prisma, viewer, proxy.seq, { bystander });
}

// Shared by 🔍 and 📸 — a photograph shows the same thing looking at somebody does.
function examineEmbed(readout) {
  const embed = new EmbedBuilder();
  if (readout.concealed) {
    embed.setDescription(readout.line);
  } else {
    embed.setTitle(readout.name).setDescription(fitDescription(readout.appearance || "No visible appearance."));
  }
  if (readout.ailments.length > 0) {
    embed.addFields({ name: "Ailments", value: fitField(readout.ailments.join(", ")) });
  }
  if (readout.equipment.length > 0) {
    embed.addFields({ name: "Equipment", value: fitField(readout.equipment.join(", ")) });
  }
  if (readout.tags.length > 0) {
    const value = readout.tags.map((t) => (t.detail ? `${t.name} (${t.detail})` : t.name)).join(", ");
    embed.addFields({ name: "Tags", value: fitField(value) });
  }
  if (readout.desire) {
    embed.addFields({
      name: "Last Desire",
      value: readout.desire.text
        ? fitField(`» ${readout.desire.text} (+${readout.desire.points})`)
        : "Nothing you can read.",
    });
  }
  if (readout.roleTitle) embed.addFields({ name: "Role", value: readout.roleTitle, inline: true });
  if (readout.resources != null) {
    embed.addFields({ name: "Resources", value: `${readout.resources} ⬢`, inline: true });
  }
  if (process.env.WEB_BASE_URL) {
    embed.setThumbnail(`${process.env.WEB_BASE_URL}${readout.avatarPath}`);
  }
  return embed;
}

// 📸 — an Examine that stopped moving, freezing the reading onto a real Tag row. The camera is NOT
// spent — holding one is the whole gate (consuming one is the separate path in requestActions.js).
// One shot per message per photographer, in memory and volatile across a restart (harmless: a
// restart just hands one more shot of an old message, and re-photographing the same moment is the same photo).
const photographed = new Set();
const photographKey = (messageId, characterId) => `${messageId}:${characterId}`;

async function handleCameraReaction(reaction, proxy, user) {
  const held = await prisma.characterTag.findFirst({
    where: {
      character: { discordUserId: user.id, status: "ALIVE" },
      tag: { slug: CAMERA_SLUG },
      quantity: { gt: 0 },
    },
    select: { characterId: true },
  });
  if (!held) {
    await sendDm(user, "» *You have no camera.*", { kind: DM_KIND.QUIET }).catch((err) =>
      console.error(`Couldn't tell ${user.id} they have no camera:`, err),
    );
    return;
  }

  const key = photographKey(reaction.message.id, held.characterId);
  if (photographed.has(key)) {
    await sendDm(user, "» *You already have that shot.*", { kind: DM_KIND.QUIET }).catch((err) =>
      console.error(`Couldn't tell ${user.id} they already shot that:`, err),
    );
    return;
  }

  const result = await readoutForReaction(proxy, user, { bystander: true });
  if (!result) return;
  if (result.blocked) {
    await sendDm(user, `» *${result.blocked}*`, { kind: DM_KIND.QUIET }).catch((err) =>
      console.error(`Couldn't tell ${user.id} why they can't look:`, err),
    );
    return;
  }

  const { readout } = result;
  // No transaction: the camera isn't spent, and mintPhoto's collision retry can't run inside one
  // (db/lib/photoMint.js#createWithRetry). readout.name is already the PRESENTED identity.
  const photo = await mintPhoto(prisma, held.characterId, {
    subject: readout.name,
    caption: photoCaption(readout),
    subjectCharacterId: proxy.characterId ?? null,
  });
  photographed.add(key); // claimed only once the print exists, so a failed mint can retry

  const embed = examineEmbed(readout).setFooter({ text: photo.name });
  await sendDm(user, { embeds: [embed] }).catch((err) => console.error("Camera reaction DM failed:", err));
}

async function isGm(reaction, userId) {
  if (!reaction.message.guild) return false;
  const member = await reaction.message.guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  return gmRoleIds().some((id) => member.roles.cache.has(id));
}

// GM-only: delete and repost as the bot itself, identical content/embeds/attachments.
async function handleFogReaction(reaction, user) {
  if (!(await isGm(reaction, user.id))) return;

  const message = reaction.message;
  const payload = {
    content: message.content,
    embeds: message.embeds,
    files: [...message.attachments.values()].map((a) => a.url),
  };

  await message.delete().catch(() => { });
  await message.channel.send(payload).catch(() => { });
}

module.exports = {
  name: "messageReactionAdd",
  async execute(reaction, user) {
    if (user.bot) return;

    const emojiName = reaction.emoji?.name; // gate on the gateway payload before paying for a fetch (Partials costs two REST calls)

    if (!reaction.message.guildId) return; // guildId, not guild: a partial message may lack the latter
    if (!KNOWN_EMOJIS.has(emojiName)) return; // unrecognised emoji stops here, before the two REST fetches

    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
    if (!reaction.message.guild) return;

    if (reaction.emoji.name === FOG_EMOJI) {
      await handleFogReaction(reaction, user).catch(() => { });
      return;
    }

    // The transcript row, not an in-memory map — so ✏️ ❌ 🔍 📸 work on a message posted before the bot last restarted.
    const proxy = await proxyRowFor(reaction.message.id).catch((err) => {
      console.error("Couldn't look up the archived row for a reaction:", err);
      return null;
    });

    const emoji = reaction.emoji.name;

    if (emoji === STAR_EMOJI) { // doesn't require a proxy, so it comes before the bail every other reaction needs
      if (proxy || reaction.message.author?.id === reaction.client.user.id || reaction.message.webhookId) {
        await handleStarReaction(reaction, proxy, user).catch(() => { });
        await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      }
      return;
    }

    if (!proxy || proxy.deletedAt) return; // an already-deleted row is inert — nothing left to edit, inspect or photograph

    const isOwner = user.id === proxy.discordUserId;

    if (emoji === DOSSIER_EMOJI) {
      if (!(await isGm(reaction, user.id))) return;
      await handleDossierReaction(reaction, proxy, user).catch((err) =>
        console.error("Dossier reaction failed:", err),
      );
      await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      return;
    }

    if (emoji === DELETE_EMOJI) {
      const gm = !isOwner && (await isGm(reaction, user.id));
      if (!isOwner && !gm) return;
      // The ROW is deleted, the outbox removes the Discord message; the window is decided in one place (db/lib/say.js).
      const result = await deleteSpeech(prisma, { characterId: proxy.characterId, seq: proxy.seq, gm });
      if (!result?.ok && result?.refusal) {
        await sendDm(user, `» *${result.refusal}*`, { kind: DM_KIND.QUIET }).catch((err) =>
          console.error(`Couldn't tell ${user.id} why the delete was refused:`, err),
        );
      }
      await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip ❌ reaction:", err));
      return;
    }

    if (EDIT_EMOJIS.includes(emoji)) {
      if (!isOwner) return;
      if (Date.now() - new Date(proxy.sentAt).getTime() > EDIT_WINDOW_MS) { // refused here too — the modal is a lot of ceremony to walk through before "too late"
        await sendDm(user, `» *${WINDOW_REFUSAL}*`, { kind: DM_KIND.QUIET }).catch((err) =>
          console.error(`Couldn't tell ${user.id} the edit window had closed:`, err),
        );
        await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
        return;
      }
      stashEdit(reaction.message.id, reaction.message.content); // a reaction carries no token, so it stashes text + DMs a button (editModal.js)
      await sendDm(user, buildEditPrompt(reaction.message.id), { kind: DM_KIND.QUIET }).catch((err) =>
        console.error(`Couldn't send the edit prompt to ${user.id}:`, err),
      );
      await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      return;
    }

    if (INSPECT_EMOJIS.includes(emoji)) {
      try { // reaction clears in the finally, so a thrown error never leaves 🔍 stuck
        const result = await readoutForReaction(proxy, user);
        if (!result) return;
        if (result.blocked) {
          await sendDm(user, `» *${result.blocked}*`, { kind: DM_KIND.QUIET }).catch((err) =>
            console.error(`Couldn't tell ${user.id} why they can't look:`, err),
          );
          return;
        }
        try {
          await sendDm(user, { embeds: [examineEmbed(result.readout)] });
        } catch (err) {
          console.error("Inspect reaction DM failed:", err);
        }
      } finally {
        await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      }
      return;
    }

    if (CAMERA_EMOJIS.includes(emoji)) {
      try {
        await handleCameraReaction(reaction, proxy, user);
      } catch (err) {
        console.error("Camera reaction failed:", err);
      } finally {
        await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      }
    }
  },
};
