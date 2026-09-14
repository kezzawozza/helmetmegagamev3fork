"use client";

import { useState } from "react";
import { nameKey } from "@/lib/characterName";

// TYPED names, held as chips — no server list to pick from, unlike ChipPicker: a dropdown
// here would be a roster of everybody alive in Ravenheart (WarrantDialog.js). House form
// (DESIGN-SYSTEM.md §5): `data-active` but no `aria-pressed` (a REMOVE control, not a toggle).
// Blur commits a half-typed name — losing it on Save is the one thing a control like this must not do.
export default function NameChips({ label, names, onChange, max = 12, maxLength = 100, disabled = false }) {
  const [draft, setDraft] = useState("");

  function commit(raw) {
    const name = (raw ?? "").trim().replace(/\s+/g, " ");
    setDraft("");
    if (!name || names.length >= max) return;
    // Dedupe the way the server matches — nameKey folds case and whitespace.
    if (names.some((n) => nameKey(n) === nameKey(name))) return;
    onChange([...names, name]);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && names.length > 0) {
      e.preventDefault();
      onChange(names.slice(0, -1));
    }
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {names.length > 0 ? (
        <div className="chip-row" role="group" aria-label={label}>
          {names.map((name) => (
            <button
              key={nameKey(name)}
              type="button"
              className="chip"
              data-active="true"
              disabled={disabled}
              aria-label={`Remove ${name}`}
              onClick={() => onChange(names.filter((n) => nameKey(n) !== nameKey(name)))}
            >
              {name}
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      ) : null}
      <input
        type="text"
        value={draft}
        disabled={disabled || names.length >= max}
        placeholder={names.length >= max ? "You can't watch for more people." : "Type a name, press Enter"}
        autoComplete="off"
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
