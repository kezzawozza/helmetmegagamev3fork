import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import { getGmSession } from "@/lib/discordGuild";
import { UserError } from "@/lib/actionResult";
import { blockerFor, SPEAK } from "@lifeweb/db/lib/incapacitation";
import {
  WHOLE_MOVE,
  addFractions,
  fitsInRemaining,
  formatMoveAmount,
  ledgerRemaining,
  ledgerUsed,
} from "@/lib/craftBudget";
import { fileAutoRoutine } from "@/lib/moveSpend";
import { after } from "next/server";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { movesOpen } from "@lifeweb/db/lib/turnGate";

// Helpers shared by 2+ action groups under actions/ (requestActions.js has the public server-action wrappers). Each action re-validates everything the client sent (a server action is a public endpoint) and writes its effect + AuditLog row in ONE transaction.

// `needs` (db/lib/incapacitation.js): pass ACT and the action refuses for anyone Bound, Dying, Paralyzed, Catatonic, mid-Seizure or out cold, naming the blocking tag. Omit for the few that aren't an act (reading your sheet, paperwork).
export async function requireCharacter({ needs = null } = {}) {
  const { session, inGuild } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  // Left the guild: the session is still valid but web access isn't (root
  // CLAUDE.md "Web app auth") — covers a dozen action files at this one hub.
  if (!inGuild) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    // Held tags carry their GROUP too: resolveRecipeItems matches a recipe's `{ group }` ingredient, and isCorpseTag is a group check.
    include: {
      tags: {
        include: { tag: { include: { group: { select: { slug: true } } } } },
      },
      // Half of db/lib/reading.js's `where` — Sun Sensitivity needs to know whether there's a roof.
      location: { select: { indoors: true } },
      role: { select: { slug: true } },
    },
  });
  if (!character) redirect("/character");
  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    if (blocker) {
      throw new UserError(
        needs === SPEAK
          ? `You can't speak right now — you're ${blocker.name}.`
          : `You can't do that right now. You're ${blocker.name}.`,
      );
    }
  }
  return { session, character };
}

