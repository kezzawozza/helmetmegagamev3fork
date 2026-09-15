const { sendDm } = require("../../dm");
const { openDeadchatTo, DEADCHAT_INVITE } = require("../../deadchat");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("../../constants");
const { stillAlive } = require("../../deathTeardown");
const { revokeAllCharacterAccess } = require("../../accessSweep");
const {
  postMessage,
  deleteGuildRole,
  getGuildMember,
  setGuildNickname,
} = require("../../discordRest");

async function handleDeaths({ prisma, p, list, step, eachDm }) {
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
        await openDeadchatTo(prisma, death.discordUserId).catch((err) =>
          console.error(
            `Failed to open Deadchat for ${death.discordUserId}:`,
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
            `You have died. ${death.reason}\n${DEADCHAT_INVITE}`,
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
}

module.exports = { handleDeaths };
