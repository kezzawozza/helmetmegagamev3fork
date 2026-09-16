# Combat

How good somebody is in a fight, where the number comes from, and who is
allowed to read it.

Nothing here resolves a fight. A fight is a Gambit and a GM's ruling, the same
as it always was. What this system does is answer the question a GM used to
answer by opening the Tags list and doing arithmetic in their head: **how good
is this person, actually?**

`db/lib/fightingSkill.js` is the whole of it, and it is the sibling of
`db/lib/armorValue.js` — the catalog carries the numbers, one module owns the
words and the stacking rule, and nothing else is allowed to re-derive either.

## 1. It reads the catalog as written

The catalog was most of the way here before this existed. Around twenty tag
descriptions already say **"your melee skill counts as 2 tiers higher"**, so the
unit is tiers, and **not one description was reworded** to make this work. Where
a tag says a number, that number is what it does.

Two are load-bearing enough to name, because the prose and the `fighting:`
block are two copies of one number and they must never drift:

| tag | its own words |
|---|---|
| `opium-high` | "Your fighting skill counts as 1 tier lower." |
| `crossbow` | "your Ranged Fighting skill counts as half a tier higher due to its ease of use" |

The crossbow read *one tier* until 2026-09-10, when the ranged rebalance (§4,
The ranged ladder) dropped it to 0.5 and the description was edited to match.

The drinking ladder used to sit in that table too — `tipsy`, `wasted` and
`hangover` each stated their own shift. On 2026-09-11 the numbers moved (§4, The
drinking ladder) and the sentences came out rather than being rewritten: a rung's cost now
depends on whether you are a Drunken Master, so no single sentence on the rung
could be true for everyone reading it.

## 2. The four classes

Every combat-relevant tag is exactly one of these, and which one it is depends
entirely on **what the code can know**.

| Class | Means | Examples |
|---|---|---|
| **Tier** | a rung on the ladder | `melee-expert`, `ranged-basic` |
| **Modifiers** | programmatic, and not about a weapon | Giant, Old, Missing Arm, Reckless Attacker, Flamboyant (*wearing no body armour*), Drunken Master (*while drunk at all*), the Thanati robes |
| **Items** | the weapon in your hand, and the skills keyed to one | a Broadsword, Melee (Swords) *with a sword in hand* |
| **Situational** | the fiction of the moment decides, so a GM does | Duelist, Shield Wall, Guerrilla, Sniper, Monster Hunter, Camouflage |

Four rules fall out of that, and each one is load-bearing:

- **Items means weapons. Nothing else.** Armour is its own system with its own
  words and **never** adds to or subtracts from a fighting band. It sits in the
  same tile so the two are read together, not summed. Armour can still be a
  *condition* on a Modifier — which is all Flamboyant needs, and it reads only
  whether a slot is filled, never what is in it.
- **A situational may carry no number at all.** Camouflage, Iron Constitution,
  a Hound: real weight in a fight, no tier. They render in the same strip as
  the numbered ones, so a GM reads one list instead of two. And it is a
  **flag**, not a sentence — `situational: true`. It used to carry the
  condition as prose ("when dueling", "at long range") and that came back out:
  which moment a tag is for is already in the tag's own description, and two
  copies of one fact are two things to keep in step.
- **Some things are a floor or a cap, not a number.** Apex Form *is* Legendary
  — it "removes almost all of your other tags", so there is nothing left to add
  to. Bound, Paralyzed and Asleep *are* Pitiful. A floor never caps and a cap
  always wins.
- **A modifier can cancel another.** Ambidextrous is *"Losing a hand would only
  be a minor inconvenience to you"* — not a smaller penalty, no penalty. The
  breakdown still names the cancelled row and what cancelled it, so a player
  wondering why their missing hand costs nothing can read the answer.

### Stacking

**Modifiers sum. Items take the single best.**