export function revalidateAll() {
  revalidatePath("/character");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

export function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Parties ------------------------------------------------------------

// "character:<id>" / "room:<id>" / "hood:<token>"; re-exported here (prisma bound) from db/lib/parties.js beside applyTransfer.
//
// The hood arm used to live inside transfer.js as its own `hoodedKey`, which
// meant Transfer was the only party surface that could name a person in a mask:
// a masked stranger could not be asked to pay for a cure or a craft, because
// resolveParty split the key on ":" and answered null for a "hood" kind. It is
// one question, so it gets one answer here — pass `actor` and a hood token
// resolves to the character standing in front of them, or to nobody.
//
// resolveHoodToken re-checks co-presence itself, so a token minted in a room
// this character has since left names no one; `allowDead` widens it to an
// unburied body, which only a source-side loot ever wants.
export async function resolveParty(key, { actor = null, ...opts } = {}) {
  const raw = String(key ?? "");
  if (raw.startsWith("hood:")) {
    if (!actor) return null;
    const id = await resolveHoodToken(prisma, actor, raw.slice("hood:".length), {
      includeDead: opts.allowDead === true,
    });
    if (!id) return null;
    return dbResolveParty(prisma, `character:${id}`, opts);
  }
  return dbResolveParty(prisma, raw, opts);
}

// Serializer every craft touching a ration or a stack takes first — Postgres holds it to end of transaction, so two tabs submitting at once queue up instead of both reading the same count.
export function lockCharacter(tx, characterId) {
  return tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
}

// --- The craft Move budget (docs/systemdocs/CRAFTING.md §2a) -----------
// A craft under a whole Move files the same auto:craft Action every craft with turns files, writing a LEDGER (`Action.craftBudget`): Move spent and what was made, one entry per family. The row IS the record — no derive/cache, no per-craft Undo; a GM Reject hands the whole turn back with one delete.

export const MOVE_SPENT = "You've already used your Move this turn.";

function ledgerEntryList(entries) {
  return entries.map((e) => (e.qty > 1 ? `${e.qty}× ${e.name}` : e.name)).join(", ");
}

// Rebuilt from the ledger every time an entry lands, so a GM reading the desk sees the whole turn's work, not just the first thing made. A turn's Routine can now mix families, so this groups by family and names each group with its own verb — "Treating" for medical, "Crafting" for everything else.
export function craftLedgerDescription(entries) {
  const healing = entries.filter((e) => e.family === "medical");
  const crafted = entries.filter((e) => e.family !== "medical");
  const lines = [];
  if (crafted.length) lines.push(`Crafting this turn: ${ledgerEntryList(crafted)}.`);
  if (healing.length) lines.push(`Treating this turn: ${ledgerEntryList(healing)}.`);
  return lines.join(" ");
}

export function craftLedgerEntry(tag, cost) {
  return {
    tagId: tag.id,
    name: tag.name,
    family: cost.family,
    qty: cost.freeQty + cost.billedQty, // free half of a straddling order is derivable: qty - num billed
    num: cost.num,
    den: cost.den,
  };
}

// Reads the turn's Action against what this craft needs; returns the ledger to extend (null if no Action yet) or throws the refusal. Called TWICE per budget craft: once outside the transaction (fast fail), again inside under the Character row lock (the answer that counts).
export function checkCraftMove(action, need) {
  // Asked for more than a turn holds, which an empty turn would otherwise wave through with no ledger yet to fail against.
  if (!fitsInRemaining(need, WHOLE_MOVE)) {
    throw new UserError(
      "That's more than a turn's work — make fewer at once.",
    );
  }
  if (!action) return null;
  // A recipe with no craft family can neither lock a Routine nor share one — anything already filed stops it.
  if (!need.family) throw new UserError(MOVE_SPENT);
  // `includes`, not equality: other machinery APPENDS to gmNotes, and an appended note must not strand a half-spent ledger.
  if (!(action.gmNotes ?? "").includes("auto:craft") || !action.craftBudget)
    throw new UserError(MOVE_SPENT);
  const ledger = action.craftBudget;
  const left = ledgerRemaining(ledger);
  if (!fitsInRemaining(need, left)) {
    const asks =
      need.num >= need.den
        ? "a whole Move"
        : `${formatMoveAmount(need.num, need.den)} of a Move`;
    throw new UserError(
      left.num > 0
        ? `That takes ${asks}, and you have ${formatMoveAmount(left.num, left.den)} of this turn's Move left.`
        : `That takes ${asks}, and this turn's Move is spent.`,
    );
  }
  return ledger;
}

// The fast fail, outside the transaction. Replaces requireFreeMove wherever a verb costs a FRACTION of the Move: every craft, plus Bury and Engrave at a half each. Extract and the build sites still take a whole clean Move.
export async function resolveCraftMove(character, openTurn, need) {
  if (!openTurn) throw new UserError("No turn is open.");
  // One gate, one sentence — db/lib/turnGate.js. It asks about the session BEFORE the lock window, because a frozen clock
  // reports `locked: false` (freezing removes the deadline, it does not shut the game).
  const gate = await movesOpen(prisma, { turn: openTurn });
  if (!gate.ok) throw new UserError(gate.message);
  const action = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  checkCraftMove(action, need);
}

// Claims the Move (or slice) this craft needs, inside the caller's transaction, re-checked under the Character row lock since two tabs can both have passed the cheap check a moment ago (`@@unique([characterId, turnId])` P2002 catch in fileAutoRoutine is the backstop under even that).
// `description`: a project passes its own "(2/3)" line and keeps it; a fractional craft passes none and gets the running made-this-turn list.
// `notes`: what lands in Action.gmNotes. It must CONTAIN "auto:craft" — that
// string is what checkCraftMove above recognises as a shareable ledger — so a
// non-craft verb on this budget appends its own marker rather than replacing
// it ("auto:craft auto:bury").
export async function spendCraftMove(
  tx,
  { character, openTurn, need, entry, description = null, notes = "auto:craft" },
) {
  await lockCharacter(tx, character.id);
  const existing = await tx.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  const ledger = checkCraftMove(existing, need);
  // No family, no ledger: takes the whole Move, and the next craft that turn is refused by the Action's own existence.
  if (!need.family) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        description,
        notes,
      ),
      budget: null,
    };
  }
  const entries = [...(ledger?.entries ?? []), entry];
  const used = addFractions(ledgerUsed(ledger), need);
  const budget = {
    usedNum: used.num,
    usedDen: used.den,
    entries,
  };
  // A turn's Routine can now mix families under one Move; craftLedgerDescription groups by family and reads "Treating" for medical, "Crafting" for the rest.
  const line = description ?? craftLedgerDescription(entries);
  if (!existing) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        line,
        notes,
        budget,
      ),
      budget,
    };
  }
  // `updateMany` + count, not `update`: racing a GM Reject should read as "your turn was just reset", not a raw P2025.
  const { count } = await tx.action.updateMany({
    where: { id: existing.id },
    data: { craftBudget: budget, description: line },
  });
  if (count === 0)
    throw new UserError("A GM just reset your turn — try again.");
  return { action: existing, budget };
}

// The ground, with everything canBuildHere() judges plus the channel the site speaks into.
export async function loadBuildGround(locationId) {
  if (!locationId) return null;
  return prisma.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      slug: true, // site gate matches on this (placement.locations)
      indoors: true,
      attributes: true,
      discordChannelId: true,
      zone: { select: { kind: true } },
    },
  });
}

// Scenery into the Location's own channel, post-commit and catch-logged: a Discord outage must never roll back work that really happened (ARCHITECTURE.md §5).
export function speakAtSite(channelId, line) {
  if (!channelId || !line) return;
  after(() =>
    postMessage(channelId, line).catch((err) =>
      console.error("Structure ambient line failed:", err),
    ),
  );
}
