import { prisma, DYNASTY_HEAD_SLUG, DYNASTY_MEMBER_SLUGS } from "@lifeweb/db";
import { formatCharacterName } from "@/lib/characterName";
import { ensureCharacterRole } from "@/lib/discordGuild";

// The prisma/Discord half of db/lib/dynasty.js — the Baroness, Heir and Successor wear the
// Baron's last name. Server-only: pure predicates live in the barrel instead.
export async function dynastyLastName() {
  const baron = await prisma.character.findFirst({
    where: { status: "ALIVE", role: { slug: DYNASTY_HEAD_SLUG } },
    select: { lastName: true },
  });
  return baron?.lastName ?? null;
}

// Called only after a Baron write has committed — never on his death. A FOURTH writer of the
// denormalized Character.name mirror (see the Character names section of CLAUDE.md).
export async function propagateDynastyLastName(lastName) {
  const members = await prisma.character.findMany({
    where: { status: "ALIVE", role: { slug: { in: DYNASTY_MEMBER_SLUGS } } },
  });

  for (const member of members) {
    if (member.lastName === lastName) continue;

    const updated = await prisma.character.update({
      where: { id: member.id },
      data: {
        lastName,
        name: formatCharacterName({ ...member, lastName }),
      },
    });

    await ensureCharacterRole(updated).catch(() => {});
  }
}