Not invented for this. It is the rule the handbook already states for tools:
*"Carrying two weapons does not pay twice — you hunt with one of them, so only
the better one counts — but a weapon, a set of gear and a skill all stack."*

The "best" is the best **pairing**, not the best weapon: a specialism is scored
together with the weapon it names, because a Broadsword is worth little alone
and a great deal to a swordsman. Holding a sword and a mace, a swordsman gets
the sword.

Situational entries never enter the number at all. That is what stops Duelist
plus Guerrilla plus Sniper from running away.

## 3. The scale

**Authored in tiers, stored in points.** One tier is ten points, so a tag can
be worth half a tier and the arithmetic never touches a float. `tiers: -0.5`
becomes `points: -5` at the door (`db/lib/tagShapes.js`), and nothing reads
`tiers` back out of the database. A `tiers:` off the 0.1 grid is refused rather
than rounded — a typo should fail the sync, not quietly change a tag.

Untrained is **15**, a rung is **+10**, and the bands are **10 wide**, so every
rung lands dead centre of its band. That centring is what makes the words
stable: a peasant picking up a knife, or taking one half-tier knock, stays what
they were.

**Pitiful is the one band that is not ten wide** (2026-09-10). It ended at 9,
six points under an untrained 15, so a single ordinary drawback — Clumsy, Fat or
Dwarf, all −0.7 — put a healthy person in the same word as somebody tied to a
chair, and a fifth of the living roster was in it. The bands measure *skill*,
and below untrained there is no skill left to measure, only injury, so the
bottom band should take a real injury to reach. Weak widens downward instead.
The trade is that untrained is no longer dead centre of its own band: five
points up to Mediocre, eleven down to Pitiful. That asymmetry is the point in a
valley where almost nobody has been trained.

| Score | Band | | Held | Score | Band |
|---|---|---|---|---|---|
| ≤4 | Pitiful | | nothing | 15 | **Weak** |
| 5–19 | Weak | | Basic | 25 | Mediocre |
| 20–29 | Mediocre | | Trained | 35 | Capable |
| 30–39 | Capable | | Skilled | 45 | Seasoned |
| 40–49 | Seasoned | | Expert | 55 | Dangerous |
| 50–59 | Dangerous | | Legendary | 65 | Lethal |
| 60–69 | Lethal | | | | |
| 70+ | Legendary | | | | |

**Everyone starts Weak**, which is the point — most of Ravenheart has never
been trained. **Pitiful is only reachable downward**: a missing arm, Frail,
Wasted, a bad wound. **Legendary needs the peak of a specialism and the right
thing in hand** — Expert plus Swords plus a sword. Nobody buys their way there.

How it actually falls out:

```
a peasant                                Weak
a peasant with a work knife              Weak
guard: Basic + broadsword                Mediocre
soldier: Trained + broadsword            Capable
Trained + Swords + broadsword            Dangerous
Expert, unarmed                          Dangerous
Expert + Swords + broadsword             Legendary
robed Thanati, Skilled, with the knife   Lethal
```

**Every tunable is in one block at the top of `db/lib/fightingSkill.js`** — the
base, the rung step, the tier size, the band edges. Rebalancing the whole
system is an edit there, not a sweep through `docs/tags.yaml`. That matters,
because the specialisms at +2 tiers are the values most likely to want a second
pass once the game has been played.

### Pricing a tag

A fighting rung costs 7 tag points, so **a tier is worth about 7 points** — but
that is a **ceiling, not a formula**:

> A tag's price pays for everything it does. Combat gets the share of that price
> combat actually earns, and the full share only when fighting is the tag's
> whole job.

Relentless (7 pts, pure nerve) takes its full +1. Eagle Eyes used to be the
example pointing the other way — 2 pts, and combat took only part of it.

