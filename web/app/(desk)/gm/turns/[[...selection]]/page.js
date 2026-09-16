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
import { desireReviewWhere } from "@lifeweb/db/lib/desireReview";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import { chipSelect, composeChipTag, GM_CHIP_CTX } from "@/lib/referenceData";
import { deployVersion } from "@/lib/deployVersion";
import { turnsSelectionHref } from "@/lib/routes";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  AVATAR_REVIEW_SELECT,
  DESIRE_CLAIM_INCLUDE,
  OOC_INCLUDE,
  moveRow,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
  avatarReviewRow,
  desireClaimRow,
  oocRow,
  tagsByIdFor,
} from "@/lib/moveRows";
import { deskRowContext, structuresByLocation } from "@/lib/deskRows";
import { pgNowMs } from "@/lib/pgClock";
import { ATTACK_INCLUDE, INTERCEPT_HIT_INCLUDE, otherHoldRows } from "@/lib/holdClusters";

// The adjudication workspace's server half: one load, all DTOs, no
// Prisma-shaped object across the boundary. The queue is the OPEN turn's
// Moves plus the newest Requests. A past turn is readable through the
// History lens but fetches itself (actions.js#getMoveHistory) — this file
// only ships the picker's list of resolved turns.


function turnLabel(turn) {
  if (!turn) return "—";
  return `${turn.number} · ${turn.phase === "DAWN" ? "Dawn" : "Dusk"}`;
}



// THE SELECTION IS A SEARCH PARAM, NOT A PATH SEGMENT, and that is the whole
// reason the desk stops throwing GMs' work away: a path form's replaceState
// moved canonicalUrl with it, so the next router.refresh() (every mutation
// does one) refetched at changed dynamic params — Next treats that as a
// different segment and REMOUNTS the whole workspace, no navigation or
// reload to explain it. A search param changes no segment, so the same
// refresh is a plain props update. `history` is a fourth type: a Move on a
// RESOLVED turn, opened read-only, never overlapping `move`. `sel` reads
// "<type>/<id>" — the old path form still resolves via the redirect below,
// so no bookmark or pasted link breaks.
function parseSelection(sel) {
  if (typeof sel !== "string") return null;
  const [type, id, ...rest] = sel.split("/");
  if (rest.length || !id) return null;
  // "desire" and "ooc" open a desk in Workspace.js the same way the first
  // three do; "desire" was simply missed when its lens landed, so a
  // ?sel=desire/<id> link resolved to nothing.
  if (!["move", "caving", "history", "desire", "ooc"].includes(type)) return null;
  return { type, id };
}

function legacyPathSelection(segments) {
  if (!segments || segments.length !== 2) return null;
  return parseSelection(segments.join("/"));
}

