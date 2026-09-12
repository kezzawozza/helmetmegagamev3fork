"use server";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { isUnaffiliated, UNAFFILIATED_SLUG } from "@lifeweb/db/lib/factionConstants";
import { GHOST_ROLE_ID } from "@lifeweb/db/lib/roleIds";
import { after } from "next/server";
import { parseConfigForm } from "@lifeweb/db/lib/gameConfigFields";
import { getGameConfig, getGameState, GAME_STATE_CREATE } from "@lifeweb/db/lib/gameState";
import { getOpenTurn } from "@/lib/turn";
import { buildEpilogue } from "@lifeweb/db/lib/epilogue";
import { forgetGameId } from "@lifeweb/db/lib/archive";
import { forgetGameFloor } from "@lifeweb/db/lib/feedWipe";
import { exportGame, verifyPacket } from "@lifeweb/db/lib/archiveExport";
import { bucketConfigured, putObject, finalKey } from "@lifeweb/db/lib/archiveBucket";
import {
  prisma,
  advanceTurn as advanceTurnInDb,
  runFullChannelWipe,
  syncZonesFromYaml,
  syncSpecialChannels,
  syncTagsFromYaml,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
  syncLaborDropsFromYaml,
} from "@lifeweb/db";
import { runChannelDoctor } from "@lifeweb/db/lib/channelDoctor";
import { postTurnsAnnouncement } from "@lifeweb/db/lib/turnAnnouncement";
import { pickTurnBanner, nextTurnBanner } from "@lifeweb/db/lib/turnBanner";
import { requireDev } from "@/lib/devAccess";
import {
  deleteCharacterRole,
  revokeAccessForCharacters,
  updateGuildNickname,
  listGuildMembers,
  removeGhostRole,
  setTurnPingRole,
  sendDm,
} from "@/lib/discordGuild";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { rollCavingOnArrival } from "@lifeweb/db/lib/cavingPass";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { visibleZoneIds } from "@lifeweb/db/lib/gmZoneView";
import { inactiveCharacters } from "@lifeweb/db/lib/inactivity";
import { grantTagSlugs, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { getFactionAncestorIds } from "@/lib/factionPermissions";
import { mintLetterFor, sealWithMark } from "@lifeweb/db/lib/paperMint";
import {
  canReadLetters,
  deliveryDm,
  replyButtonRow,
  GM_LETTER_SOURCE,
} from "@lifeweb/db/lib/bird";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { afterInventoryChange } from "@/lib/afterInventoryChange";

// The same ceiling the Write dialog puts on a player's sheet — a GM letter is
// a sheet of paper like any other, and a longer one would not fit the object.
const GM_LETTER_MAX = 2000;


function str(formData, key) {
  const v = formData.get(key);
  return v == null ? "" : v.toString();
}

function intOrNull(formData, key) {
  const v = str(formData, key).trim();
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function intOrZero(formData, key) {
  return intOrNull(formData, key) ?? 0;
}

// Every knob on GameConfig, parsed and clamped by the registry
// (db/lib/gameConfigFields.js) — the same list the form was rendered from, so
// a hand-posted field the registry does not name is simply never read.
export async function updateGameConfig(formData) {
  await requireDev();

  const current = await getGameConfig(prisma);
  await prisma.gameConfig.update({
    where: { id: 1 },
    data: parseConfigForm(formData, current),
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
  revalidatePath("/character");
  revalidatePath("/store");
  revalidatePath("/chat");
}

// The Depot's live state and its tuning, in one flat clamped allowlist —
// the same shape updateGameConfig uses, and for the same reason: a loop over
// formData keys would let a hand-posted field write a column nobody meant to
// expose.
export async function updateDepot(formData) {
  await requireDev();

  const fuelMax = Math.max(1, intOrZero(formData, "fuelMax"));

  await prisma.depot.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      // Live state.
      accountObols: Math.max(0, intOrZero(formData, "accountObols")),
      debtObols: Math.max(0, intOrZero(formData, "debtObols")),
      // Clamped to the tank the GM is saving in the same submit, not the one
      // that was there before — otherwise raising both at once silently loses
      // the fuel.
      generatorFuel: Math.max(0, Math.min(fuelMax, intOrZero(formData, "generatorFuel"))),
      generatorOn: formData.get("generatorOn") === "on",
      turretArmed: formData.get("turretArmed") === "on",

      // Tuning.
      fuelMax,
      fuelBurnPerTurn: Math.max(0, intOrZero(formData, "fuelBurnPerTurn")),
      coalFuel: Math.max(0, intOrZero(formData, "coalFuel")),
      saltpeterFuel: Math.max(0, intOrZero(formData, "saltpeterFuel")),
      shuttleMaxTurns: Math.max(1, intOrZero(formData, "shuttleMaxTurns")),
      shuttleCooldown: Math.max(0, intOrZero(formData, "shuttleCooldown")),
      creditCapObols: Math.max(0, intOrZero(formData, "creditCapObols")),
      // Never zero: the ⬢-to-obol conversion divides by it.
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/depot");
}

// A raw superadmin correction to the current turn's day/phase, not a
// normal turn advance.
export async function updateCurrentTurn(formData) {
  await requireDev();

  const day = intOrNull(formData, "day");
  const phase = str(formData, "phase") || "DAWN";
  if (day == null || day < 1) return;

  const number = (day - 1) * 2 + (phase === "DAWN" ? 1 : 2);

  const openTurnRecord = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (openTurnRecord) {
    // A phase flip has to re-pick the banner, or a dusk turn keeps riding a
    // dawn plate. Saving the form unchanged leaves the picture alone, so this
    // doubles as the GM re-roll: switch the phase and switch it back.
    const banner =
      openTurnRecord.phase === phase && openTurnRecord.banner
        ? openTurnRecord.banner
        : await nextTurnBanner(prisma, phase);
    await prisma.turn.update({ where: { id: openTurnRecord.id }, data: { number, phase, banner } });
  } else {
    await prisma.turn.create({
      data: { number, phase, banner: await nextTurnBanner(prisma, phase), status: "OPEN", gameDate: new Date() },
    });
  }

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

// A pending note for the *next* turn, consumed by advanceTurn().
export async function updateNextTurn(formData) {
  await requireDev();

  const note = str(formData, "note").trim() || null;

  await prisma.gameState.upsert({
    where: { id: 1 },
    create: { ...GAME_STATE_CREATE, nextTurnNote: note },
    update: { nextTurnNote: note },
  });

  revalidatePath("/gm/dev");
}

// The Lifeweb's blood, as a raw override. Per-game state, so it lives beside
// the phase on the Game section rather than among the durable knobs.
export async function updateWorldState(formData) {
  await requireDev();

  await prisma.gameState.upsert({
    where: { id: 1 },
    create: GAME_STATE_CREATE,
    update: { lifewebBlood: Math.max(0, Math.min(100, intOrZero(formData, "lifewebBlood"))) },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
}

// advanceTurnInDb() hands back its Discord side effects as a thunk. That
// thunk goes to after(), not the request, since the message wipe can take
// minutes and a pending server action blocks client-side navigation.
export async function forceAdvanceTurn() {
  const session = await requireDev();

  try {
    const { advanced, refused, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

    if (refused === "NOT_RUNNING") {
      return { ok: false, error: "The game isn't running, so there is no turn to end. Start it from the Game section first." };
    }

    // Lost the race to the bot's cron or a second click; turn already advanced.
    if (!advanced) {
      revalidatePath("/gm/dev");
      revalidatePath("/", "layout");
      return { ok: true };
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_turn_forced",
        details: { previousTurnId: previousTurn?.id ?? null, newTurnId: newTurn.id, number: newTurn.number, phase: newTurn.phase },
      },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      runSideEffects().catch((err) => console.error("Turn side effects failed:", err)),
    );

    return { ok: true };
  } catch (err) {
    // No error.js boundary here; report in place rather than let Next's
    // generic error page hide whether the turn advanced.
    console.error("Force advance turn failed:", err);
    return { ok: false, error: "Could not end the turn. Check the server logs." };
  }
}

// Full game restart for dev/testing: wipes every player- and turn-scoped
// row, recreates GameState (phase CLOSED), clears every Discord channel,
// opens Turn 1/DAWN, reposts #turns, then re-syncs every YAML master in
// dependency order. Requires typing "WIPE" — no undo.
//
// GameConfig and PlayerPreference are deliberately NOT touched: the knobs a
// GM tuned and the priorities a player set are meant to outlive the game
// (docs/systemdocs/LOBBY.md §6).
// Write the current game's transcript out to the bucket as one packet, and
// stamp the Game row to say so. See docs/systemdocs/ARCHIVE.md.
//
// This is deliberately NOT part of Restart Game. It is minutes of read-only
// work and network I/O, and the wipe's own button promises it "returns in a
// second or two" and tells a GM "Nothing was changed" when it cannot reach the
// server — a promise a long upload in front of it would turn into a lie the
// first time a request timed out. Splitting them also means this can be run
// early, run twice, and run while the game is still going: it deletes nothing.
//
// Restart Game then only ever CHECKS the stamp this leaves.
export async function archiveCurrentGame() {
  const session = await requireDev();

  try {
    if (!bucketConfigured()) {
      return {
        ok: false,
        error: "This deployment has no bucket credentials, so it cannot upload a packet. Run `npm run archive:export -- --final` from a machine that has them.",
      };
    }

    const state = await prisma.gameState.findUnique({ where: { id: 1 }, include: { game: true } });
    const game = state?.game;
    if (!game) return { ok: false, error: "There is no current game to archive." };

    const tmp = path.join(os.tmpdir(), `bascinet-archive-${game.id}.jsonl.gz`);
    let manifest;
    try {
      manifest = await exportGame(prisma, { gameId: game.id, outPath: tmp });
      // Read back what was actually written before anything is told it exists.
      // A truncated packet is the same shape and roughly the same size as a
      // good one, and this file is about to become the only copy.
      await verifyPacket(tmp);
      const key = finalKey(game.id);
      await putObject(key, await fs.promises.readFile(tmp));
      await prisma.game.update({
        where: { id: game.id },
        data: {
          exportKey: key,
          entryCount: manifest.entryCount,
          exportMaxSeq: manifest.maxSeq === null ? null : BigInt(manifest.maxSeq),
        },
      });
    } finally {
      await fs.promises.unlink(tmp).catch(() => {});
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_game_archived",
        details: { gameId: game.id, entryCount: manifest.entryCount },
      },
    });

    revalidatePath("/gm/dev");
    return { ok: true, entryCount: manifest.entryCount };
  } catch (err) {
    console.error("Archive export failed:", err);
    return { ok: false, error: err.message ?? "Could not write the packet. Check the server logs." };
  }
}

export async function wipeGameData(formData) {
  const session = await requireDev();

  if (str(formData, "confirm").trim() !== "WIPE") {
    return { ok: false, error: 'Type "WIPE" (all caps) to confirm.' };
  }

  // Keep this game's transcript, or throw it away with the rest? Either way
  // the rows LEAVE the database — the difference is whether a packet is
  // standing behind them (docs/systemdocs/ARCHIVE.md).
  //
  // Discard is the default because the ordinary use of this button is ending a
  // playtest, and thirteen throwaway games accumulating in the /archive picker
  // before launch is what prompted the whole change.
  const keepArchive = str(formData, "archive") === "keep";

  try {
    // Snapshotted before the deletes — the only handle left on what to
    // clean up once the DB rows are gone.
    const [characters, members, state] = await Promise.all([
      prisma.character.findMany({
        select: { discordUserId: true, discordRoleId: true, turnPingOptIn: true },
      }),
      listGuildMembers(),
      prisma.gameState.findUnique({ where: { id: 1 }, include: { game: true } }),
    ]);

    // The game that is ending keeps its record (docs/systemdocs/LOBBY.md §7):
    // a reveal if it never got one, an end stamp, and its number. The next
    // game is a fresh row the new GameState points at.
    const oldGame = state?.game ?? null;

    // The one check that has to happen before ANYTHING commits. Everything
    // from here to the transaction writes as it goes, so a refusal further in
    // leaves a stamped epilogue and an orphan next-Game row behind.
    if (keepArchive && oldGame && !oldGame.exportKey) {
      return {
        ok: false,
        error: "This game has no archive packet yet. Press Archive this game first — nothing has been changed.",
      };
    }

    if (oldGame && !oldGame.epilogue) {
      const epilogue = await buildEpilogue(prisma, { game: oldGame, state: { ...state, endedAt: new Date() } }).catch((err) => {
        console.error("Epilogue snapshot failed:", err);
        return null;
      });
      await prisma.game.update({
        where: { id: oldGame.id },
        data: { endedAt: oldGame.endedAt ?? new Date(), startedAt: oldGame.startedAt ?? state.startedAt, playerCount: oldGame.playerCount ?? state.playerCount, ...(epilogue ? { epilogue } : {}) },
      });
    }
    const nextGame = await prisma.game.create({ data: {} });
    // Whoever is still wearing the ghost seat, so the wipe can take it off
    // them. Read off the guild rather than the database on purpose: the rows
    // that would answer it are about to be deleted, and a leftover ghost role
    // would hand an ex-player read-only vision of every zone in the NEW game.
    const ghostMemberIds = members.filter((m) => m.roles.includes(GHOST_ROLE_ID)).map((m) => m.id);

    // Ordered so dependents (Request, Desire, StagedMessage/Effect — required
    // FKs to Character/Turn) go before character/turn.deleteMany, or a
    // Postgres FK violation rolls back the whole transaction.
    await prisma.$transaction([
      prisma.note.deleteMany({}),
      prisma.action.deleteMany({}),
      prisma.desire.deleteMany({}),
      prisma.birdMessage.deleteMany({}),
      prisma.characterTag.deleteMany({}),
      // Structures: same reasoning as RoomTag below — Structure cascades from
      // Location, which the wipe never deletes, so it goes explicitly.
      // StructureWork first, since it has a required FK to Structure.
      prisma.structureWork.deleteMany({}),
      prisma.structure.deleteMany({}),
      // Link state back to its born values: a gate somebody shut, a keyed
      // door somebody propped — all play state.
      // Raw SQL because column-to-column isn't expressible in updateMany.
      // No anchor reposts needed: finishGameWipe re-syncs zones afterwards
      // and anchors hash their own gate state, so they self-heal there.
      prisma.$executeRaw`UPDATE "LocationLink" SET "isOpen" = "authoredOpen", "openUntil" = NULL`,
      // Anything pinned to a noticeboard (PAPERWORK.md). Before the tag sweep
      // below, or the FK from NoticePost.tagId blocks it.
      prisma.noticePost.deleteMany({}),
      // Room stashes (CARRY.md): the rows cascade from nothing the wipe
      // deletes, so they go explicitly and the ⬢ column is zeroed.
      prisma.roomTag.deleteMany({}),
      // Runtime-minted tags: crates, headstones, written paper, sealed
      // letters. GAME state that happened to be stored in the catalog, and it
      // has to go with the game.
      //
      // This closes a real leak rather than merely serving the new feature.
      // The wipe never touched the Tag table, and db:prune-tags skips every
      // `custom` row on purpose — so a crate or a headstone was a permanent
      // orphan accumulating across every game ever run. Only corpses escaped,
      // through corpseOfCharacterId's cascade, and they still do.
      //
      // `ephemeral` and not `custom`, deliberately: a GM's homebrew from
      // /gm/dev/tags is custom too and must SURVIVE a restart. Runs after the
      // holdings above so nothing references these rows.
      prisma.tag.deleteMany({ where: { ephemeral: true } }),
      prisma.room.updateMany({ data: { resources: 0 } }),
      // Factions are live game state now (FACTIONS.md), so a restart has to
      // undo the parts players wrote. Handshakes go with the characters they
      // named; every silo is un-pointed so db:sync-roles' null-fill floor can
      // seed the authored ones again; and a faction somebody FOUNDED in the
      // last game is deleted outright rather than lingering as a leaderless
      // ghost. Founded factions carry no Role rows, so nothing cascades into
      // the creation wizard.
      prisma.factionApplication.deleteMany({}),
      prisma.faction.updateMany({ data: { siloRoomId: null } }),
      prisma.auditLog.deleteMany({}),
      // Antagonist objectives are per-game state. The epilogue snapshot above
      // ran before this transaction opened, so it has already read them.
      prisma.objective.deleteMany({}),
      // Rites in progress die with the game; the chants cascade off them.
      prisma.riteAttempt.deleteMany({}),
      // The handshakes (LESSONS.md): Learn/Teach, Bind, Confession, Escort.
      // Explicit, and it has to be — Offer names its two sides by plain id
      // rather than by relation, so nothing cascades into it when the
      // characters go, while Offer.turnId IS a required FK and defaults to
      // Restrict. Miss it and turn.deleteMany below dies on the constraint,
      // taking the whole transaction with it: the wipe reports failure and
      // wipes nothing at all.
      prisma.offer.deleteMany({}),
      prisma.character.deleteMany({}),
      prisma.playerThread.deleteMany({}),
      prisma.playerThreadInvite.deleteMany({}),
      prisma.stagedMessage.deleteMany({}),
      prisma.stagedEffect.deleteMany({}),
      prisma.turn.deleteMany({}),
      prisma.directMessage.deleteMany({}),
      // The transcript is not touched HERE. It leaves after this transaction
      // commits, in batches — see the delete below for why it cannot be in
      // this array.
      // The lobby is per game; the preferences behind it are not.
      prisma.lobbyEntry.deleteMany({}),
      // Delete and recreate rather than reset a list of columns: a fresh row
      // cannot carry anything over, which the old allowlist provably could.
      prisma.gameState.deleteMany({}),
      prisma.gameState.create({ data: { id: 1, gameId: nextGame.id } }),
      // The Depot is the same kind of row and was missed entirely, so it kept
      // everything: an ARMED turret, the Merchant's account, a docked shuttle
      // and a merchantFace naming a character the wipe had just deleted. The
      // gun then shot the people in the caves the next game, with nobody in
      // that game having armed it. Same delete-and-recreate for the same
      // reason — loadDepot upserts id 1, so a read before this lands is fine.
      prisma.depot.deleteMany({}),
      prisma.depot.create({ data: { id: 1 } }),
    ]);
    forgetGameId();
    // Chat reads past a finished game by seq (db/lib/feedWipe.js); drop
    // the memo so it empties now rather than in half a minute.
    forgetGameFloor();

    // The transcript leaves the database (docs/systemdocs/ARCHIVE.md). Three
    // things about the shape of this, all learned the hard way:
    //
    // NOT in the transaction above. A month-long game is tens of thousands of
    // rows, and deleting them means index maintenance across nine indexes plus
    // the trigram GIN on `content`, inside a transaction already holding write
    // locks on some twenty-five tables. It is the likeliest statement there to
    // hit a timeout, and if it did the whole wipe would roll back — including
    // the gameState.create above — while the epilogue stamp and the next Game
    // row, written before it, stayed committed.
    //
    // BOUNDED BY exportMaxSeq when a packet is standing behind it. The bot
    // keeps writing between the moment the packet was made and now, and those
    // rows are not in the file. Without the bound they would be destroyed
    // having never been anywhere else. Discarding has no such bound, because
    // nothing is being preserved.
    //
    // BATCHED, so a timeout mid-way leaves a smaller job rather than no
    // progress, and re-running the wipe finishes it.
    let archivedRows = 0;
    if (oldGame) {
      const bound = keepArchive && oldGame.exportMaxSeq != null
        ? { seq: { lte: oldGame.exportMaxSeq } }
        : {};
      for (;;) {
        const doomed = await prisma.archiveEntry.findMany({
          where: { gameId: oldGame.id, ...bound },
          select: { id: true },
          take: 5000,
        });
        if (doomed.length === 0) break;
        const { count } = await prisma.archiveEntry.deleteMany({
          where: { id: { in: doomed.map((r) => r.id) } },
        });
        archivedRows += count;
        if (count === 0) break;
      }
      await prisma.game.update({
        where: { id: oldGame.id },
        data: { archivedAt: new Date() },
      });
      // Discarding takes the Game row too, which is why the schema says "one
      // row per game KEPT". It has to happen after the transaction above:
      // GameState.gameId is a required FK, so the old row is only unreferenced
      // once gameState.deleteMany + create have committed.
      if (!keepArchive) {
        await prisma.game.delete({ where: { id: oldGame.id } }).catch((err) => {
          console.error("Could not discard the old Game row:", err);
        });
      }
    }

    // After the character sweep above, so the FK from Character.factionId is
    // already gone and the delete cannot be blocked by a member.
    await prisma.faction.deleteMany({ where: { foundedById: { not: null } } });

    const firstTurn = await prisma.turn.create({
      data: { number: 1, phase: "DAWN", banner: pickTurnBanner("DAWN"), status: "OPEN", gameDate: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_game_wipe",
        details: {
          characters: characters.length,
          ghostMembers: ghostMemberIds.length,
          archived: keepArchive,
          transcriptRows: archivedRows,
          exportKey: keepArchive ? oldGame?.exportKey ?? null : null,
        },
      },
    });

    // Created before the background work starts, so a dead container leaves
    // an unfinished report (finishedAt null) rather than a false success.
    const reportRow = await prisma.systemReport.create({
      data: { kind: "WIPE", actorDiscordUserId: session.discordUserId },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      finishGameWipe(session.discordUserId, characters, ghostMemberIds, firstTurn, reportRow.id).catch(
        (err) => console.error("Game wipe side effects failed:", err),
      ),
    );

    return { ok: true, reportId: reportRow.id };
  } catch (err) {
    // No error.js boundary here; report in place rather than let Next's
    // generic error page hide whether the wipe happened.
    console.error("Game wipe failed:", err);
    return { ok: false, error: "Could not wipe the game. Check the server logs." };
  }
}

// Everything the wipe does outside the database, handed to after() rather
// than awaited. A step runner: every step is retried once, every failure is
// collected, and the run lands on the SystemReport row wipeGameData
// created, so the Dev Panel never claims success it can't know about.
async function finishGameWipe(actorDiscordUserId, characters, ghostMemberIds, firstTurn, reportId) {
  const steps = [];
  const failures = [];
  async function step(name, fn, { retries = 1 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const detail = await fn();
        steps.push({ name, ok: true, ...(detail !== undefined && detail !== null ? { detail } : {}) });
        return detail;
      } catch (err) {
        if (attempt === retries) {
          steps.push({ name, ok: false, message: err.message });
          failures.push({ step: name, message: err.message });
          console.error(`Game wipe step "${name}" failed:`, err);
          return null;
        }
      }
    }
    return null;
  }

  // First, while nothing has re-provisioned: strip every zone role and
  // stray member overwrite.
  await step("access sweep", () => revokeAccessForCharacters(characters));

  // Sequential, not Promise.all — 240+ simultaneous requests against two
  // per-guild rate-limit buckets is its own incident.
  for (const c of characters) {
    if (c.discordRoleId) {
      await step(`character role ${c.discordRoleId}`, () => deleteCharacterRole(c.discordRoleId));
    }
    await step(`nickname ${c.discordUserId}`, () => updateGuildNickname(c.discordUserId, null), {
      retries: 0,
    });
    if (c.turnPingOptIn) {
      await step(`turn-ping ${c.discordUserId}`, () => setTurnPingRole(c.discordUserId, false));
    }
  }

  for (const id of ghostMemberIds) {
    await step(`ghost ${id}`, () => removeGhostRole(id));
  }

  await step("full channel wipe", () => runFullChannelWipe(prisma));

  // After the wipe, never before: it bulk-deletes every #turns message.
  await step("turns console repost", () => postTurnsAnnouncement(prisma, firstTurn, null));

  // Dependency order: roles resolve a starting zone and validate
  // starting_tags; special channels' view grants name the zone roles.
  await step("zone sync", () => syncZonesFromYaml(prisma));
  await step("special channels sync", () => syncSpecialChannels(prisma));
  await step("tag sync", () => syncTagsFromYaml(prisma));
  await step("role sync", () => syncRolesFromYaml(prisma));
  await step("desire sync", () => syncDesiresFromYaml(prisma));
  await step("document sync", () => syncDocumentsFromYaml(prisma));
  // No dependents of its own, so it runs last — validates against the tag,
  // zone and location catalogs the steps above just rebuilt.
  await step("labor drop sync", () => syncLaborDropsFromYaml(prisma));

  // Backstop: whatever a retry above missed, the doctor finds and repairs.
  await step("channel doctor", () =>
    runChannelDoctor(prisma, { apply: true, scope: "cheap", actorDiscordUserId }),
  );

  const okSteps = steps.filter((s) => s.ok).length;
  await prisma.systemReport
    .update({
      where: { id: reportId },
      data: {
        finishedAt: new Date(),
        ok: failures.length === 0,
        summary: { steps: steps.length, okSteps, failedSteps: failures.length },
        failures,
      },
    })
    .catch((err) => console.error("Game wipe report write failed:", err));

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId,
        actionType: "superadmin_game_wipe_finished",
        details: { reportId, steps: steps.length, failed: failures.length },
      },
    })
    .catch((err) => console.error("Game wipe completion audit failed:", err));
}

export async function updateFaction(formData) {
  await requireDev("gm");

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const before = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!before) return;

  const parentFactionId = str(formData, "parentFactionId").trim() || null;
  if (parentFactionId) {
    if (parentFactionId === factionId) return;
    // Reject a cycle: can't already be an ancestor of its new parent.
    const ancestorIds = await getFactionAncestorIds(parentFactionId);
    if (ancestorIds.includes(factionId)) return;
  }

  // A room id straight off the form. Validated by existence rather than
  // trusted, and "" clears the pointer.
  const siloRoomRaw = str(formData, "siloRoomId").trim();
  let siloRoomId = null;
  if (siloRoomRaw) {
    const room = await prisma.room.findUnique({ where: { id: siloRoomRaw }, select: { id: true } });
    if (!room) return;
    siloRoomId = room.id;
  }

  await prisma.faction.update({
    where: { id: factionId },
    data: {
      name: str(formData, "name").trim(),
      parentFactionId,
      siloRoomId,
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// Reassigns the faction's members to "Unaffiliated" before deleting the row.
export async function deleteFaction(formData) {
  const session = await requireDev();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || isUnaffiliated(faction)) return;

  const unaffiliated = await prisma.faction.findFirst({ where: { slug: UNAFFILIATED_SLUG } });
  if (unaffiliated) {
    await prisma.character.updateMany({
      where: { factionId },
      data: { factionId: unaffiliated.id, isLeader: false },
    });
  }

  await prisma.faction.delete({ where: { id: factionId } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_deleted",
      details: { factionId, name: faction.name },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// Moves a character into a faction and sets their seats, in one write.
// Deliberately not built out of the player-facing actions: those all check
// "is this your faction", which is the check a GM is here to skip.
export async function assignFactionMember(formData) {
  const session = await requireDev("gm");

  const characterId = str(formData, "characterId");
  const factionId = str(formData, "factionId");
  if (!characterId || !factionId) return;

  const [character, faction] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId }, select: { id: true, name: true } }),
    prisma.faction.findUnique({ where: { id: factionId }, select: { id: true, name: true, slug: true } }),
  ]);
  if (!character || !faction) return;

  const makeLeader = str(formData, "isLeader") === "true" && !isUnaffiliated(faction);
  const makeTreasurer = str(formData, "isTreasurer") === "true" && !isUnaffiliated(faction);

  await prisma.$transaction(async (tx) => {
    // One Leader per faction, same rule setFactionLeader keeps.
    if (makeLeader) {
      await tx.character.updateMany({
        where: { factionId, isLeader: true },
        data: { isLeader: false },
      });
    }
    await tx.character.update({
      where: { id: characterId },
      data: { factionId, isLeader: makeLeader, isTreasurer: makeTreasurer },
    });
    // Whatever they had open elsewhere is moot once a GM has placed them.
    await tx.factionApplication.updateMany({
      where: { characterId, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_member_assigned",
      targetCharacterId: characterId,
      details: { factionId, factionName: faction.name, isLeader: makeLeader, isTreasurer: makeTreasurer },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// --- The bomb ---------------------------------------------------------

// A GM's hand on the countdown, and the only safeguard the feature has: anyone
// holding the datacard and the device can start it, and this is what can stop
// it inside the two-turn window. Superadmin-gated like everything else on this
// panel.
//
// Defusing is deliberately not the same as a player's Disarm: it files no
// Request (there is nobody to review a GM) and it works whoever is holding
// what, including when the armer is dead or gone.
export async function defuseNukeAction() {
  const session = await requireDev();

  // The fired stamp lives on the Game row, not GameState — otherwise Defuse
  // stayed refused for every game after the one that detonated.
  const state = await getGameState(prisma);
  const currentGame = await prisma.game.findUnique({
    where: { id: state.gameId },
    select: { nukeDetonatedTurn: true },
  });
  if (currentGame?.nukeDetonatedTurn != null) {
    return { ok: false, error: "It already went off." };
  }
  if (state.nukeArmedTurn == null) {
    return { ok: false, error: "Nothing is armed." };
  }

  const wasFiringOn = state.nukeArmedTurn;
  await prisma.gameState.update({ where: { id: 1 }, data: { nukeArmedTurn: null } });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "nuke_defused",
        details: { wasFiringOn },
      },
    })
    .catch((err) => console.error("Nuke defuse audit log failed:", err));

  revalidatePath("/gm/dev");
  return { ok: true, wasFiringOn };
}

// The same hand on the cult's countdown. The Rite of Ascension calls itself
// off when the cult leader dies, and this is the other way out of it —
// worth having for the same reason the Defuse button is: an eight-cultist
// chant that lands by accident, or in a playtest, should not have to burn
// the world to be undone.
export async function cancelAscensionAction() {
  const session = await requireDev();

  const state = await getGameState(prisma);
  const currentGame = await prisma.game.findUnique({
    where: { id: state.gameId },
    select: { ascensionFiredTurn: true },
  });
  if (currentGame?.ascensionFiredTurn != null) {
    return { ok: false, error: "It already happened." };
  }
  if (state.ascensionArmedTurn == null) {
    return { ok: false, error: "Nothing is coming." };
  }

  const wasFiringOn = state.ascensionArmedTurn;
  await prisma.gameState.update({ where: { id: 1 }, data: { ascensionArmedTurn: null } });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "ascension_cancelled",
        details: { wasFiringOn, by: "gm" },
      },
    })
    .catch((err) => console.error("Ascension cancel audit log failed:", err));

  revalidatePath("/gm/dev");
  return { ok: true, wasFiringOn };
}

// --- Channel doctor + system reports ----------------------------------

// Runs in after() and lands on a SystemReport row; /gm/dev polls the
// latest report per kind, so the button returns immediately.
export async function runDoctorAction(formData) {
  // The tier the run costs depends on what it does: a dry run only reads
  // Discord, Repair rewrites the guild. Read the mode BEFORE the guard --
  // hiding the Repair button from a GM is a hint, not a lock.
  const repair = str(formData, "mode") === "repair";
  const session = await requireDev(repair ? "super" : "gm");
  const scope = str(formData, "scope") === "full" ? "full" : "cheap";

  after(() =>
    runChannelDoctor(prisma, { apply: repair, scope, actorDiscordUserId: session.discordUserId }).catch((err) =>
      console.error("Channel doctor action failed:", err),
    ),
  );

  revalidatePath("/gm/dev");
  return { ok: true };
}

// --- Bulk actions -----------------------------------------------------
//
// One character picker, three verbs. Every one of them is a RAW edit, not the
// player-facing move it resembles: no Move cost, no Action, no adjacency
// check, no cooldown stamp, no point spend. A GM reaching for this has already
// decided the fiction.
//
// All three share bulk move's original shape — a SystemReport row created
// synchronously and finished inside after(), one AuditLog row written before
// the response, and per-character try/catch so one character's failed Discord
// sync never stops the rest.

const BULK_KINDS = new Set(["move", "resources", "tag"]);

export async function applyBulkAction(input) {
  const session = await requireDev("gm");

  const kind = String(input?.kind ?? "");
  if (!BULK_KINDS.has(kind)) return { ok: false, error: "Pick something to do." };

  const characterIds = (Array.isArray(input?.characterIds) ? input.characterIds : [])
    .map(String)
    .filter(Boolean);
  if (characterIds.length === 0) return { ok: false, error: "Pick at least one character." };

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      locationId: true,
      zoneId: true,
      resources: true,
    },
  });
  if (characters.length === 0) return { ok: false, error: "No living characters matched." };

  switch (kind) {
    case "move":
      return bulkMove(session, characters, input);
    case "resources":
      return bulkResources(session, characters, input);
    case "tag":
      return bulkTag(session, characters, input);
    default:
      return { ok: false, error: "Pick something to do." };
  }
}

