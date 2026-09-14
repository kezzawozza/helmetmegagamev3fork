"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { learnRequest, teachRequest, confessRequest } from "@/app/(app)/character/requestActions";

// Learn Skill, Teach Skill and Confess: a partner standing here, then what
// passes between you — a skill they could teach, a skill you could teach
// them, or a sin of yours (LESSONS.md, CONFESSION.md). All three are offers
// the other side accepts in Discord or on /chat, so the notice says so.
//
// The partner lists are the page's own. For lessons they never read the other
// sheet: the skills are what YOU could learn or what YOU know, and whether the
// pair works is found out by asking (LESSONS.md §4). No threshold is shown —
// it would give away the teacher's Teaching.
const VERBS = {
  learn: {
    title: "Learn Skill",
    submit: "Ask them",
    who: "Who are you learning from?",
    what: "Which skill?",
    empty: "Nobody here can teach you anything right now.",
    people: (p) => p.teachers ?? [],
    choices: (partner) => partner.skills ?? [],
    // Learning is always the student's Gambit, so a spent Move always stops it.
    note: (p) => (p.hasMoved ? "You've already used your Move this turn." : null),
    run: (partnerId, tagId) => learnRequest({ teacherId: partnerId, tagId }),
  },
  teach: {
    title: "Teach Skill",
    submit: "Offer",
    who: "Who are you teaching?",
    what: "Which skill?",
    empty: "There's nobody here you could teach anything.",
    people: (p) => p.learners ?? [],
    choices: (partner) => partner.skills ?? [],
    // Teaching is free for a tag holder, so a spent Move only stops the rest.
    note: (p) =>
      !p.teachCostsMove
        ? "Teaching is free."
        : p.hasMoved
          ? "You've already used your Move this turn."
          : "Teaching someone takes your whole turn.",
    run: (partnerId, tagId) => teachRequest({ learnerId: partnerId, tagId }),
  },
  confess: {
    title: "Confess",
    submit: "Confess",
    who: "Who are you confessing to?",
    what: "What are you confessing?",
    empty: "Nobody here can hear a confession.",
    people: (p) => p.confessors ?? [],
    choices: (partner, p) => p.mySins ?? [],
    note: (p) => (p.hasMoved ? "You've already used your Move this turn." : null),
    run: (partnerId, tagId) => confessRequest({ chaplainId: partnerId, tagId }),
  },
};

export default function LessonDialog({ mode, onDone, onClose }) {
  const verb = VERBS[mode];
  const pools = useActionPools();
  const people = verb.people(pools);
  const [partnerId, setPartnerId] = useState("");
  const [tagId, setTagId] = useState("");
  const { submit, busy, error } = useSubmit();

  const partner = people.find((p) => p.id === partnerId) ?? null;
  const choices = partner ? verb.choices(partner, pools) : [];
  const note = verb.note?.(pools) ?? null;

  return (
    <ActionDialog
      title={verb.title}
      submitLabel={verb.submit}
      busy={busy}
      error={error}
      empty={people.length === 0 ? verb.empty : null}
      canSubmit={Boolean(partner && tagId)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => verb.run(partner.id, tagId),
          (res) => onDone(noticeLine(mode, res, { name: partner.name })),
        )
      }
    >
      <ChipPicker
        label={verb.who}
        options={people.map((p) => ({ id: p.id, label: p.name }))}
        value={partnerId}
        onChange={(id) => {
          setPartnerId(id);
          setTagId("");
        }}
      />
      {partner && (
        <ChipPicker
          label={verb.what}
          options={choices.map((t) => ({
            id: t.id,
            // [PLAYER TEXT — Bascinet to rewrite]
            label: t.threshold ? `${t.name} · needs ${t.threshold}+` : t.name,
          }))}
          value={tagId}
          onChange={setTagId}
          emptyLabel="Nothing to pass on."
        />
      )}
      {note && <p className="text-xs text-muted">{note}</p>}
    </ActionDialog>
  );
}