// Snapshotted (web/lib/snapshot, CHAT.md §5c): reads the session, mounts the
// shell, streams FreshTurnsWorkspace in behind it.
export default async function TurnsWorkspacePage({ params, searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const { selection } = await params;
  // An old path-shaped deep link — one hop onto the query form.
  const legacy = legacyPathSelection(selection);
  if (legacy) redirect(turnsSelectionHref(legacy));
  const { sel } = await searchParams;
  return (
    // remountOnFresh={false}: the workspace re-seeds via the desk store
    // (deskStore.js) rather than remounting, which used to take a GM's
    // in-progress Result box with it.
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
  // Only the turn's END is derived here, for the push countdown — the Move
  // cutoff moved to the header chip (LockChip.js). The big batch below still waits on openTurn — it filters by turn id.
  const openTurn = await getOpenTurn();
  const endsAt = openTurn ? turnEndsAt(openTurn) : null;

  const [
    actions,
    cavingRolls,
    attacks,
    interceptHits,
    avatarsToReview,
    desireClaims,
    oocLines,
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
    rooms,
  ] = await Promise.all([
    openTurn
      ? prisma.action.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: MOVE_INCLUDE,
        })
      : [],
    // The Caving lens — every roll on the open turn (CAVING.md). No "strays
    // from earlier turns" clause like stagedEffects/stagedMessages below.
    openTurn
      ? prisma.cavingRoll.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: CAVING_ROLL_INCLUDE,
        })
      : [],
    // The Other lens — everything holding somebody in place this turn
    // (ATTACK.md). Cancelled rows ride along rather than being filtered out.
    openTurn
      ? prisma.attack.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: ATTACK_INCLUDE,
        })
      : [],
    // Its intercept half — AMBUSH files an Attack above, so this is the two-minute Safe stops.
    openTurn
      ? prisma.interceptHit.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: INTERCEPT_HIT_INCLUDE,
        })
      : [],
    // Uploaded portraits nobody has looked at yet (PORTRAITS.md §1a). NOT
    // scoped to the open turn — a picture is a thing that's still true, not
    // a thing that happened this turn.
    prisma.character.findMany({
      where: avatarReviewWhere(prisma),
      orderBy: { avatarSetAt: "desc" },
      select: AVATAR_REVIEW_SELECT,
    }),
    // The Desires lens — fulfilled, catalog-backed claims still waiting on a
    // GM (DESIRES.md §6). NOT scoped to the open turn, same reasoning as the
    // portrait queue above. Newest first, capped.
    prisma.desire.findMany({
      where: desireReviewWhere(),
      orderBy: { createdAt: "desc" },
      take: 50,
      include: DESIRE_CLAIM_INCLUDE,
    }),
    // The OOC lens — every out-of-character line said this turn (db/lib/ooc.js).
    // Scoped to the open turn like the Moves and Caving lenses, because unlike
    // a portrait or a Desire claim this IS a thing that happened this turn and
    // stops being interesting when the turn does.
    //
    // The AuditLog row the rate limit writes is the only record there is, so
    // this reads it rather than a table of its own. Capped: a turn's chatter
    // has no ceiling and the rail is not a transcript.
    openTurn
      ? prisma.auditLog.findMany({
          where: { actionType: "ooc", turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          take: 200,
          include: OOC_INCLUDE,
        })
      : [],
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
    // Recipient and mass-apply pickers. Living characters only.
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
      select: { id: true, name: true, kind: true }, // `kind`: a CAVE_LEVEL has no #summary and fans out to its Locations
    }),
    // The effect composer's search space. chipSelect() is what TagChip/ChipLabel
    // need to render coloured with a working tooltip — the narrow half alone
    // draws every player-written note blank (tagChipRows.js). Composed below,
    // after the batch resolves.
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: chipSelect({ stackable: true, equippable: true }),
    }),
    getVisibleZones(),
    listSelectableZones(),
    getGmProfiles(),
    // The History lens's turn picker. Just the labels — Moves fetch on demand via getMoveHistory.
    prisma.turn.findMany({
      where: { status: "RESOLVED" },
      orderBy: { number: "desc" },
      select: { id: true, number: true, phase: true },
    }),
    // Discord usernames, Catatonic status, Location names — the clock every
    // row stamps with is NOT here, read below after this batch resolves.
    deskRowContext({ openTurn }),
    // The staged room composer's picker — NOT filtered to a provisioned
    // thread like /gm/dev's ambient-line picker, since a stash exists whether Discord knows about the room or not.
    prisma.room.findMany({
      orderBy: [{ location: { zone: { sortOrder: "asc" } } }, { location: { sortOrder: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        destroysContents: true,
        location: { select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } } },
      },
    }),
  ]);

  const { usernameById, catatonicIds, locationRows, locationNameById, now } = ctx;
  // The staged room composer's options, narrowed to zones this GM watches.
  // Null means every zone (web/lib/gmZoneView.js). The <select> is only a
  // hint — the action re-checks the seat. Read here, not in deskRowContext,
  // since deskPatchFor runs on every mutation and live-desk frame and needs none of this.
  const stagingRooms = (visibleZones ? rooms.filter((r) => visibleZones.some((z) => z.id === r.location.zoneId)) : rooms).map(
    (r) => ({
      id: r.id,
      name: r.name,
      destroysContents: r.destroysContents,
      locationId: r.location.id,
      locationName: r.location.name,
      zoneId: r.location.zoneId,
      zoneName: r.location.zone?.name ?? null,
    }),
  );
  const gmProfilesById = Object.fromEntries(gmProfiles.map((p) => [p.discordUserId, { username: p.username, avatarUrl: p.avatarUrl }]));

  const tagsById = tagsByIdFor(actions);

  // One bulk load for every Location on the queue, not one query per row — see deskRows.js#structuresByLocation.
  const structuresByLocationId = await structuresByLocation(
    actions.map((a) => a.character.locationId),
  );

  // THE CLOCK IS READ LAST, and the order is load-bearing. Every row is
  // stamped with `asOfMs`, and the client desk store keeps the newer of two
  // copies (deskStore.js) — reading the clock alongside the queries instead
  // could stamp this payload AFTER a Solve whose rows it read before,
  // out-ranking that Solve's patch. Read after every query resolves, so the
  // stamp can only under-claim. Same order, same reason, in deskRows.js#deskPatchFor.
  const asOfMs = await pgNowMs();

  const moves = actions.map((a) => moveRow(a, { usernameById, now, structuresByLocationId }));


  const cavingRows = cavingRolls.map((c) => cavingRollRow(c, { usernameById, catatonicIds }));

  // What each person filed this turn, for the Other lens's Move chips. Built
  // off `moves`, not `actions` — a chip can then only exist for a Move the
  // client actually holds. A character may hold more than one (an auto-filed
  // Travel beside their Gambit), so each gets its own chip.
  const movesByCharacterId = new Map();
  for (const m of moves) {
    const list = movesByCharacterId.get(m.characterId) ?? [];
    list.push({ id: m.id, kindLabel: m.kindLabel });
    movesByCharacterId.set(m.characterId, list);
  }

  // The Other lens's one merged list — an Ambush is already an Attack row, so the two halves never name the same event twice.
  const otherCtx = { usernameById, catatonicIds, movesByCharacterId };
  const otherRows = [
    ...otherHoldRows(attacks, interceptHits, otherCtx),
    ...avatarsToReview.map((c) => avatarReviewRow(c, otherCtx)),
  ];

  // The Desires lens' own row list — a fifth lens, not folded into Other: a claim isn't a hold on anyone.
  const desireCtx = { usernameById, catatonicIds };
  const desireRows = desireClaims.map((d) => desireClaimRow(d, desireCtx));

  // The OOC lens. Live mutes for exactly the accounts on this lens, so the
  // desk's button can say Unmute without a second round trip — `until` in the
  // past is not a mute, and the row lapses on its own (schema.prisma, OocMute),
  // so the filter here IS the expiry.
  const oocAccounts = [
    ...new Set(oocLines.map((a) => a.targetCharacter?.discordUserId).filter(Boolean)),
  ];
  const oocMutes = oocAccounts.length
    ? await prisma.oocMute.findMany({
        where: { discordUserId: { in: oocAccounts }, until: { gt: new Date() } },
        select: { discordUserId: true, until: true },
      })
    : [];
  const mutedUntilByUser = new Map(oocMutes.map((m) => [m.discordUserId, m.until.toISOString()]));
  const oocRows = oocLines.map((a) => oocRow(a, { usernameById, catatonicIds, mutedUntilByUser }));

  const effectCtx = { usernameById, locationNameById, openTurn };
  const messageCtx = { usernameById, openTurn };
  const effects = stagedEffects.map((e) => stagedEffectRow(e, effectCtx));
  const messages = stagedMessages.map((m) => stagedMessageRow(m, messageCtx));

  // A /gm/turns/history/<id> deep link — the URL names the one row; a row
  // that turns out to be on the OPEN turn isn't history, so it redirects to /gm/turns/move/<id>.
  let initialHistory = null;
  // The Caving twin — a /gm/turns/caving/<id> link naming a roll on a
  // RESOLVED turn (open-turn rolls are already in cavingRows). Preloads it
  // so History opens straight to it; Workspace flips to History · Caving on arrival.
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
        move: moveRow(past, { usernameById, now }), // no structuresByLocationId: today's ground would lie about a past Move
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

  // `label` uses the same turnLabel() as resolved turns, so History's Turn
  // dropdown needs no second formatting rule. `endsAtMs` lets the push
  // countdown tick against the same turnClock derivation everything else
  // uses, present even with no Move lock — a short manual turn still ends at a real time.
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
        // The database's clock and turn these rows belong to — the desk
        // store folds every payload against them (deskStore.js), newer wins.
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
        // Composed here rather than in the query: a GM reads a letter ungated
        // (paperViewGm), and `stackable`/`equippable` ride through untouched.
        tagCatalog: tagCatalog.map((t) => composeChipTag(t, GM_CHIP_CTX)),
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
        stagingRooms: stagingRooms,
        moves: moves,
        cavingRolls: cavingRows,
        otherRows: otherRows,
        desireRows: desireRows,
        oocRows: oocRows,
        stagedEffects: effects,
        stagedMessages: messages,
        gmProfiles: gmProfilesById,
        deployVersion: deployVersion(),
      }}
    />
  );
}
