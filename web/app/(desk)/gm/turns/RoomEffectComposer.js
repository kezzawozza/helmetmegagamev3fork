"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { mergeTagOp } from "@/lib/tagOpAlgebra";
import TagChip from "@/app/components/TagChip";
import TagCatalogBrowser from "@/app/components/TagCatalogBrowser";
import QuantityField from "@/app/components/QuantityField";
import { createStagedRoomEffect, updateStagedRoomEffect, getRoomStash } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import useEscapeLayer from "./escapeLayers";

// Stage a change to a ROOM's stash: tags left on the floor and the room's own
// ⬢ (docs/systemdocs/CARRY.md). A GM seeding a cave, dropping loot where a
// Gambit left it, or taking something back off the ground.
//
// A separate composer rather than a target-kind switch inside
// EffectComposer.js, for the same reason TransferComposer is separate: almost
// nothing over there applies here. A room has no sheet to fetch, no tag
// points, nowhere to be relocated to, and there is no multi-target case — one
// room per row. A `kind` toggle would have left half that dialog dead.
//
// TWO RULES DIFFER FROM THE CHARACTER COMPOSER, and both are deliberate:
//
//  - Every tag carries a quantity here, stackable or not. The non-stackable
//    pin is a rule about what one CHARACTER can hold (TAGS.md §5a) — two
//    players can each leave their Longbow on the same floor, and
//    db/lib/tagWrites.js#addToRoomStack applies no pin for exactly that
//    reason. So mergeTagOp is always called with `stackable: true`; its own
//    clamp would pin an add back to 1.
//  - Remove is always offered. What the room actually holds is shown in "On
//    the floor" below, and the push refuses a remove the stack can't cover
//    rather than quietly taking what is there.

