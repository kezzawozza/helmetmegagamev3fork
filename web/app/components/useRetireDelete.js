"use client";

// The place editor's two destructive verbs, which every level of it repeats.
//
// A zone, a Location and a Room are deleted the same way and retired the same
// way, and the only thing that differs between the three is the noun. Three
// copies of this dance had drifted into three slightly different wordings of
// the same two dialogs, which is the shape of thing that eventually becomes
// three different behaviours.
//
// Delete is two steps, and the first one is the point: ask the server what is
// standing in the way FIRST, and if anything is, say so and stop rather than
// letting somebody confirm a delete that cannot happen. Retire is one step,
// because it is reversible and says so.
//
// `call` comes from useActionRunner, so a refusal from the action itself lands
// in the caller's own FormError rather than anywhere new.
import { useConfirm } from "@/app/components/ConfirmProvider";

export default function useRetireDelete({ noun, call, blockers, hardDelete, retire, deleteNote, retireNote }) {
  const confirm = useConfirm();

  async function onDelete(row) {
    const standing = await blockers(row.id);
    if (standing.length) {
      // No cancelLabel: there is nothing to choose here, only something to
      // read. The dialog is the answer, not a question.
      await confirm({
        title: `Can't delete this ${noun}`,
        message: standing.join("\n"),
        confirmLabel: "OK",
        cancelLabel: "",
      });
      return;
    }
    const ok = await confirm({
      title: `Delete "${row.name}"?`,
      message: deleteNote ?? "This removes the row for good.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    call(hardDelete, row.id);
  }

  async function onRetire(row) {
    const ok = await confirm({
      title: `Retire "${row.name}"?`,
      message: retireNote ?? "It drops out of every picker, travel and the map. Reversible.",
      confirmLabel: "Retire",
    });
    if (!ok) return;
    call(retire, row.id);
  }

  return { onDelete, onRetire };
}
