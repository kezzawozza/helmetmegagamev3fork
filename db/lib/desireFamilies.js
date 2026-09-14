// Reads ONLY the `families:` / `familyGroups:` headers of docs/desires.yaml, never the `desires:` list
// below them, so a caller that just needs to validate a family key doesn't parse the whole catalog. A
// MISSING file is NOT an error — db/lib/syncTags.js requires this module to check a tag's
// `desires.locks` families at db:sync-tags time, and a repo with no desires.yaml must still sync tags;
// it just gets an empty set and every reference throws (same failure a typo would produce).

const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const { entriesOf } = require("./yamlEntries");

let cachedDoc;

// The parsed file, or {} when absent. Cached for the life of the process — never invalidates at runtime.
function loadDoc() {
  if (cachedDoc !== undefined) return cachedDoc;
  const file = docsPath("desires.yaml");
  if (!file || !fs.existsSync(file)) return (cachedDoc = {});
  cachedDoc = yaml.load(fs.readFileSync(file, "utf8")) ?? {};
  return cachedDoc;
}

let cachedKeys;
let cachedFamilies;
let cachedGroups;

// Returns a Set of family keys. Empty when docs/desires.yaml is absent.
function desireFamilyKeys() {
  if (cachedKeys !== undefined) return cachedKeys;
  cachedKeys = new Set();
  for (const entry of entriesOf(loadDoc().families, "key")) {
    if (entry?.key) cachedKeys.add(entry.key);
  }
  return cachedKeys;
}

// { key, name, group, color } per family, in header order. `group` names a familyGroups entry and
// `color` is a freeform hex — both picker-only data (web/app/components/DesireCatalog.js) the sync
// never reads, so either may be absent and comes back null. Separate export so a caller that only
// wants the Set (validation) never carries names.
function desireFamilies() {
  if (cachedFamilies !== undefined) return cachedFamilies;
  cachedFamilies = entriesOf(loadDoc().families, "key")
    .filter((f) => f?.key)
    .map((f) => ({
      key: f.key,
      name: f.name ?? f.key,
      group: f.group ?? null,
      color: f.color ?? null,
    }));
  return cachedFamilies;
}

// { key, name } per familyGroups entry, in header order — the hue clusters the picker's tab bar is built from.
function desireFamilyGroups() {
  if (cachedGroups !== undefined) return cachedGroups;
  cachedGroups = entriesOf(loadDoc().familyGroups, "key")
    .filter((g) => g?.key)
    .map((g) => ({ key: g.key, name: g.name ?? g.key }));
  return cachedGroups;
}

module.exports = { desireFamilyKeys, desireFamilies, desireFamilyGroups };
