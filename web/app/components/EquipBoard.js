"use client";

import { useRef, useState, useTransition } from "react";
import {
  LAYER_NAMES,
  MAX_ACCESSORIES,
  SLOT_TITLES,
  handsFor,
  handsOf,
  handsUsed,
} from "@lifeweb/db/lib/equipSlots";
import {
  BOAT_CONFLICT_SLUGS,
  FAST_TRAVEL_SLUGS,
  STOWABLE_SLUGS,
  WATER_TRAVEL_SLUGS,
} from "@lifeweb/db/lib/mounts";
import { armorWord, combineArmor } from "@lifeweb/db/lib/armorValue";
import { formatTagWeight } from "@/lib/formatTagWeight";
import { carryBonusLabel } from "@/lib/sheetCards";
import { equipOne, takeAndEquip, unequipOne } from "@/app/(app)/character/equipActions";
import ClickMenu from "./ClickMenu";
import FormError from "./FormError";

// The rig: what is worn, drawn as the slots it is worn in (TAGS.md,
// "equipSlot"). One row per slot, one cell per place a thing can go — three
// head layers, three body layers, four hands, a ride and what it tows, and up
// to MAX_ACCESSORIES accessories. A filled cell names the thing and the one
// fact about it worth a glance; an empty cell is dashed and named, and
// clicking it lists what you carry that fits there — and, since 2026-09-10,
// what is sitting in a room stash here that fits there too. A player asked for
// that one directly: "If I'm in a room with stuff stored in it, I should be
// able to click on this and see what I can take from that room that would fit
// in this slot." Picking a stash row takes it and wears it in one gesture.
//
// A slot holds one PHYSICAL unit, not a stack — CharacterTag.equippedQuantity
// says how many of a held stack are out, so a cell here is one unit of it,
// not the row. Equipping and unequipping move that number by one at a time
// (equipOne/unequipOne, character/equipActions.js), and the server's refusal
// — a second helm, a fifth hand — lands in FormError under the board. No
// tooltips on this surface.

// Cell counts come from equipSlots.js rather than being written out again: a
// layered slot has one cell per layer name, and anything but the hands holds
// exactly one.
//
// The hands are a function rather than a constant because a maiming takes
// them away (Tag.handsLost) — a one-armed character's board draws two cells,
// not four with two of them permanently dashed and empty, which would have
// read as room they do not have.
function rowsFor(hands) {
  return ["HEAD", "BODY", "WEAPON", "MOUNT"].map((slot) => ({
    slot,
    cells: LAYER_NAMES[slot]?.length ?? (slot === "WEAPON" ? hands : 1),
  }));
}

// One row per PHYSICAL unit a CharacterTag row has equipped, not one per row
// — a stack with equippedQuantity 3 draws three cells. Each unit still points
// back at its own row (`ct`), since that row's id is what equipOne/unequipOne
// act on; units of one stack are fungible, so which one a click names never
// matters (equipActions.js#unequipOne).
function equippedUnits(rows) {
  return rows.flatMap((ct) => {
    const n = ct.equippedQuantity ?? 0;
    return Array.from({ length: Math.max(0, n) }, (_, i) => ({ ct, tag: ct.tag, key: `${ct.id}-${i}` }));
  });
}

// The one line under a worn thing's name.
function fact(tag) {
  const melee = tag.meleeArmor ?? 0;
  const ballistic = tag.ballisticArmor ?? 0;
  if (melee || ballistic) return `${armorWord(melee)} · ${armorWord(ballistic)}`;
  if (tag.concealsIdentity) return "conceals you";
  const carry = carryBonusLabel(tag.carryBonus);
  if (carry) return carry;
  return formatTagWeight(tag) ?? null;
}

