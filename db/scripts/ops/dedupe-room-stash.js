// Removes the room-stash items `db:sync-zones` re-created after players had
// already carried them off, and the copies of those since picked up. Dry run
// by default; `-- --apply` writes.
//
//   npm run db:dedupe-room-stash                        # the plan, writes nothing
//   npm run db:dedupe-room-stash -- --report ~/x.txt    # ...and save it to a file
//   npm run db:dedupe-room-stash -- --apply             # do it
//
// THE BUG: `syncZones.js#seedRoomStash` creates a RoomTag only when no row
// exists — but taking the last unit DELETES the row, so "emptied" and
// "never seeded" are the same state and a re-sync refills the room. PROOF: a
// RoomTag row whose `createdAt` falls inside a known sync run, on a pair a
// player had demonstrably drawn down first — everything else is reported and
// left alone. WHICH COPY GOES: the ground one; a player keeps what they
// carried off. Deletions go through dropRoomTag/dropCharacterTag, not raw
// prisma, to keep the room lock and clamps consistent.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { prisma } = require("../../index");
const { dropRoomTag, dropCharacterTag } = require("../../lib/tagWrites");
const { sendDm } = require("../../lib/dm");

// The one bad run's window; widen only with the same kind of evidence.
const BURST_START = new Date("2026-09-10T22:34:00.000Z");
const BURST_END = new Date("2026-09-10T22:35:00.000Z");

const APPLY = process.argv.includes("--apply");
const reportIdx = process.argv.indexOf("--report");
const REPORT_PATH = reportIdx >= 0 ? process.argv[reportIdx + 1] : null;

const DM_TEXT = "A duplicate item was removed.";
const SYSTEM_ACTOR = "system"; // AuditLog.actorDiscordUserId is NOT NULL

// Every authored stash line in docs/zones.yaml as (roomSlug, tagSlug, qty).
function authoredStashes() {
  const file = path.join(__dirname, "..", "..", "..", "docs", "zones.yaml");
  const doc = yaml.load(fs.readFileSync(file, "utf8"));
  const out = new Map();
  const walk = (locations) => {
    for (const loc of Object.values(locations || {})) {
      for (const [roomSlug, room] of Object.entries(loc.rooms || {})) {
        const stash = room.stash;
        if (!stash) continue;
        if (Array.isArray(stash)) {
          for (const slug of stash) out.set(`${roomSlug}::${slug}`, 1);
        } else if (typeof stash === "object") {
          for (const [slug, n] of Object.entries(stash.items || {})) out.set(`${roomSlug}::${slug}`, n);
        }
      }
    }
  };
  for (const zone of Object.values(doc.zones || {})) {
    walk(zone.locations);
    for (const level of Object.values(zone.levels || {})) walk(level.locations);
  }
  return out;
}

// Every audited movement of a tag into or out of a room, as a flat timeline
// per (roomId, tagId). `request_transfer_tag` is the only actionType that
// moves a stack between a room and a character.
async function roomTimelines() {
  const logs = await prisma.auditLog.findMany({
    where: { actionType: "request_transfer_tag" },
    select: { createdAt: true, details: true },
    orderBy: { createdAt: "asc" },
  });
  const timelines = new Map();
  const push = (roomId, tagId, event) => {
    const key = `${roomId}::${tagId}`;
    if (!timelines.has(key)) timelines.set(key, []);
    timelines.get(key).push(event);
  };
  for (const log of logs) {
    const d = log.details || {};
    if (!d.tagId) continue;
    const n = d.quantity || 1;
    if (d.from?.kind === "room") push(d.from.id, d.tagId, { when: log.createdAt, delta: -n, party: d.to });
    if (d.to?.kind === "room") push(d.to.id, d.tagId, { when: log.createdAt, delta: +n, party: d.from });
  }
  return timelines;
}

