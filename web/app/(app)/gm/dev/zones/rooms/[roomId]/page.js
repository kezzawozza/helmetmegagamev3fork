import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { resourcesOf, withoutResources } from "@lifeweb/db/lib/resourceStack";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import RoomForm from "./RoomForm";
import StashPanel from "./StashPanel";

export default async function DevRoomPage({ params }) {
  const { roomId } = await params;
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      location: { select: { id: true, name: true, zone: { select: { name: true } } } },
      tags: { include: { tag: { select: { id: true, slug: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!room) notFound();

  // ⬢ come out of the item list and go to the chip above it — they are a
  // stack row like everything else now, and a GM reading "12 ⬢" over a
  // "Resources ×12" line would reasonably think the room held both.
  const stash = withoutResources(room.tags)
    .map((rt) => ({ id: rt.id, tagId: rt.tag.id, slug: rt.tag.slug, name: rt.tag.name, quantity: rt.quantity }));

  return (
    <>
      <PageShell width="wide">
        <p>
          <Link href={`/gm/dev/zones/locations/${room.location.id}`} className="menu-item">
            ← {room.location.zone.name} · {room.location.name}
          </Link>
        </p>
        <RoomForm
          room={{
            id: room.id,
            slug: room.slug,
            name: room.name,
            kind: room.kind,
            sortOrder: room.sortOrder,
            description: room.description,
            soundproof: room.soundproof,
            destroysContents: room.destroysContents,
            accessTagSlugs: room.accessTagSlugs.join(", "),
            updatedAt: room.updatedAt.toISOString(),
          }}
        />
        <StashPanel
          roomId={room.id}
          resources={resourcesOf(room)}
          stash={stash}
          seededStashSlugs={room.seededStashSlugs}
          canSuper={tier === "super"}
        />
      </PageShell>
    </>
  );
}
