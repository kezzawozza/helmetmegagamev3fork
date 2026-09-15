"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import Select from "../Select";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { scoreMatch } from "@/lib/fuzzySearch";
import { birdMessageRequest } from "@/app/(app)/character/requestActions";

// Send Bird (docs/systemdocs/BIRD.md): who it is for, where you think they
// are, and which letter you are holding goes with it.
//
// The recipient list is EVERY character, alive or dead, unfiltered — and it
// stays a searched dropdown rather than chips. Narrowing it to the living
// would turn the picker into a casualty list that updates itself, and two
// hundred chips is worse than a select. The search narrows on the NAME THE
// PLAYER TYPED, which tells them nothing they did not already have to guess.
export default function BirdDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const targets = pools.birdTargets ?? [];
  const zones = pools.birdZones ?? [];
  const letters = pools.letterOptions ?? [];
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [tagId, setTagId] = useState(letters.length === 1 ? letters[0].tagId : "");
  const { submit, busy, error } = useSubmit();

  const q = query.trim();
  const choices = q ? targets.filter((t) => t.id === targetId || scoreMatch(q, { name: t.name })) : targets;

  const recipient = targets.find((t) => t.id === targetId) ?? null;

  return (
    <ActionDialog
      title="Send bird"
      submitLabel="Send it"
      busy={busy}
      error={error}
      empty={letters.length === 0 ? "You aren't carrying anything written. Use Write first." : null}
      canSubmit={Boolean(targetId && zoneId && tagId)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => birdMessageRequest({ recipientId: targetId, guessedZoneId: zoneId, tagId }),
          () => onDone(`The bird is away to ${recipient?.name ?? "them"}.`),
        )
      }
    >
      <label className="field">
        <span className="field-label">Who is it for?</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" data-autofocus />
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
          <option value="" disabled>
            Pick someone
          </option>
          {choices.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted mono">
          {choices.length} / {targets.length}
        </span>
      </label>
      <ChipPicker label="Where do you think they are?" options={zones.map((z) => ({ id: z.id, label: z.name }))} value={zoneId} onChange={setZoneId} />
      <ChipPicker
        label="Which letter?"
        options={letters.map((o) => ({ id: o.tagId, label: o.name, note: o.excerpt ?? null }))}
        value={tagId}
        onChange={setTagId}
      />
      <p className="text-xs text-muted">
        The bird takes it out of your hands. Guess the wrong place and it comes back with the letter still on it.
      </p>
    </ActionDialog>
  );
}
