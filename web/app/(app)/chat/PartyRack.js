"use client";

import { useCallback, useEffect, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { loadParty, bringAlong, putDown, answerEscort } from "./actions";
import useVisiblePoll from "./useVisiblePoll";

// BRINGING: the people attached to you, drawn as the seats they take up.
//
// This replaced two things at once — the Move Player dialog, which shoved one
// person one hop, and the drag chips inside the Travel confirm, which had to
// be re-ticked before every single move. You pick somebody up once here and
// they follow you until something lets go: you walk off, they walk off, or a
// way refuses to take them (docs/systemdocs/MAP.md §3a).
//
// The slots are the mount's, from db/lib/mounts.js#fastTravelCapacity — which
// counts the rider, so a horse's 2 seats are one saddle for you and one for
// somebody else. Past them the card is dashed, because a party over the seats
// costs the extra crossing the mount buys and nothing else. On foot there are
// no seats at all and none of that language draws: walking any number of
// people has never cost anything and still doesn't.
//
// RIDING is the other half: a passenger cannot lead a party of their own
// (db/lib/escort.js#escortAuthority — a passenger picking up followers of
// their own left an orphaned sub-party nobody's move ever walked). So while
// `data.riding` is set, this draws who you're being brought along WITH
// instead of a "Bring somebody" picker — there is nothing here for you to
// drive.

// The same minute HereList polls on, and for the same reason: somebody
// walking up to you has to appear without a reload.
const PARTY_POLL_MS = 60_000;

function seatLine(seats, size) {
  if (seats <= 0) return null;
  const over = size + 1 > seats;
  return {
    label: `${seats} seats`,
    over,
    warning: over
      ? `You have more people than your mount can support (${seats} seats), so you lose the extra free zone move.`
      : null,
  };
}

export default function PartyRack() {
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    loadParty()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't see who's with you." });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useVisiblePoll(reload, PARTY_POLL_MS);

  if (!data?.ok) {
    // Silent while it loads, and silent on failure: this panel is an
    // affordance, not a reading, and an error line here would sit under the
    // place card forever for a player who has nobody to bring anyway.
    return data?.error ? (
      <div className="chat-party">
        <p className="group-label chat-section-title">Bringing</p>
        <FormError>{data.error}</FormError>
      </div>
    ) : null;
  }

  const { party, candidates, incoming, seats, riding } = data;
  // Only the people you have NOT already got. The rack shows the party; the
  // picker shows who else is standing here.
  const pickable = candidates.filter((c) => !c.attached);
  const seat = seatLine(seats, party.length);

  // Nothing to draw and nothing to offer — no empty panel under the place
  // card for somebody standing alone in a field. Riding always draws: being
  // brought along is exactly the thing this panel exists to say.
  if (!riding && party.length === 0 && pickable.length === 0 && incoming.length === 0) return null;

  return (
    <div className="chat-party">
      {riding ? (
        <>
          <p className="group-label chat-section-title">With {riding.leaderName}</p>
          {riding.companions.length > 0 && (
            <p className="text-sm text-muted">
              Also along: {riding.companions.map((c) => c.name).join(", ")}
            </p>
          )}
        </>
      ) : (
        <p className="group-label chat-section-title">
          Bringing · {party.length}
          {seat && <span className="text-muted"> · {seat.label}</span>}
        </p>
      )}

      {/* An ask aimed at YOU. The Accept and Cancel on the Discord DM are
          unreachable for a player who never opens Discord, and this panel is
          already on screen. */}
      {incoming.map((offer) => (
        <div key={offer.id} className="chat-party-ask">
          <p className="text-sm">{offer.from} wants to take you along.</p>
          <div className="chat-buttons">
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => run(answerEscort, { offerId: offer.id, accept: true }, { onOk: reload })}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={() => run(answerEscort, { offerId: offer.id, accept: false }, { onOk: reload })}
            >
              Cancel
            </button>
          </div>
        </div>
      ))}

      {!riding && party.length > 0 && (
        <div className="equip-slots party-slots">
          {party.map((person, index) => (
            <div
              key={person.id}
              className="equip-slot party-slot"
              // Past the mount's seats. Dashed and in the accent, which is
              // how the rest of the app says "this costs you something"
              // (the band's overburden row). Never set on foot, where
              // seats is 0 and there is no bonus to lose.
              data-overflow={seats > 0 && index + 1 >= seats ? "true" : undefined}
            >
              {/* A hood row is keyed by token, never by id — /api/avatar/<id>
                  answers with a face, so shipping one IS the unmasking
                  (PROXYING.md §5). `unknown` draws the question-mark plate. */}
              <CharacterAvatar
                characterId={person.hooded ? null : person.id}
                unknown={Boolean(person.hooded)}
                name={person.name}
                size={24}
                zoomable={!person.hooded}
              />
              <span className="party-slot-name">{person.name}</span>
              {person.reason && <span className="party-slot-why">{person.reason}</span>}
              <button
                type="button"
                className="party-slot-drop"
                aria-label={`Leave ${person.name}`}
                disabled={pending}
                onClick={() => run(putDown, person.id, { onOk: reload })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {!riding && seat?.warning && <p className="chat-quiet-line">⚠ {seat.warning}</p>}

      {!riding && pickable.length > 0 && (
        <>
          <div className="chat-buttons">
            <button
              type="button"
              className="btn-quiet"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Done" : "Bring somebody"}
            </button>
          </div>
          {open && (
            <div className="chip-row" role="group" aria-label="Bring somebody">
              {pickable.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="chip"
                  // The METAGAMING rule (HereList.js): nothing here is greyed
                  // for a fact about the person it names. "ask" is not a
                  // refusal — it says a living person gets a say, which every
                  // living person does, and reveals nothing about them.
                  title={person.verdict === "ASK" ? "They'd have to agree" : (person.reason ?? undefined)}
                  disabled={pending}
                  onClick={() => run(bringAlong, person.id, { onOk: reload })}
                >
                  {person.name}
                  {person.verdict === "ASK" && <span className="text-muted"> · ask</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <FormError>{error}</FormError>
    </div>
  );
}
