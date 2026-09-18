import { prisma, feedRowShape } from "@lifeweb/db";
import { sayInPieces } from "@lifeweb/db/lib/say";
import { touchCharacterActivity } from "@lifeweb/db/lib/characterActivity";
import { archiveContextForPlaceKey, parsePlaceKey } from "@lifeweb/db/lib/placeKey";
import { pullMentionedIntoConversation } from "@lifeweb/db/lib/conversations";
import { addThreadMember } from "@lifeweb/db/lib/discordRest";
import { loadFeedCharacter } from "@/lib/feedAccess";
import { roleGroupHue } from "@lifeweb/db/lib/roleGroups";
import { ghostCharacterFor } from "@lifeweb/db/lib/ghost";
import { getGmSession, sendDm } from "@/lib/discordGuild";
import { MENTION_SOURCE } from "@lifeweb/db/lib/dmKinds";
import { oocRejectionDm } from "@lifeweb/db/lib/oocGuard";

// POST /api/feed/say — the web half of the send. Every gate, transform and
// identity decision lives in db/lib/say.js, the one write path the Discord
// proxy runs too; this route is the HTTP shape around it. The row is what it
// writes, and the bot's outbox is what puts it on Discord, so nothing here
// holds a Discord token.
export const dynamic = "force-dynamic";

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request) {
  const { session, inGuild } = await getGmSession();
  if (!session?.discordUserId) return jsonResponse({ error: "Sign in first." }, 401);
  // Left the guild: no voice in Deadchat (or anywhere else) from the web,
  // even from an already-open tab — loadFeedViewer refuses the read side,
  // this refuses the write side. See root CLAUDE.md "Web app auth".
  if (!inGuild) return jsonResponse({ error: "Sign in first." }, 401);

  // A ghost falls through to their last body (db/lib/ghost.js). It resolves to null the moment they
  // have a living character again, so this can never hand somebody two voices — and the place gate
  // below still decides where the voice reaches, which for a ghost is Deadchat and nowhere else.
  let character = await loadFeedCharacter(session.discordUserId);
  let ghost = false;
  if (!character) {
    character = await ghostCharacterFor(prisma, session.discordUserId);
    ghost = Boolean(character);
  }
  if (!character) return jsonResponse({ error: "You have no living character." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "That didn't arrive in one piece." }, 400);
  }

  const place = typeof body?.place === "string" ? body.place : null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : null;
  const content = typeof body?.content === "string" ? body.content : "";

  // The zone name and the thread name are snapshot columns on the row, so
  // /archive can still read them after a resync. Resolved from the place key
  // alone, and shaped to match exactly what the Discord proxy stamps — the
  // same scene must not render two ways depending on which face said it.
  const context = await archiveContextForPlaceKey(prisma, place);

  // The gate is inside sayInPieces — it asks db/lib/feedAccess.js#placesFor,
  // which is also what drew the composer the player typed into, so a Location
  // (scenery, no composer) is refused here too. The character it gates on is
  // the session's, never the request's.
  const said = await sayInPieces(prisma, {
    character,
    placeKey: place,
    content,
    source: "WEB",
    ghost,
    zoneId: context.zoneId,
    zoneName: context.zoneName,
    channelKind: context.channelKind,
    threadName: context.threadName,
    // Carried through the write and out on the NOTIFY, so the stream's copy
    // of this row lands in the sending tab as the row it already drew.
    clientId,
  });

  if (!said.ok) {
    // Nothing was posted, so the words only exist in the composer the player is
    // about to lose. The DM hands them back (db/lib/oocGuard.js). Never allowed
    // to fail the response: the refusal is the answer either way.
    if (said.oocRejected) {
      await sendDm(session.discordUserId, oocRejectionDm(said.original ?? content)).catch((err) =>
        console.error("OOC rejection DM failed:", err?.message ?? err),
      );
    }
    // A slowmode refusal is the only one with a clock on it, and the composer
    // shows the seconds rather than a flat "no".
    const status = said.retryAfter ? 429 : 403;
    return jsonResponse({ error: said.refusal, retryAfter: said.retryAfter ?? null }, status);
  }

  // Not for a ghost: this feeds the inactivity report (db:report-inactive-characters), which is
  // about players who have stopped playing a LIVING character. A corpse that chats every day is not
  // the thing that report is looking for.
  if (!ghost) await touchCharacterActivity(prisma, character.id).catch(() => {});

  // Pinging somebody in a conversation puts them in it, the way Discord does
  // when you @ a stranger in a thread. Only here, on the web path: a mention
  // typed into Discord is already handled by Discord itself.
  //
  // AFTER the row is written, never before, and never able to fail the send —
  // the words are the point, and a Discord hiccup must not cost them.
  //
  // Never from Deadchat. `pullIntoConversation` no-ops on a non-conv: key anyway, but a ghost
  // @-ing a living player into a thread would be the dead reaching into the world, which is the one
  // thing this seat must not do — so it is refused by name rather than by accident.
  if (!ghost) {
    await pullIntoConversation(character, place, said.rows.map((r) => r.content).join("\n") || content).catch((err) =>
      console.error("Mention thread-add failed:", err?.message ?? err),
    );
  }

  // The FIRST row is the one the sending tab already drew, so it is the one
  // that comes back — it carries the clientId and replaces the pending twin.
  // Any pieces after it arrive on the stream like anybody else's message.
  // `pieces` is only so the composer can say what happened.
  return jsonResponse({
    row: feedRowShape(said.rows[0], {
      clientId,
      avatarVersion: character.updatedAt?.getTime?.() ?? null,
      roleGroup: roleGroupHue(character.role?.groupSlug),
    }),
    pieces: said.pieces,
  });
}

// The membership rows are written in db/lib (returned-side-effects, so the
// same helper serves either face); what is left here is the Discord half and
// the DM, with the REST client this face holds.
async function pullIntoConversation(character, placeKey, content) {
  const parsed = parsePlaceKey(placeKey);
  if (parsed?.kind !== "conv") return;

  const conversation = await prisma.playerThread.findUnique({
    where: { id: parsed.id },
    select: { id: true, threadId: true, name: true, locationId: true, location: { select: { name: true } } },
  });
  if (!conversation) return;

  const added = await pullMentionedIntoConversation(prisma, {
    conversation,
    content,
    speakerId: character.id,
  });

  const where = conversation.location?.name ?? "somewhere";
  for (const target of added) {
    // A character not mirrored to Discord is out of every Discord channel on
    // purpose (CHAT.md §6), and somebody standing elsewhere gets the invite
    // row instead — it replays when they reach the Location.
    if (
      conversation.threadId &&
      target.locationId === conversation.locationId &&
      target.discordMirrored &&
      target.discordUserId
    ) {
      await addThreadMember(conversation.threadId, target.discordUserId).catch(() => {});
    }
    // The web's sendDm (REST, and it logs the row) — CLAUDE.md's three
    // sendDm signatures, one per calling context.
    // MENTION_SOURCE, the same tag bot/src/lib/mentions.js puts on its relay.
    // `kind` decides how much of the inbox it gets (NOTICE, by sendDm's
    // default) and `source` decides how it is DRAWN — DmThread renders a
    // mention row differently, and dmThread.js filters on it. Orthogonal, and
    // both wanted here. It lives in dmKinds.js now, not the old dmSources.js.
    await sendDm(target.discordUserId, `*You were named in ${where} · ${conversation.name}.*`, {
      source: MENTION_SOURCE,
    }).catch(() => {});
  }
}