// Classify one authored (room, tag) pair.
//
// The hard part is that the PROOF is destroyed by the thing we are looking
// for. A RoomTag row stamped inside the sync window is proof the sync made
// it — but if somebody has since picked that row clean, the row is gone and
// the timestamp with it. So there are two shapes of the same bug:
//
//   * row survives  — the surplus is still on the floor, createdAt proves it
//   * row consumed  — the stack was drawn to ZERO before the sync, and MORE
//                     came out of it after. Nothing but a re-seed can put
//                     units into an empty room, and none of the four
//                     audit-silent paths mints these tags (wantedPoster
//                     mints a UNIQUE paper per poster, not the generic one;
//                     the others mint corpses, Godflesh and structure yields)
//
// Anything else that does not add up predates the sync and is somebody
// else's mystery: reported, never acted on.
//
// Returns { kind: "clean" | "first-seed" | "duplicate" | "unexplained", ... }
function classify({ authoredQty, row, events }) {
  const before = events.filter((e) => e.when < BURST_START);
  const after = events.filter((e) => e.when >= BURST_START);

  // Replay the legitimate stack up to the sync. A dip below zero here happened
  // BEFORE this sync ran and is not ours to explain.
  let stockBefore = authoredQty;
  const priorGhosts = [];
  for (const e of before) {
    stockBefore += e.delta;
    if (stockBefore < 0) {
      priorGhosts.push({ party: e.party, quantity: -stockBefore, when: e.when });
      stockBefore = 0;
    }
  }

  const bornInBurst = row && row.createdAt >= BURST_START && row.createdAt <= BURST_END;
  const drawnDownFirst = before.some((e) => e.delta < 0);
  const emptiedBeforeSync = drawnDownFirst && stockBefore === 0;
  const tookMoreAfter = after.some((e) => e.delta < 0);

  // The sync made it, but nobody ever drew this stack down — so it was never
  // seeded at all (a tag that did not exist yet at game start is skipped with
  // a warning). An honest first seed.
  if (bornInBurst && !drawnDownFirst) return { kind: "first-seed", quantity: row.quantity };

  const injected = bornInBurst || (emptiedBeforeSync && tookMoreAfter) ? authoredQty : 0;

  if (injected > 0) {
    // Two buckets. A withdrawal draws on what the room legitimately still had
    // first — players keep what they were entitled to — and only the overflow
    // comes out of what the sync injected. Whoever drew that overflow is
    // holding a duplicate.
    let legit = stockBefore;
    let ghost = injected;
    const takers = [];
    for (const e of after) {
      if (e.delta > 0) { legit += e.delta; continue; } // somebody putting theirs back
      let want = -e.delta;
      const fromLegit = Math.min(want, legit);
      legit -= fromLegit;
      want -= fromLegit;
      const fromGhost = Math.min(want, ghost);
      if (fromGhost > 0) {
        ghost -= fromGhost;
        takers.push({ party: e.party, quantity: fromGhost, when: e.when });
      }
    }
    return {
      kind: "duplicate",
      evidence: bornInBurst ? "row survives" : "row consumed",
      onGround: row ? Math.min(ghost, row.quantity) : 0,
      takers,
      createdAt: row?.createdAt ?? null,
      lastTakenBefore: before.filter((e) => e.delta < 0).at(-1),
      priorGhosts,
    };
  }

  // No injection we can pin on the sync. Report anything still unaccounted for.
  let live = stockBefore;
  for (const e of after) {
    live += e.delta;
    if (live < 0) { priorGhosts.push({ party: e.party, quantity: -live, when: e.when }); live = 0; }
  }
  const actual = row?.quantity ?? 0;
  const onFloor = Math.max(0, actual - live);
  const carriedOff = priorGhosts.reduce((n, g) => n + g.quantity, 0);
  if (onFloor > 0 || carriedOff > 0) {
    return { kind: "unexplained", onFloor, carriedOff, ghostTakers: priorGhosts, actual, expected: live };
  }
  return { kind: "clean" };
}

