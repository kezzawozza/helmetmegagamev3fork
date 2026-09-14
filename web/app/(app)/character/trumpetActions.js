"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { TRUMPET_SLUG } from "@lifeweb/db/lib/constants";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { broadcastTrumpet, TRUMPET_COOLDOWN_MS } from "@lifeweb/db/lib/trumpet";
import { auth } from "@/lib/auth";

// Sounding a trumpet is heard across the Location graph — db/lib/trumpet.js
// for reach, db/lib/soundBroadcast.js for how it carries. Web half: the
// button lives on the Character page, not Discord, since "only if you have
// one" is a per-reader question. Writes an AuditLog row, unlike equipping —
// heard by most of the barony and can't be taken back (bell rope's reasoning).

// One clock per character, in process memory (the bot's `lastShouted`
// pattern) — a courtesy against spam, not game state, so a deploy clearing it costs nothing.
const lastSounded = new Map();

export async function soundTrumpet() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // From the session, never a posted id — a server action is a public endpoint.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
  if (!character) return { ok: false, error: "No living character." };

  // Every gate the page already applied, re-applied — hidden button is a hint, not a lock.
  if (!character.tags.some((ct) => ct.tag.slug === TRUMPET_SLUG)) {
    return { ok: false, error: "You aren't carrying a trumpet." };
  }
  if (!character.locationId) {
    return { ok: false, error: "You're nowhere." };
  }

  // ACT, not SPEAK: a trumpet takes breath AND hands, so Bound stops it where a shout deliberately isn't stopped.
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    return { ok: false, error: `You can't play the instrument — you're ${blocker.name}.` };
  }

  const since = Date.now() - (lastSounded.get(character.id) ?? 0);
  if (since < TRUMPET_COOLDOWN_MS) {
    const minutes = Math.max(1, Math.ceil((TRUMPET_COOLDOWN_MS - since) / 60_000));
    return {
      ok: false,
      error: `Your lips need about ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    };
  }
  // Claimed BEFORE the posting loop — a couple dozen REST calls, long enough for a second click to slip past a cooldown stamped at the end.
  lastSounded.set(character.id, Date.now());

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "trumpet_sounded",
        targetCharacterId: character.id,
        details: { characterName: character.name, locationId: character.locationId },
      },
    })
    .catch((err) => console.error("Trumpet audit log failed:", err));

  // Post-commit and catch-logged (requestActions.js#speakAtSite discipline, ARCHITECTURE.md §5).
  const locationId = character.locationId;
  after(() =>
    broadcastTrumpet(prisma, locationId).catch((err) =>
      console.error("Trumpet broadcast failed:", err),
    ),
  );

  revalidatePath("/character");
  return { ok: true };
}