**Eagle Eyes is now the exception instead** (2026-09-16). At +0.5 for 2 points
it is 0.25 a point, nearly double the ceiling, and that is deliberate: it is
`tree: ranged`, so unlike the awareness tags it sits beside it never pays into
both halves at once. The same pass cut Spotter (0.7 → 0.4), Sixth Sense
(0.7 → 0.2) and Brave (0.5 → 0.3), all `tree: both`, because a pile of cheap
unrelated traits was out-earning the weapon in somebody's hands. Eagle Eyes was
raised in the same breath to keep an archer's *aim* worth more than an archer's
*alertness*. If the ceiling is ever enforced here, the fix is the tag's price,
not its tiers.

### Pricing a drawback

**The same ceiling, pointed the other way** (2026-09-10). A drawback bought for
points is a bargain the game struck with the player, so it owes the same rate a
bonus pays:

> A drawback's combat penalty is at most `|pointCost| × 0.14` tiers, and less
> when the drawback costs you things outside a fight too.

0.14 is a rung: +1 tier for 7 points. Tough, Relentless and Giant all sit
exactly on it, and Strong is deliberately under it at 0.10 because it also does
carry.

The negatives did not. They ran 0.20 to 0.375 — Missing Fingers worst of all at
−1.5 tiers for a −4 drawback, **2.7× what a bonus pays**, with a hand slot taken
on top, and worse than a Peg Leg that cost more. Losing fingers outranked losing
a leg. Every bought drawback was re-rated to the ceiling above.

**Two deliberate deviations**, both louder here than in a diff:

- **Blind** rates to −1.1 at −8 points, which is absurd for blindness. It sits
  at −2.0. What is wrong is the −8 price, and repricing a tag is a `TAGS.md`
  §4a call rather than this ladder's.
- **Old** went the other way, −0.5 → −0.7. It was the one bought drawback
  already *under* the rate, and leaving it would have left Old and Frail four
  points apart at the same price.

Health tags are mostly **not** priced this way, because almost all of them cost
0 — a wound is not bought. Those are priced off **each other**: the ladder from
Bruised (−0.3) to Arterial Bleed (−2) has to read as one ladder. It ran −0.5 to
−3 until 2026-09-10 and was compressed one notch, so that two mortal wounds
still floor a character but one no longer does it alone.

**The smallest step is 0.1 tiers**, and that is what makes the small traits
worth authoring at all. Steady costs 1 point and would round to nothing on a
whole-tier scale; at +0.1 it is honest about being slight and it still
*composes* — Steady, Eagle Eyes and Strong together come to a tier and a
tenth on an archer nobody would call a combat build.

Three prices are worth a second look rather than being buried, and each is one
number in one table:

- **Giant at +2** puts an untrained behemoth at Capable, above a Trained
  fighter holding nothing. Price-consistent (14 pts is two rungs) and
  flavour-consistent ("you could easily crush anyone"), but it is the value
  most likely to want tuning.
- **Ambidextrous costs 2 points** and cancels a whole maiming. Very cheap
  insurance. Repricing the tag is a `TAGS.md` §4a call, so this prices the
  effect and leaves the cost alone.
- **Brave already does two jobs** — `db/lib/mood.js` halves every mood swing it
  takes, `db/lib/torture.js` raises its torture threshold — and because mood
  feeds the Gambit die it already pays off in a fight indirectly. +0.3 is a
  third job priced modestly, not new ground — it was +0.5 until 2026-09-16,
  when every `tree: both` trait that was not really about fighting came down.

## 4. Authoring

One nullable column, `Tag.fighting`, normalised and validated by
`db/lib/tagShapes.js` the way `laborBonus` and `placement` already are.

