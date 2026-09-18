// The Oracle's run: six correspondents and an editor, once per turn. See docs/systemdocs/ORACLE.md.
// Called from db/lib/oracleCutoff.js at the Move cutoff, NOT from a TURN_PASSES entry and not from the turn's side-effect thunk.
// Never a pass: a pass runs inside resolveNeeds()'s serial loop, gates needsResolvedAt, and is awaited inline by the bot's cron, so one spending two minutes on an HTTP call holds the turn advance open and blows the 15s transaction timeout (TURN-ENGINE.md: passes return data and never make network calls).
// Not the thunk either (ran at turn close, three hours too late for gamemasters adjudicating between lock and push) — so skipIfComplete below asks the written rows instead of a thunk step() ledger.
//
// Two phases now (ORACLE.md §2). Phase one drafts everything already knowable
// five minutes before the cutoff. Phase two, at the cutoff itself, appends
// "Declared this turn" / "Needs a ruling" once the Moves are in, then runs the
// editor. Phase one is still all-seven-or-none (the reasons below haven't
// changed: the editor overwrites whatever it finds, and aggregatesSeenByZone
// claims once-a-turn lines in one pass across the whole set). Phase two
// carries neither hazard — its input is this turn's Moves, stamped per zone,
// claiming nothing across zones — so it resumes zone by zone: a run that
// finished phase one but not two picks up exactly where it stopped.

const { complete } = require("./oracleClient");
const { correspondentPrompt, editorPrompt, appendPrompt, splitEditorReply } = require("./oraclePrompts");
const {
  loadTurnMaterial,
  zoneBlock,
  threatsBlock,
  zoneDeclaredBlock,
  linkCharacterTokens,
  aggregatesSeenByZone,
} = require("./oracleInput");
const { TURN_CLOCK_SELECT } = require("./turnClock");
const { AGGREGATE } = require("./oracleAudit");

// Whether a run is even possible. Checked at RUN time rather than baked into the side-effect payload, so enabling the Oracle between the advance and the resume does the obvious thing.
function oracleReady(config) {
  return Boolean(config?.oracleEnabled && config?.oracleApiKey && config?.oracleModel);
}