// A SystemReport for every bulk run, not just the move: the Discord half runs
// after the response, so a failure has nowhere else to be seen.
async function openBulkReport(session, summary) {
  return prisma.systemReport.create({
    data: { kind: "BULK_MOVE", actorDiscordUserId: session.discordUserId, summary },
  });
}

async function closeBulkReport(reportId, failures) {
  await prisma.systemReport
    .update({
      where: { id: reportId },
      data: { finishedAt: new Date(), ok: failures.length === 0, failures },
    })
    .catch((err) => console.error("Bulk action report write failed:", err));
}

async function bulkMove(session, characters, input) {
  const locationId = String(input?.locationId ?? "");
  if (!locationId) return { ok: false, error: "Pick a location." };

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { zone: true },
  });
  if (!location) {
    return { ok: false, error: "That isn't a place a character can stand." };
  }

  // The denormalization contract: locationId and zoneId are written together.
  await prisma.character.updateMany({
    where: { id: { in: characters.map((c) => c.id) } },
    // travelTo* cleared alongside: being put somewhere by a GM ends any walk
    // in progress, or db/lib/travelArrivalPass.js would undo this at Dawn.
    // escortedById with them: being picked up and put somewhere ends any
    // escort, the same way travelTo* is cleared (docs/systemdocs/MAP.md §3a).
    data: {
      locationId: location.id,
      zoneId: location.zoneId,
      travelToLocationId: null,
      travelTurnId: null,
      escortedById: null,
    },
  });

  const report = await openBulkReport(session, {
    action: "move",
    location: location.name,
    zone: location.zone?.name ?? null,
    characters: characters.length,
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_bulk_move",
      details: {
        locationId: location.id,
        locationName: location.name,
        zoneId: location.zoneId,
        zoneName: location.zone?.name ?? null,
        characterIds: characters.map((c) => c.id),
      },
    },
  });

  after(async () => {
    const failures = [];
    for (const c of characters) {
      try {
        await applyLocationMoveSideEffects(prisma, {
          characterId: c.id,
          fromLocationId: c.locationId,
          toLocationId: location.id,
        });
      } catch (err) {
        failures.push({ step: "move", target: c.name, message: err.message });
        console.error(`Bulk move: Discord sync failed for ${c.name}:`, err);
      }
      // One Caving Die per arrival, same as walking in — including a drop
      // into somewhere they already stood today. Outside the try above: a
      // failed Discord sync still moved the character.
      try {
        const cavingDm = await rollCavingOnArrival(
          prisma,
          { ...c, locationId: location.id, zoneId: location.zoneId },
          location,
        );
        if (cavingDm) await sendDm(cavingDm.discordUserId, cavingDm.content);
      } catch (err) {
        failures.push({ step: "caving", target: c.name, message: err.message });
        console.error(`Bulk move: caving arrival DM failed for ${c.name}:`, err);
      }
    }
    await closeBulkReport(report.id, failures);
  });

  revalidatePath("/gm/dev");
  return { ok: true, applied: characters.length };
}

