// Provisioning + reconciliation for the SPECIAL CHANNELS registry (db/lib/specialChannels.js). Run by `npm run db:sync-narrowcast-channels` and from wipeGameData's Restart Game flow.
// Everything here derives from the registry entry: category, channel, topic, @everyone deny, spectator/ghost seats, and static zone-role view grants. Per-CHARACTER access is applied elsewhere, as tags/zone change — see the two syncCharacterNarrowcastAccess twins.
// This reconciles on every run, not just at creation — topics drift, zone roles get recreated, and a channel missing its roleView grants is a channel nobody can hear. The NAME is reconciled too; only the channel's ID is one-time.
const {
  getGuildChannels,
  createChannel,
  patchChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
} = require("./discordRest");
const { applySpectatorOverwrite, spectatorsVisibleNow } = require("./spectatorAccess");
const { SPECIAL_CHANNELS } = require("./specialChannels");
const { gmRoleIds } = require("./roleIds");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

const CATEGORY_NAME = "Radio";

// Memoized for the length of one run — without it the second entry sees a category in neither its stale config nor the stale channel list, and cuts a duplicate.
async function ensureCategory(prisma, config, guildChannels, categoryConfigKey, memo) {
  if (memo.has(categoryConfigKey)) return memo.get(categoryConfigKey);
  const id = await resolveCategory(prisma, config, guildChannels, categoryConfigKey);
  memo.set(categoryConfigKey, id);
  return id;
}

async function resolveCategory(prisma, config, guildChannels, categoryConfigKey) {
  const knownId = config[categoryConfigKey];
  if (knownId && guildChannels.some((c) => c.id === knownId && c.type === CHANNEL_TYPE_CATEGORY)) {
    return knownId;
  }
  // Recover a category that already exists in Discord by name rather than creating a duplicate.
  const existing = guildChannels.find(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && c.name === CATEGORY_NAME,
  );
  const id = existing
    ? existing.id
    : (await createChannel({ name: CATEGORY_NAME, type: CHANNEL_TYPE_CATEGORY })).id;
  if (!existing) console.log(`provisioned category #${CATEGORY_NAME}`);
  await prisma.gameConfig.update({ where: { id: 1 }, data: { [categoryConfigKey]: id } });
  return id;
}

async function syncSpecialChannels(prisma) {
  const spectatorsVisible = await spectatorsVisibleNow(prisma);
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
  }

  const config = await prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const guildChannels = await getGuildChannels();
  const stats = { provisioned: [], reparented: [], roleGrants: 0, roleRevokes: 0 };
  const categoryIds = new Map();

  const zones = await prisma.zone.findMany({
    where: { discordRoleId: { not: null } },
    select: { slug: true, discordRoleId: true },
  });
  const roleBySlug = new Map(zones.map((z) => [z.slug, z.discordRoleId]));
  const slugByRole = new Map(zones.map((z) => [z.discordRoleId, z.slug]));

  for (const entry of SPECIAL_CHANNELS) {
    const categoryId = await ensureCategory(
      prisma,
      config,
      guildChannels,
      entry.categoryConfigKey,
      categoryIds,
    );

    let channelId = config[entry.configKey];
    let known = channelId ? guildChannels.find((c) => c.id === channelId) : null;

    if (!known) {
      // Recover an unparented same-name channel from a rebuilt DB before creating a duplicate.
      const existing = guildChannels.find(
        (c) => c.type === CHANNEL_TYPE_TEXT && c.name === entry.slug,
      );
      if (existing) {
        channelId = existing.id;
        known = existing;
      } else {
        const created = await createChannel({
          name: entry.slug,
          type: CHANNEL_TYPE_TEXT,
          topic: entry.topic,
          parent_id: categoryId,
        });
        channelId = created.id;
        stats.provisioned.push(entry.slug);
        console.log(`provisioned #${entry.slug}`);
      }
      await prisma.gameConfig.update({ where: { id: 1 }, data: { [entry.configKey]: channelId } });
    } else if (known.parent_id !== categoryId) {
      // A single PATCH with just parent_id, per CHANNELS.md's warning against combining it with bulk position updates.
      await patchChannel(channelId, { parent_id: categoryId });
      stats.reparented.push(entry.slug);
    }

    // Reconciled every run from here down. @everyone is denied view/send; ATTACH_FILES is denied and never granted back by any player-facing overwrite. GM gets an explicit attach allow so moderation posts with attachments still work.
    // The NAME is reconciled too, not just the topic — the doctor checks member overwrites only, so nothing else can see name drift. Renaming an existing channel keeps its id and history.
    await patchChannel(channelId, {
      name: entry.slug,
      topic: entry.topic,
      ...(entry.slowmode !== undefined ? { rate_limit_per_user: entry.slowmode } : {}),
    });
    if (known && known.name !== entry.slug) {
      console.log(`renamed #${known.name} -> #${entry.slug}`);
    }
    await putChannelOverwrite(channelId, guildId, {
      deny: (PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES).toString(),
    });
    for (const gmRoleId of gmRoleIds()) {
      await putChannelOverwrite(channelId, gmRoleId, {
        allow: (PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES).toString(),
      });
    }
    await applySpectatorOverwrite(channelId, { visible: spectatorsVisible });
    // `ghostsMaySee` is a WEB-only flag now (db/lib/feedAccess.js#ghostPlacesFor). There is no ghost
    // role left to grant it with, and a per-member overwrite per net per ghost would be three
    // channels' worth of bookkeeping for a seat nobody reads on Discord any more.

    const wantedZones = new Set(entry.roleViewZones ?? []);
    for (const slug of wantedZones) {
      const roleId = roleBySlug.get(slug);
      if (!roleId) continue;
      await putChannelOverwrite(channelId, roleId, { allow: PERM_VIEW_CHANNEL.toString() });
      stats.roleGrants += 1;
    }

    // A zone dropped from roleViewZones must actually go deaf. Scoped to known zone roles — GM/spectator/cursed overwrites are never candidates.
    for (const overwrite of known?.permission_overwrites ?? []) {
      if (overwrite.type !== 0) continue;
      const slug = slugByRole.get(overwrite.id);
      if (!slug || wantedZones.has(slug)) continue;
      await deleteChannelOverwrite(channelId, overwrite.id);
      stats.roleRevokes += 1;
      console.log(`revoked ${slug}'s view of #${entry.slug}`);
    }
  }

  return stats;
}

module.exports = { syncSpecialChannels };
