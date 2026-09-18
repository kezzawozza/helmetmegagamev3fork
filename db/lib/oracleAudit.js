// Which AuditLog rows the Oracle is allowed to see, and how one is written
// for a language model. See docs/systemdocs/ORACLE.md. NOT
// web/lib/auditNarrative.js — that renders React SEGMENTS for AuditFeed, and
// db/ cannot import from web/ anyway. A model does not need prose:
// `heal | Ada Vance -> Bram Holt | tags: Splint` degrades gracefully on an
// unknown actionType. The JUDGEMENT below — which rows matter — lives here as
// data rather than a rendering table.

// The rows that are events in the fiction. Everything absent is dropped,
// including the "machine" band the turn engine writes per character per
// pass. Deliberately an ALLOWLIST: a new actionType stays invisible until
// someone decides it's a story fact — a missing line reads as a quiet turn,
// an unexpected one reads as a hallucination.
const INCLUDED = new Set([
  // Adjudication outcomes.
  "move_confirmed",
  "move_rejected",
  "caving_roll_resolved",
  "caving_loot_granted",

  // One person acting on another.
  "request_heal_character",
  "request_loot_character",
  "request_crucify_character",
  "request_intercept_fired",
  "request_intercept_released",
  "request_attack_filed",
  "request_loot_resources",
  "request_transfer_resources",
  "request_loot_tag",
  "request_transfer_tag",
  "escort_consented",

  // Things made, broken, eaten.
  "request_craft_tag",
  "request_destroy_tag",
  "request_consume_tag",

  // The Tower.
  "request_donate_blood",
  "request_feed_person",
  "request_feed_person_killed",

  // Motivation, identity, power.
  "request_fulfill_desire",
  "desire_set",
  "request_change_name",
  "request_disguise_self",
  "character_conceal_toggled",

  // Said to a whole zone at once — a PA carries an @here, so it's an event, not scenery.
  "intercom_broadcast",
  "faction_leader_set",
  "faction_treasurer_assigned",
  "faction_treasurer_revoked",
  "faction_member_added",
  "faction_member_removed",

  // Arrivals and departures — GM-actioned kills/revives are here because the OUTCOME is a fiction fact even when the actor isn't.
  "character_created",
  "member_left",
  "gm_character_killed",
  "gm_character_revived",
  "catatonic_deaths_resolved",

  // GM bookkeeping about a threat seat. No `locationId` in these rows, so
  // they never reach a zone page by accident; oracleInput.js#threatsBlock
  // pulls them here for the Threats correspondent.
  "threat_assigned",
  "threat_spawn_offered",
  "threat_spawn_cancelled",
  "objective_added",
  "objective_pinned",
  "objective_removed",
  "rite_fired",
]);

// Rows worth one line for the WHOLE TURN rather than one per character — the
// Oracle wants "hunger was charged" once, not ninety times.
const AGGREGATE = new Set(["hunger_resolved", "caving_resolved", "tag_expiry_resolved"]);

// A person shopping — real events, but a hundred crowd out what matters, so folded into one line per character by collapseShopping() below.
const SHOPPING = new Set(["request_add_tag", "request_remove_tag", "request_buy_tags"]);

// The `details` keys worth passing through — allowlist for the same reason
// INCLUDED is: an unknown key is more likely an id than a fact.
const DETAIL_KEYS = [
  "tagName",
  "quantity",
  "resourcesSpent",
  "amount",
  "resources",
  "mode",
  "matchedBy",
  "points",
  "pointsAwarded",
  "name",
  "previousName",
  "toName",
  "fromName",
  "locationName",
  "mining",
  "text",
  "desireName",
  "untilTurn",
  "blood",
  "died",
  "result",
  // "concealed" (hood on/off, see MEANINGFUL_WHEN_FALSE), "body" (intercom said, truncated), "threat" (objective lifecycle rows above).
  "concealed",
  "body",
  "threat",
  "party",
  "objective",
  "pinned",
  "role",
];

