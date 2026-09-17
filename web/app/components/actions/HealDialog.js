"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { consumableTags } from "@/lib/tagRequests";
import { fitsInRemaining, formatMoveAmount } from "@/lib/craftBudget";
import { healCharacterRequest } from "@/app/(app)/character/requestActions";

// Heal: a patient standing here (you included), one of their afflictions, and
// who pays — three chip rows, each appearing once the one above is answered.
// Gated on YOUR Medical training, never on who is hurt nearby.

// `kind` rather than a hardcoded "character:", the same shape PartySelect and
// MoveThingsDialog build: a payer in a mask arrives as a bare token with
// `kind: "hood"`, and resolveParty knows both (character/actions/shared.js).
function partyChips(parties, selfId) {
  return [
    ...(parties?.characters ?? []).map((c) => ({
      id: `${c.kind ?? "character"}:${c.id}`,
      label: c.id === selfId ? `${c.name} (you)` : c.name,
      note: c.kind === "hood" ? "hooded" : null,
    })),
    ...(parties?.rooms ?? []).map((r) => ({ id: `room:${r.id}`, label: r.name, note: "room" })),
  ];
}

export default function HealDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  // The item-cure shortcut below (item 8) mounts a different dialog on top of
  // this one. `open` rides along on the pools bag rather than a second
  // context — see RequestActionsProvider.js's own comment on `bag.open`.
  const open = pools.open ?? null;
  const selfId = pools.selfId;
  const selfKey = selfId ? `character:${selfId}` : "";
  const { roster, loading } = useRoster(["people", "self"], {
    seed: {
      people: { healTargets: pools.healTargets ?? [], peopleParties: pools.healParties?.characters ?? [] },
      self: { characterTags: pools.characterTags ?? [] },
    },
  });
  const targets = roster?.people?.healTargets ?? [];
  const parties = { characters: roster?.people?.peopleParties ?? [], rooms: pools.healParties?.rooms ?? [] };
  const craftBudget = pools.craftBudget ?? null;
  const hasMoved = Boolean(pools.hasMoved);
  const hasSurgicalSite = Boolean(pools.hasSurgicalSite);
  const surgicalSitePenalty = Boolean(pools.surgicalSitePenalty);
  // The medical pass' item-cure shortcut (TAGS.md §5c): items this character
  // is holding whose `cures` names the affliction picked below.
  const curativeItems = consumableTags(roster?.self?.characterTags ?? []);

  const [patientId, setPatientId] = useState(presets?.patientId ?? "");
  const [tagId, setTagId] = useState("");
  const [payerKey, setPayerKey] = useState(selfKey);
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const patient = targets.find((t) => t.id === patientId) ?? null;
  const affliction = patient?.healable.find((h) => h.tagId === tagId) ?? null;
  const payers = partyChips(parties, selfId);
  const curesForAffliction = affliction
    ? curativeItems.filter((t) => (t.cures ?? []).includes(affliction.slug))
    : [];
  // Quiet, same weight as a Discord -# line: a billed cure files today's
  // Move (review fix, round 3).
  const billed = Boolean(affliction) && !affliction.gambit && affliction.moveCost?.kind !== "free";

  async function onSubmit() {
    if (!patient || !affliction || !payerKey) return;
    if (payerKey !== selfKey) {
      const payerName = payers.find((p) => p.id === payerKey)?.label ?? "They";
      const ok = await confirm({
        title: "Bill someone else?",
        message: `${payerName} will be charged ${affliction.cost ?? 0} ⬢ for this treatment.`,
        confirmLabel: "Charge them",
      });
      if (!ok) return;
    }
    // The patient rows are keyed ("character:<id>" / "hood:<token>").
    const self = patient.id === selfKey;
    submit(
      () =>
        healCharacterRequest({
          targetCharacterId: patient.id,
          tagId: affliction.tagId,
          payerKey,
          // What the confirm just showed as costing the Move — 0 for a
          // Gambit (its own Move, not this ledger) or a free cure, 1 for
          // anything billed. Mirrors craft's billedSeen contract
          // (CRAFTING.md §2a): a stale pool reading gets the "reload"
          // refusal, not a silent Move charge (review fix, M2).
          billedSeen: String(billed ? 1 : 0),
        }),
      (res) =>
        onDone(
          res.gambit
            ? `${self ? "Your" : `${patient.name}'s`} ${affliction.tagName} is a Gambit — you'll both know at the end of the turn.`
            : noticeLine(mode, res, { name: self ? "You" : patient.name, self }),
        ),
    );
  }

  return (
    <ActionDialog
      title="Heal"
      submitLabel="Treat"
      busy={busy}
      error={error}
      loading={loading && targets.length === 0}
      empty={!loading && targets.length === 0 ? "Nobody here needs treating." : null}
      canSubmit={Boolean(patient && affliction && payerKey)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Who are you treating?"
        options={targets.map((t) => ({ id: t.id, label: t.id === selfKey ? `${t.name} (you)` : t.name }))}
        value={patientId}
        onChange={(id) => {
          setPatientId(id);
          setTagId("");
        }}
      />
      {patient && (
        <>
          <ChipPicker
            label="What are you treating?"
            // A row the server will refuse outright is greyed here rather than
            // offered with a warning under it. `needsSite` without a site in
            // reach is the only such case (TAGS.md §5c): everything else is a
            // Gambit, which is always allowed to be attempted. Leaving it
            // pressable meant picking it, reading the price, and being told no.
            options={patient.healable.map((h) => ({
              id: h.tagId,
              label: h.tagName,
              note: h.gambit ? "Gambit" : null,
              disabled: Boolean(h.needsSite) && !hasSurgicalSite,
              reason: "You need surgical equipment.",
            }))}
            value={tagId}
            onChange={setTagId}
            emptyLabel="Nothing on them you could treat."
          />
          {/* A disabled chip's title tooltip never shows on a touch screen, so a
              medic with the skill and the ⬢ had no way to learn why a row
              wouldn't select — this says the same thing in text a tap can
              read, always up front rather than behind a hover. */}
          {!hasSurgicalSite && patient.healable.some((h) => h.needsSite) ? (
            <p className="text-xs text-accent">You need surgical equipment.</p>
          ) : null}
        </>
      )}
      {/* The medical pass' item-cure shortcut (TAGS.md §5c): skip the Heal
          request entirely and post a targeted Consume instead, pre-seeded
          with the patient. */}
      {affliction && curesForAffliction.length > 0 && (
        <p className="text-xs">
          <span className="text-muted">or use: </span>
          {curesForAffliction.map((item, i) => (
            <span key={item.id}>
              {i > 0 && ", "}
              <button
                type="button"
                className="btn-quiet"
                onClick={() => open?.("consume", item.id, { targetId: patientId })}
              >
                {item.name}
              </button>
            </span>
          ))}
        </p>
      )}
      {/* Surgery needs a site (M3, TAGS.md §5c; reworked M6b) — tier-6/7 rows
          only. Same shape as CraftDialog's Workshop hint: a warning, never a
          greyed-out row, since the server always offers the attempt (or
          refuses it outright without a site) rather than hiding it. Three
          states now: a real site (no penalty), the portable pack alone
          (−1), or nothing in reach (refused). */}
      {affliction?.needsSite && (
        <p className={`text-xs ${hasSurgicalSite && !surgicalSitePenalty ? "text-muted" : "text-accent"}`}>
          {!hasSurgicalSite
            ? "Surgery: you need Surgical Equipment, a Portable Surgical Pack, or a Surgical Theater."
            : surgicalSitePenalty
              ? "Surgery with only a Portable Surgical Pack lowers the Gambit die by 1."
              : "Surgery with a proper site in reach. Your Gambit won't have a penalty."}
        </p>
      )}
      {affliction && (
        <>
          <ChipPicker label="Paid for by" options={payers} value={payerKey} onChange={(k) => k && setPayerKey(k)} />
          <p className={`text-xs ${affliction.gambit ? "text-accent" : "text-muted"}`}>
            Costs <span className="mono">{affliction.cost} ⬢</span>.
            {affliction.gambit
              ? " This is a Gambit: you spend your Move, a GM reads the roll at the turn's close, and nothing comes off them until then."
              : affliction.moveCost?.kind === "free"
                ? ` First aid doesn't cost a Move — ${pools.healsLeft === 1 ? "1 free treatment" : `${pools.healsLeft ?? "a few"} free treatments`} left this turn.`
                : ` This costs ${affliction.moveCost?.num === affliction.moveCost?.den ? "your whole Move" : `${formatMoveAmount(affliction.moveCost?.num, affliction.moveCost?.den)} of your Move`}${affliction.moveCost?.kind === "spill" ? ", over the free first aid" : ""}.`}
          </p>
          {/* Quiet, same weight as a Discord -# line: a billed cure files
              today's Move (review fix, round 3). */}
          {billed && (
            <p className="text-xs text-muted">
              {`This will use your Move.`}
            </p>
          )}
          {/* Committed-Routine warning, same shape as the Craft dialog's
              (CraftAction.js): a Routine with nothing left to give still
              can't pay even though the line above just quoted a price for
              it, and an ordinary declared Move / Gambit / build turn —
              hasMoved true, no craftBudget ledger at all — refuses too
              (review fix, M2 and round 3, mirroring CraftAction's own
              recipeBlocked: "You've already used your Move this turn."). */}
          {billed &&
            (craftBudget ? (
              !fitsInRemaining(
                { num: affliction.moveCost.num, den: affliction.moveCost.den },
                { num: craftBudget.remainingNum, den: craftBudget.remainingDen },
              ) ? (
                <p className="text-xs text-accent">Your Move is spent for this turn.</p>
              ) : null
            ) : hasMoved ? (
              <p className="text-xs text-accent">{`You've already used your Move this turn.`}</p>
            ) : null)}
        </>
      )}
    </ActionDialog>
  );
}
