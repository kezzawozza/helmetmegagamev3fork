# Attack — pinning a fight in place

You press it on somebody standing with you and neither of you goes anywhere.
Both of you are held where you are until the turn ends and a GM reads what you
both filed.

**Nothing here resolves a fight.** A fight is a Gambit and a GM's ruling, the
same as it always was (`COMBAT.md`). What this buys is that the other person
cannot walk out of the scene and carry on with their day before the ruling
lands.

## 1. It is Intercept's hold

`db/lib/intercept.js` owns `Character.heldUntil`, `heldReasonFor`, and every
gate that reads them — the mover's own gate in `performLocationMove`, the
refusal `resolveNeighbors` draws on every shut way, the `/chat` and `/map`
banners, the Stepstone, the bot's picker, the escort that refuses to carry a
held follower. **None of that changed.** `db/lib/attack.js` writes the same two
columns and inherits the lot.

The hold runs to `turnClock.js#turnEndsAt(openTurn)`, so the turn advance frees
everybody for free: no cron, no pass, no rows to sweep. Floored at
`now + SAFE_HOLD_MS`, the `fireWatches` reasoning — a turn the cron has not
closed on time would otherwise put the deadline in the past and hold nobody.

**Both sides are held, each named as holding the other.** You do not start a
fight and stroll off.

`Character.heldReason` says WHY, and it has **three** values, not two —
`intercept`, `attack`, `attacking` (`HELD_REASON` in `db/lib/intercept.js`).
The third is the whole point: the person who was jumped and the person who did
the jumping are both held, and telling the aggressor *"Somebody attacked you"*
on every shut way and every banner would be a plain lie. A column rather than a
query because `heldReasonFor` is pure and eight surfaces read it.

`heldById` names **one** opponent, and a brawl has several, so it is re-derived
rather than merely cleared — see `settleHold` below. Every clear that works off
`heldById` (`releaseHeldBy`, the walk-off clear in `locationTravel.js`, the
death clear in `characterDeath.js`) carries `heldReason: { notIn: FIGHT_REASONS }`
for the same reason: a blind clear would free somebody out of a fight that is
still going.

## 2. The row is the rule

`Attack`, one row per attacker per target per turn, and the
`@@unique([attackerId, targetCharacterId, turnId])` is what keeps it that way.
The `InterceptHit` shape exactly: the insert claims the act, so nothing is ever
counted.

Breaking off **stamps `cancelledAt` and never deletes**. It is what a GM reads
afterwards — a fight somebody started and called off is still something that
happened — and deleting it would hand the unique straight back.

**A cancelled row is a cooling-off period, not a headstone.** This used to be
"attacking is permanent for the turn", which sounded fair until you noticed a
turn is a whole real day: calling a fight off because the scene had moved on
spent your only swing at that person until tomorrow, and the next press was
answered with *"You're already fighting them"* about a fight nobody was in.
The hold had lifted and the other person could walk away, so the sentence was
simply untrue.

So the unit is an hour rather than a turn — `ATTACK_COOLDOWN_MS` in
`db/lib/attack.js`, the `db/lib/bell.js` shape, hardcoded because there is one
right answer. The clock starts at the **break off**, not at the attack, so a
long fight does not let you re-engage the moment you let go. Nobody hounds one
person all afternoon, which is what the old rule was protecting; a fight that
restarts for a real reason can restart.

The unique stays, and this is the part worth keeping straight: a cooled-off row
is **reopened in place**, not replaced. `fileAttack` reads the clashing row and
answers one of three ways — a live fight refuses as it always did, a row still
inside its hour refuses with the minutes left, and a cooled-off one has its
`cancelledAt` cleared and both sides held again. So it is still one row per
pair per turn, and everything downstream that assumes that
(`web/lib/holdClusters.js`'s one-per-pairing rule, the desk's Call off button)
never learns a new shape. Each press is its own `request_attack_filed` audit
row, which is where the history of a fight restarting actually lives.

