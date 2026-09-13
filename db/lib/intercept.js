// LAYING IN WAIT (docs/systemdocs/INTERCEPT.md).
//
// You set a watch — a mode, a line to say, and who you are watching for — and
// when one of them walks in where you are standing they are stopped and handed
// your words. A Safe intercept holds them two minutes. An Ambush holds them
// until the turn ends, or until you let them go.
//
// This is the only module that knows what a watch is, the db/lib/escort.js
// posture. It takes `db` as a parameter and is deliberately NOT on the
// @lifeweb/db barrel (the db/lib/dm.js convention); require it by path.
//
// IT SENDS NOTHING. fireWatches returns DM descriptors the way the Caving Die
// returns `cavingDm`, and the caller sends them after its transaction commits
// — no network call may run inside a $transaction (ARCHITECTURE.md §5).
//
// THE HOLD IS DERIVED, and that is the whole reason this feature needs no
// cron, no turn pass and no rows to sweep. Character.heldUntil is a plain
// timestamp: past it, you are free, and nothing had to notice. It is the
// keyed-way pattern (MAP.md §2b) applied to a person instead of a door. An
// An Ambush gets its timestamp from db/lib/attack.js instead, because an
// Ambush IS an attack now; either way it is the turn's own end, so the turn
// advance releases everybody for free.
//
// A hold takes MOVEMENT and nothing else. It is deliberately not an
// incapacitating tag (db/lib/incapacitation.js): those take ACT as well, and a
// person somebody is holding at knifepoint is meant to be able to talk, fight
// back and file a Gambit of their own. That is the whole shape of the thing —
// an ambush is a standoff, not a paralysis.
const { presentedIdentity, CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");
const { withArticle } = require("./concealedIdentity");
const { matchesTypedName } = require("./characterName");
const { blockerFor, ACT } = require("./incapacitation");
const { reFor } = require("./discordMarkup");
const { DM_KIND } = require("./dmKinds");

// WHY somebody cannot move, written onto Character.heldReason beside the
// timestamp. Three values rather than two, because a fight holds BOTH sides
// and they are not in the same position: the person who was jumped and the
// person who did the jumping must not read the same sentence.
//
// A frozen table rather than seven hand-written strings across four files —
// the clear in db/lib/characterDeath.js was written without the guard the
// clear in this file has, and a typo'd literal is exactly how that happens
// twice.
const HELD_REASON = Object.freeze({
  INTERCEPT: "intercept",
  ATTACK: "attack",
  ATTACKING: "attacking",
});

// The two that a fight writes. releaseHeldBy and every other clear that works
// off heldById has to leave these alone: only the Attack row knows whether
// either side is still in another fight (docs/systemdocs/ATTACK.md §2).
const FIGHT_REASONS = Object.freeze([HELD_REASON.ATTACK, HELD_REASON.ATTACKING]);

// "...and this hold is not a fight", as a `where` fragment to spread in.
//
// Written as an explicit OR rather than a bare `notIn`, and that is not
// belt-and-braces. The column is nullable, and in SQL `x NOT IN (…)` is NULL
// — which is FALSE — when x is NULL. Every intercept hold that was already
// running when this shipped has a NULL heldReason, so a bare notIn could read
// each one as a fight and leave it unreleasable until the turn ended. The
// migration backfills those rows too; this is the half that does not depend on
// which Prisma version is generating the query.
const NOT_A_FIGHT = Object.freeze({
  OR: [{ heldReason: null }, { heldReason: { notIn: FIGHT_REASONS } }],
});

// Two minutes, Bascinet's number. Long enough to say something and be
// answered, short enough that walking into a checkpoint is not a punishment.
const SAFE_HOLD_MS = 2 * 60 * 1000;

// What a watch may carry. The name cap is FULL_NAME_LIMIT's business; this is
// how MANY, and it is a sanity bound rather than a design statement — a
// player who wants to watch for more than this wants "Any person".
const MAX_NAMES = 12;
const MESSAGE_LIMIT = 300;

// The Release button that used to ride the ambusher's DM. Nothing builds one
// any more — an ambush files an Attack and wears Cancel attack instead
// (db/lib/attack.js) — but the prefix and its answerer stay so that a button
// already sitting in somebody's DMs when this shipped still does something.
const INTERCEPT_RELEASE_PREFIX = "icept:release:";

// ---------------------------------------------------------------------------
// The message a player typed
// ---------------------------------------------------------------------------

// Capped and de-pinged at SAVE time, never at send. Sanitizing here means the
// stored row, the DirectMessage row, /gm/messages, the player's own web thread
// and the Discord send are all clean from one place; doing it at send would
// leave the logged copy carrying the ping, and web/app/components/
// remarkDiscord.js renders that token on the web too.
//
// Only the broadcast pings go. <@id>, <#id> and <t:…> are the sanctioned
// vocabulary db/test/discordMarkup.test.js pins, and they render correctly on
// both faces — stripping them would be stripping the language.
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

// ---------------------------------------------------------------------------
// The hold
// ---------------------------------------------------------------------------

// PURE. `character` needs heldUntil only. Returns the refusal sentence, or
// null when they may walk. Every surface that draws a way out reads this, and
// so does the one gate in db/lib/locationTravel.js#performLocationMove, so a
// picker and the mover can never disagree about whether somebody is held.
function heldReasonFor(character, now = new Date()) {
  const until = character?.heldUntil ? new Date(character.heldUntil) : null;
  if (!until || until.getTime() <= now.getTime()) return null;
  // WHICH of the two things has hold of them. A column rather than a query,
  // because this function is pure and eight surfaces read it — see the
  // Character.heldReason comment in db/prisma/schema.prisma.
  if (character.heldReason === HELD_REASON.ATTACK) {
    return "Somebody attacked you. You can't move until the end of the turn.";
  }
  // The other side of the same fight. They know perfectly well what is holding
  // them — they started it — and telling them they were attacked would be a
  // plain lie on every shut way and every banner.
  if (character.heldReason === HELD_REASON.ATTACKING) {
    return "You're in a fight. You can't move until the end of the turn.";
  }
  const seconds = Math.ceil((until.getTime() - now.getTime()) / 1000);
  // Under five minutes it is worth counting down; a hold that runs to the end
  // of the turn is not, and saying "43188s" would be worse than saying nothing.
  return seconds <= 300
    ? `Somebody intercepted you. You can't move for another ${seconds}s.`
    : "Somebody ambushed you. You can't move until the end of the turn.";
}

// The one write that ends a hold early, and the three callers that use it: the
// holder's Release button on the web, the same button in their DM, and the
// holder walking away or dying. Conditional on `heldById` so nobody can free
// somebody else's prisoner, and so a hold that has already lapsed or been
// handed on is not clobbered.
async function releaseHeldBy(db, holderId, { targetId = null } = {}) {
  // An ATTACK hold is not this function's to end. Both sides of a fight are
  // held and each names the other, so letting the intercept Release touch one
  // would free the victim, leave the Attack row live, and leave the attacker
  // standing there held by a fight that no longer holds anybody. Breaking off
  // is db/lib/attack.js#cancelAttack, and only that.
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

// ---------------------------------------------------------------------------
// The anchor
// ---------------------------------------------------------------------------

// PURE. A watch is set in one place and works in that place only. Every reader
// asks this rather than trusting the row to have been cleaned up: the delete
// below is what a player sees, and this is what makes a row that somehow
// outlived its place harmless anyway.
function anchorHolds(watch, locationId) {
  return Boolean(watch?.locationId) && Boolean(locationId) && watch.locationId === locationId;
}

// Moving cancels the watch. Called from
// db/lib/locationMove.js#applyLocationMoveSideEffects, which is the writer
// EVERY relocation runs — walking, being carried along by an escort, a GM's
// teleport, a Bulk Move, a staged Relocate to, a rite. That is deliberately
// the opposite hook from firing (fireWatches hangs off the mover, so a
// teleport cannot trip somebody's ambush): a watch fires only from the road,
// but it dies however you left.
//
// IT SENDS NOTHING, like the rest of this module. The caller is handed
// `cancelled` and sends INTERCEPT_CANCELLED_DM itself.
async function cancelWatchOnMove(db, characterId) {
  if (!characterId) return { cancelled: false };
  const gone = await db.interceptWatch.deleteMany({ where: { characterId } });
  if (gone.count === 0) return { cancelled: false };

  // The same actionType the save and Stop watching write: the AuditLog row is
  // the only history a watch has, because the row itself is overwritten.
  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  await db.auditLog
    .create({
      data: {
        // "system", not the walker: nobody chose to end the watch — a GM's
        // teleport ends one as surely as its owner's own legs do.
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

// ---------------------------------------------------------------------------
// Who a watch catches
// ---------------------------------------------------------------------------

// A HOOD BEATS A NAME, and this is the line that makes it true.
//
// A typed name is matched against the identity the room would SEE, never
// against the row. So a hooded Greeblus reads as "a young man" and no watch
// naming him reaches him — which is what the "any concealed person" option is
// for. Without this rule Intercept would be a hood-defeating radar: a watch
// costing nothing would tell you Greeblus is here AND that he is hiding it,
// which is precisely what the hood is bought to prevent. A forced name (Apex
// Form's "Beast") is not matchable either, and for the same reason.
//
// `presented` is presentedIdentity()'s result for the arrival.
function matchesArrival(watch, arrival, presented) {
  if (!watch) return null;
  if (watch.anyPerson) return "anyPerson";
  if (presented?.concealed || presented?.forced) {
    return watch.anyConcealed && presented.concealed ? "anyConcealed" : null;
  }
  const typed = (watch.targetNames ?? []).find((name) => matchesTypedName(arrival, name));
  return typed ? "name" : null;
}

// What the room saw. "Lord Greeblus", or "a young man" for anybody hiding it.
// Both directions of every Intercept DM go through this, which is what stops
// the confirmation DM being the unmasking tool matchesArrival just closed.
function seenAs(presented) {
  if (!presented) return "somebody";
  return presented.concealed ? withArticle(presented.name.toLowerCase()) : presented.name;
}

// "He said" / "She said" / "They said". Bascinet's line is "He said", which is
// wrong for half the cast; the shape is theirs, the agreement is arithmetic.
// Straight off Character.gender, the same column concealedIdentity.js reads.
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

// IDENTITY_SELECT already filters the held tags to quantity > 0, so both
// helpers see exactly what the character has on them.
function identityOf(row) {
  const tags = row?.tags ?? [];
  return presentedIdentity(row, { forcedName: forcedNameFrom(tags), concealment: concealmentFrom(tags) });
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

// Called once by db/lib/locationTravel.js#performLocationMove with everyone
// who just arrived — the mover first, then their whole escort party, which is
// what makes "if several people come up together, all of them get stopped"
// free rather than a feature of its own.
//
// Runs AFTER the move's transaction commits, and does its own small
// transactions per catch. Returns DM descriptors; sends nothing.
async function fireWatches(db, { arrivals, locationId, openTurn }) {
  const dms = [];
  if (!locationId || !openTurn || !Array.isArray(arrivals) || arrivals.length === 0) return { dms, hits: [] };

  const arrivalIds = new Set(arrivals.map((a) => a.id).filter(Boolean));

  // Everybody laying in wait here, with what a watch needs to be allowed to
  // fire at all. Loaded once for the whole party.
  const watches = await db.interceptWatch.findMany({
    where: {
      // The anchor is the rule: a watch works where it was set and nowhere
      // else. The character clause stays beside it rather than being replaced
      // by it, because the cancel can be missed — every caller of
      // applyLocationMoveSideEffects swallows its throw, so a Discord failure
      // mid-relocation can leave a live row anchored to a place its owner has
      // already left. This is what makes that a dud instead of a ghost.
      locationId,
      character: { locationId, status: "ALIVE" },
      OR: [{ anyPerson: true }, { anyConcealed: true }, { NOT: { targetNames: { isEmpty: true } } }],
    },
    include: { character: { select: IDENTITY_SELECT } },
  });

  const live = watches.filter((w) => {
    // You cannot lay in wait while you are walking. A watcher who arrived in
    // the same party as their quarry has been on the road all day, not
    // standing in it — and catching the person you travelled with would be a
    // trick nobody meant to build.
    if (arrivalIds.has(w.characterId)) return false;
    // Dying, bound, catatonic, crucified: none of them stop a stranger walking
    // past. The watch row survives — it is a standing preference, like an
    // escort consent, and it works again the moment they can act.
    return !blockerFor(w.character.tags, ACT);
  });
  if (live.length === 0) return { dms, hits: [] };

  const now = new Date();
  const hits = [];

  for (const arrival of arrivals) {
    const row = await db.character.findUnique({ where: { id: arrival.id }, select: IDENTITY_SELECT });
    if (!row || row.status !== "ALIVE") continue;
    // They may have walked straight on again, or been walked on by somebody
    // else, between the move committing and this running.
    if (row.locationId !== locationId) continue;
    const presented = identityOf(row);

    for (const watch of live) {
      const matchedBy = matchesArrival(watch, row, presented);
      if (!matchedBy) continue;

      // THE RATION, and the insert IS the enforcement. Without it a lapsed
      // two-minute hold is walked straight back into, and a Safe watch on a
      // busy road becomes an endless roadblock and an endless DM feed. A
      // unique violation means this person already caught this one this turn,
      // which is not an error — it is the rule working.
      //
      // Keyed to the CATCHER, never to the watch row: a watch dies when its
      // owner walks off, so a ration keyed to the row would be reset by
      // stepping out and back.
      try {
        await db.interceptHit.create({
          data: { interceptorId: watch.characterId, targetCharacterId: row.id, turnId: openTurn.id },
        });
      } catch (err) {
        if (err?.code === "P2002") continue;
        throw err;
      }

      // An Ambush carries NO deadline of its own: db/lib/attack.js#fileAttack
      // owns that clock now, and two copies of "when does the turn end" is
      // exactly the drift this codebase keeps writing comments about.
      const ambush = watch.mode === "AMBUSH";
      const until = ambush ? null : new Date(now.getTime() + SAFE_HOLD_MS);
      hits.push({ watch, interceptor: watch.character, target: row, presented, matchedBy, ambush, until });

      // The record a GM reads on /gm/audit. turnId is set because the once-
      // per-turn rule is turn-scoped and a row without it is unreadable as a
      // record of that rule — though the rule is ENFORCED by the unique above,
      // never by counting these (REQUESTS.md §1a). `presented` and not the
      // real name: the audit log is not a place to unmask somebody the game
      // just refused to unmask.
      await db.auditLog
        .create({
          data: {
            // An interceptor with no Discord account is a threat seat, and
            // AuditLog.actorDiscordUserId is NOT NULL — the whole row used to
            // be lost to the catch below.
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

  // AN AMBUSH IS AN ATTACK (docs/systemdocs/ATTACK.md). It files a real Attack
  // row and that is what holds both sides — the ambusher included, because
  // springing the trap puts you in the fight too. No strength gate: you set a
  // watch blind and do not get to pick who walks into it.
  //
  // Required lazily because db/lib/attack.js requires this module back for the
  // hold's own vocabulary. A cycle resolved at call time rather than at load
  // time, so neither half ever sees a partial exports object.
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
    // The unique on Attack already has these two, this turn — they were
    // button-attacked, or ambushed and broken off. Nobody was newly held, so
    // the victim must NOT be told "it's an ambush, you can't move": a line
    // that is not true is worse than no line. Very hard to reach, because the
    // InterceptHit ration above stops the same catcher twice in one turn, but
    // it costs one flag to never lie.
    hit.held = filed.ok;
    attackDmsOut.push(...filed.dms);
  }

  // ONE hold per person, however many people caught them: the longest wins, so
  // a second Safe stop cannot shorten the first. Conditional on the clock, so
  // a hold already running longer than this one — an Ambush's, above — is left
  // exactly where it is.
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

  // The victim hears from each of them. Three guards at the gate is three
  // lines, because walking into three people is what happened.
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
        // NOTICE even with typed words in it: it is the game delivering a stop, and as
        // CONVERSATION every stop on the road pinged the GM inbox.
        kind: DM_KIND.NOTICE,
        authorDiscordUserId: hit.interceptor.discordUserId ?? null,
      });
    }
  }

  // And the interceptor hears what they caught. A Safe watch reports its whole
  // haul in one line; an Ambush is one DM each, because each carries a Release
  // button and a button answers about exactly one person
  // (db/lib/dmActions.js#dmAction).
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
    // The ambusher's own line is db/lib/attack.js's now, because the button on
    // it calls off a fight rather than releasing a hold — one DM per victim
    // still, since a button answers about exactly one person.
  }
  dms.push(...attackDmsOut);

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
  cancelWatchOnMove,
  INTERCEPT_CANCELLED_DM,
  matchesArrival,
  seenAs,
  saidWord,
  IDENTITY_SELECT,
  identityOf,
  fireWatches,
};
