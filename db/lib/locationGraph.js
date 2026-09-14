// The travel graph — the ONE place that reads LocationLink, so no caller has to remember an edge is a single undirected row that could have this location on either side. Every surface offering a destination and every crossing check comes through here: db/lib/locationTravel.js#performLocationMove, the bot's Travel picker, the escort per-follower check (MAP.md §3a), and the modular gate button — gating is not cosmetic: a hidden edge must be genuinely absent from a list, and a locked one must refuse server-side even when a client sends its id directly. Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { heldTagSlugs } = require("./roomAccess");
const { blocksOnFoot, equippedSlugs } = require("./mounts");
const { heldReasonFor } = require("./intercept");
const { cavingHoldFor } = require("./cavingPass");

// The two endpoints of a link, oriented so `near` is the side you're standing on. Callers only ever want `far`.
function endpoints(link, locationId) {
  const nearIsA = link.aId === locationId;
  return {
    near: nearIsA ? link.a : link.b,
    far: nearIsA ? link.b : link.a,
  };
}

// Canonical endpoint order for a NEW row: ascending slug, so an attribute can never disagree between directions and a modular gate can't end up open one way and shut the other. The sync is the only writer.
function orderEndpoints(slugA, idA, slugB, idB) {
  return slugA <= slugB ? { aId: idA, bId: idB } : { aId: idB, bId: idA };
}

const LINK_INCLUDE = {
  a: { include: { zone: true } },
  b: { include: { zone: true } },
};

async function linksFor(prisma, locationId) {
  if (!locationId) return [];
  return prisma.locationLink.findMany({
    where: { OR: [{ aId: locationId }, { bId: locationId }] },
    include: LINK_INCLUDE,
  });
}

// One link between two specific locations, whichever way round it is stored.
async function linkBetween(prisma, locationId, otherLocationId) {
  if (!locationId || !otherLocationId) return null;
  return prisma.locationLink.findFirst({
    where: {
      OR: [
        { aId: locationId, bId: otherLocationId },
        { aId: otherLocationId, bId: locationId },
      ],
    },
    include: LINK_INCLUDE,
  });
}

// Is a keyed edge currently propped open? Nothing closes one — the window simply lapses, which is why this is a comparison and not a stored flag.
function isHeldOpen(link, now = new Date()) {
  return Boolean(link?.openUntil && link.openUntil.getTime() > now.getTime());
}

// Should this crossing raise the "Leave open for 24 hours?" prompt? Only for somebody who actually holds the key — propping a door is the key-holder's decision, not a courtesy inherited by whoever walks through — and only while shut, so a stream of traffic through an open way doesn't re-ask every one of them.
function shouldPromptKeyed(link, { tagSlugs, now = new Date() } = {}) {
  if (!link?.keyed || !link.requiredTagSlug) return false;
  if (isHeldOpen(link, now)) return false;
  const held = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs ?? []);
  return held.has(link.requiredTagSlug);
}

// The pure predicate: may a character holding `tagSlugs` cross this edge right now? Separated from the queries so the picker, mover and re-validation all reach the identical verdict from already-loaded data. `listed` is weaker than `passable`: a LOCKED edge is listed and refuses (so a player can see the door and learn they need the key), while a HIDDEN edge is not listed at all. A propped-open keyed edge satisfies its own tag requirement, which also makes a hidden one listed — deliberate: a door somebody held open must be visible to whoever is meant to follow them through it. `onFootBlocked` is the ONE input here about tags-you-have-out, not tags-you-hold — pass it from blocksOnFoot(equippedSlugs(tags)); a horse or cart in your pocket is not one you're riding or pushing.
function crossingCheck(link, { tagSlugs, onFootBlocked = false, now = new Date() } = {}) {
  if (!link) {
    return { listed: false, passable: false, refusal: "You can't get there directly from here." };
  }

  const held = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs ?? []);
  const hasTag = !link.requiredTagSlug || held.has(link.requiredTagSlug) || isHeldOpen(link, now);
  // Which of THEIR OWN tags opens this way, for a surface that wants to say so. Deliberately not `hasTag`, which is also true of a keyed way someone else propped open — walking through a door another player wedged isn't your trait opening it. Only ever a tag they hold, so it leaks nothing, and it's absent from every refusing branch below, so a locked way says no more than it did.
  const openedBy =
    link.requiredTagSlug && held.has(link.requiredTagSlug) ? link.requiredTagSlug : null;

  if (link.hidden && !hasTag) {
    // Same wording a nonexistent edge gets, deliberately: a refusal that read differently would tell a player the hidden way is there.
    return { listed: false, passable: false, refusal: "You can't get there directly from here." };
  }
  if (!hasTag) {
    return { listed: true, passable: false, refusal: "This way isn't open to you." };
  }
  if (link.modular && !link.isOpen) {
    return {
      listed: true,
      passable: false,
      refusal: "The way is shut. Somebody in the watchtower would have to work the winch.",
    };
  }
  // Dismounts the traveller rather than refusing — db/lib/indoors.js's dismountForNarrowWay, called from applyLocationMoveSideEffects the same way arriving indoors parks a mount at the door. `dismounts` is surfaced so the picker can say so before anyone commits.
  if (link.onFoot && onFootBlocked) {
    return { listed: true, passable: true, refusal: null, dismounts: true, openedBy };
  }
  return { listed: true, passable: true, refusal: null, dismounts: false, openedBy };
}

