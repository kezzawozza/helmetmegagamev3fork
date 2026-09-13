#!/usr/bin/env node
// node scripts/revert-guard.js <base>
//
// Refuses a push that deletes lines somebody else added recently.
//
// Several sessions land on master at once. A session that wrote a file out
// from a stale read commits the old copy whole, and git sees nothing wrong:
// the commit simply "removes" the lines another session added an hour ago.
// That is how be5c3d7c reverted a day of work on 2026-09-12 with no conflict.
//
// So: blame every line the outgoing commits delete, as it stands on <base>
// (origin/master after the rebase). A deleted line whose last author commit
// is younger than WINDOW_HOURS and is not one of our own outgoing commits is
// somebody else's fresh work. Past THRESHOLD such lines, stop and name them.
const { execFileSync } = require("node:child_process");

const WINDOW_HOURS = 48;
const THRESHOLD = 5;

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const base = process.argv[2] || "origin/master";
const ours = new Set(git(["rev-list", `${base}..HEAD`]).split("\n").filter(Boolean));
if (!ours.size) process.exit(0);

const cutoff = Date.now() / 1000 - WINDOW_HOURS * 3600;
const hits = new Map(); // commit -> { subject, files: Map(file -> count) }

const diff = git(["diff", "-U0", "--no-renames", base, "HEAD", "--", ".", ":!CHANGELOG.md"]);
let file = null;
for (const line of diff.split("\n")) {
  if (line.startsWith("--- ")) {
    file = line === "--- /dev/null" ? null : line.slice(6);
    continue;
  }
  const m = file && line.match(/^@@ -(\d+)(?:,(\d+))? /);
  if (!m) continue;
  const start = Number(m[1]);
  const count = m[2] === undefined ? 1 : Number(m[2]);
  if (!count) continue;

  const blame = git(["blame", "--porcelain", "-L", `${start},+${count}`, base, "--", file]);
  const times = new Map();
  let sha = null;
  for (const b of blame.split("\n")) {
    const head = b.match(/^([0-9a-f]{40}) \d+ \d+/);
    if (head) {
      sha = head[1];
      continue;
    }
    if (b.startsWith("committer-time ")) times.set(sha, Number(b.slice(15)));
    if (b.startsWith("\t") && sha && !ours.has(sha)) {
      const t = times.get(sha);
      if (t !== undefined && t >= cutoff) {
        if (!hits.has(sha)) hits.set(sha, { files: new Map() });
        const f = hits.get(sha).files;
        f.set(file, (f.get(file) || 0) + 1);
      }
    }
  }
}

const total = [...hits.values()].reduce((n, h) => n + [...h.files.values()].reduce((a, b) => a + b, 0), 0);
if (total < THRESHOLD) process.exit(0);

console.error(`revert-guard: this push deletes ${total} lines that other commits added in the last ${WINDOW_HOURS}h:`);
for (const [sha, h] of hits) {
  const subject = git(["log", "-1", "--pretty=%h %s", sha]).trim();
  console.error(`  ${subject}`);
  for (const [f, n] of h.files) console.error(`      ${n} line${n === 1 ? "" : "s"}  ${f}`);
}
console.error("If that is a stale copy, redo the edit on top of master. If you meant it, pass --allow-revert.");
process.exit(1);
