// The confirm-inside-a-transition deadlock, as a test. `startTransition(async
// () => { await confirm({…}) })` hangs forever: confirm()'s dialog needs an
// immediate render, but an async transition schedules it at transition
// priority, which can't commit until the promise settles, which can't settle
// until the never-rendered dialog is clicked. Fix: confirm FIRST, outside the
// transition. See DESIGN-SYSTEM.md §8.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WEB_APP = path.join(__dirname, "..", "..", "web", "app");
const SKIP = new Set(["node_modules", ".next"]);

function jsFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// The transition's OWN callback body, by brace matching from its opening `{`.
// Braces inside strings could in principle skew the count, but a false
// positive here is loud and easy to read rather than silent.
function transitionBody(source, from) {
  const open = source.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

test("no component awaits confirm() inside startTransition", () => {
  const files = jsFilesUnder(WEB_APP);
  assert.ok(files.length > 200, `only scanned ${files.length} files — has web/app moved?`);

  const offences = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const re = /startTransition\(\s*async/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      if (!transitionBody(source, m.index).includes("await confirm(")) continue;
      offences.push(`${path.relative(path.join(__dirname, "..", ".."), file)}:${source.slice(0, m.index).split("\n").length}`);
    }
  }

  assert.deepEqual(
    offences,
    [],
    `confirm() awaited inside startTransition — these controls will hang:\n${offences.join("\n")}\n` +
      "Move the confirm ABOVE the transition (DESIGN-SYSTEM.md §8).",
  );
});