```yaml
  melee-expert:                       # Tier — Basic is rung 1
    fighting: { tree: melee, rung: 4 }

  broadsword:                         # Items — a weapon declaring itself
    fighting: { tiers: 0.4, weaponClass: sword }

  melee-swords:                       # Items — a skill keyed to a class
    fighting: { tree: melee, tiers: 2, when: { weaponClass: [sword] } }

  strong:                             # Modifiers — and this is why decimals
    fighting: { tree: both, tiers: 0.5 }

  melee-flamboyant:                   # Modifiers — conditional on what you wear
    fighting: { tree: melee, tiers: 2, when: { unarmoured: [BODY] } }

  ambidextrous:                       # Modifiers — cancels, never counterweights
    fighting: { cancels: [missing-arm, missing-fingers, mangled-hand] }

  apex-form:                          # A floor, not a bonus
    fighting: { tree: both, floor: legendary }

  bound:                              # A cap
    fighting: { tree: both, cap: pitiful }

  melee-duelist:                      # Situational — never summed
    fighting: { tree: melee, tiers: 2, situational: true }

  camouflage:                         # Situational with no number at all
    fighting: { situational: true }
```

`rung:` is a position, not a score — `fightingSkill.js` owns the `15 + 10 ×
rung` arithmetic, so re-tuning the ladder is one constant rather than ten YAML
edits.

### `when:` is an AND

| key | true when |
|---|---|
| `weaponClass: [...]` | an **equipped** weapon is of one of these classes |
| `holds: [...]` | the character holds all of these tags |
| `holdsAny: [...]` | the character holds **at least one** of these tags |
| `equipped: [...]` | all of these are equipped, not merely carried |
| `unarmoured: [SLOT]` | nothing is equipped in that slot |

Every key present must hold, so a bonus needing several things at once is one
entry rather than several that cannot see each other.

`holdsAny:` is the one OR in the table, and it exists for a condition that spans
the rungs of a ladder. Drunken Master is the only user and the reason:

```yaml
drunken-master:
  fighting: { tree: both, tiers: 1.9, when: { holdsAny: [tipsy, wasted, blind-drunk] } }
```

The drinking rungs **replace** each other — a second drink clears `tipsy` and
grants `wasted` — so "drunk at all" can never be written with `holds`, and this
block spent a while keyed to `tipsy` alone, going dead the moment anybody had a
second one.

`equipped:` versus `holds:` is the distinction `armorValue.js` already draws
and enforces — *"A vest in your cart stops nothing"*. A robe you are not
wearing is not a robe, and a sword in a sack is not a sword.

`weaponClass` inside `when:` is deliberately **not** tested as a character-level
condition. It is resolved per weapon, so that "+2 while using swords" attaches
to the sword being used — otherwise holding a sword and a mace would pay both
specialisms at once.

### The eleven weapon classes

`sword · polearm · club · axe · knife · unarmed · bow · crossbow · firearm ·
thrown · exotic`

A weapon's class is also what says **which half of the tree it serves**: bow,
crossbow, firearm and thrown are the ranged half. There is deliberately no slug
list anywhere — that is the mistake `armorValue.js` was written to undo, and
its own comment says why: *"A number on the tag cannot go stale the way a list
in a file did the moment somebody added a helmet to the catalog."*

### The ranged ladder

**Firearms sit above bows, and every firearm above every bow.** A gun is the
newer technology and the catalog says so: the pre-gunpowder half of the ranged
tree caps at 0.5, and the powder half starts at 0.6. Set 2026-09-10.

| Weapon | Class | Tiers |
|---|---|---|
| Kpfw-6 Avtomat | firearm | 1.2 |
| CTT4&3 Rifle | firearm | 1 |
| ML-23 | firearm | 0.8 |
| Sawn-Off Double Barrel | firearm | 0.8 |
| Neoclassic R&W10 | firearm | 0.7 |
| Neoclassic Duelista | firearm | 0.7 |
| Musketoon | firearm | 0.6 |
| Bore Pistol | firearm | 0.6 |
| Crossbow | crossbow | 0.5 |
| Longbow | bow | 0.5 |
| Shortbow | bow | 0.4 |
| Javelin | thrown | 0.4 |
| Bomb | thrown | 0.4 |
| Sling | thrown | 0.3 |

