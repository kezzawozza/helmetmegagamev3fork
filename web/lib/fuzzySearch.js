// Dependency-free fuzzy person-search, the one shared implementation — typo
// tolerance plus "found by anything about them" (role, faction, etc), not just name substrings.

// Field weights, highest wins on a multi-field hit (matchedField reports it).
const FIELD_WEIGHTS = {
  name: 100,
  role: 80,
  faction: 70,
  username: 60,
  zone: 50,
  tag: 45,
  status: 30,
  kind: 30,
  text: 25,
  notes: 15,
  preview: 20,
};

// field:term aliases. An unrecognised prefix is ordinary text, not a scope.
const FIELD_ALIASES = {
  name: "name",
  role: "role",
  job: "role",
  faction: "faction",
  zone: "zone",
  where: "zone",
  user: "username",
  username: "username",
  discord: "username",
  handle: "username",
  tag: "tag",
  status: "status",
  kind: "kind",
  type: "kind",
  text: "text",
  note: "notes",
  notes: "notes",
};

// Splits a query into bare terms (any field) and scoped terms (field:term, or
// @term for username:term) — a colon after an unrecognised word stays plain text.
export function parseQuery(query) {
  const bare = [];
  const scoped = [];
  for (const raw of String(query ?? "").trim().split(/\s+/).filter(Boolean)) {
    if (raw.startsWith("@") && raw.length > 1) {
      scoped.push({ field: "username", term: raw.slice(1) });
      continue;
    }
    const colon = raw.indexOf(":");
    if (colon > 0 && colon < raw.length - 1) {
      const field = FIELD_ALIASES[raw.slice(0, colon).toLowerCase()];
      if (field) {
        scoped.push({ field, term: raw.slice(colon + 1) });
        continue;
      }
    }
    bare.push(raw);
  }
  return { bare, scoped };
}

// Tier bonuses on top of field weight; field ordering matters most.
const TIER_EXACT = 40;
const TIER_PREFIX = 30;
const TIER_SUBSTRING = 20;
const TIER_FUZZY = 10;

function normalize(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .trim();
}

function tokenize(str) {
  return normalize(str)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Bounded Levenshtein — bails once distance is certain to exceed `max`.
function boundedLevenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const alen = a.length;
  const blen = b.length;
  let prev = new Array(blen + 1);
  let curr = new Array(blen + 1);
  for (let j = 0; j <= blen; j++) prev[j] = j;

  for (let i = 1; i <= alen; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[blen];
}

function maxDistanceFor(tokenLength) {
  if (tokenLength >= 6) return 2;
  if (tokenLength >= 3) return 1;
  return 0;
}

// Best tier bonus for one query token against one field, or null.
function scoreTokenAgainstField(qToken, fieldTokens, fieldWhole) {
  if (!qToken) return null;

  if (fieldTokens.includes(qToken) || fieldWhole === qToken) return TIER_EXACT;

  for (const ft of fieldTokens) {
    if (ft.startsWith(qToken)) return TIER_PREFIX;
  }
  if (fieldWhole.includes(qToken)) return TIER_SUBSTRING;

  const maxDist = maxDistanceFor(qToken.length);
  if (maxDist > 0) {
    for (const ft of fieldTokens) {
      if (boundedLevenshtein(qToken, ft, maxDist) <= maxDist) return TIER_FUZZY;
    }
  }
  return null;
}

// Every word (bare or scoped) must match SOME allowed field (AND across
// words); score sums each word's best hit, matchedField is the highest-weighted field hit.
export function scoreMatch(query, fields) {
  const { bare, scoped } = parseQuery(query);
  const words = [
    ...bare.map((term) => ({ term, field: null })),
    ...scoped.map(({ field, term }) => ({ term, field })),
  ];
  if (words.length === 0) return null;

  const fieldEntries = Object.entries(FIELD_WEIGHTS)
    .filter(([key]) => fields[key] != null && fields[key] !== "")
    .map(([key, weight]) => ({
      key,
      weight,
      whole: normalize(Array.isArray(fields[key]) ? fields[key].join(" ") : fields[key]),
      tokens: tokenize(Array.isArray(fields[key]) ? fields[key].join(" ") : fields[key]),
    }));
  if (fieldEntries.length === 0) return null;

  let total = 0;
  let bestField = null;
  let bestFieldWeight = -1;

  for (const word of words) {
    // A scoped word on an absent field can't match — real "no", not "ignore".
    const candidates = word.field ? fieldEntries.filter((fe) => fe.key === word.field) : fieldEntries;
    const qTokens = tokenize(word.term);
    if (qTokens.length === 0) return null;

    for (const qToken of qTokens) {
      let tokenBest = null;
      let tokenBestField = null;
      for (const fe of candidates) {
        const tier = scoreTokenAgainstField(qToken, fe.tokens, fe.whole);
        if (tier == null) continue;
        const score = fe.weight + tier;
        if (tokenBest == null || score > tokenBest) {
          tokenBest = score;
          tokenBestField = fe;
        }
      }
      if (tokenBest == null) return null; // AND across every token: all must hit
      total += tokenBest;
      if (tokenBestField.weight > bestFieldWeight) {
        bestFieldWeight = tokenBestField.weight;
        bestField = tokenBestField.key;
      }
    }
  }

  return { score: total, matchedField: bestField };
}
