// Searching somebody (docs/systemdocs/SEARCH.md). A Search is an Offer, the
// same consent handshake Kiss/Bind/Confession/Escort/Lesson share — read
// db/lib/kiss.js first, everything here is a delta from it. Costs no Move,
// files no Action, and no turn pass touches it; what holds it back is one
// ration, once per person per turn, spent by the ASK.
//
// Two things make it different from every other kind. It has a THIRD control
// on the consent DM — Hide items, which writes Offer.hiddenTagIds before the
// answer — and it rolls a d6 nobody is ever shown.
//
// Takes `prisma` first, NOT on the @lifeweb/db barrel — require by path.
const { isHere } = require("./presence");
const { blockerFor, ACT } = require("./incapacitation");
const { hideableFromSearch } = require("./medicalVision");
const { isTradeable } = require("./tradeable");
const { rollWithAdvantage } = require("./advantage");
const { CONCEALMENT_TAG_FIELDS } = require("./presentedIdentity");
const { capitalizeFirst } = require("./concealedIdentity");
const { seenAs, identityOf, IDENTITY_SELECT } = require("./intercept");
const { searchButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");

// The ask writes this; the ration counts SearchAttempt rows, not these. Kept
// apart the way KISS.md §3 keeps `kiss` and `kiss_accepted` apart: if the
// accept wrote `search` rows, being searched would look like searching.
const SEARCH_AUDIT_ACTION = "search";
const SEARCH_ACCEPTED_ACTION = "search_accepted";

// Discord's own ceiling on a select menu. The web face has no cap.
const MENU_OPTION_LIMIT = 25;

// A superset of IDENTITY_SELECT, and the `tags` key OVERRIDES rather than
// merges — you cannot have two of them, and this is the single most breakable
// line in the feature. Drop CONCEALMENT_TAG_FIELDS and presentedIdentity
// reports every hood as no hood; drop inspectVisibility and hideableFromSearch
// reads `undefined` and, being an allowlist, makes everything unhideable.
// db/test/search.test.js pins the key set for exactly that reason.
const SEARCH_SELECT = {
  ...IDENTITY_SELECT,
  tags: {
    where: { quantity: { gt: 0 } },
    select: {
      tagId: true,
      quantity: true,
      equipped: true,
      tag: {
        select: {
          id: true,
          name: true,
          slug: true,
          tradeable: true,
          inspectVisibility: true,
          weightLbs: true,
          forcedName: true,
          ...CONCEALMENT_TAG_FIELDS,
        },
      },
    },
  },
};

// ─── The pure half (db/test/search.test.js covers all of this) ─────────────

// What the target may palm. Cargo only, and HIDDEN or WORN only — an ALWAYS
// item is seen standing in the road, so offering to hide it would be a lie.
function hideableHoldings(characterTags = []) {
  return (characterTags ?? [])
    .filter((ct) => ct?.tag && isTradeable(ct.tag) && hideableFromSearch(ct.tag))
    .map((ct) => ({
      tagId: ct.tagId ?? ct.tag.id,
      name: ct.tag.name,
      quantity: ct.quantity ?? 1,
      equipped: Boolean(ct.equipped),
      weightLbs: ct.tag.weightLbs ?? 0,
    }));
}

// Everything in their pockets a search is ABOUT — cargo, whatever its
// visibility. What is not hidden out of this comes out whatever the die says.
function searchableHoldings(characterTags = []) {
  return (characterTags ?? [])
    .filter((ct) => ct?.tag && isTradeable(ct.tag))
    .map((ct) => ({
      tagId: ct.tagId ?? ct.tag.id,
      name: ct.tag.name,
      quantity: ct.quantity ?? 1,
      equipped: Boolean(ct.equipped),
      weightLbs: ct.tag.weightLbs ?? 0,
    }));
}

// The whole rule, in one line. A 6 takes the lot; a 1 against five hidden
// things takes none. The floor is why hiding ONE thing is the strong play
// (SEARCH.md §3a says so out loud, since nobody can see the die to work it out).
function revealCount(die, hiddenCount) {
  if (!hiddenCount) return 0;
  return Math.floor((die / 6) * hiddenCount);
}

// Which of the hidden ones come out — at random, so the target cannot steer
// what they give up by the order they ticked. `rng` is injected so the test is
// deterministic; nothing in the game passes it.
function pickRevealed(hidden = [], count, rng = Math.random) {
  const pool = [...hidden];
  const take = Math.max(0, Math.min(count, pool.length));
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

function nameList(rows) {
  return rows.map((r) => (r.quantity > 1 ? `${r.name} ×${r.quantity}` : r.name)).join(", ");
}

// Both sides' words come out of ONE call, so the two readouts cannot drift.
// The die is not in here and never reaches a player — SEARCH.md §3b.
function searchReadout({ searcherSeenAs, targetSeenAs, found = [], onShow = [] }) {
  const lines = [];
  lines.push(found.length ? `They are carrying: ${nameList(found)}.` : "They are carrying nothing.");
  if (onShow.length) lines.push(`In plain sight: ${nameList(onShow)}.`);
  return {
    searcherLines: [`You searched ${targetSeenAs}.`, ...lines].join("\n"),
    // Same facts, so nobody has to wonder what leaked. "In plain sight" is
    // repeated deliberately: it tells them which half was never at stake.
    targetLines: [
      `${capitalizeFirst(searcherSeenAs)} searched you.`,
      found.length ? `They found: ${nameList(found)}.` : "They found nothing.",
      ...(onShow.length ? [`In plain sight: ${nameList(onShow)}.`] : []),
    ].join("\n"),
  };
}

// kissAuthority's twin with two deliberate deletions: no capability or fiction
// list beyond ACT, and NO covered-face refusal. A hood hides who you are, not
// what is in your pockets (PROXYING.md §5), so `allowConcealed` is on — the
// second caller in the game after Transfer.
function searchAuthority(actor, target) {
  if (!actor || !target) return "They aren't here.";
  if (actor.id === target.id) return "Search somebody else.";
  if (actor.status !== "ALIVE") return "You can't do that right now.";
  // NOT notHereMessage(): it prints `target.name` off the row, and this is the
  // one verb whose target may be hooded. "Lord Greeblus isn't here." would
  // unmask somebody the searcher only ever saw as a young man — and a refusal
  // is the last place that should happen (INTERCEPT.md §2).
  if (target.status !== "ALIVE") return `${capitalizeFirst(seenAs(identityOf(target)))} isn't here.`;
  if (!isHere(actor, target, { allowConcealed: true }))
    return `${capitalizeFirst(seenAs(identityOf(target)))} isn't here.`;

  const mine = blockerFor(actor.tags, ACT);
  if (mine) return `You're ${mine.name}.`;
  // Named by the face the room sees, never the row — the rule INTERCEPT.md §2
  // sets. A refusal is no place to out somebody.
  const theirs = blockerFor(target.tags, ACT);
  if (theirs) return `${capitalizeFirst(seenAs(identityOf(target)))} is ${theirs.name}.`;
  return null;
}

// ─── The impure half ───────────────────────────────────────────────────────

// Returns { ok, offer, dm } or { ok: false, reason }. The SearchAttempt insert
// IS the ration (SEARCH.md §3), so a P2002 here is a refusal, not a crash, and
// it rides the same transaction as the Offer so two fast clicks cannot both
// pass.
async function createSearchOffer(prisma, { actor, target, turn }) {
  const refusal = searchAuthority(actor, target);
  if (refusal) return { ok: false, reason: refusal };
  if (!target.discordUserId)
    return { ok: false, reason: `${capitalizeFirst(seenAs(identityOf(target)))} can't be reached.` };
  if (!turn?.id) return { ok: false, reason: "No turn is open." };

  const theirFace = seenAs(identityOf(target));

  let offer;
  try {
    offer = await prisma.$transaction(async (tx) => {
      // The claim comes FIRST: if it throws, nothing else in here happened.
      await tx.searchAttempt.create({
        data: { searcherId: actor.id, targetCharacterId: target.id, turnId: turn.id },
      });
      const row = await tx.offer.create({
        data: { kind: "SEARCH", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
      });
      await tx.searchAttempt.updateMany({
        where: { searcherId: actor.id, targetCharacterId: target.id, turnId: turn.id },
        data: { offerId: row.id },
      });
      if (actor.discordUserId) {
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: actor.discordUserId,
            actionType: SEARCH_AUDIT_ACTION,
            targetCharacterId: target.id,
            turnId: turn.id,
            locationId: actor.locationId ?? null,
            // `presented` for the INTERCEPT.md §2 reason: the log must not be
            // the thing that unmasks somebody the searcher never saw.
            details: { offerId: row.id, presented: theirFace, asked: true },
          },
        });
      }
      return row;
    });
  } catch (err) {
    if (err?.code === "P2002") return { ok: false, reason: `You already searched ${theirFace} this turn.` };
    throw err;
  }

  return {
    ok: true,
    offer,
    dm: {
      discordUserId: target.discordUserId,
      content: `*${seenAs(identityOf(actor))}* wants to search you. Consent?`,
      components: searchButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id, "SEARCH"),
    },
  };
}

