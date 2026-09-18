"use client";

// The Oracle desk. See docs/systemdocs/ORACLE.md.
//
// Three columns, the shape the other desks already use (.desk-body is a
// 19rem / 1fr / 22rem grid): the zone rail, one page of prose, and the shared
// inspector. Clicking a name in the prose is what fills the inspector, which is
// the whole reason this is a desk and not a document page.
//
// The right-hand column is web/app/components/InspectorColumn.js — the SAME
// component /gm/turns and /gm/players mount, with the same Sheet / Tags / Moves
// / Archive / DMs tabs. Nothing about it is rebuilt here; a name click asks it
// for the Moves tab through `requestedTab`, the way the adjudication desk's
// "Past moves" button does.

import { useCallback, useMemo, useState, useTransition } from "react";
import DeskRail from "@/app/components/DeskRail";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DiscordTime from "@/app/components/DiscordTime";
import InspectorColumn from "@/app/components/InspectorColumn";
import DevPanelModal from "@/app/components/DevPanelModal";
import GmZoneRail from "@/app/components/GmZoneRail";
import usePins from "@/app/components/usePins";
import { useVisibleZoneNames } from "@/app/components/GmZoneViewProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import OracleMarkdown from "./OracleMarkdown";
import { saveSynopsis, regenerateTurn } from "./actions";

const FRONT_PAGE = "__front__";
const THREATS_PAGE = "__threats__";

function EditBox({ page, onDone, onCancel }) {
  const [text, setText] = useState(page.body);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="field">
        <textarea
          value={text}
          rows={18}
          maxLength={20000}
          onChange={(event) => setText(event.target.value)}
          aria-label="Page"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() =>
            startSave(async () => {
              const res = await saveSynopsis({ id: page.id, body: text });
              if (res.ok) onDone(res.row);
              else setError(res.error);
            })
          }
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
    </div>
  );
}

