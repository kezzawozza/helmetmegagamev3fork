// The per-minute halves of the clock that used to be a single midnight cron: when the open turn is due to end, and when a
// scheduled session is due to open or close.
//
// The cron string went away because it could not be one string any more. A turn is 6, 8, 12 or 24 hours
// (GameConfig.turnLengthHours), a GM may change that mid-game, and a session can start at any minute a GM scheduled — none
// of which a fixed `0 0 * * *` can express. Polling instead also means a missed tick heals in a minute rather than at the
// next midnight, which is what used to make a bot restart at 00:01 cost a whole day.
//
// Both functions are cheap when idle: one indexed read each, and they answer `false`/`null` without writing.

const { prisma } = require("@lifeweb/db");
const { advanceDue, TURN_CLOCK_SELECT } = require("@lifeweb/db/lib/turnClock");
const { clockStatus } = require("@lifeweb/db/lib/gameState");
const { sessionDue, openSession, closeSession, sessionSnapshot } = require("@lifeweb/db/lib/session");
const { advanceTurn } = require("./turnEngine");
const { speakIntoTurns } = require("@lifeweb/db/lib/sessionNotice");

// Has the open turn run past its own end? A frozen clock is never due — out of session, paused, or not RUNNING, there is no
// deadline to be past (db/lib/gameState.js#isClockRunning).
async function turnIsDue(now = new Date()) {
  const [turn, clock] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true, ...TURN_CLOCK_SELECT } }),
    clockStatus(prisma),
  ]);
  if (!turn || clock.frozen) return false;
  return advanceDue(turn, { now });
}

async function tickTurnClock(now = new Date()) {
  if (!(await turnIsDue(now))) return null;
  return advanceTurn();
}

// Open or close a scheduled session. A GM's Start now / Close now buttons call the same two db/lib/session.js functions, so
// there is one way a session changes state and one line announcing it.
async function tickSessionClock(now = new Date()) {
  const { config, state } = await sessionSnapshot(prisma);
  const due = sessionDue(config, state, now);
  if (!due) return null;

  const result = due === "OPEN" ? await openSession(prisma, { now }) : await closeSession(prisma, { now });
  if (!result.ok) return null;

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: "system",
        actionType: due === "OPEN" ? "session_opened" : "session_closed",
        details: { scheduled: true },
      },
    })
    .catch((err) => console.error("Failed to log the session change:", err));

  // Discord last, and never inside the write: the row is the truth, the line is a courtesy.
  await speakIntoTurns(prisma, result.line).catch((err) => console.error("Failed to announce the session change:", err));
  return due;
}

module.exports = { turnIsDue, tickTurnClock, tickSessionClock };
