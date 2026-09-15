import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import AppHeader from "@/app/components/AppHeader";
import DevSubNav from "../../../DevSubNav";
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

  const stash = room.tags.map((rt) => ({ id: rt.id, tagId: rt.tag.id, slug: rt.tag.slug, name: rt.tag.name, quantity: rt.quantity }));

  return (
    <>
      <AppHeader title={room.name} actions={<DevSubNav current="zones" />} />
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
          resources={room.resources}
          stash={stash}
          seededStashSlugs={room.seededStashSlugs}
          canSuper={tier === "super"}
        />
      </PageShell>
    </>
  );
}
