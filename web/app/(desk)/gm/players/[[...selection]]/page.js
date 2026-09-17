import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import RosterView from "../RosterView";
import Loading from "../Skeleton";
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { cursedUserIds } from "@lifeweb/db/lib/curse";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getVisibleZones } from "@/lib/gmZoneView";
import { getOpenTurn } from "@/lib/turn";

// The roster, and the desk's ONLY route — an optional catch-all (same shape
// /gm/turns uses) since selecting a conversation is client state
// (players/selection.js) rather than a navigation, and this route must stay
// mounted so closing a conversation reveals the roster underneath. The
// `selection` param is deliberately unread — it exists so /gm/players/<id>
// resolves on a cold load; who's open comes from the selection store.
// Heavy loads live here, not the layout: the tag catalog and faction tree
// are only needed by this view, and the layout re-runs on every router.refresh().

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshPlayerRoster in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function PlayerRosterPage({ searchParams }) {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="gm-players" userId={session.discordUserId} render={RosterView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshPlayerRoster searchParams={searchParams} userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshPlayerRoster({ searchParams, userId }) {
  const [tags, factions, visibleZones, openTurn, params] = await Promise.all([
    // The whole catalog, gates and all — bulk tagging is a GM grant that deliberately ignores requiredTag and the TagGroup gate (TAGS.md).
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true, // for the roster's Catatonic column
        category: true,
        description: true,
        pointCost: true,
        mastery: true, // ChipLabel's mastery star
        parentTagId: true, // bulk-tag picker sorts chain-aware; degrades to alphabetical without it
        group: { select: { name: true } },
      },
    }),
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: { characters: { select: { id: true, name: true, isLeader: true } } },
    }),
    getVisibleZones(),
    getOpenTurn(),
    searchParams,
  ]);

  const [characters, members, actedCharacterIds, heldTags] = await Promise.all([
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      include: { faction: { include: { zone: true } }, zone: true },
      take: 1000,
    }),
    listGuildMembers(), // TTL-cached, so the layout already calling it costs nothing here
    // "Has this player moved yet this turn" — the most-asked question in the back half of a turn.
    openTurn
      ? prisma.action
          .findMany({ where: { turnId: openTurn.id }, select: { characterId: true } })
          .then((rows) => new Set(rows.map((r) => r.characterId)))
      : Promise.resolve(new Set()),
    // Ids, not a count: fuzzy search matches tag NAMES now, and the count falls out of the same rows for free.
    prisma.characterTag.findMany({ select: { characterId: true, tagId: true } }),
  ]);

  const tagNameById = new Map(tags.map((t) => [t.id, t.name]));
  const tagNamesByCharacter = new Map();
  for (const ct of heldTags) {
    const name = tagNameById.get(ct.tagId);
    if (!name) continue;
    const list = tagNamesByCharacter.get(ct.characterId);
    if (list) list.push(name);
    else tagNamesByCharacter.set(ct.characterId, [name]);
  }
  // Who's AFK, from rows already in hand — no extra query.
  const catatonicTagId = tags.find((t) => t.slug === CATATONIC_SLUG)?.id ?? null;
  const catatonicCharacterIds = new Set(
    heldTags.filter((ct) => ct.tagId === catatonicTagId).map((ct) => ct.characterId),
  );
  const cursed = cursedUserIds(characters); // a database question now (db/lib/curse.js), not a Discord role
  const memberById = new Map(members.map((m) => [m.id, m])); // same map PlayerRail builds, so the table finds a Discord handle without a second query

  return (
    <SnapshotFresh
      scope="gm-players"
      userId={userId}
      data={{
        initialTab: params?.tab?.toString() ?? "",
        initialHighlightFactionId: params?.faction?.toString() ?? null,
        characters: characters.map((c) => ({
          id: c.id,
          discordUserId: c.discordUserId,
          name: c.name,
          roleTitle: c.roleTitle,
          factionId: c.factionId,
          factionName: c.faction?.name ?? "",
          factionZoneName: c.faction?.zone?.name ?? "",
          zoneName: c.zone?.name ?? "",
          status: c.status,
          username: memberById.get(c.discordUserId)?.username ?? "",
          globalName: memberById.get(c.discordUserId)?.globalName ?? "",
          resources: c.resources,
          cursed: cursed.has(c.discordUserId),
          catatonic: catatonicCharacterIds.has(c.id),
          tagCount: (tagNamesByCharacter.get(c.id) ?? []).length,
          tag: (tagNamesByCharacter.get(c.id) ?? []).join(" "),
          acted: actedCharacterIds.has(c.id),
          avatarVersion: c.updatedAt.getTime(),
        })),
        tags: tags,
        visibleZoneNames: visibleZones?.map((z) => z.name) ?? null,
        hasOpenTurn: Boolean(openTurn),
        factions: factions,
        factionCount: factions.length,
      }}
    />
  );
}
