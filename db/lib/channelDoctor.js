// The channel doctor is now a thin alias over db/lib/discordMirror — see that
// module's header. `runChannelDoctor` maps its two scopes onto "cheap"/"full"
// and keeps the `{ scope, apply, findings, failures, repaired }` shape callers
// already expect.
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