// The MOUNT row's menu. equipActions.js refuses more than the slot rule does —
// a cart or a mount is not set up indoors, a boat and a road kit are never out
// at once, and Motion Sickness rules out riding at all — so offering those and
// then failing them is a worse menu than one that leaves them out and says
// why. Everything else on the board is filtered on the slot alone, because the
// slot really is the whole rule there.
function mountMenu(fits, wornRows, { indoors, motionSick }) {
  const out = new Set(wornRows.map((ct) => ct.tag.slug));
  const boatOut = [...WATER_TRAVEL_SLUGS].some((slug) => out.has(slug));
  const rideOut = [...BOAT_CONFLICT_SLUGS].some((slug) => out.has(slug));
  const why = new Set();
  const options = fits.filter((ct) => {
    const slug = ct.tag.slug;
    if (indoors && STOWABLE_SLUGS.has(slug)) {
      why.add("there is no setting one up indoors");
      return false;
    }
    if (motionSick && (FAST_TRAVEL_SLUGS.has(slug) || WATER_TRAVEL_SLUGS.has(slug))) {
      why.add("your stomach won't have it");
      return false;
    }
    if ((boatOut && BOAT_CONFLICT_SLUGS.has(slug)) || (rideOut && WATER_TRAVEL_SLUGS.has(slug))) {
      why.add("you are either riding or poling");
      return false;
    }
    return true;
  });
  const note = why.size
    ? `Some of what you carry isn't offered here: ${[...why].join("; ")}.`
    : null;
  return { options, note };
}

// "Nothing here fits." / "Nothing here or in the Chest fits." The rooms are
// named so a player can tell an empty menu from one that never looked — the
// board searches a stash only when the character can actually open it, and
// silence about that would read as a bug on the one turn it matters.
function nothingFits(searched) {
  if (!searched.length) return "Nothing you carry fits here.";
  return `Nothing you carry or in ${listRooms(searched)} fits here.`;
}

function listRooms(names) {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// A dashed, named empty place. Its click menu lists the carried things that
// fit; nothing fits and it says so. `note` is the MOUNT row's reason for
// having left something out — never a silent omission. A row with room left
// in a partly-equipped stack still offers it here, alongside whatever else is
// carried — Equip pulls one more unit out, same gesture either way.
function EmptyCell({
  label,
  options,
  onPick,
  pending,
  span = 1,
  note = null,
  state = "empty",
  // The rooms the options were gathered from, so "nothing fits" can say where
  // it looked. Empty when the character is standing nowhere with a stash.
  searched = [],
}) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div
      className="equip-cell is-empty"
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
    >
      <button
        ref={ref}
        type="button"
        className="equip-cell-face"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="equip-cell-name text-muted">{label}</span>
        {state && <span className="equip-cell-fact text-muted">{state}</span>}
      </button>
      {open && (
        <ClickMenu triggerRef={ref} onClose={() => setOpen(false)} ariaLabel={label}>
          {options.length === 0 && !note ? (
            <span className="chat-quiet-line">{nothingFits(searched)}</span>
          ) : (
            options.map((ct, i) => (
              <button
                key={ct.id}
                type="button"
                role="menuitem"
                className="menu-item"
                // A rule where the carried things stop and the room's begin,
                // rather than a heading nobody needs: the row already names
                // its room.
                data-rule={i > 0 && ct.stash && !options[i - 1].stash ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  onPick(ct);
                }}
              >
                {ct.tag.name}
                {ct.tag.twoHanded ? " (two hands)" : ""}
                {ct.stash ? <span className="text-muted"> · {ct.roomName}</span> : null}
              </button>
            ))
          )}
          {note && <span className="chat-quiet-line">{note}</span>}
        </ClickMenu>
      )}
    </div>
  );
}

