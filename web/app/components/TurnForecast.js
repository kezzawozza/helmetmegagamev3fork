"use client";

import { useState } from "react";
import {
  ATE_MEAL_SLUG,
  FAST_METABOLISM_SLUG,
  HORSE_UPKEEP_COST,
  HUNGERLESS_SLUG,
  UPKEEP_SLUGS,
} from "@lifeweb/db/lib/constants";
import { chainTokens } from "@/lib/tagChains";
import ChipText from "./ChipText";

// What changes when the turn turns, as one wrapping line: the tags that run
// out or become something worse, the crafts and builds that finish, the road
// you arrive at the end of, and whether there is dinner. Every item is derived
// from what the sheet already loaded — nothing here is a second opinion, only
// the turn passes read forward one step (db/lib/tagExpiryPass.js,
// hungerPass.js, horseUpkeepPass.js, craft and structure passes,
// locationTravel.js).
//
// The items read INLINE, separated by · rather than one to a line. As a list
// four short clauses made the box taller than the turn card beside it, for
// four sentences of six words each. Nothing here ends in a full stop for the
// same reason — a period before a separator is noise.
//
// Renders nothing when nothing changes, so a quiet turn costs no space.

// How many read before the fold. Past this the rest hide behind a +N more.
const SHOWN = 3;

export default function TurnForecast({
  tags = [],
  openTurnNumber = null,
  craftProjects = [],
  sitesHere = [],
  resources = 0,
}) {
  const [open, setOpen] = useState(false);
  if (openTurnNumber == null) return null;
  const items = [];

  // A tag on its last turn: either it simply ends, or its chain says what it
  // turns into (TAGS.md §5c). expiresTurn is the absolute turn it is swept
  // after, so equal to the open turn means "this close".
  for (const ct of tags) {
    if (ct.expiresTurn !== openTurnNumber) continue;
    const becomes = chainTokens(ct.tag?.expiresInto);
    items.push(
      <span key={`tag-${ct.tag.id}`}>
        {becomes ? (
          <>
            {ct.tag.name} → <ChipText text={becomes} />
          </>
        ) : (
          `${ct.tag.name} ends`
        )}
      </span>,
    );
  }

  // Work that lands at the close: one more turn's progress takes it over the
  // line (db/lib/structures.js counts the same way).
  for (const p of craftProjects) {
    if (p.turnsDone + 1 >= p.turnsNeeded) {
      items.push(
        <span key={`project-${p.id}`}>{`${p.quantity > 1 ? `${p.quantity}× ` : ""}${p.tagName} is finished`}</span>,
      );
    }
  }
  for (const s of sitesHere) {
    if (s.status === "UNDER_CONSTRUCTION" && s.turnsDone + 1 >= s.turnsNeeded) {
      items.push(<span key={`site-${s.id}`}>{`${s.typeName} is finished`}</span>);
    }
  }


  // The horse's feed (and every other UPKEEP_SLUGS animal, e.g. the
  // Arelitz), the way horseUpkeepPass.js settles it: 1 ⬢ per species held,
  // billed separately — read straight off the same list the real pass uses,
  // so a future addition to UPKEEP_SLUGS shows up here with no second edit.
  const held = new Set(tags.map((ct) => ct.tag?.slug));
  const heldUpkeepCount = UPKEEP_SLUGS.filter((slug) => held.has(slug)).length;
  const horseCost = heldUpkeepCount * HORSE_UPKEEP_COST;

  // Dinner, the way db/lib/hungerPass.js settles it: Hungerless owes nothing,
  // a meal already eaten covers it, otherwise the flat 1 ⬢ (2 with Fast
  // Metabolism) — and under the full cost you pay nothing and go Hungry. The
  // horse's feed is billed before Hunger (TURN-ENGINE.md §7d) so it folds
  // into the same total here.
  if (!held.has(HUNGERLESS_SLUG) && !held.has(ATE_MEAL_SLUG)) {
    const dinnerCost = held.has(FAST_METABOLISM_SLUG) ? 2 : 1;
    const totalCost = horseCost + dinnerCost;
    items.push(
      <span key="dinner">{resources >= totalCost ? `You'll consume ${totalCost} ⬢` : "You'll go hungry"}</span>,
    );
  } else if (horseCost > 0) {
    // Hungerless, or already fed — Dinner is skipped, but the horse still eats.
    items.push(
      <span key="horse-upkeep">
        {resources >= horseCost
          ? `Your ${heldUpkeepCount > 1 ? "animals" : "animal"} will consume ${horseCost} ⬢`
          : "You can't feed your animal"}
      </span>,
    );
  }

  if (items.length === 0) return null;

  // Whether to fold is a count, never a measurement of the rendered box —
  // measuring means writing state from a layout effect, which this repo makes
  // an error. ExpandableText.js takes the same way out for the same reason.
  const folded = items.length > SHOWN && !open;
  const shown = folded ? items.slice(0, SHOWN) : items;

  return (
    <div className="ledger-turn">
      <span className="field-label">Turn Effects</span>
      <div className="sheet-forecast">
        {/* The separator LEADS its item and shares a box with it, so a wrap
            can never leave a · dangling at the end of a line. It is also
            decoration: a reader hearing "middle dot" between every clause is
            worse off than one hearing nothing. */}
        {shown.map((item, i) => (
          <span key={item.key}>
            {i > 0 && <span aria-hidden="true">·</span>}
            {item}
          </span>
        ))}
        {items.length > SHOWN && (
          <button type="button" className="btn-quiet" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Less" : `+${items.length - SHOWN} more`}
          </button>
        )}
      </div>
    </div>
  );
}
