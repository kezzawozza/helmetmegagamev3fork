// The audit log, in English — maps each AuditLog.actionType/details pairing to meaning.
// An unregistered actionType MUST still render via the fallback, never blank, never a throw.
// No Prisma, no server imports: AuditFeed is a client component.

const t = (v) => ({ k: "t", v });
const em = (v) => ({ k: "em", v });
// `id` is the tag's row id when the writer stored one beside the name snapshot.
// A log row keeps a NAME (ARCHITECTURE.md: log tables snapshot rather than hold
// FKs), and a name does not identify a runtime-minted row: paperName() calls
// every untitled note "A Note", so a name lookup over those picks an arbitrary
// one. Passing the id where we have it is what lets AuditSegments resolve the
// RIGHT note — and the reason it may never resolve a paper by name at all.
const chip = (v, id = null) => (v ? { k: "chip", v: String(v), ...(id ? { id: String(id) } : {}) } : null);
const mono = (v) => (v ? { k: "mono", v: String(v) } : null);
const zone = (v) => (v ? { k: "zone", v: String(v) } : null);
const actor = () => ({ k: "actor" });
const target = () => ({ k: "target" });

// Per CLAUDE.md the glyph REPLACES the word, so this is never written beside one.
const res = (n) => (Number.isFinite(Number(n)) ? { k: "res", v: Number(n) } : null);

// "×3", omitted entirely at 1 — noise on every single tag line otherwise.
const qty = (n) => (Number(n) > 1 ? { k: "qty", v: Number(n) } : null);


// `tags` is applyTagOpsInTx's `applied` array ({op, name, quantity}). Survives an old row with a missing name.
function tagOpSummary(tags) {
  const parts = [];
  for (const op of tags.slice(0, 4)) {
    const name = op.name ?? "a tag";
    const n = Number(op.quantity) > 1 ? ` ×${op.quantity}` : "";
    if (op.op === "add") parts.push(`+${name}${n}`);
    else if (op.op === "remove") parts.push(`−${name}`);
    else if (op.quantity != null) parts.push(`${name} → ×${op.quantity}`);
    else parts.push(name);
  }
  if (tags.length > parts.length) parts.push(`+${tags.length - parts.length} more`);
  return parts.join(", ");
}

// `d.from`/`d.to` are {kind, id, name} (web/app/(app)/character/requestActions.js#transferRequestImpl).
function transferSegments(d, ...payload) {
  const from = d?.from;
  const to = d?.to;
  const parts = payload.filter(Boolean);
  if (d?.destroyed) {
    return [actor(), t("tipped"), ...parts, t("into the trough")];
  }
  if (from?.kind === "room") {
    return [actor(), t("took"), ...parts, t("from"), em(from.name)];
  }
  if (to?.kind === "room") {
    return [actor(), t("left"), ...parts, t("in"), em(to.name)];
  }
  if (to?.kind === "character") {
    return [actor(), t("handed"), ...parts, t("to"), em(to.name)];
  }
  // A shape this fallback hasn't been taught — say the actor and the payload rather than nothing.
  return [actor(), t("transferred"), ...parts];
}

// `prefix` is what the fallback matches on; first match wins, prefixes must not overlap. `band` splits
// the log into "player" (own sheet) vs. "machine" (engine/staging/GM); page defaults to player.
export const AUDIT_FAMILIES = {
  // craft_/build_ never carried the request_ prefix; without this family they'd only surface under "Everything".
  request: { label: "Player action", band: "player", prefixes: ["request_", "desire_", "craft_", "build_"] },
  move: { label: "Move", band: "player", prefixes: ["move_", "caving_roll"] },
  lifeweb: { label: "Lifeweb", band: "player", prefixes: [] },
  membership: { label: "Membership", band: "player", prefixes: ["member_", "player_"] },
  gm: { label: "GM action", band: "machine", prefixes: ["gm_"] },
  staging: { label: "Staging", band: "machine", prefixes: ["staged_", "staging_"] },
  system: { label: "System", band: "machine", prefixes: ["turn_"] },
  superadmin: { label: "Superadmin", band: "machine", prefixes: ["superadmin_"] },
};

