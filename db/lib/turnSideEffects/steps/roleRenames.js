const { reconcileCharacterRoleNames } = require("../../characterRoleNames");
const { getGuildRoles, patchGuildRole } = require("../../discordRest");
const { plainDm } = require("../shared");

async function renameCatatonicRoles({ prisma, p, list, step, eachDm }) {
  await eachDm("catatonicDm", p.catatonicDms, (dm) => plainDm(prisma, dm, "Catatonic"));

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
}

module.exports = { renameCatatonicRoles };
