// The threat catalog: every antagonist seat, in one place. A threat is three
// things: optIn (a lobby/wizard checkbox — consent data, `true` or
// `{name, whitelist}`; `name` is the PUBLIC name when it differs, e.g.
// "Succubus" for the Demoness, "Cultist" for a Thanati, so the word never
// appears; `whitelist: true` locks it to the Whitelist Discord role), assign
// (a real seat a GM hands to an existing character, granting the tags/points
// here and DMing the Role charter), and spawn (the same seat as a whole new
// character, offered over DM). HALF THE OPT-INS ARE DECOYS — `optIn` alone,
// so ticking one tells a GM about consent without naming the real seats; the
// hand-run briefs (Brigands, Monsters, the Sympathizer) live in SECRETS.md,
// not here. INCOMPATIBLE TAGS are `conflictsWith` edges on the seat tag in
// docs/tags.yaml, not listed here. Kept in code, not a table, for the reason
// db/lib/roleIds.js gives: fixed values that can never differ per environment.
// Alphabetized by `name` so catalog order *is* display order, which also hides
// the real seats among the decoys. No prose here except `brief` below — a
// seated player reads the Role's own charter. A PARTY is the group a seat
// scores objectives with; seats with no `party` are SOLO in the reveal.
const THANATI_PARTY = { key: "thanati", name: "Thanati" };
const TRIBUNAL_PARTY = { key: "tribunal", name: "Tribunal" };

// THE ONE EXCEPTION TO "NO PROSE IN THE CATALOG": the Thanati have no Role of
// their own (spawn.roleSlug is null, the GM picks a cover role), so nowhere
// else for this to live. A seat WITH a role of its own never gets one of these: write it on the role.
const THANATI_BRIEF = [
  "You are a Thanati. Crudux Cruo! This reality is flawed to its core. Lord Tzchernobog will deliver a new, perfect reality once this one has come to an end, when the last human observer has passed into nothingness.",
  "Read the Thanati document for more information.",
  "Secrecy is your greatest strength. Ever since the arrival of the Inquisitor, the cult's position has been tenuous. The capture of one of you will result in your exposure. Death is preferable to what the sadistic inquisition will do to you.",
  "You are running out of time. Be quick!",
];
const THANATI_LEADER_BRIEF = [
  "You are the Thanati cult leader. Crudux Cruo! This reality is flawed to its core! Lord Tzchernobog will deliver a new, perfect reality once this one has come to an end, when the last human observer has passed into nothingness.",
  "Read the Thanati document for more information.",
  "Secrecy is your greatest strength. Ever since the arrival of the Inquisitor, the cult's position has been tenuous. The capture of one of you will result in your exposure. Death is preferable to what the sadistic inquisition will do to you.",
  "You are running out of time. Be quick, and organize your followers!",
];