// The zones a correspondent is written for: the seat zones, the same set listSelectableZones() offers a GM — the granularity GmZoneView filters at, so one page per seat zone is one page per thing a GM can be scoped to.
function seatZones(prisma) {
  return prisma.zone.findMany({
    where: { gmRoleId: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });
}

// The last N turns of pages for one scope, oldest first, as context. Reads `body`, the EDITED text when a GM has rewritten it — the entire correction mechanism, since there is no regenerate.
// Ceilings on length, not targets, sitting at roughly three times the prompts' ask so an ordinary page never comes near them. Deliberately generous: a cap too high costs nothing, a cap too low cuts a page off mid-sentence (the editor suffers most, since its THREADS block is at the END). A page hitting either is now an error, not a silent short page — treat one in the log as a prompt problem.
const CORRESPONDENT_MAX_TOKENS = 10000;
const EDITOR_MAX_TOKENS = 10000;
// Phase two only appends a short paragraph — "Declared this turn" plus
// "Needs a ruling" — over an input that is already small (this turn's Moves
// plus the page so far). A cap near the correspondent's would let a stalled
// model burn most of the five-minute lead for no reason; this one is sized to
// the prompt's own ask (see oraclePrompts.js#appendPrompt), same three-times
// margin as the phase-one caps above.
const APPEND_MAX_TOKENS = 600;

// `kind` defaults from `zoneId` for the two shapes that predate it (a real zone always has one, the front page never does) — only Threats, which also has no zoneId, needs to pass it explicitly.
function pageKind(zoneId, kind) {
  return kind ?? (zoneId ? "ZONE" : "FRONT");
}

async function memoryFor(prisma, { turnNumber, zoneId, kind, take }) {
  if (!take || take < 1) return [];
  const rows = await prisma.oracleSynopsis.findMany({
    where: { zoneId: zoneId ?? null, kind: pageKind(zoneId, kind), turn: { number: { lt: turnNumber } } },
    orderBy: { turn: { number: "desc" } },
    take,
    select: { body: true, turn: { select: { number: true } } },
  });
  return rows.reverse().map((row) => `[turn ${row.turn.number}]\n${row.body}`);
}

// The editor's parsed THREADS list from the most recent front page that has
// one — the structured half of the memory. Two turns back is still useful;
// older than `within` turns and a thread nobody has restated is treated as
// dead. Fed into every writer regardless of `oracleMemoryTurns`: the thread
// list is what lets a page say somebody has circled the gatehouse for three
// turns even when the page count that carries prose is turned down to 1 or 0.
async function threadsMemory(prisma, { turnNumber, within = 3 }) {
  const row = await prisma.oracleSynopsis.findFirst({
    where: { kind: "FRONT", threads: { not: null }, turn: { number: { lt: turnNumber, gte: turnNumber - within } } },
    orderBy: { turn: { number: "desc" } },
    select: { threads: true },
  });
  const rows = Array.isArray(row?.threads) ? row.threads : [];
  // Malformed entries (a bare string, a row missing `state`) are dropped
  // rather than thrown on — the model wrote the JSON, and a parse quirk in
  // one thread must not cost every writer their whole memory.
  return rows
    .filter((t) => t && typeof t.name === "string" && typeof t.state === "string")
    .slice(0, 5)
    .map((t) => `${t.name} | ${t.state}`);
}

// Find one page. NOT findUnique on turnId_zoneId, and the front page is why: Postgres treats NULLs as distinct in a unique index, so @@unique([turnId, zoneId]) never actually constrains the front page — a PARTIAL unique index in raw SQL (WHERE "zoneId" IS NULL) is the real guard, and Prisma refuses a null component in a compound unique WHERE outright. So that key addresses the six zone pages and never the seventh.
// findFirst here and find-then-write below handle null the way an ordinary filter does.
function findPage(prisma, turnId, zoneId, select, kind) {
  return prisma.oracleSynopsis.findFirst({
    where: { turnId, zoneId: zoneId ?? null, kind: pageKind(zoneId, kind) },
    select,
  });
}

// Write one page, phase-aware. Replaces rather than only creating: a resume
// reaching a zone whose step was recorded but whose row is missing should
// heal, and a "Run now" over an existing turn should replace its own draft.
// editedAt/editedBy are deliberately NOT cleared here — the caller refuses to
// overwrite a page a GM has rewritten.
//
// phase 1: stores the fresh draft as BOTH body and phaseOneBody, and clears
// phaseTwoAt — clearing it is what makes a re-run of phase one (Run now,
// Regenerate) redo phase two rather than trust a stale stamp.
// phase 2: appends to the stored phaseOneBody (falling back to body for a row
// written before two-phase existed) and stamps phaseTwoAt.
// The FRONT write (no `phase` passed) stamps phaseTwoAt too — the editor only
// ever runs once, after every zone+threats page already carries its own
// phaseTwoAt, so there is no separate "phase one" front page to distinguish it
// from.
async function writePage(prisma, { turnId, zoneId, kind, phase, body, threads, config, usage }) {
  const existing = await findPage(prisma, turnId, zoneId, { id: true, phaseOneBody: true, body: true }, kind);

  const data = {
    threads: threads ?? undefined,
    provider: config.oracleProvider,
    model: config.oracleModel,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  };

  if (phase === 1) {
    data.body = body;
    data.phaseOneBody = body;
    data.phaseTwoAt = null;
  } else if (phase === 2) {
    const base = existing?.phaseOneBody ?? existing?.body ?? "";
    data.body = `${base}\n\n${body}`;
    data.phaseTwoAt = new Date();
  } else {
    // The FRONT page. Written once, whole, by the editor.
    data.body = body;
    data.phaseTwoAt = new Date();
  }

  if (existing) return prisma.oracleSynopsis.update({ where: { id: existing.id }, data });
  return prisma.oracleSynopsis.create({
    data: { turnId, zoneId: zoneId ?? null, kind: pageKind(zoneId, kind), ...data },
  });
}

// A page a GM has rewritten is theirs. Neither a resume nor a Run now may silently replace it — the edit IS the correction.
async function isEdited(prisma, turnId, zoneId, kind) {
  const row = await findPage(prisma, turnId, zoneId, { editedAt: true }, kind);
  return Boolean(row?.editedAt);
}

// Is phase one whole — every seat zone plus the Threats row exists at all,
// regardless of whether phase two has appended anything? This is the resume
// ledger for phase one specifically: phase one stays all-or-none for the
// reasons isComplete below still gives, so a partial phase-one run is redone
// whole rather than patched zone by zone.
async function isPhaseOneComplete(prisma, turnId, zones) {
  const rows = await prisma.oracleSynopsis.findMany({
    where: { turnId, kind: { in: ["ZONE", "THREATS"] } },
    select: { zoneId: true, kind: true },
  });
  const writtenZoneIds = new Set(rows.filter((row) => row.kind === "ZONE").map((row) => row.zoneId));
  return rows.some((row) => row.kind === "THREATS") && zones.every((zone) => writtenZoneIds.has(zone.id));
}

// Every seat zone plus Threats carrying phaseTwoAt — phase two's own resume
// check, and the gate on whether the editor may run yet. A row existing is no
// longer proof a page is finished: phase one alone leaves a ZONE/THREATS row
// with phaseTwoAt still null, and running the editor over a set like that is
// the same "some of the document" hazard phase one's all-or-none guards.
async function isPhaseTwoAppended(prisma, turnId, zones) {
  const rows = await prisma.oracleSynopsis.findMany({
    where: { turnId, kind: { in: ["ZONE", "THREATS"] } },
    select: { zoneId: true, kind: true, phaseTwoAt: true },
  });
  const finishedZoneIds = new Set(
    rows.filter((row) => row.kind === "ZONE" && row.phaseTwoAt).map((row) => row.zoneId),
  );
  const threatsFinished = rows.some((row) => row.kind === "THREATS" && row.phaseTwoAt);
  return threatsFinished && zones.every((zone) => finishedZoneIds.has(zone.id));
}

// Is the whole set present AND finished — every seat zone plus Threats
// carrying phaseTwoAt, and a FRONT row on top?
// ALL SEVEN OR NONE for phase one, still, and the FRONT row on top of that:
// runEditor reads zone pages back from the database and writes the front page
// over whatever it finds, so a later-filled zone would leave the front page
// permanently summarising the set without it; and aggregatesSeen (an
// in-process Set keeping a once-per-turn line in one zone's input) would let a
// second pass report the same fact twice. Both bugs come from treating six
// zone pages as six independent jobs when they are one document.
async function isComplete(prisma, turnId, zones) {
  const rows = await prisma.oracleSynopsis.findMany({
    where: { turnId },
    select: { zoneId: true, kind: true, phaseTwoAt: true },
  });
  if (!rows.some((row) => row.kind === "FRONT")) return false;

  const finishedZoneIds = new Set(
    rows.filter((row) => row.kind === "ZONE" && row.phaseTwoAt).map((row) => row.zoneId),
  );
  const threatsFinished = rows.some((row) => row.kind === "THREATS" && row.phaseTwoAt);
  return threatsFinished && zones.every((zone) => finishedZoneIds.has(zone.id));
}

// One line per model call in the run log. The provider is staying slow
// (ORACLE.md §6), so the number is the diagnosis: build time is ours, request
// time is theirs. Tokens are whatever the provider reported — nano-gpt
// returns usage, some do not, and "?" is an honest answer.
function logCall(label, { buildMs, result }) {
  const io = `${result.inputTokens ?? "?"} in / ${result.outputTokens ?? "?"} out`;
  console.log(`Oracle ${label}: build ${buildMs}ms · request ${result.ms ?? "?"}ms · ${io}`);
}

// One zone's phase-one page. Returns nothing useful — the row is the output.
async function runCorrespondent(prisma, { turn, zone, material, config, aggregatesSeen, threads }) {
  if (await isEdited(prisma, turn.id, zone.id)) return;

  const buildStart = Date.now();
  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: zone.id,
    take: config.oracleMemoryTurns,
  });
  const block = zoneBlock(material, zone, { aggregatesSeen, memory, threads, phase: 1 });
  const buildMs = Date.now() - buildStart;

  const result = await complete(config, {
    system: correspondentPrompt(config),
    user: block.text,
    maxTokens: CORRESPONDENT_MAX_TOKENS,
  });
  logCall(zone.slug, { buildMs, result });

  await writePage(prisma, {
    turnId: turn.id,
    zoneId: zone.id,
    phase: 1,
    // {char:Ada Vance} -> {char:<id>|Ada Vance}; a name nobody answers to loses its braces rather than becoming a link to the wrong person.
    body: linkCharacterTokens(result.text, material.characters),
    config,
    usage: result,
  });
}

