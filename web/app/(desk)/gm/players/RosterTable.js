"use client";

import { noteActionVersion } from "@/app/components/useDeskVersion";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import StatusPill, { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import MatchHint from "@/app/components/MatchHint";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import DevPanelModal from "@/app/components/DevPanelModal";
import Select from "@/app/components/Select";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import ZoneChip from "@/app/components/ZoneChip";
import Pager from "@/app/components/Pager";
import { filterTagsByQuery, sortForMode, tagsById as buildTagsById } from "@/lib/characterCreation";
// bulkTagCharacters stays in (app) — it is shared GM plumbing, not this
// desk's own, so it keeps its home rather than following the table here.
import { bulkTagCharacters } from "@/app/(app)/gm/actions";
import BulkComposer from "./BulkComposer";
import { inVisibleZones } from "@/lib/zones";
import { useVisibleZoneNames } from "@/app/components/GmZoneViewProvider";

// The roster: the whole fleet at once, with the columns a GM actually asks
// about mid-turn. The old /gm/players table had nine and could not answer
// "who still hasn't moved" — the question that comes up most in the back half
// of a turn — so Acted and Tags are new here, as is the name linking into the
// player's own desk rather than only into the Dev Panel.
//
// Only two bulk verbs, and that is deliberate: message and tag are GM-safe.
// Bulk zone moves stay a superadmin verb on /gm/dev, so a button for it here
// would fail for most of the people looking at it.

// Eleven: the checkbox, nine columns of fact, and one Flags cell. Cursed,
// Catatonic and Acted used to be three columns of their own, each holding a
// word or a dash — three column-widths spent saying "no" about nearly every
// row. Folded into one cell of chips they cost nothing when empty and read as
// a set when they are not, and the table stopped needing a permanent
// horizontal scroll to reach Resources.
const COL_COUNT = 9;

// "Zone" is where the character is STANDING, and there is only the one zone
// now. It used to mean the seat — the zone their faction was keyed to — with
// the physical one beside it as "Standing in"; with factions gone there is no
// seat to keep apart from the feet, so a GM's desk follows the feet.
// Status is a fixed CharacterStatus vocabulary — options: lists every value
// so "Cursed" doesn't vanish from the dropdown just because nobody's cursed
// this turn. Zone stays derived from the loaded rows, since it legitimately
// varies game to game.
// Acted is a FILTER rather than a sortable column now that it lives in the
// Flags cell. That is the better control for the question it answers — "who
// still hasn't moved" wants the other forty rows gone, not pushed to page two
// — and it only exists while a turn is open, since with none there is nothing
// to have acted in.
const FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (c) => c.zoneName },
  { key: "status", label: "Status", value: (c) => c.status, options: ["ALIVE", "DEAD", "CURSED"] },
];

const ACTED_FILTER = {
  key: "acted",
  label: "Acted",
  value: (c) => (c.acted ? "Acted" : "Not acted"),
  options: ["Acted", "Not acted"],
};

// scoreMatch fields. `tag` is every tag name the character holds, which is
// what makes a search reach the sheet: the role was the only proxy for it
// before, and that does not cover a Smith who took Pale.
const CHARACTER_STATUS_TEXT = { ALIVE: "Alive", DEAD: "Dead", CURSED: "Cursed" };
const searchMapFor = (c) => ({
  name: c.name,
  role: c.roleTitle,
  zone: c.zoneName,
  username: c.username || c.globalName,
  status: CHARACTER_STATUS_TEXT[c.status] ?? c.status,
  tag: c.tag,
});

