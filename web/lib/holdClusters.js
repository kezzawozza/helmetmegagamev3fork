// The Other lens's fight half, in its own IMPORT-FREE file.
//
// moveRows.js is server-only — it reaches the Prisma barrel through
// referenceData.js — and everything below is pure: plain objects in, plain
// DTOs out. Kept apart so db/test/ can require it without dragging a database
// client in, the same reason stagingReach.js exists.
//
// ctx: { usernameById, catatonicIds, movesByCharacterId }
// ─── The Other lens ─────────────────────────────────────────────────────────
//
// Everything that pins somebody in place this turn, in one shape: a fight
// somebody started (docs/systemdocs/ATTACK.md), and a Safe intercept that
// fired (docs/systemdocs/INTERCEPT.md). Neither is a Move and neither has a
// desk — the row's job is to tell a GM who cannot leave and who is standing
// over them, before they read the Gambits.
//
// An Ambush shows up here as an Attack, because it IS one now.
//
// A row is ONE FIGHT, not one pairing. Three guards jumping a party of four
// files twelve Attack rows, and twelve rail rows read as twelve unrelated
// events when it is one scrap in one room — so the rows are clustered below
// and everybody in the cluster rides along on the row itself.
export const ATTACK_INCLUDE = {
  attacker: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
  // roleTitle on this side too: every member of a cluster draws the same
  // person line, and the target of one edge is the attacker of the next.
  targetCharacter: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
  location: { select: { name: true, zone: { select: { name: true } } } },
};

export const INTERCEPT_HIT_INCLUDE = {
  interceptor: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
  targetCharacter: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
};

// One person's line in a row's strip. REAL names, here and on the row itself:
// this is the GM desk, which already prints a fighting band (COMBAT.md §5),
// and the presented-face rule the DMs run under is about players.
//
// `moves` is what a GM opened the row for — what this person filed this turn,
// so the Gambit is one click away instead of a hunt through the Moves lens by
// name. It comes from the rows the page already built, never from a second
// query, so a chip can only exist for a Move that was actually shipped to the
// client and therefore cannot link to a desk row that is not there.
function personLine(c, role, { usernameById, catatonicIds, movesByCharacterId }) {
  return {
    characterId: c.id,
    name: c.name,
    avatarVersion: c.updatedAt.getTime(),
    catatonic: catatonicIds?.has(c.id) ?? false,
    roleTitle: c.roleTitle ?? "",
    discordUsername: usernameById.get(c.discordUserId) ?? c.discordUserId ?? "",
    role,
    moves: movesByCharacterId?.get(c.id) ?? [],
  };
}

// Connected components over a turn's Attack rows, so one fight is one row.
//
// Bucketed by Location FIRST. Two people cannot be in two rooms at once, so
// two brawls can never really share a member — but bucketing makes that
// structural rather than lucky, and it keeps an aggressor who attacked
// somebody in Town at dawn and somebody else in the Marshes at dusk from
// welding the two into one nonsense row. A null locationId is its own bucket
// (Attack.locationId is SetNull: a fight can outlive its Location).
//
// Cancelled edges ride along in their component rather than splitting off. A
// fight somebody started and called off is still something that happened at
// that scene, which is why the loader fetches them at all.
function attackClusters(attacks) {
  const buckets = new Map();
  for (const a of attacks) {
    const key = a.locationId ?? "";
    const list = buckets.get(key) ?? [];
    list.push(a);
    buckets.set(key, list);
  }

  const out = [];
  for (const list of buckets.values()) {
    // Union-find over character ids. The sets are a handful of people, so
    // find() walks the chain without path compression.
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      return r;
    };
    for (const a of list) {
      if (!parent.has(a.attackerId)) parent.set(a.attackerId, a.attackerId);
      if (!parent.has(a.targetCharacterId)) parent.set(a.targetCharacterId, a.targetCharacterId);
    }
    for (const a of list) {
      const ra = find(a.attackerId);
      const rb = find(a.targetCharacterId);
      if (ra !== rb) parent.set(ra, rb);
    }
    const byRoot = new Map();
    for (const a of list) {
      const root = find(a.attackerId);
      const edges = byRoot.get(root) ?? [];
      edges.push(a);
      byRoot.set(root, edges);
    }
    for (const edges of byRoot.values()) out.push(edges);
  }
  return out;
}

