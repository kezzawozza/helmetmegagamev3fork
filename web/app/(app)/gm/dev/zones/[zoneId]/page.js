import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import AppHeader from "@/app/components/AppHeader";
import DevSubNav from "../../DevSubNav";
import ZoneForm from "./ZoneForm";
import LocationsList from "./LocationsList";

export default async function DevZonePage({ params }) {
  const { zoneId } = await params;
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");

  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    include: {
      locations: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { rooms: true } } },
      },
    },
  });
  if (!zone) notFound();

  const locations = zone.locations.map((l) => ({
    id: l.id,
    slug: l.slug,
    name: l.name,
    sortOrder: l.sortOrder,
    retiredAt: l.retiredAt ? l.retiredAt.toISOString() : null,
    roomCount: l._count.rooms,
    mirrored: Boolean(l.discordChannelId),
  }));

  return (
    <>
      <AppHeader title={zone.name} actions={<DevSubNav current="zones" />} />
      <PageShell width="wide">
        <p>
          <Link href="/gm/dev/zones" className="menu-item">
            ← All zones
          </Link>
        </p>
        <ZoneForm
          zone={{
            id: zone.id,
            slug: zone.slug,
            name: zone.name,
            kind: zone.kind,
            sortOrder: zone.sortOrder,
            description: zone.description,
            mapPolygon: zone.mapPolygon ? JSON.stringify(zone.mapPolygon) : "",
            mapLabelX: zone.mapLabelX,
            mapLabelY: zone.mapLabelY,
            updatedAt: zone.updatedAt.toISOString(),
          }}
        />
        <LocationsList zoneId={zone.id} rows={locations} canSuper={tier === "super"} />
      </PageShell>
    </>
  );
}