export default function RosterTable({
  characters,
  tags = [],
  visibleZoneNames,
  hasOpenTurn,
}) {
  // Keyed on character id rather than row index, so a selection survives
  // paging, filtering and sorting — the recipient list is what gets sent.
  const [selected, setSelected] = useState(new Set());
  const [composerOpen, setComposerOpen] = useState(false);
  const [tagBarOpen, setTagBarOpen] = useState(false);
  // { characterId, name } of the Dev Panel currently open as a modal over
  // this desk, or null. Mirrors the adjudication desk's Workspace.js —
  // opening it never leaves /gm/players or resets the roster's filters.
  const [devPanel, setDevPanel] = useState(null);

  const filterDefs = useMemo(
    () => (hasOpenTurn ? [...FILTER_DEFS, ACTED_FILTER] : FILTER_DEFS),
    [hasOpenTurn],
  );
  // The prop is only the seed — see PlayerRail.
  const zonesInView = useVisibleZoneNames(visibleZoneNames);
  // The zones this GM chose to see (null = all). Not a default filter — rows
  // outside it never reach the table, so its own Zone dropdown narrows within
  // what is visible rather than reaching past it.
  //
  // It is a VIEW, not enforcement: the server still ships every row, and a GM
  // who wants a hidden one can reach it by URL. The real boundary is the
  // Discord half (GAMEMASTERS.md §6) — this side is about not drowning.
  const inView = useMemo(
    () => inVisibleZones(characters, zonesInView),
    [characters, zonesInView],
  );

  const {
    query,
    setQuery,
    filters,
    setFilters,
    sort,
    toggleSort,
    options,
    matchFor,
    pageRows,
    page,
    setPage,
    total,
    totalPages,
  } = useTableState({
    rows: inView,
    filterDefs,
    searchMap: searchMapFor,
    initialSort: { key: "name", dir: "asc" },
  });

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Select-all applies to the filtered page, not the whole roster — a header
  // checkbox that quietly picks up 100 people you cannot see is how a
  // broadcast goes to the wrong room.
  const pageAllSelected = pageRows.length > 0 && pageRows.every((c) => selected.has(c.id));
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of pageRows) {
        if (pageAllSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        /* "Filter roster", not "Search players": the rail beside this one
           already owns the word Search ("Search inbox"), and this box does
           not reach past the rows on screen the way that one does. Two
           boxes, two verbs. */
        searchLabel="Filter roster"
        searchPlaceholder="name, role, zone, @handle…"
      >
        <button
          type="button"
          className="btn"
          disabled={selected.size === 0}
          onClick={() => setComposerOpen(true)}
        >
          Message selected ({selected.size})
        </button>
        <button
          type="button"
          className="btn"
          disabled={selected.size === 0}
          onClick={() => setTagBarOpen((open) => !open)}
        >
          Tag selected ({selected.size})
        </button>
        {selected.size > 0 && (
          <button type="button" className="btn-quiet" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        )}
      </FilterBar>

      {tagBarOpen && selected.size > 0 && (
        <BulkTagBar
          tags={tags}
          count={selected.size}
          characterIds={[...selected]}
          onDone={() => {
            setTagBarOpen(false);
            setSelected(new Set());
          }}
        />
      )}

      {/* Ten columns plus the checkbox, down from thirteen. 1050px is the
          width at which no row wraps to a second line with a real roster
          in it — measured, not guessed: below about 1000px the names start
          breaking over two lines and every row grows, which costs more
          vertical room than the horizontal scroll ever cost. It is still a
          long way down from 1230px.

          It does NOT fit the desk's middle column at 1440 (694px of room),
          so the frame keeps its horizontal scroll. Folding the three flag
          columns cut how far you have to push it from about 535px to about
          355px — better, not solved. Making it fit outright means dropping
          a column somebody asked for or narrowing the inspector, and
          neither is this batch's call. */}
      <TableScroll minWidth="880px">
        <thead>
          <tr>
            <th scope="col" className="col-fit">
              <input
                type="checkbox"
                checked={pageAllSelected}
                onChange={togglePage}
                aria-label="Select every player on this page"
              />
            </th>
            <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortHeader label="Discord" sortKey="username" sort={sort} onSort={toggleSort} />
            <SortHeader label="Role" sortKey="roleTitle" sort={sort} onSort={toggleSort} />
            <SortHeader label="Zone" sortKey="zoneName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
            <th scope="col">Flags</th>
            <SortHeader label="Tags" sortKey="tagCount" sort={sort} onSort={toggleSort} />
            <SortHeader label="Resources" sortKey="resources" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((c) => {
            const match = matchFor(c);
            return (
            <tr key={c.id}>
              {/* The box itself stays 16px; the padding is what makes the
                  tap target reach the 44px minimum. */}
              <td style={{ padding: "12px 14px" }}>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={`Select ${c.name}`}
                />
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <CharacterAvatar
                    characterId={c.id}
                    name={c.name}
                    version={c.avatarVersion}
                    catatonic={c.catatonic}
                    zoomable
                  />
                  {/* Straight into their conversation — the verb this desk
                      exists for. The Dev Panel is one click further, off
                      the name itself. */}
                  <Link href={`/gm/players/${c.discordUserId}`} className="menu-item">
                    {c.name}
                  </Link>
                  <MatchHint
                    match={match}
                    values={{ role: c.roleTitle, zone: c.zoneName }}
                  />
                  <DevCharacterButton
                    characterId={c.id}
                    name={c.name}
                    onOpen={() => setDevPanel({ characterId: c.id, name: c.name })}
                  />
                </div>
              </td>
              <td className="text-muted">{c.username ? `@${c.username}` : c.globalName || "-"}</td>
              <td>{c.roleTitle ?? "-"}</td>
              <td>
                <ZoneChip zoneName={c.zoneName} />
              </td>
              <td>
                <EnumPill map={CHARACTER_STATUS} value={c.status} />
              </td>
              {/* Three states that are nearly always absent, in one cell.
                  Catatonic is AFK, from the auto-granted catatonic tag
                  (db/lib/catatonicPass.js), not a CharacterStatus. "Not
                  acted" is the only one drawn for its ABSENCE, because
                  absence is the thing a GM is hunting in the back half of
                  a turn; with no turn open there is nothing to say. */}
              <td>
                <div className="flex flex-wrap items-center gap-1">
                  {c.cursed && <StatusPill tone="bad">Cursed</StatusPill>}
                  {c.catatonic && <StatusPill tone="warn">Catatonic</StatusPill>}
                  {hasOpenTurn &&
                    (c.acted ? (
                      <StatusPill tone="good">Acted</StatusPill>
                    ) : (
                      <StatusPill tone="warn">Not acted</StatusPill>
                    ))}
                  {!c.cursed && !c.catatonic && !hasOpenTurn && (
                    <span className="text-muted">-</span>
                  )}
                </div>
              </td>
              <td className="mono">{c.tagCount}</td>
              <td className="mono">{c.resources} ⬢</td>
            </tr>
            );
          })}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={COL_COUNT} className="text-center text-muted">
                No characters match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </TableScroll>

      <Pager page={page} totalPages={totalPages} total={total} unit="players" onPage={setPage} />

      {/* One bulk-message UI on this desk, not two. "Message selected" used
          to unfold its own inline panel with a bare textarea — no recipient
          list you could edit, no character count, no zone shortcuts —
          beside a BulkComposer that already had all four and was reachable
          from the desk header. Same modal now, opened with the roster's
          selection already ticked. */}
      {composerOpen && (
        <BulkComposer
          characters={inView}
          initialSelectedIds={[...selected]}
          onClose={() => setComposerOpen(false)}
        />
      )}

      {devPanel && (
        <DevPanelModal
          characterId={devPanel.characterId}
          name={devPanel.name}
          onClose={() => setDevPanel(null)}
        />
      )}
    </div>
  );
}

