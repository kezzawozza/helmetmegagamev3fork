// What a consumable turns into. On top sits the LADDER (Tag.escalatesInto,
// BREWING.md). Deliberately pure (no Prisma) so previews match real grants. A caller
// needing a stable preview must read consumesIntoOneOf directly, not call
// this twice — a second call can roll a different outcome.
const LIGHTWEIGHT_SLUG = "lightweight";
const IRON_LIVER_SLUG = "iron-liver";
const NOTHING_TOKEN = "nothing";
const HOLDING_SLUG = "holding-it-down";

// `resistSlugs` (M4) applies here and ONLY here
// through this same function) — never in grantTagSlugs, which the bot's GM
// `/heal` and every other writer share, and which must never filter a
// deliberate GM grant.
export function resolveConsumeGrants(tag, heldSlugs, ladder = null, resistSlugs = null) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const resistSet = resistSlugs instanceof Set ? resistSlugs : new Set(resistSlugs ?? []);
  const conditions = tag?.consumesIntoUnless ?? null;
  const overrides = tag?.consumesIntoDurations ?? null;
  const oneOfList = tag?.consumesIntoOneOf ?? null;
  const nextRung = (slug) => (ladder instanceof Map ? ladder.get(slug) : ladder?.[slug]) ?? null;
  const ladderEntries = ladder instanceof Map ? [...ladder.entries()] : Object.entries(ladder ?? {});
  const ladderRungs = new Set();
  for (const [from, to] of ladderEntries) {
    if (from) ladderRungs.add(from);
    if (to) ladderRungs.add(to);
  }

  const slugs = [];
  const blocked = [];
  const resisted = [];
  const removes = [];
  const durations = {};
  const willHold = new Set(held);
  const consumesInto = tag?.consumesInto ?? [];
  for (let i = 0; i < consumesInto.length; i += 1) {
    const alternatives = oneOfList?.[i] ?? null;
    const candidates =
      Array.isArray(alternatives) && resistSet.size
        ? alternatives.filter((s) => !resistSet.has(s))
        : alternatives;
    const pickFrom = Array.isArray(candidates) && candidates.length ? candidates : alternatives;
    const picked = Array.isArray(pickFrom)
      ? pickFrom[Math.floor(Math.random() * pickFrom.length)]
      : consumesInto[i];

    if (picked === NOTHING_TOKEN) continue;

    const blockers = conditions?.[picked] ?? null;
    if (blockers?.some((b) => held.has(b))) {
      blocked.push(picked);
      continue;
    }

    let climbed = climbLadder(picked, willHold, nextRung);
    if (!climbed) {
      if (ladderRungs.has(picked)) continue;
      // §5b's "repeat a slug to grant several of it". Without this, every
      climbed = { slug: picked, cleared: null };
    }

    // consumable like a meal never does, and neither rule below applies to it.
    const onLadder = nextRung(picked) != null;
    if (onLadder && held.has(LIGHTWEIGHT_SLUG) && climbed.cleared === null) {
      climbed = { slug: nextRung(picked), cleared: null };
    } else if (onLadder && held.has(IRON_LIVER_SLUG) && climbed.cleared !== null) {
      if (!willHold.has(HOLDING_SLUG)) {
        slugs.push(HOLDING_SLUG);
        willHold.add(HOLDING_SLUG);
        continue;
      }
      removes.push(HOLDING_SLUG);
      willHold.delete(HOLDING_SLUG);
    }
    const slug = climbed.slug;
    // shrugs the whole thing off as if it never landed.
    if (resistSet.has(slug)) {
      resisted.push(slug);
      continue;
    }
    if (climbed.cleared) {
      removes.push(climbed.cleared);
      willHold.delete(climbed.cleared);
    }
    willHold.add(slug);

    slugs.push(slug);
    const override = overrides?.[slug];
    if (override != null) durations[slug] = override;
  }
  return { slugs, blocked, resisted, removes, durations, resources: tag?.consumesIntoResources ?? 0 };
}

export function resistSlugsOf(characterTags) {
  const out = new Set();
  for (const ct of characterTags ?? []) {
    for (const slug of ct?.tag?.resists ?? []) out.add(slug);
  }
  return out;
}

export function heldSlugsOf(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
}

// nothing at all. Never clear a rung without granting its successor: that
// would make one more drink sober you up.
export function climbLadder(picked, heldSlugs, nextRung) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  let occupied = null;
  for (let rung = picked; rung; rung = nextRung(rung)) {
    if (held.has(rung)) occupied = rung;
  }
  if (!occupied) return { slug: picked, cleared: null };
  const above = nextRung(occupied);
  if (!above) return null;
  return { slug: above, cleared: occupied };
}
