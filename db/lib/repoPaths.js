const fs = require("node:fs");
const path = require("node:path");

// Where docs/ actually is at runtime. A plain `path.join(__dirname, ...)` breaks under Turbopack, which inlines __dirname as a literal resolving to the wrong tree in the Next server build. serverExternalPackages does NOT fix it (@lifeweb/db is a workspace symlink, bundled regardless), so the search starts from __dirname first, process.cwd() as the fallback that survives bundling.

const MARKER = "zones.yaml"; // identifies OUR docs/, not some other one
const MAX_UP = 6;

let cached;

function search(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < MAX_UP; i++) {
    const candidate = path.join(dir, "docs");
    if (fs.existsSync(path.join(candidate, MARKER))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function docsDir() {
  if (cached !== undefined) return cached;
  cached = search(__dirname) ?? search(process.cwd()) ?? null;
  if (!cached) {
    console.error(
      `Could not locate docs/ (looked for docs/${MARKER} above ${__dirname} and ${process.cwd()})`,
    );
  }
  return cached;
}

// Joins onto docs/, or null when it cannot be found. Callers reading a YAML master should throw on null — a sync with no master is not a sync.
function docsPath(...segments) {
  const dir = docsDir();
  return dir ? path.join(dir, ...segments) : null;
}

// Joins onto the repo ROOT. Used to reach web/public from db/ for syncTags.js's asset-existence checks, which treat a null as "cannot verify" — a sync must not fail over a check it cannot perform.
function repoPath(...segments) {
  const dir = docsDir();
  return dir ? path.join(path.dirname(dir), ...segments) : null;
}

module.exports = { docsPath, repoPath };