Within the powder half the axis is rate of fire first, power second: full auto,
then semi-automatic rifle, then a magazine pistol and a two-shot shotgun, then
a revolver, then the single-shot black-powder pieces a player can actually
craft. The **Disabler** stays at 0.3 and off this ladder — it is non-lethal and
"only useful against unarmed people", so it is a tool, not a gun. The BB Pistol
(0.1) and the Whip (0.2) are `exotic`, which `fightingSkill.js` does not count
as ranged at all.

### The drinking ladder

Set 2026-09-11. A drink used to cost a whole band — Tipsy was a flat −1 tier,
and a tier is exactly one band wide — which made one beer before a fight a
decision nobody could afford to make lightly. It is a nudge now.

| tag | alone | with Drunken Master |
|---|---|---|
| `tipsy` | −0.5 | **+1.4** |
| `wasted` | −1.2 | **+0.7** |
| `hangover` | −0.5 | — |
| `blind-drunk` | −3 | −1.1 |
| `unconscious` | `cap: pitiful` | — |

Drunken Master is a flat **+1.9** on top of whatever the rung costs, not a
cancellation. That keeps the rungs in order — the second drink is still worse
than the first — while making any of them better than staying dry. Blind Drunk
is the exception on purpose: softened, never repaid. Skill at fighting drunk is
not skill at fighting blind.

Hangover is outside it. The tag is the morning, and Drunken Master is about the
night before.

None of these rungs states its number in its own description any more (§1) —
what a drink costs now depends on who is drinking it.

### What the door refuses

Every one of these is a **silent** no-op at runtime rather than a crash, which
is exactly why `db/lib/syncTags.js` catches them at the door:

- a shift with no `tree` — it lands on neither half
- a `when:` naming a tag that is not in the catalog — it never fires
- a `weaponClass` on something not `equippable` — a weapon nobody can draw
- a `weaponClass` **and** a `tree` — the class already decides the tree, and
  saying it twice invites the two to disagree
- a block with a condition and nothing to apply
- a `tiers:` off the 0.1 grid

## 5. Nobody reads an enemy

**A fighting band is the one number a player must never be able to read off
somebody they might have to fight.** Four things keep that true, and a new
surface has to keep all four:

- The Combat tile draws **only on your own sheet** (`LedgerBand.js` takes
  `isSelf`). There is no other-character sheet today; the gate is there so the
  day one exists it is already shut.
- Every fighting skill in the catalog is `visible: false`, so 🔍 Examine has
  never shown one and must keep not showing one.
- **`web/lib/sheetCards.js#rowValue` must not learn a fighting word.** A tag
  row's right-hand value renders on surfaces a stranger can reach.
- **The bot's inspect embed is deliberately left alone.**
  `bot/src/events/messageReactionAdd.js` prints `formatTagArmor` on every
  visible tag; it does **not** print `formatTagFighting`, and it should not.
  Armour is public by design — you can see what somebody is wearing. Putting a
  number on a stranger's missing arm is a different thing.

**One deliberate exception, and it is one bit.** The Attack button refuses a
target more than two bands above you and says so — *"This opponent is too strong
to attack."* Press it and you have learned that somebody is three or more bands
above you, and nothing else: not their band, not their score, not which half of
the tree it came from, and nothing at all about anybody two bands up or less.
That is the price of the verb existing at all (`ATTACK.md` §3), and it is why
the picker in that dialog lists the people it will refuse rather than filtering
them out — a picker that hid them would answer the same question for free, for
everybody in the room, on every page load.

`formatTagFighting` (`db/lib/formatTagFighting.js`) says what **one tag** does,
not what a person is, and that is why it is safe on a chip: the tags carrying a
real shift are invisible to strangers in the first place.

