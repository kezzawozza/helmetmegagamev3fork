import { after } from "next/server";
import { sendDm } from "@/lib/discordGuild";
import { prisma } from "@lifeweb/db";
import { stillAlive } from "@lifeweb/db/lib/deathTeardown";

// Fired from after(), post-commit: a DM must never hold up the action that triggered it, and a
// failed DM must never undo what already happened. Deliberately unattributed — callers write what
// CHANGED, never who did it (REQUESTS.md). Exception: a Bird's letter is signed (BIRD.md).
//
// Also no-ops on a dead character whose player already controls a different living one — a notice
// about the corpse isn't a notice about THEM any more. `!== "ALIVE"`, not `=== "DEAD"`, the same
// convention db/lib/ghost.js and db/lib/curse.js use for the vestigial CURSED enum value. Trusts
// `character.status` when the caller included it (every dead-capable call site does — corpse.js,
// misc.js's loot/bind, the Dev Panel's loadCharacter) and skips the extra query otherwise, since
// every other call site is already ALIVE-only by its own fetch. `stillAlive` is the same predicate
// db/lib/reincarnate.js and the death teardown already rely on, reused rather than re-derived.
export function notifyCharacter(character, text, opts = {}) {
  if (!character?.discordUserId) return;
  after(async () => {
    if (character.status && character.status !== "ALIVE") {
      const reborn = await stillAlive(prisma, character.discordUserId).catch(() => false);
      if (reborn) return;
    }
    await sendDm(character.discordUserId, text, {
      authorDiscordUserId: opts.authorDiscordUserId ?? null,
      source: opts.source ?? "player_event",
      kind: opts.kind,
      components: opts.components,
      embeds: opts.embeds,
      meta: opts.meta,
    }).catch((err) => console.error(`notifyCharacter DM failed for ${character.id}:`, err));
  });
}
