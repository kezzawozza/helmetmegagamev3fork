// Discord's angle-bracket vocabulary, as source strings — the single source
// web/app/components/remarkDiscord.js and db/test/discordMarkup.test.js both build RegExps from. No requires here, ever, same rule as dmKinds.js.

const SNOWFLAKE = "\\d{5,32}";

const TIMESTAMP_STYLES = ["t", "T", "d", "D", "f", "F", "R"];
const DEFAULT_TIMESTAMP_STYLE = "f";

const DISCORD_MARKUP = Object.freeze({
  timestamp: { source: `<t:(-?\\d{1,15})(?::([${TIMESTAMP_STYLES.join("")}]))?>`, label: "a timestamp" },
  role: { source: `<@&(${SNOWFLAKE})>`, label: "a role mention" },
  user: { source: `<@!?(${SNOWFLAKE})>`, label: "a user mention" },
  channel: { source: `<#(${SNOWFLAKE})>`, label: "a channel mention" },
  emoji: { source: `<(a?):([A-Za-z0-9_]{2,32}):(${SNOWFLAKE})>`, label: "a custom emoji" },
  ping: { source: "@(everyone|here)\\b", label: "a broadcast ping" },
});

const DISCORD_MARKUP_KINDS = Object.freeze(Object.keys(DISCORD_MARKUP));

// SHAPED like Discord markup, deliberately NOT built from the vocabulary
// above, so an unknown syntax can be caught by construction. Autolinks
// (`<https://…>`, `<mailto:…>`) excluded outright. No regex metacharacters in the body — spelled as literals like `<@&(\\d{5,32})>`.
const UNKNOWN_SHAPE = "<(?!https?://|mailto:)[A-Za-z]{0,10}[:@#][A-Za-z0-9_:.!&-]{1,64}>";

function reFor(kind, flags = "g") {
  const entry = DISCORD_MARKUP[kind];
  if (!entry) throw new Error(`Unknown Discord markup kind: ${kind}`);
  return new RegExp(entry.source, flags);
}

function findDiscordMarkup(text) {
  if (typeof text !== "string" || !text) return [];
  const found = [];
  for (const kind of DISCORD_MARKUP_KINDS) {
    const re = reFor(kind);
    let m;
    while ((m = re.exec(text)) !== null) {
      if (found.some((f) => m.index < f.index + f.raw.length && f.index < m.index + m[0].length)) continue;
      found.push({ kind, raw: m[0], index: m.index, groups: m.slice(1) });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

// `[]` is healthy — the guard test asserts exactly that over every DM-writing file.
function findUnknownMarkup(text) {
  if (typeof text !== "string" || !text) return [];
  const known = findDiscordMarkup(text);
  const unknown = [];
  const re = new RegExp(UNKNOWN_SHAPE, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (known.some((k) => k.index === m.index && k.raw === m[0])) continue;
    unknown.push({ raw: m[0], index: m.index });
  }
  return unknown;
}

module.exports = {
  DISCORD_MARKUP,
  DISCORD_MARKUP_KINDS,
  TIMESTAMP_STYLES,
  DEFAULT_TIMESTAMP_STYLE,
  reFor,
  findDiscordMarkup,
  findUnknownMarkup,
};
