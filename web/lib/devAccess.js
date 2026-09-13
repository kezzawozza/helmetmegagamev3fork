import { cache } from "react";

import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";

// Who may see what in the Dev Panel.
//
// There are two tiers, and the line between them is host access vs. running
// the game. "super" is the host: wipe the game, retune the economy, force a
// turn, open and close the lobby — things whose blast radius is the whole
// installation. "gm" is the work five people do every day: move a group of
// characters, send a letter, set an antagonist's objectives.
//
// The panel used to be superadmin outright, which meant the daily work was
// behind the gate meant for the dangerous stuff. This table is the whole
// difference; the nav filters itself through it and every server action
// re-checks against it, because a server action is a public endpoint and a
// hidden nav item is a hint, not a lock.
export const SECTION_TIER = {
  game: "super",
  games: "super",
  turn: "super",
  config: "super",
  depot: "super",
  // The Oracle carries a live API key and two editable prompts, so it sits
  // with the superadmin sections rather than the GM ones.
  oracle: "super",

  bulk: "gm",
  letters: "gm",
  ambient: "gm",
  reports: "gm",
  gamemasters: "gm",

  assignments: "gm",
  antagonists: "gm",

  // Staging a quest is daily work, not host access. Deleting one takes the
  // record of who touched it, so THAT verb asks for super in questActions.js
  // — the section itself is a GM's.
  quests: "gm",

  danger: "super",
};

// Where a tier lands when it asks for no section in particular.
const HOME = { super: "game", gm: "bulk" };

export function allows(tier, need) {
  if (tier === "super") return true;
  if (tier === "gm") return need === "gm";
  return false;
}

export function homeSection(tier) {
  return HOME[tier] ?? "bulk";
}

// Resolve a section a viewer may actually open. Falls back to their home
// section rather than bouncing them off the panel: a GM typing /gm/dev with no
// query, or following an old ?s=danger link, should land somewhere useful.
export function resolveSection(tier, requested) {
  if (requested && SECTION_TIER[requested] && allows(tier, SECTION_TIER[requested])) {
    return requested;
  }
  return homeSection(tier);
}

// "super" | "gm" | "none". Built on getGmSession, which is already cache()d, so
// the guild REST lookup is paid once per request no matter how many callers ask.
export const getDevTier = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return "none";
  if (isSuperadmin(session.discordUserId)) return "super";
  return isGm ? "gm" : "none";
});

// The one guard the Dev Panel's server actions share. `need` is the tier the
// action costs, not the tier the caller has — most of them still cost "super".
export async function requireDev(need = "super") {
  const tier = await getDevTier();
  if (!allows(tier, need)) throw new Error("Not authorized.");
  const { session } = await getGmSession();
  return session;
}
