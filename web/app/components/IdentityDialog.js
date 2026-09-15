"use client";

import { useState, useTransition } from "react";
import { NAME_LIMITS } from "@/lib/characterName";
import { randomCharacterName } from "@/lib/nameCorpus";
import RequestDialog from "./RequestDialog";
import { changeNameRequest } from "../(app)/character/requestActions";

// Drinking a Mulligan Potion. It lives with the tags rather than on the Bio
// card, because the bottle is what you click — the tag rail routes that one
// tag's Consume button here instead of consuming it, and every other
// consumable just goes.
//
// All four parts of a name, unlike every other player-facing form: this is the
// one door through which a prefix is typed rather than earned and the quoted
// title is written by anyone but a GM (docs/systemdocs/CHARACTERS.md §1b).
// changeNameRequestImpl re-checks the potion, the caps and the dynasty lock —
// a server action is a public endpoint, so what's here is only the form.
//
// `identity` is the server-resolved prop bag from character/page.js: the
// potion's tag id, the name parts to seed the fields with, whether the last
// name is a dynasty's, and the gender the Randomize button rolls against.
export default function IdentityDialog({ identity, open, onClose }) {
  const [honorific, setHonorific] = useState(identity?.honorific ?? "");
  const [firstName, setFirstName] = useState(identity?.firstName ?? "");
  const [title, setTitle] = useState(identity?.title ?? "");
  const [lastName, setLastName] = useState(identity?.lastName ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const lastNameLocked = identity?.lastNameLocked ?? false;

  // Same rule as the creation wizard: the character's own gender picks the
  // name pool, and a dynasty surname is left alone rather than rolled and
  // discarded.
  function rollName() {
    const rolled = randomCharacterName({
      gender: identity?.gender ?? "NEUTRAL",
      lastNameLocked,
    });
    setFirstName(rolled.firstName);
    if (!lastNameLocked) setLastName(rolled.lastName ?? "");
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await changeNameRequest({ honorific, firstName, title, lastName });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      onClose();
    });
  }

  return (
    <RequestDialog
      open={open}
      title="New identity"
      submitLabel="Drink it"
      busy={pending}
      error={error}
      canSubmit={Boolean(firstName.trim())}
      onCancel={() => !pending && onClose()}
      onConfirm={submit}
    >
      <p className="text-muted text-xs">
        What would you like your identity to be? This is permanent.
      </p>
      <label className="field">
        <span className="field-label">Prefix</span>
        <input
          value={honorific}
          onChange={(e) => setHonorific(e.target.value)}
          maxLength={NAME_LIMITS.honorific}
        />
      </label>
      <label className="field">
        <span className="field-label">First name</span>
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          maxLength={NAME_LIMITS.firstName}
          required
        />
      </label>
      {/* Rendered in quotes between the first and last name by
          formatCharacterName, so it needs no explaining here — the sheet
          shows the result the moment this closes. */}
      <label className="field">
        <span className="field-label">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={NAME_LIMITS.title}
        />
      </label>
      <label className="field">
        <span className="field-label">Last name</span>
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          maxLength={NAME_LIMITS.lastName}
          disabled={lastNameLocked}
        />
      </label>
      <div className="flex items-center justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={rollName}>
          Randomize name
        </button>
      </div>
    </RequestDialog>
  );
}