// Does this edge have a gate to work at all? Only a modular edge does. The gate button renders off this, on the WATCHTOWER at the gate (db/lib/roomStarterRow.js) — getting into that room is the whole permission model (anyone who can see the winch may pull it), so there's no second predicate here; toggleGate only re-checks the clicker is standing at the gate.
function gateOperable(link) {
  return Boolean(link?.modular);
}

// The destination list for one character standing in one location, already gated, sorted by zone then the location's authoring order. `character` needs id and either a loaded `tags` (as CHARACTER_SELECT shapes it) or nothing, in which case tags are queried. Returns [{ location, link, listed, passable, refusal, crossesZone }] — callers rendering a list must filter on `listed` themselves, since the mover wants the unlisted rows too to refuse correctly. A character already on the road gets every ZONE CROSSING shut, named in the refusal (MAP.md §3); hops inside their own zone are untouched, since a paid crossing costs the day, not the ability to walk across town. Doing this here rather than in each picker is what keeps the map, /chat panel, and bot list from ever disagreeing about a hop — same reason the gates live here.
async function resolveNeighbors(prisma, character, locationId, { fromZoneId = null } = {}) {
  const links = await linksFor(prisma, locationId);
  if (links.length === 0) return [];

  // Loaded in the shape equippedSlugs expects, not the cheaper flat set: heldTagSlugs returns BARE slugs with no equip state, and a stowed horse must not read as a mount.
  const tags =
    character?.tags ??
    (character?.id
      ? await prisma.characterTag.findMany({
          where: { characterId: character.id },
          select: { equipped: true, tag: { select: { slug: true } } },
        })
      : []);
  const tagSlugs = new Set(tags.map((ct) => ct.tag?.slug).filter(Boolean));
  const onFootBlocked = blocksOnFoot(equippedSlugs(tags));

  const zoneId = fromZoneId ?? character?.zoneId ?? null;
  // One clock for the whole list, so a propped-open way cannot lapse halfway down it and show as both open and shut in one render.
  const now = new Date();

  // Somebody has hold of them (docs/systemdocs/INTERCEPT.md). Pure — one comparison against Character.heldUntil, no query — so every picker draws the refusal the mover is about to give, instead of the server refusing after a click.
  const heldReason = heldReasonFor(character, now);

  const rows = links
    .map((link) => {
      const { far } = endpoints(link, locationId);
      const row = {
        location: far,
        link,
        crossesZone: Boolean(zoneId) && far.zoneId !== zoneId,
        ...crossingCheck(link, { tagSlugs, onFootBlocked, now }),
      };
      // Being held shuts every way out, not just zone crossings — an ambush is a hand on your shoulder (INTERCEPT.md). `listed` is deliberately left alone: the way still draws, just SHUT with why, rather than vanishing and reading like it never existed.
      if (heldReason) {
        row.passable = false;
        row.refusal = heldReason;
      }
      return row;
    })
    .sort(
      (x, y) =>
        (x.location.zone?.sortOrder ?? 0) - (y.location.zone?.sortOrder ?? 0) ||
        (x.location.zone?.name ?? "").localeCompare(y.location.zone?.name ?? "") ||
        x.location.sortOrder - y.location.sortOrder ||
        x.location.name.localeCompare(y.location.name),
    );

  // An unresolved 1 on the Caving Die shuts the ways OUT of the zone, leaving the rest of the level open (CAVING.md §2c) — the whole difference from being held, and why it's applied here rather than above. Skipped unless a crossing is on offer to shut, so a picker anywhere but a cave mouth pays nothing.
  if (character?.id && zoneId && rows.some((row) => row.crossesZone)) {
    const cavingHold = await cavingHoldFor(prisma, character.id, zoneId);
    if (cavingHold) {
      for (const row of rows) {
        if (!row.crossesZone) continue;
        row.passable = false;
        row.refusal = cavingHold;
      }
    }
  }

  return rows;
}

