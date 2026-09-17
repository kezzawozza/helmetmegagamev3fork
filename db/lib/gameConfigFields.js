// The registry behind GameConfig: every knob a GM can edit, declared once.
//
// Three things used to have to agree by hand — the Prisma column, the form on
// /gm/dev, and the parser behind it — and they had drifted: noticeExpiryTurns
// had a column and no control, and four per-game columns had no wipe-reset.
// Now the form renders THIS list, the parser walks THIS list, and
// `npm run db:check-config` diffs it against the schema so a new column
// without an entry here fails the push instead of quietly becoming
// unreachable.
//
// `internal` names the columns that are real but not knobs: Discord pointers
// and the REST breaker, written by code and never by a form.

const GROUPS = [
  { key: "creation", name: "Character creation" },
  { key: "economy", name: "Economy" },
  { key: "carry", name: "Carrying" },
  { key: "mood", name: "Mood" },
  { key: "desires", name: "Desires" },
  { key: "clock", name: "Turn clock" },
  { key: "catatonic", name: "Catatonic" },
  { key: "features", name: "Features" },
  { key: "discord", name: "Discord" },
];

// type: "int" | "float" | "bool". min/max clamp an int or float on save.
const FIELDS = [
  // --- Character creation --------------------------------------------------
  {
    key: "startingTagPoints", type: "int", group: "creation", default: 12, min: 0, max: 100,
    label: "Starting Tag Points",
  },
  {
    key: "maxDrawbackTags", type: "int", group: "creation", default: 6, min: 0, max: 20,
    label: "Max drawback tags",
  },
  {
    key: "maxDrawbackPoints", type: "int", group: "creation", default: 13, min: 0, max: 60,
    label: "Max drawback points",
  },
  {
    key: "playerCount", type: "int", group: "creation", default: 80, min: 1, max: 1000,
    label: "Expected players (until Start)",
  },
  {
    key: "creationWindowHours", type: "int", group: "creation", default: 12, min: 1, max: 168,
    label: "Creation window (hours)",
  },
  {
    key: "playtestModeEnabled", type: "bool", group: "creation", default: false,
    label: "Playtest",
    info: "Only GMs, playtesters, and contributors can join",
  },

  // --- Economy ---------------------------------------------------------------
  {
    key: "productionCoefficient", type: "float", group: "economy", default: 0.93, min: 0, max: 5, step: 0.05,
    label: "Production coefficient",
  },
  {
    key: "lifewebDecayPerTurn", type: "int", group: "economy", default: 10, min: 0, max: 100,
    label: "Lifeweb decay / turn",
  },
  {
    key: "noticeExpiryTurns", type: "int", group: "economy", default: 10, min: 1, max: 100,
    label: "Notice lifespan (turns)",
  },
  {
    key: "farmMaxCrops", type: "int", group: "economy", default: 50, min: 1, max: 500,
    label: "Farm sow cap",
    info: "Most crops one Farm action may sow in a single plan",
  },

  // --- Carrying --------------------------------------------------------------
  {
    key: "carryWeightLbs", type: "int", group: "carry", default: 71, min: 1, max: 2000,
    label: "Carry cap: lb",
  },
  {
    key: "carryResourceCap", type: "int", group: "carry", default: 25, min: 1, max: 1000,
    label: "Carry cap: ⬢",
  },
  {
    key: "freeZoneMovesPerTurn", type: "int", group: "carry", default: 1, min: 0, max: 5,
    label: "Free zone moves",
  },
  {
    key: "locationMoveCooldownSeconds", type: "int", group: "carry", default: 3, min: 0, max: 3600,
    label: "Walk cooldown (seconds)",
  },

  // --- Mood ------------------------------------------------------------------
  {
    key: "moodIntensity", type: "float", group: "mood", default: 1, min: 0, max: 4, step: 0.1,
    label: "Mood intensity",
  },

  // --- Desires ---------------------------------------------------------------
  {
    key: "desireSlots", type: "int", group: "desires", default: 2, min: 1, max: 5,
    label: "Desire slots",
  },
  {
    key: "desireSlotLockTurns", type: "int", group: "desires", default: 1, min: 0, max: 20,
    label: "Desire slot lock",
  },

  // --- Turn clock ------------------------------------------------------------
  {
    key: "autoTurnAdvanceDisabled", type: "bool", group: "clock", default: false,
    label: "Pause automatic turn advance",
  },

  // --- Catatonic -------------------------------------------------------------
  {
    key: "catatonicTurns", type: "int", group: "catatonic", default: 4, min: 1, max: 60,
    label: "Catatonic after N idle turns",
  },
  {
    key: "catatonicDeathTurns", type: "int", group: "catatonic", default: 4, min: 0, max: 60,
    label: "Death after N Catatonic turns (0 = off)",
  },

  // --- Features --------------------------------------------------------------
  {
    key: "avatarUploadsEnabled", type: "bool", group: "features", default: true,
    label: "Player avatar uploads",
  },
  {
    key: "archiveTravelEvents", type: "bool", group: "features", default: false,
    label: "Archive travel events",
  },
  {
    key: "playPanelEnabled", type: "bool", group: "features", default: true,
    label: "Play page",
  },

  // --- Discord ---------------------------------------------------------------
  {
    key: "tupperAutocorrectEnabled", type: "bool", group: "discord", default: true,
    label: "Tupper autocorrect",
  },
  {
    key: "nicknameSyncEnabled", type: "bool", group: "discord", default: false,
    label: "Nickname sync",
  },
];

