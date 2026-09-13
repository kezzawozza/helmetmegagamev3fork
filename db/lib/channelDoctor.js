// The channel doctor — the reconciliation sweep that compares what the
// database says the game looks like against what Discord actually shows,
// reports every mismatch, and (with apply) repairs it. Runs on bot restart
// and after each turn advance (cheap scope), and from finishGameWipe (full).
//
// "cheap": role membership, Location channel occupancy, and structural
// checks — safe on every restart.
// "full": adds channel overwrites, thread/invite bookkeeping, and
// narrowcast overwrites — the expensive halves.
//
// Dry-run by default (apply: false). Every run is persisted as a
// SystemReport (kind: DOCTOR) the Dev Panel renders.
const {
  getGuildRoles,
  listGuildMembers,
  addMemberRole,
  removeMemberRole,
  deleteGuildRole,
  getChannel,
  getGuildChannels,
  deleteChannelOverwrite,
  putChannelOverwrite,
  patchThread,
  listThreadMembers,
  addThreadMember,
  removeThreadMember,
} = require("./discordRest");
const { PLAYER_ROLE_ID, SPECTATOR_ROLE_ID, LEADER_WHITELIST_ROLE_ID, GHOST_ROLE_ID, gmRoleIds } = require("./roleIds");
const { hashNameToColor } = require("./roleColor");
const { ghostRoleId, ensureGhostRoleAppearance } = require("./ghostAccess");
const { cursedUserIds, CURSE_SELECT } = require("./curse");
const {
  zoneChannelSpec,
  locationChannelSpec,
  LOCATION_MEMBER_ALLOW,
} = require("./zoneChannelSpec");
const { accessibleRooms, roomAccessKeys, recordRoomThread } = require("./roomAccess");
const { reconcileChannelOverwrites, managedOverwriteIds } = require("./syncZones");
const {
  spectatorsVisible,
  managedSpectatorChannels,
  spectatorDrift,
  applySpectatorOverwrite,
} = require("./spectatorAccess");
const { SPECIAL_CHANNELS, buildNarrowcastContext, computeNarrowcastAccess } = require("./specialChannels");
const {
  findTurnsChannelId,
  turnsChannelOverwrites,
  syncTurnsChannelAccess,
} = require("./turnsChannelAccess");

// See db/scripts/ops/prune-orphan-roles.js for the signature's provenance:
// mentionable and coloured by a hash of its own name is something nothing
// else in the guild reproduces by accident. A Catatonic character's role
// ("<name> • Catatonic", flat grey — db/lib/characterRoleAppearance.js)
// fails this on purpose; it's protected anyway, because a claimed role is
// skipped before the signature is ever tested.
function looksLikeCharacterRole(role) {
  return role.mentionable === true && role.color === hashNameToColor(role.name);
}

function standingRoleIds() {
  return new Set(
    [
      PLAYER_ROLE_ID,
      SPECTATOR_ROLE_ID,
      LEADER_WHITELIST_ROLE_ID,
      ...gmRoleIds(),
      GHOST_ROLE_ID,
      process.env.DISCORD_TURN_PING_ROLE_ID,
    ].filter(Boolean),
  );
}

// One finding: { check, target, problem, repaired }. `repaired` is false on a
// dry run, and false when the repair itself failed (then `error` says why).
function makeReporter(findings, apply) {
  return async function report(check, target, problem, repair) {
    const finding = { check, target, problem, repaired: false };
    findings.push(finding);
    if (apply && repair) {
      try {
        await repair();
        finding.repaired = true;
      } catch (err) {
        finding.error = err.message;
      }
    }
  };
}

// Membership reconciliation for one role: everyone in `shouldHave` holds it,
// nobody else does. `holders` is the live member list filtered to this role.
async function reconcileRoleMembership({ roleId, label, shouldHave, members, report }) {
  if (!roleId) return;
  const want = new Set(shouldHave);
  for (const userId of want) {
    const member = members.get(userId);
    if (!member) continue; // left the guild — reported by the character checks
    if (!member.roles.includes(roleId)) {
      await report("role-membership", `${label}/${userId}`, `missing the ${label} role`, () =>
        addMemberRole(userId, roleId),
      );
    }
  }
  for (const [userId, member] of members) {
    if (!member.roles.includes(roleId)) continue;
    if (want.has(userId)) continue;
    await report("role-membership", `${label}/${userId}`, `holds the ${label} role and shouldn't`, () =>
      removeMemberRole(userId, roleId),
    );
  }
}