A GM calling a fight off from `/gm/turns` goes through the same `cancelAttack`,
so it starts the same hour. One rule for both.

Only the attacker may call it off. `cancelAttack`'s `WHERE` is the ownership
check; there is no second lookup to disagree with it.

`settleHold` runs for **both** sides, and it clears **or re-points** — never
just clears. That second half is the one that matters. A and C both attack B,
then A breaks off: B stays held, correctly, but `heldById` still says A, who is
now in no fight at all. Left stale, the next thing that clears "everyone A is
holding" — A walking away, A dying — frees B out of C's fight. So the pointer
moves to somebody really still there, and being jumped outranks doing the
jumping when a person is in both positions at once.

**Three other things end a fight**, and each ends the ROW rather than the hold,
because the hold is derived from it:

1. The attacker presses **Break off** — on the sheet, or on the button in their
   own DM. Both go through `db/lib/dmAnswer.js#answerAttackHold`, so the faces
   cannot drift.
2. Either of them is **relocated** — a GM's teleport, a Bulk Move, a staged
   Relocate to, a rite. `closeFightsFor` hangs off
   `applyLocationMoveSideEffects`, the writer every relocation runs. Walking off
   never reaches it, because a held character cannot walk.
3. Either of them **dies** (`db/lib/characterDeath.js`), through the same
   helper and ahead of the escort and hold releases. **Both** ends, not just a
   dead attacker: a row left live on the far side would go on pinning the
   survivor for the rest of the turn, because `settleHold` would keep finding
   it — and the GM's lens would sit there reading "Holding" over a corpse.

*One known gap, and it is small:* a two-minute Safe intercept hold that an
attack overwrote is not restored when the attack is called off. A second column
for two minutes of a stranger's afternoon is the worse trade.

## 3. The strength gate

> This opponent is too strong to attack.

Refused when the target's band is **more than two bands** above yours.
`MAX_BAND_GAP` in `db/lib/attack.js` is the one tunable.

**Bands, not points, and that is load-bearing.** `floor:`/`cap:` tags move the
band index *after* the points are summed (`fightingSkill.js`), so a bound Expert
still scores 55 and only their band knows they are Pitiful. A score-based gate
would let a tied-up champion refuse to be attacked, which is exactly backwards.
Bands are also the unit the game already speaks, and every rung sits dead centre
of one — so two bands is two rungs either way. (Pitiful is the one band that is
not ten points wide, `COMBAT.md` §3, and the gate is unaffected: it counts band
indexes, not the points inside them.)

**The better half of each tree answers.** A marksman is measured on their
ranged band, not on the melee they never trained; otherwise a good shot is a
free target for anybody with a knife.

Only the gap **upward** is checked. Attacking somebody far below you is a bad
thing to do, not an impossible one, and the GM reads it either way.

How it falls out against the catalog as written:

```
a peasant           Weak       may attack up to Capable
a guard             Mediocre   may attack up to Seasoned
a soldier           Capable    may attack the Dangerous swordsman
```

So a peasant may take on a guard or a soldier and is refused a trained
swordsman or an Expert; a guard may take on the soldier and is refused the
swordsman. That is the line the gate is drawn at: a fight you will probably
lose is yours to pick, a fight you cannot be in is not.

**Why it exists:** without it anybody at all freezes anybody at all for a whole
day, and a bum stops the Tribunal Ordinator by walking up to them. It is meant
to stop a hopeless fight, not a hard one.

**It is the one thing a player ever learns about somebody else's band**, and
`COMBAT.md` §5 names it as the deliberate exception it is. It is one bit — "3 or
more above me" — rather than a number, and it costs a press to learn.

## 4. An Ambush IS an attack

An Intercept watch in **Ambush** mode files a real `Attack` row when it fires
(`fromAmbush: true`), and that row is what holds both sides. Same hold, same
cancel, same queue. **Safe** is untouched: a two-minute stop, no Attack row.

Two consequences worth stating plainly:

