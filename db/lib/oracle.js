// The Oracle's run: six correspondents and an editor, once per turn. See docs/systemdocs/ORACLE.md.
// Called from db/lib/oracleCutoff.js at the Move cutoff, NOT from a TURN_PASSES entry and not from the turn's side-effect thunk.
// Never a pass: a pass runs inside resolveNeeds()'s serial loop, gates needsResolvedAt, and is awaited inline by the bot's cron, so one spending two minutes on an HTTP call holds the turn advance open and blows the 15s transaction timeout (TURN-ENGINE.md: passes return data and never make network calls).
// Not the thunk either (ran at turn close, three hours too late for gamemasters adjudicating between lock and push) — so skipIfComplete below asks the written rows instead of a thunk step() ledger.

const { complete } = require("./oracleClient");
const { correspondentPrompt, editorPrompt, splitEditorReply } = require("./oraclePrompts");
const { loadTurnMaterial, zoneBlock, threatsBlock, linkCharacterTokens, aggregatesSeenByZone } = require("./oracleInput");
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
const CORRESPONDENT_MAX_TOKENS = 200000;
const EDITOR_MAX_TOKENS = 200000;

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

// Find one page. NOT findUnique on turnId_zoneId, and the front page is why: Postgres treats NULLs as distinct in a unique index, so @@unique([turnId, zoneId]) never actually constrains the front page — a PARTIAL unique index in raw SQL (WHERE "zoneId" IS NULL) is the real guard, and Prisma refuses a null component in a compound unique WHERE outright. So that key addresses the six zone pages and never the seventh.
// findFirst here and find-then-write below handle null the way an ordinary filter does.
function findPage(prisma, turnId, zoneId, select, kind) {
  return prisma.oracleSynopsis.findFirst({
    where: { turnId, zoneId: zoneId ?? null, kind: pageKind(zoneId, kind) },
    select,
  });
}

// Write one page. Replaces rather than only creating: a resume reaching a zone whose step was recorded but whose row is missing should heal, and a "Run now" over an existing turn should replace its own draft.
// editedAt/editedBy are deliberately NOT cleared here — the caller refuses to overwrite a page a GM has rewritten.
async function writePage(prisma, { turnId, zoneId, kind, body, threads, config, usage }) {
  const data = {
    body,
    threads: threads ?? undefined,
    provider: config.oracleProvider,
    model: config.oracleModel,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  };
  const existing = await findPage(prisma, turnId, zoneId, { id: true }, kind);
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

// Is the whole set present — every seat zone plus the front page? The resume ledger for the cutoff run: firing on the Move cutoff means there's no turn thunk to borrow a step() ledger from, so the written rows are the ledger.
// ALL SEVEN OR NONE, deliberately: runEditor reads zone pages back from the database and writes the front page over whatever it finds, so a later-filled zone would leave the front page permanently summarising the set without it; and aggregatesSeen (an in-process Set keeping a once-per-turn line in one zone's input) would let a second pass report the same fact twice. Both bugs come from treating six zone pages as six independent jobs when they are one document.
async function isComplete(prisma, turnId, zones) {
  const rows = await prisma.oracleSynopsis.findMany({
    where: { turnId },
    select: { zoneId: true, kind: true },
  });
  const writtenZoneIds = new Set(rows.filter((row) => row.kind === "ZONE").map((row) => row.zoneId));
  const kinds = new Set(rows.map((row) => row.kind));
  return kinds.has("FRONT") && kinds.has("THREATS") && zones.every((zone) => writtenZoneIds.has(zone.id));
}

// One zone's page. Returns nothing useful — the row is the output.
async function runCorrespondent(prisma, { turn, zone, material, config, aggregatesSeen }) {
  if (await isEdited(prisma, turn.id, zone.id)) return;

  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: zone.id,
    take: config.oracleMemoryTurns,
  });
  const block = zoneBlock(material, zone, { aggregatesSeen, memory });

  const result = await complete(config, {
    system: correspondentPrompt(config),
    user: block.text,
    maxTokens: CORRESPONDENT_MAX_TOKENS,
  });

  await writePage(prisma, {
    turnId: turn.id,
    zoneId: zone.id,
    // {char:Ada Vance} -> {char:<id>|Ada Vance}; a name nobody answers to loses its braces rather than becoming a link to the wrong person.
    body: linkCharacterTokens(result.text, material.characters),
    config,
    usage: result,
  });
}

