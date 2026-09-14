// What went in and out of a faction's silo, for the Silo tab (FACTIONS.md §4c).
//
// A view over AuditLog rather than a table of its own, the same call the
// Depot's ledger makes (web/app/(app)/depot/page.js): those rows already
// snapshot exactly what moved and who moved it, and a second ledger would be a
// second thing to keep in step with the first. Nothing here writes.
//
// Everything is read off the `details` snapshot, never off live state — a row
// has to keep reading correctly after the catalog, the room or the depositor
// moves under it.
import { prisma } from "@lifeweb/db";
import { readBlock } from "@lifeweb/db/lib/reading";

// A rolling window, not the whole game. Seven in-game days is long enough to
// catch somebody who is at it regularly and short enough that the scan stays
// bounded and the table pages in the browser like every other player list.
const LEDGER_TURNS = 7;

// The ceiling on what crosses to the client, the Depot's number. Enough to be
// a book, few enough that a busy week does not ship a megabyte of JSON.
const LEDGER_LIMIT = 200;

// Player hands only. `gm_transfer_resources` shares this exact party shape and
// is deliberately left out — the ledger says what people carried, not when a
// GM reached in. `carry_overflow_dropped` is out for the same reason and would
// not fit anyway: it writes roomId/roomName instead of from/to.
const LEDGER_KINDS = ["request_transfer_tag", "request_transfer_resources"];

// AuditLog carries no turnId on a transfer row, so the turn number comes from
// where createdAt falls between the window's turns. That works for rows written
// before this existed too, which is the point of doing it this way.
function turnNumberAt(turnsDesc, at) {
  for (const turn of turnsDesc) {
    if (at >= turn.startedAt) return turn.number;
  }
  return null;
}

// One act per line. A single transfer writes one row per tag stack plus one for
// the ⬢, so a deposit of two stacks and 30 ⬢ is three rows that all carry the
// same moveId. Rows from before moveId existed have none and stand alone, which
// is the old behaviour and reads fine.
function groupRows(rows, roomId, turnsDesc) {
  const acts = new Map();
  for (const row of rows) {
    const d = row.details ?? {};
    const key = typeof d.moveId === "string" && d.moveId ? d.moveId : row.id;
    let act = acts.get(key);
    if (!act) {
      act = {
        id: key,
        at: row.createdAt.getTime(),
        turn: turnNumberAt(turnsDesc, row.createdAt),
        // Into the room, or out of it. Everything else on the row is described
        // from the mover's point of view; the ledger is the room's.
        dir: d.to?.id === roomId ? "In" : "Out",
        who: typeof d.by === "string" && d.by ? d.by : "—",
        lines: [],
        delta: 0,
      };
      acts.set(key, act);
    }
    if (row.actionType === "request_transfer_tag") {
      act.lines.push(`${d.tagName ?? "Something"} ×${d.quantity ?? 1}`);
    } else {
      const amount = Number(d.amount) || 0;
      act.delta += act.dir === "In" ? amount : -amount;
    }
  }
  return [...acts.values()].map((act) => ({
    id: act.id,
    turn: act.turn,
    dir: act.dir,
    what: act.lines.length ? act.lines.join(", ") : "—",
    who: act.who,
    delta: act.delta,
    at: act.at,
  }));
}

// `viewer` is { tags, phase, indoors } — readBlock's own contract, and it fails
// closed: a caller that cannot resolve a turn or a Location blocks rather than
// leaking. Returns { rows, blocked }; a blocked reader gets NO rows, so the
// gate is a lock and not a hint.
export async function loadSiloLedger(roomId, viewer) {
  if (readBlock(viewer?.tags ?? [], { phase: viewer?.phase ?? null, indoors: viewer?.indoors ?? true })) {
    return { rows: [], blocked: true };
  }

  const turnsDesc = await prisma.turn.findMany({
    orderBy: { number: "desc" },
    take: LEDGER_TURNS,
    select: { number: true, startedAt: true },
  });
  if (turnsDesc.length === 0) return { rows: [], blocked: false };
  const windowStart = turnsDesc[turnsDesc.length - 1].startedAt;

  // The createdAt bound is what keeps this off a full scan of the app's
  // biggest table: @@index([createdAt]) narrows it to the window before the
  // Json extraction runs. `details` has no expression index, and the trigram
  // one over details::text does not serve an equality path filter. If seven
  // turns ever gets slow the answer is an expression index on
  // ((details->'from'->>'id')) / ((details->'to'->>'id')) in raw migration
  // SQL — at the cost of a fourth "decline this drop" ghost in Prisma.
  const rows = await prisma.auditLog.findMany({
    where: {
      actionType: { in: LEDGER_KINDS },
      createdAt: { gte: windowStart },
      OR: [
        { details: { path: ["from", "id"], equals: roomId } },
        { details: { path: ["to", "id"], equals: roomId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: LEDGER_LIMIT,
    select: { id: true, actionType: true, details: true, createdAt: true },
  });

  return { rows: groupRows(rows, roomId, turnsDesc), blocked: false };
}
