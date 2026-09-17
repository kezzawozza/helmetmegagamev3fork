const HUNGER_SLUG = "hungry";
// The deeper band of the 0-100 hunger meter (db/lib/hunger.js) — <= 0 hunger.
const STARVING_SLUG = "starving";
const HUNGERLESS_SLUG = "hungerless";
// Doubles the meter's decay to 20/turn (db/lib/hunger.js), hardcoded by slug — no generic upkeep field on Tag.
const FAST_METABOLISM_SLUG = "fast-metabolism";
const DYING_SLUG = "dying";
// Vaporised outright (Thanati rites, the bomb — db/lib/characterDeath.js `gib`). No corpse minted.
const GIBBED_SLUG = "gibbed";
const NOBILITY_SLUG = "nobility";
const COURTIER_SLUG = "courtier";
const ATE_MEAL_SLUG = "ate-meal";
const MORTUS_SLUG = "mortus";
const DRAINED_SLUG = "drained";
// The two-stage fatigue ladder — see db/lib/fatigue.js.
const TIRED_SLUG = "tired";
const EXHAUSTED_SLUG = "exhausted";
// The `auto:` markers the two day-spending buttons stamp on the Action they
// file (db/lib/moveEffects.js reads them to decide what to push at turn
// close). Soilery's own "auto:farm" is written at its call site; these two are
// shared between the web action that files the Move and the effect that
// resolves it, so they are named once here.
const AUTO_MINE_NOTE = "auto:mine";
const AUTO_REFINE_NOTE = "auto:refine";

// One gates the Mine button, one gates Farm. Neither gates the other — see
// docs/systemdocs/MINING.md.
const PROSPECTING_SLUG = "prospecting";
const SOILERY_SLUG = "soilery";
const CATATONIC_SLUG = "catatonic-afk";
// Over a carry cap (db/lib/carry.js). Granted/cleared by settleCarry; read by the travel gate in db/lib/locationTravel.js.
const OVERBURDENED_SLUG = "overburdened";
// Fertilizer's buff (SOILERY.md's Addendum) — read by farmRequestImpl to flip
// db/lib/soilery.js#reap into its bounty table instead of the wither one.
const FERTILIZED_FIELDS_SLUG = "fertilized-fields";

// Read on a gate crossing (db/lib/locationMove.js#announceGateCrossing) — a MANNED gate falls back to what a passer-by saw.
const STEALTH_SLUG = "stealth";

// Corpses (docs/systemdocs/CORPSES.md). BUTCHER_SLUG gates the Butcher button; ENGRAVE_RESOURCE_COST
// is the cost of carving a stone with no body found.
const CORPSE_GROUP_SLUG = "items-corpse";
const BUTCHER_SLUG = "butcher";

// The two standing kits (db/lib/equipmentReach.js), satisfied by HOLDING or standing where one is set
// up. Workshop Equipment gates smithing/building; Surgical Equipment is +1 on a medical Gambit.
const WORKSHOP_EQUIPMENT_SLUG = "workshop-equipment";
// Trinket's skilled floor (TRINKETS.md): can't roll below Normal, read straight off the sheet by db/lib/trinketPass.js.
const SMITHING_SKILLED_SLUG = "smithing-skilled";
// The third standing kit, turning on the Package button. Not craftable — exactly two exist.
const PACKAGING_EQUIPMENT_SLUG = "packaging-equipment";
// What one crate holds. 150 lb is the number the Squeeze economy is balanced on (FACTORY.md).
const PACKAGE_MAX_LBS = 150;
// Bounds the weightless too — obols are 0 lb and stackable without a ceiling otherwise.
const PACKAGE_MAX_UNITS = 200;
const PACKAGE_LABEL_MAX = 120;