// The Threats page. Shaped exactly like a zone's, except no real Zone row, so `zoneId` stays null and `kind: "THREATS"` keeps it from colliding with the front page's own null-zoneId row.
// It never claims an AGGREGATE line for itself — passing every AGGREGATE type as already-seen means it only ever reports what a seat-holder specifically did, never a turn-wide fact a zone page already covers.
async function runThreatsCorrespondent(prisma, { turn, material, config }) {
  if (await isEdited(prisma, turn.id, null, "THREATS")) return;

  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: null,
    kind: "THREATS",
    take: config.oracleMemoryTurns,
  });
  const block = threatsBlock(material, { aggregatesSeen: new Set(AGGREGATE), memory });

  const result = await complete(config, {
    system: correspondentPrompt(config),
    user: block.text,
    maxTokens: CORRESPONDENT_MAX_TOKENS,
  });

  await writePage(prisma, {
    turnId: turn.id,
    zoneId: null,
    kind: "THREATS",
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

  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: null,
    take: config.oracleMemoryTurns,
  });

  const user = [
    memory.length ? `PREVIOUS FRONT PAGES\n${memory.join("\n\n")}` : null,
    `THIS TURN (${turn.number})`,
    ...pages.map((page) => `## ${page.zone?.name ?? (page.kind === "THREATS" ? "Threats" : "Elsewhere")}\n${page.body}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await complete(config, {
    system: editorPrompt(config),
    user,
    maxTokens: EDITOR_MAX_TOKENS,
  });

  const { body, threads } = splitEditorReply(result.text);
  await writePage(prisma, {
    turnId: turn.id,
    zoneId: null,
    body: linkCharacterTokens(body, characters),
    threads,
    config,
    usage: result,
  });
}

// The whole run. `step` is turnSideEffects.js's — one key per zone plus one for the editor, so a crash re-runs only what never finished. Called without a ledger (the panel's Run now), pass a step that just calls through.
// Every failure path here is a return, never a throw: step() already swallows, but a turn must not depend on that for its correctness.
async function runOracle(prisma, { turnId, step, skipIfComplete = false }) {
  const config = await prisma.gameConfig.findFirst();
  if (!oracleReady(config)) return { ran: false, reason: "The Oracle is off or unconfigured." };

  const turn = await prisma.turn.findUnique({
    where: { id: turnId },
    select: { id: true, number: true, startedAt: true },
  });
  if (!turn) return { ran: false, reason: "No such turn." };

  const zones = await seatZones(prisma);
  if (zones.length === 0) return { ran: false, reason: "No seat zones." };

  // Nothing left to write? Say so before loading anything: the cutoff check runs once a minute for the whole three-hour window, and the material load is half a dozen queries over the whole transcript — too much to spend on discovering there is no work.
  if (skipIfComplete && (await isComplete(prisma, turn.id, zones))) {
    return { ran: false, reason: "Every page for this turn is already written." };
  }

  const material = await loadTurnMaterial(prisma, turn, { includeChat: config.oracleIncludeChat });

  // The six run AT ONCE: a page is one to five minutes of a small model writing at a few tokens a second, and six in a row would put the chronicle on the desk a quarter hour into its three-hour window. Together they cost about what the SLOWEST one costs (measured back to back: 818s sequential, 240s at once). The once-a-turn claim is settled up front (oracleInput.js#aggregatesSeenByZone) so each call gets its own Set, identical to the in-order input.
  // allSettled rather than all: every zone is attempted whatever its neighbours do (six calls are already in flight; there's nothing left to stop). Still TOLD about the error below, and the editor does not run over a set it cannot trust.
  const seenByZone = aggregatesSeenByZone(material, zones);
  const settled = await Promise.allSettled([
    ...zones.map((zone) =>
      step(`oracle:${zone.slug}`, () =>
        runCorrespondent(prisma, {
          turn,
          zone,
          material,
          config,
          aggregatesSeen: seenByZone.get(zone.id) ?? new Set(),
        }),
      ),
    ),
    // Same batch, same reasoning as the zones — the editor below reads it back from the database exactly like a zone page.
    step("oracle:threats", () => runThreatsCorrespondent(prisma, { turn, material, config })),
  ]);
  const failed = settled.find((outcome) => outcome.status === "rejected");
  if (failed) return { ran: false, reason: failed.reason?.message ?? String(failed.reason) };

  await step("oracle:editor", () =>
    runEditor(prisma, { turn, config, characters: material.characters }),
  );
  return { ran: true, zones: zones.length };
}

module.exports = {
  runOracle,
  memoryFor,
  isComplete,
};
