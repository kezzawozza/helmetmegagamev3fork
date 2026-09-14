// Pure Desire-catalog gate evaluator. No prisma import, not in the
// @lifeweb/db barrel — deep-imported by client components. Order (first
// match wins): hidden, locked, spent, cooldown, available. A hidden state
// must be withheld entirely; a locked reason must never name a hidden tag (leaks Demoness).
function evaluateDesireCatalog({ templates, heldTags, hiddenTagIds, roleSlug, history, openTurnNumber, desireSlots = 2 }) {
  const heldTagIds = new Set((heldTags || []).map((t) => t.id));
  const hidden_ = hiddenTagIds instanceof Set ? hiddenTagIds : new Set(hiddenTagIds || []);
  const allClauses = unionLockClauses(heldTags || []);
  const globalClauses = allClauses.filter(({ clause }) => clause.slot == null);
  const scopedClauses = allClauses.filter(({ clause }) => clause.slot != null);
  const hist = history || [];

  const slotLocksFor = (template) =>
    Array.from({ length: desireSlots }, (_, slotIndex) =>
      lockedReasonForTemplate(template, scopedClauses, { slotIndex, desireSlots }),
    );

  const visible = [];
  const hidden = [];

  for (const template of templates || []) {
    if (template.retired) continue;

    const requiresResult = evalRequires(template, { heldTagIds, roleSlug, hiddenTagIds: hidden_ });

    if (requiresResult.hidden) {
      hidden.push(template.id);
      continue;
    }

    const slotLocks = slotLocksFor(template);
    const push = (state, reason, availableFromTurn) =>
      visible.push({ template, state, reason, availableFromTurn, slotLocks });

    if (!requiresResult.ok) {
      push("locked", requiresResult.reason, null);
      continue;
    }

    const lockReason = lockedReasonForTemplate(template, globalClauses, { slotIndex: null, desireSlots });
    if (lockReason) {
      push("locked", lockReason, null);
      continue;
    }

    const templateHistory = hist.filter((h) => h.templateId === template.id);
    const fulfilledRows = templateHistory.filter((h) => h.status === "FULFILLED");

    if (template.onceEver && fulfilledRows.length > 0) {
      push("spent", null, null);
      continue;
    }

    if (fulfilledRows.length > 0) {
      const lastFulfilled = fulfilledRows.reduce((latest, row) =>
        (row.endedTurnNumber ?? -Infinity) > (latest.endedTurnNumber ?? -Infinity) ? row : latest
      );
      const cooldownLength = template.cooldownTurns ?? template.tier;
      const availableFromTurn = (lastFulfilled.endedTurnNumber ?? 0) + cooldownLength;
      if (openTurnNumber < availableFromTurn) {
        push("cooldown", null, availableFromTurn);
        continue;
      }
    }

    push("available", null, null);
  }

  return { visible, hidden };
}

// AND across keys, OR within an `any` list. requiresAnyOf joins anyTags/anyRoles with OR instead.
function evalRequires(template, { heldTagIds, roleSlug, hiddenTagIds }) {
  const anyTags = template.requiresAnyTags || [];
  const allTags = template.requiresAllTags || [];
  const notTags = template.requiresNotTags || [];
  const anyRoles = template.requiresAnyRoles || [];
  const notRoles = template.requiresNotRoles || [];

  const heldForbidden = notTags.find((t) => heldTagIds.has(t.id));
  if (heldForbidden) {
    return { ok: false, reason: `Locked by ${heldForbidden.name}` };
  }
  const heldForbiddenRole = roleSlug && notRoles.find((r) => r.slug === roleSlug);
  if (heldForbiddenRole) {
    return { ok: false, reason: `Locked by your ${heldForbiddenRole.name} role` };
  }

  const missingAll = allTags.filter((t) => !heldTagIds.has(t.id));
  if (missingAll.length > 0) {
    if (missingAll.some((t) => hiddenTagIds.has(t.id))) return { hidden: true };
    return { ok: false, reason: `Requires the ${missingAll[0].name} tag` };
  }

  const holdsGatingTag = anyTags.some((t) => heldTagIds.has(t.id));
  const holdsGatingRole = Boolean(roleSlug) && anyRoles.some((r) => r.slug === roleSlug);

  // OR mode: an empty list must not satisfy the OR, so an empty side still
  // LOCKS but isn't named. Never read `anyTags[0].name` unguarded.
  if (template.requiresAnyOf) {
    if (holdsGatingTag || holdsGatingRole) return { ok: true };
    if (anyTags.some((t) => hiddenTagIds.has(t.id))) return { hidden: true };
    const wants = [
      anyTags[0] ? `the ${anyTags[0].name} tag` : null,
      anyRoles[0] ? `the ${anyRoles[0].name} role` : null,
    ].filter(Boolean);
    return {
      ok: false,
      reason: wants.length ? `Requires ${wants.join(" or ")}` : "Locked.",
    };
  }

  if (anyTags.length > 0 && !holdsGatingTag) {
    const gatesHidden = anyTags.some((t) => hiddenTagIds.has(t.id));
    if (gatesHidden) return { hidden: true };
    return { ok: false, reason: `Requires the ${anyTags[0].name} tag` };
  }

  if (anyRoles.length > 0 && !holdsGatingRole) {
    return { ok: false, reason: `Requires the ${anyRoles[0].name} role` };
  }

  return { ok: true };
}

