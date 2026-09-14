// The Oracle's run: six correspondents and an editor, once per turn.
// See docs/systemdocs/ORACLE.md.
//
// Called from db/lib/oracleCutoff.js at the Move cutoff, NOT from a TURN_PASSES
// entry and no longer from the turn's side-effect thunk. Both halves of that are
// load-bearing and worth keeping next to the code.
//
// Never a pass: a pass runs inside resolveNeeds()'s serial loop, gates
// needsResolvedAt, and is awaited inline by the bot's cron, so one that spends
// two minutes on an HTTP call holds the whole turn advance open and blows the
// 15s transaction timeout on the way. TURN-ENGINE.md states the rule outright —
// passes return data and never make network calls.
//
// No longer the thunk either, which ran at turn close. That was three hours too
// late to be read by the people it is written for: gamemasters adjudicate
// between the Moves locking and the push, and the chronicle was arriving after
// the rulings. The thunk's step() ledger went with it, so skipIfComplete below
// asks the written rows instead.

const { complete } = require("./oracleClient");
const { correspondentPrompt, editorPrompt, splitEditorReply } = require("./oraclePrompts");
const { loadTurnMaterial, zoneBlock, threatsBlock, linkCharacterTokens, aggregatesSeenByZone } = require("./oracleInput");
const { AGGREGATE } = require("./oracleAudit");

// Whether a run is even possible. Checked at RUN time rather than baked into
// the side-effect payload, so enabling the Oracle between the advance and the
// resume does the obvious thing.
function oracleReady(config) {
  return Boolean(config?.oracleEnabled && config?.oracleApiKey && config?.oracleModel);
}

// The zones a correspondent is written for: the seat zones, the same set
// listSelectableZones() offers a GM. That is not a coincidence — it is the
// granularity GmZoneView filters at, so one page per seat zone is exactly one
// page per thing a GM can be scoped to.
function seatZones(prisma) {
  return prisma.zone.findMany({
    where: { gmRoleId: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });
}

// The last N turns of pages for one scope, oldest first, as context.
//
// Reads `body`, which is the EDITED text when a GM has rewritten it. That is
// the entire correction mechanism: there is no regenerate, so a page a GM fixed
// is what the next turns are told, and a page nobody touched carries forward as
// drafted.
// Ceilings on length, not targets — the prompts ask for 150-400 words from a
// correspondent and 120-300 plus threads from the editor, and these sit at
// roughly three times that so an ordinary page never comes near them.
//
// They are deliberately generous, because the failure they guard is one-sided.
// A cap set too high costs nothing: the model writes the length it was asked
// for and stops. A cap set too low cuts a page off mid-sentence, and until
// oracleClient.js learned to read finish_reason nothing anywhere noticed. The
// editor is the one that suffers most from a low cap, since its THREADS block
// is at the END of its reply, so a truncated front page loses the threads rail
// rather than a paragraph.
//
// A page that runs into either of these is now an error rather than a silent
// short page, so treat one in the log as a prompt problem, not a cap problem.
const CORRESPONDENT_MAX_TOKENS = 1800;
const EDITOR_MAX_TOKENS = 1400;

// `kind` defaults from `zoneId` for the two shapes that predate it (a real
// zone always has one, the front page never does) — only the Threats
// correspondent, which also has no zoneId, needs to pass it explicitly, since
// zoneId alone can no longer tell FRONT and THREATS apart.
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

// Find one page. NOT findUnique on turnId_zoneId, and the front page is why.
//
// Postgres treats NULLs as distinct in a unique index, so @@unique([turnId,
// zoneId]) never actually constrained the front page — schema.prisma says so,
// and a PARTIAL unique index in raw SQL (WHERE "zoneId" IS NULL) is the real
// guard. Prisma knows it too, and refuses a null component in a compound unique
// WHERE outright: "Argument `zoneId` must not be null". So that key can address
// the six zone pages and never the seventh.
//
// It is findFirst here and a find-then-write below, which handle null the way
// an ordinary filter does. The pair used to be findUnique and upsert, and the
// front page was unreadable and unwritable from the day the Oracle was built —
// invisible until it first called a real provider, because every zone page
// succeeded and only the editor ever passes null.
function findPage(prisma, turnId, zoneId, select, kind) {
  return prisma.oracleSynopsis.findFirst({
    where: { turnId, zoneId: zoneId ?? null, kind: pageKind(zoneId, kind) },
    select,
  });
}

// Write one page. Replaces rather than only creating: a resume that reaches a
// zone whose step was recorded but whose row somehow is not should heal rather
// than throw, and a "Run now" over an existing turn should replace its own
// draft.
//
// editedAt/editedBy are deliberately NOT cleared here — see the caller, which
// refuses to overwrite a page a GM has rewritten.
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

// A page a GM has rewritten is theirs. Neither a resume nor a Run now may
// silently replace it — the edit IS the correction, and losing one would make
// the only correction mechanism unreliable.
async function isEdited(prisma, turnId, zoneId, kind) {
  const row = await findPage(prisma, turnId, zoneId, { editedAt: true }, kind);
  return Boolean(row?.editedAt);
}

// Is the whole set present — every seat zone plus the front page?
//
// This is the resume ledger for the cutoff run. The turn thunk used to supply
// one (Turn.sideEffectSteps, via step()); firing on the Move cutoff means there
// is no thunk to borrow it from, so the written rows are the ledger instead.
//
// ALL SEVEN OR NONE, deliberately — a half-finished run is redone whole rather
// than patched zone by zone, and both reasons are about the front page and the
// once-a-turn lines:
//
//   * runEditor reads the zone pages back out of the database and writes the
//     front page over whatever it finds. Fill in a missing zone on a later pass
//     and the front page still summarises the set WITHOUT it, permanently and
//     silently, because a front page now exists.
//   * aggregatesSeen is an in-process Set that keeps a once-per-turn line
//     ("hunger was charged") in exactly one zone's input. A second pass starts
//     with an empty Set and skips the zone that already consumed the line, so
//     the next zone consumes it again and the same fact is reported twice.
//
// Both bugs come from treating six zone pages as six independent jobs. They are
// one document. Re-running the whole turn costs a handful of model calls on the
// rare bad night and keeps the output coherent.
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
    // {char:Ada Vance} -> {char:<id>|Ada Vance}, and a name nobody answers to
    // loses its braces rather than becoming a link to the wrong person.
    body: linkCharacterTokens(result.text, material.characters),
    config,
    usage: result,
  });
}