// The Threats page's phase one. Shaped exactly like a zone's, except no real
// Zone row, so `zoneId` stays null and `kind: "THREATS"` keeps it from
// colliding with the front page's own null-zoneId row.
// It never claims an AGGREGATE line for itself — passing every AGGREGATE type
// as already-seen means it only ever reports what a seat-holder specifically
// did, never a turn-wide fact a zone page already covers.
async function runThreatsCorrespondent(prisma, { turn, material, config, threads }) {
  if (await isEdited(prisma, turn.id, null, "THREATS")) return;

  const buildStart = Date.now();
  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: null,
    kind: "THREATS",
    take: config.oracleMemoryTurns,
  });
  const block = threatsBlock(material, { aggregatesSeen: new Set(AGGREGATE), memory, threads, phase: 1 });
  const buildMs = Date.now() - buildStart;

  const result = await complete(config, {
    system: correspondentPrompt(config),
    user: block.text,
    maxTokens: CORRESPONDENT_MAX_TOKENS,
  });
  logCall("threats", { buildMs, result });

  await writePage(prisma, {
    turnId: turn.id,
    zoneId: null,
    kind: "THREATS",
    phase: 1,
    body: linkCharacterTokens(result.text, material.characters),
    config,
    usage: result,
  });
}

// Phase one, whole: the six zone pages plus Threats, all at once, no editor.
// Called both from runOracle's own "one"/"both" branches and, self-healing,
// from the top of the "two" branch when a bot came back after missing the
// lead window entirely.
async function runPhaseOne(prisma, { turn, config, step, threadsCache }) {
  const material = await loadTurnMaterial(prisma, turn, { includeChat: config.oracleIncludeChat });
  const zones = await seatZones(prisma);
  const threads = threadsCache ?? (await threadsMemory(prisma, { turnNumber: turn.number }));

  // The six run AT ONCE: a page is one to five minutes of a small model writing at a few tokens a second, and six in a row would put the chronicle on the desk a quarter hour into its lead window. Together they cost about what the SLOWEST one costs (measured back to back: 818s sequential, 240s at once). The once-a-turn claim is settled up front (oracleInput.js#aggregatesSeenByZone) so each call gets its own Set, identical to the in-order input.
  // allSettled rather than all: every zone is attempted whatever its neighbours do (six calls are already in flight; there's nothing left to stop). Still TOLD about the error below.
  const seenByZone = aggregatesSeenByZone(material, zones);
  const settled = await Promise.allSettled([
    ...zones.map((zone) =>
      step(`oracle:${zone.slug}`, () =>
        runCorrespondent(prisma, {
          turn,
          zone,
          material,
          config,
          threads,
          aggregatesSeen: seenByZone.get(zone.id) ?? new Set(),
        }),
      ),
    ),
    step("oracle:threats", () => runThreatsCorrespondent(prisma, { turn, material, config, threads })),
  ]);
  const failed = settled.find((outcome) => outcome.status === "rejected");
  if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));

  return { zones };
}