// Add or set. "Set" writes one number over everybody, "add" moves each
// character's own total, and neither is allowed to leave anyone below zero —
// a negative balance is not a state the rest of the game knows how to read.
async function bulkResources(session, characters, input) {
  const amount = Number(input?.amount);
  if (!Number.isInteger(amount)) return { ok: false, error: "Resources must be a whole number." };
  const set = input?.mode === "set";
  if (set && amount < 0) return { ok: false, error: "A total cannot be negative." };

  const changes = characters.map((c) => ({
    ...c,
    to: Math.max(0, set ? amount : c.resources + amount),
  }));

  await prisma.$transaction(
    changes.map((c) =>
      prisma.character.update({ where: { id: c.id }, data: { resources: c.to } }),
    ),
  );

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_bulk_resources",
      details: {
        mode: set ? "set" : "add",
        amount,
        characters: changes.map((c) => ({ id: c.id, from: c.resources, to: c.to })),
      },
    },
  });

  // One line each, and only to the people whose number actually moved — a DM
  // saying nothing changed is worse than no DM.
  for (const c of changes) {
    if (c.to === c.resources) continue;
    const delta = c.to - c.resources;
    notifyCharacter(c, `${delta > 0 ? "+" : ""}${delta} ⬢ — you now hold ${c.to} ⬢.`);
  }

  revalidatePath("/gm/dev");
  return { ok: true, applied: changes.length };
}