async function travelOptions(prisma, character, locationId, opts) {
  return (await resolveNeighbors(prisma, character, locationId, opts)).filter((row) => row.listed);
}

// How far a shout carries, in hops. Everything past this hears nothing. Three (Bascinet's call — the far ring carried too much and said too little).
const SOUND_HOPS = 3;

// Who can hear a noise made at `originLocationId`, and which way it came from — the only multi-hop question in this file, allowed here because nothing outside this module may read LocationLink. EVERY EDGE COUNTS: locked, hidden, shut, on-foot — sound doesn't care, because none of those are about sound; deliberately the one traversal that never calls crossingCheck. Returns [{ locationId, name, discordChannelId, distance, viaName }], sorted nearest first, origin included at distance 0. `viaName` is the HEARER's own neighbour on the shortest path back (the next step toward the noise, never the noise itself) — the whole privacy rule: a shout tells you which way to run, not who or how far. `throughHidden` is the one exception, used only by the Nuclear Datacard's pointer (db/lib/nuke.js) tracking its own warhead, not ears — left off by default so nothing else picks it up by accident.
async function soundRange(prisma, originLocationId, maxHops = SOUND_HOPS, { throughHidden = false } = {}) {
  if (!originLocationId) return [];

  // One query for the whole graph — ~56 Locations and a few dozen edges, so paying per-hop for linksFor() would be more round trips than rows.
  const [links, locations] = await Promise.all([
    prisma.locationLink.findMany({ select: { aId: true, bId: true, hidden: true } }),
    prisma.location.findMany({ select: { id: true, slug: true, name: true, discordChannelId: true } }),
  ]);

  const byId = new Map(locations.map((loc) => [loc.id, loc]));
  const adjacency = new Map();
  const link = (from, to, hidden) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ id: to, hidden });
  };
  for (const edge of links) {
    link(edge.aId, edge.bId, edge.hidden);
    link(edge.bId, edge.aId, edge.hidden);
  }
  // Sorted by slug so a tie between two equally-short ways back resolves the same on every run — otherwise one shout could name a different direction than the next for no reason a player could see.
  for (const [, list] of adjacency) {
    list.sort((x, y) => (byId.get(x.id)?.slug ?? "").localeCompare(byId.get(y.id)?.slug ?? ""));
  }

  const out = [];
  const seen = new Set([originLocationId]);
  // `via` is the hearer's own step BACK toward the origin, always the node this one was reached FROM — BFS guarantees that's exactly one hop nearer the origin. No path reconstruction needed.
  let frontier = [{ id: originLocationId, via: null, viaHidden: false }];

  for (let distance = 0; distance <= maxHops && frontier.length > 0; distance += 1) {
    const next = [];
    for (const node of frontier) {
      const loc = byId.get(node.id);
      if (loc) {
        out.push({
          locationId: node.id,
          name: loc.name,
          discordChannelId: loc.discordChannelId,
          distance,
          // NULL when the step back runs through a HIDDEN edge. Sound still carries (the row stays), but the DIRECTION is withheld, since naming it would reveal a way exists where none was said to — a hidden edge is absent from every travel list for exactly that reason (crossingCheck below), and a shout must not be the hole in it.
          viaName:
            node.viaHidden && !throughHidden
              ? null
              : node.via
                ? (byId.get(node.via)?.name ?? null)
                : null,
        });
      }
      if (distance === maxHops) continue;
      for (const neighbor of adjacency.get(node.id) ?? []) {
        if (seen.has(neighbor.id)) continue;
        seen.add(neighbor.id);
        // Only the hearer's OWN step counts, deliberately not sticky: the direction names one adjacent Location and nothing else, so nothing is given away if that neighbour is reachable by an open way — a shout from deep in the caves should still say which way down the road it came from.
        next.push({ id: neighbor.id, via: node.id, viaHidden: neighbor.hidden });
      }
    }
    frontier = next;
  }

  return out;
}

// How long a propped door stays propped. Real hours, not turns: a physical door somebody wedged, and the point is that people can follow within the day.
const KEYED_OPEN_MS = 24 * 60 * 60 * 1000;

module.exports = {
  LINK_INCLUDE,
  KEYED_OPEN_MS,
  soundRange,
  endpoints,
  orderEndpoints,
  linksFor,
  linkBetween,
  crossingCheck,
  gateOperable,
  isHeldOpen,
  shouldPromptKeyed,
  resolveNeighbors,
  travelOptions,
};
