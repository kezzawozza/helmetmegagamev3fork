"use client";

import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRefresh } from "@/app/components/useRefresh";
import IconButton from "@/app/components/IconButton";
import RequestDialog from "@/app/components/RequestDialog";
import Select from "@/app/components/Select";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  SkullIcon,
  AnkhIcon,
  UncurseIcon,
  RestoreIcon,
  SkipIcon,
  MessageIcon,
  TrashIcon,
  WoundIcon,
  BandageIcon,
  MealIcon,
  MapIcon,
  ResourcesIcon,
} from "@/app/components/icons";
import {
  killCharacterNow,
  reviveCharacter,
  setCurseOverride,
  restoreTurn,
  spendTurn,
  messageCharacter,
  teleportCharacter,
  deleteCharacter,
  transferResources,
} from "./actions";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";

// The microaction row. Verbs, not values.
//
// Every button here FIRES: its own server action, its own audit row, and its
// effect the moment it is confirmed. All of them touch things the staged form
// deliberately does not carry — status, the Action row, where they stand, the
// tags — so any of them can be used mid-edit without racing the Apply bar.
//
// Inflict wound, heal all, feed and a Refund points button used to stage
// instead, which made them three buttons in a row of verbs that looked like
// they fired and didn't. The tag three fire now, Refund points is gone, and
// what is left is a clean split: columns stage, verbs and tags fire.
export default function ActionBar({
  character,
  canDelete,
  curse,
  hasActed,
  openTurn,
  locations,
  transferRoster,
  tags,
  held,
  feed,
  onApplyTags,
  refresh,
  onDeleted,
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [routeRefresh] = useRefresh();
  const doRefresh = refresh ?? routeRefresh;
  const doDeleted = onDeleted ?? (() => router.push("/gm/players"));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  // What the last of these buttons just did. An unlabelled icon that changes
  // something out of view reads as a dead button, which is exactly how it was
  // first reported — so each one says so in a line beneath the row.
  const [done, setDone] = useState(null);
  const [dialog, setDialog] = useState(null); // "message" | "delete" | "wound" | "transfer" | "teleport"
  const [draft, setDraft] = useState("");
  const [transferFromKey, setTransferFromKey] = useState("");
  const [transferToKey, setTransferToKey] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [teleportQuery, setTeleportQuery] = useState("");

  const alive = character.status === "ALIVE";
  const heldIds = new Set(held.map((h) => h.tagId));

  // Name or zone, case-insensitive — there are 50+ Locations and no grouping
  // in this list, so typing "town" or "gate" is the only fast way to one.
  const teleportMatches = useMemo(() => {
    const q = teleportQuery.trim().toLowerCase();
    if (!q) return locations ?? [];
    return (locations ?? []).filter(
      (l) => l.name.toLowerCase().includes(q) || (l.zoneName ?? "").toLowerCase().includes(q),
    );
  }, [locations, teleportQuery]);

  // The Transfer dialog's party picker: this character plus every other
  // ALIVE character. This panel just preselects the "To" side as this
  // character.
  const transferParties = useMemo(
    () => ({
      characters: (transferRoster ?? []).map((c) => ({ key: `character:${c.id}`, label: c.name })),
    }),
    [transferRoster],
  );

  function transferPartyOptions() {
    return (
      <>
        <option value="">— Select… —</option>
        <optgroup label="Characters">
          {transferParties.characters.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </optgroup>
      </>
    );
  }

  function openTransferDialog() {
    setTransferFromKey("");
    // The roster options are ALIVE-only, so preselecting a dead character
    // would render a blank <select> that still passes canSubmit. A dead
    // character's panel just starts with both ends empty.
    setTransferToKey(alive ? `character:${character.id}` : "");
    setTransferAmount("");
    setDialog("transfer");
  }

  function swapTransferEnds() {
    setTransferFromKey(transferToKey);
    setTransferToKey(transferFromKey);
  }

  function run(fn) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setDialog(null);
      setDraft("");
      doRefresh();
    });
  }

  // A tag gesture: fires now, reports what it did. DevPanel's applyTagOps
  // refreshes on success, so there is nothing to do here but surface the
  // outcome.
  function runTags(ops, said) {
    setError(null);
    startTransition(async () => {
      const res = await onApplyTags(ops);
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setDone(said);
    });
  }

  // Confirm FIRST, transition SECOND. Never the other way round.
  //
  // useConfirm() resolves on a click, so the setState that mounts the dialog
  // has to render immediately. Awaited inside startTransition's async scope
  // that update is deferred behind a transition which is itself waiting on the
  // promise: the dialog never appears, `pending` never clears, and every
  // button in the bar sits disabled forever while the server action is never
  // called at all. Same warning as LifewebRequestButtons.js and
  // TagRequestButtons.js, which hit this before.
  async function confirmThenRun(opts, fn) {
    setError(null);
    if (!(await confirm(opts))) return;
    run(fn);
  }

  // Every affliction they currently hold, dropped. `healable` is precomputed
  // on the server from the shared isHealable predicate, so the picker and the
  // server action can't disagree about what counts as one.
  function healAll() {
    const wounds = tags.filter((t) => t.healable && heldIds.has(t.id));
    if (!wounds.length) {
      setError(`${character.name} has nothing to heal.`);
      return;
    }
    setError(null);
    // One gesture, one call, one audit row, one DM — applyTagOpsInTx applies
    // the whole batch in order, so a ward's worth of removals is still one
    // thing that happened to the player rather than a burst of them.
    runTags(
      wounds.map((t) => ({ tagId: t.id, op: "remove", quantity: null })),
      wounds.length === 1 ? `Healed ${wounds[0].name}` : `Healed ${wounds.length} afflictions`,
    );
  }

  // Drop Hungry, grant Ate Meal — the same pair db/lib/hungerPass.js works in.
  function feedThem() {
    const hunger = tags.find((t) => t.slug === feed.dropSlug);
    const meal = tags.find((t) => t.slug === feed.grantSlug);
    const ops = [];
    if (hunger && heldIds.has(hunger.id)) ops.push({ tagId: hunger.id, op: "remove", quantity: null });
    if (meal && !heldIds.has(meal.id)) ops.push({ tagId: meal.id, op: "add", quantity: 1 });
    if (!ops.length) {
      setError(`${character.name} is already fed.`);
      return;
    }
    setError(null);
    runTags(ops, "Fed them");
  }

  const wounds = tags.filter((t) => t.healable);

  return (
    <>
      {/* Thirteen bare icons in a row, split only by hairlines, meant every
          verb had to be hovered to be read. Named clusters instead: Life,
          Turn, Reach (message, teleport, ⬢), Body (what is on the sheet) and
          Admin (deletion). The icons stay — the label is what says which
          neighbourhood you are in. */}
      <section className="panel dev-bar p-3">
        <div className="dev-bar-cluster">
          <span className="field-label">Life</span>
          <div className="flex items-center gap-2">
          {alive ? (
            <IconButton
              icon={SkullIcon}
              label={`Kill ${character.name}`}
              disabled={pending}
              onClick={() =>
                confirmThenRun(
                  {
                    title: `Kill ${character.name}?`,
                    message: "They are dead now. Their role and channel access go, and they get the Cursed seat.",
                    confirmLabel: "Kill them",
                  },
                  () => killCharacterNow({ characterId: character.id }),
                )
              }
            />
          ) : (
            <IconButton
              icon={AnkhIcon}
              label={`Revive ${character.name}`}
              disabled={pending}
              onClick={() =>
                confirmThenRun(
                  {
                    title: `Revive ${character.name}?`,
                    message:
                      "Restores their personal Discord role and channel access, and takes back the ghost seat.",
                    confirmLabel: "Revive",
                  },
                  () => reviveCharacter({ characterId: character.id }),
                )
              }
            />
          )}
          {curse?.cursed && (
            <IconButton
              icon={UncurseIcon}
              label={`Lift the curse on ${character.name}`}
              disabled={pending}
              onClick={() =>
                confirmThenRun(
                  {
                    title: `Lift the curse on ${character.name}?`,
                    message:
                      "Their next character may take any role, at full points. It stays lifted until a gamemaster puts it back.",
                    confirmLabel: "Lift it",
                  },
                  () => setCurseOverride({ characterId: character.id, override: false }),
                )
              }
            />
          )}

          </div>
        </div>

        <div className="dev-bar-cluster">
          <span className="field-label">Turn</span>
          <div className="flex items-center gap-2">
          <IconButton
            icon={RestoreIcon}
            label={hasActed ? "Give their turn back" : "They haven't acted this turn"}
            disabled={pending || !hasActed}
            onClick={() =>
              confirmThenRun(
                {
                  title: "Give their turn back?",
                  message: "Their Move for this turn is undone and they are told they can act again.",
                  confirmLabel: "Restore turn",
                },
                () => restoreTurn({ characterId: character.id }),
              )
            }
          />
          <IconButton
            icon={SkipIcon}
            label={hasActed ? "They've already acted this turn" : "Spend their turn"}
            disabled={pending || hasActed || !openTurn}
            onClick={() =>
              confirmThenRun(
                {
                  title: "Spend their turn?",
                  message: "A Routine worth nothing is filed for them, and they are told.",
                  confirmLabel: "Spend it",
                },
                () => spendTurn({ characterId: character.id }),
              )
            }
          />
          </div>
        </div>

        <div className="dev-bar-cluster">
          <span className="field-label">Reach</span>
          <div className="flex items-center gap-2">
          <IconButton
            icon={MessageIcon}
            label={`Message ${character.name}`}
            disabled={pending}
            onClick={() => setDialog("message")}
          />
          <IconButton
            icon={MapIcon}
            label={alive ? `Teleport ${character.name}` : "A corpse can't be moved"}
            disabled={pending || !alive}
            onClick={() => {
              setTeleportQuery("");
              setDialog("teleport");
            }}
          />
          <IconButton
            icon={ResourcesIcon}
            label="Transfer ⬢"
            disabled={pending || !transferRoster?.length}
            onClick={openTransferDialog}
          />
          </div>
        </div>

        {/* Three tag verbs, all of which fire. */}
        <div className="dev-bar-cluster">
          <span className="field-label">Body</span>
          <div className="flex items-center gap-2">
          <IconButton
            icon={WoundIcon}
            label="Inflict a wound"
            disabled={pending}
            onClick={() => setDialog("wound")}
          />
          <IconButton
            icon={BandageIcon}
            label="Heal every affliction"
            disabled={pending}
            onClick={healAll}
          />
          <IconButton
            icon={MealIcon}
            label="Feed them"
            disabled={pending}
            onClick={feedThem}
          />
          </div>
        </div>

        {/* Two buttons used to live here beside Delete, and both are gone.
            Re-push Discord re-sent the role and the channel
            overwrites a character should already have — which is what
            db:mirror and the channel doctor do on every bot start anyway, so
            it could only ever confirm that nothing was wrong. The eye linked
            to /character, the SIGNED-IN GM's own sheet rather than this
            character's, so it answered a question nobody asked with somebody
            else's answer. There is no GM-facing view of another character's
            player sheet to point it at; this panel is that view.

            So the cluster is Delete alone, and it draws only for a superadmin
            — an empty labelled group is worse than no group. */}
        {canDelete && (
          <div className="dev-bar-cluster">
            <span className="field-label">Admin</span>
            <div className="flex items-center gap-2">
              <IconButton
                icon={TrashIcon}
                label={`Delete ${character.name} permanently`}
                disabled={pending}
                onClick={() => setDialog("delete")}
              />
            </div>
          </div>
        )}

        <FormError>{error}</FormError>
        {!error && done && <p className="w-full text-sm text-accent">{done}.</p>}
      </section>

      {/* Kill, Restore turn and Spend turn used to open a RequestDialog for a
          typed reason first, to send along with the player's DM. Nobody wrote
          one that said anything the DM did not, so they are a confirm now;
          the server actions still take an optional reason for a caller that
          has one. */}
      {dialog === "message" && (
        <Modal modeless title={`Message ${character.name}`} onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-3">
            <label className="field">
              <span className="field-label">
                Sent from Bascinet as a DM{" "}
                {draft.length > GM_MESSAGE_MAX_LENGTH && (
                  <span className="text-danger">
                    ({draft.length}/{GM_MESSAGE_MAX_LENGTH})
                  </span>
                )}
              </span>
              {/* No maxLength: a long paste stays visible and trimmable
                  rather than being silently cut. */}
              <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <FormError>{error}</FormError>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={pending || !draft.trim() || draft.length > GM_MESSAGE_MAX_LENGTH}
                onClick={() => run(() => messageCharacter({ characterId: character.id, message: draft }))}
              >
                Send
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Raw relocation, same as Bulk Move — no Move cost, no Action row, no
          adjacency check. Immediate, not staged: it fires on click. */}
      {dialog === "teleport" && (
        <Modal modeless title={`Teleport ${character.name}`} onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-3">
            <label className="field">
              <span className="field-label">Search</span>
              <input
                autoFocus
                value={teleportQuery}
                onChange={(e) => setTeleportQuery(e.target.value)}
                placeholder="Location or zone…"
              />
            </label>
            {teleportMatches.length === 0 && <p className="text-muted text-sm">Nothing matches that.</p>}
            <ul className="flex flex-col gap-2">
              {teleportMatches.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className="btn-quiet w-full text-left"
                    disabled={character.locationId === l.id}
                    onClick={() =>
                      run(() => teleportCharacter({ characterId: character.id, locationId: l.id }))
                    }
                  >
                    {l.name}
                    <span className="text-muted"> — {l.zoneName ?? "unzoned"}</span>
                    {character.locationId === l.id ? " — already there" : ""}
                  </button>
                </li>
              ))}
            </ul>
            <FormError>{error}</FormError>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Immediate, not staged — the counterparty usually isn't this
          character's own pending diff, so half of it Cancel-ing with the
          sheet edit would be incoherent. See web/lib/gmTransfer.js. Either
          end is a character; this panel just preselects "To" as this
          character. */}
      <RequestDialog
        modeless
        open={dialog === "transfer"}
        title={`Transfer ⬢ for ${character.name}`}
        submitLabel="Transfer"
        busy={pending}
        canSubmit={
          Boolean(transferFromKey) &&
          Boolean(transferToKey) &&
          transferFromKey !== transferToKey &&
          Number.isInteger(Number(transferAmount)) &&
          Number(transferAmount) > 0
        }
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          run(() =>
            transferResources({
              fromKey: transferFromKey,
              toKey: transferToKey,
              amount: transferAmount,
            }),
          )
        }
      >
        <label className="field">
          <span className="field-label">From</span>
          <Select value={transferFromKey} onChange={(e) => setTransferFromKey(e.target.value)}>
            {transferPartyOptions()}
          </Select>
        </label>
        <button
          type="button"
          className="btn-quiet"
          aria-label="Swap From and To"
          onClick={swapTransferEnds}
        >
          ⇄
        </button>
        <label className="field">
          <span className="field-label">To</span>
          <Select value={transferToKey} onChange={(e) => setTransferToKey(e.target.value)}>
            {transferPartyOptions()}
          </Select>
        </label>
        <label className="field w-40">
          <span className="field-label">Amount</span>
          <input
            type="number"
            min="1"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            placeholder="0"
          />
        </label>
      </RequestDialog>

      {dialog === "wound" && (
        <Modal modeless title="Inflict a wound" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {wounds.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="btn-quiet w-full text-left"
                    disabled={heldIds.has(t.id)}
                    onClick={() => {
                      setDialog(null);
                      runTags([{ tagId: t.id, op: "add", quantity: 1 }], `Inflicted ${t.name}`);
                    }}
                  >
                    {t.name}
                    {heldIds.has(t.id) ? " — already has it" : ""}
                  </button>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Deleting is the one thing here with no undo at all, so it takes a
          typed name rather than a yes/no — the same posture as Restart Game. */}
      {dialog === "delete" && (
        <Modal title={`Delete ${character.name}`} onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">This is permanent.</p>
            {/* Not .field-label: that class is uppercase, and the name below
                must be typed verbatim — an uppercased label made a correctly
                typed name look wrong forever. */}
            <label className="field">
              <span className="text-sm">
                Type <strong>{character.name}</strong> to confirm
              </span>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <FormError>{error}</FormError>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={pending || draft.trim() !== character.name}
                onClick={() =>
                  run(async () => {
                    const res = await deleteCharacter({ characterId: character.id, confirmName: draft });
                    if (res?.ok) doDeleted();
                    return res;
                  })
                }
              >
                Delete permanently
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
