# Stealing and pickpocketing

Two verbs for taking something that isn't yours without being seen doing it.
This doc owns `db/lib/steal.js`, `db/lib/pickpocket.js`, the `steal` mode on
the Move things dialog, `PickpocketDialog.js`, and the `PickpocketAttempt`
table. Related: [`CARRY.md`](CARRY.md) §6–§7 (stashes and Transfer),
[`SEARCH.md`](SEARCH.md) (the other verb that reaches a hood),
[`TAGS.md`](TAGS.md) §4a (what the two tags cost).

## 0. Why they exist

Before these, the game had one way to take something out of a room stash —
Transfer, **From: a room, To: you** — and it always posted a line to the room
thread saying you had done it (`CARRY.md` §7). It had no way at all to go
through an upright person's pockets: Loot refuses anybody who is not bound,
dying, paralyzed, catatonic or dead, because listing a standing person's
holdings would leak their hidden tags.

So theft was unplayable. A Brigand could rob a corpse, or tie somebody up and
then rob them, but could not palm a lantern off a shelf without the room being
told, and could not lift a purse at all. Meanwhile the `pickpocket` tag had
been in the catalog since launch, cost 3 points, sat behind the Brigand gate,
and did nothing whatsoever.

## 1. Steal

**It is Transfer's room → you path with the room line suppressed.** That is
the whole implementation and it is deliberately not more than that:
`web/app/(app)/character/actions/steal.js` hands the move itself to
`transferRequestImpl`, which already does reach, the tradeable filter, the
non-stackable clamp, the carry ceiling, the per-line `TRANSFER_TAG` rows a GM
undoes from `/gm/turns`, and the `afterInventoryChange` tail. Forking that
function to put a die in it is the thing the file exists to avoid.

- Anyone presses **Steal**, picks a stash at their Location they can get into,
  and ticks what they want.
- **It costs no Move, files no `Action`, and has no ration.** Steal all day.
- On the way out a **d6** is rolled. Nobody is ever shown it.

### 1a. The goods always move

This is the part a player will get wrong, so it is worth saying plainly: **a
failed steal is not a stopped steal, it is a noticed one.** The die decides one
thing only — whether the room thread hears a line. On a success nothing is
posted anywhere at all: no Discord message and no `/chat` scene row.

That is also the reason the verb is honest rather than strictly better than
Take. Transfer's line names what you took; Steal's says only that somebody
tried. Anyone who does not mind being seen still has Take sitting right there.

### 1b. The table

Success on a **4 or higher**, modified. The list lives in `db/lib/steal.js`,
and it is **closed**:

| | value |
|---|---|
| Stealth | +2 |
| Clumsy | −2 |
| Tipsy | −1 |
| Wasted | −2 |
| Blind Drunk | −2 |

So an average person is seen a third of the time, somebody Clumsy needs a 6,
and somebody with Stealth is only caught on a 1.

**Hunger and mood do not apply**, which is where this deliberately diverges
from `gambitModifier.js`. Steal costs no Move and has no ration, so folding the
Gambit penalties in would make a hungry character's every theft loud with
nothing they could do about it.

**Stealth and Clumsy cannot both land** — the catalog pins them
`conflictsWith` each other — so nothing has to arbitrate between those two.

**The drink rungs never sum: the worst one counts.** Tipsy escalates into
Wasted so that pair never co-occurs, but **Blind Drunk is a separate tag off a
bad drink and nothing stops it landing on somebody already Wasted**. Summed,
that pair is a silent −4 and a 6 that still fails, which is a worse punishment
than either tag claims to be. Same shape as a mood band, and for the same
reason. `db/test/steal.test.js` pins it.

**Subtle is not in the table, and its absence is the interesting one.** It used
to read *"the room never notices you doing it"*, which is this verb exactly. It
was rewritten on 2026-09-16 to be about whispers not carrying, so it is a sound
tag now rather than a sleight-of-hand one.

### 1c. Lucky applies, Inspired does not

The die goes through `db/lib/advantage.js#rollWithAdvantage`, which is the
repo's rule for every d6 a character throws, so **Lucky quietly applies** — the
same admission [`SEARCH.md`](SEARCH.md) §3b makes about its own unseen die.

`gambitOnly` stays **false**, so **Inspired deliberately does not**. It is a
one-shot the player paid for, and an unlimited free roll eating it would be a
theft they could not even see. Worth knowing because Bascinet's own note for
this feature said "rolls a gambit" — it is Gambit-*shaped*, the way Torture and
Confession are, but it files no `Action` and spends no Move.

### 1d. Suppressing the room line safely

