import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getDevTier } from "@/lib/devAccess";
import PageShell from "@/app/components/PageShell";
import AppHeader from "@/app/components/AppHeader";
import DevSubNav from "../DevSubNav";
import ZonesTable from "./ZonesTable";

// /gm/dev/zones — the place editor's landing page: every Zone, its mirror
// footprint, and a Create form. See docs/systemdocs/DEV-PANEL.md.
export default async function DevZonesPage() {
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");

  const zones = await prisma.zone.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { locations: true } } },
  });

  const rows = zones.map((z) => ({
    id: z.id,
    slug: z.slug,
    name: z.name,
    kind: z.kind,
    sortOrder: z.sortOrder,
    retiredAt: z.retiredAt ? z.retiredAt.toISOString() : null,
    locationCount: z._count.locations,
    mirrored: Boolean(z.discordCategoryId),
  }));

  return (
    <>
      <AppHeader title={`Zones (${zones.length})`} actions={<DevSubNav current="zones" />} />
      <PageShell width="wide">
        <ZonesTable rows={rows} canSuper={tier === "super"} />
      </PageShell>
    </>
  );
}