export default function OracleDesk({
  turn,
  turns,
  pages,
  threads,
  zones,
  counts,
  roster,
  selectableZones,
  visibleZoneIds,
  visibleZoneNames,
  selectedKey,
  canRegenerate,
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [edits, setEdits] = useState(() => new Map());
  const [editing, setEditing] = useState(false);
  const [cache, setCache] = useState(() => new Map());
  const [devPanel, setDevPanel] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [tabRequest, setTabRequest] = useState(null);
  const [regenerating, startRegenerate] = useTransition();
  const [regenerateError, setRegenerateError] = useState(null);

  const zonesInView = useVisibleZoneNames(visibleZoneNames);
  const { pins, togglePin } = usePins({
    knownIdentities: useMemo(() => new Set(roster.map((r) => `c:${r.id}`)), [roster]),
  });

  const rosterById = useMemo(() => new Map(roster.map((r) => [r.id, r])), [roster]);

  // A page a GM saved in this session, over the server's copy. Avoids a full
  // desk reload for a change only this column shows.
  const pageFor = useCallback(
    (key) => {
      const base = pages.find((p) => p.key === key) ?? null;
      if (!base) return null;
      const edited = edits.get(base.id);
      return edited ? { ...base, ...edited } : base;
    },
    [pages, edits],
  );

  const page = pageFor(selectedKey);

  // When this turn's chronicle was last touched — the newest editedAt across
  // every page of it, not just the one on screen, because the header is about
  // the turn and the rail is about the page. `editedAt` has been shipped to
  // this component since the desk was built and nothing has ever drawn it, so
  // a GM opening the Oracle could not tell a page written an hour ago from one
  // written last week, or an empty turn from a failed run. Local edits count:
  // pageFor folds in anything saved this session, so saving a page updates
  // this line without a reload.
  const lastWritten = useMemo(() => {
    let newest = null;
    for (const p of pages) {
      const at = pageFor(p.key)?.editedAt;
      if (at && (!newest || at > newest)) newest = at;
    }
    return newest;
  }, [pages, pageFor]);

  // The zone rail honours GmZoneView the way every other desk does — as a
  // VIEW. The server still ships every page (GAMEMASTERS.md §1); this hides
  // rows a GM has filtered out, it does not defend them.
  const visibleZones = useMemo(
    () => (zonesInView ? zones.filter((z) => zonesInView.includes(z.name)) : zones),
    [zones, zonesInView],
  );

  const onInspect = useCallback(
    (characterId, _name, tab) => {
      const row = rosterById.get(characterId);
      if (!row) return;
      setInspected({ characterId: row.id, discordUserId: row.discordUserId, name: row.name });
      if (tab) setTabRequest((prev) => ({ tab, token: (prev?.token ?? 0) + 1 }));
    },
    [rosterById],
  );

  const pinned = useMemo(
    () =>
      pins
        .map((p) => (p.characterId ? rosterById.get(p.characterId) : null))
        .filter(Boolean)
        .map((r) => ({ characterId: r.id, discordUserId: r.discordUserId, name: r.name })),
    [pins, rosterById],
  );

  function select(key) {
    setEditing(false);
    router.replace(`/gm/oracle?turn=${turn.number}&page=${encodeURIComponent(key)}`, { scroll: false });
  }

  async function onRegenerate() {
    setRegenerateError(null);
    const ok = await confirm({
      title: `Regenerate turn ${turn.number}?`,
      message:
        "Every page a gamemaster has not rewritten is redrafted, then the front page. Pages with an edit are left alone. This takes a few minutes.",
      confirmLabel: "Regenerate",
    });
    if (!ok) return;
    startRegenerate(async () => {
      const res = await regenerateTurn(turn.number);
      if (res.ok) {
        router.refresh();
      } else {
        setRegenerateError(res.error);
      }
    });
  }

  return (
    // .desk-shell is what gives the three columns below a height to scroll
    // against — a 100dvh flex column, overflow hidden, the same wrapper turns,
    // players, audit and dev all open with. Without it .desk-body's `flex: 1`
    // had no flex parent to claim from, so the grid sized to its tallest
    // column, nothing scrolled internally, and the page stopped short of
    // .app-main's stretched 100dvh with dead space under it.
    //
    // DevPanelModal stays INSIDE the shell on purpose: the shell is deliberately
    // unpositioned and carries no z-index, so an in-tree .modal-overlay is not
    // trapped at this element's level (globals.css, above .desk-shell).
    <div className="desk-shell">
      {/* No DeskHeader any more. The turn/lock/clock chips it used to carry
          named the OPEN turn, which the universal top bar's own clock block
          already says — dropped as redundant there. What's left is this
          desk's own state: the turn SELECTOR (this page reads whichever turn
          you pick, not necessarily the open one) and the last-written note,
          neither of which the bar can say. */}
      <div className="desk-header">
        <div className="flex min-w-0 items-center gap-3">
          {/* Muted text, not a chip: it is a count-style fact, and only
              warnings take colour in a desk header (DESIGN-SYSTEM §5a). */}
          <span className="text-sm text-muted">
            {lastWritten ? (
              <>
                Last written <DiscordTime epoch={Math.floor(Date.parse(lastWritten) / 1000)} format="R" />
              </>
            ) : (
              "Not written yet"
            )}
          </span>
          {regenerateError ? <span className="text-sm text-danger">{regenerateError}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="field">
            <label className="field-label" htmlFor="oracle-turn">
              Turn
            </label>
            <select
              id="oracle-turn"
              className="mono"
              value={turn.number}
              onChange={(event) => router.push(`/gm/oracle?turn=${event.target.value}`)}
            >
              {turns.map((t) => (
                <option key={t.number} value={t.number}>
                  {t.number} · Day {t.dayNumber}
                </option>
              ))}
            </select>
          </div>
          {/* Superadmin like Run now on /gm/dev — replacing a whole turn's
              chronicle is host access, not an ordinary GM correction. */}
          {canRegenerate && (
            <button type="button" className="btn-quiet" disabled={regenerating} onClick={onRegenerate}>
              {regenerating ? "Regenerating…" : "Regenerate turn"}
            </button>
          )}
        </div>
      </div>

      <div className="desk-body">
        {/* .desk-queue-row, the same rail row /gm/turns and /gm/players use —
            this rail is the same tool as theirs and should look it. It used to
            reach for .desk-card, which is the WIDE READING CARD for the main
            column: max-width 52rem and margin 0 auto, so in a narrow rail every
            row centred itself into a rounded bubble instead of filling the
            width. The active row is data-active here rather than a border, so
            it wears the inset accent bar the other two desks use. */}
        <DeskRail as="aside" ariaLabel="Chronicle pages">
          <button
            type="button"
            className="desk-queue-row"
            data-active={selectedKey === FRONT_PAGE ? "true" : "false"}
            onClick={() => select(FRONT_PAGE)}
          >
            Front page
          </button>

          {/* No real Zone behind this one (ORACLE.md) — a seat-holder's own
              page, hardcoded here the same way Front page is, since it isn't
              part of the `zones` list either. */}
          <button
            type="button"
            className="desk-queue-row"
            data-active={selectedKey === THREATS_PAGE ? "true" : "false"}
            onClick={() => select(THREATS_PAGE)}
          >
            Threats
          </button>

          {visibleZones.map((zone) => {
            const count = counts[zone.id] ?? { present: 0 };
            return (
              <button
                key={zone.id}
                type="button"
                className="desk-queue-row"
                data-active={selectedKey === zone.slug ? "true" : "false"}
                onClick={() => select(zone.slug)}
              >
                {/* The flex row goes on an inner span, the way QueueRail's rows
                    do. .desk-queue-row is `display: block` and unlayered, and
                    unlayered CSS outranks @layer utilities — so a `flex` on the
                    button itself lost silently and the count sat flush against
                    the zone name ("Fortress25"). */}
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{zone.name}</span>
                  <span className="mono text-sm text-muted">{count.present}</span>
                </span>
              </button>
            );
          })}

          {threads.length > 0 && (
            <section className="flex flex-col gap-1 p-3">
              <h2 className="field-label">Threads</h2>
              {threads.map((thread) => (
                <p key={thread.name} className="text-sm">
                  <strong>{thread.name}</strong>
                  <br />
                  <span className="text-muted">{thread.state}</span>
                </p>
              ))}
            </section>
          )}
        </DeskRail>

        <main className="desk-main">
          {!page ? (
            <div className="desk-empty">
              <p>Nothing written for this turn yet.</p>
              <p className="text-sm">
                <Link href="/gm/dev?s=oracle">Settings</Link>
              </p>
            </div>
          ) : (
            // .desk-card is the wide reading card for a main column — max-width
            // 52rem, centred — so a synopsis keeps a readable line length on a
            // wide monitor instead of running the full 1fr cell. It brings its
            // own padding, and .desk-main already adds 1rem.
            <article className="desk-card flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="section-title">{page.title}</h2>
                {!editing && (
                  <button type="button" className="btn-quiet" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                )}
              </div>


              {editing ? (
                <EditBox
                  page={page}
                  onCancel={() => setEditing(false)}
                  onDone={(row) => {
                    setEdits((prev) => new Map(prev).set(row.id, row));
                    setEditing(false);
                  }}
                />
              ) : (
                <OracleMarkdown text={page.body} onInspect={onInspect} className="markdown-content" />
              )}
            </article>
          )}
        </main>

        <InspectorColumn
          inspected={inspected}
          pinned={pinned}
          roster={roster}
          onInspect={onInspect}
          onTogglePin={togglePin}
          cache={cache}
          setCache={setCache}
          tagsById={{}}
          currentTurnNumber={turn.number}
          pendingByCharacter={new Map()}
          onOpenDev={(characterId, name) => setDevPanel({ characterId, name })}
          requestedTab={tabRequest}
          emptyHint="Click a name to pull that character up here."
          footer={<GmZoneRail zones={selectableZones} selectedIds={visibleZoneIds} />}
        />
      </div>

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