// Grant or revoke one tag across every selected row. The heavy lifting is
// bulkTagCharacters, which runs a transaction per character rather than one
// over the batch and reports partial success — so a single bad character
// can't roll back the rest.
function BulkTagBar({ tags, count, characterIds, onDone }) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [tagId, setTagId] = useState("");
  const [result, setResult] = useState(null);

  // Chain-aware ("group") rather than cost-then-name, so a chain's rungs sit
  // together in tier order in the picker.
  const sorted = useMemo(() => sortForMode(tags, "group", buildTagsById(tags)), [tags]);
  const matches = useMemo(() => filterTagsByQuery(sorted, query).slice(0, 40), [sorted, query]);

  // Narrowing the search until the chosen tag drops out of the list would
  // otherwise leave the <select> rendering blank while tagId still held the
  // old value — and both buttons enabled, ready to grant a tag nobody can
  // see. Cleared in the setter rather than an effect
  // (react-hooks/set-state-in-effect is an error in this repo).
  function changeQuery(next) {
    setQuery(next);
    if (tagId && !filterTagsByQuery(sorted, next).slice(0, 40).some((t) => t.id === tagId)) {
      setTagId("");
    }
  }

  function apply(mode) {
    setResult(null);
    startTransition(async () => {
      const res = noteActionVersion(await bulkTagCharacters({ characterIds, tagId, mode }));
      if (!res?.ok) {
        setResult({ error: res?.error ?? "Something went wrong." });
        return;
      }
      setResult(res);
      if (!res.failed) onDone();
    });
  }

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">Find a tag</span>
          <input
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder="Name, description, or group"
          />
        </label>
        <label className="field">
          <span className="field-label">
            Tag to apply to {count} character{count === 1 ? "" : "s"}
          </span>
          <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">Choose a tag…</option>
            {matches.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.category}] {t.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={pending || !tagId} onClick={() => apply("grant")}>
          Grant to all
        </button>
        <button type="button" className="btn-quiet" disabled={pending || !tagId} onClick={() => apply("revoke")}>
          Revoke from all
        </button>
        <button type="button" className="btn-quiet" onClick={onDone} disabled={pending}>
          Close
        </button>
      </div>

      <FormError>{result?.error}</FormError>
      {result?.ok && (
        <p className="text-sm text-muted">
          {result.tagName}: applied to {result.applied}
          {result.failed ? `, failed on ${result.failed}` : ""}.
        </p>
      )}
    </div>
  );
}
