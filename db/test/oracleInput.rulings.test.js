// The Oracle's Rulings block and two-tense bucketing. See
// docs/systemdocs/ORACLE.md §3 and db/lib/oracleInput.js.

const test = require("node:test");
const assert = require("node:assert");

const { zoneBlock, threatsBlock, zoneDeclaredBlock } = require("../lib/oracleInput");

function baseMaterial(overrides = {}) {
  return {
    turnId: "turn-12",
    turnNumber: 12,
    turnNumberById: new Map([
      ["turn-11", 11],
      ["turn-12", 12],
    ]),
    characters: [],
    actions: [],
    auditRows: [],
    beats: [],
    chat: [],
    stagedMessages: [],
    stagedEffects: [],
    seatByZoneId: new Map(),
    names: { byCharacterId: new Map(), byDiscordUserId: new Map() },
    threatMembers: new Map(),
    objectivesByParty: new Map(),
    spawns: [],
    rites: [],
    ...overrides,
  };
}

const ZONE = { id: "zone-1", name: "Fortress" };

function action(overrides) {
  return {
    id: "a1",
    characterId: "c1",
    zoneId: ZONE.id,
    turnId: "turn-11",
    createdAt: "2026-09-10T00:03:00Z",
    description: "Did a thing.",
    moveKind: "ROUTINE",
    moveReviewStatus: "SOLVED",
    diceRoll: null,
    diceModifier: null,
    resourceDelta: null,
    resultMessage: null,
    reviewedAt: null,
    location: null,
    ...overrides,
  };
}

function names() {
  return { byCharacterId: new Map([["c1", "Ada Vance"]]), byDiscordUserId: new Map() };
}

// 1 — a SOLVED action with a resultMessage appears under Rulings, once.

