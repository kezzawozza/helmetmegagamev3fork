"use client";

import { useEffect, useState } from "react";
import FormError from "@/app/components/FormError";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import HoverCard from "@/app/components/HoverCard";
import ChipLabel from "@/app/components/ChipLabel";
import TagDetails from "@/app/components/TagDetails";
import { readStash } from "./actions";
import { TONE_CLASS } from "./PlacePanel";

// THIS ROOM: the storage and the fixtures of the room whose feed is OPEN, and
// of no other room.
//
// This is the fix for the Intercom complaint. affordancesFor() answers "what
// can this character do where they are standing", which at a Location with
// six rooms is every room's buttons at once — so standing anywhere in the
// Keep offered the Council Room's Intercom and six Storage buttons. The list
// is right; what was missing was the grouping. The open place says which room
// this is, and one room's worth is what draws.
//
// Absent entirely when the open place is the Location, a conversation or the
// zone summary: the Location's own fixtures are on the place card above.

// Past this many stacks the strip stops being a glance and starts being an
// inventory. The rest are one click away and nothing is hidden.
const VISIBLE_ITEMS = 12;

function roomIdOf(selected) {
  if (!selected || selected.kind !== "room") return null;
  return selected.placeKey?.slice("room:".length) || null;
}

// What is lying in the room, as chips. The action answers with rows now
// (readStash), so nothing here is parsing a sentence the bot wrote for a
// Discord channel — the ⬢ is a mono chip and every stack is one .chip reading
// "Paper ×23", with the × only where there is more than one of a thing.
//
// Every stack is a BUTTON: clicking one opens the Transfer dialog with this
// room as the source and that stack already ticked, which is the whole of
// "take that". Reading a list of things you cannot touch was the complaint.
// The ⬢ chip stays inert — a quantity is typed, not picked.
// One stack on the floor, and what it is. A name alone ("Wolfsbane") is not
// enough to decide with when the choice is what to carry out of here, so the
// chip is the app's REAL tag chip: the same group colour, mastery star and
// details block the sheet and the store draw, through the same portal, because
// this strip is inside a scrolling column that would clip an in-tree tooltip.
// A letter lying here shows what it says, to a reader who can read it.
//
// pinnable={false}: the chip is a button already. A click has one meaning
// here — open Transfer with this stack ticked — and a pin would fight it. That
// is also why the face is ChipLabel `as="button"` rather than a TagChip: a
// span inside the button would nest one .chip box inside another.
//
// inTooltip={false}: an unpinnable panel closes the moment the pointer leaves
// it, so the interactive chips `inTooltip` renders inside a description would
// be unreachable. Flat tokens are the honest render here.
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
    return <p className="chat-quiet-line">Nothing is stored here.</p>;
  }
  const shown = showAll ? items : items.slice(0, VISIBLE_ITEMS);
  const hidden = items.length - shown.length;
  return (
    <div className="chat-chips">
      <span className="chip chip-mono">{stash.resources ?? 0} ⬢</span>
      {shown.map((item) => (
        <StashChip key={item.tagId} item={item} onTake={onTake} />
      ))}
      {/* Both ways. It opened and then had no way back, so a room holding
          thirty stacks stayed thirty stacks tall for the rest of the visit. */}
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
  // WHICH room is expanded, not whether one is: keyed that way, walking into
  // another room collapses its own list without an effect having to reset a
  // boolean (react-hooks/set-state-in-effect is an error here).
  const [expanded, setExpanded] = useState(null);
  const actions = useRequestActions();

  // Re-read whenever the open room changes. The answer is stamped with the
  // room it came from, so a slow reply for the room you have just left is
  // rendered for nobody rather than under the wrong name.
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

  // The three ways into the Transfer dialog. `selfId` comes off the actions
  // context rather than a prop, so this panel needs nothing threaded down to
  // name the player's own end of a move.
  const selfKey = actions?.selfId ? `character:${actions.selfId}` : "";
  const roomKey = `room:${roomId}`;

  function drop() {
    actions?.open?.("transfer", null, { fromKey: selfKey, toKey: roomKey });
  }

  // With an item: the stack that was clicked, already ticked. Without one:
  // the Take button, which seeds the direction and leaves the picking.
  function take(item = null) {
    actions?.open?.("transfer", null, {
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
      <p className="chat-section-title">This room</p>

      {/* Three states, not two. A read still in flight says so; one that
          came back refused says WHY, which is the whole point of the
          sentence the action returned — it used to be swallowed and drawn as
          "looking…", so a locked cupboard looked like a slow one forever. */}
      {here?.ok ? (
        <>
          {/* The chips say WHAT is in there; without this they did not say
              what the strip was. The Discord sentence used to carry the word
              ("Storage · …") and the chips lost it. */}
          <p className="chat-quiet-line">Storage</p>
          <StashChips
            stash={here}
            showAll={expanded === roomId}
            onToggle={() => setExpanded((open) => (open === roomId ? null : roomId))}
            onTake={take}
          />
        </>
      ) : here ? (
        <FormError>{here.error ?? "Couldn't see in there."}</FormError>
      ) : (
        <p className="chat-quiet-line">Storage · looking…</p>
      )}
      {here?.ok && (
        <div className="chat-buttons">
          {/* One Transfer dialog, three ways in. "Move things" made a player
              open it and then say which way the things were going, when the
              button they wanted to press already knew. Drop and Take seed both
              ends; Transfer is the same dialog with nothing assumed, for
              handing something to a person. */}
          <button type="button" className="btn-quiet" onClick={drop}>
            Drop
          </button>
          <button type="button" className="btn-quiet" onClick={() => take()}>
            Take
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
