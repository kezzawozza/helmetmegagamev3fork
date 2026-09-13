// Everything the turn advance says out loud. The only place in the
// turn-advance path that talks to Discord — every resolveNeeds() pass hands
// back posts and DMs instead of sending them, so a 429 can never wedge a turn
// inside its transaction.
//
// WHY THIS IS ITS OWN MODULE, AND WHY IT HAS A LEDGER. It used to be a closure
// inside advanceTurn(), holding thirty arrays in one process's memory with no
// record anywhere that it had run. On 2026-09-08 the bomb went off at the
// close of turn 3, the database half committed perfectly — twelve dead, the
// game ended, all of it logged — and a redeploy landed twenty-eight seconds
// later and SIGTERM'd the container mid-fan-out. Three of twelve death DMs got
// out. The fireball and the Game Ended post never did, and nothing on earth
// was going to retry them: resolveNeeds() stamps Turn.needsResolvedAt before
// this thunk is even built, so as far as the resume query was concerned that
// turn was finished.
//
// So the payload is persisted (Turn.sideEffectPayload) and the progress is
// recorded (Turn.sideEffectSteps), exactly the way resolveNeeds() persists
// Turn.resolvedPasses one layer down, and for exactly the same reason: none of
// this is idempotent. Re-running the loop below sends somebody a second notice
// telling them they died.
//
// ORDER IS LOAD-BEARING AND MUST NOT BE TIDIED. The fireball sits after the
// death loop so nobody reads that the sky is on fire before their own
// character has died. The feed watermark goes before the Discord wipe. The
// turret burst goes before the DMs telling people what it hit.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel — the
// db/lib/dm.js convention; require it by path.
const { Prisma } = require("@prisma/client");
const { sendDm } = require("./dm");
const { DM_KIND } = require("./dmKinds");
const { hungerDm, DYING_DM } = require("./hungerPass");
const { GHOST_ROLE_ID } = require("./roleIds");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("./constants");
const { announceTurretBurst } = require("./turretBurst");
const { ambientLine } = require("./ambientLine");
const { deliverCarryDrop } = require("./carry");
const { revokeAllCharacterAccess } = require("./accessSweep");
const { stillAlive } = require("./deathTeardown");
const { reconcileCharacterRoleNames } = require("./characterRoleNames");
const { refreshLiveRooms } = require("./syncZones");
const { broadcastToZones } = require("./worldBroadcast");
const { publicPostTargets } = require("./publicPostTargets");
const { postGameEnded } = require("./gameEnd");
const { syncSpectatorAccess } = require("./spectatorAccess");
const { sceneLine, sceneLineAt } = require("./scene");
const { deliverPrivate, deliverPublic, failuresFor } = require("./stagedDelivery");
const {
  placeKeyForLocation,
  placeKeyForConversation,
} = require("./placeKey");
const { postTurnsAnnouncement } = require("./turnAnnouncement");
const { runMessageWipe } = require("./messageWipe");
const {
  postMessage,
  patchGuildRole,
  getGuildRoles,
  deleteGuildRole,
  addMemberRole,
  getGuildMember,
  setGuildNickname,
} = require("./discordRest");

// Everything advanceTurn() has to hand over for this to be replayable in a
// process that never saw the turn resolve. Plain JSON only — no Prisma rows,
// no Dates, no functions. `newTurnId` rather than the row, and
// `messageWipeEnabled` is deliberately NOT captured: a resume should honour
// the switch as it stands now.
//
// `startedAtMs` is the one that bites if you forget it. It is the cutoff for
// the message wipe, and on a resumed run Date.now() is hours later — which
// would sweep away everything said in between.
function buildSideEffectPayload(fields) {
  return {
    startedAtMs: Date.now(),
    newTurnId: fields.newTurnId,
    note: fields.note ?? null,
    autoLaborDms: fields.autoLaborDms ?? [],
    lessonDms: fields.lessonDms ?? [],
    researchDms: fields.researchDms ?? [],
    confessionDms: fields.confessionDms ?? [],
    trinketDms: fields.trinketDms ?? [],
    tagExpiryDms: fields.tagExpiryDms ?? [],
    turretBursts: fields.turretBursts ?? [],
    depotLocationId: fields.depotLocationId ?? null,
    depotLines: fields.depotLines ?? [],
    turretDms: fields.turretDms ?? [],
    birdNotices: fields.birdNotices ?? [],
    carryDrops: fields.carryDrops ?? [],
    catatonicDms: fields.catatonicDms ?? [],
    catatonicRoleUpdates: fields.catatonicRoleUpdates ?? [],
    catatonicDeathWarnings: fields.catatonicDeathWarnings ?? [],
    dyingDeathWarnings: fields.dyingDeathWarnings ?? [],
    catatonicDeaths: fields.catatonicDeaths ?? [],
    dyingDeaths: fields.dyingDeaths ?? [],
    nukeDeaths: fields.nukeDeaths ?? [],
    ascensionDeaths: fields.ascensionDeaths ?? [],
    turretDeaths: fields.turretDeaths ?? [],
    stagedDeaths: fields.stagedDeaths ?? [],
    hungerNotices: fields.hungerNotices ?? [],
    zoneMoves: fields.zoneMoves ?? [],
    travelArrivals: fields.travelArrivals ?? [],
    xomDeaths: fields.xomDeaths ?? [],
    xomTeleports: fields.xomTeleports ?? [],
    xomConversations: fields.xomConversations ?? [],
    xomShouts: fields.xomShouts ?? [],
    privateDeliveries: fields.privateDeliveries ?? [],
    routineNotices: fields.routineNotices ?? [],
    gambitRollNotices: fields.gambitRollNotices ?? [],
    nukeBroadcast: fields.nukeBroadcast ?? null,
    ascensionBroadcast: fields.ascensionBroadcast ?? null,
    gameEndedPost: fields.gameEndedPost ?? null,
    publicPosts: fields.publicPosts ?? [],
  };
}

