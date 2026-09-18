"use client";

import { useEffect, useState } from "react";
import AvatarZoom from "./AvatarZoom";
import Modal from "./Modal";
import Select from "./Select";
import FormError from "./FormError";
import TagChip from "./TagChip";
import { useTags } from "./TagsProvider";
import { peopleToExamine, examineCharacter } from "@/app/(app)/character/examineActions";

// Look at — the Examine control. One of two grid entries filing no Request
// (ReadDialog.js is the other), so it gets its own plain modal. See
// examineActions.js for why the feature exists. Two round trips on purpose:
// roster loads when the dialog opens, readout loads when a name is picked.
// `targetId` skips the picker but not the re-check: examineCharacter()
// re-resolves the looker and re-checks co-presence, so a stale id is refused.
export default function ExamineDialog({ open, onClose, targetId = null }) {
  if (!open) return null;
  // Keyed on the target so a second person starts a fresh look, not reused state.
  return <ExamineDialogBody key={targetId ?? "picker"} onClose={onClose} targetId={targetId} />;
}

function ExamineDialogBody({ onClose, targetId = null }) {
  const preset = Boolean(targetId);
  const [roster, setRoster] = useState({ loading: !preset, people: [], error: null });
  const [chosen, setChosen] = useState(targetId ?? "");
  const [look, setLook] = useState({ loading: preset, readout: null, error: null });

  // One fetch or the other, never both.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (preset) {
        const res = await examineCharacter(targetId);
        if (cancelled) return;
        if (res?.ok) setLook({ loading: false, readout: res.readout, error: null });
        else setLook({ loading: false, readout: null, error: res?.error ?? "You can't see them." });
        return;
      }
      const res = await peopleToExamine();
      if (cancelled) return;
      if (res?.ok) setRoster({ loading: false, people: res.people, error: null });
      else setRoster({ loading: false, people: [], error: res?.error ?? "Couldn't see who's here." });
    })();
    return () => {
      cancelled = true;
    };
  }, [preset, targetId]);

  async function pick(id) {
    setChosen(id);
    if (!id) {
      setLook({ loading: false, readout: null, error: null });
      return;
    }
    setLook({ loading: true, readout: null, error: null });
    const res = await examineCharacter(id);
    if (res?.ok) setLook({ loading: false, readout: res.readout, error: null });
    else setLook({ loading: false, readout: null, error: res?.error ?? "You can't see them." });
  }

  return (
    <Modal title="Look at" onClose={onClose}>
      <div className="mt-3 flex flex-col gap-3">
        {roster.loading && <p className="text-sm text-muted">Looking around…</p>}
        {roster.error && <FormError>{roster.error}</FormError>}

        {!preset && !roster.loading && !roster.error && roster.people.length === 0 && (
          <p className="text-sm text-muted">There is nobody else here.</p>
        )}

        {!preset && roster.people.length > 0 && (
          <label className="field">
            <span className="field-label">Who</span>
            <Select value={chosen} onChange={(e) => pick(e.target.value)}>
              <option value="">Pick somebody…</option>
              {roster.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
        )}

        {look.loading && <p className="text-sm text-muted">Looking…</p>}
        {look.error && <FormError>{look.error}</FormError>}
        {look.readout && <Readout readout={look.readout} />}
      </div>
    </Modal>
  );
}

// What you can see, as hoverable chips. The catalog is already in the tree
// (TagsProvider), so resolving a slug costs no round trip. A slug the catalog
// does not have falls back to a plain chip — a custom or system-authored tag by design.
function SeenTags({ tags }) {
  const { tagsBySlug } = useTags();
  return (
    <div className="field">
      <span className="field-label">What you can see</span>
      <div className="chip-row">
        {tags.map((t) => {
          const full = t.slug ? tagsBySlug.get(t.slug) : null;
          return (
            <span key={t.slug ?? t.name} className="inline-flex items-center gap-1">
              {full ? <TagChip tag={full} /> : <span className="chip">{t.name}</span>}
              {/* The detail is about THIS sighting, not the tag, so it stays outside the chip. */}
              {t.detail && <span className="text-xs text-muted">({t.detail})</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function Readout({ readout }) {
  return (
    <div className="panel flex flex-col gap-3" style={{ padding: "0.75rem" }}>
      <div className="flex items-center gap-2">
        {/* A plain <img>, not CharacterAvatar: that would build its own
            /api/avatar/<id> URL and serve the real face under a hood. */}
        <AvatarZoom src={readout.avatarPath} name={readout.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={readout.avatarPath}
            alt=""
            width={32}
            height={32}
            style={{ borderRadius: "var(--r-full)", objectFit: "cover", flexShrink: 0 }}
          />
        </AvatarZoom>
        <strong>{readout.name}</strong>
      </div>

      {readout.line && <p className="text-sm text-muted">{readout.line}</p>}
      {readout.appearance && <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{readout.appearance}</p>}

      {/* Above the gear, because an office is part of who somebody is rather
          than a thing found on them. Null for a hood and for the four seats
          nobody reads off a look — decided once in db/lib/examine.js. */}
      <Line label="Role" values={readout.roleTitle ? [readout.roleTitle] : null} />

      <Line label="Ailments" values={readout.ailments} />
      <Line label="Equipment" values={readout.equipment} />

      {readout.tags.length > 0 && <SeenTags tags={readout.tags} />}

      {/* Only when the looker holds the sight that buys it — db/lib/inspectVision.js. */}
      {readout.desire && (
        <div className="field">
          <span className="field-label">Last Desire</span>
          <p className="text-sm">
            {readout.desire.text ? `» ${readout.desire.text} (+${readout.desire.points})` : "Nothing you can read."}
          </p>
        </div>
      )}
    </div>
  );
}

function Line({ label, values }) {
  if (!values || values.length === 0) return null;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <p className="text-sm">{values.join(", ")}</p>
    </div>
  );
}
