// The sentence a notice says after an action, when the server did not send one.
//
// A server action MAY return `line` — one-marked sentence, used verbatim.
// It does so where only it knows the truth (the die Extract rolled, what
// Recover handed back, the turn the bomb fires on). Everything else is
// composed here from the payload, because the client already has the words
// on screen: the name it just picked, the thing it just made.
//
// Never for a failure. A refusal stays { ok: false, error } and is shown as a
// bad-toned notice or the dialog's own error line.

function named(ctx, fallback = "them") {
  return ctx?.name ?? fallback;
}

const LINES = {
  bind: (res, ctx) =>
    res.pending ? `${named(ctx, res.name)} has to agree first.` : `${named(ctx, res.name)} is tied up.`,
  free: (res, ctx) => `${named(ctx)} is loose again.`,
  crucify: (res, ctx) => `${named(ctx, res.name)} is on the cross.`,
  shackle: (res, ctx) => `${named(ctx, res.name)} is shackled.`,
  torture: (res, ctx) => `${named(ctx, res.name)} has been put to the question.`,
  // Apply Collar has two endings, the same shape bind does: an offer went out,
  // or it is already round their neck.
  applycollar: (res, ctx) =>
    res.pending ? `${named(ctx, res.name)} has to agree first.` : `${named(ctx, res.name)} has a collar on.`,
  unlockcollar: (res, ctx) => `${named(ctx, res.name)} is out of the collar, and it's yours.`,
  // The server returns its own `line` here, which noticeLine prefers — only it
  // knows whether anything was still alive to go off. This is the fallback.
  detonatecollar: (res, ctx) => `${named(ctx, res.name)} is gone.`,
  harm: (res, ctx) => (res.killed ? `${named(ctx)} is dead.` : `${named(ctx)} is hurt.`),
  mutilate: (res, ctx) => `The ${res.part ?? "piece"} is yours.`,
  brand: (res, ctx) => `${named(ctx, res.name)} is branded. It'll never come off.`,
  bury: (res, ctx) => `${res.name ?? named(ctx, "They")} is buried.`,
  butcher: (res, ctx) => `${res.name ?? named(ctx, "The body")} is cut up.`,
  engrave: (res) => (res.headstone ? `The name is cut into the stone.` : `No stone took the name.`),
  disguise: (res, ctx) => `You go by ${named(ctx, res.name)} now.`,
  heal: (res, ctx) => `${named(ctx, "They")} ${ctx?.self ? "are" : "is"} treated.`,
  miracle: (res, ctx) => `${named(ctx, "They")} is healed by a miracle.`,
  learn: (res, ctx) => `Offer sent — the lesson happens if they accept.`,
  teach: (res, ctx) => `Offer sent — the lesson happens if they accept.`,
  confess: () => `Offer sent — they hear you if they accept.`,
  kiss: () => `Waiting on response.`,
  search: () => `Waiting on response.`,
  tax: () => `Filed.`,
  consume: (res, ctx) => `${named(ctx, "It")} used up.`,
  destroy: (res, ctx) => `${named(ctx, "It")} destroyed.`,
  transfer: (res, ctx) => ctx?.line ?? `Moved.`,
  loot: (res, ctx) => ctx?.line ?? `Taken.`,
  package: (res) => res.line ?? `Crated.`,
  purchase: (res) => `Bought for ${res.total ?? 0} ⬢ — it's on the hideout floor.`,
  hideout: (res) => `The hideout is ${res.room ?? "set"} now.`,
  write: () => `Written.`,
  seal: () => `Sealed.`,
  bird: () => `The bird is away.`,
  research: (res, ctx) => `You settle in with ${ctx?.name ?? res.ingredientName ?? "it"}.`,
  craft: (res, ctx) => (res.made ? `${res.made} made.` : ctx?.line ?? `The work is filed.`),
  recall: () => `Your comrades.`,
  // Both server actions return their own `line`, which noticeLine prefers.
  // These are the fallbacks.
  warrant: (res, ctx) => `A warrant is out on ${res.name ?? named(ctx, "them")}.`,
  unwarrant: (res, ctx) => `The warrant on ${res.name ?? named(ctx, "them")} is lifted.`,
  wantedlist: (res) => (res.roster?.length ? `The warrant book.` : `Nobody is wanted.`),
  // The server action returns its own `line`, which noticeLine prefers. This
  // is the fallback.
  intercept: () => `You lie in wait.`,
  // The server action returns its own `line` (it names who), which noticeLine
  // prefers. These are the fallbacks.
  attack: () => `You attack.`,
  recover: (res) => (res.granted?.length ? `${res.granted.join(" and ")} back in your hands.` : `Recovered.`),
  pointer: (res) => res.line ?? `The card swings.`,
  pointerdevice: (res) => res.line ?? `Nothing happens.`,
  arm: () => `The count has begun.`,
  disarm: () => `The count is stopped.`,
  extract: (res) => res.line ?? `You cut what you could.`,
  breakrestraints: (res) => res.line ?? `You struggle against the ropes.`,
};

export function noticeLine(mode, res, ctx = null) {
  if (res?.line) return res.line;
  const fn = LINES[mode];
  return fn ? fn(res ?? {}, ctx) : "Done.";
}