// One physical unit, worn. Not the row's total `quantity` — a cell is a
// single thing, and showing the whole stack's count on it read as though
// equipping one equipped all of them.
function WornCell({ unit, onUnequip, pending, span = 1, canAct }) {
  const line = fact(unit.tag);
  return (
    <div className="equip-cell" style={span > 1 ? { gridColumn: `span ${span}` } : undefined}>
      <div className="equip-cell-face">
        <span className="equip-cell-name">{unit.tag.name}</span>
        {line && <span className="equip-cell-fact text-muted">{line}</span>}
      </div>
      {canAct && (
        <button
          type="button"
          className="equip-cell-off"
          disabled={pending}
          onClick={onUnequip}
          aria-label={`Unequip ${unit.tag.name}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function EquipBoard({
  characterTags,
  isSelf,
  indoors = false,
  motionSick = false,
  // Every room stash at this Location the character can actually open, from
  // the same loader the Transfer dialog reads (web/lib/peoplePools.js), so a
  // locked door is absent here for exactly the reason it is absent there.
  // Never passed for somebody else's sheet: the board only acts when isSelf.
  stash = [],
  // { weightUsed, weightCap, … } from db/lib/carry.js, for the line at the foot
  // of the board. The band's Carrying tile shows the same two numbers; this
  // repeats them because the board above is what CHANGES them, and taking a
  // coat off to get under the cap should not mean scrolling back up to check.
  carry = null,
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  const equippable = characterTags.filter((ct) => ct.tag.equippable);
  const wornRows = equippable.filter((ct) => (ct.equippedQuantity ?? 0) > 0);
  // What still has room to come out — a partly-equipped stack (2 of 5 out)
  // still offers the other 3 wherever it fits, alongside whatever else is
  // carried.
  const carried = equippable.filter((ct) => (ct.quantity ?? 1) - (ct.equippedQuantity ?? 0) > 0);
  const worn = equippedUnits(wornRows);

  // The room's equippables, in the shape the cells already expect: an id, a
  // `.tag`, and a flag saying which of the two pick paths to take. The id is
  // namespaced because a stash row and a carried row can be the same tag, and
  // React keys and menu clicks both have to tell them apart.
  const stashOffers = isSelf
    ? stash.flatMap((room) =>
        (room.tags ?? [])
          .filter((rt) => rt.tag?.equippable)
          .map((rt) => ({
            id: `stash:${room.id}:${rt.tagId}`,
            tag: rt.tag,
            stash: true,
            roomId: room.id,
            roomName: room.name,
            tagId: rt.tagId,
          })),
      )
    : [];
  const searched = stashOffers.length ? [...new Set(stashOffers.map((o) => o.roomName))] : [];

  // Carried first, then the room's. Ordering is the whole grouping: what you
  // already have costs nothing to put on, and what is in a box costs a
  // transfer everybody in the room hears about.
  function offersFor(predicate) {
    return [...carried.filter(predicate), ...stashOffers.filter(predicate)];
  }

  function equip(ct) {
    if (!isSelf || !ct.id) return;
    setError(null);
    startTransition(async () => {
      try {
        // Out of a box: one gesture, two acts. takeAndEquip files the transfer
        // through the ordinary path — so the audit row and the room's own
        // "someone takes a Padded Cap" line both still happen — and then wears
        // it. A refusal on the wearing half leaves it in your pack, which is
        // recoverable and is what the sentence below says.
        const res = ct.stash
          ? await takeAndEquip({ roomId: ct.roomId, tagId: ct.tagId })
          : await equipOne(ct.id);
        if (res?.error) setError(res.error);
      } catch {
        setError("Could not reach the server. Nothing was changed.");
      }
    });
  }

  function unequip(ct) {
    if (!isSelf || !ct.id) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await unequipOne(ct.id);
        if (res?.error) setError(res.error);
      } catch {
        setError("Could not reach the server. Nothing was changed.");
      }
    });
  }

  const melee = combineArmor(wornRows, "meleeArmor");
  const ballistic = combineArmor(wornRows, "ballisticArmor");
  const hands = handsUsed(wornRows);
  // What this character HAS, not what a whole person has.
  const handCap = handsFor(characterTags);
  const rows = rowsFor(handCap);
  const freeHands = Math.max(0, handCap - hands);

  // Nothing on you AND nothing in a box you can open. The stash half matters:
  // a character who put their whole kit in the Armoury used to get this dead
  // end, which is the exact person the room menu exists for.
  if (equippable.length === 0 && stashOffers.length === 0) {
    return (
      <section className="panel p-3">
        <h2 className="panel-header">Equipment</h2>
        <p className="text-sm text-muted">
          You&apos;re not carrying anything that can be worn or readied.
        </p>
      </section>
    );
  }

  return (
    <section className="panel p-3 equip-board">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-header">Equipment</h2>
        {/* What the rig comes to, in the header, the way the mockup draws it:
            the shield mark and the word, twice, melee then ballistic. */}
        <span className="text-sm text-muted">
          <span aria-hidden="true">⛊</span> {armorWord(melee)} · <span aria-hidden="true">⛊</span>{" "}
          {armorWord(ballistic)}
        </span>
      </div>

      {rows.map(({ slot, cells }) => {
        const inSlot = worn.filter((unit) => unit.tag.equipSlot === slot);
        const fits = offersFor((ct) => ct.tag.equipSlot === slot);
        const layered = Boolean(LAYER_NAMES[slot]);
        let drawn;
        if (layered) {
          drawn = Array.from({ length: cells }, (_, i) => {
            const layer = i + 1;
            const unit = inSlot.find((row) => row.tag.equipLayer === layer);
            const label = `${LAYER_NAMES[slot][i]}`;
            return unit ? (
              <WornCell
                key={unit.key}
                unit={unit}
                onUnequip={() => unequip(unit.ct)}
                pending={pending}
                canAct={isSelf}
              />
            ) : (
              <EmptyCell
                key={`${slot}-${layer}`}
                label={label}
                options={fits.filter((row) => row.tag.equipLayer === layer)}
                onPick={equip}
                pending={pending}
                searched={searched}
              />
            );
          });
          // Anything worn at a layer this row has no cell for still gets one,
          // on the end. The catalog is the only thing that says how deep a
          // slot goes, and the catalog is synced separately from the code
          // (TAGS.md) — so between a deploy and its `db:sync-tags` a helm can
          // be worn at a layer that no longer exists. Drawing only the named
          // layers would leave it on the character's head with nothing to
          // take it off with.
          for (const unit of inSlot) {
            const layer = unit.tag.equipLayer;
            if (Number.isInteger(layer) && layer >= 1 && layer <= cells) continue;
            drawn.push(
              <WornCell
                key={unit.key}
                unit={unit}
                onUnequip={() => unequip(unit.ct)}
                pending={pending}
                canAct={isSelf}
              />,
            );
          }
        } else if (slot === "WEAPON") {
          drawn = inSlot.map((unit) => (
            <WornCell
              key={unit.key}
              unit={unit}
              span={handsOf(unit.tag)}
              onUnequip={() => unequip(unit.ct)}
              pending={pending}
              canAct={isSelf}
            />
          ));
          if (freeHands > 0) {
            drawn.push(
              <EmptyCell
                key="hands-free"
                label={freeHands === 1 ? "One slot" : `${freeHands} slots`}
                state={null}
                span={freeHands}
                options={fits.filter((row) => handsOf(row.tag) <= freeHands)}
                onPick={equip}
                pending={pending}
                searched={searched}
              />,
            );
          }
        } else {
          const menu =
            slot === "MOUNT"
              ? mountMenu(fits, wornRows, { indoors, motionSick })
              : { options: fits, note: null };
          // One cell, and one thing in it — but draw EVERY unit actually worn
          // here, not just the first. An unlayered slot holds one piece by
          // rule, and a character can still be wearing two against that rule:
          // HEAD stopped being layered, so anyone in a mask under a hood is
          // over its limit until the cleanup pass reaches them
          // (db/scripts/ops/collapse-equip-slots.js). Drawing inSlot[0] alone
          // would leave the second piece on their head with no ✕ to take it
          // off — the same trap the layered branch's stray-layer loop above
          // exists to avoid, and the worse one here, because a pre-existing
          // clash refuses every unrelated equip they try afterwards
          // (db/lib/equipSlots.js#findSlotClash).
          drawn = inSlot.length
            ? inSlot.map((unit) => (
              <WornCell
                key={unit.key}
                unit={unit}
                onUnequip={() => unequip(unit.ct)}
                pending={pending}
                canAct={isSelf}
              />
            ))
            : [
              <EmptyCell
                key={slot}
                label={SLOT_TITLES[slot]}
                options={menu.options}
                note={menu.note}
                onPick={equip}
                pending={pending}
                searched={searched}
              />,
            ];
        }
        // A ride nobody owns is not worth a row of dashes.
        if (slot === "MOUNT" && inSlot.length === 0 && fits.length === 0) return null;
        return (
          <div key={slot} className="equip-row">
            <span className="field-label equip-row-title">
              <span>{SLOT_TITLES[slot]}</span>
              {/* The one hint about how the slot fills, on the right of the
                  row's own line — "Mail, then Over", "4 hands", "one thing".
                  Named layers come from equipSlots.js rather than being written
                  out again here, so a slot that gains a layer says so. */}
              <span className="equip-row-hint">
                {slot === "WEAPON" ? (
                  <span className="mono" data-over={hands > handCap ? "true" : undefined}>
                    {hands}/{handCap} hands
                  </span>
                ) : LAYER_NAMES[slot] ? (
                  LAYER_NAMES[slot].join(", then ")
                ) : (
                  "one thing"
                )}
              </span>
            </span>
            {/* The slot's own cells, widened to whatever actually had to be
                drawn — a stray layer on a layered row, or a second piece in an
                unlayered slot somebody is over the limit of. WEAPON is the
                exception and keeps its own count, because a two-hander's cell
                SPANS two of them rather than adding one. */}
            <div
              className="equip-cells"
              style={{
                gridTemplateColumns: `repeat(${slot === "WEAPON" ? cells : Math.max(cells, drawn.length)}, minmax(0, 1fr))`,
              }}
            >
              {drawn}
            </div>
            {/* A character who filled their hands before the hand rule
                existed can equip nothing at all until they put something
                down, and the refusal they would otherwise meet arrives from
                the server on an unrelated click. Say it here instead. */}
            {slot === "WEAPON" && hands > handCap && (
              <span className="chat-quiet-line">
                You are holding more than {handCap} hands&apos; worth — put something away
                before you ready anything else.
              </span>
            )}
          </div>
        );
      })}

      {(() => {
        const inSlot = worn.filter((unit) => unit.tag.equipSlot === "ACCESSORY");
        const fits = offersFor((ct) => ct.tag.equipSlot === "ACCESSORY");
        if (inSlot.length === 0 && fits.length === 0) return null;
        return (
          <div className="equip-row">
            <span className="field-label equip-row-title">
              <span>{SLOT_TITLES.ACCESSORY}</span>
              {/* Counted like the hands above, and for the same reason: this
                  row is the one that used to take everything, so the number is
                  what tells a player it no longer does. `data-over` covers a
                  character who was already over the cap when it came in. */}
              <span className="equip-row-hint">
                <span
                  className="mono"
                  data-over={inSlot.length > MAX_ACCESSORIES ? "true" : undefined}
                >
                  {inSlot.length}/{MAX_ACCESSORIES}
                </span>
              </span>
            </span>
            <div className="equip-cells equip-cells-wrap">
              {inSlot.map((unit) => (
                <WornCell
                  key={unit.key}
                  unit={unit}
                  onUnequip={() => unequip(unit.ct)}
                  pending={pending}
                  canAct={isSelf}
                />
              ))}
              {isSelf && fits.length > 0 && inSlot.length < MAX_ACCESSORIES && (
                <EmptyCell
                  label="Add"
                  options={fits}
                  onPick={equip}
                  pending={pending}
                  searched={searched}
                />
              )}
            </div>
          </div>
        );
      })()}

      {/* Whatever is carried and fits nowhere drawn above: a slotless custom
          tag. Still equippable, still one click — one cell per equipped unit,
          plus an "equip" cell for the row while it still has room. */}
      {(() => {
        const strayEquipped = worn.filter((unit) => !unit.tag.equipSlot);
        const strayFits = carried.filter((ct) => !ct.tag.equipSlot);
        if (strayEquipped.length === 0 && strayFits.length === 0) return null;
        return (
          <div className="equip-row">
            <span className="field-label equip-row-title">
              <span>Other</span>
            </span>
            <div className="equip-cells equip-cells-wrap">
              {strayEquipped.map((unit) => (
                <WornCell
                  key={unit.key}
                  unit={unit}
                  onUnequip={() => unequip(unit.ct)}
                  pending={pending}
                  canAct={isSelf}
                />
              ))}
              {strayFits.map((ct) => (
                <div key={ct.id} className="equip-cell is-empty">
                  <button
                    type="button"
                    className="equip-cell-face"
                    disabled={pending || !isSelf}
                    onClick={() => equip(ct)}
                  >
                    <span className="equip-cell-name text-muted">{ct.tag.name}</span>
                    <span className="equip-cell-fact text-muted">equip</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* What it all weighs, under a rule at the foot of the board. Same two
          numbers as the band's Carrying tile and the same meter, off the same
          `carry` object — nothing here derives a second opinion. */}
      {carry && (
        <div>
          <div className="sheet-carry-line">
            <span className="field-label">Carrying</span>
            <span className="mono" data-over={carry.weightUsed > carry.weightCap ? "true" : undefined}>
              {carry.weightUsed} / {carry.weightCap} lb
            </span>
          </div>
          <span
            className="sheet-meter"
            data-over={carry.weightUsed > carry.weightCap ? "true" : undefined}
            role="img"
            aria-label={`${carry.weightUsed} of ${carry.weightCap} pounds carried`}
          >
            <span
              style={{
                width: `${Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))}%`,
              }}
            />
          </span>
        </div>
      )}

      <FormError>{error}</FormError>
    </section>
  );
}
