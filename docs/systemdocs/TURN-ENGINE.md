# Turn engine

How a turn closes and the next one opens. One function owns it —
`advanceTurn()` in `db/index.js` — and everything else on this page is either a
pass it calls or a side effect it hands back.

A turn is **6, 8, 12 or 24 hours**, set by `GameConfig.turnLengthHours`, and
ends on a clean **America/Chicago** boundary — every `turnLengthHours` from
00:00, so a 6-hour game ends turns at 00:00, 06:00, 12:00 and 18:00 local. That
is the game's clock and the only one it quotes; the header of every web page
carries it (`web/app/components/BascinetClock.js`).

**There are no Dawn and Dusk halves any more.** A turn is a turn, and
`Turn.dayNumber` — stamped when the turn opens — says which in-game day it
belongs to. The day rolls at Chicago midnight whatever the length, so 24 hours
is one turn a day and 6 hours is four. `Math.ceil(turn.number / 2)` is gone:
with the length a knob it would renumber the whole history the moment a GM
changed it, including the day keys the Bird and Fast Travel claim against.

**Three columns on the turn row, and they are what makes the knob safe.**
`turnLengthHours` and `endsAt` are stamped at open, so `db/lib/turnClock.js`
reads the TURN and never the config. A GM changing the length therefore moves
the **next** turn and never the open one — nobody's deadline jumps while they
are mid-action — and `db/lib/oracleInput.js` can ask a turn that closed last
week what its cutoff was and get the right answer.

**There is no advance cron.** `bot/src/events/ready.js` polls every minute
(`bot/src/lib/sessionClock.js#tickTurnClock`, on `turnClock.js#advanceDue`),
because no single cron string can express a length a GM may change. A missed
tick now heals within a minute instead of at the next midnight.

The advance is also **the push**: everything the GMs staged during the
closing turn — mechanical effects, private messages, public declarations, and
every Move's own declared payout — applies and delivers here, and nowhere
else. See `ADJUDICATION.md`.

## 1. Two callers, one engine

| Caller | Path | How it handles the side effects |
|---|---|---|
| The bot's per-minute clock | `bot/src/lib/sessionClock.js` -> `bot/src/lib/turnEngine.js` | Awaits the thunk inline — it's a background process, nobody is waiting. |
| The Dev Panel's "End turn" | `web/app/(app)/gm/dev/actions.js#forceAdvanceTurn` | Hands it to `next/server`'s `after()`, so the response — already carrying the committed new turn — flushes first. |

Each adds its own `AuditLog` entry. **Both must check the returned `advanced`
flag** before logging or dereferencing `newTurn`. It is also `false`, with
`refused: "NOT_RUNNING"`, whenever `GameState.phase` is not RUNNING
(`LOBBY.md` §1) — the one gate for both callers, so a game in the lobby or
already ended never ticks — and `refused: "NOT_IN_SESSION"` between sittings
(`SESSIONS.md`). `GameConfig.autoTurnAdvanceDisabled` is the separate,
poll-only pause.

Manual turn control lives only in the Dev Panel, not on `/gm/turns`. The
Current Turn widget can also overwrite the open turn's day/phase directly
(`updateCurrentTurn`) *without* resolving Needs, for raw correction.

## 2. The order, and why

This sequence is the thing to know. Two steps in it are load-bearing and were
each arrived at by getting them wrong first.

1. **Claim the open turn by closing it.** An `updateMany` conditioned on
   `status: "OPEN"`. This happens **before Needs resolve**, deliberately: if a
   GM clicks just as the cron fires, exactly one caller wins and the loser
   returns `advanced: false` having done nothing. A half-resolved turn is a
   cheaper failure than a losing racer double-charging everyone's upkeep.
2. **Nothing files itself.** There was an auto-labor pass here, and it ran
   **first** in the sequence, because a day's labor *earned* ⬢ before the horse
   upkeep pass below spent them (§5b). Laboring is gone. A day's work is a
   button pressed during the turn and paid at the press (`MINING.md` §3), so a
   character who files nothing simply has a day pass — nothing left in this
   sequence earns, and income-before-upkeep no longer constrains any ordering
   here.
2b. **Offer expiry pass** (`db/lib/offerExpiryPass.js`, still keyed `"lessons"`
   in `TURN_PASSES`). Every still-PENDING offer on the closing turn expires
   here, **whatever its kind** — lesson, bind, confession, kiss, escort or
   search — each with its own line DM'd to the initiator. One pass for all of
   them on purpose, which is why `db/lib/confessionPass.js` does no expiring of
   its own; two passes racing the same rows would double-DM.

   It used to resolve accepted lessons too, and was named for that. **A lesson
   is settled the moment it is accepted now** (`db/lib/lessons.js`), so there is
   nothing accepted left for this to find. The pass key stays `"lessons"`
   because it is written into `Turn.resolvedPasses`; renaming it would make
   every half-resolved turn look like it still owed the pass. Step 3 below still
   skips its own 🎲 DM for a Gambit whose `gmNotes` reads `auto:lesson` — a
   settled lesson never reaches it anyway, but one accepted before the change
   shipped is still out there. See `LESSONS.md`.
