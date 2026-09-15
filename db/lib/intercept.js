// LAYING IN WAIT (docs/systemdocs/INTERCEPT.md). You set a watch — mode, a line
// to say, who you're watching for — and when a match walks in where you're standing they're stopped and handed your words. Safe holds two minutes; Ambush holds until the turn ends or you release them.
// This is the only module that knows what a watch is (the db/lib/escort.js posture). Takes `db` as a parameter, deliberately NOT on the @lifeweb/db barrel (dm.js convention); require by path. IT SENDS NOTHING — fireWatches returns DM descriptors like the Caving Die's `cavingDm`, sent by the caller after its transaction commits (no network call inside a $transaction, ARCHITECTURE.md §5).
// THE HOLD IS DERIVED — Character.heldUntil is a plain timestamp, past it you're free and nothing had to notice, so this needs no cron, turn pass or rows to sweep (the keyed-way pattern, MAP.md §2b, applied to a person). An Ambush gets its timestamp from attack.js instead, since an Ambush IS an attack now; either way it's the turn's own end, so the turn advance releases everybody for free.
// A hold takes MOVEMENT only, never ACT — deliberately not an incapacitating tag (incapacitation.js): a person held at knifepoint can still talk, fight back and file a Gambit. An ambush is a standoff, not a paralysis.
const { presentedIdentity, CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");
const { withArticle } = require("./concealedIdentity");
const { matchesTypedName } = require("./characterName");
const { blockerFor, ACT } = require("./incapacitation");
const { reFor } = require("./discordMarkup");
const { DM_KIND } = require("./dmKinds");
// For the auto-search refusal note only: it is guidance sitting under somebody's
// own catch line rather than a notice of its own, which is what `-#` is for
// (CLAUDE.md, "Bot message style"). The helper is used for its per-line prefixing.
const { ambientLine } = require("./ambientLine");

// WHY somebody cannot move, written onto Character.heldReason beside the timestamp.
// Three values, not two: a fight holds BOTH sides and they're not in the same position, so the jumped and the jumper must not read the same sentence. A frozen table rather than hand-written strings across files — db/lib/characterDeath.js's clear once lacked this guard, and a typo'd literal is how that happens twice.
const HELD_REASON = Object.freeze({
  INTERCEPT: "intercept",
  ATTACK: "attack",
  ATTACKING: "attacking",
});

// The two that a fight writes. releaseHeldBy and every other heldById clear must leave these alone — only the Attack row knows whether either side is still in another fight (ATTACK.md §2).
const FIGHT_REASONS = Object.freeze([HELD_REASON.ATTACK, HELD_REASON.ATTACKING]);

// "...and this hold is not a fight", as a `where` fragment to spread in. Written as
// an explicit OR, not a bare `notIn` — the column is nullable and in SQL `x NOT IN (…)` is NULL (FALSE) when x is NULL, so a bare notIn would read every already-running intercept hold (NULL heldReason) as a fight and leave it unreleasable until the turn ended; the migration also backfills those rows, but this half doesn't depend on Prisma's query generation.
const NOT_A_FIGHT = Object.freeze({
  OR: [{ heldReason: null }, { heldReason: { notIn: FIGHT_REASONS } }],
});

// Two minutes, Bascinet's number — long enough to say something and be answered, short enough that walking into a checkpoint isn't a punishment.
const SAFE_HOLD_MS = 2 * 60 * 1000;

// What a watch may carry. The name cap is FULL_NAME_LIMIT's business; this is how MANY, a sanity bound not a design statement — wanting more than this means wanting "Any person".
const MAX_NAMES = 12;
const MESSAGE_LIMIT = 300;

// The Release button that used to ride the ambusher's DM. Nothing builds one any more (an ambush files an Attack and wears Cancel attack instead, attack.js), but the prefix and its answerer stay so a button already sitting in somebody's DMs still does something.
const INTERCEPT_RELEASE_PREFIX = "icept:release:";

// ─── The message a player typed ───────────────────────────────────────────

// Capped and de-pinged at SAVE time, never at send — so the stored row, the DirectMessage
// row, /gm/messages, the player's own web thread and the Discord send are all clean from one place; doing it at send would leave the logged copy carrying the ping (remarkDiscord.js renders that token on the web too). Only the broadcast pings go — <@id>, <#id> and <t:…> are the sanctioned vocabulary (discordMarkup.test.js), stripping them would be stripping the language.
function cleanMessage(text) {
  return (text ?? "")
    .toString()
    .replace(reFor("ping"), (m) => m.slice(1))
    .trim()
    .slice(0, MESSAGE_LIMIT);
}

function cleanNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = (raw ?? "").toString().trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

// ─── The hold ──────────────────────────────────────────────────────────────

// PURE. `character` needs heldUntil only. Returns the refusal sentence, or null when
// they may walk. Every surface that draws a way out reads this, and so does the one gate in locationTravel.js#performLocationMove, so a picker and the mover can never disagree.
function heldReasonFor(character, now = new Date()) {
  const until = character?.heldUntil ? new Date(character.heldUntil) : null;
  if (!until || until.getTime() <= now.getTime()) return null;
  // WHICH of the two things has hold of them — a column rather than a query, since this function is pure and eight surfaces read it (see Character.heldReason in schema.prisma).
  if (character.heldReason === HELD_REASON.ATTACK) {
    return "Somebody attacked you. You can't move until the end of the turn.";
  }
  // The other side of the same fight — they started it, so telling them they were attacked would be a plain lie on every shut way and every banner.
  if (character.heldReason === HELD_REASON.ATTACKING) {
    return "You're in a fight. You can't move until the end of the turn.";
  }
  const seconds = Math.ceil((until.getTime() - now.getTime()) / 1000);
  // Under five minutes it's worth counting down; a hold that runs to the end of the turn isn't — "43188s" would be worse than saying nothing.
  return seconds <= 300
    ? `Somebody intercepted you. You can't move for another ${seconds}s.`
    : "Somebody ambushed you. You can't move until the end of the turn.";
}

// The one write that ends a hold early — the holder's Release button on the web, the
// same button in their DM, and the holder walking away or dying. Conditional on `heldById` so nobody can free somebody else's prisoner, and a lapsed or handed-on hold isn't clobbered.
async function releaseHeldBy(db, holderId, { targetId = null } = {}) {
  // An ATTACK hold is not this function's to end — both sides of a fight are held and
  // each names the other, so letting Release touch one would free the victim, leave the Attack row live, and leave the attacker held by a fight that no longer holds anybody. Breaking off is attack.js#cancelAttack, and only that.
  const where = { heldById: holderId, heldUntil: { gt: new Date() }, ...NOT_A_FIGHT };
  if (targetId) where.id = targetId;
  const freed = await db.character.findMany({
    where,
    select: { id: true, name: true, discordUserId: true, status: true },
  });
  if (freed.length === 0) return [];
  await db.character.updateMany({
    where: { id: { in: freed.map((c) => c.id) } },
    data: { heldUntil: null, heldById: null, heldReason: null },
  });
  return freed;
}

// ─── The anchor ────────────────────────────────────────────────────────────

// PURE. A watch is set in one place and works there only. Every reader asks this rather
// than trusting the row to have been cleaned up — the delete below is what a player sees, this is what makes an outlived row harmless anyway.
function anchorHolds(watch, locationId) {
  return Boolean(watch?.locationId) && Boolean(locationId) && watch.locationId === locationId;
}

// PURE, and the second half of "does this watch reach this person": anchorHolds asks
// where the WATCH is, this asks where the ARRIVAL came from. Off, a watch reaches everybody and this costs nothing — which is the default and what every watch set before the flag existed does. On, it is the gate guard's mute button: the townsfolk crossing their own square all day stop generating the same line, and only somebody who actually came up the road is stopped.
// An arrival with no previous zone at all counts as OUTSIDE. An unknown origin is a stranger, and the other way round would be a hole in a watch somebody deliberately turned on.
// Deliberately NOT folded into matchesArrival: that function is the hood rule and only the hood rule (INTERCEPT.md §2). Where you came from is geography, not a face.
function originHolds(watch, arrival, zoneId) {
  if (!watch?.outsideZoneOnly) return true;
  return arrival?.fromZoneId !== zoneId;
}

// Moving cancels the watch. Called from locationMove.js#applyLocationMoveSideEffects,
// the writer EVERY relocation runs — walking, an escort, a GM teleport, a Bulk Move, a staged Relocate to, a rite. Deliberately the opposite hook from firing (fireWatches hangs off the mover, so a teleport can't trip somebody's ambush): a watch fires only from the road, but dies however you left. IT SENDS NOTHING, like the rest of this module — the caller is handed `cancelled` and sends INTERCEPT_CANCELLED_DM itself.
async function cancelWatchOnMove(db, characterId) {
  if (!characterId) return { cancelled: false };
  const gone = await db.interceptWatch.deleteMany({ where: { characterId } });
  if (gone.count === 0) return { cancelled: false };

  // The same actionType the save and Stop watching write — the AuditLog row is the only history a watch has, since the row itself is overwritten.
  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  await db.auditLog
    .create({
      data: {
        // "system", not the walker: nobody chose to end the watch — a GM's teleport ends one as surely as its owner's own legs do.
        actorDiscordUserId: "system",
        actionType: "request_intercept_set",
        targetCharacterId: characterId,
        turnId: openTurn?.id ?? null,
        details: { stopped: true, reason: "moved" },
      },
    })
    .catch((err) => console.error(`Intercept: cancel audit row failed for ${characterId}:`, err.message ?? err));

  return { cancelled: true };
}

// Bascinet's words, verbatim.
const INTERCEPT_CANCELLED_DM = "You left, so your interception was canceled.";

// ─── Who a watch catches ───────────────────────────────────────────────────

// A HOOD BEATS A NAME, and this is the line that makes it true. A typed name is
// matched against the identity the room would SEE, never the row — a hooded Greeblus reads as "a young man" and no watch naming him reaches him (that's what "any concealed person" is for). Without this rule Intercept would be a hood-defeating radar: a free watch would tell you Greeblus is here AND that he's hiding it, exactly what the hood is bought to prevent. A forced name (Apex Form's "Beast") is unmatchable for the same reason. `presented` is presentedIdentity()'s result for the arrival.
function matchesArrival(watch, arrival, presented) {
  if (!watch) return null;
  if (watch.anyPerson) return "anyPerson";
  if (presented?.concealed || presented?.forced) {
    return watch.anyConcealed && presented.concealed ? "anyConcealed" : null;
  }
  const typed = (watch.targetNames ?? []).find((name) => matchesTypedName(arrival, name));
  return typed ? "name" : null;
}

// What the room saw: "Lord Greeblus", or "a young man" for anybody hiding it. Both
// directions of every Intercept DM go through this, which stops the confirmation DM being the unmasking tool matchesArrival just closed.
function seenAs(presented) {
  if (!presented) return "somebody";
  return presented.concealed ? withArticle(presented.name.toLowerCase()) : presented.name;
}

// "He said" / "She said" / "They said" — Bascinet's line is "He said", wrong for half the cast; the shape is theirs, the agreement is arithmetic. Straight off Character.gender, the same column concealedIdentity.js reads.
function saidWord(character) {
  if (character?.gender === "MAN") return "He said";
  if (character?.gender === "WOMAN") return "She said";
  return "They said";
}

// Everything presentedIdentity needs, for a character loaded fresh.
const IDENTITY_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  age: true,
  gender: true,
  concealed: true,
  status: true,
  locationId: true,
  discordUserId: true,
  updatedAt: true,
  tags: {
    where: { quantity: { gt: 0 } },
    select: { equipped: true, tag: { select: { ...CONCEALMENT_TAG_FIELDS, slug: true, forcedName: true } } },
  },
};

