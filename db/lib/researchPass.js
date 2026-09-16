// The per-turn research pass, run from db/index.js#resolveNeeds() right
// after runLessonPass — same slot as Lessons, for the same reason: the die
// was decided at file time (Action.diceRoll/diceModifier, set by the
// Research desk), and this is where it gets read and turned into a result.
// docs/systemdocs/TURN-ENGINE.md §2 (2c).
//
// Every OPEN Action carrying an `auto:research:<slug>` gmNotes marker on the
// closing turn is resolved here: total = diceRoll + diceModifier against the
// ingredient's secret-recipe pool (db/lib/research.js). A 6+ against a
// non-empty, not-yet-revealed pool mints a letter (db/lib/paperMint.js) with
// one recipe's blurb; either way the Action is SOLVED with a result line, so
// the staged push (db/lib/stagedPush.js) closes it as adjudicated rather
// than silently, the same as a lesson.
//
// Returns Discord work as data for advanceTurn()'s runSideEffects(), never
// sends it. Returns an object even when idle: db/index.js treats null as a
// failed pass to retry.
const { mintLetterFor } = require("./paperMint");
// The same die line a learner reads, so a Research DM and a Lesson DM never
// disagree about how a modifier is shown.
const { rollLine } = require("./gambitModifier");
const { forcedNameFrom, concealmentFrom, presentedIdentity } = require("./presentedIdentity");
const {
  RESEARCH_MARKER_RE,
  TAG_TOKEN_RE,
  researchPaperText,
  secretRecipesFor,
  researchOutcome,
  familiarityBonus,
  loadResearchCatalog,
} = require("./research");

const RESEARCH_REVEALED_ACTION = "research_revealed";

function outcomeLine(outcome, ingredientName) {
  if (outcome === "paper") {
    return `Your hours of research into ${ingredientName} have borne fruit. You've uncovered a secret recipe from the archives.`;
  }
  if (outcome === "unlikely") {
    return `Your research has indicated that ${ingredientName} likely holds no secrets.`;
  }
  return `The archives have not yet shared any secrets for ${ingredientName}, but there remains something to be found. More research is required.`;
}

