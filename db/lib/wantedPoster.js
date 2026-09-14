// The world puts a face up — Wanted and Debtor alike.
//
// A character who turns up already Wanted (the tag is a creation-time buy)
// has a bounty on them before they have done anything, and three sheets go up
// the moment they arrive: one in the garrison mess, where the soldiers who
// might collect it eat; one in the Censor's office, where the paperwork
// lives; and one nailed to the board in the Square, where everybody in Town
// walks past it.
//
// Debtor works the same shape, in different rooms: one loose sheet in the
// Merchant's office, one on the Customs storefront counter, one pinned to the
// Customs noticeboard. Its line never names a zone — the debt is the debt
// wherever the debtor is standing.
//
// The Wanted line names the zone the character STARTED in and never updates.
// That is what a wanted poster is — a snapshot of where somebody was last
// seen, going stale the moment they move.
//
// Three separate sheets, not one: NoticePost.tagId is @unique, so a pinned
// poster cannot also be sitting in a stash.
//
// Takes `prisma` as a parameter, the db/lib/dm.js convention, and stays off
// the @lifeweb/db barrel.

const { mintUnownedPaper } = require("./paperMint");
const { addToRoomStack } = require("./tagWrites");
const { expiryFrom } = require("./turnFormat");
const { DEBTOR_SLUG } = require("./constants");
// The tag itself lives in wanted.js; this file is only the paper. Both are
// re-exported below so the callers that always imported them from here still
// can.
const { WANTED_SLUG, isWanted } = require("./wanted");

// The Merchant advanced him half of it; the paper says the rest.
const DEBTOR_DEBT_OBOLS = 40;
const DEBTOR_STARTING_OBOLS = 20;

// Long enough to outlast the brigand (or the debt). NoticePost.expiresTurn is
// required and db/lib/noticeboardPass.js destroys the paper with the post, so
// a poster with no clock is not an option — this is the clock that reads as
// "indefinitely".
const POSTER_TURNS = 30;

// One spec per kind of notice: who authored it, which two rooms get a loose
// sheet, which Location's noticeboard gets the pinned one, how the text
// reads, and whether that text needs a zone name to make sense.
const NOTICE_SPECS = {
  WANTED: {
    author: "The Cerberon",
    roomSlugs: ["garrison-mess-hall", "garrison-censors-office"],
    boardLocationSlug: "square",
    text: (name, zoneName) => `WANTED: ${name}. Last seen in the ${zoneName}.`,
    needsZone: true,
  },
  DEBTOR: {
    author: "The Merchant",
    roomSlugs: ["depot-merchants-office", "depot-storefront"],
    boardLocationSlug: "depot",
    text: (name) => `DEBTOR: ${name}. Owes: ${DEBTOR_DEBT_OBOLS} obols. Send the dockers.`,
    needsZone: false,
  },
};

// True when a freshly created character bought Debtor.
function isDebtor(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(DEBTOR_SLUG);
}

// Puts the three sheets up for one notice spec. Best-effort by contract:
// every caller wraps it, because a poster may never cost a character that
// already exists.
async function postNotices(prisma, character, openTurn, spec) {
  const zoneName = character?.zone?.name ?? character?.zoneName ?? null;
  if (!character?.id) return { rooms: 0, pinned: false };
  if (spec.needsZone && !zoneName) return { rooms: 0, pinned: false };

  const text = spec.needsZone ? spec.text(character.name, zoneName) : spec.text(character.name);
  const turnNumber = openTurn?.number ?? null;

  const rooms = await prisma.room.findMany({
    where: { slug: { in: spec.roomSlugs } },
    select: { id: true },
  });
  const board = await prisma.location.findUnique({
    where: { slug: spec.boardLocationSlug },
    select: { id: true },
  });

  // One transaction per sheet rather than one for all three. createWithRetry
  // re-creates on a name collision, and Postgres aborts a whole transaction
  // on the first failed statement — so batching them would turn one unlucky
  // waybill code into three lost posters (the trap paperMint.js documents).
  let posted = 0;
  for (const room of rooms) {
    await prisma.$transaction(async (tx) => {
      const tag = await mintUnownedPaper(tx, `${character.id}-${room.id}`, spec.author, text);
      await addToRoomStack(tx, room.id, tag.id, 1, {});
    });
    posted += 1;
  }

  let pinned = false;
  if (board && turnNumber != null) {
    await prisma.$transaction(async (tx) => {
      const tag = await mintUnownedPaper(tx, `${character.id}-${board.id}`, spec.author, text);
      await tx.noticePost.create({
        data: {
          locationId: board.id,
          tagId: tag.id,
          // Nullable by design: a notice outlives whoever pinned it, and
          // neither the Cerberon nor the Merchant are a character.
          postedById: null,
          postedTurn: turnNumber,
          expiresTurn: expiryFrom(turnNumber, POSTER_TURNS),
        },
      });
    });
    pinned = true;
  }

  return { rooms: posted, pinned };
}

async function postWantedPosters(prisma, character, openTurn) {
  return postNotices(prisma, character, openTurn, NOTICE_SPECS.WANTED);
}

async function postDebtorNotices(prisma, character, openTurn) {
  return postNotices(prisma, character, openTurn, NOTICE_SPECS.DEBTOR);
}

module.exports = {
  isWanted,
  postWantedPosters,
  WANTED_SLUG,
  isDebtor,
  postDebtorNotices,
  DEBTOR_STARTING_OBOLS,
};
