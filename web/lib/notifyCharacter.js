import { after } from "next/server";
import { sendDm } from "@/lib/discordGuild";

// Fired from after(), post-commit: a DM must never hold up the action that triggered it, and a
// failed DM must never undo what already happened. Deliberately unattributed — callers write what
// CHANGED, never who did it (REQUESTS.md). Exception: a Bird's letter is signed (BIRD.md).
export function notifyCharacter(character, text, opts = {}) {
  if (!character?.discordUserId) return;
  after(() =>
    sendDm(character.discordUserId, text, {
      authorDiscordUserId: opts.authorDiscordUserId ?? null,
      source: opts.source ?? "player_event",
      kind: opts.kind,
      components: opts.components,
      embeds: opts.embeds,
      meta: opts.meta,
    }).catch((err) => console.error(`notifyCharacter DM failed for ${character.id}:`, err)),
  );
}