// IDENTITY_SELECT already filters the held tags to quantity > 0, so both helpers see exactly what the character has on them.
function identityOf(row) {
  const tags = row?.tags ?? [];
  return presentedIdentity(row, { forcedName: forcedNameFrom(tags), concealment: concealmentFrom(tags) });
}

// ─── Firing ────────────────────────────────────────────────────────────────

// Called once by locationTravel.js#performLocationMove with everyone who just arrived
// — the mover first, then their whole escort party, which makes "if several people come up together, all of them get stopped" free rather than a feature of its own. Runs AFTER the move's transaction commits, does its own small transactions per catch. Returns DM descriptors; sends nothing.
async function fireWatches(db, { arrivals, locationId, zoneId = null, openTurn }) {
  const dms = [];
  if (!locationId || !openTurn || !Array.isArray(arrivals) || arrivals.length === 0) return { dms, hits: [] };

  const arrivalIds = new Set(arrivals.map((a) => a.id).filter(Boolean));

  // Everybody laying in wait here, with what a watch needs to be allowed to fire at all. Loaded once for the whole party.
  const watches = await db.interceptWatch.findMany({
    where: {
      // The anchor is the rule: a watch works where it was set and nowhere else. The
      // character clause stays beside it rather than replacing it, since the cancel can be missed — every applyLocationMoveSideEffects caller swallows its throw, so a Discord failure mid-relocation can leave a live row anchored to a place its owner already left. This makes that a dud instead of a ghost.
      locationId,
      character: { locationId, status: "ALIVE" },
      OR: [{ anyPerson: true }, { anyConcealed: true }, { NOT: { targetNames: { isEmpty: true } } }],
    },
    include: { character: { select: IDENTITY_SELECT } },
  });

  const live = watches.filter((w) => {
    // You cannot lay in wait while you are walking — a watcher who arrived in the same
    // party as their quarry has been on the road all day, not standing in it; catching the person you travelled with would be a trick nobody meant to build.
    if (arrivalIds.has(w.characterId)) return false;
    // Dying, bound, catatonic, crucified: none of them stop a stranger walking past. The
    // watch row survives — a standing preference, like an escort consent — and works again the moment they can act.
    return !blockerFor(w.character.tags, ACT);
  });
  if (live.length === 0) return { dms, hits: [] };

  const now = new Date();
  const hits = [];

  for (const arrival of arrivals) {
    const row = await db.character.findUnique({ where: { id: arrival.id }, select: IDENTITY_SELECT });
    if (!row || row.status !== "ALIVE") continue;
    // They may have walked straight on again, or been walked on by somebody else, between the move committing and this running.
    if (row.locationId !== locationId) continue;
    const presented = identityOf(row);

    for (const watch of live) {
      const matchedBy = matchesArrival(watch, row, presented);
      if (!matchedBy) continue;
      // Where they came from, not who they are. It reads `arrival` and not `row`, since
      // the journey is on the descriptor the mover handed us and the fresh row knows only the face. BEFORE the ration insert below: a local this watch deliberately ignored must not burn the turn's one catch, or a stranger arriving later the same turn would walk straight through.
      if (!originHolds(watch, arrival, zoneId)) continue;

      // THE RATION, and the insert IS the enforcement. Without it a lapsed two-minute
      // hold is walked straight back into, and a Safe watch on a busy road becomes an endless roadblock and DM feed. A unique violation means this catcher already caught this target this turn — not an error, the rule working. Keyed to the CATCHER, never the watch row: a watch dies when its owner walks off, so a row-keyed ration would reset by stepping out and back.
      try {
        await db.interceptHit.create({
          data: { interceptorId: watch.characterId, targetCharacterId: row.id, turnId: openTurn.id },
        });
      } catch (err) {
        if (err?.code === "P2002") continue;
        throw err;
      }

      // An Ambush carries NO deadline of its own — attack.js#fileAttack owns that clock now, so there's exactly one "when does the turn end", not two copies drifting apart.
      const ambush = watch.mode === "AMBUSH";
      const until = ambush ? null : new Date(now.getTime() + SAFE_HOLD_MS);
      hits.push({ watch, interceptor: watch.character, target: row, presented, matchedBy, ambush, until });

      // The record a GM reads on /gm/audit. turnId is set since the once-per-turn rule
      // is turn-scoped and a row without it is unreadable as a record of it (though the rule is ENFORCED by the unique above, never by counting these — REQUESTS.md §1a). `presented`, not the real name: the audit log isn't a place to unmask somebody the game just refused to unmask.
      await db.auditLog
        .create({
          data: {
            // An interceptor with no Discord account is a threat seat, and AuditLog.actorDiscordUserId is NOT NULL — the whole row used to be lost to the catch below.
            actorDiscordUserId: watch.character.discordUserId ?? "system",
            actionType: "request_intercept_fired",
            targetCharacterId: row.id,
            turnId: openTurn.id,
            details: { mode: watch.mode, matchedBy, presented: presented.name, locationId },
          },
        })
        .catch((err) => console.error(`Intercept: audit row failed for ${row.id}:`, err.message ?? err));
    }
  }

  if (hits.length === 0) return { dms, hits: [] };

  // AN AMBUSH IS AN ATTACK (ATTACK.md). It files a real Attack row and that's what
  // holds both sides — the ambusher included, since springing the trap puts you in the fight too. No strength gate: you set a watch blind and don't get to pick who walks into it. Required lazily since attack.js requires this module back for the hold's own vocabulary — a cycle resolved at call time, not load time, so neither half ever sees a partial exports object.
  const { fileAttack } = require("./attack");
  const attackDmsOut = [];
  for (const hit of hits.filter((h) => h.ambush)) {
    const filed = await fileAttack(db, {
      attacker: hit.interceptor,
      target: hit.target,
      openTurn,
      fromAmbush: true,
      locationId,
    });
    // The unique on Attack already has these two, this turn — button-attacked, or
    // ambushed and broken off. Nobody was newly held, so the victim must NOT be told "it's an ambush, you can't move": a false line is worse than no line. Very hard to reach (the InterceptHit ration above stops the same catcher twice a turn), but it costs one flag to never lie.
    hit.held = filed.ok;
    attackDmsOut.push(...filed.dms);
  }

  // ONE hold per person, however many caught them: the longest wins, so a second Safe stop can't shorten the first. Conditional on the clock, so a hold already running longer (an Ambush's, above) is left exactly where it is.
  const longest = new Map();
  for (const hit of hits.filter((h) => !h.ambush)) {
    const best = longest.get(hit.target.id);
    if (!best || (hit.until && hit.until > best.until)) longest.set(hit.target.id, hit);
  }
  for (const hit of longest.values()) {
    if (!hit.until) continue;
    await db.character.updateMany({
      where: { id: hit.target.id, OR: [{ heldUntil: null }, { heldUntil: { lt: hit.until } }] },
      data: { heldUntil: hit.until, heldById: hit.interceptor.id, heldReason: HELD_REASON.INTERCEPT },
    });
  }

  // The victim hears from each of them. Three guards at the gate is three lines, since walking into three people is what happened.
  for (const hit of hits) {
    if (!hit.target.discordUserId) continue;
    if (hit.ambush && !hit.held) continue;
    const stopper = seenAs(identityOf(hit.interceptor));
    if (hit.ambush) {
      dms.push({
        discordUserId: hit.target.discordUserId,
        content: [
          "You were stopped on the road. It's an ambush! You can't move until the end of the turn. Make a Gambit declaring your intent!",
          ...(hit.watch.message ? [`» ${hit.watch.message}`] : []),
        ].join("\n"),
        kind: DM_KIND.NOTICE,
        authorDiscordUserId: hit.watch.message ? hit.interceptor.discordUserId ?? null : null,
      });
    } else {
      dms.push({
        discordUserId: hit.target.discordUserId,
        content: [
          `You were stopped on the road by ${stopper}. ${saidWord(hit.interceptor)}:`,
          `» ${hit.watch.message || "…"}`,
          "You can't move for two minutes.",
        ].join("\n"),
        // NOTICE even with typed words in it — it's the game delivering a stop; as CONVERSATION every stop on the road pinged the GM inbox.
        kind: DM_KIND.NOTICE,
        authorDiscordUserId: hit.interceptor.discordUserId ?? null,
      });
    }
  }

  // And the interceptor hears what they caught. A Safe watch reports its whole haul in
  // one line; an Ambush is one DM each, since each carries a Release button and a button answers about exactly one person (dmActions.js#dmAction).
  const byInterceptor = new Map();
  for (const hit of hits) {
    if (!byInterceptor.has(hit.interceptor.id)) byInterceptor.set(hit.interceptor.id, []);
    byInterceptor.get(hit.interceptor.id).push(hit);
  }
  for (const group of byInterceptor.values()) {
    const who = group[0].interceptor;
    if (!who.discordUserId) continue;
    const safe = group.filter((h) => !h.ambush);
    if (safe.length > 0) {
      dms.push({
        discordUserId: who.discordUserId,
        content: `You successfully intercepted ${safe.map((h) => seenAs(h.presented)).join(", ")}.`,
        kind: DM_KIND.NOTICE,
      });
    }
    // The ambusher's own line is attack.js's now, since the button calls off a fight rather than releasing a hold — still one DM per victim, a button answers about exactly one person.
  }
  dms.push(...attackDmsOut);

  // AUTO-SEARCH (docs/systemdocs/SEARCH.md §6). A watch with the box ticked also
  // ASKS to search whoever it caught — it buys the ask and never the answer, so
  // the consent DM is the ordinary one and No is a real answer.
  //
  // Required lazily for fileAttack's reason one block up: search.js requires this
  // module back for seenAs/identityOf/IDENTITY_SELECT, so the cycle is resolved at
  // call time rather than load time and neither half sees a partial exports object.
  //
  // Runs LAST, after the InterceptHit ration has claimed the catch and after the
  // ambush has filed: searching somebody you did not actually stop would be a lie,
  // which is what `hit.held` guards below — the same flag the victim's DM uses.
  const { createSearchOffer } = require("./search");
  for (const hit of hits.filter((h) => h.watch.autoSearch)) {
    if (hit.ambush && !hit.held) continue;
    const asked = await createSearchOffer(db, {
      actor: hit.interceptor,
      target: hit.target,
      turn: openTurn,
    }).catch((err) => {
      console.error(`Intercept: auto-search for ${hit.target.id} failed:`, err.message ?? err);
      return { ok: false, reason: null };
    });
    if (asked.ok) {
      dms.push({ ...asked.dm, kind: DM_KIND.NOTICE });
      continue;
    }
    // The TARGET is told nothing — they must not hear about a search that never
    // happened. The person who ticked the box is, because silence there reads as
    // a bug. Only reachable when the same searcher already searched this person by
    // hand this turn, since InterceptHit is itself once per person per turn.
    if (asked.reason && hit.interceptor.discordUserId) {
      dms.push({
        discordUserId: hit.interceptor.discordUserId,
        content: ambientLine(asked.reason),
        kind: DM_KIND.NOTICE,
      });
    }
  }

  return { dms, hits };
}

module.exports = {
  HELD_REASON,
  FIGHT_REASONS,
  NOT_A_FIGHT,
  SAFE_HOLD_MS,
  MAX_NAMES,
  MESSAGE_LIMIT,
  INTERCEPT_RELEASE_PREFIX,
  cleanMessage,
  cleanNames,
  heldReasonFor,
  releaseHeldBy,
  anchorHolds,
  originHolds,
  cancelWatchOnMove,
  INTERCEPT_CANCELLED_DM,
  matchesArrival,
  seenAs,
  saidWord,
  IDENTITY_SELECT,
  identityOf,
  fireWatches,
};
