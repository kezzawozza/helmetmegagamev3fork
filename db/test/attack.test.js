// The strength gate on the Attack button (ATTACK.md), the only thing a
// player ever learns about somebody else's fighting band (COMBAT.md §5). The
// capped-champion case decided the shape: floor:/cap: tags move the BAND
// after points are summed, so a bound Expert still scores 55 — a score-based
// gate would let a tied-up champion refuse to be attacked.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { ATTACK_COOLDOWN_MS, attackCooldown, attackRefusal, bestBandRank, cancelAttack, closeFightsFor, fileAttack, MAX_BAND_GAP, TOO_STRONG } = require("../lib/attack");
const { bandRank } = require("../lib/fightingSkill");

// A held row in the shape every surface passes: `{ tag, equipped }`.
function row(slug, fighting, extra = {}) {
  return { equipped: true, ...extra, tag: { slug, name: slug, fighting } };
}
// Rungs: Basic 1, Trained 2, Skilled 3, Expert 4. Untrained is no row at all.
const rung = (n) => row(`melee-${n}`, { tree: "melee", rung: n });

test("everybody starts Weak, on both halves", () => {
  assert.equal(bestBandRank([]), bandRank("weak"));
});

test("a peasant may attack a peasant", () => {
  assert.equal(attackRefusal([], []), null);
});

test("a peasant may attack two bands up, and no further", () => {
  // Weak(1) -> Capable(3) is exactly MAX_BAND_GAP.
  assert.equal(bestBandRank([rung(2)]), bandRank("capable"));
  assert.equal(attackRefusal([], [rung(2)]), null);
  // Weak(1) -> Seasoned(4) is one past it.
  assert.equal(bestBandRank([rung(3)]), bandRank("seasoned"));
  assert.equal(attackRefusal([], [rung(3)]), TOO_STRONG);
});

test("the gap is what matters, not the height", () => {
  // A Seasoned fighter may attack a Lethal one: still two bands.
  assert.equal(attackRefusal([rung(3)], [rung(5)]), null);
  assert.equal(attackRefusal([rung(3)], [rung(6)]), TOO_STRONG);
});

test("punching down is never refused", () => {
  assert.equal(attackRefusal([rung(4)], []), null);
});

test("the better half of the tree answers for each side", () => {
  const marksman = [row("ranged-expert", { tree: "ranged", rung: 4 })];
  assert.equal(bestBandRank(marksman), bandRank("dangerous"));
  assert.equal(attackRefusal([], marksman), TOO_STRONG);
  assert.equal(attackRefusal(marksman, [rung(3)]), null);
});

test("a CAPPED champion is attackable — the case bands exist for", () => {
  const boundExpert = [rung(4), row("bound", { tree: "both", cap: "pitiful" })];
  assert.equal(bestBandRank(boundExpert), bandRank("pitiful"));
  assert.equal(attackRefusal([], boundExpert), null);
});

test("a FLOORED champion is refused, however little they hold", () => {
  const apex = [row("apex-form", { tree: "both", floor: "legendary" })];
  assert.equal(bestBandRank(apex), bandRank("legendary"));
  assert.equal(attackRefusal([], apex), TOO_STRONG);
});

test("the tunable is a band count, and it is two", () => {
  assert.equal(MAX_BAND_GAP, 2);
});

// ─── Against the catalog as written ─────────────────────────────────────────
// Off docs/tags.yaml rather than a made-up tag: every incapacitating state
// caps the band at Pitiful, so a helpless champion is attackable by anybody.
const CATALOG = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "..", "docs", "tags.yaml"), "utf8"),
);
const catalogTags = CATALOG.tags ?? CATALOG;
const { normalizeFighting } = require("../lib/tagShapes");
const catalogRow = (slug) => ({
  equipped: true,
  tag: { slug, name: slug, fighting: normalizeFighting(catalogTags[slug]?.fighting) },
});

test("a helpless champion is attackable by anybody", () => {
  const champion = ["melee-expert", "melee-swords", "broadsword"].map(catalogRow);
  assert.equal(attackRefusal([], champion), TOO_STRONG); // untouchable on his feet
  for (const slug of ["bound", "crucified", "dying", "catatonic-afk", "paralyzed", "asleep", "unconscious", "seizure"]) {
    assert.equal(
      attackRefusal([], [...champion, catalogRow(slug)]),
      null,
      `a ${slug} champion should be attackable`,
    );
  }
});

