# Mood

The dial under every character's nerves, and the one word it shows through.
Read this before touching `db/lib/mood.js`, `db/lib/moodPass.js`, the Mood box
on the sheet, the phobias, Brave / Rough Camper / Outsider / Spelunker / Pale,
`GameConfig.moodIntensity`, or anything that should frighten, hurt, feed or
cheer a character.

It was the **fear dial** until 2026-09-09: 0–100 with the sign the other way up,
projected onto five status tags (`uncomfortable` … `panic`) with a DM on every
band change. Three things were wrong with that. It only went one way, so a
drink or a haven bottomed out at "no tag" and comfort was worth nothing to
somebody already calm. It shouted — every band change was a DM, which buried
the two bands that cost dice. And the band was a *tag*, five catalog rows whose
only job was to render a number as a word, which meant a GM hand-grant could
fight the dial for the same `@@unique([characterId, tagId])` row.

The fear dial had itself replaced two older things on 2026-09-06: the phobia
rule table (`db/lib/phobias.js`) and the Nobility "Disappointed" track. Both
are still gone; their jobs are two rows in the tables below.

## 1. The dial

`Character.mood` is a float, **+82 down to −100**, that no player ever sees as
a number. It is shown and edited on the Dev Panel's Identity tab (clamped on
save, `web/lib/characterWrite.js`). Everything else that moves it goes through
`db/lib/mood.js`.

What a player sees is **one word**, in the Mood box on their sheet (§4), read
off the band the dial sits in. The bands are 18 wide and symmetric about Fine
— all but Panicking, which is the one band with nothing facing it — and the
boundary belongs to the band further from Fine on both sides, so −10 is
Uncomfortable, +10 is Content, −82 is Panicking, +64 is Ecstatic:

| Mood | Word | Tone | Dice |
|---|---|---|---|
| +64 … +82 | Ecstatic | good | +1 to every Gambit |
| +46 … +64 | Happy | good | |
| +28 … +46 | Pleased | good | |
| +10 … +28 | Content | good | |
| −10 … +10 | **Fine** | muted | |
| −10 … −28 | Uncomfortable | warn | |
| −28 … −46 | Stressed | warn | |
| −46 … −64 | Anxious | warn | |
| −64 … −82 | Afraid | bad | −1 to every Gambit |
| −82 … −100 | Panicking | bad | −2 to every Gambit |

`bandOf` never returns null: a mood of 0 is **Fine**, which is a word like any
other. The **middle six bands are flavour** — Content, Pleased and Happy roll
what Fine rolls. The three at the ends carry their modifier on the band row
itself, which is what `db/lib/gambitModifier.js` reads; a mood is one number,
so it lands in exactly one band and the three can never sum.

**Ecstatic was added on 2026-09-10**, and it is the first thing on the good half
of the dial ever worth a die. It mirrors Afraid exactly — same 18-point width,
same distance from Fine, +1 against its −1 — which is why the ceiling moved from
+64 to +82 to make room: at +64 the dial clamped *inside* Happy, so the comfort
half had nowhere left to go and a character who drank, ate well and slept in the
Keep every night rolled what somebody at Fine rolled. Two consequences worth
knowing. Hunger is no longer the only contributor and no longer the only
direction, so a Gambit modifier can now be **positive**, and one good night
cancels a character's first hungry turn outright. And Panicking still has no
twin: nothing on the dial is worth +2.

**A player is DM'd only when they reach a band that moves the die** — Afraid,
Panicking or Ecstatic — and the line is plain: `You are now Afraid.` The rule is
the dice, not the direction: a band worth a line is one that changes what you
roll, which is why the good end earned one the day it earned a modifier. Nothing
is said for the other six bands, and nothing is said on the way back out —
climbing out of Afraid, or sliding out of Ecstatic, is the player's own business,
and the box on their sheet already says so. `moodBandDm` is the whole rule, and
falling out of Ecstatic needed no code of its own: Happy is not a key, so the
existing "only on the way in" clause already covers it. Hooks inside a transaction hand the DM to `setMoodDmSender`'s
registered sender (registered once in `db/index.js` beside the client), which
fires a moment and a half after the call — after the surrounding write has, in
practice, committed. That is a delay, not a commit signal: a transaction that
rolls back after moving the dial still sends its line. Accepted, because every
such transaction is a short request action whose remaining statements are an
audit row. The turn passes pass `notify: false` and carry their DMs back for
the thunk instead.

