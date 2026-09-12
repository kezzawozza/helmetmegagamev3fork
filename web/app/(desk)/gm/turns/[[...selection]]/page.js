import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import TurnsView from "./TurnsView";
import Loading from "../Skeleton";
import { prisma } from "@lifeweb/db";
import { getGmProfiles } from "@/lib/gmProfiles";
import { getOpenTurn } from "@/lib/turn";
import { turnEndsAt } from "@lifeweb/db/lib/turnClock";
import { avatarReviewWhere } from "@lifeweb/db/lib/avatarReview";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";
import { deployVersion } from "@/lib/deployVersion";
import { turnsSelectionHref } from "@/lib/routes";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  AVATAR_REVIEW_SELECT,
  moveRow,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
  avatarReviewRow,
  tagsByIdFor,
} from "@/lib/moveRows";
import { deskRowContext, structuresByLocation } from "@/lib/deskRows";
import { pgNowMs } from "@/lib/pgClock";
import { ATTACK_INCLUDE, INTERCEPT_HIT_INCLUDE, otherHoldRows } from "@/lib/holdClusters";

// The adjudication workspace's server half: one load, all DTOs, no
// Prisma-shaped object across the boundary. The queue is the OPEN turn's
// Moves — under staged arbitration a resolved turn's Moves are already
// pushed, so nothing here can still be done to them — plus the newest
// Requests, which keep their own review lifecycle. A past turn is readable
// through the History lens, but it fetches itself (actions.js#getMoveHistory);
// all this file ships for it is the picker's list of resolved turns.


function turnLabel(turn) {
  if (!turn) return "—";
  return `${turn.number} · ${turn.phase === "DAWN" ? "Dawn" : "Dusk"}`;
}



// THE SELECTION IS A SEARCH PARAM, NOT A PATH SEGMENT, and that is the whole
// reason the desk stops throwing GMs' work away.
//
// It used to be a path: /gm/turns/move/<id>, mirrored in with replaceState so
// picking a row cost no RSC fetch. But Next's patched replaceState moves the
// router's canonicalUrl with it, so the NEXT router.refresh() — every desk
// mutation does one, and the backstop poll does one every two minutes —
// refetched the route at a path whose dynamic params had changed. Next treats
// that as a different segment and REMOUNTS it: the workspace, the rail, the
// open Move desk and every piece of React state under them, gone, with no
// navigation and no reload to explain it. That is the "the desk randomly
// redraws and eats what I was typing" bug. A search param changes no segment,
// so the same refresh is a plain props update. Measured both ways.
//
// `history` is the fourth type: a Move on a RESOLVED turn, opened read-only.
// It never overlaps `move` — the open turn's Move is always `move`, and a
// history URL naming one is redirected below.
//
// `sel` reads "<type>/<id>". The old path form still resolves — the catch-all
// route stays, and every /gm/turns/<type>/<id> link elsewhere in the app lands
// on the redirect below — so nobody's bookmark or pasted link breaks.
function parseSelection(sel) {
  if (typeof sel !== "string") return null;
  const [type, id, ...rest] = sel.split("/");
  if (rest.length || !id) return null;
  if (!["move", "caving", "history"].includes(type)) return null;
  return { type, id };
}

