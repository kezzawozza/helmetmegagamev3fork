// Torture, the pure half (docs/systemdocs/TORTURE.md). A Torturer picks a Bound person standing where they are, one die is rolled, and this file
// says whether they broke. Prisma-free: the web action loads the rows, this decides, the test reads it directly. Off the @lifeweb/db barrel.
const { TORTURER_SLUG, TORTURING_EQUIPMENT_SLUG } = require("./constants");
const { formatAdvantage } = require("./advantage");
const { HEALTH_CATEGORY } = require("./medicalVision");

// die + bonuses must reach this. A 1 on the die always fails, whatever the bonuses add up to.
const TORTURE_BASE_THRESHOLD = 4;

// What the TARGET holds moves the bar. Hardest wins when several apply, which only ever means Relentless over Brave: Brave and Craven already conflict.
const TARGET_THRESHOLDS = Object.freeze([
  { slug: "relentless", threshold: 6 },
  { slug: "brave", threshold: 5 },
  { slug: "craven", threshold: 2 },
]);

// What the TORTURER brings. Each is +1. Equipment is "in reach" rather than held, so the caller resolves it and passes the boolean.
const TORTURE_BONUSES = Object.freeze([
  { key: "equipment", label: "Torturing Equipment", value: 1 },
  { slug: "trench-knife", label: "Trench Knife", value: 1 },
  { slug: "cruel", label: "Cruel", value: 1 },
]);

// Everything a broken person gives up, minus what the room/medic could already see: wounds and transient statuses. Tag.category stores the DISPLAY name.
const STATUS_CATEGORY = "Status";
const REVEAL_EXCLUDED_CATEGORIES = new Set([HEALTH_CATEGORY, STATUS_CATEGORY]);

function toSet(slugs) {
  return slugs instanceof Set ? slugs : new Set(slugs ?? []);
}

function thresholdFor(targetSlugs) {
  const held = toSet(targetSlugs);
  let threshold = TORTURE_BASE_THRESHOLD;
  let matched = false;
  for (const rule of TARGET_THRESHOLDS) {
    if (!held.has(rule.slug)) continue;
    threshold = matched ? Math.max(threshold, rule.threshold) : rule.threshold;
    matched = true;
  }
  return threshold;
}

// [{ label, value }], the shape gambitModifier.js returns, so the two lists concatenate and print through one formatter.
function tortureBonuses({ torturerSlugs = [], equipmentInReach = false } = {}) {
  const held = toSet(torturerSlugs);
  return TORTURE_BONUSES.filter((b) => (b.key === "equipment" ? equipmentInReach : held.has(b.slug))).map(
    ({ label, value }) => ({ label, value }),
  );
}

// `gambitMods` is gambitModifiers(torturerTags, { mood }) — computed by the caller since mood reads a Character column this file never sees.
function resolveTorture({ die, rolls = null, torturerSlugs = [], targetSlugs = [], equipmentInReach = false, gambitMods = [] }) {
  const modifiers = [...tortureBonuses({ torturerSlugs, equipmentInReach }), ...gambitMods];
  const total = die + modifiers.reduce((sum, m) => sum + m.value, 0);
  const threshold = thresholdFor(targetSlugs);
  return { die, rolls, total, threshold, success: die !== 1 && total >= threshold, modifiers };
}

function revealedTags(characterTags = []) {
  return characterTags.filter((ct) => ct?.tag && !REVEAL_EXCLUDED_CATEGORIES.has(ct.tag.category));
}

// "Rolled a 5 +1 Cruel −1 Hungry against 4" — U+2212 minus, matching the bot's roll line. `rolls` is every die actually thrown — two when the
// torturer holds Lucky, the ONE place in the game a player sees that tag do its work.
function formatTortureRoll({ die, modifiers, threshold, rolls = null }) {
  const mods = modifiers.map((m) => `${m.value > 0 ? "+" : "−"}${Math.abs(m.value)} ${m.label}`).join(" ");
  const luck = formatAdvantage({ rolls, advantage: (rolls?.length ?? 0) > 1 });
  return `Rolled a ${die}${luck ? ` ${luck}` : ""}${mods ? ` ${mods}` : ""} against ${threshold}`;
}

// Discord's field cap, same trim the bot's examineEmbed applies.
const FIELD_MAX = 1024;
function fitField(text) {
  return text.length <= FIELD_MAX ? text : `${text.slice(0, FIELD_MAX - 1)}…`;
}
const BULLET = " • ";

// The DM a break earns, as plain JSON — no discord.js in web/, the REST sender posts the object as-is. `avatarUrl` is absolute; the caller prefixes its origin.
function buildTortureEmbed({ name, avatarUrl, tags, desires, thanatiNames }) {
  const fields = [];
  fields.push({
    name: "Their tags are",
    value: fitField(tags.length ? tags.map((t) => (t.detail ? `${t.name} (${t.detail})` : t.name)).join(BULLET) : "Nothing."),
  });
  if (desires.length) {
    fields.push({
      name: "Their last three fulfilled desires were",
      value: fitField(desires.map((d) => `“${d.text}”`).join(BULLET)),
    });
  }
  if (thanatiNames) {
    fields.push({
      name: "The Thanati",
      value: fitField(
        `Your target was the Thanati cult leader, and told you the names of the Thanati members. They are: ${
          thanatiNames.length ? thanatiNames.join(BULLET) : "nobody else, yet"
        }.`,
      ),
    });
  }
  return {
    title: "You successfully broke your target.",
    description: `Their name is ${name}.`,
    fields,
    ...(avatarUrl ? { thumbnail: { url: avatarUrl } } : {}),
  };
}

module.exports = {
  TORTURER_SLUG,
  TORTURING_EQUIPMENT_SLUG,
  TORTURE_BASE_THRESHOLD,
  TARGET_THRESHOLDS,
  TORTURE_BONUSES,
  REVEAL_EXCLUDED_CATEGORIES,
  thresholdFor,
  tortureBonuses,
  resolveTorture,
  revealedTags,
  formatTortureRoll,
  buildTortureEmbed,
};
