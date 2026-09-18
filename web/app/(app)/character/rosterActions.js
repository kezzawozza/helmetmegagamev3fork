"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { loadPeoplePools, loadStashRooms } from "@/lib/peoplePools";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { resourcesOf } from "@lifeweb/db/lib/resourceStack";
import { cookedTasteOnly } from "@/lib/referenceData";
import { whosHere } from "@lifeweb/db/lib/whosHere";
import { HEAL_SKILL_SELECT } from "@/lib/healRequests";

// "What can I see from here" — the reads a player-action dialog makes on
// open (useRoster.js), so the roster is current, not the page's render-time
// one. Character always the session's own. Every list is the same helper the
// sheet page and /chat build theirs from (web/lib/peoplePools.js). `need`
// names which slices to pay for.

async function me() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in." };
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      role: { select: { slug: true } },
      tags: {
        include: {
          // HEAL_SKILL_SELECT, not `name` alone — this is what the Heal dialog actually paints from.
          tag: { include: { group: true, requirementSkills: { select: HEAL_SKILL_SELECT } } },
        },
      },
    },
  });
  if (!character) return { error: "You have no living character." };
  return { session, character };
}

export async function loadActionRoster({ need = [] } = {}) {
  const who = await me();
  if (who.error) return { ok: false, error: who.error };
  const { session, character } = who;
  const wants = new Set(Array.isArray(need) ? need.map(String) : []);
  const out = { ok: true };

  const openTurn = wants.has("people") ? await getOpenTurn() : null;
  const [people, rooms, gameConfig] = await Promise.all([
    wants.has("people")
      ? loadPeoplePools(character, { discordUserId: session.discordUserId, openTurn })
      : null,
    wants.has("rooms") ? loadStashRooms(character) : null,
    wants.has("self") ? prisma.gameConfig.findUnique({ where: { id: 1 } }) : null,
  ]);

  if (people) {
    out.people = {
      examineBlocked: people.examineBlocked,
      canHeal: people.canHeal,
      healsLeft: people.healsLeft,
      healTargets: people.healTargets,
      canMiracle: people.canMiracle,
      miraclesLeft: people.miraclesLeft,
      miracleTargets: people.miracleTargets,
      peopleParties: people.peopleParties,
      transferParties: people.transferParties,
      lootTargets: people.lootTargets,
      bindTargets: people.bindTargets,
      collarTargets: people.collarTargets,
      collarOthers: people.collarOthers,
      harmTargets: people.harmTargets,
      harmTags: people.harmTags,
      kissTargets: people.kissTargets,
      searchParties: people.searchParties,
    };
  }
  if (wants.has("rooms")) out.rooms = rooms ?? [];
  if (wants.has("corpses")) {
    // Same already-filtered door list the server re-check uses (CORPSES.md).
    const keys = await roomAccessKeys(prisma, character.id);
    const rows = character.locationId
      ? await prisma.room.findMany({
          where: { locationId: character.locationId },
          select: { id: true, name: true, kind: true, accessTagSlugs: true },
        })
      : [];
    out.corpses = await corpsesInReach(prisma, character, {
      rooms: accessibleRooms(rows, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds),
    });
  }
  if (wants.has("self")) {
    out.self = {
      // Same include as the sheet's: `cooked` down to its taste, `cookedFrom` gone (COOKING.md).
      characterTags: character.tags.map((ct) => {
        const tag = cookedTasteOnly(ct.tag);
        return tag === ct.tag ? ct : { ...ct, tag };
      }),
      resources: resourcesOf(character),
      carry: carryStatus(character, gameConfig),
    };
  }
  return out;
}

// Who is standing where you are, as db/lib/whosHere.js answers it — the same
// rows the "Who's here?" Discord button gives. Lives here because the HERE
// list is drawn on the sheet (CharacterSheet.js) as well as /chat.
// withSightings gives a row its face and eye (db/lib/sightings.js); the
// Discord button asks without it.
export async function loadPeopleHere() {
  const who = await me();
  if (who.error) return { ok: false, error: who.error };
  const rows = await whosHere(prisma, who.character, { withSightings: true, withAcross: true });
  return { ok: true, ...rows };
}