function unionLockClauses(heldTags) {
  const pairs = [];
  for (const tag of heldTags) {
    if (Array.isArray(tag.desireLocks)) {
      for (const clause of tag.desireLocks) {
        pairs.push({ clause, sourceName: tag.name });
      }
    }
  }
  return pairs;
}

// `slot: "bottom"` binds the last slot only; `slotIndex: null` is the slot-agnostic pass, where a scoped clause must never fire.
function clauseAppliesToSlot(clause, { slotIndex, desireSlots }) {
  if (clause.slot == null) return true;
  if (slotIndex == null) return false;
  if (clause.slot === "bottom") return slotIndex === desireSlots - 1;
  return false;
}

// { all: true } beats { families } beats { tiers, exceptFamilies }.
function lockedReasonForTemplate(template, pairs, scope = { slotIndex: null, desireSlots: 2 }) {
  const templateFamilies = template.families || [];
  const inScope = pairs.filter(({ clause }) => clauseAppliesToSlot(clause, scope));

  for (const { clause, sourceName } of inScope) {
    if (!clause.all) continue;
    const excepted = Array.isArray(clause.exceptFamilies) &&
      templateFamilies.some((f) => clause.exceptFamilies.includes(f));
    if (!excepted) return `Locked by ${sourceName}`;
  }
  for (const { clause, sourceName } of inScope) {
    if (!Array.isArray(clause.families)) continue;
    if (clause.families.some((f) => templateFamilies.includes(f))) return `Locked by ${sourceName}`;
  }
  for (const { clause, sourceName } of inScope) {
    if (!Array.isArray(clause.tiers)) continue;
    if (!clause.tiers.includes(template.tier)) continue;
    const excepted = Array.isArray(clause.exceptFamilies) &&
      templateFamilies.some((f) => clause.exceptFamilies.includes(f));
    if (!excepted) return `Locked by ${sourceName}`;
  }
  return null;
}

// "1–4" for a run with no gap on the tier ladder, "1, 2, 5" otherwise.
const TIER_LADDER = [1, 2, 3, 4, 5, 7];
function formatTiers(tiers) {
  const steps = tiers.map((t) => TIER_LADDER.indexOf(t));
  const unbroken = steps.every((s, i) => s >= 0 && (i === 0 || s === steps[i - 1] + 1));
  return unbroken && tiers.length > 1 ? `${tiers[0]}–${tiers[tiers.length - 1]}` : tiers.join(", ");
}

// One sentence per clause: "Alcoholic shuts your bottom Desire slot to everything outside Alcohol."
function describeDesireLocks(heldTags, familyNames) {
  const name = (key) => familyNames?.get?.(key) ?? familyNames?.[key] ?? key;
  const list = (keys) => keys.map(name).join(", ");
  const notes = [];
  for (const { clause, sourceName } of unionLockClauses(heldTags || [])) {
    const except = Array.isArray(clause.exceptFamilies) ? ` outside ${list(clause.exceptFamilies)}` : "";
    if (clause.slot === "bottom") {
      if (clause.all) {
        notes.push(`${sourceName} shuts your bottom Desire slot to everything${except}.`);
      } else if (Array.isArray(clause.families)) {
        notes.push(`${sourceName} shuts ${list(clause.families)} in your bottom Desire slot.`);
      } else if (Array.isArray(clause.tiers)) {
        const tiers = clause.tiers.length === 1 ? `tier ${clause.tiers[0]}` : `tiers ${formatTiers(clause.tiers)}`;
        notes.push(`${sourceName} shuts your bottom Desire slot${except} at ${tiers}.`);
      }
      continue;
    }
    if (clause.all) {
      notes.push(`${sourceName} shuts every Desire${except}.`);
    } else if (Array.isArray(clause.families)) {
      notes.push(`${sourceName} shuts ${list(clause.families)}.`);
    }
    // A whole-catalog TIER lock says nothing here on purpose — Nobility's own
    // catalog row already reads "Locked by Nobility". The bottom-slot tier clause above still speaks since an Addiction has no row of its own.
  }
  return notes;
}

