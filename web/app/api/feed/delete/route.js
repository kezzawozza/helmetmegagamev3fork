import { prisma } from "@lifeweb/db";
import { deleteSpeech } from "@lifeweb/db/lib/say";
import { loadFeedViewer } from "@/lib/feedAccess";

// POST /api/feed/delete { seq } — take back something you said, inside the
// five-minute window. Soft: the row stays with a `deletedAt` so a browser
// holding it can reconcile and the outbox has something to read when it goes
// to remove the Discord message.
//
// TWO CALLERS, and the difference is who is asking rather than anything in the
// body. A player takes back their OWN line inside the window. A GM with no
// living character removes ANY line, which is db/lib/say.js#deleteSpeech's
// `{ gm: true }` — the same flag the ✏️/❌ reactions pass on Discord — and
// leaves a row in AuditLog, because a line vanishing from a scene is exactly
// the kind of thing somebody later has to be able to ask "who did that?"
// about. WHICH of the two a GM is depends on the seat they are reading from,
// and loadFeedViewer is the only thing that decides it — their own character's
// scene, or the watcher's view of every zone (web/lib/viewAs.js). This route
// used to answer that question itself, with `character ? false : isGm`, so a
// GM who flipped to the GM seat got the Remove button and then a refusal from
// here. One decision, one place.
export const dynamic = "force-dynamic";

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request) {
  const { discordUserId, character, gm } = await loadFeedViewer();
  if (!discordUserId) return jsonResponse({ error: "Sign in first." }, 401);
  if (!character && !gm) return jsonResponse({ error: "You have no living character." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "That didn't arrive in one piece." }, 400);
  }

  const seq = typeof body?.seq === "string" || typeof body?.seq === "number" ? String(body.seq) : null;

  const result = await deleteSpeech(prisma, { characterId: character?.id ?? null, seq, gm });
  if (!result?.ok) return jsonResponse({ error: result?.refusal ?? "That didn't go." }, 403);

  if (gm) {
    // Best-effort, and after the removal: a failed log must never leave the
    // line standing when a GM has already been told it went.
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "gm_feed_remove",
          targetCharacterId: result.row.characterId ?? null,
          details: { seq: String(result.row.seq), placeKey: result.row.placeKey ?? null },
        },
      })
      .catch((err) => console.error("GM feed removal audit failed:", err));
  }

  return jsonResponse({
    seq: String(result.row.seq),
    deletedAt: result.row.deletedAt ? new Date(result.row.deletedAt).toISOString() : null,
  });
}
