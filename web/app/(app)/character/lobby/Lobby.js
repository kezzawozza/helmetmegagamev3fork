"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import PageShell from "@/app/components/PageShell";
import CheckField from "@/app/components/CheckField";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { ANTAGONISTS, optInName, optInWhitelisted } from "@/lib/threats";
import { LEVELS, setPriority, pickedNothing } from "@lifeweb/db/lib/playerPreferences";
import { savePreferences, setReady, setUnready } from "../lobbyActions";

// The pregame lobby (docs/systemdocs/LOBBY.md §2): roles down the left, and
// on the right — sticky, so it stays in view while scrolling forty roles —
// the Ready card, the fallback dropdown and the antagonist boxes. Controls
// and names only; the handbook explains the rest. Preferences save on every
// change, debounced; Ready is its own button.

const LEVEL_LABEL = { OFF: "Off", LOW: "Low", MEDIUM: "Med", HIGH: "High" };
const JOBLESS_OPTIONS = [
  { value: "MIGRANT", label: "Join as Migrant" },
  { value: "RETURN_TO_LOBBY", label: "Return to lobby" },
];
const NOTHING_LINE = {
  MIGRANT: "Every role is Off: you'll start as a Migrant.",
  RETURN_TO_LOBBY: "Every role is Off: you'll go back to the lobby.",
};
const SAVE_DELAY_MS = 400;

function PriorityControl({ slug, level, onChange }) {
  return (
    <div className="chip-row priority-row" role="radiogroup" aria-label="Priority">
      {["OFF", ...LEVELS].map((value) => {
        const active = (level ?? "OFF") === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`chip${value === "HIGH" ? " chip-high" : ""}`}
            data-active={active ? "true" : undefined}
            onClick={() => onChange(slug, value)}
          >
            {LEVEL_LABEL[value]}
          </button>
        );
      })}
    </div>
  );
}

