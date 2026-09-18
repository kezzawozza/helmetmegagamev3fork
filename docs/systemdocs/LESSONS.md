# Lessons and consent handshakes

Learn Skill and Teach Skill on `/character`, the Teaching tag tree, and the
`Offer` model both of them and Bind run on.

**A lesson happens when it is accepted.** The die is thrown, the skill lands and
both people are told, all inside the transaction that answers the offer. It used
to resolve at turn end, which left the learner's Gambit sitting OPEN on the
adjudication desk for an outcome no GM decides — and solving that row DESTROYED
the lesson, because the pass read a SOLVED Move as "a GM wrote the result, theirs
stands" and returned without granting. Nothing reaches the desk now.

## 1. The rules

**Anybody can teach.** The Teaching tag stopped being a door on 2026-09-14;
it is now what makes teaching free, repeatable and easier. Learning is always
the student's **Gambit** — the die after its modifier (Hunger, Afraid, Panic;
`db/lib/gambitModifier.js`).

| The teacher | Student needs | Costs the teacher | Students a turn |
|---|---|---|---|
| anybody | **6** | their whole **Routine** | 1 |
| holds **Teaching** (4 pt) | **5 or 6** | **nothing** | 3 |
| holds **Teaching (Drill Instructor)**, fighting skill | **4, 5 or 6** | nothing | 3 |

- **Teaching** (4 pt, a standalone `skills` tag) buys three things at once: the
  Routine back, the threshold down a pip, and a cap of `TEACHING_CAPACITY`
  students a turn. A holder's Move slot is **never read** — they can labor,
  travel or run a Gambit and still teach three people the same day.
- An untrained teacher owes a whole Routine, so any Move already locked in
  refuses. That is also what caps them at one student: accepting files the
  Routine, and the next offer finds the slot full.
- **Teaching (Drill Instructor)** (3 pt, `skills` category but grouped under
  `general-cerberon` for that group's `requiredTag: cerberon` gate, so only a
  Cerberus or the Censor, who starts with the Cerberon tag; requires
  Teaching): a student learning a **fighting skill** (group `skills-fighting`)
  succeeds on a **4, 5 or 6**. It replaced the old Drillmaster tag.
- **Teaching (Lecturing)** is gone, removed with this rework. Its three-student
  cap moved onto plain Teaching, which no longer spends a Routine to need
  widening. Nobody was compensated; existing holders were converted to plain
  Teaching by `db/scripts/ops/convert-lecturers.js` (§6).
- Neither remaining tag is `teachable`. You can't be taught to teach.
- Thresholds are fixed. There is no "each attempt lowers the difficulty".
- Both sides have to be standing at the same Location and unconcealed
  (`db/lib/presence.js`) — which counts a worn hood that forces concealment,
  not just `/conceal`. The learner may never already have locked in a Move.

Constants: `db/lib/constants.js` (`TEACHING_SLUG`, `DRILL_INSTRUCTOR_SLUG`,
`FIGHTING_GROUP_SLUG`, `TEACHING_CAPACITY`, `UNTAUGHT_LESSON_THRESHOLD`,
`LESSON_THRESHOLD`, `DRILL_THRESHOLD`).

## 2. What can be taught

A tag is a **skill** for this purpose when `Tag.teachable` is true — a flag in
`docs/tags.yaml`, not a category heuristic (TAGS.md §5). It is set on most of
the `skills` category and on two general traits (Literate, Camouflage), and
deliberately withheld from two kinds of skill:

- **masteries**, the 12–15 point capstones — a capstone must not be had for
  the price of one Lesson Move. Smithing (Gunpowder) is the one exception,
  because a powder formula passes hand to hand.
- **role-exclusive crafts** — Blessing, Research and the Teaching tree. They
  are the role's own work rather than a lesson, and you cannot be taught to
  teach.

`db/lib/lessons.js#teachableSkills(teacher, learner, catalog)` is the one
rule, used by the page to build the menus and by the offer and accept paths
to re-check them:

- the teacher holds the skill **or a higher tier of it** (`parentTagId` chain
  — a Melee IV can teach Melee I);
- the learner holds neither it nor a higher tier;
- the learner holds its `parentTagId` when it has one, and its `requiredTagId`
  / group gate — a lesson can't skip a prerequisite the store won't.

On success the skill lands with `TagSource.LESSON` and the tiers below it come
off (`db/lib/tagWrites.js#replaceLowerTiers`), same as buying the upgrade.

## 3. The Offer

```
Offer { kind LESSON|BIND|CONFESSION|ESCORT|KISS|SEARCH, status PENDING|ACCEPTED|DECLINED|CANCELLED|EXPIRED|RESOLVED,
        turnId, initiatorId, responderId,
        teacherId?, learnerId?, tagId?, threshold?, learnerActionId?, teacherActionId?,
        hiddenTagIds[], outcome?, reason? }
```

