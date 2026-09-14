// Who a character can act on from their sheet: people at the same Location who haven't hidden their
// face, plus the unburied dead for body actions. The ONE roster behind every people-picker on
// /character; `isHere` is the server-side re-check every action runs on a posted id — both read the
// same predicate (db/lib/presence.js) so the menu and the gate can't disagree.
import { prisma } from "@lifeweb/db";
import { hereWhere } from "@lifeweb/db/lib/presence";

export { hereWhere, isHere, HERE_FIELDS, notHereMessage } from "@lifeweb/db/lib/presence";

// Everyone here, name-sorted, with the caller's `select`. Nowhere is nobody.
export async function peopleHere(character, { includeDead = false, select } = {}) {
  if (!character?.locationId) return [];
  return prisma.character.findMany({
    where: hereWhere(character, { includeDead }),
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    select,
  });
}
