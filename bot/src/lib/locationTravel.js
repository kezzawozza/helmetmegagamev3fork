const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  performLocationMove,
  exertRefusal,
  exertEdgeFor,
  exertEdgeSentence,
  exertResultLine,
  freeMovesLeft,
  freeZoneMovesReason,
} = require("@lifeweb/db/lib/locationTravel");
const {
  ESCORT_SELECT,
  escortCandidates,
  escortAuthority,
  attach,
  detach,
  partyOf,
  createEscortOffer,
} = require("@lifeweb/db/lib/escort");
const { linkBetween } = require("@lifeweb/db/lib/locationGraph");
const { walkWithinZone } = require("@lifeweb/db/lib/locationWalk");
const { stowedMounts } = require("@lifeweb/db/lib/mounts");
const { applyLocationMoveSideEffects } = require("@lifeweb/db/lib/locationMove");
const { putChannelOverwrite } = require("@lifeweb/db/lib/discordRest");
const { LOCATION_MEMBER_ALLOW } = require("@lifeweb/db/lib/zoneChannelSpec");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");

// Gateway half of the Travel flow. Rules and writes live in db/lib/locationTravel.js; this is the
// Discord vocabulary — pickers and the REST side effects db/lib/locationMove.js owns.
//
// Custom ids, all "loc:"-namespaced (COMMANDS.md): loc:open, loc:pick, loc:bring,
// loc:confirm:{locationId}, loc:cancel. loc:who / loc:secret / loc:converse / loc:gate:{linkId}
// live in db/lib/locationAnchorRow.js instead, because the sync posts them.

// Discord's hard cap on select-menu options, and on max_values with them.
const MENU_OPTION_LIMIT = 25;

const PICK_ID = "loc:pick";
const BRING_ID = "loc:bring";
const CONFIRM_PREFIX = "loc:confirm:";
const EXERT_PREFIX = "loc:exert:";
const CANCEL_ID = "loc:cancel";

// Nothing is parked between clicks: an escort is a row on the follower (Character.escortedById),
// so the select writes it immediately and Confirm reads it back from the database.

// Loaded with exactly the shape performLocationMove and escortAuthority need — a partial row would
// silently mis-authorize an escort. ESCORT_SELECT is the wider shape (carries the faction relation).
async function loadMover(discordUserId) {
  return prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: ESCORT_SELECT,
  });
}

