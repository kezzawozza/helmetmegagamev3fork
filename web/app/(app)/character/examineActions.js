"use server";

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { lastSightings } from "@lifeweb/db/lib/sightings";
import { examineRow } from "@lifeweb/db/lib/examineRow";
import { examineBlock } from "@lifeweb/db/lib/examineVision";
import { isDaylight } from "@lifeweb/db/lib/turnClock";
import { ghostCharacterFor } from "@lifeweb/db/lib/ghost";

// Examine — looking at somebody you have HEARD. Moves nothing, costs nothing,
// spends no Move, writes no audit row. The subject must have said something
// you heard this turn (db/lib/sightings.js); the reading is frozen at that
// line rather than re-read live. /conceal still gives the hood's impoverished
// read. The readout is db/lib/examine.js, shared with the reaction handler so
// the two surfaces can't drift on the doctor's eye or what "visible" means.

const LOOKER_SELECT = {
  id: true,
  locationId: true,
  factionId: true,
  discordUserId: true,
  // for examineVision.js: spectacles only correct sight while worn, Sun Sensitivity only blinds outdoors.
  tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true } } } },
  location: { select: { indoors: true } },
};

// The looker, from the session and never from a posted id — a server action is a public endpoint.
//
// A GHOST looks too (db/lib/ghost.js). Watching the whole board and being unable to look at any of
// it was a gap, not a rule — the seat is for watching. They look as their last body, so a doctor who
// died still reads a wound the way they always did, and the place gate is the same one their feed
// already answers to. `ghost` rides back with them because every gate below has to know.
async function looker() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: LOOKER_SELECT,
  });
  if (me) return { me, ghost: false };

  const dead = await ghostCharacterFor(prisma, session.discordUserId);
  if (dead) {
    const body = await prisma.character.findUnique({ where: { id: dead.id }, select: LOOKER_SELECT });
    if (body) return { me: body, ghost: true };
  }
  throw new UserError("No living character.");
}

// The vision gate, asked before either action does any work — the greyed button on the sheet is a hint, this is the lock.
//
// A ghost is exempt. Every block it applies — a blindfold, spectacles left behind, the dark, Sun
// Sensitivity outdoors — is something that happens to a body, and a ghost's is on the floor. Their
// corpse is still wearing the tags, so without this a blindfolded death would follow them.
async function blockedFromLooking(me, ghost) {
  if (ghost) return null;
  return examineBlock(me.tags, { daylight: isDaylight(), indoors: me.location?.indoors ?? true });
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
    const { me, ghost } = await looker();
    // A ghost stands nowhere, so the Location check is theirs to skip — their scope is every place
    // their seat reads, not a room.
    if (!ghost && !me.locationId) return { people: [] };

    // Refused here as well as in examineCharacter(), so a blinded player never
    // gets a roster of who's around them as a consolation prize.
    const blocked = await blockedFromLooking(me, ghost);
    if (blocked) throw new UserError(blocked);

    // Label and hood flag come off the LINE they spoke, so a mask pulled on
    // since still lists under the old name, and silence never lists at all.
    const seen = await lastSightings(prisma, me, { ghost, discordUserId: me.discordUserId });

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
    const { me, ghost } = await looker();

    const blocked = await blockedFromLooking(me, ghost);
    if (blocked) throw new UserError(blocked);

    const seen = await lastSightings(prisma, me, { ghost, discordUserId: me.discordUserId });
    const sighting = seen.get(String(targetId ?? ""));
    if (!sighting) throw new UserError("You haven't heard them say anything.");

    // looker() already selects exactly what examineRow wants — the two lists
    // are the same list, and VIEWER_SELECT is where it is written down.
    const result = await examineRow(prisma, me, sighting.seq, { ghost });
    if (!result) throw new UserError("You can't see them.");
    if (result.blocked) throw new UserError(result.blocked);
    return { readout: result.readout };
  });
}