const THREATS = [
  {
    slug: "archon",
    name: "Archon",
    optIn: true,
  },
  {
    slug: "bastard",
    name: "Bastard",
    optIn: { whitelist: true },
  },
  {
    slug: "demoness",
    name: "Demoness",
    optIn: { name: "Succubus", whitelist: true },
    assignable: true,
    seatTagSlug: "demoness", // derived from the tag, not stored, so a hand grant still shows up.
    zone: "Fortress",
    assign: { tagPoints: 7, tagSlugs: ["demoness", "hungerless", "beautiful", "rough-camper"] },
    spawn: {
      gender: "WOMAN",
      roleSlug: null, // no default role; the GM picks one when offering.
      resources: 3,
      tagPoints: 7,
      tagSlugs: ["dagger", "obol x4"], // "x4" is a stack count (parseStartingTag), not four entries.
    },
  },
  {
    slug: "judge",
    name: "Judge",
    optIn: true,
    assignable: true,
    seatTagSlug: "judge",
    zone: "Town, or Cave",
    assign: { tagPoints: 17, tagSlugs: ["cruel", "judge", "rough-camper", "outsider", "brave"] },
    spawn: {
      gender: "ROLL",
      roleSlug: null,
      resources: 3,
      tagPoints: 17,
      tagSlugs: ["neoclassic-duelista", "light-infantry-armour", "obol x4"],
    },
  },
  {
    slug: "obsessed",
    name: "Obsessed",
    optIn: true,
  },
  {
    slug: "schemer",
    name: "Schemer",
    optIn: true,
  },
  {
    slug: "skinless",
    name: "Skinless",
    optIn: true,
  },
  // THE THANATI: two real seats behind two public names so the word Thanati is never on a checkbox.
  {
    slug: "thanati",
    name: "Thanati",
    optIn: { name: "Cultist" },
    assignable: true,
    seatTagSlug: "thanati",
    zone: "Anywhere",
    party: THANATI_PARTY,
    brief: THANATI_BRIEF,
    assign: { tagPoints: 4, tagSlugs: ["thanati", "underquarter-basements", "literate"] },
    spawn: {
      gender: "ROLL",
      roleSlug: null,
      resources: 3,
      tagPoints: 4,
      tagSlugs: ["underquarter-basements", "literate", "obol x4"],
    },
  },
  {
    slug: "thanati-leader",
    name: "Thanati Leader",
    optIn: { name: "Cultist Leader", whitelist: true },
    assignable: true,
    seatTagSlug: "thanati-leader",
    zone: "Anywhere",
    party: THANATI_PARTY,
    brief: THANATI_LEADER_BRIEF,
    assign: { tagPoints: 7, tagSlugs: ["thanati", "thanati-leader", "underquarter-basements", "literate"] },
    spawn: {
      gender: "ROLL",
      roleSlug: null,
      resources: 3,
      tagPoints: 7,
      tagSlugs: ["thanati-mask", "underquarter-basements", "literate", "obol x4"],
    },
  },
  // THE TRIBUNAL. Both carry `spawn.locationSlug`, which nothing else does — the seat knows where its own shuttle puts down.
  {
    slug: "tribunal-ordinator",
    name: "Tribunal Ordinator",
    optIn: { whitelist: true },
    assignable: true,
    seatTagSlug: "ordinator-insignia",
    zone: "Black Hills",
    party: TRIBUNAL_PARTY,
    assign: {
      tagPoints: 10,
      // Mirrors tribunal-ordinator's starting_tags (docs/roles.yaml); Assign/Spawn are separate lists, keep both in sync.
      tagSlugs: [
        "ordinator-insignia",
        "cataphract-armor",
        "tribunal-ordinator-helmet",
        "nuclear-datacard",
        "elevator-key",
        "fragmentation-grenade",
        "motorcycle",
        "supply-kit",
        "radio-243000",
      ],
    },
    spawn: {
      gender: "ROLL",
      honorific: "Ordinator",
      roleSlug: "tribunal-ordinator",
      locationSlug: "hills-waterway",
      resources: 8,
      tagPoints: 10,
    },
  },
  {
    slug: "tribune",
    name: "Tribune",
    optIn: true,
    assignable: true,
    seatTagSlug: "tribunal-helmet",
    zone: "Black Hills",
    party: TRIBUNAL_PARTY,
    assign: {
      tagPoints: 10,
      // Mirrors tribune's starting_tags — see the Ordinator's note above.
      tagSlugs: [
        "tribunal-helmet",
        "heavy-infantry-armor",
        "c4",
        "fragmentation-grenade",
        "motorcycle",
        "supply-kit",
        "radio-243000",
      ],
    },
    spawn: {
      gender: "ROLL",
      honorific: ["Sergeant", "Corporal"],
      roleSlug: "tribune",
      locationSlug: "hills-waterway",
      resources: 8,
      tagPoints: 10,
    },
  },
  // Retired (docs/archive/windlander.yaml); the box stays as a decoy.
  {
    slug: "windlander",
    name: "Windlander",
    optIn: true,
  },
];

// Seats that arrive by shuttle (db/lib/threatSpawn.js). A set, not a flag, so a future seat joins with one line.
const SHUTTLE_ARRIVAL_SLUGS = new Set(["tribunal-ordinator", "tribune"]);

const THREATS_BY_SLUG = new Map(THREATS.map((t) => [t.slug, t]));

function optInName(threat) {
  return (typeof threat.optIn === "object" && threat.optIn?.name) || threat.name;
}

function optInWhitelisted(threat) {
  return typeof threat.optIn === "object" && threat.optIn?.whitelist === true;
}

// PUBLIC-name order, so the lobby/wizard read as alphabetical whatever the seat is called.
const OPT_IN_THREATS = THREATS.filter((t) => t.optIn).sort((a, b) =>
  optInName(a).localeCompare(optInName(b)),
);
const ANTAGONISTS = OPT_IN_THREATS;
const ANTAGONIST_SLUGS = new Set(OPT_IN_THREATS.map((t) => t.slug));

// Assignable and spawnable are the same set.
const ASSIGNABLE_THREATS = THREATS.filter((t) => t.assignable);

const SEAT_TAG_SLUGS = ASSIGNABLE_THREATS.map((t) => t.seatTagSlug).filter(Boolean);

function threatBySlug(slug) {
  return THREATS_BY_SLUG.get(slug) ?? null;
}

