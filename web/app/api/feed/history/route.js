import { prisma, FEED_ROW_SELECT } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors, floorForPlace, seqFilterAbove } from "@lifeweb/db/lib/feedWipe";
import { loadFeedViewer, findPlace } from "@/lib/feedAccess";

// GET /api/feed/history?place=<key> — the last hundred things said in one
// place, and, with ?before=<seq>, the hundred before those.
//
// The stream carries what happens NEXT; this is what happened before. They are
// separate on purpose: a Chat has half a dozen places and a GM has hundreds,
// and pushing every one of their backlogs down one stream would spend a
// player's first second of the page on rooms they never opened. So the page
// server-renders the place it opens on, and this fills in the rest as they are
// selected.
//
// ?before= is how a reader gets further back than that first hundred. It used
// to be that they could not: one page existed, and a scene older than a
// hundred lines was simply unreachable from Chat, which is what players
// meant by the chat "not saving up the entire chat". The rows were in
// /archive the whole time — a different page with a different shape, and not
// what somebody scrolling up in a room is asking for.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;
// Either side of a search hit. Fifty is enough to read what led up to a line
// and what came of it without pulling the whole day down the wire.
const AROUND_ROWS = 50;
// The largest value a Postgres bigint holds. ArchiveEntry.seq is one.
const MAX_SEQ = 9223372036854775807n;

// A seq off the query string, or null if it isn't one.
//
// BigInt() throws a SyntaxError on anything that is not a whole number, and
// the query string is whatever somebody typed — answered rather than thrown,
// because an unparseable cursor is a bad request, not a 500. And a number that
// PARSES can still be out of range: `seq` is a bigint column, so anything past
// its bounds is not a line either, and handing it to Prisma is an error from
// inside the driver instead of an answer.
function readSeq(raw) {
  let value;
  try {
    value = BigInt(raw);
  } catch {
    return null;
  }
  if (value < 0n || value > MAX_SEQ) return null;
  return value;
}

export async function GET(request) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!viewer.character && !viewer.gm) {
    return Response.json({ error: "You have no living character." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const place = params.get("place");
  // The same gate the stream uses, derived from the same place list.
  const found = await findPlace(prisma, viewer.character, place, viewer.options);
  if (!found) return Response.json({ error: "You aren't there." }, { status: 403 });

  // Nothing from before the last wipe of THIS place (db/lib/feedWipe.js).
  // Discord's half of that pass deleted its messages outright; Chat keeps
  // the rows for /archive and reads past them. One place, so one floor: a
  // zone summary reads the Dawn watermark, everywhere else the turn one.
  const floor = floorForPlace(await feedWipeFloors(prisma), place);

  // ?around=<seq> — the window either side of one line, which is what a
  // search hit needs: the newest hundred would usually not hold something
  // said three days ago. Two queries rather than one, because "50 below and
  // 50 above, inclusive" is not a thing one findMany can say.
  const around = params.get("around");
  if (around) {
    const anchor = readSeq(around);
    if (anchor === null) return Response.json({ error: "That isn't a line." }, { status: 400 });
    const base = { placeKey: place, deletedAt: null };
    const [below, above] = await Promise.all([
      prisma.archiveEntry.findMany({
        // The anchor itself rides in this half, so a hit whose seq is the
        // oldest thing left above the wipe floor still comes back.
        where: { ...base, seq: seqFilterAbove(floor, { lte: anchor }) },
        orderBy: { seq: "desc" },
        take: AROUND_ROWS + 1,
        select: FEED_ROW_SELECT,
      }),
      prisma.archiveEntry.findMany({
        where: { ...base, seq: seqFilterAbove(floor, { gt: anchor }) },
        orderBy: { seq: "asc" },
        take: AROUND_ROWS,
        select: FEED_ROW_SELECT,
      }),
    ]);
    const window = [...below.reverse(), ...above];
    return Response.json({ place, rows: await withAvatarVersions(prisma, window) });
  }

  // ?before=<seq> — one page further back, for a reader scrolling up. Same
  // shape and same size as the plain page below, so the client's merge does
  // not care which one answered.
  const before = params.get("before");
  let cursor = null;
  if (before !== null) {
    cursor = readSeq(before);
    if (cursor === null) return Response.json({ error: "That isn't a line." }, { status: 400 });
  }

  const rows = await prisma.archiveEntry.findMany({
    where: {
      placeKey: place,
      deletedAt: null,
      seq: seqFilterAbove(floor, cursor === null ? {} : { lt: cursor }),
    },
    orderBy: { seq: "desc" },
    take: HISTORY_ROWS,
    select: FEED_ROW_SELECT,
  });

  // A short page is the end of the road — there is nothing older to ask for,
  // either because the place is that young or because the wipe floor is right
  // there. The client stops asking on this rather than firing a request at
  // every scroll to the top forever.
  const exhausted = rows.length < HISTORY_ROWS;

  // One `?v=` per character across the page, rather than the per-row sentAt
  // fallback that made the same face refetch on every line.
  return Response.json({
    place,
    rows: await withAvatarVersions(prisma, rows.reverse()),
    exhausted,
    // Whether the end of the road is a WIPE rather than the start of the
    // place. Chat says different things about the two: one points at
    // /archive, the other is just the beginning.
    floored: exhausted && floor > 0n,
  });
}