A handshake between two characters, alive for one turn. The **initiator**
pressed the button on the web; the **responder** gets a DM with two buttons
(`db/lib/offerRow.js`: `offer:accept:<id>` / `offer:decline:<id>`), answered
by `bot/src/lib/offers.js`.

**A new kind needs no new plumbing** — that is the point of the shared
prefixes. `ESCORT` (`db/lib/escort.js`, `MAP.md` §3a) is the newest, and all
it added was a branch in `handleOfferAccept`'s kind switch and its own
wording in `declineOffer`. Its buttons are green and grey rather than the
blurple `offerButtonRow`, through `escortButtonRow` — same two custom ids, so
the router never had to learn about it. `ESCORT` is also the one kind whose
accept leaves a mark that OUTLIVES the offer: it stamps a two-turn consent
window on the responder, so being picked up again inside it does not re-ask. The click's acknowledgement is
`interaction.update()`: the buttons come off the message and the outcome is
written under it, so nothing can be clicked twice and no message id has to be
stored. A stale button just says the offer's gone.

`SEARCH` ([`SEARCH.md`](SEARCH.md)) is the newest, and the only one so far to
need a **third** control. Yes and No still wear the two prefixes above, so the
router and the web's `DmActionRow` needed no branch for them; what is new is
**Hide items**, on its own `search:hide:` prefix, because hiding EDITS the
pending row rather than answering it — the Yes/No pair has to survive it, so it
can be neither an `interaction.update()` nor a `DM_CHOICE`. Its `hiddenTagIds`
is the only pre-answer payload on this table; `outcome` stays what every kind
writes at resolve time.

It is also the first kind either end of which may be wearing a **hood**, which
is why four surfaces that used to print `Character.name` off an offer now go
through `seenAs()` — see `SEARCH.md` §2a before adding a fifth.

Character ends are snapshot ids without FKs — the log-table convention. A
dead character's offers stay readable.

### 3a. Lesson: offer → accept → resolve

1. **Offer** (`lessons.js#createLessonOffer`, from `learnRequest` /
   `teachRequest` in `character/requestActions.js`). Validates both sides and
   the **initiator's** Move slot, refuses a duplicate PENDING offer for the
   same pair and skill, writes the row, returns the DM. The learner-initiated
   DM is Bascinet's line: "*X* wants to try and learn *Y* from you. Accept?"
2. **Accept** (`lessons.js#acceptLesson`). Re-validates everything for
   **both** sides — same open turn, `moveWindow` not locked, both alive and
   here, skill still teachable, learner has no Action, teacher passes
   `teacherSlot` — then in one transaction: claim PENDING→ACCEPTED
   (`updateMany`, count 0 = someone answered first); create the learner's
   Action (`GAMBIT`, `CONFIRMED`, `moveReviewStatus OPEN`, die rolled and
   modifier stored now like any Gambit, `gmNotes: "auto:lesson"`); create the
   teacher's Routine (`CONFIRMED`, `PASSED`, `appliedEffects: {}`,
   `auto:lesson`) **only if the teacher lacks Teaching**; stamp `threshold`
   and the action ids. A Teaching holder's `teacherActionId` stays **null** —
   there is no Move, so there is nothing for a GM to see or reject, and their
   accept DM says so instead of confirming a Move. Any refusal after the claim
   leaves the offer **CANCELLED**, never PENDING, and DMs the initiator why.
   `@@unique([characterId, turnId])` is the real gate; a P2002 is a refusal,
   not a crash.

   `teacherSlot` is where the two teachers part company. A Teaching holder is
   capped by counting this turn's ACCEPTED/RESOLVED LESSON offers against
   `TEACHING_CAPACITY` — off the offers themselves, because there is no Action
   to hang the count on, and excluding the offer being accepted, which the
   claim has already flipped to ACCEPTED. Everyone else is capped by owing a
   free Move slot.
3. **Resolve**, in the same transaction as the accept (`db/lib/lessons.js`).
   `lessonOutcome` is the pure half — `total = diceRoll + diceModifier +
   charmBonus`, `succeeded = learner is ALIVE && total >= threshold` — and is
   unit-tested on its own, the way `torture.js` and `breakRestraints.js` split.
   On success the skill is granted and lower tiers are replaced; either way the
   learner's Action is filed **PASSED** with a `resultMessage` and
   `appliedEffects: {}`, which keeps it off the desk and out of the staged push,
   and the Offer goes straight to RESOLVED. A **Minted Charm** the learner has
   EQUIPPED adds +1 to the total (2026-09-07; docs/tags.yaml
   `minted-charm`, a hidden smith craft) — the student-side sibling of
   Drill Instructor, which moves the threshold from the teacher's side; the
   bonus is folded into the die line and recorded on `outcome.charmBonus`. Both sides are DM'd the die and the result in one
   line, so `stagedPush.js` skips its own 🎲 DM for `auto:lesson` Gambits.
   Every PENDING offer on the turn expires with a DM to the initiator.

