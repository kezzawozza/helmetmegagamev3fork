// The one die a player rolls for themselves, written as a SYSTEM archive row (db/lib/scene.js) rather than an interaction reply — a public reply carries Discord's "@account used /roll" header and outs the player behind the character (PROXYING.md). Who rolled it IS named, unlike a shout, via presentedIdentity.
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the db/lib/dm.js convention; require it by path.

const { rollDie } = require("./moveEffects");
const { sceneLine } = require("./scene");
const { discordTargetForPlaceKey } = require("./placeKey");
const { postMessage } = require("./discordRest");
const { loadForcedName, loadConcealment, presentedIdentity } = require("./presentedIdentity");

async function castDie(prisma, character, placeKey) {
  if (!character?.id) return { ok: false, error: "You don't have a living character." };
  if (!placeKey) return { ok: false, error: "There's nowhere to roll it." };

  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, character.id),
    loadConcealment(prisma, character.id),
  ]);
  const who = presentedIdentity(character, { forcedName, concealment }).name ?? "Somebody";

  const value = rollDie(6);
  const text = `${who} casts a die — **${value}**.`;

  await sceneLine(prisma, { placeKey, text });

  // Then Discord, best-effort — a dead channel loses the audience, not the die.
  try {
    const target = await discordTargetForPlaceKey(prisma, placeKey);
    const channelId = target?.threadId ?? target?.channelId ?? null;
    if (channelId) await postMessage(channelId, text, undefined, { parse: [] });
  } catch (err) {
    console.error("Roll post failed:", err.message ?? err);
  }

  return { ok: true, value, line: `You rolled a ${value}.` };
}

module.exports = { castDie };
