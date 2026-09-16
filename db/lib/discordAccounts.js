// The Discord handle behind an account, cached so a GM can search "peace.lock"
// instead of a snowflake. Discord does not let us look a handle up by name, and
// nothing else in the schema stores one — Character keys on discordUserId and
// renders the name live (Action.reviewedByDiscordUserId's comment), which works
// on a page that already has the member in hand and not at all anywhere else.
//
// It is a CACHE, not an identity table. Auth still resolves through
// Character.discordUserId and nothing here gates anything. A row is one Discord
// ACCOUNT, not one character: a player with three characters has one handle, and
// storing it per character would let the copies disagree.
//
// Handles are mutable, so every write site is a reconcile rather than a
// create-once — the bot's member sweep, a web sign-in, and the mirror all upsert
// the same rows through here. Prisma-free and pure except the two functions that
// take `prisma` as a parameter, the db/lib/dm.js convention.

// The columns anything reconciling an account must select. Export and use it —
// a caller that omits `globalName` gets `undefined` back from diffAccountRows
// and rewrites every row on every pass. (CURSE_SELECT's lesson.)
const DISCORD_ACCOUNT_SELECT = {
  discordUserId: true,
  username: true,
  globalName: true,
};

// A handle for LOOKUP, not for display — the stored `username` keeps Discord's
// own casing. Discord handles are already lowercase in practice, but a GM types
// what they see, and they may paste it with the @ still attached.
function normalizeHandle(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@+/, "");
  return trimmed ? trimmed.toLowerCase() : null;
}

// Guild members -> rows. Accepts BOTH member shapes on purpose: discord.js
// (the bot's gateway fetch) spells it `globalName`, Discord's REST list (the
// one the mirror already holds) spells it `global_name`. Reading one would
// blank every display name coming from the other and rewrite the row on every
// pass, forever.
//
// Bots are skipped: they are not players, and the guild's own bots would
// otherwise sit in a table a GM searches. A member with no username is dropped
// rather than stored blank, so a missing row always means "never seen" and
// never "seen, but useless".
function accountRowsFromMembers(members) {
  const byId = new Map();
  for (const member of members ?? []) {
    const user = member?.user ?? member;
    if (!user || user.bot) continue;
    const discordUserId = member?.id ?? user.id;
    if (!discordUserId || !user.username) continue;
    // Last write wins; a members.fetch() can hand back the same member twice.
    byId.set(String(discordUserId), {
      discordUserId: String(discordUserId),
      username: user.username,
      globalName: user.globalName ?? user.global_name ?? null,
    });
  }
  return [...byId.values()];
}

// What actually changed. Pure so the sweep can report a real count and, more to
// the point, write nothing on the overwhelmingly common pass where nobody has
// renamed themselves — this runs over every guild member at every boot.
//
// An account in `existing` that `incoming` does not mention is LEFT ALONE. A
// member leaving the guild does not unmake the handle behind their archive
// lines, and this pass only ever sees who is currently there.
function diffAccountRows(incoming, existing) {
  const before = new Map((existing ?? []).map((row) => [row.discordUserId, row]));
  const toCreate = [];
  const toUpdate = [];
  for (const row of incoming ?? []) {
    const prior = before.get(row.discordUserId);
    if (!prior) {
      toCreate.push(row);
    } else if (prior.username !== row.username || (prior.globalName ?? null) !== row.globalName) {
      toUpdate.push(row);
    }
  }
  return { toCreate, toUpdate };
}

// What a reconcile WOULD do. Read-only, deliberately split from the write below
// so db/lib/discordMirror/ can honour its dry run: the mirror reports drift on
// every run and only repairs under `--apply`, and a planner that wrote anyway
// would make a dry run a lie.
async function planDiscordAccountSync(prisma, rows) {
  const incoming = rows ?? [];
  if (!incoming.length) return { toCreate: [], toUpdate: [], unchanged: 0 };

  const existing = await prisma.discordAccount.findMany({
    where: { discordUserId: { in: incoming.map((r) => r.discordUserId) } },
    select: DISCORD_ACCOUNT_SELECT,
  });
  const { toCreate, toUpdate } = diffAccountRows(incoming, existing);
  return {
    toCreate,
    toUpdate,
    unchanged: incoming.length - toCreate.length - toUpdate.length,
  };
}

// The write half of a plan. Only the rows that drifted — never a blind upsert
// per member, which would be 100+ writes at every boot.
async function applyDiscordAccountSync(prisma, { toCreate, toUpdate }) {
  if (toCreate?.length) {
    // skipDuplicates: a sign-in can insert the same account between the plan's
    // read and this write, and losing that race must not fail a whole sweep.
    await prisma.discordAccount.createMany({ data: toCreate, skipDuplicates: true });
  }
  for (const row of toUpdate ?? []) {
    await prisma.discordAccount.update({
      where: { discordUserId: row.discordUserId },
      data: { username: row.username, globalName: row.globalName },
    });
  }
  return { created: toCreate?.length ?? 0, updated: toUpdate?.length ?? 0 };
}

// Plan and write in one go, for the callers that always mean to write — the
// bot's boot sweep and single-member sightings.
async function syncDiscordAccounts(prisma, rows) {
  const plan = await planDiscordAccountSync(prisma, rows);
  const { created, updated } = await applyDiscordAccountSync(prisma, plan);
  return { created, updated, unchanged: plan.unchanged };
}

// One account, from a place that has it in hand — the web's sign-in callback.
// Upsert rather than the diff above: it is a single row and already a write.
async function rememberDiscordAccount(prisma, { discordUserId, username, globalName = null }) {
  if (!discordUserId || !username) return null;
  const data = { username, globalName: globalName ?? null };
  return prisma.discordAccount.upsert({
    where: { discordUserId: String(discordUserId) },
    create: { discordUserId: String(discordUserId), ...data },
    update: data,
  });
}

// "peace.lock" -> the account, or null. Case-insensitive because a GM types
// what they see; `mode: "insensitive"` rather than a stored lowercase column,
// so the table keeps Discord's own casing for display.
async function resolveDiscordHandle(prisma, handle) {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;
  return prisma.discordAccount.findFirst({
    where: { username: { equals: normalized, mode: "insensitive" } },
    select: DISCORD_ACCOUNT_SELECT,
  });
}

module.exports = {
  DISCORD_ACCOUNT_SELECT,
  normalizeHandle,
  accountRowsFromMembers,
  diffAccountRows,
  planDiscordAccountSync,
  applyDiscordAccountSync,
  syncDiscordAccounts,
  rememberDiscordAccount,
  resolveDiscordHandle,
};
