"use client";

import { useEffect, useState } from "react";
import FormError from "@/app/components/FormError";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import HoverCard from "@/app/components/HoverCard";
import ChipLabel from "@/app/components/ChipLabel";
import TagDetails from "@/app/components/TagDetails";
import { readStash } from "./actions";
import { TONE_CLASS } from "./PlacePanel";

// THIS ROOM: storage and fixtures of the room whose feed is OPEN, and no
// other — affordancesFor() otherwise returns every room's buttons at once.
// Absent when the open place is the Location, a conversation, or a zone summary.

// Past this many stacks the strip stops being a glance and starts being an
// inventory. The rest are one click away and nothing is hidden.
const VISIBLE_ITEMS = 12;

function roomIdOf(selected) {
  if (!selected || selected.kind !== "room") return null;
  return selected.placeKey?.slice("room:".length) || null;
}

// What is lying in the room, as chips (readStash rows, not a parsed Discord
// sentence). Every stack is a BUTTON: clicking opens Transfer with this room
// as source and that stack ticked. The ⬢ chip stays inert — typed not picked.
// Uses the app's REAL tag chip (group colour, mastery star, details) through
// a portal, since this strip sits in a scrolling column that would clip an
// in-tree tooltip. pinnable={false} and `as="button"`: the chip is already a
// button, so a pin would fight the click, and a span inside it would nest
// one .chip box inside another.
function StashChip({ item, onTake }) {
  return (
    <HoverCard pinnable={false} panel={<TagDetails tag={item.tag} quantity={item.quantity} />}>
      <ChipLabel
        as="button"
        type="button"
        tag={item.tag}
        quantity={item.quantity}
        title={`Take ${item.tag.name}`}
        onClick={() => onTake(item)}
      />
    </HoverCard>
  );
}

function StashChips({ stash, showAll, onToggle, onTake }) {
  const items = stash.items ?? [];
  if (items.length === 0 && !(stash.resources > 0)) {
    return <p className="chat-quiet-line">Empty</p>;
  }
  const shown = showAll ? items : items.slice(0, VISIBLE_ITEMS);
  const hidden = items.length - shown.length;
  return (
    <div className="chat-chips">
      <span className="chip chip-mono">{stash.resources ?? 0} ⬢</span>
      {shown.map((item) => (
        <StashChip key={item.tagId} item={item} onTake={onTake} />
      ))}
      {/* Toggles both ways, so an expanded room can be collapsed again. */}
      {(hidden > 0 || showAll) && (
        <button type="button" className="btn-quiet" onClick={onToggle}>
          {showAll ? "Show less" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

export default function RoomPanel({ selected, affordances = [], onFixture, pending = false }) {
  const roomId = roomIdOf(selected);
  const [stash, setStash] = useState(null);
  // Keyed by WHICH room is expanded so walking into another room collapses
  // its list with no effect resetting a boolean (react-hooks/set-state-in-effect is an error here).
  const [expanded, setExpanded] = useState(null);
  const actions = useRequestActions();

  // Answer is stamped with the room it came from, so a slow reply for a room
  // already left renders for nobody rather than under the wrong name.
  useEffect(() => {
    if (!roomId) return undefined;
    let cancelled = false;
    readStash(roomId)
      .then((res) => {
        if (!cancelled) setStash({ roomId, ...res });
      })
      .catch(() => {
        if (!cancelled) setStash({ roomId, ok: false, error: "Couldn't see in there." });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  if (!roomId) return null;

  // `selfId` comes off the actions context, so nothing needs threading down.
  const selfKey = actions?.selfId ? `character:${actions.selfId}` : "";
  const roomKey = `room:${roomId}`;

  function drop() {
    actions?.open?.("transfer", null, { fromKey: selfKey, toKey: roomKey });
  }

  // With an item: the clicked stack, already ticked. Without one: seeds direction only.
  function take(item = null) {
    actions?.open?.("transfer", null, {
      fromKey: roomKey,
      toKey: selfKey,
      ...(item ? { picks: { [item.tagId]: 1 } } : {}),
    });
  }

  // Same seeding as Take, different verb: out of the stash, into your hands,
  // and a die decides whether the room hears about it (THEFT.md §1).
  function steal(item = null) {
    actions?.open?.("steal", null, {
      fromKey: roomKey,
      toKey: selfKey,
      ...(item ? { picks: { [item.tagId]: 1 } } : {}),
    });
  }

  function transfer() {
    actions?.open?.("transfer");
  }

  const here = stash?.roomId === roomId ? stash : null;
  const fixtures = affordances.filter(
    (entry) => entry.kind === "room" && entry.roomId === roomId && entry.id !== "storage",
  );

  return (
    <div className="chat-room">
      {/* One heading: the place card above already names the room. */}
      <p className="group-label chat-section-title">Storage</p>

      {/* Three states: in flight, refused (says WHY), or ready. */}
      {here?.ok ? (
        <StashChips
          stash={here}
          showAll={expanded === roomId}
          onToggle={() => setExpanded((open) => (open === roomId ? null : roomId))}
          onTake={take}
        />
      ) : here ? (
        <FormError>{here.error ?? "Couldn't see in there."}</FormError>
      ) : (
        <p className="chat-quiet-line">Looking…</p>
      )}
      {here?.ok && (
        <div className="chat-buttons chat-buttons--tight">
          {/* One Transfer dialog, three ways in: Drop/Take seed both ends, Transfer assumes nothing. */}
          <button type="button" className="btn-quiet" onClick={drop}>
            Drop
          </button>
          <button type="button" className="btn-quiet" onClick={() => take()}>
            Take
          </button>
          <button type="button" className="btn-quiet" onClick={() => steal()}>
            Steal
          </button>
          <button type="button" className="btn-quiet" onClick={transfer}>
            Transfer
          </button>
        </div>
      )}

      {fixtures.length > 0 && (
        <div className="chat-buttons">
          {fixtures.map((entry) => (
            <button
              key={`${entry.id}:${entry.roomId}`}
              type="button"
              className={TONE_CLASS[entry.tone] ?? "btn-secondary"}
              disabled={pending}
              onClick={() => onFixture(entry)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
