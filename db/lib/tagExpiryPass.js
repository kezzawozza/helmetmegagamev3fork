// Per-turn tag progression (untreated-wound chain: Tag.expiresInto turns a tag into another, e.g. Infected → Festering). MUST run immediately BEFORE the non-stackable expiry sweep — that sweep is a blind deleteMany, so it deletes the rows this pass just read. Only ever grants (or renews, for a self-referencing entry — see the `renewals` array below); db/lib/dyingDeathPass.js kills, and a chain landing on `dead` grants Dying stamped for this turn so the dying pass ends it in the same close.

const { expiryFrom } = require("./turnFormat");
const { applyWoundMood } = require("./mood");
const { DYING_SLUG } = require("./constants");
const { DEAD_TOKEN } = require("./tagShapes");

// Stackable tags are out of scope — a stack SHEDS (sweepExpiredStacks in db/index.js), it doesn't expire. increased-recovery (M3, TAGS.md §5c) on Infection/Wounds pushes a row's clock one turn, but never the step that would actually GRANT Dying.
// `dead` counts here as much as `dying` does — Mercy must not be able to stall a wound that kills at its close.
function chainReachesDying(expiresInto) {
  return (expiresInto ?? []).some((entry) =>
    (entry?.oneOf ?? []).some((slug) => slug === DYING_SLUG || slug === DEAD_TOKEN),
  );
}
const STALLABLE_GROUP_SLUGS = new Set(["health-infection", "health-wounds"]);

// Not every chain is a wound getting worse. Exhausted decays INTO Tired,
// Migraine into No Migraine, Stitched and Cauterized into Scarred — the tag
// on the right is the lighter one, and a DM headed "Something has taken a
// turn for the worse" over "Exhausted → Tired" told a player the opposite of
// what happened. A progression whose every successor is one of these is
// announced as recovery instead. Keyed on the successor, like the rest of
// this file's rules, rather than on a catalog flag the schema does not have.
const RELIEF_SUCCESSOR_SLUGS = new Set(["tired", "no-migraine", "scarred"]);
const WORSE_HEADER = "Something has taken a turn for the worse.";
const BETTER_HEADER = "Your condition has improved.";