async function runChannelDoctor(prisma, { apply = false, scope = "cheap", actorDiscordUserId = null } = {}) {
  const startedAt = new Date();
  const findings = [];
  const errors = [];
  const report = makeReporter(findings, apply);

  const [zones, characters, liveRoles, memberList, config] = await Promise.all([
    prisma.zone.findMany({
      include: { seatZone: { select: { kind: true } }, locations: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.character.findMany({
      select: {
        id: true,
        name: true,
        discordRoleId: true,
        zoneId: true,
        locationId: true,
        turnPingOptIn: true,
        webOnly: true,
        // status and discordUserId come from here too — spreading it is what
        // keeps the ghost reconcile below reading the same fields the rule
        // does. Drop one and db/lib/curse.js answers from undefined.
        ...CURSE_SELECT,
      },
    }),
    getGuildRoles(),
    listGuildMembers(),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  // The spectator seat's view bits follow the phase (db/lib/spectatorAccess.js);
  // every spec below and the cheap check carry this one answer.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true } });
  const spectators = spectatorsVisible(state?.phase);

  const members = new Map(memberList.map((m) => [m.user.id, m]));
  const rolesById = new Map(liveRoles.map((r) => [r.id, r]));
  const alive = characters.filter((c) => c.status === "ALIVE");
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  // A cave level has no GM seat of its own — its Locations wear the group's,
  // matching db:sync-zones' gmRoleIdFor and Zone.seatZoneId's indirection.
  const gmRoleIdForZone = (z) =>
    z.gmRoleId ?? (z.parentZoneId ? zonesById.get(z.parentZoneId)?.gmRoleId : null) ?? null;
  const locations = zones.flatMap((z) =>
    z.locations.map((l) => ({ ...l, zoneName: z.name, zoneGmRoleId: gmRoleIdForZone(z) })),
  );
  const locationsById = new Map(locations.map((l) => [l.id, l]));

  // --- cheap: structure ------------------------------------------------

  for (const zone of zones) {
    if (zone.kind !== "CAVE_GROUP" && zone.discordRoleId && !rolesById.has(zone.discordRoleId)) {
      await report("zone-structure", zone.name, "recorded zone role no longer exists (run db:sync-zones)");
    }
    if (zone.kind !== "CAVE_GROUP" && !zone.discordRoleId) {
      await report("zone-structure", zone.name, "zone has no role recorded (run db:sync-zones)");
    }
    for (const [label, id] of [
      ["category", zone.discordCategoryId],
      ["summary", zone.discordSummaryChannelId],
    ]) {
      if (!id) continue;
      const live = await getChannel(id, { allow404: true }).catch(() => undefined);
      if (live === null) {
        await report("zone-structure", `${zone.name}/${label}`, "recorded channel no longer exists (run db:sync-zones)");
      }
    }
    if (zone.kind !== "CAVE_GROUP" && zone.locations.length === 0) {
      await report("zone-structure", zone.name, "zone has no locations — nobody can stand in it (check docs/zones.yaml)");
    }
  }
  // A Location wears no role, so its structure is just its channel. The live
  // channel object is kept, because its permission_overwrites are what the
  // occupancy check below diffs — reading it twice would double the doctor's
  // REST cost for nothing.
  const liveLocationChannels = new Map();
  for (const location of locations) {
    const label = `${location.zoneName}/${location.name}`;
    if (!location.discordChannelId) {
      await report("location-structure", label, "location has no channel recorded (run db:sync-zones)");
      continue;
    }
    const live = await getChannel(location.discordChannelId, { allow404: true }).catch(() => undefined);
    if (live === null) {
      await report("location-structure", label, "recorded channel no longer exists (run db:sync-zones)");
    } else if (live) {
      liveLocationChannels.set(location.id, live);
    }
  }

  // The locked/hidden tag a LocationLink names, checked against the live
  // catalog.
  //
  // It CANNOT be a foreign key and cannot be validated at zone-sync time,
  // because tags sync AFTER zones (SYNC.md's working order) — the same trade
  // the room `access:` list makes. So this is where a typo surfaces, and it
  // matters more here than for a room: a locked way naming a tag that does
  // not exist is a way nobody can ever pass, and a HIDDEN one is that plus
  // invisible, so nobody would even report it missing.
  //
  // Report-only. The fix is an edit to docs/zones.yaml, which is the master;
  // there is nothing sensible for --apply to guess.
  const links = await prisma.locationLink.findMany({ where: { requiredTagSlug: { not: null } }, include: { a: true, b: true } });
  if (links.length > 0) {
    const tagSlugs = await prisma.tag
      .findMany({ select: { slug: true } })
      .then((rows) => new Set(rows.map((r) => r.slug)));
    for (const link of links) {
      if (tagSlugs.has(link.requiredTagSlug)) continue;
      const label = `${link.a.name} <-> ${link.b.name}`;
      const kind = link.hidden ? "hidden" : "locked";
      await report("connection-slug", label, `names ${kind} tag "${link.requiredTagSlug}" — no such tag (check docs/zones.yaml)`);
    }
  }

  // Character.zoneId is denormalized from location.zoneId; a mismatch means
  // some writer forgot the contract. Repaired from the location, which is
  // the authority.
  for (const c of alive) {
    if (!c.locationId) {
      await report("character-place", c.name, "living character stands in no location");
      continue;
    }
    const location = locationsById.get(c.locationId);
    if (!location) {
      await report("character-place", c.name, "living character stands in a location that no longer exists");
    } else if (c.zoneId !== location.zoneId) {
      await report("character-place", c.name, "zoneId disagrees with the location's zone", () =>
        prisma.character.update({ where: { id: c.id }, data: { zoneId: location.zoneId } }),
      );
    }
  }

  // The bot's own highest role must sit above every zone role, or the role
  // swaps 403. Report-only — moving roles is a human decision.
  const me = members.get(process.env.DISCORD_CLIENT_ID) ?? null;
  if (me) {
    const botTop = Math.max(...me.roles.map((id) => rolesById.get(id)?.position ?? 0), 0);
    for (const zone of zones) {
      const role = zone.discordRoleId ? rolesById.get(zone.discordRoleId) : null;
      if (role && role.position >= botTop) {
        await report("zone-structure", zone.name, "zone role sits above the bot's highest role — swaps will 403");
      }
    }
  }


  // Ghost appearance: color 0, so ghosts aren't visually outed.
  //
  // The absent case is reported rather than skipped. The id is a constant now
  // (db/lib/roleIds.js), so "not in the guild" means the role was deleted or
  // the constant is stale — and a stale one is worse than a missing env var
  // ever was: every grant below would 404 against a role that isn't there, on
  // every bot start and every turn advance, and the REST breaker only counts
  // 401/403/429 so nothing would damp it.
  const ghost = rolesById.get(GHOST_ROLE_ID) ?? null;
  if (!ghost) {
    await report("ghost-role", GHOST_ROLE_ID, "no such role in the guild — GHOST_ROLE_ID is stale");
  } else if (ghost.color !== 0 || ghost.hoist) {
    await report("ghost-appearance", ghost.name, "ghost role is colored/hoisted", () =>
      ensureGhostRoleAppearance(),
    );
  }

  // --- cheap: role membership -----------------------------------------

  // Zone roles: exactly the living characters standing in each zone.
  for (const zone of zones) {
    if (!zone.discordRoleId) continue;
    await reconcileRoleMembership({
      roleId: zone.discordRoleId,
      label: `Zone: ${zone.name}`,
      // A "web only" character holds no Discord access at all, so they are
      // not in this set and the doctor takes the role back off them if they
      // somehow still wear it (docs/systemdocs/CHAT.md §6).
      shouldHave: alive.filter((c) => c.zoneId === zone.id && !c.webOnly).map((c) => c.discordUserId),
      members,
      report,
    });
  }

  // Location occupancy: the per-member overwrites on a Location channel must
  // be exactly the living characters standing there. This is the successor to
  // the old "Location: X" role membership check, and it is the ONLY sweep
  // that catches a location grant the move pipeline failed to swap — or one
  // a dead character kept, since an overwrite has no equivalent of the role
  // strip that prune-orphan-roles used to perform.
  //
  // Costs no extra requests: the overwrites arrive on the channel object the
  // structure pass above already fetched. Member targets only (type 1) — the
  // role overwrites belong to locationChannelSpec and are reconciled by the
  // full pass, not here.
  for (const location of locations) {
    const live = liveLocationChannels.get(location.id);
    if (!live) continue;
    const label = `${location.zoneName}/${location.name}`;
    const shouldHave = new Set(
      alive
        .filter((c) => c.locationId === location.id && !c.webOnly)
        .map((c) => c.discordUserId)
        .filter(Boolean),
    );
    // The ALLOW BITS come along, not just the id: LOCATION_MEMBER_ALLOW
    // changes over time (Send came off it when Location channels became
    // scenery), and an occupant already holding an old overwrite would
    // otherwise pass a presence-only check forever.
    const has = new Map(
      (live.permission_overwrites ?? [])
        .filter((o) => Number(o.type) === 1)
        .map((o) => [o.id, String(o.allow ?? "0")]),
    );
    const wantAllow = String(LOCATION_MEMBER_ALLOW);

    for (const userId of shouldHave) {
      const allow = has.get(userId);
      if (allow === wantAllow) continue;
      const why =
        allow === undefined
          ? `${userId} stands here but the channel is closed to them`
          : `${userId} holds the old permissions here (${allow}, want ${wantAllow})`;
      await report("location-occupancy", label, why, () =>
        putChannelOverwrite(location.discordChannelId, userId, {
          allow: wantAllow,
          type: 1,
        }),
      );
    }
    for (const userId of has.keys()) {
      if (shouldHave.has(userId)) continue;
      await report("location-occupancy", label, `${userId} can read this channel but does not stand here`, () =>
        deleteChannelOverwrite(location.discordChannelId, userId),
      );
    }
  }

  // Turn-ping: living characters' preferences, nobody else — and not a
  // web-only one. The ping is a <@&role> inside the #turns console, and
  // #turns is opened by the zone role that the web-only switch takes away
  // (db/lib/turnsChannelAccess.js), so holding the role there meant being
  // pinged twice a day about a channel you cannot open. Bidirectional, like
  // every reconcile here, which is what makes this one predicate both take
  // the role off everybody already in that state and hand it back the moment
  // they switch web-only off again.
  await reconcileRoleMembership({
    roleId: process.env.DISCORD_TURN_PING_ROLE_ID,
    label: "turn-ping",
    shouldHave: alive.filter((c) => c.turnPingOptIn && !c.webOnly).map((c) => c.discordUserId),
    members,
    report,
  });

  // The ghost seat: whoever db/lib/curse.js says is cursed, and nobody else.
  //
  // One-directional, database -> role, never the reverse. The role is a cache
  // of a derived set now; it decides nothing, so a disagreement costs a dead
  // player some channels until the next run rather than costing them points.
  // This used to compute the set inline and WITHOUT the buriedAt clause, so it
  // re-granted the role to anyone who had buried their body and not yet
  // re-rolled.
  const cursedShould = [...cursedUserIds(characters)];
  await reconcileRoleMembership({
    roleId: ghostRoleId(),
    label: "cursed",
    shouldHave: cursedShould,
    members,
    report,
  });

  // Character roles: every ALIVE character's role exists; no orphan
  // character-signature roles. Creation isn't repaired here (it needs the
  // name/color pipeline in web/lib/discordGuild.js) — report only. Orphans
  // are deleted on apply, same conservatism as prune-orphan-roles.
  const claimedRoleIds = new Set(characters.map((c) => c.discordRoleId).filter(Boolean));
  const standing = standingRoleIds();
  // The zone ACCESS roles. Kept narrow on purpose: this same set is what
  // #turns grants view to below, and a GM seat has no business there — every
  // GM already holds a global GM role, which #turns grants outright.
  const zoneRoleIds = new Set(zones.map((z) => z.discordRoleId).filter(Boolean));
  // The per-zone GM seats. Not character roles, so the orphan sweep below
  // must never offer to delete one; nothing else wants them.
  const zoneGmRoleIds = new Set(zones.map((z) => z.gmRoleId).filter(Boolean));
  for (const c of alive) {
    if (!c.discordRoleId) {
      await report("character-role", c.name, "living character has no Discord role recorded");
    } else if (!rolesById.has(c.discordRoleId)) {
      await report("character-role", c.name, "recorded character role no longer exists");
    }
  }
  for (const role of liveRoles) {
    if (
      claimedRoleIds.has(role.id) ||
      standing.has(role.id) ||
      zoneRoleIds.has(role.id) ||
      zoneGmRoleIds.has(role.id)
    ) {
      continue;
    }
    if (!looksLikeCharacterRole(role)) continue;
    if (role.managed || role.permissions !== "0") continue;
    const held = memberList.some((m) => m.roles.includes(role.id));
    if (held) continue;
    await report("character-role", role.name, "orphan character role (no character claims it)", () =>
      deleteGuildRole(role.id),
    );
  }

  // Seat stamping: nothing seat-scoped may point at a cave level.
  const badSeatZones = zones.filter((z) => z.kind === "CAVE_LEVEL").map((z) => z.id);
  if (badSeatZones.length > 0) {
    const [actions, notes] = await Promise.all([
      prisma.action.count({ where: { zoneId: { in: badSeatZones } } }),
      prisma.note.count({ where: { zoneId: { in: badSeatZones } } }),
    ]);
    if (actions > 0 || notes > 0) {
      await report(
        "seat-stamp",
        "Action/Note",
        `${actions + notes} rows stamped with a cave-level zoneId instead of the Caves seat`,
      );
    }
  }

  // The spectator seat's visibility on every managed channel — the backstop
  // for a phase transition whose sweep died. One channel list, PUTs only on
  // drift, so it stays in the cheap scope.
  {
    const [managedSpectator, liveChannels] = await Promise.all([
      managedSpectatorChannels(prisma),
      getGuildChannels(),
    ]);
    for (const target of spectatorDrift(managedSpectator, liveChannels, spectators)) {
      await report(
        "spectator-visibility",
        target.label,
        spectators ? "spectators cannot see a channel they should" : "spectators can see a channel while the game is not on",
        () => applySpectatorOverwrite(target.id, { visible: spectators }),
      );
    }
  }

  // --- full: overwrites + threads --------------------------------------

  if (scope === "full") {
    // Zone roles only. A member target must never enter this set — it is the
    // allowlist of overwrites the reconcile may DELETE, and every occupant of
    // every Location channel is a member overwrite (CHANNELS.md §3).
    // BOTH role families, and the GM seats matter more than they look. The
    // set is what the reconcile may DELETE when the spec no longer names a
    // target — and a zone whose gmRoleId is still null names no GM at all, so
    // without its seat in here a full run would sweep the live global-GM
    // overwrite off every one of that zone's channels and put nothing back.
    // db:sync-zones learned this at syncZones.js#managedOverwriteIds; this is
    // the same lesson on the doctor's side.
    const managed = managedOverwriteIds([...zoneRoleIds, ...zoneGmRoleIds]);
    const characterUserIds = new Set(characters.map((c) => c.discordUserId));

    const overwriteTargets = [];
    for (const zone of zones) {
      const spec = zoneChannelSpec(zone, { spectators });
      overwriteTargets.push([`${zone.name}/category`, zone.discordCategoryId, spec.category, false]);
      overwriteTargets.push([`${zone.name}/summary`, zone.discordSummaryChannelId, spec.summary, false]);
    }
    for (const location of locations) {
      overwriteTargets.push([
        `${location.zoneName}/${location.name}`,
        location.discordChannelId,
        locationChannelSpec(location, location.zoneGmRoleId ?? null, { spectators }),
        true,
      ]);
    }
    {
      for (const [label, channelId, want, isLocation] of overwriteTargets) {
        if (!channelId || !want) continue;
        let live;
        try {
          live = await getChannel(channelId, { allow404: true });
        } catch (err) {
          errors.push({ check: "overwrites", target: label, message: err.message });
          continue;
        }
        if (!live) continue;

        // A member overwrite on a zone's CATEGORY or #summary belongs to
        // nobody; access there rides the zone role.
        //
        // A LOCATION channel is the opposite, and this sweep used to take it
        // down with the rest: since Bascinet 2 the per-member overwrite IS how
        // an occupant is let in (CHANNELS.md §3), so one `--full --apply` threw
        // every player out of every Location channel at once and left them out
        // until the next run — the occupancy check that puts them back has
        // already run by the time this gets here.
        if (!isLocation) {
          for (const overwrite of live.permission_overwrites ?? []) {
            if (overwrite.type !== 1) continue;
            await report(
              "member-overwrite",
              `${label}/${overwrite.id}`,
              "stray per-member overwrite on a game channel",
              () => deleteChannelOverwrite(channelId, overwrite.id),
            );
          }
        }

        // Spec drift, repaired with the same reconcile the sync uses.
        const wanted = new Map(want.permission_overwrites.map((o) => [o.id, o]));
        const liveById = new Map((live.permission_overwrites ?? []).map((o) => [o.id, o]));
        let drifted = false;
        for (const [id, o] of wanted) {
          const l = liveById.get(id);
          if (!l || (l.allow ?? "0") !== (o.allow ?? "0") || (l.deny ?? "0") !== (o.deny ?? "0")) {
            drifted = true;
            break;
          }
        }
        if (!drifted) {
          for (const [id, o] of liveById) {
            if (!wanted.has(id) && managed.has(id) && o.type === 0) drifted = true;
          }
        }
        if (drifted) {
          await report("overwrites", label, "channel overwrites drifted from the spec", () =>
            reconcileChannelOverwrites(channelId, want, managed),
          );
        }
      }
    }

    // Room threads: exist and are unarchived. Recreating one is the sync's
    // job (it needs the YAML body), so a missing thread is report-only.
    const rooms = await prisma.room.findMany({ include: { location: { select: { name: true } } } });
    const privateRooms = [];
    for (const room of rooms) {
      const label = `${room.location.name}/${room.name}`;
      if (!room.discordThreadId) {
        await report("room-thread", label, "room has no thread recorded (run db:sync-zones)");
        continue;
      }
      let live;
      try {
        live = await getChannel(room.discordThreadId, { allow404: true });
      } catch (err) {
        errors.push({ check: "room-thread", target: label, message: err.message });
        continue;
      }
      if (!live) {
        await report("room-thread", label, "recorded room thread no longer exists (run db:sync-zones)");
        continue;
      }
      if (live.thread_metadata?.archived) {
        await report("room-thread", label, "room thread is archived", () =>
          patchThread(room.discordThreadId, { archived: false }),
        );
      }
      if (room.kind === "PRIVATE") privateRooms.push({ ...room, label });
    }

    // Private-room membership: exactly the living characters ENTITLED to the
    // room — holding one of its access tags, or let in by hand (RoomGuest).
    // NOT filtered by where they are standing: membership stopped following
    // presence on 2026-09-06 (db/lib/roomAccess.js), because a thread is gated
    // on VIEW_CHANNEL of its parent anyway and the add/remove was only earning
    // an undeletable "added <name> to the thread" line on every arrival.
    //
    // This check is therefore also the BACKFILL: run the doctor once after that
    // change and every keyholder lands in every thread they are entitled to,
    // which is what "do it all at game start" means in practice.
    // Thread-major: one member-list read per private room.
    //
    // Guests are NOT optional here. This check deletes anyone it can't account
    // for, so a doctor that only knew about keys would evict every guest the
    // next time anyone ran it. Full scope only — the bot's ready pass is
    // `cheap` and never reaches this line — but "only on demand" is not
    // "never".
    if (privateRooms.length > 0) {
      // recordRoomThread keys on the CHARACTER, and everything down here is
      // keyed on the Discord user, so the two need bridging once.
      const userIdToCharacterId = new Map(
        alive.filter((c) => c.discordUserId).map((c) => [c.discordUserId, c.id]),
      );
      const keysByCharacter = new Map();
      for (const c of alive) keysByCharacter.set(c.id, await roomAccessKeys(prisma, c.id));
      for (const room of privateRooms) {
        const shouldHave = new Set(
          alive
            .filter((c) => c.discordUserId && !c.webOnly)
            .filter((c) => {
              const keys = keysByCharacter.get(c.id);
              return accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length > 0;
            })
            .map((c) => c.discordUserId),
        );
        let live;
        try {
          live = await listThreadMembers(room.discordThreadId);
        } catch (err) {
          errors.push({ check: "room-membership", target: room.label, message: err.message });
          continue;
        }
        const present = new Set(live.map((m) => m.user_id));
        for (const userId of shouldHave) {
          if (present.has(userId)) continue;
          // The record follows the repair. Without it the doctor's own backfill
          // would poison every later key revocation: syncCharacterRoomAccess
          // acts only where entitlement and the record disagree, so a
          // membership the doctor added but never recorded can never be taken
          // away again. See db/lib/roomAccess.js#recordRoomThread.
          await report("room-membership", `${room.label}/${userId}`, "holds a key and isn't in the room", async () => {
            await addThreadMember(room.discordThreadId, userId);
            await recordRoomThread(prisma, userIdToCharacterId.get(userId), room.id, true);
          });
        }
        for (const userId of present) {
          if (shouldHave.has(userId)) continue;
          if (!characterUserIds.has(userId)) continue; // GMs and the bot may sit in any thread
          await report("room-membership", `${room.label}/${userId}`, "in the room without a key", async () => {
            await removeThreadMember(room.discordThreadId, userId);
            await recordRoomThread(prisma, userIdToCharacterId.get(userId), room.id, false);
          });
        }
      }
    }

    // PlayerThread bookkeeping.
    const rows = await prisma.playerThread.findMany();
    for (const row of rows) {
      const live = await getChannel(row.threadId, { allow404: true }).catch(() => undefined);
      if (live === null) {
        await report("player-thread", row.name, "tracked thread no longer exists on Discord", async () => {
          await prisma.playerThread.deleteMany({ where: { threadId: row.threadId } });
          await prisma.playerThreadInvite.deleteMany({ where: { threadId: row.threadId } });
        });
      }
    }

    // Room guests who no longer qualify: dead, or wandered off. The membership
    // check above repairs the THREAD; this repairs the row behind it, so a
    // guest who left doesn't sit in the table until they happen to move again.
    const guests = await prisma.roomGuest.findMany({
      include: { room: { select: { locationId: true, name: true } } },
    });
    for (const guest of guests) {
      const character = characters.find((c) => c.id === guest.characterId);
      const stillHere =
        character?.status === "ALIVE" && guest.room && character.locationId === guest.room.locationId;
      if (stillHere) continue;
      await report(
        "room-guest",
        `${guest.room?.name ?? guest.roomId}/${guest.characterId}`,
        "guest is dead or no longer standing in the room's location",
        () =>
          prisma.roomGuest.delete({
            where: { roomId_characterId: { roomId: guest.roomId, characterId: guest.characterId } },
          }),
      );
    }

    // Dead invites: character gone, or thread untracked.
    const invites = await prisma.playerThreadInvite.findMany();
    const trackedThreadIds = new Set(rows.map((r) => r.threadId));
    const characterIds = new Set(characters.filter((c) => c.status === "ALIVE").map((c) => c.id));
    for (const invite of invites) {
      if (trackedThreadIds.has(invite.threadId) && characterIds.has(invite.characterId)) continue;
      await report(
        "thread-invite",
        `${invite.threadId}/${invite.characterId}`,
        "invite for a dead character or untracked thread",
        () =>
          prisma.playerThreadInvite.delete({
            where: { threadId_characterId: { threadId: invite.threadId, characterId: invite.characterId } },
          }),
      );
    }

    // Narrowcast member overwrites vs the rules, channel-major.
    //
    // The context is built ONCE per character, not once per character per
    // channel: it is two queries and it does not depend on the entry. With one
    // special channel the difference was invisible; each new entry used to
    // multiply the whole sweep by another 2N queries.
    const accessByCharacter = new Map();
    if (SPECIAL_CHANNELS.some((entry) => config?.[entry.configKey])) {
      for (const c of alive) {
        if (c.webOnly) continue;
        accessByCharacter.set(c, computeNarrowcastAccess(await buildNarrowcastContext(prisma, c.id)));
      }
    }

    for (const entry of SPECIAL_CHANNELS) {
      const channelId = config?.[entry.configKey];
      if (!channelId) continue;
      let live;
      try {
        live = await getChannel(channelId, { allow404: true });
      } catch (err) {
        errors.push({ check: "narrowcast", target: entry.slug, message: err.message });
        continue;
      }
      if (!live) continue;

      const wantByUser = new Map();
      for (const [c, access] of accessByCharacter) {
        const grant = access[entry.slug];
        if (grant) wantByUser.set(c.discordUserId, grant);
      }

      const PERM_VIEW = 1024n;
      const PERM_SEND = 2048n;
      for (const overwrite of live.permission_overwrites ?? []) {
        if (overwrite.type !== 1) continue;
        const grant = wantByUser.get(overwrite.id);
        if (!grant) {
          const label = characterUserIds.has(overwrite.id) ? "no longer earns it" : "unknown member";
          await report("narrowcast", `${entry.slug}/${overwrite.id}`, `member overwrite ${label}`, () =>
            deleteChannelOverwrite(channelId, overwrite.id),
          );
          continue;
        }
        let allow = 0n;
        if (grant.view || grant.send) allow |= PERM_VIEW;
        if (grant.send) allow |= PERM_SEND;
        if ((overwrite.allow ?? "0") !== allow.toString()) {
          await report("narrowcast", `${entry.slug}/${overwrite.id}`, "member overwrite has the wrong bits", () =>
            putChannelOverwrite(channelId, overwrite.id, { allow: allow.toString(), type: 1 }),
          );
        }
        wantByUser.delete(overwrite.id);
      }
      for (const [userId, grant] of wantByUser) {
        let allow = 0n;
        if (grant.view || grant.send) allow |= PERM_VIEW;
        if (grant.send) allow |= PERM_SEND;
        await report("narrowcast", `${entry.slug}/${userId}`, "member should have access and has no overwrite", () =>
          putChannelOverwrite(channelId, userId, { allow: allow.toString(), type: 1 }),
        );
      }
    }

    // #turns. Outside the zone spec and outside SPECIAL_CHANNELS — nothing in
    // the repo creates it — but its view grants ride the zone roles, so it
    // drifts the same way everything else does. One finding per problem,
    // repaired by re-running the sync (idempotent, and it also strips the
    // hand-made per-member overrides the role grant replaces).
    try {
      const turnsId = await findTurnsChannelId();
      if (!turnsId) {
        await report("turns-access", "#turns", "no text channel named turns in the guild");
      } else {
        const live = await getChannel(turnsId, { allow404: true });
        const overwrites = live?.permission_overwrites ?? [];
        const liveById = new Map(overwrites.map((o) => [o.id, o]));
        const wanted = turnsChannelOverwrites({
          guildId: process.env.DISCORD_GUILD_ID,
          zoneRoleIds: [...zoneRoleIds],
          spectators,
        });
        // One finding for the channel, not one per target: the repair is a
        // single idempotent sync, and reporting it per overwrite would re-run
        // that whole sync once for every drifted bit.
        const problems = [];
        for (const [id, want] of wanted) {
          const l = liveById.get(id);
          if (!l) problems.push(`${id} has no overwrite`);
          else if ((l.allow ?? "0") !== want.allow || (l.deny ?? "0") !== want.deny) {
            problems.push(`${id} has the wrong bits`);
          }
        }
        // The spec is the complete description of who may see #turns, so
        // anything it doesn't name is a leftover — bar a bot's own overwrite,
        // which the sync also leaves alone.
        const botRoleIds = new Set(liveRoles.filter((r) => r.tags?.bot_id).map((r) => r.id));
        const strays = overwrites.filter((o) => !wanted.has(o.id) && !botRoleIds.has(o.id));
        if (strays.length) {
          problems.push(
            `${strays.length} overwrite(s) outside the spec (${strays
              .map((o) => o.id)
              .join(", ")}) — access rides the zone role now`,
          );
        }
        if (problems.length) {
          await report("turns-access", "#turns", problems.join("; "), () =>
            syncTurnsChannelAccess(prisma, { channelId: turnsId }),
          );
        }
      }
    } catch (err) {
      errors.push({ check: "turns-access", target: "#turns", message: err.message });
    }
  }

  const failures = [
    ...errors,
    ...findings.filter((f) => f.error).map((f) => ({ check: f.check, target: f.target, message: f.error })),
  ];
  const summaryCounts = {};
  for (const f of findings) summaryCounts[f.check] = (summaryCounts[f.check] ?? 0) + 1;

  const result = {
    scope,
    apply,
    findings,
    failures,
    repaired: findings.filter((f) => f.repaired).length,
  };

  await prisma.systemReport
    .create({
      data: {
        kind: "DOCTOR",
        startedAt,
        finishedAt: new Date(),
        ok: failures.length === 0,
        actorDiscordUserId,
        summary: {
          scope,
          apply,
          findings: findings.length,
          repaired: result.repaired,
          byCheck: summaryCounts,
        },
        failures: [
          ...failures,
          ...findings
            .filter((f) => !f.repaired && !f.error)
            .map((f) => ({ check: f.check, target: f.target, message: f.problem })),
        ],
      },
    })
    .catch((err) => console.error("Channel doctor: report write failed:", err.message));

  return result;
}

module.exports = { runChannelDoctor };
