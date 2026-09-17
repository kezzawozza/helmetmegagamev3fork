// A mention is FACE-NEUTRAL in the row: stored as `{char:<id>|<Name>}`, translated at the edges — Discord's `<@&roleId>` (a character role is a mentionable name token, PROXYING.md §6) becomes `{char:<id>}` in db/lib/say.js#prepareSpeech (in), and back to `<@&roleId>` in bot/src/lib/feedOutbox.js (out); web uses `{char:<id>}` directly (web/app/components/richTokens.js), the same inline-reference syntax every other bubble uses. The id is never trusted as authorisation — a token resolves to a character or is left exactly as written, same contract as every other richTokens.js kind.
// The name is frozen at send time as the PRESENTED name (db/lib/presentedIdentity.js: forced > concealed > own) — a row must never print a name the room couldn't have heard — and lives IN the token, not a sidecar column, because the text gets copied (a ⭐ into Note.content, a journal entry) with no migration needed. A token with no `|` predates this and resolves live; there is deliberately NO BACKFILL, since stamping today's names onto old rows would be the retroactive rewrite this exists to prevent.

const { parsePlaceKey } = require("./placeKey");
const { charactersNamedIn } = require("./mentions");
const { buildNarrowcastContext, computeNarrowcastAccess, NARROWCAST_SLUGS } = require("./specialChannels");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");

// A cuid in practice, but written loosely on purpose: what makes a token valid is that it resolves, not that it matches a shape. The name half is optional and stops at the first `}` or `|`, which is what freezeMentionName below guarantees it can never contain.
const TOKEN_RE = /\{char:([A-Za-z0-9_-]{1,64})(?:\|([^{}|\n]{0,64}))?\}/g;
const ROLE_RE = /<@&(\d{5,32})>/g;

// What a name has to survive to sit inside the grammar: `{`, `}` and `|` would break it, and a player-typed name can hold all three (normalizeDisguiseName in db/lib/disguiseMint.js only collapses whitespace and caps length, so a disguise called `Bob}` is reachable today). Capped at 64 to match the id half, so one mention can't be a paragraph.
function freezeMentionName(name) {
  if (typeof name !== "string") return null;
  const clean = name.replace(/[{}|]/g, "").replace(/\s+/g, " ").trim().slice(0, 64);
  return clean || null;
}

// Whether this text names this character, in either spelling. One predicate, since "does the row mention me" is asked from three places — building the string separately at each is how a widened grammar silently stops matching at one call site and not the others.
function mentionsCharacter(content, characterId) {
  if (typeof content !== "string" || !characterId) return false;
  return content.includes(`{char:${characterId}}`) || content.includes(`{char:${characterId}|`);
}

// The tags presentedIdentity resolves against: a name-forcing one, and anything equipped that conceals. Same shape web/lib/mentionDirectory.js selects — CONCEALMENT_TAG_FIELDS exists so these can't drift.
const IDENTITY_INCLUDE = {
  where: {
    OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
  },
  select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
};

// Stamp every mention in `content` with the name its subject is presenting RIGHT NOW, replacing anything already there. Replacing rather than preserving is the security half: the web composer writes a name in as it inserts the chip, and a server action is a public endpoint (CLAUDE.md), so a posted `{char:<victim>|Some Fake Name}` must be overwritten rather than trusted — the composer's copy exists only so the draft looks right before sending. One query for the whole message, a no-op scan when there are no mentions (almost every line).
async function stampMentionNames(prisma, content) {
  const ids = mentionedIdsIn(content);
  if (ids.length === 0) return content;

  const characters = await prisma.character.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      concealed: true,
      age: true,
      gender: true,
      tags: IDENTITY_INCLUDE,
    },
  });
  const nameById = new Map(
    characters.map((character) => [
      character.id,
      freezeMentionName(
        presentedIdentity(character, {
          forcedName: forcedNameFrom(character.tags),
          concealment: concealmentFrom(character.tags),
        }).name,
      ),
    ]),
  );

  // A token naming somebody who is gone keeps whatever it had: no live answer exists to replace it with, and dropping the name would lose the only record of who was meant.
  return content.replace(TOKEN_RE, (raw, id, existing) => {
    const name = nameById.get(id) ?? freezeMentionName(existing);
    return name ? `{char:${id}|${name}}` : `{char:${id}}`;
  });
}