export default function Lobby({ groups, initial, entry, readyCount, whitelisted, canSkip }) {
  const [priorities, setPriorities] = useState(initial.rolePriorities ?? {});
  const [optIns, setOptIns] = useState(initial.antagonistOptIns ?? []);
  const [jobless, setJobless] = useState(initial.joblessRole ?? "MIGRANT");
  const [readyAt, setReadyAt] = useState(entry?.readyAt ?? null);
  const [openIntro, setOpenIntro] = useState(null);
  const [, startSaving] = useTransition();
  const { run, pending, error, setError } = useActionRunner();
  const timer = useRef(null);
  const router = useRouter();

  // The three useStates above are for rendering; THIS is what a handler reads
  // and what a save sends. Reading the state instead was the mobile bug: two
  // taps inside one render batch both saw the pre-first-tap values, so the
  // first tap vanished from the payload — and because every payload carries
  // all three fields, an antagonist tap right after a priority tap sent the
  // old priorities with it.
  const draft = useRef({
    priorities: initial.rolePriorities ?? {},
    antagonistOptIns: initial.antagonistOptIns ?? [],
    joblessRole: initial.joblessRole ?? "MIGRANT",
  });
  // Bumped by every edit, captured when a save goes out. The other half of
  // the same bug: the server's echo used to land unconditionally, so a reply
  // to a question the player had already moved past would quietly un-tick the
  // box they just ticked.
  const revision = useRef(0);

  // The ready count is the one live thing on the page; a refresh every half
  // minute re-renders the server component with the current number.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(id);
  }, [router]);

  // Every change goes through here: the draft is the new truth, the three
  // states follow it so the page repaints, and one save is queued.
  function edit(next) {
    draft.current = next;
    revision.current += 1;
    setPriorities(next.priorities);
    setOptIns(next.antagonistOptIns);
    setJobless(next.joblessRole);
    queueSave();
  }

  // Debounced: a player sweeping down the list fires one save, not thirty.
  // Whatever the server normalized comes back and replaces the local copy —
  // it has to, because the server is the one that drops a whitelisted slug
  // and enforces the single High. But only while the answer still fits the
  // question: if the player has edited since this request went out, the reply
  // is stale and the newer save already queued will bring its own.
  function queueSave() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const sent = revision.current;
      const payload = draft.current;
      startSaving(async () => {
        try {
          const res = await savePreferences(payload);
          if (!res?.ok) setError(res?.error ?? "Couldn't save.");
          else {
            setError(null);
            if (revision.current !== sent) return;
            draft.current = {
              priorities: res.saved.rolePriorities,
              antagonistOptIns: res.saved.antagonistOptIns,
              joblessRole: res.saved.joblessRole,
            };
            setPriorities(res.saved.rolePriorities);
            setOptIns(res.saved.antagonistOptIns);
            setJobless(res.saved.joblessRole);
          }
        } catch {
          setError("Couldn't reach the server. Your last change may not have saved.");
        }
      });
    }, SAVE_DELAY_MS);
  }

  function changeLevel(slug, level) {
    edit({ ...draft.current, priorities: setPriority(draft.current.priorities, slug, level) });
  }

  function toggleOptIn(slug) {
    const held = draft.current.antagonistOptIns;
    const next = held.includes(slug) ? held.filter((s) => s !== slug) : [...held, slug];
    edit({ ...draft.current, antagonistOptIns: next });
  }

  // All/None over the boxes the player may actually tick. A whitelisted seat
  // they don't hold is left exactly as it is either way — the server drops it
  // anyway, and ticking it here would only bounce back on the next save.
  function setAllOptIns(on) {
    const takeable = ANTAGONISTS.filter((a) => whitelisted || !optInWhitelisted(a)).map((a) => a.slug);
    const held = draft.current.antagonistOptIns;
    const next = on
      ? [...new Set([...held, ...takeable])]
      : held.filter((slug) => !takeable.includes(slug));
    edit({ ...draft.current, antagonistOptIns: next });
  }

  function changeJobless(value) {
    edit({ ...draft.current, joblessRole: value });
  }

  function toggleReady() {
    if (readyAt) run(setUnready, undefined, { onOk: () => setReadyAt(null) });
    else run(setReady, undefined, { onOk: (res) => setReadyAt(res.readyAt) });
  }

  return (
    <PageShell width="wide">
      <h2 className="section-title">Lobby</h2>

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1fr)_22rem]">
        <aside className="flex flex-col gap-4 md:sticky md:top-6 md:order-2">
          <div className="panel flex flex-col gap-3 p-4" data-ready={readyAt ? "true" : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="lobby-dot" aria-hidden="true" />
                <strong>{readyAt ? "Ready" : "Not ready"}</strong>
                {readyAt ? (
                  <span className="text-sm text-muted">
                    since {new Date(readyAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                ) : null}
              </span>
              <span className="chip mono">{readyCount} ready</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={readyAt ? "btn-secondary" : "btn"} onClick={toggleReady} disabled={pending}>
                {pending ? "…" : readyAt ? "Unready" : "Ready up"}
              </button>
              {canSkip ? (
                <Link href="/character?create=1" className="btn-secondary">
                  Skip to character creation
                </Link>
              ) : null}
            </div>
            {pickedNothing(priorities) ? <p className="text-sm text-accent">{NOTHING_LINE[jobless]}</p> : null}
            <FormError>{error}</FormError>
          </div>

          <label className="field">
            <span className="field-label">If none are available</span>
            <Select value={jobless} onChange={(e) => changeJobless(e.target.value)}>
              {JOBLESS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>

          <section className="panel flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="panel-header">Antagonists</h2>
              <span className="flex gap-1">
                <button type="button" className="btn-quiet text-xs" onClick={() => setAllOptIns(true)}>
                  All
                </button>
                <button type="button" className="btn-quiet text-xs" onClick={() => setAllOptIns(false)}>
                  None
                </button>
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {ANTAGONISTS.map((a) => {
                // Two separate facts. `gated` is about the SEAT and is true
                // for everyone, which is what the Whitelist mark says — a
                // player who HOLDS the whitelist can still tell which of their
                // boxes are the gated ones. `locked` is about this player and
                // is what greys the row out.
                const gated = optInWhitelisted(a);
                const locked = gated && !whitelisted;
                return (
                  <CheckField
                    key={a.slug}
                    checked={optIns.includes(a.slug)}
                    onChange={() => toggleOptIn(a.slug)}
                    disabled={locked}
                    className={locked ? "is-locked" : ""}
                  >
                    {optInName(a)}
                    {gated ? <span className="ml-2 text-xs text-muted">Whitelist</span> : null}
                  </CheckField>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="flex flex-col gap-4 md:order-1">
          {groups.map((group) => (
            <div key={group.slug} className="flex flex-col gap-1">
              <h2 className="text-xs uppercase tracking-wide text-muted">{group.name}</h2>
              <ul className="panel divide-y divide-[var(--border)]">
                {group.roles.map((role) => (
                  <li
                    key={role.id}
                    className="lobby-role"
                    // Whitelisted, and separately blocked-for-you. The border
                    // is on the first, so a player who HOLDS the whitelist can
                    // still tell which of their seats are the gated ones.
                    data-whitelisted={role.requiresWhitelist ? "true" : undefined}
                    data-locked={role.whitelistBlocked ? "true" : undefined}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <button
                          type="button"
                          className="lobby-role-name"
                          onClick={() => setOpenIntro(openIntro === role.id ? null : role.id)}
                          aria-expanded={openIntro === role.id}
                        >
                          {role.name}
                          {role.grantsLeader ? <span title="Leader"> ★</span> : null}
                        </button>
                        <span className="text-xs text-muted">{role.factionName}</span>
                      </div>
                      {openIntro === role.id && role.intro ? (
                        <p className="mt-1 text-sm text-muted">{role.intro}</p>
                      ) : null}
                    </div>
                    {role.whitelistBlocked ? (
                      <span className="text-xs text-muted">Whitelist</span>
                    ) : (
                      <PriorityControl slug={role.slug} level={priorities[role.slug]} onChange={changeLevel} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </PageShell>
  );
}
