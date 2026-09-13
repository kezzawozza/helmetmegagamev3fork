"use client";

import { useMemo, useState, useTransition } from "react";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { chainTokens } from "@/lib/tagChains";
import { buildCards, matchesQuery, nextRung, rowValue } from "@/lib/sheetCards";
import { thingVerbSets, thingVerbs } from "@/app/(app)/chat/thingRows";
import { consumeTagRequest } from "@/app/(app)/character/requestActions";
import { equipOne, unequipOne } from "@/app/(app)/character/equipActions";
// A leaf CommonJS module — constants and pure functions, no prisma require —
// so naming it here does not drag the @lifeweb/db barrel into the bundle.
import { RESEARCH_TAG_SLUG } from "@lifeweb/db/lib/research";
import ChipText from "./ChipText";
import FormError from "./FormError";
import IdentityDialog from "./IdentityDialog";
import Modal from "./Modal";
import RowVerbs from "./RowVerbs";
import StorePanel from "./StorePanel";
import TagPointsValue from "./TagPointsValue";
import TagRow from "./TagRow";
import { useRequestActions } from "./RequestActionsProvider";
import { useNotice } from "./NoticeProvider";

// The right column of /ledger: every held tag, one card per kind, one row per
// tag, and a filter box over all of it. Which card, which order and which
// value each row shows is web/lib/sheetCards.js; this draws.
//
// Three things a row can do, all through machinery that already exists:
// - click it and its details open inline (TagRow.js → TagDetails.js);
// - a pocket row's verbs open the sheet's own dialogs with the tag picked
//   (RowVerbs.js → RequestActionsProvider), or flip the equip toggle;
// - a wound's Heal opens the Heal dialog on yourself and that wound.
//
// The store (Spend Tag Points) hangs off this header, beside the points it
// spends, as it did on the old sheet's tag panel.
export default function TagRail({
  characterTags,
  isSelf,
  selfId = null,
  currentTurn = null,
  tagPoints = null,
  tagCatalog = [],
  storeTags = null,
  storeHeldTags = null,
  storeRoleSlug = null,
  nukeArmedTurn = null,
  identity = null,
}) {
  const actions = useRequestActions();
  const open = actions?.open ?? null;
  const pools = actions?.pools ?? {};
  // Research (CRAFTING.md §2b): the provider composes both off the three
  // facts the page hands it. `canResearch` is "every gate is open", so the
  // verb only renders when it can actually fire; `researchHint` is the
  // reason it can't, and rides the row's own note line instead — this
  // surface has no tooltips (SHEET.md).
  const canResearch = pools.canResearch ?? false;
  const researchHint = pools.researchHint ?? null;

  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [storeOpen, setStoreOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const notice = useNotice();

  const cards = useMemo(() => buildCards(characterTags, { currentTurn }), [characterTags, currentTurn]);
  const verbSets = useMemo(() => thingVerbSets(characterTags), [characterTags]);
  const heldTagIds = useMemo(() => new Set(characterTags.map((ct) => ct.tag.id)), [characterTags]);

  // Straight to the server, no confirm and no dialog: a consumable is one
  // click. The action revalidates the page, so the row disappears on its own.
  //
  // The RESULT used to be thrown away here, which mattered the moment a
  // cooked dish started having something to say: eating one from this rail is
  // how people actually eat, and the taste line would only ever have reached
  // the handful who go through the Actions grid instead. A `line` the server
  // sent is raised the same way every other action's is (NoticeProvider),
  // and a consume with nothing to say still says nothing.
  function consume(tagId) {
    setError(null);
    startTransition(async () => {
      const res = await consumeTagRequest({ tagId });
      if (!res?.ok) setError(res?.error ?? "Something went wrong.");
      else if (res.line) notice(res.line);
    });
  }

  // A slot holds one physical unit, not a stack (equipSlots.js): this row's
  // button is a plain toggle, so it moves exactly one unit — onto the rack if
  // none of this holding is out yet, back off if any of it is. Equipping a
  // second unit of a partly-out stack is the rig's job (EquipBoard.js), which
  // draws one cell per unit and can offer both verbs on the same holding.
  function equip(ct) {
    setError(null);
    startTransition(async () => {
      const res = await (ct.equipped ? unequipOne(ct.id) : equipOne(ct.id));
      if (res?.error) setError(res.error);
    });
  }

  function verbsFor(ct) {
    if (!isSelf) return null;
    const v = {
      ...thingVerbs(ct, verbSets),
      equipped: Boolean(ct.equipped),
      healable: Boolean(ct.tag.healable),
      researchable: ct.tag.slug === RESEARCH_TAG_SLUG && canResearch,
    };
    // Off the tag's own id, not v.consumable: consumableTags() (the set
    // v.consumable is built from) excludes the potion on purpose, so it's
    // never on offer in the ordinary consume list elsewhere. Gating this row's
    // own Use button on that same set left the potion with no Use at all.
    const isPotion = ct.tag.id === identity?.tagId;
    if (isPotion) v.consumable = true;
    // A poison opens its own three-option dialog (lace it, dose someone, or
    // drink it) instead of the one-click straight-to-server path — it needs
    // an answer the quick Use can't ask for. Routes on Tag.poison, the one
    // catalog fact that's always safe to read straight off the tag.
    const isPoison = v.consumable && Boolean(ct.tag.poison);
    return (
      <RowVerbs
        verbs={v}
        pending={pending}
        onUse={
          v.consumable && (!isPoison || open)
            ? () => (isPoison ? open("poison", ct.tag.id) : isPotion ? setIdentityOpen(true) : consume(ct.tag.id))
            : null
        }
        onEquip={v.equippable && ct.id ? () => equip(ct) : null}
        onGive={open ? () => open("transfer", ct.tag.id) : null}
        onDestroy={open ? () => open("destroy", ct.tag.id) : null}
        onHeal={pools.canHeal && open && selfId ? () => open("heal", ct.tag.id, { patientId: selfId }) : null}
        onResearch={open ? () => open("research") : null}
      />
    );
  }

  // Health's second line: what it turns into, and what a cure costs.
  function healthNote(ct) {
    const becomes = chainTokens(ct.tag.expiresInto);
    const cure = ct.tag.healable ? formatTagRequirement(ct.tag) : null;
    if (!becomes && !cure) return null;
    return (
      <>
        {becomes && (
          <>
            → <ChipText text={becomes} inTooltip={false} />
          </>
        )}
        {becomes && cure ? " · " : ""}
        {cure ? `cure ${cure}` : ""}
      </>
    );
  }

  // A row's second line. Health says what it turns into and what a cure
  // costs; the Research row says why the verb is missing when a gate is shut,
  // since this surface has no tooltips; a skill says what the next rung up
  // would cost.
  function noteFor(ct, card, rung) {
    if (card.key === "Health") return healthNote(ct);
    if (isSelf && ct.tag.slug === RESEARCH_TAG_SLUG && !canResearch) return researchHint;
    if (rung) return `next: ${rung.name} · ${rung.pointCost > 0 ? "+" : ""}${rung.pointCost} pts`;
    return null;
  }

  const pointsControl =
    tagPoints != null &&
    (isSelf && storeTags ? (
      <button type="button" className="btn-quiet" onClick={() => setStoreOpen(true)}>
        Spend Tag Points (<TagPointsValue points={tagPoints} />)
      </button>
    ) : (
      <span className="text-sm">
        <span className="text-muted">Tag points </span>
        <TagPointsValue points={tagPoints} />
      </span>
    ));

  const filtering = query.trim().length > 0;

  return (
    <>
      <section className="panel p-4 sheet-rail-head">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Tags</h2>
          {pointsControl}
        </div>
        <label className="field mt-2">
          <span className="sr-only">Find a tag</span>
          <input
            type="search"
            value={query}
            placeholder="Find a tag…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <FormError>{error}</FormError>
      </section>

      {isSelf && storeTags && (
        <Modal open={storeOpen} onClose={() => setStoreOpen(false)} title="Spend Tag Points" width="widest">
          <StorePanel
            tags={storeTags}
            budget={tagPoints ?? 0}
            heldTags={storeHeldTags ?? []}
            roleSlug={storeRoleSlug}
            onDone={() => setStoreOpen(false)}
          />
        </Modal>
      )}
      {isSelf && identity && identityOpen && (
        <IdentityDialog identity={identity} open onClose={() => setIdentityOpen(false)} />
      )}

      {cards.length === 0 && (
        <section className="panel p-4">
          <p className="text-sm text-muted">No tags yet.</p>
        </section>
      )}

      {cards.map((card) => {
        const groups = card.groups
          .map((g) => ({ ...g, rows: g.rows.filter((ct) => matchesQuery(ct, query)) }))
          .filter((g) => g.rows.length > 0);
        if (filtering && groups.length === 0) return null;
        const shown = groups.reduce((n, g) => n + g.rows.length, 0);
        return (
          <section key={card.key} className="panel p-4 sheet-card" data-card={card.key.toLowerCase()}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="section-title">{card.title}</h2>
              <span className="mono text-sm text-muted">
                {card.weight != null ? `${card.weight} lb · ` : ""}
                {filtering ? `${shown} / ${card.count}` : card.count}
              </span>
            </div>
            {groups.map((g) => (
              <div key={g.key} className="sheet-group">
                {g.name && card.groups.length > 1 && (
                  <p className="sheet-group-name" style={g.color ? { color: g.color } : undefined}>
                    {g.name}
                  </p>
                )}
                <ul className="sheet-rows">
                  {g.rows.map((ct) => {
                    const id = ct.tag.id;
                    const rung = card.key === "Skills" ? nextRung(ct, tagCatalog, heldTagIds) : null;
                    return (
                      <TagRow
                        key={id}
                        ct={ct}
                        value={rowValue(ct, currentTurn)}
                        note={noteFor(ct, card, rung)}
                        verbs={
                          card.key === "Items" || card.key === "Assets" || card.key === "Health" || ct.tag.slug === RESEARCH_TAG_SLUG
                            ? verbsFor(ct)
                            : null
                        }
                        open={openId === id}
                        onToggle={() => setOpenId((was) => (was === id ? null : id))}
                        currentTurn={currentTurn}
                        armedTurn={ct.tag.slug === "nuclear-device" ? nukeArmedTurn : null}
                        worn={Boolean(ct.equipped)}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
