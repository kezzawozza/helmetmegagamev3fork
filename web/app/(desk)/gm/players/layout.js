import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { cursedUserIds } from "@lifeweb/db/lib/curse";
import { resourcesByCharacterIds } from "@lifeweb/db/lib/resourceStack";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import { getOpenTurn } from "@/lib/turn";
import { railKindSql, dmPreview } from "@/lib/dmThread";
import PlayerRail from "./PlayerRail";
import InboxPoller from "./InboxPoller";
import InboxStream from "./InboxStream";
import { InboxStreamChip } from "../StreamStatusChip";
import DeskInboxCounts from "./DeskInboxCounts";
import { deployVersion } from "@/lib/deployVersion";
import { DeskStaleChip } from "@/app/components/useDeskVersion";
import { DeskStaleRefreshGate } from "@/app/components/useRefresh";
import InspectorHost from "./InspectorHost";
import DeskMiddle from "./DeskMiddle";
import { getGmProfiles } from "@/lib/gmProfiles";
import { GmZoneViewProvider } from "@/app/components/GmZoneViewProvider";
import BulkMessageButton from "./BulkMessageButton";
import { InspectorToggle } from "@/app/components/useInspectorOverlay";

// The player desk's server half. Owns the rail's data; the child route
// loads its own conversation. The rail is the union of "everyone with a
// conversation" and "everyone with a character". The GM gate lives in
// (desk)/layout.js above this.

