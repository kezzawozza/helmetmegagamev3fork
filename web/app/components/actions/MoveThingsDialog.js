"use client";

import { useMemo, useState } from "react";
import ChipPicker from "../ChipPicker";
import QuantityField from "../QuantityField";
import StackPicker, { pickedLines } from "../StackRow";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { transferableTags } from "@/lib/tagRequests";
import { transferRequest, lootCharacterRequest, stealRequest } from "@/app/(app)/character/requestActions";

// Moving things: one dialog for Transfer, Loot, Take, Drop and Give.
//
// Two chip rows say which way the things are going — from You, a room here
// or somebody helpless, to You, a person here or a room — and then the
// source's stacks are rows with a count each (StackRow.js), plus a ⬢ box.
// This replaced two dropdowns, a checkbox list and a "How many?" field per
// tick, and a separate Loot dialog that was a third dropdown over the same
// body (docs/systemdocs/CARRY.md).
//
// The server paths are unchanged. Out of a person's pockets IS Loot —
// lootCharacterRequest, with the helpless gate, the mood hit and the "your
// body was searched" notice — whichever button opened this. Everything else
// is transferRequest. A concealed person is offered as a destination under
// an opaque "hood:<token>" key (web/lib/peoplePools.js).
//
// `presets` seeds the ends and a first pick: Chat's room panel opens this
// three ways (Drop, Take, a click straight on a stack), and the HERE list's
// Transfer names the person. Loot's button opens it with nothing assumed but
// the direction.

// formatTagWeight's wording, over the per-row number this dialog has already
// normalised for all three sources — the Assets rule included, which is why it
// cannot just call formatTagWeight(tag) and get the same answer for a horse.
// Null when a thing weighs nothing against the cap, so the row says nothing
// rather than "0 lb".
function weightNote(each, quantity = 1) {
  const per = Number(each) || 0;
  if (per <= 0) return null;
  const n = Math.max(1, Number(quantity) || 1);
  const total = Math.round(per * n * 100) / 100;
  return n === 1 ? `${per} lb` : `${per} lb each · ${total} lb`;
}

function stackLabel(name, quantity) {
  return quantity > 1 ? `${name} ×${quantity}` : name;
}

