"use client";

import TagChip from "@/app/components/TagChip";

// What is true of this body right now, in one wrapping row: what you are
// carrying, and every Status or Health tag you are wearing.
//
// The category test is the SHEET's own (web/lib/sheetCards.js groups on the
// same field), so a new affliction shows up here the day it is added to
// docs/tags.yaml without anybody listing it twice.
const SHOWN_CATEGORIES = new Set(["Status", "Health"]);

// The three that are not news but a problem. Their slugs are literals rather
// than an import, because db/lib/constants.js is a server module and this is
// the browser's copy of three strings.
const BAD = new Set(["overburdened", "dying", "catatonic-afk"]);

// `onPick` turns each tag chip into a button: the sheet's band passes it and
// opens the tag's details inline underneath (LedgerBand.js), so nothing here
// has to be hovered to be read. Chat passes nothing and keeps plain chips.
//
// `meter` draws the load bar under the chips. Chat opts in; the sheet does not,
// because its Carrying tile already draws the same meter off the same numbers
// (LedgerBand.js), and two of them on one screen is one too many. The bar says
// what the chip cannot: how close you are, rather than how much you have. A
// player who has to divide 63 by 71 to see Overburdened coming finds out by
// being told instead, which is too late to put anything down.
//
// `numbers` is the same opt-out one step further, and for the same reason.
// The sheet's band draws Resources and Carrying as tiles a few inches away,
// with the caps and the meter the chips can only half-say, so it turns the
// two leading chips off and keeps this row for what is actually worn. Chat
// has no tiles, so it keeps them.
export default function StatusStrip({
  resources = 0,
  carry = null,
  tags = [],
  onPick = null,
  pickedId = null,
  meter = false,
  numbers = true,
  // Only so an expiring affliction can say how many turns are left on it —
  // the same badge the sheet's own chips wear. Absent is fine; the badge is
  // simply not drawn.
  currentTurn = null,
}) {
  const worn = tags.filter((ct) => SHOWN_CATEGORIES.has(ct.tag?.category));
  // The sheet's own arithmetic, to the pixel: the same clamp at 100 and the
  // same floor of 1 under the cap, so a character with no cap at all cannot
  // divide by zero.
  const over = Boolean(carry && carry.weightUsed > carry.weightCap);
  const overResources = Boolean(carry && carry.resources > carry.resourcesCap);
  const loadPct = carry
    ? Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))
    : 0;

  return (
    <>
      <div className="chat-chips">
        {/* Each chip reddens for its OWN cap. `carry.over` is the two of them
            ORed together, so a character over on Resources used to turn the
            POUNDS chip red — and now that a load bar sits under that chip, a
            red number over an unfilled bar would be a straight contradiction. */}
        {numbers && (
          <span className="chip chip-mono" data-tone={overResources ? "danger" : undefined}>
            {resources} ⬢
          </span>
        )}
        {numbers && carry && (
          <span className="chip chip-mono" data-tone={over ? "danger" : undefined}>
            {Math.round(carry.weightUsed)}/{carry.weightCap} lb
          </span>
        )}
        {worn.map((ct) => {
          const id = ct.tag.id ?? ct.tagId;
          const tone = BAD.has(ct.tag.slug) ? "danger" : undefined;
          // On the SHEET (onPick set) the chip is a button and the details
          // open inline underneath it — LedgerBand.js draws the same
          // TagDetails block, so nothing here has to be hovered to be read.
          // In CHAT there is nowhere to open inline, so the chip is the app's
          // real tag chip and the details come on hover: group colour, how
          // long it lasts, what cures it. It used to be a bare span with a
          // native `title` of the description, which is the one place a player
          // most needs the whole row rather than one sentence.
          return onPick ? (
            <button
              key={id}
              type="button"
              className="chip"
              data-tone={tone}
              data-active={pickedId === id ? "true" : undefined}
              aria-expanded={pickedId === id}
              onClick={() => onPick(ct)}
            >
              {ct.tag.name}
              {(ct.quantity ?? 1) > 1 ? ` ×${ct.quantity}` : ""}
            </button>
          ) : (
            <TagChip
              key={id}
              tag={ct.tag}
              quantity={ct.quantity ?? 1}
              expiresTurn={ct.expiresTurn ?? null}
              currentTurn={currentTurn}
              tone={tone}
            />
          );
        })}
      </div>
      {meter && carry && (
        /* The sheet's meter, reused whole (.depot-meter / .depot-meter-fill).
           role="img" with the numbers spelled out, because a bare bar tells a
           screen reader nothing the chip above has not already said better. */
        <div
          className="depot-meter chat-load"
          role="img"
          aria-label={`${Math.round(carry.weightUsed)} of ${carry.weightCap} pounds carried`}
        >
          <span
            className="depot-meter-fill"
            data-tone={over ? "danger" : undefined}
            style={{ width: `${loadPct}%` }}
          />
        </div>
      )}
    </>
  );
}
