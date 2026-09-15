import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import AppHeader from "@/app/components/AppHeader";
import DevSubNav from "../../DevSubNav";
import LinksTable from "./LinksTable";

export default async function DevLinksPage() {
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");

  const [links, locations] = await Promise.all([
    prisma.locationLink.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        a: { select: { id: true, name: true, zone: { select: { name: true } } } },
        b: { select: { id: true, name: true, zone: { select: { name: true } } } },
      },
    }),
    prisma.location.findMany({
      where: { retiredAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, zone: { select: { name: true } } },
    }),
  ]);

  const rows = links.map((l) => ({
    id: l.id,
    aId: l.a.id,
    aName: `${l.a.zone.name} · ${l.a.name}`,
    bId: l.b.id,
    bName: `${l.b.zone.name} · ${l.b.name}`,
    announce: l.announce,
    hidden: l.hidden,
    modular: l.modular,
    isOpen: l.isOpen,
    authoredOpen: l.authoredOpen,
    keyed: l.keyed,
    openUntil: l.openUntil ? l.openUntil.toISOString() : null,
    onFoot: l.onFoot,
    requiredTagSlug: l.requiredTagSlug ?? "",
    updatedAt: l.updatedAt.toISOString(),
  }));

  const locationOptions = locations.map((l) => ({ id: l.id, label: `${l.zone.name} · ${l.name}` }));

  return (
    <>
      <AppHeader title={`Travel links (${links.length})`} actions={<DevSubNav current="zones" />} />
      <PageShell width="wide">
        <LinksTable rows={rows} locationOptions={locationOptions} canSuper={tier === "super"} />
      </PageShell>
    </>
  );
}
