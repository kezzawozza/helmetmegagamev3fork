#!/usr/bin/env node
// docs/zones.yaml -> a rendered image, via Graphviz's own `dot` binary and
// zone-dot.js's generator directly (no stale zone.dot on disk).
//
//   npm run map:png                 write zone.png at the repo root
//   npm run map:png -- out.svg      write somewhere else; extension picks the format
//
// Needs Graphviz installed locally (`brew install graphviz` / `apt install graphviz`).

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { generateDot, ROOT } = require("./zone-dot");

function main() {
  const outPath = path.resolve(process.argv[2] ?? path.join(ROOT, "zone.png"));
  const format = path.extname(outPath).slice(1) || "png";
  const { dot, zoneCount, edgeCount } = generateDot();

  const result = spawnSync("dot", ["-T", format, "-o", outPath], { input: dot });

  if (result.error?.code === "ENOENT") {
    console.error(
      "Graphviz's `dot` isn't installed or isn't on PATH.\n" +
        "  macOS:          brew install graphviz\n" +
        "  Debian/Ubuntu:  apt install graphviz",
    );
    process.exit(1);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const { size } = fs.statSync(outPath);
  console.log(
    `${edgeCount} edges, ${zoneCount} zones -> ${path.relative(ROOT, outPath)} (${format}, ${size} bytes)`,
  );
}

main();
