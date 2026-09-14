const { Events } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { placeKeyForChannel } = require("@lifeweb/db/lib/placeKey");
const { notifyTyping } = require("@lifeweb/db/lib/typingNotify");
const { findAliveCharacter } = require("../lib/interactionGuild");

// "Somebody in this room is writing something." Discord shows its own typing
// indicator to the people in the channel; this carries the same fact across to
// Chat, so a player on /chat and a player in Discord are standing in the
// same scene rather than two copies of it.
//
// The event is CHEAP on purpose. It fires roughly once every ten seconds per
// person while they type, and everything it does is a memoised place-key
// lookup and one small NOTIFY. No name goes on the wire — the web hub resolves
// the presented name itself, because a forced name or a concealment is not
// this side's answer to give (db/lib/typingNotify.js).
//
// The web's own composer posts to /api/feed/typing and lands on the same
// channel, so a Chat reader sees both faces typing without either face
// knowing the other exists. A Discord-side echo of a WEB typist is deferred:
// Discord has no API for a bot to type as somebody else.

// A character whose account is out of the channels (CHAT.md §6a) could not
// have raised this event, but the join is one column and it costs nothing to
// be sure.
const CHARACTER_SELECT = { id: true, webOnly: true };

module.exports = {
  name: Events.TypingStart,
  async execute(typing) {
    // Never in a DM. A DM is one player and the bot; there is no scene, and
    // "somebody is typing" there would only ever mean the person reading it.
    if (!typing?.guild || !typing.channel || !typing.user || typing.user.bot) return;

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
