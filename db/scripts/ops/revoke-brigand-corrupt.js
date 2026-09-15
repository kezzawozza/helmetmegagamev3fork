// One-off: two Brigands (Dunkin D, John Johnson) bought Corrupt through /store point-buy
// before its five Desires were role-gated to Cerberus/Sheriff/Censor/Incarn — a seat a
// Brigand never holds. Removes the tag, leaves tagPoints untouched (no refund, explicit
// GM call), audit-logs it, DMs each player.
//
//   node db/scripts/ops/revoke-brigand-corrupt.js           # dry run
//   node db/scripts/ops/revoke-brigand-corrupt.js --apply   # write + DM
//
// Drops through dropCharacterTag (db/lib/tagWrites.js), the one module allowed to write
// CharacterTag rows. Corrupt has no sellablePrice/depotPrice, so its economy hook is a no-op.
require("dotenv").config();
const { prisma } = require("../../index");
const { dropCharacterTag } = require("../../lib/tagWrites");
const { sendDm } = require("../../lib/dm");
const { DM_KIND } = require("../../lib/dmKinds");

const APPLY = process.argv.includes("--apply");
const CORRUPT_SLUG = "corrupt";
const TARGETS = [
  { characterId: "cmtw14wb70143mv0pksm1lb87", name: "Dunkin D", discordUserId: "248925965508411394" },
  { characterId: "cmtvrc3ik01jemr0po8uckcix", name: "John Johnson", discordUserId: "298080075604033538" },
];
const DM_TEXT =
  "Corrupt is meant for the Cerberon, the Sheriff, or an Incarn — a Brigand shouldn't have been able to buy it. It's been removed from your sheet. The points you spent on it aren't being refunded.";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will remove Corrupt and DM both players" : "DRY RUN — no writes");

  const tag = await prisma.tag.findUnique({ where: { slug: CORRUPT_SLUG }, select: { id: true } });
  if (!tag) {
    console.error(`Skipped: no "${CORRUPT_SLUG}" tag — run npm run db:sync-tags.`);
    return;
  }

  for (const t of TARGETS) {
    console.log(`\n${t.name} (${t.characterId})`);
    const held = await prisma.characterTag.findUnique({
      where: { characterId_tagId: { characterId: t.characterId, tagId: tag.id } },
    });
    if (!held) {
      console.log("  does not hold Corrupt, skipping");
      continue;
    }
    if (!APPLY) {
      console.log("  would: remove CharacterTag(corrupt), write AuditLog, DM", t.discordUserId);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await dropCharacterTag(tx, t.characterId, tag.id);
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: "system",
          actionType: "gm_bulk_tag",
          targetCharacterId: t.characterId,
          details: {
            mode: "remove",
            tagSlug: CORRUPT_SLUG,
            tagName: "Corrupt",
            reason:
              "Corrupt's Desires were gated to Cerberus/Sheriff/Censor/Incarn; a Brigand should never have been able to buy it. No point refund.",
          },
        },
      });
    });
    console.log("  removed + audit-logged");
    try {
      await sendDm(prisma, t.discordUserId, DM_TEXT, { kind: DM_KIND.CONVERSATION });
      console.log("  DM sent");
    } catch (err) {
      console.error("  DM FAILED:", err?.message ?? err);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
