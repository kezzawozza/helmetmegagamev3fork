#!/usr/bin/env node
// Finds exported symbols (ESM and CJS, named exports only) under
// web/lib, web/app, db/lib, bot/src that are never referenced, as a
// whole-word identifier, anywhere else under web/, bot/, db/, scripts/.
//
// Heuristic, not a real parser: it token-scans source text, so a name that
// only shows up in a comment or a string still counts as "used". That is
// the safe direction for a tool whose false negatives (missing a genuinely
// dead export) are cheap and whose false positives (flagging a live one)
// would send someone chasing a ghost.
//
// Zero dependencies, node >= 22.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFINE_ROOTS = ["web/lib", "web/app", "db/lib", "bot/src"];
const SEARCH_ROOTS = ["web", "bot", "db", "scripts"];
const EXCLUDE_DIRS = new Set(["node_modules", ".next", ".git"]);
const EXTENSIONS = new Set([".js", ".mjs"]);

const SKIP_NAMES = new Set([
  "page",
  "layout",
  "metadata",
  "generateMetadata",
  "revalidate",
  "dynamic",
  "viewport",
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "default",
]);

function walk(root, out = []) {
  const full = path.join(ROOT, root);
  if (!fs.existsSync(full)) return out;
  const entries = fs.readdirSync(full, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const rel = path.join(root, e.name);
    if (e.isDirectory()) {
      walk(rel, out);
    } else if (e.isFile() && EXTENSIONS.has(path.extname(e.name))) {
      out.push(rel);
    }
  }
  return out;
}

function collectFiles(roots) {
  const set = new Set();
  for (const r of roots) for (const f of walk(r)) set.add(f);
  return set;
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function usesServerDirective(lines) {
  const first = lines.find((l) => l.trim() !== "");
  if (!first) return false;
  return /^["']use server["'];?$/.test(first.trim());
}

const RE_DEFAULT = /^export\s+default\b/;
const RE_FUNC_CLASS = /^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/;
const RE_CONST = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const RE_BRACE_START = /^export\s*\{/;
const RE_ME_DOT = /^\s*module\.exports\.([A-Za-z_$][\w$]*)\s*=/;
const RE_EXPORTS_DOT = /^\s*exports\.([A-Za-z_$][\w$]*)\s*=/;

function extractExports(content) {
  const results = [];
  const lines = content.split("\n");

  if (usesServerDirective(lines)) return results;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (RE_DEFAULT.test(line)) continue;

    let m = line.match(RE_FUNC_CLASS);
    if (m) {
      results.push({ name: m[1], line: i + 1 });
      continue;
    }

    m = line.match(RE_CONST);
    if (m) {
      results.push({ name: m[1], line: i + 1 });
      continue;
    }

    if (RE_BRACE_START.test(line)) {
      let block = line;
      let j = i;
      while (!block.includes("}") && j < lines.length - 1) {
        j++;
        block += "\n" + lines[j];
      }
      const openIdx = block.indexOf("{");
      const closeIdx = block.lastIndexOf("}");
      if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
        const inner = block.slice(openIdx + 1, closeIdx);
        for (const part of splitTopLevel(inner)) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const asMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/);
          if (asMatch) {
            if (asMatch[1] !== "default") results.push({ name: asMatch[2], line: i + 1 });
            continue;
          }
          const idMatch = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
          if (idMatch) results.push({ name: idMatch[1], line: i + 1 });
        }
      }
      i = j;
      continue;
    }

    m = line.match(RE_ME_DOT);
    if (m) {
      results.push({ name: m[1], line: i + 1 });
      continue;
    }

    m = line.match(RE_EXPORTS_DOT);
    if (m) {
      results.push({ name: m[1], line: i + 1 });
      continue;
    }
  }

  // module.exports = { ... } — may be multi-line, so scan the whole file
  // for a matching brace pair rather than line by line.
  const meIdx = content.search(/module\.exports\s*=\s*\{/);
  if (meIdx !== -1) {
    const start = content.indexOf("{", meIdx);
    let depth = 0;
    let k = start;
    for (; k < content.length; k++) {
      if (content[k] === "{") depth++;
      else if (content[k] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (k < content.length) {
      const block = content.slice(start + 1, k);
      const blockStartLine = content.slice(0, start).split("\n").length;
      for (const part of splitTopLevel(block)) {
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith("...")) continue;
        const keyMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*(?::|,|$)/);
        if (!keyMatch) continue;
        const idx = block.indexOf(part);
        const line = blockStartLine + block.slice(0, idx).split("\n").length - 1;
        results.push({ name: keyMatch[1], line });
      }
    }
  }

  // De-dupe by name, keeping the first (lowest) line seen.
  const byName = new Map();
  for (const r of results) {
    if (!byName.has(r.name) || r.line < byName.get(r.name).line) byName.set(r.name, r);
  }
  return [...byName.values()];
}

function resolveRequireTarget(fromDir, spec) {
  let resolved = path.normalize(path.join(fromDir, spec));
  if (path.extname(resolved) === "") resolved += ".js";
  return resolved;
}

function main() {
  const defineFiles = collectFiles(DEFINE_ROOTS);
  const searchFiles = collectFiles(SEARCH_ROOTS);

  const contentCache = new Map();
  const getContent = (f) => {
    if (!contentCache.has(f)) {
      contentCache.set(f, fs.readFileSync(path.join(ROOT, f), "utf8"));
    }
    return contentCache.get(f);
  };

  // Word index: identifier -> set of files it appears in (token scan, not AST).
  const wordIndex = new Map();
  for (const f of searchFiles) {
    const content = getContent(f);
    const words = content.match(/[A-Za-z_$][\w$]*/g);
    if (!words) continue;
    for (const w of new Set(words)) {
      let set = wordIndex.get(w);
      if (!set) {
        set = new Set();
        wordIndex.set(w, set);
      }
      set.add(f);
    }
  }

  // db/index.js barrel: files spread into it (...require("./lib/foo")) have
  // every export counted as used, per CLAUDE.md's barrel convention.
  const reExportedFiles = new Set();
  const dbIndexPath = "db/index.js";
  if (fs.existsSync(path.join(ROOT, dbIndexPath))) {
    const c = getContent(dbIndexPath);
    const re = /\.\.\.require\(["']([^"']+)["']\)/g;
    let m;
    while ((m = re.exec(c))) {
      reExportedFiles.add(resolveRequireTarget("db", m[1]));
    }
  }

  const dead = [];
  for (const f of defineFiles) {
    if (reExportedFiles.has(f)) continue;
    const content = getContent(f);
    for (const { name, line } of extractExports(content)) {
      if (SKIP_NAMES.has(name)) continue;
      const users = wordIndex.get(name);
      const usedElsewhere = users && [...users].some((u) => u !== f);
      if (!usedElsewhere) dead.push({ file: f, line, name });
    }
  }

  dead.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  for (const d of dead) {
    console.log(`${d.file}:${d.line} ${d.name}`);
  }
  const filesWithDead = new Set(dead.map((d) => d.file));
  console.log(`${dead.length} dead exports in ${filesWithDead.size} files`);
}

main();