// ─── The hold, end to end ───────────────────────────────────────────────────
// The hold is two columns on Character and a table; heldById names ONE
// opponent while a brawl has several. A small in-memory stand-in rather than
// a database — the two tables db/lib/attack.js touches, and db/test has no Postgres.
function fakeDb(ids) {
  let rows = [];
  const chars = Object.fromEntries(ids.map((id) => [id, { heldUntil: null, heldById: null, heldReason: null }]));
  const matchRow = (w, r) => {
    for (const [k, v] of Object.entries(w)) {
      if (k === "OR") {
        if (!v.some((o) => matchRow(o, r))) return false;
        continue;
      }
      if (k === "id" && v && v.in) {
        if (!v.in.includes(r.id)) return false;
        continue;
      }
      if (v === null) {
        if (r[k] !== null && r[k] !== undefined) return false;
        continue;
      }
      if (r[k] !== v) return false;
    }
    return true;
  };
  const db = {
    attack: {
      create: async ({ data }) => {
        const clash = rows.some(
          (r) =>
            r.attackerId === data.attackerId &&
            r.targetCharacterId === data.targetCharacterId &&
            r.turnId === data.turnId,
        );
        if (clash) {
          const err = new Error("unique");
          err.code = "P2002";
          throw err;
        }
        rows.push({ id: `r${rows.length}`, cancelledAt: null, ...data });
      },
      findUnique: async ({ where }) => {
        const key = where.attackerId_targetCharacterId_turnId ?? where;
        return rows.find((r) => matchRow(key, r)) ?? null;
      },
      findMany: async ({ where }) => rows.filter((r) => matchRow(where, r)),
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of rows) if (matchRow(where, r)) { Object.assign(r, data); count += 1; }
        return { count };
      },
    },
    character: {
      updateMany: async ({ where, data }) => {
        const c = chars[where.id];
        if (!c) return { count: 0 };
        if (where.heldReason?.in && !where.heldReason.in.includes(c.heldReason)) return { count: 0 };
        if (where.OR) { // clock guard: never shorten a hold already running longer
          const ok = where.OR.some(
            (o) => "heldUntil" in o && (o.heldUntil === null ? c.heldUntil == null : c.heldUntil < o.heldUntil.lt),
          );
          if (!ok) return { count: 0 };
        }
        Object.assign(c, data);
        return { count: 1 };
      },
    },
    turn: { findFirst: async () => ({ id: "t1" }) },
  };
  return {
    db,
    chars,
    live: () => rows.filter((r) => !r.cancelledAt).map((r) => `${r.attackerId}->${r.targetCharacterId}`),
    held: () =>
      Object.fromEntries(
        Object.entries(chars).map(([k, v]) => [k, v.heldReason ? `${v.heldReason}<-${v.heldById}` : "free"]),
      ),
  };
}
const TURN = { id: "t1", startedAt: new Date() };
const who = (id) => ({ id, name: id.toUpperCase(), discordUserId: null, firstName: id, lastName: null, age: 30, gender: "MAN", concealed: false, status: "ALIVE", locationId: "L", updatedAt: new Date(), tags: [] });

test("an attack holds both sides, and they read different reasons", async () => {
  const f = fakeDb(["a", "b"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  assert.deepEqual(f.held(), { a: "attacking<-b", b: "attack<-a" });
});

test("a live fight refuses a second attack, and says so in its own words", async () => {
  const f = fakeDb(["a", "b"]);
  assert.equal((await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN })).ok, true);
  const again = await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  assert.equal(again.already, true);
  assert.equal(again.cooldownSecondsLeft, undefined); // not a cooldown — they are IN it
});

test("a broken-off fight waits out the hour, then restarts in the same row", async () => {
  const f = fakeDb(["a", "b"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  await cancelAttack(f.db, { attackerId: "a", targetCharacterId: "b", turnId: "t1" });
  assert.deepEqual(f.held(), { a: "free", b: "free" }); // the hold lifts, which is what made the old refusal a lie

  const tooSoon = await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.already, false);
  assert.ok(tooSoon.cooldownSecondsLeft > 0 && tooSoon.cooldownSecondsLeft <= 3600);

  const later = new Date(Date.now() + ATTACK_COOLDOWN_MS + 1000);
  const back = await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN, now: later });
  assert.equal(back.ok, true);
  assert.deepEqual(f.held(), { a: "attacking<-b", b: "attack<-a" }); // held again, both sides
  assert.deepEqual(f.live(), ["a->b"]); // reopened in place — still ONE row for the pair, not a second
});