// Grant or remove one tag across the selection. Deliberately NOT the staged
// applyTagOpsInTx path the character panel uses: that one carries per-sheet
// validation and an optimistic-concurrency token this form has neither of.
// grantTagSlugs still enforces the stacking rules and the Blessed ward.
async function bulkTag(session, characters, input) {
  const slug = String(input?.tagSlug ?? "");
  if (!slug) return { ok: false, error: "Pick a tag." };
  const remove = input?.mode === "remove";

  const tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!tag) return { ok: false, error: "No such tag." };

  const openTurn = await getOpenTurn();
  const failures = [];
  const touched = [];

  for (const c of characters) {
    try {
      await prisma.$transaction(async (tx) => {
        if (remove) {
          await dropCharacterTag(tx, c.id, tag.id);
        } else {
          await grantTagSlugs(tx, c.id, [slug], openTurn?.number ?? null);
        }
      });
      touched.push(c.id);
    } catch (err) {
      failures.push({ step: "tag", target: c.name, message: err.message });
      console.error(`Bulk tag: ${remove ? "remove" : "grant"} failed for ${c.name}:`, err);
    }
  }

  const report = await openBulkReport(session, {
    action: remove ? "tag-remove" : "tag-grant",
    tag: tag.name,
    characters: touched.length,
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_bulk_tag",
      turnId: openTurn?.id ?? null,
      details: {
        mode: remove ? "remove" : "grant",
        tagSlug: slug,
        tagName: tag.name,
        characterIds: touched,
      },
    },
  });

  // Not wrapped in after(): the helper defers its own Discord round trips and
  // is the one sweep every other tag writer runs, so a tag that changes carry
  // or a room key settles the same way here as anywhere else.
  try {
    await afterInventoryChange(touched);
  } catch (err) {
    failures.push({ step: "inventory", target: "all", message: err.message });
    console.error("Bulk tag: inventory sweep failed:", err);
  }
  await closeBulkReport(report.id, failures);

  for (const c of characters) {
    if (!touched.includes(c.id)) continue;
    notifyCharacter(c, remove ? `You have lost ${tag.name}.` : `You have gained ${tag.name}.`);
  }

  revalidatePath("/gm/dev");
  return {
    ok: failures.length === 0,
    applied: touched.length,
    error: failures.length ? `${failures.length} failed — see System reports.` : undefined,
  };
}

