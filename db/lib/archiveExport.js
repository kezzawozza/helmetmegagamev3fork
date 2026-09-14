// Archive packets: one finished game's transcript as a single portable file. The problem is GRANULARITY, not durability — PITR and nightly pg_dump already cover losing the database (docs/systemdocs/BACKUPS.md), but both are all-or-nothing and dumps prune to the newest 30, so getting just one game's transcript meant restoring a whole database into a scratch service. Cheap because ArchiveEntry has no foreign keys — every id is a snapshot column (schema.prisma) — so the table is already a flat file that happens to live in Postgres.
// FORMAT: gzipped JSONL, manifest on line 1, one ArchiveEntry per line after. Not CSV: `content` is multi-line prose full of commas/quotes, `epilogue` is JSON, `seq` is a BigInt, and CSV can't tell NULL from empty string (a null `concealedAlias` means "not concealed", an empty one means a nameless mask). Stays readable after a year of drift: every column is written EXPLICITLY (nulls included, so "existed and was null" reads differently from "didn't exist"); the column list comes from Prisma's DMMF at runtime, never a hardcoded array; `seq` crosses as a string (BigInt, CHAT.md's feed-cursor rule) and dates as ISO strings.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const { Prisma } = require("@prisma/client");

const PACKET_KIND = "bascinet-archive";
const PACKET_VERSION = 1;

// How many rows are read from Postgres at a time. Keyset-paged on seq rather than offset-paged: a month-long game is tens of thousands of rows and the bot is still writing while this runs.
const PAGE = 2000;

// Columns the importer refuses to invent — each drives real behaviour, so a "sensible default" would be silent corruption: sentAt (defaulted to now(), every archived WEB row would land inside bot/src/lib/feedOutbox.js#drainFeedOutbox's claim window and narrate a dead game into today's channels), discordMessageId/sourceDiscordMessageId (both @unique — Postgres allows unlimited NULLs on a unique index, so defaulting to null throws the Discord link away silently), seq (the feed cursor, see assertSeqSafe below), id (@default(cuid()) — minting one on import duplicates the row instead of updating it).
// Tolerance is for columns added AFTER a packet was written, and nothing else.
const STRICT_FIELDS = [
  "id", "seq", "gameId", "kind", "content", "sentAt", "source",
  "discordMessageId", "sourceDiscordMessageId", "deletedAt",
];

function archiveFields() {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "ArchiveEntry");
  if (!model) throw new Error("archiveExport: ArchiveEntry is not in the Prisma datamodel");
  return model.fields.filter((f) => f.kind !== "object").map((f) => ({
    name: f.name,
    type: f.type,
    required: f.isRequired,
  }));
}

// A row as it goes into the file. Every field named, in schema order.
function encodeRow(row, fields) {
  const out = {};
  for (const f of fields) {
    const v = row[f.name];
    if (v === null || v === undefined) out[f.name] = null;
    else if (typeof v === "bigint") out[f.name] = v.toString();
    else if (v instanceof Date) out[f.name] = v.toISOString();
    else out[f.name] = v;
  }
  return out;
}

// ...and back. `missing` collects the strict fields a packet has lost, so the caller can refuse the whole import rather than write half of it.
function decodeRow(obj, fields, { missing, dropped }) {
  const out = {};
  for (const f of fields) {
    if (!(f.name in obj)) {
      if (STRICT_FIELDS.includes(f.name)) missing.add(f.name);
      continue; // let Prisma's own default answer for a column added later
    }
    const v = obj[f.name];
    if (v === null) { out[f.name] = null; continue; }
    if (f.type === "BigInt") out[f.name] = BigInt(v);
    else if (f.type === "DateTime") out[f.name] = new Date(v);
    else out[f.name] = v;
  }
  const known = new Set(fields.map((f) => f.name));
  for (const k of Object.keys(obj)) if (!known.has(k)) dropped.add(k);
  return out;
}

function sha256Stream() {
  return crypto.createHash("sha256");
}

// ---------------------------------------------------------------- export