- **No strength gate on an ambush.** You set a watch blind and do not get to
  pick who walks into it.
- **The ambusher is held too.** Springing the trap puts you in the fight. That
  is a real change to Intercept and it follows from §1.

The Release button on the ambusher's DM became **Cancel attack**
(`DM_ACTION.ATTACK_HOLD`), because breaking off has to unpick *both* holds
rather than one. `INTERCEPT_HOLD` and its prefix stay so a button already
sitting in somebody's DMs when this shipped still does something; nothing
builds a new one.

`releaseHeldBy` refuses to touch an attack hold at all — its `WHERE` carries
`heldReason: { not: "attack" }`. Letting the intercept Release near one would
free the victim, leave the row live, and leave the attacker standing there held
by a fight that no longer holds anybody.

## 5. What it costs

Nothing. No Move, no ⬢, no `Action` row, no per-turn ration. The Gambit you
file afterwards is what costs your Move.

`needs: ACT` applies — a bound man is told why rather than left pressing a
button that cannot work.

### 5a. But not once your Move is spent

**A Move already filed this turn refuses the button**, unless that Move is a
**Gambit**. `db/lib/combatGate.js` owns the predicate and the sentence:

> You've already used your Move this turn. You should only Attack if you plan to
> use your Gambit to actually declare your combat.

The reason is the whole of §5 turned around. Free means a player whose turn is
already spent on something else can still pin somebody where they stand for the
rest of the day — and all a GM gets for it is a Move with nothing in it about
any fight, and two holds to unpick by hand. The other player lost an afternoon
to a button that cost nobody anything.

The Gambit exception is why the check reads `Action.moveKind` rather than the
plain "have you acted" question the rest of the sheet asks
(`web/lib/moveEconomy.js`). Writing *"I swing at Bob"* first and pressing the
button second is the right thing done in the other order, and must not be
refused.

It tests the **row**, not the kind, so **a filed Move with no `moveKind` at all
counts as spent**. `db/lib/locationTravel.js` files a paid zone crossing with
that column left null, and a crossing costs the whole turn — reading it as
"hasn't acted" would have let anybody who walked across a boundary pin somebody
anyway, which is the case this exists for. A future writer that forgets the
column fails closed the same way.

**Two things this does not catch**, stated so nobody assumes otherwise. It is
an ordering rule: pressing Attack first and filing a Routine afterwards is not
refused by anything, because `db/lib/moves.js#fileMove` knows nothing about
holds. And the exception is the Move's *kind*, not its contents — the auto-filed
Gambits (`auto:lesson`, `auto:confession`, `auto:heal_gambit`, the Cathedral
research one) are nobody's combat declaration but read as one here.

**Break off is never gated.** `cancelAttackImpl` carries no such check, on
purpose: it is the way out for exactly the player this refuses, and locking it
would be worse than the thing being prevented.

A firing **ambush** is not gated either. `fireWatches` files its `Attack` row
off a watch set earlier, when the Move was still free (§4).

## 6. The surface

`/character`'s verb strip, in the **Others** section, on `ActionDialog`.

**No `gate` and no `show`.** Whether anybody standing near you is out of your
league is a fact about the *room*, and greying on it would be free scouting
every time the page loaded — the metagaming rule at the top of
`actionRegistry.js`.

§5a's refusal is a fact about your own sheet, so that rule would allow greying
the icon for it — but the **Attack submit inside the dialog** greys instead,
with the sentence above the picker. Break off lives in this dialog, and a dead
icon on the strip would strand anybody who attacked and then filed a Routine.
It is the shape `CraftDialog.js` already uses for `hasMoved`.

The picker lists everybody here, **including the people the button will
refuse**, for the same reason the icon never greys: filtering them out would
answer "who is out of my league?" to anyone who opened the dialog, which is the
one thing §3's exception is kept narrow to avoid.

Nothing in the dialog is a tooltip (`SHEET.md` §3). What an attack does prints
on the page, and the fights you are already in sit under it with a **Break off**
button each.