`transferRequestImpl` takes its `announceTake` switch as a **SECOND
parameter**, never a field on its input object, and it has to stay that way.
`requestActions.js` calls it as `guarded(() => transferRequestImpl(input))` and
hands the client's whole input object straight through, so anything read off
`input` is settable by whoever is typing in the browser. An `announceTake:
false` posted from a console would let any player empty every stash in the game
in silence. As a second argument it is unreachable, and `actions/steal.js` is
its only caller.

The dialog's own notice is **outcome-blind** for the same family of reasons —
the server returns no die and the sentence never varies, so nothing there can
be read backwards into whether the room saw you. The room's thread is what
tells you that.

## 2. Pickpocket

Going through a standing person's pockets. Needs the **Pickpocketing (Basic)**
tag (§3), costs no Move, and is rationed: **once per person per turn**, spent
by reaching in whether or not it works.

- Both sides at the same Location, both alive, neither blocked from `ACT`.
- **A hood refuses nothing**, either end — `allowConcealed: true`, the Search
  posture (`SEARCH.md` §2a). A hood hides who you are, not what is in your
  pockets. Every line either side reads names people by the face the room saw.
- Nothing is ever posted to a room, on any outcome.

### 2a. Three bands, not two

Read off the die **plus** Skilled's +1:

| total | what happens |
|---|---|
| 4+ | **clean.** They are told nothing at all. |
| 2–3 | **noticed.** You get the goods, and they are DM'd that you picked them. |
| 1 | **failed.** Nothing moves, and they are DM'd that you tried and failed. |

The middle band is the whole texture, and collapsing it into a plain pass/fail
is the easy accident — a verb that only ever succeeded silently or failed
harmlessly would be a free action with no reason not to press it at everybody
in the room.

**Pickpocketing (Skilled)'s +1 lifts a natural 1 clear of the failure band**,
so a master is never caught empty-handed, only felt. That is what "almost
always succeeds" means.

### 2b. The weight budget, and the hole it plugs

**15 lb**, or **30 lb** with Skilled. Weighed with `db/lib/tagWeight.js#rowWeight`.

Three filters decide what a hand can reach, and the third is a hole rather than
a nicety:

- **`tradeable`** — the Loot filter. Skills, injuries, beliefs and statuses
  were never cargo.
- **not `equipped`** — lifting a worn breastplate off a standing man is a
  fight, not a theft. This makes the verb strictly narrower than Search's Hide
  picker, which *does* treat a WORN dagger as palmable, and the difference is
  deliberate: Search asks what you could hide on yourself, this asks what
  somebody else's fingers could reach. Do not "harmonise" the two.
- **not an Asset** — and this one is load-bearing. **An Asset weighs 0 on
  purpose** (a horse carries itself, `CARRY.md` §1), so a weight budget cannot
  bound it. Without this clause 15 lb buys every horse, deed and house a person
  has on them, unlimited, because none of it counts. The budget is the only
  brake this verb has, so anything the budget cannot measure is off the table
  entirely.

### 2c. What the thief is shown

A plain name and a weight, and **no `TagChip`** — the only stack list in the
app drawn that way apart from a helpless person's pockets, and for that exact
reason (`REQUESTS.md` §5b). The filter behind the rows is `tradeable` rather
than `catalogVisibility`, so a secret tag is *already* named there; putting its
description, recipe and cost on a hover as well would be a second leak on top
of the one the verb is for.

This is a real new exposure. Loot refuses an upright person precisely to avoid
it, and this verb exists to open it. Matching Loot's filter and its no-chip
rule is what keeps the exposure to what the verb is actually for.

**A clean roll and a noticed roll return the IDENTICAL payload.** If the thief
could tell a 5 from a 2 by what came back, the die would be readable off the
dialog and a noticed theft would just be one you re-plan around.

### 2d. One row, doing two jobs

`PickpocketAttempt`, `@@unique([thiefId, targetCharacterId, turnId])`.

It is the **ration** — the insert is the claim, the `SearchAttempt` discipline
(`SEARCH.md` §3). Pickpocket has no cooldown behind it, so a count-then-create
would not be race-proof, and the claim has to survive a failed roll or failing
would be a free retry.

And it is the **authorization** for the second half. Pickpocket is two acts —
roll, then choose — and the take re-reads this row for whether it may happen at
all and how many pounds are left. The die and the budget are columns rather
than something handed to the browser, because an authorization that travelled
through a client is not one. `spentLbs` is claimed by a conditional
`updateMany` whose WHERE is the check, so two tabs cannot both spend the last
pound.