**GMs see everything**, on the inspector's Sheet tab — and they read the same
tile the player does, not a summary of it. It serves `/gm/turns`,
`/gm/players` and `/gm/oracle` at once, since all three mount the same
inspector, and the Move desk carries a copy. Deciding how a fight goes is the
job the number is withheld from players for.

It was two flat strings for a while — `"Melee: Seasoned | Ranged: Weak — 2
situational"` over `"Melee: Good | Ballistic: Meager"` — which told a GM the
answer and not one word of the working. Finding out *why* meant opening the
Tags list and adding tiers up by hand, which is the exact arithmetic
`fightingSkill.js` exists to have already done.

**The GM's breakdown names the armour; the player's does not.** Armour never
enters the fighting arithmetic (§2), so a line about it inside the band's own
breakdown reads as though it does — which is why the sheet still has none. A
GM is asking the other question, though: not how hard this person hits but
what is turning the blow aside. So the GM surfaces pass `showArmorPieces` and
get a line per dimension naming each worn piece and the word it earns
**alone** — never a share of the combined value, because the stacking is
multiplicative (`armorValue.js#combineArmor`) and there is no honest way to
split it.

## 6. The surfaces

- **`web/app/components/CombatReadout.js`** — THE Combat readout. One
  component, every surface: the player's own sheet, the GM inspector's Sheet
  tab, and the Move desk. It takes held tag rows and derives the rest itself,
  so no surface can arrive at a second opinion about somebody's band — which
  is exactly how the desk's old one-line version drifted.

  **The rows it is handed must carry `equipped`.** Both `fightingSkill` and
  `combineArmor` read a *missing* flag as equipped — deliberate latitude, so a
  bare `Tag[]` still resolves — so a caller that drops the column does not
  fail, it silently counts every sword in a sack and every breastplate in a
  cart. `web/lib/moveRows.js` did exactly that until the Move desk started
  drawing this.

  The swap-in-place behaviour it wears is `web/app/components/DetailTile.js`,
  lifted out of `LedgerBand.js` for the same reason: a second hand-rolled
  hover panel on the desk would have drifted from this one immediately.
