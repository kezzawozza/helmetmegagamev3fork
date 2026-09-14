import { cache } from "react";
import { auth } from "@/lib/auth";
import {
  prisma,
  characterRoleAppearance,
  formatBareName,
  CATATONIC_SLUG,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  PLAYER_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  hasGmRole,
  hasPlaytestRole,
  hasContributorRole,
  SPECIAL_CHANNELS,
} from "@lifeweb/db";
import { applyDeathToRow } from "@lifeweb/db/lib/characterDeath";
import { applyDmPrefix, dmLogRow } from "@lifeweb/db/lib/dmPolicy";
import { buildNickname } from "@lifeweb/db/lib/nicknameFormat";
import {
  revokeAllCharacterAccess as revokeAllCharacterAccessShared,
  revokeAccessForCharacters as revokeAccessForCharactersShared,
} from "@lifeweb/db/lib/accessSweep";
import {
  putChannelOverwrite,
  deleteChannelOverwrite,
  discordRequest,
  postDmBatched,
} from "@lifeweb/db/lib/discordRest";
import { GHOST_ROLE_ID } from "@lifeweb/db/lib/roleIds";

// Channels opt into summary/tupper behavior by id — see bot/src/lib/channels.js
// for the bot-side twin (kept separate since the bot uses its gateway cache).
const CHANNEL_TYPE_TEXT = 0;
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Tupper/summary status is channel-ID-based.
// Since Bascinet 2 the tupper set is every Location channel plus each zone's
// #summary; #summary is also the channel a zone's summaries post to.
// #cerberon is tupper-only (no zone to summarize into).
export function isSummaryChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT) return false;
  return locationChannelIds?.tupperSummary?.has(channel.id) ?? false;
}

export function isTupperChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT) return false;
  return (
    (locationChannelIds?.tupperSummary?.has(channel.id) || locationChannelIds?.tupperOnly?.has(channel.id)) ?? false
  );
}

// Per-key TTL cache so repeated Discord lookups across navigations don't
// each cost a round trip. Fine at this scale (one Railway instance).
function ttlCache(ttlMs) {
  const store = new Map();
  return {
    // maxAgeMs, when given, is a tighter bound than the TTL: a caller that
    // has to see a role handed out in Discord a moment ago passes a small one.
    get(key, maxAgeMs) {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return undefined;
      if (maxAgeMs != null && Date.now() - entry.fetchedAt > maxAgeMs) return undefined;
      return entry.value;
    },
    // getStale: only for the failure path — serving a stale value beats both
    // inventing null (silently demotes a GM) and throwing (500s every player).
    getStale(key) {
      const entry = store.get(key);
      return entry ? entry.value : undefined;
    },
    set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs, fetchedAt: Date.now() });
    },
    delete(key) {
      store.delete(key);
    },
  };
}

const memberCache = ttlCache(5 * 60_000);
const memberListCache = ttlCache(5 * 60_000);

// In-flight dedup, keyed the same way as the TTL cache. At turn open ~120
// players arrive within seconds with cold keys; sharing the promise collapses
// concurrent misses for the same key into one call.
const inFlight = new Map();

function dedupe(key, run) {
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// Does NOT swallow errors into null: a 429 must stay distinguishable from
// "not in the guild", or a rate-limited GM gets silently bounced from /gm.
async function fetchGuildMember(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return null;

  return discordRequest(`/guilds/${guildId}/members/${discordUserId}`, { allow404: true });
}

// maxAgeMs: accept a cached member only this fresh (0 = always refetch). A
// number rather than an options object so React's cache() still memoizes the
// call per request. The character page's no-character branch and the creation
// gates use it — a Playtest or Player role granted in Discord a moment ago has
// to be visible there, and five minutes of "no Skip button" reads as a bug.
export const getGuildMember = cache(async (discordUserId, maxAgeMs) => {
  const cached = memberCache.get(discordUserId, maxAgeMs);
  if (cached !== undefined) return cached;

  try {
    const value = await dedupe(`member:${discordUserId}`, () => fetchGuildMember(discordUserId));
    memberCache.set(discordUserId, value);
    return value;
  } catch (err) {
    // Reuse the last known answer on a rate limit / outage; only degrade to
    // null once nothing has ever been cached for this user.
    const stale = memberCache.getStale(discordUserId);
    if (stale !== undefined) {
      console.error(`Guild member lookup failed for ${discordUserId}, serving stale: ${err.message}`);
      return stale;
    }
    console.error(`Guild member lookup failed for ${discordUserId}, no cached value: ${err.message}`);
    return null;
  }
});

async function fetchGuildMembers() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return [];

  const members = await discordRequest(`/guilds/${guildId}/members?limit=1000`);
  return members.map((m) => ({
    id: m.user.id,
    username: m.user.username,
    globalName: m.user.global_name ?? null,
    avatar: m.user.avatar ?? null,
    // The SERVER-specific avatar, which is a different picture from the one
    // above: `m.avatar` is the face somebody set for this guild, `m.user
    // .avatar` the one they wear everywhere. Carried here so gmProfiles.js can
    // build the GM roster out of this list instead of fetching the identical
    // /guilds/:id/members?limit=1000 a second time — see its own note.
    guildAvatar: m.avatar ?? null,
    roles: m.roles ?? [],
  }));
}

