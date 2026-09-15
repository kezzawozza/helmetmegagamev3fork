"use client";

// One picker, six verbs. The Dev Panel's whole "pick an audience, then say or
// do one thing to all of them" surface.
//
// It used to be four sections: Bulk actions (move/resources/tag), Send a
// letter, Say something, and the Quests panel's Broadcast tab. Four pickers,
// four previews, four send buttons, and three of the four could only reach one
// target at a time — a letter went to one character, a line went into one
// place. They share a question, so they now share a screen, and the multi-select
// comes free with it.
//
// Everything arrives as flat props from the page, so this file imports nothing
// from db/lib and the browser bundle stays clear of it.
import { useMemo, useState, useTransition } from "react";

import Select from "@/app/components/Select";
import CheckPicker from "@/app/components/CheckPicker";
import usePickList from "@/app/components/usePickList";
import FormError from "@/app/components/FormError";
import Switch from "@/app/components/Switch";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { applyBulkAction, sendAmbientLine, sendGmLetters } from "@/app/(app)/gm/dev/actions";
import { sendGmBroadcast } from "@/app/(desk)/gm/players/actions";
import { AUDIENCE, PREVIEW, VERBS, PLACE_KINDS, plural, subtext, verbByKey } from "./bulkVerbs";

export default function BulkActions({
  characters,
  locations,
  tags,
  places,
  prefill,
  messageMaxLength,
}) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  // Prefill arrives as INITIAL state, never synced in an effect
  // (react-hooks/set-state-in-effect is an error here). Advertise on a quest is
  // a real navigation to ?s=bulk&verb=say&…, so a reload keeps the prefill
  // instead of dropping it — which is what the old client-state handoff could
  // not do.
  const [verb, setVerb] = useState(() => verbByKey(prefill?.verb ?? "move").key);
  const [placeKind, setPlaceKind] = useState(prefill?.kind ?? "location");
  const [text, setText] = useState(prefill?.text ?? "");

  // Two audiences, two live selections. Switching Move → Say → Move must not
  // lose the roster you just picked.
  const people = usePickList(characters);
  const placeList = places[placeKind] ?? [];
  const placesPicked = usePickList(placeList, prefill?.placeId ? [prefill.placeId] : []);

  const [zoneFilter, setZoneFilter] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.locations?.[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [resourceMode, setResourceMode] = useState("add");
  const [tagSlug, setTagSlug] = useState(tags[0]?.slug ?? "");
  const [tagMode, setTagMode] = useState("grant");
  const [senderName, setSenderName] = useState("");
  const [sealed, setSealed] = useState(false);
  const [sealLabel, setSealLabel] = useState("");
  const [sealMark, setSealMark] = useState("");

  const active = verbByKey(verb);
  const onPeople = active.audience === AUDIENCE.PEOPLE;

  const zones = useMemo(
    () => [...new Set(characters.map((c) => c.zoneName).filter(Boolean))].sort(),
    [characters],
  );
  // The zone dropdown narrows the LIST; CheckPicker's own filter box narrows
  // what is left. Two filters over one picker, which is why the dropdown rides
  // in the toolbar slot rather than being a prop.
  const peopleItems = useMemo(
    () => (zoneFilter ? characters.filter((c) => c.zoneName === zoneFilter) : characters),
    [characters, zoneFilter],
  );

  const locationName = useMemo(() => {
    for (const group of locations) {
      const hit = group.locations.find((l) => l.id === locationId);
      if (hit) return `${group.zoneName} — ${hit.name}`;
    }
    return "";
  }, [locations, locationId]);

  const tagName = tags.find((t) => t.slug === tagSlug)?.name ?? "";
  const picked = onPeople ? people : placesPicked;
  const who = onPeople
    ? plural(people.count, "character", "characters")
    : plural(placesPicked.count, placeKind, `${placeKind}s`);

  // The sentence Apply will carry out, in the words a GM would use. It is also
  // what the confirm dialog repeats back, so there is one description of the
  // change rather than two that can disagree.
  const sentence = useMemo(() => {
    if (picked.count === 0) return onPeople ? "Nobody picked yet." : "Nowhere picked yet.";
    switch (verb) {
      case "move":
        return locationName ? `Moves ${who} to ${locationName}.` : "Pick a location.";
      case "resources": {
        const n = Number(amount);
        if (!Number.isInteger(n)) return "Type a whole number.";
        return resourceMode === "set" ? `Sets ${who} to ${n} ⬢.` : `Gives ${who} ${n > 0 ? "+" : ""}${n} ⬢.`;
      }
      case "tag":
        if (!tagName) return "Pick a tag.";
        return tagMode === "remove" ? `Takes ${tagName} off ${who}.` : `Grants ${tagName} to ${who}.`;
      case "message":
        return `Sends ${who} a direct message from Bascinet.`;
      case "letter":
        return senderName ? `Sends ${who} a letter from ${senderName}.` : "Say who it's from.";
      case "say":
        return `Says it in ${who}.`;
      default:
        return "";
    }
  }, [picked.count, onPeople, verb, locationName, amount, resourceMode, tagName, tagMode, senderName, who]);

  const over = messageMaxLength != null && verb === "message" && text.length > messageMaxLength;

  const ready =
    picked.count > 0 &&
    ((verb === "move" && locationId) ||
      (verb === "resources" && amount !== "" && Number.isInteger(Number(amount))) ||
      (verb === "tag" && tagSlug) ||
      (verb === "message" && text.trim() && !over) ||
      (verb === "letter" && text.trim() && senderName.trim() && (!sealed || (sealLabel.trim() && sealMark.trim()))) ||
      (verb === "say" && text.trim()));

  function reset() {
    setError(null);
    setNote(null);
  }

  // Confirm first, transition second (DESIGN-SYSTEM.md §8). Awaiting the
  // dialog inside the transition deadlocks: the prompt needs an immediate
  // render, the transition cannot commit until the promise settles, and the
  // promise cannot settle until somebody clicks a dialog that never mounted.
  async function apply() {
    reset();
    const ok = await confirm({
      title: onPeople ? "Apply to everyone picked?" : "Say this everywhere picked?",
      message:
        active.preview === PREVIEW.RENDERING
          ? `${sentence} ${text.trim().split("\n")[0]}`
          : `${sentence} There is no Undo — the audit log is the only record.`,
      confirmLabel: verb === "say" ? "Say it" : "Apply",
      cancelLabel: "Not yet",
    });
    if (!ok) return;

    startTransition(async () => {
      if (verb === "say") {
        // One call per target, SEQUENTIALLY — never Promise.all. Discord rate
        // limits, and a fan-out across a whole zone list is exactly the shape
        // that earns a ban. sendAmbientLine re-checks GmZoneView per call, so
        // a partial failure is possible and is reported per target.
        const said = [];
        const refused = [];
        for (const id of placesPicked.picked) {
          const res = await sendAmbientLine({ kind: placeKind, targetId: id, text });
          if (res?.ok) said.push(res.said);
          else refused.push(placeList.find((p) => p.id === id)?.label ?? id);
        }
        if (said.length > 0) setNote(`Said in ${said.join(", ")}.`);
        if (refused.length > 0) setError(`Refused for ${refused.join(", ")}.`);
        if (said.length > 0 && refused.length === 0) setText("");
        return;
      }

      if (verb === "message") {
        // sendGmBroadcast already fans out sequentially on the server, inside
        // after() — so this is one call, not a loop. The shared internal for
        // this verb and /gm/players' composer is the ACTION, not a loop.
        const res = await sendGmBroadcast({ characterIds: people.picked, message: text.trim() });
        if (!res?.ok) {
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        setNote(`Sent to ${plural(people.count, "player", "players")}.`);
        setText("");
        return;
      }

      if (verb === "letter") {
        const res = await sendGmLetters({
          recipientIds: people.picked,
          senderName,
          body: text,
          sealed,
          sealLabel,
          sealMark,
        });
        if (!res?.ok) {
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        setNote(res.message);
        setText("");
        return;
      }

      const res = await applyBulkAction({
        kind: verb,
        characterIds: people.picked,
        locationId,
        amount: Number(amount),
        mode: verb === "tag" ? tagMode : resourceMode,
        tagSlug,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setNote(`Applied to ${plural(res.applied ?? people.count, "character", "characters")}.`);
      people.clear();
    });
  }

  return (
    <div className="desk-card grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-3">
        {onPeople ? (
          <CheckPicker
            label="Who"
            items={peopleItems}
            value={people.picked}
            onChange={people.set}
            filterPlaceholder="Name or place…"
            emptyLabel="Nobody matches."
            searchThreshold={0}
            toolbar={
              <label className="field">
                <span className="field-label">Zone</span>
                <Select
                  value={zoneFilter}
                  onChange={(e) => setZoneFilter(e.target.value)}
                  className="min-w-40"
                >
                  <option value="">Everywhere</option>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </label>
            }
          />
        ) : (
          <>
            {/* A kind is one value, so aria-pressed — .segmented is a control
                with a value and a screen reader has to reach it. */}
            <div className="segmented self-start">
              {PLACE_KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  aria-pressed={placeKind === k.key}
                  onClick={() => {
                    setPlaceKind(k.key);
                    placesPicked.clear();
                    reset();
                  }}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <CheckPicker
              label="Where"
              items={placeList}
              value={placesPicked.picked}
              onChange={placesPicked.set}
              emptyLabel="Nowhere to say it — no channel here is mirrored yet."
            />
            {prefill?.unreachableZoneName ? (
              <p className="text-sm text-muted">
                {prefill.unreachableZoneName} has no summary channel to advertise into.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {/* A verb is one value, so aria-pressed, not data-active. */}
        <div className="segmented">
          {VERBS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={verb === v.key}
              onClick={() => {
                setVerb(v.key);
                reset();
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {verb === "move" ? (
          <label className="field">
            <span className="field-label">Location</span>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((group) => (
                <optgroup key={group.zoneName} label={group.zoneName}>
                  {group.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
        ) : null}

        {verb === "resources" ? (
          <>
            <div className="segmented">
              <button type="button" aria-pressed={resourceMode === "add"} onClick={() => setResourceMode("add")}>
                Add
              </button>
              <button type="button" aria-pressed={resourceMode === "set"} onClick={() => setResourceMode("set")}>
                Set
              </button>
            </div>
            <label className="field">
              <span className="field-label">Resources</span>
              <input
                type="number"
                step="1"
                value={amount}
                placeholder={resourceMode === "add" ? "+3 or -3" : "0"}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </>
        ) : null}

        {verb === "tag" ? (
          <>
            <div className="segmented">
              <button type="button" aria-pressed={tagMode === "grant"} onClick={() => setTagMode("grant")}>
                Grant
              </button>
              <button type="button" aria-pressed={tagMode === "remove"} onClick={() => setTagMode("remove")}>
                Remove
              </button>
            </div>
            <label className="field">
              <span className="field-label">Tag</span>
              <Select value={tagSlug} onChange={(e) => setTagSlug(e.target.value)}>
                {tags.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : null}

        {verb === "letter" ? (
          <label className="field">
            <span className="field-label">From</span>
            <input
              type="text"
              maxLength={80}
              value={senderName}
              placeholder="God-King Enoch II"
              onChange={(e) => setSenderName(e.target.value)}
            />
          </label>
        ) : null}

        {active.preview === PREVIEW.RENDERING ? (
          <label className="field">
            <span className="field-label">
              {verb === "say" ? "The line" : verb === "letter" ? "The letter" : "The message"}
            </span>
            <textarea
              rows={verb === "letter" ? 8 : 5}
              value={text}
              placeholder={verb === "say" ? "Something drips, far back in the dark." : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        ) : null}

        {verb === "letter" ? (
          <>
            <div className="ops-toggle">
              <Switch checked={sealed} onChange={(e) => setSealed(e.target.checked)}>
                Sealed
              </Switch>
            </div>
            {sealed ? (
              <>
                <label className="field">
                  <span className="field-label">Seal name</span>
                  <input
                    type="text"
                    maxLength={40}
                    value={sealLabel}
                    placeholder="Royal"
                    onChange={(e) => setSealLabel(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">What the wax carries</span>
                  <input
                    type="text"
                    maxLength={200}
                    value={sealMark}
                    placeholder="A crown over crossed howitzers."
                    onChange={(e) => setSealMark(e.target.value)}
                  />
                </label>
              </>
            ) : null}
          </>
        ) : null}

        {/* The audience line is drawn for EVERY verb, so the count is never
            buried inside a sentence for half of them and missing from the
            other half. The panel under it is always here too — a preview that
            appears and disappears moves everything below it. */}
        <div className="flex flex-col gap-2">
          <span className="field-label">What happens</span>
          <p className="mono text-sm text-muted">{who} picked</p>
          {active.preview === PREVIEW.RENDERING ? (
            <pre className="desk-move-text whitespace-pre-wrap">
              {!text ? "—" : verb === "say" ? subtext(text) : text}
            </pre>
          ) : (
            <p className="desk-move-text">» {sentence}</p>
          )}
          {verb === "say" ? (
            <p className="text-xs text-muted">
              Subtext, one prefix per line. It sits under the conversation rather than in it.
            </p>
          ) : null}
          {over ? (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {text.length} / {messageMaxLength}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn" disabled={!ready || pending} onClick={apply}>
            {pending ? "Working…" : verb === "say" ? "Say it" : "Apply"}
          </button>
          {note ? <span className="text-sm text-muted">{note}</span> : null}
          <FormError>{error}</FormError>
        </div>
      </div>
    </div>
  );
}
