import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";

// Who may read which game's transcript (docs/systemdocs/ARCHIVE.md). A PAST game is readable by
// any signed-in user; the CURRENT game opens only when GameState.archiveVisible is on, and to GMs
// always — effectively a one-way door, since the archive names the character behind every /conceal.
export async function loadArchiveAccess(requestedGameId = "") {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, status: 401, reason: "signin" };

  const [{ isGm: gm }, state, games] = await Promise.all([
    getGmSession(),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { archiveVisible: true, gameId: true, phase: true } }),
    prisma.game.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, label: true, startedAt: true, endedAt: true, epilogue: true,
        archivedAt: true, entryCount: true, exportKey: true, createdAt: true,
      },
    }),
  ]);

  // An id nobody has must not quietly fall through to the current game.
  const requested = requestedGameId?.toString().trim() ?? "";
  const current = games.find((g) => g.id === state?.gameId) ?? games[0] ?? null;
  const game = requested ? (games.find((g) => g.id === requested) ?? null) : current;
  if (!game) return { ok: false, status: 404, reason: "no-game", current, games, state, gm };

  const isCurrent = game.id === state?.gameId;
  if (isCurrent && !gm && !state?.archiveVisible) {
    return { ok: false, status: 403, reason: "shut", current, games, state, gm };
  }

  return {
    ok: true,
    game,
    games,
    state,
    gm,
    isCurrent,
    // An archived game's rows have LEFT the database. Callers must not run the row queries.
    archived: Boolean(game.archivedAt),
    // The reveal must not show while the game is running again (LOBBY.md §7). GMs see it regardless.
    revealHidden: isCurrent && !gm && state?.phase !== "ENDED",
  };
}
