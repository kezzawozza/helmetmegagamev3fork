// The objective catalog: every kind of win condition a GM can hand an
// antagonist party (docs/systemdocs/THREATS.md §6a). Pure and dependency-free
// — the /gm/dev Objectives panel is a client component fed from this, so
// nothing here may require anything with node deps.
//
// A kind is:
//   pick        the GM's dropdown text — the spec's bracketed form.
//   label       template rendered through, {target}/{location}/{value}/{text}
//               filled from the row's snapshots.
//   parties     which parties may take it (db/lib/threats.js party keys);
//               null means any, which only `custom` is.
//   weight      "MINOR" | "MAJOR" | null. Display only.
//   target      what the Add row's second control asks for. "leader" is a
//               character whose Role has requiresWhitelist;
//               "inquisitor-or-baron" is a slug in
//               INQUISITOR_OR_BARON_ROLE_SLUGS (the Baroness is not one).
//   script      null = the GM says whether it happened; else a checker name
//               in db/lib/objectives.js, unless the GM pins an answer.
//   startsDone  manual kinds only, the pin a fresh row starts with.
//   placeholder true = the thing it asks for doesn't exist yet, hand-scored
//               until it does.

const OBJECTIVE_KINDS = [
  {
    key: "kill-character",
    pick: "Kill [Character]",
    label: "Kill {target}",
    parties: ["thanati"],
    weight: "MINOR",
    target: "character",
    script: "characterDead",
  },
  {
    key: "convert-character",
    pick: "Perform conversion rite for [Character]",
    label: "Perform the conversion rite for {target}",
    parties: ["thanati"],
    weight: "MINOR",
    target: "character",
    script: null,
    placeholder: true,
  },
  {
    key: "convert-leader",
    pick: "Perform conversion rite for [Leader Character]",
    label: "Perform the conversion rite for {target}",
    parties: ["thanati"],
    weight: "MAJOR",
    target: "leader",
    script: null,
    placeholder: true,
  },
  {
    key: "deface-icon",
    pick: "Deface [Holy Icon]",
    label: "Deface {text}",
    parties: ["thanati"],
    weight: "MINOR",
    target: "text",
    script: null,
  },
  {
    key: "sacrifice-corpse",
    pick: "Perform a sacrifice rite with [Character's] corpse",
    label: "Perform a sacrifice rite with {target}'s corpse",
    parties: ["thanati"],
    weight: "MINOR",
    target: "character",
    script: null,
    placeholder: true,
  },
  {
    key: "sacrifice-living",
    pick: "Perform a sacrifice rite with living [Character]",
    label: "Perform a sacrifice rite with living {target}",
    parties: ["thanati"],
    weight: "MINOR",
    target: "character",
    script: null,
    placeholder: true,
  },
  {
    key: "sacrifice-leader",
    pick: "Perform a sacrifice rite with living [Leader Character]",
    label: "Perform a sacrifice rite with living {target}",
    parties: ["thanati"],
    weight: "MAJOR",
    target: "leader",
    script: null,
    placeholder: true,
  },
  {
    key: "sacrifice-inquisitor-or-baron",
    pick: "Perform a sacrifice rite with living [Inquisitor or Baron]",
    label: "Perform a sacrifice rite with living {target}",
    parties: ["thanati"],
    weight: "MAJOR",
    target: "inquisitor-or-baron",
    script: null,
    placeholder: true,
  },
  {
    key: "blow-up-location",
    pick: "Blow up [Location]",
    label: "Blow up {location}",
    parties: ["thanati"],
    weight: "MAJOR",
    target: "location",
    script: null,
  },
  {
    key: "mass-deaths",
    pick: "Cause [x number of] deaths in a single day",
    label: "Cause {value} deaths in a single day",
    parties: ["thanati"],
    weight: "MAJOR",
    target: "number",
    defaultValue: 5,
    script: "deathsInOneDay",
  },
  {
    key: "detonate-nuke",
    pick: "Detonate the nuclear device",
    label: "Detonate the nuclear device",
    parties: ["tribunal"],
    weight: null,
    target: null,
    script: "nukeDetonated",
  },
  {
    key: "celebrate",
    pick: "Celebrate Ravenheart’s hard work",
    label: "Celebrate Ravenheart’s hard work",
    parties: ["tribunal"],
    weight: null,
    target: null,
    script: null,
    startsDone: true,
  },
  {
    key: "custom",
    pick: "Custom",
    label: "{text}",
    parties: null,
    weight: null,
    target: "text",
    script: null,
  },
];

const KINDS_BY_KEY = new Map(OBJECTIVE_KINDS.map((k) => [k.key, k]));

// The set a party gets from the "Add the standard set" button.
const PARTY_DEFAULTS = { tribunal: ["detonate-nuke", "celebrate"] };

// "Inquisitor or Baron" in the spec — the Baroness is ruled out.
const INQUISITOR_OR_BARON_ROLE_SLUGS = new Set(["inquisitor", "baron"]);

const OBJECTIVE_WEIGHTS = ["MINOR", "MAJOR"];

function objectiveKind(key) {
  return KINDS_BY_KEY.get(key) ?? null;
}

// Catalog order, `custom` last.
function kindsForParty(partyKey) {
  return OBJECTIVE_KINDS.filter((k) => k.parties == null || k.parties.includes(partyKey));
}

// A target that has since lost its name reads as "somebody"/"somewhere".
function describeObjective(row) {
  const kind = objectiveKind(row.kind);
  const template = kind?.label ?? "{text}";
  return template
    .replace("{target}", row.targetName ?? "somebody")
    .replace("{location}", row.targetLocationName ?? "somewhere")
    .replace("{value}", row.value != null ? String(row.value) : "?")
    .replace("{text}", (row.text ?? "").trim() || "…");
}

module.exports = {
  OBJECTIVE_KINDS,
  OBJECTIVE_WEIGHTS,
  PARTY_DEFAULTS,
  INQUISITOR_OR_BARON_ROLE_SLUGS,
  objectiveKind,
  kindsForParty,
  describeObjective,
};
