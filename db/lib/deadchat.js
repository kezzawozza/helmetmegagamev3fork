// DEADCHAT — the one room the dead talk in, and the only place a ghost has a voice.
//
// WHY IT IS NOT A ROLE. This replaces the Ghost role (db/lib/ghostAccess.js, deleted), which was an
// out-of-character leak: Discord prints a member's roles on their profile card, so anyone who
// clicked a player read "Ghost" and knew they were dead. Pinning the role's colour to 0 hid it from
// the member list and did nothing about the profile. A per-member overwrite is visible only inside
// the channel it opens, and everyone who can open this one is already dead.
//
// WHY IT IS NOT A SPECIAL CHANNEL (db/lib/specialChannels.js), which it otherwise resembles. Three
// things in that registry are wrong for this room, and each would have to be branched around:
//   - locationMove.js#reconcileNarrowcastAccess DELETES the member overwrite for every entry whose
//     `member(ctx)` returns null. Deadchat's would be null for every living character, so every
//     player's every move would fire a delete against this channel.
//   - syncSpecialChannels.js applies the SPECTATOR overwrite unconditionally. A spectator reading
//     Deadchat is the full death list at a glance — the same leak, one seat over.
//   - its `member(ctx)` is built from a living character's zone and tags. A ghost has neither; the
//     seat is keyed on the ACCOUNT, the way the DM thread is (CHAT.md §2b).
//
// Takes `prisma` as a parameter rather than requiring db/index.js: that would resolve to a partial
// exports object (the db/lib/dm.js convention). REST only, never inside a transaction
// (ARCHITECTURE.md §5), and every call is best-effort — the channel doctor is the safety net.
const {
  getGuildChannels,
  getChannel,
  createChannel,
  patchChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
  getGuildMember,
} = require("./discordRest");
const { gmRoleIds } = require("./roleIds");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_ADD_REACTIONS = 64n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;
const PERM_READ_HISTORY = 65536n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_MANAGE_THREADS = 17179869184n;
const PERM_CREATE_PUBLIC_THREADS = 34359738368n;
const PERM_CREATE_PRIVATE_THREADS = 68719476736n;

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

const CATEGORY_NAME = "Beyond";
const CHANNEL_NAME = "deadchat";

// One ghost's seat. Reactions are allowed (a ghost still stars a line onto their own /notes page);
// everything that would let them reshape the room is denied by name, the way the Ghost role's mask
// denied it. READ_HISTORY matters more here than anywhere else — a ghost arriving mid-game should
// find the conversation already in progress, not an empty room.
const DEADCHAT_ALLOW = PERM_VIEW_CHANNEL | PERM_READ_HISTORY | PERM_SEND_MESSAGES | PERM_ADD_REACTIONS;
const DEADCHAT_DENY =
  PERM_ATTACH_FILES |
  PERM_MANAGE_MESSAGES |
  PERM_MANAGE_THREADS |
  PERM_CREATE_PUBLIC_THREADS |
  PERM_CREATE_PRIVATE_THREADS;

// A GM READS Deadchat and does not speak in it, matching the rule everywhere else on the desk: a GM
// reads every place they watch and speaks in none (db/lib/feedAccess.js#gmPlacesFor). SEND is denied
// rather than merely ungranted, so a GM who also happens to have a dead character cannot type here
// as themselves and be resolved as a ghost — one act, one answer.
const GM_ALLOW = PERM_VIEW_CHANNEL | PERM_READ_HISTORY;
const GM_DENY = PERM_SEND_MESSAGES | PERM_ATTACH_FILES;

async function deadchatChannelId(prisma) {
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { deadchatChannelId: true },
  });
  return config?.deadchatChannelId ?? null;
}

// Idempotent: recovers an existing category/channel by name before cutting a new one, the way
// syncSpecialChannels does, so a rebuilt database does not leave a duplicate behind.
async function ensureDeadchatChannel(prisma, { fresh = false } = {}) {
  if (!process.env.DISCORD_GUILD_ID || !process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
  }
  const guildId = process.env.DISCORD_GUILD_ID;
  const config = await prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const guildChannels = await getGuildChannels();

  let categoryId = config.deadchatCategoryId;
  if (!categoryId || !guildChannels.some((c) => c.id === categoryId && c.type === CHANNEL_TYPE_CATEGORY)) {
    const existing = guildChannels.find((c) => c.type === CHANNEL_TYPE_CATEGORY && c.name === CATEGORY_NAME);
    categoryId = existing ? existing.id : (await createChannel({ name: CATEGORY_NAME, type: CHANNEL_TYPE_CATEGORY })).id;
    if (!existing) console.log(`provisioned category #${CATEGORY_NAME}`);
    await prisma.gameConfig.update({ where: { id: 1 }, data: { deadchatCategoryId: categoryId } });
  }

  let channelId = config.deadchatChannelId;
  let known = channelId ? guildChannels.find((c) => c.id === channelId) : null;
  let provisioned = false;

  if (!known) {
    const existing = guildChannels.find((c) => c.type === CHANNEL_TYPE_TEXT && c.name === CHANNEL_NAME);
    if (existing) {
      channelId = existing.id;
      known = existing;
    } else {
      const created = await createChannel({
        name: CHANNEL_NAME,
        type: CHANNEL_TYPE_TEXT,
        parent_id: categoryId,
      });
      channelId = created.id;
      provisioned = true;
      console.log(`provisioned #${CHANNEL_NAME}`);
    }
    await prisma.gameConfig.update({ where: { id: 1 }, data: { deadchatChannelId: channelId } });
  } else if (known.parent_id !== categoryId) {
    await patchChannel(channelId, { parent_id: categoryId });
  }

  // Reconciled every run from here down, like the special channels: the name reset is cosmetic, a
  // missing @everyone deny is the whole room open to the living.
  await patchChannel(channelId, { name: CHANNEL_NAME });
  await putChannelOverwrite(channelId, guildId, {
    deny: (PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES).toString(),
  });
  for (const gmRoleId of gmRoleIds()) {
    await putChannelOverwrite(channelId, gmRoleId, {
      allow: GM_ALLOW.toString(),
      deny: GM_DENY.toString(),
    });
  }
  // Deliberately NO spectator overwrite. A spectator seat reading this channel would be the full
  // death list at a glance, which is the leak this whole room was rebuilt to close.

  // Restart Game only: the ghosts of the last game are not the ghosts of this one, and the rows that
  // would say who they were are being deleted in the same flow. Stripping every member overwrite
  // here is what makes that safe without reading the old roster back.
  if (fresh) await stripAllMemberSeats(channelId);

  return { channelId, categoryId, provisioned };
}