// The Raven Draught carries one sentence (BIRD.md §8a). Shared so the textarea and the server clamp can't drift.
const WHISPER_MAX = 400;
const SURGICAL_EQUIPMENT_SLUG = "surgical-equipment";
// One-use stand-in (M3, TAGS.md §5c): +1 on a single medical Gambit die, spent on use, held-by-the-actor only.
const PORTABLE_SURGICAL_PACK_SLUG = "portable-surgical-pack";
// The fourth standing kit: +1 on a torture roll within reach (db/lib/torture.js). TORTURER_SLUG shows the button.
const TORTURING_EQUIPMENT_SLUG = "torturing-equipment";
const TORTURER_SLUG = "torturer";

// Mutilate's gate: any ONE shows the button (TORTURE.md §6) — no single "would cut pieces off somebody" tag.
const MUTILATE_GATE_SLUGS = Object.freeze([
  "cruel",
  "torturer",
  "thanati",
  "medical-basic",
  "medical-skilled",
  "medical-expert",
  "butcher",
]);

// Kissing's OTHER gate (KISS.md); incapacity half is db/lib/incapacitation.js. Things that walk/work/
// talk normally but still can't kiss: not-a-person (ghoul/apex-form/servant-of-tzchernobog), bloodlust
// (rage), consent-is-meaningless (broken/broken-enslaved — keeps {desire:dem-kiss-a-broken} a GM call),
// and the phrygian-toxin/poison-tooth tell. Taste/belief tags (Prudish, Eunuch, etc) stay OUT — they lock Desires, not the verb.
const KISS_BLOCKING_SLUGS = Object.freeze([
  "ghoul",
  "rage",
  "servant-of-tzchernobog",
  "apex-form",
  "broken",
  "broken-enslaved",
  "phrygian-toxin",
  "installed-poison-tooth",
]);

// Puts a Sound Trumpet button on your Character page; heard across the Location graph (db/lib/trumpet.js).
const TRUMPET_SLUG = "trumpet";

// Arelitz (ARELITZ.md) — bred in a Stable room, not crafted. No food
// upkeep, unlike the old Horse family this replaced: db/lib/horseUpkeepPass.js
// and its UPKEEP_SLUGS are gone along with it.
const ARELITZ_SLUG = "arelitz";
const UNRULY_ARELITZ_SLUG = "unruly-arelitz";
const ARELITZ_HATCHLING_SLUG = "arelitz-hatchling";
const ARELITZ_YOUNGLING_SLUG = "arelitz-youngling";
const ARELITZ_YEARLING_SLUG = "arelitz-yearling";
const ARELITZ_MASTERY_SLUG = "arelitz-mastery";
const ARELITZ_EGG_SLUG = "arelitz-egg";

// The stable's per-Room cap on arelitz + brood, and the two dice ARELITZ.md
// specifies. GameConfig.stableCapacity/db:check-config carries the tunable
// default; these are the code fallbacks (same posture as FARM_MAX_CROPS).
const STABLE_CAPACITY = 10;
const HATCH_IN = 30;
// A d6, target 5+ (roughly 1-in-3 before mood/hunger modifiers) — Bascinet's
// chosen difficulty for db/lib/arelitz.js's break-in Gambit.
const BREAK_IN_TARGET = 5;
const HUMAN_FLESH_SLUG = "human-flesh";
const ENGRAVE_RESOURCE_COST = 3;
// Turns a person's corpse stays fresh. Monster corpses never rot.
const CORPSE_ROT_TURNS = 3;

// The Teaching tree (LESSONS.md). Anyone may teach: it costs them their
// Routine and their student needs UNTAUGHT_LESSON_THRESHOLD. TEACHING_SLUG
// costs its holder no Move at all, carries up to TEACHING_CAPACITY students a
// turn, and drops the student to LESSON_THRESHOLD; a Drill Instructor's
// students succeed on DRILL_THRESHOLD for FIGHTING_GROUP_SLUG skills.
const TEACHING_SLUG = "teaching";
const DRILL_INSTRUCTOR_SLUG = "teaching-drill-instructor";
const FIGHTING_GROUP_SLUG = "skills-fighting";
const TEACHING_CAPACITY = 3;
const UNTAUGHT_LESSON_THRESHOLD = 6;
const LESSON_THRESHOLD = 5;
const DRILL_THRESHOLD = 4;

