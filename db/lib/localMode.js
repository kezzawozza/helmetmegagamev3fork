// Runs this app with no real Discord credentials, no live writes reaching a
// real guild. Hooks into `db/lib/discordRest.js#discordRequest` (the ONE
// place every REST call goes through, ARCHITECTURE.md §5): a recognized
// superadmin id (db/lib/roleIds.js#SUPERADMIN_DISCORD_IDS) fakes the full
// GM/Playtest/Leader-Whitelist bundle, any other id gets only Player (so
// /gm/* still bounces), and writes are appended to LOCAL_OUTBOX_PATH with a
// stand-in so `.id` reads don't throw. Nothing else should grow its own
// `if (isLocalMode())` Discord branch — extend localDiscordRequest/localMember
// here instead (web/lib/superadmin.js already just checks the same allowlist).
// Turn on with LOCAL_MODE=true; DISCORD_TOKEN/DISCORD_GUILD_ID still need to
// be SET to a placeholder (web/lib/discordGuild.js returns early if either is
// falsy) but their real values are never read.

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

// Every role a superadmin's local session is granted. TRIAL_GM_ROLE_ID alone
// satisfies hasGmRole() with no DISCORD_GM_ROLE_ID needed. Cursed and Spectator
// are deliberately absent — those are personas, not access.
const LOCAL_ROLES = [TRIAL_GM_ROLE_ID, PLAYTEST_ROLE_ID, CONTRIBUTOR_ROLE_ID, PLAYER_ROLE_ID, LEADER_WHITELIST_ROLE_ID];

// Only a recognized superadmin id fakes the full bundle; anything else gets
// just Player, so it's bounced from /gm/* like a real non-GM account.
function localMember(userId) {
  const roles = SUPERADMIN_DISCORD_IDS.includes(userId) ? [...LOCAL_ROLES] : [PLAYER_ROLE_ID];
  return {
    user: { id: userId, username: "local-dev", global_name: "Local Tester", avatar: null },
    roles,
  };
}

// Append-only, one JSON object per line, so a stubbed call is one line to tail. Gitignored.
const LOCAL_OUTBOX_PATH = path.resolve(__dirname, "..", "..", "local-discord-outbox.jsonl");

function logStub(method, discordPath, body) {
  const line = JSON.stringify({ at: new Date().toISOString(), method, path: discordPath, body }) + "\n";
  try {
    fs.appendFileSync(LOCAL_OUTBOX_PATH, line);
  } catch (err) {
    console.error("localMode: failed to write the outbox log:", err);
  }
}

// Unique across PROCESSES, not just within one — the counter used to restart
// at 1 every run, so two separate local runs could each mint "local-1" and
// hand it to a different row. A real Discord id is never reused, so neither is
// this one.
const fakeIdPrefix = `local-${process.pid.toString(36)}`;
let fakeIdSeq = 0;

// The local answer to discordRequest(path, opts) — never touches the network.
function localDiscordRequest(discordPath, { method = "GET", body } = {}) {
  const segments = discordPath.split("?")[0].split("/").filter(Boolean);

  // GET /guilds/:id/members/:userId — the one lookup every permission check rests on.
  if (method === "GET" && segments[0] === "guilds" && segments[2] === "members" && segments[3]) {
    return Promise.resolve(localMember(segments[3]));
  }

  // The roster: a local session is a guild of one. Empty also terminates
  // listGuildMembers()'s `after`-cursor pagination loop on the first page.
  if (method === "GET" && segments[0] === "guilds" && segments[2] === "members") {
    return Promise.resolve([]);
  }

  // Create/edit/delete: logged instead of sent, stand-in shaped so `.id` reads don't throw.
  if (method !== "GET") {
    logStub(method, discordPath, body);
    fakeIdSeq += 1;
    return Promise.resolve({
      id: `${fakeIdPrefix}-${fakeIdSeq}`,
      channel_id: segments[1] ?? null,
      content: body?.content ?? null,
      token: "local-webhook-token",
    });
  }

  // fetchActiveThreads/listArchivedThreads read `.threads`/`.has_more` directly — a bare `[]` would throw.
  if (method === "GET" && segments.at(-1) === "active") return Promise.resolve({ threads: [] });
  if (method === "GET" && segments.includes("archived")) {
    return Promise.resolve({ threads: [], has_more: false });
  }

  // Every other read: nothing exists locally. List endpoints end pluralized; a single-item fetch ends in an id.
  const tail = segments.at(-1) ?? "";
  const looksSingular = /^\d+$/.test(tail);
  return Promise.resolve(looksSingular ? null : []);
}

module.exports = {
  isLocalMode,
  localDiscordRequest,
};
