// What a consumable turns into for a character: consumesInto lists targets,
// consumesIntoUnless blocks one if the character holds a blocking slug,
// consumesIntoDurations overrides a grant's expiry, consumesIntoOneOf picks
// between alternatives at one position, consumesIntoResources grants flat ⬢.
//
// One more rule sits on top of those: the LADDER (Tag.escalatesInto,
// docs/systemdocs/BREWING.md). A non-stackable tag the character already
// holds is normally left completely alone, which is why a second beer used to
// do nothing whatsoever. If the held tag names a rung above it, the grant
// climbs instead: the held rung is cleared and the one above is granted.
// tipsy -> wasted -> unconscious.
//
// Two tags reshape a first drink or a climb, right where the ladder resolves:
// Lightweight sends the FIRST drink one rung above whatever it would have
// landed on — for every drink in the catalog that's Sober -> Wasted, skipping
// Tipsy entirely. Iron Liver does the opposite to a CLIMB
// (a rung already held moving up): it costs a drink to grant a "holding it
// down" marker instead of climbing, and only the drink after that actually
// climbs (clearing the marker too). Net Iron Liver pace: 1 drink -> Tipsy, two more
// -> Wasted, two more -> Unconscious. The catalog's conflictsWith keeps a
// character from holding both; if that were ever bypassed, Lightweight wins
// on a first drink and Iron Liver wins on a climb, since they check disjoint
// cases.
//
// Deliberately pure (no Prisma) so previews match real grants. A caller
// needing a stable preview must read consumesIntoOneOf directly, not call
// this twice — a second call can roll a different outcome.
//
// LIGHTWEIGHT_SLUG / IRON_LIVER_SLUG / HOLDING_SLUG live only here, on
// purpose: this file is imported by "use client" components (TagRail.js,
// RequestActionsProvider.js), so pulling in @lifeweb/db/lib/constants would
// drag the db package into the browser bundle. docs/tags.yaml is the source
// of truth for the slugs themselves — keep these three in sync with it by
// hand.
const LIGHTWEIGHT_SLUG = "lightweight";
const IRON_LIVER_SLUG = "iron-liver";
const HOLDING_SLUG = "holding-it-down";

