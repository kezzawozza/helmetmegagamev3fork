// Noticeboards: paper nailed up in public, for anyone to read or take down.
// See docs/systemdocs/PAPERWORK.md.
//
// A board is not a thing — it is an ATTRIBUTE on a Location, declared in
// docs/zones.yaml and registered in db/lib/locationAttributes.js, so no slug is
// hardcoded anywhere and adding a board is one line of YAML.
//
// A pinned paper is a NoticePost row, not a RoomTag: a board belongs to the
// Location rather than to any room inside it, a notice needs its own clock, and
// a public board must not turn up in a room's private Storage readout.
//
// Everything a notice does is deliberately open. Anyone standing there may pin,
// read or tear one down — including tearing down somebody else's. A board you
// cannot strip is not a board, it is a bulletin the game is enforcing, and
// ripping down a rival's proclamation is exactly the kind of thing the whole
// system exists to make possible.
//
// Pure of Prisma by the usual rule, with ONE exception at the bottom:
// boardFor() takes `prisma` as a parameter the way db/lib/dm.js does, because
// "the board at this Location" was being spelled out again at every call site
// and one of them had it keyed off the READER rather than off the Location.

const NOTICEBOARD_ATTRIBUTE = "noticeboard";

// Discord's cap on a string select's options, which is also the practical cap
// on how many notices one panel can offer. A board fuller than this shows the
// oldest 25 — the ones closest to blowing away, and so the ones most worth
// acting on.
const BOARD_OPTION_LIMIT = 25;

function hasNoticeboard(location) {
  return Boolean(location?.attributes?.[NOTICEBOARD_ATTRIBUTE]);
}

// The line a notice gets in the board's readout. Says WHAT it is and HOW LONG
// it has left, and nothing about what it says — reading is its own act, and
// somebody who cannot read must not learn the contents from a list.
function noticeLine(post, turnNumber) {
  const left = Math.max(0, (post.expiresTurn ?? 0) - (turnNumber ?? 0) + 1);
  const clock = left <= 1 ? "comes down this turn" : `${left} turns left`;
  return `${post.tag?.name ?? "A paper"} — ${clock}`;
}

// The whole board, as subtext. Empty is a real state and says so: an empty
// board is information, and a silent panel would read as a bug.
function boardText(locationName, posts, turnNumber) {
  if (!posts || posts.length === 0) {
    return `The noticeboard at ${locationName} is bare.`;
  }
  const lines = posts.map((p) => `  ${noticeLine(p, turnNumber)}`);
  return [`The noticeboard at ${locationName}:`, ...lines].join("\n");
}

// What the world says when somebody nails something up. Scenery, so the caller
// runs it through db/lib/ambientLine.js, which handles the per-line `-#`.
//
// It names the PAPER and never the person. A notice pinned anonymously is the
// point of a public board, and "Ada pinned up a paper" would end that forever.
function pinnedLine(tagName) {
  return `Somebody has pinned ${tagName} to the noticeboard.`;
}

function tornLine(tagName) {
  return `${tagName} has been torn down off the noticeboard.`;
}

// THE BOARD AT A LOCATION, loaded. `prisma` is a parameter for the reason
// db/lib/dm.js gives — requiring db/index.js back from inside db/lib would
// resolve to a partial exports object — so require this by path, never
// through the barrel.
//
// It knows nothing about who is asking. That is deliberate: the ACTOR gate
// (are you standing here, are you alive) belongs to the caller, and a loader
// that carried it could not be used to draw a board into a page the way
// web/app/(app)/chat does. It answers `{ location, openTurn, posts }`, or
// `{ error }` when there is no such place or no board on it.
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

// TEARING WITH NO HANDS. A player who takes a notice down walks away holding
// it; a GM has nothing to hold it in, so the paper goes with the post — which
// is also exactly what happens to a notice that blows away on its own clock
// (the noticeboard pass in db/index.js).
//
// `ephemeral` is the same guard that pass uses, and it is the whole guard: a
// catalog tag that somehow found its way onto a wall must survive being torn
// off it. The post delete is returned uncounted-on so the caller can keep its
// own delete-IS-the-claim race check — two people tearing at one paper still
// cannot both walk away with it.
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