// Whether the last attempt to read the roster actually reached Discord.
//
// The list itself cannot answer that: the failure path below returns [], and
// so does LOCAL_MODE (db/lib/localMode.js — a local session is a guild of
// one). So "empty" means EITHER "Discord is down" OR "there is genuinely
// nobody", and a caller that guesses gets it wrong half the time. The player
// desk guessed, and turned a Discord blip into a 404 on an ordinary
// conversation; see (desk)/gm/players/[discordUserId]/page.js.
//
// Starts true: nothing has failed yet, and a caller asking before the first
// fetch should not be told the roster is unknowable.
let memberListReachable = true;

// Did the roster we are serving come from a successful read? A stale answer
// counts — it was real when it was fetched, and it still names real people.
export function isGuildRosterKnown() {
  return memberListReachable;
}

export const listGuildMembers = cache(async () => {
  const cached = memberListCache.get("all");
  if (cached !== undefined) return cached;
  try {
    const value = await dedupe("memberList", fetchGuildMembers);
    memberListCache.set("all", value);
    memberListReachable = true;
    return value;
  } catch (err) {
    const stale = memberListCache.getStale("all");
    console.error(`Guild member list failed${stale ? ", serving stale" : ""}: ${err.message}`);
    memberListReachable = stale !== undefined;
    return stale ?? [];
  }
});

const channelListCache = ttlCache(30_000);

async function fetchGuildChannels() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return [];

  return discordRequest(`/guilds/${guildId}/channels`);
}

export const listGuildChannels = cache(async () => {
  const cached = channelListCache.get("all");
  if (cached !== undefined) return cached;
  try {
    const value = await dedupe("channelList", fetchGuildChannels);
    channelListCache.set("all", value);
    return value;
  } catch (err) {
    const stale = channelListCache.getStale("all");
    console.error(`Guild channel list failed${stale ? ", serving stale" : ""}: ${err.message}`);
    return stale ?? [];
  }
});

// Either GM seat counts — the Gamemaster role and the Trial Gamemaster role
// are access-identical, and db/lib/roleIds.js#gmRoleIds is the only place that
// list lives. See docs/systemdocs/GAMEMASTERS.md.
export function isGm(member) {
  if (!member) return false;
  return hasGmRole(member.roles);
}

// The Playtest seat (db/lib/roleIds.js): passes the roster check without the
// Player role. It does NOT open the doors early — see creationOpen().
export function isPlaytester(member) {
  if (!member) return false;
  return hasPlaytestRole(member.roles);
}

// The Contributor seat (db/lib/roleIds.js): a person who works on Bascinet.
// Read by the playtest-mode roster gate below and nowhere else.
function isContributor(member) {
  if (!member) return false;
  return hasContributorRole(member.roles);
}

// Role ID hardcoded rather than env-configured: this gate fails CLOSED, so a
// missing env var would silently lock every player out.
export function isApprovedPlayer(member) {
  if (!member) return false;
  return member.roles?.includes(PLAYER_ROLE_ID) ?? false;
}

// Who counts as on the roster for this game — the one answer the lobby and
// both creation actions share, so they cannot drift apart.
//
// Normally that is the Player role, which the bot hands to everyone the moment
// they join the guild (bot/src/events/guildMemberAdd.js), or the Playtest seat.
// With GameConfig.playtestModeEnabled on, the door narrows to the people
// building the game: a GM, a playtester, or a Contributor. Superadmins bypass
// this entirely at every call site.
export function onRoster(member, { playtestMode = false } = {}) {
  if (playtestMode) {
    return isGm(member) || isPlaytester(member) || isContributor(member);
  }
  return isApprovedPlayer(member) || isPlaytester(member);
}

export function isLeaderWhitelisted(member) {
  if (!member) return false;
  return member.roles?.includes(LEADER_WHITELIST_ROLE_ID) ?? false;
}

export async function listGmMembers() {
  const members = await listGuildMembers();
  return members.filter((m) => hasGmRole(m.roles));
}

// Shared auth+role lookup for pages (redirect on failure) and server
// actions (throw) — callers decide what "not allowed" means.
export const getGmSession = cache(async () => {
  const session = await auth();
  if (!session?.discordUserId) return { session: null, isGm: false };
  const member = await getGuildMember(session.discordUserId);
  return { session, isGm: isGm(member) };
});