// The rows the Hide-items picker draws, plus what is already ticked. Loaded
// for the RESPONDER off the session, never off a posted id.
async function hideableFor(prisma, { offerId, discordUserId }) {
  const offer = await prisma.offer.findUnique({
    where: { id: String(offerId ?? "") },
    select: { id: true, kind: true, status: true, responderId: true, hiddenTagIds: true },
  });
  if (!offer || offer.kind !== "SEARCH") return { ok: false, reason: "That offer's gone." };
  if (offer.status !== "PENDING") return { ok: false, reason: "That offer's gone." };

  const responder = await prisma.character.findFirst({
    where: { id: offer.responderId, status: "ALIVE" },
    select: { id: true, discordUserId: true, tags: SEARCH_SELECT.tags },
  });
  if (!responder || responder.discordUserId !== discordUserId) {
    return { ok: false, reason: "That's not yours to answer." };
  }

  return { ok: true, rows: hideableHoldings(responder.tags), hidden: offer.hiddenTagIds ?? [] };
}

// The one writer both faces call. The ownership check is the WHERE, loadOfferFor's
// posture — there is no second lookup to disagree with it. Posted ids are
// intersected against what they actually hold, because a server action and a
// Discord component are both public endpoints.
//
// `scope` is what the picker could actually SHOW. Discord caps a select menu at
// 25 options, so a player with more hideable stacks than that sees a slice — and
// without this the save would replace the whole set and silently unhide
// everything outside it, undoing on Discord what they had ticked on the web.
// Given a scope, ids hidden outside it are carried through untouched; the web
// picker shows everything and passes none.
async function setHiddenItems(prisma, { offerId, discordUserId, tagIds = [], scope = null }) {
  const loaded = await hideableFor(prisma, { offerId, discordUserId });
  if (!loaded.ok) return loaded;

  const allowed = new Set(loaded.rows.map((r) => r.tagId));
  const picked = [...new Set((tagIds ?? []).map(String))].filter((id) => allowed.has(id));

  const shown = scope ? new Set(scope.map(String)) : null;
  const carried = shown
    ? (loaded.hidden ?? []).filter((id) => allowed.has(id) && !shown.has(id))
    : [];
  const hiddenTagIds = [...new Set([...carried, ...picked])];

  const claim = await prisma.offer.updateMany({
    where: { id: String(offerId), kind: "SEARCH", status: "PENDING" },
    data: { hiddenTagIds },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone." };
  return { ok: true, hidden: hiddenTagIds, rows: loaded.rows };
}

// The Yes click; the shape db/lib/dmAnswer.js#answerOffer hands back to both faces.
async function acceptSearch(prisma, offer, responder) {
  const [actor, target] = await Promise.all([
    prisma.character.findUnique({ where: { id: offer.initiatorId }, select: SEARCH_SELECT }),
    prisma.character.findUnique({ where: { id: offer.responderId }, select: SEARCH_SELECT }),
  ]);

  const refuse = async (reason) => {
    await prisma.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    return {
      ok: false,
      reason,
      dms: actor?.discordUserId
        ? [{ discordUserId: actor.discordUserId, content: `Your search fell through: ${reason}` }]
        : [],
    };
  };

  // Re-run the whole gate — a DM can sit unanswered for hours, and in that time
  // either of them can be bound, drugged, moved or killed.
  const refusal = searchAuthority(actor, target);
  if (refusal) return refuse(refusal);

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });

  const { die, rolls, advantage } = rollWithAdvantage(actor.tags, 6);

  const hiddenIds = new Set(offer.hiddenTagIds ?? []);
  const pockets = searchableHoldings(target.tags);
  const hidden = pockets.filter((r) => hiddenIds.has(r.tagId));
  const open = pockets.filter((r) => !hiddenIds.has(r.tagId));
  const givenUp = pickRevealed(hidden, revealCount(die, hidden.length));

  // Context, never at stake: what a bystander sees on them anyway. NOT cargo —
  // an ALWAYS item in their pockets is already in `open` above and printing it
  // in both lists read as the search finding the same longbow twice. What is
  // left is the half a search was never about: scars, statuses, a visible
  // affliction.
  const onShow = (target.tags ?? [])
    .filter((ct) => ct?.tag?.inspectVisibility === "ALWAYS" && !isTradeable(ct.tag))
    .map((ct) => ({ name: ct.tag.name, quantity: ct.quantity ?? 1 }));

  const found = [...open, ...givenUp];
  const { searcherLines, targetLines } = searchReadout({
    searcherSeenAs: seenAs(identityOf(actor)),
    targetSeenAs: seenAs(identityOf(target)),
    found,
    onShow,
  });

  // One row per side, both carrying turnId — REQUESTS.md §1a. `presented` is
  // stored rather than the bare name for the INTERCEPT.md §2 reason.
  await prisma.auditLog.createMany({
    data: [
      {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: SEARCH_ACCEPTED_ACTION,
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        locationId: actor.locationId ?? null,
        details: {
          offerId: offer.id,
          die,
          hiddenCount: hidden.length,
          revealed: givenUp.map((r) => r.name),
          found: found.map((r) => r.name),
          presented: seenAs(identityOf(target)),
        },
      },
      {
        actorDiscordUserId: target.discordUserId ?? "system",
        actionType: SEARCH_ACCEPTED_ACTION,
        targetCharacterId: actor.id,
        turnId: turn?.id ?? null,
        locationId: target.locationId ?? null,
        details: { offerId: offer.id, searched: true, presented: seenAs(identityOf(actor)) },
      },
    ],
  });

  // The die goes on the row so a GM auditing it can see what happened, and
  // nowhere else. No player surface reads `outcome`.
  await prisma.offer.update({
    where: { id: offer.id },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      outcome: {
        die,
        rolls,
        advantage,
        hiddenCount: hidden.length,
        revealedTagIds: givenUp.map((r) => r.tagId),
      },
    },
  });

  // `line` is what dmAnswer.js hands back to whoever pressed the button, and
  // that is the RESPONDER — the person being searched. The searcher is not here;
  // they are reached by an addressed `dms` entry. Getting these the wrong way
  // round tells each of them the other one's sentence, with their own name in it.
  return {
    ok: true,
    line: targetLines,
    dms: actor.discordUserId ? [{ discordUserId: actor.discordUserId, content: searcherLines }] : [],
  };
}

