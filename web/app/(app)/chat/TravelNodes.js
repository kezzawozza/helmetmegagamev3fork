"use client";

import { useCallback, useEffect, useState } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import useActionRunner from "@/app/components/useActionRunner";
import ChipLabel from "@/app/components/ChipLabel";
import { useTags } from "@/app/components/TagsProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { crossingConfirm, crossingLine, travelFoot, walkFoot, walkLine, openedByLabel } from "@/lib/travelCost";
import { loadTravel, travelTo } from "./actions";

// TRAVEL: every way out of here as a node you can see. Loaded on mount and
// after a move, never with the page — an exit's state moves under a player
// standing still. Cost line follows MAP.md §3; travelFoot()
// (web/lib/travelCost.js, shared with /map) marks a dismount as "· on foot"
// or "· indoors". Nothing that refuses is hidden — a shut/locked way draws
// dimmed with the reason, so a player can go find the winch.

// The whole of it, for the hover — the node clamps name/description. `via` is
// the tag that opens the way; the node's chip can only carry the name.
function titleFor(option, via) {
  if (!option.passable) return option.reason ?? option.name;
  const head = option.description ? `${option.name} — ${option.description}` : option.name;
  return via ? `${head}\n${openedByLabel(via.name)}` : head;
}

// `pick` is `/travel` reaching in from the composer: { locationId, at }, `at`
// a timestamp so picking the same node twice re-opens the strip. It only ever
// SELECTS — Go still moves anybody's feet.
export default function TravelNodes({ onDone, pick = null }) {
  // Catalog + held tags from the root layout (web/lib/referenceData.js) — openedBy always resolves.
  const { tagsBySlug } = useTags();
  // A move changes the whole column (place card, HERE, rooms) as server props
  // off page.js, so reloading only this list would leave the rest stale.
  const [refresh] = useRefresh();
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [target, setTarget] = useState(null);
  // Setting state DURING render, per React's own pattern and
  // react-hooks/set-state-in-effect. Keyed on `at`, not id, so re-picking the
  // same node after cancelling still opens the strip.
  const [tookPick, setTookPick] = useState(null);
  if (pick?.at && pick.at !== tookPick) {
    setTookPick(pick.at);
    setTarget(pick.locationId ?? null);
  }
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    loadTravel()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't read the road." });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  if (!data) {
    return (
      <div className="chat-travel">
        <p className="chat-section-title">Travel</p>
        <p className="chat-quiet-line">Reading the road…</p>
      </div>
    );
  }
  if (!data.ok) {
    return (
      <div className="chat-travel">
        <p className="chat-section-title">Travel</p>
        <FormError>{data.error}</FormError>
      </div>
    );
  }

  const walks = data.walks ?? [];
  // Picked out of either list. A walk carries no crossing and no cost, so the
  // strip below reads its own sentence and never the crossing one.
  const chosen = target
    ? (data.options.find((o) => o.id === target) ?? walks.find((w) => w.id === target) ?? null)
    : null;
  const walking = Boolean(chosen && walks.some((w) => w.id === chosen.id));
  // chosen's OWN count, not the header's ambient one — a boat's bonus is
  // earned per crossing.
  const nextTurn = Boolean(chosen?.crossesZone && chosen.freeLeft <= 0);

  // Travel, in one place. Go is the only door onto it, the way the map's is
  // (MAP.md §6c) — clicking a node only ever picks it.
  //
  // A zone crossing stops here and asks again, in the shared dialog. It is the
  // one move that spends something, carries whoever is with you, and cannot be
  // walked back for free.
  //
  // Push on is the same door with a die in it (MAP.md §3): its own confirm,
  // then the same action with `exert` set.
  const go = async (option, { exert = false } = {}) => {
    if (option.crossesZone) {
      const asked = crossingConfirm(option, option.freeLeft, data.partySize, { exert });
      if (!(await confirm(asked))) return;
    }
    run(travelTo, { locationId: option.id, exert }, {
      onOk: (res) => {
        setTarget(null);
        onDone?.(res);
        reload();
        refresh();
      },
    });
  };

  return (
    <div className="chat-travel">
      <p className="chat-section-title" title={data.freeReason ?? undefined}>
        Travel · {data.freeLeft} available
      </p>

      {/* Held where they stand (INTERCEPT.md). List stays up, every way drawn shut. */}
      {data.held ? <p className="text-sm">{data.held}</p> : null}

      {data.options.length === 0 ? (
        <EmptyState>There is no way out of here.</EmptyState>
      ) : (
        <div className="chat-nodes">
          {data.options.map((option) => {
            const via = option.openedBy ? (tagsBySlug.get(option.openedBy) ?? null) : null;
            return (
            <button
              key={option.id}
              type="button"
              className="chat-node"
              data-crossing={option.crossesZone ? "true" : undefined}
              data-dim={option.passable ? undefined : "true"}
              data-active={target === option.id ? "true" : undefined}
              title={titleFor(option, via)}
              disabled={!option.passable || pending}
              // A click only ever picks; the strip below is the only door to Go.
              // focus() is not redundant: Safari/Firefox on macOS do NOT focus
              // a button on a mouse click, so keyboard tab would otherwise break.
              onClick={(e) => {
                e.currentTarget.focus();
                setTarget(option.id);
              }}
            >
              <span className="chat-node-name">{option.name}</span>
              <span className="chat-node-zone">{option.zoneName}</span>
              {/* Clamped in CSS rather than truncated here; the whole line is on the node's title either way. */}
              {option.description && (
                <span className="chat-node-desc">{option.description}</span>
              )}
              {/* Flat ChipLabel, not TagChip — an interactive chip can't live inside this button. */}
              {via && <ChipLabel tag={via} />}
              <span className="chat-node-foot mono">{travelFoot(option, option.freeLeft, data.mounted, data.moved)}</span>
            </button>
            );
          })}
        </div>
      )}

      {/* Farther in this zone — a walk of several hops (MAP.md §3c). Its own
          heading rather than mixed into the grid above, because that grid means
          "doors out of this room" and a three-hop walk is not one of those.
          Clicking still only picks: the shortcut is the map's, and this panel is
          the surface a stray tap landed on last time. */}
      {walks.length > 0 && (
        <>
          <p className="chat-section-title">Further in {data.zoneName ?? "this zone"}</p>
          <div className="chat-nodes">
            {walks.map((option) => (
              <button
                key={option.id}
                type="button"
                className="chat-node"
                data-active={target === option.id ? "true" : undefined}
                title={option.description ? `${option.name} — ${option.description}` : option.name}
                disabled={pending}
                onClick={(e) => {
                  e.currentTarget.focus();
                  setTarget(option.id);
                }}
              >
                <span className="chat-node-name">{option.name}</span>
                {/* The stops, where there is room for them — the same sentence
                    the strip spells out in full once this is picked. */}
                <span className="chat-node-zone">{option.through.join(" · ")}</span>
                {option.description && <span className="chat-node-desc">{option.description}</span>}
                <span className="chat-node-foot mono">{walkFoot(option, data.mounted)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {chosen && (
        <div className="chat-travel-confirm">
          <p className="text-sm">
            {walking ? walkLine(chosen) : crossingLine(chosen, nextTurn, data.moved)}
          </p>

          {/* Who comes along is the party rack's business now — an escort persists, so only the count is owed here. */}
          {data.partySize > 0 && (
            <p className="chat-quiet-line">
              {data.partySize === 1 ? "One person" : `${data.partySize} people`} with you.
            </p>
          )}

          <FormError>{error}</FormError>
          <div className="chat-buttons">
            {/* Go is the Move. Once it is spent a crossing with no travel
                left has no Go to offer — the server would only refuse it —
                so the button leaves rather than lying (MAP.md §3). */}
            {!(nextTurn && data.moved) && (
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => go(chosen)}
              >
                Go
              </button>
            )}
            {/* The other way across once the travels and the Move are gone:
                on a die. Only drawn where the server would say yes —
                canExert is its refusal, asked ahead of time. */}
            {nextTurn && chosen.canExert && (
              <button
                type="button"
                className="btn"
                disabled={pending}
                title="Exert yourself for another free travel."
                onClick={() => go(chosen, { exert: true })}
              >
                Push on
              </button>
            )}
            <button type="button" className="btn-quiet" disabled={pending} onClick={() => setTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