## 2. The coefficient

`GameConfig.moodIntensity` (k, default 1, live on `/gm/dev` under *Mood*) is
the one knob. Every **harm** is multiplied by k; every **relief** and the
nightly drift are divided by k. Higher is a harsher world that heals slower.
`0` is the off switch: everything resolves to 0 and the mood pass sets every
dial to Fine at the next close.

## 3. What sinks a mood

All base values, before k and before the multipliers in §6. Harm is **negative**
in `EVENTS`, so most callers name only the kind. `kind` is what the multipliers
key on.

| Event | kind | Base | Where |
|---|---|---|---|
| Arrive at a WILDERNESS Location | WILDERNESS | −2 | `applyArrivalMood`, from `locationMove.js` — **capped, below** |
| Arrive at a CAVE Location | CAVE | −3 | same, and capped with it |
| End the turn in the WILDERNESS | WILDERNESS | −10 | mood pass |
| End the turn in a CAVE | CAVE | −14 | mood pass |
| A new wound tag lands (`health-wounds`, `health-maiming`, `health-infection`) | WOUND | by rung, §5 | `applyWoundMood`, four writers |
| `dying` granted, by any path | DYING | −40 | `applyWoundMood` |
| The Caving Die rolls a 1 | CAVE_TROUBLE | −10 | `cavingPass.js#rollCaving` |
| Bound | BOUND | −15 | `bind.js#applyBind` |
| Still bound at turn end | BOUND | −10 | mood pass |
| Crucified | CRUCIFIED | −80 | `crucifyCharacterRequestImpl` |
| Tortured, broke or held | TORTURED | −40 | `tortureCharacterRequestImpl` (TORTURE.md) |
| A piece cut off you | MUTILATED | −50 | `mutilateRequestImpl` (TORTURE.md §6). A corpse takes no hit — a dead row's dial is read by nobody. |
| Branded | BRANDED | −40 | `brandCharacterRequestImpl` (TORTURE.md §8). Same two ×0 immunities as TORTURED. |
| Someone dies in your Location | DEATH_SEEN | −15 to each witness | `characterDeath.js#applyDeathToRow` |
| An unburied body in your Location at turn end | CORPSE | −5 | mood pass |
| Shot at by a turret and alive, hit or graze, either gun | TURRET | −25 | `turretPass.js#applyTurretShot` |
| `hungerStreak > 0` at turn end | HUNGER | −5 | mood pass |
| A noble with no `dined` marker at turn end | NOBLE_MEAL | −10 | mood pass |
| Looted while alive | ROBBED | −10 | `lootCharacterRequestImpl` |

**Place classes** come from `placeClassOf(location)`, in this precedence:
HAVEN (the `haven` attribute: Inn, Keep, Sanctuary) > INDOORS
(`Location.indoors`, and a `safe` cave Location, which is why Customs and the
Depot are a roof and not the dark) > CAVE (`zone.kind === CAVE_LEVEL`) >
WILDERNESS (the `wilderness` attribute: every Forest, Black Hills and Marshes
Location except `factory`, `farms` and `marshes-village`) > OPEN (everything
else outdoors).
Both attributes live in `db/lib/locationAttributes.js` and print on Examine.

A **first placement** (creation, a spawn, a GM dropping somebody in from
nowhere) has no `from` Location and charges no arrival cost: nobody walked.

Arrival cost **is rationed**: everything a character's own legs take off the
dial in one open turn, together, stops at `MOVE_MOOD_TURN_CAP` (**15**). This
used to be uncapped, on the argument that eight cave Locations should cost
eight times what camping does. What that missed is how cheap a step is next to
the band table. A Refugee whose entire job is cutting Godflesh out of the
Marshes walked five `wilderness` Locations — every godflesh site there is one —
and hit Uncomfortable at exactly −10 on the first afternoon, before a single
turn had closed and therefore before the drift or a roof had ever added
anything back. Pacing two tiles farmed the dial for free.

Three things the ration is careful about:

