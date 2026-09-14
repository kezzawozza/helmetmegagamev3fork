// Sync every archive packet in the bucket down to a folder on this machine.
//
//   npm run archive:pull                     # -> ./archives, everything
//   npm run archive:pull -- --dest ~/packets # somewhere else
//   npm run archive:pull -- --final          # only the permanent packets
//   npm run archive:pull -- --recheck        # re-verify what is already here
//
// Under the packet design (ARCHIVE.md §6) a finished game leaves the
// database, so the packet in the bucket is the ONLY copy of that transcript —
// this makes a second one. No database dependency: safe to run anywhere with
// the S3_* credentials. Never trusts the transfer: every download lands on a
// `.part` file, is verified by verifyPacket(), and only then renamed into
// place, so a half-written file never occupies the name. And never lets a
// packet reach git — the transcript names the character behind every
// /conceal and this repo is public, so the destination is gitignored and this
// writes a self-ignoring .gitignore into the folder too.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { verifyPacket } = require("../../lib/archiveExport");
const { bucketConfigured, listObjects, getObject, ARCHIVE_PREFIX } = require("../../lib/archiveBucket");

// `*` ignores this file too, hence the negation — otherwise the guard would
// disappear the first time somebody committed the folder deliberately.
const SELF_IGNORE = "# Archive packets: a public repo must never carry one.\n*\n!.gitignore\n";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
const has = (name) => process.argv.includes(`--${name}`);
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function main() {
  if (!bucketConfigured()) {
    console.error("No bucket credentials in this environment (S3_ENDPOINT / S3_BUCKET / AWS_*).");
    process.exitCode = 1;
    return;
  }

  const dest = path.resolve(arg("dest") || process.env.ARCHIVE_PULL_DIR || path.join(process.cwd(), "archives"));
  const prefix = has("final") ? `${ARCHIVE_PREFIX()}/final/` : `${ARCHIVE_PREFIX()}/`;

  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitignore"), SELF_IGNORE);

  const objects = (await listObjects(prefix))
    .filter((o) => o.key.endsWith(".jsonl.gz"))
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  console.log(`${objects.length} packet(s) under ${prefix} -> ${dest}\n`);

  const pulled = [];
  const skipped = [];
  const failed = [];

  for (const o of objects) {
    const rel = o.key.slice(ARCHIVE_PREFIX().length + 1); // key's own shape is the folder layout
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const here = fs.existsSync(out) ? fs.statSync(out).size : null;
    if (here === o.size && !has("recheck")) {
      skipped.push(rel);
      console.log(`  = ${rel}`);
      continue;
    }
    if (here === o.size) {
      // --recheck: right size, so verify the bytes without downloading again.
      try {
        await verifyPacket(out);
        skipped.push(rel);
        console.log(`  = ${rel}  (re-verified)`);
      } catch (err) {
        // Moved aside rather than deleted: bit rot doesn't change the size,
        // so leaving it on the name would mean every later run skips it.
        fs.renameSync(out, `${out}.corrupt`);
        failed.push({ rel, why: `${err.message} — moved aside to ${rel}.corrupt` });
        console.log(`  ! ${rel}  ${err.message}`);
      }
      continue;
    }

    const part = `${out}.part`;
    try {
      fs.writeFileSync(part, await getObject(o.key));
      const manifest = await verifyPacket(part);
      fs.renameSync(part, out);
      pulled.push(rel);
      console.log(`  + ${rel}  ${mb(o.size)}, ${manifest.entryCount} entries, game ${manifest.gameId}`);
    } catch (err) {
      fs.rmSync(part, { force: true });
      failed.push({ rel, why: err.message });
      console.log(`  ! ${rel}  ${err.message}`);
    }
  }

  console.log(`\n${pulled.length} pulled, ${skipped.length} already here, ${failed.length} failed.`);
  if (failed.length) {
    console.log("\nNone of these hold the name any more, so a re-run will fetch them again:");
    for (const f of failed) console.log(`  ${f.rel}: ${f.why}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