// --- The inactivity nudge ---------------------------------------------
//
// Who counts as inactive is db/lib/inactivity.js's answer, the same one the
// ops script prints, so the report a GM runs on the command line and the list
// they message from here cannot drift.
//
// The DM goes through web/lib/discordGuild.js#sendDm and no other path: that
// is the one that writes a DirectMessage row, which is what puts the nudge in
// the player's conversation on /gm/players instead of only in somebody's
// client.

const NUDGE_MAX = 1500;

export async function nudgeInactivePlayers(input) {
  const session = await requireDev("gm");

  const text = String(input?.text ?? "").trim();
  if (!text) return { ok: false, error: "Write the message first." };
  if (text.length > NUDGE_MAX) return { ok: false, error: "That is too long for a nudge." };

  const characterIds = (Array.isArray(input?.characterIds) ? input.characterIds : [])
    .map(String)
    .filter(Boolean);
  if (characterIds.length === 0) return { ok: false, error: "Pick at least one player." };

  // Re-derived from the module rather than trusted from the form: a server
  // action is a public endpoint, and this one can DM anybody otherwise.
  const report = await inactiveCharacters(prisma);
  const eligible = new Map(
    [...report.leftGuild, ...report.neverActive, ...report.sinceDayOne].map((c) => [c.id, c]),
  );

  const targets = characterIds.map((id) => eligible.get(id)).filter((c) => c?.discordUserId);
  if (targets.length === 0) return { ok: false, error: "None of those are on the inactive list." };

  const sent = [];
  const failures = [];
  for (const c of targets) {
    try {
      // Attributed: this is a GM's own words, not the bot's, so it keeps the
      // null source that means "conversation" and shows on the desk as one.
      await sendDm(c.discordUserId, text, { authorDiscordUserId: session.discordUserId });
      sent.push(c.id);
    } catch (err) {
      failures.push({ step: "dm", target: c.name, message: err.message });
      console.error(`Inactivity nudge failed for ${c.name}:`, err);
    }
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_inactive_nudge",
      details: { characterIds: sent, failed: failures.length, text },
    },
  });

  revalidatePath("/gm/dev");
  return {
    ok: failures.length === 0,
    sent: sent.length,
    error: failures.length ? `${failures.length} could not be reached.` : undefined,
  };
}

