"use server";

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { lastSightings } from "@lifeweb/db/lib/sightings";
import { examineRow } from "@lifeweb/db/lib/examineRow";
import { examineBlock } from "@lifeweb/db/lib/examineVision";

// Examine — looking at somebody you have HEARD. Moves nothing, costs nothing,
// spends no Move, writes no audit row. The subject must have said something
// you heard this turn (db/lib/sightings.js); the reading is frozen at that
// line rather than re-read live. /conceal still gives the hood's impoverished
// read. The readout is db/lib/examine.js, shared with the reaction handler so
// the two surfaces can't drift on the doctor's eye or what "visible" means.

// The looker, from the session and never from a posted id — a server action is a public endpoint.
async function looker() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      locationId: true,
      factionId: true,
      discordUserId: true,
      // for examineVision.js: spectacles only correct sight while worn, Sun Sensitivity only blinds outdoors.
      tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true } } } },
      location: { select: { indoors: true } },
    },
  });
  if (!me) throw new UserError("No living character.");
  return me;
}

// The vision gate, asked before either action does any work — the greyed button on the sheet is a hint, this is the lock.
async function blockedFromLooking(me) {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { phase: true } });
  return examineBlock(me.tags, { phase: openTurn?.phase ?? null, indoors: me.location?.indoors ?? true });
}

// Who you can look at: everyone you have heard speak this turn, INCLUDING the
// concealed — deliberately not a roster of who's standing here
// (db/lib/presence.js). A hood takes you off every other people-picker, but
// looking at a hooded figure is the point of a hood, so it stays here under
// its alias, listed by who you NOTICED rather than who's nearby (so the
// dialog can't be used as a presence oracle). Fetched on open, not baked into
// the page render, so the sheet never carries a list of who's around you.
export async function peopleToExamine() {
  return guarded(async () => {
    const me = await looker();
    if (!me.locationId) return { people: [] };

    // Refused here as well as in examineCharacter(), so a blinded player never
    // gets a roster of who's around them as a consolation prize.
    const blocked = await blockedFromLooking(me);
    if (blocked) throw new UserError(blocked);

    // Label and hood flag come off the LINE they spoke, so a mask pulled on
    // since still lists under the old name, and silence never lists at all.
    const seen = await lastSightings(prisma, me);

    return {
      people: [...seen.entries()]
        .map(([id, sighting]) => ({ id, label: sighting.name, concealed: sighting.concealed }))
        .sort((a, b) => Number(a.concealed) - Number(b.concealed) || (a.label ?? "").localeCompare(b.label ?? "")),
    };
  });
}

// One look, at the line you heard them say. The seq resolves server-side into
// a speaker, hood and readout (db/lib/examineRow.js) — the same path 🔍 takes
// in Discord and both eyes take on /chat. Subject is re-resolved from the
// sighting, never trusted from the dialog.
export async function examineCharacter(targetId) {
  return guarded(async () => {
    const me = await looker();

    const blocked = await blockedFromLooking(me);
    if (blocked) throw new UserError(blocked);

    const seen = await lastSightings(prisma, me);
    const sighting = seen.get(String(targetId ?? ""));
    if (!sighting) throw new UserError("You haven't heard them say anything.");

    // looker() already selects exactly what examineRow wants — the two lists
    // are the same list, and VIEWER_SELECT is where it is written down.
    const result = await examineRow(prisma, me, sighting.seq);
    if (!result) throw new UserError("You can't see them.");
    if (result.blocked) throw new UserError(result.blocked);
    return { readout: result.readout };
  });
}
