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

// A Soilery Farm Move (web/app/(app)/character/actions/soilery.js): commits at press, resolves
// its wither die and Exhausted lockout at push (db/lib/moveEffects.js's `farmed` entry).
const AUTO_FARM = "auto:farm";

function isAutoFarm(gmNotes) {
  return typeof gmNotes === "string" && gmNotes.includes(AUTO_FARM);
}

// A break-in Gambit (db/lib/arelitz.js, web/app/(app)/character/actions/arelitz.js):
// the die and modifier are rolled at filing, same as a Heal Gambit, but resolves
// automatically at push (db/lib/moveEffects.js's `brokeIn` entry) rather than
// waiting on a GM — see ARELITZ.md §6 for why.
const AUTO_BREAK_ARELITZ = "auto:break_arelitz";

function isAutoBreakArelitz(gmNotes) {
  return typeof gmNotes === "string" && gmNotes.includes(AUTO_BREAK_ARELITZ);
}

// A lesson's learner-side Gambit (db/lib/lessons.js). A lesson is settled the moment it
// is accepted now, so its row arrives already PASSED and there is nothing to solve.
// The label still matters for the ones filed BEFORE that shipped: those sit OPEN with a
// die showing, look exactly like an ordinary Gambit awaiting judgement, and solving one
// DESTROYS it — the old turn-end pass read a SOLVED row as "a GM wrote the result, theirs
// stands" and returned without ever granting the skill.
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
  if (isAutoFarm(gmNotes)) return "Farming";
  if (isAutoBreakArelitz(gmNotes)) return "Breaking in an arelitz";
  return MOVE_KIND_LABELS[moveKind] ?? "Move";
}

export function rollLabel(a) {
  if (a.diceRoll == null) return "";
  const mod = a.diceModifier ?? 0;
  if (!mod) return `rolled ${a.diceRoll}`;
  return `rolled ${a.diceRoll} (${mod > 0 ? `+${mod}` : mod}) = ${a.diceRoll + mod}`;
}
