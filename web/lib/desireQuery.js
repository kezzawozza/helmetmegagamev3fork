import { prisma } from "@lifeweb/db";
import { desireFamilies } from "@lifeweb/db/lib/desireFamilies";

// The read side of the Desire catalog — everything /analysis asks the
// database. Nothing here writes. See docs/systemdocs/DESIRES.md.
//
// FULFILLED is the "real" claim and is what every balance number below
// counts by default. CANCELLED (GM-rejected) is tracked separately
// (rejectedClaims/rejectedClaimsByTurn) and never folds into the main
// numbers. ACTIVE is a legacy status nothing writes any more and is only
// ever surfaced by rawClaims(), which shows literally every row.
//
// `Desire.points` (not the live `DesireTemplate.tier`) is the source of
// truth for "how powerful was this claim" — it's the awarded value
// snapshotted at claim time, which can diverge from the current template if
// a GM re-scored it or the catalog changed since. Every "power"/"tier" query
// below reads `points`, not `template.tier`.
//
// A claim with `templateId: null` (freeform / GM off-catalog) has no
// template to join. Every query that groups by template excludes these via
// `templateId: { not: null }`; freeformClaims() is where they're counted
// instead — they must never silently disappear from the page, only from the
// per-template aggregates that have nowhere to put them.

const FULFILLED = { status: "FULFILLED" };

// 1|2|3|4|5|7 — 6 is deliberately never used (DesireTemplate.tier comment).
const KNOWN_TIERS = [1, 2, 3, 4, 5, 6, 7];

