"use client";

// One character picker, three verbs. This replaces the old Bulk Move form,
// whose <select multiple size={8}> was the worst control in the panel: no
// search, no idea where anybody was standing, and no way to tell what you had
// picked without scrolling the box.
//
// The verbs share a picker because they share a question — WHO — and differ
// only in what happens next. Everything arrives as flat props from the page,
// so this file imports nothing from db/lib and the browser bundle stays clear
// of it.
import { useMemo, useState, useTransition } from "react";

import Select from "@/app/components/Select";
import CheckField from "@/app/components/CheckField";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { applyBulkAction } from "@/app/(app)/gm/dev/actions";

const VERBS = [
  { key: "move", label: "Move" },
  { key: "resources", label: "Resources" },
  { key: "tag", label: "Tag" },
];

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export default function BulkActions({ characters, locations, tags }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const [picked, setPicked] = useState([]);
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("");

  const [verb, setVerb] = useState("move");
  const [locationId, setLocationId] = useState(locations[0]?.locations?.[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [resourceMode, setResourceMode] = useState("add");
  const [tagSlug, setTagSlug] = useState(tags[0]?.slug ?? "");
  const [tagMode, setTagMode] = useState("grant");

  const zones = useMemo(
    () => [...new Set(characters.map((c) => c.zoneName).filter(Boolean))].sort(),
    [characters],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => {
      if (zone && c.zoneName !== zone) return false;
      if (!q) return true;
      return `${c.name} ${c.placeLabel}`.toLowerCase().includes(q);
    });
  }, [characters, query, zone]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const locationName = useMemo(() => {
    for (const group of locations) {
      const hit = group.locations.find((l) => l.id === locationId);
      if (hit) return `${group.zoneName} — ${hit.name}`;
    }
    return "";
  }, [locations, locationId]);

  const tagName = tags.find((t) => t.slug === tagSlug)?.name ?? "";
  const who = plural(picked.length, "character", "characters");

  // The sentence Apply will carry out, in the words a GM would use. It is also
  // what the confirm dialog repeats back, so there is one description of the
  // change rather than two that can disagree.
  const sentence = useMemo(() => {
    if (picked.length === 0) return "Nobody picked yet.";
    switch (verb) {
      case "move":
        return locationName ? `Moves ${who} to ${locationName}.` : "Pick a location.";
      case "resources": {
        const n = Number(amount);
        if (!Number.isInteger(n)) return "Type a whole number.";
        return resourceMode === "set"
          ? `Sets ${who} to ${n} ⬢.`
          : `Gives ${who} ${n > 0 ? "+" : ""}${n} ⬢.`;
      }
      case "tag":
        if (!tagName) return "Pick a tag.";
        return tagMode === "remove" ? `Takes ${tagName} off ${who}.` : `Grants ${tagName} to ${who}.`;
      default:
        return "";
    }
  }, [picked.length, verb, locationName, amount, resourceMode, tagName, tagMode, who]);

  const ready =
    picked.length > 0 &&
    ((verb === "move" && locationId) ||
      (verb === "resources" && Number.isInteger(Number(amount)) && amount !== "") ||
      (verb === "tag" && tagSlug));

  // Confirm first, transition second (DESIGN-SYSTEM.md §8). Awaiting the
  // dialog inside the transition deadlocks: the prompt needs an immediate
  // render, the transition cannot commit until the promise settles, and the
  // promise cannot settle until somebody clicks a dialog that never mounted.
  async function apply() {
    setError(null);
    setNote(null);
    const ok = await confirm({
      title: "Apply to everyone picked?",
      message: `${sentence} There is no Undo — the audit log is the only record.`,
      confirmLabel: "Apply",
      cancelLabel: "Not yet",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await applyBulkAction({
        kind: verb,
        characterIds: picked,
        locationId,
        amount: Number(amount),
        mode: verb === "tag" ? tagMode : resourceMode,
        tagSlug,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setNote(`Applied to ${plural(res.applied ?? picked.length, "character", "characters")}.`);
      setPicked([]);
    });
  }

  return (
    <div className="desk-card grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="field flex-1 min-w-56">
            <span className="field-label">Search</span>
            <input
              type="text"
              value={query}
              placeholder="Name or place…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Zone</span>
            <Select value={zone} onChange={(e) => setZone(e.target.value)} className="min-w-40">
              <option value="">Everywhere</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="check-picker">
          {visible.map((c) => (
            <CheckField key={c.id} checked={pickedSet.has(c.id)} onChange={() => toggle(c.id)}>
              <span className="flex flex-wrap items-baseline gap-2">
                <span>{c.name}</span>
                <span className="text-xs text-muted">{c.placeLabel}</span>
              </span>
            </CheckField>
          ))}
          {visible.length === 0 ? <EmptyState>Nobody matches.</EmptyState> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setPicked([...new Set([...picked, ...visible.map((c) => c.id)])])}
          >
            Select all
          </button>
          <button type="button" className="btn-quiet" onClick={() => setPicked([])}>
            Clear
          </button>
          <span className="mono text-sm text-muted">
            {picked.length} of {characters.length} selected
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {/* A verb is one value, so aria-pressed, not data-active — .segmented
            is a control with a value and a screen reader has to reach it. */}
        <div className="segmented">
          {VERBS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={verb === v.key}
              onClick={() => {
                setVerb(v.key);
                setError(null);
                setNote(null);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {verb === "move" ? (
          <label className="field">
            <span className="field-label">Location</span>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((group) => (
                <optgroup key={group.zoneName} label={group.zoneName}>
                  {group.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
        ) : null}

        {verb === "resources" ? (
          <>
            <div className="segmented">
              <button type="button" aria-pressed={resourceMode === "add"} onClick={() => setResourceMode("add")}>
                Add
              </button>
              <button type="button" aria-pressed={resourceMode === "set"} onClick={() => setResourceMode("set")}>
                Set
              </button>
            </div>
            <label className="field">
              <span className="field-label">Resources</span>
              <input
                type="number"
                step="1"
                value={amount}
                placeholder={resourceMode === "add" ? "+3 or -3" : "0"}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </>
        ) : null}

        {verb === "tag" ? (
          <>
            <div className="segmented">
              <button type="button" aria-pressed={tagMode === "grant"} onClick={() => setTagMode("grant")}>
                Grant
              </button>
              <button type="button" aria-pressed={tagMode === "remove"} onClick={() => setTagMode("remove")}>
                Remove
              </button>
            </div>
            <label className="field">
              <span className="field-label">Tag</span>
              <Select value={tagSlug} onChange={(e) => setTagSlug(e.target.value)}>
                {tags.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : null}

        <p className="desk-move-text">» {sentence}</p>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn" disabled={!ready || pending} onClick={apply}>
            {pending ? "Applying…" : "Apply"}
          </button>
          {note ? <span className="text-sm text-muted">{note}</span> : null}
          <FormError>{error}</FormError>
        </div>
      </div>
    </div>
  );
}
