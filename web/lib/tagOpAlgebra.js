// One staged op per tag (@@unique([characterId, tagId])), so a presence op (add/remove) and a
// modifier patch must MERGE rather than clobber each other (op shape: db/lib/tagOps.js, DEV-PANEL.md §5).
export function mergeTagOp(existing, incoming, { stackable = true } = {}) {
  const clamp = (op) =>
    op && op.op === "add" && !stackable && op.quantity !== 1 ? { ...op, quantity: 1 } : op;
  if (!existing) return clamp(incoming);

  if (incoming.op === "patch" && existing.op !== "patch") {
    const { op: _drop, tagId: _also, ...modifiers } = incoming;
    void _drop;
    void _also;
    return clamp({ ...existing, ...modifiers });
  }
  if (existing.op === "patch" && incoming.op !== "patch") {
    const { op: _drop, tagId: _also, quantity: _qty, ...modifiers } = existing;
    void _drop;
    void _also;
    void _qty;
    return clamp({ ...modifiers, ...incoming });
  }
  // Exact inverses cancel: granted it, then thought better of it.
  if (
    (existing.op === "add" && incoming.op === "remove") ||
    (existing.op === "remove" && incoming.op === "add")
  ) {
    return null;
  }
  if (existing.op === incoming.op) {
    // A patch quantity is ABSOLUTE, so two of them are last-wins, never a sum. Setting a stack to
    // 3 and then to 5 must mean 5, not 8.
    if (existing.op === "patch") return clamp({ ...existing, ...incoming });
    const both = existing.quantity != null && incoming.quantity != null;
    return clamp({
      ...existing,
      ...incoming,
      quantity: both ? existing.quantity + incoming.quantity : null,
    });
  }
  return clamp(incoming);
}
