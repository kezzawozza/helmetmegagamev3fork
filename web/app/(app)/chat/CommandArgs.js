"use client";

import { useEffect, useState } from "react";
import { pendingArg } from "./commands";
import { matchRoster } from "./MentionMenu";
import { loadTravel } from "./actions";

// Lifted out of ./Feed.js (CHAT-REBUILD.md) so it sits with CommandMenu.js
// and CommandStrip.js — the three pieces of the command line, in one place,
// drawn by whichever composer is mounted.

// What `/travel`'s picker says when the reachable places could not be read.
const ROAD_ERROR = "Couldn't read the road. Try again.";

// The chips a command still wants: a person, a Move kind, or a destination.
//
// One row at a time — the FIRST unfilled argument is the question being
// asked. Drawing every argument at once would make this a form, and the whole
// point of a command line is that it asks one thing and then gets out of the
// way.
//
// The person row includes HOODS where the command says it may (`/look`), and
// their value is the opaque token db/lib/whosHere.js minted, not an id: the
// browser is never told who is under one.
// At most this many faces in the person row. Past a dozen the chips wrap into
// a wall and the box they belong to is off the bottom of the screen; the
// filter below is what a player uses to get past it.
const PERSON_CHIP_LIMIT = 12;

export default function CommandArgs({ command, people, members, query = "", onPick }) {
  const { entry, values } = command;
  const arg = pendingArg(entry, values);
  const [destinations, setDestinations] = useState(null);

  // The reachable places, only for a command that asks for one. Fetched on
  // demand rather than with the page: an exit's state moves under a player
  // standing still, and a stale list would offer a shut gate.
  useEffect(() => {
    if (arg?.kind !== "destination") return undefined;
    let cancelled = false;
    // A refusal or a dropped request is kept apart from an empty list: "no
    // way out" is a fact about the place, and it must not be what a network
    // blip reads as.
    loadTravel()
      .then((res) => {
        if (!cancelled) setDestinations(res?.ok ? res.options : { error: res?.error ?? ROAD_ERROR });
      })
      .catch(() => {
        if (!cancelled) setDestinations({ error: ROAD_ERROR });
      });
    return () => {
      cancelled = true;
    };
  }, [arg?.kind]);

  if (!arg) return null;


  if (arg.kind === "destination") {
    if (!destinations) return <p className="text-sm text-muted">Reading the road…</p>;
    if (destinations.error) return <p className="text-sm text-muted">{destinations.error}</p>;
    if (destinations.length === 0) return <p className="text-sm text-muted">No way out of here.</p>;
    return (
      <div className="chip-row" aria-label="Where to">
        {destinations.map((option) => (
          <button
            key={option.id}
            type="button"
            className="chip"
            title={option.reason ?? undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, option.id)}
          >
            {option.name}
          </button>
        ))}
      </div>
    );
  }

  // `from: "members"` is /remove, whose people are the guest list rather than
  // the street — a conversation member need not be standing beside you. It
  // falls back to who is here when the list has not landed.
  const roster =
    arg.from === "members" && members.length > 0
      ? members
      : [...(people?.named ?? []), ...(arg.hoods ? (people?.concealed ?? []) : [])];

  if (roster.length === 0) return <p className="text-sm text-muted">Nobody to pick.</p>;

  // What is in the box FILTERS the row. A command that asks for a person has
  // no text argument, so the textarea is doing nothing else — and a Location
  // with thirty people in it is otherwise a picker you scroll rather than one
  // you use. Same prefix rule as the @ list, so the two behave alike.
  const hits = matchRoster(roster, query, Infinity);
  const shown = hits.slice(0, PERSON_CHIP_LIMIT);
  const more = hits.length - shown.length;

  if (shown.length === 0) return <p className="text-sm text-muted">Nobody here by that name.</p>;

  return (
    <div className="chip-row" aria-label="Who">
      {shown.map((person, index) => {
        // A hood has no characterId — the token is the whole handle, and it
        // is what the server resolves back against the people standing here.
        const value = person.characterId ?? person.token ?? null;
        const label = person.name ?? person.alias ?? "somebody";
        return (
          <button
            key={value ?? `hooded-${index}`}
            type="button"
            className="chip"
            disabled={!value}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, value)}
          >
            {label}
          </button>
        );
      })}
      {more > 0 && <span className="text-sm text-muted">…and {more} more</span>}
    </div>
  );
}