export const AUDIT_BANDS = {
  player: "What players did",
  machine: "Engine, staging and GM",
};

export function familiesInBand(band) {
  return Object.entries(AUDIT_FAMILIES)
    .filter(([, fam]) => fam.band === band)
    .map(([key]) => key);
}

// Here rather than beside the WHERE in web/lib/auditQuery.js, which imports Prisma — this stays client-safe.
export const DATE_PRESETS = {
  today: "Today",
  "24h": "Last 24h",
  turn: "This turn",
  "7d": "Last 7 days",
};

// `d` is entry.details ?? {}; every accessor must survive a null or missing key — read against years of history.
// `tone` is the StatusPill vocabulary, defaults to neutral; `bad` is reserved for DESTRUCTIVE below.

const R = {
  // ---- Player actions (web/lib/requests.js#logAudit) ----
  request_add_tag: (d) => [actor(), t("added"), chip(d.tagName, d.tagId), qty(d.quantity), t("for"), res(d.resourcesSpent)],
  request_remove_tag: (d) => [actor(), t("dropped"), chip(d.tagName, d.tagId), qty(d.quantity), t("for"), res(d.resourcesSpent)],
  // The craft-era names for the two rows above — same shapes.
  request_craft_tag: (d) => [actor(), t("made"), chip(d.tagName, d.tagId), qty(d.quantity), t("for"), res(d.resourcesSpent)],
  request_destroy_tag: (d) => [actor(), t("destroyed"), chip(d.tagName, d.tagId), qty(d.quantity)],
  request_consume_tag: (d) => [
    actor(), t("consumed"), chip(d.tagName, d.tagId),
    ...(d.administered ? [t("on"), target()] : []),
    ...(d.cured?.length ? [t("curing"), ...joinChips(d.cured.map((c) => c.tagName))] : []),
    ...(d.granted?.length ? [t("for"), ...joinChips(d.granted)] : []),
    ...(d.resourcesGranted ? [t("and"), res(d.resourcesGranted)] : []),
  ],
  // Soilery (db/lib/soilery.js): the harvest itself isn't decided yet at this point — it lands at
  // turn push (db/lib/moveEffects.js's `farmed` entry) — so this is the PLAN the character filed,
  // not the outcome. `d.farmPlan.rows` is `[{ slug, tagId, tagName, planted }, ...]`.
  request_farm: (d) => [
    actor(), t("sowed"),
    ...(d.farmPlan?.rows?.length
      ? joinChips(d.farmPlan.rows.map((row) => `${row.planted}× ${row.tagName}`))
      : [t("a field")]),
    ...(d.locationName ? [t("at"), zone(d.locationName)] : []),
  ],
  // Mining (web/app/(app)/character/actions/mine.js): paid at the press, so unlike Farm and
  // Refine below this row already knows what the day was worth.
  request_mine: (d) => [
    actor(), t("worked a seam"),
    ...(d.value != null ? [t("for"), em(`${d.value} ⬢`)] : []),
    ...(d.expression ? [t("out of"), em(d.expression)] : []),
  ],
  // Refining (web/app/(app)/character/actions/refine.js): the cubes land at the turn push
  // (db/lib/moveEffects.js's `refined` entry), so this is the shift filed, not the outcome.
  request_refine: (d) => [
    actor(), t("spent the day refining Godflesh"),
    ...(d.locationName ? [t("at"), zone(d.locationName)] : []),
  ],
  request_buy_tags: (d) => [
    actor(), t("bought"), ...joinChips(d.tags ?? []),
    ...(d.totalPoints ? [t(`for ${d.totalPoints} point${d.totalPoints === 1 ? "" : "s"}`)] : []),
  ],
  request_heal_character: (d) => [actor(), t("healed"), target(), ...effectTail(d)],
  // The old request_move_character line is gone; existing rows render through the fallback.
  escort_consented: (d) => [actor(), t("agreed to follow"), target(), t(`until turn ${d.untilTurn}`)],
  request_change_name: (d) => [actor(), t("renamed from"), em(d.previousName), t("to"), em(d.name)],
  request_loot_character: (d) => [actor(), t("looted"), target(), ...effectTail(d)],
  request_crucify_character: (d) => [actor(), t("crucified"), target(), ...(d?.locationName ? [t("at"), em(d.locationName)] : [])],
  // Intercept (docs/systemdocs/INTERCEPT.md). `fired` names the person by the face the room saw, never their true name.
  request_intercept_set: (d) =>
    d?.stopped
      ? [actor(), t(d?.reason === "moved" ? "left, so the watch ended" : "stopped watching the road")]
      : [
          actor(),
          t("laid in wait"),
          chip(d?.mode === "AMBUSH" ? "Ambush" : "Safe"),
          ...(d?.anyPerson
            ? [t("for anyone")]
            : d?.targetNames?.length
              ? [t("for"), em(d.targetNames.join(", "))]
              : d?.anyConcealed
                ? [t("for anyone concealed")]
                : []),
        ],
  request_intercept_fired: (d) => [
    actor(),
    t(d?.mode === "AMBUSH" ? "ambushed" : "intercepted"),
    target(),
    ...(d?.locationName ? [t("at"), em(d.locationName)] : []),
  ],
  request_intercept_released: () => [actor(), t("let"), target(), t("go")],
  // Attack (docs/systemdocs/ATTACK.md); an ambush that fired writes request_intercept_fired above.
  request_attack_filed: () => [actor(), t("attacked"), target()],
  request_attack_cancelled: () => [actor(), t("broke off from"), target()],
  request_loot_resources: (d) => [actor(), t("looted"), res(d.amount ?? d.resources), t("from"), target()],
  // Verb and preposition read by direction, so pickup/deposit/hand-off/Spillway each say the true shape.
  request_transfer_resources: (d) => transferSegments(d, res(d.amount ?? d.resources)),
  request_loot_tag: (d) => [actor(), t("looted"), chip(d.tagName, d.tagId), qty(d.quantity), t("from"), em(d.fromName)],
  request_transfer_tag: (d) => transferSegments(d, chip(d.tagName, d.tagId), qty(d.quantity)),
  request_fulfill_desire: (d) => [actor(), t("claimed a Desire for"), points(d.pointsAwarded)],
  request_donate_blood: (d) => [actor(), t("donated blood to the Lifeweb"), ...bloodTail(d)],
  request_feed_person: (d) => [actor(), t("fed a person to the Lifeweb"), ...bloodTail(d)],
  request_feed_person_killed: (d) => [t("The Lifeweb took"), em(d.targetName), t("— fed by"), actor()],
  // Kept so old rows still render — nothing writes these any more (DESIRES.md §1).
  desire_set: (d) => [actor(), t("set a Desire worth"), points(d.points), ...(d.text ? [t("—"), em(quote(d.text))] : [])],
  desire_cancelled: () => [actor(), t("cancelled their Desire")],
  desire_auto_cancelled: (d) => [t("A Desire of"), target(), t("was auto-cancelled"), ...(d?.desireName ? [t("—"), em(quote(d.desireName))] : [])],

  // ---- Request review, from the adjudication desk ----
  request_reviewed: (d) => [actor(), t("reviewed a"), em(typeWords(d.type)), t("request")],
  request_edited: (d) => [actor(), t("edited a"), em(typeWords(d.type)), t("request")],
  request_undone: (d) => [actor(), t("UNDID a"), em(typeWords(d.type)), t("request")],

  // ---- Moves ----
  move_submitted: () => [actor(), t("submitted a Move")],
  move_confirmed: (d) => [
    actor(), t("confirmed their Move"),
    ...(d.diceRoll != null ? [t("— rolled"), em(String(d.diceRoll)), ...(d.diceModifier ? [em(signed(d.diceModifier))] : [])] : []),
  ],
  move_rejected: (d) => [actor(), t("rejected a Move"), ...(d.description ? [t("—"), em(quote(d.description))] : [])],
  // A player rewriting or taking back their own Gambit before the lock (db/lib/moves.js).
  // The old rows from the first, removed Edit render through these too — they carried no
  // `from`/`to`, so the tail simply falls away.
  move_edited: (d) => [actor(), t("rewrote their Move"), ...(d.to ? [t("—"), em(quote(d.to))] : [])],
  move_withdrawn: (d) => [
    actor(),
    t("took their Move back"),
    ...(d.description ? [t("—"), em(quote(d.description))] : []),
  ],
  // move_${mode} modes from the adjudication desk; a mode with no line here renders via the `move_` fallback.
  move_solve: () => [actor(), t("solved a Move for"), target()],
  move_unsolve: () => [actor(), t("reopened a Move for"), target()],
  move_save: () => [actor(), t("edited a Move for"), target()],
  caving_roll_resolved: (d) => [
    actor(), t("resolved a Caving roll"),
    ...(d.die != null ? [t("— rolled"), em(String(d.die))] : []),
    ...(d.kind ? [chip(titleCase(d.kind))] : []),
  ],

  // ---- GM actions ----
  gm_character_applied: () => [actor(), t("edited"), target(), t("from the dev panel")],
  // Tag changes commit one gesture at a time; details.tags carries what actually moved.
  gm_character_tag_applied: (d) => [
    actor(),
    t("changed tags on"),
    target(),
    ...(d.tags?.length ? [chip(tagOpSummary(d.tags))] : []),
  ],
  // A LATER delete leaves the row with no target to link — details.name is the snapshot fallback.
  gm_character_killed: (d, e) => [actor(), t("killed"), e.target ? target() : em(d.name)],
  gm_character_revived: () => [actor(), t("revived"), target()],
  gm_character_deleted: (d) => [actor(), t("DELETED the character"), em(d.name)],
  gm_character_discord_resync: () => [actor(), t("resynced"), target(), t("with Discord")],
  // No possessives anywhere in this table: .audit-line's gap would render "X" + "'s turn" as "X 's turn".
  gm_turn_spent: (d) => [actor(), t("spent a turn for"), target(), ...(d.turn ? [t(`on turn ${d.turn}`)] : [])],
  gm_turn_restored: () => [actor(), t("restored a turn for"), target()],
  gm_dm_sent: (d) => [actor(), t("DM'd"), target(), ...lengthTail(d)],
  // A DM reply's target is a Discord user; the inspector links the id under Details.
  gm_dm_reply: (d, e) => [
    actor(), t("replied to"), e.target ? target() : em("a player"), ...msgTail(d.message),
  ],
  gm_message_sent: (d) => [actor(), t("messaged"), recipients(d.recipientCount ?? d.characterIds?.length), ...msgTail(d.message)],
  gm_message_delivered: () => [actor(), t("delivered a message to"), target()],
  gm_message_delivery_failed: () => [actor(), t("could NOT deliver a message to"), target()],
  gm_bulk_tag_grant: (d) => [actor(), t("granted"), chip(d.tagName, d.tagId), t("to"), recipients(d.applied ?? d.characterIds?.length), ...failedTail(d)],
  gm_bulk_tag_revoke: (d) => [actor(), t("revoked"), chip(d.tagName, d.tagId), t("from"), recipients(d.applied ?? d.characterIds?.length), ...failedTail(d)],
  gm_bulk_move: (d) => [actor(), t("moved"), recipients(d.characterIds?.length), t("to"), zone(d.locationName ?? d.zoneName)],
  gm_heal: (d) => [actor(), t("healed"), target(), ...(d.tagNames?.length ? [t("of"), ...joinChips(d.tagNames)] : [])],
  gm_custom_tag_created: (d) => [actor(), t("created the custom tag"), chip(d.name, d.tagId)],
  gm_custom_tag_updated: (d) => [actor(), t("edited the custom tag"), chip(d.name, d.tagId)],
  gm_custom_tag_deleted: (d) => [actor(), t("deleted the custom tag"), chip(d.name, d.tagId)],
  // gm_desire_set kept for old rows; a GM now AWARDS (gm_desire_fulfilled) or REVOKES (gm_desire_cancelled).
  gm_desire_set: (d) => [actor(), t("set a Desire for"), target(), t("worth"), points(d.points)],
  gm_desire_fulfilled: (d) => [actor(), t("awarded a Desire to"), target(), t("worth"), points(d.points)],
  // desireName and claimText are the Desire's name and the reason the player typed when claiming it.
  // Older rows have neither on the row; the audit page fills both in from the Desire itself.
  gm_desire_cancelled: (d) => [
    actor(), t("revoked a Desire of"), target(),
    ...(d.desireName ? [t("—"), em(quote(d.desireName))] : []),
    ...(d.claimText ? [t("— claimed as"), em(quote(truncate(d.claimText, 90)))] : []),
  ],
  gm_donated_lifeweb_blood: (d) => [actor(), t("donated blood for"), target(), ...bloodTail(d)],
  gm_fed_lifeweb_person: (d) => [actor(), t("fed a person to the Lifeweb"), ...bloodTail(d)],

  // ---- Staging (the adjudication desk's drafts, pushed at turn end) ----
  staged_message_created: (d) => [actor(), t("staged a"), em(kindWord(d.kind)), t("message for"), recipients(d.recipients?.length ?? d.recipients)],
  staged_message_updated: () => [actor(), t("edited a staged message")],
  staged_message_deleted: (d) => [actor(), t("deleted a staged"), em(kindWord(d.kind)), t("message")],
  staged_message_resent: (d) => [actor(), t("resent"), count(d.resent), t("staged messages"), ...(d.stillFailing ? [t(`— ${d.stillFailing} still failing`)] : [])],
  staged_effects_created: (d) => [actor(), t("staged effects on"), recipients(d.targets?.length ?? d.targets)],
  staged_effect_updated: () => [actor(), t("edited a staged effect")],
  staged_effects_deleted: (d) => [actor(), t("deleted"), count(d.count), t("staged effects")],
  staged_push_resolved: () => [t("The turn's staged effects and messages were pushed")],
  staged_push_delivery_failed: () => [t("A staged message failed to deliver at push")],
  staging_retargeted: (d) => [
    actor(), t("moved"), count((d.effects ?? 0) + (d.messages ?? 0)), t("staged rows to turn"), em(String(d.toTurnNumber ?? "?")),
  ],

  // ---- Membership ----
  character_created: (d) => [
    actor(), t("created"), target(),
    ...(d.role ? [t("—"), chip(d.role)] : []),
    ...(d.location || d.zone ? [t("in"), zone(d.location ?? d.zone)] : []),
  ],
  member_joined: (d) => [em(d.username ?? "Someone"), t("joined the guild")],
  member_left: (d) => [em(d.username ?? "Someone"), t("left the guild"), ...(d.characterName ? [t("—"), em(d.characterName)] : [])],
  // Kept so old rows still render (Bascinet 2 replaced both with Conversations).
  player_topic_created: () => [actor(), t("opened a public topic")],
  player_thread_created: () => [actor(), t("opened a conversation")],
  thread_persistence_changed: () => [actor(), t("changed a thread's persistence")],
  character_conceal_toggled: (d) => [
    actor(),
    t(d.concealed ? "put their hood up" : "put their hood down"),
  ],

  // ---- System (actor is "system") ----
  // Weather was deleted; the clause is guarded so old rows that carry it still read.
  turn_advanced: (d) => [
    t("Turn"), em(String(d.number ?? "?")), t("opened — day"), em(String(d.dayNumber ?? "?")),
    ...(d.weather ? [t("·"), em(titleCase(d.weather))] : []),
  ],
  turn_resume: () => [t("A half-finished turn advance was resumed")],
  turn_pass_failed: (d) => [t("A turn pass FAILED"), ...(d.pass ? [t("—"), em(d.pass)] : [])],
  // Hunger bills nobody now — the pass only asks who ate (db/lib/hungerPass.js).
  hunger_resolved: (d) => [
    t("Everyone was checked for whether they ate"),
    ...((d.starved ?? 0) > 0 ? [t("—"), em(`${d.starved} went hungry`)] : []),
  ],
  mining_yields_drifted: (d) => [
    t("What the land is worth shifted"),
    ...((d.drifted ?? 0) > 0 ? [t("—"), em(`${d.drifted} places changed`)] : []),
  ],
  catatonic_resolved: () => [t("Catatonic characters were resolved for the turn")],
  catatonic_deaths_resolved: (d) =>
    (d.killed ?? 0) > 0
      ? [t("Catatonic death claimed"), em((d.names ?? []).join(", ") || String(d.killed))]
      : [t("The Catatonic death pass ran — nobody died")],
  caving_resolved: () => [t("The Caving Die was rolled for everyone in the Depths")],
  tag_expiry_resolved: () => [t("Expiring tags were retired for the turn")],
  access_revoke_incomplete: () => [t("A channel access revoke did not complete")],

  // ---- Superadmin ----
  superadmin_turn_forced: (d) => [actor(), t("FORCED turn"), em(String(d.number ?? "?")), t("open")],
  superadmin_game_wipe: (d) => [actor(), t("started a GAME WIPE —"), count(d.characters), t("characters")],
  superadmin_game_wipe_finished: () => [actor(), t("finished the GAME WIPE")],
  superadmin_gm_zones_assigned: (d) => [
    actor(), t("seated a GM in"),
    ...(d.zoneNames?.length ? joinZones(d.zoneNames) : [t("no zone")]),
  ],
  // The single-zone predecessor, kept so old rows still read.
  superadmin_gm_zone_assigned: (d, e) => [
    actor(), t("seated a GM in"), zone(name(e, d.zoneId)) ?? em("no zone"),
  ],
};

