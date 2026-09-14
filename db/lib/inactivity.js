// Who has stopped playing. One definition, read by both the ops script
// (db/scripts/ops/report-inactive-characters.js) and the Dev Panel's System
// reports section, so the report a GM runs on the command line and the list
// they nudge from the web cannot drift apart.
//
// Same lastActivityTurn semantics as db/lib/catatonicPass.js: NULL reads as
// "active right now", not as "never active", which is why a character whose
// clock was never stamped is its own bucket rather than folded in with one
// genuinely stuck on turn 1.

const BUCKET_LABEL = {
  leftGuild: "Left the guild",
  neverActive: "Never active",
  sinceDayOne: "Idle since day one",
};

async function inactiveCharacters(prisma) {
  const turn =
    (await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } })) ??
    (await prisma.turn.findFirst({ orderBy: { number: "desc" }, select: { number: true } }));

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true, lastActivityTurn: true, leftGuildAt: true },
    orderBy: { name: "asc" },
  });

  const leftGuild = characters.filter((c) => c.leftGuildAt != null);
  const neverActive = characters.filter((c) => c.leftGuildAt == null && c.lastActivityTurn == null);
  const sinceDayOne = characters.filter((c) => c.leftGuildAt == null && c.lastActivityTurn === 1);

  return { turn: turn?.number ?? null, leftGuild, neverActive, sinceDayOne };
}

// The three buckets flattened into rows, each carrying which bucket it came
// from — what a table wants, where the script wants them kept apart.
function inactiveRows(report) {
  return ["leftGuild", "neverActive", "sinceDayOne"].flatMap((bucket) =>
    report[bucket].map((c) => ({
      id: c.id,
      name: c.name,
      discordUserId: c.discordUserId,
      bucket,
      bucketLabel: BUCKET_LABEL[bucket],
      lastActivityTurn: c.lastActivityTurn,
      leftGuildAt: c.leftGuildAt ? c.leftGuildAt.toISOString().slice(0, 10) : null,
    })),
  );
}

module.exports = {
  inactiveCharacters,
  inactiveRows,
};
