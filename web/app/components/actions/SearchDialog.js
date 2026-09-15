"use client";

import { useState } from "react";
import PartySelect from "../PartySelect";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { searchRequest } from "@/app/(app)/character/requestActions";

// Search (docs/systemdocs/SEARCH.md). One question, so the dialog is one picker.
//
// Nothing lands here: the verb files an Offer and the other player gets a DM
// with Yes / No / Hide items. What comes back is `pending`, the same answer
// Learn, Teach, Confess and Kiss give.
//
// PartySelect rather than Kiss's ChipPicker, because this is one of the two
// verbs that reaches a person in a hood: a concealed row carries `kind: "hood"`
// and posts "hood:<token>" instead of "character:<id>" (PROXYING.md §5). A
// hood reads as "a young man" here and in every line that follows.
export default function SearchDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster, loading } = useRoster(["people"], {
    seed: { people: { searchParties: pools.searchParties ?? [] } },
  });
  const [targetKey, setTargetKey] = useState(presets?.targetId ?? "");
  const { submit, busy, error } = useSubmit();

  const targets = roster?.people?.searchParties ?? [];
  const chosen = targets.find((t) => `${t.kind ?? "character"}:${t.id}` === targetKey) ?? null;

  function onSubmit() {
    if (!targetKey) return;
    submit(
      () => searchRequest({ targetKey }),
      (res) => onDone(noticeLine(mode, res, { name: chosen?.name ?? "them" })),
    );
  }

  return (
    <ActionDialog
      title="Search"
      busy={busy}
      error={error}
      loading={loading && targets.length === 0}
      empty={!loading && targets.length === 0 ? "There's nobody here to search." : null}
      canSubmit={Boolean(targetKey)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <PartySelect
        label="Who do you want to search?"
        hint="Pick somebody"
        characters={targets}
        value={targetKey}
        onChange={setTargetKey}
      />
      <p className="text-xs text-muted">
        They are asked, and they can say no. Before they answer they get one chance to hide
        things — whether that works is a roll you will never see.
      </p>
    </ActionDialog>
  );
}