// Phase two's short append to one zone page: reads back what phase one wrote,
// asks only about this turn's declared Moves, and appends. Resumable per
// zone — unlike phase one, nothing here is claimed across zones, so a run
// that appended to three zones and then died picks up at the fourth.
async function runZoneAppend(prisma, { turn, zone, material, config }) {
  if (await isEdited(prisma, turn.id, zone.id)) return;
  const existing = await findPage(prisma, turn.id, zone.id, { phaseOneBody: true, body: true, phaseTwoAt: true });
  if (!existing || existing.phaseTwoAt) return;

  const buildStart = Date.now();
  const block = zoneDeclaredBlock(material, zone, { pageSoFar: existing.phaseOneBody ?? existing.body });
  const buildMs = Date.now() - buildStart;

  const result = await complete(config, {
    system: appendPrompt(config),
    user: block.text,
    maxTokens: APPEND_MAX_TOKENS,
  });
  logCall(`${zone.slug}:declared`, { buildMs, result });

  await writePage(prisma, {
    turnId: turn.id,
    zoneId: zone.id,
    phase: 2,
    body: linkCharacterTokens(result.text, material.characters),
    config,
    usage: result,
  });
}

async function runThreatsAppend(prisma, { turn, material, config }) {
  if (await isEdited(prisma, turn.id, null, "THREATS")) return;
  const existing = await findPage(
    prisma,
    turn.id,
    null,
    { phaseOneBody: true, body: true, phaseTwoAt: true },
    "THREATS",
  );
  if (!existing || existing.phaseTwoAt) return;

  const buildStart = Date.now();
  const block = zoneDeclaredBlock(material, null, {
    pageSoFar: existing.phaseOneBody ?? existing.body,
    scope: "threats",
  });
  const buildMs = Date.now() - buildStart;

  const result = await complete(config, {
    system: appendPrompt(config),
    user: block.text,
    maxTokens: APPEND_MAX_TOKENS,
  });
  logCall("threats:declared", { buildMs, result });

  await writePage(prisma, {
    turnId: turn.id,
    zoneId: null,
    kind: "THREATS",
    phase: 2,
    body: linkCharacterTokens(result.text, material.characters),
    config,
    usage: result,
  });
}

