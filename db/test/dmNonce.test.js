// The partial unique index on DirectMessage.clientNonce: what makes a re-send
// safe. It lives entirely in migration SQL — Prisma's schema language can't
// say WHERE, so `prisma migrate diff` actively offers to drop it, and if that
// drop is accepted a retried message quietly reaches the player twice. The
// partial half matters too: every other DM writer passes null, so a plain
// UNIQUE would refuse all but one of them. Wants a real Postgres; skips
// itself unless DATABASE_URL is local (db/lib/localDatabase.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("clientNonce is unique, and null is exempt", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const nonce = `test-nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const discordUserId = `test-user-${Date.now()}`;
  const written = [];

  t.after(async () => {
    await prisma.directMessage.deleteMany({ where: { id: { in: written } } });
    await prisma.$disconnect();
  });

  const row = async (data) => {
    const created = await prisma.directMessage.create({
      data: { discordUserId, direction: "OUTBOUND", content: "ok", kind: "CONVERSATION", ...data },
    });
    written.push(created.id);
    return created;
  };

  const first = await row({ clientNonce: nonce });
  assert.equal(first.clientNonce, nonce);

  await assert.rejects(
    () => row({ clientNonce: nonce }),
    (err) => err.code === "P2002",
    "a second row with the same clientNonce must be refused",
  );

  const a = await row({ clientNonce: null });
  const b = await row({ clientNonce: null });
  assert.notEqual(a.id, b.id);

  const found = await prisma.directMessage.findFirst({ where: { clientNonce: nonce } });
  assert.equal(found.id, first.id);
});