// Confession (CONFESSION.md). CHAPLAIN_SLUG (the Bishop holds it too) is the gate, not the role.
const CHAPLAIN_SLUG = "chaplain";
const CONFESSION_THRESHOLD = 5;

// The one "read someone else's sheet" tag (db/lib/inspectVision.js). Mindreading is deliberately NOT here — GM-adjudicated Gambit, not code.
const SEDUCTIVE_DEMONESS_SLUG = "demoness-seductive";

// "Ate a fine/lavish meal this turn" — granted by consumesInto, consumed by the mood pass, never by time.
const DINED_SLUG = "dined";
// What a drawback-triggered ride leaves you as (db/lib/locationTravel.js).
const VOMITING_SLUG = "vomiting";
// Drawback slugs read by their scripted mechanics.
const LAZY_SLUG = "lazy";
const GUILT_RIDDEN_SLUG = "guilt-ridden";
const INSOMNIAC_SLUG = "insomniac";
const MOTION_SICKNESS_SLUG = "motion-sickness";
// Lightweight / Iron Liver / Steady's slugs live only in web/lib/consumeGrants.js (ships to the client).
const DEBTOR_SLUG = "debtor";
// Manic keeps its own copy in db/lib/desireGates.js (deep-imported by client components) but stays listed here too.
// A WOUND, not an illness/state of mind — shared by the mood dial and Second Wind (db/lib/fightingSkill.js).
const WOUND_TAG_GROUPS = Object.freeze(["health-wounds", "health-maiming", "health-infection"]);

const LUCKY_SLUG = "lucky";
const MANIC_SLUG = "manic";
const METEMPSYCHOSIS_SLUG = "metempsychosis";
// A pure counter (db/lib/reincarnate.js): one stack added per life spent, never removed by rolling.
const HEIGHTENED_PSYCHOSIS_SLUG = "heightened-psychosis";
const AMOR_FATI_SLUG = "amor-fati";
const IMPERTURBABLE_SLUG = "imperturbable";
// Imperturbable's opposite number, and the only other tag that PINS the dial
// rather than nudging it: while the high lasts, the holder is at MOOD_MAX
// every turn no matter what is done to them. See db/lib/mood.js.
const CHANGA_HIGH_SLUG = "changa-high";
const SECOND_WIND_SLUG = "second-wind";
const BREWING_DISTILLING_SLUG = "brewing-distilling";
const MUSICIAN_PYTHAGOREAN_SLUG = "musician-pythagorean";
// The instrument, and the skill that plays it well — shared so web /play (Chat) and the bot's /play read the same slugs.
const INSTRUMENT_SLUG = "instrument";
const MUSICIAN_SLUG = "musician";
// The phobias, Brave, Pale, Rough Camper and friends are read by slug inside db/lib/mood.js's multiplier table.

// A ZONE slug, not a tag: the Fortress holds the Lifeweb tower and the PA system.
const FORTRESS_SLUG = "fortress";

// #leave — GM-only departure alerts and catatonic deaths, hardcoded (db/lib/roleIds.js reason). Lives in db/ since db/index.js's turn-engine thunk posts death alerts here too.
const LEAVE_ANNOUNCE_CHANNEL_ID = "1540014692926361651";

// Tag.category holds the DISPLAY NAME from docs/tags.yaml's `categories:` map
// ("Items"), not the slug it is keyed by ("items") — db/lib/syncTags.js resolves
// one to the other before writing. Every runtime minter has to spell the same
// thing, and for a long time five of the six did not: paper, corpses, photos,
// pointer devices and crates all wrote the raw slug, so a player's own notes
// landed in a second category one capital letter away from the real one. That
// is not only cosmetic — web/app/(app)/chat/thingRows.js matches this string
// exactly, so every one of those rows was invisible in the Things drawer.
// Use these; never a bare string.
const TAG_CATEGORY = Object.freeze({
  META: "Meta",
  GENERAL: "General",
  SKILLS: "Skills",
  STATUS: "Status",
  HEALTH: "Health",
  ITEMS: "Items",
  ASSETS: "Assets",
  DEMONESS: "Demoness",
});

