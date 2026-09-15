// What a shout sounds like from N places away, who hears it, and how it is delivered.
// Both faces call shout() below (bot/src/events/interactionCreate.js#handleShoutCommand, web/app/(app)/chat/actions.js#shoutHere), plus the turn engine for a Xom scream. The cooldown is an AuditLog row (no timestamp column on Character), so it survives a restart and is shared across both faces.
// shoutLine/shoutParts are pure — no prisma, no I/O. db/lib/locationGraph.js#soundRange answers WHO hears; they answer WHAT they hear; deliverShout() puts it in front of them.
// Distance takes the words away before it takes the direction away — you always learn which way to run, but stop learning what was said. You learn WHO shouted only at distance zero, and it is the PRESENTED name (db/lib/presentedIdentity.js), so concealment still holds. From one hop out nobody is named at all.

const { ambientLine } = require("./ambientLine");
const { sceneLine } = require("./scene");
const { postMessage } = require("./discordRest");
const { soundRange } = require("./locationGraph");
const { loadVoiceState } = require("./say");
const { placeKeyForLocation, parsePlaceKey, discordTargetForPlaceKey } = require("./placeKey");
const { muffle } = require("./muffle");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { aliasSubject } = require("./concealedIdentity");

// How much is lost at each remove. Index IS the hop count; index 0 is never reached (your own Location returns above). Past the end of the table the words are gone and only the direction survives.
const MUFFLE_BY_DISTANCE = [0, 0, 0.4];

// The line one Location gets. `viaName` is the hearer's own neighbour toward the noise, null only at distance 0. `shouterName`/`muffled` are distance-0 facts, ignored elsewhere, riding in an options bag so the three-argument calls elsewhere stay honest.
// Distance 0 is FULL SIZE, everything beyond is `-#` subtext — the same split /play already makes: a shout in your own street is not scenery.
function shoutLine(text, distance, viaName, options = {}) {
  return renderShout(shoutParts(text, distance, viaName, options), distance);
}

// Discord's rendering of parts already built. shout() rolls the static ONCE per Location and renders the Discord line from those same parts, so Discord and Chat blank the same letters — two different rolls let a reader who sees both faces fill in each other's gaps.
function renderShout(parts, distance) {
  if (distance === 0) return parts.text;
  return ambientLine(parts.text, parts.lines);
}

// The same line as STRUCTURE rather than Discord formatting: `{ text, lines }`, exactly what ambientLine takes. db/lib/scene.js needs the pieces, not the rendered string, since a scene row deliberately stores no `-#` (the web draws a SYSTEM row as subtext itself).
// The muffling is random per call — call it once per audience and render both faces from the result (renderShout).
function shoutParts(text, distance, viaName, { shouterName = null, muffled = false } = {}) {
  if (distance === 0) {
    // No name is the FALLBACK, not a special case: a failed identity load leaves the anonymous line standing, erring toward hiding somebody visible rather than the reverse.
    const said = shouterName ? `${shouterName} shouts: » ${text}` : `You hear someone shout: » ${text}`;
    return { text: muffled ? `${said}, but it's muffled.` : said, lines: [] };
  }

  const where = viaName ? ` from the direction of ${viaName}` : " somewhere nearby";

  const fraction = MUFFLE_BY_DISTANCE[distance];
  if (fraction == null) {
    return { text: `You hear someone shout${where}.`, lines: [] };
  }
  return { text: `You hear someone shout${where}: » ${muffle(text, fraction)}`, lines: [] };
}

// ---------------------------------------------------------------- the shout

// What the room is told to call the shouter. presentedIdentity() decides concealment; the one choice left is WHICH string a hood gets — `identity.name` is Title Case (a webhook username), which mid-sentence reads as a real name, so a hood takes aliasSubject()'s "a young man" instead. A forced name or real name comes straight off the identity.
// Pure, exported for the tests: the whole feature rests on this one choice.
function shouterNameFor(character, identity) {
  if (!identity) return null;
  if (identity.concealed) return aliasSubject(character ?? {});
  return identity.name || null;
}