export async function deleteMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    allow404: true,
  });
}

export { buildNickname };

export async function updateGuildNickname(discordUserId, nickname) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return;

  try {
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}`, {
      method: "PATCH",
      body: { nick: nickname },
      allow404: true,
    });
  } catch (err) {
    console.error(`Failed to set nickname for ${discordUserId}:`, err);
  }
}

// `characterName` is always the BARE name (formatBareName). The 32-char cap
// is shared between the two halves, so a title never appears here.
export async function syncCharacterNickname(discordUserId, characterName) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) return;
  // Gated here rather than at the six call sites: "Play from the web" exists so
  // that nothing on Discord says which character this account is, and a
  // nickname is the loudest thing that could (docs/systemdocs/CHAT.md §6).
  const hidden = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE", webOnly: true },
    select: { id: true },
  });
  if (hidden) return;

  const member = await getGuildMember(discordUserId);
  if (!member) return;

  const base = member.user.global_name || member.user.username;
  await updateGuildNickname(discordUserId, buildNickname(base, characterName));
}

export async function setTurnPingRole(discordUserId, optIn) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = process.env.DISCORD_TURN_PING_ROLE_ID;
  if (!guildId || !token || !roleId) return;

  const method = optIn ? "PUT" : "DELETE";
  try {
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method,
      allow404: true,
    });
  } catch (err) {
    console.error(`Failed to ${optIn ? "add" : "remove"} turn-ping role for ${discordUserId}:`, err);
  }
}

// The ghost seat — read-only channel access for a dead player. Granted by
// killCharacter on death, taken off on a re-roll, a burial or a revive, and
// reconciled against the database by the channel doctor.
//
// A PERMISSION HANDLE, nothing more. Whether the player is Cursed — Migrant or
// Bum only, six fewer points — is db/lib/curse.js's answer, and no longer has
// anything to do with whether this role landed.
async function grantGhostRole(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = GHOST_ROLE_ID;
  if (!guildId || !token) return;

  try {
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method: "PUT",
      allow404: true,
    });
    memberCache.delete(discordUserId);
    memberListCache.delete("all");
  } catch (err) {
    console.error(`Failed to grant the ghost role to ${discordUserId}:`, err);
  }
}

export async function removeGhostRole(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = GHOST_ROLE_ID;
  if (!guildId || !token) return;

  try {
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method: "DELETE",
      allow404: true,
    });
    memberCache.delete(discordUserId);
    memberListCache.delete("all");
  } catch (err) {
    console.error(`Failed to remove the ghost role from ${discordUserId}:`, err);
  }
}

// Personal Discord role titled after this character, colored deterministically.
// Goes through db/lib/characterRoleAppearance.js so a Catatonic character's
// grey and a disguised character's false name both stay intact — a profile
// save landing mid-disguise would otherwise put the real name straight back on
// the token, which is the failure mode that comment has always warned about.
export async function ensureCharacterRole(character) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const bare = formatBareName(character);
  if (!guildId || !token || !bare) return character.discordRoleId ?? null;

  // One query for both halves of the title.
  const held = await prisma.characterTag.findMany({
    where: {
      characterId: character.id,
      OR: [{ tag: { slug: CATATONIC_SLUG } }, { tag: { forcedName: { not: null } } }],
    },
    select: { tag: { select: { slug: true, forcedName: true } } },
  });
  const catatonic = held.some((row) => row.tag?.slug === CATATONIC_SLUG);
  const forcedName = held.find((row) => row.tag?.forcedName)?.tag?.forcedName ?? null;
  const { name, color } = characterRoleAppearance(bare, { catatonic, forcedName });

  try {
    if (!character.discordRoleId) {
      const role = await discordRequest(`/guilds/${guildId}/roles`, {
        method: "POST",
        // permissions: "0" is NOT the API default — Discord's create-role
        // endpoint copies @everyone's permissions when the field is omitted.
        // Leaving it out gave every character role @everyone's bits, which
        // granted nothing extra (nobody holds these roles) but did make each
        // one look like a real access role to db:prune-orphan-roles, whose
        // "carries permissions" gate then refused to ever delete one.
        body: { name, color, hoist: false, mentionable: true, permissions: "0" },
      });

      // Assigned to NOBODY on purpose: it's a mentionable name token with no
      // permissions of its own. Access rides the zone role instead.
      await prisma.character.update({ where: { id: character.id }, data: { discordRoleId: role.id } });
      return role.id;
    }

    await discordRequest(`/guilds/${guildId}/roles/${character.discordRoleId}`, {
      method: "PATCH",
      body: { name, color },
    });
    return character.discordRoleId;
  } catch (err) {
    console.error("ensureCharacterRole failed:", err);
    return character.discordRoleId ?? null;
  }
}

// Does NOT revoke channel access (a per-member overwrite, not the role) —
// callers must pair this with revokeAllCharacterAccess.
export async function deleteCharacterRole(discordRoleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token || !discordRoleId) return;

  await discordRequest(`/guilds/${guildId}/roles/${discordRoleId}`, {
    method: "DELETE",
    allow404: true,
  });
}

// Reconciles per-member overwrites on #cerberon against current tags
// and Zone (see db/lib/specialChannels.js). Every location change goes through
// db/lib/locationMove.js#applyLocationMoveSideEffects instead, which does this
// and the two role swaps in one place; this stays for the tag-change callers.
export async function syncCharacterNarrowcastAccess(characterId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !characterId) return;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { discordUserId: true, webOnly: true },
  });
  if (!character?.discordUserId) return;
  // "Play from the web" holds this account out of every channel, narrowcast
  // included (docs/systemdocs/CHAT.md §6).
  if (character.webOnly) return;

  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);

  await Promise.all(
    SPECIAL_CHANNELS.map((entry) => [entry.slug, config?.[entry.configKey]])
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const grant = access[slug];
        try {
          if (grant) {
            let allow = 0;
            if (grant.view || grant.send) allow |= PERM_VIEW_CHANNEL;
            if (grant.send) allow |= PERM_SEND_MESSAGES;
            await putChannelOverwrite(channelId, character.discordUserId, {
              allow: String(allow),
              type: 1,
            });
          } else {
            await deleteChannelOverwrite(channelId, character.discordUserId);
          }
        } catch (err) {
          console.error(`Narrowcast sync failed for ${slug}/${characterId}:`, err);
        }
      }),
  );
}

export async function revokeAllCharacterAccess(character) {
  return revokeAllCharacterAccessShared(prisma, character);
}

export async function revokeAccessForCharacters(characters) {
  return revokeAccessForCharactersShared(prisma, characters);
}

// Order matters: revoke access, then delete the role, before nulling
// discordRoleId — both are needed to name the overwrites removed.
export async function killCharacter(character, reason = null) {
  await revokeAllCharacterAccess(character).catch((err) =>
    console.error(`Failed to revoke access for dead character ${character.id}:`, err),
  );

  if (character.discordRoleId) {
    await deleteCharacterRole(character.discordRoleId).catch(() => {});
  }

  await updateGuildNickname(character.discordUserId, null).catch(() => {});

  // Shared with the turn engine's catatonic death pass (characterDeath.js)
  // so the two death paths can't drift.
  await applyDeathToRow(prisma, character, {
    expectStatus: "DEAD",
    content: `${character.name} died.`,
  }).catch((err) => console.error(`Death row cleanup failed for ${character.id}:`, err));

  await grantGhostRole(character.discordUserId);

  await sendDm(character.discordUserId, `You have died.${reason?.trim() ? `\n${reason.trim()}` : ""}`, {
    source: "player_event",
  }).catch((err) => console.error(`Death DM failed for ${character.id}:`, err));
}

// Applies the `»` prefix and logs the DM so the player desk keeps the full
// conversation. postDmBatched splits anything over Discord's 2000-char limit;
// `opts.components` is an optional action row and `opts.embeds` an optional
// list of embed objects; both land on the LAST chunk.
//
// `opts.kind` decides how much of the GM inbox this line is entitled to, and
// it defaults to NOTICE (db/lib/dmKinds.js). This default used to be "no
// answer", which the desk read as conversation — which is how a seat
// assignment and a bird letter ended up in the inbox looking like mail. Pass
// DM_KIND.CONVERSATION only when a person actually typed the words.
export async function sendDm(discordUserId, content, opts = {}) {
  const formatted = applyDmPrefix(content);
  const message = await postDmBatched(discordUserId, formatted, {
    components: opts.components,
    embeds: opts.embeds,
    // Pass one whenever the line carries text a PLAYER typed, so it cannot
    // ping the room out of somebody else's inbox.
    allowedMentions: opts.allowedMentions,
  });
  try {
    // db/lib/dmPolicy.js — the prefix, the defaults and the row shape are
    // shared with the other two transports. This one used to write `source:
    // null`, which was never a third meaning, only an unset field; it writes
    // the same "bot_auto" default the others do now.
    await prisma.directMessage.create({
      data: dmLogRow({
        discordUserId,
        content: formatted,
        opts,
        discordMessageId: message?.id ?? null,
        hasEmbeds: Boolean(opts.embeds?.length),
      }),
    });
  } catch (err) {
    // P2002 is the nonce already being on the table: this send is a retry of
    // one that did get through, and the row the caller wants is the one
    // already there. Not a failure, and nothing to log. Anything else is a
    // lost log row, which is worth a line — the send itself still stands.
    if (err?.code !== "P2002") console.error("DM log write failed:", err);
  }
  return message;
}