// Every character id named by a `{char:…}` in this text, deduped and in the order they appear.
function mentionedIdsIn(content) {
  if (typeof content !== "string" || !content.includes("{char:")) return [];
  const ids = [];
  for (const match of content.matchAll(TOKEN_RE)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

// Web/row -> Discord. Returns `{ content, characters }`: the rewritten text, and the characters it actually named. A token whose character is gone or has no role falls back to the NAME the token froze, printed as plain text (not a ping — there is no role to ping).
async function tokensToRoles(prisma, content) {
  const ids = mentionedIdsIn(content);
  if (ids.length === 0) return { content, characters: [] };

  const characters = await prisma.character.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      status: true,
      discordRoleId: true,
      discordUserId: true,
      locationId: true,
      zoneId: true,
      discordMirrored: true,
    },
  });
  const byId = new Map(characters.map((c) => [c.id, c]));

  const rewritten = content.replace(TOKEN_RE, (raw, id, frozenName) => {
    const character = byId.get(id);
    if (character?.discordRoleId) return `<@&${character.discordRoleId}>`;
    return frozenName || raw;
  });

  return { content: rewritten, characters: ids.map((id) => byId.get(id)).filter(Boolean) };
}

// Row -> plain prose. The third spelling, for a line whose text is about to be MANGLED: db/lib/shout.js muffles a
// shout at two hops out by blanking random characters, and a `{char:…}` run through that comes out as broken
// braces with the named person's name still perfectly legible in the middle of a redacted sentence. Flattening
// the token first means the name is redacted with everything else. Pure — stampMentionNames has already run, so
// every live token carries its name, and a token with no name half predates the freeze and has none to print.
function tokensToNames(content) {
  if (typeof content !== "string") return content;
  return content.replace(TOKEN_RE, (raw, _id, frozenName) => frozenName || "someone");
}

// Discord -> row. Only a role that IS a character's name token is rewritten: Character.discordRoleId is @unique, so the lookup answers with one character or nothing, and a GM/spectator/player role resolves to nothing and is left alone — same rule bot/src/lib/mentions.js has always applied to the relay DM.
async function rolesToTokens(prisma, content) {
  if (typeof content !== "string" || !content.includes("<@&")) return content;
  const roleIds = [...new Set([...content.matchAll(ROLE_RE)].map((m) => m[1]))];
  if (roleIds.length === 0) return content;

  const characters = await prisma.character.findMany({
    where: { discordRoleId: { in: roleIds } },
    select: { id: true, discordRoleId: true },
  });
  if (characters.length === 0) return content;
  const byRole = new Map(characters.map((c) => [c.discordRoleId, c.id]));

  return content.replace(ROLE_RE, (raw, roleId) => {
    const id = byRole.get(roleId);
    return id ? `{char:${id}}` : raw;
  });
}

// How far a ping carries, expressed as the place it was said in. PROXYING.md §6's rule: a ping must not reach further than a voice would, so a Location, Room and Conversation all gate on the LOCATION around them, and a zone summary gates on the zone.
async function earshotForPlaceKey(prisma, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { locationId: null, zoneId: null };

  if (parsed.kind === "loc") return { locationId: parsed.id, zoneId: null };
  if (parsed.kind === "zone") return { locationId: null, zoneId: parsed.id };

  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({ where: { id: parsed.id }, select: { locationId: true } });
    return { locationId: room?.locationId ?? null, zoneId: null };
  }

  const conversation = await prisma.playerThread.findUnique({
    where: { id: parsed.id },
    select: { locationId: true },
  });
  return { locationId: conversation?.locationId ?? null, zoneId: null };
}

