// Audit-log writes for tag changes that otherwise leave no trace: automated
// turn-engine passes and the moment a staged tag change actually lands at
// the turn-end push. Player and GM-direct call sites already audit
// themselves at the point of write (see the R table in
// web/lib/auditNarrative.js) — this module exists only for the paths that
// don't, so it is deliberately not wired into db/lib/tagWrites.js/tagOps.js
// themselves, which stay pure DB-mutation primitives with no side-effect
// writes.

// `applied`: [{ tagId, tagName, op: "add"|"remove", quantity }]
async function logSystemTagChange(tx, { system, targetCharacterId, applied, extra = {} }) {
  if (!applied?.length) return;
  await tx.auditLog.create({
    data: {
      actorDiscordUserId: `system:${system}`,
      actionType: `system_tag_${system}`,
      targetCharacterId,
      details: { system, tags: applied, ...extra },
    },
  });
}

// One row per pass invocation, not one per character — a hunger-band sweep
// can touch the whole roster in a single turn, and a row per character would
// flood /gm/audit for an event nobody reads at that granularity. Mirrors the
// existing gm_bulk_tag/gm_bulk_tag_grant convention: a character id list in
// `details`, no single targetCharacterId.
async function logBatchSystemTagChange(tx, { system, characterIds, tagId, tagName, op, quantity = 1, extra = {} }) {
  if (!characterIds?.length) return;
  await tx.auditLog.create({
    data: {
      actorDiscordUserId: `system:${system}`,
      actionType: `system_tag_${system}`,
      details: { system, characterIds, tags: [{ tagId, tagName, op, quantity }], ...extra },
    },
  });
}

// Normalizes db/lib/tagOps.js#applyTagOpsInTx's `applied` return shape
// ({ op, tagId, name, quantity? }) into the { tagId, tagName, op, quantity }
// shape every tag-audit row uses.
function summarizeTagOps(applied) {
  return (applied ?? []).map((a) => ({
    tagId: a.tagId,
    tagName: a.name,
    op: a.op,
    quantity: a.quantity ?? 1,
  }));
}

// Same normalization for db/lib/tagWrites.js#grantTagSlugs' `[{ tagId,
// tagName, added }]` return shape — drops entries where nothing actually
// landed (an already-held non-stackable tag is a documented no-op).
function mapGrantedTags(granted) {
  return (granted ?? [])
    .filter((g) => g.added > 0)
    .map((g) => ({ tagId: g.tagId, tagName: g.tagName, op: "add", quantity: g.added }));
}

module.exports = { logSystemTagChange, logBatchSystemTagChange, summarizeTagOps, mapGrantedTags };
