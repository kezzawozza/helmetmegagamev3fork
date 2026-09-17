"use server";

import { getGmSession } from "@/lib/discordGuild";
import { prisma } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { ADMIN_NOTE_MAX_LENGTH } from "@/lib/constants";

// The server half of AdminNotes.js, shared by both surfaces that mount it —
// the player desk's inspector and the Dev Character Panel. Its own "use
// server" file rather than an import from one desk's actions.js, for the
// reason devPanelActions.js gives: those are themselves "use server" modules,
// so their requireGm isn't importable and the same few lines are replicated.
async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new UserError("Not authenticated.");
  if (!gm) throw new UserError("Not authorized.");
  return session;
}

const SEVERITIES = new Set(["HIGH", "MEDIUM", "LOW"]);

// Every action below hands back the whole fresh list, and NONE of them calls
// revalidatePath. Nothing in either route's server render reads a note — the
// tab fetches for itself, both places — so revalidating would throw away the
// entire player-desk layout (rail, roster, staged effects) to refresh a list
// the server never sent. Same reasoning as markConversationRead's deliberate
// exception in the players desk (PLAYER-DESK.md §9).
async function listFor(discordUserId) {
  const notes = await prisma.adminNote.findMany({
    where: { discordUserId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  // Author handles come from the DiscordAccount cache, which is a cache: it
  // has no row for a GM the sweep has never seen. Fall back to the raw
  // snowflake rather than rendering a note with no byline at all.
  const authorIds = [...new Set(notes.map((n) => n.authorDiscordUserId))];
  const accounts = authorIds.length
    ? await prisma.discordAccount.findMany({ where: { discordUserId: { in: authorIds } } })
    : [];
  const handleById = new Map(
    accounts.map((a) => [a.discordUserId, a.globalName || a.username]),
  );

  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    severity: n.severity,
    createdAt: n.createdAt.toISOString(),
    author: handleById.get(n.authorDiscordUserId) ?? n.authorDiscordUserId,
  }));
}

export async function listAdminNotes({ discordUserId }) {
  return guarded(async () => {
    await requireGm();
    if (!discordUserId) throw new UserError("No player specified.");
    return { notes: await listFor(String(discordUserId)) };
  });
}

export async function addAdminNote({ discordUserId, body, severity }) {
  return guarded(async () => {
    const session = await requireGm();
    if (!discordUserId) throw new UserError("No player specified.");

    const text = body?.toString().trim() ?? "";
    if (!text) throw new UserError("Write something first.");
    if (text.length > ADMIN_NOTE_MAX_LENGTH) {
      throw new UserError(`That is over the ${ADMIN_NOTE_MAX_LENGTH} character limit.`);
    }
    const level = String(severity ?? "LOW");
    if (!SEVERITIES.has(level)) throw new UserError("Pick a severity.");

    const player = String(discordUserId);
    // The author is the session's, never the client's claim about who is
    // writing — same posture the players desk takes with a posted id.
    await prisma.$transaction([
      prisma.adminNote.create({
        data: {
          discordUserId: player,
          authorDiscordUserId: session.discordUserId,
          body: text,
          severity: level,
        },
      }),
      prisma.auditLog.create({
        data: {
          actorDiscordUserId: session.discordUserId,
          actionType: "admin_note_added",
          details: { discordUserId: player, severity: level, body: text },
        },
      }),
    ]);

    return { notes: await listFor(player) };
  });
}

export async function deleteAdminNote({ id }) {
  return guarded(async () => {
    const session = await requireGm();
    if (!id) throw new UserError("No note specified.");

    const note = await prisma.adminNote.findUnique({ where: { id: String(id) } });
    if (!note) throw new UserError("That note is already gone.");

    // Any GM may delete any note, so the audit row carries the whole body: a
    // note that can be erased leaving no trace of what it said is the failure
    // the append-only shape exists to prevent.
    //
    // deleteMany inside an INTERACTIVE transaction, not a plain delete in an
    // array. Two GMs clicking the same row is an ordinary race: `delete`
    // throws P2025 on the loser, which `guarded` rethrows and Next redacts to
    // a digest, so the GM sees the desk break rather than "already gone". And
    // the audit row has to be conditional on the delete having actually
    // happened — in an array it would commit either way, logging a deletion
    // that never occurred.
    const removed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.adminNote.deleteMany({ where: { id: note.id } });
      if (!count) return false;
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: session.discordUserId,
          actionType: "admin_note_deleted",
          details: {
            discordUserId: note.discordUserId,
            severity: note.severity,
            body: note.body,
            authorDiscordUserId: note.authorDiscordUserId,
          },
        },
      });
      return true;
    });
    if (!removed) throw new UserError("That note is already gone.");

    return { notes: await listFor(note.discordUserId) };
  });
}
