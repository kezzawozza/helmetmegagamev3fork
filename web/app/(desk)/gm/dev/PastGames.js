import Link from "next/link";

import { TableScroll } from "@/app/components/DataTable";
import { EmptyRow } from "@/app/components/EmptyState";
import StatusPill from "@/app/components/StatusPill";
import { gameTitle, shortId } from "@/lib/gameLabel";

// Every game there has ever been, and the way into each one's transcript —
// which restart was the real one, how long it ran, whether its transcript is
// still in the database or out in a packet. A plain table, not useTableState:
// a handful of rows, nothing to search or sort (same call as the Gamemasters
// roster). Most numbers come from Game.epilogue (db/lib/epilogue.js), so a
// running game shows a dash; the archive count is counted live instead, and
// falls back to the packet's own count once the rows have left the database (`archivedAt`).
const COL_COUNT = 8;

function ending(game, isCurrent) {
  if (game.nukeDetonatedTurn != null) {
    return { tone: "bad", label: `Nuked, turn ${game.nukeDetonatedTurn}` };
  }
  if (game.ascensionFiredTurn != null) {
    return { tone: "bad", label: `Ascended, turn ${game.ascensionFiredTurn}` };
  }
  if (game.endedAt) return { tone: "muted", label: "Ended" };
  if (isCurrent) return { tone: "good", label: "Running" };
  return { tone: "neutral", label: "Never finished" }; // a restart nobody played
}

// The three packet states, in ARCHIVE.md's order: no packet, rows still in the database, rows gone into it.
function packet(game) {
  if (game.archivedAt) return { tone: "muted", label: "Archived away" };
  if (game.exportKey) return { tone: "good", label: "Exported" };
  return null;
}

function num(value) {
  return value == null ? "—" : value.toLocaleString();
}

export default function PastGames({ games, currentGameId, archiveCounts }) {
  return (
    <TableScroll minWidth="820px">
      <thead>
        <tr>
          <th scope="col">Game</th>
          <th scope="col">Id</th>
          <th scope="col">Ending</th>
          <th scope="col">Days</th>
          <th scope="col">Turns</th>
          <th scope="col">Lived</th>
          <th scope="col">Died</th>
          <th scope="col">Archive</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const isCurrent = g.id === currentGameId;
          const facts = g.epilogue?.facts ?? null;
          const end = ending(g, isCurrent);
          const pack = packet(g);
          const rows = g.archivedAt ? g.entryCount : archiveCounts[g.id];
          return (
            <tr key={g.id}>
              <td>
                {gameTitle(g)}
                {isCurrent ? <span className="chip">Current</span> : null}
                {g.closingNote ? (
                  <span className="block text-xs text-muted">» {g.closingNote}</span>
                ) : null}
                {g.exportKey ? <span className="block text-xs text-muted mono">{g.exportKey}</span> : null}
              </td>
              <td className="mono">{shortId(g)}</td>
              <td>
                <StatusPill tone={end.tone}>{end.label}</StatusPill>
                {pack ? <StatusPill tone={pack.tone}>{pack.label}</StatusPill> : null}
              </td>
              <td className="mono">{num(facts?.days)}</td>
              <td className="mono">{num(facts?.turns)}</td>
              <td className="mono">{num(facts?.characters ?? g.playerCount)}</td>
              <td className="mono">{num(facts?.deaths)}</td>
              <td className="mono">
                {/* An archived-away game still links: /archive renders the
                    stub saying where its transcript went (ARCHIVE.md). */}
                {rows > 0 ? (
                  <Link href={`/archive?game=${g.id}`} className="menu-item">
                    {num(rows)} ↗
                  </Link>
                ) : (
                  <span className="text-muted">{num(rows ?? 0)}</span>
                )}
              </td>
            </tr>
          );
        })}
        {games.length === 0 ? (
          <EmptyRow cols={COL_COUNT}>No game has been opened yet.</EmptyRow>
        ) : null}
      </tbody>
    </TableScroll>
  );
}