// "A", "A and B", "A, B and C".
function listNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// `entries` are { location, hops, through } — `hops` null for somewhere next
// door, a number for somewhere farther in the same zone the character already
// knows and could walk to (MAP.md §3c). `from` null means first placement
// (arrival, not travel, costs nothing).
//
// Discord select menus have no option GROUPS, so the grouping here is the order
// the caller hands them in plus this description line, which is the whole cost
// model in one sentence: a step inside the zone is free on a cooldown, a walk is
// several of those, an edge that leaves the zone spends the Move.
function buildLocationSelectRow(entries, from) {
  const shown = entries.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(PICK_ID)
    .setPlaceholder("Choose where to go…")
    .addOptions(
      shown.map(({ location, hops, through }) => ({
        label: location.name.slice(0, 100),
        value: location.id,
        description: describeDestination(location, from, hops, through).slice(0, 100),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

// One line under a destination's name. Naming the first stop on a walk where it
// fits, because which way you are about to go is the thing worth knowing.
function describeDestination(location, from, hops, through) {
  if (!from) return location.zone?.name ?? "Somewhere";
  if (hops) {
    const far = `${hops} hops`;
    const first = through?.[0];
    return first && `${far} — through ${first}`.length <= 100 ? `${far} — through ${first}` : `${far} away`;
  }
  if (location.zoneId === from.zoneId) return "Same zone";
  return `Into ${location.zone?.name ?? "another zone"} — free, or costs a Move`;
}

// Who you are taking with you — the Discord twin of the party rack on /chat. Null when nobody can
// be brought (an empty select menu is rejected by Discord). Not bound to a destination — it sets
// the party and it persists, pre-ticked with whoever is already following; deselecting puts them down.
function buildBringRow(candidates) {
  const shown = candidates.slice(0, MENU_OPTION_LIMIT);
  if (shown.length === 0) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(BRING_ID)
    .setPlaceholder("Who comes with you?")
    .setMinValues(0)
    .setMaxValues(shown.length)
    .addOptions(
      shown.map((candidate) => ({
        label: candidate.name.slice(0, 100),
        value: candidate.id,
        default: candidate.attached,
        description: (candidate.verdict === "ASK"
          ? "You'd have to ask them"
          : `${candidate.reason ?? "comes with you"}`
        ).slice(0, 100),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Applies a Bring select. Anyone ticked who needs consent gets an Offer DM
// instead of being attached; everybody else attaches on the spot, and
// everybody untricked is put down. Returns { attached, asked, dropped, dms }
// so the caller can say what happened in one line.
async function applyBring(mover, pickedIds, turn) {
  const picked = new Set(pickedIds);
  const candidates = await escortCandidates(prisma, mover, turn?.number ?? null);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out = { attached: [], asked: [], dropped: [], dms: [] };

  for (const row of await partyOf(prisma, mover.id)) {
    if (!picked.has(row.id)) {
      await detach(prisma, row.id);
      out.dropped.push(row.name);
    }
  }

  for (const id of picked) {
    const candidate = byId.get(id);
    if (!candidate || candidate.attached) continue; // a picker is a hint; this is the lock
    if (candidate.verdict === "ASK") {
      if (!turn) continue;
      const target = await prisma.character.findUnique({ where: { id }, select: ESCORT_SELECT });
      if (!target || !escortAuthority(mover, target, turn.number)) continue;
      const offer = await createEscortOffer(prisma, { actor: mover, target, turn });
      if (offer.ok) {
        out.asked.push(target.name);
        out.dms.push(offer.dm);
      }
      continue;
    }
    // FORCED is taken rather than agreed with (same call the web's bringAlong makes, db/lib/escort.js#attach).
    if (await attach(prisma, mover.id, id, { takeover: candidate.verdict === "FORCED" })) {
      out.attached.push(candidate.name);
    }
  }
  return out;
}

// `exert` adds the Push on button — one more crossing on a die instead of the
// Move (MAP.md §3). Only offered where exertRefusal has already said yes.
// `go` false leaves Confirm off the row: the Move is spent and this crossing
// has no free move left, so there is nothing for it to do but refuse (MAP.md
// §3). Push on may still stand beside Cancel.
function buildConfirmRow(locationId, { exert = false, go = true } = {}) {
  const row = new ActionRowBuilder();
  if (go) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}${locationId}`)
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Success),
    );
  }
  if (exert) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${EXERT_PREFIX}${locationId}`).setLabel("Push on").setStyle(ButtonStyle.Danger),
    );
  }
  row.addComponents(new ButtonBuilder().setCustomId(CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary));
  return row;
}

// Executes a validated move. performLocationMove owns the rules and the
// writes; everything below is the Discord work it deliberately leaves to its
// caller, run per moved character and never allowed to throw — a failed role
// swap must not make a committed move look refused. The channel doctor
// reconciles whatever a miss here leaves.
async function performMove(character, targetLocation, { exert = false } = {}) {
  // Next door, or a walk of several hops across this zone (MAP.md §3c)? The
  // route is worked out server-side from the id that came back on the select;
  // nothing about the road is posted from Discord. `exert` means nothing on a
  // walk, which never crosses a zone.
  const adjacentLink = character.locationId
    ? await linkBetween(prisma, character.locationId, targetLocation.id)
    : null;
  const walking = Boolean(character.locationId) && !adjacentLink;

  const result = walking
    ? await walkWithinZone(prisma, character, targetLocation)
    : await performLocationMove(prisma, character, targetLocation, { exert });
  if (!result.ok) return result;

  // Where they ACTUALLY got to — a walk can be stopped on the road.
  const landed = result.arrivedAt ?? targetLocation;

  // Followers the way wouldn't take, already detached. The leader's message must not say WHY —
  // naming a hidden crawl's refusal would announce that the crawl is there (MAP.md §2a).
  for (const entry of result.leftBehind ?? []) {
    if (character.discordUserId) {
      await sendDm(
        prisma,
        character.discordUserId,
        entry.reason === "edge"
          ? `*You can't move ${entry.character.name} through here. You left them behind.*`
          : `*${entry.character.name} isn't with you any more.*`,
        { kind: DM_KIND.QUIET },
      ).catch(() => { });
    }
    if (entry.character.status === "ALIVE" && entry.character.discordUserId) {
      await sendDm(
        prisma,
        entry.character.discordUserId,
        `*${character.name} went on without you.*`,
        { kind: DM_KIND.QUIET },
      ).catch(() => { });
    }
  }

  // Sequential: firing a whole dragged party's REST calls at once trips the invalid-response breaker (db/lib/discordRest.js).
  // SKIPPED on a walk: locationWalk.js already ran this once per hop, and
  // running it again over the merged list would fire every turret a second time
  // and re-roll every Caving Die (MAP.md §3c).
  if (!result.sideEffectsApplied) {
    for (const entry of result.moved) {
      await applyLocationMoveSideEffects(prisma, {
        characterId: entry.character.id,
        fromLocationId: entry.fromLocationId,
        toLocationId: entry.toLocationId,
        dismounted: entry.character.id === character.id ? result.dismounted : undefined, // mover only, never a dragged passenger's
        walked: true, // on foot, so the street behind them stays lit (db/lib/vantages.js) — a dragged passenger walked too
      }).catch((err) =>
        console.error(`Move side effects failed for ${entry.character.name}:`, err.message ?? err),
      );
    }
  }

  // Caving Die "on arrival" trigger (db/lib/locationTravel.js, CAVING.md). Null off a cave level.
  // A walk gathered one per hop and hands them over already collected.
  const cavingDms = result.cavingDms ?? result.moved.map((entry) => entry.cavingDm).filter(Boolean);
  for (const dm of cavingDms) {
    await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
      console.error(`Caving arrival DM to ${dm.discordUserId} failed:`, err.message ?? err),
    );
  }

  // Anybody laying in wait here (INTERCEPT.md). Built inside performLocationMove, sent from here.
  for (const dm of result.interceptDms ?? []) {
    await sendDm(prisma, dm.discordUserId, dm.content, {
      kind: dm.kind,
      authorDiscordUserId: dm.authorDiscordUserId ?? null,
      components: dm.components,
      meta: dm.meta,
      allowedMentions: { parse: [] }, // belt-and-braces: cleanMessage() already stripped broadcast pings
    }).catch((err) => console.error(`Intercept DM to ${dm.discordUserId} failed:`, err.message ?? err));
  }

  // Being carried off happens without the player pressing anything, so it has to be told.
  for (const entry of result.moved) {
    if (entry.character.id === character.id) continue;
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(
      prisma,
      entry.character.discordUserId,
      `*${character.name} brought you along to ${landed.name}.*`,
      { kind: DM_KIND.QUIET },
    ).catch((err) =>
      console.error(`Drag DM to ${entry.character.discordUserId} failed:`, err.message ?? err),
    );
  }

  return result;
}

// A rejoining player comes back with every role stripped and their Location overwrite swept by
// guildMemberRemove, so this is a pure re-grant — same shape Revive uses (CHARACTERS.md §5b).
async function restoreStandingRoles(member, character) {
  if (!character.discordMirrored) return; // not-mirrored holds no Discord access on purpose (CHAT.md §6)

  const zoneRoleId = character.zone?.discordRoleId ?? null;
  if (zoneRoleId) {
    await member.roles
      .add(zoneRoleId)
      .catch((err) =>
        console.error(
          `Failed to grant ${member.id} the ${character.zone?.name ?? "zone"} role:`,
          err.message,
        ),
      );
  }

  const channelId = character.location?.discordChannelId ?? null;
  if (channelId) {
    await putChannelOverwrite(channelId, member.id, {
      allow: String(LOCATION_MEMBER_ALLOW),
      type: 1,
    }).catch((err) =>
      console.error(
        `Failed to reopen ${character.location?.name ?? "location"} to ${member.id}:`,
        err.message,
      ),
    );
  }
}

module.exports = {
  MENU_OPTION_LIMIT,
  PICK_ID,
  BRING_ID,
  CONFIRM_PREFIX,
  EXERT_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildBringRow,
  applyBring,
  buildConfirmRow,
  performMove,
  restoreStandingRoles,
  freeMovesLeft,
  freeZoneMovesReason,
  exertRefusal,
  exertEdgeFor,
  exertEdgeSentence,
  exertResultLine,
  stowedMounts,
};
