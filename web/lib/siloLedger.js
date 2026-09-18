// What went in and out of a faction's silo, for the Silo tab (FACTIONS.md §4c). A view over
// AuditLog, not a table of its own (like the Depot's ledger); nothing here writes. Everything is
// read off the `details` snapshot, never off live state.
import { prisma } from "@lifeweb/db";
import { readBlock } from "@lifeweb/db/lib/reading";

const LEDGER_TURNS = 7;

const LEDGER_LIMIT = 200;

// Player hands only — `gm_transfer_resources` and `carry_overflow_dropped` are deliberately left out.
const LEDGER_KINDS = ["request_transfer_tag", "request_transfer_resources"];

function turnNumberAt(turnsDesc, at) {
  for (const turn of turnsDesc) {
    if (at >= turn.startedAt) return turn.number;
  }
  return null;
}

// One act per line: a single transfer writes one row per tag stack plus one for the ⬢, all sharing moveId.
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

// Fails closed. Returns { rows, blocked }; a blocked reader gets NO rows.
export async function loadSiloLedger(roomId, viewer) {
  if (readBlock(viewer?.tags ?? [], { daylight: viewer?.daylight ?? false, indoors: viewer?.indoors ?? true })) {
    return { rows: [], blocked: true };
  }

  const turnsDesc = await prisma.turn.findMany({
    orderBy: { number: "desc" },
    take: LEDGER_TURNS,
    select: { number: true, startedAt: true },
  });
  if (turnsDesc.length === 0) return { rows: [], blocked: false };
  const windowStart = turnsDesc[turnsDesc.length - 1].startedAt;

  // createdAt bound keeps this off a full scan: @@index([createdAt]) narrows it before the Json extraction runs.
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
