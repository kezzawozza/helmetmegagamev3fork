"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { loadPeoplePools, loadStashRooms } from "@/lib/peoplePools";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { cookedTasteOnly } from "@/lib/referenceData";
import { whosHere } from "@lifeweb/db/lib/whosHere";
import { HEAL_SKILL_SELECT } from "@/lib/healRequests";
import { getMyFactionRole } from "@/lib/factionPermissions";
import { taxRoster, taxesFiledThisTurn } from "@lifeweb/db/lib/taxTargets";
import { TAXMAN_SLUG } from "@lifeweb/db/lib/constants";

// "What can I see from here" — the reads a player-action dialog makes the
// moment it opens (web/app/components/actions/useRoster.js), so the roster it
// offers is the roster standing there now, not the one the page rendered with.
//
// The character is always the session's own; nothing here takes an id. Every
// list is the same helper the sheet page and /chat build theirs from
// (web/lib/peoplePools.js), so the dialog, the page and the server's own
// re-check cannot disagree about who is in reach. `need` names which slices
// to pay for: a Bind dialog does not want the room stashes.

async function me() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in." };
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      role: { select: { slug: true } },
      tags: {
        include: {
          // HEAL_SKILL_SELECT, not `name` alone: this is the query the Heal
          // dialog actually paints from (useRoster refetches through here on
          // open and overwrites the page's seed), so a subset here breaks the
          // dialog even when the sheet's own query is right.
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

  const openTurn = wants.has("people") || wants.has("tax") ? await getOpenTurn() : null;
  const [people, rooms, gameConfig, tax] = await Promise.all([
    wants.has("people")
      ? loadPeoplePools(character, { discordUserId: session.discordUserId, openTurn })
      : null,
    wants.has("rooms") ? loadStashRooms(character) : null,
    wants.has("self") ? prisma.gameConfig.findUnique({ where: { id: 1 } }) : null,
    wants.has("tax") ? loadTaxRoster(character, openTurn) : null,
  ]);

  if (people) {
    out.people = {
      examineBlocked: people.examineBlocked,
      canHeal: people.canHeal,
      healsLeft: people.healsLeft,
      healTargets: people.healTargets,
      peopleParties: people.peopleParties,
      transferParties: people.transferParties,
      lootTargets: people.lootTargets,
      bindTargets: people.bindTargets,
      harmTargets: people.harmTargets,
      harmTags: people.harmTags,
      kissTargets: people.kissTargets,
    };
  }
  if (wants.has("rooms")) out.rooms = rooms ?? [];
  if (wants.has("tax")) out.tax = tax ?? { canTax: false, members: [], rooms: [] };
  if (wants.has("corpses")) {
    // The same already-filtered door list the server re-check uses, so a
    // locked room's floor is never a scouting target (CORPSES.md).
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
      // Same include as the sheet's, so the same cut: `cooked` down to its
      // taste, `cookedFrom` gone (docs/systemdocs/COOKING.md).
      characterTags: character.tags.map((ct) => {
        const tag = cookedTasteOnly(ct.tag);
        return tag === ct.tag ? ct : { ...ct, tag };
      }),
      resources: character.resources,
      carry: carryStatus(character, gameConfig),
    };
  }
  return out;
}

// Who is standing where you are, as db/lib/whosHere.js answers it — the same
// rows the "Who's here?" button on the Discord anchor gives. Was in
// play/actions.js; it lives here now because the HERE list is drawn on the
// character sheet (CharacterSheet.js) as well as /chat. (/ledger, which the
// old comment named, is a bare redirect to /character now.) withSightings is what gives a row its face and its eye
// (db/lib/sightings.js); the Discord button asks without it, because a list
// of names has no faces to withhold.
// TaxDialog's roster: the character's own faction (with each member's ⬢),
// the resources sitting in every room they can reach in their own zone, and
// whether they may tax at all. isOfficer is re-checked at file time too —
// this is what the dialog shows, never what the server trusts.
async function loadTaxRoster(character, openTurn) {
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  const canTax = heldSlugs.has(TAXMAN_SLUG) && !character.concealed;
  if (!canTax || !character.factionId) return { canTax: false, members: [], rooms: [] };

  const { isOfficer } = await getMyFactionRole(character.discordUserId, character.factionId);
  if (!isOfficer) return { canTax: false, members: [], rooms: [] };

  const [members, rooms, filed] = await Promise.all([
    taxRoster(prisma, character, { openTurnNumber: openTurn?.number ?? null }),
    loadStashRooms(character, { scope: "zone" }),
    taxesFiledThisTurn(prisma, character.id, openTurn?.id),
  ]);
  return { canTax: true, members, rooms, filed };
}

export async function loadPeopleHere() {
  const who = await me();
  if (who.error) return { ok: false, error: who.error };
  const rows = await whosHere(prisma, who.character, { withSightings: true, withAcross: true });
  return { ok: true, ...rows };
}
