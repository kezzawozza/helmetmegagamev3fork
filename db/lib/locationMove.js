// The Discord half of ANY location change — the Travel button, the web's writers (creation, GM teleport, Bulk Move) and the staged "Relocate to" at the turn push all call this after their DB write has committed, never from inside it (see db/lib/stagedPush.js). Pure REST, so one implementation serves both faces. Deliberately NOT on the @lifeweb/db barrel, same reasoning as db/lib/dm.js — require it by path. Every call here is .catch-logged, never thrown; the channel doctor's post-turn pass is the safety net for anything a call here missed.
const {
  addMemberRole,
  removeMemberRole,
  putChannelOverwrite,
  deleteChannelOverwrite,
  postMessage,
  addThreadMember,
} = require("./discordRest");
const { DM_ACTION, dmAction } = require("./dmActions");
const { buildNarrowcastContext, computeNarrowcastAccess, SPECIAL_CHANNELS } = require("./specialChannels");
const { applyPendingInvites } = require("./threadInvites");
const { conversationsFor } = require("./conversations");
const { notifyPresence } = require("./presenceNotify");
const { syncCharacterRoomAccess } = require("./roomAccess");
const { ambientLine } = require("./ambientLine");
const { STEALTH_SLUG } = require("./constants");
const { sceneLineAt } = require("./scene");
const { settleCarry, deliverCarryDrop } = require("./carry");
const {
  parkMountsIndoors,
  parkedMessage,
  dismountForNarrowWay,
  dismountedMessage,
} = require("./indoors");
const { applyArrivalMood } = require("./mood");
const { recordArrival } = require("./locationVisits");
const { cancelWatchOnMove, releaseHeldBy, INTERCEPT_CANCELLED_DM } = require("./intercept");
const { closeFightsFor } = require("./attack");
const { reconcileCorpses } = require("./corpseFollow");
const { LOCATION_MEMBER_ALLOW, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY } = require("./zoneChannelSpec");
const { lightVantage, clearVantage, vantagesFor, dropVantages } = require("./vantages");
const { linkBetween, endpoints, shouldPromptKeyed } = require("./locationGraph");
const { keyedPromptRow } = require("./locationAnchorRow");
const { aliasSubject } = require("./concealedIdentity");
const { sendDm } = require("./dm");
const { rollTurretOnArrival, TURRET_DM } = require("./depotPass");
const { applyDeathTeardown } = require("./deathTeardown");
const {
  rollGatehouseTurretOnArrival,
  GATEHOUSE_TURRET_DM,
} = require("./gatehouseTurret");
// The gun's own DM wording lives with each gun; naming the wound underneath it is the same job for both, so that half is shared.
const { turretDmFor } = require("./turretPass");
// Announcing carries its own DISCORD_TOKEN guard, so calling it beside the roll is safe even though the roll itself deliberately runs above that guard.
const { announceTurretBurst } = require("./turretBurst");

// Mirrors web/lib/discordGuild.js's PERM_VIEW_CHANNEL / PERM_SEND_MESSAGES — duplicated rather than imported because db/ cannot reach into web/.
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Reconciles a character's per-member overwrites on the narrowcast channels (#cerberon) against their CURRENT zone/tags. Same computation as web/lib/discordGuild.js#syncCharacterNarrowcastAccess, built on db/lib REST primitives instead of web's.
async function reconcileNarrowcastAccess(prisma, characterId, discordUserId) {
  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);

  await Promise.all(
    SPECIAL_CHANNELS.map((entry) => [entry.slug, config?.[entry.configKey]])
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const grant = access[slug];
        try {
          if (grant) {
            let allow = 0;
            if (grant.view || grant.send) allow |= PERM_VIEW_CHANNEL;
            if (grant.send) allow |= PERM_SEND_MESSAGES;
            await putChannelOverwrite(channelId, discordUserId, { allow: String(allow), type: 1 });
          } else {
            await deleteChannelOverwrite(channelId, discordUserId);
          }
        } catch (err) {
          console.error(`Narrowcast sync failed for ${slug}/${characterId}:`, err.message ?? err);
        }
      }),
  );
}

