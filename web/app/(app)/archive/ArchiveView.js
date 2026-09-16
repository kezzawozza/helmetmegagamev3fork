"use client";

import { useCallback, useState } from "react";
import useArchiveScroll from "@/app/components/useArchiveScroll";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import Switch from "@/app/components/Switch";
import EmptyState from "@/app/components/EmptyState";
import useSessionState from "@/app/components/useSessionState";
import { gameTitle } from "@/lib/gameLabel";
import { activeArchiveFilters, archiveParamsToQuery } from "@/lib/archiveQuery";
import ArchiveTranscript from "./ArchiveTranscript";

// The transcript's controls and its scroll.
//
// FILTERS LIVE IN THE URL, not in this component's state. Narrowing pushes a
// new query and the server re-renders the first screen; the stream below is
// keyed on that query so it remounts with the new rows rather than trying to
// reconcile them (react-hooks/set-state-in-effect is an error here, so a
// "reset when the props change" effect is not available and would be the wrong
// shape anyway). The view stays shareable: what you are reading is in the link
// even though how far you have scrolled is not.
//
// The two VIEW toggles sit above that remount on purpose — narrowing to one
// speaker should not turn your portraits back off — and they live in
// sessionStorage so a reload keeps them.

const VIEW_KEY = "archive:view";
const VIEW_DEFAULT = { groupScenes: true, portraits: false };

export default function ArchiveView({ game, games, currentGameId, zones, characters, filters, total, first }) {
  const router = useRouter();
  const [view, setView] = useSessionState(VIEW_KEY, VIEW_DEFAULT);
  const [drawer, setDrawer] = useState(false);
  const query = archiveParamsToQuery(filters);
  const active = activeArchiveFilters(filters);

  // One place that writes a link, so no control invents its own query string.
  const go = useCallback(
    (overrides) => {
      const next = archiveParamsToQuery(filters, overrides);
      router.push(next ? `/archive?${next}` : "/archive");
    },
    [filters, router],
  );

  return (
    <>
      <div className="archive-bar">
        <form
          className="archive-search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: new FormData(e.currentTarget).get("q")?.toString().trim() ?? "" });
          }}
        >
          <input name="q" defaultValue={filters.q} placeholder="anything said…" aria-label="Search the transcript" />
        </form>

        {/* The one filter people reach for every visit, so it stays out of the
            drawer: a day is unreadable with the world's own lines folded in
            and unfinishable without them. */}
        <div className="segmented" role="group" aria-label="What to show">
          <button type="button" aria-pressed={filters.show === "speech"} onClick={() => go({ show: "speech" })}>
            Speech
          </button>
          <button type="button" aria-pressed={filters.show === "all"} onClick={() => go({ show: "all" })}>
            Everything
          </button>
        </div>

        <button type="button" className="btn" onClick={() => setDrawer(true)}>
          Filters{active.length ? ` · ${active.length}` : ""}
        </button>

        <div className="archive-bar-spacer" />

        <Switch checked={view.groupScenes} onChange={(e) => setView({ ...view, groupScenes: e.target.checked })}>
          Scenes
        </Switch>
        <Switch checked={view.portraits} onChange={(e) => setView({ ...view, portraits: e.target.checked })}>
          Faces
        </Switch>
      </div>

      {/* What is narrowed, always visible and always removable. A filter set in
          the drawer and forgotten about is the reason the drawer needs these. */}
      {active.length ? (
        <div className="archive-chips">
          {active.map((f) => (
            <button key={f.key} type="button" className="chip" onClick={() => go({ [f.key]: "" })}>
              {f.label} <span aria-hidden="true">×</span>
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button type="button" className="archive-chips-clear" onClick={() => go({ q: "", day: "", zone: "", character: "" })}>
            Clear all
          </button>
        </div>
      ) : null}

      <ArchiveStream key={query} query={query} first={first} view={view} total={total} onPick={go} />

      <Modal open={drawer} onClose={() => setDrawer(false)} title="Filters">
        <div className="archive-drawer">
          <label className="field">
            <span className="field-label">Game</span>
            <Select
              value={filters.game || game.id}
              onChange={(e) => {
                setDrawer(false);
                // A different game is a different transcript, so everything
                // narrowing THIS one is dropped rather than carried over to a
                // game whose zones and people are not the same.
                router.push(`/archive?game=${encodeURIComponent(e.target.value)}`);
              }}
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameTitle(g)}
                  {g.id === currentGameId ? " · current" : g.archivedAt ? " · archived" : ""}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Day</span>
            <input
              type="number"
              min="1"
              defaultValue={filters.day}
              placeholder="any"
              onBlur={(e) => go({ day: e.target.value.trim() })}
            />
          </label>
          <label className="field">
            <span className="field-label">Zone</span>
            <Select value={filters.zone} onChange={(e) => go({ zone: e.target.value })}>
              <option value="">Anywhere</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Speaker</span>
            <Select value={filters.character} onChange={(e) => go({ character: e.target.value })}>
              <option value="">Anyone</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Order</span>
            <Select value={filters.order} onChange={(e) => go({ order: e.target.value })}>
              <option value="asc">Oldest first</option>
              <option value="desc">Newest first</option>
            </Select>
          </label>
        </div>
      </Modal>
    </>
  );
}

// The rows, and nothing else. Remounted whenever the filter changes, which is
// what keeps "what is on screen" and "what was asked for" from disagreeing.
function ArchiveStream({ query, first, view, total, onPick }) {
  // Rows, cursor and the sentinel come from the shared hook — the GM
  // inspector's Archive tab scrolls the same transcript through the same
  // endpoint, and two copies of this would eventually disagree.
  const { rows, done, failed, more, sentinel } = useArchiveScroll({ query, first });

  const cite = useCallback((row) => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#e${row.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
  }, []);

  if (rows.length === 0) {
    return <EmptyState>No line in this game matches that.</EmptyState>;
  }

  return (
    <>
      <ArchiveTranscript
        rows={rows}
        groupScenes={view.groupScenes}
        portraits={view.portraits}
        onPick={onPick}
        onCite={cite}
      />
      <div className="archive-more" ref={done ? undefined : sentinel}>
        {failed ? (
          <button type="button" className="btn" onClick={more}>
            That didn&rsquo;t load. Try again
          </button>
        ) : done ? (
          <span className="text-muted">
            {rows.length} of {total} · that is all of it
          </span>
        ) : (
          <span className="text-muted">
            {rows.length} of {total}…
          </span>
        )}
      </div>
    </>
  );
}
