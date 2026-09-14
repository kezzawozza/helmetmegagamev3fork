"use client";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import { zoneKey } from "@/lib/zones";

// The transcript as a dense reading surface (docs/systemdocs/ARCHIVE.md §5):
// one line per thing said, under a sticky day header and a scene line, with
// runs of event rows folded into one muted line each.
//
// Grouping is by CONSECUTIVE runs over the rows as they arrive, never by
// bucketing the whole list: rows come in the query's order, and bucketing
// would silently reorder a view sorted newest-first. The one pre-pass below
// builds a flat list of blocks; nothing mutates during render.
//
// Three things this draws that the old version did not, all off columns the
// archive already stored and threw away:
//
//   - a WORLD line (source SYSTEM) reads as subtext rather than as somebody
//     called "Unknown" saying it, which is how /chat has always drawn them
//   - a scene is keyed on placeKey, so two rooms that share a name stay two
//     scenes and a renamed one stays one
//   - the frozen face, behind a toggle

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

function phaseWord(phase) {
  return phase ? `${phase.charAt(0)}${phase.slice(1).toLowerCase()}` : null;
}

function dayLabel(row) {
  if (row.turnNumber == null) return "Before the game";
  return `Day ${Math.ceil(row.turnNumber / 2)}`;
}

// The channelKinds that mean "a place in the world", and so are already
// covered by zoneName. Anything else with no zone is a standing channel
// outside the zone system — a radio net — and the channel's own name is the
// only thing that tells two of them apart. Without this both nets filed
// under one "Elsewhere" scene, police traffic interleaved with the cult's.
const PLACED_KINDS = new Set(["summary", "location", "scene", "intercom"]);

// The place, as a key and as words. The KEY is placeKey where there is one —
// the display string merges two rooms that happen to share a name and splits
// one that got renamed, which is exactly the pair of bugs this avoids.
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

// A concealed message keeps both halves: the alias is what the room saw, the
// real name is who it was. Together they make the finished archive readable as
// one story — and are why the archive stays shut until the game ends.
//
// Two spans rather than one string, so the real name can be dimmed: at a
// glance you read the scene as the room read it, and the answer is there when
// you want it.
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
      blocks.push({ type: "day", key: `d${row.id}`, label: dayLabel(row), phase: phaseWord(row.turnPhase) });
    }
    if (row.kind === "TURN_START") {
      // The header IS this row — the day line above already says everything it
      // carries, so the row itself is not rendered.
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
        {/* A world line has no speaker at all. It used to print "Unknown",
            which read as a bug rather than as the room itself talking. */}
        {world ? null : (
          <>
            {portraits ? (
              <CharacterAvatar
                characterId={row.characterId}
                name={speaker.shown ?? ""}
                version={row.avatarVersion}
                src={row.avatarPath ?? undefined}
                // A line said under an alias before the game recorded what was
                // over the speaker's face. It cannot be given one now — the
                // sprite lived on the tag they were wearing then — so it keeps
                // its secret and draws the plate.
                unknown={row.unknownFace}
                size={18}
              />
            ) : null}
            <button
              type="button"
              className="archive-row-name"
              onClick={() => onPick?.({ character: row.characterId })}
              // A hooded row carries no id to filter on — that withholding is
              // what stops a browser matching a hood to a name.
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
              {[b.label, b.phase].filter(Boolean).join(" · ")}
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
                    {/* Through the same renderer as a speech row: these carry
                        {char:…} and {tag:…} tokens too, and printing them raw
                        showed players the braces. */}
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