// The columns presentedIdentity() reads, plus the tags it resolves against. Modelled on db/lib/whosHere.js#PRESENT_SELECT minus Role/Faction — hearing somebody yell tells you their name, not who they answer to.
const SHOUTER_SELECT = {
  id: true,
  name: true,
  age: true,
  gender: true,
  concealed: true,
  updatedAt: true,
  tags: {
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
    },
    select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// The shouter's own row, re-read here rather than trusted from the caller — the web's actor() and the bot's select carry neither age/gender/concealed nor the tags, and growing both call sites is exactly what CONCEALMENT_TAG_FIELDS warns against. Any failure returns null, rendered as the anonymous line.
async function loadShouterName(prisma, characterId) {
  try {
    const row = await prisma.character.findUnique({ where: { id: characterId }, select: SHOUTER_SELECT });
    if (!row) return null;
    const identity = presentedIdentity(row, {
      forcedName: forcedNameFrom(row.tags),
      concealment: concealmentFrom(row.tags),
    });
    return shouterNameFor(row, identity);
  } catch (err) {
    console.error("Shout identity load failed:", err.message ?? err);
    return null;
  }
}

// Does this place eat a shout? A Room may be `soundproof` (docs/zones.yaml), and a Conversation inherits it from the Room it hangs under (PlayerThread.roomId is nullable, so one held on the open Location inherits nothing). A Location itself never is.
async function soundproofAt(prisma, placeKey) {
  const here = parsePlaceKey(placeKey);
  if (!here) return false;
  try {
    if (here.kind === "room") {
      const room = await prisma.room.findUnique({ where: { id: here.id }, select: { soundproof: true } });
      return room?.soundproof === true;
    }
    if (here.kind === "conv") {
      const conv = await prisma.playerThread.findUnique({
        where: { id: here.id },
        select: { room: { select: { soundproof: true } } },
      });
      return conv?.room?.soundproof === true;
    }
  } catch (err) {
    console.error("Shout soundproof lookup failed:", err.message ?? err);
  }
  return false;
}

// Five minutes between shouts, per character. The bot's number.
const SHOUT_COOLDOWN_MS = 5 * 60_000;

// The AuditLog row IS the cooldown and the record of the shout. `targetCharacterId` is the shouter (no other party), so the read is keyed on the character rather than the driving account.
const SHOUT_ACTION = "shout";

// Who hears it, and what they hear. `character` needs { id, locationId, discordUserId }; the name comes off a fresh read (loadShouterName). `placeKey` is where the shout was MADE — the only way to tell a vault from the street outside it.
// Returns { ok: true, muffled, here: { line, scene }, heard: [{ locationId, placeKey, name, distance, viaName, line, scene, discordChannelId }] } or { ok: false, error, retryAfter? } (seconds). `here` is ALWAYS present, even when `heard` is empty (inside a soundproof room it is the only thing there is). Posting is deliverShout()'s half — every caller hands this result straight to it.
async function shout(prisma, character, text, { placeKey = null } = {}) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "Say something." };
  // 300, the option's own maximum: goes into a couple dozen channels, half with most letters knocked out.
  if (body.length > 300) return { ok: false, error: "A shout can only be up to 300 characters." };

  if (!character?.id) return { ok: false, error: "You don't have a living character." };
  if (!character.locationId) return { ok: false, error: "You're nowhere." };

  // SHOUT, not ACT and not SPEAK: {tag:bound} blocks acting but never the voice (a hostage can still yell — it only stops the yell CARRYING, further down, a muffle rather than a refusal); {tag:mute} is the mirror, refused only here. Checked BEFORE the cooldown is claimed: a refused shout must not burn the throat timer.
  const voice = await loadVoiceState(prisma, character.id);
  if (voice.shoutBlock) {
    return { ok: false, error: `You can't get the words out — you're ${voice.shoutBlock.name}.` };
  }

  const last = await prisma.auditLog
    .findFirst({
      where: { actionType: SHOUT_ACTION, targetCharacterId: character.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    .catch(() => null);
  const since = Date.now() - (last?.createdAt?.getTime?.() ?? 0);
  if (since < SHOUT_COOLDOWN_MS) {
    const left = SHOUT_COOLDOWN_MS - since;
    const minutes = Math.max(1, Math.ceil(left / 60_000));
    return {
      ok: false,
      retryAfter: Math.ceil(left / 1000),
      error: `You need about ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  // Two different things muffle a shout: `sealed` (the walls hold it — nothing leaves the thread) and `gagged` ({tag:bound} — the yell happens and the room hears it, but it doesn't carry past; not a refusal, COMMANDS.md §2d, so it takes the hops, never the room).
  // Neither is a gate: everything above this point can still refuse; nothing below does, since a muffled shout still costs the throat.
  const sealed = await soundproofAt(prisma, placeKey);
  const gagged = voice.shoutMuffled === true;
  const muffled = sealed || gagged;
  const shouterName = await loadShouterName(prisma, character.id);

  // The room you are standing in, rendered once, named and told about the walls if any.
  const hereScene = shoutParts(body, 0, null, { shouterName, muffled });
  const here = { line: renderShout(hereScene, 0), scene: hereScene };

  // WHO hears it, before the cooldown is claimed: a turned-away shout must not cost five minutes of throat. Skipped when soundproof (nowhere for the BFS to go); a gag asks the same BFS for just its origin (maxHops 0).
  const range = sealed ? [] : await soundRange(prisma, character.locationId, gagged ? 0 : undefined);
  const heard = range.map((place) => {
    // Rolled once: `scene` (db/lib/scene.js, Chat) and `line` (Discord) carry the same static.
    const scene = shoutParts(body, place.distance, place.viaName, { shouterName, muffled });
    return {
      locationId: place.locationId,
      placeKey: placeKeyForLocation(place.locationId),
      name: place.name,
      discordChannelId: place.discordChannelId,
      distance: place.distance,
      viaName: place.viaName,
      line: renderShout(scene, place.distance),
      scene,
    };
  });

  // Nobody at all is worth saying rather than "you shout" into a void, still ahead of the cooldown claim. The `!muffled` guard is load-bearing: a soundproof room empties `heard` by design and would otherwise refuse every muffled shout.
  if (!muffled && heard.length === 0) return { ok: false, error: "There's nobody here to hear it." };

  // Claimed once the shout is certain, BEFORE the caller's posting loop — that loop is real seconds of REST calls, long enough for a second shout to slip past a cooldown claimed at the end. `turnId` is set since this row is the ration the cooldown reads back (REQUESTS.md §1a).
  const openTurn = await prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true } })
    .catch(() => null);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "",
        actionType: SHOUT_ACTION,
        targetCharacterId: character.id,
        turnId: openTurn?.id ?? null,
        details: { locationId: character.locationId, text: body, placeKey, muffled, sealed, gagged },
      },
    })
    .catch((err) => console.error("Shout audit log failed:", err.message ?? err));

  return { ok: true, muffled, here, heard, line: muffled ? "You shout, but it's muffled." : "You shout." };
}


// --------------------------------------------------------------- delivering

// Which of `heard` still needs delivering once `here` has been. Pure, exported for the test — the whole de-duplication rule. soundRange includes the shouter's own Location at distance 0, so a caller shouting FROM a `loc:` key (the turn engine's Xom scream does) names the same place twice; a `room:`/`conv:` key can never collide.
function shoutAudience(placeKey, heard = []) {
  return heard.filter((place) => place.placeKey !== placeKey);
}

// Put a finished shout in front of the people shout() says can hear it. Two halves per place: the archive row (what Chat/`/archive` show, the only half a web-only player sees) and the Discord post — neither downstream of the other (the outbox carries WEB rows only, db/lib/scene.js).
// `placeKey` is where the shout was MADE; `here` is that place, `heard` the Locations around it. Sequential, no Promise.all — a fan-out would burst Discord's rate-limit buckets (same discipline as bot/src/lib/deathSmell.js).
// NOTHING HERE MAY THROW: by the time this runs the shout has happened and the cooldown is spent, so a dead channel is one audience short, not a failed shout. Every step is caught on its own.
async function deliverShout(prisma, { placeKey, here, heard = [] } = {}) {
  if (placeKey && here) {
    try {
      await sceneLine(prisma, {
        placeKey,
        text: here.scene.text,
        lines: here.scene.lines,
        channelKind: "shout",
      });
    } catch (err) {
      console.error(`Shout row for ${placeKey} failed:`, err?.message ?? err);
    }
    try {
      const target = await discordTargetForPlaceKey(prisma, placeKey);
      const channelId = target?.threadId ?? target?.channelId ?? null;
      if (channelId) await postMessage(channelId, here.line, undefined, { parse: [] });
    } catch (err) {
      console.error(`Shout into ${placeKey} failed:`, err?.message ?? err);
    }
  }

  for (const place of shoutAudience(placeKey, heard)) {
    try {
      await sceneLine(prisma, { placeKey: place.placeKey, text: place.scene.text, lines: place.scene.lines });
    } catch (err) {
      console.error(`Shout row for ${place.name} failed:`, err?.message ?? err);
      continue;
    }
    if (!place.discordChannelId) continue;
    try {
      // parse: [] — no mentions: the text is player-typed and this is the widest broadcast in the game; an "@everyone" here would ping twenty-nine channels at once.
      await postMessage(place.discordChannelId, place.line, undefined, { parse: [] });
    } catch (err) {
      console.error(`Shout into ${place.name} failed:`, err?.message ?? err);
    }
  }
}

module.exports = {
  shoutLine,
  shoutParts,
  renderShout,
  shouterNameFor,
  shoutAudience,
  shout,
  deliverShout,
};
