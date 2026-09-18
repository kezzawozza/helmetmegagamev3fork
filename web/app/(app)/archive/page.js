import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { ARCHIVE_ROW_SELECT, archiveRowsShape } from "@lifeweb/db/lib/archive";
import { factsLine, rosterLine } from "@lifeweb/db/lib/epilogue";
import { formatAntagonistLines } from "@lifeweb/db/lib/objectives";
import PageShell from "@/app/components/PageShell";
import AppHeader from "@/app/components/AppHeader";
import { loadArchiveAccess } from "@/lib/archiveAccess";
import {
  ARCHIVE_PAGE_SIZE,
  archiveCursorOf,
  archiveOrderBy,
  archiveWhere,
  parseArchiveParams,
} from "@/lib/archiveQuery";
import { gameTitle } from "@/lib/gameLabel";
import ArchiveView from "./ArchiveView";

// The transcript, one game at a time (docs/systemdocs/ARCHIVE.md).
//
// This renders the FIRST screen and the furniture; ArchiveView owns the
// controls and asks /api/archive for the rest as you scroll. The gate, the
// filter and the row shaping are all shared with that endpoint rather than
// spelled twice — web/lib/archiveAccess.js, web/lib/archiveQuery.js and
// db/lib/archive.js#archiveRowsShape.
export default async function ArchivePage({ searchParams }) {
  const params = await searchParams;
  const access = await loadArchiveAccess(params?.game?.toString() ?? "");

  // The nav hides the link from a non-GM entirely, but a page is a public
  // URL — same posture as /character's creation gate.
  if (!access.ok) {
    if (access.reason === "signin") redirect("/");
    // A named game that no longer exists was discarded, or the link predates
    // the numbering going away. Send them to the current game rather than
    // silently showing it as if it were the one they asked for.
    if (access.reason === "no-game") redirect(access.current ? "/archive" : "/character");
    redirect("/character");
  }

  const { game, games, state, archived } = access;
  const filters = parseArchiveParams(params ?? {});
  const where = archiveWhere(game.id, filters);

  // An archived game's rows have LEFT the database — it lives in a packet in
  // the bucket now. Skipping these queries matters: they would all come back
  // empty and the page would render as a transcript with nothing in it and
  // empty filter dropdowns, which reads as a bug rather than as a game that
  // was deliberately put away. The epilogue below is the whole stub, and it is
  // still on the Game row.
  const [rows, total, zoneRows, characterRows] = archived
    ? [[], 0, [], []]
    : await Promise.all([
        prisma.archiveEntry.findMany({
          where,
          // The columns the transcript actually reads. It used to select none,
          // which loaded every column of every row including the BigInt seq.
          select: ARCHIVE_ROW_SELECT,
          orderBy: archiveOrderBy(filters.order),
          // One over a screen, so "is there more" costs no extra query.
          take: ARCHIVE_PAGE_SIZE + 1,
        }),
        prisma.archiveEntry.count({ where }),
        // Filter vocabularies come from the game's own rows, not the live
        // tables: a past game's characters are gone and its zones may have
        // been re-synced under new ids, but the snapshot names on the rows are
        // exactly what was.
        prisma.archiveEntry.groupBy({ by: ["zoneName"], where: { gameId: game.id, zoneName: { not: null } } }),
        prisma.archiveEntry.groupBy({
          by: ["characterId", "characterName"],
          where: { gameId: game.id, kind: "MESSAGE", characterId: { not: null } },
        }),
      ]);

  const done = rows.length <= ARCHIVE_PAGE_SIZE;
  const screen = done ? rows : rows.slice(0, ARCHIVE_PAGE_SIZE);
  const first = {
    rows: await archiveRowsShape(prisma, screen),
    cursor: archiveCursorOf(screen[screen.length - 1]),
    done,
  };
  const zones = zoneRows.map((r) => r.zoneName).sort((a, b) => a.localeCompare(b));
  const characters = characterRows
    .map((r) => ({ id: r.characterId, name: r.characterName ?? r.characterId }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const epilogue = game.epilogue ?? null;
  return (
    <>
      <AppHeader
        title={`Archive · ${gameTitle(game)}`}
        meta={archived ? "put away" : `${total.toLocaleString()} ${total === 1 ? "line" : "lines"}`}
      />
      <PageShell width="wide">
        {epilogue ? (
          <section className="panel flex flex-col gap-3 p-4">
            <h2 className="panel-header">How it ended</h2>
            {epilogue.closingNote ? <p className="text-sm">» {epilogue.closingNote}</p> : null}
            <p className="text-sm text-muted">{factsLine(epilogue.facts)}</p>
            {epilogue.antagonists?.length ? (
              <details className="archive-fold" open>
                <summary>The antagonists</summary>
                <ul>
                  {formatAntagonistLines(epilogue.antagonists).map((line, i) => (
                    <li key={`${epilogue.antagonists[i].partyKey}`}>{line.replaceAll("**", "")}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <details className="archive-fold">
              <summary>Who was who</summary>
              <ul>
                {epilogue.roster.map((r) => (
                  <li key={`${r.handle}-${r.name}`}>{rosterLine(r)}</li>
                ))}
              </ul>
            </details>
          </section>
        ) : null}

        {archived ? (
          <section className="panel flex flex-col gap-2 p-4">
            <h2 className="panel-header">This game has been put away</h2>
            <p className="text-sm">
              Its {game.entryCount ?? "—"} lines were written out to a file and taken out of the database, so the
              transcript is not here to read. What it ended with is above.
            </p>
            <p className="text-sm text-muted mono">npm run archive:import -- --key {game.exportKey ?? "…"}</p>
          </section>
        ) : (
          <ArchiveView
            game={game}
            games={games}
            currentGameId={state?.gameId ?? null}
            zones={zones}
            characters={characters}
            filters={filters}
            total={total}
            first={first}
          />
        )}
      </PageShell>
    </>
  );
}
