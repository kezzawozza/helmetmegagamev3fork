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
  reports: "gm",
  gamemasters: "gm",

  assignments: "gm",
  antagonists: "gm",

  // Deleting a quest takes the record of who touched it, so THAT verb asks for super (questActions.js).
  quests: "gm",
  // The four lists that used to be pages of their own. Every GM reads them;
  // the narrower verbs inside each (delete a custom tag,
  // hard-delete a place) ask for super at the call site instead.
  characters: "gm",
  tags: "gm",
  zones: "gm",

  danger: "super",
};

const HOME = { super: "game", gm: "bulk" };

// Sections that folded into another one. A bookmark to the old key lands on
// what replaced it rather than bouncing its owner to their home section.
// Send a letter and Say something are both bulk verbs now.
const MERGED_INTO = { letters: "bulk", ambient: "bulk" };

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
  const key = MERGED_INTO[requested] ?? requested;
  if (key && SECTION_TIER[key] && allows(tier, SECTION_TIER[key])) {
    return key;
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