- It counts the delta that **actually landed**, after the multipliers and after
  `GameConfig.moodIntensity`. Capping the base instead would hand Brave (factor
  `0.5`) twice everyone else's allowance.
- It counts **movement only**. A wound, a death seen, a turret burst and the
  nightly place term all land in full on top of a capped-out day. It also only
  ever bites on the way DOWN — walking into the Cathedral is not movement the
  cap has an opinion about.
- It keys off `term.move`, **not** off `kind`. `arrivalTermFor` and
  `placeTermFor` return the same `WILDERNESS` / `CAVE` kinds, because kind is
  what the multipliers read — a cave is a cave whether you walked in or slept
  there. Only the flag separates a step from a night.

The running total lives in `Character.moveMoodTurnId` / `moveMoodUsed` as a
positive magnitude, the same claim-token shape as `zoneMovesTurnId` /
`zoneMovesUsed` and written with the same guarded `updateMany`, so two arrivals
in one tick cannot both spend the same remainder. Between turns there is no
turn to ration against, so a move charges in full.

## 4. The Mood box

The word lives in its own tile on `/character`, between **Carrying** and
**Gambit die** (`web/app/components/LedgerBand.js`, `SHEET.md` §2). It is one
of the tiles with something to say, so it opens a line under the row of tiles —
**on hover as well as on click**, because that is what Bascinet asked for and
because a readout this long belongs on the page rather than in a floating box
(`SHEET.md` §2).
What it says is Bascinet's own wording, verbatim (`MOOD_DETAIL`):

> Certain things, like spending time in the wilderness without the Rough Camper
> trait or receiving wounds harm your mood. Other things, like listening to
> music, fulfilling desires, or eating meals boost your mood. Your Mood impacts
> your Gambit rolls.

The word is **coloured by tone, not by a token picked at the call site** — the
rule `web/app/components/StatusPill.js` sets. `MOOD_BANDS` carries a `tone` per
band and `.ledger-tile-value[data-tone=…]` in `globals.css` decides what that
looks like: `muted` for Fine (grey), `warn` through the middle three, `bad`
(`--danger`, full red) for Afraid and Panicking, `good` for the four above
Fine. The four tokens are the ones `.status-pill` already uses, so
`npm run audit:contrast --workspace=web` already covers them. The tile also
drops `--font-mono`, because a word is not data.

`web/app/(app)/character/page.js` hands the raw number to the sheet — it has
to, since both the box's word and the Gambit tile's modifier are computed
client-side — but nothing renders the figure. Only `bandOf()`'s label.

## 5. Wounds read the cure ladder

A wound's rung on the cure ladder (`TAGS.md` §5c) decides how much it costs,
read off its requirement block by `woundRungOf`. `woundMoodFor` returns it
**signed**:

| Rung | Derivation | Mood |
|---|---|---|
| 0 | no requirement block at all | 0 |
| ½ | 0 ⬢ (minor-bleeding, dislocated-shoulder) | −4 |
| 1 | 1 ⬢ | −8 |
| 2 | 2 ⬢, 1/4 Move (burned, frostbite, choking...) or a legacy/GM-authored 0-turn 2 ⬢ wound | −15 |
| 3 | 2 ⬢, 1/3 Move (deep-wound, broken-bone...) | −30 |
| 3½ | 3 ⬢ (severe-bleeding, arterial-bleed, parasites) | −35 |
| 4 | 4–5 ⬢ | −40 |
| 5 | 6–7 ⬢ | −45 |
| 6 | 8+ ⬢ (14 ⬢ today), no Gambit | −55 |
| 7 | `requirementGambit` (14 ⬢ today) | −65 |

Rung 2 and rung 3 now share the same ⬢ (2) and the same `requirementTurns`
(both bill a fraction of a Move, not a flat turn any more) — `woundRungOf`
tells them apart by `requirementPerTurn` instead: 4 (a 1/4 Move, the Simple
rung) reads as rung 2, anything else nonzero (a 1/3 Move, the Moderately
Severe rung) reads as rung 3.

Illness, mind, minor and recovery tags cost nothing — a cold is not a wound. A
tier-0 wound (no block) is real, untreatable and too small to matter. So the
ladder is now read three ways — the bill, the Heal picker, and the mood — and a
rung priced carelessly is wrong three ways.

