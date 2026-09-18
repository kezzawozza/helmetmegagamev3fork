// The staged-arbitration push, run inside resolveNeeds() against the CLOSING
// turn: applies every StagedEffect a GM queued, pays out each confirmed
// Move's own declared numbers, and silently
// closes any Move no GM touched (OPEN -> PASSED), with a canned DM for a
// Routine that closes with nothing written to its player. Sends nothing
// itself — deliveries are handed back for advanceTurn()'s side-effect thunk.
// A LABOR Move is already paid by the time this runs — it settles at confirm
// now (db/lib/moveConfirm.js) and arrives with `appliedEffects` stamped, which
// the §2 query filters out. What still pays here is a GM-adjudicated Gambit
// and any Routine the game filed on a player's behalf.
// Every mutation is claimed first (appliedAt / appliedEffects written from
// null) so the crash-resume path can never apply a row twice.
// Position in TURN_PASSES is load-bearing, see resolveNeeds().

const { Prisma } = require("@prisma/client");
const { addResources, applyMoveEffects, describeMoveEffects } = require("./moveEffects");
const { formatRangeExpression } = require("./resourceDelta");
const { settleGambitDice } = require("./gambitCutoff");
const { TagOpError, validateTagOps, applyTagOpsInTx } = require("./tagOps");
const { validateRoomTagOps, applyRoomTagOpsInTx } = require("./roomTagOps");
const { addRoomResources } = require("./roomStash");
const { applyTransfer, InsufficientResourcesError } = require("./resourceTransfer");
const { ensureDeliveries } = require("./stagedDelivery");
const { applyDeathToRow } = require("./characterDeath");
const { farmDm } = require("./soilery");

// The tail on a Routine nothing else spoke for. Left off when a GM staged a
// message or an effect on the Move — that IS the adjudication, and "no notes"
// would contradict the DM the player just read.
const NO_NOTES_TAIL =
  "*Your Routine passed without any special adjudication notes. Only Gambits " +
  "receive adjudications, typically. If you need additional information or " +
  "believe this was in error, message the GMs.*";

// The Routine close DM. Mirrors the auto-labor DM (db/lib/autoLaborPass.js) and is the
// only place the payout of a Routine the GAME filed is reported. A player's own Labor
// never reaches this: it pays at confirm and says so there. sendDm writes the » prefix,
// so don't write one here.
function formatRoutineCloseDm(turn, action, applied, adjudicated) {
  const effects = describeMoveEffects(applied);
  const kind = action.moveKind === "LABOR" ? "Labor" : "Routine";
  const lines = [
    `*Your ${kind} for turn ${turn.number}.*`,
    `» ${action.description}`,
    ...(effects ? [`**Applied:** ${effects}`] : []),
    // A refining shift pays no ⬢ and its range is a literal 0-0, so this
    // line would only ever read "+0 ⬢". A range that cannot pay is not
    // information (docs/systemdocs/FACTORY.md §4).
    ...(action.resourceRollValue != null && action.resourceRollExpression !== "0-0"
      ? [
          `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${action.resourceRollValue > 0 ? "+" : ""}${action.resourceRollValue} ⬢`,
        ]
      : []),
    ...(adjudicated ? [] : [NO_NOTES_TAIL]),
  ];
  return lines.join("\n");
}

// The Gambit reveal. The die is thrown at submit (db/lib/gambitDie.js) and the modifier
// settled at the lock (db/lib/gambitCutoff.js), but BOTH are withheld from the player
// until the turn closes — this DM is where they find out, and it is the only place. The
// desk sees the die all day; the player does not. Raw + modifier + total only, no
// per-contributor breakdown (that needs tags this pass doesn't load).
function formatGambitRollDm(turn, action) {
  const { diceRoll, diceModifier } = action;
  const mod = diceModifier ?? 0;
  const roll = mod
    ? `**${diceRoll}** (${mod > 0 ? `+${mod}` : mod}) → **${diceRoll + mod}**`
    : `**${diceRoll}**`;
  return `🎲 Your Gambit for turn ${turn.number}: ${roll}.`;
}

