// Rewrites docs/miningdrops.yaml's own comments in place: per-entry value (an
// author-written "why" blurb is preserved across refreshes — see the `— ` split below), per-roll EV/hit-rate (own bucket AND what pools with it — global, place, any requiresTag ancestor), and a per-category rollup. See docs/systemdocs/MININGDROPS.md §6a-§6b.
// Pure text surgery over an indentation stack, not a YAML round-trip — this file's shape is fully hand-authored and disciplined, so it never reorders a key, reformats a list, or drops a blank line: it only rewrites the trailing `# ...` on lines it recognizes.
const { scopeFilters, passesRequiredTag } = require("./miningDrops");
const { rowShares } = require("./miningdropsRarity");

// One "slot" per nesting step before a bucket reaches roll-keyed leaves — global consumes none. There were three more buckets here, each crossing a Laboring tier with a place; mining is the only kind of day left, so the tier step went with it.
const BRANCH_PLANS = {
  global: [],
  zone: ["zoneSlug"],
  location: ["locationSlug"],
};

function indentOf(line) {
  const m = /^( *)/.exec(line);
  return m[1].length;
}

// Splits "  code  # comment" into { code, comment } (comment keeps its leading "#", or null). Nothing in this file's keys or short scalars ever contains a literal "#", so a first-match split is safe.
function splitComment(line) {
  const idx = line.indexOf("#");
  if (idx === -1) return { code: line.replace(/\s+$/, ""), comment: null };
  return { code: line.slice(0, idx).replace(/\s+$/, ""), comment: line.slice(idx).trimEnd() };
}