- **`web/app/components/LedgerBand.js`** — where the player meets it, in the
  **band row** beside This turn and Turn Effects rather than in the tile row. That
  row's `max-width` fits exactly five tiles and a sixth needs 856px; putting
  Combat there broke a line that had never wrapped.

  Resting, it is **a row per dimension** — Melee and Ranged, each with its own
  band and its own armour. It was two unlabelled *pairs* first ("Pitiful ·
  Pitiful" over "⛊ None · None") and nobody could read the second half of
  either: one shield in front of two words says nothing about which word it
  belongs to. Turning it ninety degrees answers both at once.

  One honest approximation is baked in: the Ranged row pairs ranged **skill**
  with **ballistic** armour, and those are not quite the same axis — ballistic
  is what guns roll against, while ranged skill covers bows too. Bascinet's
  call, made knowingly, on the grounds that two labelled lines roughly right
  beat four values nobody can attribute at all.

  Hover, focus or click and it **swaps its own face** for the breakdown: MELEE
  and RANGED as full-width stacked rows. Sized by the resting face, so opening
  it moves nothing. **Not a tooltip** — `SHEET.md` §3 is the rule for that
  surface, and swapping in place is what keeps it.
- **`web/app/components/InspectorColumn.js`** — the GM's copy, under the Sheet
  tab's facts, with the armour pieces.
- **`web/app/(desk)/gm/turns/MoveDesk.js`** — the same tile in the arbitration
  panel's header. How hard does this person hit and what happens when they are
  hit are the two questions a ruling opens with, and answering them used to
  mean leaving the Move for the right-hand rail.
- **`web/app/components/TagDetails.js`** — one tag's own "In a fight" line.

**A maiming costs more than tiers.** Missing Arm, Mangled Hand and Missing
Fingers also take hand slots away (`Tag.handsLost`, `TAGS.md`), so a one-armed
character fights worse *and* has fewer hands to fight with. The two are priced
together and read separately: `fightingSkill.js` never looks at `handsLost`,
and `equipSlots.js` never looks at `fighting`. Ambidextrous cancels the tier
penalty and not the slot — coping with one hand is not having two.
- **`web/app/globals.css`** — the eight band colours, mixed from `--danger`,
  `--muted` and `--positive` with `color-mix(in oklab, …)` rather than written
  as hex, so the ramp follows every theme. `npm run audit:contrast` reproduces
  the mix and gates all eight; **a band added to `fightingSkill.js` without a
  row in `globals.css` and in `audit-contrast.js` renders unstyled and
  unaudited.**

**Legendary is the one band that looks different rather than just greener** —
it takes `--font-display`. Practically nobody reaches it, and it should read as
an event when somebody does.

## 7. What is deliberately not here

- **No column on `Character`.** The band is derived from tags on every read,
  the way `combineArmor` and `gambitModifierTotal` already are. Cheap, and it
  cannot go stale.
- **No `fighting` field on the GM tag form** (`/gm/dev/tags`). That form takes
  scalars; `laborBonus` and `placement` are Json blocks and are YAML-only for
  the same reason, and a JSON textarea in a modal would be worse than the gap.
  A GM edit through the form leaves the column untouched, since the write names
  its fields.
- **No number, anywhere, to anybody.** The band is a word — the posture
  `Tag.meleeArmor`'s comment sets for armour and `laborYield.js#qualityWord`
  sets for Laboring. The breakdown names contributors in tiers so a GM can
  follow the arithmetic; nothing prints a total.
- **Beguiling cannot be held by this model, and that is correct.** It reads
  *"people struggle to raise a hand against you, having their fighting skill
  counts as 1 tier lower or 2 tiers lower if you are wearing a human face"* —
  it modifies **whoever is fighting you**, and a band computed from one
  character's own tags can never know who that is. It rides as a `note:` on its
  holder, where the GM adjudicating the fight will see it. Making it a real
  modifier would mean resolving fights in code, which this system does not do.


## Second Wind

An ordinary 6-point tag (**not** a mastery, despite reading like one): a
**wound's** penalty stops counting toward the rating.

It works through `contextOf`'s new `secondWind` flag and reuses the branch in
`modifiers()` that already exists for a cancelled maiming — the contributor is
pushed at **`points: 0` with a `cancelledBy` label, not dropped**, so a player
wondering why their broken arm costs nothing can read the answer instead of
assuming the system lost it.

Three things it deliberately does **not** do:

- **It never lifts a band CAP.** Dying, Paralyzed and Seizure keep
  `cap: pitiful`. Those take you *out* of a fight rather than making you worse
  at one, which is exactly what the cap mechanism is for (§2).
- **It only waives penalties.** A Health tag with positive `points` keeps
  helping.
- **It is WOUNDS only** — the three groups in `WOUND_TAG_GROUPS`
  (`db/lib/constants.js`): `health-wounds`, `health-maiming`,
  `health-infection`. 33 tags, against 30 Health tags that still cost you:
  every illness, Blind, Concussed, Envenomated, Choking, and the aches. It
  waived the whole Health category for a day, which at 6 points bought off
  sixty-odd stacking penalties on a tag buyable at creation. A cold is not a
  wound, and neither is blindness.
- **A Status penalty** — Bound, a hangover, Wasted — is untouched.

`FIGHTING_TAG_FIELDS` gained `category: true` for this. The group slug it also
needs is deliberately **not** in that object: every caller spreads it into a
wider select that already asks for `group` with more fields, and a narrower
`group` spread in afterwards would silently strip the colour off every chip in
the app. So the contract is that a caller resolving a whole character selects
`group: { select: { slug: true } }` itself — both do today. A row arriving
without its group reads as not-a-wound, which fails **safe**: the penalty still
counts.
