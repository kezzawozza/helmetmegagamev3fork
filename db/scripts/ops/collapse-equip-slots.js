// One-off: take off whatever no longer fits, after HEAD became a single
// unlayered slot and BODY collapsed from three layers to two (Mail, Over).
// `node db/scripts/ops/collapse-equip-slots.js` to preview, `-- --apply` to
// write. See docs/systemdocs/TAGS.md.
//
// THIS IS NOT TIDYING — it unbricks equipping. A clash is validated over the
// character's WHOLE equipped set after the write (db/lib/equipSlots.js's
// header explains why), and findSlotClash returns the FIRST offending pair it
// meets. So a character wearing a mask under a helm under a hood is refused
// when they try to equip a sword, and told about two items they did not
// touch. db/lib/tagOps.js does the same to a GM's staged batch, including a
// batch that was trying to unequip one of the three — two would still be
// left, so the whole batch rolls back. Until this runs, anybody over the new
// limit can only dig themselves out one piece at a time from the sheet.
//
// Run it AFTER `npm run db:sync-tags` has applied the new layers, not before:
// it reads live Tag.equipSlot/equipLayer and calls the same findSlotClash the
// app does, so there is no second copy of the rule here to drift.
//
// Idempotent, and silent to players by design — no DM goes out. Keep the
// output: it is the only record of what came off, and the answer to "where
// did my helm go".
require("dotenv").config();
const { prisma } = require("../../index");
const { findSlotClash } = require("../../lib/equipSlots");
const { settleCarry } = require("../../lib/carry");

// Which of a clashing set is kept. Armour first, because that is what a
// player loses a fight without; then a concealing piece, so a character whose
// face was hidden stays hidden rather than being silently unmasked; then the
// row id, purely so two runs agree.
function keepScore(row) {
  const tag = row.tag;
  const armor = Math.max(tag.meleeArmor ?? 0, tag.ballisticArmor ?? 0);
  return [armor, tag.concealsIdentity ? 1 : 0];
}

function betterThan(a, b) {
  const [aArmor, aConceal] = keepScore(a);
  const [bArmor, bConceal] = keepScore(b);
  if (aArmor !== bArmor) return aArmor > bArmor;
  if (aConceal !== bConceal) return aConceal > bConceal;
  return String(a.id) < String(b.id);
}

// The rows to unequip so nothing clashes any more. Walks each occupied
// slot/layer key, keeps the best row there, and returns the rest.
//
// Works in ROWS rather than the physical units findSlotClash counts, because
// unequipping is a row-level write. A stack equipped more than once clashes
// with itself (two hats out of one stack are still two hats on one head), so
// such a row is cut back to a single unit rather than taken off entirely.
function losers(rows) {
  const best = new Map();
  const out = [];

  for (const row of rows) {
    const tag = row.tag;
    if (!tag?.equipSlot) continue;
    if (tag.equipSlot === "WEAPON" || tag.equipSlot === "ACCESSORY") continue; // counted in hands / capped separately
    const key = tag.equipLayer == null ? tag.equipSlot : `${tag.equipSlot}:${tag.equipLayer}`;
    const held = best.get(key);
    if (!held) {
      best.set(key, row);
      continue;
    }
    if (betterThan(row, held)) {
      best.set(key, row);
      out.push(held);
    } else {
      out.push(row);
    }
  }

  // A survivor still wearing several units of one stack keeps exactly one.
  const trims = [...best.values()]
    .filter((row) => (row.equippedQuantity ?? 0) > 1)
    .map((row) => ({ row, to: 1 }));

  return { unequip: out, trims };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", tags: { some: { equipped: true } } },
    select: {
      id: true,
      name: true,
      tags: {
        where: { equipped: true },
        select: {
          id: true,
          equippedQuantity: true,
          tag: {
            select: {
              name: true,
              equipSlot: true,
              equipLayer: true,
              meleeArmor: true,
              ballisticArmor: true,
              concealsIdentity: true,
            },
          },
        },
      },
    },
  });

  const touched = [];
  for (const character of characters) {
    // The same question the app asks, on the same rows — findSlotClash
    // expands them by equippedQuantity itself.
    if (!findSlotClash(character.tags)) continue;
    const { unequip, trims } = losers(character.tags);
    if (!unequip.length && !trims.length) continue;
    touched.push({ character, unequip, trims });
  }

  if (!touched.length) {
    console.log("Nothing to take off — every equipped set already fits.");
    return;
  }

  console.log(`${apply ? "Taking off" : "Would take off"} gear from ${touched.length} character(s):\n`);
  for (const { character, unequip, trims } of touched) {
    const kept = character.tags
      .filter((r) => !unequip.some((u) => u.id === r.id))
      .map((r) => r.tag.name);
    console.log(`  ${character.name}`);
    for (const row of unequip) {
      const where = row.tag.equipLayer == null ? row.tag.equipSlot : `${row.tag.equipSlot}:${row.tag.equipLayer}`;
      console.log(`    - ${row.tag.name}  (${where})`);
    }
    for (const { row } of trims) {
      console.log(`    - ${row.tag.name}  (stack cut from ${row.equippedQuantity} to 1)`);
    }
    console.log(`    keeps: ${kept.join(", ") || "nothing"}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with `-- --apply` to write.");
    return;
  }

  let rows = 0;
  for (const { character, unequip, trims } of touched) {
    await prisma.$transaction(async (tx) => {
      for (const row of unequip) {
        // `equipped` is defined as equippedQuantity > 0 and kept in sync on
        // every write (schema.prisma#CharacterTag), so both move together.
        await tx.characterTag.update({
          where: { id: row.id },
          data: { equipped: false, equippedQuantity: 0 },
        });
        rows += 1;
      }
      for (const { row, to } of trims) {
        await tx.characterTag.update({ where: { id: row.id }, data: { equippedQuantity: to } });
        rows += 1;
      }
    });
    // Taking off a carryBonus item SHRINKS the cap, which can leave a
    // character over it. settleCarry drops nothing on a shrink — the shed is
    // gated on the load having grown (db/lib/carry.js) — so this grants
    // Overburdened where it is now deserved and takes nobody's property.
    await settleCarry(prisma, character.id, { drop: false });
  }

  console.log(`\nUpdated ${rows} row(s) across ${touched.length} character(s).`);
}

// Exported so db/test/collapseEquipSlots.test.js can check WHICH piece
// survives without a database. What this takes off a player is silent, so it
// is worth a test rather than one careful reading.
module.exports = { losers, betterThan };

if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error(err);
      prisma.$disconnect();
      process.exit(1);
    });
}
