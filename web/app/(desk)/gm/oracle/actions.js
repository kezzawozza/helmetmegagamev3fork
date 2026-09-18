"use server";

// The Oracle desk's writes. See docs/systemdocs/ORACLE.md. Reading is done
// server-side. A GM's ordinary action is rewriting one page; Regenerate below
// is the other one — redrafting the whole turn, superadmin-only.

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { runOracle } from "@lifeweb/db/lib/oracle";

const MAX_BODY = 20_000;

// Every GM, not just a superadmin — the settings behind the desk are the
// superadmin part. Re-checks for itself; a server action is a public endpoint.
async function requireGm() {
  const session = await auth();
  if (!session?.discordUserId) throw new Error("Not authorized.");
  const { isGm } = await getGmSession();
  if (!isGm) throw new Error("Not authorized.");
  return session;
}

export async function saveSynopsis({ id, body }) {
  const session = await requireGm();

  const text = String(body ?? "").trim().slice(0, MAX_BODY);
  if (!text) return { ok: false, error: "A page cannot be empty." };

  // editedAt stops a later run replacing this text and tells the desk to draw
  // it as a person's page rather than a draft. Never cleared once stamped.
  const row = await prisma.oracleSynopsis.update({
    where: { id: String(id) },
    data: {
      body: text,
      editedAt: new Date(),
      editedByDiscordUserId: session.discordUserId,
    },
    select: { id: true, body: true, editedAt: true },
  });

  revalidatePath("/gm/oracle");
  return { ok: true, row: { ...row, editedAt: row.editedAt?.toISOString() ?? null } };
}

// Whole turn, every unedited page, then the front page. Superadmin like Run
// now, not GM like Save above: rewriting one page is a GM's correction,
// replacing the whole turn is host access. The desk is GM-tier and Save
// above is GM-tier, so this is a deliberate second, narrower gate in the
// same file. A server action is a public endpoint, so it is re-checked here
// whatever the button on the page did.
export async function regenerateTurn(turnNumber) {
  const session = await requireGm();
  if (!isSuperadmin(session.discordUserId)) return { ok: false, error: "Superadmin only." };

  const number = Number(turnNumber);
  if (!Number.isInteger(number)) return { ok: false, error: "No such turn." };

  const turn = await prisma.turn.findUnique({
    where: { number },
    select: { id: true },
  });
  if (!turn) return { ok: false, error: "No such turn." };

  // No ledger here — a failure is told to the waiting GM, not swallowed.
  // Edited pages are skipped inside runOracle itself (isEdited), not here.
  let result;
  try {
    result = await runOracle(prisma, { turnId: turn.id, step: (_key, fn) => fn(), phases: "both" });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }

  revalidatePath("/gm/oracle");
  return result.ran ? { ok: true, zones: result.zones } : { ok: false, error: result.reason };
}
