import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import AppHeader from "@/app/components/AppHeader";
import LocationForm from "./LocationForm";
import YieldPanel from "./YieldPanel";
import RoomsList from "./RoomsList";
import LinksPanel from "./LinksPanel";
import { ATTRIBUTES } from "@lifeweb/db/lib/locationAttributes";

export default async function DevLocationPage({ params }) {
  const { locationId } = await params;
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: {
      zone: { select: { id: true, name: true } },
      yields: true,
      rooms: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      linksA: { include: { b: { select: { id: true, name: true } } } },
      linksB: { include: { a: { select: { id: true, name: true } } } },
    },
  });
  if (!location) notFound();

  const yields = location.yields.map((y) => ({ kind: y.kind, base: y.base, current: y.current }));
  const rooms = location.rooms.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    retiredAt: r.retiredAt ? r.retiredAt.toISOString() : null,
    mirrored: Boolean(r.discordThreadId),
  }));
  const links = [
    ...location.linksA.map((l) => ({ id: l.id, otherId: l.b.id, otherName: l.b.name })),
    ...location.linksB.map((l) => ({ id: l.id, otherId: l.a.id, otherName: l.a.name })),
  ];

  return (
    <>
      <AppHeader title={location.name} actions={
        <Link href="/gm/dev?s=zones" className="btn-quiet">
          &larr; Zones
        </Link>
      } />
      <PageShell width="wide">
        <p>
          <Link href={`/gm/dev/zones/${location.zone.id}`} className="menu-item">
            ← {location.zone.name}
          </Link>
        </p>
        <LocationForm
          location={{
            id: location.id,
            slug: location.slug,
            name: location.name,
            indoors: location.indoors,
            sortOrder: location.sortOrder,
            description: location.description,
            attributes: location.attributes ?? {},
            updatedAt: location.updatedAt.toISOString(),
          }}
          attributeSchema={Object.entries(ATTRIBUTES).map(([key, entry]) => ({
            key,
            type: entry.type ?? "boolean",
            options: entry.options ?? null,
          }))}
        />
        <YieldPanel locationId={location.id} rows={yields} />
        <RoomsList locationId={location.id} rows={rooms} canSuper={tier === "super"} />
        <LinksPanel locationId={location.id} links={links} />
      </PageShell>
    </>
  );
}