2c. **Research pass** (`db/lib/researchPass.js`, `"research"` in
   `TURN_PASSES`) — the Scholastic's own code-adjudicated Gambit, same shape
   as Lessons and slotted right after it. For every Action this turn whose
   `gmNotes` carries `auto:research:<ingredient-slug>` it totals the die
   already rolled at submit against the secret recipes that ingredient
   unlocks — a craftable whose *product* is `catalog: gm`, never `catalog:
   secret` — minus whichever ones this character has already been dealt
   (ledgered per-character in `AuditLog`, `research_revealed`, so a binned
   paper can't be farmed for a second try at the same recipe). Every earlier
   filing on the same ingredient (`research_filed` rows since that
   ingredient's last reveal) adds +1 — the first try needs a 6, the sixth
   cannot miss, and the die line says so the way a Lesson shows a charm's
   bonus. A total of 6
   or more with at least one recipe left mints the researcher a paper of
   notes on one, chosen at random, through `db/lib/paperMint.js#mintLetterFor`
   (`PAPERWORK.md`); 4 or more with nothing left to find says so; anything
   else turns up nothing. One DM at close carries the die and the outcome —
   so, like Lessons, step 3 below skips its own 🎲 DM for `auto:research`.
   Its slot is load-bearing the same way Lessons' is: **before** the staged
   push, and it sits **before** Confessions too, since neither pass's PENDING-offer expiry has anything to
   do with a Gambit that was already CONFIRMED at submit. See `REQUESTS.md`
   and `ADJUDICATION.md`.
3. **Staged push pass** (`db/lib/stagedPush.js`) — applies every `StagedEffect`
   the GMs queued this turn, then every confirmed Move's own declared numbers
   (nothing pays at confirm any more — a Routine and a GM-solved Gambit both
   sit with `appliedEffects` null until here), and
   silently closes untouched Moves (`OPEN → PASSED`, `auto:silent_close`).
   Silent for a Gambit's *adjudication*, but every Routine gets a close DM —
   description, `**Applied:**`, resource roll — because this push is the only
   place a hand-filed Routine is ever reported. It carries a "no adjudication notes" tail unless a private
   staged message on that Move already went to that player or a staged effect
   on it targets them, in which case the summary stands alone. The only Routine
   skipped outright is one whose `gmNotes` carry an `auto:` marker, meaning
   another pass is already DMing them about it. Every Gambit gets its own DM
   regardless: the d6 is rolled and stored at submit
   (`db/lib/moveConfirm.js` → `db/lib/gambitDie.js`) so the GM desk has it
   immediately, and shown to the player nowhere else, so this is where they
   find out how it fell. `/character`
   used to reveal it at Moves lock — an adjudication window early
   (`adjudicationHours`, `db/lib/turnClock.js`) — which handed players a bare
   number with no outcome attached; it now strips the die unconditionally
   (`web/app/(app)/character/page.js`). The gap between the throw and the
   telling is wider than it used to be, so that strip carries more weight:
   the number exists from the moment a Move is filed, and belongs to the
   player only here.
   A row the Mine button already paid arrives with `appliedEffects` stamped
   (`MINING.md` §3), so this pass skips it and the two can never both pay.
   Its slot is load-bearing two ways: **before**
   the progression/sweep (a staged "remove Infected" must beat the
   progression, and a staged fresh grant carries `expiresTurn > N` so the
   sweep can't eat it), and **before** the horse upkeep pass (deferred income
   lands before its bill — about the horse's feed rather than Hunger, which
   charges no ⬢ at all, §5).
   Every row is
   claimed with a conditional write (`appliedAt`, or `appliedEffects` DbNull
   → `{}`), so the resume path can never apply one twice. The staged DMs and
   the public post are handed back for the thunk, not sent here.
   A payload is `{ resources?, tagPoints?, tagOps? }`. Resources go through
   `addResources`' clamp and tag ops through `db/lib/tagOps.js`, but
   `tagPoints` is a plain `increment` with no clamp — a GM may take points
   back off a sheet, and negative is a legal balance. `appliedEffect`
   snapshots each of the three that actually moved.
4. **Tag progression pass** (`db/lib/tagExpiryPass.js`) — **before** the sweep,
   never after. Any expiring tag carrying `Tag.expiresInto` turns into
   something else first: Infected festers, Festering goes both Feverish and
   Necrotic, Necrosis rolls a leg or an arm (`TAGS.md` §5c). The sweep below is
   a blind `deleteMany`, so once it has run there is nothing left to read. This
   pass grants and never deletes; the sweep removes exactly the rows it just
   read. **Nothing here kills anyone** — the terminal chains still land on the
   `dying` tag and stop. What changed is what `dying` is: a one-turn clock
   (`durationTurns: 1`) rather than a permanent flag, so pass 4b below ends it
   at the *next* close. A character who reaches the end of a chain gets a full
   turn on death's door, which is the window a medic has to reach them.
4b. **Dying death pass** (`db/lib/dyingDeathPass.js`) — the second of the
   engine's two auto-kills. Every ALIVE holder of `dying` whose
   `CharacterTag.expiresTurn` has come due dies at this close, through the same
   `applyDeathToRow` claim and the same returned-`deaths` teardown as 7b. Its
   slot is load-bearing on both sides: **after** the staged push and pass 4, so
   a staged "remove Dying" or a medic's cure landing this same close always
   beats the axe, and **before** the sweep at 5, which would otherwise delete
   the very rows that are the evidence. A `dying` row with a **null**
   `expiresTurn` is not killed — it is stamped for the next close and its
   holder warned, so nothing granted before this pass existed dies to a clock
   it was never shown. Own `resolvedPasses` marker, same as 7b: a destructive
   pass must not half-run on a resume.
4c. **Nuke explosion pass** (`db/lib/nukeExplosionPass.js`) — the third
   auto-kill, and the only one that can end most of a game at once. When
   `GameState.nukeArmedTurn` has come due, every ALIVE character whose zone is
   not a `CAVE_LEVEL` dies: the Caves and the Depths are the whole escape.
   Sits beside 4b for the same reason — **after** the staged push and pass 4,
   so a Disarm filed this close (or a GM defusing it from `/gm/dev`) beats the
   clock. It reads GameConfig rather than a tag, so unlike 4b the sweep at 5
   cannot eat its trigger; it is placed here for the ordering that matters and
   not the one that doesn't.

   **The countdown is not a tag, deliberately.** A tag has a holder, and a
   holder can die inside the two-turn window, which would silently cancel the
   explosion. It also claims `nukeDetonatedTurn` **before** the killing starts,
   so a crash halfway through cannot leave a world that explodes again on the
   next close. Discord work — the `@everyone` fireball line into every zone's
   `#summary` — comes back as `broadcast` for the thunk, never posted inside
   the pass. **A detonation ends the game**: right after the pass,
   `advanceTurn` calls `db/lib/gameEnd.js#endGameInDb` (phase ENDED, archive
   open, the epilogue written) and hands the `**Game Ended**` post to the
   thunk to follow the fireball (`LOBBY.md` §7). The new turn still opens so
   the banner has somewhere to hang; the next advance is refused.

4d. **Ascension pass** (`db/lib/ascensionPass.js`) — the cult's doomsday, and
   the second way a game ends (`THANATI.md` §9). It runs **before 4c**, not
   after, though it is numbered here with its sibling. The ONLY thing that
   calls it off is the cult leader dying, so it must sit after the staged push
   and 4b — a killing adjudicated this close beats the clock — and *before* the
   bomb, because the blast kills that same leader. With the bomb first, two
   doomsdays landing on one close meant the fireball cancelled the rite and the
   cult silently lost a race it had already won. Now the cult's ending is the
   one written, and by the time the bomb runs there is usually nobody left for
   it to kill.
   **Everyone dies here, with no zone exemption at all** — which is the one
   line that separates this ending from the bomb's. The blast spares the two
   cave levels because being under the rock is the whole escape; here the rock
   is what Ravenheart is swallowed into. Gibbed, like the blast: no corpses to
   loot or bury, and no afterwards to do it in. The pass hands back `deaths`
   and one line, the `nukeExplosionPass` contract exactly.
   `GameState.ascensionArmedTurn` due plus the snapshot leader still
   ALIVE fires it: `ascensionFiredTurn` is claimed first, every `#summary`
   hears the hellfire (no `@everyone`; the warning two turns ago was the one
   worth waking anybody for), and `endGameInDb` runs exactly as at 4c. A dead
   or missing leader clears the countdown and says nothing at all.

5. **Expiry sweep** — delete non-stackable `CharacterTag`s whose `expiresTurn`
   has come due.
6. **Stackable sweep** (`sweepExpiredStacks`) — a stack is one row carrying a
   count, so an expiry sheds a single unit and rerolls the remainder's timer,
   deleting the row only when the last unit goes.
7. **Catatonic (AFK) pass** (`db/lib/catatonicPass.js`) — every ALIVE
   character's `lastActivityTurn` checked against `GameConfig.catatonicTurns`.
   Slotted **after** the sweep for the same reason Hunger is below: it reads
   and writes `CharacterTag` rows and must not race the sweep over the same
   table. Unlike every other pass here, it also **clears** its own tag —
   there is no `durationTurns` on `catatonic-afk`, so nothing sweeps it; the pass
   grants it when a character goes stale and deletes it the moment their
   clock moves again. A character whose player **left the guild**
   (`Character.leftGuildAt`, set by `db/lib/playerDeparture.js`) reads as
   stale whatever their clock says — their clock can never move again, and
   without the override the tag granted at leave time would be cleared at
   the very next close. The pass also stamps `Character.catatonicSinceTurn`
   when it grants and nulls it when it clears — the death countdown below.
   Ordering against Hunger doesn't matter; it touches neither
   resources nor the hunger meter.
7b. **Catatonic death pass** (`db/lib/catatonicDeathPass.js`) — the other
   automatic death, alongside 4b. A character
   who has held `catatonic-afk` for `GameConfig.catatonicDeathTurns` consecutive
   turns (default 4; **0 is the off switch**, a Dev Panel dial needing no
   deploy) dies at this close, outright: the DB half of death runs here via
   `db/lib/characterDeath.js#applyDeathToRow` (shared with
   `killCharacter` so the two death paths can't drift — conditional
   `status: "ALIVE"` claim, so a resumed turn can never kill twice), and the
   Discord teardown — access revoke, role delete, Cursed grant **only if
   the player is still in the guild**, death DM, one combined `#leave`
   alert — rides back on `deaths` for the thunk. A separate pass rather
   than a branch of 7, deliberately: it must run strictly **after** 7's
   clear branch so a character who woke this close can never be killed by
   it, and a destructive pass gets its own `resolvedPasses` marker. The
   countdown clock is `catatonicSinceTurn`, not `lastActivityTurn`, so a GM
   moving `catatonicTurns` mid-game doesn't move anyone's execution date; a
   GM hand-grant with no stamp never counts down at all. Players one close
   from death get a warning DM (`warnings`).
7c. **Bird pass** (`db/lib/birdPass.js`) — the delayed half of the Bird
   (`BIRD.md`). A letter whose zone guess missed, or whose recipient was
   already dead, resolved into nothing when it was sent; this is what finally
   tells the sender so, one turn later. **The delay is the mechanic, not a
   scheduling detail** — an instant answer would make a Bird a once-a-day
   oracle for whether a named person is alive in a named zone. Slotted
   deliberately **after** both auto-kills, so a sender who died this same close
   is already dead when the notice is composed and the passes cannot disagree
   about writing to them. The `failureNotifiedAt` stamp it writes IS its claim,
   so a resumed close cannot tell the same sender twice; own `resolvedPasses`
   marker for the same reason. DMs ride back on `notices` for the thunk.
7d. **Horse upkeep pass** (`db/lib/horseUpkeepPass.js`, `"horseUpkeep"` in
   `TURN_PASSES`) — the horse's feed, 1 ⬢ off everyone holding one. Slotted
   **immediately before Hunger**, which was load-bearing when a rider's own
   dinner was also billed in ⬢: the animal ate first, so a character down to
   their last ⬢ fed the horse and went Hungry. Hunger stopped costing money in
   9/2026 (§5), so the two passes no longer compete for the same purse and the
   slot is merely tidy. Nothing in the close earns any more either (§2 step 2),
   so there is no income for it to come after. See §5b.
8. **Hunger pass** (`db/lib/hungerPass.js`) — **after** the sweep, never
   before. Last turn's Hunger carries `expiresTurn` equal to the closing turn's
   number, so the sweep clears it a moment before a fresh one may be granted.
   The other order collides with `@@unique([characterId, tagId])` and silently
   drops the re-grant, leaving a tag that expires immediately.
8a. **Dawn afflictions pass** (`db/lib/dawnAfflictionPass.js`) — right after
   hunger. Guilt Ridden and Insomniac each roll a chance of a bad night's
   sleep, stepping the Tired → Exhausted ladder (`TAGS.md`, `MINING.md` §5).
   Audit action `dawn_afflictions_resolved`.

   **The name is a fossil and stays one.** It ran on the DAWN turn once; it
   runs every close now, which on a 6-hour game is four bad nights a day. The
   file name, the `"dawnAffliction"` key and the audit action are all left
   alone on purpose — the key is written into `Turn.resolvedPasses` and the
   action into `AuditLog`, so renaming either makes history unreadable. Same
   precedent as the `"lessons"` key.
8a-bis. **Xom pass** (`db/lib/xomPass.js`, `"xom"` in `TURN_PASSES`) — the
   god of chance and disorder collects. Every ALIVE holder of
   `{tag:old-ways-xom}` rolls once on a weighted table, and roughly half the
   time nothing happens. The rest of the table hands out an item, a Seizure,
   Rage, Melee V, a scream, a teleport across the map, Madness on
   every clergy character at once, or a death. Audit action `xom_resolved`.

   **The table is code, in `db/lib/xom.js`, not a YAML master.** Six of its
   thirteen rows are distinct code paths rather than "grant this slug", so a
   YAML row would need a `kind:` that maps one-to-one onto a switch the pass
   already contains — a second place to keep in step for no editability at
   all. `docs/miningdrops.yaml` also weights by REPEATING an entry, which
   cannot express the half-unit the mass-madness row carries. Bascinet's
   weights are stored unnormalised and sum to 101.5; `pickXomOutcome`
   normalises once, at roll time. `db/test/xom.test.js` asserts that every row
   in the table has an arm in the pass's switch — a row without one falls
   through to `default` and does nothing, silently, at four in the morning.

   **Why the slot.** After `expirySweep`, or the timed tags it grants (Seizure
   at 1 turn, Madness at 2) would be swept the moment they landed — the rule
   the hunger pass runs under, §8 above. After `tagExpiry`, so a tag that
   progressed this close is on the sheet. After `dyingDeath` /
   `catatonicDeath` / `nukeExplosion` / `ascension`, so anyone they killed is
   already `DEAD` and the ALIVE filter drops them: the bomb wins ties, which
   is right, because a blast is a fact about the map and a god's whim is not.
   Before `carry`, which has to weigh five cave rats and a grenade in the same
   close or Overburdened lands a day late. Before `mood`, which pays the night
   wherever a character is standing — and somebody Xom moved should pay it
   where Xom put them.

   **It is not idempotent**, which makes `Turn.resolvedPasses` load-bearing
   here in a way it is nowhere else: a resumed advance must never re-roll.
   Holders iterate sequentially, never `Promise.all` — the death claim, the
   teleport write and the one-shot mass-madness guard are all order-sensitive.

   **Three payload fields, and the reason for each.** The tag grants ride
   `notices` into `tagExpiryDms` like the dawn afflictions do, and the gib
   merges into `turnDeaths` for the same teardown every other death gets. The
   other three are Discord-shaped and get their own loops in
   `db/lib/turnSideEffects.js`:

   - `xomTeleports` — `applyLocationMoveSideEffects`, then **its own ambient
     line at both ends**, because Xom does not use the roads and that helper
     announces a gate crossing only when a graph link exists. Then
     `rollCavingOnArrival`, the same call the staged-relocate loop makes:
     being *dropped* into the dark must not be the one free walk in
     (`CAVING.md` §2), or Xom becomes the cheapest way into the Depths in the
     game. Its own loop rather than a merge into `relocations`, because that
     loop's letter is a sentence about a journey somebody paid for.
   - `xomConversations` — **after** the teleports, always: the point is that
     the two of them are standing in the same place when it opens. Goes
     through `db/lib/conversationOpen.js`, which is now the one copy of that
     sequence — the bot's Converse modal and Chat's Converse dialog were
     already two, and this would have been a third.
   - `xomShouts` — `shout()` runs in the thunk rather than the pass, because
     it claims an `AuditLog` row and hands back a fan-out that has to be
     posted. **Its gates stay intact**: a Mute holder does not scream, and one
     who shouted five minutes ago has nothing left in the throat — the outcome
     is simply spent. Its `placeKey` is the **Location**, never a Room, because
     the turn engine has no idea which thread anybody was sitting in at 04:00.
     So a Xom scream is made on the map, and a soundproof room never seals one.
     That is a known limitation of running from here, not an oversight.

   **Nothing is broadcast past the room it happened in.** The tag is
   `catalog: secret`; a zone-wide post would reverse-engineer the whole
   mechanic inside two turns and hand the Church a list of names.

8b. **Carry pass** (`db/lib/carryPass.js`) — **after** hunger, so it sees the
   final sheet: staged pushes, the sweep and the horse's feed
   all happen earlier in the close and none of them may settle in place.
   `settleCarry` for every ALIVE character holding a tradeable tag or
   Overburdened — one transaction each — and the overflow drops ride back for
   the thunk (`CARRY.md` §3). There used to be a third clause, asking for
   anybody over the separate ⬢ cap. Both that cap and its column are gone: ⬢
   are a tradeable one-pound item now, so a character sitting on a sack of them
   is already caught by the first clause, exactly like one carrying a sword.
8c. **Mood pass** (`db/lib/moodPass.js`, `"mood"` in `TURN_PASSES`) — the
   nightly settle for the mood dial (`MOOD.md`). Slotted after hunger,
   so it sees the final hunger band, and after carry, so it sees the final
   sheet; before travel arrival, so a traveller pays the night for the
   Location they ended the day in rather than the one they haven't reached yet.
   It applies the turn's flat harms and reliefs to `Character.mood`, slides
   every dial back toward Fine from either direction — one slow step of
   `MOOD_DRIFT_UP` (4) coming up, one fast `MOOD_DRIFT_DOWN` (40) coming down —
   and deletes each character's `dined` marker so a fresh turn starts
   unmarked. It settles no tag: the band is a word read off the number, not a
   row. Audit action `mood_resolved`; its DMs — only the two bands that carry
   one — ride the `tagExpiryDms` channel back on the thunk.
8d. **Travel arrival pass** (`db/lib/travelArrivalPass.js`, `"travelArrival"`
   in `TURN_PASSES`) — **a drain, and nothing else.** It used to land everyone
   who had spent their Move crossing a zone last turn; every crossing lands the
   moment it is made now (`MAP.md` §3) and nothing files work for this pass at
   all. It stays last, and stays at all, only to walk over anybody who was
   mid-journey when that change deployed — after which its query matches
   nobody. Delete it once they have landed. It does no Discord work; anything
   it finds rides back on `travelArrivals` through the same thunk loop a GM's
   staged "Relocate to" uses. Audit action `travellers_arrived`.

   One consequence of the removal worth knowing here: every pass above now
   settles a zone-crosser at their **destination** rather than their origin.
   The night's mood reads their destination's `wilderness`/`haven`, and a
   turret there can shoot them.
9. **Lifeweb decay** — a fixed `lifewebDecayPerTurn` off `GameConfig.lifewebBlood`.
10. **Open the next turn** with the alternated phase, and pick its banner (§4).
11. **Write the `TURN_START` archive row** — here, where the turn is created,
   rather than in the side effects, so a failed announcement can't leave two
   days with no boundary in the transcript.
12. **Return `runSideEffects`** — see §3. Nothing above this line talks to
   Discord; nothing below it touches the database.

**`needsResolvedAt` is stamped only when every pass in `TURN_PASSES` has been
recorded.** A pass that throws leaves the turn advancing — a stuck turn is
worse than a missed upkeep — but the turn stays unstamped, so the next advance
picks it up and re-runs only what never landed. It used to be stamped
unconditionally, which meant a hunger pass that failed at 04:00 was written off
as resolved and nobody ever ate that day's upkeep.

Two things follow from that, and both are load-bearing:

- A pass with **nothing to do returns an object, not `null`**. `null` is
  reserved for "this pass did not run, retry it" — the value `resolveNeeds`'s
  own catch returns. `tagExpiryPass` used to return
  `null` for both, so a turn with nothing expiring never recorded the pass at
  all.
- The **resume path claims `Turn.needsResumeClaimedAt`** before it does
  anything, with the same conditional `updateMany` the normal path uses on
  `status: "OPEN"`, and a 30-minute staleness window so a resume that dies
  holding the lease can't wedge the turn. `resolvedPasses` is not a lock, and
  `needsResolvedAt` is the completion stamp rather than a lease, so neither
  could do this job.

## 2a. What the bomb does to a body

The nuke pass gibs rather than kills (`CORPSES.md` §1a): everybody above ground
is vaporised, so the close mints no corpses and every tag they carried is
deleted. Antagonist seat tags are the exception, because the epilogue that runs
moments later reads them off live rows.

It also, finally, tells them why. The pass used to push its death entries with
no `reason` field while the thunk's shared DM loop interpolated one anyway, so
every victim of the bomb was DM'd the literal string `You have died. undefined`.

## 3. The side-effect thunk

`advanceTurn` **composes but does not run** the Discord work. It returns
`{ advanced, previousTurn, newTurn, note, runSideEffects }`, and the caller
decides when the thunk runs. The thunk itself lives in
`db/lib/turnSideEffects.js`.

That split is load-bearing. The message wipe walks every zone's channels
sequentially; awaiting it inside a server action holds the action open, and a
pending server action blocks client-side navigation — which froze the entire
web app until a hard refresh.

### 3a. The thunk is recorded, and an unfinished one is finished

**The four `Turn.sideEffect*` columns are to the Discord half what
`resolvedPasses` and `needsResolvedAt` are to the database half, and they exist
because that half had nothing of the kind.** `needsResolvedAt` is stamped by
`resolveNeeds` before `advanceTurn` has even composed the thunk, so a turn whose
fan-out died was already finished as far as §2's resume was concerned.

What that cost, on 2026-09-08: the bomb went off at the close of turn 3 and the
database half committed perfectly — twelve dead, gibbed, the game ENDED, all of
it logged. A redeploy landed twenty-eight seconds later and SIGTERM'd the web
container inside the per-death teardown loop. Three of twelve death DMs got out.
**The fireball and the Game Ended post never did**, and nothing was ever going
to send them.

So, in order:

- `advanceTurn` writes **`sideEffectPayload`** — everything the thunk needs, as
  plain JSON — onto the closing turn *before* handing the thunk back. No Prisma
  rows, no Dates, no functions: `newTurnId` rather than the row, and
  `startedAtMs` rather than a live `Date.now()`, because that value is the
  message wipe's cutoff and a resumed run would otherwise sweep away everything
  said since. `buildSideEffectPayload` is the whole list.
- Each send is wrapped in **`step(key, fn)`**, which records the key in
  **`sideEffectSteps`** only once the send returns. Anything that posts or DMs
  gets a per-item key (`death:<characterId>`, `delivery:<stagedMessageId>`,
  index keys for the notice loops); a singleton post gets a section key
  (`nukeBroadcast`, `gameEnded`, `messageWipe`). The granularity is the point:
  a re-run must not tell somebody a second time that they died. The existing
  per-call `.catch()`es stay — those stop one dead channel taking a loop down,
  which is a different job.
- **Staged deliveries do not rest on a step key at all.** Each send
  has a `Delivery` row it claims before sending and stamps after
  (`db/lib/stagedDelivery.js`, `ADJUDICATION.md` §1a), and that claim is what
  keeps a resume from sending twice. The step key stays, one per *message*, as
  the cheap "this whole message is done" skip — and it is recorded **only when
  every recipient came back sent**. A message that bounced anybody, or whose
  rows another run was holding, leaves its key unrecorded, so a resume walks it
  again; the rows underneath are idempotent, so re-walking costs a recipient
  who already has it nothing. Recording the key regardless was the old bug
  wearing a new table: the rows knew about the bounce and nothing ever read
  them again.
- **`deliveryFailures` is rewritten from the rows on every push, always** — not
  only when *this* run bounced somebody. A run that fails nobody can still be
  looking at a message with `FAILED` rows on it (a partial push resumed, or a
  Resend running beside it), and blanking the blob there told the tray the
  message was clean while the rows said otherwise.
- **`sideEffectsDoneAt`** is stamped only at the very end, and is the sole
  selector for the resume.
- **`resumeTurnSideEffects(prisma)`** finds the oldest turn with a payload and
  no `sideEffectsDoneAt`, claims **`sideEffectClaimedAt`** with the same
  compare-and-swap and the same 30-minute staleness window §2 uses for
  `needsResumeClaimedAt`, and finishes only the outstanding keys. It writes a
  `turn_side_effects_resumed` audit row.

**Two things call it, and the second is the one that matters.** `advanceTurn`'s
own thunk runs it first, so the next advance catches up whatever the last one
dropped — but a game that ended at 22:00 is not helped by the 04:00 cron. So the
**bot calls it on `ready`**, as one of its catch-up passes: the bot coming back
up is the earliest signal available that somebody's process just died, and the
deploy that kills the web container restarts the bot too.

**A turn that closed before this existed has a null payload and is never
selected** — there is nothing to replay for it.

The thunk performs, in narrative order:

1. Public staged posts (via `postAsCharacter`, the REST twin of the
   bot's webhook proxy), each archived only once Discord accepts it.
2. *(Nothing here any more. This was the auto-labor DMs, and nothing files
   itself at the close now — §2 step 2.)*
3. Tag progression DMs — one per player whose condition worsened, listing each
   step (`» Festering → Feverish and Necrosis`). Before the Hunger DMs purely
   so the two arrive in severity order.
3b. The Catatonic DMs and role renames, then the death pass's work: the
   eve-of-death warning DMs, and per death the Discord teardown — membership
   check first (the Cursed grant and the death DM go only to a
   player **still in the guild**; for a departed one each would just 403
   into the REST breaker's tally), then access revoke, role delete, and one
   combined `#leave` post naming everyone who died this turn.
4. Hunger DMs — one per player who crossed newly into Hungry or Starving this
   close (`db/lib/hungerPass.js`'s own notices), plus the Dying line for
   anyone whose three-turn Starving clock just ran out (§5). A character who
   stayed in the same band, or who ate enough to clear one already, hears
   nothing from this step — the tag leaving their sheet is the whole notice.
   (The Dev Panel's Feed Them button sends its own `recovered` line instead,
   since a GM acting on someone's sheet needs telling apart from the
   player's own eating — `db/lib/hunger.js#hungerDm`.)
5. **The staged deliveries** — every unsent `StagedMessage` for the closing
   turn. PRIVATE rows fan out one DM per recipient (per-recipient try/catch,
   failures collected onto the row's `deliveryFailures` and into one
   `staged_push_delivery_failed` audit row naming who); PUBLIC rows post to
   **the row's own zone `#summary`** (the composer requires a real zone — no
   fallback). If that zone's summary channel isn't configured, the post is
   skipped and recorded instead — never lost. Each row is stamped `sentAt` only after its sends were attempted, so a
   crash mid-way leaves the remainder visibly unsent — the workspace's
   missed-push banner — rather than falsely delivered.
6. The `#turns` announcement (`db/lib/turnAnnouncement.js`).
7. The message wipe, on **every** turn while `GameConfig.messageWipeEnabled` is
   on (`db/lib/messageWipe.js`; see `CHANNELS.md` §8). Location channels, Rooms
   and Conversations clear every turn; a zone's `#summary` only when the new
   turn starts a new in-game day — `newTurn.dayNumber !== p.previousDayNumber`,
   which the thunk passes as `wipeSummaries`. The closing turn's day rides in
   `sideEffectPayload` rather than being re-read, so a resumed run cannot get a
   different answer than the original. It is handed a
   **cutoff** — a timestamp the thunk takes as its very first statement, before
   any Discord call — and deletes nothing created at or after it. That is what
   lets the slow wipe stay last in the order without eating the summaries step
   5 just posted. Move the cutoff and you reintroduce that bug.
8. The channel doctor's **cheap** reconcile — roles and membership only, a
   handful of requests (`db/lib/channelDoctor.js`; `CHANNELS.md` §6). It used
   to sit behind a `GameConfig.autoReconcileEnabled` switch nobody ever turned
   on; keeping Discord in step with the database after a turn moves people
   around is not a thing to opt into.

Everything is sequential and individually `.catch()`'d, so a Discord failure
never blocks the turn. The message wipe additionally guards **per zone**, so
one channel a GM deleted by hand costs that room rather than every room after
it plus `#cerberon`. **Never `Promise.all` a fan-out here** — sequential
awaiting is what keeps the bot from emitting the burst of 429s that earns an
IP-level ban.

Both passes follow the same discipline: `runHungerPass` returns
`starvedDiscordUserIds` and `runTagExpiryPass` returns `dms`, rather than
either of them sending anything
themselves — so none makes a network call and none can hold a turn advance
open. Each also writes exactly **one** summary `AuditLog` row
(`tag_expiry_resolved` for the new one), never one per character: at 100+
players a per-character row would drown every human-authored line in
`/gm/audit`.

## 4. Turn banners

Each turn announcement carries a photograph. There are eight, in
`docs/assets/turn/{dawn,dusk}-{1..4}.jpg`, all cropped to the same 2446×1122
frame as the `#info` banner so both channels read as one system. They are built
by `docs/assets/make-turn-banners.js`, which holds the per-plate crop window and
colour grade — run it again and you get the same eight files.

**There is no weather system.** `Turn.weather`, `GameState.nextWeather` and
the `Weather` enum are orphaned columns from a removed feature — nothing
reads or writes them, and no GM control exists for a next-weather override.

**Which plate.** `db/lib/turnBanner.js` picks one when the turn opens and writes
it to `Turn.banner`, avoiding whatever the previous turn used. All eight are one
pool now; they were four Dawn and four Dusk, picked by the turn's phase, and the
filenames still say so because they are only pictures and renaming them would
cost a rebuild of `docs/assets/make-turn-banners.js` for nothing. On a 6-hour
game a plate comes round about twice as often as it used to, which is inherent
to there being four times as many turns.

**Why it is stored rather than rolled at post time.** The announcement gets
reposted: the bot rebuilds a missing console on cold start
(`bot/src/lib/turnsConsole.js`) and `finishGameWipe` reposts it after a wipe. A
fresh roll in either path would swap the picture out from under players
mid-turn. A null `banner` — a row from before the column existed, or a creation
path that forgot — is not "no picture": the resolver picks one on the spot, so a
Turn 1 never posts bare.

**After the bomb there is no morning, only the sky.** `Game.nukeDetonatedTurn`
pins `nuke.jpg` for the rest of the game, ahead of the ordinary plate, and
`Game.ascensionFiredTurn` pins `hellfire.jpg` the same way.

**Both stamps live on the `Game` row, and that is load-bearing.** They used to
sit on `GameState` — but they are turn NUMBERS, and turn numbers restart at 1
every game, so the value said nothing about which game had ended and every
reader took a stale one as its own. On 2026-09-09 a freshly restarted game
opened wearing the last one's fireball: the nuke plate over every turn
announcement, an epilogue on a game one turn old, and the Arm button refusing
on the grounds that the bomb had already gone off. A `Game` row is created
fresh by the wipe, so it cannot carry anything over. The `GameState` columns
are still written as a forensic record and read by nothing — the readers are
`turnBannerPath`, `turnAnnouncement.js`, `bot/src/lib/turnsConsole.js`,
`objectives.js` (the Tribunal), `riteIngredients.js` (the Ascension's
"already running" gate), the two nuke buttons and `/gm/dev`, and every one of
them selects `{ game: { select: … } }`.

**Resume withdraws the ending.** `resumeGameInDb` clears the Game row's
`endedAt`, `closingNote` and `epilogue` as well as the phase. It used to leave
the reveal in place "until the next ending overwrites it", which meant a
resumed game went on being played with `/archive` still rendering how it
ended.

How it is posted (`db/lib/turnAnnouncement.js`): **`#turns` is ONE rolling
message**, replaced each turn, carrying the announcement, the banner and the
player console together. Discord renders content, then attachments, then
components, which is exactly the order wanted:

```
-# Day 4, Turn 7 | April 24th, 1098     <- content
[ turn banner ]                        <- attachment
Travel   Move   Speak                  <- components, always last
```

There used to be a one-word scene line under that header — `Dawn.` or `Dusk.` —
and with the phases gone it has nothing left to say. The turn-ping role it
carried moved onto the clock line rather than sitting alone on a line of its
own, and the line is omitted entirely when no ping role is configured, so the
message never carries a stray blank line.

It was three messages once — banner, announcement, and a console anchor
deliberately kept separate so it would not "jump above and below the
announcement twice a day". The cost of holding it still was worse: the
announcement reposted *beneath* it every turn, so the buttons sank up the
channel until players stopped finding them, and a wipe of `#turns` (Restart
Game) left them gone entirely until the next bot restart. One message has no
ordering problem to solve. (Restart Game no longer leaves the channel empty
either: `finishGameWipe` calls `postTurnsAnnouncement` for the fresh Turn 1
right after the channel wipe, since a wipe opens Turn 1 directly and never
runs the thunk this section describes.) Tracked on `GameConfig.turnsConsoleChannelId` /
`turnsConsoleMessageId`; `turnsAnnouncementMessageId` and
`turnsBannerMessageId` are no longer written.

A missing image file is not an error — `turnBannerPath()` returns null and
the announcement posts alone. A banner is worth losing; a turn announcement
is not. That also covers `docsPath()` itself coming back null: the guard is at
the top of `turnBannerPath`, because `path.join(null, …)` throws, and it
threw one line above the `existsSync` that was supposed to be the graceful
exit — taking the announcement, the console text and the button row with it.

## 5. Hunger

A 0-100 meter, `Character.hungerValue` (`db/lib/hunger.js`), decaying by
`HUNGER_DECAY_PER_TURN` (10, doubled to 20 by `fast-metabolism`) at the close of
every turn. `hungerless` pins the meter at `HUNGER_MAX` (100), clears
`starvingSinceTurn`, and is skipped entirely. **Hunger costs no ⬢ at all any
more** — the old upkeep (pay 1 ⬢, or 2 with a Big Appetite, or go Hungry) is
gone outright, and with it `Character.hungerStreak`'s old escalating −1-per-turn
Gambit penalty and `HUNGER_STREAK_CAP`. `hungerStreak` is an orphan column now
— nothing writes or reads it — the same fate as `Character.missedMealStreak`
below.

Two thresholds carve the meter into bands, not one escalating streak:
**Hungry** at `HUNGRY_THRESHOLD` (30) or below, **Starving** at
`STARVING_THRESHOLD` (0) or below — nested, not exclusive, since Starving sits
*inside* the Hungry range (`db/lib/hunger.js#bandOf`/`#crossings`). A
character at or under 0 holds both tags at once; only the Gambit modifier
(`db/lib/gambitModifier.js`) picks one and never sums them: **−1** Hungry,
**−3** Starving, Starving winning outright. Crossing DOWN into either band for
the first time — not merely remaining in one already held — charges a
one-time **−30** mood hit (`HUNGRY_ONSET`/`STARVING_ONSET`, `MOOD.md`); a
single turn's decay crossing both bands at once still charges exactly the two
hits that fired, never a third for the distance travelled.

What raises the meter is eating, not a turn spent fed: a raw foodstuff
restores `foodHungerFor(tag)` (its own `cooked.hunger`, or `Tag.mealHunger`
for a minted dish, or a flat fallback for an unpriced item that still grants
`ate-meal`); a cooked dish sums its own `mealHunger` plus every ingredient's.
The write is one atomic, clamped `UPDATE ... LEAST(HUNGER_MAX, ...)`
(`web/app/(app)/character/actions/misc.js#consumeTagRequestImpl`), and the
Hungry/Starving tags come off the instant the meter crosses back over their
threshold — not at the next turn close — via
`db/lib/hungerBands.js#clearHungerBands`, shared with the Dev Panel's Feed
Them button (`gm/dev/characters/[characterId]/actions.js#feedCharacter`).
Nothing player-initiated ever grants or removes Hungry, Starving, or Dying via
this path directly — no request type, no picker entry; eating only ever moves
the meter, and the pass reads the meter fresh each close.

Reaching 0 and staying there for **`STARVING_DEATH_TURNS` (3) consecutive
closes** grants `dying` with a one-turn clock — an inference this rework made
(the doc names no such rule for prolonged Starving), easy to retune in
`db/lib/hunger.js`. Nothing here kills anyone, same as every other terminal
tag chain (§3) — the Dying death pass (§2 4b) is what finishes at the next
close what starving started, and the Catatonic death pass (§2 7b) is the
other. `Character.starvingSinceTurn` is the clock: stamped the turn the meter
first reads at or below 0, cleared the instant it eats back above 0 — so
eating on the second of three starved turns resets the count to zero rather
than merely pausing it. `db/lib/hungerPass.js#runHungerPass` is the only
turn-pass writer of `hungerValue`, `starvingSinceTurn`, and the two band tags.

A character born mid-close — Metempsychosis, or any death this same
`resolveNeeds()` run reincarnated (`stagedPush`/`dyingDeath`/`ascension`/
`nukeExplosion`/`catatonicDeath`/`xom` all route through `applyDeathToRow`,
which can trigger a rebirth) — is excluded from this turn's pass: `db/index.js`
passes a `bornBefore` cutoff, taken before any pass runs, and the pass never
sees a character created after it. They start decaying the turn after the one
they woke up in.

Per character, at the close of every turn:

| State | Outcome |
|---|---|
| Holds `hungerless` | Pinned at `HUNGER_MAX`; `starvingSinceTurn` cleared; skipped entirely. |
| Holds `fast-metabolism` | Decays **20** instead of 10. |
| Otherwise | Decays **10**. |

Every decay is floored at 0 — `Character.hungerValue` can never go negative
without a `Math.max`, the same structural-clamp discipline the old resource
decrement used, just aimed at the meter instead of ⬢. Crossing down into
Hungry or Starving for the first time this close grants the tag (`expiresTurn`
one turn out, `createMany({ skipDuplicates: true })`) and charges the one-time
mood hit; crossing back up over a threshold drops it. A character who stays
exactly where they were — still Hungry, still above 0 — hears nothing: the DM
only fires on a fresh crossing, never once per turn spent in a band.

### There is no starvation brake here, on purpose

An earlier revision of this pass shipped with `HUNGER_CAN_KILL = false`: the
⬢ charge had come out, but no foodstuff existed yet for a character with no
Cooking to eat, so letting Starving reach `dying` unconditionally would have
killed every such character on schedule with no action that could have saved
them. The brake's own comment named its exact condition for going away: "flip
it to `true` in the same change that ships foodstuff items, and not before."

**This is that change.** Soilery ships the foodstuff catalog the brake was
waiting on — six growable crops, ten more foodstuffs, and the seed-bag/Farming
chain that gets a character to them without Cooking at all — on top of the
Depot wares and mining drops that already existed. The counter that stocks those
wares is open to everybody now rather than to one man (`DEPOT.md`), so a Ration
Box is a walk and an order rather than a favour. `STARVING_DEATH_TURNS` (above,
this same section) is therefore unconditional, with no flag gating it: the
prerequisite and the follow-up landed in the same rework.

One summary `hunger_resolved` audit row per turn, not one per character: at
100+ players the latter would drown `/gm/audit`.

Full writeup: `REQUESTS.md` §4.

### 5a. Nobility upkeep

The Disappointed track is gone — no separate tag, no streak counter driving
it. A noble who ends the turn without the `dined` marker (no fine or lavish
meal that turn) instead takes −10 mood at the mood pass (8c, `MOOD.md`), the
same as any other harm to the dial. Hungerless and Dying nobles are exempt.

`Character.missedMealStreak` is an orphan column now — nothing writes or
reads it any more, same as `GameConfig.mindlinkChannelId`. There is no
player-facing tracker: the sheet's old Dinner row went with the track
(Bascinet's call, 2026-09-07). A noble learns they skipped dinner the way
everyone learns about a bad night — the word in the Mood box on their sheet.

### 5b. The horse's feed

A Horse costs **1 ⬢ every turn it is in your inventory**
(`db/lib/horseUpkeepPass.js`), and this pass is **not** affected by the hunger
rework — animals still eat ⬢, people no longer do. Three things about it are
the opposite of how the rest of the horse works, and all three are deliberate:

- **Held, not equipped.** Everything else a horse does is gated on
  `CharacterTag.equipped` (`db/lib/mounts.js`), and an indoors Location parks
  the animal at the door. The feed ignores all of it. A horse in your pocket
  still eats, so stowing it is not a way to skip the bill.
- **Short of the cost, nothing happens.** A character at 0 ⬢ is charged nothing
  and keeps the horse — no starving marker, no runaway. Hunger used to have a
  row of exactly this shape and no longer does (§5, 9/2026), so this is now the
  only place in the close where being broke is answered by silence.
- **Each species bills separately.** A Horse and an Arelitz Warbeast together
  eat 2 ⬢, not 1 — the pass walks `UPKEEP_SLUGS` and charges once per slug
  held.

The charge is a **stack write per payer**, not one bulk `updateMany`. It used
to be the latter, with a `resources: { gte: 1 }` guard that doubled as the
clamp, but ⬢ live in a `CharacterTag` row now (`db/lib/resourceStack.js`) and
there is no column left to decrement across a hundred characters at once.
`takeCharacterResources` keeps the same floor a different way: it is strict and
conditional, so either the whole cost comes off or nothing does, and nobody
goes negative. The query that finds holders is only a cheap pre-filter — the
write is the real check.

Nobody is DM'd about it. A "your horse ate" line every turn would sit on top of
the hunger notice one pass later, and the tag description says where the ⬢
went. The pass writes one `horse_upkeep` audit row per close instead, so a GM
can see the charge on `/gm/audit`.

The Motorcycle (the other member of `FAST_TRAVEL_SLUGS`) is **not** charged —
it is a machine, and nothing burns fuel for it.

Same `bornBefore` cutoff as Hunger above, and for the same reason: a soul
reincarnated mid-close hasn't had the horse long enough to owe its feed yet.

## 6. Filing nothing

There is no Default Move and no auto-labor pass. `DefaultEffort` and its
`/character` panel are deleted, and so is the pass that used to file a Labor
for everyone who had not acted by the close.

**Filing nothing now does nothing at all.** The day passes, no `Action` is
written, no ⬢ land, no fatigue is taken. A day's work is something a character
presses a button to do while the turn is open — Mine, Farm, Refine or Harvest
Godflesh (`MINING.md`, `SOILERY.md`, `FACTORY.md`) — and three of the four
spend the Move that the one-Move-a-turn row represents.

That is a deliberate reversal. The old pass existed so an absent player still
earned something, and it carried a long tail of exceptions with it: who is
incapacitated, who holds no Laboring tag, who is Exhausted, who is standing
somewhere none of their skills reach. Every one of those is now just the
button not being pressed, or the button refusing at the press with a sentence
the player can read (`MINING.md` §3).

## 6b. Mining coefficient drift

`"miningYield"` in `TURN_PASSES` (`db/lib/miningYield.js#runMiningYieldPass`)
walks every `LocationMining` row one turn forward — a mean-reverting random
walk plus rare jump events. Its slot is late and load-bearing for one reason
now: **what it writes is what the next turn's mining is worth**, so a day
already paid keeps the coefficient it was priced at. (It used to have a second
reason — sitting after the auto-labor pass, which paid at the close. Mining
pays at the press instead, which makes the point sharper rather than weaker: a
payout can land at any hour of the turn, so the coefficient must not move
under it mid-day.)

It is random and therefore **not idempotent**. That is exactly why it is a
named pass rather than inline work: `markDone` is what stops a resumed turn
advance from drifting the whole map twice. The full parameter table is in
`MINING.md` §6.

## 6a. The Move cutoff

Moves close an **adjudication window** before the turn ends, so a GM has time
to read what was filed before the push runs. It is **not a knob** — it falls out
of the turn's length, in `db/lib/turnClock.js#adjudicationHours`:

| Turn length | 6h | 8h | 12h | 24h |
|---|---|---|---|---|
| Adjudication window | 2h | 2h | 3h | 3h |

A GM who could set this to zero would be adjudicating a push that was still
moving, and one who set it to the whole turn would have shut the game; it is a
property of how much there is to read, not a preference.

**The end time is stored, not derived.** `turnEndsAt(turn)` returns
`turn.endsAt`, stamped at open as the first Chicago grid boundary strictly
after `startedAt`, and `moveCutoffAt(turn)` is that minus the window for
`turn.turnLengthHours`. The derivation survives only as the fallback for rows
written before the column. Reading live config instead would let a GM's knob
move a deadline under somebody mid-action, and would make ~20 synchronous
callers async for the privilege.

**A boundary is strictly after the start, so a manual advance SNAPS FORWARD.**
End a 6-hour turn by hand at 15:00 and the next one runs to 18:00 — three
hours, not six — and the grid never moves. That is what keeps every turn landing
on a clean local time no matter how many times a GM intervenes.

`moveWindow(turn, { now, clockFrozen })` returns
`{ endsAt, cutoffAt, locked, hasLock }`. There is **no lock at all**
(`hasLock: false`) in two cases: the clock is frozen
(`db/lib/gameState.js#clockFrozen` — `GameConfig.autoTurnAdvanceDisabled` is
on, the game is not RUNNING, or it is between sittings), so there is no
scheduled end to count back from; or the turn is shorter than its own window,
which the snap above produces a few minutes before any boundary — counting back
would otherwise lock the whole turn the moment it opened. `locked` is true only
*between* the cutoff and the end, so a turn that outlives its end (a missed
poll) reopens rather than staying shut forever.

**`locked: false` does not mean the game is open**, and this is the sharpest
edge in the whole module. A frozen clock reports `locked: false` because
freezing removes the DEADLINE, not because anybody may act. Whether a player
may act is `db/lib/turnGate.js#movesOpen`, which asks about the session first
and the window second. Read `locked` alone and a game between sittings is wide
open.

**Two things fire on the cutoff itself.** The Oracle drafts the turn's
chronicle a couple of minutes after the lock, off the bot's minute cron
(`db/lib/oracleCutoff.js`), so a GM has it in front of them for the whole
adjudication window rather than after the push. It used to run at turn close.
See `ORACLE.md` §2.

The other is the **Gambit settle pass** (`db/lib/gambitCutoff.js`), on the same
minute cron and sharing `cutoffReached` with it. The die itself is thrown back
at submit now; what lands here is `Action.diceModifier`, the Hunger and mood
reading, so the die answers what you rolled and the modifier answers how the
character was when the day closed. It is also what finally shuts the edit
window on a turn where `hasLock` is false — a settled `diceModifier` is the
mark `moveIsEditable` reads when there is no cutoff to compare against. The
staged push runs it again as the backstop. See `ADJUDICATION.md`.

Enforced in the bot at both `move:open` (the `#turns` button and `/move`) and
on modal submit — a modal can sit open on screen across the cutoff — with an
ephemeral refusal naming both times. **Travel, Speak, requests and GM edits are not
affected**: the cutoff is about the Move queue a GM has to read.

Surfaced to players on the `#turns` announcement (`Moves must be sent by
<t:C:t>`, added by `buildTurnAnnouncement` when `hasLock`), in `/character`'s
"This turn" row, and in the handbook.

Chat's turn card counts to the **cutoff**, not to the turn's end: `myMove`
sends `moveWindow(...).cutoffAt` as `closesAt`, and `TurnCard.js` renders
`closes in N h` from it, or `locked` once the window has shut. Counting to
`endsAt` told a player they had the adjudication window they did not have.

**And it is in the header of every page**, which is the one surface nobody has
to go looking for: `LOCK 9:00 PM · 2h 14m`, becoming `MOVES LOCKED` once the
window shuts, and nothing at all when `hasLock` is false. The clock time is the
**reader's own**, in their own timezone and locale — a relative "closes in 3 h"
still made a player two zones over do arithmetic to know whether they could file
after dinner.

One component draws it, `web/app/components/LockChip.js`, and it takes no props:
`web/lib/turn.js#getMoveWindow` derives the two timestamps once per request and
the root layout streams them into `MoveWindowProvider`, so a header adds the chip
by writing `<LockChip />`. That matters because there are eleven headers and
several are rendered from client components that cannot hold an async server
child. `/gm/turns` had its own `moves lock in 2h 14m` string; it reads the shared
chip now, and keeps its separate "Push in …" countdown, which counts to `endsAt`.

`locked` is derived in the browser against `cutoffAt`, never sent as a boolean —
a GM desk sits open for hours and has to cross the cutoff while it sits there.

### 6a-i. A Gambit is yours until the lock; everything else is a receipt

The one-Move-a-turn row IS the turn — the `@@unique([characterId, turnId])`
Action — so a player still gets one Move. What changed is how long it stays
theirs.

**A Gambit can be rewritten or withdrawn until the Move cutoff.**
`db/lib/moves.js` exports `editMove` and `withdrawMove` beside `fileMove`, and
`moveIsEditable` is the predicate all three sides read — the server actions,
the Change button on the turn card, and the dialog. Withdrawing deletes the
Action through the shared `deleteActionRestoringTurn`
(`db/lib/moveEconomy.js`), which is the same path a GM's Reject takes: there
is no `turnsRemaining` column, so giving the day back means deleting the row.

**Nothing else is editable.** A **Mine** settles on the press — the ⬢ and any
mining drop land inside the filing transaction (`MINING.md` §3), which stamps
`appliedEffects` so the push skips it. A Move the *game* filed is a receipt for
something that already happened: a craft, a burial, an engraving, a torture, a
travel stub, a lesson, a day in the seam. `Action.playerFiled` separates the two and **defaults false**,
so a writer who forgets it fails closed. It is deliberately a column rather
than a `gmNotes` substring — that matching is what this replaced.

**This was only safe once the die moved.** Editing used to exist and was
removed because changing kinds re-confirmed the row and re-confirming rolled,
so an uncapped Edit was a re-roll button you could flip Gambit → Routine →
Gambit on all afternoon. The fix this time is structural rather than a
prohibition: the d6 is thrown once, at the cutoff, by `db/lib/gambitCutoff.js`
— so there is nothing to fish for while the window is open, and once it shuts
nobody can touch their Move at all. The modifiers get more honest in the
bargain, since Hunger and mood are read at the lock rather than whenever the
player happened to type.

`gambitCutoff` is a per-minute poll in the **bot** process, sharing
`turnClock.js`'s `cutoffReached` with the Oracle's cutoff run. Three
consequences: a web-only deploy never ticks it, a frozen clock or a turn
shorter than its adjudication window never locks at all, and the roll can land up to
a minute late. So `rollPendingGambits` is **also called at the head of the
staged push** as the backstop — a no-op on an ordinary turn where the cutoff
already fired.

**`move_edited` rows are written again**, alongside the new `move_withdrawn`.
Both render through the `move_` prefix fallback in
`web/lib/auditNarrative.js`.

The `auto:` marker on `Action.gmNotes` outlives all of this: `db/lib/
stagedPush.js` tests the same substring, and `web/lib/moves.js` reads the
markers for the desk's labels.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/index.js` | `advanceTurn`, `resolveNeeds`, `sweepExpiredStacks` |
| `db/turnCalendar.js` | The in-fiction calendar and `buildTurnAnnouncement` |
| `db/lib/turnBanner.js` | Picking and resolving the turn banner (§4) |
| `db/lib/turnClock.js` | The Chicago boundary grid, turn end, Move cutoff, the day rule, `advanceDue` (§6a) |
| `db/lib/turnGate.js` | **The one answer to "may a player act right now?"** — the session first, the lock second |
| `db/lib/session.js` | Opening and closing a sitting (`SESSIONS.md`) |
| `db/lib/sessionNotice.js` | The one line into `#turns` when a session opens or closes |
| `bot/src/lib/sessionClock.js` | The bot's per-minute turn and session polls |
| `web/app/components/BascinetClock.js` | The game's clock in every page header (§9) |
| `web/app/components/LockChip.js` | The cutoff in every page header, in the reader's own time (§6a) |
| `db/lib/stagedPush.js` | The staged push pass (`ADJUDICATION.md`) |
| `db/lib/miningYield.js` | Mining coefficient drift, and the quality words |
| `db/lib/horseUpkeepPass.js` | The horse's feed (§5b) |
| `db/lib/resourceStack.js` | ⬢ as a stack row — the only reader and writer of a ⬢ balance (`CARRY.md`, `ECONOMY.md`) |
| `db/lib/hunger.js` | The 0-100 hunger meter itself — thresholds, decay, banding (§5) |
| `db/lib/hungerPass.js` | The Hunger pass |
| `db/lib/hungerBands.js` | Clearing Hungry/Starving the instant eating clears the threshold (§5) |
| `db/lib/catatonicPass.js` | The Catatonic (AFK) flagging pass |
| `db/lib/catatonicDeathPass.js` | The Catatonic death pass (§2 7b) |
| `db/lib/dyingDeathPass.js` | The Dying death pass (§2 4b) |
| `db/lib/nukeExplosionPass.js` | The nuke explosion pass (§2 4c) |
| `db/lib/ascensionPass.js` | The Rite of Ascension's pass (§2 4d) |
| `db/lib/nuke.js` | Where the device is, and what the datacard's pointer says |
| `db/lib/worldBroadcast.js` | The two whole-map fan-outs (every `#summary`, every Location) |
| `db/lib/characterDeath.js` | The shared DB half of death (`applyDeathToRow`) |
| `db/lib/playerDeparture.js` | Guild-leave marking, shared by the live handler and the startup reconcile |
| `db/lib/tagExpiryPass.js` | The tag progression pass (`Tag.expiresInto`) |
| `db/lib/turnAnnouncement.js` | The rolling `#turns` announcement |
| `db/lib/messageWipe.js` | The message wipe (`CHANNELS.md` §8) |
| `db/lib/threadExpiryPass.js` | Inactivity expiry for player threads (`CHANNELS.md` §4) |
| `db/lib/channelDoctor.js` | The optional post-turn reconcile (`CHANNELS.md` §6) |
| `bot/src/lib/turnEngine.js` | The poll's caller: the audit row and the inline thunk |
| `bot/src/lib/moveModal.js` | The Move modal a player files a Move through (`COMMANDS.md`) |
| `db/lib/moveConfirm.js` | Confirming a filed Move — both faces call it, and a Move that never reaches it stays `PENDING_TYPE` and is skipped by the staged push (`bot/src/lib/moveConfirm.js` is a shim that binds `prisma`) |
| `web/app/(app)/gm/dev/actions.js` | `forceAdvanceTurn`, the GM caller |

## The train passes

`db/lib/trainDeparturePass.js` and `db/lib/trainArrivalPass.js`, registered in
`TURN_PASSES` as `"trainDeparture"` and `"trainArrival"`, between `arelitzLay`
and `depot`.

They sit **after `carry`** for the reason carry's own entry gives: crates land
in a Room stash, and nothing may put things on a floor before the overburdened
shed has finished putting things there. They sit **before `depot`**, so the last
thing that happens at the Depot is the gun firing on whoever came to meet the
train. Departure is before arrival, which on the shipped cycle is a safety
property rather than a live dependency — exactly one of them does anything on
any given turn — but if the cycle is ever retuned to run both halves on one
close, selling must not be able to sweep crates that landed that same close.

They deliberately do **not** go up with the income passes. A settled sale credits
an ACCOUNT, and no upkeep pass can spend an account — only ⬢ and coin — so the
income-before-upkeep rule does not reach here. Say so in the comment or somebody
will "fix" it.

**Parity decides which half RUNS; rows decide what MOVES.** Each pass opens with
a `turn.number % 2` check and returns `ran: false` on the half that is not its
turn, so both are entered every close and exactly one does anything. What
actually moves is decided entirely by `deliveredAt: null` / `settledAt: null`,
each row claimed with a conditional `updateMany` before it is touched. A failed
advance that is resumed, a GM force-advance, or a game that starts on an even
turn therefore costs a turn of flavour and never a shipment. Turn 1 needs no
special case at all: it is a departure with an empty drop box, and turn 2's
arrival finds whatever was ordered on turn 1. `db/test/train.test.js` holds
that.

- **Departure** settles every unsettled `DepotSale` at the price frozen when it
  was dropped, takes `Depot.sellTaxRate` off the top as coin into the Keep's
  Vault, and credits the net to whichever account the row named. Crediting a
  TREASURY account puts the backing coin in the Vault in the **same
  transaction** — a claim this pass mints has to be worth something at the ATM.
- **Arrival** turns every undelivered `DepotOrder` into crates in the Railyard,
  stamped with the buyer's fingerprint unless they ordered anonymously.

One bad row never strands the rest of the train: the claim rolls back with it
and it rides the next run.

## The Depot pass

`db/lib/depotPass.js`, registered in `TURN_PASSES` as `"depot"` and run **last**
— after `lifewebDecay` — so the turret fires on the sheet every other pass left
behind, in particular the armour the carry pass may have made somebody drop.

It does **one** thing now: the **turret sweep**. Everyone standing in the Depot
whose presented name is not `Depot.merchantFace` takes a roll, and armed is the
only condition — there is no generator left for it to depend on.

It used to burn generator fuel and run the shuttle's clock as well. Both are
gone (`DEPOT.md`). **The key stays `"depot"`** although the pass shrank: it is
written into `Turn.resolvedPasses`, and renaming it makes every half-resolved
turn look like it still owes the pass. Same precedent as `"lessons"`.

Like every other pass it returns its side effects — `lines` (ambient lines the
caller speaks into the Depot channel), `dms`, and `deaths` — rather than making
a network call.

**A turret kill owes the same Discord teardown every other death gets**, and
for a long time it got none of it: the sheet said `DEAD` while the character
kept their personal role and every channel overwrite, and never
received the ghost seat. Both guns now hand their kills up as `deaths`, which
the thunk folds into `turnDeaths` alongside the catatonic, Dying and blast
ones. The walk itself lives in `db/lib/deathTeardown.js` so the four callers
that perform it cannot drift. Turret deaths carry `ownDm: true`, because the
gun has already spoken to the victim in its own voice and a generic "You have
died" after it would be the same news twice. The turret's **other** trigger is on arrival, in
`db/lib/locationMove.js`, deliberately before that function's `DISCORD_TOKEN`
guard: being shot is a database fact and must not depend on there being a token
to announce it with.

See `docs/systemdocs/DEPOT.md` §0c, §0d and §0f.
