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
import { hideableFor, setHiddenItems } from "@lifeweb/db/lib/search";
import { applySpawnSideEffects } from "@lifeweb/db/lib/threatSpawn";
import { deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { sendDm } from "@/lib/discordGuild";

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

// --- Hide items (docs/systemdocs/SEARCH.md §2) ----------------------------
//
// Search's third control, and the reason it is NOT a DM_CHOICE: hiding edits a
// pending row rather than answering it, so the Yes/No pair has to survive it and
// the picker has to be re-openable. The Discord twin is bot/src/lib/offers.js;
// everything both faces must agree about is db/lib/search.js#setHiddenItems.
//
// Both actions resolve the acting account from the SESSION. The client sends
// only which offer it is editing, and search.js re-checks that the offer is
// pending and that it is this account's to answer — a server action is a public
// endpoint, and a disabled input is a hint, not a lock.

export async function loadSearchHideables(offerId) {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, reason: "You are not signed in." };
  return hideableFor(prisma, { offerId: String(offerId), discordUserId: session.discordUserId });
}

export async function setSearchHidden(offerId, tagIds) {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, reason: "You are not signed in." };
  return setHiddenItems(prisma, {
    offerId: String(offerId),
    discordUserId: session.discordUserId,
    // Capped generously rather than trusted: the real filter is the
    // intersection against what they actually hold, done server-side.
    tagIds: Array.isArray(tagIds) ? tagIds.slice(0, 200).map(String) : [],
  });
}
