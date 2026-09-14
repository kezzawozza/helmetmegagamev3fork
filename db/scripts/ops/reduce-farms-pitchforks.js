// One-off: brings the Farms Fields room stash's pitchfork count down to the
// new starting quantity (docs/zones.yaml, 4 -> 2) — seedRoomStash never
// revisits a slug once seeded, so editing the YAML alone does nothing for a
// running game.
//
//   node db/scripts/ops/reduce-farms-pitchforks.js           # dry run
//   node db/scripts/ops/reduce-farms-pitchforks.js --apply   # write
//
// Scoped to the Farms Fields room ONLY, by name. Never raises the count, only
// lowers it to the target — a room already below 2 is left alone.
require("dotenv").config();
const { prisma } = require("../../index");

const APPLY = process.argv.includes("--apply");
const ROOM_SLUG = "farms-fields";
const TAG_SLUG = "pitchfork";
const TARGET = 2;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write" : "DRY RUN — no writes");

  const room = await prisma.room.findUnique({ where: { slug: ROOM_SLUG }, select: { id: true, name: true } });
  if (!room) throw new Error(`No room "${ROOM_SLUG}".`);

  const tag = await prisma.tag.findUnique({ where: { slug: TAG_SLUG }, select: { id: true } });
  if (!tag) throw new Error(`No tag "${TAG_SLUG}".`);

  const row = await prisma.roomTag.findUnique({
    where: { roomId_tagId: { roomId: room.id, tagId: tag.id } },
    select: { id: true, quantity: true },
  });

  if (!row) {
    console.log(`${room.name} holds no pitchforks. Nothing to do.`);
    return;
  }
  console.log(`${room.name} currently holds ${row.quantity} pitchfork(s).`);
  if (row.quantity <= TARGET) {
    console.log(`Already at or below the target of ${TARGET}. Nothing to do.`);
    return;
  }

  console.log(`Would set quantity ${row.quantity} -> ${TARGET}.`);
  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.roomTag.findUnique({ where: { id: row.id }, select: { quantity: true } });
    if (!fresh || fresh.quantity <= TARGET) {
      console.log("Quantity changed since the read above — leaving it alone.");
      return;
    }
    await tx.roomTag.update({ where: { id: row.id }, data: { quantity: TARGET } });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: "system",
        actionType: "room_stash_adjusted",
        details: { roomId: room.id, room: room.name, tag: TAG_SLUG, from: fresh.quantity, to: TARGET, why: "starting pitchfork count halved, docs/zones.yaml" },
      },
    });
  });
  console.log(`Set. ${room.name} now holds ${TARGET} pitchfork(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