export default function RoomEffectComposer({
  moveId = null,
  cavingRollId = null,
  existing = null,
  tagCatalog,
  stagingRooms = [],
  onDone,
  onCancel,
}) {
  const [roomId, setRoomId] = useState(() => existing?.room?.id ?? "");
  const [resources, setResources] = useState(() => {
    const v = existing?.roomResources ?? 0;
    return v ? String(v) : "";
  });
  const [ops, setOps] = useState(() => {
    const map = new Map();
    for (const op of existing?.roomTagOps ?? []) map.set(op.tagId, op);
    return map;
  });
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const [checkedTagIds, setCheckedTagIds] = useState(() => new Set());
  const [quantityDrafts, setQuantityDrafts] = useState(() => new Map());
  const [addQtyDrafts, setAddQtyDrafts] = useState(() => new Map());
  const [cancelNotice, setCancelNotice] = useState(null);

  const { markDirty, markClean, guardedClose } = useDirtyGuard({
    alsoDirty: !existing && Boolean(resources.trim() || ops.size),
  });

  useEscapeLayer(() => {
    if (!pending) guardedClose(onCancel);
  });

  const tagById = useMemo(() => new Map(tagCatalog.map((t) => [t.id, t])), [tagCatalog]);
  const room = useMemo(() => stagingRooms.find((r) => r.id === roomId) ?? null, [stagingRooms, roomId]);

  // What is on the floor right now, so a Remove is picked from what is
  // actually there. Only a successful fetch is cached; a failure is never
  // stored as an empty stash, which would be indistinguishable from a room
  // that genuinely holds nothing.
  const [stashByRoom, setStashByRoom] = useState(() => new Map());
  const [stashFailed, setStashFailed] = useState(false);
  const [stashRetry, setStashRetry] = useState(0);
  const stash = roomId ? (stashByRoom.get(roomId) ?? null) : null;

  useEffect(() => {
    if (!roomId || stash) return undefined;
    let cancelled = false;
    (async () => {
      setStashFailed(false);
      const res = await getRoomStash({ roomId });
      if (cancelled) return;
      if (!res?.ok) {
        setStashFailed(true);
        return;
      }
      setStashByRoom((prev) => new Map(prev).set(roomId, { resources: res.resources, tags: res.tags }));
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, stash, stashRetry]);

  const heldTagIds = useMemo(() => new Set((stash?.tags ?? []).map((t) => t.tagId)), [stash]);
  const stagedByTagId = useMemo(() => {
    const map = new Map();
    for (const op of ops.values()) map.set(op.tagId, op);
    return map;
  }, [ops]);

  function stageOp(tagId, op, quantity = 1) {
    // Computed out here, not inside the functional updater — React may invoke
    // that twice, and the notice is a side effect.
    let cancelledName = null;
    setOps((prev) => {
      const next = new Map(prev);
      // Always `stackable: true` — see the header. A floor takes any number.
      const merged = mergeTagOp(next.get(tagId), { tagId, op, quantity }, { stackable: true });
      if (merged == null) {
        next.delete(tagId);
        cancelledName = tagById.get(tagId)?.name ?? "that tag";
      } else {
        next.set(tagId, merged);
      }
      return next;
    });
    setCancelNotice(
      cancelledName
        ? `${cancelledName}: the new op exactly cancelled what was already staged, so nothing is staged for it now.`
        : null,
    );
    markDirty();
  }

  function commitQuantity(tagId, raw) {
    const trimmed = raw.trim();
    setOps((prev) => {
      const next = new Map(prev);
      const op = next.get(tagId);
      if (!op) return prev;
      let quantity;
      if (trimmed === "" && op.op !== "add") {
        // Blank means "the whole stack" on a remove — the null
        // db/lib/tagWrites.js#dropRoomTag reads as "take all of it". An add
        // has no whole stack to mean.
        quantity = null;
      } else {
        const parsed = Number.parseInt(trimmed, 10);
        quantity = Number.isInteger(parsed) && parsed > 0 ? parsed : op.quantity;
      }
      next.set(tagId, { ...op, quantity });
      return next;
    });
    setQuantityDrafts((prev) => {
      const next = new Map(prev);
      next.delete(tagId);
      return next;
    });
  }

  function stageManyAdds(tagIds) {
    for (const tagId of tagIds) stageOp(tagId, "add");
    setCheckedTagIds(new Set());
  }

  function unstage(tagId) {
    setOps((prev) => {
      const next = new Map(prev);
      next.delete(tagId);
      return next;
    });
    setCancelNotice(null);
    markDirty();
  }

  function renderTagBrowserActions(tag, { staged }) {
    const draft = addQtyDrafts.get(tag.id);
    const n = Number.parseInt(draft ?? "1", 10);
    const qty = Number.isInteger(n) && n > 0 ? n : 1;
    return (
      <>
        {/* Shown for every tag, not only a stackable one — a floor holds as
            many Longbows as people leave on it. */}
        <QuantityField
          inline
          ariaLabel="Quantity to add"
          value={draft ?? "1"}
          onChange={(v) => setAddQtyDrafts((prev) => new Map(prev).set(tag.id, v))}
        />
        <button type="button" className="btn-quiet" onClick={() => stageOp(tag.id, "add", qty)}>
          {qty > 1 ? `+ Add ×${qty}` : "+ Add"}
        </button>
        {/* Always offered, unlike the character composer's held-gated one:
            "On the floor" above says what is actually in there, and the push
            refuses a remove the stack can't cover rather than quietly taking
            whatever it finds. */}
        <button type="button" className="btn-quiet" onClick={() => stageOp(tag.id, "remove")}>
          − Remove
        </button>
        {staged && (
          <button type="button" className="btn-quiet" onClick={() => unstage(tag.id)}>
            Unstage
          </button>
        )}
      </>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        // Fold in anything still ticked in the catalog browser but never
        // pushed through "Add N selected" — ticking a box should be enough.
        let tagOps = [...ops.values()];
        if (checkedTagIds.size) {
          const merged = new Map(ops);
          for (const tagId of checkedTagIds) {
            const next = mergeTagOp(merged.get(tagId), { tagId, op: "add", quantity: 1 }, { stackable: true });
            if (next == null) merged.delete(tagId);
            else merged.set(tagId, next);
          }
          tagOps = [...merged.values()];
        }
        const res = existing
          ? await updateStagedRoomEffect({ stagedEffectId: existing.id, roomResources: resources, tagOps })
          : await createStagedRoomEffect({ roomId, moveId, cavingRollId, roomResources: resources, tagOps });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  const roomLabel = existing?.room
    ? existing.room.locationName
      ? `${existing.room.locationName} — ${existing.room.name}`
      : existing.room.name
    : null;

  return (
    <Modal
      modeless
      title={existing ? "Edit staged room effect" : "Stage a room effect"}
      onClose={() => !pending && guardedClose(onCancel)}
      width="widest"
    >
      <div className="mt-3 flex flex-col gap-4">
        <section className="composer-group">
          <h3 className="composer-group-title">Which room</h3>
          {existing ? (
            // Fixed once staged, the same as a character row's target. Editing
            // changes what the row does, never what it does it to.
            <p className="text-sm">{roomLabel}</p>
          ) : (
            <label className="field" style={{ width: "22rem" }}>
              <span className="field-label">Room</span>
              <Select
                value={roomId}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  markDirty();
                }}
              >
                <option value="">— pick a room —</option>
                {groupByLocation(stagingRooms).map((group) => (
                  <optgroup key={group.locationId} label={`${group.zoneName ?? "Unzoned"} — ${group.locationName}`}>
                    {group.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </label>
          )}
          {room?.destroysContents && (
            <p className="text-xs text-accent">
              {room.name} destroys whatever is put into it — you can only take things out.
            </p>
          )}
        </section>

        <section className="composer-group">
          <h3 className="composer-group-title">What it does to the stash</h3>
          <label className="field" style={{ width: "10rem" }}>
            <span className="field-label">Resources</span>
            <input
              type="number"
              value={resources}
              onChange={(e) => {
                setResources(e.target.value);
                markDirty();
              }}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="±0"
            />
          </label>
        </section>

        {(ops.size > 0 || cancelNotice) && (
          <section className="composer-group">
            <h3 className="composer-group-title">Tag changes</h3>
            {cancelNotice && <p className="text-xs text-muted">{cancelNotice}</p>}
            {[...ops.values()].map((op) => {
              const tag = tagById.get(op.tagId);
              return (
                <div key={op.tagId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="mono">{op.op === "add" ? "+" : "−"}</span>
                  {tag ? <TagChip tag={tag} /> : <span>Unknown tag</span>}
                  <QuantityField
                    inline
                    allowBlank={op.op !== "add"}
                    ariaLabel={op.op === "add" ? "Quantity" : "Quantity — blank means the whole stack"}
                    value={quantityDrafts.has(op.tagId) ? quantityDrafts.get(op.tagId) : String(op.quantity ?? "")}
                    onChange={(v) => {
                      setQuantityDrafts((prev) => new Map(prev).set(op.tagId, v));
                      markDirty();
                    }}
                    onCommit={(v) => commitQuantity(op.tagId, v)}
                  />
                  <button type="button" className="btn-quiet" onClick={() => unstage(op.tagId)}>
                    Unstage
                  </button>
                </div>
              );
            })}
          </section>
        )}

        {roomId && (
          <section className="composer-group">
            <h3 className="composer-group-title">On the floor</h3>
            <div className="flex flex-col gap-1">
              {stashFailed ? (
                <span className="text-sm text-accent flex items-center gap-2">
                  Couldn&apos;t load what&apos;s in there.
                  <button type="button" className="btn-quiet" onClick={() => setStashRetry((n) => n + 1)}>
                    Retry
                  </button>
                </span>
              ) : !stash ? (
                <span className="text-sm text-muted">Loading the stash…</span>
              ) : (
                <>
                  <span className="text-sm text-muted mono">{stash.resources} ⬢</span>
                  {stash.tags.length === 0 ? (
                    <span className="text-sm text-muted">Nothing is stored here.</span>
                  ) : (
                    stash.tags.map((t) => {
                      const staged = ops.get(t.tagId);
                      const catalogTag = tagById.get(t.tagId);
                      return (
                        <div key={t.tagId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">
                            {catalogTag ? (
                              <TagChip tag={catalogTag} quantity={t.quantity} />
                            ) : (
                              <>
                                {t.name}
                                {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                              </>
                            )}
                          </span>
                          <button
                            type="button"
                            className="btn-quiet"
                            disabled={staged?.op === "remove"}
                            onClick={() => stageOp(t.tagId, "remove")}
                          >
                            {staged?.op === "remove" ? "Staged" : "− Remove"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </section>
        )}

        <section className="composer-group">
          <h3 className="composer-group-title">Add from the catalog</h3>
          <TagCatalogBrowser
            tags={tagCatalog}
            heldTagIds={heldTagIds}
            stagedByTagId={stagedByTagId}
            selectable
            selected={checkedTagIds}
            onSelectedChange={(next) => {
              setCheckedTagIds(next);
              markDirty();
            }}
            onSelectAction={stageManyAdds}
            selectActionLabel="Add"
            renderActions={renderTagBrowserActions}
          />
        </section>

        <FormError>{error}</FormError>

        <div className="modal-actions modal-actions--sticky">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={pending || (!existing && !roomId)}>
            {pending ? "Working…" : existing ? "Save" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// One <optgroup> per Location, labelled with its zone. Rooms arrive already
// ordered zone → location → name (web/lib/deskRows.js), so one pass keeps them
// in docs/zones.yaml order.
function groupByLocation(rooms) {
  const groups = [];
  for (const r of rooms ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.locationId === r.locationId) last.rooms.push(r);
    else groups.push({ locationId: r.locationId, locationName: r.locationName, zoneName: r.zoneName, rooms: [r] });
  }
  return groups;
}