// `heldSlugs` may be a Set or any iterable of slugs. `ladder` is an optional
// Map (or plain object) of slug -> escalatesInto, which the caller builds from
// the catalog; without one, no grant escalates and the old behaviour stands.
//
// `resistSlugs` (the medical pass, M4) is an optional Set/iterable of slugs
// the TARGET's held resist-traits shrug off (Tag.resists — Iron
// Constitution's sidecar). It applies here and ONLY here (plus the poison
// force-dose path below, which resolves the poison's own consumesInto
// through this same function) — never in grantTagSlugs, which the bot's GM
// `/heal` and every other writer share, and which must never filter a
// deliberate GM grant. Two effects: a `oneOf` position PREFERS a
// non-resisted branch when one exists (a resisted alternative is filtered
// out of the pick, not just re-rolled away from after landing on it), and
// whatever slug the position finally lands on — oneOf-picked or plain — is
// dropped from the grant if it's still in the resist set, reported back
// separately as `resisted` rather than silently vanishing.
//
// Returns the granted slugs (oneOf entries already resolved to one pick), the
// ones a condition blocked, the ones a resist shrugged off, the rungs to
// CLEAR off the sheet first, the expiry overrides that apply to the granted
// ones (a plain { slug: turns } map carrying only slugs that survived the
// filter), and the flat Resources amount to credit.
export function resolveConsumeGrants(tag, heldSlugs, ladder = null, resistSlugs = null) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const resistSet = resistSlugs instanceof Set ? resistSlugs : new Set(resistSlugs ?? []);
  const conditions = tag?.consumesIntoUnless ?? null;
  const overrides = tag?.consumesIntoDurations ?? null;
  const oneOfList = tag?.consumesIntoOneOf ?? null;
  const nextRung = (slug) => (ladder instanceof Map ? ladder.get(slug) : ladder?.[slug]) ?? null;
  // Every slug that is a rung on SOME ladder — either it escalates, or
  // something escalates into it. Needed because `nextRung(x) === null` alone
  // cannot tell "plain item" from "top rung": Unconscious and Paper both
  // answer null, and they want opposite things from a repeat.
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
  // Tracks what the sheet looks like as we go, so two of the same drink in one
  // consumesInto list climb two rungs rather than both landing on the first.
  const willHold = new Set(held);
  const consumesInto = tag?.consumesInto ?? [];
  for (let i = 0; i < consumesInto.length; i += 1) {
    const alternatives = oneOfList?.[i] ?? null;
    // A oneOf position PREFERS a branch the target doesn't shrug off (M4,
    // "food oneOf picks prefer a non-resisted branch for holders" —
    // skinned-cave-rat's vomiting/ate-meal split against Iron Constitution).
    // Filtered down to the non-resisted alternatives first, and only when
    // that leaves at least one — if every alternative is resisted, the pick
    // falls back to the full list, and the resist check below catches it.
    const candidates =
      Array.isArray(alternatives) && resistSet.size
        ? alternatives.filter((s) => !resistSet.has(s))
        : alternatives;
    const pickFrom = Array.isArray(candidates) && candidates.length ? candidates : alternatives;
    const picked = Array.isArray(pickFrom)
      ? pickFrom[Math.floor(Math.random() * pickFrom.length)]
      : consumesInto[i];

    // The condition is answered against what was PICKED, before the ladder
    // moves it: `unlessTags` is how a drink says "not for someone already in
    // this state", and letting the climb dodge that would invert it.
    const blockers = conditions?.[picked] ?? null;
    if (blockers?.some((b) => held.has(b))) {
      blocked.push(picked);
      continue;
    }

    // Where this rung actually lands, given what they already hold.
    let climbed = climbLadder(picked, willHold, nextRung);
    if (!climbed) {
      // climbLadder says "already holding this, and nothing sits above it".
      // For a real ladder that means the top rung: the drink is wasted on
      // them, nothing cleared and nothing granted.
      if (ladderRungs.has(picked)) continue;
      // For anything else it means the list asked for ANOTHER one — TAGS.md
      // §5b's "repeat a slug to grant several of it". Without this, every
      // copy after the first was silently dropped, so a Stack of Paper
      // listing `paper` twenty times handed over a single sheet, and none at
      // all to somebody already holding one. grantTagSlugs counts the
      // duplicates into a quantity, and collapses them for a non-stackable
      // target exactly as the doc says.
      climbed = { slug: picked, cleared: null };
    }

    // `picked` sits on a ladder only if it has a successor — a plain
    // consumable like a meal never does, and neither rule below applies to it.
    const onLadder = nextRung(picked) != null;
    if (onLadder && held.has(LIGHTWEIGHT_SLUG) && climbed.cleared === null) {
      // Lightweight: the first drink lands two rungs up (Sober -> Wasted)
      // instead of one.
      climbed = { slug: nextRung(picked), cleared: null };
    } else if (onLadder && held.has(IRON_LIVER_SLUG) && climbed.cleared !== null) {
      // Iron Liver: a climb (not a first drink) costs a "holding it down" marker
      // before it's allowed to land, doubling the drinks a climb takes.
      if (!willHold.has(HOLDING_SLUG)) {
        slugs.push(HOLDING_SLUG);
        willHold.add(HOLDING_SLUG);
        continue;
      }
      removes.push(HOLDING_SLUG);
      willHold.delete(HOLDING_SLUG);
    }
    const slug = climbed.slug;
    // The resist check itself (M4) — against the FINAL landing slug, after
    // the ladder/Lightweight/Iron Liver machinery above, since none of that
    // applies to a resistable Health slug in practice (nothing on a drinking
    // ladder carries `resists`) but the order has to be right regardless.
    // Nothing lands: no clear, no willHold update, no grant — the trait
    // shrugs the whole thing off as if it never landed.
    //
    // M4 added two more callers of this same function for a poison's own
    // consumesInto: consumeTagRequestImpl's poisoned draw passes the REAL
    // drinking ladder (a poisoned Consume climbs it exactly like the food's
    // own grant would), poisonCharacterRequestImpl's forced dose passes
    // `null` (see its own comment). The "nothing on a drinking ladder
    // carries resists" claim above still holds for both — no poison's
    // consumesInto target (choking, asleep, phrygian-toxin) is itself a
    // ladder rung — but it is now an assumption about the CATALOG, not a
    // structural guarantee this function enforces.
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

// The union of every `resists` list a character's held tags carry (Iron
// Constitution's sidecar, M4) — what resolveConsumeGrants' `resistSlugs`
// wants. `characterTags` is the `{ tag: { resists } }` shape used everywhere
// else in this file.
export function resistSlugsOf(characterTags) {
  const out = new Set();
  for (const ct of characterTags ?? []) {
    for (const slug of ct?.tag?.resists ?? []) out.add(slug);
  }
  return out;
}

// The held-slug set every call site needs, from the CharacterTag rows they
// already have in hand.
export function heldSlugsOf(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
}

// Where a granted rung lands for somebody already part-way up the ladder,
// and which rung (if any) has to come off the sheet to put them there.
//
// The walk starts at `picked` and follows the chain to find the HIGHEST rung
// this character already occupies — not merely whether they hold the picked
// one. That distinction is the whole feature: somebody already Wasted does
// not hold Tipsy, so a naive "is the picked slug held?" test would hand them
// a fresh Tipsy instead of putting them on the floor.
//
// Returns { slug, cleared } — `cleared` is null for somebody starting sober —
// or null when they are on the TOP rung already, meaning the grant does
// nothing at all. Never clear a rung without granting its successor: that
// would make one more drink sober you up.
//
// `nextRung` is a function slug -> slug|null. The chain is proved acyclic at
// sync time (db/lib/tagShapes.js), so both loops terminate. Exported so the
// sheet's "Click to consume →" hint and the real grant cannot disagree.
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
