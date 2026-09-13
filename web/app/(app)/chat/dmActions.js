"use server";

// Answering a DM's buttons from the web (db/lib/dmActions.js says why this
// exists). The Discord twin is bot/src/lib/offers.js and
// bot/src/lib/threatSpawn.js; everything the two faces must agree about lives
// in db/lib/dmAnswer.js, and what is left here is the web's own half.
//
// A server action is a public endpoint. The acting account comes from the
// SESSION, never from anything posted — the client sends only which row it is
// answering, and the router re-checks that the row is that account's before it
// does anything.
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { answerDmAction as routeDmAction } from "@lifeweb/db/lib/dmAnswer";
import { DM_ACTION, DM_CHOICE } from "@lifeweb/db/lib/dmActions";
import { applySpawnSideEffects } from "@lifeweb/db/lib/threatSpawn";
import { deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { sendDm, syncCharacterNickname } from "@/lib/discordGuild";
import { formatBareName } from "@lifeweb/db/lib/characterName";

// Everything the router handed back that has to reach Discord. Runs inside
// after(): a pending server action blocks client-side navigation, and none of
// this is anything the answer the player just got depends on
// (ARCHITECTURE.md §4).
//
// Best-effort throughout, and each step catches its own — a failed room sync is
// the channel doctor's problem, not a reason the accept failed.
async function applySideEffects({ dms, sideEffects }) {
  for (const dm of dms ?? []) {
    await sendDm(dm.discordUserId, dm.content).catch((err) =>
      console.error(`DM action fan-out to ${dm.discordUserId} failed:`, err),
    );
  }

  if (sideEffects.spawn) {
    await applySpawnSideEffects(prisma, sideEffects.spawn).catch((err) =>
      console.error("Spawn side effects failed:", err),
    );
  }

  // The web's twin of the bot's syncMemberNickname. This one is the better of
  // the two to be on: it honours the webOnly gate, so accepting a seat from the
  // web cannot be the thing that tells Discord who you are.
  if (sideEffects.nicknameSyncDiscordUserId) {
    try {
      const character = await prisma.character.findFirst({
        where: { discordUserId: sideEffects.nicknameSyncDiscordUserId, status: "ALIVE" },
        select: { firstName: true, lastName: true },
      });
      if (character) {
        await syncCharacterNickname(sideEffects.nicknameSyncDiscordUserId, formatBareName(character));
      }
    } catch (err) {
      console.error("Spawn nickname sync failed:", err);
    }
  }

  // The twin of the bot's post-bind block. web/lib/afterInventoryChange.js runs
  // the same two steps for a sheet that changed by other means; this path has
  // already had its settleCarry done inside the router, so only the Discord
  // half is left.
  for (const characterId of sideEffects.roomSyncCharacterIds ?? []) {
    try {
      const row = await prisma.character.findUnique({ where: { id: characterId } });
      if (row) await syncCharacterRoomAccess(prisma, row);
    } catch (err) {
      console.error(`Post-bind room sync for ${characterId} failed:`, err);
    }
  }
  if (sideEffects.carryDrop) {
    await deliverCarryDrop(prisma, sideEffects.carryDrop).catch((err) =>
      console.error("Post-bind carry drop failed:", err),
    );
  }
  if (sideEffects.boundNotification) {
    await sendDm(sideEffects.boundNotification.discordUserId, sideEffects.boundNotification.content).catch(() => {});
  }
}

// `kind` and `id` name the row; `choice` is accept or decline. Returns
// { ok, line } — the card draws the line where its buttons were, which is what
// the bot's interaction.update() does to the DM.
export async function answerDmAction(kind, id, choice, amount = null) {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, line: "You are not signed in." };

  if (!DM_ACTION[kind]) return { ok: false, line: "That's not something you can answer." };
  const picked =
    choice === DM_CHOICE.ACCEPT || choice === DM_CHOICE.PARTIAL ? choice : DM_CHOICE.DECLINE;

  const result = await routeDmAction(prisma, {
    action: { kind, id: String(id) },
    choice: picked,
    amount: picked === DM_CHOICE.PARTIAL ? String(amount ?? "").slice(0, 6) : null,
    discordUserId: session.discordUserId,
  });

  after(() => applySideEffects(result).catch((err) => console.error("DM action side effects failed:", err)));

  return { ok: result.ok, line: result.line };
}