// A search dies when the two of them are no longer standing in one place. The
// test is CO-LOCATION, not "somebody moved", and that distinction is the whole
// of this function.
//
// It has to be, because of the order the travel path runs in:
// performLocationMove fires the watches (which is where an auto-search offer is
// BORN, intercept.js#fireWatches) and only then does the caller loop
// applyLocationMoveSideEffects over everyone who arrived — which lands here,
// with the fresh offer's own responder as `characterId`. A naive "they moved,
// so cancel" would kill every auto-search the instant it was created, spend the
// ration, and DM the interceptor that their catch walked away while the two of
// them stood in the same room. Asking where both of them are now is immune to
// that ordering, and says the true thing besides.
//
// It fires for either end: which of them left does not change that they are no
// longer together. Two people who travel TOGETHER keep their pending search,
// which is right — nobody walked away from anybody.
//
// Sends nothing — returns DM descriptors, the cancelWatchOnMove posture, so the
// caller can send them below its own Discord guard.
//
// The ration is NOT refunded. The ask spent it (KISS.md §4), or walking out of
// a room and back in would be a free second attempt.
async function cancelSearchOffersOnMove(db, characterId) {
  const rows = await db.offer.findMany({
    where: {
      kind: "SEARCH",
      status: "PENDING",
      OR: [{ initiatorId: characterId }, { responderId: characterId }],
    },
    select: { id: true, initiatorId: true, responderId: true },
  });
  if (rows.length === 0) return [];

  const dms = [];
  for (const row of rows) {
    const iAmTheSearcher = row.initiatorId === characterId;
    const otherId = iAmTheSearcher ? row.responderId : row.initiatorId;
    const [me, other] = await Promise.all([
      db.character.findUnique({ where: { id: characterId }, select: IDENTITY_SELECT }),
      db.character.findUnique({ where: { id: otherId }, select: IDENTITY_SELECT }),
    ]);
    // Still together — a party that travelled as one, or the arrival that just
    // walked into the watch that is asking. Nothing has been walked away from.
    if (me?.locationId && other?.locationId && me.locationId === other.locationId) continue;

    const claim = await db.offer.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    // Answered in the gap between the read and the claim — say nothing.
    if (claim.count === 0) continue;

    // The line always goes to the SEARCHER and always names the RESPONDER. Which
    // of `me` and `other` is which depends on WHICH END MOVED, and getting it
    // wrong is not a crash — it just quietly tells the searcher that they
    // themselves walked away.
    const searcher = iAmTheSearcher ? me : other;
    const subject = iAmTheSearcher ? other : me;
    if (!searcher?.discordUserId) continue;
    dms.push({
      discordUserId: searcher.discordUserId,
      content: `${capitalizeFirst(seenAs(identityOf(subject)))} refused your search and walked away.`,
    });
  }
  return dms;
}

module.exports = {
  SEARCH_AUDIT_ACTION,
  SEARCH_ACCEPTED_ACTION,
  SEARCH_SELECT,
  MENU_OPTION_LIMIT,
  hideableHoldings,
  searchableHoldings,
  revealCount,
  pickRevealed,
  searchReadout,
  searchAuthority,
  createSearchOffer,
  hideableFor,
  setHiddenItems,
  acceptSearch,
  cancelSearchOffersOnMove,
};
