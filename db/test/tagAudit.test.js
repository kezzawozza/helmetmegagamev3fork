// node --test over db/lib/tagAudit.js — the audit-log writes for tag changes
// that otherwise leave no trace (automated turn-engine passes, and the
// staged-push landing a GM-staged gambit tag change). Run with
// `npm test --workspace=db`.
//
// WHAT A FAILURE HERE MEANS. These are the only calls standing between a
// tag actually landing on a sheet and /gm/audit knowing about it for the
// paths that used to write nothing at all. A no-op that should have written
// a row is a silent gap in the audit trail; a row written with the wrong
// shape renders wrong or fails to filter on /gm/audit's "System"/"GM action"
// families.
const test = require("node:test");
const assert = require("node:assert/strict");

const { logSystemTagChange, logBatchSystemTagChange, summarizeTagOps, mapGrantedTags } = require("../lib/tagAudit");

function makeTx() {
  const created = [];
  return {
    created,
    auditLog: {
      async create({ data }) {
        created.push(data);
        return { id: `audit-${created.length}`, ...data };
      },
    },
  };
}

test("summarizeTagOps normalizes applyTagOpsInTx's applied shape", () => {
  const out = summarizeTagOps([
    { op: "add", tagId: "t1", name: "Bleeding", quantity: 2 },
    { op: "remove", tagId: "t2", name: "Bandaged" },
  ]);
  assert.deepEqual(out, [
    { tagId: "t1", tagName: "Bleeding", op: "add", quantity: 2 },
    { tagId: "t2", tagName: "Bandaged", op: "remove", quantity: 1 },
  ]);
});

test("summarizeTagOps survives an empty/missing applied array", () => {
  assert.deepEqual(summarizeTagOps(null), []);
  assert.deepEqual(summarizeTagOps(undefined), []);
  assert.deepEqual(summarizeTagOps([]), []);
});

test("mapGrantedTags normalizes grantTagSlugs' shape and drops no-op grants", () => {
  const out = mapGrantedTags([
    { tagId: "t1", tagName: "Madness", added: 1 },
    { tagId: "t2", tagName: "Thanati", added: 0 }, // already held, non-stackable — nothing landed
  ]);
  assert.deepEqual(out, [{ tagId: "t1", tagName: "Madness", op: "add", quantity: 1 }]);
});

test("logSystemTagChange writes one row naming the system and the tags", async () => {
  const tx = makeTx();
  await logSystemTagChange(tx, {
    system: "turret",
    targetCharacterId: "char-1",
    applied: [{ tagId: "t1", tagName: "Deep Wound", op: "add", quantity: 1 }],
  });
  assert.equal(tx.created.length, 1);
  const row = tx.created[0];
  assert.equal(row.actionType, "system_tag_turret");
  assert.equal(row.actorDiscordUserId, "system:turret");
  assert.equal(row.targetCharacterId, "char-1");
  assert.equal(row.details.system, "turret");
  assert.deepEqual(row.details.tags, [{ tagId: "t1", tagName: "Deep Wound", op: "add", quantity: 1 }]);
});

test("logSystemTagChange is a no-op when nothing actually changed", async () => {
  const tx = makeTx();
  await logSystemTagChange(tx, { system: "turret", targetCharacterId: "char-1", applied: [] });
  await logSystemTagChange(tx, { system: "turret", targetCharacterId: "char-1", applied: null });
  assert.equal(tx.created.length, 0);
});

test("logBatchSystemTagChange writes one row for the whole character list, not one per character", async () => {
  const tx = makeTx();
  await logBatchSystemTagChange(tx, {
    system: "hunger",
    characterIds: ["char-1", "char-2", "char-3"],
    tagId: "t-hungry",
    tagName: "Hungry",
    op: "add",
  });
  assert.equal(tx.created.length, 1);
  const row = tx.created[0];
  assert.equal(row.actionType, "system_tag_hunger");
  assert.equal(row.targetCharacterId, undefined);
  assert.deepEqual(row.details.characterIds, ["char-1", "char-2", "char-3"]);
  assert.deepEqual(row.details.tags, [{ tagId: "t-hungry", tagName: "Hungry", op: "add", quantity: 1 }]);
});

test("logBatchSystemTagChange is a no-op with an empty character list", async () => {
  const tx = makeTx();
  await logBatchSystemTagChange(tx, { system: "hunger", characterIds: [], tagId: "t-hungry", tagName: "Hungry", op: "add" });
  assert.equal(tx.created.length, 0);
});
