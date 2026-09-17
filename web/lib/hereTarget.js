// "Who did this picker point at, and can I reach them?" — one answer for every verb on /character that
// acts on a BODY rather than on a name: Attack, Bind, Free, Loot, Crucify, Shackle, Torture, Heal, Kiss.
//
// It exists because concealment hides WHO somebody is, not THAT they are standing there. Until this,
// every one of those verbs resolved a bare Character.id and re-checked isHere() with allowConcealed
// left at its default false — so a man in a mask was both missing from the picker and refused if you
// posted his id anyway. Putting on a closed helm made you immune to being hit, which is not what a
// helmet is for. See db/lib/presence.js#hereWhere for the roster half of the same rule.
//
// Transfer and Search already reached a hood, each with its own inline copy of the token dance; both
// now come through db/lib/targetKey.js, and so does this. Heal and Loot were the last two outside it
// — see db/lib/presence.js's header and PROXYING.md §5 for what that cost.
import { prisma } from "@lifeweb/db";
import { resolveTargetKey, splitTargetKey } from "@lifeweb/db/lib/targetKey";
import { isHere, notHereMessage } from "@lifeweb/db/lib/presence";
import { UserError } from "./actionResult";

// A refusal must never be an unmasking. notHereMessage() prints target.name, which is the one thing a
// hood is bought to hide — so a key that arrived as a hood is always refused in the blank form, even
// when we did load a row. A named key keeps the specific sentence it has always had.
function refusalFor(key, target) {
  return splitTargetKey(key).kind === "hood" ? "They aren't here." : notHereMessage(target);
}

// The target row, or a thrown UserError. `select` is the caller's own — this adds nothing to it,
// because isHere() with allowConcealed short-circuits before it would read a concealment tag.
//
// allowConcealed is TRUE here and that is the whole point: co-presence is a physical fact, and the
// only thing a hood is allowed to cost you is the name. Consent verbs that must not fire blind keep
// their own gates on top (db/lib/kiss.js#kissBlock, db/lib/bind.js).
export async function resolveHereTarget(character, key, { select, allowDead = false, status } = {}) {
  if (!character?.locationId) throw new UserError("You aren't anywhere you could do that.");
  // allowDead widens the hood resolver the same way it widens isHere() below —
  // a body is a legal target for Loot and for nothing else, and the two halves
  // have to be told the same thing or a masked corpse resolves to nobody.
  const id = await resolveTargetKey(prisma, character, key, { allowDead });
  const target = id
    ? await prisma.character.findFirst({
        where: { id, ...(status ? { status } : {}) },
        select,
      })
    : null;
  if (!target || !isHere(character, target, { allowDead, allowConcealed: true })) {
    throw new UserError(refusalFor(key, target));
  }
  return target;
}