// Mirrors TagOpError for the zone half of a staged effect: thrown inside
// applyOneStagedEffect's transaction so the whole row rolls back clean, then
// caught by runStagedPushPass and stamped errored rather than silently dropped.
class StagedZoneError extends Error {}

// One transaction per row, never one around the batch: one bad row must not
// roll back a hundred good ones. Returns what the row actually moved, for the
// appliedEffect snapshot.
async function applyOneStagedEffect(prisma, row, turn) {
  return prisma.$transaction(async (tx) => {
    // The claim IS the double-apply guard: a resumed pass re-selects
    // appliedAt: null, so this updateMany comes back 0 for anything the
    // crashed run already committed.
    const claim = await tx.stagedEffect.updateMany({
      where: { id: row.id, appliedAt: null },
      data: { appliedAt: new Date() },
    });
    if (claim.count === 0) return null;

    const snapshot = {};

    // An instantaneous death, staged from the tray's dedicated Death
    // composer. Exclusive with every other character-targeted shape below:
    // a dead character has no further sheet to move ⬢ onto, gain tagPoints
    // on, retag, or relocate in this same row, so a death payload
    // short-circuits the rest of the row entirely rather than composing
    // with it. applyDeathToRow is safe on `tx` throughout, including a
    // Metempsychosis holder's reincarnation: db/lib/reincarnate.js detects
    // that it was handed a transaction client rather than the bare `prisma`
    // singleton and reuses it instead of opening a nested one, so the rebirth
    // lands atomically with the rest of this row.
    if (row.payload?.death === true) {
      const gib = row.payload?.gib === true;
      const reason =
        typeof row.payload?.reason === "string" && row.payload.reason.trim()
          ? row.payload.reason.trim()
          : "died.";
      const target = row.targetCharacter;
      const { claimed, corpse } = await applyDeathToRow(
        tx,
        { id: row.targetCharacterId, name: target?.name ?? "Someone", zoneId: target?.zoneId ?? null },
        { turn, content: `${target?.name ?? "Someone"} died — ${reason}`, gib },
      );
      snapshot.death = claimed ? { claimed: true, gib, reason, corpse } : { claimed: false, gib, reason };
      await tx.stagedEffect.update({ where: { id: row.id }, data: { appliedEffect: snapshot } });
      return snapshot;
    }

    const resources = Number.isInteger(row.payload?.resources) ? row.payload.resources : 0;
    if (resources) {
      snapshot.resources = await addResources(tx, row.targetCharacterId, resources);
    }

    // A party-to-party transfer, staged from the tray's composer. Mutually
    // exclusive with `resources`.
    // Applied blind from the snapshot taken at staging time: if the party was
    // deleted since, InsufficientResourcesError stands in and stamps the row
    // Errored rather than silently dropping the ⬢.
    const transfer = row.payload?.transfer ?? null;
    if (transfer) {
      await applyTransfer(tx, {
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        ledger: {
          actorDiscordUserId: row.createdByDiscordUserId,
          actorCharacterId: null,
          actorName: "GM (Adjudication)",
          turnNumber: turn.number,
          dayNumber: turn.dayNumber ?? null,
          note: `Staged transfer, turn ${turn.number}`,
        },
      }, {
        reason: "STAGED_PUSH",
        actionType: "staged_push_resolved",
        actorDiscordUserId: row.createdByDiscordUserId,
        turnId: turn.id,
        turnNumber: turn.number,
      });
      snapshot.transfer = transfer;
    }

    const tagPoints = Number.isInteger(row.payload?.tagPoints) ? row.payload.tagPoints : 0;
    if (tagPoints) {
      // Unclamped on purpose: tagPoints may legitimately go negative (see
      // web/lib/characterWrite.js). The snapshot is the delta itself.
      await tx.character.update({
        where: { id: row.targetCharacterId },
        data: { tagPoints: { increment: tagPoints } },
      });
      snapshot.tagPoints = tagPoints;
    }

    const ops = Array.isArray(row.payload?.tagOps) ? row.payload.tagOps : [];
    if (ops.length) {
      const tags = await tx.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
      const tagsById = new Map(tags.map((t) => [t.id, t]));
      const heldRows = await tx.characterTag.findMany({
        where: { characterId: row.targetCharacterId },
        select: { tagId: true },
      });
      // Validation runs before any tag write, so a TagOpError here rolls the
      // whole row back clean, including the claim.
      validateTagOps(ops, tagsById, new Set(heldRows.map((r) => r.tagId)));
      // The turn handed down is the NEXT one, not the closing one: these tags
      // land as that turn opens, so a 1-turn tag granted here survives this
      // rollover's own expiry sweep, same as one granted five minutes earlier.
      snapshot.tags = await applyTagOpsInTx(tx, {
        characterId: row.targetCharacterId,
        ops,
        tagsById,
        openTurn: { ...turn, number: turn.number + 1 },
      });
    }

    // Raw relocation — no Action row, no Move cost, no adjacency check (same
    // as the Dev Panel's location edit and Bulk Move; doesn't go through
    // performLocationMove). Re-verified here since the location may since
    // have been pruned by a zone sync. Writes zoneId alongside — the
    // denormalization contract on Character.
    const locationId = row.payload?.locationId ?? null;
    if (locationId) {
      const location = await tx.location.findUnique({ where: { id: locationId } });
      if (!location) {
        throw new StagedZoneError("That isn't a place a character can stand.");
      }
      const before = await tx.character.findUnique({
        where: { id: row.targetCharacterId },
        select: { locationId: true, zoneId: true },
      });
      await tx.character.update({
        where: { id: row.targetCharacterId },
        data: { locationId, zoneId: location.zoneId, escortedById: null },
      });
      snapshot.location = {
        from: before?.locationId ?? null,
        to: locationId,
        fromZoneId: before?.zoneId ?? null,
        toZoneId: location.zoneId,
      };
    }

    // A room's stash — tags left on a floor and the room's own ⬢
    // (docs/systemdocs/CARRY.md). A row carrying `room` has no target
    // character at all, and carries none of the character keys above, so it
    // falls straight through everything before this point. The name was
    // snapshotted at staging time, same as a transfer's parties, but the room
    // itself is re-read: a zone sync may have pruned it since.
    const room = row.payload?.room ?? null;
    if (room) {
      const live = await tx.room.findUnique({
        where: { id: room.id ?? "" },
        select: { id: true, destroysContents: true },
      });
      if (!live) throw new StagedZoneError("That room no longer exists.");

      // ⬢ before tags, so the order inside a row is fixed and obvious.
      // addRoomResources clamps a burn at 0 and returns what actually moved,
      // and swallows a mint into a destroysContents room on its own.
      // The economy context every money chokepoint now carries, the same
      // shape the staged transfer above passes. A GM adding ⬢ to a stash is a
      // faucet and taking it is a sink, so the reason is not one value.
      const econ = {
        actionType: "staged_push_resolved",
        actorDiscordUserId: row.createdByDiscordUserId,
        turnId: turn.id,
        turnNumber: turn.number,
      };

      const roomResources = Number.isInteger(row.payload?.roomResources) ? row.payload.roomResources : 0;
      if (roomResources) {
        snapshot.roomResources = await addRoomResources(tx, live.id, roomResources, {
          ...econ,
          reason: roomResources > 0 ? "GM_GRANT" : "GM_TAKE",
        });
      }

      const roomOps = Array.isArray(row.payload?.roomTagOps) ? row.payload.roomTagOps : [];
      if (roomOps.length) {
        const roomTags = await tx.tag.findMany({ where: { id: { in: roomOps.map((o) => o.tagId) } } });
        const roomTagsById = new Map(roomTags.map((t) => [t.id, t]));
        // Before any write, so a TagOpError rolls the row back whole.
        validateRoomTagOps(roomOps, roomTagsById);
        // The NEXT turn, for the same reason the character branch above says:
        // these land as that turn opens, so a 1-turn tag stashed here survives
        // this rollover's own sweep.
        snapshot.roomTags = await applyRoomTagOpsInTx(tx, {
          roomId: live.id,
          ops: roomOps,
          tagsById: roomTagsById,
          openTurn: { ...turn, number: turn.number + 1 },
          econ,
        });
      }
      snapshot.room = room;
    }

    await tx.stagedEffect.update({ where: { id: row.id }, data: { appliedEffect: snapshot } });
    return snapshot;
  });
}

