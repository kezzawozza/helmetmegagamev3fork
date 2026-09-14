// A role's starting_tags entry: a tag identifier and optionally a count.
// docs/roles.yaml authors these as display NAMES; `Role.startingTagSlugs`
// stores the resolved SLUG, looked up once at sync time by
// db/lib/syncRoles.js. Every runtime reader matches on slug now.
//
// Most roles want one of a thing. Repeating an entry N times can't express a
// count (the resolver is a `slug: { in: [...] }` set lookup that collapses
// duplicates), so the count rides in the string instead of a parallel array:
//
//   - merchants-license       -> { slug: "merchants-license", quantity: 1 }
//   - obol x5                 -> { slug: "obol", quantity: 5 }
//
// The suffix is deliberately strict — a trailing " x<digits>" and nothing
// else — so an identifier that really ends in something x-ish is not silently
// truncated into a count.
const STARTING_TAG_COUNT = /^(.*\S)\s+x(\d+)$/;

function parseStartingTag(entry) {
  const raw = String(entry ?? "").trim();
  const m = STARTING_TAG_COUNT.exec(raw);
  if (!m) return { slug: raw, quantity: 1 };
  const quantity = Number(m[2]);
  // "Thing x0" is a mistake, not a request for nothing; fall back to one.
  if (!Number.isInteger(quantity) || quantity < 1) return { slug: m[1], quantity: 1 };
  return { slug: m[1], quantity };
}

// Just the identifiers, for callers that only care WHICH tags a role touches.
function startingTagSlugs(entries = []) {
  return entries.map((e) => parseStartingTag(e).slug);
}

// Re-attach a count to a resolved slug for storage.
function formatStartingTag(slug, quantity) {
  return quantity > 1 ? `${slug} x${quantity}` : slug;
}

module.exports = { parseStartingTag, startingTagSlugs, formatStartingTag };