async function main() {
  const authored = authoredStashes();
  const [rooms, tags, roomTags, timelines] = await Promise.all([
    prisma.room.findMany({ select: { id: true, slug: true, name: true } }),
    prisma.tag.findMany({ select: { id: true, slug: true, name: true } }),
    prisma.roomTag.findMany({ select: { roomId: true, tagId: true, quantity: true, createdAt: true } }),
    roomTimelines(),
  ]);
  const roomBySlug = new Map(rooms.map((r) => [r.slug, r]));
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]));
  const rowFor = new Map(roomTags.map((rt) => [`${rt.roomId}::${rt.tagId}`, rt]));

  // What a previous run already took. The floor half is naturally idempotent
  // — once the surplus is gone the stack reads clean — but the BAG half is
  // derived from audit history, which never changes, so without this a second
  // --apply would happily take another copy off every player. Keyed on the
  // withdrawal's own timestamp, which is unique per taker event.
  const alreadyDone = new Set(
    (await prisma.auditLog.findMany({
      where: { actionType: "stash_dedupe" },
      select: { details: true },
    }))
      .filter((r) => r.details?.where === "character")
      .map((r) => `${r.details.tagId}::${r.details.characterName}::${new Date(r.details.takenAt).toISOString()}`),
  );

  const duplicates = [];
  const firstSeeds = [];
  const unexplained = [];

  for (const [key, authoredQty] of authored) {
    const [roomSlug, tagSlug] = key.split("::");
    const room = roomBySlug.get(roomSlug);
    const tag = tagBySlug.get(tagSlug);
    if (!room || !tag) continue;
    const id = `${room.id}::${tag.id}`;
    const verdict = classify({
      authoredQty,
      row: rowFor.get(id),
      events: (timelines.get(id) || []).slice().sort((a, b) => a.when - b.when),
    });
    const entry = { room, tag, authoredQty, ...verdict };
    if (entry.takers) {
      entry.takers = entry.takers.filter(
        (t) => !alreadyDone.has(`${tag.id}::${t.party?.name}::${t.when.toISOString()}`),
      );
    }
    if (verdict.kind === "duplicate" && (entry.onGround > 0 || entry.takers.length)) duplicates.push(entry);
    else if (verdict.kind === "first-seed") firstSeeds.push(entry);
    else if (verdict.kind === "unexplained") unexplained.push(entry);
  }

  const groundUnits = duplicates.reduce((s, d) => s + d.onGround, 0);
  const bagUnits = duplicates.reduce((s, d) => s + d.takers.reduce((n, t) => n + t.quantity, 0), 0);

  // ---- the report ---------------------------------------------------------
  const L = [];
  const say = (line = "") => L.push(line);
  say("BASCINET — ROOM STASH DUPLICATES");
  say(`generated ${new Date().toISOString()}`);
  say("=".repeat(78));
  say();
  say("WHAT HAPPENED");
  say("  `npm run db:sync` ran against the live game at 22:34 UTC on 2026-09-10.");
  say("  seedRoomStash re-creates a stash item whenever no RoomTag row exists —");
  say("  but taking the last unit deletes that row, so an emptied stash and a");
  say("  never-seeded one look identical to it, and it refilled rooms players");
  say("  had already looted.");
  say();
  say(`  duplicate stacks:        ${duplicates.length}`);
  say(`  surplus still on floor:  ${groundUnits} units  (these get deleted)`);
  say(`  surplus now in bags:     ${bagUnits} units  (deleted from the holder)`);
  say(`  legitimate first seeds:  ${firstSeeds.length}  (left alone)`);
  say(`  unexplained surpluses:   ${unexplained.length}  (reported only — need a human)`);
  say();
  say("=".repeat(78));
  say();
  say("1. TO DELETE — surplus lying on the floor");
  say("   The sync put these back after a player had taken them. The player keeps");
  say("   what they carried off; this is the copy that should not exist.");
  say();
  for (const d of duplicates.filter((d) => d.onGround > 0).sort((a, b) => a.room.name.localeCompare(b.room.name))) {
    const took = d.lastTakenBefore
      ? `player took it ${d.lastTakenBefore.when.toISOString().slice(0, 16).replace("T", " ")}`
      : "drawn down before the sync";
    say(`   ${d.room.name.padEnd(24)} ${(`${d.tag.name} x${d.onGround}`).padEnd(38)}`);
    say(`   ${" ".repeat(24)} sync created ${d.createdAt.toISOString().slice(11, 19)}, ${took}`);
  }
  say();
  say("2. TO DELETE — surplus already picked up");
  say("   An injected unit somebody has since pocketed. Taken from whoever picked");
  say("   it up, by the audit trail.");
  say();
  const anyTakers = duplicates.filter((d) => d.takers.length);
  if (!anyTakers.length) say("   (none)");
  for (const d of anyTakers) {
    for (const t of d.takers) {
      say(`   ${(t.party?.name ?? "?").padEnd(28)} ${(`${d.tag.name} x${t.quantity}`).padEnd(30)} took it ${t.when.toISOString().slice(11, 19)} from ${d.room.name}`);
    }
  }
  say();
  say("3. NOT TOUCHING — unexplained surplus");
  say("   More stock than the ledger accounts for, but NOT created by the sync");
  say("   burst. Something else made these. Four room-stack paths write no audit");
  say("   row at all (corpseMint, refinery revert, structureYieldPass,");
  say("   wantedPoster), so this may be innocent. Needs a human decision.");
  say();
  if (!unexplained.length) say("   (none)");
  for (const u of unexplained.sort((a, b) => (b.onFloor + b.carriedOff) - (a.onFloor + a.carriedOff))) {
    say(`   ${u.room.name} — ${u.tag.name} (authored ${u.authoredQty})`);
    if (u.onFloor > 0) say(`     +${u.onFloor} on the floor: holds ${u.actual}, ledger explains ${u.expected}`);
    for (const g of u.ghostTakers) {
      say(`     +${g.quantity} carried off by ${g.party?.name ?? "?"} at ${g.when.toISOString().slice(0, 16).replace("T", " ")} — more left the room than ever entered it`);
    }
  }
  say();
  say("4. NOT TOUCHING — legitimate first seeds");
  say("   Created by the same sync run, but no player ever drew these down. Their");
  say("   Tag rows were made at 17:24 on 09-10, AFTER the 16:05 game start — so");
  say("   at 16:05 the tags did not exist and seedRoomStash skipped them with its");
  say("   'unknown tag' warning. This run was their first honest seed.");
  say();
  if (!firstSeeds.length) say("   (none)");
  for (const f of firstSeeds.sort((a, b) => a.room.name.localeCompare(b.room.name))) {
    say(`   ${f.room.name.padEnd(24)} ${f.tag.name} x${f.quantity}`);
  }
  say();
  say("=".repeat(78));
  say("Players losing an item are DMed exactly: \"A duplicate item was removed.\"");
  say("Every deletion writes an AuditLog row (stash_dedupe) readable at /gm/audit.");

  const report = L.join("\n");
  console.log(report);
  if (REPORT_PATH) {
    const target = REPORT_PATH.replace(/^~/, process.env.HOME);
    fs.writeFileSync(target, `${report}\n`, "utf8");
    console.log(`\nreport written to ${target}`);
  }

  if (!APPLY) {
    console.log(`\nDry run — re-run with \`-- --apply\` to delete ${groundUnits + bagUnits} unit(s).`);
    return;
  }

  // ---- apply --------------------------------------------------------------
  let deleted = 0;
  const dmTargets = new Map();

  for (const d of duplicates) {
    if (d.onGround > 0) {
      const res = await prisma.$transaction(async (tx) => {
        const ok = await dropRoomTag(tx, d.room.id, d.tag.id, d.onGround);
        if (!ok.ok) return false;
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: SYSTEM_ACTOR,
            actionType: "stash_dedupe",
            details: {
              where: "room", roomId: d.room.id, roomName: d.room.name,
              tagId: d.tag.id, tagName: d.tag.name, quantity: d.onGround,
              seededAt: d.createdAt, reason: "re-seeded by db:sync-zones over a stack players had emptied",
            },
          },
        });
        return true;
      });
      if (res) { deleted += d.onGround; console.log(`  - ${d.room.name}: ${d.tag.name} x${d.onGround} (floor)`); }
      else console.log(`  ! skipped ${d.room.name}/${d.tag.name} — stack moved since the report, re-run`);
    }
    for (const t of d.takers) {
      if (t.party?.kind !== "character" || !t.party.id) {
        console.log(`  ! skipped ${d.tag.name} x${t.quantity} — went to ${t.party?.kind ?? "?"}, not a character`);
        continue;
      }
      const character = await prisma.character.findUnique({
        where: { id: t.party.id }, select: { id: true, name: true, discordUserId: true },
      });
      if (!character) { console.log(`  ! skipped ${d.tag.name} x${t.quantity} — character ${t.party.name} is gone`); continue; }
      // The duplicate may have moved on since — eaten, written on, handed to
      // somebody else. Take only what is actually still there and say so:
      // chasing it down the chain risks deleting the NEXT person's legitimate
      // copy, which is a worse error than leaving one duplicate in play.
      const held = await prisma.characterTag.findFirst({
        where: { characterId: character.id, tagId: d.tag.id }, select: { quantity: true },
      });
      const take = Math.min(t.quantity, held?.quantity ?? 0);
      if (take < t.quantity) {
        console.log(`  ! ${character.name}: ${d.tag.name} — wanted ${t.quantity}, holds ${held?.quantity ?? 0}${take ? `, taking ${take}` : ", skipping"}`);
      }
      if (take === 0) continue;
      t.quantity = take;
      await prisma.$transaction(async (tx) => {
        await dropCharacterTag(tx, character.id, d.tag.id, t.quantity);
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: SYSTEM_ACTOR,
            actionType: "stash_dedupe",
            targetCharacterId: character.id,
            details: {
              where: "character", characterName: character.name,
              roomId: d.room.id, roomName: d.room.name,
              tagId: d.tag.id, tagName: d.tag.name, quantity: t.quantity,
              takenAt: t.when, seededAt: d.createdAt,
              reason: "picked up a unit db:sync-zones had re-seeded over an emptied stack",
            },
          },
        });
      });
      deleted += t.quantity;
      if (character.discordUserId) dmTargets.set(character.discordUserId, character.name);
      console.log(`  - ${character.name}: ${d.tag.name} x${t.quantity} (inventory)`);
    }
  }

  // Post-commit, and best-effort: a Discord outage must not undo the cleanup.
  for (const [discordUserId, name] of dmTargets) {
    await sendDm(prisma, discordUserId, DM_TEXT).catch((err) =>
      console.error(`  ! DM to ${name} failed: ${err.message}`));
  }

  console.log(`\nDeleted ${deleted} unit(s). DMed ${dmTargets.size} player(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
