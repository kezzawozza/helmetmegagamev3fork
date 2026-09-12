"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Pager from "@/app/components/Pager";
import DeskHeader, { DeskTurnChip } from "@/app/components/DeskHeader";
import LockChip from "@/app/components/LockChip";
import { useRefresh } from "@/app/components/useRefresh";
import AuditFeed from "./AuditFeed";
import AuditFilters from "./AuditFilters";
import AuditInspector from "./AuditInspector";
import { exportAudit } from "./exportActions";

// The audit desk's client shell.
//
// FILTERS live in the URL — the log is unbounded, so filtering happens in
// Postgres, and a URL is a view worth pasting to another GM. SELECTION is
// local: the page already shipped every row, so picking one is a lookup, and
// the URL is patched with history.replaceState to keep the permalink right
// without re-running the RSC tree. Presentation state (time format, live
// tail) stays local — it's how one person reads, not what they're looking at.

const REFRESH_MS = 20_000;

export default function AuditDesk({
  entries,
  names,
  tags,
  pinned,
  selectedId,
  total,
  pageSize,
  filters,
  openTurn,
  typeCounts,
  actors,
  characters,
  factions,
  zones,
  turnNumbers,
  selectableZones,
  visibleZoneIds,
}) {
  const router = useRouter();
  const [refresh] = useRefresh();
  const [selected, setSelected] = useState(selectedId ?? null);
  const [absoluteTime, setAbsoluteTime] = useState(false);
  const [live, setLive] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");

  // What the newest row was the last time the reader actually looked. The
  // badge counts forward from it rather than from the last refresh, so a tail
  // running while a GM reads something else accumulates instead of resetting.
  const seenTopId = useRef(entries[0]?.id ?? null);
  const [freshCount, setFreshCount] = useState(0);

  const page = filters.page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Rewrites the query string. `null` clears everything; anything else is a
  // patch, and any change resets to page 1 — landing on page 7 of a filter
  // that now has two pages is the classic way to show an empty screen.
  const set = useCallback(
    (patch) => {
      const next = patch === null ? emptyFilters() : { ...filters, ...patch, page: 1 };
      router.push(hrefFor(next), { scroll: false });
    },
    [filters, router],
  );

  const goToPage = useCallback(
    (n) => router.push(hrefFor({ ...filters, page: n }), { scroll: false }),
    [filters, router],
  );

  // Selection is a local pick plus a URL rewrite that does NOT re-render.
  const select = useCallback(
    (id) => {
      setSelected(id);
      const url = id ? `/gm/audit/${id}${window.location.search}` : `/gm/audit${window.location.search}`;
      window.history.replaceState(null, "", url);
    },
    [],
  );

  // Live tail. Paused while the tab is hidden — a background tab polling every
  // 20 seconds is pure cost — and stoppable, because a GM reading one entry
  // should not have the list move under them.
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  // Count what has arrived since the reader last looked at the top of the
  // list. Only meaningful on page 1 of an unfiltered-by-date view; elsewhere
  // "newest" is not what the page is showing.
  useEffect(() => {
    if (page !== 1) return;
    const top = entries[0]?.id ?? null;
    if (!seenTopId.current) {
      seenTopId.current = top;
      return;
    }
    if (top === seenTopId.current) return;
    const index = entries.findIndex((e) => e.id === seenTopId.current);
    setFreshCount(index === -1 ? entries.length : index);
  }, [entries, page]);

  const acknowledge = () => {
    seenTopId.current = entries[0]?.id ?? null;
    setFreshCount(0);
  };

  const current = useMemo(() => {
    if (!selected) return null;
    return entries.find((e) => e.id === selected) ?? (pinned?.id === selected ? pinned : null);
  }, [entries, pinned, selected]);

  // A `details` blob names a tag by NAME, never by id (auditNarrative.js's
  // `d.tagName`) — this is the one place that resolves one back to a live
  // catalog row for AuditSegments' hover chip, same fallback as every other
  // tag chip in the app when the name no longer matches (renamed, deleted).
  const tagsByName = useMemo(() => new Map((tags ?? []).map((t) => [t.name, t])), [tags]);

  const download = async () => {
    setExporting(true);
    setNotice("");
    try {
      const result = await exportAudit({ params: toQueryObject(filters) });
      if (!result?.ok) {
        setNotice(result?.error ?? "Could not build that export.");
        return;
      }
      const blob = new Blob([result.text], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(result.truncated ? `Exported the newest ${result.count} entries.` : `Exported ${result.count} entries.`);
    } catch (e) {
      console.error("Audit export failed:", e);
      setNotice("Could not build that export.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="desk-shell">
      <DeskHeader
        title="Audit"
        meta={
          <>
            {/* Unconditional. It used to vanish with the turn, so "no turn
                open" and "the chip has not loaded" looked the same. */}
            <DeskTurnChip turn={openTurn} />
            <LockChip />
            {freshCount > 0 && (
              <button type="button" className="chip" onClick={acknowledge}>
                {freshCount} new
              </button>
            )}
          </>
        }
        actions={
          <>
            {notice && <span className="text-muted text-xs">{notice}</span>}
            <div className="segmented" role="group" aria-label="Time format">
              <button type="button" aria-pressed={!absoluteTime} onClick={() => setAbsoluteTime(false)}>
                Ago
              </button>
              <button type="button" aria-pressed={absoluteTime} onClick={() => setAbsoluteTime(true)}>
                Clock
              </button>
            </div>
            {/* A real toggle, in the house form: a chip keyed on data-active
                plus aria-pressed (DESIGN-SYSTEM §5). As a .btn-quiet with a
                changing word it was the one control on the desk whose state
                you had to read the LABEL to know. */}
            <button
              type="button"
              className="chip"
              data-active={live ? "true" : undefined}
              aria-pressed={live}
              title={live ? "Stop following new entries" : "Follow new entries as they land"}
              onClick={() => setLive((v) => !v)}
            >
              Live
            </button>
            <button type="button" className="btn-secondary" disabled={exporting} onClick={() => download()}>
              CSV
            </button>
          </>
        }
      />

      <div className="desk-body">
        <div className="desk-rail">
          <AuditFilters
            filters={filters}
            set={set}
            typeCounts={typeCounts}
            actors={actors}
            characters={characters}
            factions={factions}
            zones={zones}
            turnNumbers={turnNumbers}
          />
        </div>

        <main className="desk-main audit-main">
          <AuditFeed
            entries={entries}
            names={names}
            tagsByName={tagsByName}
            selectedId={selected}
            onSelect={select}
            absoluteTime={absoluteTime}
            emptyMessage="Nothing matches these filters."
          />
          <Pager page={page} totalPages={totalPages} total={total} unit="entries" onPage={goToPage} />
        </main>

        <AuditInspector
          entry={current}
          names={names}
          tagsByName={tagsByName}
          onFilter={set}
          selectableZones={selectableZones}
          visibleZoneIds={visibleZoneIds}
        />
      </div>
    </div>
  );
}

// The filter state back into a query string. A module-level function rather
// than a closure, so the two useCallbacks above can list it as a dependency
// without it changing identity on every render.
function hrefFor(next) {
  const params = new URLSearchParams();
  const put = (key, value) => value && params.append(key, value);
  put("q", next.q);
  put("band", next.band);
  for (const v of next.families) put("family", v);
  for (const v of next.types) put("type", v);
  for (const v of next.actors) put("actor", v);
  put("actorKind", next.actorKind);
  for (const v of next.targets) put("target", v);
  for (const v of next.factions) put("faction", v);
  for (const v of next.zones) put("zone", v);
  put("turnFrom", next.turnFrom);
  put("turnTo", next.turnTo);
  put("preset", next.preset);
  put("from", next.from);
  put("to", next.to);
  if (next.page > 1) put("page", String(next.page));
  const qs = params.toString();
  // Back to the bare list, not to the selected entry: a filter change is a new
  // question, and keeping the old row pinned answers the previous one.
  return qs ? `/gm/audit?${qs}` : "/gm/audit";
}

function emptyFilters() {
  return {
    q: "",
    band: "",
    families: [],
    types: [],
    actors: [],
    actorKind: "",
    targets: [],
    factions: [],
    zones: [],
    turnFrom: "",
    turnTo: "",
    preset: "",
    from: "",
    to: "",
    page: 1,
  };
}

// The filter state as the plain object parseAuditParams() expects, for the
// export action — it re-parses rather than trusting a shape the client built.
function toQueryObject(f) {
  return {
    q: f.q,
    band: f.band,
    family: f.families,
    type: f.types,
    actor: f.actors,
    actorKind: f.actorKind,
    target: f.targets,
    faction: f.factions,
    zone: f.zones,
    turnFrom: f.turnFrom,
    turnTo: f.turnTo,
    preset: f.preset,
    from: f.from,
    to: f.to,
  };
}
