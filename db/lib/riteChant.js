// The chant hook: every line a character says passes through
// db/lib/say.js#recordSpeech, which hands the written row to noteChant() here
// (docs/systemdocs/THANATI.md §4). There is no Rite button — this is how a
// rite begins, and the sweep (db/lib/riteSweep.js) is how it ends.
//
// A chant COUNTS when: said in a Room's thread or a linked Conversation; the
// line contains a Word of the Circle; the speaker wears robes and holds Dark
// Inspiration. It then joins (or opens) the room's RiteAttempt for that rite,
// re-judged: enough distinct chanters + every ingredient present
// (db/lib/riteIngredients.js) → READY, the two-minute clock starts.
//
// Same hook also carries a rite's ANSWER: Rite of Panic fires then waits for
// a participant to name a zone in the same room (riteEffects.js).
//
// Best-effort, must NEVER slow or fail the message it rides on: the caller
// fires it without awaiting and every path here is caught. Takes `db` as a
// parameter (db/lib/dm.js convention).
const { WINDOW_MS, GRACE_MS, riteByKey, matchRites } = require("./rites");
const { ensureRiteWords } = require("./riteWords");
const { chanterReady } = require("./thanati");
const { resolveIngredients } = require("./riteIngredients");
const { roomLine, answerPanic } = require("./riteEffects");

// Posted once per attempt, the moment the last requirement lands.
const TENSE_LINE = "You feel tense... Anyone else who wants to participate should join in now.";

const ROOM_SELECT = {
  id: true,
  name: true,
  kind: true,
  locationId: true,
  accessTagSlugs: true,
  discordThreadId: true,
  location: { select: { id: true, name: true, slug: true, zoneId: true, discordChannelId: true } },
};

// room:<id> directly; conv:<id> through the Conversation's linked room. Null
// for a Location channel, a zone, a DM, or a Conversation nobody linked.
async function roomIdForPlaceKey(db, placeKey) {
  if (!placeKey) return null;
  if (placeKey.startsWith("room:")) return placeKey.slice("room:".length) || null;
  if (placeKey.startsWith("conv:")) {
    const thread = await db.playerThread.findUnique({
      where: { id: placeKey.slice("conv:".length) },
      select: { roomId: true },
    });
    return thread?.roomId ?? null;
  }
  return null;
}

async function distinctChanters(db, attemptId) {
  const rows = await db.riteChant.findMany({
    where: { attemptId },
    select: { characterId: true, characterName: true },
  });
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.characterId)) seen.set(r.characterId, r.characterName);
  return [...seen].map(([characterId, name]) => ({ characterId, name }));
}

// Idempotent: READY write is guarded on readyAt still being null.
async function evaluateAttempt(db, attempt, room = null) {
  const rite = riteByKey(attempt.riteKey);
  if (!rite || attempt.status !== "OPEN") return false;
  const chanters = await distinctChanters(db, attempt.id);
  if (chanters.length < rite.minChanters) return false;
  const where = room ?? (await db.room.findUnique({ where: { id: attempt.roomId }, select: ROOM_SELECT }));
  if (!where) return false;
  const { ok } = await resolveIngredients(db, rite, where, { participants: chanters });
  if (!ok) return false;

  const now = new Date();
  const { count } = await db.riteAttempt.updateMany({
    where: { id: attempt.id, status: "OPEN", readyAt: null },
    data: { status: "READY", readyAt: now, firesAt: new Date(now.getTime() + GRACE_MS) },
  });
  if (count === 0) return false;
  await roomLine(db, where, TENSE_LINE);
  return true;
}

// READY counts as live so a late chanter inside the grace window still counts.
async function attemptFor(db, rite, room) {
  const since = new Date(Date.now() - WINDOW_MS);
  const live = await db.riteAttempt.findFirst({
    where: { riteKey: rite.key, roomId: room.id, status: { in: ["OPEN", "READY"] }, openedAt: { gte: since } },
    orderBy: { openedAt: "desc" },
  });
  if (live) return live;
  const created = await db.riteAttempt.create({ data: { riteKey: rite.key, roomId: room.id, roomName: room.name } });
  // Two chanters in the same second can both miss the read above and both
  // create; no unique index refuses the second, so the loser folds into the
  // oldest live attempt. `id` breaks an openedAt tie (same-tick rows compare
  // equal, so without it neither deletes and both stay half-counted).
  const oldest = await db.riteAttempt.findFirst({
    where: { riteKey: rite.key, roomId: room.id, status: { in: ["OPEN", "READY"] }, openedAt: { gte: since } },
    orderBy: [{ openedAt: "asc" }, { id: "asc" }],
  });
  if (oldest && oldest.id !== created.id) {
    await db.riteAttempt.delete({ where: { id: created.id } }).catch(() => {});
    return oldest;
  }
  return created;
}

// A rite waiting on a word from one of its own: the first participant's line
// that names a place answers it.
async function answerAwaiting(db, { roomId, character, content }) {
  const waiting = await db.riteAttempt.findMany({
    where: { roomId, status: "AWAITING" },
    orderBy: { firedAt: "asc" },
  });
  for (const attempt of waiting) {
    const participants = Array.isArray(attempt.participants) ? attempt.participants : [];
    if (!participants.some((p) => p.characterId === character.id)) continue;
    const answered = await answerPanic(db, { attempt, content });
    if (answered) return true;
  }
  return false;
}

async function noteChantImpl(db, { row, character }) {
  if (!row?.content || !character?.id) return;
  const roomId = await roomIdForPlaceKey(db, row.placeKey);
  if (!roomId) return;

  // A rite already fired may be listening for its answer.
  if (await answerAwaiting(db, { roomId, character, content: row.content })) return;

  const words = await ensureRiteWords(db);
  const keys = matchRites(row.content, words);
  if (keys.length === 0) return;

  if (!(await chanterReady(db, character.id))) return;

  const room = await db.room.findUnique({ where: { id: roomId }, select: ROOM_SELECT });
  if (!room) return;

  for (const key of keys) {
    const rite = riteByKey(key);
    if (!rite) continue;
    const attempt = await attemptFor(db, rite, room);
    await db.riteChant.create({
      data: {
        attemptId: attempt.id,
        characterId: character.id,
        characterName: character.name ?? "",
        archiveSeq: row.seq ?? null,
      },
    });
    await evaluateAttempt(db, attempt, room);
  }
}

// Fire-and-forget. Returns a promise the caller may ignore.
function noteChant(db, args) {
  return noteChantImpl(db, args).catch((err) => console.error("Rite chant hook failed:", err.message ?? err));
}

module.exports = {
  noteChant,
  evaluateAttempt,
  distinctChanters,
  ROOM_SELECT,
};
