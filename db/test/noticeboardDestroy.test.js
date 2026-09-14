// destroyNotice — what a tear does when nobody has hands to take the paper
// into (PAPERWORK.md §7). Three things it must get right: the paper goes WITH
// the post (else the Tag row goes orphaned, and db:prune-tags skips `custom`
// rows on purpose); `ephemeral` is the whole guard, so a catalog tag survives
// being torn off a wall; and a lost race deletes NOTHING — the post delete IS
// the claim.

const test = require("node:test");
const assert = require("node:assert/strict");
const { destroyNotice } = require("../lib/noticeboard");

// A stand-in for the Prisma client that records what it was asked to delete.
function fakePrisma({ postsDeleted = 1 } = {}) {
  const calls = [];
  return {
    calls,
    noticePost: {
      deleteMany: async (args) => {
        calls.push(["noticePost", args.where]);
        return { count: postsDeleted };
      },
    },
    tag: {
      deleteMany: async (args) => {
        calls.push(["tag", args.where]);
        return { count: 1 };
      },
    },
  };
}

test("the paper goes with the post", async () => {
  const db = fakePrisma();
  const claimed = await destroyNotice(db, { id: "post-1", tagId: "tag-1" });

  assert.equal(claimed.count, 1);
  assert.deepEqual(db.calls, [
    ["noticePost", { id: "post-1" }],
    ["tag", { id: "tag-1", ephemeral: true }],
  ]);
});

test("only an ephemeral tag is destroyed", async () => {
  const db = fakePrisma();
  await destroyNotice(db, { id: "post-1", tagId: "tag-1" });

  const tagWhere = db.calls.find(([model]) => model === "tag")[1];
  assert.equal(tagWhere.ephemeral, true); // else a torn catalog tag deletes it for everybody
});

test("a lost race leaves the paper alone", async () => {
  const db = fakePrisma({ postsDeleted: 0 });
  const claimed = await destroyNotice(db, { id: "post-1", tagId: "tag-1" });

  assert.equal(claimed.count, 0);
  assert.equal(
    db.calls.some(([model]) => model === "tag"),
    false,
  );
});
