// The registry of SPECIAL CHANNELS — standing channels outside the zone system. Each entry fully describes a channel: provisioning, static role grants, per-character access, wipe behavior, ghost visibility and tupper routing all derive from it. Access rules stay CODE, not a YAML mini-language.
// #cerberon, #27.065 and #243.000 are the three radio nets. #intercom is now a button in the Council Room (db/lib/intercom.js); its GameConfig column stays as an orphan.

const SPECIAL_CHANNELS = [
  {
    slug: "cerberon",
    // What the web calls it. The slug stays lowercase because it is the Discord channel name.
    name: "Cerberon",
    configKey: "cerberonChannelId",
    categoryConfigKey: "radioCategoryId",
    topic: "The Cerberon's radio net. Bracelets receive; the Censor's system speaks.",
    tupper: true,
    wipe: "clear",
    ghostsMaySee: true,
    roleViewZones: [],
    // Possession is what matters — a bracelet transferred outside the Cerberon still opens the channel.
    member: (ctx) => {
      if (ctx.tagSlugs.has("radio-system-cerberon")) return { view: true, send: true };
      if (ctx.tagSlugs.has("radio-bracelet-cerberon")) return { view: true, send: false };
      return null;
    },
  },
  {
    slug: "27.065",
    name: "27.065",
    configKey: "freq27065ChannelId",
    categoryConfigKey: "radioCategoryId",
    topic:
      "An open frequency. Everyone holding a radio tuned to it hears everything said, and anyone who hears may answer.",
    tupper: true,
    wipe: "clear",
    ghostsMaySee: true,
    roleViewZones: [],
    // No listener-only half here: there is a single radio, and it both hears and speaks.
    member: (ctx) => (ctx.tagSlugs.has("radio-27065") ? { view: true, send: true } : null),
  },
  {
    slug: "243.000",
    name: "243.000",
    configKey: "freq243000ChannelId",
    categoryConfigKey: "radioCategoryId",
    topic:
      "The Tribunal's own frequency. Everyone holding a radio tuned to it hears everything said, and anyone who hears may answer.",
    tupper: true,
    wipe: "clear",
    ghostsMaySee: true,
    roleViewZones: [],
    // Same shape as 27.065: one radio, hears and speaks both.
    member: (ctx) => (ctx.tagSlugs.has("radio-243000") ? { view: true, send: true } : null),
  },
];

const NARROWCAST_SLUGS = SPECIAL_CHANNELS.map((c) => c.slug);

// Slugs, not ids — the rules are authored against docs/zones.yaml's fixed identifiers. Zone is read THROUGH the location, falling back to Character.zoneId only for an unplaced character.
async function buildNarrowcastContext(prisma, characterId) {
  const [row, tags] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: {
        location: { select: { zone: { select: { slug: true, seatZone: { select: { slug: true } } } } } },
        zone: { select: { slug: true, seatZone: { select: { slug: true } } } },
      },
    }),
    prisma.characterTag.findMany({
      where: { characterId },
      select: { tag: { select: { slug: true } } },
    }),
  ]);

  const zone = row?.location?.zone ?? row?.zone ?? null;
  return {
    zoneSlug: zone?.slug ?? null,
    seatZoneSlug: zone?.seatZone?.slug ?? zone?.slug ?? null,
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
  };
}

function computeNarrowcastAccess(ctx) {
  return Object.fromEntries(SPECIAL_CHANNELS.map((entry) => [entry.slug, entry.member(ctx)]));
}

module.exports = {
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
};
