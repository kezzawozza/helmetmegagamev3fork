"use client";

import TagChip from "@/app/components/TagChip";

// What is true of this body right now: what you carry, and every Status or
// Health tag worn. Category test is the SHEET's own (web/lib/sheetCards.js).
const SHOWN_CATEGORIES = new Set(["Status", "Health"]);

// Literals, not an import: db/lib/constants.js is a server module.
const BAD = new Set(["overburdened", "dying", "catatonic-afk"]);

// `onPick` makes each chip a button (the sheet's band opens details inline,
// LedgerBand.js); Chat keeps plain chips. `meter` draws the load bar — Chat
// opts in, the sheet doesn't since its Carrying tile already draws it.
// `numbers` is the same opt-out: the sheet's tiles already show Resources/Carrying, Chat has none.
export default function StatusStrip({
  resources = 0,
  carry = null,
  tags = [],
  onPick = null,
  pickedId = null,
  meter = false,
  numbers = true,
  // So an expiring affliction can say turns left; absent, the badge just isn't drawn.
  currentTurn = null,
}) {
  const worn = tags.filter((ct) => SHOWN_CATEGORIES.has(ct.tag?.category));
  // Sheet's own arithmetic: floor of 1 under the cap, so a capless character can't divide by zero.
  // ⬢ no longer carries its own cap — it is a one-pound item now, weighed in
  // beside the gear (db/lib/carry.js), so the single weight cap covers it.
  const over = Boolean(carry && carry.weightUsed > carry.weightCap);
  const loadPct = carry
    ? Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))
    : 0;

  return (
    <>
      <div className="chat-chips">
        {/* The ⬢ chip has no cap to redden for — ⬢ weigh a pound each and
            count on the Carrying chip beside it, which is the one that warns. */}
        {numbers && (
          <span className="chip chip-mono">
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
          // SHEET (onPick set): button, details open inline (LedgerBand.js).
          // CHAT: nowhere to open inline, so a real tag chip with hover details.
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
        /* The sheet's meter, reused whole. role="img" with numbers spelled out for screen readers. */
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
