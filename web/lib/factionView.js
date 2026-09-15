import "server-only";
import { prisma, CATATONIC_SLUG, OBOL_SLUG } from "@lifeweb/db";

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
  return prisma.faction.findUnique({
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
          resources: true,
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
          // Only ever rendered behind the officer gate — a plain member never
          // sees the column.
          resources: true,
          // Two things riding the same relation, both filtered down to a
          // fixed pair of slugs rather than the whole sheet: the AFK marker
          // (a bare row means catatonic — `tags.some()` reads it below) and
          // an officer's Obols column, which needs the actual quantity
          // (obols are a physical Tag stack, not a balance column — DEPOT.md).
          tags: {
            where: { tag: { slug: { in: [CATATONIC_SLUG, OBOL_SLUG] } } },
            select: { quantity: true, tag: { select: { slug: true } } },
          },
        },
      },
    },
  });
}