// Keys whose FALSE is a fact rather than an absence. Every other detail is
// skipped when false (noise on a flag that merely failed to apply); wrong
// for a flag that IS the event — a hood going ON or OFF is the same key with opposite values.
const MEANINGFUL_WHEN_FALSE = new Set(["concealed"]);

// "request_heal_character" -> "heal_character" — the prefix outlived the Request table.
function verb(actionType) {
  return String(actionType || "").replace(/^(request|gm|move|desire|faction|character|catatonic)_/, "") || actionType;
}

function truncate(text, max) {
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// One row as one line. `names` maps a characterId to the name to use — the
// caller decides true vs. presented (ORACLE.md), so this never resolves an identity itself.
function auditLine(row, names) {
  const actor = names.byDiscordUserId?.get(row.actorDiscordUserId) ?? null;
  const target = row.targetCharacterId ? (names.byCharacterId?.get(row.targetCharacterId) ?? null) : null;

  const parts = [verb(row.actionType)];
  // Acting on THEMSELVES stamps its own character as target — "Ada Vance -> Ada Vance" says nothing twice.
  if (actor && target && actor === target) parts.push(actor);
  else if (actor && target) parts.push(`${actor} -> ${target}`);
  else if (actor) parts.push(actor);
  else if (target) parts.push(target);

  const details = row.details && typeof row.details === "object" ? row.details : {};
  const kv = [];
  for (const key of DETAIL_KEYS) {
    const value = details[key];
    if (value == null || value === "") continue;
    if (value === false && !MEANINGFUL_WHEN_FALSE.has(key)) continue;
    // A quantity of 1 is the default, noise on every line.
    if (key === "quantity" && Number(value) <= 1) continue;
    kv.push(`${key}: ${typeof value === "string" ? truncate(value, 120) : value}`);
  }
  if (kv.length) parts.push(kv.join(", "));

  return parts.join(" | ");
}

// Ninety shopping rows become at most one line per character.
function collapseShopping(rows, names) {
  const byActor = new Map();
  for (const row of rows) {
    const who = names.byDiscordUserId?.get(row.actorDiscordUserId) ?? "somebody";
    const details = row.details && typeof row.details === "object" ? row.details : {};
    const label = details.tagName ?? (Array.isArray(details.tagNames) ? details.tagNames.join(", ") : null);
    if (!label) continue;
    const sign = row.actionType === "request_remove_tag" ? "−" : "+";
    if (!byActor.has(who)) byActor.set(who, []);
    byActor.get(who).push(`${sign}${label}`);
  }
  const lines = [];
  for (const [who, ops] of byActor) {
    const shown = ops.slice(0, 8);
    if (ops.length > shown.length) shown.push(`+${ops.length - shown.length} more`);
    lines.push(`tags | ${who} | ${shown.join(", ")}`);
  }
  return lines;
}

// Every audit row for a turn -> the lines the Oracle sees, filtered,
// collapsed and aggregated. Rows arrive already scoped to one zone; this
// makes no location judgement of its own. `aggregatesSeen` carries
// once-per-turn lines across zones, so "hunger was charged" appears once, not on all six pages.
function auditLinesFor(rows, names, aggregatesSeen = new Set()) {
  const lines = [];
  const shopping = [];

  for (const row of rows) {
    const type = row.actionType;
    if (AGGREGATE.has(type)) {
      if (aggregatesSeen.has(type)) continue;
      aggregatesSeen.add(type);
      lines.push(`turn | ${verb(type)}`);
      continue;
    }
    if (SHOPPING.has(type)) {
      shopping.push(row);
      continue;
    }
    if (!INCLUDED.has(type)) continue;
    lines.push(auditLine(row, names));
  }

  return [...lines, ...collapseShopping(shopping, names)];
}

module.exports = {
  INCLUDED,
  AGGREGATE,
  SHOPPING,
  auditLine,
  auditLinesFor,
};
