import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import CraftsView from "./CraftsView";
import Loading from "../../Skeleton";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";

// Every craft project, running or done — the pocket-item twin of
// /gm/structures. A running project is otherwise invisible to a GM: it
// lives on one player's sheet, its spent ingredients live in
// CraftProject.consumed, and the audit rows only say it started. This page
// is the read; the repair, when one is needed, stays by hand on /gm/dev,
// with the Spent column saying exactly what went in. Open to every GM, no
// rail item — reachable through ⌘K, like /gm/structures.
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshCrafts in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function CraftsPage() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="gm-crafts" userId={session.discordUserId} render={CraftsView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshCrafts userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshCrafts({ userId }) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!isGm) redirect("/character");

  const rows = await prisma.craftProject.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      character: { select: { name: true } },
      tag: { select: { name: true } },
    },
  });

  // Turn numbers in one extra query — CraftProject stores turn ids as plain
  // strings (snapshot posture, no relation), the same shape the Depot ledger
  // resolves.
  const turnIds = [
    ...new Set(
      rows.flatMap((r) => [r.startedTurnId, r.lastTurnId]).filter(Boolean),
    ),
  ];
  const turnNumbers = new Map(
    turnIds.length
      ? (
          await prisma.turn.findMany({
            where: { id: { in: turnIds } },
            select: { id: true, number: true },
          })
        ).map((t) => [t.id, t.number])
      : [],
  );

  const projects = rows.map((row) => ({
    id: row.id,
    characterName: row.character?.name ?? "—",
    tagName: row.tag?.name ?? "—",
    quantity: row.quantity,
    status: row.status,
    turnsDone: row.turnsDone,
    turnsNeeded: row.turnsNeeded,
    resourcesCost: row.resourcesCost ?? 0,
    payerName: row.payerName ?? "—",
    // What the start consumed, readable — the snapshot a by-hand reversal
    // hands back (shape: the `replaced` list, CRAFTING.md §3).
    spent: Array.isArray(row.consumed)
      ? row.consumed
          .map((c) => (c?.quantity > 1 ? `${c.quantity}× ${c.tagName}` : c?.tagName))
          .filter(Boolean)
          .join(", ")
      : "",
    // The words a customizable project is carrying to its finishing turn.
    customName:
      row.custom && typeof row.custom === "object" ? (row.custom.name ?? "") : "",
    startedTurn: turnNumbers.get(row.startedTurnId) ?? null,
    lastTurn: turnNumbers.get(row.lastTurnId) ?? null,
    createdAtMs: row.createdAt.getTime(),
  }));

  return (
    <SnapshotFresh
      scope="gm-crafts"
      userId={userId}
      data={{
        projects: projects,
      }}
    />
  );
}
