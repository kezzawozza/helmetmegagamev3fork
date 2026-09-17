import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import NotesView from "./NotesView";
import Loading from "./Skeleton";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { loadMentionDirectory, loadOfferableMentions } from "@/lib/mentionDirectory";

// Notes are personal — a player's own Journal and their own list of messages
// they've starred, never a shared/GM view. Each signed-in user only ever
// sees rows keyed to their own discordUserId. See docs/systemdocs/
// PROXYING.md §7 for the Starred half's full history, and this file's own
// comments below for the two disclosure rules the Journal half has to obey.
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshNotes in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function NotesPage() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="notes" userId={session.discordUserId} render={NotesView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshNotes />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshNotes() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  const [notes, journalEntries, roster, directory, openTurn] = await Promise.all([
    prisma.note.findMany({
      where: { discordUserId: session.discordUserId },
      orderBy: { sentAt: "desc" },
      include: { zone: { select: { name: true } }, character: { select: { name: true } } },
    }),
    prisma.journalEntry.findMany({
      where: { discordUserId: session.discordUserId },
      orderBy: { updatedAt: "desc" },
    }),
    // Two rosters, because offering a name and resolving one are different
    // questions (web/lib/mentionDirectory.js has the whole argument).
    //
    //   offerable — the composer's autocomplete. Anybody presenting as
    //               somebody else is left out: being offered a name to type is
    //               a live act, and a hooded character must not be in it.
    //   directory — what a saved {char:<id>} draws its FACE against. Everybody,
    //               and deliberately blind to hoods, or the little portrait
    //               beside an old entry would wink out whenever its subject
    //               masked up somewhere and come back when they stopped.
    //
    // (The NAME comes off the token itself either way, frozen at the moment it
    // was written — db/lib/characterMentions.js.)
    //
    // It keeps a buried character's death from leaking by omission
    // (CHARACTERS.md §5) — a dead-and-buried character is simply absent, like
    // every other roster in the app.
    //
    // Both come out of the shared module rather than a findMany here. This
    // page used to roll its own, with NO concealment filter at all, so a
    // hooded or disguised character was offered by name in the autocomplete —
    // while /chat, one directory over, withheld them. The forced/concealed
    // rule has three cases and a precedence order, and the second copy of it
    // is always the one that never got written.
    loadOfferableMentions({ includeUnburiedDead: true }),
    loadMentionDirectory({ includeUnburiedDead: true }),
    getOpenTurn(),
  ]);

  const starred = notes.map((n) => ({
    id: n.id,
    characterName: n.characterName,
    // A concealed message was filed under its alias (see
    // bot/src/events/messageReactionAdd.js#handleStarReaction), which stores
    // characterId unconditionally even though characterName becomes the
    // alias. Rendering a face from that id would hand the starrer the identity
    // the concealment was hiding.
    //
    // The face the room actually SAW is recorded now
    // (Note.presentedAvatarPath), so an aliased note draws the mask or plaque
    // it was heard under and never asks /api/avatar at all. The name
    // comparison behind it is the fallback for notes taken before that column
    // existed: it fails safe in both directions, since a merely-renamed
    // character loses its face here rather than gaining somebody else's — and
    // when it does fail, the plate says so instead of the wrong person.
    avatarPath: n.presentedAvatarPath ?? null,
    characterId:
      !n.presentedAvatarPath && n.character && n.character.name === n.characterName ? n.characterId : null,
    unknownFace: !n.presentedAvatarPath && !(n.character && n.character.name === n.characterName),
    zoneName: n.zone?.name ?? null,
    content: n.content,
    sentAt: n.sentAt.toISOString(),
    // Numeric twin of sentAt, so the shared table state sorts on a number
    // rather than re-parsing a date string per comparison.
    sentAtMs: n.sentAt.getTime(),
  }));

  const journal = journalEntries.map((e) => ({
    id: e.id,
    title: e.title,
    body: e.body,
    pinned: e.pinned,
    turnNumber: e.turnNumber,
    labels: e.labels,
    updatedAt: e.updatedAt.toISOString(),
    updatedAtMs: e.updatedAt.getTime(),
  }));

  // Already the shape the provider wants — both loaders stamp updatedAt as a
  // number so nothing on this page has to remember to.
  return (
    <SnapshotFresh
      scope="notes"
      userId={session.discordUserId}
      data={{
        starred: starred,
        journal: journal,
        roster: roster,
        directory: directory,
        currentTurnNumber: openTurn?.number ?? null,
      }}
    />
  );
}
