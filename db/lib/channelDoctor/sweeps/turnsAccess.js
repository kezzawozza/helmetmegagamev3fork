// The channel doctor's full-scope #turns access sweep. Moved verbatim out of
// runChannelDoctor (W2d).
const { getChannel } = require("../../discordRest");
const { findTurnsChannelId, turnsChannelOverwrites, syncTurnsChannelAccess } = require("../../turnsChannelAccess");

async function runTurnsAccessSweep({ report, errors, prisma, liveRoles, zoneRoleIds, spectators }) {
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

module.exports = { runTurnsAccessSweep };