// Grant BEFORE revoke, deliberately: an interrupted swap leaves the player seeing two rooms for a moment (harmless, self-healing) rather than none (a lockout a player can't diagnose).
async function swapRole(discordUserId, fromRoleId, toRoleId, label) {
  if (toRoleId) {
    await addMemberRole(discordUserId, toRoleId).catch((err) =>
      console.error(`Move: failed to grant ${discordUserId} the ${label} role ${toRoleId}:`, err.message ?? err),
    );
  }
  if (fromRoleId && fromRoleId !== toRoleId) {
    await removeMemberRole(discordUserId, fromRoleId).catch((err) =>
      console.error(`Move: failed to remove ${discordUserId}'s ${label} role ${fromRoleId}:`, err.message ?? err),
    );
  }
}

// The Location half of a move, and the reason a Location wears no Discord role: one per-member overwrite on the channel, never a role. Spends none of the guild's 250 roles — see db/lib/zoneChannelSpec.js.
// Two masks now, not one: LOCATION_MEMBER_ALLOW for the street you stand in, LOCATION_VANTAGE_ALLOW + LOCATION_VANTAGE_DENY for one you walked out of and are still watching (db/lib/vantages.js). The watcher needs the deny, not just a smaller allow — @everyone would otherwise hand back thread-send and reactions. Same call either way; a PUT replaces both halves, so walking back in clears the deny.
async function openLocationTo(discordUserId, channelId, allow, deny = 0n) {
  if (!channelId) return;
  await putChannelOverwrite(channelId, discordUserId, {
    allow: String(allow),
    deny: String(deny),
    type: 1,
  }).catch((err) =>
    console.error(`Move: failed to open ${channelId} to ${discordUserId}:`, err.message ?? err),
  );
}

async function closeLocationTo(discordUserId, channelId) {
  if (!channelId) return;
  await deleteChannelOverwrite(channelId, discordUserId).catch((err) =>
    console.error(`Move: failed to close ${channelId} to ${discordUserId}:`, err.message ?? err),
  );
}

// Everything Discord needs to know to put a character back where they already stand: the Location overwrite, zone role, narrowcast, private-room threads, conversations, and standing invites. This is the "web only" switch coming OFF (db/lib/webOnly.js, CHAT.md §6), built on the SAME four helpers a move uses — swapLocationOverwrite, swapRole, reconcileNarrowcastAccess, syncCharacterRoomAccess — rather than a second copy; there's no origin, so every call is a pure grant. Best-effort throughout, like every other call in this file — anything that fails is the channel doctor's next pass to repair, which it can now do because it knows the flag.
async function materializeDiscordPresence(prisma, character) {
  if (!process.env.DISCORD_TOKEN) return;
  if (!character?.discordUserId || !character.locationId) return;
  const discordUserId = character.discordUserId;

  const location = await prisma.location.findUnique({
    where: { id: character.locationId },
    include: { zone: true },
  });
  if (!location) return;

  await openLocationTo(discordUserId, location.discordChannelId ?? null, LOCATION_MEMBER_ALLOW);
  await swapRole(discordUserId, null, location.zone?.discordRoleId ?? null, "zone");

  // The fog of war comes back on too. Vantage rows are a database fact and survived the switch being on (db/lib/vantages.js); this is the Discord half catching up, so the places they walked through earlier this turn are where they left them rather than dark until the next move.
  const vantages = await vantagesFor(prisma, { id: character.id, zoneId: location.zoneId }).catch((err) => {
    console.error(`Web-only off: vantage lookup failed for ${character.id}:`, err.message ?? err);
    return [];
  });
  for (const vantage of vantages) {
    await openLocationTo(discordUserId, vantage.location?.discordChannelId ?? null, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY);
  }
  await reconcileNarrowcastAccess(prisma, character.id, discordUserId).catch((err) =>
    console.error(`Web-only off: narrowcast reconcile failed for ${character.id}:`, err.message ?? err),
  );
  await syncCharacterRoomAccess(prisma, character).catch((err) =>
    console.error(`Web-only off: room access sync failed for ${character.id}:`, err.message ?? err),
  );

  // Conversations are a DB row and Discord's member list is its projection (db/lib/conversations.js), so the rows survived the switch being on and this is the projection catching up. Location-filtered for the same reason /add is: Discord sheds a thread member who cannot see the parent.
  const conversations = await conversationsFor(prisma, character.id, {
    locationId: character.locationId,
  }).catch((err) => {
    console.error(`Web-only off: conversation lookup failed for ${character.id}:`, err.message ?? err);
    return [];
  });
  for (const conversation of conversations) {
    await addThreadMember(conversation.threadId, discordUserId).catch((err) =>
      console.error(
        `Web-only off: failed to re-add ${character.id} to conversation ${conversation.threadId}:`,
        err.message ?? err,
      ),
    );
  }

  await applyPendingInvites(prisma, character).catch((err) =>
    console.error(`Web-only off: thread invite pass failed for ${character.id}:`, err.message ?? err),
  );
}