// Whether this character is close enough to be told: alive, and standing in the place's earshot. Pinging your own character DOES pass — the relay is the only proof a player has that the feature works (PROXYING.md §6).
function inEarshot(character, earshot) {
  if (!character || character.status !== "ALIVE") return false;
  if (earshot.locationId) return character.locationId === earshot.locationId;
  if (earshot.zoneId) return character.zoneId === earshot.zoneId;
  return false;
}

// Everybody in earshot whose NAME this text says out loud — a bare name is a
// mention on both faces (REDESIGN.md §2, §6). The predicate is db/lib/mentions.js,
// which asks no database; this is the query that hands it its candidates.
//
// NOTIFY-ONLY, and the callers must keep it that way. An explicit `{char:…}`
// mention inside a Conversation is also an INVITE — it adds the person to the
// thread — and a bare name must never be, or "Marrow said the bell had gone"
// typed in a private conversation would pull Marrow into it.
//
// Earshot is the same rule a role ping obeys (PROXYING.md §6): a Location, Room
// or Conversation gates on the Location around it, a zone summary on the zone. So
// a candidate that comes back here has already passed the test `inEarshot` would
// apply, and the caller need not apply it twice.
//
// The name matched is the PRESENTED one, and a character who is concealed or
// under a forced name is dropped: the room does not know that name is theirs, and
// pinging them by it would be the hood confirming itself.
async function charactersNamedNearby(prisma, { placeKey, content, speakerId = null }) {
  if (typeof content !== "string" || !content.trim()) return [];
  const earshot = await earshotForPlaceKey(prisma, placeKey);
  if (!earshot.locationId && !earshot.zoneId) return [];

  const candidates = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      ...(earshot.locationId ? { locationId: earshot.locationId } : { zoneId: earshot.zoneId }),
      ...(speakerId ? { id: { not: speakerId } } : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      discordRoleId: true,
      discordUserId: true,
      locationId: true,
      zoneId: true,
      discordMirrored: true,
      concealed: true,
      age: true,
      gender: true,
      tags: IDENTITY_INCLUDE,
    },
  });

  const shaped = candidates.map((character) => {
    const shown = presentedIdentity(character, {
      forcedName: forcedNameFrom(character.tags),
      concealment: concealmentFrom(character.tags),
    });
    const { tags, ...rest } = character;
    return { ...rest, name: shown.name, concealed: Boolean(shown.concealed || shown.forced) };
  });

  return charactersNamedIn(content, shaped, { speakerId });
}

// The same question for a place key of ANY kind, including the ones earshot has no answer for. A special channel
// has no zone at all, so it asks whether the target currently hears that channel instead — the rule
// bot/src/lib/mentions.js#canHearPing has always applied to a Discord-origin ping, now reachable from db/lib
// too. Deadchat and a party thread answer NO for now: neither is a place, both are memberships, and a relay that
// guessed would be a ping carrying further than the room it was typed in.
async function canHearPing(prisma, character, placeKey) {
  if (!character || character.status !== "ALIVE") return false;
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return false;
  if (parsed.kind === "dead" || parsed.kind === "party") return false;
  if (parsed.kind === "net") {
    if (!NARROWCAST_SLUGS.includes(parsed.id)) return false;
    const ctx = await buildNarrowcastContext(prisma, character.id);
    return Boolean(computeNarrowcastAccess(ctx)[parsed.id]?.view);
  }
  return inEarshot(character, await earshotForPlaceKey(prisma, placeKey));
}

module.exports = {
  TOKEN_RE,
  ROLE_RE,
  freezeMentionName,
  mentionsCharacter,
  mentionedIdsIn,
  stampMentionNames,
  tokensToRoles,
  rolesToTokens,
  tokensToNames,
  earshotForPlaceKey,
  inEarshot,
  charactersNamedNearby,
  canHearPing,
};