// The slug an entry line names — a find can be an object (`{ slug: rope, rarity: uncommon }`), so the value after the dash isn't always the thing to price; pads and ⬢ deltas stay bare scalars. A regex, not a YAML parse: this module works on LINES and must not reflow anything it doesn't own — the sync already validates the shape, so a malformed file would have thrown before this runs.
function entrySlug(raw) {
  const value = String(raw).trim().replace(/^["']|["']$/g, "");
  const object = /^\{\s*slug\s*:\s*([^,}\s]+)/.exec(value);
  return object ? object[1].trim().replace(/^["']|["']$/g, "") : value;
}

function withComment(code, comment) {
  return comment ? `${code}  ${comment}` : code;
}

// The one pool entry -> mechanical value fragment. Mirrors audit-mining-drops.js#priceEntry but returns just the fragment, since the entry line already has its own slug.
const OBOL_SLUG = "obol";

// EV overrides: the number a loot table's balance math should use for this tag,
// INSTEAD of priceEntry's real-value branches below — checked first, so it wins even when a real (lower) price also exists. Two reasons a tag is here: (1) no real price yet (godflesh — Depot-sellable would undercut the Factory, FACTORY.md §1, so this is planning-only, never written to the tag; the three monster corpses, priced by Butchering's one named yield: Skinless Corpse->Skinless Brain 25⬢, Graga Corpse->Graga Sac 8⬢, Nekker Corpse->Nekker Pheromones 5⬢; human-flesh stays priced 0 on purpose, CORPSES.md §6, so gets no override); (2) a real price exists but is deliberately LESS than the tag's worth (the eight Lockboxes — a locked box sells for half its contents so opening it always beats fencing it, but the loot table's balance math needs the FULL contents value, so the override is the sum of each box's own Spoils `consumesInto` list, kept in sync by hand):
//   Overspill 40 = jewelry8+steel18+silver5+mace9 · Basement 61 = soporific27+amoeba-vial31+bliss3 · Waterlogged 51 = steel18+jewelry8+trench-knife12+silver5+dagger7+old-coin1
//   Silt 18 = jewelry8+silver5+coal4+old-coin1 · Buried 24 = dagger7+jewelry8+silver5+coal4 · Netted 18 = trout-heart4+silver5+jewelry8+old-coin1
//   Till 16 = obol1+obol1+silver5+jewelry8+old-coin1 · Reliquary 20 = heirloom12+jewelry8
const ASSUMED_VALUES = {
  godflesh: 8,
  "skinless-corpse": 25,
  "graga-corpse": 8,
  "nekker-corpse": 5,
  "overspill-lockbox": 40,
  "basement-lockbox": 61,
  "waterlogged-lockbox": 51,
  "silt-lockbox": 18,
  "buried-lockbox": 24,
  "netted-lockbox": 18,
  "till-lockbox": 16,
  "reliquary-lockbox": 20,
};

function mechanicalValue(rawValue, tagsById) {
  const value = String(rawValue).trim();
  if (/^nothing$/i.test(value)) return null; // no comment needed
  if (/^[+-]\d+$/.test(value)) return null; // the number already says it all
  const tag = [...tagsById.values()].find((t) => t.slug === value);
  if (!tag) return null; // unknown to the catalog — sync will throw on this, not our job to comment
  if (tag.slug === OBOL_SLUG) return "the coin itself, worth 1 ⬢";
  if (ASSUMED_VALUES[tag.slug] != null) {
    const overrideValue = ASSUMED_VALUES[tag.slug];
    // A tag with a real (lower, deliberate) price still shows it, so the discount reads as intentional rather than a stale/wrong number.
    return tag.sellable && tag.sellablePrice
      ? `worth ${overrideValue} ⬢ opened (sells ${tag.sellablePrice} ⬢ locked)`
      : `assumed ${overrideValue} ⬢ (not actually sellable yet)`;
  }
  if (tag.sellable && tag.sellablePrice) return `sells ${tag.sellablePrice} ⬢`;
  // Not sellable, but consuming it pays out anyway (Purse, Supply Kit) — mirrors audit-mining-drops.js#priceEntry's own fallback.
  if (tag.consumesIntoResources) return `worth ${tag.consumesIntoResources} ⬢ consumed`;
  return "not sellable";
}

// Combined pool EV/hit-rate for one roll at one resolved scope — the exact runtime rule (scopeFilters + passesRequiredTag): what a payout in that scope actually draws from.
function combinedStats(rows, roll, { zoneId, locationId, heldTagIds }) {
  const scopes = scopeFilters(zoneId ?? null, locationId ?? null);
  const matched = rows.filter(
    (r) =>
      r.roll === roll &&
      scopes.some((s) => s.zoneId === r.zoneId && s.locationId === r.locationId) &&
      passesRequiredTag(r, heldTagIds),
  );
  return summarize(matched);
}

// Own-bucket EV/hit-rate: the exact scope tuple this node was authored at, no OR-expansion.
function ownStats(rows, roll, { zoneId, locationId, requiredTagId }) {
  const matched = rows.filter(
    (r) =>
      r.roll === roll &&
      r.zoneId === (zoneId ?? null) &&
      r.locationId === (locationId ?? null) &&
      r.requiredTagId === (requiredTagId ?? null),
  );
  return summarize(matched);
}

function summarize(rows) {
  if (rows.length === 0) return null;
  let hits = 0;
  let sum = 0;
  for (const r of rows) {
    if (r.kind === "NOTHING") continue;
    hits += 1;
    if (r.kind === "RESOURCES") sum += r.resourceAmount ?? 0;
    // TAG value folded in by the caller via tagValue(r), kept out of this pure summarizer so it stays independent of the tag catalog.
  }
  return { count: rows.length, hits, sum };
}

// summarize() can't price a TAG row without the catalog, so pricing happens up front:
// every row gets `.evValue` (⬢, 0 for unpriced/NOTHING), matching audit-mining-drops.js's EV rule. Also normalizes requiredTagId to explicit `null` — parseDoc's in-memory rows OMIT the key when there's no requiresTag ancestor (unlike a live Prisma row), and `undefined` here would silently fail every own-scope equality check below.
function priceRows(rows, tagsById) {
  return rows.map((r) => {
    const withTagId = { ...r, requiredTagId: r.requiredTagId ?? null };
    if (r.kind === "RESOURCES") return { ...withTagId, evValue: r.resourceAmount ?? 0 };
    if (r.kind === "TAG") {
      const tag = tagsById.get(r.tagId);
      if (tag?.slug === OBOL_SLUG) return { ...withTagId, evValue: 1 };
      if (tag && ASSUMED_VALUES[tag.slug] != null) return { ...withTagId, evValue: ASSUMED_VALUES[tag.slug] };
      if (tag?.sellable && tag.sellablePrice) return { ...withTagId, evValue: tag.sellablePrice };
      if (tag?.consumesIntoResources) return { ...withTagId, evValue: tag.consumesIntoResources };
      return { ...withTagId, evValue: 0 };
    }
    return { ...withTagId, evValue: 0 };
  });
}

function statLine(stats) {
  if (!stats) return null;
  return `EV ${(stats.ev ?? 0).toFixed(2)} ⬢ · hit ${Math.round((stats.hit ?? 0) * 100)}%`;
}

// Priced by BAND, not row count — rowShares (miningdropsRarity.js) gives each row's real chance under the face's column, so `ev` is a proper expectation and `hit` the actual miss rate, not "fraction of lines that aren't pads".
function computeStats(rows, roll, scope) {
  const matched = rows.filter((predicateFor(roll, scope)));
  if (matched.length === 0) return null;
  const shares = rowShares(matched, roll);
  let ev = 0;
  let hit = 0;
  matched.forEach((r, i) => {
    ev += (r.evValue ?? 0) * shares[i];
    if (r.kind !== "NOTHING") hit += shares[i];
  });
  return { count: matched.length, hits: hit, evSum: ev, ev, hit };
}

function predicateFor(roll, { mode, zoneId, locationId, requiredTagId, heldTagIds }) {
  if (mode === "own") {
    return (r) =>
      r.roll === roll &&
      r.zoneId === (zoneId ?? null) &&
      r.locationId === (locationId ?? null) &&
      r.requiredTagId === (requiredTagId ?? null);
  }
  const scopes = scopeFilters(zoneId ?? null, locationId ?? null);
  return (r) =>
    r.roll === roll &&
    scopes.some((s) => s.zoneId === r.zoneId && s.locationId === r.locationId) &&
    passesRequiredTag(r, heldTagIds ?? new Set());
}

// Comment for a roll-leaf line ("6:") — its own bucket's numbers, plus combined numbers if they differ (they always do unless this bucket has no ancestry to pool with).
function buildRollComment(rows, roll, frame) {
  const own = computeStats(rows, roll, { mode: "own", ...frame });
  const combined = computeStats(rows, roll, { mode: "combined", ...frame });
  if (!own && !combined) return null;
  const ownLine = own ? statLine(own) : "no entries here";
  const combinedLine = combined ? statLine(combined) : null;
  const isTrivial = combined && own && own.count === combined.count && own.ev === combined.ev;
  return isTrivial || !combinedLine
    ? `# ${ownLine}`
    : `# own ${ownLine} · combined ${combinedLine}`;
}

// Comment for a category header — the COMBINED EV for every roll 1-6 with anything
// at this scope, rolled into one number: the ACTUAL expected value of one Labor here, not per-face numbers side by side. The die is 1d6 uniform, so this is (1/6)*sum over all six faces' combined EV, and an unconfigured face (almost always 2-5) counts as a real zero — listing faces side by side reads as if they add up on their own, they don't without dividing by 6 and counting the unlisted faces too. Hit rate is weighted the same way: share of ALL SIX faces, not just the configured ones.
function buildRollupComment(rows, frame) {
  let totalEv = 0;
  let totalHitFraction = 0;
  let anyConfigured = false;
  for (let roll = 1; roll <= 6; roll++) {
    const combined = computeStats(rows, roll, { mode: "combined", ...frame });
    if (!combined) continue; // this face's own 0 is added by the /6 below either way
    anyConfigured = true;
    totalEv += combined.ev;
    totalHitFraction += combined.hit;
  }
  if (!anyConfigured) return null;
  const ev = (totalEv / 6).toFixed(2);
  const hitPct = Math.round((totalHitFraction / 6) * 100);
  return `# ⬢ EV/labor ${ev} · hit ${hitPct}%`;
}

// The exhaustive set of shapes mechanicalValue() can produce, numbers wildcarded —
// matches a bare mechanical comment from an EARLIER run even after the tag's price has since changed, which an exact match against TODAY's value would miss (and would otherwise duplicate as `# sells 21 ⬢ — sells 30 ⬢`). Kept in lockstep with mechanicalValue() by hand, same as audit-mining-drops.js#priceEntry.
const MECHANICAL_SHAPES = [
  /^the coin itself, worth \d+ ⬢$/,
  /^worth \d+ ⬢ opened \(sells \d+ ⬢ locked\)$/,
  /^assumed \d+ ⬢ \(not actually sellable yet\)$/,
  /^sells \d+ ⬢$/,
  /^worth \d+ ⬢ consumed$/,
  /^not sellable$/,
];

function looksMechanical(text) {
  return MECHANICAL_SHAPES.some((re) => re.test(text));
}

// Splits an existing entry comment into { blurb }. Convention: the author's "why"
// comes first, then " — ", then this tool's own mechanical fragment. Three cases: has " — " -> everything before it is the blurb. No " — " but the whole comment IS a bare mechanical comment (this tool's own prior write, or pre-convention legacy) -> no blurb, and critically NOT re-wrapped as one or every refresh would duplicate it ("sells 4 ⬢ — sells 4 ⬢") — matched by SHAPE (`looksMechanical`), not exact string, so a stale price is still recognized as bare. No " — ", anything else -> first comment on this entry: the whole text is a hand-written blurb with no mechanical suffix yet. `mech` (the freshly computed value, or null) is checked first since it's cheap and exact, ahead of the shape fallback.
function splitBlurb(comment, mech = null) {
  if (!comment) return { blurb: null };
  const text = comment.replace(/^#\s*/, "").trim();
  const idx = text.indexOf(" — ");
  if (idx !== -1) return { blurb: text.slice(0, idx).trim() };
  if (mech !== null && text === mech) return { blurb: null };
  if (looksMechanical(text)) return { blurb: null };
  return { blurb: text || null };
}


// The main pass. `lines` is the raw file split on "\n"; `ctx` carries the resolved catalogs (see db/scripts/ops/audit-mining-drops.js) plus `rows`, the parsed+priced MiningDropOption-shaped rows (syncMiningDrops.js#parseDoc, then priceRows()).
function annotateLines(lines, ctx) {
  const rows = ctx.rows;
  const out = [...lines];
  const stack = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || /^\s*#/.test(raw)) continue;

    const indent = indentOf(raw);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1] ?? null;

    const { code, comment } = splitComment(raw);
    const keyMatch = /^(\s*)([A-Za-z0-9_.-]+):\s*(\{\})?\s*$/.exec(code);
    const listMatch = /^(\s*)-\s+(.+)$/.exec(code);

    if (keyMatch) {
      const key = keyMatch[2];
      const isEmptyDict = Boolean(keyMatch[3]);

      if (!parent) {
        // `global`'s plan is empty from the start — its children are straight roll keys (or requiresTag), so it's pushed as already-at-rollLevel, not "top" (which expects a slug step next and would `continue` past global's roll keys).
        const plan = [...(BRANCH_PLANS[key] ?? [])];
        stack.push({
          indent,
          kind: plan.length ? "top" : "rollLevel",
          scope: {},
          heldTagIds: new Set(),
          plan,
        });
        continue;
      }

      if (parent.kind === "top" || parent.kind === "slugStep") {
        const [stepKind, ...restPlan] = parent.plan;
        if (!stepKind) continue; // malformed nesting — leave untouched
        const scope = { ...parent.scope };
        if (stepKind === "zoneSlug") scope.zoneId = ctx.zoneIdBySlug.get(key) ?? null;
        else if (stepKind === "locationSlug") scope.locationId = ctx.locationIdBySlug.get(key) ?? null;
        const frame = {
          indent,
          kind: restPlan.length ? "slugStep" : "rollLevel",
          scope,
          heldTagIds: parent.heldTagIds,
          plan: restPlan,
        };
        stack.push(frame);
        if (!isEmptyDict && !restPlan.length) {
          const rollup = buildRollupComment(rows, { ...frame.scope, heldTagIds: frame.heldTagIds });
          if (rollup) out[i] = withComment(code, rollup);
        }
        continue;
      }

      if (parent.kind === "rollLevel" || parent.kind === "skillLevel") {
        if (key === "requiresTag") {
          stack.push({ indent, kind: "requiresTagMarker", scope: parent.scope, heldTagIds: parent.heldTagIds });
          continue;
        }
        if (/^\d+$/.test(key)) {
          const roll = Number(key);
          const requiredTagId = parent.requiredTagId ?? null;
          const frame = {
            indent,
            kind: "rollLeaf",
            scope: parent.scope,
            requiredTagId,
            heldTagIds: parent.heldTagIds,
            roll,
          };
          stack.push(frame);
          const rollComment = buildRollComment(rows, roll, {
            ...frame.scope,
            requiredTagId,
            heldTagIds: frame.heldTagIds,
          });
          if (rollComment) out[i] = withComment(code, rollComment);
          continue;
        }
        // Unrecognized key at this depth — skip, don't guess.
        stack.push({ indent, kind: "unknown", scope: parent.scope, heldTagIds: parent.heldTagIds, plan: [] });
        continue;
      }

      if (parent.kind === "requiresTagMarker") {
        const requiredTagId = ctx.tagIdBySlug.get(key) ?? null;
        const heldTagIds = new Set(parent.heldTagIds);
        if (requiredTagId) heldTagIds.add(requiredTagId);
        const frame = {
          indent,
          kind: "skillLevel",
          scope: parent.scope,
          requiredTagId,
          heldTagIds,
          plan: [],
        };
        stack.push(frame);
        if (!isEmptyDict) {
          const rollup = buildRollupComment(rows, { ...frame.scope, heldTagIds: frame.heldTagIds });
          if (rollup) out[i] = withComment(code, rollup);
        }
        continue;
      }

      stack.push({ indent, kind: "unknown", scope: parent?.scope ?? {}, heldTagIds: parent?.heldTagIds ?? new Set(), plan: [] });
      continue;
    }

    if (listMatch && parent && parent.kind === "rollLeaf") {
      const rawValue = entrySlug(listMatch[2]);
      const mech = mechanicalValue(rawValue, ctx.tagsById);
      const { blurb } = splitBlurb(comment, mech);
      const newComment = mech ? `# ${blurb ? `${blurb} — ` : ""}${mech}` : blurb ? `# ${blurb}` : null;
      out[i] = withComment(code, newComment);
      continue;
    }
  }

  return out;
}

module.exports = { annotateLines, priceRows, mechanicalValue, splitBlurb, ASSUMED_VALUES };