// The front page. Reads the six zone pages back OUT OF THE DATABASE rather than taking them from the correspondents' return values, so a resume whose zone steps ran in a previous process still has something to edit.
async function runEditor(prisma, { turn, config, characters }) {
  if (await isEdited(prisma, turn.id, null)) return;

  // Every real zone plus the Threats page — everything NOT the front page itself. The Threats row has no `zone` relation, so its header falls back to its own kind rather than "Elsewhere", reserved for a row this file hasn't been taught about.
  const pages = await prisma.oracleSynopsis.findMany({
    where: { turnId: turn.id, kind: { not: "FRONT" } },
    select: { body: true, kind: true, zone: { select: { name: true } } },
  });
  if (pages.length === 0) return;

  const buildStart = Date.now();
  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: null,
    take: config.oracleMemoryTurns,
  });
  const threads = await threadsMemory(prisma, { turnNumber: turn.number });

  const user = [
    threads.length ? `OPEN THREADS — carried from the front page\n${threads.join("\n")}` : null,
    memory.length ? `PREVIOUS FRONT PAGES\n${memory.join("\n\n")}` : null,
    `THIS TURN (${turn.number})`,
    ...pages.map((page) => `## ${page.zone?.name ?? (page.kind === "THREATS" ? "Threats" : "Elsewhere")}\n${page.body}`),
  ]
    .filter(Boolean)
    .join("\n\n");
  const buildMs = Date.now() - buildStart;

  const result = await complete(config, {
    system: editorPrompt(config),
    user,
    maxTokens: EDITOR_MAX_TOKENS,
  });
  logCall("editor", { buildMs, result });

  const { body, threads: newThreads } = splitEditorReply(result.text);
  await writePage(prisma, {
    turnId: turn.id,
    zoneId: null,
    body: linkCharacterTokens(body, characters),
    threads: newThreads,
    config,
    usage: result,
  });
}