// What a crossing actually says, once the traveller's own tags have had their say. Pure and exported so the rule is testable without a database (db/lib/inspectVision.js posture). Stealth takes the announcement down ONE step rather than silencing every gate — you can be quiet, but not quiet past somebody reading your papers.
// unmanned (CONCEALED) -> NONE (nobody was watching); manned (TRUE_NAME) -> CONCEALED (what a passer-by saw, not your papers). So a stealthy traveller at the Fortress gatehouse lands where an ordinary one lands at the Town gates, and at the Town gates they vanish. NONE stays NONE: a gate that announces nothing cannot announce less.
const STEALTH_DOWNGRADE = { TRUE_NAME: "CONCEALED", CONCEALED: "NONE" };

function announceLevelFor(linkAnnounce, characterTags = []) {
  if (linkAnnounce === "NONE") return "NONE";
  const stealthy = (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === STEALTH_SLUG);
  if (!stealthy) return linkAnnounce;
  return STEALTH_DOWNGRADE[linkAnnounce] ?? linkAnnounce;
}

// A gate crossing, announced in the destination zone's #summary as game narration, not the character speaking — a plain bot message, NOT postAsCharacter, since a webhook post under the traveller's own name would defeat the unmanned form. A manned gate has a Cerberus reading papers (true name, /conceal doesn't help); an unmanned one records what a passer-by saw ("An old woman"), never the name behind it.
// Derived from the edge rather than passed in, so every writer of Character.locationId gets this for free — a GM's teleport onto a non-adjacent location finds no link and announces nothing, which is right.
async function announceGateCrossing(prisma, character, fromLocationId, toLocation) {
  if (!fromLocationId) return;
  const channelId = toLocation.zone?.discordSummaryChannelId ?? null;
  if (!channelId) return;

  const link = await linkBetween(prisma, fromLocationId, toLocation.id);
  if (!link || link.announce === "NONE") return;

  const announce = announceLevelFor(link.announce, character.tags);
  if (announce === "NONE") return;

  const who = announce === "TRUE_NAME" ? character.name : aliasSubject(character);
  if (!who) return;
  const said = `${who} has entered ${toLocation.name}.`;
  await postMessage(channelId, ambientLine(said));
  // Chat's half of the same crossing (db/lib/scene.js), beside the post.
  await sceneLineAt(prisma, { zoneId: toLocation.zone?.id ?? toLocation.zoneId, text: said });
}

// The offer to hold a keyed door open behind you. Only the key-holder is asked, and only while the way is shut (see shouldPromptKeyed). Deliberately a DM rather than a channel post: the whole point of a keyed way is that it's usually secret, and asking in the open would tell the room it exists.
// The 24 hours aren't started here — this only poses the question; the button handler in bot/src/events/interactionCreate.js stamps openUntil, so a player who never answers leaves the door shut, the safe default.
async function offerToHoldKeyed(prisma, character, fromLocationId, toLocation) {
  if (!fromLocationId) return;
  const link = await linkBetween(prisma, fromLocationId, toLocation.id);
  const tagSlugs = (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean);
  if (!shouldPromptKeyed(link, { tagSlugs })) return;

  const far = endpoints(link, toLocation.id).far;
  await sendDm(
    prisma,
    character.discordUserId,
    `The way between ${far.name} and ${toLocation.name} is open behind you. Leave it open for the next 24 hours?\n` +
      `-# While it stands open, anyone can see it and follow you through.`,
    { components: keyedPromptRow(link.id), meta: dmAction(DM_ACTION.KEYED_WAY, link.id), source: "bot_auto" },
  );
}