// Real columns that are not knobs. The check script exempts these; the form
// never shows them.
const INTERNAL_KEYS = [
  "id",
  "turnsConsoleChannelId",
  "turnsConsoleMessageId",
  "restInvalidCount",
  "restInvalidWindowStart",
  "restBreakerOpenUntil",
  // The Play page (CHAT.md §7): the two wipe watermarks, one per cadence.
  "feedWipeSeq",
  "feedWipeSummarySeq",
  // Not a knob on purpose. The wipe is how the game works, so there is no
  // form control for it; the column is a hand-flippable escape hatch for the
  // day Discord starts rate-limiting the sweep. See db/lib/messageWipe.js.
  "messageWipeEnabled",
  "radioCategoryId",
  "cerberonChannelId",
  "freq27065ChannelId",
  "freq243000ChannelId",
  // Deadchat (db/lib/deadchat.js). Provisioned, not configured — like the radio
  // ids above, it is here so the registry check does not read it as drift.
  "deadchatCategoryId",
  "deadchatChannelId",
  // Retired 2026-09-13: the per-slot rules in db/lib/equipSlots.js are the
  // whole equipment limit. The column stays, unread, so nothing drops a value.
  "equipSlots",
  // Retired as knobs 2026-09-09. All three are rules of the game now, not
  // preferences: the whitelist always gates a gated role, the portrait maker
  // is always open, and the fantasy parts are always off. The code hardcodes
  // each answer; the columns stay so nothing drops a value.
  "leaderWhitelistEnabled",
  "portraitMakerEnabled",
  "portraitFantasyPartsEnabled",
  // The Oracle (docs/systemdocs/ORACLE.md). Edited from its own section at
  // /gm/dev?s=oracle, never from the generic Configuration form: the registry
  // has no field type for a textarea, and rendering an API key as a text box
  // would put a live credential on screen. See web/app/(app)/gm/dev/oracleActions.js.
  "oracleEnabled",
  "oraclePlaytest",
  "oracleProvider",
  "oracleBaseUrl",
  "oracleModel",
  "oracleApiKey",
  "oracleApiKeySetAt",
  "oracleApiKeySetBy",
  "oracleMemoryTurns",
  "oracleIncludeChat",
  "oracleCorrespondentPrompt",
  "oracleEditorPrompt",
];

function fieldsInGroup(groupKey) {
  return FIELDS.filter((f) => f.group === groupKey);
}

// Turns one posted form value into the column's value, clamped. A missing or
// unparsable number falls back to the current value, never to the default —
// a GM who cleared a box did not ask for the launch setting back.
function parseField(field, raw, current) {
  if (field.type === "bool") return raw === "on" || raw === "true";
  const text = raw == null ? "" : String(raw).trim();
  if (text === "") return current ?? field.default;
  const n = field.type === "float" ? Number.parseFloat(text) : Number.parseInt(text, 10);
  if (Number.isNaN(n)) return current ?? field.default;
  const lo = field.min ?? -Infinity;
  const hi = field.max ?? Infinity;
  return Math.min(hi, Math.max(lo, n));
}

// Every field off a FormData, as the `data` for a gameConfig.update.
function parseConfigForm(formData, current = {}) {
  const data = {};
  for (const field of FIELDS) {
    data[field.key] = parseField(field, formData.get(field.key), current[field.key]);
  }
  return data;
}

module.exports = { GROUPS, FIELDS, INTERNAL_KEYS, fieldsInGroup, parseConfigForm };
