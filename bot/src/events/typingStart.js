const { Events } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { placeKeyForChannel } = require("@lifeweb/db/lib/placeKey");
const { notifyTyping } = require("@lifeweb/db/lib/typingNotify");
const { findAliveCharacter } = require("../lib/interactionGuild");

// Carries Discord's typing indicator to Chat. Cheap: a memoised place-key lookup, one small
// NOTIFY. No name on the wire — the web hub resolves the presented name itself (db/lib/typingNotify.js).
const CHARACTER_SELECT = { id: true, webOnly: true };

module.exports = {
  name: Events.TypingStart,
  async execute(typing) {
    if (!typing?.guild || !typing.channel || !typing.user || typing.user.bot) return; // never in a DM

    const character = await findAliveCharacter(typing.user.id, { select: CHARACTER_SELECT });
    if (!character || character.webOnly) return;

    const placeKey = await placeKeyForChannel(prisma, {
      channelId: typing.channel.id,
      parentId: typing.channel.parentId ?? null,
    });
    if (!placeKey) return;

    await notifyTyping(prisma, { placeKey, characterId: character.id });
  },
};