async function runStagedPushPass(prisma, turn) {
  const failures = [];

  // ── 0. any Gambit that never got its modifier ────────────────────────────
  // The die itself lands at submit now (db/lib/gambitDie.js); what the cutoff still settles is the
  // Hunger/mood modifier (db/lib/gambitCutoff.js). But that is a per-minute poll in the BOT process
  // against a window a frozen clock or a short turn never opens. This is the backstop — it throws a
  // die too for anything that reached here without one — and it is a no-op on an ordinary turn where
  // the cutoff already fired.
  try {
    await settleGambitDice(prisma, turn.id);
  } catch (err) {
    console.error("Backstop Gambit settle failed:", err);
    failures.push({ kind: "gambitRoll", id: turn.id, error: String(err?.message ?? err) });
  }

  // ── 1. GM-staged effects ─────────────────────────────────────────────────
  let effectsApplied = 0;
  // ALIVE + a real discordUserId only, deduped to each character's FINAL
  // zone so a batch doesn't churn roles on the way through — rows process in
  // createdAt order and each overwrite wins.
  const zoneMovesByCharacter = new Map();
  // Every staged death that actually claimed, in the exact shape
  // catatonicDeathPass.js/dyingDeathPass.js already establish — folded into
  // turnDeaths by db/index.js/turnSideEffects.js so a staged kill gets the
  // same Discord teardown, death DM and #leave rollup any other death does.
  const deaths = [];
  const stagedEffects = await prisma.stagedEffect.findMany({
    where: { turnId: turn.id, appliedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      targetCharacter: {
        select: { status: true, discordUserId: true, name: true, discordRoleId: true, zoneId: true },
      },
    },
  });
  for (const row of stagedEffects) {
    try {
      const snapshot = await applyOneStagedEffect(prisma, row, turn);
      if (snapshot) {
        effectsApplied += 1;
        if (snapshot.location) {
          const target = row.targetCharacter;
          if (target?.status === "ALIVE" && target.discordUserId) {
            const existing = zoneMovesByCharacter.get(row.targetCharacterId);
            zoneMovesByCharacter.set(row.targetCharacterId, {
              characterId: row.targetCharacterId,
              discordUserId: target.discordUserId,
              // The FIRST applied move's "from" is the true prior location; a
              // later move in the same batch overwrites only "to".
              fromLocationId: existing ? existing.fromLocationId : snapshot.location.from,
              toLocationId: snapshot.location.to,
            });
          }
        }
        if (snapshot.death?.claimed) {
          // discordRoleId is read off the pre-death snapshot taken above —
          // applyDeathToRow already nulled the live column by the time we
          // get here, same reason catatonicDeathPass.js captures it first.
          const target = row.targetCharacter;
          deaths.push({
            characterId: row.targetCharacterId,
            name: target?.name ?? "Someone",
            discordUserId: target?.discordUserId ?? null,
            discordRoleId: target?.discordRoleId ?? null,
            zoneId: target?.zoneId ?? null,
            reason: snapshot.death.reason,
          });
        }
      }
    } catch (err) {
      if (err instanceof TagOpError || err instanceof StagedZoneError || err instanceof InsufficientResourcesError) {
        // A GM staged something that no longer validates (tag vanished from
        // the catalog, equip conflict, zone deleted, transfer underfunded...).
        // Stamp it errored so the tray shows a verdict, not a pending row.
        await prisma.stagedEffect
          .update({
            where: { id: row.id },
            data: { appliedAt: new Date(), appliedEffect: { error: err.message } },
          })
          .catch((markErr) => console.error(`Failed to mark staged effect ${row.id} errored:`, markErr));
        failures.push({ kind: "effect", id: row.id, characterId: row.targetCharacterId, error: err.message });
      } else {
        // Anything else (a DB hiccup) leaves the row unapplied — visible in
        // the tray's missed-push banner, retargetable to the next turn.
        console.error(`Staged effect ${row.id} failed to apply:`, err);
        failures.push({ kind: "effect", id: row.id, characterId: row.targetCharacterId, error: String(err?.message ?? err) });
      }
    }
  }
  const zoneMoves = [...zoneMovesByCharacter.values()];

  // ── 2. every confirmed Move's own declared numbers ───────────────────────
  // status CONFIRMED filters out abandoned modal drafts (PENDING_*); the
  // DbNull filter makes this a no-op for anything already paid.
  let movesApplied = 0;
  let movesClosed = 0;
  // The two includes exist only for the Routine notice below: who to DM, and
  // whether a GM already wrote this player about this Move.
  const unapplied = await prisma.action.findMany({
    where: { turnId: turn.id, status: "CONFIRMED", appliedEffects: { equals: Prisma.DbNull } },
    orderBy: { createdAt: "asc" },
    include: {
      character: { select: { discordUserId: true } },
      stagedMessages: {
        where: { kind: "PRIVATE" },
        select: { recipients: { select: { characterId: true } } },
      },
      stagedEffects: { select: { targetCharacterId: true } },
    },
  });
  const routineNotices = [];
  // Independent of the routine-closing logic below: the die was already
  // decided at submit, this pass just delivers the news. Every CONFIRMED
  // Gambit still unpaid this turn qualifies.
  // A lesson's Gambit is excluded: it is settled the moment the lesson is
  // accepted (db/lib/lessons.js), which already told the learner the die AND
  // what it did, in one line. A settled lesson carries appliedEffects and never
  // reaches `unapplied` anyway — the marker check still earns its place for a
  // lesson accepted BEFORE that change shipped, which is OPEN with no effects.
  // A research Gambit is excluded for the same reason: db/lib/researchPass.js
  // already told the researcher the die and what it turned up.
  const gambitRollNotices = [];
  for (const action of unapplied) {
    if ((action.gmNotes ?? "").includes("auto:lesson")) continue;
    if ((action.gmNotes ?? "").includes("auto:research")) continue;
    if (action.moveKind === "GAMBIT" && action.diceRoll != null && action.character?.discordUserId) {
      gambitRollNotices.push({
        discordUserId: action.character.discordUserId,
        content: formatGambitRollDm(turn, action),
      });
    }
  }
  for (const action of unapplied) {
    // Decided inside the transaction, queued outside it: a commit that fails
    // after the eligibility check must not leave a "your Routine passed" DM
    // pointing at a payout that rolled back.
    let notice = null;
    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.action.updateMany({
          where: { id: action.id, appliedEffects: { equals: Prisma.DbNull } },
          data: { appliedEffects: {} },
        });
        if (claim.count === 0) return;
        const applied = await applyMoveEffects(tx, action);
        const silentClose = action.moveReviewStatus === "OPEN";
        await tx.action.update({
          where: { id: action.id },
          data: {
            appliedEffects: applied,
            ...(silentClose
              ? {
                  moveReviewStatus: "PASSED",
                  gmNotes: [action.gmNotes, "auto:silent_close"].filter(Boolean).join("\n"),
                }
              : {}),
          },
        });
        movesApplied += 1;
        if (silentClose) movesClosed += 1;

        // A private staged message IS the adjudication note, but only when it
        // went to this player.
        const alreadyTold = action.stagedMessages.some((message) =>
          message.recipients.some((r) => r.characterId === action.characterId),
        );
        // A staged effect against the Move's own character counts too —
        // their sheet is changing in this same push.
        const alreadyAdjudicated = action.stagedEffects.some(
          (e) => e.targetCharacterId === action.characterId,
        );
        // Neither suppresses the DM, only its "no notes" tail. The remaining
        // skip is the "auto:" family (auto-labor / travel stub each send
        // their own DM) — reads pre-update gmNotes so the auto:silent_close
        // appended above can't mute the notice it's meant to accompany.
        //
        // LABOR closes the same way a Routine does: it is never arbitrated,
        // but the player still needs to be told what their day paid.
        if (
          (action.moveKind === "ROUTINE" || action.moveKind === "LABOR") &&
          !(action.gmNotes ?? "").includes("auto:") &&
          action.character?.discordUserId
        ) {
          notice = {
            discordUserId: action.character.discordUserId,
            content: formatRoutineCloseDm(turn, action, applied, alreadyTold || alreadyAdjudicated),
          };
        } else if (action.farmPlan && applied.farmed && action.character?.discordUserId) {
          // Farming files as "auto:farm" (web/lib/moves.js), which the generic "auto:" skip above
          // would otherwise swallow the way it does auto-labor/travel — but the wither die IS the
          // whole point of the Farm button, so it gets its own narrow carve-out rather than
          // loosening that skip for every other auto: Routine.
          notice = {
            discordUserId: action.character.discordUserId,
            content: farmDm(turn.number, applied.farmed.rows),
          };
        }
      });
      if (notice) routineNotices.push(notice);
    } catch (err) {
      console.error(`Move payout for action ${action.id} failed:`, err);
      failures.push({ kind: "move", id: action.id, characterId: action.characterId, error: String(err?.message ?? err) });
    }
  }

  // ── 3. compose deliveries for the thunk ──────────────────────────────────
  // Read-only here: sentAt is stamped by the thunk after Discord answers, so
  // a crash between this pass and the sends leaves the rows visibly unsent
  // (the tray's missed-push banner) instead of falsely delivered.
  const unsent = await prisma.stagedMessage.findMany({
    where: { turnId: turn.id, sentAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      recipients: {
        include: {
          character: { select: { id: true, name: true, discordUserId: true } },
        },
      },
      // The channel is NOT read here. Where a public declaration goes is
      // resolved live at delivery time (db/lib/publicPostTargets.js), because
      // for a cave level it is a LIST of Location channels and a list frozen
      // into the payload goes stale. The name is for the tray.
      zone: { select: { name: true } },
    },
  });

  const privateDeliveries = [];
  const publicPosts = [];
  // The Delivery rows are written HERE, at selection, not at send time. That
  // is what makes the sends resumable in the first place: a push that dies
  // after the first DM finds the other rows already sitting there PENDING,
  // and the one it managed SENT. See db/lib/stagedDelivery.js.
  const toEnsure = [];
  for (const message of unsent) {
    if (message.kind === "PUBLIC") {
      publicPosts.push({
        stagedMessageId: message.id,
        content: message.content,
        zoneName: message.zone?.name ?? null,
        // Every PUBLIC row carries a real (non-CAVE_GROUP) zone. The zone is
        // all the thunk needs: it resolves the channels itself.
        zoneId: message.zoneId ?? null,
      });
      continue;
    }
    const recipients = message.recipients.map((r) => ({
      characterId: r.character.id,
      name: r.character.name,
      discordUserId: r.character.discordUserId,
    }));
    if (!recipients.length) {
      // Every recipient cascaded away (deleted characters). Left unsent on
      // purpose — the tray shows "no recipients" and the GM decides.
      failures.push({ kind: "message", id: message.id, error: "no recipients" });
      continue;
    }
    privateDeliveries.push({
      stagedMessageId: message.id,
      content: message.content,
      recipients,
      createdByDiscordUserId: message.createdByDiscordUserId,
    });
    toEnsure.push({ stagedMessage: message, recipients });
  }

  // A PUBLIC row is NOT pre-written here. deliverPublic calls ensureDeliveries
  // itself and is the only thing that ever touches that row, so writing it
  // twice bought nothing — and the pre-write is only worth its query for the
  // PRIVATE fan-out, where it is what makes a half-finished push resumable.
  for (const each of toEnsure) {
    // Best-effort: a push whose delivery rows could not be written still
    // delivers (deliverPrivate calls ensureDeliveries itself and is idempotent
    // on the unique key) — this only moves the write earlier, off the clock a
    // player is waiting on.
    await ensureDeliveries(prisma, each).catch((err) =>
      console.error(`Failed to prepare deliveries for ${each.stagedMessage.id}:`, err),
    );
  }

  return {
    effectsApplied,
    effectsStaged: stagedEffects.length,
    movesApplied,
    movesClosed,
    failures,
    routineNotices,
    gambitRollNotices,
    privateDeliveries,
    publicPosts,
    zoneMoves,
    deaths,
  };
}

module.exports = { runStagedPushPass };
