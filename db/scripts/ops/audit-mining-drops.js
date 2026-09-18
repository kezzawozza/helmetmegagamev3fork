#!/usr/bin/env node
// Prices out docs/miningdrops.yaml — what each pool entry is worth and each
// pool's ⬢ expected value. Reads the YAML off disk, so it prices a draft
// before db:sync-mining-drops runs. See MININGDROPS.md §2 for the six buckets,
// §2a for requiredTag, §6 for "not yet configured".
//
//   npm run db:audit-mining-drops
//   npm run db:audit-mining-drops -- --zone forest --location forest-west-riverbank
//   npm run db:audit-mining-drops -- --zone forest --holds forester   # also folds in a skill's extra pool
//   npm run db:audit-mining-drops -- --write   # the only flag that TOUCHES the file — rewrites its comments
const fs = require("node:fs");
const { prisma } = require("../../index");
const { loadDoc, parseDoc } = require("../../lib/syncMiningDrops");
const { scopeFilters, passesRequiredTag } = require("../../lib/miningDrops");
const { annotateLines, priceRows } = require("../../lib/miningdropsAnnotate");
const { bandOf } = require("../../lib/miningdropsRarity");
const { docsPath } = require("../../lib/repoPaths");
const { summarize } = require("../../lib/miningdropsEv");