function bottomSlotAddiction(heldTags) {
  for (const { clause, sourceName } of unionLockClauses(heldTags || [])) {
    if (clause.slot === "bottom") return { name: sourceName };
  }
  return null;
}

// Short string ("Pacifist", "Innkeeper role") or null. Only call for a template whose gate the character passes — never a locked or hidden one.
function unlockedBy(template, { heldTagIds, roleSlug }) {
  const parts = [...(template.requiresAllTags || []), ...(template.requiresAnyTags || [])]
    .filter((t) => heldTagIds.has(t.id))
    .map((t) => t.name);
  const role = roleSlug && (template.requiresAnyRoles || []).find((r) => r.slug === roleSlug);
  if (role) parts.push(`${role.name} role`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Per-slot lock: claiming a Desire shuts that slot until maxEnded + lockTurns
// + 1 (`lockTurns` is GameConfig.desireSlotLockTurns). `lastEnded` is the
// slot's most recent FULFILLED row; null endedTurnNumber counts toward
// neither. `noLock` (Manic, TAGS.md 4a) is a real bypass rather than
// `lockTurns: 0` — a Desire row is born ended, so at 0 the test still reads
// `openTurnNumber <= maxEnded`, shutting the slot until the next turn. This
// is the SLOT lock only; each Desire's own cooldown (evaluateDesireCatalog
// above) is untouched — Manic may refill a slot instantly but still can't re-claim the same Desire early.
function slotStates({ history, openTurnNumber, desireSlots, lockTurns = 2, noLock = false }) {
  const hist = history || [];
  const slots = [];
  for (let slotIndex = 0; slotIndex < desireSlots; slotIndex++) {
    const endedRows = hist.filter((h) => h.slotIndex === slotIndex && h.endedTurnNumber != null);
    let lockedUntilTurn = null;
    // The client labels a locked slot by this ("Locked (1t)"), never the
    // absolute turn number — "turn 3" means nothing to a player who doesn't know what turn it is. Never below 1 while locked.
    let lockedTurnsLeft = null;
    let lastEnded = null;
    if (endedRows.length > 0) {
      const maxEnded = Math.max(...endedRows.map((h) => h.endedTurnNumber));
      if (!noLock && openTurnNumber <= maxEnded + lockTurns) {
        lockedUntilTurn = maxEnded + lockTurns + 1;
        lockedTurnsLeft = Math.max(1, lockedUntilTurn - openTurnNumber);
      }
      lastEnded =
        endedRows
          .filter((h) => h.status === "FULFILLED")
          .reduce((latest, row) => (latest == null || row.endedTurnNumber > latest.endedTurnNumber ? row : latest), null);
    }
    slots.push({ slotIndex, lockedUntilTurn, lockedTurnsLeft, lastEnded });
  }
  return slots;
}

// Spelled out rather than imported from db/lib/constants.js — this file has
// no imports on purpose, deep-imported by CLIENT components, same reason as
// web/lib/consumeGrants.js's own copy of the drinking-ladder slugs. Keep in step with MANIC_SLUG there.
const MANIC_SLUG = "manic";

function desireSlotsNeverLock(heldTags) {
  if (heldTags instanceof Set) return heldTags.has(MANIC_SLUG);
  return (heldTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === MANIC_SLUG);
}

module.exports = {
  desireSlotsNeverLock,
  // Exported for db/lib/seatConflicts.js — a seat asks this same evaluator rather than restating clause precedence and letting the two drift.
  unionLockClauses,
  lockedReasonForTemplate,
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  bottomSlotAddiction,
  unlockedBy,
  evalRequires,
};