// Writes `<outPath>` and returns the manifest it wrote. Two passes, because the manifest carries the hash of the entries and sits on the FIRST line — a reader should validate a packet before parsing a hundred thousand rows of it. Pass one streams Postgres into a plain temp file while hashing; pass two writes the manifest and copies the temp through gzip, at the cost of local disk next to the read.
async function exportGame(prisma, { gameId, outPath }) {
  const fields = archiveFields();
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error(`archiveExport: no Game ${gameId}`);

  const tmp = path.join(os.tmpdir(), `bascinet-archive-${process.pid}-${Date.now()}.jsonl`);
  const hash = sha256Stream();
  let entryCount = 0;
  let maxSeq = 0n;
  let minSeq = null;

  const body = fs.createWriteStream(tmp);
  try {
    let cursor = null;
    for (;;) {
      const rows = await prisma.archiveEntry.findMany({
        where: { gameId, ...(cursor ? { seq: { gt: cursor } } : {}) },
        orderBy: { seq: "asc" },
        take: PAGE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const line = JSON.stringify(encodeRow(row, fields)) + "\n";
        hash.update(line);
        if (!body.write(line)) await new Promise((r) => body.once("drain", r));
        entryCount += 1;
        if (minSeq === null) minSeq = row.seq;
        maxSeq = row.seq;
      }
      cursor = rows[rows.length - 1].seq;
    }
    await new Promise((resolve, reject) => body.end((err) => (err ? reject(err) : resolve())));

    const manifest = {
      kind: PACKET_KIND,
      packet: PACKET_VERSION,
      gameId,
      exportedAt: new Date().toISOString(),
      entryCount,
      // The seq window the packet actually covers. The wipe bounds its delete by maxSeq so a row written between the export and the delete is never destroyed without having been in the file.
      minSeq: minSeq === null ? null : minSeq.toString(),
      maxSeq: entryCount ? maxSeq.toString() : null,
      sha256: hash.digest("hex"),
      // Every column name the schema had when this was written, so a future importer can name what it's dropping rather than guess.
      fields: fields.map((f) => f.name),
      game: encodeGame(game),
    };

    await pipeline(
      manifestThenBody(manifest, tmp),
      zlib.createGzip({ level: 9 }),
      fs.createWriteStream(outPath),
    );
    return manifest;
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

function encodeGame(game) {
  const out = {};
  for (const [k, v] of Object.entries(game)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "bigint") out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

async function* manifestThenBody(manifest, tmp) {
  yield JSON.stringify(manifest) + "\n";
  for await (const chunk of fs.createReadStream(tmp)) yield chunk;
}

// ---------------------------------------------------------------- verify

// Re-reads what was actually written and recomputes the hash over it. Nothing in this system deletes a row on the strength of an exit code: a truncated packet is the same shape and roughly the same size as a good one, and you find out which it was on the worst possible day. ops/backup/backup.sh refuses to upload a dump with no restorable entries for the same reason.
async function verifyPacket(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let manifest = null;
  const hash = sha256Stream();
  let count = 0;
  try {
    for await (const line of rl) {
      if (manifest === null) {
        manifest = JSON.parse(line);
        if (manifest.kind !== PACKET_KIND) throw new Error(`not an archive packet: ${manifest.kind}`);
        continue;
      }
      if (line === "") continue;
      hash.update(line + "\n");
      count += 1;
    }
  } finally {
    rl.close();
  }
  if (manifest === null) throw new Error("archiveExport: empty packet, no manifest");
  const digest = hash.digest("hex");
  if (count !== manifest.entryCount) {
    throw new Error(`archiveExport: packet holds ${count} entries, manifest claims ${manifest.entryCount}`);
  }
  if (digest !== manifest.sha256) {
    throw new Error("archiveExport: packet hash does not match its manifest — the file is damaged");
  }
  return manifest;
}

// ---------------------------------------------------------------- import

// The seq guard. Every feed reader leans on one invariant (CHAT.md §7): seq only climbs, so every row of a finished game sits BELOW every row of the current one — db/lib/feedWipe.js#previousGameFloor turns that into the floor /chat filters above, by taking MAX(seq) of everything not in this game.
// Deleting old rows is safe: it can only lower the floor, and the rows it would have hidden are gone. IMPORTING is the dangerous direction — a packet whose seq range reaches into the live game's range lifts the floor ABOVE the live rows, and /chat, the SSE stream, history and the unread dots all go dark at once.
async function assertSeqSafe(prisma, { maxSeq, gameId }) {
  if (maxSeq === null) return;
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  const currentGameId = state?.gameId ?? null;
  if (!currentGameId || currentGameId === gameId) return;
  const low = await prisma.archiveEntry.aggregate({
    where: { gameId: currentGameId },
    _min: { seq: true },
  });
  const liveMin = low._min.seq;
  if (liveMin === null || liveMin === undefined) return;
  if (BigInt(maxSeq) >= liveMin) {
    throw new Error(
      `archiveExport: this packet's seq range (up to ${maxSeq}) reaches into the current game ` +
      `(from ${liveMin}). Importing it would lift the feed floor above the live rows and blank ` +
      `/chat for everyone. Re-run with --remap-seq to import it with fresh seq values instead.`,
    );
  }
}

// Move the sequence forward past whatever was imported — and ONLY forward. Read as "setval to the imported max", this would move it BACKWARD in the ordinary case (importing an old game), and every insert after that would collide on ArchiveEntry_seq_key until it climbed back: a hard outage of all speech. The name has to stay quoted, or it folds to lowercase and errors.
async function bumpSeqSequence(prisma) {
  // pg_get_serial_sequence for the name and pg_sequence_last_value for the current position, so the sequence ("ArchiveEntry_seq_seq") is never spelled out twice and cannot drift.
  await prisma.$executeRawUnsafe(`
    SELECT setval(
      s.seq,
      GREATEST(
        COALESCE(pg_sequence_last_value(s.seq), 1),
        COALESCE((SELECT MAX("seq") FROM "ArchiveEntry"), 1)
      )
    )
    FROM (SELECT pg_get_serial_sequence('"ArchiveEntry"', 'seq')::regclass AS seq) s
  `);
}

// Loads a packet back. Returns a report — what it wrote, and every column it dropped or let default. That report is what makes a packet written today loadable in two years: the failure mode of a tolerant importer is silence.
async function importPacket(prisma, filePath, { remapSeq = false, chunk = 500 } = {}) {
  const fields = archiveFields();
  const manifest = await verifyPacket(filePath);
  if (!remapSeq) await assertSeqSafe(prisma, { maxSeq: manifest.maxSeq, gameId: manifest.gameId });

  const missing = new Set();
  const dropped = new Set();
  const added = fields
    .map((f) => f.name)
    .filter((n) => Array.isArray(manifest.fields) && !manifest.fields.includes(n));

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let first = true;
  let batch = [];
  let written = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    // createMany + skipDuplicates rather than per-row upsert: the trigram GIN on `content` dominates insert cost, and a re-run of a half-finished import should skip what landed rather than rewrite it.
    const res = await prisma.archiveEntry.createMany({ data: batch, skipDuplicates: true });
    written += res.count;
    batch = [];
  };

  try {
    for await (const line of rl) {
      if (first) { first = false; continue; }
      if (line === "") continue;
      const row = decodeRow(JSON.parse(line), fields, { missing, dropped });
      if (missing.size) {
        throw new Error(
          `archiveExport: packet is missing ${[...missing].join(", ")} — these carry behaviour and ` +
          `will not be defaulted. Refusing to import rather than write something wrong.`,
        );
      }
      if (remapSeq) delete row.seq;
      batch.push(row);
      if (batch.length >= chunk) await flush();
    }
    await flush();
  } finally {
    rl.close();
  }

  await prisma.game.upsert({
    where: { id: manifest.gameId },
    update: {},
    create: decodeGame(manifest.game),
  });
  await bumpSeqSequence(prisma);

  // What is actually there afterwards, which isn't the same question as what this run wrote. createMany's skipDuplicates is silent by design — fine for a re-run skipping what landed — but equally silent when the packet's ids collide with rows belonging to some OTHER game, so "0 written, all skipped" would read as success over an empty table. Counting settles it, and the caller can say so.
  const present = await prisma.archiveEntry.count({ where: { gameId: manifest.gameId } });

  return {
    manifest,
    written,
    skipped: manifest.entryCount - written,
    present,
    complete: present >= manifest.entryCount,
    droppedColumns: [...dropped],
    defaultedColumns: added,
    remapped: remapSeq,
  };
}

function decodeGame(game) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "Game");
  const out = {};
  for (const f of model.fields) {
    if (f.kind === "object") continue;
    if (!(f.name in game) || game[f.name] === null) continue;
    out[f.name] = f.type === "DateTime" ? new Date(game[f.name]) : game[f.name];
  }
  return out;
}

module.exports = {
  archiveFields,
  decodeRow,
  exportGame,
  verifyPacket,
  importPacket,
  bumpSeqSequence,
};
