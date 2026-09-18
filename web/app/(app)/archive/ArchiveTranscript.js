"use client";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import { zoneKey } from "@/lib/zones";

// The transcript as a dense reading surface (docs/systemdocs/ARCHIVE.md §5):
// one line per thing said, under a sticky day header and scene line, with
// event rows folded into one muted line each. Grouping is by CONSECUTIVE runs
// over the rows in query order, never bucketing the whole list — that would
// silently reorder a view sorted newest-first.

const FOLD_LABEL = {
  CHARACTER_CREATED: (n) => `${n} arrived`,
  DEATH: (n) => `${n} died`,
  DESIRE_FULFILLED: (n) => (n === 1 ? "1 desire fulfilled" : `${n} desires fulfilled`),
  TRAVEL: (n) => `${n} moved`,
  LIFEWEB: (n) => `${n} lifeweb`,
};

// A mark per kind, so a death and a move are not the same muted line.
const FOLD_MARK = {
  CHARACTER_CREATED: "✦",
  DEATH: "†",
  DESIRE_FULFILLED: "✧",
  TRAVEL: "→",
  LIFEWEB: "❧",
};

// The day is snapshotted onto the ArchiveEntry itself — there is no Turn row to
// join here, and it stopped being derivable from the turn number when the turn
// length became a knob. The fallback covers rows written before the column.
function dayLabel(row) {
  if (row.turnNumber == null) return "Before the game";
  return `Day ${row.dayNumber ?? Math.ceil(row.turnNumber / 2)}`;
}

// channelKinds meaning "a place in the world", already covered by zoneName.
// Anything else with no zone is a standing channel outside the zone system.
const PLACED_KINDS = new Set(["summary", "location", "scene", "intercom", "decree"]);

// The KEY is placeKey where there is one, since the display string alone
// merges two same-named rooms and splits a renamed one.
function sceneOf(row) {
  const named = row.channelKind && !PLACED_KINDS.has(row.channelKind) ? `#${row.channelKind}` : null;
  const place = row.zoneName ?? named ?? "Elsewhere";
  return {
    key: row.placeKey ?? (row.threadName ? `${place} · ${row.threadName}` : place),
    zoneName: row.zoneName ?? null,
    label: row.threadName ? `${place} · ${row.threadName}` : place,
    // A zone's own #summary is not a room, and saying so costs one word.
    channelKind: row.channelKind ?? null,
  };
}

// A concealed message keeps both halves: alias (what the room saw) and real
// name, as two spans so the real name can be dimmed rather than merged.
function speakerParts(row) {
  if (row.alias) return { shown: row.alias, real: row.realName ?? null };
  return { shown: row.realName ?? row.name ?? null, real: null };
}

function clock(sentAt) {
  return new Date(sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function foldSummary(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, n]) => (FOLD_LABEL[kind] ?? (() => `${n} ${kind.toLowerCase()}`))(n))
    .join(" · ");
}

function buildBlocks(rows, { groupScenes = true } = {}) {
  const blocks = [];
  let dayKey;
  let sceneKey;
  for (const row of rows) {
    const thisDay = row.turnNumber ?? "none";
    if (thisDay !== dayKey) {
      dayKey = thisDay;
      sceneKey = undefined;
      blocks.push({ type: "day", key: `d${row.id}`, label: dayLabel(row) });
    }
    if (row.kind === "TURN_START") {
      // The day line above already says everything this row carries.
      continue;
    }
    const scene = sceneOf(row);
    if (groupScenes && scene.key !== sceneKey) {
      sceneKey = scene.key;
      blocks.push({ type: "scene", key: `s${row.id}`, ...scene });
    }
    if (row.kind === "MESSAGE") {
      blocks.push({ type: "row", key: row.id, row, scene });
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.type === "fold") last.rows.push(row);
      else blocks.push({ type: "fold", key: `f${row.id}`, rows: [row] });
    }
  }
  return blocks;
}

function SceneHeader({ block, onPick }) {
  const key = zoneKey(block.zoneName);
  return (
    <div className="archive-scene" data-zone={key ?? "none"}>
      <button
        type="button"
        className="archive-scene-name"
        onClick={() => onPick?.({ zone: block.zoneName })}
        title={block.zoneName ? `Only ${block.zoneName}` : undefined}
      >
        {block.label}
      </button>
      {block.channelKind === "summary" ? <span className="archive-scene-kind">summary</span> : null}
    </div>
  );
}

function Row({ row, showPlace, portraits, onPick, onCite }) {
  const world = row.source === "SYSTEM";
  const speaker = speakerParts(row);
  return (
    <div className="archive-row" id={`e${row.id}`} data-world={world ? "true" : undefined}>
      <span className="archive-row-time">{clock(row.sentAt)}</span>
      <span className="archive-row-who">
        {/* A world line has no speaker at all — not "Unknown". */}
        {world ? null : (
          <>
            {portraits ? (
              <CharacterAvatar
                characterId={row.characterId}
                name={speaker.shown ?? ""}
                version={row.avatarVersion}
                src={row.avatarPath ?? undefined}
                // Can't recover a face recorded before the game tracked it — keeps its secret, draws the plate.
                unknown={row.unknownFace}
                size={18}
              />
            ) : null}
            <button
              type="button"
              className="archive-row-name"
              onClick={() => onPick?.({ character: row.characterId })}
              // A hooded row carries no id, which stops matching a hood to a name.
              disabled={!row.characterId}
              title={row.characterId ? `Only ${speaker.real ?? speaker.shown}` : undefined}
            >
              {speaker.shown}
            </button>
            {speaker.real && speaker.real !== speaker.shown ? (
              <span className="archive-row-real">{speaker.real}</span>
            ) : null}
          </>
        )}
      </span>
      <span className="archive-row-what">
        {showPlace ? <span className="archive-row-place">{sceneOf(row).label}</span> : null}
        <ChatMarkdown content={row.content} />
        {row.editedAt ? <span className="archive-row-edited">edited</span> : null}
      </span>
      <button type="button" className="archive-row-cite" onClick={() => onCite?.(row)} title="Copy a link to this line">
        #
      </button>
    </div>
  );
}

export default function ArchiveTranscript({ rows, groupScenes = true, portraits = false, onPick, onCite }) {
  const blocks = buildBlocks(rows, { groupScenes });
  return (
    <div className="archive" data-portraits={portraits ? "true" : undefined}>
      {blocks.map((b) => {
        if (b.type === "day") {
          return (
            <div key={b.key} className="archive-day">
              {b.label}
            </div>
          );
        }
        if (b.type === "scene") return <SceneHeader key={b.key} block={b} onPick={onPick} />;
        if (b.type === "fold") {
          return (
            <details key={b.key} className="archive-fold">
              <summary>{foldSummary(b.rows)}</summary>
              <ul>
                {b.rows.map((r) => (
                  <li key={r.id} id={`e${r.id}`}>
                    <span className="archive-row-time">{clock(r.sentAt)}</span>
                    <span className="archive-fold-mark">{FOLD_MARK[r.kind] ?? "·"}</span>
                    {/* Same renderer as a speech row: these carry {char:…}/{tag:…} tokens too. */}
                    <ChatMarkdown content={r.content} />
                  </li>
                ))}
              </ul>
            </details>
          );
        }
        return (
          <Row
            key={b.key}
            row={b.row}
            showPlace={!groupScenes}
            portraits={portraits}
            onPick={onPick}
            onCite={onCite}
          />
        );
      })}
    </div>
  );
}
