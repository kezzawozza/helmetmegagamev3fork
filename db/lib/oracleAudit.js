// Which AuditLog rows the Oracle is allowed to see, and how one is written for
// a language model. See docs/systemdocs/ORACLE.md.
//
// NOT web/lib/auditNarrative.js, and deliberately so. That module renders a row
// into React SEGMENTS for AuditFeed — actor(), target(), chip(), res() nodes a
// client component resolves against a DTO carrying a names map. Reusing it here
// would mean rebuilding that DTO inside db/lib to flatten it straight back into
// a string, and db/ cannot import from web/ anyway.
//
// A model does not need prose. `heal | Ada Vance -> Bram Holt | tags: Splint`
// is about as short as the English sentence, needs no renderer, and degrades
// gracefully on an actionType nobody has taught this file about. What IS worth
// sharing is the JUDGEMENT below — which rows matter — and that lives here as
// data rather than as a rendering table.

// The rows that are events in the fiction. Everything absent from this set is
// dropped, including every type auditNarrative.js files under band "machine":
// the turn engine writes a row per character per pass, so a hundred players'
// doings sit under thousands of machine lines, and handing those to a model
// would cost more than the moves do.
//
// Deliberately an ALLOWLIST, not a denylist. A new actionType is invisible to
// the Oracle until somebody decides it is a story fact, which is the safe
// direction to fail: a missing line reads as a quiet turn, an unexpected one
// reads as a hallucination.
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

  // Said to a whole zone at once. A PA is not scenery — it carries an @here
  // and everybody hears it, so it belongs in the record of what happened.
  "intercom_broadcast",
  "faction_leader_set",
  "faction_treasurer_assigned",
  "faction_treasurer_revoked",
  "faction_member_added",
  "faction_member_removed",

  // Arrivals and departures. The GM-actioned kills and revives are here
  // because the OUTCOME is a fact in the fiction even though the actor is not.
  "character_created",
  "member_left",
  "gm_character_killed",
  "gm_character_revived",
  "catatonic_deaths_resolved",

  // The GM's own bookkeeping about a threat seat — a spawn offered, an
  // objective pinned. Nobody's `locationId` in these rows, so they never reach
  // a zone page by accident; oracleInput.js#threatsBlock pulls them here by
  // actionType for the Threats correspondent. See ORACLE.md.
  "threat_assigned",
  "threat_spawn_offered",
  "threat_spawn_cancelled",
  "objective_added",
  "objective_pinned",
  "objective_removed",
  "rite_fired",
]);

// Rows worth one line for the WHOLE TURN rather than one per character. The
// turn engine writes these per character; the Oracle wants "hunger was charged"
// once, not ninety times.
const AGGREGATE = new Set(["hunger_resolved", "auto_labor_resolved", "caving_resolved", "tag_expiry_resolved"]);

// Rows that are a person shopping. Real events, but a hundred of them in a turn
// crowds out everything that matters, so they are folded into one line per
// character by collapseShopping() below.
const SHOPPING = new Set(["request_add_tag", "request_remove_tag", "request_buy_tags"]);

// The `details` keys worth passing through, per row. AuditLog.details is an
// untyped Json blob whose shape only its call site knows, so this is an
// allowlist for the same reason INCLUDED is: an unknown key is more likely to
// be an id than a fact, and an id in the prompt is a token spent on nothing.
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
  "labor",
  "text",
  "desireName",
  "untilTurn",
  "blood",
  "died",
  "result",
  // A hood going on, or coming off. See MEANINGFUL_WHEN_FALSE below.
  "concealed",
  // What the intercom actually said. Truncated like any other long string —
  // the point is that a zone was addressed and roughly about what.
  "body",
  // The threat/objective lifecycle rows above.
  "threat",
  "party",
  "objective",
  "pinned",
  "role",
];

// Keys whose FALSE is a fact rather than an absence.
//
// Every other detail is skipped when false, which is right for a flag that
// merely failed to apply (`moodApplied: false` is noise on a line that already
// says what happened). It is wrong for a flag that IS the event: a hood going
// ON and a hood coming OFF are both things a GM wants to read, and they arrive
// as the same key with opposite values. Without this, `concealed: false` was
// dropped and the line read "conceal_toggled | Ada" either way — ambiguous in
// the one direction the reader cares about.
const MEANINGFUL_WHEN_FALSE = new Set(["concealed"]);

// "request_heal_character" -> "heal_character". The prefix outlived the Request
// table and is noise to a reader who is not grepping the log.
function verb(actionType) {
  return String(actionType || "").replace(/^(request|gm|move|desire|faction|character|catatonic)_/, "") || actionType;
}

function truncate(text, max) {
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// One row as one line. `names` maps a characterId to the name the Oracle should
// use — the caller decides whether that is the true name or the presented one
// (ORACLE.md: real names, mask annotated), so this function never resolves an
// identity itself and cannot leak one by accident.
function auditLine(row, names) {
  const actor = names.byDiscordUserId?.get(row.actorDiscordUserId) ?? null;
  const target = row.targetCharacterId ? (names.byCharacterId?.get(row.targetCharacterId) ?? null) : null;

  const parts = [verb(row.actionType)];
  // A row where somebody acted on THEMSELVES — pulling a hood up, putting on a
  // disguise, keying the intercom — stamps its own character as the target, and
  // "Ada Vance -> Ada Vance" is a token spent to say nothing twice.
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
    // A quantity of 1 is the default and saying so is noise on every line.
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

// Every audit row for a turn -> the lines the Oracle sees, already filtered,
// collapsed and aggregated. Rows arrive already scoped to one zone by the
// caller; this function makes no location judgement of its own.
//
// `aggregatesSeen` lets the caller carry the once-per-turn lines across zones,
// so "hunger was charged" appears in one zone's page rather than all six.
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