function threatBySeatTag(tagSlug) {
  return ASSIGNABLE_THREATS.find((t) => t.seatTagSlug === tagSlug) ?? null;
}

// `solo` is what the reveal reads to choose "was a" over "were the".
function partyOf(threat) {
  if (!threat) return null;
  if (threat.party) return { key: threat.party.key, name: threat.party.name, solo: false };
  return { key: threat.slug, name: threat.name, solo: true };
}

// Every party, deduped, in catalog order (Objectives cards + reveal).
const PARTIES = (() => {
  const seen = new Map();
  for (const t of ASSIGNABLE_THREATS) {
    const p = partyOf(t);
    if (!seen.has(p.key)) seen.set(p.key, p);
  }
  return [...seen.values()];
})();

function partyByKey(key) {
  return PARTIES.find((p) => p.key === key) ?? null;
}

// Whatever the form posted, reduced to known opt-in slugs. A slug that has
// since left the catalog is dropped here, so renaming one needs no data migration.
function normalizeAntagonistSlugs(input, { whitelisted = true } = {}) {
  const posted = new Set(
    (Array.isArray(input) ? input : [input])
      .filter((v) => v != null)
      .map((v) => v.toString().trim()),
  );
  return OPT_IN_THREATS.filter((t) => posted.has(t.slug))
    .filter((t) => whitelisted || !optInWhitelisted(t))
    .map((t) => t.slug);
}

// Slugs -> PUBLIC names. Unknown slugs are dropped rather than rendered raw, so a stale value can never leak into the UI.
function antagonistNames(slugs) {
  const held = new Set(slugs ?? []);
  return OPT_IN_THREATS.filter((t) => held.has(t.slug)).map(optInName);
}

// Slugs a player without the Whitelist role may not tick; server drops them too.
const WHITELISTED_OPT_IN_SLUGS = new Set(OPT_IN_THREATS.filter(optInWhitelisted).map((t) => t.slug));

// A spawned character has nobody to type a name, so one is rolled.
const SPAWN_NAMES = {
  WOMAN: [
    "Maeris", "Ilvane", "Corrin", "Sabeth", "Vessa", "Orlaith",
    "Thessaly", "Maren", "Yveline", "Perrin", "Cassia", "Domna",
    "Roswitha", "Ferren", "Alisaunde", "Nyssa", "Odila", "Verity",
    "Halcyone", "Ismene", "Brenna", "Solveig", "Cerise", "Aldith",
  ],
  MAN: [
    "Jorren", "Aldric", "Vaskin", "Corben", "Merric", "Thaddeus",
    "Ossian", "Ruvain", "Gaspar", "Edren", "Lucan", "Ambrose",
    "Halvard", "Ceril", "Rodrigan", "Ysbrand", "Emeric", "Tobias",
    "Warrin", "Anselm", "Dorian", "Fenric", "Marcus", "Oswin",
  ],
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomSpawnName(gender) {
  return pick(SPAWN_NAMES[gender] ?? SPAWN_NAMES[pick(["MAN", "WOMAN"])]);
}

// Everything a spawned character is called. `gender: "ROLL"` is a seat that
// does not care which — every antagonist but the Demoness — and it is resolved
// HERE, never written: Character.gender is an enum of MAN/WOMAN/NEUTRAL and
// Prisma rejects the sentinel. `honorific` is the seat's rank, a string or a
// list to roll from; a seat without one arrives untitled, as they all used to.
function rollSpawnIdentity(spawn) {
  const gender = spawn.gender === "ROLL" ? pick(["MAN", "WOMAN"]) : (spawn.gender ?? "NEUTRAL");
  const rank = spawn.honorific ?? null;
  return {
    gender,
    firstName: randomSpawnName(gender),
    honorific: Array.isArray(rank) ? pick(rank) : rank,
  };
}

// The web builds the buttons, the bot routes clicks — REST/gateway twin convention (ARCHITECTURE.md).
const THREAT_SPAWN_ACCEPT_PREFIX = "threat-spawn-accept:";
const THREAT_SPAWN_DECLINE_PREFIX = "threat-spawn-decline:";

module.exports = {
  SHUTTLE_ARRIVAL_SLUGS,
  THREATS,
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  SPAWN_NAMES,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  threatBySlug,
  threatBySeatTag,
  PARTIES,
  partyOf,
  partyByKey,
  optInName,
  optInWhitelisted,
  WHITELISTED_OPT_IN_SLUGS,
  randomSpawnName,
  rollSpawnIdentity,
  ANTAGONISTS, // kept under the old name — the column is still Character.antagonistOptIns.
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
};