// The Threats page. Shaped exactly like a zone's — same PRESENT/MOVES/EVENTS
// structure, same prompt, same slot in the front page's zone list — except it
// has no real Zone row, so `zoneId` stays null and `kind: "THREATS"` is what
// keeps it from colliding with the front page's own null-zoneId row.
//
// It never claims an AGGREGATE line ("hunger was charged") for itself: those
// are turn-wide facts a zone page already reports once, and a seat-holder's
// own audit rows would otherwise let the Threats page claim one too, printing
// it twice. Passing every AGGREGATE type as already-seen means it only ever
// reports what a seat-holder specifically did.
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

// The front page. Reads the six zone pages back OUT OF THE DATABASE rather than
// taking them from the correspondents' return values, so a resume whose zone
// steps ran in a previous process still has something to edit.
async function runEditor(prisma, { turn, config, characters }) {
  if (await isEdited(prisma, turn.id, null)) return;

  // Every real zone plus the Threats page — everything that is NOT the front
  // page itself. The Threats row has no `zone` relation (zoneId is null), so
  // its section header falls back to its own kind rather than to "Elsewhere",
  // which is reserved for a genuinely zone-less row this file hasn't been
  // taught about.
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

// The whole run. `step` is turnSideEffects.js's — one key per zone plus one for
// the editor, so a crash re-runs only what never finished. When called from
// anywhere without a ledger (the panel's Run now), pass a step that just calls
// through.
//
// Every failure path here is a return, never a throw: step() already swallows,
// but a turn must not depend on that for its correctness.
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

  // Nothing left to write? Say so before loading anything. The cutoff check
  // runs once a minute for the whole three-hour window, and the material load
  // is half a dozen queries over every living character and the turn's whole
  // transcript — far too much to spend on discovering there is no work.
  if (skipIfComplete && (await isComplete(prisma, turn.id, zones))) {
    return { ran: false, reason: "Every page for this turn is already written." };
  }

  const material = await loadTurnMaterial(prisma, turn, { includeChat: config.oracleIncludeChat });

  // The six run AT ONCE. A page is one to five minutes of a small model writing
  // at a few tokens a second, and six of those in a row put the chronicle on
  // the desk a quarter of an hour into the three-hour window it is written to
  // be read in. Together they cost about what the SLOWEST one costs. Measured
  // on the same real turn, back to back: 818 seconds in a row, 240 at once.
  //
  // What used to make them sequential was a single mutable Set claiming the
  // once-a-turn lines as it went. That claim is settled up front now
  // (oracleInput.js#aggregatesSeenByZone) and each call gets its own Set, so
  // the input is identical to what the in-order version built.
  //
  // allSettled rather than all: every zone is attempted whatever its
  // neighbours do — the cutoff run's step() swallows anyway, and Run now's does
  // not, so without this one early failure would quietly cost the five pages
  // behind it. Six calls are already in flight by then; there is nothing left
  // to stop, which is the one thing Run now's old "the first error stops the
  // run" no longer means. It is still TOLD about the error — the reason comes
  // back below — and the editor does not run over a set it cannot trust.
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
    // Same batch, same reasoning as the zones — it costs what the slowest call
    // costs either way, and the editor below reads it back from the database
    // exactly like a zone page.
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
