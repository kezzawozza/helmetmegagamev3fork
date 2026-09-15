"use client";

import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { forceAdvanceTurn } from "./actions";

// The Dev Panel's "End turn" control. This is the only client component under
// /gm/dev — the rest of the panel is bare <form action={serverAction}> — and it
// exists for three reasons the plain form couldn't cover:
//
//   1. A pending server action blocks client-side navigation, so without a
//      visible pending state a slow advance reads as the whole app freezing.
//   2. forceAdvanceTurn now returns { ok, error } rather than throwing into a
//      non-existent error.js, so something has to render the error.
//   3. Ending a turn resolves Needs and wipes the roleplay channels — a
//      confirm belongs in front of it. Just the question, though: the GM
//      running the panel knows what ending a turn does.
export default function EndTurnButton({ turnLabel }) {
  const confirm = useConfirm();
  const { run, pending, error } = useActionRunner();

  async function onClick() {
    const ok = await confirm({
      title: turnLabel ? `End ${turnLabel}?` : "End the current turn?",
      confirmLabel: "End the turn",
      cancelLabel: "Leave it open",
    });
    if (!ok) return;

    // forceAdvanceTurn catches its own failures, but its authorization check
    // runs before that try block and a transport error can reject too — with
    // no error.js to land on, an unhandled rejection here would take the panel
    // down. useActionRunner's own catch is what stops that.
    run(forceAdvanceTurn);
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div>
        <button type="button" className="btn" onClick={onClick} disabled={pending}>
          {pending ? "Ending turn…" : "End turn"}
        </button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
