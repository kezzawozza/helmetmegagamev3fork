// The channel doctor — now a name for one shape of mirror run.
//
// It used to be its own reconciler: it compared the database against Discord,
// repaired what it could, and for anything structural it was missing — a zone
// with no role, a Location whose channel had been deleted — it wrote a finding
// that said "run db:sync-zones". That was the whole gap the mirror closes, so
// the doctor is not a second detector any more. `runChannelDoctor` maps its two
// scopes onto `runDiscordMirror` and hands back the same `{ scope, apply,
// findings, failures, repaired }` it always did, which is why the bot's ready
// pass, the turn wrapup and the Dev Panel's Repair button needed no changes.
//
//   cheap  structure + role membership + Location occupancy, and now the
//          structural op list as well — so a missing channel is rebuilt
//          instead of reported.
//   full   all of that plus channel overwrites, threads, narrowcast and
//          #turns access.
//
// The sweeps themselves still live in db/lib/channelDoctor/; only the sequence
// moved, to db/lib/discordMirror/sweeps.js.
const { runDiscordMirror } = require("./discordMirror");

async function runChannelDoctor(prisma, { apply = false, scope = "cheap", actorDiscordUserId = null } = {}) {
  const { findings, failures, repaired } = await runDiscordMirror(prisma, {
    apply,
    scope: scope === "full" ? "full" : "cheap",
    actorDiscordUserId,
    // Its runs stay on their own SystemReport kind: /gm/dev shows the latest
    // report per kind, and a doctor run that filed itself as MIRROR would push
    // the preview off the panel.
    reportKind: "DOCTOR",
  });
  return { scope, apply, findings, failures, repaired };
}

module.exports = { runChannelDoctor };
