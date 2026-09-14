// Shared helpers for the channel doctor's sweeps. Split out of
// db/lib/channelDoctor.js verbatim (W2d).
const { addMemberRole, removeMemberRole } = require("../discordRest");
const { PLAYER_ROLE_ID, SPECTATOR_ROLE_ID, LEADER_WHITELIST_ROLE_ID, GHOST_ROLE_ID, gmRoleIds } = require("../roleIds");
const { hashNameToColor } = require("../roleColor");

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

module.exports = { looksLikeCharacterRole, standingRoleIds, makeReporter, reconcileRoleMembership };