A lesson resolves where it was accepted: moving away or a teacher dying
before turn end changes nothing. Death voids **PENDING** offers only
(`characterDeath.js`). A GM **Reject** of either Move
(`web/lib/moveEconomy.js#deleteActionRestoringTurn` →
`lessons.js#cancelOffersForAction`) cancels the lesson; rejecting an untrained
teacher's Routine deletes the stranded learner's Gambit too and DMs them that
their Move is free again. A Teaching holder's lesson has no teacher Action, so
that door simply never opens on it — a GM who wants it stopped rejects the
learner's Gambit.

### 3b. Bind: consent unless helpless

`bindCharacterRequest` (`db/lib/bind.js`): a target who is DEAD or holds an
`INCAPACITATING_SLUGS` tag is bound on the spot, as before. Anyone else gets
an Offer of kind BIND and the DM "*X* wants to bind you. Accept?" Accept
re-checks co-presence, alive, not already bound, same open turn, then
`applyBind` — the one function that grants `bound`, writes the
`BIND_CHARACTER` Request (`effect.offerId`, `effect.consented`) and the audit
row, used by both doors. Consent DMs **name the actor**; the old rule that a
victim's DM never does still holds for Loot and Harm.

### 3c. Break Restraints: a Bound character's own struggle

The one self-service door onto shedding `bound` — Free (§3b's rescue button)
still needs somebody else standing there. **Break Restraints**
(`breakRestraintsRequestImpl`, `web/app/(app)/character/actions/misc.js`) is
a Bound character's own Gambit at freedom, once a turn, and the odds get
better automatically the longer they've been tied up.

**The gate is holding `bound`, and nothing else.** `requireCharacter()` is
called with no `needs` — `bound` blocks `ACT` (`db/lib/incapacitation.js`),
so requiring it would make the button unreachable for the one character who
needs it. Hidden, not greyed, the same rule Extract follows (`FACTORY.md`
§3): whether you're Bound is your own sheet's fact.

**It spends the Move**, filed instantly through `fileAutoRoutine` as a
ROUTINE already PASSED — the same shape Torture uses, and for the same
reason: it resolves the moment it's pressed, so a real GAMBIT row would have
the turn-end push announce the same die a second time. No confirm dialog
either (`web/components/actions/index.js`'s `INSTANT` table) — the tooltip
already says what pressing it does. A Bound character may also file an
ordinary Gambit (`db/lib/moves.js`), so each turn it is one or the other: the
two share the one Move.

**The clock**: `Character.boundSinceTurnNumber`, stamped with `turn.number`
by `applyBind` the moment `bound` is freshly granted (not on a re-bind of
someone already tied up), the same claim-token shape as `extractDayKey`
(`FACTORY.md` §3) — a plain column, not a foreign key, so deleting a turn
never cascades into a character row. Read back each attempt as
`openTurn.number - boundSinceTurnNumber`, 0 on the same turn the bind
landed.

**The threshold table** (`db/lib/breakRestraintsThreshold`, pure and
Prisma-free like `torture.js`'s own `thresholdFor`) — a `null` threshold
means automatic, no roll needed at all:

| Holds | Turn 1 | Turn 2 | Turn 3+ |
|---|---|---|---|
| neither | needs 6 | needs 5 or 6 | automatic |
| Escape Artist | needs 5 or 6 | needs 3–6 | automatic |

Bascinet rebalanced this on 2026-09-14: harder in the first two turns, and
automatic from the third for everyone. **Giant no longer helps** — it used
to lower turn 1, and with Escape Artist made breaking free instant. Lucky or
Inspired still rolls two dice and keeps the better. No Hunger/mood Gambit
modifiers apply; this is a flat die-vs-threshold check.

On success, `bound` is **not** removed on the spot: its row is stamped
`expiresTurn = openTurn.number`, so the `expirySweep` turn pass takes it off
when the turn closes, and the player is told "You broke your restraints. This
will take effect at the end of the turn." Until then they are still Bound —
lootable, movable, and a re-bind is refused as "already bound". Free (§3b's
rescuer) stays instant. `boundSinceTurnNumber` is cleared at once. **A GM manually stripping `bound` from `/gm/dev` leaves the column
stale** until the character is bound again — accepted, not fixed:
`applyBind`'s fresh-grant check overwrites it correctly on the next real
bind, and the button is hidden the whole time `bound` is absent anyway.

**Shackles.** The **Shackle** button (`shackleCharacterRequestImpl`, misc.js)
shows only where COMPLETE **Dungeons** stand — a structure nobody can build,
seeded by `docs/zones.yaml` in the Cathedral, the Garrison and the Lifeweb.
Anyone standing there may shackle a Bound person, spending no Move: `bound`
comes off, `shackled` goes on with no expiry, and `boundSinceTurnNumber`
restarts. `shackled` is Bound in every other way (`db/lib/bind.js#
RESTRAINT_SLUGS`: Bind refuses, Torture/Mutilate/Free accept, the shout is
muffled, the night costs mood, a rite takes them), and Free still cuts them
loose. Break Restraints is **impossible** on shackles ("Breaking free is
impossible.", refused before the Move) — except for an Escape Artist, who
needs a 6 the turn they were shackled, then 5, 4, 3, 2, and 1 from then on;
never automatic, and a success still lands at the close of the turn.

## 4. The web

- **Nobody's skills are shown.** `character/page.js` builds `teachers` as
  everyone here, each offered what *I* could learn (`learnableSkills`), and
  `learners` as everyone here, each offered what *I* know
  (`knownTeachableSkills`). No threshold is shown before an offer is accepted —
  it named the teacher's Teaching or Drill Instructor. The only way to find out
  what someone knows is to ask them, and they see you ask.
- The offer goes out whatever the other sheet holds. A teacher who doesn't know
  the skill is told so ("…You don't know it.") and can only decline; if the pair
  can't do it anyway, **Accept is answered as a decline** (`acceptLesson`), so the
  initiator gets the same "declined the lesson" either way. Only the initiator's
  own side refuses up front ("You can't learn X right now.", "You don't know X.").
  `pendingOffers` is every PENDING offer I'm part of this turn; `SheetTurn.js`
  shows it under "This turn" ("Waiting for Ada to accept…").
- `actionRegistry.js`: `learn` greys on `canLearn` (`teachers.length > 0`) and
  `teach` on `canTeach` (`learners.length > 0`) — both lists the server already
  filtered, so greying is allowed. `teachCostsMove` (do I lack Teaching?) is a
  separate prop and only decides what the dialog's footnote says.
- `/gm/turns` shows a lesson as an ordinary Gambit whose description starts
  "Learning …" with `auto:lesson` in the notes. A GM who writes a result
  before the push wins; a GM who Rejects cancels the lesson.

## 5. Where the code lives

| Thing | File |
|---|---|
| Eligibility, offer, accept, decline, cancel hooks | `db/lib/lessons.js` |
| Offer expiry turn pass | `db/lib/offerExpiryPass.js` (still keyed `"lessons"` in `db/index.js` — the key is written into `Turn.resolvedPasses`, so renaming it would orphan half-resolved turns) |
| One-off drain for lessons stranded by the change | `db/scripts/ops/resolve-inflight-lessons.js` |
| Bind, both doors | `db/lib/bind.js` |
| Button row + prefixes | `db/lib/offerRow.js` |
| Bot click handlers | `bot/src/lib/offers.js`, routed in `bot/src/events/interactionCreate.js` |
| Co-presence rule | `db/lib/presence.js` (web: `web/lib/peopleHere.js`) |
| Web actions | `web/app/(app)/character/requestActions.js` (`learnRequest`, `teachRequest`, `bindCharacterRequest`) |
| Menus and status line | `character/page.js`, `RequestActionsProvider.js`, `SheetTurn.js` |
| Catalog | `docs/tags.yaml` (`teaching`, `teaching-drill-instructor`; `teachable:` on skills) |
| One-off Lecturing conversion | `db/scripts/ops/convert-lecturers.js` (`npm run db:convert-lecturers`) |
| Player text | `docs/documents.yaml` `teachingskills`, `docs/handbook.md` "Teaching" |

An offer's Accept / Decline is answerable on **either face** — the buttons are
drawn in the Bascinet pane on `/chat` as well as in the Discord DM
(`CHAT.md` §2b).

## 6. Converting the old Lecturers

Dropping `teaching-lecturing` from `docs/tags.yaml` does nothing to a character
who already holds it — `db:sync-tags` is upsert-only. Two steps clear it, and
**both are destructive against live data, so both wait on Bascinet saying yes
in chat**:

```
npm run db:convert-lecturers            # dry run: says what it would do
npm run db:convert-lecturers -- --apply
npm run db:prune-tags -- --apply        # then the orphaned tag itself
```

The first re-points each Lecturing row at plain `teaching`, or deletes it if
the holder somehow has both. It is the one place the old rung is remembered,
and it can be deleted once it has been run against the live database.
