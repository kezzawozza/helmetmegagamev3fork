"use server";

// The Oracle desk's one write. See docs/systemdocs/ORACLE.md. Reading is done
// server-side; a GM's only action is rewriting a page — no regenerate, so an edit has to stick.

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";

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
