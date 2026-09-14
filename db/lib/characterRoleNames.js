// The personal Discord role's title, reconciled against the name its character is actually going by
// (PROXYING.md §6). The role follows a held Tag.forcedName (db/lib/disguiseMint.js, Apex Form) so a
// Disguise Kit scene's @-token matches the prose. A HOOD renames nothing — see db/lib/characterRoleAppearance.js.
// RECONCILE, not a hook: a forcedName tag can arrive/leave through eight-plus generic tag writes, none
// of which know a Discord role exists, so this asks Discord what the roles are called and PATCHes only
// the ones that disagree. Runs from advanceTurn beside the Catatonic pass's role updates, merged before
// sending so a role is never PATCHed twice in a turn. Returned side effects (ARCHITECTURE.md): this
// computes, the caller sends. Takes `prisma`, off the barrel (db/lib/dm.js convention).
const { CATATONIC_SLUG } = require("./constants");
const { formatBareName } = require("./characterName");
const { characterRoleAppearance } = require("./characterRoleAppearance");

// A ceiling on one turn's worth of renames — role PATCH is a slow per-guild bucket. Leftovers are
// picked up next turn.
const MAX_RENAMES_PER_PASS = 25;

// `roles` is what db/lib/discordRest.js#getGuildRoles returned — this module holds no client.
// Returns [{ roleId, name, color }], the shape catatonicPass.js hands back, so advanceTurn concatenates them.
async function reconcileCharacterRoleNames(prisma, roles) {
  if (!Array.isArray(roles) || roles.length === 0) return [];
  const byId = new Map(roles.map((role) => [role.id, role]));

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", discordRoleId: { not: null } },
    select: {
      id: true,
      discordRoleId: true,
      firstName: true,
      lastName: true,
      // Both things the title is composed from. One row each, not the whole sheet.
      tags: {
        where: { OR: [{ tag: { forcedName: { not: null } } }, { tag: { slug: CATATONIC_SLUG } }] },
        select: { tag: { select: { slug: true, forcedName: true } } },
      },
    },
  });

  const updates = [];
  for (const character of characters) {
    const role = byId.get(character.discordRoleId);
    // A role the DB names but the guild does not have is the channel doctor's to report, not this pass's.
    if (!role) continue;

    const bare = formatBareName(character);
    if (!bare) continue;

    const forcedName = character.tags.find((held) => held.tag?.forcedName)?.tag?.forcedName ?? null;
    const catatonic = character.tags.some((held) => held.tag?.slug === CATATONIC_SLUG);
    const want = characterRoleAppearance(bare, { catatonic, forcedName });

    if (role.name === want.name && role.color === want.color) continue;
    updates.push({ roleId: character.discordRoleId, ...want });
    if (updates.length >= MAX_RENAMES_PER_PASS) break;
  }
  return updates;
}

module.exports = { reconcileCharacterRoleNames, MAX_RENAMES_PER_PASS };
