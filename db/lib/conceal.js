// /conceal as a rule, not a handler — both faces call it (bot/src/events/interactionCreate.js#
// handleConcealCommand and the web's Chat composer), so refusals read the same everywhere. A standing
// state: while on, every message proxies under the alias with the unknown silhouette, and Who's here
// lists the alias. Refusals in order: a held forcesName tag refuses outright (identity is fixed);
// a bare face has nothing to toggle; a forcesConceal piece is already hiding you and doesn't come off
// by asking — the concealed column is left alone so the player's last choice resumes once it's off,
// and the message must say a forcesConceal piece is ALREADY hiding you (not "take it off first",
// which says the opposite). Takes `prisma` as a parameter, off the @lifeweb/db barrel like db/lib/dm.js;
// require it by path.

const { loadForcedName, loadConcealment } = require("./presentedIdentity");
const { concealedAlias, withArticle } = require("./concealedIdentity");

// `character` needs { id, concealed, age, gender } and { discordUserId } for the audit row.
async function toggleConceal(prisma, character) {
  if (!character?.id) return { ok: false, error: "You don't have a living character." };

  const forcedName = await loadForcedName(prisma, character.id);
  if (forcedName) {
    return { ok: false, error: `You are ${forcedName} now.` };
  }

  const concealment = await loadConcealment(prisma, character.id);
  if (!concealment) {
    return { ok: false, error: "Conceal your face first." };
  }
  if (concealment.forced) {
    return {
      ok: false,
      error: concealment.name
        ? `The ${concealment.name} already conceals you.`
        : "That already conceals you.",
    };
  }

  const concealed = !character.concealed;
  await prisma.character.update({ where: { id: character.id }, data: { concealed } });

  const alias = concealedAlias(character);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "",
        actionType: "character_conceal_toggled",
        targetCharacterId: character.id,
        details: { concealed },
      },
    })
    .catch((err) => console.error("Conceal audit log failed:", err));

  return {
    ok: true,
    concealed,
    alias: concealed ? alias : null,
    line: concealed
      ? `You now speak as **${withArticle(alias.toLowerCase())}**.`
      : "You speak under your real name again.",
  };
}

module.exports = { toggleConceal };
