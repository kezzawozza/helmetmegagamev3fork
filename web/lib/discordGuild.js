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
import { openDeadchatTo, DEADCHAT_INVITE } from "@lifeweb/db/lib/deadchat";
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

// Channels opt into summary/tupper behavior by id — see bot/src/lib/channels.js
// for the bot-side twin (kept separate since the bot uses its gateway cache).
const CHANNEL_TYPE_TEXT = 0;
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Tupper/summary status is channel-ID-based: the tupper set is every
// Location channel plus each zone's #summary; #cerberon is tupper-only.
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
    // maxAgeMs, when given, is tighter than the TTL for a caller that has
    // to see a role handed out in Discord a moment ago.
    get(key, maxAgeMs) {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return undefined;
      if (maxAgeMs != null && Date.now() - entry.fetchedAt > maxAgeMs) return undefined;
      return entry.value;
    },
    // Only for the failure path — a stale value beats both a silent GM
    // demotion and a 500 for every player.
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

// In-flight dedup: at turn open ~120 players arrive within seconds with cold
// keys, so sharing the promise collapses concurrent misses into one call.
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

// maxAgeMs: accept a cached member only this fresh. A number rather than an
// options object so React's cache() still memoizes the call per request.
export const getGuildMember = cache(async (discordUserId, maxAgeMs) => {
  const cached = memberCache.get(discordUserId, maxAgeMs);
  if (cached !== undefined) return cached;

  try {
    const value = await dedupe(`member:${discordUserId}`, () => fetchGuildMember(discordUserId));
    memberCache.set(discordUserId, value);
    return value;
  } catch (err) {
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
    // Server-specific avatar (`m.avatar`), a different picture from
    // `m.user.avatar`, carried so gmProfiles.js can reuse this list.
    guildAvatar: m.avatar ?? null,
    roles: m.roles ?? [],
  }));
}

// The list itself cannot say whether the roster read reached Discord: the
// failure path and LOCAL_MODE both return []. Starts true.
let memberListReachable = true;

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

// Either GM seat counts (db/lib/roleIds.js#gmRoleIds; GAMEMASTERS.md).
export function isGm(member) {
  if (!member) return false;
  return hasGmRole(member.roles);
}

export function isPlaytester(member) {
  if (!member) return false;
  return hasPlaytestRole(member.roles);
}

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

// Who counts as on the roster — the one answer the lobby and both creation
// actions share. With GameConfig.playtestModeEnabled on, the door narrows
// to GMs, playtesters and Contributors. Superadmins bypass this entirely.
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
  // Not being mirrored to Discord exists so that nothing on Discord says
  // which character this account is, and a nickname is the loudest thing
  // that could (docs/systemdocs/CHAT.md §6).
  const notMirrored = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE", discordMirrored: false },
    select: { id: true },
  });
  if (notMirrored) return;

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


// Personal Discord role titled after this character, colored
// deterministically, via db/lib/characterRoleAppearance.js so a Catatonic
// character's grey and a disguised character's false name stay intact.
export async function ensureCharacterRole(character) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const bare = formatBareName(character);
  if (!guildId || !token || !bare) return character.discordRoleId ?? null;
  // Not mirrored to Discord: no name token to mint or repaint (CHAT.md §6).
  if (!character.discordMirrored) return character.discordRoleId ?? null;

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
        // permissions: "0" is NOT the API default — omitting it copies
        // @everyone's bits, which made db:prune-orphan-roles' "carries
        // permissions" gate refuse to ever delete a character role.
        body: { name, color, hoist: false, mentionable: true, permissions: "0" },
      });

      // Assigned to NOBODY on purpose — a mentionable name token only.
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

// Reconciles per-member overwrites on #cerberon against current tags and
// Zone. Every location change goes through locationMove.js's own side
// effects instead; this stays for the tag-change callers.
export async function syncCharacterNarrowcastAccess(characterId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !characterId) return;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { discordUserId: true, discordMirrored: true },
  });
  if (!character?.discordUserId) return;
  // Not mirrored to Discord holds this account out of every channel,
  // narrowcast included (docs/systemdocs/CHAT.md §6).
  if (!character.discordMirrored) return;

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

  // Shared with the turn engine's catatonic death pass so the two death
  // paths can't drift.
  await applyDeathToRow(prisma, character, {
    expectStatus: "DEAD",
    content: `${character.name} died.`,
  }).catch((err) => console.error(`Death row cleanup failed for ${character.id}:`, err));

  // The Deadchat seat (db/lib/deadchat.js) — a per-member overwrite on one channel, replacing the
  // Ghost role that used to go here. Note the order this inherits and must keep: revokeAllCharacterAccess
  // above sweeps the channels the character held, Deadchat included, so the grant has to come after it.
  await openDeadchatTo(prisma, character.discordUserId).catch((err) =>
    console.error(`Deadchat seat failed for ${character.id}:`, err),
  );

  await sendDm(character.discordUserId, `You have died.${reason?.trim() ? `\n${reason.trim()}` : ""}\n${DEADCHAT_INVITE}`, {
    source: "player_event",
  }).catch((err) => console.error(`Death DM failed for ${character.id}:`, err));
}

// Applies the `»` prefix and logs the DM. postDmBatched splits anything over
// Discord's 2000-char limit; `opts.components`/`opts.embeds` land on the
// LAST chunk. `opts.kind` decides how much of the GM inbox this line is
// entitled to, defaulting to NOTICE (db/lib/dmKinds.js) — pass
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
    // P2002 is the nonce already on the table: a retry of a send that did
    // get through. This used to write `source:
    // null`, which was never a third meaning, only an unset field; it writes
    // the same "bot_auto" default the others do now.
    if (err?.code !== "P2002") console.error("DM log write failed:", err);
  }
  return message;
}