async function runTagExpiryPass(prisma, turn) {
  const expiring = await prisma.characterTag.findMany({
    where: {
      expiresTurn: { lte: turn.number },
      tag: { stackable: false, NOT: { expiresInto: { equals: null } } },
    },
    select: {
      id: true,
      characterId: true,
      character: { select: { status: true, discordUserId: true } },
      tag: {
        select: { slug: true, name: true, expiresInto: true, group: { select: { slug: true } } },
      },
    },
  });
  if (expiring.length === 0) return { turnNumber: turn.number, progressed: 0, fatal: 0, dms: [] };

  const candidateCharacterIds = [...new Set(expiring.map((ct) => ct.characterId))];
  const recoveryHolders = await prisma.characterTag.findMany({
    where: { characterId: { in: candidateCharacterIds }, tag: { slug: "increased-recovery" } },
    select: { characterId: true },
  });
  const recoverySet = new Set(recoveryHolders.map((r) => r.characterId));

  const successorSlugs = new Set();
  for (const ct of expiring) {
    for (const entry of ct.tag.expiresInto ?? []) {
      for (const slug of entry?.oneOf ?? []) {
        successorSlugs.add(slug === DEAD_TOKEN ? DYING_SLUG : slug);
      }
    }
  }
  const successors = await prisma.tag.findMany({
    where: { slug: { in: [...successorSlugs] } },
    select: { id: true, slug: true, name: true, defaultDurationTurns: true },
  });
  const successorBySlug = new Map(successors.map((t) => [t.slug, t]));

  const rows = [];
  // characterId -> { discordUserId, worse: ["Infected → Festering", ...],
  // better: ["Exhausted → Tired", ...] } — two lists, because the one DM
  // each character gets heads them differently.
  const progressions = new Map();
  const missing = new Set();
  const stalledIds = [];
  // { characterId, tagId } for the Dying rows a `dead` chain owes — they must overwrite an existing clock rather than defer to it.
  const fatalRows = [];
  // { id, expiresTurn } — a tag naming ITSELF as a successor (TAGS.md §5c). The row already
  // exists (it's the one expiring), so it can't go through `rows[]`/createMany: that would
  // collide with CharacterTag's own (characterId, tagId) uniqueness and get silently skipped
  // by skipDuplicates, and the sweep would then delete the untouched original. Pushing its
  // OWN clock forward instead means the sweep — which queries fresh, after this pass runs —
  // never matches it, so the tag survives alongside whatever else that entry list granted.
  const renewals = [];

  for (const ct of expiring) {
    if (ct.character?.status !== "ALIVE") continue;

    // increased-recovery postpones this row's clock instead of progressing it, checked BEFORE the grant. Exempted when the chain could hand over Dying, so Mercy slows the march but never cancels the arrival.
    if (
      recoverySet.has(ct.characterId) &&
      STALLABLE_GROUP_SLUGS.has(ct.tag.group?.slug) &&
      !chainReachesDying(ct.tag.expiresInto)
    ) {
      stalledIds.push(ct.id);
      continue;
    }

    const gained = [];
    for (const entry of ct.tag.expiresInto ?? []) {
      const choices = entry?.oneOf ?? [];
      if (choices.length === 0) continue;
      const slug = choices[Math.floor(Math.random() * choices.length)];
      if (slug === DEAD_TOKEN) {
        const dying = successorBySlug.get(DYING_SLUG);
        if (!dying) {
          missing.add(DYING_SLUG);
          continue;
        }
        fatalRows.push({ characterId: ct.characterId, tagId: dying.id });
        continue;
      }
      const successor = successorBySlug.get(slug);
      if (!successor) {
        missing.add(slug);
        continue;
      }
      if (slug === ct.tag.slug) {
        renewals.push({ id: ct.id, expiresTurn: expiryFrom(turn.number + 1, successor.defaultDurationTurns) });
        gained.push(successor);
        continue;
      }
      rows.push({
        characterId: ct.characterId,
        tagId: successor.id,
        source: "EVENT",
        expiresTurn: expiryFrom(turn.number + 1, successor.defaultDurationTurns),
      });
      gained.push(successor);
    }

    if (gained.length === 0) continue;
    if (!progressions.has(ct.characterId)) {
      progressions.set(ct.characterId, { discordUserId: ct.character.discordUserId, worse: [], better: [] });
    }
    const relief = gained.every((t) => RELIEF_SUCCESSOR_SLUGS.has(t.slug));
    progressions.get(ct.characterId)[relief ? "better" : "worse"].push(
      `${ct.tag.name} → ${gained.map((t) => t.name).join(" and ")}`,
    );
  }

  for (const slug of missing) {
    console.error(`Tag expiry pass: no "${slug}" tag — run npm run db:sync-tags.`);
  }

  if (stalledIds.length) {
    await prisma.characterTag.updateMany({
      where: { id: { in: stalledIds } },
      data: { expiresTurn: turn.number + 1 },
    });
  }

  for (const { id, expiresTurn } of renewals) {
    await prisma.characterTag.update({ where: { id }, data: { expiresTurn } });
  }

  for (const { characterId, tagId } of fatalRows) {
    const { count } = await prisma.characterTag.updateMany({
      where: { characterId, tagId },
      data: { expiresTurn: turn.number },
    });
    if (count === 0) {
      await prisma.characterTag.create({
        data: { characterId, tagId, source: "EVENT", expiresTurn: turn.number },
      });
    }
  }

  // skipDuplicates keeps a held successor's own clock rather than resetting it, exactly as consumesInto leaves an already-held grant alone (docs/systemdocs/TAGS.md §5b).
  const alreadyHeld = rows.length
    ? await prisma.characterTag.findMany({
        where: { OR: rows.map((r) => ({ characterId: r.characterId, tagId: r.tagId })) },
        select: { characterId: true, tagId: true },
      })
    : [];
  const heldKeys = new Set(alreadyHeld.map((r) => `${r.characterId}:${r.tagId}`));
  await prisma.characterTag.createMany({ data: rows, skipDuplicates: true });

  const moodDms = [];
  const landedByCharacter = new Map();
  for (const r of rows) {
    if (heldKeys.has(`${r.characterId}:${r.tagId}`)) continue;
    if (!landedByCharacter.has(r.characterId)) landedByCharacter.set(r.characterId, []);
    landedByCharacter.get(r.characterId).push(r.tagId);
  }
  for (const [characterId, tagIds] of landedByCharacter) {
    const moved = await applyWoundMood(prisma, characterId, tagIds, { notify: false }).catch((err) => {
      console.error(`Tag expiry pass: wound mood failed for ${characterId}:`, err.message ?? err);
      return null;
    });
    if (moved?.dm) moodDms.push(moved.dm);
  }

  const dms = [...progressions.values()]
    .filter((p) => p.discordUserId)
    .map((p) => ({
      discordUserId: p.discordUserId,
      // Bot-composed, so the » goes in at the call site rather than coming
      // from sendDm — see CLAUDE.md's aura note. Worse first: a wound that
      // deepened overnight outranks a night's sleep wearing off.
      content: [
        ...(p.worse.length ? [WORSE_HEADER, ...p.worse.map((l) => `» ${l}`)] : []),
        ...(p.better.length ? [BETTER_HEADER, ...p.better.map((l) => `» ${l}`)] : []),
      ].join("\n"),
    }));

  return {
    turnNumber: turn.number,
    progressed: progressions.size,
    granted: rows.length,
    renewed: renewals.length,
    fatal: fatalRows.length,
    unknownSlugs: [...missing],
    dms: [...dms, ...moodDms],
  };
}

module.exports = { runTagExpiryPass };
