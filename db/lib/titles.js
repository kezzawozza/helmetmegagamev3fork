// Which title a character has earned, and which form of it they wear. Every
// word is granted by a tag or a role; `Character.gender` picks the form of a
// gendered title. An entry is one TITLE, not one word — `words` is a plain
// string or a map keyed by gender. Hardcoded rather than a YAML master, for
// the reason db/lib/roleIds.js gives: single guild, one correct value. Pure —
// no prisma, no I/O — so a client component can import it through
// web/lib/characterName.js without dragging PrismaClient in.

// Matches the Gender enum in db/prisma/schema.prisma exactly.
const GENDERS = Object.freeze(["MAN", "WOMAN", "NEUTRAL"]);

const TITLES = Object.freeze([
  // Martial. The Tribunal's two ranks sit on the seat rather than a tag, so a
  // spawned Tribune wears one from the moment the shuttle lands; Ordinator
  // also rides the insignia, which means whoever loots it off the body may
  // style themselves with it.
  { words: "Sergeant", tags: ["sergeant"], roles: ["tribune"] },
  { words: "Corporal", roles: ["tribune"] },
  { words: "Ordinator", tags: ["ordinator-insignia"], roles: ["tribunal-ordinator"] },
  { words: "Constable", tags: ["cerberon"] },
  { words: "Censor", roles: ["censor"] },

  // Noble. Baron/baroness also grant `nobility`, so its holder is offered
  // Lord/Lady/Noble too — deliberate, a Baron may prefer to be styled Lord.
  { words: { MAN: "Sir", WOMAN: "Dame", NEUTRAL: "Ser" }, tags: ["knighted"] },
  { words: { MAN: "Lord", WOMAN: "Lady", NEUTRAL: "Noble" }, tags: ["nobility"] },
  { words: { MAN: "Baron", WOMAN: "Baroness", NEUTRAL: "Baron" }, roles: ["baron", "baroness"] },

  // Clerical. `bishop` role grants `chaplain` tag, so Bishops get this too.
  { words: { MAN: "Father", WOMAN: "Mother", NEUTRAL: "Reverend" }, tags: ["chaplain"] },
  // Monastic: Mortii by tag, Incarn (warrior monk) by role, same title.
  { words: { MAN: "Brother", WOMAN: "Sister", NEUTRAL: "Sibling" }, tags: ["mortus"], roles: ["incarn"] },
  { words: "Bishop", roles: ["bishop"] },

  // Doctor is the middle rung of the medical chain, a practising physician's
  // title, not a mastery award — the Serpent carries it by role regardless.
  { words: "Doctor", tags: ["medical-skilled"], roles: ["esculap", "serpent"] },
  { words: "Professor", roles: ["scholastic"] },

  // Master is the craft-master's word, ungendered.
  { words: "Master", roles: ["metalsmith", "innkeeper", "headman"] },
]);

// An unknown gender falls back to the neutral form rather than throwing.
function wordFor(entry, gender) {
  if (typeof entry.words === "string") return entry.words;
  return entry.words[gender] ?? entry.words.NEUTRAL;
}

// Every word any character could wear, in table order. The GM dev panel
// offers this whole list ungated: a GM setting a title should never be
// second-guessed.
const TITLE_WORDS = Object.freeze(
  TITLES.flatMap((t) => (typeof t.words === "string" ? [t.words] : GENDERS.map((g) => t.words[g]))).filter(
    (word, i, all) => all.indexOf(word) === i,
  ),
);

// The words this character may wear. One word per earned title, never the
// gendered variants together — those aren't a player choice. Order follows
// the table (ladder order, not alphabetical).
function earnedTitles({ tagSlugs = [], roleSlug = null, gender = "NEUTRAL" } = {}) {
  const held = new Set(tagSlugs);
  return TITLES.filter(
    (t) =>
      (t.tags ?? []).some((slug) => held.has(slug)) ||
      (roleSlug != null && (t.roles ?? []).includes(roleSlug)),
  ).map((t) => wordFor(t, gender));
}

// Fails the sync if a title references an unknown tag/role or a gendered
// entry is missing a form. Called from syncRoles, which runs after syncTags
// (SYNC.md); a bad slug here is otherwise silent until a player asks why they
// can't be styled Doctor.
async function assertTitlesResolve(prisma) {
  const [tags, roles] = await Promise.all([
    prisma.tag.findMany({ select: { slug: true } }),
    prisma.role.findMany({ select: { slug: true } }),
  ]);
  const tagSlugs = new Set(tags.map((t) => t.slug).filter(Boolean));
  const roleSlugs = new Set(roles.map((r) => r.slug).filter(Boolean));

  const problems = [];
  const seen = new Set();
  for (const entry of TITLES) {
    const label = typeof entry.words === "string" ? entry.words : (entry.words.MAN ?? "?");

    if (typeof entry.words === "string") {
      if (seen.has(entry.words)) problems.push(`"${entry.words}" is listed twice`);
      seen.add(entry.words);
    } else {
      for (const gender of GENDERS) {
        const word = entry.words[gender];
        if (!word) {
          problems.push(`"${label}" has no ${gender} form`);
          continue;
        }
        // A shared word across two forms of the SAME entry is fine (Baron).
        if (seen.has(word) && !GENDERS.some((g) => g !== gender && entry.words[g] === word)) {
          problems.push(`"${word}" is listed twice`);
        }
        seen.add(word);
      }
    }

    if (!(entry.tags ?? []).length && !(entry.roles ?? []).length) {
      problems.push(`"${label}" is earned from nothing — give it a tag or a role`);
    }
    for (const slug of entry.tags ?? []) {
      if (!tagSlugs.has(slug)) problems.push(`"${label}" references unknown tag "${slug}"`);
    }
    for (const slug of entry.roles ?? []) {
      if (!roleSlugs.has(slug)) problems.push(`"${label}" references unknown role "${slug}"`);
    }
  }

  if (problems.length) {
    throw new Error(`db/lib/titles.js: ${problems.join("; ")}`);
  }
}

module.exports = {
  TITLES,
  TITLE_WORDS,
  GENDERS,
  earnedTitles,
  assertTitlesResolve,
};
