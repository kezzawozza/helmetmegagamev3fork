// The channel doctor's full-scope narrowcast overwrite sweep — the special
// channels' member overwrites vs. the access rules. Moved verbatim out of
// runChannelDoctor (W2d).
const { getChannel, deleteChannelOverwrite, putChannelOverwrite } = require("../../discordRest");
const { SPECIAL_CHANNELS, buildNarrowcastContext, computeNarrowcastAccess } = require("../../specialChannels");

async function runNarrowcastSweep({ report, errors, prisma, alive, config, characterUserIds }) {
  // Narrowcast member overwrites vs the rules, channel-major.
  //
  // The context is built ONCE per character, not once per character per
  // channel: it is two queries and it does not depend on the entry. With one
  // special channel the difference was invisible; each new entry used to
  // multiply the whole sweep by another 2N queries.
  const accessByCharacter = new Map();
  if (SPECIAL_CHANNELS.some((entry) => config?.[entry.configKey])) {
    for (const c of alive) {
      if (!c.discordMirrored) continue;
      accessByCharacter.set(c, computeNarrowcastAccess(await buildNarrowcastContext(prisma, c.id)));
    }
  }

  for (const entry of SPECIAL_CHANNELS) {
    const channelId = config?.[entry.configKey];
    if (!channelId) continue;
    let live;
    try {
      live = await getChannel(channelId, { allow404: true });
    } catch (err) {
      errors.push({ check: "narrowcast", target: entry.slug, message: err.message });
      continue;
    }
    if (!live) continue;

    const wantByUser = new Map();
    for (const [c, access] of accessByCharacter) {
      const grant = access[entry.slug];
      if (grant) wantByUser.set(c.discordUserId, grant);
    }

    const PERM_VIEW = 1024n;
    const PERM_SEND = 2048n;
    for (const overwrite of live.permission_overwrites ?? []) {
      if (overwrite.type !== 1) continue;
      const grant = wantByUser.get(overwrite.id);
      if (!grant) {
        const label = characterUserIds.has(overwrite.id) ? "no longer earns it" : "unknown member";
        await report("narrowcast", `${entry.slug}/${overwrite.id}`, `member overwrite ${label}`, () =>
          deleteChannelOverwrite(channelId, overwrite.id),
        );
        continue;
      }
      let allow = 0n;
      if (grant.view || grant.send) allow |= PERM_VIEW;
      if (grant.send) allow |= PERM_SEND;
      if ((overwrite.allow ?? "0") !== allow.toString()) {
        await report("narrowcast", `${entry.slug}/${overwrite.id}`, "member overwrite has the wrong bits", () =>
          putChannelOverwrite(channelId, overwrite.id, { allow: allow.toString(), type: 1 }),
        );
      }
      wantByUser.delete(overwrite.id);
    }
    for (const [userId, grant] of wantByUser) {
      let allow = 0n;
      if (grant.view || grant.send) allow |= PERM_VIEW;
      if (grant.send) allow |= PERM_SEND;
      await report("narrowcast", `${entry.slug}/${userId}`, "member should have access and has no overwrite", () =>
        putChannelOverwrite(channelId, userId, { allow: allow.toString(), type: 1 }),
      );
    }
  }
}

module.exports = { runNarrowcastSweep };