module.exports = {
  FORTRESS_SLUG,
  LEAVE_ANNOUNCE_CHANNEL_ID,
  HUNGER_SLUG,
  STARVING_SLUG,
  HUNGERLESS_SLUG,
  FAST_METABOLISM_SLUG,
  DYING_SLUG,
  GIBBED_SLUG,
  NOBILITY_SLUG,
  COURTIER_SLUG,
  ATE_MEAL_SLUG,
  MORTUS_SLUG,
  DRAINED_SLUG,
  TIRED_SLUG,
  EXHAUSTED_SLUG,
  PROSPECTING_SLUG,
  SOILERY_SLUG,
  AUTO_MINE_NOTE,
  AUTO_REFINE_NOTE,
  CATATONIC_SLUG,
  OVERBURDENED_SLUG,
  FERTILIZED_FIELDS_SLUG,
  STEALTH_SLUG,
  CORPSE_GROUP_SLUG,
  BUTCHER_SLUG,
  WORKSHOP_EQUIPMENT_SLUG,
  SMITHING_SKILLED_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
  PACKAGE_MAX_LBS,
  PACKAGE_MAX_UNITS,
  PACKAGE_LABEL_MAX,
  WHISPER_MAX,
  SURGICAL_EQUIPMENT_SLUG,
  PORTABLE_SURGICAL_PACK_SLUG,
  TORTURING_EQUIPMENT_SLUG,
  TORTURER_SLUG,
  MUTILATE_GATE_SLUGS,
  KISS_BLOCKING_SLUGS,
  TRUMPET_SLUG,
  ARELITZ_SLUG,
  UNRULY_ARELITZ_SLUG,
  ARELITZ_HATCHLING_SLUG,
  ARELITZ_YOUNGLING_SLUG,
  ARELITZ_YEARLING_SLUG,
  ARELITZ_MASTERY_SLUG,
  ARELITZ_EGG_SLUG,
  STABLE_CAPACITY,
  HATCH_IN,
  BREAK_IN_TARGET,
  HUMAN_FLESH_SLUG,
  ENGRAVE_RESOURCE_COST,
  CORPSE_ROT_TURNS,
  TEACHING_SLUG,
  DRILL_INSTRUCTOR_SLUG,
  FIGHTING_GROUP_SLUG,
  TEACHING_CAPACITY,
  UNTAUGHT_LESSON_THRESHOLD,
  LESSON_THRESHOLD,
  DRILL_THRESHOLD,
  CHAPLAIN_SLUG,
  CONFESSION_THRESHOLD,
  SEDUCTIVE_DEMONESS_SLUG,
  DINED_SLUG,
  VOMITING_SLUG,
  LAZY_SLUG,
  GUILT_RIDDEN_SLUG,
  INSOMNIAC_SLUG,
  MOTION_SICKNESS_SLUG,
  DEBTOR_SLUG,
  WOUND_TAG_GROUPS,
  LUCKY_SLUG,
  MANIC_SLUG,
  METEMPSYCHOSIS_SLUG,
  HEIGHTENED_PSYCHOSIS_SLUG,
  AMOR_FATI_SLUG,
  IMPERTURBABLE_SLUG,
  CHANGA_HIGH_SLUG,
  SECOND_WIND_SLUG,
  BREWING_DISTILLING_SLUG,
  MUSICIAN_PYTHAGOREAN_SLUG,
  INSTRUMENT_SLUG,
  MUSICIAN_SLUG,
  TAG_CATEGORY,
};