**Four writers create wound rows, and all four call `applyWoundMood`:**
`tagWrites.js#addToStack` and `#grantTagSlugs` (their `!existing` branches only:
a stack going up or an already-held tag is not a new wound), the turret's own
write in `turretPass.js#applyTurretShot`, the untreated-wound chain's
`createMany` in `tagExpiryPass.js` (which first works out which rows will
actually land past `skipDuplicates`). The starvation Dying grant in
`hungerPass.js` is a batch `createMany` too and charges DYING through
`applyMood` directly after it lands. **A new direct `characterTag.create` of a
Health tag must call `applyWoundMood` too.** Character creation's kit grant is
deliberately exempt — starting with Arthritis is a build, not an injury.

Being **healed** of a wound (a routine cure, not a Gambit attempt) gives back
half of what that wound took.

## 6. What lifts a mood

**Two kinds of good thing, and they are not interchangeable. Where a character
merely IS can only mend them; what they DO, eat or want is what lifts them.**
Shelter and the Cathedral carry `capAtFine` on their term: they fill whatever
hole the dial is in, up to Fine, and stop there. A roof is not a joy — it is the
absence of a bad night. Everything else below can carry somebody past 0 and on
up into Content, Pleased, Happy and Ecstatic.

This arrived on 2026-09-10, hours after Ecstatic, and it is the brake that band
needed. A Haven night is +12 against a −4 drift, so a bed used to net +8 a night
forever: about ten nights from Fine to the +82 ceiling and then a standing +1 on
every Gambit, for no upkeep at all. The good half of the dial is meant to cost
something. Now it does — a drink, a feast, music, a fulfilled Desire — and a bed
buys only the right not to be miserable.

Recovery is deliberately untouched. At −50 a Haven night still lands its full
+18; only *crossing* 0 is blocked, so nobody climbs out of a hole any slower than
they did before.

| Event | Base | Where |
|---|---|---|
| End the turn OPEN (a settled place, outdoors) | +5 **to Fine only** | mood pass |
| End the turn INDOORS | +7 **to Fine only** | mood pass |
| End the turn in a HAVEN | +14 **to Fine only** | mood pass |
| Consume anything that lands you tipsy / wasted / unconscious / blind-drunk / high / euphoric | +35 | `consumeTagRequestImpl` |
| Consume `tea`, `maggot-milk`, or anything granting `caffeinated` (Coffee) | +17 | same |
| Eat a **cooked dish** | its own small figure plus its ingredients', §6a | `dishMoodTerms` |
| Consume a treat — `sweets`, `honey`, `honeyed-cakes`, `fish-roe`, `pumpkin` | +9 | same |
| Consume a `cigarette`, a `sky-lantern` or a `firecracker` | +9 | same |
| Consume anything at all that grants `ate-meal` | +6 | same |
| Fulfil a Desire (player claim or GM award) | +12 per point | both award sites |
| A confession the die absolved | +17 | `confessionPass.js` |
| A **Musician's** `/play` with an instrument, once per listener per turn (Musician (Pythagorean): ×4, +48) | +12 to everyone at the Location | `sootheListeners` (`db/lib/instrumentPlay.js`) |
| A **Musician's** `/play` with no instrument — sung — same ration (Musician (Pythagorean): ×4, +36) | +9 to everyone at the Location | `sootheListeners` (`db/lib/instrumentPlay.js`) |
| Walk into the Cathedral, once per turn | +12 **to Fine only** | `applyArrivalMood` |
| Be healed of a wound | +½ what it took | `healCharacterRequestImpl` |

The food rules are keyed on the *status* a consume grants where there is a
distinctive one (so a brew added to the catalog later is soothing the day it
ships) and on the item where there is not; one consume takes the **largest**
single figure, never a sum. That is what keeps Sweets worth 8 rather than 8+5,
Fine Meal 15 rather than 15+5, and Bliss (which lands two statuses) one drink.
An Instant Camera is deliberately worth nothing.

A Fine Meal used to be worth nothing at all, on the argument that it only fed a
noble. It was +15 for a while — "makes an ordinary person happy" is its own
catalog line — and it still feeds the noble besides (§7). Both meals left this
table entirely with the cooking rework; §6a is where they went.

