# Lessons and consent handshakes

Learn Skill and Teach Skill on `/character`, the Teaching tag tree, the
`Offer` model both of them and Bind run on, and the turn pass that resolves a
lesson. This is the game's first code-adjudicated Gambit.

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
`docs/tags.yaml`, set on every entry in the `skills` category, not a category
heuristic (TAGS.md §5). `db/lib/lessons.js#teachableSkills(teacher, learner,
catalog)` is the one rule, used by the page to build the menus and by the
offer and accept paths to re-check them:

- the teacher holds the skill **or a higher tier of it** (`parentTagId` chain
  — a Melee (Expert) can teach Melee (Basic));
- the learner holds neither it nor a higher tier;
- the learner holds its `parentTagId` when it has one, and its `requiredTagId`
  / group gate — a lesson can't skip a prerequisite the store won't.

On success the skill lands with `TagSource.LESSON` and the tiers below it come
off (`db/lib/tagWrites.js#replaceLowerTiers`), same as buying the upgrade.

## 3. The Offer

```
Offer { kind LESSON|BIND|CONFESSION|ESCORT, status PENDING|ACCEPTED|DECLINED|CANCELLED|EXPIRED|RESOLVED,
        turnId, initiatorId, responderId,
        teacherId?, learnerId?, tagId?, threshold?, learnerActionId?, teacherActionId?,
        outcome?, reason? }
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
3. **Resolve** (`db/lib/lessonPass.js`, the `"lessons"` pass — between
   `autoLabor` and `stagedPush` in `TURN_PASSES`). For each ACCEPTED lesson
   on the closing turn: learner Action gone → CANCELLED (a GM rejected it);
   Action already `SOLVED` → RESOLVED with `outcome.gmDecided`, no grant (the
   GM's word stands); otherwise `total = diceRoll + diceModifier`,
   `succeeded = total >= threshold`, grant on success, set the Action `SOLVED`
   with a `resultMessage`. A **Minted Charm** the learner has EQUIPPED at
   resolution adds +1 to the total (2026-09-07; docs/tags.yaml
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
already says what pressing it does.

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
| neither | needs 5 or 6 | needs 3–6 | automatic |
| Escape Artist | needs 3–6 | automatic | automatic |
| Giant | needs 4–6 | needs 3–6 | automatic |
| **Escape Artist and Giant together** | **automatic** | automatic | automatic |

Escape Artist shifts the whole ladder one turn early — their turn 1 plays
like everyone else's turn 2. Giant only sweetens turn 1; Bascinet gave no
reason to shift its later turns, so turn 2+ falls back to the base ladder.
Escape Artist and Giant together is Bascinet's own ruling (2026-09-24):
instant, from turn 1, no exceptions — not merely the better of the two.
No Hunger/mood Gambit modifiers apply; this is a flat die-vs-threshold
check.

On success, `dropCharacterTag` removes `bound` and `boundSinceTurnNumber` is
cleared. **A GM manually stripping `bound` from `/gm/dev` leaves the column
stale** until the character is bound again — accepted, not fixed:
`applyBind`'s fresh-grant check overwrites it correctly on the next real
bind, and the button is hidden the whole time `bound` is absent anyway.

## 4. The web

- `character/page.js` builds `teachers` (everyone here holding a skill I could
  take, each skill carrying its own `threshold` so the chip can say what I need
  to roll off **that** teacher) and `learners`, the same list the other way
  round. Both are built for everyone present now, not just tag holders. Only
  skills that could actually change hands cross the wire — never another sheet.
  `pendingOffers` is every PENDING offer I'm part of this turn; `SheetTurn.js`
  shows it under "This turn" ("Waiting for Ada to accept…").
- **This is a skill-scanner of the room, and that is accepted.** Since anyone
  can teach, the Learn menu now names everyone standing here who holds a skill
  I lack. That falls out of the rule; designing around it would mean hiding
  teachers who could really teach me.
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
| Turn pass | `db/lib/lessonPass.js` (`"lessons"` in `db/index.js`) |
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
