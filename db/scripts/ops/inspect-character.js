#!/usr/bin/env node
// Everything about one character that decides whether they are hidden, and
// from what. Read-only, always.
//
//   npm run db:inspect-character -- "Semyun"
//
// "Play on Discord too" and concealment neither leave a trace anywhere a GM can
// read — concealment is derived at read time from the column AND what is
// equipped, so `concealed: true` alone means nothing (PROXYING.md §5). Both
// answers are computed here by the same functions every send path asks.
// Matches on a case-insensitive fragment of the name and prints every match.
const { prisma } = require("../../index");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("../../lib/presentedIdentity");
const { HANDS_TAG_FIELDS, findEquipProblem, handsFor, handsUsed } = require("../../lib/equipSlots");

const DISCORD_MIRROR_COOLDOWN_SECONDS = 7200; // mirrors db/lib/discordMirroring.js's own exported constant

function stamp(date) {
  return date ? date.toISOString() : "never";
}

function cooldownLine(changedAt) {
  if (!changedAt) return "no cooldown running — it has never been flipped";
  const readyAt = new Date(changedAt.getTime() + DISCORD_MIRROR_COOLDOWN_SECONDS * 1000);
  const left = readyAt.getTime() - Date.now();
  if (left <= 0) return `free to flip (last flip ${stamp(changedAt)})`;
  return `REFUSES a flip for another ${Math.ceil(left / 60000)} min, until ${stamp(readyAt)}`;
}

async function main() {
  const fragment = process.argv.slice(2).join(" ").trim();
  if (!fragment) {
    console.error('Usage: npm run db:inspect-character -- "<part of a name>"');
    process.exitCode = 1;
    return;
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { playPanelEnabled: true },
  });
  console.log(`GameConfig.playPanelEnabled: ${config?.playPanelEnabled !== false}`); // first thing to rule out

  const characters = await prisma.character.findMany({
    where: { name: { contains: fragment, mode: "insensitive" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      age: true,
      gender: true,
      updatedAt: true,
      discordUserId: true,
      discordRoleId: true,
      discordMirrored: true,
      discordMirroredChangedAt: true,
      concealed: true,
      roomThreadRoomIds: true,
      location: { select: { name: true } },
      zone: { select: { name: true } },
      tags: {
        select: {
          equipped: true,
          quantity: true,
          expiresTurn: true,
          tag: {
            select: {
              slug: true,
              forcedName: true,
              equippable: true,
              equipSlot: true,
              twoHanded: true,
              ...CONCEALMENT_TAG_FIELDS,
              ...HANDS_TAG_FIELDS,
            },
          },
        },
      },
    },
  });

  if (characters.length === 0) {
    console.log(`\nNo character's name contains "${fragment}".`);
    return;
  }

  for (const c of characters) {
    console.log(`\n=== ${c.name} — ${c.status} — ${c.id}`);
    console.log(`  discordUserId ${c.discordUserId ?? "none"} · role ${c.discordRoleId ?? "none"}`);
    console.log(`  ${c.zone?.name ?? "nowhere"} / ${c.location?.name ?? "nowhere"}`);

    console.log(`\n  Play on Discord too: ${c.discordMirrored}`);
    console.log(`    last flipped ${stamp(c.discordMirroredChangedAt)}`);
    console.log(`    ${cooldownLine(c.discordMirroredChangedAt)}`);
    if (!c.discordMirrored && c.roomThreadRoomIds?.length) {
      console.log(`    STILL RECORDED IN ${c.roomThreadRoomIds.length} room thread(s): the flip's Discord half did not finish`);
    }

    const concealing = c.tags.filter((ct) => ct.tag.concealsIdentity || ct.tag.forcesConceal);
    const concealment = concealmentFrom(c.tags);
    const forcedName = forcedNameFrom(c.tags);
    const identity = presentedIdentity(c, { forcedName, concealment });

    console.log(`\n  Character.concealed (the wish): ${c.concealed}`);
    if (concealing.length === 0) {
      console.log("    holds nothing that conceals — so the wish cannot take effect, and");
      console.log("    /conceal and the switch on /character both refuse to set it");
    }
    for (const ct of concealing) {
      const flags = [
        ct.equipped ? "EQUIPPED" : "carried",
        ct.tag.forcesConceal ? "forces" : "optional",
        `layer ${ct.tag.equipLayer ?? "none"}`,
        ct.tag.concealSprite ? `sprite ${ct.tag.concealSprite}` : "NO SPRITE — conceals nobody",
      ];
      console.log(`    ${ct.tag.name} (${ct.tag.slug}) — ${flags.join(" · ")}`);
    }
    if (forcedName) {
      const row = c.tags.find((ct) => ct.tag.forcedName);
      console.log(`    forced name "${forcedName}" (${row?.tag.slug}), expires turn ${row?.expiresTurn ?? "never"}`);
      console.log("    a forced name beats a hood, and it is not concealment");
    }

    console.log(`\n  Resolved right now: ${identity.name}`);
    console.log(`    concealed ${identity.concealed} · forced ${identity.forced} · face ${identity.avatarPath}`);
    if (c.concealed && !identity.concealed) {
      console.log("    ^ THE WISH IS SET AND NOT IN EFFECT. This is what a player means by");
      console.log("      'my disguise does not work' — nothing concealing is equipped.");
    }

    const equipped = c.tags.filter((ct) => ct.equipped);
    const handCap = handsFor(c.tags);
    const problem = findEquipProblem(equipped, handCap);
    console.log(`\n  Equipped: ${equipped.length} · ${handsUsed(equipped)}/${handCap} hands`);
    if (problem) console.log(`    the slot rules would refuse this set: ${problem}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