function legacyPathSelection(segments) {
  if (!segments || segments.length !== 2) return null;
  return parseSelection(segments.join("/"));
}

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshTurnsWorkspace in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function TurnsWorkspacePage({ params, searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const { selection } = await params;
  // An old path-shaped deep link, from a bookmark or from one of the Links
  // elsewhere in the app. One hop onto the query form and it behaves like
  // everything else from then on.
  const legacy = legacyPathSelection(selection);
  if (legacy) redirect(turnsSelectionHref(legacy));
  const { sel } = await searchParams;
  return (
    // remountOnFresh={false}: the workspace re-seeds itself when its props
    // change — every row it draws goes through the desk store, which folds the
    // stored snapshot and the fresh payload together by the database's clock
    // (deskStore.js). The remount was there to stop an island holding stale
    // props in state, and it took the Result box a GM had already started
    // typing with it. Nothing here needs it any more.
    <SnapshotPage scope={`gm-turns:${sel ?? ""}`} userId={session.discordUserId} render={TurnsView} fallback={<Loading />} remountOnFresh={false}>
      <Suspense fallback={null}>
        <FreshTurnsWorkspace searchParams={searchParams} userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshTurnsWorkspace({ searchParams, userId }) {
  const { sel } = await searchParams;
  const parsedSelection = parseSelection(sel);
  // Only the turn's END is derived here now, for the push countdown below — the
  // Move cutoff moved into the header chip every page wears (LockChip.js), which
  // reads it from the root layout. turnEndsAt does not care whether the clock is
  // frozen, so this no longer needs clockFrozen() alongside it. The big batch
  // below still waits on openTurn — it filters by turn id.
  const openTurn = await getOpenTurn();
  const endsAt = openTurn ? turnEndsAt(openTurn) : null;

  const [
    actions,
    cavingRolls,
    attacks,
    interceptHits,
    avatarsToReview,
    stagedEffects,
    stagedMessages,
    roster,
    presenceZones,
    tagCatalog,
    visibleZones,
    selectableZones,
    gmProfiles,
    resolvedTurns,
    ctx,
  ] = await Promise.all([
    openTurn
      ? prisma.action.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: MOVE_INCLUDE,
        })
      : [],
    // The Caving lens — every roll on the open turn. See
    // docs/systemdocs/CAVING.md. No "strays from earlier turns" clause
    // like stagedEffects/stagedMessages below: a CavingRoll is never
    // "unapplied", it just sits resolved or not.
    openTurn
      ? prisma.cavingRoll.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: CAVING_ROLL_INCLUDE,
        })
      : [],
    // The Other lens — everything holding somebody in place this turn
    // (docs/systemdocs/ATTACK.md). Turn-scoped like the Caving lens above, and
    // cancelled rows ride along rather than being filtered out: a fight
    // somebody started and called off is still something a GM may need to know
    // happened.
    openTurn
      ? prisma.attack.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: ATTACK_INCLUDE,
        })
      : [],
    // Its intercept half. An AMBUSH files an Attack above, so what is left
    // here is the two-minute Safe stops.
    openTurn
      ? prisma.interceptHit.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: INTERCEPT_HIT_INCLUDE,
        })
      : [],
    // Uploaded portraits nobody has looked at yet (PORTRAITS.md §1a). NOT
    // scoped to the open turn, unlike everything above it: a picture is not a
    // thing that happened this turn, it is a thing that is still true — and a
    // queue that emptied itself at every turn end would be a review surface
    // that reviewed nothing.
    prisma.character.findMany({
      where: avatarReviewWhere(prisma),
      orderBy: { avatarSetAt: "desc" },
      select: AVATAR_REVIEW_SELECT,
    }),
    // Open-turn staging plus every unapplied stray from earlier turns —
    // the strays feed the missed-push banner.
    prisma.stagedEffect.findMany({
      where: openTurn ? { OR: [{ turnId: openTurn.id }, { appliedAt: null }] } : { appliedAt: null },
      orderBy: { createdAt: "asc" },
      include: STAGED_EFFECT_INCLUDE,
    }),
    prisma.stagedMessage.findMany({
      where: openTurn ? { OR: [{ turnId: openTurn.id }, { sentAt: null }] } : { sentAt: null },
      orderBy: { createdAt: "asc" },
      include: STAGED_MESSAGE_INCLUDE,
    }),
    // Recipient and mass-apply pickers. Living characters only — a staged
    // message to someone who dies mid-turn keeps its recipient row anyway.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        roleTitle: true,
        discordUserId: true,
        faction: { select: { name: true } },
        zone: { select: { name: true } },
      },
    }),
    // The public-declaration composer picks a ZONE, because #summary belongs
    // to the zone: PRESENCE zones only, never the abstract Caves group row.
    prisma.zone.findMany({
      where: { kind: { not: "CAVE_GROUP" } },
      orderBy: { sortOrder: "asc" },
      // `kind` so the composer can say where a cave declaration actually goes:
      // a CAVE_LEVEL has no #summary and fans out to its Location channels.
      select: { id: true, name: true, kind: true },
    }),
    // The effect composer's search space: the whole catalog. TAG_CHIP_FIELDS
    // is what TagChip/ChipLabel need to render coloured with a working
    // tooltip (group, category, description, …) — this used to be a lean,
    // bespoke select missing all of that, which is why chips here rendered
    // uncoloured with an empty tooltip. See referenceData.js's own comment;
    // this is the second time that regression happened.
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: {
        ...TAG_CHIP_FIELDS,
        stackable: true,
        equippable: true,
      },
    }),
    getVisibleZones(),
    listSelectableZones(),
    getGmProfiles(),
    // The History lens's turn picker. Just the labels — a resolved turn's
    // Moves are fetched on demand by getMoveHistory when a GM actually
    // opens the lens, so the open turn's desk never pays for history it
    // isn't looking at (and neither does the 45s router.refresh()).
    prisma.turn.findMany({
      where: { status: "RESOLVED" },
      orderBy: { number: "desc" },
      select: { id: true, number: true, phase: true },
    }),
    // Discord usernames, who is Catatonic and the Location names. The clock
    // every row is stamped with is NOT in here — it is read below, after this
    // whole batch has resolved.
    deskRowContext({ openTurn }),
  ]);

  const { usernameById, catatonicIds, locationRows, locationNameById, now } = ctx;
  const gmProfilesById = Object.fromEntries(gmProfiles.map((p) => [p.discordUserId, { username: p.username, avatarUrl: p.avatarUrl }]));

  const tagsById = tagsByIdFor(actions);

  // One bulk load for every Location on the queue, not one query per row —
  // see web/lib/deskRows.js#structuresByLocation.
  const structuresByLocationId = await structuresByLocation(
    actions.map((a) => a.character.locationId),
  );

  // THE CLOCK IS READ LAST, and the order is load-bearing. Every row shipped
  // below is stamped with `asOfMs`, and the client's desk store keeps the
  // newer of two copies of a row (deskStore.js) — which is what lets the
  // stored snapshot and the fresh payload both fold in without the page having
  // to remount. Read the clock alongside the queries instead and this payload
  // can carry a stamp from AFTER a Solve whose rows it was read before,
  // out-ranking that Solve's own patch and putting the Move back in the queue.
  // Read after every query has resolved and the stamp can only under-claim,
  // which is the direction the newer-wins rule is safe in. Same order, and the
  // same reason, in deskRows.js#deskPatchFor.
  const asOfMs = await pgNowMs();

  const moves = actions.map((a) => moveRow(a, { usernameById, now, structuresByLocationId }));


  const cavingRows = cavingRolls.map((c) => cavingRollRow(c, { usernameById, catatonicIds }));

  // What each person filed this turn, for the Other lens's Move chips. Built
  // off `moves` rather than off `actions` and costing no second query: a chip
  // can then only exist for a Move the client actually holds, so it is
  // structurally impossible to draw one that opens an empty desk. A character
  // may hold more than one (an auto-filed Travel beside their Gambit — Action
  // carries no unique on characterId+turnId), so each gets its own chip.
  const movesByCharacterId = new Map();
  for (const m of moves) {
    const list = movesByCharacterId.get(m.characterId) ?? [];
    list.push({ id: m.id, kindLabel: m.kindLabel });
    movesByCharacterId.set(m.characterId, list);
  }

  // The Other lens's one merged list. An Ambush is already an Attack row, so
  // the two halves never name the same event twice.
  const otherCtx = { usernameById, catatonicIds, movesByCharacterId };
  const otherRows = [
    ...otherHoldRows(attacks, interceptHits, otherCtx),
    ...avatarsToReview.map((c) => avatarReviewRow(c, otherCtx)),
  ];

  const effectCtx = { usernameById, locationNameById, openTurn };
  const messageCtx = { usernameById, openTurn };
  const effects = stagedEffects.map((e) => stagedEffectRow(e, effectCtx));
  const messages = stagedMessages.map((m) => stagedMessageRow(m, messageCtx));

  // A /gm/turns/history/<id> deep link, so one GM can send another the exact
  // past Move and have it open on arrival. The lens fetches the rest of that
  // turn on its own; this is only the one row the URL names. A row that turns
  // out to be on the OPEN turn isn't history at all — it is still live work,
  // so the URL corrects itself to /gm/turns/move/<id>.
  let initialHistory = null;
  // The Caving twin of the deep link above: a /gm/turns/caving/<id> link naming
  // a roll on a RESOLVED turn (the open turn's rolls are already in cavingRows,
  // so this only fires for a past one). Preloads the one row and its staged
  // work so the History lens opens straight to it, the same one-shot as
  // initialHistory — Workspace flips the lens to History · Caving on arrival.
  let initialCaving = null;
  if (parsedSelection?.type === "history") {
    const past = await prisma.action.findUnique({
      where: { id: parsedSelection.id },
      include: MOVE_INCLUDE,
    });
    if (past && openTurn && past.turnId === openTurn.id) redirect(turnsSelectionHref({ type: "move", id: past.id }));
    if (past) {
      const [pastEffects, pastMessages] = await Promise.all([
        prisma.stagedEffect.findMany({
          where: { moveId: past.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_EFFECT_INCLUDE,
        }),
        prisma.stagedMessage.findMany({
          where: { moveId: past.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_MESSAGE_INCLUDE,
        }),
      ]);
      initialHistory = {
        turnId: past.turnId,
        // No structuresByLocationId, deliberately: a past Move under today's
        // ground would lie, and the history desk shows no Standing-here line.
        move: moveRow(past, { usernameById, now }),
        effects: pastEffects.map((e) => stagedEffectRow(e, effectCtx)),
        messages: pastMessages.map((m) => stagedMessageRow(m, messageCtx)),
        tagsById: tagsByIdFor([past]),
      };
    }
  }

  if (parsedSelection?.type === "caving" && !cavingRows.some((c) => c.id === parsedSelection.id)) {
    const roll = await prisma.cavingRoll.findUnique({
      where: { id: parsedSelection.id },
      include: CAVING_ROLL_INCLUDE,
    });
    if (roll) {
      const [rollEffects, rollMessages] = await Promise.all([
        prisma.stagedEffect.findMany({
          where: { cavingRollId: roll.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_EFFECT_INCLUDE,
        }),
        prisma.stagedMessage.findMany({
          where: { cavingRollId: roll.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_MESSAGE_INCLUDE,
        }),
      ]);
      initialCaving = {
        turnId: roll.turnId,
        roll: cavingRollRow(roll, { usernameById, catatonicIds }),
        effects: rollEffects.map((e) => stagedEffectRow(e, effectCtx)),
        messages: rollMessages.map((m) => stagedMessageRow(m, messageCtx)),
      };
    }
  }

  // `label` is built by the same turnLabel() the resolved turns are, so the
  // History lens can list the open turn in its Turn dropdown alongside them
  // with no second formatting rule to keep in sync (Workspace.js only appends
  // the "· open" suffix).
  // `endsAtMs` rides along so the desk's push countdown can tick against the
  // same turnClock derivation everything else uses, instead of the header
  // re-deriving the cron's boundary hours in the browser (it did, and held the
  // old two-a-day rule). Present even when there is no Move lock — a short
  // manual turn still ends at a real time.
  const openTurnDto = openTurn
    ? {
        id: openTurn.id,
        number: openTurn.number,
        phase: openTurn.phase,
        label: turnLabel(openTurn),
        endsAtMs: endsAt ? endsAt.getTime() : null,
      }
    : null;

  return (
    <SnapshotFresh
      scope={`gm-turns:${sel ?? ""}`}
      userId={userId}
      data={{
        // The database's own clock at the read above, and the turn these rows
        // belong to. The client's desk store folds every payload in against
        // them (deskStore.js): the stored snapshot and the fresh payload both
        // land, newer wins, and a turn that opened underneath an idle desk
        // drops the old queue instead of merging with it.
        asOfMs: asOfMs,
        turnId: openTurn?.id ?? null,
        initialSelection: parsedSelection,
        initialHistory: initialHistory,
        initialCaving: initialCaving,
        resolvedTurns: resolvedTurns.map((t) => ({ id: t.id, number: t.number, label: turnLabel(t) })),
        openTurn: openTurnDto,
        selectableZones: selectableZones,
        visibleZoneIds: visibleZones?.map((z) => z.id) ?? [],
        visibleZoneNames: visibleZones?.map((z) => z.name) ?? null,
        tagsById: tagsById,
        tagCatalog: tagCatalog,
        roster: roster.map((c) => ({
        id: c.id,
        name: c.name,
        factionName: c.faction?.name ?? "",
        roleTitle: c.roleTitle ?? "",
        zoneName: c.zone?.name ?? "",
        discordUserId: c.discordUserId,
        username: usernameById.get(c.discordUserId) ?? "",
      })),
        presenceZones: presenceZones,
        stagingLocations: locationRows,
        moves: moves,
        cavingRolls: cavingRows,
        otherRows: otherRows,
        stagedEffects: effects,
        stagedMessages: messages,
        gmProfiles: gmProfilesById,
        deployVersion: deployVersion(),
      }}
    />
  );
}
