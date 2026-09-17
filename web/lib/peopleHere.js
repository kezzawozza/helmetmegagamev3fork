// The ONE roster behind every people-picker on /character and /chat, in two
// halves: the people whose faces you can see, and the people in masks. A hood
// hides WHO somebody is, never THAT they are standing there, so both halves feed
// every picker that acts on a body (PROXYING.md §5).
//
// ONE PREDICATE DECIDES THE SPLIT, and it is not this file's. `presentRows` in
// db/lib/whosHere.js is where "is this person hidden from this viewer" is
// answered, and `resolveHoodToken` reads the same answer — so a row offered
// under a token always resolves back to somebody.
//
// It used to split with hereWhere()'s SQL on one side and presentRows on the
// other, and those two disagree in both directions. The damage was not
// theoretical:
//
//   * A masked CORPSE. hereWhere's dead arm is `{ status: DEAD, buriedAt: null }`
//     and knows nothing about Character.deathMaskTagId, so a body that died in a
//     helmet came back in the NAMED half under its real name and real id — and
//     in the hooded half under its alias, the same inventory listed twice in one
//     Loot dropdown. /api/avatar/<id> is ungated, so that id is the face.
//   * Speak hooded, then `/conceal off`. The columns say unconcealed; your
//     viewer's SIGHTING still says hooded (db/lib/sightings.js — a sighting is
//     frozen at the last line you heard). You landed in both halves at once,
//     alias beside real name.
//   * The mirror: spoke bare-faced, then put on a forcing helm. hereWhere drops
//     you for the helm, the sighting drops you from the hooded half, and you
//     fell out of every picker on the page.
//
// So both halves are now taken from the same `whosHere` answer, and this file's
// only remaining job is shaping the rows.
import { prisma } from "@lifeweb/db";
import { hereWhere } from "@lifeweb/db/lib/presence";
import { whosHere } from "@lifeweb/db/lib/whosHere";

export { hereWhere, isHere, HERE_FIELDS, notHereMessage } from "@lifeweb/db/lib/presence";

const NAME_ORDER = [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }];

// What a picker calls somebody, and what it posts back for them. Both halves
// already carry the presented name — the one the VIEWER holds, forced names and
// aliases resolved — so neither of these re-derives anything.
export function pickerName(row) {
  return row?.name ?? "somebody";
}
export function pickerKey(row) {
  return row?.hooded ? row.id : `character:${row.id}`;
}

// Both halves, from one room read and one row read.
//
//   named   real ids, and the name the viewer HOLDS for them.
//   hooded  "hood:<token>" for an id, the alias for a name, `hooded: true`.
//           The real id and real name are stripped on the way out rather than
//           never selected, so a caller cannot leak one by writing its `select`
//           carelessly — shipping an id IS the unmasking.
//
// `room` lets a caller that has already asked whosHere hand the answer in
// rather than paying for it twice.
export async function rosterHere(character, { includeDead = false, select, room = null } = {}) {
  if (!character?.locationId) return { named: [], hooded: [], room: null };
  const answer =
    room ??
    (await whosHere(prisma, character, {
      includeSelf: false,
      includeDead,
      withSightings: true,
      withHoodIds: true,
    }));

  const hoodIds = answer.hoodIds ?? new Map();
  const tokenById = new Map([...hoodIds].map(([token, id]) => [id, token]));
  const aliasByToken = new Map(answer.concealed.filter((c) => c.token).map((c) => [c.token, c.alias]));
  // The name the viewer holds, not Character.name: presentRows has already
  // resolved a forced name and any sighting.
  const heldName = new Map(answer.named.map((c) => [c.characterId, c.name]));

  const ids = [...heldName.keys(), ...hoodIds.values()];
  if (ids.length === 0) return { named: [], hooded: [], room: answer };
  const rows = await prisma.character.findMany({ where: { id: { in: ids } }, orderBy: NAME_ORDER, select });

  const named = [];
  const hooded = [];
  for (const row of rows) {
    const token = tokenById.get(row.id);
    if (!token) {
      named.push({ ...row, name: heldName.get(row.id) ?? row.name });
      continue;
    }
    const { id: _id, name: _name, ...rest } = row;
    hooded.push({
      ...rest,
      // `token` alongside the key because the two consumers want different
      // shapes: a dialog posts `id` straight back, while PartySelect builds its
      // own value as `${kind}:${id}` and needs the bare token plus kind "hood".
      id: `hood:${token}`,
      token,
      name: aliasByToken.get(token) ?? "somebody",
      hooded: true,
    });
  }
  return { named, hooded, room: answer };
}

// The named half alone, for the two callers that look somebody up by real id.
export async function peopleHere(character, { includeDead = false, select } = {}) {
  return (await rosterHere(character, { includeDead, select })).named;
}