function attackClusterRow(edges, ctx) {
  const { usernameById, catatonicIds } = ctx;
  // Oldest first. The row's title and its id both come off the edge that
  // started the fight — an id derived from the member set instead would be a
  // NEW id the moment a fourth person joined, which drops the GM's keyboard
  // cursor and re-collapses whatever they were reading.
  const ordered = [...edges].sort((x, y) => x.createdAt - y.createdAt);
  const seed = ordered[0];
  const newest = ordered[ordered.length - 1];

  // Attackers first, then the people they are standing over. Somebody in both
  // positions at once reads as HELD — being jumped outranks doing the
  // jumping, the settleHold rule in db/lib/attack.js, and the row should not
  // disagree with the sentence that person is reading off every shut way.
  const people = new Map();
  for (const e of ordered) {
    if (!people.has(e.attackerId)) people.set(e.attackerId, personLine(e.attacker, "attacking", ctx));
  }
  for (const e of ordered) {
    const was = people.get(e.targetCharacterId);
    if (was) was.role = "held";
    else people.set(e.targetCharacterId, personLine(e.targetCharacter, "held", ctx));
  }
  const peopleList = [...people.values()];

  const kindLabel = ordered.some((e) => e.fromAmbush) ? "Ambush" : "Attack";
  const holding = ordered.some((e) => !e.cancelledAt);

  return {
    id: `hold:${seed.id}`,
    kind: kindLabel === "Ambush" ? "AMBUSH" : "ATTACK",
    kindLabel,
    characterId: seed.attackerId,
    characterName: seed.attacker.name,
    avatarVersion: seed.attacker.updatedAt.getTime(),
    catatonic: catatonicIds?.has(seed.attackerId) ?? false,
    discordUsername: usernameById.get(seed.attacker.discordUserId) ?? seed.attacker.discordUserId ?? "",
    roleTitle: seed.attacker.roleTitle ?? "",
    targetCharacterId: seed.targetCharacterId,
    targetName: seed.targetCharacter.name,
    // Everybody the title does not already name, for its "+2".
    extraCount: Math.max(0, peopleList.length - 2),
    // Where it happened first, the seat second — the cavingRollRow reasoning:
    // a fight is in the room it is in, not in whichever zone the attacker
    // holds a chair in.
    zoneName: seed.location?.zone?.name ?? seed.attacker.zone?.name ?? "",
    locationName: seed.location?.name ?? null,
    statusLabel: holding ? "Holding" : "Called off",
    people: peopleList,
    // One per pairing, because calling one off is per pairing: cancelAttack's
    // WHERE names two people and a turn. A cluster-wide button would end
    // fights the GM never meant to touch.
    holds: ordered.map((e) => ({
      attackId: e.id,
      attackerId: e.attackerId,
      attackerName: e.attacker.name,
      targetId: e.targetCharacterId,
      targetName: e.targetCharacter.name,
      cancelled: Boolean(e.cancelledAt),
    })),
    // So the rail's search finds a cluster by ANYONE in it, not only by the
    // two the title happens to name.
    searchText: peopleList.map((p) => p.name).join(" "),
    // The NEWEST edge, so a fight that just grew sorts as the fresh thing it
    // is rather than sinking to where it started.
    createdAtMs: newest.createdAt.getTime(),
  };
}

function interceptHitRow(h, ctx) {
  const { usernameById, catatonicIds } = ctx;
  return {
    id: h.id,
    kind: "INTERCEPT",
    kindLabel: "Intercept",
    characterId: h.interceptorId,
    characterName: h.interceptor.name,
    avatarVersion: h.interceptor.updatedAt.getTime(),
    catatonic: catatonicIds?.has(h.interceptorId) ?? false,
    discordUsername: usernameById.get(h.interceptor.discordUserId) ?? h.interceptor.discordUserId ?? "",
    roleTitle: h.interceptor.roleTitle ?? "",
    targetCharacterId: h.targetCharacterId,
    targetName: h.targetCharacter.name,
    extraCount: 0,
    zoneName: h.interceptor.zone?.name ?? "",
    locationName: null,
    // A Safe stop is two minutes and is long over by the time a GM reads it;
    // saying "Holding" would be a lie the row cannot check.
    statusLabel: "Stopped",
    // The same strip an Attack cluster draws, so the renderer needs no second
    // shape — two people and what each of them filed.
    people: [
      personLine(h.interceptor, "stopping", ctx),
      personLine(h.targetCharacter, "stopped", ctx),
    ],
    // No pairing to call off. The hold lapsed on its own clock long before a
    // GM got here, so a button could only ever answer "they're already free".
    holds: [],
    searchText: `${h.interceptor.name} ${h.targetCharacter.name}`,
    createdAtMs: h.createdAt.getTime(),
  };
}

// The Other lens's fight half, clustered. `interceptHits` are Safe stops only
// — an Ambush files an Attack, so the two halves never name one event twice.
export function otherHoldRows(attacks, interceptHits, ctx) {
  return [
    ...attackClusters(attacks).map((edges) => attackClusterRow(edges, ctx)),
    ...interceptHits.map((h) => interceptHitRow(h, ctx)),
  ];
}
