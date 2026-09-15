import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import TagCatalogView from "./TagCatalogView";
import Loading from "./Skeleton";
import { DESIRE_UNLOCK_SELECT } from "@/lib/referenceData";
import { paperDescriptionGm, paperViewGm } from "@lifeweb/db/lib/paper";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";

// The tag catalog, with a Create dialog for GM-authored tags.
//
// YAML-sourced rows are read-only here on purpose: docs/tags.yaml is their
// source of truth and syncTags would revert a UI edit on its next run. Only
// rows carrying Tag.custom are editable, and only a superadmin may delete one.
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshDevTags in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function DevTagsPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="gm-dev-tags" userId={session.discordUserId} render={TagCatalogView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshDevTags userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshDevTags({ userId }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [tags, groups, counts] = await Promise.all([
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        group: { select: { id: true, name: true, color: true } },
        // id as well as name: the detail sheet only needs the name, but the
        // edit dialog's cure-ladder picker has to resolve the relation back
        // to the ids it posts.
        requirementSkills: { select: { id: true, name: true } },
        // The detail sheet's "Unlocks N Desires" block. Unfiltered here on
        // purpose — /gm/dev/tags is the GM's unfiltered view of the catalog.
        ...DESIRE_UNLOCK_SELECT,
      },
    }),
    prisma.tagGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.characterTag.groupBy({ by: ["tagId"], _count: { tagId: true } }),
  ]);

  const heldCount = new Map(counts.map((c) => [c.tagId, c._count.tagId]));

  return (
    <SnapshotFresh
      scope="gm-dev-tags"
      userId={userId}
      data={{
        tags: tags.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          category: t.category,
          // A GM reads a letter ungated (PAPERWORK.md). Both helpers pass a
          // non-paper row straight through, so this is a no-op for the
          // catalog and the one thing that makes a player's note legible here.
          // `paperText` itself never crosses — this DTO names its columns.
          description: paperDescriptionGm(t),
          paper: paperViewGm(t),
          paperKind: t.paperKind,
          // Catalog or runtime-minted, for the browser's Minted tab.
          ephemeral: t.ephemeral,
          pointCost: t.pointCost,
          custom: t.custom,
          groupId: t.groupId,
          groupName: t.group?.name ?? null,
          inspectVisibility: t.inspectVisibility,
          stackable: t.stackable,
          equippable: t.equippable,
          concealsIdentity: t.concealsIdentity,
          forcesConceal: t.forcesConceal,
          concealSprite: t.concealSprite,
          equipSlot: t.equipSlot,
          equipLayer: t.equipLayer,
          meleeArmor: t.meleeArmor,
          ballisticArmor: t.ballisticArmor,
          // The detail sheet's "Weighs …" flag — `tradeable` below is the
          // other half of the rule (web/lib/formatTagWeight.js).
          weightLbs: t.weightLbs,
          forcedName: t.forcedName,
          consumable: t.consumable,
          removable: t.removable,
          tradeable: t.tradeable,
          craftable: t.craftable,
          healable: t.healable,
          teachable: t.teachable,
          purchasable: t.purchasable,
          purchasableAfterStart: t.purchasableAfterStart,
          mastery: t.mastery,
          defaultDurationTurns: t.defaultDurationTurns,
          sellable: t.sellable,
          sellablePrice: t.sellablePrice,
          // Everything below feeds the read-only detail sheet: the tier chain
          // and prerequisite links (walked client-side over this same list),
          // the consume/expiry targets, and the requirement block.
          groupColor: t.group?.color ?? null,
          // The nested shape ChipLabel/TagChip read (`tag.group.color`);
          // `groupColor` above stays for the detail sheet's own flat lookups.
          group: t.group ?? null,
          parentTagId: t.parentTagId,
          requiredTagId: t.requiredTagId,
          consumesInto: t.consumesInto,
          expiresInto: t.expiresInto,
          removesInto: t.removesInto,
          // The medical pass's item-cure fields (TAGS.md §5c).
          cures: t.cures,
          curesInto: t.curesInto,
          administerable: t.administerable,
          administerSkill: t.administerSkill,
          requirementTurns: t.requirementTurns,
          // Without this a `turnsCost: 1/N` cure's detail sheet (formatTagRequirement,
          // via TagDetailSheet) showed a flat "1 turn" instead of its real
          // fraction (review fix, round 3 — same gap as the examine/catalog
          // selects fixed the round before).
          requirementPerTurn: t.requirementPerTurn,
          requirementResources: t.requirementResources,
          requirementGambit: t.requirementGambit,
          requirementSkills: t.requirementSkills,
          held: heldCount.get(t.id) ?? 0,
        })),
        groups: groups,
        categories: [...new Set(tags.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
        canDelete: isSuperadmin(session.discordUserId),
      }}
    />
  );
}