// Modes beyond the two spelled out above arrive as strings this file never saw; the fallback handles them.

// Rows a GM scanning for "what went wrong" needs to find.
const DESTRUCTIVE = new Set([
  "gm_character_deleted",
  "gm_character_killed",
  "gm_custom_tag_deleted",
  "gm_bulk_tag_revoke",
  "superadmin_game_wipe",
  "superadmin_game_wipe_finished",
  "superadmin_turn_forced",
  "request_undone",
  "request_feed_person_killed",
  "request_crucify_character",
  "move_rejected",
  "staged_message_deleted",
  "staged_effects_deleted",
  "member_left",
]);

// Something did not work — distinct from destructive: nobody chose it.
const WARNING = new Set([
  "gm_message_delivery_failed",
  "staged_push_delivery_failed",
  "turn_pass_failed",
  "access_revoke_incomplete",
]);

function auditTone(actionType) {
  if (DESTRUCTIVE.has(actionType)) return "bad";
  if (WARNING.has(actionType)) return "warn";
  if (actionType?.startsWith("superadmin_")) return "accent";
  return "neutral";
}


// Overrides for the handful whose name does not carry their family.
const FAMILY_OVERRIDES = {
  // A find happened TO a player; neither name matches the `caving_roll` prefix.
  caving_loot_granted: "move",
  caving_loot_undone: "gm",
  request_donate_blood: "lifeweb",
  request_feed_person: "lifeweb",
  request_feed_person_killed: "lifeweb",
  gm_donated_lifeweb_blood: "lifeweb",
  gm_fed_lifeweb_person: "lifeweb",
  character_created: "membership",
  character_conceal_toggled: "membership",
  thread_persistence_changed: "membership",
  hunger_resolved: "system",
  default_moves_resolved: "system",
  catatonic_resolved: "system",
  catatonic_deaths_resolved: "system",
  caving_resolved: "system",
  tag_expiry_resolved: "system",
  access_revoke_incomplete: "system",
};