export default async function PlayerDeskLayout({ children }) {
  const { session } = await getGmSession();

  const [guildMembers, gmProfiles, visibleZones, selectableZones, openTurn, characters, characterTags, allTags, stagedEffects] =
    await Promise.all([
    listGuildMembers(),
    getGmProfiles(),
    getVisibleZones(),
    listSelectableZones(),
    getOpenTurn(),
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      // `zone` is where they are physically standing, which is the only zone
      // a desk row has now.
      include: { zone: true },
      take: 1000, // safety net, not a real limit
    }),
    // Held tags, ids only, ALIVE characters only — feeds rail/roster tag search.
    prisma.characterTag.findMany({
      where: { character: { status: "ALIVE" } },
      select: { characterId: true, tagId: true },
    }),
    // Names for the search field, and the catalog behind the inspector's
    // custom-tag door.
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        pointCost: true,
        // ChipLabel's mastery star. A GM handing out Lucky from this picker
        // should see that they are granting a capstone.
        mastery: true,
        sprite: true, // TagIcon's item art; null falls back to the group glyph
        group: { select: { id: true, name: true } },
      },
    }),
    // This turn's unapplied staging, so the shared inspector can dim a
    // staged removal / suffix a staged ± on both desks.
    prisma.stagedEffect.findMany({
      where: { appliedAt: null },
      select: { targetCharacterId: true, payload: true },
    }),
  ]);

  // Newest CONVERSATION message per player. DISTINCT ON is Postgres-specific,
  // no Prisma equivalent; rides @@index([kind, discordUserId, createdAt]).
  //
  // One query, where there used to be two. The second existed to find the last
  // line a PERSON wrote, separately from the last line of any kind, because a
  // hunger notice could otherwise sit at the top of the inbox looking like
  // mail. A notice is invisible to the rail now (dmThread.js#railKindSql), so
  // the two questions have the same answer.
  // The clock FIRST, on its own, and not in the Promise.all below.
  //
  // rowsAsOfMs is the watermark mergeRailRows uses to decide whether a live
  // patch is newer than these rows; a patch only applies when its own stamp is
  // strictly later. Read alongside the queries, the stamp could land AFTER a
  // message the queries had already missed — so the rows lacked the message,
  // the watermark claimed to be newer than it, and the patch carrying it was
  // discarded. The desk showed nothing new until a reload.
  //
  // Reading it first makes the stamp a floor rather than a ceiling: never
  // later than the data it describes. The cost is that an almost-simultaneous
  // patch can now apply when it had nothing new to add, which is a redundant
  // repaint corrected by the next frame. Losing a message is permanent;
  // repainting one is not. inboxDelta.js already reads its clock first for
  // exactly this reason, so the two sides now agree.
  const clock = await prisma.$queryRaw`SELECT (EXTRACT(EPOCH FROM now()) * 1000)::double precision AS "nowMs"`;
  const rowsAsOfMs = Number(clock[0].nowMs);

  const [latestMessages, unreadRows, everDmedUserIds, claims, reads, mutes] = await Promise.all([
    prisma.$queryRaw`
      SELECT DISTINCT ON ("discordUserId")
        "discordUserId", "id", "direction", "content", "authorDiscordUserId", "source", "createdAt"
      FROM "DirectMessage"
      WHERE ${railKindSql()}
      ORDER BY "discordUserId", "createdAt" DESC
    `,
    // Per-GM unread counts: INBOUND rows newer than this GM's read cursor
    // (epoch when no cursor row exists yet).
    prisma.$queryRaw`
      SELECT dm."discordUserId", COUNT(*)::int AS "unreadCount"
      FROM "DirectMessage" dm
      LEFT JOIN "ConversationRead" cr
        ON cr."playerDiscordUserId" = dm."discordUserId"
        AND cr."gmDiscordUserId" = ${session.discordUserId}
      WHERE dm."direction" = 'INBOUND'
        AND dm."createdAt" > COALESCE(cr."lastReadAt", to_timestamp(0))
        AND ${railKindSql("dm")}
      GROUP BY dm."discordUserId"
    `,
    // Everyone the game has ever written to, notices included — the third leg
    // of the rail union below. Ids only, off @@index([kind, discordUserId,
    // createdAt]); the rows themselves are never loaded.
    prisma.$queryRaw`SELECT DISTINCT "discordUserId" FROM "DirectMessage"`,
    prisma.conversationMeta.findMany({
      where: {
        OR: [
          { claimedByDiscordUserId: { not: null } },
          { handledAt: { not: null } },
        ],
      },
    }),
    // This GM's read cursors. The rail does not draw them; the client uses
    // them to decide when its own optimistic "read" has been overtaken by the
    // server and can be dropped (liveInbox.js#reconcileReadOverrides).
    prisma.conversationRead.findMany({
      where: { gmDiscordUserId: session.discordUserId },
      select: { playerDiscordUserId: true, lastReadAt: true },
    }),
    // This GM's own mutes — a mute is per-GM by design, so muting a
    // conversation removes it only from the muting GM's rail.
    prisma.conversationMute.findMany({
      where: { gmDiscordUserId: session.discordUserId },
      select: { playerDiscordUserId: true },
    }),
  ]);

  const latestByUser = new Map(latestMessages.map((m) => [m.discordUserId, m]));
  const unreadByUser = new Map(unreadRows.map((r) => [r.discordUserId, r.unreadCount]));
  const claimByUser = new Map(claims.map((c) => [c.playerDiscordUserId, c.claimedByDiscordUserId]));
  const lastReadByUser = new Map(reads.map((r) => [r.playerDiscordUserId, r.lastReadAt.getTime()]));
  const mutedUserIds = new Set(mutes.map((m) => m.playerDiscordUserId));
  const handledAtByUser = new Map(
    claims.filter((c) => c.handledAt).map((c) => [c.playerDiscordUserId, c.handledAt.getTime()]),
  );

  const usernameById = new Map(guildMembers.map((mem) => [mem.id, mem.username]));
  const globalNameById = new Map(guildMembers.map((mem) => [mem.id, mem.globalName]));

  // Cursed is a live Discord role, not a DB field.
  // Who is cursed is a database question now (db/lib/curse.js), not a Discord
  // role — and the rows it reads are the ones already loaded above, so this
  // costs no extra query.
  const cursed = cursedUserIds(characters);

  // Name/role/zone resolve together under one ALIVE-wins rule.
  const characterByUser = new Map();
  for (const c of characters) {
    const existing = characterByUser.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterByUser.set(c.discordUserId, c);
  }

  // Who's AFK — feeds the rail avatar's badge.
  const catatonicTagId = allTags.find((t) => t.slug === CATATONIC_SLUG)?.id ?? null;
  const catatonicCharacterIds = new Set(
    characterTags.filter((ct) => ct.tagId === catatonicTagId).map((ct) => ct.characterId),
  );

  // ⬢ per character, in one batch query rather than one per row — this rail
  // lists everyone. Every status, not just ALIVE: a dead character's purse is
  // still shown here, so the tag rows above (ALIVE only) can't answer it.
  const resourcesByCharacter = await resourcesByCharacterIds(prisma, characters.map((c) => c.id));

  // Held-tag names per character, for the rail's fuzzy `tag` field.
  const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));
  const tagNamesByCharacter = new Map();
  for (const ct of characterTags) {
    const name = tagNameById.get(ct.tagId);
    if (!name) continue;
    const list = tagNamesByCharacter.get(ct.characterId);
    if (list) list.push(name);
    else tagNamesByCharacter.set(ct.characterId, [name]);
  }

  // The union: every player who has a conversation, plus every player who has
  // a character, plus everyone the game has ever DM'd at all.
  //
  // The third leg is there because notices stopped counting as conversation. A
  // lobby entrant handed a seat (db/lib/lobbySweep.js) or someone offered an
  // antagonist chair (gm/dev/threatActions.js) has no character row yet and
  // nothing but notices, so the first two legs miss them entirely and a GM
  // could reach them by no means at all.
  //
  // "Anyone the game has DM'd" rather than "every guild member" on purpose:
  // the guild also holds bots, spectators, contributors and the GMs, none of
  // whom belong in a roster, and putting all of them in would have made a
  // two-letter search return more non-players than players. Being written to
  // by the game is what makes somebody a person this desk is about.
  //
  // The rail with an empty query is still only people with a conversation —
  // a notice-only row appears when a GM searches and not before
  // (PlayerRail.js).
  const userIds = new Set([
    ...latestByUser.keys(),
    ...characterByUser.keys(),
    ...everDmedUserIds.map((r) => r.discordUserId),
  ]);

  const rows = [...userIds].map((discordUserId) => {
    const c = characterByUser.get(discordUserId) ?? null;
    const last = latestByUser.get(discordUserId) ?? null;
    const username = usernameById.get(discordUserId) ?? "";
    const preview = dmPreview(last, session.discordUserId);
    return {
      discordUserId,
      characterId: c?.id ?? null,
      avatarVersion: c?.updatedAt ? c.updatedAt.getTime() : null,
      name: c?.name ?? username ?? discordUserId,
      roleTitle: c?.roleTitle ?? "",
      zoneName: c?.zone?.name ?? "",
      status: c?.status ?? null,
      resources: c ? resourcesByCharacter.get(c.id) ?? 0 : 0,
      cursed: cursed.has(discordUserId),
      catatonic: c ? catatonicCharacterIds.has(c.id) : false,
      username,
      globalName: globalNameById.get(discordUserId) ?? "",
      preview,
      lastAtMs: last ? last.createdAt.getTime() : 0,
      lastDirection: last?.direction ?? null,
      // Whether a thread exists, not how long — avoids a per-user COUNT scan.
      hasConversation: latestByUser.has(discordUserId),
      unreadCount: unreadByUser.get(discordUserId) ?? 0,
      lastReadAtMs: lastReadByUser.get(discordUserId) ?? 0,
      claimedByDiscordUserId: claimByUser.get(discordUserId) ?? null,
      // Handled only while the mark is at or after the last message; a new
      // inbound DM outruns it and the row is awaiting again.
      handled:
        handledAtByUser.has(discordUserId) &&
        handledAtByUser.get(discordUserId) >= (last ? last.createdAt.getTime() : 0),
      muted: mutedUserIds.has(discordUserId),
      tag: c ? (tagNamesByCharacter.get(c.id) ?? []).join(" ") : "",
      tagNames: c ? (tagNamesByCharacter.get(c.id) ?? []) : [],
    };
  });

  // BulkComposer's recipient pool: living characters only.
  const bulkCharacters = rows
    .filter((r) => r.characterId && r.status === "ALIVE")
    .map((r) => ({
      id: r.characterId,
      name: r.name,
      roleTitle: r.roleTitle,
      zoneName: r.zoneName,
    }));

  return (
    // Skips a hard-reload across the build boundary once deploy latches the
    // stale flag — same as /gm/turns.
    <DeskStaleRefreshGate version={deployVersion()}>
    <div className="desk-shell">
      {/* No DeskHeader any more. The turn/lock/clock chips it used to carry
          are redundant with the universal top bar's own clock block; the
          rest is this desk's own state and stays. */}
      <div className="desk-header">
        <div className="flex min-w-0 items-center gap-3">
          <DeskInboxCounts rows={rows} rowsAsOfMs={rowsAsOfMs} />
          <InboxStreamChip />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DeskStaleChip />
          <InspectorToggle />
          <BulkMessageButton characters={bulkCharacters} />
        </div>
      </div>

      {/* The zone view lives in the client from here down, so the rail, the
          roster (which arrives as {children}) and the picker in the inspector
          all re-filter on the click rather than on a revalidate. */}
      <GmZoneViewProvider initialZoneNames={visibleZones?.map((z) => z.name) ?? null}>
      <div className="desk-body desk-body--players">
        <PlayerRail
          rows={rows}
          rowsAsOfMs={rowsAsOfMs}
          visibleZoneNames={visibleZones?.map((z) => z.name) ?? null}
          myDiscordUserId={session.discordUserId}
        />
        {/* The roster arrives as {children} and stays mounted; DeskMiddle
            draws the open conversation over it. gmProfiles and the acting
            GM's id are desk-wide, so they are handed down once here rather
            than fetched per conversation — which is what opening somebody
            used to pay a Discord round trip for. */}
        <DeskMiddle rows={rows} gmProfiles={gmProfiles} myDiscordUserId={session.discordUserId}>
          {children}
        </DeskMiddle>
        {/* The third column is the shell's, not the person view's: it stays
            put across a navigation (the roster included), which is the whole
            point of a persistent inspector. */}
        <InspectorHost
          selectableZones={selectableZones}
          visibleZoneIds={visibleZones?.map((z) => z.id) ?? []}
          rows={rows}
          stagedEffects={stagedEffects.map((e) => ({
            targetCharacterId: e.targetCharacterId,
            resources: e.payload?.resources ?? 0,
            tagPoints: e.payload?.tagPoints ?? 0,
            tagOps: e.payload?.tagOps ?? [],
          }))}
          currentTurnNumber={openTurn?.number ?? null}
          bulkCharacters={bulkCharacters}
          tagCatalog={allTags}
        />
      </div>
      </GmZoneViewProvider>

      <InboxPoller deployVersion={deployVersion()} />
      <InboxStream deployVersion={deployVersion()} />
    </div>
    </DeskStaleRefreshGate>
  );
}
