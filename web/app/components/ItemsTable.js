"use client";

import { Fragment } from "react";
import { tagWeightLbs } from "@/lib/formatTagWeight";
import { itemWhere } from "@/lib/itemWhere";
import TagDetails from "./TagDetails";
import TagIcon from "./TagIcon";
import TagMarks from "./TagMarks";
import { useIsCoarsePointer } from "./useIsCoarsePointer";

// The sheet's Items panel, as the mockup's own `.data-table` — Thing / Where /
// Each / Total — rather than the two separate Items and Assets item cards
// (ItemCard.js). This is a SHEET-ONLY view: ItemCard.js and its consumers
// (the GM's Sheet tab and Dev Character Panel, InspectorColumn.js /
// HeldTagsBody.js) are untouched, because a GM skimming a whole inventory
// still wants every fact a card can carry, not one table row's worth.
//
// Items and Assets are ONE table under ONE heading here, the way the mockup
// draws them — Assets used to get its own card, and a character's whole
// property is one thing to skim, not two. Assets weigh nothing by rule
// (db/lib/tagWeight.js), so their Each/Total simply read "0 lb".
//
// Clicking a row's name opens the same TagDetails block every other row on
// the sheet opens, in a row of its own underneath (colSpan across the table) —
// the table's shape changes, the "click to read, verbs are a second tap on a
// phone" rule (SHEET.md §3) does not.
export default function ItemsTable({
  rows,
  verbsFor,
  openId,
  onToggle,
  currentTurn = null,
  totalWeight = null,
  nukeArmedTurn = null,
}) {
  const coarse = useIsCoarsePointer();
  if (rows.length === 0) return null;

  return (
    <section className="panel p-3 sheet-card" data-card="items">
      <div className="panel-header-row justify-between">
        <h2 className="panel-header">Items</h2>
        <span className="mono text-sm text-muted">
          {totalWeight != null ? `${totalWeight} lb carried` : `${rows.length}`}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Thing</th>
            <th>Where</th>
            <th>Each</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ct) => {
            const tag = ct.tag;
            const id = tag.id;
            const quantity = ct.quantity ?? 1;
            const stack = quantity > 1 ? quantity : null;
            const category = tag.category ? String(tag.category).toLowerCase() : null;
            const each = tagWeightLbs(tag, 1);
            const total = tagWeightLbs(tag, quantity);
            const open = openId === id;
            const verbs = verbsFor(ct);
            return (
              <Fragment key={id}>
                <tr data-open={open ? "true" : undefined}>
                  <td>
                    <button
                      type="button"
                      className="data-table-face"
                      aria-expanded={open}
                      onClick={() => onToggle(id)}
                    >
                      <span className="chip" data-tag-category={category ?? undefined}>
                        <TagIcon tag={tag} size={11} />
                        {tag.name}
                      </span>
                      {stack && <span className="mark">×{stack}</span>}
                      <TagMarks worn={Boolean(ct.equipped || ct.equippedQuantity)} poison={Boolean(ct.poisonMarker)} />
                    </button>
                    {!coarse && verbs}
                  </td>
                  <td>{itemWhere(ct)}</td>
                  <td className="num">{each} lb</td>
                  <td className="num">{total} lb</td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={4} className="sheet-row-details">
                      <TagDetails
                        tag={tag}
                        quantity={quantity}
                        expiresTurn={ct.expiresTurn}
                        currentTurn={currentTurn}
                        armedTurn={tag.slug === "nuclear-device" ? nukeArmedTurn : null}
                        showName={false}
                        inTooltip
                        poisonMarker={Boolean(ct.poisonMarker)}
                      />
                      {coarse && verbs}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