**It is deliberately not an `Offer`.** Every Offer in the game is a consent
handshake: it DMs buttons, `offerExpiryPass.js` expires it, `characterDeath.js`
voids it, and it shows up in the responder's waiting-on-you list in `/chat`. A
pickpocket target is never asked anything and on a good roll is never told — so
the one surface an Offer would light up is exactly the one that has to stay
dark.

Two consequences fall out of it for free:

- **A turn boundary invalidates the authorization with no sweep**, because the
  take looks the row up by the *currently* open turn.
- **Nothing has to cancel it when somebody walks away.** The take re-runs
  `pickpocketAuthority` from scratch, so co-location is re-checked at use.
  That is why this verb needs no hook in `locationMove.js` the way a pending
  Search offer does.

`turnId` is not a foreign key — the `InterceptHit` reasoning: it is a claim
token, and deleting a turn must never cascade into somebody's spent ration.

**A reopened dialog does not cost the attempt and does not reroll.** A P2002 on
the claim reads the existing row back and hands the *same* die over, as long as
nothing has been taken against it yet. Only a roll that actually happened sends
the target's DM.

### 2e. The DM fires at the take, not at the roll

A 2–3 where the thief opens the picker and then takes nothing says nothing at
all, which is the honest reading: you notice a hand in your pocket because
something left it. The consequence is that a thief who looks and cancels
escapes notice — the spent ration is the brake on doing that all afternoon.

### 2f. No mood hit, no notice

Loot applies `ROBBED` and tells the target their body was searched. Neither
happens here, and `ROBBED` especially must not: a mood hit on a clean roll
would be a tell, and would give away a theft the die had just bought silence
for. If a mood hit is ever wanted, it belongs on the **noticed** band alone.

## 3. The two tags

| | slug | cost | who |
|---|---|---|---|
| Pickpocketing (Basic) | `pickpocket` | 3 | anyone |
| Pickpocketing (Skilled) | `pickpocketing-skilled` | 2 | Brigands |

**The slug did not change, on purpose.** `db:sync-tags` is upsert-only, so
renaming in place keeps every Brigand who already bought the old Pickpocket.

**What opened it to everyone was the GROUP, not the tag.** `pickpocket` moved
from `general-brigand` — which carries `requiredTag: brigand` in
`docs/taggroups.yaml` — to `general-traits`, which carries no gate. The member
tags of a gated group deliberately never repeat the gate themselves
(`TAGS.md`), so moving the tag is the whole of the change.

**Skilled uses `requiredTag`, not `parentTag`.** A prerequisite that does *not*
replace, so a master holds both rungs and pays 5 in total. `parentTag` would
delete Basic on purchase and leave every gate having to accept either tag to
mean the same thing.

## 4. Where the code lives

| Piece | File |
|---|---|
| Steal's table and threshold | `db/lib/steal.js` |
| Pickpocket's bands, budget and holdings filter | `db/lib/pickpocket.js` |
| Steal's server action | `web/app/(app)/character/actions/steal.js` |
| Pickpocket's two phases | `web/app/(app)/character/actions/pickpocket.js` |
| The `announceTake` switch | `web/app/(app)/character/actions/transfer.js` |
| Steal's dialog (a mode on the shared one) | `web/app/components/actions/MoveThingsDialog.js` |
| Pickpocket's dialog | `web/app/components/actions/PickpocketDialog.js` |
| The buttons | `web/app/components/actionRegistry.js`, `web/app/(app)/chat/RoomPanel.js` |
| The gate | `canPickpocket` in `web/app/(app)/character/page.js` |
| The ration + authorization row | `PickpocketAttempt` in `db/prisma/schema.prisma` |
| The pure halves | `db/test/steal.test.js`, `db/test/pickpocket.test.js` |
| The tags | `docs/tags.yaml` (`pickpocket`, `pickpocketing-skilled`) |

## 5. Known warts

- **A failed Steal still moves the goods**, and a player reading the room line
  as "the theft was stopped" will be wrong. It is the settled rule, but it is
  the thing a GM will be asked about first.
- **The audit log is the only complete record of a stash now.** Anyone reading
  a Room thread has until now been able to treat "no line" as "nothing left
  here". After Steal, a missing item with no line is ordinary. Any tool
  reconciling `RoomTag` deltas against scene lines will disagree.
- **Search and Pickpocket each hold their own per-target-per-turn claim**, in
  separate tables with separate refusals, so `SEARCH.md` §7's known wart
  reproduces here exactly: a hood coming off makes a refusal that names
  somebody you were never told about. Same harmless direction.
- **A pickpocket near their own carry ceiling is refused outright** rather than
  landing and shedding. That is not tidiness: past 1.5× the cap `settleCarry`
  sheds newest-first into a public room *with a line in it* (`CARRY.md` §5),
  which would announce a silent theft one second after it succeeded.
