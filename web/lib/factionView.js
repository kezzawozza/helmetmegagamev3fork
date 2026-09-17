import "server-only";
import { prisma, CATATONIC_SLUG, OBOL_SLUG } from "@lifeweb/db";
import { RESOURCES_SLUG, resourcesOf } from "@lifeweb/db/lib/resourceStack";

// The faction query, lifted out of web/app/(app)/faction/page.js so a second
// surface can ask the same question. Chat's Faction panel
// (web/lib/selfPools.js#loadFactionView) is that second surface, and a copy of
// this include would have been a second answer to "who is in this faction" —
// the one thing FACTIONS.md §5 is about.
//
// A page file may not export anything but a page, so the loader could not stay
// where it was and be shared. Nothing about the shape changed except
// `updatedAt`, which Chat needs for the avatar `?v=`.
export async function loadFaction(factionId) {
  const faction = await prisma.faction.findUnique({
    where: { id: factionId },
    include: {
      parentFaction: { select: { id: true, name: true } },
      subjectFactions: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      zone: { select: { name: true } },
      siloRoom: {
        select: {
          id: true,
          name: true,
          kind: true,
          accessTagSlugs: true,
          location: { select: { name: true, zoneId: true, zone: { select: { name: true } } } },
          // Full enough for a TagChip hover (FactionConsole.js's silo table) —
          // description, group colour, requirement/armour — not just the name
          // a chip with no panel behind it used to settle for.
          tags: {
            select: {
              id: true,
              quantity: true,
              tag: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  description: true,
                  mastery: true,
                  group: { select: { slug: true } },
                  weightLbs: true,
                  meleeArmor: true,
                  ballisticArmor: true,
                  requirementTurns: true,
                  requirementPerTurn: true,
                  requirementResources: true,
                  requirementGambit: true,
                  requirementSkills: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      characters: {
        // ALIVE only. A corpse in the roster inflated the member count the
        // directory shows (which always counted the living), so a faction
        // advertised as "4 members" became 9 the moment you joined it — and
        // the dead carried live Remove and Treasurer buttons.
        where: { status: "ALIVE" },
        orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
        select: {
          id: true,
          name: true,
          status: true,
          isLeader: true,
          isTreasurer: true,
          roleTitle: true,
          // The avatar cache-buster, and only that: /api/avatar answers with
          // an immutable Cache-Control, so a roster without it draws faces
          // from before the last portrait change (PORTRAITS.md).
          updatedAt: true,
          // Three things riding the same relation, all filtered down to a
          // fixed set of slugs rather than the whole sheet: the AFK marker
          // (a bare row means catatonic — `tags.some()` reads it below), an
          // officer's Obols column, and their ⬢ — every one of them a
          // physical Tag stack now rather than a balance column (DEPOT.md,
          // and docs/systemdocs/ECONOMY.md for the ⬢). The ⬢ row is lifted
          // out into `resources` below and does not stay in this list.
          tags: {
            where: { tag: { slug: { in: [CATATONIC_SLUG, OBOL_SLUG, RESOURCES_SLUG] } } },
            select: { quantity: true, tag: { select: { slug: true } } },
          },
        },
      },
    },
  });
  if (!faction) return null;

  // ⬢ are a stack row now, so the number every caller still reads as
  // `.resources` is lifted off the tags rather than selected as a column —
  // and then taken back out of the lists, since the silo table and the
  // officer's roster both show it in their own ⬢ field and would otherwise
  // print it twice.
  const silo = faction.siloRoom;
  return {
    ...faction,
    siloRoom: silo
      ? {
          ...silo,
          resources: resourcesOf(silo),
          tags: silo.tags.filter((rt) => rt.tag.slug !== RESOURCES_SLUG),
        }
      : silo,
    characters: faction.characters.map((c) => ({
      ...c,
      resources: resourcesOf(c),
      tags: c.tags.filter((ct) => ct.tag.slug !== RESOURCES_SLUG),
    })),
  };
}