test("a SOLVED action with a resultMessage appears once under Rulings on resolved Moves", () => {
  const material = baseMaterial({
    names: names(),
    actions: [action({ resultMessage: "It worked.", reviewedAt: "2026-09-10T21:40:00Z" })],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.match(text, /Rulings on resolved Moves\n.*\n  ruling: It worked\./s);
  const occurrences = text.split("ruling: It worked.").length - 1;
  assert.equal(occurrences, 1);
});

// 2 — a SOLVED action with an empty resultMessage stays in the resolved
// bucket and is absent from Rulings.

test("a SOLVED action with an empty resultMessage is not in Rulings but is in the resolved bucket", () => {
  const material = baseMaterial({
    names: names(),
    actions: [action({ resultMessage: "   " })],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.doesNotMatch(text, /RULINGS — GROUND TRUTH/);
  assert.match(text, /RESOLVED SINCE LAST PAGE \(turn 11\) — these happened/);
});

// 3 — bucketing by turnId, not moveReviewStatus.

test("an action stamped the current turn lands under DECLARED, not RESOLVED", () => {
  const material = baseMaterial({
    names: names(),
    actions: [action({ turnId: "turn-12", moveReviewStatus: "OPEN" })],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.match(text, /DECLARED THIS TURN \(turn 12\) — intentions, not yet resolved/);
  assert.doesNotMatch(text, /RESOLVED SINCE LAST PAGE/);
});

test("an action stamped the previous turn lands under RESOLVED, not DECLARED", () => {
  const material = baseMaterial({
    names: names(),
    actions: [action({ turnId: "turn-11" })],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.match(text, /RESOLVED SINCE LAST PAGE \(turn 11\) — these happened/);
  assert.doesNotMatch(text, /DECLARED THIS TURN/);
});

// 4 — section ordering.

test("Rulings ranks above RESOLVED SINCE LAST PAGE, which ranks above EVENTS", () => {
  const material = baseMaterial({
    names: names(),
    actions: [action({ resultMessage: "Ruled.", reviewedAt: "2026-09-10T21:40:00Z" })],
    auditRows: [{ actionType: "request_heal_character", actorDiscordUserId: "u1", details: {} }],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  const rulingsIdx = text.indexOf("RULINGS — GROUND TRUTH");
  const resolvedIdx = text.indexOf("RESOLVED SINCE LAST PAGE");
  const eventsIdx = text.indexOf("EVENTS");
  assert.ok(rulingsIdx >= 0 && resolvedIdx >= 0, "both sections must be present");
  assert.ok(rulingsIdx < resolvedIdx, "Rulings must come before Resolved");
  if (eventsIdx >= 0) assert.ok(resolvedIdx < eventsIdx, "Resolved must come before Events");
});

// 5 — every move line carries a stamp.

test("every move line carries a [turn N · HH:MM] stamp", () => {
  const material = baseMaterial({
    names: names(),
    actions: [action({ turnId: "turn-11", createdAt: "2026-09-10T02:30:00Z" })],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.match(text, /\[turn 11 · \d{2}:\d{2}\]/);
});

// 6 — the header line names the right turn numbers.

test("the header line names the current and previous turn numbers", () => {
  const material = baseMaterial({ names: names() });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.match(text, /It is the lock of turn 12\./);
  assert.match(text, /turn 12's Moves have been declared/i);
});

// 7 — phase gates DECLARED THIS TURN.

test("phase 1 omits DECLARED THIS TURN; phase 2 includes it", () => {
  const material = baseMaterial({
    names: names(),
    actions: [action({ turnId: "turn-12", moveReviewStatus: "OPEN" })],
  });
  const phaseOne = zoneBlock(material, ZONE, { aggregatesSeen: new Set(), phase: 1 });
  const phaseTwo = zoneBlock(material, ZONE, { aggregatesSeen: new Set(), phase: 2 });
  assert.doesNotMatch(phaseOne.text, /DECLARED THIS TURN/);
  assert.match(phaseTwo.text, /DECLARED THIS TURN/);
});

// 8 — memory renders under the renamed heading.

test("memory renders under PREVIOUS PAGES — already reported, do not restate as new", () => {
  const material = baseMaterial({ names: names() });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set(), memory: ["[turn 11]\nSomething happened."] });
  assert.match(text, /PREVIOUS PAGES — already reported, do not restate as new\n\[turn 11\]/);
});

// OPEN THREADS, ahead of shard D's real data — the option must exist and be
// honoured now.

test("threads render under OPEN THREADS, just before PREVIOUS PAGES", () => {
  const material = baseMaterial({ names: names() });
  const { text } = zoneBlock(material, ZONE, {
    aggregatesSeen: new Set(),
    threads: ["gatehouse watch | Three characters have circled it for two turns."],
    memory: ["[turn 11]\nSomething happened."],
  });
  assert.match(text, /OPEN THREADS — carried from the front page\ngatehouse watch/);
  assert.ok(text.indexOf("OPEN THREADS") < text.indexOf("PREVIOUS PAGES"));
});

test("an empty threads array renders no OPEN THREADS section", () => {
  const material = baseMaterial({ names: names() });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set(), threads: [] });
  assert.doesNotMatch(text, /OPEN THREADS/);
});

// STAGED EFFECTS keeps only the mechanical half; staged messages moved to
// Rulings entirely.

test("a staged effect renders under the renamed STAGED EFFECTS header", () => {
  const material = baseMaterial({
    names: names(),
    stagedEffects: [
      { targetCharacterId: "c1", appliedEffect: { resources: 5 }, targetCharacter: { zoneId: ZONE.id, name: "Ada Vance" } },
    ],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.match(text, /STAGED EFFECTS\nAda Vance: \+5 ⬢/);
});

test("a staged message renders under RULINGS, not under a STAGED heading", () => {
  const material = baseMaterial({
    names: names(),
    stagedMessages: [{ kind: "PUBLIC", content: "The gate held.", zoneId: ZONE.id, sentAt: "2026-09-10T00:03:00Z", turnId: "turn-11", recipients: [] }],
  });
  const { text } = zoneBlock(material, ZONE, { aggregatesSeen: new Set() });
  assert.match(text, /Told to the players\n- \[turn 11 · 19:03\] PUBLIC · Fortress — The gate held\./);
  assert.doesNotMatch(text, /^STAGED\n/m);
});

// The Threats page carries the same two sections.

test("threatsBlock also buckets by tense and ranks Rulings first", () => {
  const material = baseMaterial({
    names: { byCharacterId: new Map([["c1", "Maeris"]]), byDiscordUserId: new Map() },
    characters: [{ id: "c1", name: "Maeris", location: { name: "Fortress" }, tags: [] }],
    threatMembers: new Map([["demoness", [{ id: "c1", name: "Maeris", seat: "Demoness" }]]]),
    actions: [
      action({ characterId: "c1", turnId: "turn-12", moveReviewStatus: "OPEN" }),
      action({ characterId: "c1", turnId: "turn-11", resultMessage: "Ruled.", reviewedAt: "2026-09-10T21:40:00Z" }),
    ],
  });
  const { text } = threatsBlock(material, { aggregatesSeen: new Set() });
  assert.match(text, /DECLARED THIS TURN \(turn 12\)/);
  assert.match(text, /RESOLVED SINCE LAST PAGE \(turn 11\)/);
  assert.ok(text.indexOf("RULINGS — GROUND TRUTH") < text.indexOf("RESOLVED SINCE LAST PAGE"));
});

// zoneDeclaredBlock — phase two's whole input.

test("zoneDeclaredBlock renders the phase-two header, the page so far, and only this turn's Moves", () => {
  const material = baseMaterial({
    names: names(),
    actions: [
      action({ turnId: "turn-12", moveReviewStatus: "OPEN", description: "Marches on the gate." }),
      action({ turnId: "turn-11" }), // resolved, must not appear
    ],
  });
  const { text } = zoneDeclaredBlock(material, ZONE, { pageSoFar: "Yesterday was quiet." });
  assert.match(text, /^It is the lock of turn 12\. The Moves below have been DECLARED and not resolved\./);
  assert.match(text, /THE PAGE SO FAR\nYesterday was quiet\./);
  assert.match(text, /DECLARED THIS TURN \(turn 12\) — intentions, not yet resolved/);
  assert.match(text, /Marches on the gate\./);
  const resolvedMentions = (text.match(/RESOLVED SINCE LAST PAGE/g) ?? []).length;
  assert.equal(resolvedMentions, 0);
  // Only one Move line (the declared one) should appear as a stamped line.
  assert.equal((text.match(/\[turn 12 ·/g) ?? []).length, 1);
});

test("zoneDeclaredBlock has no roster, chat, rulings or memory sections", () => {
  const material = baseMaterial({
    names: names(),
    characters: [{ id: "c1", name: "Ada Vance", zoneId: ZONE.id, tags: [] }],
  });
  const { text } = zoneDeclaredBlock(material, ZONE, { pageSoFar: "Prose." });
  assert.doesNotMatch(text, /PRESENT/);
  assert.doesNotMatch(text, /CHAT/);
  assert.doesNotMatch(text, /RULINGS/);
  assert.doesNotMatch(text, /PREVIOUS PAGES/);
});

test("zoneDeclaredBlock's threats scope only includes seat-holders' declared Moves", () => {
  const material = baseMaterial({
    names: { byCharacterId: new Map([["c1", "Maeris"], ["c2", "Ada Vance"]]), byDiscordUserId: new Map() },
    threatMembers: new Map([["demoness", [{ id: "c1", name: "Maeris", seat: "Demoness" }]]]),
    actions: [
      action({ characterId: "c1", turnId: "turn-12", description: "Seduces the Baron." }),
      action({ characterId: "c2", turnId: "turn-12", description: "Tends the shop." }),
    ],
  });
  const { text } = zoneDeclaredBlock(material, null, { pageSoFar: "", scope: "threats" });
  assert.match(text, /Seduces the Baron\./);
  assert.doesNotMatch(text, /Tends the shop\./);
});