// --- Ambient lines ----------------------------------------------------
//
// A line the WORLD says, typed from the web instead of by hand in Discord.
// The formatting is the whole point of the tool: `-#` is PER LINE, so a
// multi-line block needs the prefix on every one of them, and ambientLine is
// the one place that rule lives (docs/systemdocs/ARCHITECTURE.md, CLAUDE.md's
// aura section). Typed by hand, a two-line scene came out half subtext.
//
// The intercom is the deliberate exception to all of this and is NOT reachable
// from here — a PA is a loudspeaker, not scenery (db/lib/intercom.js).

const AMBIENT_MAX = 1500;

// The channel a target speaks into, or a refusal. Every kind resolves through
// its own row so a target with no Discord footprint yet says so plainly rather
// than posting into nothing.
async function ambientTarget(kind, id) {
  switch (kind) {
    case "zone": {
      const zone = await prisma.zone.findUnique({
        where: { id },
        select: { id: true, name: true, discordSummaryChannelId: true },
      });
      if (!zone) return { error: "No such zone." };
      if (!zone.discordSummaryChannelId) return { error: "That zone has no #summary channel yet." };
      return { channelId: zone.discordSummaryChannelId, name: `${zone.name} — #summary`, zoneId: zone.id };
    }
    case "location": {
      const location = await prisma.location.findUnique({
        where: { id },
        select: { id: true, name: true, discordChannelId: true, zoneId: true },
      });
      if (!location) return { error: "No such location." };
      if (!location.discordChannelId) return { error: "That location has no channel yet." };
      return { channelId: location.discordChannelId, name: location.name, zoneId: location.zoneId };
    }
    case "room": {
      const room = await prisma.room.findUnique({
        where: { id },
        select: { id: true, name: true, discordThreadId: true, location: { select: { zoneId: true } } },
      });
      if (!room) return { error: "No such room." };
      if (!room.discordThreadId) return { error: "That room has no thread yet." };
      return { channelId: room.discordThreadId, name: room.name, zoneId: room.location?.zoneId ?? null };
    }
    default:
      return { error: "Pick somewhere to say it." };
  }
}

