// Working a gate, on either face — shared so Chat and the bot's button handlers don't carry two
// copies of the rules about who may touch a portcullis. Neither of these touches Discord: redrawing
// the watchtower's starter row after a flip stays bot-side, since the caller is handed back
// `locationIds` and does its own redraw.
const { gateOperable, endpoints, isHeldOpen, KEYED_OPEN_MS } = require("./locationGraph");

// `character` needs { id, locationId }. Working a gate reads nothing else — the winch is in the
// watchtower, so the room they clicked in already answered who they are.
const GATE_CHARACTER_SELECT = {
  id: true,
  name: true,
  locationId: true,
};

// Every refusal is a sentence a player reads, so both faces say the same one.
async function toggleGate(prisma, { character, linkId, actorDiscordUserId }) {
  if (!character) return { ok: false, error: "You don't have a living character." };

  const link = await prisma.locationLink.findUnique({ where: { id: linkId }, include: { a: true, b: true } });
  // Covers "not modular" — whatever a stale button claimed.
  if (!gateOperable(link)) return { ok: false, error: "There's no gate here." };
  if (character.locationId !== link.aId && character.locationId !== link.bId) {
    return { ok: false, error: "You aren't standing at that gate." };
  }

  const wantOpen = !link.isOpen;
  // The checks above read a snapshot; the flip must not trust it across time — a re-sync can turn
  // the edge into an ordinary way, and two watchmen can click in the same second. Lock, re-read, re-run.
  let outcome = "flipped";
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LocationLink" WHERE "id" = ${link.id} FOR UPDATE`;
    const fresh = await tx.locationLink.findUnique({ where: { id: link.id } });
    if (!gateOperable(fresh)) {
      outcome = "gone";
      return;
    }
    if (fresh.isOpen !== link.isOpen) {
      outcome = "raced";
      return;
    }
    await tx.locationLink.update({ where: { id: link.id }, data: { isOpen: wantOpen } });
  });
  if (outcome === "gone") return { ok: false, error: "There's no gate here to work." };
  if (outcome === "raced") return { ok: false, error: "Somebody just beat you to it." };

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: actorDiscordUserId ?? null,
      actionType: wantOpen ? "gate_opened" : "gate_closed",
      targetCharacterId: character.id,
      details: { linkId: link.id, between: [link.a.name, link.b.name], isOpen: wantOpen },
    },
  });

  const farName = endpoints(link, character.locationId).far.name;
  return {
    ok: true,
    opened: wantOpen,
    farName,
    // Both sides, for whichever face has an anchor to redraw.
    locationIds: [link.aId, link.bId],
    line: wantOpen ? `You open the way to ${farName}.` : `You shut the way to ${farName}.`,
  };
}

// The answer to "leave it open for the next 24 hours?" — the DM's Yes/No, and Chat's Hold open button.
// Re-checked rather than trusted: a DM is durable and the key can change hands between the crossing
// and the answer, so whoever answers must still hold it. A conditional updateMany against the window
// they were shown means two people propping the same door in the same moment can't stack two windows.
async function holdKeyedOpen(prisma, { discordUserId, linkId, hold }) {
  const link = await prisma.locationLink.findUnique({ where: { id: linkId }, include: { a: true, b: true } });
  if (!link?.keyed) return { ok: false, error: "There's no door here." };
  const between = `${link.a.name} and ${link.b.name}`;

  if (!hold) return { ok: true, held: false, line: `You closed the way between ${between}.` };

  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, tags: { select: { tag: { select: { slug: true } } } } },
  });
  const holdsKey = (character?.tags ?? []).some((ct) => ct.tag?.slug === link.requiredTagSlug);
  if (!holdsKey) return { ok: false, error: "You can no longer open that." };

  if (isHeldOpen(link)) {
    return { ok: false, error: `The way between ${between} is already being held open.` };
  }

  const openUntil = new Date(Date.now() + KEYED_OPEN_MS);
  const claim = await prisma.locationLink.updateMany({
    where: { id: link.id, OR: [{ openUntil: null }, { openUntil: { lte: new Date() } }] },
    data: { openUntil },
  });
  if (claim.count === 0) return { ok: false, error: "Somebody just beat you to it." };

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId ?? null,
      actionType: "keyed_way_held_open",
      targetCharacterId: character.id,
      details: { linkId: link.id, between: [link.a.name, link.b.name], openUntil: openUntil.toISOString() },
    },
  });

  return {
    ok: true,
    held: true,
    line: `You leave the way between ${between} open.`,
    note: "It stands open for 24 hours. Anyone can see and use it until then.",
  };
}

module.exports = { GATE_CHARACTER_SELECT, toggleGate, holdKeyedOpen };
