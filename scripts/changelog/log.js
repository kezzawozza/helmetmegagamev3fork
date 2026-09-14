// The changelog writer. One entry per push, in CHANGELOG.md and in Discord.
// The audience is the GM team: an entry says what changed in the *game*,
// never which files moved.
//
//   npm run push -- "Subject" "Rebalanced the labor yields" "+Labor? button"
//
// First argument is the heading; each after it is a note, with its own glyph
// (✚ new, − gone, ✎ changed) or treated as ✎. `--hidden` skips both halves.
// Lore and antagonist-seat pushes are held back by default — see
// SENSITIVE_PATHS/SENSITIVE_WORDS. Committed by hand instead? `npm run
// changelog` reads HEAD's commit body for notes (glyph, "-", or "*" lines,
// wrapped bullets folded into one).
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Not a secret — anyone in the guild can read a channel id, one guild only.
// Same reasoning as db/lib/roleIds.js. The env var overrides for a test channel.
const CHANNEL_ID = process.env.CHANGELOG_CHANNEL_ID || "1545157496304566354";

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, "CHANGELOG.md");
const MAX_NOTES = 12; // long enough to read a push at a glance

// Touching one of these is lore or antagonist work, withheld unless
// --tell-gms — the GMs are briefed on this material deliberately, not by changelog.
const SENSITIVE_PATHS = [
  "docs/lore.md",
  "docs/archive/",
  "db/lib/threats.js",
  "docs/systemdocs/THREATS.md",
];

// A second net over the words rather than the files; this one only warns.
const SENSITIVE_WORDS = /\b(lore|antagonist|threat seat|the tower'?s secret|bacchus)\b/i;

const HEADER = `# Changelog

Every push, newest first, in plain language for the GM team. Written by
\`npm run push\` and mirrored to Discord — see CLAUDE.md.
\`✚\` new, \`−\` gone, \`✎\` changed.
`;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const GLYPHS = { "✚": "✚", "−": "−", "✎": "✎", "+": "✚", "-": "−", "~": "✎" };

function normalizeNote(raw) {
  const text = String(raw).trim();
  if (!text) return null;
  const lead = text[0];
  const glyph = GLYPHS[lead];
  if (!glyph) return `✎ ${text}`;
  return `${glyph} ${text.slice(1).trim()}`.trim();
}

function clamp(notes) {
  if (notes.length <= MAX_NOTES) return notes;
  return [...notes.slice(0, MAX_NOTES), `… and ${notes.length - MAX_NOTES} more`];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function prepend(entry) { // newest first, directly under the header
  const existing = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : null;
  if (!existing) {
    fs.writeFileSync(FILE, `${HEADER}\n${entry}\n`);
    return;
  }
  const marker = existing.indexOf("\n## ");
  const head = marker === -1 ? existing.trimEnd() : existing.slice(0, marker).trimEnd();
  const rest = marker === -1 ? "" : existing.slice(marker + 1);
  fs.writeFileSync(FILE, `${head}\n\n${entry}\n\n${rest}`.trimEnd() + "\n");
}

function changedPaths(staged, range) {
  const raw = range
    ? git(["diff", "--name-only", range])
    : staged
    ? git(["diff", "--cached", "--name-only"])
    : git(["show", "--name-only", "--pretty=format:", "HEAD"]);
  return raw.split("\n").map((l) => l.trim()).filter(Boolean);
}

function sensitiveHits(paths) {
  return paths.filter((p) => SENSITIVE_PATHS.some((s) => (s.endsWith("/") ? p.startsWith(s) : p === s)));
}

// A bullet opens a note; every following line folds into it (single space —
// un-wrapping the author's typography) until a blank line, the next bullet,
// or a trailer ends it. Prose paragraphs are left alone.
const BULLET = /^[✚−✎+\-*]\s*\S/;

// Git trailers (Co-Authored-By, Claude-Session, Signed-off-by) can sit with
// no blank line above them; folding one into the last note would publish it.
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*:[ \t]/;

function notesFromCommitBody() {
  const body = git(["log", "-1", "--pretty=%b"]);
  const notes = [];
  let open = null;
  const close = () => {
    if (open) notes.push(open);
    open = null;
  };

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || TRAILER.test(line)) {
      close();
      continue;
    }
    if (BULLET.test(line)) {
      close();
      open = line.replace(/^\*/, "✎");
      continue;
    }
    if (open) open += ` ${line}`;
  }
  close();

  return notes.map(normalizeNote).filter(Boolean);
}

