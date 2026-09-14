// "Melee +2 while using swords" — the line under a tag's description wherever formatTagArmor's
// already does. Returns null for a tag with no `fighting` block. Callers must select `fighting`
// (FIGHTING_TAG_FIELDS in db/lib/fightingSkill.js) — a caller that forgets renders nothing rather than
// throwing. This says what ONE TAG does; it must never become a character's band — a per-tag line is
// fine on a chip anybody can open since `visible: false` tags with a real shift never reach a
// stranger. The band is a different question with a different answer (COMBAT.md, "Nobody reads an enemy").
const { POINTS_PER_TIER } = require("./fightingSkill");

const TREE_WORDS = { melee: "Melee", ranged: "Ranged", both: "Fighting" };

// A slug back into the name it came from — docs/tags.yaml's header states the invariant ("A SLUG IS
// ITS NAME, SLUGIFIED"), and db/lib/syncTags.js throws when the two disagree. Unlike requirementItems
// (db/lib/tagShapes.js), no denormalised label is stored here — these slugs are plain two-word names.
function nameFromSlug(slug) {
  return String(slug)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function nameList(slugs, join) {
  return slugs.map(nameFromSlug).join(join);
}

// Same U+2212 minus the Gambit line and the bot's roll use.
function shift(points) {
  const tiers = points / POINTS_PER_TIER;
  return `${tiers > 0 ? "+" : "−"}${Math.abs(tiers)}`;
}

// Each clause carries its own preposition (using/wearing/while/with) rather than one bolted on in
// front of all of them. Several clauses join with a comma because they are an AND.
function conditionOf(when) {
  if (!when) return null;
  const parts = [];
  if (when.weaponClass?.length) parts.push(`using ${when.weaponClass.map((c) => `${c}s`).join(" or ")}`);
  if (when.equipped?.length) parts.push(`wearing ${nameList(when.equipped, " and ")}`);
  if (when.holds?.length) parts.push(`while ${nameList(when.holds, " and ")}`);
  if (when.unarmoured?.length) {
    parts.push(`with nothing on your ${when.unarmoured.join(" or ").toLowerCase()}`);
  }
  return parts.length ? parts.join(", ") : null;
}

function formatTagFighting(tag) {
  const f = tag?.fighting;
  if (!f || typeof f !== "object") return null;

  // A weapon says what it is, not what it adds — its class is the useful fact.
  if (f.weaponClass) return `Counts as a ${f.weaponClass}`;

  // A rung is a position on the ladder; the ladder's own tag names already say where it sits.
  if (f.rung != null && f.points == null) return null;

  if (f.floor) return `You fight as ${nameFromSlug(f.floor)} at worst`;
  if (f.cap) return "You cannot fight";
  if (f.cancels?.length) return `Cancels the penalty from ${nameList(f.cancels, ", ")}`;

  // A situational says only that a gamemaster decides it — WHICH moment is the description's job.
  if (f.points == null) return f.situational ? "Situational" : null;
  const tree = TREE_WORDS[f.tree] ?? "Fighting";
  const clause = conditionOf(f.when);
  if (clause) return `${tree} ${shift(f.points)} ${clause}`;
  return f.situational ? `${tree} ${shift(f.points)} · situational` : `${tree} ${shift(f.points)}`;
}

module.exports = { formatTagFighting };
