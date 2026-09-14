import { prisma, FEED_ROW_SELECT } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors, floorForPlace, seqFilterAbove } from "@lifeweb/db/lib/feedWipe";
import { loadFeedViewer, findPlace } from "@/lib/feedAccess";

// GET /api/feed/history?place=<key> — the last hundred things said in one
// place, and with ?before=<seq> the hundred before those. The stream carries
// what happens NEXT; this is what happened before, so the page server-renders
// the place it opens on and this fills in the rest as they're selected.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;
// Either side of a search hit.
const AROUND_ROWS = 50;
// The largest value a Postgres bigint holds. ArchiveEntry.seq is one.
const MAX_SEQ = 9223372036854775807n;

// A seq off the query string, or null if it isn't one — an unparseable cursor
// is a bad request, not a 500, and an out-of-bounds one is handled the same way.
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
  const found = await findPlace(prisma, viewer.character, place, viewer.options);
  if (!found) return Response.json({ error: "You aren't there." }, { status: 403 });

  // Nothing from before the last wipe of THIS place (db/lib/feedWipe.js): a
  // zone summary reads the Dawn watermark, everywhere else the turn one.
  const floor = floorForPlace(await feedWipeFloors(prisma), place);

  // ?around=<seq> — the window either side of one line, for a search hit.
  // Two queries, since "50 below and 50 above, inclusive" is not one findMany.
  const around = params.get("around");
  if (around) {
    const anchor = readSeq(around);
    if (anchor === null) return Response.json({ error: "That isn't a line." }, { status: 400 });
    const base = { placeKey: place, deletedAt: null };
    const [below, above] = await Promise.all([
      prisma.archiveEntry.findMany({
        // Anchor rides in this half, so a hit at the wipe floor still comes back.
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

  // ?before=<seq> — one page further back; same shape/size as the plain page.
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

  // A short page is the end of the road; the client stops asking on this.
  const exhausted = rows.length < HISTORY_ROWS;

  return Response.json({
    place,
    rows: await withAvatarVersions(prisma, rows.reverse()),
    exhausted,
    // Whether the end of the road is a WIPE rather than the start of the place.
    floored: exhausted && floor > 0n,
  });
}
