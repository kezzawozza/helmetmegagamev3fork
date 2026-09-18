// The rules behind PlayerPreference.rolePriorities (docs/systemdocs/LOBBY.md §2). Pure functions, no DB, so the lobby's client component and the server action can never disagree about what "one High" means.
// Shape is { [roleSlug]: "LOW" | "MEDIUM" | "HIGH" }; absent is Off. Setting a role to HIGH demotes whichever role held HIGH before to MEDIUM, so there is only ever one.

const LEVELS = ["LOW", "MEDIUM", "HIGH"];
// Migrant is the one unlimited seat left. Commoner was the other, and the
// default — it went with Laboring, since it only ever existed to be the fate
// of somebody who wanted to work for a living.
const JOBLESS_ROLES = ["MIGRANT", "RETURN_TO_LOBBY"];

function setPriority(priorities, slug, level) {
  const next = { ...(priorities ?? {}) };
  if (level === "HIGH") {
    for (const [other, held] of Object.entries(next)) {
      if (other !== slug && held === "HIGH") next[other] = "MEDIUM";
    }
  }
  if (!level || level === "OFF") delete next[slug];
  else next[slug] = level;
  return next;
}

// Whatever was posted, reduced to known slugs at valid levels with at most one HIGH (first wins). `allowed` drops a whitelisted seat this player lacks the role for.
function normalizePriorities(raw, allowed) {
  const out = {};
  let sawHigh = false;
  const entries = raw && typeof raw === "object" ? Object.entries(raw) : [];
  for (const [slug, level] of entries) {
    if (!allowed.has(slug)) continue;
    if (!LEVELS.includes(level)) continue;
    if (level === "HIGH") {
      if (sawHigh) {
        out[slug] = "MEDIUM";
        continue;
      }
      sawHigh = true;
    }
    out[slug] = level;
  }
  return out;
}

function normalizeJoblessRole(raw) {
  return JOBLESS_ROLES.includes(raw) ? raw : "MIGRANT";
}

// True when Start would have nothing to give this player but the fallback.
function pickedNothing(priorities) {
  return Object.keys(priorities ?? {}).length === 0;
}

module.exports = { LEVELS, setPriority, normalizePriorities, normalizeJoblessRole, pickedNothing };