async function stripAllMemberSeats(channelId) {
  const live = await getChannel(channelId).catch(() => null);
  for (const overwrite of live?.permission_overwrites ?? []) {
    if (Number(overwrite.type) !== 1) continue; // 1 = member; never touch @everyone or the GM roles
    await deleteChannelOverwrite(channelId, overwrite.id).catch((err) =>
      console.error(`Deadchat: failed to strip seat ${overwrite.id}:`, err.message ?? err),
    );
  }
}

// Hand somebody the seat. Called wherever a character dies; the twin of closeDeadchatTo.
async function openDeadchatTo(prisma, discordUserId) {
  if (!discordUserId) return false;
  const channelId = await deadchatChannelId(prisma);
  if (!channelId) return false;
  await putChannelOverwrite(channelId, discordUserId, {
    allow: DEADCHAT_ALLOW.toString(),
    deny: DEADCHAT_DENY.toString(),
    type: 1,
  });
  return true;
}

// Take it away. Called wherever a player gets a living character again — and NOWHERE else. Burial
// and engraving lift the CURSE (db/lib/curse.js) and say nothing about who may watch or talk.
async function closeDeadchatTo(prisma, discordUserId) {
  if (!discordUserId) return false;
  const channelId = await deadchatChannelId(prisma);
  if (!channelId) return false;
  await deleteChannelOverwrite(channelId, discordUserId);
  return true;
}

// Is this the Deadchat channel? Asked only on the rare path where a message arrived from somebody
// with no living character, so one indexed read there is cheaper than memoising another id.
async function isDeadchatChannel(prisma, channelId) {
  if (!channelId) return false;
  return (await deadchatChannelId(prisma)) === channelId;
}

// Who currently holds a seat, read off Discord rather than the database. Two callers want exactly
// this: the channel doctor's reconcile, and the Restart Game wipe, which needs the answer AFTER the
// rows that would otherwise give it are gone.
async function deadchatSeatHolders(prisma) {
  const channelId = await deadchatChannelId(prisma);
  if (!channelId) return [];
  const live = await getChannel(channelId).catch(() => null);
  return (live?.permission_overwrites ?? []).filter((o) => Number(o.type) === 1).map((o) => o.id);
}

// The name a ghost speaks under: "Solomon Baker (Pub Fries)". Deadchat is out-of-character, so
// naming the account is the point rather than a leak — it is the one room where who you actually are
// is the useful half.
//
// Memoised for a minute (the placeKey.js channelMemo pattern): a burst of messages should cost one
// REST call, not one each. Falls back to the bare character name — a handle lookup failing must
// never cost somebody their message.
const HANDLE_TTL_MS = 60 * 1000;
const handleMemo = new Map(); // discordUserId -> { handle, at }

function forgetDeadchatHandles() {
  handleMemo.clear();
}

async function deadchatHandle(discordUserId) {
  if (!discordUserId) return null;
  const cached = handleMemo.get(discordUserId);
  if (cached && Date.now() - cached.at < HANDLE_TTL_MS) return cached.handle;
  const member = await getGuildMember(discordUserId).catch(() => null);
  const handle = member?.user?.global_name ?? member?.user?.username ?? null;
  handleMemo.set(discordUserId, { handle, at: Date.now() });
  return handle;
}

async function deadchatSpeakerName(character) {
  const base = character?.name ?? "Someone";
  const handle = await deadchatHandle(character?.discordUserId);
  return handle ? `${base} (${handle})` : base;
}

module.exports = {
  ensureDeadchatChannel,
  openDeadchatTo,
  closeDeadchatTo,
  deadchatSeatHolders,
  deadchatChannelId,
  isDeadchatChannel,
  deadchatSpeakerName,
  forgetDeadchatHandles,
  DEADCHAT_ALLOW,
  DEADCHAT_DENY,
  CHANNEL_NAME: CHANNEL_NAME,
  // Read by db/lib/discordMirror/desired.js, so the mirror describes this room
  // from the same strings that provision it.
  CATEGORY_NAME,
  GM_ALLOW,
  GM_DENY,
};
