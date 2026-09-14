// Filing a tax collection. See docs/systemdocs (Tax).

import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getOpenTurn } from "@/lib/turn";
import { UserError } from "@/lib/actionResult";
import { sendDm } from "@/lib/discordGuild";
import { getMyFactionRole } from "@/lib/factionPermissions";
import { taxRoster } from "@lifeweb/db/lib/taxTargets";
import { fileTax } from "@lifeweb/db/lib/tax";
import { TAXMAN_SLUG } from "@lifeweb/db/lib/constants";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import {
  requireCharacter,
  revalidateAll,
  parseCount,
} from "./shared.js";

// --- Tax -------------------------------------------------------------

// `picks`/`obolPicks` are each { [characterId]: "amount" }, the StackRow
// shape — one currency apiece, since a PendingTax row is single-currency
// (schema.prisma's PendingTaxKind). Every entry is re-derived from a fresh
// taxRoster() rather than trusted from the client — the picker may be stale,
// and a stale row is dropped rather than errored.
export async function taxRequestImpl({ picks, obolPicks }) {
  const { character } = await requireCharacter({ needs: ACT });

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // Identity-revealing, the same posture as any other act that names you —
  // a hooded Leader taxing in their own voice would be the unmasking tool
  // the concealment system otherwise refuses to be.
  if (character.concealed) throw new UserError("You can't tax anyone while concealed.");

  if (!character.tags.some((ct) => ct.tag?.slug === TAXMAN_SLUG)) {
    throw new UserError("You don't have a tax button.");
  }

  const { isOfficer, isLeader } = await getMyFactionRole(character.discordUserId, character.factionId);
  if (!isOfficer) throw new UserError("You're not a Leader or Treasurer.");
  const taxerRole = isLeader ? "Leader" : "Treasurer";

  const roster = await taxRoster(prisma, character, { openTurnNumber: openTurn.number });
  const byId = new Map(roster.map((m) => [m.id, m]));

  function targetsFrom(rawPicks, kind, held) {
    const entries = Object.entries(rawPicks ?? {});
    const out = [];
    for (const [characterId, rawAmount] of entries) {
      const member = byId.get(characterId);
      // Stale client state — dropped silently, not errored (§10 of TAGS.md's
      // metagaming posture: the roster is what decides, never the post body).
      if (!member || !member.sameZone || member.lockedOut) continue;
      const cap = held(member);
      const amount = Math.min(parseCount(rawAmount, { min: 1, max: cap }) ?? 0, cap);
      if (amount <= 0) continue;
      out.push({ id: member.id, amount, kind });
    }
    return out;
  }

  const targets = [
    ...targetsFrom(picks, "RESOURCES", (m) => m.resources),
    ...targetsFrom(obolPicks, "OBOL", (m) => m.obols),
  ];
  if (targets.length === 0) throw new UserError("Nobody to tax.");

  // A duplicate row against the same target AND currency this turn would
  // just double the clamp math at close for no player-visible reason —
  // refuse it here. Resources and Obols are separate currencies, so taxing
  // one doesn't block filing the other against the same person this turn.
  const already = await prisma.pendingTax.findMany({
    where: { taxerId: character.id, turnId: openTurn.id, targetId: { in: targets.map((t) => t.id) }, declinedAt: null },
    select: { targetId: true, kind: true },
  });
  const alreadyKeys = new Set(already.map((r) => `${r.targetId}:${r.kind}`));
  const filedTargets = targets.filter((t) => !alreadyKeys.has(`${t.id}:${t.kind}`));
  if (filedTargets.length === 0) throw new UserError("You've already taxed them this turn.");

  const targetRows = await prisma.character.findMany({
    where: { id: { in: filedTargets.map((t) => t.id) } },
    select: { id: true, name: true, discordUserId: true },
  });
  const withNames = filedTargets.map((t) => ({ ...t, ...targetRows.find((r) => r.id === t.id) }));

  const { dms } = await fileTax(prisma, {
    taxer: character,
    taxerRole,
    turn: openTurn,
    targets: withNames,
  });

  after(() =>
    Promise.all(
      dms.map((dm) =>
        sendDm(dm.discordUserId, dm.content, { components: dm.components, meta: dm.meta, source: "player_event" }).catch(
          (err) => console.error(`Tax DM failed:`, err),
        ),
      ),
    ),
  );

  revalidateAll();
  return { pending: true };
}

