import { redirect } from "next/navigation";
import { prisma, FEED_ROW_SELECT } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors, floorForPlace, seqFilterAbove } from "@lifeweb/db/lib/feedWipe";
import { loadForcedName, loadConcealment, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import ChatView from "./ChatView";
import Loading from "./Skeleton";
import { affordancesFor } from "@lifeweb/db/lib/placeAffordances";
import { whosHere, hoodToken } from "@lifeweb/db/lib/whosHere";
import { loadMentionDirectory } from "@/lib/mentionDirectory";
import { examineLines } from "@lifeweb/db/lib/examineLocation";
import { hasNoticeboard } from "@lifeweb/db/lib/noticeboard";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { canDetectPoison } from "@lifeweb/db/lib/poison";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";
import { loadNavItems } from "@/lib/navItems";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import { loadPeoplePools, loadStashRooms } from "@/lib/peoplePools";
import { HEAL_SKILL_SELECT } from "@/lib/healRequests";
import { waitingOnYou, myMove } from "./actions";
import { loadDesireView, loadLettersView, loadFactionView } from "@/lib/selfPools";
import { withoutDmNoise } from "@/lib/dmThread";
import { DM_PLACE_KEY } from "@/lib/dmSources";
import { thingGroups } from "./thingRows";
import { hasAttribute, GODFLESH_ATTRIBUTE } from "@lifeweb/db/lib/locationAttributes";
import { extractToolFor, extractedToday } from "@lifeweb/db/lib/godflesh";
import { MERCHANT_LICENSE_SLUG, DEPOT_LOCATION_SLUG, DEPOT_KEYCARD_SLUG } from "@lifeweb/db";
import { cookedTasteOnly, DESIRE_UNLOCK_SELECT } from "@/lib/referenceData";
import { chipContextFor, composeChipTag } from "@/lib/tagChipRows";
import {
  RESEARCH_TAG_SLUG,
  CATHEDRAL_LOCATION_SLUG,
  loadResearchCatalog,
  researchableHeld,
} from "@lifeweb/db/lib/research";

// /chat — Chat. Three columns on a desktop, one on a phone: everywhere
// this character can hear on the left, the open scene in the middle, and (in
// phase 3) the people standing there on the right.
//
// The first place's rows are rendered on the server so the page has something
// to show before any JavaScript runs; every other place is fetched when the
// reader opens it, and everything after that arrives on the one SSE stream
// Chat.js holds.
//
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page itself only reads the
// session, mounts the shell, and streams FreshChat in behind it. A browser
// that has been here before paints its last Chat in the first frame and the
// stream catches it up from the stored seq; the fresh props then re-seed it.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;

export default async function PlayPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage
      scope="play"
      userId={session.discordUserId}
      render={ChatView}
      fallback={<Loading />}
      remountOnFresh={false}
    >
      <Suspense fallback={null}>
        <FreshChat userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

// The whole load, ending in one serialisable object for ChatView. Every
// prop below used to be a JSX attribute on <Chat> or <RequestActionsProvider>
// right here; the names are unchanged.
async function FreshChat({ userId }) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) redirect("/");

  // Chat switch on /gm/dev (GameConfig.playPanelEnabled). GMs bounce too:
  // a GM watching a scene has the desk's Scene tab, and off means off. The
  // whole row is read once here; the composer and the aside take theirs off
  // it below.
  const gameConfig = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (gameConfig && !gameConfig.playPanelEnabled) redirect("/character");

  // No living character, and not a GM: they still get Bascinet's column. The
  // DM thread is the account's, not the body's (./actions.js#gmThread), and
  // for a web-only player it is the ONLY place a seat offer or any other bot
  // message can be read at all — Discord is not an option they have. This used
  // to return `empty` and draw a dead page.
  if (!viewer.character && !viewer.gm) {
    return (
      <SnapshotFresh
        scope="play"
        userId={userId}
        data={{
          kind: "dm",
          chat: {
            initialPlaces: [],
            initialPlace: DM_PLACE_KEY,
            initialRows: [],
            initialSeq: "0",
            self: { characterId: null, discordUserId: viewer.discordUserId, name: null, speakerKey: null },
            aside: null,
            navItems: (await loadNavItems(viewer.discordUserId)).map(({ href, label, icon }) => ({ href, label, icon })),
          },
        }}
      />
    );
  }

  const places = await placesFor(prisma, viewer.character, viewer.options);
  const first = places[0] ?? null;

  // The "Zones I see" picker, at the foot of the right column. A GM reading
  // Chat is reading the zones they hold, so the control that decides that
  // belongs on the page rather than three clicks away on a desk — it is the
  // same control the GM desks carry, writing the same GmZoneView rows. Nobody
  // else has one: a player's places come from where they are standing.
  const gmZones = viewer.gm
    ? await (async () => {
        const [visible, selectable] = await Promise.all([getVisibleZones(), listSelectableZones()]);
        return { selectable, selectedIds: visible?.map((zone) => zone.id) ?? [] };
      })()
    : null;

  if (!first) {
    return <SnapshotFresh scope="play" userId={userId} data={{ kind: "nowhere" }} />;
  }

  // The cursor the stream opens with is the newest seq in the GAME at render
  // time, not the newest in this place. The catch-up then carries exactly what
  // happened while the page was loading, across every place at once — asking
  // from this place's own newest would have replayed every other place's whole
  // backlog down the stream.
  // The wipe watermarks, read before the rows so the first paint and the
  // stream's catch-up agree about where the day starts (db/lib/feedWipe.js).
  // Two of them: a zone summary clears at Dawn, everywhere else every turn.
  const floors = await feedWipeFloors(prisma);
  const floor = floorForPlace(floors, first.placeKey);

  // The rail's own item list, for the foot of the phone's places drawer —
  // the bottom bar is hidden on /chat there (Chat.js). Only href, label and
  // icon go down: the badge is the GM inbox's, and the drawer has no room
  // for a number nobody asked for.
  const navItemsPromise = loadNavItems(viewer.discordUserId).then((items) =>
    items.map(({ href, label, icon }) => ({ href, label, icon })),
  );
  const [rows, watermark, forcedName, concealment] = await Promise.all([
    prisma.archiveEntry.findMany({
      where: { placeKey: first.placeKey, deletedAt: null, seq: seqFilterAbove(floor) },
      orderBy: { seq: "desc" },
      take: HISTORY_ROWS,
      select: FEED_ROW_SELECT,
    }),
    prisma.archiveEntry.aggregate({ _max: { seq: true } }),
    viewer.character ? loadForcedName(prisma, viewer.character.id) : null,
    viewer.character ? loadConcealment(prisma, viewer.character.id) : null,
  ]);

  // The first paint's rows, with ONE `?v=` per character rather than the
  // per-row sentAt fallback — otherwise every line asked for the same face at
  // a different URL (db/lib/archive.js#withAvatarVersions).
  const initialRows = await withAvatarVersions(prisma, rows.reverse());

  // The name this character's own optimistic rows wear before the server
  // answers — forced beats concealed beats their own, the same resolution the
  // send route does, so an optimistic row never shows a name the confirmed
  // one will not.
  const identity = viewer.character
    ? presentedIdentity(viewer.character, { forcedName, concealment })
    : { name: null };

  // The right column. Everything in it is a fact about where this character
  // is standing, so it is loaded here and re-checked by every action the
  // panels call — a disabled button is a hint, never a lock.
  //
  // A GM watching a zone has no character, and therefore nothing to stand in,
  // nobody to act on and no Move to file. They get the feed and no column.
  const aside = viewer.character
    ? await (async () => {
        // The sheet FIRST. The viewer loader is shared with every feed route
        // and selects no tags, but the people pools, the affordances and the
        // carry line all read character.tags (and the role, for the gate) —
        // the page once handed them the bare viewer and fell over on the
        // first living character it met.
        const [sheet, openTurn] = await Promise.all([
          prisma.character.findUnique({
            where: { id: viewer.character.id },
            select: {
              resources: true,
              // `id` is the CharacterTag row, which is what an equip toggle
              // acts on; the Things drawer is the only thing here that needs
              // one (./thingRows.js). `equippedQuantity` alongside `equipped`
              // — a slot holds one physical unit, not a stack, and thingRows.js
              // reads the count to know how many of a holding are still free to
              // equip and how many are already out to put back.
              // `tag.group` rides along for researchableHeld's `group`-kind
              // ingredient entries (a held corpse, matched by GROUP rather
              // than slug) — nothing else here read it before Research did.
              // `poisonedCount`/`poisonPayload` (M4) are read here ONLY to
              // derive `poisonMarker` below — they are stripped from
              // `clientSheet` before it crosses into a client component, the
              // same leak point character/page.js's own comment explains.
              tags: {
                select: {
                  id: true,
                  tagId: true,
                  quantity: true,
                  equipped: true,
                  equippedQuantity: true,
                  // What the chip's duration badge counts down — the status
                  // strip draws the same "2t"/"last" the sheet's chips do, and
                  // without this every expiring affliction reads as permanent.
                  expiresTurn: true,
                  poisonedCount: true,
                  poisonPayload: true,
                  // requirementSkills named explicitly for the same reason
                  // the sheet's own query names it (character/page.js): these
                  // rows are the SELF patient in loadPeoplePools' heal roster,
                  // and `include` does not pull an unnamed relation — without
                  // it every cure here reads as Routine, above-tier ones
                  // included, which is the wrong direction to be silent in.
                  // The relations named here are the ones TAG_CHIP_FIELDS
                  // names, because the Things drawer draws these rows as the
                  // app's real tag chips now (web/lib/tagChipRows.js) and an
                  // `include` pulls no unnamed relation. `group` is the chip's
                  // full group — its COLOUR is the chip's left border, and a
                  // slug-only group silently drew every chip grey — and it is
                  // still what researchableHeld matches a held corpse on.
                  tag: {
                    include: {
                      group: {
                        select: {
                          slug: true,
                          name: true,
                          color: true,
                          requiredTagId: true,
                          requiredTag: { select: { name: true } },
                        },
                      },
                      requiredTag: { select: { name: true } },
                      requirementSkills: { select: HEAL_SKILL_SELECT },
                      ...DESIRE_UNLOCK_SELECT,
                    },
                  },
                },
              },
              role: { select: { slug: true } },
              // Which in-game DAY the bird last left on, and how many of that
              // day's flights are spent — a Rookery is worth several
              // (db/lib/rookery.js). (docs/systemdocs/PAPERWORK.md §Bird.)
              birdTurnId: true,
              birdDaySends: true,
              // Which in-game DAY they last cut Godflesh. Extract costs no
              // Move, so this is its whole cooldown (FACTORY.md §3).
              extractDayKey: true,
            },
          }),
          prisma.turn.findFirst({
            where: { status: "OPEN" },
            // `number` for the Desire gates and the turn card's label,
            // `startedAt` for the Move window (db/lib/turnClock.js).
            select: { id: true, number: true, phase: true, startedAt: true },
          }),
        ]);
        const character = { ...viewer.character, ...sheet };
        const heldSlugs = new Set((sheet?.tags ?? []).map((ct) => ct.tag.slug));
        // The sheet crosses into client components from here, so the raw text
        // of every paper on it would otherwise sit in the page source —
        // readable straight out of DevTools by a holder who is blind, drunk or
        // illiterate, which is the one thing the whole paperwork system exists
        // to prevent (character/page.js strips it the same way). The dialogs
        // fetch the text on demand instead.
        //
        // `poisonedCount`/`poisonPayload` (M4, detector-surface fix round) get
        // the same treatment as the sheet page: stripped raw, replaced with a
        // plain `poisonMarker` yes/no gated on canDetectPoison — this is the
        // Things drawer's own detection surface (the sheet's own is
        // character/page.js), so the two can no longer disagree about
        // whether a viewer smells anything.
        //
        // The same cut is made for cooking (docs/systemdocs/COOKING.md), and
        // for the same reason: this select is a bare `include` on Tag, so it
        // takes `cooked` and `cookedFrom` whole. A cook is told what an
        // ingredient tastes of and nothing else, and a dish never says what
        // it was made with. cookedTasteOnly runs FIRST, so everything below
        // is working on the already-narrowed tag.
        const canSmellPoison = canDetectPoison(sheet?.tags ?? []);
        // The reader the Things drawer's chips are composed for: their own
        // held tags and their own eyes, so a letter in a pocket shows its
        // words to a literate holder and a refusal to everybody else. This is
        // also the pass that drops `paperText` and the raw `sellablePrice` —
        // structurally, in tagChipRows.js, rather than by a strip below.
        const chipCtx = await chipContextFor({
          ...character,
          location: { indoors: viewer.character.location?.indoors ?? true },
        });
        const clientSheet = {
          ...sheet,
          tags: (sheet?.tags ?? []).map((ct) => {
            const { poisonedCount, poisonPayload, ...ctRest } = ct;
            const cut = cookedTasteOnly(ctRest.tag);
            // Crate-manifest leak (fix round M4b, fix 1): same nested-Tag
            // gap as character/page.js's own strip — `ct.tag.crateContents`
            // carries per-line poisonedCount/poisonPayload for a
            // player-packed crate, and `tag: true` above hands back the
            // whole row with nothing stripped yet.
            const { crateContents, ...tagRest } = cut ?? {};
            const stripped = {
              ...ctRest,
              // The manifest goes, but WHETHER this is a crate has to survive it: the
              // Consume dialog suppresses its "Becomes:" line for a crate, and Package
              // refuses to pack one, and both ask on the client.
              tag: ctRest.tag ? { ...tagRest, crate: Boolean(crateContents) } : ctRest.tag,
              poisonMarker: canSmellPoison && (poisonedCount ?? 0) > 0,
            };
            if (stripped.tag?.paperText == null) return stripped;
            const { paperText, ...tag } = stripped.tag;
            return { ...stripped, tag };
          }),
        };

        const [people, affordances, examine, waiting, pools, stashRooms, mine, desires, letters, boardLocation, researchCatalog] = await Promise.all([
          whosHere(prisma, character, { withSightings: true, withAcross: true }),
          affordancesFor(prisma, character),
          // What Examine used to answer in a modal. It is the place card's
          // body now, rendered on the server with the rest of the column —
          // db/lib/examineLocation.js is the same composer the Discord
          // anchor's Examine button reads from.
          character.locationId ? examineLines(prisma, character.locationId) : null,
          waitingOnYou(),
          // The people dialogs the sheet has, over the same pools the sheet
          // builds (web/lib/peoplePools.js) so the two cannot disagree about
          // who is standing near you.
          loadPeoplePools(character, { discordUserId: viewer.discordUserId, openTurn }),
          // The rooms a Transfer can reach, so "Move things" in a room can
          // hand the dialog its far side already picked.
          loadStashRooms(character),
          // The turn card's first paint: which turn is open, whether Moves
          // have locked, and the Move already filed into it. The same server
          // action the column re-polls, so the two answers cannot differ.
          myMove(),
          // The Desire SLOTS only — the ~271-template catalog behind the
          // picker is fetched when somebody opens it (web/lib/selfPools.js).
          loadDesireView(character, { openTurn, gameConfig, withCatalog: false }),
          // Write, Seal, Bind a book and the Bird, behind the ✉ beside the
          // composer. The SAME loader the sheet calls, so the two surfaces
          // cannot disagree about whether this character can write
          // (web/lib/selfPools.js).
          loadLettersView(character, { openTurn }),
          // Is there a board on this street? One attribute, and it decides
          // whether the Location's feed carries the notice cards at its top
          // (db/lib/noticeboard.js). The cards load themselves; this only
          // says whether to draw them at all.
          character.locationId
            ? prisma.location.findUnique({
                where: { id: character.locationId },
                // `slug` for the Depot, `attributes` for the noticeboard and
                // the Factory's godflesh.
                select: { slug: true, attributes: true },
              })
            : null,
          // The Research picker's held-ingredients shortlist
          // (researchableHeld) needs the craftable catalog it's checked
          // against — the same call requestActions.js#researchRequestImpl
          // makes, so the menu and the server's own re-check can't drift.
          loadResearchCatalog(prisma),
        ]);
        return {
          people,
          affordances,
          place: viewer.character.location ?? null,
          zone: viewer.character.location?.zone ?? null,
          placeLines: examine?.ok ? examine.lines : [],
          waiting: waiting.ok ? waiting.rows : [],
          selfId: character.id,
          pools,
          stashRooms,
          sheet: clientSheet,
          // What this character is carrying against their cap — the Transfer
          // dialog projects a hand-over off both.
          carry: carryStatus(character, gameConfig),
          hasBoard: hasNoticeboard(boardLocation),
          turn: mine.ok ? mine.turn : null,
          move: mine.ok ? mine.move : null,
          // Seeded alongside the Move so the dialog can key its unfiled draft
          // on the first paint rather than waiting out a poll.
          moveCharacterId: mine.ok ? mine.characterId : null,
          desires,
          letters,
          // What is in this character's pockets, for the Things drawer under
          // YOU. The drawer re-reads it for itself after every verb
          // (./actions.js#myThings).
          things: thingGroups(sheet?.tags ?? [], (tag) => composeChipTag(tag, chipCtx)),
          // The Depot terminal is a thing in a room: standing at it is not
          // enough, you need the licence or the keycard, and /depot bounces
          // anybody without one — so the link is offered only where it would
          // open (web/app/(app)/depot/page.js).
          depotHref:
            boardLocation?.slug === DEPOT_LOCATION_SLUG &&
            (heldSlugs.has(MERCHANT_LICENSE_SLUG) || heldSlugs.has(DEPOT_KEYCARD_SLUG))
              ? "/depot"
              : null,
          // The Godard Factory's Extract, opened as the sheet's own dialog
          // (docs/systemdocs/FACTORY.md). Shown where the ground is godflesh;
          // whether there is a tool in hand is the dialog's sentence, not a
          // reason to hide the button.
          canSeeExtract: hasAttribute(boardLocation, GODFLESH_ATTRIBUTE),
          canExtract:
            Boolean(extractToolFor(sheet?.tags ?? [])) && !extractedToday(sheet, openTurn),
          // Two reasons the button can grey, and having already cut today is
          // the one that outranks the tool — telling somebody to go find a
          // hatchet they cannot use until tomorrow is the wrong sentence.
          extractBlocked: !hasAttribute(boardLocation, GODFLESH_ATTRIBUTE)
            ? null
            : extractedToday(sheet, openTurn)
              ? "You already harvested Godflesh today."
              : !extractToolFor(sheet?.tags ?? [])
                ? "You need a hatchet, a battle-axe or a chainsaw in your hands."
                : null,
          // Research (CRAFTING.md §2b): the Cathedral's own
          // place-card button, alongside the sheet's Research tag chip.
          // `atCathedral` is a fact about the ground, same posture as
          // `depotHref`/`canSeeExtract` above; `holdsResearch` and the
          // shortlist are facts about this character's own sheet.
          holdsResearch: heldSlugs.has(RESEARCH_TAG_SLUG),
          atCathedral: boardLocation?.slug === CATHEDRAL_LOCATION_SLUG,
          researchOptions: researchableHeld(character.tags, researchCatalog).map((ct) => ({
            slug: ct.tag.slug,
            name: ct.tag.name,
          })),
        };
      })()
    : null;

  // The faction, for the ⚑ row at the foot of the places column. The SAME
  // loaders /faction runs (web/lib/factionView.js), so the two surfaces cannot
  // disagree about the roster — and a member's ⬢ is on the rows only for that
  // faction's own Leader or Treasurer (FACTIONS.md §6).
  const factionView = viewer.character
    ? await loadFactionView({ discordUserId: viewer.discordUserId }, viewer.character)
    : null;

  // The newest thing Bascinet said to this player, for the Messages row's
  // unread dot before the pane has ever been opened (./DmPane.js, CHAT.md
  // §2b). Through the player chair's noise filter, so a mention relay lights
  // the dot the way any other word from Bascinet does.
  const newestDm = viewer.character
    ? await prisma.directMessage.findFirst({
        where: withoutDmNoise(
          { discordUserId: viewer.discordUserId, direction: "OUTBOUND" },
          { perspective: "player" },
        ),
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
    : null;

  // Is there an instant camera in this character's hands? One slug off the
  // sheet already loaded above (db/lib/photoMint.js#CAMERA_SLUG), so the row
  // action bar can decide whether to draw the 📷 without a second query.
  const hasCamera = (aside?.sheet?.tags ?? []).some(
    (entry) => entry.tag?.slug === "instant-camera" && (entry.quantity ?? 0) > 0,
  );

  // The @ list, and the lookup a {char:…} in a row resolves against — one
  // roster for both, so a mention can only ever name somebody the writer could
  // see and only ever render for a reader who could see them too. Concealed
  // people are deliberately absent: whosHere() puts them in `concealed`, which
  // carries an alias and no id.
  const mentionRoster = (aside?.people?.named ?? []).map((person) => ({
    id: person.characterId,
    name: person.name,
    updatedAt: person.avatarVersion,
    avatarPath: person.avatarPath ?? null,
  }));

  // And the wider list a token RESOLVES against, which is not the same
  // question — see web/lib/mentionDirectory.js. A ping arriving from Discord
  // can name anybody in the guild, so the roster above could never resolve
  // half of them and the line printed a raw cuid instead of a person.
  const mentionDirectory = await loadMentionDirectory();

  const chat = {
    initialPlaces: places,
    initialPlace: first.placeKey,
    initialRows,
    initialSeq: watermark._max.seq === null ? "0" : String(watermark._max.seq),
    self: {
      characterId: viewer.character?.id ?? null,
      // What the Bascinet row in the places column is gated on — the account,
      // not the character (./Chat.js).
      discordUserId: viewer.discordUserId,
      name: identity.name,
      avatarVersion: viewer.character?.updatedAt?.getTime?.() ?? null,
      // And the face, on the same gate db/lib/say.js#recordSpeech uses — a
      // path only when the room is not seeing their own — so an optimistic row
      // never wears a face the confirmed one will not.
      avatarPath: identity.alias ? identity.avatarPath : null,
      // Whether this character's own sends go out under an alias at all —
      // a hood or a forced name. The optimistic row shapes itself the way
      // db/lib/archive.js#feedRowShape will shape the confirmed one.
      aliased: Boolean(identity.alias),
      // How this reader recognises their OWN aliased lines. A hooded row ships
      // no character id to anybody (db/lib/archive.js#feedRowShape), so
      // without this a player could not see which lines in the scene were
      // theirs to take back. Learning your own token tells you nothing — it is
      // the one hood you were already under.
      speakerKey: viewer.character ? hoodToken(viewer.character.id) : null,
    },
    aside,
    // What the server will do to the words on their way in, so the row the
    // composer draws in the same frame says what the confirmed one will say
    // (db/lib/say.js#transformSpeech).
    autocorrect: Boolean(gameConfig?.tupperAutocorrectEnabled),
    webOnly: Boolean(viewer.character?.webOnly),
    roster: mentionRoster,
    // A GM with no living character reads every zone they may see and may
    // take a line down (web/app/api/feed/delete/route.js).
    gm: Boolean(viewer.gm),
    gmZones,
    // The 📷 on somebody else's line, only for a character actually
    // carrying one. photographRow() re-checks the sheet, so this is the
    // hint and never the lock.
    hasCamera,
    // The ✉ beside the composer, and the hood next to it. `canConceal` is
    // db/lib/conceal.js's own three refusals asked in advance: a forced name
    // has nothing to hide, a bare face has nothing to toggle, and something
    // that FORCES a hood does not come off by asking. toggleConceal re-asks
    // all three.
    letters: aside?.letters
      ? {
          canWrite: aside.letters.canWrite,
          canSeal: aside.letters.canSeal,
          hasBird: aside.letters.hasBird,
          birdSentToday: aside.letters.birdSentToday,
          // Replying needs no bird of your own — the one that brought the
          // letter takes the answer — so this is its own line rather than
          // something hung off hasBird.
          hasBirdReply: (aside.letters.birdReplies ?? []).length > 0,
        }
      : null,
    faction: factionView,
    dmNewestMs: newestDm?.createdAt?.getTime?.() ?? null,
    navItems: await navItemsPromise,
    conceal: {
      canConceal: Boolean(concealment) && !concealment.forced && !forcedName,
      concealed: Boolean(identity.concealed),
      alias: identity.alias ?? null,
    },
  };

  // Look at, Heal, Transfer, Loot, Bind, Free, Harm and Move Player are the
  // SHEET's dialogs, mounted over the same pools rather than rebuilt (in
  // ChatView). Only the people half is handed down: the rest of the sheet's
  // pools — craft, paper, the bird, the Factory — belong to the sheet, and
  // ActionGrid is not mounted here at all.
  const providers = aside
    ? {
        selfId: viewer.character.id,
        selfName: viewer.character.name,
        characterTags: aside.sheet?.tags ?? [],
        resources: aside.sheet?.resources ?? 0,
        carry: aside.carry,
        examineBlocked: aside.pools.examineBlocked,
        canHeal: aside.pools.canHeal,
        healsLeft: aside.pools.healsLeft,
        hasSurgicalSite: aside.pools.hasSurgicalSite,
        surgicalSitePenalty: aside.pools.surgicalSitePenalty,
        healTargets: aside.pools.healTargets,
        healParties: { characters: aside.pools.peopleParties, rooms: [] },
        transferParties: { characters: aside.pools.transferParties, rooms: aside.stashRooms },
        lootTargets: aside.pools.lootTargets,
        consumeTargets: aside.pools.consumeTargets,
        bindTargets: aside.pools.bindTargets,
        harmTargets: aside.pools.harmTargets,
        harmTags: aside.pools.harmTags,
        kissTargets: aside.pools.kissTargets,
        kissBlocked: aside.pools.kissBlocked,
        // The four paperwork dialogs the ✉ opens, named exactly as
        // web/lib/selfPools.js returns them.
        ...aside.letters,
        // Extract, from the place card's Factory button.
        canSeeExtract: aside.canSeeExtract,
        canExtract: aside.canExtract,
        extractBlocked: aside.extractBlocked,
        // Research: the sheet's Research row AND the place card's Cathedral
        // button both read the provider's composed canResearch/researchHint,
        // which is built off these three and the Move below.
        holdsResearch: aside.holdsResearch,
        atCathedral: aside.atCathedral,
        researchOptions: aside.researchOptions,
        // Whether this turn's Move is already filed — the same
        // `Boolean(action)` the sheet passes (character/page.js). Advisory
        // either way: requireFreeMove re-reads it.
        hasMoved: Boolean(aside.move),
      }
    : null;

  return (
    <SnapshotFresh
      scope="play"
      userId={userId}
      data={{ kind: "chat", chat, providers, roster: mentionRoster, mentionDirectory }}
    />
  );
}