// Everything a location change must do in Discord once the DB write has landed: swap the location overwrite, announce a gate crossing, offer to hold a keyed way open, swap the zone role and reconcile narrowcast if the zone changed, then private-room membership and standing conversation invites wherever they now stand. `entry` is { characterId, fromLocationId, toLocationId, dismounted } — zones are read from the locations, and the character row is re-read so a stale caller can't swap the wrong account.
// `dismounted` is optional: names db/lib/locationTravel.js#performLocationMove already unequipped for a way too narrow to ride or push through, if this move came from there — see the comment below on why that has to happen inside performLocationMove's own transaction rather than here.
// `walked` says the character got here ON FOOT, and only a walk leaves the place behind them lit (db/lib/vantages.js). It defaults to FALSE and the two travel callers opt in, so a GM teleport, a rite, a threat spawn, a staged "Relocate to", Xom and a first placement all leave nothing behind — you cannot keep watching a street you never walked out of.
async function applyLocationMoveSideEffects(prisma, { characterId, fromLocationId, toLocationId, dismounted, walked = false }) {
  if (!characterId || !toLocationId) return;
  if (fromLocationId === toLocationId) return;

  // The map remembers. Here rather than in performLocationMove because this function is the one every writer of Character.locationId runs (§4 below) — a GM teleport, first placement, a rite and the turn's arrival pass all land here; hooking the mover instead would leave each a hole in somebody's map. Before the Discord guard for the same reason parking a mount is: knowing where you've been is a database fact and must not depend on there being a token to talk to Discord with.
  // Wrapped, because losing a node off a map must never wedge a move — /map's own loader re-records the character's current location on every open, so a drop here heals itself next time they look.
  await recordArrival(prisma, { id: characterId }, toLocationId).catch((err) => {
    console.error(`Move: recording the visit failed for ${characterId}:`, err.message ?? err);
  });

  // A hold is a hand on a shoulder, and it ends when the holder leaves — HOWEVER they leave. performLocationMove already does this inside its own transaction for walking off (INTERCEPT.md §3); this is the same clear for being taken away instead. Idempotent, so the walking case running it twice costs one no-op update.
  if (fromLocationId) {
    await releaseHeldBy(prisma, characterId).catch((err) =>
      console.error(`Move: releasing holds failed for ${characterId}:`, err.message ?? err),
    );
    // The same clear for a FIGHT (docs/systemdocs/ATTACK.md). releaseHeldBy deliberately won't touch one — both sides are held, and only the row knows whether either is still in another — so the row is what gets ended here, unpicking both holds on its way out.
    await closeFightsFor(prisma, characterId).catch((err) =>
      console.error(`Move: closing fights failed for ${characterId}:`, err.message ?? err),
    );
  }

  // Laying in wait ends the moment you leave the place you were waiting in (docs/systemdocs/INTERCEPT.md §1). Here rather than in performLocationMove because this is the writer every relocation runs — a teleport, Bulk Move, a staged Relocate to and a rite all break the anchor as surely as walking does. Above the Discord guard, same recordArrival reasoning: the watch is a database fact and must not survive on a box with no token.
  // `fromLocationId` has to be set. Three callers pass null for something that is NOT a move — a GM's Discord resync, a revive, and a character's first placement — cancelling on those would have a GM pressing Resync silently end a player's ambush.
  const droppedWatch = fromLocationId
    ? await cancelWatchOnMove(prisma, characterId).catch((err) => {
        console.error(`Move: cancelling the watch failed for ${characterId}:`, err.message ?? err);
        return null;
      })
    : null;

  // Before the Discord guard below, because this is a DB change that must happen whether or not there's a token to talk to Discord with. Also before the settle further down, so the settle sees the reduced cap and grants Overburdened in the same pass (docs/systemdocs/CARRY.md §3).
  const parked = await parkMountsIndoors(prisma, characterId, toLocationId).catch((err) => {
    console.error(`Move: parking mounts failed for ${characterId}:`, err.message ?? err);
    return [];
  });

  // The other trigger for the same thing: a way too narrow for what they had out. `performLocationMove` already does this itself, inside its own transaction, so a mount that doesn't survive a crossing can never bank the extra free move it buys (MAP.md §2c) — the caller passes those names straight through as `dismounted`, skipping a redo that would only ever find nothing left to unequip. A caller with no such result (a GM teleport, a rite, a spawn — none of which cross a graph edge) leaves it undefined and gets the independent check below, a no-op unless there really is a matching onFoot link.
  const dismountedNames =
    dismounted ??
    (fromLocationId
      ? await linkBetween(prisma, fromLocationId, toLocationId)
          .then((link) => dismountForNarrowWay(prisma, characterId, link))
          .catch((err) => {
            console.error(`Move: dismounting for a narrow way failed for ${characterId}:`, err.message ?? err);
            return [];
          })
      : []);


  // What walking in here does to the nerves is a DB fact too, same as parking
  // a mount above — before the Discord guard, so it lands whether or not
  // there's a token to talk to Discord with (docs/systemdocs/MOOD.md). No
  // per-turn ration on the arrival cost: a mount's two crossings are two real
  // arrivals. The Cathedral's relief rations itself inside.
  await applyArrivalMood(prisma, { characterId, fromLocationId, toLocationId }).catch((err) => {
    console.error(`Move: mood on arrival failed for ${characterId}:`, err.message ?? err);
  });

  // Walking into an armed turret. Before the Discord guard and the early return, same reason parking a mount is: being shot is a database fact and must not depend on there being a token to announce it with. Wrapped, because a gun malfunctioning must never wedge a move.
  // Both guns are asked, because a move only ever arrives in one place: each checks the destination slug first and costs a single indexed read to say no. See db/lib/turretPass.js on why the armed check is a thunk.
  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { number: true, id: true },
  });
  const turrets = [
    { roll: rollTurretOnArrival, dms: TURRET_DM, label: "depot" },
    { roll: rollGatehouseTurretOnArrival, dms: GATEHOUSE_TURRET_DM, label: "gatehouse" },
  ];
  for (const turret of turrets) {
    const shot = await turret.roll(prisma, { characterId, toLocationId, turn: openTurn }).catch((err) => {
      console.error(`Move: ${turret.label} turret failed for ${characterId}:`, err.message ?? err);
      return null;
    });
    if (!shot) continue;
    if (shot.discordUserId && shot.kind !== "graze") {
      await sendDm(prisma, shot.discordUserId, turretDmFor(turret.dms, shot)).catch((err) =>
        console.error(`Move: turret DM failed for ${characterId}:`, err.message ?? err),
      );
    }
    // A kill on arrival happens outside the turn engine, so the side-effect thunk that tears every other death down never sees it. Done here instead, and only here — the turn-end sweep's kills are carried up to db/index.js as `deaths` rather than torn down inline.
    if (shot.death) {
      await applyDeathTeardown(prisma, shot.death).catch((err) =>
        console.error(`Move: death teardown failed for ${characterId}:`, err.message ?? err),
      );
    }

    // The noise carries whatever the roll was — a graze is still a machinegun going off, and a zone that only hears the shots that land can never learn to stay out of the yard.
    await announceTurretBurst(prisma, shot.locationId).catch((err) =>
      console.error(`Move: turret burst failed for ${characterId}:`, err.message ?? err),
    );
  }

  const [fromLocation, toLocation, character] = await Promise.all([
    fromLocationId ? prisma.location.findUnique({ where: { id: fromLocationId }, include: { zone: true } }) : null,
    prisma.location.findUnique({ where: { id: toLocationId }, include: { zone: true } }),
    prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        discordUserId: true,
        locationId: true,
        status: true,
        concealed: true,
        age: true,
        gender: true,
        webOnly: true,
        tags: { select: { tag: { select: { slug: true } } } },
      },
    }),
  ]);
  if (!toLocation) return;

  // THE FOG OF WAR (db/lib/vantages.js). Above the Discord guard below, same reasoning as recordArrival: what a character can still see is a database fact, and the web reads it whether or not there is a token to talk to Discord with.
  // Leaving the zone puts every light out — all of them, not just the one behind you — and that holds however the character left, walked or carried. Staying inside it leaves the street they walked out of lit, read-only, until the turn shifts.
  const leftZone = Boolean(fromLocation) && fromLocation.zoneId !== toLocation.zoneId;
  const droppedVantages = leftZone
    ? await dropVantages(prisma, characterId).catch((err) => {
        console.error(`Move: dropping vantages failed for ${characterId}:`, err.message ?? err);
        return [];
      })
    : [];
  if (!leftZone) {
    // Arriving anywhere puts that street's own light out, walked or not: it is Here now, and Here is never a row.
    await clearVantage(prisma, characterId, toLocationId).catch((err) =>
      console.error(`Move: clearing the vantage failed for ${characterId}:`, err.message ?? err),
    );
  }
  if (walked && !leftZone && fromLocationId) {
    await lightVantage(prisma, {
      characterId,
      fromLocationId,
      toLocationId,
      zoneId: toLocation.zoneId,
      turnId: openTurn?.id ?? null,
    }).catch((err) => console.error(`Move: lighting the vantage failed for ${characterId}:`, err.message ?? err));
  }

  // No token is still a move: the database says where they stand and what they can still watch, so the web's place list has to be told either way (CHAT.md §3).
  if (!process.env.DISCORD_TOKEN) {
    await notifyPresence(prisma, characterId);
    return;
  }
  if (!character?.discordUserId) {
    await notifyPresence(prisma, characterId);
    return;
  }
  const discordUserId = character.discordUserId;

  // The watch this move just ended, told plainly — the delete happened above the guard, only the letter waits for a token. FIRST of the DMs, ahead of the channel work below, because swapLocationOverwrite/swapRole are unguarded and every caller swallows this function's throw — a Discord 5xx down there and the owner would never hear their watch was gone.
  if (droppedWatch?.cancelled) {
    await sendDm(prisma, discordUserId, INTERCEPT_CANCELLED_DM).catch((err) =>
      console.error(`Move: intercept-cancelled DM to ${discordUserId} failed:`, err.message ?? err),
    );
  }

  // The "web only" switch holds this account out of every channel, so the Discord half of standing somewhere is simply not done for them (CHAT.md §6). Everything else below still runs: the gate crossing is scenery the rest of the zone reads, the keyed-door offer and parked-mount note are DMs, and the carry, corpse and presence work is the database.
  // Grant BEFORE revoke, deliberately: an interrupted swap leaves the player seeing two streets for a moment (harmless, self-healing) rather than none (a lockout a player can't diagnose).
  if (!character.webOnly) {
    await openLocationTo(discordUserId, toLocation.discordChannelId ?? null, LOCATION_MEMBER_ALLOW);

    if (fromLocation && fromLocation.discordChannelId !== toLocation.discordChannelId) {
      if (leftZone) {
        // Out of the zone: the street behind them closes like it always did.
        await closeLocationTo(discordUserId, fromLocation.discordChannelId ?? null);
      } else if (walked) {
        // Still in the zone, and they walked: the street behind them stays open, mute. A DOWNGRADE, not a delete — the same one REST call the old revoke cost.
        await openLocationTo(discordUserId, fromLocation.discordChannelId ?? null, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY);
      } else {
        await closeLocationTo(discordUserId, fromLocation.discordChannelId ?? null);
      }
    }

    // Everything the zone crossing put out, told to Discord. One call per light; a character carries a handful at most, since a turn buys a handful of Moves.
    for (const vantage of droppedVantages) {
      await closeLocationTo(discordUserId, vantage.location?.discordChannelId ?? null);
    }
  }

  await announceGateCrossing(prisma, character, fromLocationId, toLocation).catch((err) =>
    console.error(`Move: gate announcement failed for ${characterId}:`, err.message ?? err),
  );

  await offerToHoldKeyed(prisma, character, fromLocationId, toLocation).catch((err) =>
    console.error(`Move: keyed-door offer failed for ${characterId}:`, err.message ?? err),
  );

  if (!character.webOnly && fromLocation?.zoneId !== toLocation.zoneId) {
    await swapRole(discordUserId, fromLocation?.zone?.discordRoleId ?? null, toLocation.zone?.discordRoleId ?? null, "zone");
    await reconcileNarrowcastAccess(prisma, characterId, discordUserId).catch((err) =>
      console.error(`Move: narrowcast reconcile failed for ${characterId}:`, err.message ?? err),
    );
  }

  if (parked.length > 0) {
    await sendDm(prisma, discordUserId, parkedMessage(parked, toLocation.name)).catch((err) =>
      console.error(`Move: parked-mount DM to ${discordUserId} failed:`, err.message ?? err),
    );
  }
  if (dismountedNames.length > 0) {
    await sendDm(prisma, discordUserId, dismountedMessage(dismountedNames)).catch((err) =>
      console.error(`Move: dismount DM to ${discordUserId} failed:`, err.message ?? err),
    );
  }

  // Settle carry BEFORE room access: arriving somewhere with a public room is what lets a deferred overflow drop finally land (db/lib/carry.js), and that drop can take a private-room key off the sheet, so membership has to be recomputed from the post-drop holdings.
  const carry = await settleCarry(prisma, characterId).catch((err) => {
    console.error(`Move: carry settle failed for ${characterId}:`, err.message ?? err);
    return null;
  });

  // A MOVE cannot change what this character is ENTITLED to, and thread membership follows entitlement now rather than presence (db/lib/roomAccess.js). What a move changes is guest rows, spent by walking out — `guestsOnly` sweeps those and makes no Discord calls in the ordinary case, which is what stopped Discord narrating "… added <name> to the thread" into every room on every arrival.
  // A FIRST PLACEMENT is the exception and gets the full recompute: `null` fromLocationId means nobody walked, a character being put on the map for the first time (created, spawned into a threat seat, or GM-relocated from nowhere) — nothing else would ever add them to their threads, since the mover no longer does and a tag change might not come for days. Getting this wrong is silent: a new Cerberus simply never sees the Dungeons.
  await syncCharacterRoomAccess(prisma, { ...character, locationId: toLocationId }, {
    guestsOnly: Boolean(fromLocationId),
  }).catch((err) =>
    console.error(`Move: room access sync failed for ${characterId}:`, err.message ?? err),
  );

  // Any body this character was carrying has just moved with them, and NOTHING WROTE A TAG to say so — only their own locationId changed. This is the one hook the whole corpse-as-handle design depends on; a push from a tag writer could never catch it. See db/lib/corpseFollow.js.
  await reconcileCorpses(prisma).catch((err) =>
    console.error(`Move: corpse follow failed for ${characterId}:`, err.message ?? err),
  );
  if (carry?.drop) {
    await deliverCarryDrop(prisma, carry).catch((err) =>
      console.error(`Move: carry drop delivery failed for ${characterId}:`, err.message ?? err),
    );
  }
  await applyPendingInvites(prisma, { ...character, locationId: toLocationId }).catch((err) =>
    console.error(`Move: thread invite pass failed for ${characterId}:`, err.message ?? err),
  );

  // The feet moved, so the web's place list did too: every open /chat tab of this character re-asks db/lib/feedAccess.js#placesFor (CHAT.md §3).
  await notifyPresence(prisma, characterId);
}

module.exports = {
  applyLocationMoveSideEffects,
  materializeDiscordPresence,
  reconcileNarrowcastAccess,
  announceLevelFor,
};
