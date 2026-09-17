// The ONE roster behind every people-picker on /character, in two halves that
// answer the same question about different people.
//
// `peopleHere` is the NAMED half: everybody standing at this Location whose face
// you can see. `hoodsHere` is the other half, the people in masks — and a hood
// hides WHO somebody is, never THAT they are standing there, so both halves feed
// every picker that acts on a body. `isHere` re-checks the same predicate
// server-side (db/lib/presence.js), and db/lib/targetKey.js is what turns a
// picked row back into a character.
import { prisma } from "@lifeweb/db";
import { hereWhere } from "@lifeweb/db/lib/presence";
import { whosHere } from "@lifeweb/db/lib/whosHere";

import { rosterName } from "@lifeweb/db/lib/presentedIdentity";

export { hereWhere, isHere, HERE_FIELDS, notHereMessage } from "@lifeweb/db/lib/presence";

// What a picker calls somebody, and what it posts back for them. Every roster
// on /character and /chat is built from both halves, so these two are the only
// place that has to know which half a row came from.
//
// A hood row already carries its alias in `name` — running rosterName() over
// one would resolve a FORCED name off its tags and could print the very thing
// the mask is for. A hood row also already carries its whole key.
export function pickerName(row) {
  return row?.hooded ? row.name : rosterName(row);
}
export function pickerKey(row) {
  return row?.hooded ? row.id : `character:${row.id}`;
}

export async function peopleHere(character, { includeDead = false, select } = {}) {
  if (!character?.locationId) return [];
  return prisma.character.findMany({
    where: hereWhere(character, { includeDead }),
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    select,
  });
}

// The HOODED half. Same contract as peopleHere — `select` is the caller's own,
// `includeDead` adds the unburied dead — with three differences that are the
// whole point, and that every pool downstream depends on:
//
//   * `id` is "hood:<token>", never a Character.id. Shipping an id IS the
//     unmasking: /api/avatar/<id> is ungated and answers with a face.
//   * `name` is the alias the room sees ("a young man"), never Character.name.
//   * `hooded: true`, so a pool can decide what else a row is allowed to carry.
//
// `withSightings` so a row is called what the VIEWER last heard it called, which
// is what keeps this list and resolveHoodToken from ever disagreeing
// (PROXYING.md §5). A hood with no token — AUTH_SECRET unset — is not offerable
// and simply does not appear.
export async function hoodsHere(character, { includeDead = false, select } = {}) {
  if (!character?.locationId) return [];
  const room = await whosHere(prisma, character, {
    includeSelf: false,
    includeDead,
    withSightings: true,
    withHoodIds: true,
  });
  const hoodIds = room.hoodIds ?? new Map();
  if (hoodIds.size === 0) return [];

  const aliasByToken = new Map(room.concealed.filter((c) => c.token).map((c) => [c.token, c.alias]));
  const tokenById = new Map([...hoodIds].map(([token, id]) => [id, token]));
  const rows = await prisma.character.findMany({
    where: { id: { in: [...hoodIds.values()] } },
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    select,
  });

  // The real id and the real name are dropped on the way out rather than never
  // selected: callers pass their own `select`, and one that forgot to leave
  // `name` out would otherwise publish it. Stripping here means a pool cannot
  // leak one by writing its select carelessly.
  return rows.map(({ id, name, ...rest }) => {
    const token = tokenById.get(id);
    // `token` alongside the key because the two consumers want different
    // shapes: a dialog posts `id` straight back, while PartySelect builds its
    // own value as `${kind}:${id}` and so needs the bare token plus
    // `kind: "hood"`. One row serves both rather than two rosters.
    return {
      ...rest,
      id: `hood:${token}`,
      token,
      name: aliasByToken.get(token) ?? "somebody",
      hooded: true,
    };
  });
}
