import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { auth } from "@/lib/auth";
import { UserError } from "@/lib/actionResult";
import { blockerFor, SPEAK } from "@lifeweb/db/lib/incapacitation";
import {
  WHOLE_MOVE,
  addFractions,
  craftFamilyLabel,
  fitsInRemaining,
  formatMoveFraction,
  ledgerRemaining,
  ledgerUsed,
} from "@/lib/craftBudget";
import { fileAutoRoutine } from "@/lib/moveSpend";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { after } from "next/server";
import { postMessage } from "@lifeweb/db/lib/discordRest";

// File-local helpers and constants shared by 2+ action groups under
// web/app/(app)/character/actions/. See web/app/(app)/character/requestActions.js
// for the public server-action wrappers.

// Every player-initiated change that applies immediately and is reviewed
// afterwards. Each action: authenticate, re-validate everything the client
// sent (a server action is a public endpoint), then apply the effect and
// write the Request + AuditLog rows in ONE transaction.


// `needs` is a capability from db/lib/incapacitation.js — pass ACT and the
// action refuses for anyone Bound, Dying, Paralyzed, Catatonic, mid-Seizure
// or out cold, naming the tag that stopped them. Hung here rather than
// re-written at each call site because this function already loads every held
// tag with its catalog row, so the gate costs no extra query, and because the
// inline copies it replaces had drifted: some actions checked, most didn't.
//
// Omit it for the handful that shouldn't care. Reading your own sheet is not
// an act, and neither is paperwork.
export async function requireCharacter({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    // The held tags carry their GROUP as well as themselves: resolveRecipeItems
    // matches a recipe's `{ group: … }` ingredient against it, and
    // db/lib/corpses.js#isCorpseTag is a group check too.
    include: {
      tags: {
        include: { tag: { include: { group: { select: { slug: true } } } } },
      },
      // Half of db/lib/reading.js's `where` — Sun Sensitivity needs to know
      // whether there is a roof overhead.
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
  revalidatePath("/faction");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

export function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Parties ------------------------------------------------------------

// "character:<id>" / "room:<id>" on both ends. Lives in db/lib/parties.js
// beside applyTransfer, so every transfer surface resolves the same key;
// re-exported here (prisma bound).
export function resolveParty(key, opts) {
  return dbResolveParty(prisma, key, opts);
}

// The serializer every craft that touches a ration or a stack takes first.
// Postgres holds it to the end of the transaction, so two tabs submitting at
// once queue up instead of both reading the same count.
export function lockCharacter(tx, characterId) {
  return tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
}

// --- The craft Move budget (docs/systemdocs/CRAFTING.md §2a) -----------
//
// A craft that costs less than a whole Move files the same auto:craft Action
// every craft with turns files, and writes a LEDGER on it
// (`Action.craftBudget`): the family of work the Routine is committed to, how
// much of the Move is spent, and what was made. The next craft that turn reads
// that ledger back — same family, and enough left, or it is refused.
//
// Nothing is derived and nothing is cached: the row IS the record, which is
// why a GM Reject hands the whole turn back with one delete
// (web/lib/moveEconomy.js#deleteActionRestoringTurn needs no knowledge of any
// of this). There is no per-craft Undo; a GM reversing one craft by hand
// gets no budget back either — Reject is the full reset.

export const MOVE_SPENT = "You've already used your Move this turn.";

// The Action's description, rebuilt from the ledger every time an entry lands,
// so a GM reading the desk sees the whole turn's work in one line rather than
// only the first thing made.
export function craftLedgerDescription(entries) {
  const made = entries.map((e) => (e.qty > 1 ? `${e.qty}× ${e.name}` : e.name));
  return `Crafting this turn: ${made.join(", ")}.`;
}

// Heal's own ledger line (M2, docs/systemdocs/CRAFTING.md §2a /
// TAGS.md §5c) — same shape as craftLedgerDescription, but "Treating" is the
// medic's verb, and a fresh string rather than a parameter on that one so the
// existing crafting copy stays exactly as it was. spendCraftMove picks
// between the two by family, since a turn's Routine is always one or the
// other and never both.
export function healLedgerDescription(entries) {
  const made = entries.map((e) => (e.qty > 1 ? `${e.qty}× ${e.name}` : e.name));
  return `Treating this turn: ${made.join(", ")}.`;
}

export function craftLedgerEntry(tag, cost) {
  return {
    tagId: tag.id,
    name: tag.name,
    // The free half of a straddling order is derivable: qty - num billed.
    qty: cost.freeQty + cost.billedQty,
    num: cost.num,
    den: cost.den,
  };
}

// Reads the turn's Action against what this craft needs. Returns the ledger to
// extend — null when there is no Action yet and this craft will file one — or
// throws the refusal.
//
// Called TWICE for every budget craft: once outside the transaction, so
// somebody who cannot act is told before a single ⬢ moves, and again inside it
// under the Character row lock, where the answer is the one that counts.
export function checkCraftMove(action, need) {
  // Asked for more than a turn holds — 20 work knives is five Moves' worth of
  // spill — which an empty turn would otherwise wave through, since there is
  // no ledger yet to fail against.
  if (!fitsInRemaining(need, WHOLE_MOVE)) {
    throw new UserError(
      "That's more than a turn's work — make fewer at once.",
    );
  }
  if (!action) return null;
  // A recipe with no craft family can neither lock a Routine nor share one, in
  // either direction — so anything already filed stops it.
  if (!need.family) throw new UserError(MOVE_SPENT);
  // `includes`, not equality: other machinery APPENDS to gmNotes (the staged
  // push does, on Actions it claims), and an appended note must not strand a
  // half-spent ledger behind "Move already used".
  if (!(action.gmNotes ?? "").includes("auto:craft") || !action.craftBudget)
    throw new UserError(MOVE_SPENT);
  const ledger = action.craftBudget;
  if (ledger.family !== need.family) {
    throw new UserError(
      `Your Routine this turn is ${craftFamilyLabel(ledger.family)} work, and that isn't.`,
    );
  }
  const left = ledgerRemaining(ledger);
  if (!fitsInRemaining(need, left)) {
    const asks =
      need.num >= need.den
        ? "a whole Move"
        : `${formatMoveFraction(need.num, need.den)} of a Move`;
    throw new UserError(
      left.num > 0
        ? `That takes ${asks}, and you have ${formatMoveFraction(left.num, left.den)} of this turn's Routine left.`
        : `That takes ${asks}, and this turn's Routine is spent.`,
    );
  }
  return ledger;
}

// The fast fail, outside the transaction. Replaces requireFreeMove on the
// craft path only — Bury, Engrave, Extract and the build sites still take a
// whole clean Move and keep it.
export async function resolveCraftMove(character, openTurn, need) {
  if (!openTurn) throw new UserError("No turn is open.");
  // Same source requireFreeMove reads (review fix, M2): moveWindow() takes
  // `clockFrozen`, not `autoTurnAdvanceDisabled` — the two prior reads here
  // built an options object moveWindow never destructured, so the lock check
  // silently always ran with clockFrozen defaulted false. clockFrozen(prisma)
  // is the one real answer (db/lib/gameState.js): phase !== RUNNING OR the
  // config flag, in one round trip.
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) throw new UserError("Moves are locked for this turn.");
  const action = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  checkCraftMove(action, need);
}

// Claims the Move — or the slice of it — this craft needs, inside the caller's
// transaction. Everything checkCraftMove looked at outside is read again here
// under the Character row lock, because two tabs can both have passed the
// cheap check a moment ago. The `@@unique([characterId, turnId])` P2002 catch
// in fileAutoRoutine stays the backstop underneath even that.
//
// `description` is what the Action says when this craft is the one that files
// it. A project turn passes its own "(2/3)" line and keeps it — a project
// never shares a turn, so nothing rebuilds it. A fractional craft passes none,
// and gets the running list of everything made this turn instead.
export async function spendCraftMove(
  tx,
  { character, openTurn, need, entry, description = null },
) {
  await lockCharacter(tx, character.id);
  const existing = await tx.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  const ledger = checkCraftMove(existing, need);
  // No family, no ledger: the craft takes the whole Move the way it always
  // has, and the next one that turn is refused by the Action's own existence.
  if (!need.family) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        description,
        "auto:craft",
      ),
      budget: null,
    };
  }
  const entries = [...(ledger?.entries ?? []), entry];
  const used = addFractions(ledgerUsed(ledger), need);
  const budget = {
    family: need.family,
    usedNum: used.num,
    usedDen: used.den,
    entries,
  };
  // Medical shares this exact ledger (M2) but reads "Treating", not
  // "Crafting" — the family already says which, since a turn commits to one.
  const line =
    description ??
    (need.family === "medical" ? healLedgerDescription(entries) : craftLedgerDescription(entries));
  if (!existing) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        line,
        "auto:craft",
        budget,
      ),
      budget,
    };
  }
  // `updateMany` + count, not `update`: a GM Reject deletes the Action row
  // without taking the Character lock, and racing it should read as "your
  // turn was just reset", not as a raw P2025.
  const { count } = await tx.action.updateMany({
    where: { id: existing.id },
    data: { craftBudget: budget, description: line },
  });
  if (count === 0)
    throw new UserError("A GM just reset your turn — try again.");
  return { action: existing, budget };
}

// The ground, with everything canBuildHere() judges plus the channel the
// site speaks into.
export async function loadBuildGround(locationId) {
  if (!locationId) return null;
  return prisma.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      // The site gate matches on this (placement.locations) — a Brewery
      // belongs at the inn and nowhere else.
      slug: true,
      indoors: true,
      attributes: true,
      discordChannelId: true,
      zone: { select: { kind: true } },
    },
  });
}

// Scenery into the Location's own channel, post-commit and catch-logged: a
// Discord outage must never roll back work that really happened
// (ARCHITECTURE.md §5).
export function speakAtSite(channelId, line) {
  if (!channelId || !line) return;
  after(() =>
    postMessage(channelId, line).catch((err) =>
      console.error("Structure ambient line failed:", err),
    ),
  );
}