// Phase two, whole: the short append to every zone + Threats page that isn't
// done yet, then the editor — only once every one of them carries
// phaseTwoAt. Self-healing at the top: if phase one never finished (the bot
// was down through its whole five-minute lead window), phase two runs phase
// one first, in full, before attempting its own work.
async function runPhaseTwo(prisma, { turn, config, step }) {
  const zones = await seatZones(prisma);

  if (!(await isPhaseOneComplete(prisma, turn.id, zones))) {
    await runPhaseOne(prisma, { turn, config, step });
  }

  // Reloaded, not reused from phase one: the whole point of phase two is the
  // Moves filed in the last five minutes, which a phase-one material load run
  // earlier in this same call would not contain yet.
  const material = await loadTurnMaterial(prisma, turn, { includeChat: config.oracleIncludeChat });

  const settled = await Promise.allSettled([
    ...zones.map((zone) =>
      step(`oracle:${zone.slug}:declared`, () => runZoneAppend(prisma, { turn, zone, material, config })),
    ),
    step("oracle:threats:declared", () => runThreatsAppend(prisma, { turn, material, config })),
  ]);
  const failed = settled.find((outcome) => outcome.status === "rejected");
  if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));

  // Only once every zone + Threats page carries phaseTwoAt does the editor
  // read anything worth reading — a page still missing its append is not
  // wrong to include, but running the editor before every page is finished is
  // the same "some of the document" hazard phase one's all-or-none guards.
  if (await isPhaseTwoAppended(prisma, turn.id, zones)) {
    await step("oracle:editor", () => runEditor(prisma, { turn, config, characters: material.characters }));
  }

  return { zones };
}

// The whole run. `step` is turnSideEffects.js's — one key per zone plus one for the editor, so a crash re-runs only what never finished. Called without a ledger (the panel's Run now), pass a step that just calls through.
// Every failure path here is a return, never a throw: step() already swallows, but a turn must not depend on that for its correctness.
// `phases`: "one" (the lead-window draft), "two" (the cutoff append + editor,
// self-healing into phase one first if needed), or "both" (Run now,
// Regenerate — a full redraft top to bottom).
async function runOracle(prisma, { turnId, step, skipIfComplete = false, phases = "both" }) {
  const config = await prisma.gameConfig.findFirst();
  if (!oracleReady(config)) return { ran: false, reason: "The Oracle is off or unconfigured." };

  const turn = await prisma.turn.findUnique({
    where: { id: turnId },
    // TURN_CLOCK_SELECT, because oracleInput.js#turnWindow asks this row for its Move cutoff. Selecting `startedAt` alone
    // still returns an ANSWER — turnClock.js falls back to deriving one — it is just silently the 24-hour answer.
    select: { id: true, number: true, ...TURN_CLOCK_SELECT },
  });
  if (!turn) return { ran: false, reason: "No such turn." };

  const zones = await seatZones(prisma);
  if (zones.length === 0) return { ran: false, reason: "No seat zones." };

  // Nothing left to write? Say so before loading anything: the cutoff check runs once a minute for the whole three-hour window, and the material load is half a dozen queries over the whole transcript — too much to spend on discovering there is no work.
  if (skipIfComplete) {
    if (phases === "one" && (await isPhaseOneComplete(prisma, turn.id, zones))) {
      return { ran: false, phase: 1, reason: "Phase one is already written." };
    }
    if (phases !== "one" && (await isComplete(prisma, turn.id, zones))) {
      return { ran: false, phase: 2, reason: "Every page for this turn is already written." };
    }
  }

  try {
    if (phases === "one") {
      await runPhaseOne(prisma, { turn, config, step });
      return { ran: true, phase: 1, zones: zones.length };
    }

    if (phases === "two") {
      await runPhaseTwo(prisma, { turn, config, step });
      return { ran: true, phase: 2, zones: zones.length };
    }

    // "both": Run now / Regenerate — a full redraft top to bottom. Redoing
    // phase one clears every page's phaseTwoAt (writePage, phase 1), which is
    // what makes running "both" twice in a row idempotent instead of
    // appending the declared-Moves paragraph twice.
    await runPhaseOne(prisma, { turn, config, step });
    await runPhaseTwo(prisma, { turn, config, step });
    return { ran: true, phase: 2, zones: zones.length };
  } catch (err) {
    return { ran: false, reason: err?.message ?? String(err) };
  }
}

module.exports = {
  runOracle,
  memoryFor,
  threadsMemory,
  isComplete,
  isPhaseOneComplete,
};
