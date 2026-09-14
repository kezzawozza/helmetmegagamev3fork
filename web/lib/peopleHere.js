// The ONE roster behind every people-picker on /character; `isHere` re-checks the same predicate (db/lib/presence.js) server-side.
import { prisma } from "@lifeweb/db";
import { hereWhere } from "@lifeweb/db/lib/presence";

export { hereWhere, isHere, HERE_FIELDS, notHereMessage } from "@lifeweb/db/lib/presence";

export async function peopleHere(character, { includeDead = false, select } = {}) {
  if (!character?.locationId) return [];
  return prisma.character.findMany({
    where: hereWhere(character, { includeDead }),
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    select,
  });
}