async function runTurnSideEffects(prisma, { turnId, payload }) {
  const p = payload ?? {};

  // The whole point of this function is that it runs in a process that did not
  // write the payload — which may mean a DIFFERENT DEPLOY of it. A key this
  // build expects and that build never wrote must read as "nothing to send",
  // not throw halfway and strand the rest of the turn.
  const list = (v) => (Array.isArray(v) ? v : []);

  // Steps already sent — non-empty only when a previous run of this thunk
  // died part-way. Read fresh from the row rather than trusted from a caller,
  // so a resume in another process sees what the first one managed.
  const row = await prisma.turn.findUnique({
    where: { id: turnId },
    select: { sideEffectSteps: true },
  });
  const done = new Set(Array.isArray(row?.sideEffectSteps) ? row.sideEffectSteps : []);

  // One send, one key. A step that throws is left unrecorded, so the next run
  // retries it — the same bargain resolveNeeds() strikes with a failed pass.
  // The inner .catch()es below stay where they are: they stop one dead channel
  // taking the rest of a loop with it, which is a different job from surviving
  // a killed process.
  async function step(key, fn) {
    if (done.has(key)) return;
    try {
      await fn();
    } catch (err) {
      console.error(`Turn side effect "${key}" failed:`, err);
      return;
    }
    done.add(key);
    await prisma.turn
      .update({ where: { id: turnId }, data: { sideEffectSteps: [...done] } })
      .catch((err) => console.error(`Failed to record side effect "${key}":`, err));
  }

  // Index keys, not id keys: the payload is frozen on the row, so position is
  // stable across runs, and two notices to the same person stay distinct.
  async function eachDm(prefix, items, send) {
    const each = list(items);
    for (let i = 0; i < each.length; i += 1) {
      await step(`${prefix}:${i}`, () => send(each[i]));
    }
  }

  // Cutoff for the message wipe below, taken before the first Discord call so
  // nothing posted by this thunk gets swept. See db/lib/messageWipe.js.
  const sideEffectsStartedAt = p.startedAtMs ?? Date.now();

  const plainDm = (dm, label) => (
    sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
      console.error(`${label} DM to ${dm.discordUserId} failed:`, err),
    )
  );

  await eachDm("autoLabor", p.autoLaborDms, (dm) => plainDm(dm, "Auto-labor"));
  await eachDm("lesson", p.lessonDms, (dm) => plainDm(dm, "Lesson"));
  await eachDm("research", p.researchDms, (dm) => plainDm(dm, "Research"));
  await eachDm("confession", p.confessionDms, (dm) => plainDm(dm, "Confession"));
  await eachDm("trinket", p.trinketDms, (dm) => plainDm(dm, "Trinket"));
  await eachDm("tagExpiry", p.tagExpiryDms, (dm) => plainDm(dm, "Tag progression"));

  // A gun going off is heard well past the room it is in. Before the DMs
  // below rather than after, so the zone hears the burst at about the moment
  // the people it hit are told what it did to them.
  const turretBursts = list(p.turretBursts);
  for (let i = 0; i < turretBursts.length; i += 1) {
    const burstLocationId = turretBursts[i];
    await step(`turretBurst:${i}`, () =>
      announceTurretBurst(prisma, burstLocationId).catch((err) =>
        console.error("Turret burst failed:", err.message ?? err),
      ),
    );
  }

  // The Depot's hardware, speaking for itself: the generator dying and the
  // shuttle leaving on its own clock are both things the room witnesses.
  if (p.depotLocationId && list(p.depotLines).length) {
    const depotLocation = await prisma.location
      .findUnique({
        where: { id: p.depotLocationId },
        select: { discordChannelId: true },
      })
      .catch(() => null);
    if (depotLocation?.discordChannelId) {
      const depotLines = list(p.depotLines);
  for (let i = 0; i < depotLines.length; i += 1) {
        const line = depotLines[i];
        await step(`depotLine:${i}`, () =>
          postMessage(
            depotLocation.discordChannelId,
            ambientLine(line.text, [], { signed: line.signed }),
          ).catch((err) => console.error("Depot ambient line failed:", err)),
        );
      }
    }
  }

  // The Landing Pad's starter message says whether the shuttle is sitting on
  // it (db/lib/roomLive.js), and the shuttle may have left on its own clock
  // this turn. Hash-guarded, so a turn that did not move it edits nothing.
  if (p.depotLocationId) {
    await step("shuttleRefresh", () =>
      refreshLiveRooms(prisma, "shuttle").catch((err) =>
        console.error("Landing pad refresh failed:", err.message),
      ),
    );
  }

  await eachDm("turretDm", p.turretDms, (dm) => plainDm(dm, "Turret"));
  await eachDm("bird", p.birdNotices, (dm) => plainDm(dm, "Bird failure"));

  const carryDrops = list(p.carryDrops);
  for (let i = 0; i < carryDrops.length; i += 1) {
    const result = carryDrops[i];
    await step(`carryDrop:${i}`, () =>
      deliverCarryDrop(prisma, result).catch((err) =>
        console.error(`Carry drop delivery for ${result.characterId} failed:`, err),
      ),
    );
  }

  await eachDm("catatonicDm", p.catatonicDms, (dm) => plainDm(dm, "Catatonic"));

  // Two things want to rename a personal role in a turn — the Catatonic
  // suffix, and a disguise coming on or off (db/lib/characterRoleNames.js) —
  // and both compose their title through characterRoleAppearance. Merged
  // before anything is sent, so one role is never PATCHed twice in a pass:
  // the Catatonic list wins a collision, because it is computed from this
  // turn's own flagging while the reconcile is comparing against a role list
  // fetched before any of it happened.
  //
  // Best-effort, like every other Discord step in this block. The reconcile
  // is a comparison, so whatever it could not do this turn it will simply
  // find still disagreeing next turn — which is also why one key covers the
  // whole reconcile rather than one per role.
  await step("roleNames", async () => {
    const roleUpdates = new Map();
    const guildRoles = await getGuildRoles().catch((err) => {
      console.error("Couldn't read the guild's roles for the name reconcile:", err);
      return [];
    });
    for (const update of await reconcileCharacterRoleNames(prisma, guildRoles).catch((err) => {
      console.error("Character role name reconcile failed:", err);
      return [];
    })) {
      roleUpdates.set(update.roleId, update);
    }
    for (const update of list(p.catatonicRoleUpdates)) roleUpdates.set(update.roleId, update);

    for (const update of roleUpdates.values()) {
      await patchGuildRole(update.roleId, {
        name: update.name,
        color: update.color,
      }).catch((err) =>
        console.error(`Role rename for ${update.name} failed:`, err),
      );
    }
  });

  await eachDm(
    "deathWarning",
    [...list(p.catatonicDeathWarnings), ...list(p.dyingDeathWarnings)],
    (warning) =>
      sendDm(prisma, warning.discordUserId, warning.content).catch((err) =>
        console.error(`Death warning DM to ${warning.discordUserId} failed:`, err),
      ),
  );

  const turnDeaths = [
    ...list(p.stagedDeaths),
    ...list(p.catatonicDeaths),
    ...list(p.dyingDeaths),
    ...list(p.nukeDeaths),
    ...list(p.ascensionDeaths),
    ...list(p.turretDeaths),
    ...list(p.xomDeaths),
  ];

  // Same teardown web/lib/discordGuild.js#killCharacter performs, plus a
  // membership check up front so a departed player's steps don't just 403
  // into the REST breaker's tally.
  //
  // One key per body, not per REST call: a partly-torn-down character redoing
  // its role delete and ghost grant is harmless (both are idempotent), and
  // the one thing that is NOT — the death DM — sits at the end, so a body
  // that reached it reached the key too.
  for (let i = 0; i < turnDeaths.length; i += 1) {
    const death = turnDeaths[i];
    await step(`death:${death.characterId ?? death.id ?? i}`, async () => {
      const member = await getGuildMember(death.discordUserId).catch((err) => {
        console.error(`Membership check for ${death.name} failed:`, err);
        return null;
      });

      // `id` spread in because every pass builds its death entry with
      // `characterId`, and revokeAllCharacterAccess reads `character.id` to
      // clear private-Room door grants. Without it that deleteMany matched
      // nothing and a corpse kept every door somebody had held open for them —
      // silently, since the rest of the revoke worked fine.
      // A player who is alive again already — Metempsychosis put them in a new
      // body a moment ago (db/lib/reincarnate.js) — must not be stripped by
      // their own corpse's teardown. Everything below keys on discordUserId, so
      // it reaches the person rather than the body. Same guard, same reason, as
      // db/lib/deathTeardown.js#stillAlive.
      const reborn = await stillAlive(prisma, death.discordUserId);

      const revoked = reborn ? { failed: 0, attempted: 0 } : await revokeAllCharacterAccess(prisma, {
        ...death,
        id: death.id ?? death.characterId,
      }).catch((err) => {
        console.error(
          `Failed to revoke access for ${death.name} on an automatic death:`,
          err,
        );
        return null;
      });
      if (!revoked || revoked.failed > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "access_revoke_incomplete",
              targetCharacterId: death.characterId,
              targetName: death.name,
              details: {
                failed: revoked?.failed ?? null,
                attempted: revoked?.attempted ?? null,
              },
            },
          })
          .catch((err) =>
            console.error("Failed to log an incomplete access revoke:", err),
          );
      }

      if (death.discordRoleId) {
        await deleteGuildRole(death.discordRoleId).catch((err) =>
          console.error(
            `Failed to delete ${death.name}'s role on an automatic death:`,
            err.message,
          ),
        );
      }

      if (member && !reborn) {
        await addMemberRole(death.discordUserId, GHOST_ROLE_ID).catch((err) =>
          console.error(
            `Failed to grant the ghost seat to ${death.discordUserId}:`,
            err.message,
          ),
        );
        await setGuildNickname(death.discordUserId, null).catch((err) =>
          console.error(`Failed to clear ${death.name}'s nickname:`, err.message),
        );
        // A turret says it better than this loop can, and already has — its
        // own DM went out with the burst, in the second person and in the
        // gun's voice. Sending a generic notice after it would be the same
        // news twice. Everything else above still runs: the teardown is what
        // a turret kill was missing, not the words.
        if (!death.ownDm) {
          await sendDm(
            prisma,
            death.discordUserId,
            `You have died. ${death.reason}`,
          ).catch((err) =>
            console.error(`Death DM to ${death.discordUserId} failed:`, err),
          );
        }
      }
    });
  }

  if (turnDeaths.length > 0) {
    await step("leaveRollup", () =>
      postMessage(
        LEAVE_ANNOUNCE_CHANNEL_ID,
        turnDeaths
          .map((death) => `${death.name} has died — ${death.reason}`)
          .join("\n"),
      ).catch((err) =>
        console.error("Automatic-death alert to #leave failed:", err),
      ),
    );
  }

  await eachDm("hunger", p.hungerNotices, async (notice) => {
    await sendDm(prisma, notice.discordUserId, hungerDm(notice)).catch((err) =>
      console.error(`Hunger DM to ${notice.discordUserId} failed:`, err),
    );
    if (notice.justDied) {
      await sendDm(prisma, notice.discordUserId, DYING_DM).catch((err) =>
        console.error(`Dying DM to ${notice.discordUserId} failed:`, err),
      );
    }
  });

  const { applyLocationMoveSideEffects } = require("./locationMove");
  const { rollCavingOnArrival } = require("./cavingPass");
  // Two kinds of relocation land in the same breath and want the identical
  // Discord work: a GM's staged "Relocate to" (zoneMoves) and a player's
  // paid crossing finally arriving (travelArrivals, MAP.md §3).
  const relocations = [...list(p.zoneMoves), ...list(p.travelArrivals)];
  for (let i = 0; i < relocations.length; i += 1) {
    const move = relocations[i];
    await step(`move:${i}`, async () => {
      await applyLocationMoveSideEffects(prisma, move).catch((err) =>
        console.error(`Relocation side effects failed for ${move.characterId}:`, err),
      );

      // The traveller pressed Confirm a turn ago and has heard nothing since,
      // so arriving is the one thing that has to be told. A dragged corpse
      // gets no letter; `alive` is only set by the travel pass.
      if (move.toLocationName && move.alive && move.discordUserId) {
        await sendDm(
          prisma,
          move.discordUserId,
          `You arrive at **${move.toLocationName}**.`,
          { kind: DM_KIND.QUIET },
        ).catch((err) =>
          console.error(`Arrival DM to ${move.discordUserId} failed:`, err),
        );
      }

      // The Caving Die, for a GM's staged "Relocate to". It could not run
      // inside applyOneStagedEffect — rollCaving opens its own transaction and
      // that function is already in one — but out here the write has committed
      // and this is the same post-commit half every other DM goes out from.
      //
      // It has to happen SOMEWHERE, and this is the only place left: the
      // turn-start pass used to sweep up anyone a GM had dropped underground,
      // and with that pass gone a staged relocation into the Depths would
      // otherwise roll nothing at all until the character walked. Being
      // *dropped* into the dark being the one free walk in is exactly how the
      // die first looked broken (CAVING.md §2).
      const landed = move.toLocationId
        ? await prisma.location
            .findUnique({ where: { id: move.toLocationId }, include: { zone: true } })
            .catch(() => null)
        : null;
      if (landed && move.alive !== false) {
        const dm = await rollCavingOnArrival(
          prisma,
          { id: move.characterId, discordUserId: move.discordUserId },
          landed,
        );
        if (dm) {
          await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
            console.error(`Arrival caving DM to ${dm.discordUserId} failed:`, err),
          );
        }
      }
    });
  }

  // ---------------------------------------------------------------- Xom
  //
  // The three outcomes on db/lib/xomPass.js's table that are Discord-shaped
  // rather than "a tag on your sheet changed": a teleport, the conversation it
  // opens, and a scream. Everything else Xom does rode tagExpiryDms and is
  // already sent by the time this runs.
  //
  // Their own loops rather than a merge into `relocations` above, because that
  // loop's letter ("You arrive at X") is a sentence about a journey somebody
  // paid for, and this is the opposite of one.

  for (let i = 0; i < list(p.xomTeleports).length; i += 1) {
    const move = list(p.xomTeleports)[i];
    await step(`xomTeleport:${i}`, async () => {
      await applyLocationMoveSideEffects(prisma, move).catch((err) =>
        console.error(`Xom teleport side effects failed for ${move.characterId}:`, err),
      );

      // Its own ambient line at both ends, because Xom does not use the roads.
      // applyLocationMoveSideEffects announces a gate crossing only when there
      // is a graph link between the two places, and there almost never is one
      // here — without this the character simply materialises with nothing
      // said, at either end.
      const gone = `${move.name} is not here any more.`;
      const come = `${move.name} is here, and was not a moment ago.`;
      for (const [locationId, text] of [
        [move.fromLocationId, gone],
        [move.toLocationId, come],
      ]) {
        if (!locationId) continue;
        await sceneLineAt(prisma, { locationId, text }).catch(() => {});
        const location = await prisma.location
          .findUnique({ where: { id: locationId }, select: { discordChannelId: true } })
          .catch(() => null);
        if (location?.discordChannelId) {
          await postMessage(location.discordChannelId, ambientLine(text), undefined, {
            parse: [],
          }).catch(() => {});
        }
      }

      if (move.discordUserId) {
        await sendDm(prisma, move.discordUserId, "The floor changes under you.", {
          kind: DM_KIND.NOTICE,
        }).catch((err) => console.error(`Xom teleport DM to ${move.discordUserId} failed:`, err));
      }

      // The Caving Die, for the same reason the staged-relocate loop above
      // rolls it: being DROPPED into the dark must not be the one free walk in
      // (CAVING.md §2). Without this, Xom would be the cheapest way into the
      // Depths in the game.
      const landed = move.toLocationId
        ? await prisma.location
            .findUnique({ where: { id: move.toLocationId }, include: { zone: true } })
            .catch(() => null)
        : null;
      if (landed) {
        const dm = await rollCavingOnArrival(
          prisma,
          { id: move.characterId, discordUserId: move.discordUserId },
          landed,
        );
        if (dm) {
          await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
            console.error(`Xom caving DM to ${dm.discordUserId} failed:`, err),
          );
        }
      }
    });
  }

  // AFTER the teleports, always: the whole point is that the two of them are
  // standing in the same place when it opens.
  const { openConversationThread } = require("./conversationOpen");
  for (let i = 0; i < list(p.xomConversations).length; i += 1) {
    const wanted = list(p.xomConversations)[i];
    await step(`xomConversation:${i}`, async () => {
      const opened = await openConversationThread(prisma, {
        locationId: wanted.locationId,
        name: wanted.name,
        characterIds: wanted.characterIds,
        creatorCharacterId: wanted.characterIds?.[0] ?? null,
      });
      if (!opened.ok) {
        console.error(`Xom conversation failed: ${opened.error}`);
        return;
      }
      // The two PEOPLE, not their character name-tokens: this is meant to
      // arrive as a notification on a phone. `<@id>` is the vocabulary
      // db/lib/discordMarkup.js defines, and the web renders it as "someone".
      const people = await prisma.character.findMany({
        where: { id: { in: list(wanted.characterIds) } },
        select: { discordUserId: true },
      });
      const mentions = people
        .map((row) => (row.discordUserId ? `<@${row.discordUserId}>` : null))
        .filter(Boolean)
        .join(" ");
      // Full size and mentions parsed, not the `-#` scenery format: this is a
      // god shouting at two people to talk to each other, which sits on the
      // intercom's side of the line rather than the ambient one (CLAUDE.md).
      const body = [mentions, wanted.line].filter(Boolean).join("\n");
      await postMessage(opened.threadId, body).catch((err) =>
        console.error("Xom conversation opener failed:", err),
      );
      await sceneLine(prisma, {
        placeKey: placeKeyForConversation(opened.conversation.id),
        text: wanted.line,
      }).catch(() => {});
    });
  }

  const { shout, deliverShout } = require("./shout");
  for (let i = 0; i < list(p.xomShouts).length; i += 1) {
    const scream = list(p.xomShouts)[i];
    await step(`xomShout:${i}`, async () => {
      // shout() as it stands, gates and all. A Mute holder does not scream and
      // a holder who shouted five minutes ago has nothing left in the throat —
      // the outcome is simply spent, which is the price of the god borrowing a
      // real voice rather than inventing one.
      //
      // The placeKey is the LOCATION, never a Room or a Conversation: the turn
      // engine has no idea which thread anybody was sitting in at 04:00. So a
      // Xom scream is made on the map, and a soundproof room never seals one.
      const placeKey = placeKeyForLocation(scream.locationId);
      const result = await shout(
        prisma,
        { id: scream.characterId, name: scream.name, discordUserId: scream.discordUserId, locationId: scream.locationId },
        scream.text,
        { placeKey },
      ).catch((err) => {
        console.error(`Xom shout for ${scream.characterId} failed:`, err);
        return { ok: false };
      });
      if (!result.ok) return;

      // Delivery is db/lib/shout.js#deliverShout, the same call Chat and the
      // bot make. It matters here more than there: `placeKey` above is a
      // LOCATION key, and soundRange counts the shouter's own Location as
      // distance 0, so `here` and `heard[0]` are the same place. deliverShout
      // skips that collision. Before it did, every Xom scream wrote the
      // origin's archive row twice and posted to its channel twice.
      await deliverShout(prisma, { placeKey, here: result.here, heard: result.heard });
    });
  }

  // Staged-arbitration deliveries (docs/systemdocs/ADJUDICATION.md §1a).
  //
  // One Delivery row per recipient carries the state now, and
  // db/lib/stagedDelivery.js is the same code the Resend button runs — so a
  // bounce is a FAILED row a later attempt can claim, rather than a step key
  // that says "done" because the loop did not throw. The step ladder still
  // wraps the message as a whole (a message fully delivered is not re-walked
  // on a resume), but the per-recipient no-double-send promise no longer
  // depends on it: the claim does.
  //
  // The error is NOT swallowed inside step() any more — deliverPrivate hands
  // back what failed and the key is recorded either way, because the rows
  // below are what a retry reads, not the key.
  const deliveryFailures = [];
  for (const delivery of list(p.privateDeliveries)) {
    await step(`delivery:${delivery.stagedMessageId}`, async () => {
      const stagedMessage = {
        id: delivery.stagedMessageId,
        content: delivery.content,
        createdByDiscordUserId: delivery.createdByDiscordUserId ?? null,
      };
      const { failed, skipped } = await deliverPrivate(prisma, {
        stagedMessage,
        recipients: list(delivery.recipients),
      });
      // sentAt says "delivery was attempted for every recipient", which is
      // what the tray's missed-push banner reads. The failure list is derived
      // from the rows rather than from this run — ALWAYS, not only when this
      // run bounced somebody. A run that fails nobody can still be looking at a
      // message with FAILED rows on it (a partial push resumed, or a Resend
      // running beside it), and blanking the blob there told the tray the
      // message was clean while the rows said otherwise.
      const rowFailures = await failuresFor(prisma, delivery.stagedMessageId);
      await prisma.stagedMessage
        .update({
          where: { id: delivery.stagedMessageId },
          data: {
            sentAt: new Date(),
            deliveryFailures: rowFailures.length ? rowFailures : Prisma.DbNull,
          },
        })
        .catch((err) =>
          console.error(`Failed to stamp staged message ${delivery.stagedMessageId} sent:`, err),
        );
      if (failed.length || skipped.length)
        deliveryFailures.push({
          stagedMessageId: delivery.stagedMessageId,
          attempted: list(delivery.recipients).length,
          delivered: list(delivery.recipients).length - failed.length - skipped.length,
          failed,
          // Somebody else's claim — a Resend pressed mid-push, or a second
          // runner. Not a bounce, but not a delivery either, and a GM reading
          // the audit row needs the count to add up.
          ...(skipped.length ? { skipped } : {}),
        });
      // THE KEY IS NOT RECORDED WHEN ANYBODY BOUNCED. That is the whole reason
      // the step ladder stopped being the record: a recorded key means "never
      // walk this message again", and a resumed push must retry a bounce. The
      // rows underneath are idempotent, so re-walking costs a SENT recipient
      // nothing. A skip is somebody else's claim, and re-walking that is free
      // too, so it counts as unfinished for the same reason.
      if (failed.length || skipped.length)
        throw new Error(
          `staged message ${delivery.stagedMessageId}: ${failed.length} bounced, ${skipped.length} held by another run`,
        );
    });
  }

  await eachDm("routine", p.routineNotices, (notice) =>
    sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
      console.error(`Passed-Routine DM to ${notice.discordUserId} failed:`, err),
    ),
  );

  await eachDm("gambit", p.gambitRollNotices, (notice) =>
    sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
      console.error(`Gambit roll DM to ${notice.discordUserId} failed:`, err),
    ),
  );

  // The fireball, into every zone's #summary. Last of the announcements and
  // after the deaths above, so nobody reads that the sky is on fire before
  // their own character has actually died. It carries a real @everyone —
  // the one message in the game that should wake somebody who is asleep.
  if (p.nukeBroadcast) {
    await step("nukeBroadcast", async () => {
      const { sent, failed } = await broadcastToZones(prisma, p.nukeBroadcast.content, {
        mentionEveryone: p.nukeBroadcast.mentionEveryone,
      }).catch((err) => {
        console.error("Nuke broadcast failed:", err);
        return { sent: 0, failed: [] };
      });
      console.log(`Nuke broadcast: ${sent} zones, ${failed.length} failed.`);
    });
  }

  // The hellfire, same fan-out, no @everyone: the town was warned two turns
  // ago and that was the message worth waking somebody for.
  if (p.ascensionBroadcast) {
    await step("ascensionBroadcast", async () => {
      const { sent, failed } = await broadcastToZones(
        prisma,
        p.ascensionBroadcast.content,
      ).catch((err) => {
        console.error("Ascension broadcast failed:", err);
        return { sent: 0, failed: [] };
      });
      console.log(`Ascension broadcast: ${sent} zones, ${failed.length} failed.`);
    });
  }

  // The reveal, after the sky and before anything else — the game is over.
  if (p.gameEndedPost) {
    await step("gameEnded", () =>
      postGameEnded(prisma, p.gameEndedPost).catch((err) =>
        console.error("Game Ended post failed:", err),
      ),
    );
    // A phase change, so the spectator seat is re-checked like any other.
    await step("spectatorSweep", () =>
      syncSpectatorAccess(prisma).catch((err) =>
        console.error("Spectator sweep failed:", err),
      ),
    );
  }

  for (const post of list(p.publicPosts)) {
    await step(`publicPost:${post.stagedMessageId}`, async () => {
      const stagedMessage = {
        id: post.stagedMessageId,
        content: post.content,
        createdByDiscordUserId: null,
      };
      // Resolved LIVE, not carried in the payload. Where a declaration goes is
      // a list now — one #summary, or every Location channel in a cave level
      // (db/lib/publicPostTargets.js) — and a list of channel ids frozen at
      // turn-close and replayed by a resumed push hours later is the same stale
      // -payload problem the turn and the wipe switch are re-read for below.
      const { zone, targets } = await publicPostTargets(prisma, post.zoneId);
      const { sent, failed, skipped, attempted } = await deliverPublic(prisma, {
        stagedMessage,
        targets,
        zone,
        zoneId: post.zoneId,
        // The push is always the FIRST attempt at a declaration, so the Hall
        // row is always its to write. Only Resend has a reason to skip it.
        writeSceneLine: true,
      });
      // Derived from the rows, not from this run's own bounces — the same fix
      // and the same reason as the PRIVATE block above: a channel a Resend
      // running beside this one just got through to must not still be listed
      // as failing here.
      const rowFailures = await failuresFor(prisma, post.stagedMessageId).catch(() => failed);
      await prisma.stagedMessage
        .update({
          where: { id: post.stagedMessageId },
          data: {
            // A post that reached NO channel never went anywhere, so it is not
            // stamped sent — it stays in the tray as unsent work, the way it
            // did. One that reached some of them is stamped: it did reach
            // players, the bounces live on their own rows for Resend to retry,
            // and leaving it unstamped would get it re-selected by the next
            // push and re-posted to every channel that already has it.
            ...(sent ? { sentAt: new Date() } : {}),
            deliveryFailures: rowFailures.length ? rowFailures : Prisma.DbNull,
          },
        })
        .catch((err) =>
          console.error(`Failed to stamp public post ${post.stagedMessageId}:`, err),
        );
      if (failed.length || skipped) {
        console.error(
          `Public declaration ${post.stagedMessageId} reached ${sent} of ${attempted} channels:`,
          failed.map((f) => `${f.name ?? "the channel"}: ${f.error}`).join("; ") || "the rest were held",
        );
        deliveryFailures.push({
          stagedMessageId: post.stagedMessageId,
          attempted,
          delivered: sent,
          failed,
          // Claimed by a run happening right now. Neither a send nor a bounce,
          // and leaving it out makes the audit row's counts fail to add up —
          // which reads as lost mail. Same shape the PRIVATE block uses.
          ...(skipped ? { skipped } : {}),
        });
      }
    });
  }

  if (deliveryFailures.length) {
    await step("deliveryFailureLog", () =>
      prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "staged_push_delivery_failed",
            details: { failures: deliveryFailures },
          },
        })
        .catch((err) =>
          console.error("Failed to log staged_push_delivery_failed:", err),
        ),
    );
  }

  // The banner. The row is re-read rather than carried, so a resumed run in a
  // fresh process announces the turn that actually exists.
  const newTurn = p.newTurnId
    ? await prisma.turn.findUnique({ where: { id: p.newTurnId } }).catch(() => null)
    : null;
  if (newTurn) {
    await step("turnAnnouncement", () =>
      postTurnsAnnouncement(prisma, newTurn, p.note ?? null).catch((err) =>
        console.error("Failed to post turn announcement:", err),
      ),
    );
  }

  // The wipe runs on EVERY turn now. A turn is one real day, and Dawn/Dusk
  // alternate, so the old Dawn gate meant a Room scene ran for 48 hours.
  // Only the zone summaries keep that slower life — CHANNELS.md §8.
  // `messageWipeEnabled` is no longer a GM knob; the column stays as a
  // hand-flippable escape hatch if Discord starts rate-limiting. Read now
  // rather than carried in the payload, so a resume honours the switch as it
  // stands rather than as it stood when the turn closed.
  const config = await prisma.gameConfig
    .findFirst({ select: { messageWipeEnabled: true } })
    .catch(() => null);
  if (config?.messageWipeEnabled && newTurn) {
    const wipeSummaries = newTurn.phase === "DAWN";
    // The web's half of the same wipe, and it goes FIRST: the watermark is
    // the newest row as the pass begins, which is the same instant
    // `cutoffMs` names on the Discord side. Taking it afterwards would put
    // everything said during the wipe below the floor — deleted from
    // Discord's view and hidden from the Hall's, for no reason but that the
    // sweep was slow. See db/lib/feedWipe.js and HALL.md §7.
    const { markFeedWiped } = require("./feedWipe");
    await step("feedWatermark", () => markFeedWiped(prisma, { summaries: wipeSummaries }));
    await step("messageWipe", () =>
      runMessageWipe(prisma, {
        cutoffMs: sideEffectsStartedAt,
        wipeSummaries,
      }).catch((err) => console.error("Message wipe failed:", err)),
    );
  }

  // The channel doctor's cheap reconcile — roles and membership only, a
  // handful of requests. It used to sit behind autoReconcileEnabled, a
  // switch nobody ever turned on; keeping Discord in step with the database
  // after a turn moves people around is not a thing to opt into.
  const { runChannelDoctor } = require("./channelDoctor");
  await step("channelDoctor", () =>
    runChannelDoctor(prisma, { apply: true, scope: "cheap" }).catch((err) =>
      console.error("Post-turn channel doctor failed:", err),
    ),
  );

  // The Oracle is NOT here any more (docs/systemdocs/ORACLE.md). It used to be
  // this thunk's last step, on the argument that a synopsis arriving late costs
  // nothing. True, and beside the point: it is written FOR the gamemasters
  // adjudicating, and they do that in the three hours between the Move cutoff
  // and this push. A chronicle drafted here arrived after the rulings it was
  // meant to inform. It fires at the cutoff now — db/lib/oracleCutoff.js, off
  // the bot's minute cron — so nothing below should call it.

  // Only now is the turn's Discord half actually finished, which is what the
  // resume query selects on.
  await prisma.turn
    .update({
      where: { id: turnId },
      data: { sideEffectsDoneAt: new Date(), sideEffectClaimedAt: null },
    })
    .catch((err) => console.error("Failed to stamp sideEffectsDoneAt:", err));
}

module.exports = { runTurnSideEffects, buildSideEffectPayload };
