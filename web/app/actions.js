"use server";

import { randomUUID } from "crypto";
import { signIn, signOut } from "@/lib/auth";
import { isLocalMode } from "@lifeweb/db/lib/localMode";
import { prisma, addCharacterResources } from "@lifeweb/db";
import { randomCharacterName } from "@lifeweb/db/lib/nameCorpus";
import { formatCharacterName, GENDERS } from "@/lib/characterName";

export async function signInWithDiscord() {
  await signIn("discord");
}

// A server action is a public endpoint, so this re-checks LOCAL_MODE itself
// rather than trusting that the button which calls it was only rendered
// under it — belt-and-suspenders alongside auth.js only registering the
// "local" provider under the same flag.
export async function signInLocally() {
  if (!isLocalMode()) throw new Error("Local sign-in is only available under LOCAL_MODE.");
  await signIn("local");
}

// The other LOCAL_MODE door in, beside signInLocally above: that one always
// signs in as the superadmin id and leaves the sheet empty, which is the
// wrong shape for testing anything a PLAYER sees rather than a GM panel —
// the wizard, the lobby and every /gm/* tool all still reach for a character
// that was never there. This rolls a fresh identity and a stock Migrant to
// go with it, so the click lands on an ordinary sheet immediately.
//
// A new discordUserId every time, on purpose: repeatable, disposable, and
// never collides with a character an earlier click left behind. Nothing here
// touches Discord — no role, no channel access, no nickname — since none of
// it is real under LOCAL_MODE anyway and the whole point is testing the web
// app, not the bot.
export async function startAsLocalPlayer() {
  if (!isLocalMode()) throw new Error("Local sign-in is only available under LOCAL_MODE.");

  const role = await prisma.role.findUnique({
    where: { slug: "migrant" },
    include: { startingLocation: { include: { zone: true } } },
  });
  if (!role) throw new Error('No "migrant" role in the catalog — run npm run db:sync-roles first.');

  const discordUserId = `local-player-${randomUUID().slice(0, 8)}`;
  const gender = GENDERS[Math.floor(Math.random() * GENDERS.length)];
  const { firstName, lastName } = randomCharacterName({ gender });

  const character = await prisma.character.create({
    data: {
      discordUserId,
      firstName,
      lastName,
      gender,
      name: formatCharacterName({ firstName, lastName }),
      status: "ALIVE",
      roleId: role.id,
      roleTitle: role.name,
      factionId: role.factionId,
      // The denormalization contract: locationId and location.zoneId travel
      // together (ARCHITECTURE.md §6).
      locationId: role.startingLocationId ?? null,
      zoneId: role.startingLocation?.zoneId ?? null,
    },
  });
  // Starting ⬢ is a stack now, not a column on the create — grant it once the
  // row exists (db/lib/resourceStack.js).
  await addCharacterResources(prisma, character.id, role.startingResources);

  await signIn("local", { playerId: discordUserId, redirectTo: "/character" });
}

export async function signOutOfDiscord() {
  await signOut();
}
