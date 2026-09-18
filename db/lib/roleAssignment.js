// The roll: who gets which seat when the game starts (docs/systemdocs/
// LOBBY.md §3). A pure function over plain data, so Preview and Start run
// exactly the same thing and the test file can too.
//
// Ported from tgstation's SSjob.divide_occupations:
//   1. shuffle the readied players;
//   2. head-of-staff pass — HIGH, then MEDIUM, then LOW, every unassigned
//      player who wants a leader seat at that level gets one at random;
//   3. main pass — same three levels over every seat;
//   4. whoever is left gets their jobless fallback: the overflow seat they
//      named (Migrant, unlimited) or a walk back to the lobby.
//
// No "overflow first" pass — the fallback dropdown is the overflow. No head
// is ever forced; an unwanted whitelisted seat stays empty and is a warning.
// The shuffle and every pick come from a seeded generator, so a previewed
// draft is the draft Start commits, hand-set rows included.

const { roleCapacity } = require("./roleCapacity");

const LEVEL_ORDER = ["HIGH", "MEDIUM", "LOW"];
// Migrant is the only overflow seat now. A jobless preference naming no seat
// walks to the lobby, which is what the fallback below already did for a
// missing slug.
const OVERFLOW_SLUG = { MIGRANT: "migrant" };

// Good enough for a shuffle — not a security boundary.
function hashSeed(seed) {
  let h = 2166136261;
  const text = String(seed ?? "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// players:  [{ discordUserId, priorities: { [slug]: level }, joblessRole, whitelisted }]
// roles:    [{ slug, name, isUnique, unlimited, weight, requiresWhitelist, spawnOnly }]
// taken:    Map<slug, number> — seats already held before the roll
// Returns { rows: [{ discordUserId, roleSlug, source }], warnings: [string], seed }
function assignRoles({ players, roles, taken = new Map(), playerCount, leaderWhitelistEnabled = true, seed }) {
  const rng = mulberry32(hashSeed(seed));
  const used = new Map();
  const result = new Map();

  const capOf = (role) => roleCapacity(role, playerCount);
  const heldOf = (role) => (taken.get(role.slug) ?? 0) + (used.get(role.slug) ?? 0);
  const isOpen = (role) => capOf(role) - heldOf(role) > 0;
  const mayHold = (player, role) =>
    !role.spawnOnly && (!role.requiresWhitelist || !leaderWhitelistEnabled || player.whitelisted);
  const eligible = (player, role) => mayHold(player, role) && isOpen(role);

  function assign(player, role, source) {
    result.set(player.discordUserId, { discordUserId: player.discordUserId, roleSlug: role.slug, source });
    used.set(role.slug, (used.get(role.slug) ?? 0) + 1);
  }

  const order = shuffled(players, rng);

  // Reserved pass, then everyone: the same loop, run once restricted to the
  // whitelisted seats. Those are the named ones the game cannot open without —
  // the Baron, the Bishop, the Merchant — so they are filled before the roll
  // spends a willing player on a Commoner. This used to run off `grantsLeader`,
  // which meant the same ten seats plus a faction office behind them; the
  // office is gone and the whitelist is the list that survived it.
  for (const reservedOnly of [true, false]) {
    for (const level of LEVEL_ORDER) {
      for (const player of order) {
        if (result.has(player.discordUserId)) continue;
        const candidates = roles.filter(
          (role) =>
            (player.priorities?.[role.slug] ?? null) === level &&
            (!reservedOnly || role.requiresWhitelist) &&
            eligible(player, role),
        );
        if (candidates.length === 0) continue;
        assign(player, candidates[Math.floor(rng() * candidates.length)], level);
      }
    }
  }

  // Overflow is unlimited so always open; if the YAML ever lost it, walk to lobby.
  const bySlug = new Map(roles.map((r) => [r.slug, r]));
  for (const player of order) {
    if (result.has(player.discordUserId)) continue;
    const overflow = bySlug.get(OVERFLOW_SLUG[player.joblessRole] ?? "");
    if (overflow && eligible(player, overflow)) assign(player, overflow, "FALLBACK");
    else result.set(player.discordUserId, { discordUserId: player.discordUserId, roleSlug: null, source: "FALLBACK" });
  }

  const rows = players.map((p) => result.get(p.discordUserId));

  const warnings = [];
  const unwantedReserved = roles.filter(
    (role) =>
      role.requiresWhitelist &&
      !role.spawnOnly &&
      isOpen(role) &&
      !players.some((p) => p.priorities?.[role.slug] && mayHold(p, role)),
  );
  if (unwantedReserved.length) {
    warnings.push(`The following reserved seats aren't asked for by anyone: ${unwantedReserved.map((r) => r.name).join(", ")}.`);
  }
  const returning = rows.filter((r) => r.roleSlug === null).length;
  if (returning) warnings.push(`${returning} player${returning === 1 ? "" : "s"} will return to the lobby.`);
  const empty = players.filter((p) => Object.keys(p.priorities ?? {}).length === 0).length;
  if (empty) warnings.push(`${empty} readied with every role Off.`);

  return { rows, warnings, seed: String(seed ?? "") };
}

// Time plus a little noise, short enough to read off the panel.
function newSeed() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

module.exports = { assignRoles, newSeed };
