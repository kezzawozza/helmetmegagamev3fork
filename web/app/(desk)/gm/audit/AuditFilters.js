"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// Everything here comes from auditNarrative, never from auditQuery: that one
// imports Prisma, and a client component reaching for one constant in it drags
// the whole data layer into the browser bundle.
import { AUDIT_FAMILIES, AUDIT_BANDS, DATE_PRESETS, prettifyActionType } from "@/lib/auditNarrative";
import Select from "@/app/components/Select";
import ChipPicker from "@/app/components/ChipPicker";

// The filter rail. Every control writes into the URL through the `set` the
// desk passes down — nothing here holds filter state of its own, because the
// URL is the state and a filtered view has to survive being pasted at another
// GM.
//
// The one exception is `search`, which is typed: it is held locally so the
// input does not lose a keystroke to a round trip, and committed on a short
// debounce — the way every other list in the app filters as you type. It used
// to need Enter or a blur, so a GM who typed a name and then looked at the
// feed was reading the UNFILTERED feed and had no way to know it.

const ACTOR_KINDS = [
  ["", "Anyone"],
  ["gm", "GMs"],
  ["player", "Players"],
  ["system", "System"],
];

export default function AuditFilters({
  filters,
  set,
  typeCounts,
  actors,
  characters,
  factions,
  zones,
  turnNumbers,
}) {
  const [search, setSearch] = useState(filters.q);
  // Filter as you type, on the same beat as the rail's content search. `set`
  // is read through a ref so a new closure on every render does not restart
  // the timer and hold the commit off for ever.
  const setRef = useRef(set);
  useEffect(() => {
    setRef.current = set;
  });
  useEffect(() => {
    if (search === filters.q) return undefined;
    const timer = setTimeout(() => setRef.current({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, filters.q]);
  const [typeQuery, setTypeQuery] = useState("");
  const [actorQuery, setActorQuery] = useState("");

  const toggle = (key, value) => {
    const current = filters[key];
    set({ [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };

  const visibleTypes = useMemo(() => {
    const q = typeQuery.trim().toLowerCase();
    const byType = new Map(typeCounts.map((t) => [t.actionType, t]));
    // Selected types stay pinned to the top even when the search would hide
    // them, so a filter can always be taken back off — and even when the
    // OTHER active filters (a character, an actor…) leave it with zero
    // matches right now, so the picker never just goes blank while the type
    // filter is still silently applied underneath it.
    const selected = filters.types.map((type) => byType.get(type) ?? { actionType: type, count: 0 });
    const rest = typeCounts.filter(
      (t) => !filters.types.includes(t.actionType) && (!q || t.actionType.includes(q)),
    );
    return [...selected, ...rest].slice(0, 40);
  }, [typeCounts, typeQuery, filters.types]);

  const visibleActors = useMemo(() => {
    const q = actorQuery.trim().toLowerCase();
    const selected = actors.filter((a) => filters.actors.includes(a.id));
    const rest = actors.filter(
      (a) => !filters.actors.includes(a.id) && (!q || a.name.toLowerCase().includes(q)),
    );
    return [...selected, ...rest].slice(0, 30);
  }, [actors, actorQuery, filters.actors]);

  const active =
    filters.q ||
    filters.families.length ||
    filters.types.length ||
    filters.actors.length ||
    filters.actorKind ||
    filters.targets.length ||
    filters.factions.length ||
    filters.zones.length ||
    filters.turnFrom ||
    filters.turnTo ||
    filters.preset ||
    filters.from ||
    filters.to;

  return (
    <div className="audit-filters">
      <label className="field">
        <span className="field-label">Search</span>
        <input
          value={search}
          placeholder="name, reason, @handle, role:smith, zone:caves…"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && set({ q: search })}
        />
      </label>

      {/* Show is a SINGLE pick, so it is a ChipPicker rather than a hand-rolled
          chip-row (DESIGN-SYSTEM §5) — the same markup, minus the third copy
          of it. "Everything" is one more option in the list, not a button
          bolted on the end. */}
      <ChipPicker
        label="Show"
        value={filters.band || "player"}
        options={[
          ...Object.entries(AUDIT_BANDS).map(([key, label]) => ({ id: key, label })),
          { id: "all", label: "Everything" },
        ]}
        onChange={(id) => set({ band: id || "player", families: [] })}
      />

      <Group label="Family">
        <div className="chip-row">
          {Object.entries(AUDIT_FAMILIES).map(([key, fam]) => (
            <button
              key={key}
              type="button"
              className="chip"
              data-active={filters.families.includes(key) || undefined}
              aria-pressed={filters.families.includes(key)}
              onClick={() => toggle("families", key)}
            >
              {fam.label}
            </button>
          ))}
        </div>
      </Group>

      <Group label="Who">
        <div className="segmented" role="group" aria-label="Actor kind">
          {ACTOR_KINDS.map(([value, label]) => (
            <button
              key={value || "any"}
              type="button"
              aria-pressed={filters.actorKind === value}
              onClick={() => set({ actorKind: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="control mt-2"
          value={actorQuery}
          placeholder="Find a person…"
          onChange={(e) => setActorQuery(e.target.value)}
          aria-label="Find an actor"
        />
        <div className="audit-picker">
          {visibleActors.map((a) => (
            <button
              key={a.id}
              type="button"
              className="audit-picker-row"
              data-active={filters.actors.includes(a.id) || undefined}
              aria-pressed={filters.actors.includes(a.id)}
              onClick={() => toggle("actors", a.id)}
            >
              <span className="audit-picker-name">{a.name}</span>
              <span className="text-muted text-xs">{a.kind === "gm" ? "GM" : ""}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group label="Action type">
        <input
          className="control"
          value={typeQuery}
          placeholder="Filter the list…"
          onChange={(e) => setTypeQuery(e.target.value)}
          aria-label="Filter action types"
        />
        <div className="audit-picker">
          {visibleTypes.map((t) => (
            <button
              key={t.actionType}
              type="button"
              className="audit-picker-row"
              data-active={filters.types.includes(t.actionType) || undefined}
              aria-pressed={filters.types.includes(t.actionType)}
              onClick={() => toggle("types", t.actionType)}
              title={t.actionType}
            >
              <span className="audit-picker-name">{prettifyActionType(t.actionType)}</span>
              <span className="text-muted text-xs mono">{t.count}</span>
            </button>
          ))}
          {visibleTypes.length === 0 && <p className="text-muted text-xs p-2">Nothing matches.</p>}
        </div>
      </Group>

      <Group label="About">
        <label className="field">
          <span className="field-label">Character</span>
          <Select
            value={filters.targets[0] ?? ""}
            onChange={(e) => set({ targets: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Anyone</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status !== "ALIVE" ? ` (${c.status.toLowerCase()})` : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Faction</span>
          <Select
            value={filters.factions[0] ?? ""}
            onChange={(e) => set({ factions: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Any</option>
            {factions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Zone</span>
          <Select
            value={filters.zones[0] ?? ""}
            onChange={(e) => set({ zones: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Any</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
          {/* The zone a row belongs to is its target's FACTION zone, never
              where they happen to be standing — the rule ZoneChip states. */}
          <span className="text-muted text-xs">By the character&rsquo;s faction.</span>
        </label>
      </Group>

      <Group label="When">
        <div className="chip-row">
          {Object.entries(DATE_PRESETS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="chip"
              data-active={filters.preset === key || undefined}
              aria-pressed={filters.preset === key}
              onClick={() => set({ preset: filters.preset === key ? "" : key })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="audit-pair">
          <label className="field">
            <span className="field-label">Turn from</span>
            <Select value={filters.turnFrom} onChange={(e) => set({ turnFrom: e.target.value })}>
              <option value="">—</option>
              {turnNumbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Turn to</span>
            <Select value={filters.turnTo} onChange={(e) => set({ turnTo: e.target.value })}>
              <option value="">—</option>
              {turnNumbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="audit-pair">
          <label className="field">
            <span className="field-label">From</span>
            <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">To</span>
            <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </div>
      </Group>

      {active ? (
        <button type="button" className="btn-quiet" onClick={() => set(null)}>
          Clear every filter
        </button>
      ) : null}
    </div>
  );
}

function Group({ label, children }) {
  return (
    <section className="audit-group">
      <h2 className="audit-group-title">{label}</h2>
      {children}
    </section>
  );
}