export async function sendAmbientLine(input) {
  const session = await requireDev("gm");

  const kind = String(input?.kind ?? "");
  const targetId = String(input?.targetId ?? "");
  const text = String(input?.text ?? "").trim();
  if (!text) return { ok: false, error: "Write the line first." };
  if (text.length > AMBIENT_MAX) return { ok: false, error: "That is too long for one line of scenery." };

  const target = await ambientTarget(kind, targetId);
  if (target.error) return { ok: false, error: target.error };

  // The same GmZoneView scope the desks apply: a GM should not be able to
  // speak into a zone they cannot see. No rows means every zone.
  const allowed = await visibleZoneIds(prisma, session.discordUserId);
  if (allowed && target.zoneId && !allowed.has(target.zoneId)) {
    return { ok: false, error: "That is not one of the zones you are watching." };
  }

  const content = ambientLine(text);
  try {
    await postMessage(target.channelId, content);
  } catch (err) {
    console.error("Ambient line failed:", err);
    return { ok: false, error: "Discord refused it. Nothing was said." };
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_ambient_line",
      details: { kind, targetId, targetName: target.name, text },
    },
  });

  return { ok: true, said: target.name };
}

// --- GM letters -------------------------------------------------------
//
// A letter from nobody in particular. It rides BirdMessage, which buys the
// reply window, the one-reply claim and the reply picker for free — see
// docs/systemdocs/BIRD.md §9 for the three places it branches from a player's
// Bird, and why.
// `prevState` first: the form reads the result through useActionState, since
// a fire-and-forget <form action={...}> has nowhere to report a refusal to.
export async function sendGmLetter(_prevState, formData) {
  const session = await requireDev("gm");

  const senderName = str(formData, "senderName").trim().slice(0, 80);
  const recipientId = str(formData, "recipientId");
  const body = str(formData, "body").trim().slice(0, GM_LETTER_MAX);
  const sealed = str(formData, "sealed") === "on";
  const sealLabelText = str(formData, "sealLabel").trim().slice(0, 40);
  const sealMarkText = str(formData, "sealMark").trim().slice(0, 200);

  if (!senderName) return { ok: false, error: "Say who it's from." };
  if (!recipientId) return { ok: false, error: "Pick who it's for." };
  if (!body) return { ok: false, error: "Write something first." };
  if (sealed && !sealLabelText) return { ok: false, error: "Name the seal. It goes in the letter's title." };
  if (sealed && !sealMarkText) return { ok: false, error: "Say what the wax carries." };

  // The reply window is arrivalTurn + 1, so a letter sent between turns would
  // land already unanswerable. Refuse rather than send a mute one.
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return { ok: false, error: "No turn is open. The bird waits for one." };

  const recipient = await prisma.character.findUnique({
    where: { id: recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!recipient) return { ok: false, error: "No such character." };
  // Unlike the picker, which lists the dead too (BIRD.md §2 — a list of the
  // living is a casualty report), the SEND refuses. A letter to a corpse would
  // mint paper onto a sheet nobody reads.
  if (recipient.status !== "ALIVE") return { ok: false, error: "They're past reading it." };

  const canReply = canReadLetters(recipient.tags);

  let letter = null;
  let birdMessageId = null;
  await prisma.$transaction(async (tx) => {
    letter = await mintLetterFor(tx, recipient.id, senderName, body);
    if (sealed) letter = await sealWithMark(tx, letter, { label: sealLabelText, mark: sealMarkText });

    const row = await tx.birdMessage.create({
      data: {
        // No sender Character — that is the whole loosening the gm_letters
        // migration bought.
        senderId: null,
        senderName,
        gmSenderDiscordUserId: session.discordUserId,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientDiscordUserId: recipient.discordUserId ?? null,
        // No zone guess. A GM already knows where everyone is standing, and a
        // GM letter reaches the Depths, which no bird will fly to.
        guessedZoneId: null,
        guessedZoneName: null,
        tagId: letter.id,
        tagName: letter.name,
        body: sealed ? null : body,
        delivered: true,
        arrivalTurnId: openTurn.id,
        replyDeadlineTurn: openTurn.number + 1,
      },
    });
    birdMessageId = row.id;

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_send_letter",
        targetCharacterId: recipient.id,
        // The letter IS the record, the same call the player Bird makes.
        reason: sealed ? `Sealed: ${letter.name}` : body.slice(0, MAX_REASON_LENGTH),
        details: { birdMessageId: row.id, senderName, sealed, tagId: letter.id, tagName: letter.name },
      },
    });
  });

  // Post-commit: a DM must never hold up or undo the write (ARCHITECTURE.md
  // §5). One row on the recipient's thread — the desk keys a conversation on
  // the PLAYER's id, so that is where a GM reads the exchange back. `content`
  // stays what the player actually received; the letter itself rides in meta,
  // and DmThread.js renders the card from that.
  notifyCharacter(recipient, deliveryDm({ senderName, letterName: letter.name }), {
    authorDiscordUserId: session.discordUserId,
    components: canReply ? replyButtonRow(birdMessageId) : undefined,
    source: GM_LETTER_SOURCE,
    meta: {
      birdMessageId,
      senderName,
      letterName: letter.name,
      letterBody: body,
      sealed,
      sealMark: sealed ? sealMarkText : null,
    },
  });

  await afterInventoryChange([recipient.id]);
  revalidatePath("/gm/dev");
  revalidatePath("/gm/players");
  return {
    ok: true,
    message: canReply
      ? `${letter.name} is on ${recipient.name}'s sheet. They can answer it until turn ${openTurn.number + 1}.`
      : `${letter.name} is on ${recipient.name}'s sheet. They can't read, so there's no Reply button.`,
  };
}
