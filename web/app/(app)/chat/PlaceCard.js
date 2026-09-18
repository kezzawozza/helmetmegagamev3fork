"use client";

import Link from "next/link";
import { useState } from "react";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import { TONE_CLASS } from "./PlacePanel";

// THE PLACE CARD: where you are standing, in words, and the fixtures of the
// Location itself.
//
// Two readings of the same spot. **Place** is the Location's own description
// followed by the Examine lines (db/lib/examineLocation.js) — what can be
// worked here, what the ways out are doing, what is standing on the ground.
// **Zone** is the zone's description, which nothing on the web rendered until
// now. Both are always on the page rather than behind a button, because the
// old Examine dialog was a modal you had to open to find out where you were.
//
// The fixtures under the text are the LOCATION's own: a noticeboard, a gate
// somebody in the watchtower may work, a keyed door they hold the key to. A
// room's fixtures are RoomPanel's, and travel is TravelNodes'.

const SIDES = [
  { value: "place", label: "Place" },
  { value: "zone", label: "Zone" },
];

// The Examine lines carry Discord's bold markers, because the same strings
// are printed into a channel — `**Ways out**`, and so on. They used to be
// stripped here, which threw the emphasis away rather than rendering it; they
// go through ChatMarkdown now, the same as every other string in this page
// somebody wrote for a person to read.

export default function PlaceCard({
  place,
  zone,
  lines = [],
  fixtures = [],
  onFixture,
  onConverse = null,
  // The Depot terminal, when this character is standing at it AND holds the
  // licence or the keycard. Offered as a link rather than blind: /depot bounces
  // anybody without one, and a button that only ever redirects is a lie.
  depotHref = null,
  // The Godard Factory (docs/systemdocs/FACTORY.md). Drawn where the ground is
  // godflesh; the dialog itself says what is missing when there is no tool in
  // hand, and extractGodfleshRequest re-checks both.
  onFactory = null,
  // The Cathedral's Research button (CRAFTING.md §2b).
  // Drawn only for a Research holder standing in the Cathedral — the same
  // "fact about the ground" gate onFactory uses — and disabled with the
  // reason (Move spent, nothing worth studying) rather than hidden, since
  // the ground fact alone is never private but the OTHER two gates are
  // facts about this character's own turn.
  onResearch = null,
  researchHint = null,
  // The map (docs/systemdocs/MAP.md §6). Always offered — it is the one
  // fixture here that belongs to the world rather than to this Location, and
  // a character with nowhere on it yet is told so by the board itself.
  onOpenMap = null,
  pending = false,
}) {
  const [side, setSide] = useState("place");

  const body =
    side === "zone"
      ? [zone?.description || "Nothing is written about this part of the world."]
      : [place?.description, ...lines].filter(Boolean);

  return (
    <div className="chat-card">
      <p className="group-label chat-section-title">{place?.name ?? "Here"}</p>
      {zone?.name && <p className="chat-quiet-line">{zone.name}</p>}

      <div className="chip-row" role="radiogroup" aria-label="What you are reading">
        {SIDES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="radio"
            className="chip"
            data-active={side === entry.value ? "true" : undefined}
            aria-checked={side === entry.value}
            onClick={() => setSide(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="chat-card-text">
        {body.length === 0 ? (
          <p className="text-sm text-muted">Nothing to see.</p>
        ) : (
          body.map((paragraph, index) => <ChatMarkdown key={index} content={paragraph} />)
        )}
      </div>

      {(fixtures.length > 0 ||
        onConverse ||
        depotHref ||
        onFactory ||
        onOpenMap ||
        onResearch ||
        researchHint) && (
        <div className="chat-buttons">
          {fixtures.map((entry) => (
            <button
              key={`${entry.id}:${entry.linkId ?? "place"}`}
              type="button"
              className={TONE_CLASS[entry.tone] ?? "btn-secondary"}
              disabled={pending}
              onClick={() => onFixture(entry)}
            >
              {entry.label}
            </button>
          ))}
          {depotHref && (
            <Link className="btn-secondary" href={depotHref}>
              Depot ›
            </Link>
          )}
          {onFactory && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={onFactory}>
              Factory
            </button>
          )}
          {/* Drawn once a Research holder is standing in the Cathedral —
              `onResearch`/`researchHint` arrive null together off anything
              else. Disabled with the reason rather than hidden when the Move
              is spent or nothing here is worth studying, private to this
              viewer (never rendered by the Discord anchor). */}
          {(onResearch || researchHint) && (
            <button
              type="button"
              className="btn-secondary"
              disabled={pending || !onResearch}
              title={researchHint ?? undefined}
              onClick={onResearch ?? undefined}
            >
              Research an ingredient
            </button>
          )}
          {/* Starting a conversation is otherwise only reachable from a
              person's row in HERE, which leaves somebody standing alone with
              no way to open one and invite the people who arrive after. Same
              dialog either way — it asks who to talk to itself. */}
          {onConverse && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => onConverse()}>
              Converse
            </button>
          )}
          {onOpenMap && (
            <button type="button" className="btn-secondary" onClick={onOpenMap}>
              Open map
            </button>
          )}
        </div>
      )}
    </div>
  );
}
