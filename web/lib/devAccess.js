import { cache } from "react";

import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";

// Who may see what in the Dev Panel. "super" is host access (blast radius: the whole
// installation); "gm" is the daily work. Every server action re-checks against this too.
export const SECTION_TIER = {
  game: "super",
  games: "super",
  turn: "super",
  config: "super",
  depot: "super",
  oracle: "super",

  bulk: "gm",
  letters: "gm",
  ambient: "gm",
  reports: "gm",
  gamemasters: "gm",

  assignments: "gm",
  antagonists: "gm",

  // Deleting a quest takes the record of who touched it, so THAT verb asks for super (questActions.js).
  quests: "gm",

  danger: "super",
};

const HOME = { super: "game", gm: "bulk" };

export function allows(tier, need) {
  if (tier === "super") return true;
  if (tier === "gm") return need === "gm";
  return false;
}

function homeSection(tier) {
  return HOME[tier] ?? "bulk";
}

// Falls back to their home section rather than bouncing them off the panel.
export function resolveSection(tier, requested) {
  if (requested && SECTION_TIER[requested] && allows(tier, SECTION_TIER[requested])) {
    return requested;
  }
  return homeSection(tier);
}

// "super" | "gm" | "none". Built on getGmSession, already cache()d.
export const getDevTier = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return "none";
  if (isSuperadmin(session.discordUserId)) return "super";
  return isGm ? "gm" : "none";
});

// `need` is the tier the action costs, not the tier the caller has.
export async function requireDev(need = "super") {
  const tier = await getDevTier();
  if (!allows(tier, need)) throw new Error("Not authorized.");
  const { session } = await getGmSession();
  return session;
}