async function namesFor(characterIds) {
  if (!characterIds.length) return new Map();
  const rows = await prisma.character.findMany({
    where: { id: { in: characterIds } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function templatesFor(templateIds) {
  if (!templateIds.length) return new Map();
  const rows = await prisma.desireTemplate.findMany({
    where: { id: { in: templateIds } },
    select: { id: true, slug: true, name: true, tier: true, families: true, retired: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

// Top-line stat tiles.
export async function summaryStats() {
  const [agg, uniqueTemplates, catalogSize, topCharacterRows, topTemplateRows] = await Promise.all([
    prisma.desire.aggregate({ where: FULFILLED, _count: true, _avg: { points: true }, _sum: { points: true } }),
    prisma.desire.findMany({
      where: { ...FULFILLED, templateId: { not: null } },
      select: { templateId: true },
      distinct: ["templateId"],
    }),
    // Retired templates can never be newly claimed, so they're excluded from
    // the coverage denominator — a claimed-then-retired template still
    // counts toward the numerator via uniqueTemplates above.
    prisma.desireTemplate.count({ where: { retired: false } }),
    prisma.desire.groupBy({
      by: ["characterId"],
      where: FULFILLED,
      _count: { _all: true },
      // Prisma's groupBy orderBy has to name an actual column inside
      // `_count`, not `_all` (valid in the select, not in orderBy) —
      // characterId is never null within this group, so counting it sorts
      // identically to _all.
      orderBy: { _count: { characterId: "desc" } },
      take: 1,
    }),
    prisma.desire.groupBy({
      by: ["templateId"],
      where: { ...FULFILLED, templateId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { templateId: "desc" } },
      take: 1,
    }),
  ]);

  const [charNames, templateRows] = await Promise.all([
    namesFor(topCharacterRows.map((r) => r.characterId)),
    templatesFor(topTemplateRows.map((r) => r.templateId)),
  ]);

  const mostActiveCharacter = topCharacterRows[0]
    ? {
        id: topCharacterRows[0].characterId,
        name: charNames.get(topCharacterRows[0].characterId) ?? "?",
        count: topCharacterRows[0]._count._all,
      }
    : null;
  const mostClaimedTemplate = topTemplateRows[0]
    ? {
        id: topTemplateRows[0].templateId,
        name: templateRows.get(topTemplateRows[0].templateId)?.name ?? "?",
        count: topTemplateRows[0]._count._all,
      }
    : null;

  const uniqueCount = uniqueTemplates.length;
  return {
    totalFulfilled: agg._count,
    uniqueTemplatesClaimed: uniqueCount,
    catalogSize,
    coveragePct: catalogSize ? Math.round((uniqueCount / catalogSize) * 1000) / 10 : 0,
    totalPointsAwarded: agg._sum.points ?? 0,
    avgPointsPerClaim: agg._avg.points ? Math.round(agg._avg.points * 10) / 10 : 0,
    mostActiveCharacter,
    mostClaimedTemplate,
  };
}

// Desires by person: claim count + total points earned per character. Full
// ranked list, no "top N + Other" capping — unlike the chart kit's fixed
// 8-color budget, a named ranked table has no such ceiling.
export async function claimsByCharacter() {
  const rows = await prisma.desire.groupBy({
    by: ["characterId"],
    where: FULFILLED,
    _count: { _all: true },
    _sum: { points: true },
    orderBy: { _count: { characterId: "desc" } },
  });
  const names = await namesFor(rows.map((r) => r.characterId));
  return rows.map((r) => ({
    characterId: r.characterId,
    name: names.get(r.characterId) ?? "?",
    claimCount: r._count._all,
    totalPoints: r._sum.points ?? 0,
  }));
}

// "Most powerful desires" view (a): the highest-tier templates that have
// actually been claimed at least once.
export async function mostPowerfulByTier({ limit = 20 } = {}) {
  const rows = await prisma.desire.groupBy({
    by: ["templateId"],
    where: { ...FULFILLED, templateId: { not: null } },
    _count: { _all: true },
  });
  const templates = await templatesFor(rows.map((r) => r.templateId));
  return rows
    .map((r) => {
      const t = templates.get(r.templateId);
      if (!t) return null;
      return { templateId: r.templateId, name: t.name, tier: t.tier, families: t.families, claimCount: r._count._all };
    })
    .filter(Boolean)
    .sort((a, b) => b.tier - a.tier || b.claimCount - a.claimCount)
    .slice(0, limit);
}

// "Most powerful desires" view (b): templates that have awarded the most
// TOTAL points across all claims — summed awarded `points`, not tier ×
// frequency, since points already captures any GM re-score.
export async function mostPowerfulByTotalPoints({ limit = 20 } = {}) {
  const rows = await prisma.desire.groupBy({
    by: ["templateId"],
    where: { ...FULFILLED, templateId: { not: null } },
    _count: { _all: true },
    _sum: { points: true },
  });
  const templates = await templatesFor(rows.map((r) => r.templateId));
  return rows
    .map((r) => {
      const t = templates.get(r.templateId);
      if (!t) return null;
      return { templateId: r.templateId, name: t.name, tier: t.tier, claimCount: r._count._all, totalPoints: r._sum.points ?? 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, limit);
}

// One sortable table answering both "most-claimed" (sort claimCount desc)
// and "never claimed" / dead catalog content (sort claimCount asc) — a plain
// groupBy alone never emits a zero-count group, so this merges the full
// template list against the claim counts in JS.
export async function catalogCoverage() {
  const [templates, counts] = await Promise.all([
    prisma.desireTemplate.findMany({
      select: { id: true, slug: true, name: true, tier: true, families: true, retired: true },
    }),
    prisma.desire.groupBy({
      by: ["templateId"],
      where: { ...FULFILLED, templateId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const countMap = new Map(counts.map((c) => [c.templateId, c._count._all]));
  const all = templates
    .map((t) => ({ ...t, claimCount: countMap.get(t.id) ?? 0 }))
    .sort((a, b) => b.claimCount - a.claimCount);
  const neverClaimed = all.filter((t) => t.claimCount === 0 && !t.retired);
  return { all, neverClaimedCount: neverClaimed.length };
}

// Claims by family. `families` is a String[] on DesireTemplate, not a
// relation — Prisma can't groupBy an array element, so this is a findMany +
// in-JS fan-out. A claim belonging to 2 families increments BOTH buckets, so
// the totals across families can exceed totalFulfilledClaims — the UI must
// caption that, it's not a bug in this aggregation.
export async function claimsByFamily() {
  const rows = await prisma.desire.findMany({
    where: { ...FULFILLED, templateId: { not: null } },
    select: { points: true, template: { select: { families: true } } },
  });
  const byKey = new Map();
  for (const row of rows) {
    for (const key of row.template?.families ?? []) {
      const bucket = byKey.get(key) ?? { claimCount: 0, totalPoints: 0 };
      bucket.claimCount += 1;
      bucket.totalPoints += row.points;
      byKey.set(key, bucket);
    }
  }
  const familyByKey = new Map(desireFamilies().map((f) => [f.key, f]));
  const byFamily = [...byKey.entries()]
    .map(([key, v]) => {
      const f = familyByKey.get(key);
      return { key, name: f?.name ?? key, group: f?.group ?? null, color: f?.color ?? null, ...v };
    })
    .sort((a, b) => b.claimCount - a.claimCount);
  return { byFamily, totalFulfilledClaims: rows.length };
}

// Histogram of claims by AWARDED points (not live template.tier — freeform
// claims have no template to read a tier from, and points is the only value
// present on every row). Fixed 7-category axis (1-7, 6 always empty);
// anything outside 1-7 (an unusual re-score) is counted in `otherCount`
// rather than silently dropped.
export async function claimsByTier() {
  const rows = await prisma.desire.groupBy({
    by: ["points"],
    where: FULFILLED,
    _count: { _all: true },
  });
  const countByPoints = new Map(rows.map((r) => [r.points, r._count._all]));
  const byTier = KNOWN_TIERS.map((tier) => ({ tier, count: countByPoints.get(tier) ?? 0 }));
  const otherCount = rows
    .filter((r) => !KNOWN_TIERS.includes(r.points))
    .reduce((n, r) => n + r._count._all, 0);
  return { byTier, otherCount };
}

// Claims-by-turn, stacked by points bucket — shaped to drop straight into
// <StackedArea series={...} categories={...} />.
export async function claimsByTurn() {
  const rows = await prisma.desire.groupBy({
    by: ["setTurnNumber", "points"],
    where: { ...FULFILLED, setTurnNumber: { not: null } },
    _count: { _all: true },
  });
  // 6 is never used, so it's left out of the stack keys entirely (no reason
  // to reserve a permanently-empty band in a stacked chart the way the
  // tier-histogram above deliberately shows one).
  const tierKeys = [1, 2, 3, 4, 5, 7];
  const byTurn = new Map();
  for (const r of rows) {
    const turn = r.setTurnNumber;
    if (!byTurn.has(turn)) byTurn.set(turn, {});
    const bucket = byTurn.get(turn);
    const key = tierKeys.includes(r.points) ? `tier${r.points}` : "other";
    bucket[key] = (bucket[key] ?? 0) + r._count._all;
  }
  const series = [...tierKeys.map((t) => ({ key: `tier${t}`, label: `Tier ${t}` })), { key: "other", label: "Other" }];
  const categories = [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, values]) => ({ x: turn, values }));
  return { series, categories };
}

// Gini coefficient + Lorenz points. This page is unauthenticated, so it keeps
// its own copy of the math rather than reaching into a GM-gated query module.
// 0 is equal, 1 is one character holding every point earned via Desires.
function gini(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  if (!n || total === 0) return { gini: 0, lorenz: [{ p: 0, q: 0 }, { p: 1, q: 1 }] };
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * xs[i];
  const g = (2 * weighted) / (n * total) - (n + 1) / n;
  const lorenz = [{ p: 0, q: 0 }];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += xs[i];
    lorenz.push({ p: (i + 1) / n, q: acc / total });
  }
  return { gini: Math.max(0, Math.min(1, g)), lorenz };
}

// Pure reshape of claimsByCharacter()'s output — no second query — through
// the Gini/Lorenz math above. Feeds <Lorenz points={lorenz} gini={gini} />.
export function pointsConcentration(byCharacterRows) {
  const { gini: g, lorenz } = gini(byCharacterRows.map((r) => r.totalPoints));
  return { gini: g, lorenz, byCharacter: byCharacterRows };
}

// Rejected-claims lens: per-template fulfilled/cancelled counts and cancel
// rate (which desires get rejected most), plus a small reviewedBy breakdown.
export async function rejectedClaims() {
  const [fulfilled, cancelled, reviewers] = await Promise.all([
    prisma.desire.groupBy({
      by: ["templateId"],
      where: { ...FULFILLED, templateId: { not: null } },
      _count: { _all: true },
    }),
    prisma.desire.groupBy({
      by: ["templateId"],
      where: { status: "CANCELLED", templateId: { not: null } },
      _count: { _all: true },
    }),
    prisma.desire.groupBy({
      by: ["reviewedBy"],
      where: { status: "CANCELLED", reviewedBy: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const fulfilledMap = new Map(fulfilled.map((r) => [r.templateId, r._count._all]));
  const cancelledMap = new Map(cancelled.map((r) => [r.templateId, r._count._all]));
  const ids = new Set([...fulfilledMap.keys(), ...cancelledMap.keys()]);
  const templates = await templatesFor([...ids]);

  const rows = [...ids]
    .map((id) => {
      const t = templates.get(id);
      if (!t) return null;
      const fulfilledCount = fulfilledMap.get(id) ?? 0;
      const cancelledCount = cancelledMap.get(id) ?? 0;
      const denom = fulfilledCount + cancelledCount;
      return {
        templateId: id,
        name: t.name,
        fulfilledCount,
        cancelledCount,
        cancelRate: denom ? Math.round((cancelledCount / denom) * 1000) / 10 : 0,
      };
    })
    .filter((r) => r && r.cancelledCount > 0)
    .sort((a, b) => b.cancelRate - a.cancelRate || b.cancelledCount - a.cancelledCount);

  return {
    rows,
    reviewers: reviewers.map((r) => ({ reviewedBy: r.reviewedBy, count: r._count._all })),
  };
}

// Fulfilled-vs-cancelled by turn, shaped for <DivergingBars points={...} />.
export async function rejectedClaimsByTurn() {
  const rows = await prisma.desire.groupBy({
    by: ["setTurnNumber", "status"],
    where: { status: { in: ["FULFILLED", "CANCELLED"] }, setTurnNumber: { not: null } },
    _count: { _all: true },
  });
  const byTurn = new Map();
  for (const r of rows) {
    const turn = r.setTurnNumber;
    if (!byTurn.has(turn)) byTurn.set(turn, { fulfilled: 0, cancelled: 0 });
    const bucket = byTurn.get(turn);
    if (r.status === "FULFILLED") bucket.fulfilled += r._count._all;
    else bucket.cancelled += r._count._all;
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, v]) => ({ x: turn, positive: v.fulfilled, negative: v.cancelled }));
}

// Which `onceEver` templates (tier-7 default) have been claimed game-wide,
// and how many times — a count, not a boolean, since transparency matters
// more here than a single "exhausted" flag.
export async function oncePerLifeExhaustion() {
  const templates = await prisma.desireTemplate.findMany({
    where: { onceEver: true, retired: false },
    select: { id: true, name: true, tier: true },
  });
  if (!templates.length) return [];
  const counts = await prisma.desire.groupBy({
    by: ["templateId"],
    where: { ...FULFILLED, templateId: { in: templates.map((t) => t.id) } },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.templateId, c._count._all]));
  return templates
    .map((t) => ({ id: t.id, name: t.name, tier: t.tier, claimedCount: countMap.get(t.id) ?? 0 }))
    .sort((a, b) => b.claimedCount - a.claimedCount);
}

// GM-granted claims with no template — no tier/family, so they're counted
// here rather than in claimsByFamily()/claimsByTier(), which already
// exclude them via `templateId: { not: null }`.
export async function freeformClaims() {
  const rows = await prisma.desire.findMany({
    where: { templateId: null },
    orderBy: [{ setTurnNumber: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      text: true,
      points: true,
      status: true,
      setTurnNumber: true,
      reason: true,
      character: { select: { name: true } },
    },
  });
  return {
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      text: r.text,
      points: r.points,
      status: r.status,
      setTurnNumber: r.setTurnNumber,
      reason: r.reason,
      characterName: r.character?.name ?? "?",
    })),
  };
}

// The full raw claims table — every Desire ever, including CANCELLED and any
// legacy ACTIVE rows. No server-side filtering: small enough for
// useTableState's in-memory filter/sort/paginate (DataTable.js).
export async function rawClaims() {
  const rows = await prisma.desire.findMany({
    orderBy: [{ setTurnNumber: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      text: true,
      points: true,
      status: true,
      setTurnNumber: true,
      endedTurnNumber: true,
      reason: true,
      slotIndex: true,
      characterId: true,
      templateId: true,
      character: { select: { name: true } },
      template: { select: { name: true, tier: true, families: true, slug: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    characterId: r.characterId,
    characterName: r.character?.name ?? "?",
    templateId: r.templateId,
    templateSlug: r.template?.slug ?? null,
    text: r.text,
    tier: r.template?.tier ?? null,
    families: r.template?.families ?? [],
    points: r.points,
    status: r.status,
    setTurnNumber: r.setTurnNumber,
    endedTurnNumber: r.endedTurnNumber,
    reason: r.reason,
    slotIndex: r.slotIndex,
  }));
}