### 6a. A cooked dish

`fine-meal: 15` and `lavish-meal: 30` are **gone** from `CONSUME_RELIEF`. A
dish is a MINTED row (docs/systemdocs/COOKING.md) whose slug is
`custom-craft-…`, so it could never have matched a table keyed by slug — and
a flat figure could not have said what a dish is now for. `ate-meal: 5` stays
and is genuinely the floor under every meal.

`dishMoodTerms(mealMood, ingredientMoods)` prices one instead, and differs
from `consumeReliefFor` in three ways that are the whole reason it is a
separate function:

- It **sums**. A drink is one drink however many statuses it lands, but two
  delicacies in a Lavish Meal are worth both — otherwise the second slot means
  nothing.
- It can be **negative**. A dish made of feces is the worst thing in the game
  and has to be able to say so.
- It returns the halves as **two terms, never netted**: `MEAL` for the
  positive, `DISGUST` for the negative. Only harm is scaled, so netting +45 of
  saffron against −55 of feces first would charge a scaled −10 instead of an
  unscaled +45 and an unscaled −55. They are two things that happened at one
  meal.

The recipe's own figure is deliberately tiny beside its ingredients' — **5**
for a Fine Meal and **8** for a Lavish, against a range of +45 (saffron) to
−55 (feces).

**`DISGUST` carries `noMultiplier: true`**, the way `DRIFT` does, so nothing
in §7 touches it. Three of those rules apply to `kinds: "*"`, and while "Brave
halves your disgust at eating a liver" is arguable, "the Rite of Rage makes
feces free" and "holding the right sword makes you immune to disgust" are not.
Revulsion at what you just swallowed is not a fright.

**Eating is not rationed, and that is deliberate.** `MOVE_MOOD_TURN_CAP`
counts only terms flagged `move: true`, so three bad meals in one turn land in
full (clamped at `MOOD_MIN`). The ingredients are the ration: you have to
*find* three lots of feces, and each dish costs a fraction of a cooking
Routine. Don't "fix" this.

**The nightly drift** replaced the old one-way decay. Every mood slides back
toward Fine at every close, from *both* sides, never overshooting 0 — but not at
the same speed. `MOOD_DRIFT_UP` is **4** and `MOOD_DRIFT_DOWN` is **40**: a
fright wears off slowly, a good evening is mostly gone by morning. From the
ceiling that is three nights to Fine against the floor's twenty-five.

The asymmetry is the point. Fear and grief are the half of the dial a character
has to live with; delight is the half they have to keep earning. A drink, a
kiss or a fulfilled Desire is worth having on the day and not for the week,
which is also what keeps Ecstatic's `+1` Gambit a thing somebody arranges rather
than a thing they hold. It carries `noMultiplier: true`, so no tag scales it
either way — Brave halving a happy person's decline would be nonsense, and so
would it sparing them the climb.

**How a capped term settles.** `restorativeRoom(before, otherDelta)` is the whole
rule: a `capAtFine` term contributes at most the room left between the dial and
0, measured **after** everything else the same write does. So a character at −5
who goes hungry (−5) and sleeps in a Haven wakes at exactly **0** — the bed
absorbs the hunger — while a character at +40 in that same Haven only drifts down
to +36, because there is no room at all. Measuring against the other terms rather
than against `before` alone is what makes it order-independent, and that matters:
the nightly pass hands place, drift, HUNGER, BOUND, CORPSE and NOBLE_MEAL to
**one** `applyMoodTerms` call, so a rule that read term order would be deciding
by array position. What landed comes back as `restorativeApplied`, beside
`moveApplied` — the answer to "why didn't my Haven night help".

One known wart: `applyArrivalMood` writes the `mood_cathedral` audit row before
the relief is computed, so somebody already above Fine spends their once-a-turn
visit for nothing. Left alone — they went, they were already at peace — but
written down here rather than left to be discovered.

The two once-a-turn rations are `AuditLog` rows with `turnId` set
(`mood_cathedral`, `mood_soothed_play` — `REQUESTS.md` §1a), both rare enough
not to drown `/gm/audit`. Only one place term applies per night, the best one.
Relief is never multiplied by a tag.