async function runResearchPass(prisma, turn) {
  const idle = { turnNumber: turn.number, resolved: 0, papers: 0, failed: 0, dms: [] };

  const actions = await prisma.action.findMany({
    where: {
      turnId: turn.id,
      moveReviewStatus: "OPEN",
      // Coarse DB pre-filter; RESEARCH_MARKER_RE below is what actually
      // extracts and validates the slug, the same "filter with the regex in
      // JS" split runLessonPass's siblings use for a Json-adjacent marker.
      gmNotes: { contains: "auto:research:" },
    },
    include: {
      character: {
        select: {
          id: true,
          name: true,
          discordUserId: true,
          concealed: true,
          updatedAt: true,
          // Both the ingredient/secret matching (db/lib/research.js) and
          // presentedIdentity's forced/concealed resolution read off this
          // one include, so the query only has to happen once per learner.
          tags: {
            select: {
              equipped: true,
              tag: {
                select: {
                  slug: true,
                  name: true,
                  forcedName: true,
                  concealsIdentity: true,
                  concealSprite: true,
                  forcesConceal: true,
                  equipLayer: true,
                  group: { select: { slug: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (actions.length === 0) return idle;

  const catalog = await loadResearchCatalog(prisma);

  const dms = [];
  let resolved = 0;
  let papers = 0;
  let failed = 0;

  for (const action of actions) {
    const match = RESEARCH_MARKER_RE.exec(action.gmNotes ?? "");
    if (!match) continue;
    const slug = match[1];
    const character = action.character;
    if (!character) continue;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const fresh = await tx.action.findUnique({
          where: { id: action.id },
          select: { moveReviewStatus: true },
        });
        // A GM already wrote a result on this Move. Theirs stands; the pass
        // grants nothing — the "a GM already wrote a result" guard
        // runLessonPass follows for the same reason.
        if (!fresh || fresh.moveReviewStatus !== "OPEN") return null;

        // The ingredient is not consumed, so it should still be on the
        // sheet — but a trade or a bin between filing and turn close is not
        // impossible. Falling back to a bare slug (no group) rather than
        // throwing: the die was already cast, and the pass still owes this
        // player a result even in that edge case.
        const held = (character.tags ?? []).find((row) => row.tag.slug === slug);
        const ingredientTag = held?.tag ?? { slug, name: slug, group: null };

        const revealedRows = await tx.auditLog.findMany({
          where: { actionType: RESEARCH_REVEALED_ACTION, targetCharacterId: character.id },
          select: { details: true, createdAt: true },
        });
        // Every earlier filing on this ingredient is a point of familiarity
        // (db/lib/research.js#familiarityBonus); shown on the die line the
        // way a Lesson shows a Minted Charm, "**4** (+2) → **6**".
        const filedRows = await tx.auditLog.findMany({
          where: { actionType: "research_filed", targetCharacterId: character.id },
          select: { details: true, turnId: true, createdAt: true },
        });
        const bonus = familiarityBonus({
          filed: filedRows,
          revealed: revealedRows,
          ingredientSlug: slug,
          currentTurnId: turn.id,
        });
        const revealedSlugs = new Set(
          revealedRows.map((r) => r.details?.recipeSlug).filter(Boolean),
        );
        const secrets = secretRecipesFor(ingredientTag, catalog).filter(
          (r) => !revealedSlugs.has(r.slug),
        );

        const { text: rollText, total } = rollLine(turn, action, bonus);
        const decision = researchOutcome({ total, secrets });
        const line = outcomeLine(decision, ingredientTag.name);

        let paperRecipe = null;
        if (decision === "paper") {
          paperRecipe = secrets[Math.floor(Math.random() * secrets.length)];
          // Names for any {tag:slug} in the description, so the note reads
          // as words on both the web and a bird-carried Discord copy.
          const tokenSlugs = [...(paperRecipe.description ?? "").matchAll(TAG_TOKEN_RE)].map((m) => m[1]);
          const named = tokenSlugs.length
            ? await tx.tag.findMany({ where: { slug: { in: tokenSlugs } }, select: { slug: true, name: true } })
            : [];
          const nameOf = (slug) => named.find((t) => t.slug === slug)?.name ?? null;
          const noteText = researchPaperText(paperRecipe, nameOf);

          const forcedName = forcedNameFrom(character.tags);
          const concealment = concealmentFrom(character.tags);
          const presentedName = presentedIdentity(character, { forcedName, concealment }).name;

          await mintLetterFor(tx, character.id, presentedName, noteText);
          // The ledger: skip recipes this character already researched.
          // Per-character, recipe slug in details — the same AuditLog-as-
          // ledger idiom as db/lib/mood.js's Cathedral arrival ration.
          await tx.auditLog.create({
            data: {
              actorDiscordUserId: "system",
              actionType: RESEARCH_REVEALED_ACTION,
              targetCharacterId: character.id,
              turnId: turn.id,
              details: { recipeSlug: paperRecipe.slug, ingredientSlug: slug, turnNumber: turn.number },
            },
          });
        }

        const resultMessage = `${total} → ${line}`;
        await tx.action.update({
          where: { id: action.id },
          data: { moveReviewStatus: "SOLVED", resultMessage, reviewedAt: new Date() },
        });

        return { rollText, line, paper: decision === "paper" };
      });
      if (!outcome) continue;
      resolved += 1;
      if (outcome.paper) papers += 1;
      if (character.discordUserId) {
        dms.push({
          discordUserId: character.discordUserId,
          content: `${outcome.rollText} ${outcome.line}`,
        });
      }
    } catch (err) {
      failed += 1;
      console.error(`Research Move ${action.id} failed to resolve:`, err);
    }
  }

  return { turnNumber: turn.number, resolved, papers, failed, dms };
}

module.exports = { runResearchPass };