test("attackCooldown counts down from the break off", () => {
  assert.deepEqual(attackCooldown(null), { ok: true, secondsLeft: 0 });
  const t = 10_000_000;
  assert.equal(attackCooldown(new Date(t), t).ok, false);
  assert.equal(attackCooldown(new Date(t), t).secondsLeft, 3600);
  assert.equal(attackCooldown(new Date(t), t + ATTACK_COOLDOWN_MS - 1).ok, false);
  assert.deepEqual(attackCooldown(new Date(t), t + ATTACK_COOLDOWN_MS), { ok: true, secondsLeft: 0 });
});

test("fighting back is its own row, and the roles flip when one side stops", async () => {
  const f = fakeDb(["a", "b"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  await fileAttack(f.db, { attacker: who("b"), target: who("a"), openTurn: TURN });
  await cancelAttack(f.db, { attackerId: "a", targetCharacterId: "b", turnId: "t1" });
  assert.deepEqual(f.held(), { a: "attack<-b", b: "attacking<-a" }); // only b->a left; both stay held
  await cancelAttack(f.db, { attackerId: "b", targetCharacterId: "a", turnId: "t1" });
  assert.deepEqual(f.held(), { a: "free", b: "free" });
});

test("one man leaving a brawl does not unpick it, now or later", async () => {
  const f = fakeDb(["a", "b", "c"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  await fileAttack(f.db, { attacker: who("c"), target: who("b"), openTurn: TURN });
  await cancelAttack(f.db, { attackerId: "a", targetCharacterId: "b", turnId: "t1" });
  assert.deepEqual(f.held(), { a: "free", b: "attack<-c", c: "attacking<-b" });
  await closeFightsFor(f.db, "a");
  assert.equal(f.held().b, "attack<-c");
  assert.deepEqual(f.live(), ["c->b"]);
});

test("a death closes the fight from EITHER end", async () => {
  const f = fakeDb(["a", "b"]);
  await fileAttack(f.db, { attacker: who("a"), target: who("b"), openTurn: TURN });
  await closeFightsFor(f.db, "b"); // the TARGET dies
  assert.deepEqual(f.held(), { a: "free", b: "free" });
  assert.deepEqual(f.live(), []);
});

// ─── attacksBy and the hooded opponent ─────────────────────────────────────
// The "You are fighting" list goes to a browser. /api/avatar/<id> answers with a face, so a hooded
// opponent must travel as a token — otherwise swinging at a stranger would unmask them, which is the
// one thing db/lib/intercept.js#matchesArrival is written to prevent.
const { attacksBy: attacksByFn } = require("../lib/attack");
const { hoodToken: hoodTokenFn } = require("../lib/hoodToken");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const maskTags = (over) =>
  over
    ? [{ equipped: true, tag: { forcedName: null, name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: true, equipLayer: 1 } }]
    : [];
const maskedFightRow = (id, name, masked) => ({
  targetCharacter: { id, name, concealed: false, age: 30, gender: "MAN", tags: maskTags(masked) },
});
const fakeAttackDb = (rows) => ({ attack: { findMany: async () => rows } });

test("attacksBy names an opponent in the open and hands back their id", async () => {
  const [row] = await attacksByFn(fakeAttackDb([maskedFightRow("c1", "Horvath", false)]), "me", "turn1");
  assert.equal(row.name, "Horvath");
  assert.equal(row.id, "c1");
  assert.equal(row.key, "character:c1");
});

test("attacksBy withholds a hooded opponent's id and travels as a token instead", async () => {
  const [row] = await attacksByFn(fakeAttackDb([maskedFightRow("c2", "Oleg", true)]), "me", "turn1");
  assert.equal(row.id, null, "a hooded opponent must carry no raw character id");
  assert.equal(row.key, `hood:${hoodTokenFn("c2")}`);
  assert.ok(!/Oleg/.test(row.name), "a hood is never named outright");
});

test("attacksBy answers nothing without an open turn", async () => {
  assert.deepEqual(await attacksByFn(fakeAttackDb([maskedFightRow("c1", "Horvath", false)]), "me", null), []);
});
