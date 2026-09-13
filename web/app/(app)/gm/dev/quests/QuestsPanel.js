"use client";

// The Quests catalog: a rail of what is staged, and the one that is selected.
//
// Two jobs happen here and they want different shapes, which is why this is a
// split rather than a table. Scanning — what is live, where, how long has it
// got — is a glance down a list. Working on one is a form. A single wide table
// does the first job badly and the second not at all.
import { useMemo, useState, useTransition } from "react";

import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import StatusPill from "@/app/components/StatusPill";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  createQuestAction,
  updateQuestAction,
  closeQuestAction,
  deleteQuestAction,
} from "@/app/(app)/gm/dev/questActions";

const STATUS_TONE = { OPEN: "good", CLOSED: "neutral", EXPIRED: "warn" };

// What the rail shows instead of a date. A GM thinks in turns, and the number
// they actually scan for is how long they have got.
function clockLabel(quest) {
  if (quest.status !== "OPEN") return "—";
  if (quest.turnsLeft == null) return "no expiry";
  if (quest.turnsLeft <= 0) return "due";
  return `${quest.turnsLeft} turn${quest.turnsLeft === 1 ? "" : "s"}`;
}

function QuestForm({ value, onChange, locations, tags, characters }) {
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor="quest-title">
          Title
        </label>
        <input
          id="quest-title"
          type="text"
          value={value.title}
          maxLength={90}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quest-description">
          What is here
        </label>
        <textarea
          id="quest-description"
          rows={5}
          value={value.description}
          maxLength={1800}
          onChange={(e) => set({ description: e.target.value })}
        />
        <p className="text-sm text-muted">
          This is the room&apos;s starter post — the first thing anybody who walks in reads. Editing
          it rewrites that post in place, so nobody is pinged twice.
        </p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quest-location">
          Where
        </label>
        <Select
          id="quest-location"
          value={value.locationId}
          onChange={(e) => set({ locationId: e.target.value })}
          disabled={value.locked}
        >
          <option value="">Pick a place…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
        {value.locked ? (
          <p className="text-sm text-muted">
            A thread cannot change channels, so a staged quest stays where it was staged. Close it
            and stage another to move it.
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quest-expiry">
          Lasts
        </label>
        <input
          id="quest-expiry"
          type="number"
          min={0}
          value={value.expiresTurns}
          onChange={(e) => set({ expiresTurns: e.target.value })}
        />
        <p className="text-sm text-muted">
          In turns, counted from today. Zero or blank means it stands until somebody closes it.
        </p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quest-tags">
          Needs one of these
        </label>
        <select
          id="quest-tags"
          multiple
          size={6}
          value={value.accessTagSlugs}
          onChange={(e) => set({ accessTagSlugs: [...e.target.selectedOptions].map((o) => o.value) })}
        >
          {tags.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quest-people">
          …or is one of these people
        </label>
        <select
          id="quest-people"
          multiple
          size={6}
          value={value.allowedCharacterIds}
          onChange={(e) => set({ allowedCharacterIds: [...e.target.selectedOptions].map((o) => o.value) })}
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted">
          Leave both empty and anybody standing there can see it. Set either one and the room
          becomes private.
        </p>
      </div>
    </>
  );
}

const BLANK = {
  title: "",
  description: "",
  locationId: "",
  expiresTurns: "",
  accessTagSlugs: [],
  allowedCharacterIds: [],
  locked: false,
};

export default function QuestsPanel({
  quests,
  locations,
  tags,
  characters,
  canDelete,
  onAdvertise,
}) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const [selectedId, setSelectedId] = useState(quests[0]?.id ?? null);
  const [draft, setDraft] = useState(null);
  const [creating, setCreating] = useState(null);

  const selected = useMemo(() => quests.find((q) => q.id === selectedId) ?? null, [quests, selectedId]);

  // The rail, grouped by zone with the caves first — that is where a quest
  // usually goes, so it should not be a scroll away.
  const groups = useMemo(() => {
    const by = new Map();
    for (const q of quests) {
      if (!by.has(q.zoneName)) by.set(q.zoneName, { zoneName: q.zoneName, cave: q.cave, rows: [] });
      by.get(q.zoneName).rows.push(q);
    }
    return [...by.values()].sort((a, b) => {
      if (a.cave !== b.cave) return a.cave ? -1 : 1;
      return a.zoneName.localeCompare(b.zoneName);
    });
  }, [quests]);

  function pick(quest) {
    setSelectedId(quest.id);
    setError(null);
    setNote(null);
    setDraft(null);
  }

  const editing = draft ?? (selected
    ? {
        title: selected.title,
        description: selected.description,
        locationId: selected.locationId,
        expiresTurns: selected.turnsLeft == null ? "" : String(Math.max(selected.turnsLeft, 0)),
        accessTagSlugs: selected.accessTagSlugs,
        allowedCharacterIds: selected.allowedCharacterIds,
        locked: true,
      }
    : null);

  function run(fn, input, okNote) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await fn(input);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDraft(null);
      setNote(okNote);
      if (res?.questId) setSelectedId(res.questId);
    });
  }

  // Confirm first, transition second (DESIGN-SYSTEM.md §8) — awaiting the
  // dialog inside the transition deadlocks.
  async function close() {
    const ok = await confirm({
      title: `Close "${selected.title}"?`,
      message: "The room and its thread go. What people said they were doing there is kept.",
      confirmLabel: "Close it",
      cancelLabel: "Leave it open",
    });
    if (!ok) return;
    run(closeQuestAction, { questId: selected.id }, "Closed.");
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete "${selected.title}"?`,
      message:
        "This takes the record too — every Interact on it and what each person said they were trying to do. There is no undo.",
      confirmLabel: "Delete it",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    run(deleteQuestAction, { questId: selected.id }, "Deleted.");
    setSelectedId(null);
  }

  return (
    <div className="quest-desk">
      <div className="panel quest-rail">
        <div className="panel-header">
          <span>Staged</span>
          <button type="button" className="btn" onClick={() => setCreating({ ...BLANK })}>
            New quest
          </button>
        </div>

        {quests.length === 0 ? (
          <EmptyState>Nothing is staged. A new quest appears as a room wherever you put it.</EmptyState>
        ) : (
          groups.map((group) => (
            <div key={group.zoneName} className="quest-rail-group">
              <span className="quest-rail-zone">{group.zoneName}</span>
              {group.rows.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className="quest-rail-item"
                  data-active={q.id === selectedId ? "true" : undefined}
                  onClick={() => pick(q)}
                >
                  <span className="quest-rail-title">{q.title}</span>
                  <span className="quest-rail-meta">
                    <span className="text-sm text-muted">{q.locationName}</span>
                    <StatusPill tone={STATUS_TONE[q.status] ?? "neutral"}>{q.status}</StatusPill>
                    <span className="mono text-sm">{clockLabel(q)}</span>
                    <span className="mono text-sm">{q.interactionCount}×</span>
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="quest-detail">
        {!selected ? (
          <div className="panel">
            <EmptyState>Pick a quest, or stage a new one.</EmptyState>
          </div>
        ) : (
          <>
            <div className="panel">
              <div className="panel-header">
                <span>{selected.title}</span>
                <StatusPill tone={STATUS_TONE[selected.status] ?? "neutral"}>{selected.status}</StatusPill>
              </div>

              {selected.status === "OPEN" ? (
                <QuestForm
                  value={editing}
                  onChange={setDraft}
                  locations={locations}
                  tags={tags}
                  characters={characters}
                />
              ) : (
                <p className="text-sm text-muted">
                  This one is over. Its room is gone; what is below is what happened while it stood.
                </p>
              )}

              {note ? <p className="text-sm text-muted">{note}</p> : null}
              <FormError>{error}</FormError>

              <div className="modal-actions">
                {selected.status === "OPEN" ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending || !draft}
                      onClick={() =>
                        run(updateQuestAction, { questId: selected.id, ...editing }, "Saved.")
                      }
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={pending}
                      onClick={() => onAdvertise?.(selected)}
                    >
                      Advertise
                    </button>
                    <button type="button" className="btn-secondary" disabled={pending} onClick={close}>
                      Close now
                    </button>
                  </>
                ) : null}
                {canDelete ? (
                  <button type="button" className="btn-danger" disabled={pending} onClick={remove}>
                    Delete
                  </button>
                ) : null}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <span>Who has touched it</span>
                <span className="mono text-sm">{selected.interactions.length}</span>
              </div>
              {selected.interactions.length === 0 ? (
                <EmptyState>Nobody yet.</EmptyState>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Who</th>
                      <th>Turn</th>
                      <th>What they said they were doing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.interactions.map((i) => (
                      <tr key={i.id}>
                        <td>{i.characterName}</td>
                        <td className="mono">{i.turnNumber ?? "—"}</td>
                        <td>{i.intention}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {creating ? (
        <Modal open title="Stage a quest" onClose={() => setCreating(null)}>
          <QuestForm value={creating} onChange={setCreating} locations={locations} tags={tags} characters={characters} />
          <FormError>{error}</FormError>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              disabled={pending || !creating.title.trim() || !creating.locationId}
              onClick={() => {
                const input = { ...creating };
                setCreating(null);
                run(createQuestAction, input, "Staged. The room is up.");
              }}
            >
              Stage it
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
