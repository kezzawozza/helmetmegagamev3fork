// Noticeboards: paper nailed up in public, for anyone to read or take down.
// See docs/systemdocs/PAPERWORK.md. A board is an ATTRIBUTE on a Location
// (docs/zones.yaml, db/lib/locationAttributes.js), not a slug hardcoded here.
// A pinned paper is a NoticePost, not a RoomTag: it belongs to the Location,
// needs its own clock, and must not show in a room's private Storage readout.
// Deliberately open: anyone standing there may pin, read, or tear down any
// notice, including a rival's — a board nobody can strip is a bulletin the
// game is enforcing.
// Pure of Prisma except boardFor() below, which takes `prisma` as a
// parameter the way db/lib/dm.js does — require it by path, not the barrel.

const NOTICEBOARD_ATTRIBUTE = "noticeboard";

// Discord's cap on a string select's options, which is also the practical cap
// on how many notices one panel can offer. A board fuller than this shows the
// oldest 25 — the ones closest to blowing away, and so the ones most worth
// acting on.
const BOARD_OPTION_LIMIT = 25;

function hasNoticeboard(location) {
  return Boolean(location?.attributes?.[NOTICEBOARD_ATTRIBUTE]);
}

// The line a notice gets in the board's readout: WHAT it is and HOW LONG it
// has left, never what it says — someone who cannot read must not learn the
// contents from a list.
function noticeLine(post, turnNumber) {
  const left = Math.max(0, (post.expiresTurn ?? 0) - (turnNumber ?? 0) + 1);
  const clock = left <= 1 ? "comes down this turn" : `${left} turns left`;
  return `${post.tag?.name ?? "A paper"} — ${clock}`;
}

// The whole board, as subtext. Empty is a real state and says so.
function boardText(locationName, posts, turnNumber) {
  if (!posts || posts.length === 0) {
    return `The noticeboard at ${locationName} is bare.`;
  }
  const lines = posts.map((p) => `  ${noticeLine(p, turnNumber)}`);
  return [`The noticeboard at ${locationName}:`, ...lines].join("\n");
}

// What the world says when somebody nails something up. Scenery — caller runs
// it through db/lib/ambientLine.js. Names the PAPER, never the person:
// anonymous pinning is the point of a public board.
function pinnedLine(tagName) {
  return `Somebody has pinned ${tagName} to the noticeboard.`;
}

function tornLine(tagName) {
  return `${tagName} has been torn down off the noticeboard.`;
}

// THE BOARD AT A LOCATION, loaded. Knows nothing about who is asking — the
// ACTOR gate belongs to the caller, so this can draw a board into a page the
// way web/app/(app)/chat does. Answers `{ location, openTurn, posts }` or
// `{ error }`.
async function boardFor(prisma, locationId) {
  const location = await prisma.location.findUnique({
    where: { id: locationId ?? "" },
    select: { id: true, name: true, indoors: true, attributes: true, discordChannelId: true },
  });
  if (!location) return { error: "That place is gone." };
  if (!hasNoticeboard(location)) return { error: "There's no board here." };
  const [openTurn, posts] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } }),
    prisma.noticePost.findMany({
      where: { locationId: location.id },
      orderBy: { expiresTurn: "asc" },
      take: BOARD_OPTION_LIMIT,
      include: { tag: true },
    }),
  ]);
  return { location, openTurn, posts };
}

// TEARING WITH NO HANDS: a GM has nothing to hold a torn notice in, so the
// paper goes with the post, same as the noticeboard pass in db/index.js.
// `ephemeral` is the same guard that pass uses — a catalog tag on a wall must
// survive being torn off. Delete is returned uncounted-on so the caller's own
// delete-IS-the-claim race check still holds.
async function destroyNotice(prisma, post) {
  const claimed = await prisma.noticePost.deleteMany({ where: { id: post.id } });
  if (claimed.count === 0) return claimed;
  await prisma.tag.deleteMany({ where: { id: post.tagId, ephemeral: true } });
  return claimed;
}

module.exports = {
  boardFor,
  destroyNotice,
  BOARD_OPTION_LIMIT,
  hasNoticeboard,
  noticeLine,
  boardText,
  pinnedLine,
  tornLine,
};
