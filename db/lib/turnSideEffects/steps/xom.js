const { sendDm } = require("../../dm");
const { DM_KIND } = require("../../dmKinds");
const { ambientLine } = require("../../ambientLine");
const { postMessage } = require("../../discordRest");
const { sceneLine, sceneLineAt } = require("../../scene");
const { placeKeyForLocation, placeKeyForConversation } = require("../../placeKey");
const { applyLocationMoveSideEffects } = require("../../locationMove");
const { rollCavingOnArrival } = require("../../cavingPass");
const { openConversationThread } = require("../../conversationOpen");
const { shout, deliverShout } = require("../../shout");

// ---------------------------------------------------------------- Xom
//
// The three outcomes on db/lib/xomPass.js's table that are Discord-shaped
// rather than "a tag on your sheet changed": a teleport, the conversation it
// opens, and a scream. Everything else Xom does rode tagExpiryDms and is
// already sent by the time this runs.
//
// Their own loops rather than a merge into `relocations` above, because that
// loop's letter ("You arrive at X") is a sentence about a journey somebody
// paid for, and this is the opposite of one.
async function runXomOutcomes({ prisma, p, list, step }) {
  for (let i = 0; i < list(p.xomTeleports).length; i += 1) {
    const move = list(p.xomTeleports)[i];
    await step(`xomTeleport:${i}`, async () => {
      await applyLocationMoveSideEffects(prisma, move).catch((err) =>
        console.error(`Xom teleport side effects failed for ${move.characterId}:`, err),
      );

      // Its own ambient line at both ends, because Xom does not use the roads.
      // applyLocationMoveSideEffects announces a gate crossing only when there
      // is a graph link between the two places, and there almost never is one
      // here — without this the character simply materialises with nothing
      // said, at either end.
      const gone = `${move.name} is not here any more.`;
      const come = `${move.name} is here, and was not a moment ago.`;
      for (const [locationId, text] of [
        [move.fromLocationId, gone],
        [move.toLocationId, come],
      ]) {
        if (!locationId) continue;
        await sceneLineAt(prisma, { locationId, text }).catch(() => {});
        const location = await prisma.location
          .findUnique({ where: { id: locationId }, select: { discordChannelId: true } })
          .catch(() => null);
        if (location?.discordChannelId) {
          await postMessage(location.discordChannelId, ambientLine(text), undefined, {
            parse: [],
          }).catch(() => {});
        }
      }

      if (move.discordUserId) {
        await sendDm(prisma, move.discordUserId, "The floor changes under you.", {
          kind: DM_KIND.NOTICE,
        }).catch((err) => console.error(`Xom teleport DM to ${move.discordUserId} failed:`, err));
      }

      // The Caving Die, for the same reason the staged-relocate loop above
      // rolls it: being DROPPED into the dark must not be the one free walk in
      // (CAVING.md §2). Without this, Xom would be the cheapest way into the
      // Depths in the game.
      const landed = move.toLocationId
        ? await prisma.location
            .findUnique({ where: { id: move.toLocationId }, include: { zone: true } })
            .catch(() => null)
        : null;
      if (landed) {
        const dm = await rollCavingOnArrival(
          prisma,
          { id: move.characterId, discordUserId: move.discordUserId },
          landed,
        );
        if (dm) {
          await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
            console.error(`Xom caving DM to ${dm.discordUserId} failed:`, err),
          );
        }
      }
    });
  }

  // AFTER the teleports, always: the whole point is that the two of them are
  // standing in the same place when it opens.
  for (let i = 0; i < list(p.xomConversations).length; i += 1) {
    const wanted = list(p.xomConversations)[i];
    await step(`xomConversation:${i}`, async () => {
      const opened = await openConversationThread(prisma, {
        locationId: wanted.locationId,
        name: wanted.name,
        characterIds: wanted.characterIds,
        creatorCharacterId: wanted.characterIds?.[0] ?? null,
      });
      if (!opened.ok) {
        console.error(`Xom conversation failed: ${opened.error}`);
        return;
      }
      // The two PEOPLE, not their character name-tokens: this is meant to
      // arrive as a notification on a phone. `<@id>` is the vocabulary
      // db/lib/discordMarkup.js defines, and the web renders it as "someone".
      const people = await prisma.character.findMany({
        where: { id: { in: list(wanted.characterIds) } },
        select: { discordUserId: true },
      });
      const mentions = people
        .map((row) => (row.discordUserId ? `<@${row.discordUserId}>` : null))
        .filter(Boolean)
        .join(" ");
      // Full size and mentions parsed, not the `-#` scenery format: this is a
      // god shouting at two people to talk to each other, which sits on the
      // intercom's side of the line rather than the ambient one (CLAUDE.md).
      const body = [mentions, wanted.line].filter(Boolean).join("\n");
      await postMessage(opened.threadId, body).catch((err) =>
        console.error("Xom conversation opener failed:", err),
      );
      await sceneLine(prisma, {
        placeKey: placeKeyForConversation(opened.conversation.id),
        text: wanted.line,
      }).catch(() => {});
    });
  }

  for (let i = 0; i < list(p.xomShouts).length; i += 1) {
    const scream = list(p.xomShouts)[i];
    await step(`xomShout:${i}`, async () => {
      // shout() as it stands, gates and all. A Mute holder does not scream and
      // a holder who shouted five minutes ago has nothing left in the throat —
      // the outcome is simply spent, which is the price of the god borrowing a
      // real voice rather than inventing one.
      //
      // The placeKey is the LOCATION, never a Room or a Conversation: the turn
      // engine has no idea which thread anybody was sitting in at 04:00. So a
      // Xom scream is made on the map, and a soundproof room never seals one.
      const placeKey = placeKeyForLocation(scream.locationId);
      const result = await shout(
        prisma,
        { id: scream.characterId, name: scream.name, discordUserId: scream.discordUserId, locationId: scream.locationId },
        scream.text,
        { placeKey },
      ).catch((err) => {
        console.error(`Xom shout for ${scream.characterId} failed:`, err);
        return { ok: false };
      });
      if (!result.ok) return;

      // Delivery is db/lib/shout.js#deliverShout, the same call Chat and the
      // bot make. It matters here more than there: `placeKey` above is a
      // LOCATION key, and soundRange counts the shouter's own Location as
      // distance 0, so `here` and `heard[0]` are the same place. deliverShout
      // skips that collision. Before it did, every Xom scream wrote the
      // origin's archive row twice and posted to its channel twice.
      await deliverShout(prisma, { placeKey, here: result.here, heard: result.heard });
    });
  }
}

module.exports = { runXomOutcomes };
