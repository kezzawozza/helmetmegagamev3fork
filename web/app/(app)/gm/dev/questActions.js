"use server";

// The Quests panel's verbs, behind /gm/dev?s=quests (docs/systemdocs/QUESTS.md).
// The work itself is db/lib/quests.js, shared with the bot's Interact handler; what is
// here is the gate, the GmZoneView scope and the audit row. Every one of them re-checks
// what the UI already checked. A server action is a public endpoint, and a hidden button is a hint, not a lock.
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { visibleZoneIds } from "@lifeweb/db/lib/gmZoneView";
import { createQuest, updateQuest, closeQuest } from "@lifeweb/db/lib/quests";
import { requireDev } from "@/lib/devAccess";

function repaint() {
  revalidatePath("/gm/dev");
}

// The same GmZoneView scope every desk applies: a GM cannot stage, edit or close a quest
// in a zone they are not watching. No rows means every zone.
async function inScope(session, locationId) {
  const allowed = await visibleZoneIds(prisma, session.discordUserId);
  if (!allowed) return { ok: true };
  const location = await prisma.location.findUnique({
    where: { id: String(locationId ?? "") },
    select: { zoneId: true },
  });
  if (!location) return { ok: false, error: "There's no such place." };
  if (!allowed.has(location.zoneId)) {
    return { ok: false, error: "That is not one of the zones you are watching." };
  }
  return { ok: true };
}

async function questInScope(session, questId) {
  const quest = await prisma.quest.findUnique({
    where: { id: String(questId ?? "") },
    select: { id: true, locationId: true },
  });
  if (!quest) return { ok: false, error: "That quest is gone." };
  const scope = await inScope(session, quest.locationId);
  if (!scope.ok) return scope;
  return { ok: true, quest };
}

export async function createQuestAction(input) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }

  const locationId = String(input?.locationId ?? "");
  const scope = await inScope(session, locationId);
  if (!scope.ok) return { error: scope.error };

  const result = await createQuest(prisma, {
    title: input?.title,
    description: input?.description,
    locationId,
    expiresTurns: input?.expiresTurns,
    accessTagSlugs: input?.accessTagSlugs,
    allowedCharacterIds: input?.allowedCharacterIds,
    createdById: session.discordUserId,
  });
  if (!result.ok) return { error: result.error };

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_quest_created",
        details: {
          questId: result.quest.id,
          title: result.quest.title,
          locationId,
          expiresTurn: result.quest.expiresTurn,
        },
      },
    })
    .catch(() => {});

  repaint();
  return { ok: true, questId: result.quest.id };
}

export async function updateQuestAction(input) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }

  const scoped = await questInScope(session, input?.questId);
  if (!scoped.ok) return { error: scoped.error };

  const result = await updateQuest(prisma, scoped.quest.id, {
    title: input?.title,
    description: input?.description,
    expiresTurns: input?.expiresTurns,
    accessTagSlugs: input?.accessTagSlugs,
    allowedCharacterIds: input?.allowedCharacterIds,
  });
  if (!result.ok) return { error: result.error };

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_quest_edited",
        details: { questId: scoped.quest.id, title: result.quest.title },
      },
    })
    .catch(() => {});

  repaint();
  return { ok: true };
}

// Closing is the ordinary end of a quest, so it is a GM verb, not superadmin — the record
// survives, only the thread and the Room go.
export async function closeQuestAction(input) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }

  const scoped = await questInScope(session, input?.questId);
  if (!scoped.ok) return { error: scoped.error };

  const result = await closeQuest(prisma, scoped.quest.id, { status: "CLOSED" });
  if (!result.ok) return { error: result.error };

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_quest_closed",
        details: { questId: scoped.quest.id, title: result.quest.title },
      },
    })
    .catch(() => {});

  repaint();
  return { ok: true };
}

// Deleting takes the RECORD too, the only genuinely lossy verb here, so it is superadmin.
export async function deleteQuestAction(input) {
  let session;
  try {
    session = await requireDev();
  } catch {
    return { error: "Not authorized." };
  }

  const questId = String(input?.questId ?? "");
  const quest = await prisma.quest.findUnique({ where: { id: questId }, select: { id: true, title: true } });
  if (!quest) return { error: "That quest is gone." };

  // Shut it first — a delete must not leave an orphaned thread behind.
  await closeQuest(prisma, quest.id, { status: "CLOSED" }).catch(() => {});
  // QuestInteraction is onDelete: Cascade, so the presses go with it.
  await prisma.quest.delete({ where: { id: quest.id } });

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_quest_deleted",
        details: { questId: quest.id, title: quest.title },
      },
    })
    .catch(() => {});

  repaint();
  return { ok: true };
}