export function auditFamily(actionType) {
  if (!actionType) return "system";
  if (FAMILY_OVERRIDES[actionType]) return FAMILY_OVERRIDES[actionType];
  for (const [key, fam] of Object.entries(AUDIT_FAMILIES)) {
    if (fam.prefixes.some((p) => actionType.startsWith(p))) return key;
  }
  return "system";
}

// The known action types per family; unknown ones are caught by the prefix branch — see buildAuditWhere.
export function knownTypesInFamily(family) {
  return Object.keys(R).filter((k) => auditFamily(k) === family);
}

export function familyPrefixes(family) {
  return AUDIT_FAMILIES[family]?.prefixes ?? [];
}


// `entry` carries `names`, an id -> name object (tags, zones) so a renderer can name a bare id.
export function describeAudit(entry) {
  const type = entry?.actionType ?? "";
  const details = entry?.details && typeof entry.details === "object" ? entry.details : {};
  const render = R[type];

  let segments;
  if (render) {
    try {
      segments = render(details, entry);
    } catch {
      // A row under an old payload shape must not take the page down with it.
      segments = null;
    }
  }
  if (!segments) segments = fallback(type, entry);

  return {
    family: auditFamily(type),
    familyLabel: AUDIT_FAMILIES[auditFamily(type)].label,
    tone: auditTone(type),
    segments: segments.filter(Boolean),
  };
}