Every name a player is shown goes through `seenAs()` — the face the room saw,
never the row. Attacking a hooded stranger does not unmask them, and neither
does the audit row, which stores `presented`.

**And a hooded stranger CAN be attacked.** Until 2026-09-16 they could not: the
picker was built from `peopleHere()`, whose `hereWhere` drops anybody concealed,
and `attackCharacterImpl` re-checked `isHere()` with `allowConcealed` left at
its default — so a man in a mask was both missing from the list and refused if
you posted his id anyway. Since `forcesConceal` is set on ordinary closed
helmets, that made a Tribunal Helmet a shield against being attacked at all,
and it is how somebody walked into a Thanati hideout, took what they liked and
left with nobody able to lay a hand on them.

The rule it broke is the one the rest of this section states: **a hood hides WHO
somebody is, never THAT they are standing in front of you.** Concealment costs
you a name and nothing else.

So the picker is built from `whosHere()` now, both halves of it, exactly as
Transfer and Search are (`web/lib/peoplePools.js`). A concealed row carries an
HMAC **token** in place of its id — `/api/avatar/<id>` answers with a face, so
shipping the id *is* the unmasking — and `db/lib/targetKey.js` is the one place
that turns a posted key back into an id, for somebody actually standing here.
`attacksBy()` withholds the id the same way, or the **Break off** list would
have been the cheapest unmasking in the game.

## 7. The GM's Other lens

A fourth tab on `/gm/turns`, beside Moves / Caving / History, keyboard **o**.
It lists everything holding somebody in place this turn — attacks, ambushes and
Safe intercepts — because to a GM reading the queue those are one question: who
cannot leave, and who is standing over them.

Named for the shape rather than the contents. It is where the next thing that
is neither a Move nor a die goes — the first thing to take that up being the
uploaded-portrait review queue (`PORTRAITS.md` §1a).

**A row is one FIGHT, not one pairing.** Three guards jumping a party of four
files twelve `Attack` rows, and twelve rail rows read as twelve unrelated
events when it is one scrap in one room. So the rows are clustered: connected
components over the turn's `Attack` rows, bucketed by Location first. Two
people cannot be in two rooms at once, so two brawls can never really share a
member — the bucket makes that structural rather than lucky, and it stops an
aggressor who attacked somebody in Town at dawn and somebody else in the
Marshes at dusk from welding the two into one nonsense row.

Cancelled edges ride along inside their cluster rather than splitting off. A
fight somebody started and called off is still something that happened at that
scene, which is the only reason the loader fetches them.

The row's **id comes off the oldest edge** (`hold:<attackId>`), never off the
member set. A set-derived id is a new id the moment a fourth person joins,
which drops the GM's keyboard cursor mid-read. The row is `Ambush` if any edge
is, and `Holding` while any edge is live.

### The strip

Everyone in the fight rides **under** the row, inline and always open — not a
desk, and not behind a disclosure. The whole point of the lens is seeing at a
glance whether anything is happening, and a fight you have to click twice to
read is one a GM scrolls past.

One line per person: their name, what they are in this for (*attacking* /
*held*), and **what they filed this turn** as a chip each. The chip flips the
lens to Moves and opens that Move, so a GM reading a fight is on the Gambit in
one click instead of hunting the Moves lens by name — which is the thing they
opened the row for. Somebody may hold more than one (an auto-filed Travel
beside their Gambit; `Action` carries no unique on `characterId` + `turnId`), so
each gets a chip.

The chips are built from the Move rows the page **already shipped**, not from a
second query. So a chip can only exist for a Move the client actually holds,
which makes it structurally impossible to draw one that opens an empty desk.

Somebody on both ends of the web reads as **held**: being jumped outranks doing
the jumping, the `settleHold` rule in §2, and the row must not disagree with the
sentence that person is reading off every shut way.

`.desk-queue-row` **is** a `<button>`, so none of this can nest inside it. The
row and its strip are siblings inside `.desk-queue-rowset`, the
`AvatarReviewRow` shape, with `data-stacked` turning that wrapper from a
side-by-side into a stack.