export default function MoveThingsDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const selfId = pools.selfId;
  const selfKey = selfId ? `character:${selfId}` : "";
  const loot = mode === "loot";
  // Steal (docs/systemdocs/THEFT.md §1) is this dialog with both ends decided:
  // out of a stash, into your own hands. It is the same act Take already
  // performs, which is why it is a mode here rather than a dialog of its own —
  // the only difference is which server action carries it and whether the room
  // is told.
  const steal = mode === "steal";

  const { roster, loading } = useRoster(["people", "rooms", "self"], {
    seed: {
      people: { transferParties: pools.transferParties?.characters ?? [], lootTargets: pools.lootTargets ?? [] },
      rooms: pools.transferParties?.rooms ?? [],
      self: { characterTags: pools.characterTags ?? [], carry: pools.carry ?? null },
    },
  });
  const people = roster?.people?.transferParties ?? [];
  const lootable = roster?.people?.lootTargets ?? [];
  const rooms = roster?.rooms ?? [];
  const carry = roster?.self?.carry ?? pools.carry ?? null;
  const mine = useMemo(() => transferableTags(roster?.self?.characterTags ?? []), [roster]);

  const [fromKey, setFromKey] = useState(presets?.fromKey ?? (loot || steal ? "" : selfKey));
  const [toKey, setToKey] = useState(presets?.toKey ?? (loot || steal ? selfKey : ""));
  const [picks, setPicks] = useState(() => {
    const seed = presets?.picks ?? {};
    return Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, String(v)]));
  });
  const [amount, setAmount] = useState("0");
  const { submit, busy, error } = useSubmit();

  const fromSelf = fromKey === selfKey;
  const fromRoom = fromKey.startsWith("room:") ? rooms.find((r) => `room:${r.id}` === fromKey) : null;
  // `lootTargets` rows arrive already keyed — "character:<id>" for somebody
  // named, "hood:<token>" for somebody (or some body) in a mask — so the match
  // is on the key itself rather than one rebuilt here.
  const fromPerson =
    (fromKey.startsWith("character:") || fromKey.startsWith("hood:")) && !fromSelf
      ? (lootable.find((c) => c.id === fromKey) ?? null)
      : null;
  const toSelf = toKey === selfKey;
  const toIsCharacter = toKey.startsWith("character:") || toKey.startsWith("hood:");

  // Sources: you, the rooms you can get into, and anybody who can't stop
  // you. Loot opens with you left out — the point is what you are taking.
  const sources = steal
    ? rooms.map((r) => ({ id: `room:${r.id}`, label: r.name, note: "room" }))
    : [
        ...(loot ? [] : [{ id: selfKey, label: "You" }]),
        ...rooms.map((r) => ({ id: `room:${r.id}`, label: r.name, note: "room" })),
        ...lootable.map((c) => ({
          id: c.id,
          label: c.name,
          note: c.status === "DEAD" ? "dead" : (c.condition ?? "helpless").toLowerCase(),
        })),
      ];
  // What comes off a person goes in YOUR hands — there is no verb for going
  // through somebody's pockets straight into a cupboard, and the server
  // refuses it.
  // Stealing goes in YOUR hands and nowhere else. There is no verb for lifting
  // something off a shelf straight into somebody else's pocket, and the server
  // forces the destination regardless of what is posted.
  const destinations = fromPerson || steal
    ? [{ id: selfKey, label: "You" }]
    : [
        ...(fromSelf ? [] : [{ id: selfKey, label: "You" }]),
        ...people
          .filter((c) => c.id !== selfId)
          .map((c) => ({ id: `${c.kind ?? "character"}:${c.id}`, label: c.name, note: c.kind === "hood" ? "hooded" : null })),
        ...rooms.filter((r) => `room:${r.id}` !== fromKey).map((r) => ({ id: `room:${r.id}`, label: r.name, note: "room" })),
      ];

  // What the source has on offer, as StackRow rows.
  //
  // `tag` is what makes the row a chip you can ask questions of. Your own
  // stack IS the tag (transferableTags spreads it), a room hands one over
  // beside the counts, and a helpless person's pockets deliberately hand over
  // none — those stay a name and a weight (REQUESTS.md §5b).
  const offered = fromSelf
    ? mine.map((t) => ({
        id: t.id,
        name: t.name,
        tag: t,
        held: t.quantity,
        stackable: t.stackable,
        // Assets weigh nothing on your back (CARRY.md §1).
        weightLbs: t.category === "Assets" ? 0 : (t.weightLbs ?? 0),
        // Detector surface (M4 fix round) — only meaningful from YOUR own
        // stack (own-sheet detection is the design); a room's own tags or a
        // person's own pockets below carry no such field and render nothing.
        poisonMarker: Boolean(t.poisonMarker),
      }))
    : fromPerson
      ? fromPerson.tags.map((t) => ({
          id: t.tagId,
          name: t.tagName,
          held: t.quantity,
          stackable: t.stackable,
          weightLbs: t.weightLbs ?? 0,
        }))
      : (fromRoom?.tags ?? []).map((t) => ({
          id: t.tagId,
          name: t.name,
          tag: t.tag ?? null,
          held: t.quantity,
          stackable: t.stackable,
          weightLbs: t.weightLbs ?? 0,
        }));
  // A non-stackable tag pins at one per character, so a pull out of a room
  // to a person is one at a time.
  const rows = offered.map((t) => ({
    ...t,
    max: t.stackable || !toIsCharacter ? t.held : 1,
    // The poison marker keeps the front: it is a warning, and the weight is a
    // fact. Both, when both apply.
    note: [t.poisonMarker ? "smells wrong" : null, weightNote(t.weightLbs, t.held)]
      .filter(Boolean)
      .join(" · ") || null,
  }));
  // `carry` carries no ⬢ figure any more (carryStatus is weight-only since the
  // second cap went), so the self case reads the sheet's own count.
  const balance = fromSelf ? (pools.resources ?? 0) : fromRoom ? fromRoom.resources : fromPerson ? fromPerson.resources : null;

  const lines = pickedLines(picks).filter((l) => rows.some((r) => r.id === l.tagId));
  const moved = Number(amount) || 0;
  const sameParty = Boolean(fromKey) && fromKey === toKey;
  const taking = lines.length > 0 || moved > 0;

  // Projection: what YOUR load looks like after this moves. Only meaningful
  // when one end is you, and not for what comes off a body (Loot never
  // charged the carry cap for that, CARRY.md §2).
  // ⬢ weigh a pound each and count against the one weight cap alongside the
  // gear (CARRY.md) — there is no second cap to check any more.
  const lbs = lines.reduce((n, l) => n + (rows.find((r) => r.id === l.tagId)?.weightLbs ?? 0) * l.quantity, 0) + moved;
  const round = (n) => Math.round(n * 100) / 100;
  let projected = null;
  // Weight only. `lbs` above already includes the ⬢ being moved, at a pound
  // each, so a separate ⬢ term would be the same units counted twice — and
  // carryStatus stopped returning a ⬢ balance when the second cap went.
  if (carry && fromSelf) projected = { weight: round(carry.weightUsed - lbs) };
  else if (carry && toSelf && !fromPerson) projected = { weight: round(carry.weightUsed + lbs) };
  const overAfter = projected && projected.weight > carry.weightCap;
  const refusedAfter = projected && projected.weight > carry.weightHardCap;

  function nameOf(key) {
    if (key === selfKey) return "you";
    const [kind, id] = key.split(":");
    if (kind === "room") return rooms.find((r) => r.id === id)?.name ?? "the room";
    // `people` (transferParties) carries bare ids and hood tokens, `lootable`
    // carries whole keys — hence the two lookups.
    return people.find((c) => c.id === id)?.name ?? lootable.find((c) => c.id === key)?.name ?? "them";
  }

  function whatMoved() {
    const parts = lines.map((l) => {
      const row = rows.find((r) => r.id === l.tagId);
      return stackLabel(row?.name ?? "something", l.quantity);
    });
    if (moved > 0) parts.push(`${moved} ⬢`);
    return parts.join(", ");
  }

  function onSubmit() {
    const what = whatMoved();
    // Deliberately outcome-BLIND for a steal. The server never returns the die
    // and this line never varies, so nothing here can be read backwards into
    // whether the room saw you — the room's own thread is what tells you that.
    const line = steal
      ? `Took ${what} from ${nameOf(fromKey)}.`
      : fromPerson
      ? `Took ${what} off ${nameOf(fromKey)}.`
      : fromSelf
        ? toKey.startsWith("room:")
          ? `Left ${what} in ${nameOf(toKey)}.`
          : `Gave ${nameOf(toKey)} ${what}.`
        : toSelf
          ? `Took ${what} from ${nameOf(fromKey)}.`
          : `Moved ${what} from ${nameOf(fromKey)} to ${nameOf(toKey)}.`;
    const tags = lines.map((l) => ({ tagId: l.tagId, quantity: String(l.quantity) }));
    submit(
      () =>
        steal
          ? stealRequest({ fromKey, tags })
          : fromPerson
            ? lootCharacterRequest({ targetCharacterId: fromPerson.id, tagPicks: tags, amount })
            : transferRequest({ fromKey, toKey, tags, amount }),
      () => onDone(line),
    );
  }

  const nothingToTake = (loot || steal) && !loading && sources.length === 0;

  return (
    <ActionDialog
      title={steal ? "Steal" : loot ? "Loot" : "Transfer"}
      submitLabel={steal ? "Take it" : loot ? "Take" : "Move it"}
      width="wide"
      busy={busy}
      error={error}
      loading={loading && sources.length === 0}
      empty={nothingToTake ? (steal ? "There's no stash here you can get into." : "Nothing here to search.") : null}
      canSubmit={Boolean(fromKey && toKey && !sameParty && taking && !refusedAfter)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="From"
        options={sources}
        value={fromKey}
        onChange={(key) => {
          setFromKey(key);
          setPicks({});
          setAmount("0");
          // Out of somebody's pockets only ever goes to you.
          if (key.startsWith("character:") && key !== selfKey) setToKey(selfKey);
          else if (toKey === key) setToKey("");
        }}
        emptyLabel="Nothing here to take from."
      />
      {fromKey && (
        <ChipPicker
          label="To"
          options={destinations}
          value={toKey}
          onChange={setToKey}
          emptyLabel="Nobody here to give it to."
        />
      )}
      {sameParty && <p className="text-xs text-accent">Source and recipient are the same.</p>}

      {fromKey && (
        <div className="panel flex flex-col gap-3 p-3">
          <span className="field-label">{fromSelf ? "Give" : "Take"}</span>
          <StackPicker
            rows={rows}
            picks={picks}
            onChange={setPicks}
            emptyLabel={
              fromRoom
                ? "Nothing is stored here."
                : fromPerson
                  ? "They're carrying nothing worth taking."
                  : "You're carrying nothing you could hand over."
            }
          />
          {!steal && (
          <QuantityField
            inline={false}
            label={`Resources${balance != null ? ` (of ${balance})` : ""}`}
            min={0}
            max={balance ?? undefined}
            value={amount}
            onChange={setAmount}
          />
          )}
        </div>
      )}

      {projected && (
        <p className={`text-xs ${overAfter || refusedAfter ? "text-accent" : "text-muted"}`}>
          After this you&apos;ll carry {projected.weight} / {carry.weightCap} lb.
          {refusedAfter
            ? " That's more than you could hold even overburdened, so it won't go through."
            : overAfter
              ? " That's more than you can manage — you'll be Overburdened until you set some down."
              : ""}
        </p>
      )}
    </ActionDialog>
  );
}
