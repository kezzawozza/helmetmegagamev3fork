import { prisma, Prisma } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors } from "@lifeweb/db/lib/feedWipe";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";

// GET /api/feed/search?q=&place= — what was said, anywhere this viewer can hear it.
// THREE letters, not two — below that a GIN trigram index can't match, and Postgres falls
// back to a full scan. The index, ArchiveEntry_content_trgm_idx, is raw migration SQL only
// (why `prisma migrate diff` keeps proposing to drop it — CLAUDE.md's note); this is a raw
// parameterised query, never concatenated. THE GATE IS THE PLACE LIST: `placesFor` is the
// one answer to "where may you read" (CHAT.md §5a).
export const dynamic = "force-dynamic";

const RESULT_ROWS = 30;
const MIN_QUERY = 3;
const MAX_QUERY = 80;

export async function GET(request) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!viewer.character && !viewer.gm) {
    return Response.json({ error: "You have no living character." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const q = String(params.get("q") ?? "").trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
    return Response.json({ error: "Try a different search." }, { status: 400 });
  }

  const places = await placesFor(prisma, viewer.character, viewer.options);
  const wanted = params.get("place");
  // A named place has to be one of theirs; asking for one that is not is a refusal, not a silent widening.
  const scope = wanted ? places.filter((entry) => entry.placeKey === wanted) : places;
  if (wanted && scope.length === 0) {
    return Response.json({ error: "You aren't there." }, { status: 403 });
  }
  if (scope.length === 0) return Response.json({ rows: [] });

  // Nothing from before the last wipe, the same floors the feed reads (db/lib/feedWipe.js).
  // A zone summary clears on the slower Dawn schedule, so the floor is picked per row below.
  const floors = await feedWipeFloors(prisma);

  // LIKE metacharacters escaped, so % or _ in the query search literally. Backslash is
  // Postgres's default LIKE escape, so no ESCAPE clause is needed.
  const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const keys = Prisma.join(scope.map((entry) => entry.placeKey));

  const rows = await prisma.$queryRaw`
    SELECT ae."seq",
           ae."placeKey",
           ae."characterId",
           ae."characterName",
           ae."concealedAlias",
           ae."presentedAvatarPath",
           ae."content",
           ae."sentAt",
           ae."source",
           ae."editedAt",
           ae."deletedAt"
    FROM "ArchiveEntry" ae
    WHERE ae."placeKey" IN (${keys})
      AND ae."deletedAt" IS NULL
      AND ae."seq" > (CASE WHEN ae."placeKey" LIKE 'zone:%' THEN ${floors.summary} ELSE ${floors.turn} END)
      AND ae."content" ILIKE ${pattern}
    ORDER BY ae."seq" DESC
    LIMIT ${RESULT_ROWS}
  `;

  // The place's NAME, so a hit reads "the Council Room" rather than "room:clx…".
  const nameByKey = new Map(scope.map((entry) => [entry.placeKey, entry.name]));
  const shaped = await withAvatarVersions(prisma, rows);
  return Response.json({
    rows: shaped.map((row) => ({ ...row, placeName: nameByKey.get(row.placeKey) ?? null })),
  });
}