function parseArgs(argv) {
  const out = { zoneSlug: null, locationSlug: null, holdsSlugs: [], write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--zone") out.zoneSlug = argv[++i];
    else if (argv[i] === "--location") out.locationSlug = argv[++i];
    else if (argv[i] === "--write") out.write = true;
    else if (argv[i] === "--holds") {
      out.holdsSlugs = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

// priceEntry and summarize live in db/lib/miningdropsEv.js, exercised by
// db/test/ directly.
function bucketLabel(row, zoneNameById, locationNameById, tagsById) {
  const parts = [];
  if (row.zoneId) parts.push(`zone: ${zoneNameById.get(row.zoneId) ?? row.zoneId}`);
  if (row.locationId) parts.push(`location: ${locationNameById.get(row.locationId) ?? row.locationId}`);
  if (row.requiredTagId) {
    const skill = tagsById.get(row.requiredTagId);
    parts.push(`requires: ${skill?.name ?? row.requiredTagId}`);
  }
  return parts.length ? parts.join(" + ") : "global";
}

async function main() {
  const { zoneSlug, locationSlug, holdsSlugs, write } = parseArgs(process.argv.slice(2));

  const [tags, zones, locations] = await Promise.all([
    prisma.tag.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        sellable: true,
        sellablePrice: true,
        pointCost: true,
        consumesIntoResources: true,
      },
    }),
    prisma.zone.findMany({ select: { id: true, slug: true, name: true } }),
    prisma.location.findMany({ select: { id: true, slug: true, name: true } }),
  ]);
  const catalogs = {
    tagIdBySlug: new Map(tags.map((t) => [t.slug, t.id])),
    zoneIdBySlug: new Map(zones.map((z) => [z.slug, z.id])),
    locationIdBySlug: new Map(locations.map((l) => [l.slug, l.id])),
  };
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));
  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));

  const doc = loadDoc();
  const rows = parseDoc(doc, catalogs);

  if (rows.length === 0) {
    console.log("docs/miningdrops.yaml has no entries at all yet.");
    await prisma.$disconnect();
    return;
  }

  if (write) {
    const filePath = docsPath("miningdrops.yaml");
    if (!filePath) throw new Error("Cannot find docs/miningdrops.yaml — see db/lib/repoPaths.js");
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const pricedRows = priceRows(rows, tagsById);
    const out = annotateLines(lines, {
      rows: pricedRows,
      tagsById,
      zoneIdBySlug: catalogs.zoneIdBySlug,
      locationIdBySlug: catalogs.locationIdBySlug,
      tagIdBySlug: catalogs.tagIdBySlug,
    });
    fs.writeFileSync(filePath, out.join("\n"));
    console.log(`Wrote refreshed comments to ${filePath}\n`);
  }

  // ── 1. Every authored bucket, as written ──────────────────────────────
  const byBucketRoll = new Map();
  for (const row of rows) {
    const key = `${bucketLabel(row, zoneNameById, locationNameById, tagsById)}|||${row.roll}`;
    if (!byBucketRoll.has(key)) byBucketRoll.set(key, []);
    byBucketRoll.get(key).push(row);
  }

  console.log("=== Authored pools ===\n");
  for (const [key, group] of [...byBucketRoll.entries()].sort()) {
    const [label, roll] = key.split("|||");
    const { priced, hit, ev, unpriced, shares } = summarize(group, tagsById, Number(roll));
    console.log(`${label}, roll ${roll} — ${group.length} entries`);
    priced.forEach((p, i) => {
      const band = bandOf(group[i]) ?? "?";
      console.log(`  ${`${(shares[i] * 100).toFixed(2)}%`.padStart(7)}  ${band.padEnd(18)} ${p.label}`);
    });
    console.log(
      `  -> ⬢ EV ${ev.toFixed(2)} · hit rate ${(hit * 100).toFixed(0)}%` +
        (unpriced ? ` · ${unpriced} tag(s) with no ⬢ price` : ""),
    );
    console.log("");
  }

  const gatedCount = rows.filter((r) => r.requiredTagId).length;
  if (gatedCount > 0) {
    console.log(
      `(${gatedCount} entr${gatedCount === 1 ? "y is" : "ies are"} gated behind "requires:" above — pass ` +
        `--holds <skill-slug> to fold them into the Combined section below; omitted, Combined shows the\n` +
        ` baseline every other character gets.)\n`,
    );
  }

  // ── 2. Combined, as a real mining payout would actually draw it ───────
  const zoneId = zoneSlug ? catalogs.zoneIdBySlug.get(zoneSlug) : null;
  const locationId = locationSlug ? catalogs.locationIdBySlug.get(locationSlug) : null;
  if (zoneSlug && !zoneId) console.log(`(warning: unknown --zone "${zoneSlug}", ignored)\n`);
  if (locationSlug && !locationId) console.log(`(warning: unknown --location "${locationSlug}", ignored)\n`);

  const heldTagIds = new Set();
  const heldNames = [];
  for (const slug of holdsSlugs) {
    const id = catalogs.tagIdBySlug.get(slug);
    if (!id) {
      console.log(`(warning: unknown --holds tag "${slug}", ignored)\n`);
      continue;
    }
    heldTagIds.add(id);
    heldNames.push(tagsById.get(id)?.name ?? slug);
  }

  const where = [
    zoneSlug && zoneId ? `zone ${zoneSlug}` : null,
    locationSlug && locationId ? `location ${locationSlug}` : null,
    heldNames.length ? `holding ${heldNames.join(" + ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(`=== Combined pools (what a payout actually draws from${where ? `, at ${where}` : ""}) ===\n`);

  // 1d6 uniform: the real EV of ONE day's mining is (1/6) * sum over all six
  // faces, an unconfigured face counted as a real zero, not skipped.
  let totalEv = 0;
  let totalHitFraction = 0;
  let anyConfigured = false;
  for (let roll = 1; roll <= 6; roll++) {
    const scopes = scopeFilters(zoneId ?? null, locationId ?? null);
    const combined = rows.filter(
      (r) =>
        r.roll === roll &&
        scopes.some((s) => s.zoneId === r.zoneId && s.locationId === r.locationId) &&
        passesRequiredTag(r, heldTagIds),
    );
    if (combined.length === 0) continue;
    anyConfigured = true;
    const { hit, ev, unpriced } = summarize(combined, tagsById, roll);
    totalEv += ev;
    totalHitFraction += hit;
    console.log(
      `roll ${roll} — ${combined.length} pooled entries -> ⬢ EV ${ev.toFixed(2)} · ` +
        `hit rate ${(hit * 100).toFixed(0)}%` +
        (unpriced ? ` · ${unpriced} unpriced` : ""),
    );
  }
  if (anyConfigured) {
    console.log(
      `  -> mining: ⬢ EV/day ${(totalEv / 6).toFixed(2)} · hit ${Math.round((totalHitFraction / 6) * 100)}% ` +
        `(across all six faces, not just the configured ones)`,
    );
  }

  console.log(
    "\nLegend: a bare 'roll N' line is CONDITIONAL on landing on that face — what you'd get IF you\n" +
      "rolled it. The '-> mining: ⬢ EV/day' line is the real, unconditional number: (1/6) times the\n" +
      "sum of all six faces' EV, an unconfigured face (almost always 2-5) counted as a real zero\n" +
      "rather than skipped. Adding two 'roll N' lines together is not that number — divide by 6 first,\n" +
      "and count the unlisted faces too. ⬢ EV is the RARITY-BAND-WEIGHTED expectation (MININGDROPS.md\n" +
      "§2, §7), not a flat average of the pool's lines — each entry's real chance comes from the die\n" +
      "face's column and which rarity band it's authored at (db/lib/miningdropsRarity.js), printed as\n" +
      "the leading percentage on each entry above. RESOURCES entries use their own ⬢ delta; NOTHING\n" +
      "counts as 0 ⬢. A tag priced in miningdropsAnnotate.js's ASSUMED_VALUES (a Lockbox, godflesh, a\n" +
      "monster corpse) prices at that override, ahead of its own sellablePrice — a Lockbox's real price\n" +
      "is deliberately half its contents, so the table's balance math needs the FULL value a player who\n" +
      "actually opens it realizes. A tag with neither a price nor an override, but a consumesIntoResources\n" +
      "(Purse, Supply Kit), prices at that instead. A tag's pointCost is shown for reference only — it's a\n" +
      "different scale (character-build points, not ⬢) and is never summed into the EV. Hit rate is the\n" +
      "share of the pool's PROBABILITY that isn't NOTHING, not the share of its lines. A \"requires:\" entry\n" +
      "only joins the Combined section when its skill is named on --holds.",
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  prisma.$disconnect();
});
