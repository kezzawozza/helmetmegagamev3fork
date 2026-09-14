// One toggleable surface for running this app with no real Discord
// credentials and no live writes reaching a real guild.
//
// `db/lib/discordRest.js#discordRequest` is the ONE place every Discord REST
// call in this codebase goes through — web, bot and db alike (ARCHITECTURE.md
// §5). That makes it the one point where local mode needs to hook in: a
// member/role lookup answers with a synthetic member, so isGm/isPlaytester/
// isApprovedPlayer/isLeaderWhitelisted all pass with no changes of their own
// — they just read member.roles. Which roles depends on the id being asked
// about: a recognized superadmin id (db/lib/roleIds.js#SUPERADMIN_DISCORD_IDS)
// gets the full GM/Playtest/Leader-Whitelist bundle, and any other id — a
// seeded character, "Start as a player", a `dev:session.mjs --character`
// impersonation — gets only the Player role, so a local session can still
// test the ordinary player view and still gets bounced from /gm/*. Anything
// that would have posted, edited or deleted content is appended to
// LOCAL_OUTBOX_PATH instead of reaching Discord, and answered with a
// plausible stand-in so a caller reading `.id` off the result doesn't throw.
//
// Nothing else should grow its own `if (isLocalMode())` branch for Discord
// behavior — extend localDiscordRequest/localMember here instead, so there is
// exactly one place that knows what "local mode" pretends Discord looks like.
//
// web/lib/superadmin.js#isSuperadmin doesn't need an isLocalMode() branch of
// its own any more: it just checks the same SUPERADMIN_DISCORD_IDS allowlist
// this file uses, and a locally-signed-in session carries a real
// discordUserId either way (the superadmin id, or whichever id was minted).
//
// Turn it on with LOCAL_MODE=true in .env. DISCORD_TOKEN and DISCORD_GUILD_ID
// still need to be SET to any non-empty placeholder — several callers in
// web/lib/discordGuild.js return early when either is falsy, before ever
// reaching discordRequest — but their real values are never read: this
// module intercepts before discordRequest so much as builds an auth header.

const fs = require("node:fs");
const path = require("node:path");
const {
  PLAYER_ROLE_ID,
  CONTRIBUTOR_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  PLAYTEST_ROLE_ID,
  TRIAL_GM_ROLE_ID,
  SUPERADMIN_DISCORD_IDS,
} = require("./roleIds");

function isLocalMode() {
  return process.env.LOCAL_MODE === "true";
}

// Every role a superadmin's locally-run session is granted. TRIAL_GM_ROLE_ID
// alone satisfies hasGmRole() (db/lib/roleIds.js) with no DISCORD_GM_ROLE_ID
// env var needed — it's a hardcoded id, not the env-configured one. Cursed and
// Spectator are deliberately absent: those are personas, not access, and
// nothing about "developing locally" should imply either one.
const LOCAL_ROLES = [TRIAL_GM_ROLE_ID, PLAYTEST_ROLE_ID, CONTRIBUTOR_ROLE_ID, PLAYER_ROLE_ID, LEADER_WHITELIST_ROLE_ID];

// Only a recognized superadmin id fakes the full GM/Playtest/Leader-Whitelist
// bundle. Anything else — a seeded character's discordUserId, a "Start as a
// player" account, a `dev:session.mjs --character` impersonation — gets just
// the Player role, so it is bounced from /gm/* the same way a real non-GM
// account would be. Without this split, every locally-run session looked like
// a GM to isGm()/isSuperadmin(), and there was no way to test the ordinary
// player view at all.
function localMember(userId) {
  const roles = SUPERADMIN_DISCORD_IDS.includes(userId) ? [...LOCAL_ROLES] : [PLAYER_ROLE_ID];
  return {
    user: { id: userId, username: "local-dev", global_name: "Local Tester", avatar: null },
    roles,
  };
}

// Append-only, one JSON object per line, so a stubbed call is one line to
// tail rather than a log format to parse. Gitignored — see .gitignore.
const LOCAL_OUTBOX_PATH = path.resolve(__dirname, "..", "..", "local-discord-outbox.jsonl");

function logStub(method, discordPath, body) {
  const line = JSON.stringify({ at: new Date().toISOString(), method, path: discordPath, body }) + "\n";
  try {
    fs.appendFileSync(LOCAL_OUTBOX_PATH, line);
  } catch (err) {
    console.error("localMode: failed to write the outbox log:", err);
  }
}

let fakeIdSeq = 0;

// The local answer to discordRequest(path, opts) — never touches the
// network. `path` still carries its query string; only the segments before
// "?" decide the shape of the reply.
function localDiscordRequest(discordPath, { method = "GET", body } = {}) {
  const segments = discordPath.split("?")[0].split("/").filter(Boolean);

  // GET /guilds/:id/members/:userId — one member, asked for by id. This is
  // the one lookup every permission check in the app ultimately rests on.
  if (method === "GET" && segments[0] === "guilds" && segments[2] === "members" && segments[3]) {
    return Promise.resolve(localMember(segments[3]));
  }

  // GET /guilds/:id/members[?...] — the roster. A local session is a guild of
  // one; nobody else is in it. Returning empty here (rather than a list
  // containing the local member) also terminates listGuildMembers()'s
  // `after`-cursor pagination loop on the first page.
  if (method === "GET" && segments[0] === "guilds" && segments[2] === "members") {
    return Promise.resolve([]);
  }

  // Anything that creates, edits or deletes content: logged instead of sent,
  // answered with a stand-in shaped enough that a caller reading `.id` (to
  // store a message id, say) doesn't throw.
  if (method !== "GET") {
    logStub(method, discordPath, body);
    fakeIdSeq += 1;
    return Promise.resolve({
      id: `local-${fakeIdSeq}`,
      channel_id: segments[1] ?? null,
      content: body?.content ?? null,
      token: "local-webhook-token",
    });
  }

  // Two endpoints hand back a wrapped `{ threads: [...] }` rather than a bare
  // array (fetchActiveThreads, listArchivedThreads) — the two callers
  // destructure/read `.threads` and `.has_more` directly, so a bare `[]`
  // here would leave `threads` undefined and throw on the next `.filter`.
  if (method === "GET" && segments.at(-1) === "active") return Promise.resolve({ threads: [] });
  if (method === "GET" && segments.includes("archived")) {
    return Promise.resolve({ threads: [], has_more: false });
  }

  // Every other read (channels, roles, message history…): nothing exists
  // locally, so the honest answer is empty rather than invented. Discord's
  // own list endpoints are pluralized at the tail; a single-item fetch
  // (getChannel, getForumTagId's getChannel call) ends in an id instead.
  const tail = segments.at(-1) ?? "";
  const looksSingular = /^\d+$/.test(tail);
  return Promise.resolve(looksSingular ? null : []);
}

module.exports = {
  isLocalMode,
  localDiscordRequest,
};