### Calling one off

Each live pairing carries a **✕**. Only the attacker can break off, which left a
GM with nothing to press when a fight needed ending; this is that button.

**It ends one pairing, never the cluster.** `cancelAttack`'s `WHERE` names two
people and a turn, and a cluster-wide button would end fights the GM never meant
to touch. It goes through `cancelAttack` rather than stamping `cancelledAt` by
hand, because that function also settles **both** sides — which re-points
`heldById` instead of blindly clearing it, and a blind clear frees somebody out
of a fight that is still going (§2).

Both sides are DMed **"The attack was canceled."**, a `NOTICE`: the game said
it, and a canned line sitting at the top of the GM inbox as mail is the exact
pattern `DM_KIND` was built to stop.

A fight on a turn the push already swept is refused — the turn advance freed
both of them for free (§1).

### The rest of a row

A row still has **no desk**. Clicking the row, or ⏎ on it, opens the
**inspector** on the person being held; clicking any name in the strip opens it
on them. Their sheet and their band is what a GM wants next, and the strip is
what the desk would have been.

Rows carry **real** names throughout: this is the desk that already prints a
fighting band (`COMBAT.md` §5), and the presented-face rule is about players.
Search matches **anyone** in the cluster, not only the two the title names.

`GmZoneView` narrows it the way it narrows every other lens, off the fight's
own Location rather than the attacker's seat — the `cavingRollRow` reasoning.

A Safe `InterceptHit` keeps its own row and gets the same strip — both people
and what each filed — but no ✕. The hold lapsed on its own clock long before a
GM got here, so a button could only ever answer *They're already free.*

## 8. The audit

| Type | Written by | `turnId` |
|---|---|---|
| `request_attack_filed` | the button | yes |
| `request_attack_cancelled` | Break off, on the sheet | yes |
| `gm_attack_cancelled` | the ✕ on the Other lens | yes |

The DM's **Cancel attack** writes no row, the `answerInterceptHold` precedent
(`INTERCEPT.md` §9): `db/lib/dmAnswer.js` is shared by both faces and writes no
audit anywhere, and a hold ending is not the thing the log is kept for.

An ambush writes its existing `request_intercept_fired` row and no second one.
`request_attack_filed` is on the Oracle's allowlist (`db/lib/oracleAudit.js`) —
somebody starting a fight is a story fact; calling it off is not.

Nothing here is destructive, so no `restore` snapshot is owed
(`REQUESTS.md` §2).

## 9. Where the code lives

| File | Role |
|---|---|
| `db/lib/attack.js` | The whole mechanism — the band gate, the row, both holds, the lines |
| `db/lib/combatGate.js` | §5a — the spent-Move refusal |
| `db/lib/locationMove.js` | `closeFightsOnMove` — a relocation ends the fight |
| `db/lib/characterDeath.js` | A dead man is in no fight |
| `db/lib/fightingSkill.js` | `bandRank`, and nothing else changed |
| `db/lib/intercept.js` | The hold and every gate on it; an Ambush files an Attack |
| `db/lib/dmAnswer.js` | `answerAttackHold` — Cancel attack, shared by both faces |
| `bot/src/events/interactionCreate.js` | `handleHoldEnd`, one route per prefix |
| `web/app/(app)/character/attackActions.js` | Load, attack, break off |
| `web/app/components/actions/AttackDialog.js` | The dialog |
| `web/lib/holdClusters.js` | The clustering and the Other lens's row shape. IMPORT-FREE, so `db/test/` can require it |
| `web/app/(desk)/gm/turns/QueueRail.js` | The Other lens |
| `web/app/(desk)/gm/turns/actions.js` | `cancelHoldAsGm` — the ✕ |
| `db/test/attack.test.js` | The band gate, boundary by boundary |
| `db/test/holdClusters.test.js` | The clustering — one fight is one row |