// "request_add_tag" -> "Request add tag" — deliberately plain, reads as unregistered rather than a sentence.
export function prettifyActionType(actionType) {
  if (!actionType) return "Unknown action";
  const words = actionType.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fallback(type, entry) {
  const head = [actor(), t("—"), em(prettifyActionType(type))];
  // Naming the target still tells a GM who a strange row is about.
  return entry?.target ? [...head, t("on"), target()] : head;
}


function joinChips(list) {
  const out = [];
  list.forEach((v, i) => {
    if (i > 0) out.push(t(i === list.length - 1 ? "and" : ","));
    out.push(chip(v));
  });
  return out;
}

function joinZones(list) {
  const out = [];
  list.forEach((v, i) => {
    if (i > 0) out.push(t(i === list.length - 1 ? "and" : ","));
    out.push(zone(v));
  });
  return out;
}

// Request effects are a free-form delta object; surface the two common keys, leave the rest to the inspector.
function effectTail(d) {
  const bits = [];
  if (Number.isFinite(Number(d.resources))) bits.push(t("—"), res(d.resources));
  if (d.tagNames?.length) bits.push(t("—"), ...joinChips(d.tagNames));
  return bits;
}

function bloodTail(d) {
  const delta = d.bloodDelta ?? d.amount;
  return Number.isFinite(Number(delta)) ? [t("—"), em(`${signed(delta)} Blood`)] : [];
}

function msgTail(message) {
  if (!message) return [];
  return [t("—"), em(quote(truncate(message, 90)))];
}

function lengthTail(d) {
  return Number.isFinite(Number(d.length)) ? [t(`— ${d.length} characters`)] : [];
}

function failedTail(d) {
  return d.failed?.length ? [t(`— ${d.failed.length} failed`)] : [];
}

function recipients(n) {
  const count = Number(n);
  if (!Number.isFinite(count)) return t("several characters");
  return em(`${count} character${count === 1 ? "" : "s"}`);
}

function count(n) {
  return em(String(Number.isFinite(Number(n)) ? n : "?"));
}

function points(n) {
  const v = Number(n);
  return em(Number.isFinite(v) ? `${v} point${v === 1 ? "" : "s"}` : "points");
}

// A bare id turned into its name via the page's lookup; falls back to nothing rather than a raw cuid.
function name(entry, id) {
  if (!id) return null;
  return entry?.names?.[id] ?? null;
}

function kindWord(kind) {
  return kind === "PUBLIC" ? "public" : "private";
}

function typeWords(type) {
  return type ? String(type).replace(/_/g, " ").toLowerCase() : "";
}

function titleCase(v) {
  if (!v) return "";
  return String(v)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function signed(n) {
  const v = Number(n);
  return v > 0 ? `+${v}` : String(v);
}

function quote(v) {
  return `“${String(v).trim()}”`;
}

function truncate(v, max) {
  const s = String(v).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
