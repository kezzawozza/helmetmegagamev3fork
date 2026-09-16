// The Move enums as prose. No Prisma import: RecordTab is a client component.
export const MOVE_PIPELINE_LABELS = {
  PENDING_TYPE: "Setting up Move",
  // Legacy value, never written; kept for old rows. See ActionStatus.PENDING_OPPOSED.
  PENDING_OPPOSED: "Pending confirm",
  PENDING: "Pending confirm",
};

export const MOVE_REVIEW_LABELS = {
  OPEN: "Open",
  PASSED: "Passed",
  // Legacy value, never written; kept for old rows. See MoveReviewStatus.WAITING_FOR_OPPONENTS.
  WAITING_FOR_OPPONENTS: "Waiting for Opponents",
  IN_PROGRESS: "In Progress",
  SOLVED: "Solved",
};

const MOVE_KIND_LABELS = {
  ROUTINE: "Routine",
  GAMBIT: "Gambit",
  LABOR: "Labor",
};

const AUTO_LABOR = "auto:labor";

function isAutoLabor(gmNotes) {
  return typeof gmNotes === "string" && gmNotes.includes(AUTO_LABOR);
}

// A gmNotes marker a GM never types themselves (db/lib/locationTravel.js).
const AUTO_ZONE_CHANGE = "auto:zone_change";

// A lesson's learner-side Gambit (db/lib/lessons.js). It reaches the desk OPEN with its
// die already rolled, which makes it look exactly like an ordinary Gambit waiting to be
// judged — and it is the one row a GM must NOT Solve: db/lib/lessonPass.js treats a
// SOLVED row as "a GM wrote the result, theirs stands", returns without granting, and the
// learner silently never gets the skill. Labelling it is the cheap half of the fix; the
// real one is to stop filing it OPEN at all.
const AUTO_LESSON = "auto:lesson";

function isAutoLesson(gmNotes) {
  return typeof gmNotes === "string" && gmNotes.includes(AUTO_LESSON);
}

// gmNotes can carry more than one marker, so check for the substring, not equality.
export function isTravelMove(gmNotes) {
  return typeof gmNotes === "string" && gmNotes.includes(AUTO_ZONE_CHANGE);
}

export const MOVE_REVIEW_TONES = {
  Open: "neutral",
  Passed: "muted",
  "Waiting for Opponents": "warn",
  "In Progress": "warn",
  Solved: "good",
};

export function moveKindLabel(moveKind, gmNotes) {
  if (isTravelMove(gmNotes)) return "Travel";
  if (isAutoLabor(gmNotes)) return "Labor (auto)";
  if (isAutoLesson(gmNotes)) return "Lesson (auto)";
  return MOVE_KIND_LABELS[moveKind] ?? "Move";
}

export function rollLabel(a) {
  if (a.diceRoll == null) return "";
  const mod = a.diceModifier ?? 0;
  if (!mod) return `rolled ${a.diceRoll}`;
  return `rolled ${a.diceRoll} (${mod > 0 ? `+${mod}` : mod}) = ${a.diceRoll + mod}`;
}