function fileEntry(subject, notes) { // two trailing spaces per line: GitHub's hard break
  const body = clamp(notes).map((n, i, all) => (i === all.length - 1 ? n : `${n}  `));
  return [`## ${today()} · ${subject}`, "", ...body].join("\n");
}

function discordBody(subject, notes, hash) {
  return [`**${subject}**`, `-# \`${hash}\` · ${today()}`, ...clamp(notes)].join("\n");
}

async function announce(subject, notes, hash) {
  const { postMessageBatched } = require("../../db/lib/discordRest");
  await postMessageBatched(CHANNEL_ID, discordBody(subject, notes, hash));
}

function collect(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === flag && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const staged = argv.includes("--staged");
  const announceOnly = argv.includes("--announce");
  const dryRun = argv.includes("--dry-run");
  const hidden = argv.includes("--hidden") || argv.includes("--secret");
  const tellGms = argv.includes("--tell-gms");

  if (hidden) {
    console.log("changelog: hidden push — nothing written, nothing announced.");
    return;
  }

  const msgFlag = argv.indexOf("--message");
  const subject = (msgFlag !== -1 ? argv[msgFlag + 1] : git(["log", "-1", "--pretty=%s"])).split("\n")[0].trim();

  const rangeFlag = argv.indexOf("--range");
  const secret = sensitiveHits(changedPaths(staged, rangeFlag !== -1 ? argv[rangeFlag + 1] : null));
  if (secret.length && !tellGms) {
    console.log(
      `changelog: held back — this push touches ${secret.join(", ")}, which the GMs are briefed on separately. ` +
        "Pass --tell-gms to log it anyway.",
    );
    return;
  }
  if (SENSITIVE_WORDS.test(subject)) {
    console.warn("changelog: heads up — the subject names lore or antagonist material. The GMs will read it.");
  }

  const given = msgFlag !== -1 ? collect(argv, "--note") : [...collect(argv, "--note"), ...notesFromCommitBody()];
  const notes = given.map(normalizeNote).filter(Boolean);

  if (announceOnly) {
    const hash = git(["rev-parse", "--short", "HEAD"]);
    if (dryRun) {
      console.log(`changelog: would post to ${CHANNEL_ID}\n${discordBody(subject, notes, hash)}`);
      return;
    }
    // Best-effort: a Discord outage is not a reason to fail the run.
    try {
      await announce(subject, notes, hash);
      console.log("changelog: announced to Discord.");
    } catch (err) {
      console.warn(`changelog: Discord announce failed (the push is fine): ${err.message}`);
    }
    return;
  }

  const entry = fileEntry(subject, notes);
  if (dryRun) {
    console.log(entry);
    return;
  }
  prepend(entry);
  console.log(`changelog: logged ${notes.length} note${notes.length === 1 ? "" : "s"}.`);

  if (staged) return; // push path stops here: no commit yet, so no hash to announce
  const hash = git(["rev-parse", "--short", "HEAD"]);
  try {
    await announce(subject, notes, hash);
    console.log("changelog: announced to Discord.");
  } catch (err) {
    console.warn(`changelog: Discord announce failed (CHANGELOG.md is written): ${err.message}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.warn(`changelog: skipped (${err.message})`);
  });
}

// Shared with scripts/changelog/patchnote.js.
module.exports = { normalizeNote, clamp };
