"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import QuantityField from "@/app/components/QuantityField";
import TagRow from "@/app/components/TagRow";
import ItemCard from "@/app/components/ItemCard";
import { buildCards, itemFacts, matchesQuery, rowValue, INVENTORY_CARDS } from "@/lib/sheetCards";

// The character's actual held tags, always visible in the panel's main body
// — not gated behind the Tags tab, which is add-only now (TagEditor.js).
// Reuses the sheet's own grouping and rows (buildCards/TagRow/ItemCard from
// web/lib/sheetCards.js), the same reuse InspectorColumn.js's SheetView
// already established for the adjudication desk, so a GM reads the same
// cards everywhere a tag list shows up. `includeStatus: true` because this
// panel has no StatusStrip of its own — without it a Catatonic or Wanted tag
// would simply vanish from view here.
//
// Unlike SheetView's ✕ (which only STAGES a removal for the turn-end push),
// every verb here fires immediately through `onApplyOps` — the same
// applyTagOps the Tags tab's Grant flow already calls. This is the GM's
// live edit surface, not the adjudication desk.
export default function HeldTagsBody({ characterName, characterTags, openTurn, onApplyOps }) {
  const [query, setQuery] = useState("");
  const [openTagId, setOpenTagId] = useState(null);
  const [busyTagId, setBusyTagId] = useState(null);
  const [error, setError] = useState(null);
  const confirm = useConfirm();

  const apply = useCallback(
    async (ops, tagId = null) => {
      setError(null);
      setBusyTagId(tagId);
      try {
        const res = await onApplyOps(ops);
        if (!res?.ok) setError(res?.error ?? "Something went wrong.");
        return res;
      } finally {
        setBusyTagId(null);
      }
    },
    [onApplyOps],
  );

  // What a removal would leave behind (Tag.removesInto, TAGS.md §5c) — the
  // one gesture repeating its inverse does NOT undo, so it's the one that
  // still asks first.
  function aftermathNames(tag) {
    const chain = tag?.removesInto;
    if (!Array.isArray(chain) || !chain.length) return [];
    const slugs = chain.flatMap((entry) =>
      typeof entry === "string" ? [entry] : Array.isArray(entry?.oneOf) ? entry.oneOf : [],
    );
    return [...new Set(slugs)];
  }

  async function removeHolding(ct) {
    const leaves = aftermathNames(ct.tag);
    if (leaves.length) {
      const list = leaves.length === 1 ? leaves[0] : `one of ${leaves.join(" or ")}`;
      const ok = await confirm({
        title: `Remove ${ct.tag.name}?`,
        message: `Removing it leaves ${list} behind, and putting it back will not clear that.`,
        confirmLabel: "Remove it",
        cancelLabel: "Keep it",
      });
      if (!ok) return;
    }
    await apply([{ tagId: ct.tagId, op: "remove", quantity: null }], ct.tagId);
  }

  const turn = openTurn?.number ?? null;
  const rows = characterTags.filter((ct) => matchesQuery(ct, query));
  const cards = buildCards(rows, { currentTurn: turn, includeStatus: true });

  return (
    <section className="panel flex flex-col gap-3 p-3">
      <label className="field">
        <span className="sr-only">Find a held tag</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a held tag…"
        />
      </label>
      {error && (
        <span className="form-error text-xs" role="alert">
          {error}
        </span>
      )}
      {!characterTags.length && <p className="text-sm text-muted">{characterName} holds nothing yet.</p>}
      {characterTags.length > 0 && !cards.length && <p className="text-sm text-muted">Nothing matches that.</p>}
      {cards.map((card) => (
        <section key={card.key} className="sheet-card" data-card={card.key.toLowerCase()}>
          <h3 className="section-title">
            {card.title} <span className="text-muted text-sm">{card.count}</span>
            {card.weight ? <span className="text-muted text-sm"> · {card.weight} lb</span> : null}
          </h3>
          {card.groups.map((group) => (
            <div key={group.key}>
              {/* A sub-heading only earns its line when there is more than
                  one group to tell apart — the sheet's own rule. */}
              {card.groups.length > 1 && group.name && <p className="sheet-group-name">{group.name}</p>}
              <ul className="sheet-rows">
                {group.rows.map((ct) => {
                  const shared = {
                    ct,
                    currentTurn: turn,
                    worn: Boolean(ct.equipped),
                    open: openTagId === ct.tagId,
                    onToggle: () => setOpenTagId((was) => (was === ct.tagId ? null : ct.tagId)),
                    verbs: (
                      <HeldTagVerbs
                        ct={ct}
                        busy={busyTagId === ct.tagId}
                        onSetQuantity={(n) => apply([{ tagId: ct.tagId, op: "patch", quantity: n }], ct.tagId)}
                        onRemove={() => removeHolding(ct)}
                        onPatch={(patch) => apply([{ tagId: ct.tagId, op: "patch", ...patch }], ct.tagId)}
                      />
                    ),
                  };
                  return INVENTORY_CARDS.has(card.key) ? (
                    <ItemCard key={ct.tagId} {...shared} facts={itemFacts(ct, turn)} />
                  ) : (
                    <TagRow key={ct.tagId} {...shared} value={rowValue(ct, turn)} />
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </section>
  );
}

// Every verb that acts on an EXISTING holding — quantity, equip, make
// permanent, remove. The Tags tab's Grant flow is the only door that adds a
// new one; nothing here does.
//
// The stepper is bound to the RESULTING count, so it reads as "this
// character has N of these" rather than "add or take this many" — 0 removes
// it. A local draft rides on top of the real quantity purely so typing feels
// immediate; it is reconciled whenever the server's number changes
// underneath (react-hooks/set-state-in-effect is an error here, so this is
// folded in during render rather than an effect).
function HeldTagVerbs({ ct, busy, onSetQuantity, onRemove, onPatch }) {
  const stackable = Boolean(ct.tag?.stackable);
  const [draft, setDraft] = useState(String(ct.quantity));
  const [seen, setSeen] = useState(ct.quantity);
  if (seen !== ct.quantity) {
    setSeen(ct.quantity);
    setDraft(String(ct.quantity));
  }

  // Rapid +/- clicks coalesce into one write — safe because a patch quantity
  // is ABSOLUTE (db/lib/tagOps.js writes it straight onto the row), so
  // dropping an intermediate value changes nothing about where it lands.
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function commit(raw) {
    setDraft(raw);
    const n = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isInteger(n) || n < 0) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (n === ct.quantity) return;
      // validateTagOps refuses a patch below 1 outright rather than
      // degrading to a removal, so zero has to become a remove op here.
      if (n <= 0) onRemove();
      else onSetQuantity(n);
    }, 400);
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {stackable ? (
        <QuantityField
          inline
          min={0}
          ariaLabel={`How many ${ct.tag.name} — 0 removes it`}
          value={draft}
          onChange={commit}
          disabled={busy}
        />
      ) : (
        <button type="button" className="btn-quiet" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      )}
      {ct.tag?.equippable && (
        // All-or-nothing for the whole holding, same as before: Equip puts
        // every unit out (each spending its own slot), Unequip clears all.
        <button
          type="button"
          className="btn-quiet"
          disabled={busy}
          onClick={() => onPatch({ equipped: !ct.equipped })}
        >
          {ct.equipped ? "Unequip" : "Equip"}
        </button>
      )}
      {ct.tag?.defaultDurationTurns != null && ct.expiresTurn != null && (
        <button
          type="button"
          className="btn-quiet"
          disabled={busy}
          onClick={() => onPatch({ expiry: { mode: "never" } })}
        >
          Make permanent
        </button>
      )}
    </span>
  );
}