## 7. Multipliers

Held tags scale **harm** by its kind; the factors multiply, and a 0 wins:

| Tag | Kinds | Factor |
|---|---|---|
| `brave` (5 pt, was 4) | everything | ×0.5 |
| `rough-camper` (2 pt) | WILDERNESS, CAVE | ×0.5 |
| `outsider` (1 pt, requires Rough Camper) | WILDERNESS | ×0 |
| `spelunker` (1 pt, requires Rough Camper) | CAVE | ×0 |
| `pale` (the Migrant's) | CAVE | ×0.5 |
| `hemophobia` (−4) | WOUND | ×2 |
| `agoraphobia` (−4) | WILDERNESS | ×2 |
| `claustrophobia` (−3) | CAVE | ×2 |
| `teratophobia` (−2) | CAVE_TROUBLE | ×3 |
| `pyrophobia` (−2) | WOUND, only `burned` / `severe-burns` | ×3 |
| `pain-immunity` (status) | TORTURED, BRANDED | ×0 |
| `opium-high` (status) | TORTURED, BRANDED | ×0 |
| `rage` (the Rite of Rage, THANATI.md §4) | everything | ×0 |
| `blessed` (status, 3t — a `chrism`'s anointing) | everything | ×0.5 |
| `heartforged-blade` (**while equipped** — the first equipped-conditional rule; a caller that can't say what's equipped skips it, failing safe) | everything | ×0 |

Brave × Rough Camper × Agoraphobia on a wilderness night is ×0.5; Pale ×
Claustrophobia in the caves is ×1, which is funny and correct. Acrophobia is
gone (nothing in the game is high enough), and the phobias' old "may make you
Afraid… may cause Panic" sentences went with it. The cancel tag is named
Spelunker because `caving` is already a Skills tag and role kits resolve tags
by display name.

**Who starts with what** (`docs/roles.yaml`, `db/lib/threats.js`): Rough Camper
and Outsider on both Brigands and the Tribune; those two plus Brave on the
Tribunal Ordinator; Rough Camper on the Fisherman; Rough Camper and Spelunker
on the Mercenary; the `commoner-hunter` kit unpacks Rough Camper; the Demoness
seat assigns Rough Camper, the Judge assigns Rough Camper, Outsider and Brave.

## 8. Nobles

`nobility` no longer grants Disappointed. A noble who ends the turn without
having eaten a fine or lavish meal takes −10 (NOBLE_MEAL, so Brave halves it);
Hungerless and Dying nobles are exempt. "Ate one this turn" is the hidden
`dined` status tag that `fine-meal` and `lavish-meal` consume into beside
`ate-meal`. It has **no `durationTurns`** — a 1-turn grant would be swept at
position 10 of `TURN_PASSES`, nine passes before the mood pass reads it — so
the mood pass deletes it itself, exactly as the hunger pass eats `ate-meal`.
That simile still holds: `ate-meal` carries no duration either, and the hunger
pass deletes it by hand for the same reason. What it no longer implies is a
shared bill. **`dined` and `ate-meal` are two separate markers answering two
separate questions** — `ate-meal` is the whole of whether the hunger pass
counts you fed (`TURN-ENGINE.md` §5, and since 9/2026 no ⬢ changes hands over
it), `dined` is only whether a noble ate *well*. Nothing here changed with the
hunger rework, and the −10 below is still a mood harm rather than a charge.
The marker is hidden and the sheet shows no Dinner row for it — the old
Disappointed tracker went with the track, on Bascinet's call. The Merchant now
starts with Nobility too, and therefore with its 1-point Desire lock.
`Character.missedMealStreak` is an orphan column: kept, never read.

## 9. The turn pass

`db/lib/moodPass.js`, `"mood"` in `TURN_PASSES`, in the slot the phobia pass
held: **after `hunger`** (it reads the final `hungerStreak`), **after `carry`**
(the final sheet) and **before `corpseFollow`**. It used to matter that it also
ran before `travelArrival`, so a traveller paid the night where they set out
from; travel lands at once now (`MAP.md` §3), so everybody simply pays the
night for wherever they ended the day standing — which is also what auto-labor
and the turrets now read.

Per ALIVE character it gathers the terms — place, drift, HUNGER, BOUND, CORPSE,
NOBLE_MEAL — and applies them in one write through `applyMoodTerms`, its own
transaction per character so one bad row cannot roll back a hundred good ones,
and hands `applyMoodTerms` the row it already loaded (the multiplier slugs and
this pass's own gates in one filtered read) rather than letting it read the
sheet again. Somebody already at Fine, in a place that neither lifts nor
lowers, is skipped without a write — and a `capAtFine` term does not count as
lifting for that test, because at 0 there is no hole for it to fill. Without
that exemption every character standing at Fine under a roof would open a
transaction to compute a delta of zero, which on a full roster is most of them. The `dined` markers are eaten in one
`deleteMany` **after** the loop, not per character: a pass that dies half-way
is re-run from the top, and a per-character delete would have charged the
nobles it had already reached for a dinner they ate. A replay is therefore at
worst a repeated night, never a wrong direction.
Corpse Locations are one query for the whole pass (`RoomTag` plus carried
`CharacterTag` on an unburied `corpseOf`, the death-smell shape). One
`AuditLog` row, `mood_resolved`, with the summary; the DMs ride back on `dms`
and go out on the `tagExpiryDms` channel in `db/index.js`, since "your sheet
changed" is what they are. Returns an object, never null.

## 10. The tuning

The designer's checks, all asserted in `db/test/mood.test.js`:

- Seven wilderness moves are −14: **Uncomfortable** from the walk alone. A
  wilderness night on top (−10 + 4) lands at −20, still Uncomfortable.
- A moderately severe wound (rung 3, −30) on top of that is −50: **Anxious**.
- At −20, two nights indoors (+7 +4 each) clear the dial; one night in a Haven
  reaches Fine on its own. Both run through the cap in the test rather than
  adding the constants up, because a plain sum would agree no matter what the
  cap did.
- **A bed cannot carry anybody to Ecstatic.** Thirty straight Haven nights from
  Fine leave the dial at 0, not at +82. That was the one real hole Ecstatic
  opened — +12 a night against a −4 drift, netting +8 forever — and §6's
  `capAtFine` rule is what closed it. The test walks all thirty nights.
- A Haven night from −50 still lands its full +18. The cap must never be
  mistakable for slower recovery; it only ever blocks *crossing* 0.

The dial is clamped in the database (`LEAST/GREATEST` in the UPDATE), so two
hooks in the same tick cannot race a stale read past either end.

## 11. Where the code lives

- `db/lib/mood.js` — the tables (`EVENTS`, one signed table: harm negative,
  relief positive, so most callers name only the kind; `MOOD_BANDS`;
  `PLACE_TERMS`; `MOOD_DRIFT_UP` / `MOOD_DRIFT_DOWN`;
  `DESIRE_RELIEF_PER_POINT`; the consume relief
  map), the pure functions (`bandOf`, `placeClassOf`, `placeTermFor`,
  `driftTermFor`, `restorativeRoom`, `woundRungOf`, `woundMoodFor`, `multiplierFor`,
  `resolveDelta`, `moodBandDm`, `clampMood`), and the Prisma surface
  (`applyMood`, `applyMoodTerms`, `applyWoundMood`, `applyArrivalMood`,
  `setMood`, `consumeReliefFor`, `setMoodDmSender`, `loadIntensity`). Off the
  barrel; require by subpath.
- `db/lib/moodPass.js` — the nightly settle.
- `db/lib/gambitModifier.js` — Ecstatic +1, Afraid −1, Panicking −2, read off
  the band.
- `db/lib/torture.js` — the TORTURED hit's caller side (TORTURE.md).
- `db/lib/locationAttributes.js` — `wilderness`, `haven`.
- `db/lib/gameConfigFields.js` — `moodIntensity`.
- `web/app/components/LedgerBand.js` — the Mood box (§4).
- `db/test/mood.test.js` and `db/test/gambitModifier.test.js` — the pure half.
- Hooks: `locationMove.js`, `tagWrites.js`, `turretPass.js`, `tagExpiryPass.js`,
  `hungerPass.js`, `cavingPass.js`, `bind.js`, `characterDeath.js`,
  `confessionPass.js`, `riteEffects.js` (the Rite of Panic's `setMood`),
  `web/app/(app)/character/requestActions.js` (consume, heal, loot, crucify,
  torture, brand, desire), `web/app/(app)/gm/dev/characters/[characterId]/actions.js`
  (GM desire award, the dial edit), `bot/src/events/interactionCreate.js`
  (`/play`).

## 12. What the rework left behind

- The five band tags are gone from `docs/tags.yaml`. Rows still on live sheets
  come off with `npm run db:prune-tags -- --apply` — destructive, and its own
  decision.
- `TagSource.CONDITION` is an orphan enum value. Nothing writes it; it stays,
  because this schema drops nothing.
- `settleFearTag` is gone entirely. So are `UNCOMFORTABLE_SLUG` … `PANIC_SLUG`
  in `db/lib/constants.js`.


## The two mastery tags that own the dial

Both are `mastery` tags (`TAGS.md` §4a), and they `conflictsWith` each other —
one says every blow lifts you, the other says nothing moves you at all.

**Amor Fati** is the one rule in this file that is deliberately **not** a
multiplier, and it has to stay that way.

It reads like a factor of `-0.5`, and it was one for a day. But `multiplierFor`
MULTIPLIES every applicable rule together, so a negative factor composed with
the vulnerability rows and **inverted** them:

| held | was | should be |
|---|---|---|
| Amor Fati alone, cave trouble | +5 | +5 |
| Amor Fati **+ Teratophobia** (×3) | **+15** | +5 |
| Amor Fati **+ Hemophobia** (×2), a wound | **+30** | +15 |
| Amor Fati **+ Brave** (×0.5), a wound | **+7.5** | +15 |

The phobias *refund* points, so stacking one was strictly better **and**
strictly cheaper, while Brave — which costs points — punished you. Backwards in
both directions.

So for a kind it owns, Amor Fati **replaces** the multiplier chain rather than
joining it (`amorFatiHarm`, applied in `resolveDelta`): the gift is half of what
the event costs *anybody*, and what you happen to fear does not change it.
Reordering alone would not have fixed this — multiplication commutes, so
`base × phobia × -0.5` is the same number whichever way round you write it.
What had to go was the phobia's involvement at all.

The kinds are split on purpose. Misfortune that *happens* to you — a shock with
an author and a moment — pays half back: `WOUND`, `DYING`, `CRUCIFIED`,
`TORTURED`, `MUTILATED`, `BRANDED`, `BOUND`, `ROBBED`, `TURRET`, `CAVE_TROUBLE`,
`DEATH_SEEN`. The weather does not: `WILDERNESS`, `CAVE`, `HUNGER`, `CORPSE`,
`NOBLE_MEAL` simply stop landing rather than becoming a pleasure, because nobody
would call an ever-present cost an incident. `DRIFT` needs no entry (it carries
`noMultiplier`), `PLACE` harm is already capped at Fine, and relief is untouched
throughout — this is not a damper on good things.

**Imperturbable** rides on `intensity`, **not** on a multiplier row, and the
reason is the same asymmetry: a multiplier is only ever read for `base < 0`, so
a row there would have left the holder free to climb to Ecstatic while immune
to everything below Fine. `k === 0` is a case `resolveDelta` already handled
(it returns 0 for either sign), so the tag adds no new arithmetic. It also
costs the Ecstatic Gambit bonus, which is the price of never taking the Afraid
one.

`applyMoodTerms` additionally **pins the stored value to 0** for a holder, so
"always at Fine" is true of a mood the character already had when they bought
the tag and not only of the events that stop landing afterwards. The nightly
pass reaches every living character, so it settles within a turn at the
outside.

One trap, and it is why BOTH `imperturbable` and `amor-fati` sit in
`MULTIPLIER_SLUGS` despite neither being a multiplier any more: `db/lib/moodPass.js` **filters its tag query** to that list.
A slug missing from it is not selected, and the whole night is then computed as
though the holder were ordinary. Anything the dial reads belongs on that list,
multiplier or not.

Imperturbable also refuses **Torture** outright
(`requestActions.js#tortureCharacterRequestImpl`) rather than sitting at an
unreachable threshold — the torturer is told why instead of spending a Move on
a roll that could never land.
