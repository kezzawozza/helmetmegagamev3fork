// The list of OOC mute durations OocDesk shows and its server action uses.
//
// LEAF FILE, ZERO REQUIRES: the desk's OocDesk.js is "use client", so any
// require() at the top of a module it reaches drags that module's whole
// transitive dependency graph into the browser bundle — and via
// db/lib/ooc.js → scene.js → archive.js that includes @prisma/client, which
// fails to bundle for the browser and crashes the whole Workspace chunk on
// hydration. The full-shape module (db/lib/ooc.js) re-exports these two, so
// server-side callers keep working.

const MUTE_DURATIONS = [
  { minutes: 5, label: "5 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 180, label: "3 hours" },
  { minutes: 1440, label: "1 day" },
];

function muteDurationLabel(minutes) {
  return MUTE_DURATIONS.find((d) => d.minutes === Number(minutes))?.label ?? null;
}

module.exports = { MUTE_DURATIONS, muteDurationLabel };
