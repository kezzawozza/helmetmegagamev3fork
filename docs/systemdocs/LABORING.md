# Laboring

How a character turns a day into ⬢. Replaces the old flat Labor checkbox: it
is now a kind of Move, it needs a skill, and **where you stand decides what
it pays**.

Read this before touching `db/lib/laborAccess.js`, `db/lib/production.js`,
`db/lib/laborYield.js`, `db/lib/autoLaborPass.js`, the `yield:` blocks in
`docs/zones.yaml`, or any `laborBonus:` in `docs/tags.yaml`.

A resolved Labor also rolls the **labor drop die** — a 1d6 on top of the ⬢,
which can grant a tag or a bonus. That system is its own doc,
[`LABORDROPS.md`](LABORDROPS.md); this page only owns what a Labor is worth,
not what else it might find.

## 1. The shape of it

Three things changed at once, and they only make sense together:

- **There is no Default Move.** `DefaultEffort` is gone. If you file nothing,
  you labor — automatically, if you can.
- **Labor is a third `MoveKind`**, alongside `ROUTINE` and `GAMBIT`. A turn
  buys one of the three, so filing a Routine or a Gambit *costs* you the day's
  labor. There is no checkbox any more.
- **Laboring is a skill, not a floor.** The old `base` tier is deleted, so a
  Laboring tag is what makes a day pay. It is **not** a gate: since 2026-09-10,
  a character holding no Laboring tag — or none that reaches the ground they
  stand on — files a Labor like anybody else and earns **nothing** for it. The
  tier is `unskilled`, the range is a real `0-0`, and every surface prints an
  em dash rather than a range, because there is no range. The day is still
  spent: it steps the fatigue ladder below, and it draws no drop die
  (`LABORDROPS.md`), which stays something a skill earns.

## 2. The tag ladder

All six cost **7** (`TAGS.md` §4a: significant — it reliably changes how a
month goes). Ranges live in `PRODUCTION_RATES` in `db/lib/production.js`,
which is the single source for both the payout and the `{resource:labor:tier}`
bubbles the tag descriptions render through.

| slug | name | range | gate |
|---|---|---|---|
| `laboring-basic` | Laboring (Basic) | 0–2 | — |
| `laboring-skilled` | Laboring (Skilled) | 1–4 | `parentTag: laboring-basic` |
| `laboring-hunting` | Laboring (Hunting) | 0–15 | `requiredTag: laboring-skilled` |
| `laboring-farming` | Laboring (Farming) | 15–21 | `requiredTag: laboring-skilled` |
| `laboring-fishing` | Laboring (Fishing) | 7–13 | `requiredTag: laboring-skilled` |
| `laboring-prospecting` | Laboring (Prospecting) | 2–8 | `requiredTag: laboring-skilled` |

The slugs were `laborer-*` before this rework and are `laboring-*` now, because
`db/lib/syncTags.js` enforces that **a slug is always its name, slugified** — so
anyone reading a slug in code or in a Desire's `requires` knows which tag it is.
Renaming the display name without the slug is a sync error, not a warning. The
old rows are cleared by `db:prune-tags -- --apply`.

The bottom two are general: they pay the same everywhere. The top four are
**side-grades, not rungs**. Holding several is fine and normal, and there is
nothing to switch between — §4 pays the best one you qualify for.

**Prospecting joined 2026-09-09** and pays less ⬢ than the other three
specialisations on purpose — its range is deliberately the thinnest, because
the plan is for a Labor drop (`LABORDROPS.md`) to make up the rest of its
value in items rather than coin once that table is built out. It follows
every other rule on this page exactly like Hunting, Farming and Fishing do —
same tag shape, same `LocationYield` gate, same tools mechanism (§5, unused
by it so far) — there is nothing specialisation-specific left hardcoded to
"three" anywhere in the code this rework touched.

**Basic ignores `GameConfig.productionCoefficient`** (`UNSCALED_TIERS` in
`production.js`). It is the floor of the whole economy, and a GM turning the
dial down to rebalance specialists must not quietly delete subsistence too.
Everything else scales.

The dial ships at **0.93** rather than 1 — laboring was cut about 7% before
launch. Two things that buys less than it looks like: Basic is exempt as above,
and Skilled's 1–4 rounds straight back to 1–4, so a small move on the dial
reaches only the three specialisations. At 0.93 and a location coefficient of
1.0 those become Hunting 0–18, Farming 12–16, Fishing 7–14. Moving the general
tiers at all means editing `PRODUCTION_RATES`, where one whole point is 25%.

**The three specialisations were raised ~8% on 2026-09-06** (Hunting 18 -> 19,
Farming 12–16 -> 13–17, Fishing 7–14 -> 8–15), in `PRODUCTION_RATES` rather
than on the dial, because the dial cannot reach Basic. The two general tiers
did not move and could not: 8% of a 2 or a 4 rounds back to itself, and the
smallest real step on those is 25%.

**Then they were pulled apart, later the same day**: Hunting **-20%**
(0–19 -> 0–15), Fishing **-15%** (8–15 -> 7–13), Farming **+10%**
(13–17 -> 14–19). They had been close enough to a tie that the choice between
them was mostly about which ground you happened to stand on, and the
wilderness paid best for the least settled play. Farming is now the richest
specialisation on the base rates, and the two that need no fields have to earn
it back through a Location's coefficient instead (§3).

Whole numbers do not divide into those percentages cleanly, so the endpoints
are rounded and the averages land at -21.1%, -13.0% and +10.0%. Hunting's
0–16 would have been only -15.8%, which is further from the intent than
overshooting to 0–15. The general tiers are untouched again, for the reason
above.

**Farming was then raised a further 9%** the same day, 14–19 -> **15–21**. The
average goes 16.5 -> 18.0, which is +9.09% — no whole-number pair lands on 9%
exactly, and 15–20 would have been only +6%.

## 3. What a place is worth

Each Location carries up to four `LocationYield` rows, one per `LaborKind`.
**No row means that labor is impossible there** — that is what prints `×`, and
it is why no Location needs a "wilderness" or "water" flag anywhere in the
schema. The row is the gate.

That's also why the Examine readout (§9) only ever names a kind the Location
actually has a row for: a Location with no rows at all prints no labor line,
and one with two of the four prints only those two. A permanent row of `×`
for a kind that can never be worked there was clutter, not information.

`base` is authored in `docs/zones.yaml`; `current` is where the world has
drifted it, and `current` is the only number a payout or the Examine button
ever reads.

```yaml
    forest-west-riverbank:
      name: West Riverbank
      description: >-
        …
      yield: { hunting: 0.8, farming: 0.3 }
```

`db:import-zones` writes these once, for a brand-new Location — it creates
`base` and never touches an existing `LocationYield` row at all (the importer
is additive-only: create if missing, skip and report otherwise). Retuning a
`base` mid-game is a live edit at `/gm/dev/zones` now, not a re-sync; `current`
stays untouched there too, since it's live state a save must not shove back to
the authored value. A kind dropped from the YAML no longer deletes anything —
nothing about the zones master deletes rows any more, so a retired yield is a
row somebody removes from the editor's data by hand if it ever comes up.

`collectYields` in `db/lib/syncZones/parse.js` (shared with `importZones.js`)
refuses a typo'd kind, a value outside 0–2, and an explicit `0` (omit the key
instead) — a silent `hunitng: 0.5` would disable hunting somewhere and the
symptom is nearly invisible in play.

### 3a. The authored table

Anything not listed has no row and cannot be worked. Locations are addressed by
slug — open country carries its zone as a prefix, built places do not
(`docs/zones.yaml`).

**Farming** — Farms 1.0 · Manors 0.6 · `forest-northern-road` /
`forest-south` / `forest-sparse-field` 0.5 · every other Forest place 0.3 ·
Keep 0.2.

**Fishing** — `forest-headwaters` / `forest-creekside` / `forest-northern-road` /
`forest-deep-forest` / `forest-embankment` / `forest-east-river` 0.9 ·
`hills-waterway` 0.8 · `depths-grand-chamber` 0.9 · the five open Marshes 1.0 ·
the marsh Village 1.0.

**Hunting** — Forest 0.5 except `forest-west-riverbank` 0.8 · the five open
Marshes 1.0 · Black Hills 1.0 throughout · the four Caves 0.4 · Depths 0.6
except `depths-obelisk` 1.8.

**Prospecting** — **not just mining.** A stream is panned, a wreck or a ruin
is scavenged, the undergrowth is foraged for mushrooms — whichever of those a
location's own fiction already supports. The four Caves 0.5 · Depths 0.7
except `depths-chasm` 1.4, the one place with a real named vein
(`chasm-ore-vein`, a `docs/zones.yaml` secret room gated on
`prospectors-notes`) · eight of the twelve Forest locations, 0.4–1.0 (joined
2026-09-09, alongside the surface's first rows at all). Three tie for the
best Forest ground, at 1.0: `forest-creekside` (mushroom colonies, old pans
already in the room stash), `forest-east-river` (its own description already
says worked metal washes up and lodges there), and `forest-sparse-field` (an
abandoned prison's worth of scavengeable scrap). The rest are milder —
`forest-headwaters` 0.5 (cold streams), `forest-deep-forest` 0.5 (relics
buried in the undergrowth), `forest-riverbend` 0.5 (an old, collapsed
mineshaft), `forest-west-riverbank` 0.4, `forest-embankment` 0.4.

Eight of the Black Hills' nine locations joined the same day. Three at 1.0:
`hills-underlocks` (a trash heap the local wildlife already picks through —
its own text says "whatever missed morsels have yet to be plundered"),
`hills-north` (an abandoned homestead with a hidden hatch and a basement of
tinctures), `hills-waterway` (the zone's one real river, panned the same way
a Forest stream is). The rest are milder — `hills-gullies` 0.6 (a dry,
ancient riverbed — placer ground even without running water), `hills-cliffs`
0.6 (a cave mouth with an old camp scattered outside it), `hills-shadowed-grove`
0.5, `hills-grand-ravine` 0.5. `hills-mountain` has no yield rows of any kind
(a pass, not worked ground).

`hills-west` — the Forgotten Gallows, a real grave — is the one genuinely
unique spot: 0.8, and the first location with its own dedicated
`laborTypeLocation.prospecting` table (LABORDROPS.md §2b), added
2026-09-09 on Bascinet's call rather than joining the milder-tier crowd
above.

These numbers are a first cut (2026-09-09), not signed off.

The marsh Village fishes at 1.0 and does nothing else; the Godard Factory has
no rows at all and is worked anyway (§3b). The Fortress has neither hunting nor
fishing — the Keep and the Manors farm, and nothing else inside it is worked at
all. Town carries no rows of any kind. Nothing farms or fishes underground.

**The old blanket "nothing can be produced in the depths" is gone.** Hunting
down there is now most of the reason to go.

### 3b. The one place with no rows that can still be worked

A Location carrying the `refinery: true` attribute is worked with **no
`LocationYield` row at all**, and pays in goods rather than ⬢: one Godflesh
becomes eight Squeeze on the Godard Factory floor. `resolveLaborRateFrom`
short-circuits before the candidate loop below and returns `tier: "refining"`
with a real `0-0` expression — real, because `rollResourceRange` pays nothing
on a failed parse and does so silently.

It is the only exception to "the row IS the gate", and it is a second gate
beside the rows rather than a hole in them: everything without the attribute
still needs its row. It still steps the character up the fatigue ladder below.

**It wanted a Laboring tag until 2026-09-10, and that was the bug the fix
above came from.** The skill ladder exists to price ⬢, and a refining shift
pays none — so the gate bought nothing, and meanwhile it stood the Factory's
own people off its floor. Anybody standing there works it now. See
`FACTORY.md` §4.

## 4. Resolving one labor

`resolveLaborRateFrom` in `db/lib/laborAccess.js`, in order:

1. **Gate.** Holding `exhausted` refuses. Holding `tired` does not — see
   "Tired and Exhausted" below.
2. **Build candidates.** The best general tier held (Skilled, else Basic), plus
   one per specialisation held that has a `LocationYield` row here. No general
   tier at all means no candidates and no labor.
3. **Scale.** `productionCoefficient` × the location's `current`, both ends,
   rounded. Basic skips both.
4. **Add tools** for that candidate's kind (§5). Only the best weapon counts;
   everything else sums.
5. **Pick the winner** — highest ceiling, tie-broken on the better floor.
6. **Soft Hands** halves both ends, floor. It lands *after* the tools, so it is
   literally "half of what you make".
7. **Lifeweb failure** (§6).

### Tired and Exhausted

Two Labors before a rest, not one. `db/lib/laborFatigue.js` holds the whole
decision — a first Labor grants `tired`, which blocks nothing; a second one
the following turn, while still `tired`, escalates to `exhausted` instead of
refreshing it, and that's the tag the gate actually reads. `exhausted`
degrades back into `tired` a turn later on its own, through the ordinary
`expiresInto` chain (`TAGS.md` §5c) — no code needed for that half. Rest a
second turn and `tired` clears on its own too, since nothing renewed it,
which is what lets a player pick their own pacing: two Labors and one forced
rest is the minimum cycle, but resting longer is free.

**Only a deliberate act reaches the second rung.** The auto-labor pass stops
at `tired` (§8), so doing nothing can never wear a character out — a hand-filed
Labor, a hard push in travel (`MAP.md` §3) or a bad night is what takes
somebody to `exhausted`. Working yourself into the ground is a choice you make,
not something that happens to you while you're away.

`db/lib/moveEffects.js`'s `exhausted` payout effect is the writer for the
Labor half of the ladder; a bad night's sleep (Guilt Ridden, Insomniac —
`db/lib/dawnAfflictionPass.js`) steps the same ladder for the same reason, so
working two days straight and two bad nights running land in the same place.
The Discord-visible name for the top rung stayed `Exhausted` on purpose — it
was already the established status before this ladder existed, and it also
carries a fight-effectiveness note in its description now, so nightmares
alone reaching it (`tired` twice, with no Labor involved) reads fine
narratively.

**Lazy** doesn't touch the roll itself — it takes a quarter off the value
after the range has already produced a number. `lazyYield()` in
`db/lib/laborAccess.js` floors the rolled value to 75% of what it rolled, and
both places a Labor roll actually happens call it: `db/lib/
autoLaborPass.js` (the automatic payout) and `bot/src/lib/moveConfirm.js`
(the player-filed Labor Move). The *stored* `resourceRollExpression` is cut
the same way, by `lazyExpression()` in the same file, so the printed range on
the sheet and the GM desk is the Lazy range rather than the wider pre-cut
one — otherwise a Lazy character could see a payout below the range it was
told it rolled against.

The returned `expression` is a **machine format** — `"min-max"`, matched by
`db/lib/resourceDelta.js#rollResourceRange` against `/^(\d+)-(\d+)$/`. Never
append anything to it. A failed parse pays the character nothing, silently.
The tool breakdown rides out as separate fields so the DM can name it in a
`-#` subtext line instead.

Picking the best automatically is the point: "I forgot to switch to Fishing" is
not a way to lose a day, and a specialisation that doesn't beat your general
tier never costs you anything.

## 5. Tools

Authored as a `laborBonus:` block on a tag, normalised and validated by
`db/lib/tagShapes.js`, stored as `Tag.laborBonus`:

```yaml
    laborBonus: { kind: hunting, amount: 3, equipped: true, requiresTag: horse }
```

`equipped` defaults **true**. The sync refuses a bonus that requires being
equipped on a tag that isn't `equippable`, and a `requiresTag` naming a tag
that doesn't exist.

| tag | kind | ⬢ | note |
|---|---|---|---|
| Sling | hunting | +1 | equipped |
| Shortbow | hunting | +1 | equipped |
| Longbow | hunting | +1 | equipped |
| Crossbow | hunting | +1 | equipped |
| Trapping Gear | hunting | +1 | equipped; craftable and depot stock |
| Butcher | hunting | +1 | **not** equipped — it's a skill |
| every firearm | hunting | +2 | equipped |
| Pitchfork | farming | +1 | equipped |
| Plow | farming | +3 | not equipped; needs a `horse` |
| Fishing Rod | fishing | +1 | equipped |
| Mining Helmet | prospecting | +1 | equipped (2026-09-10) — Prospecting's first tool; also armor and Caving Rare loot, so it pays three ways at once |
| Prospector's Pick | prospecting | +1 | equipped (2026-09-10) — a dedicated hand tool, craftable, modeled on the Fishing Rod |

**The hunting tools were flattened on 2026-09-06.** Every bow and the Trapping
Gear pay +1, and Butcher pays +1, where the ladder used to run +1 to +3 and
stack to +8. A fully kitted hunter was adding more to the roll than most
Locations were worth, so which weapon you owned decided the day more than where
you stood. A firearm keeps +2 as the one thing that still buys an edge.

**Weapon bonuses do not stack with each other.** You hunt with one weapon in
your hands, so only the best-paying tag in the `items-weapons` group counts —
a Longbow and a Crossbow pay +1, not +2, and the second one is dead weight.
Everything outside that group sums on top of it, so a Longbow, Trapping Gear
and Butcher is +1 +1 +1 = **+3**. Three hands (`db/lib/equipSlots.js`) still
cap how many weapons you can have readied at once.

The group is the whole test, which means a tag's `group:` is now load-bearing
for laboring: move a bow out of `items-weapons` and it silently starts
stacking. The Pitchfork sits in that group too — it pays into farming rather
than hunting, so it competes with no other weapon and the rule never bites it.

**Butcher's bonus narrowed.** It used to be a hardcoded flat +2 on every tier
but farming. It is hunting-only now, it is +1, and it moved out of code into
the YAML.

**A COMPLETE structure pays into labor too, as a synthetic tool nobody
carries.** A structure whose `placement.laborBonus` names a kind (the same
shape as a tag's `laborBonus:` block above) enters everyone standing at its
Location's labor — `db/lib/laborAccess.js#structureTools` — but it is never
equipped and never a weapon, so it sums on top of the best personal weapon
rather than competing with it. **Non-stacking per kind**: two hunting
structures on the same ground pay like the better of the two, not both added
together — a location-wide bonus is a faucet times occupancy, and the ceiling
has to be enforced here rather than hoped about in catalog pricing. `DAMAGED`,
`UNDER_CONSTRUCTION` and wrecked (`RUINED`/`ABANDONED`) structures pay
nothing — the same `COMPLETE`-only reading `db/lib/equipmentReach.js` uses for
Workshop Equipment (`SMITHING.md` §2a), so Damaging one is worth doing. The
payout DM names a paying structure through the same `formatLaborBonusNote`
path as any tool, so a player reads "Fish Weir +2" no differently from
"Fishing Rod +1".

## 6. When the Lifeweb fails

At or below `LIFEWEB_SPUTTER_THRESHOLD` (20, in `db/lib/lifeweb.js` — it moved
there from `db/index.js` so `db/lib/` modules can reach it):

- **Basic yields nothing at all.** Not scaled — stopped. 5% of "you can
  sometimes provide for yourself" is nothing with extra steps.
- Everything else keeps `Math.floor(x * 0.05)`.

In practice that zeroes almost the whole economy. The Farms still pay a
guaranteed 1 ⬢ — farming is the one specialisation whose *minimum* survives the
floor — and the best hunting and fishing spots pay 0–1. Everything else is
nothing. That is the intent: this used to be flavor text on a turn
announcement and nothing else.

## 7. Drift — what the land does on its own

`db/lib/laborYield.js`. A mean-reverting random walk plus jump events, in the
same spirit as a Markov chain.

```
target  = in an event ? eventTarget : base
current = clamp(current + reversion * (target - current) + gaussian(sigma), 0, 2)
```

An event does **not** move `current` — it moves what `current` is pulled
toward. That is what makes a swing arrive over a couple of turns instead of as
a step change, and what makes it decay on its own: clearing `eventTarget` puts
`base` back in the target slot and the same reversion walks it home. There is
no separate recovery path.

| kind | reversion | sigma | daily wobble | event chance | length | magnitude |
|---|---|---|---|---|---|---|
| HUNTING | 0.30 | 0.12 | ≈ ±0.16 | 6% per location per turn | 2–8 turns | ×0.25 – ×2 |
| FISHING | 0.20 | 0.07 | ≈ ±0.11 | 2.5% per location per turn | 3–10 turns | ×0.5 – ×1.6 |
| FARMING | 0.12 | 0.025 | ≈ ±0.05 | 1.8% per turn, **once for the world** | 8–20 turns | ×1.5 (40%) or ×0.55 (60%) |
| PROSPECTING | 0.22 | 0.13 | ≈ ±0.20 | 5% per location per turn | 3–9 turns | ×0.2 – ×2 |

Farming's event is rolled once globally and applied to every farming row at
once — a blight or a golden harvest, not one field having a bad week. Rolled
per-location it would fire about a dozen times a month across the 14 farming
locations instead of the roughly once that was asked for.

Measured over 200 simulated 60-turn games: hunting drifts ±0.16 from base with
2.8 events per location, fishing ±0.10 with 1.3, farming ±0.06 with 0.9.
Nothing ever left `[0, 2]`. Prospecting's row is a first cut, matched by feel
to Hunting rather than simulated the same way — Bascinet's to retune once it
has played out.

Clamped hard at both ends. A row with `base` 0 cannot exist, so nothing ever
drifts up from disabled.

### 7a. Where it runs

`TURN_PASSES` in `db/index.js`, as `"laborYield"`, late — **after**
`"autoLabor"** so a day is paid at the coefficients that were live during it,
and what it writes is what the next turn is worth.

It is random and therefore **not idempotent**, which is exactly why it is a
named pass: `markDone` is what stops a resumed turn advance from drifting the
whole map twice.

## 8. The auto-labor pass

`db/lib/autoLaborPass.js`, `TURN_PASSES` slot `"autoLabor"`, still **before**
Hunger so income lands before upkeep.

Candidate set is every ALIVE character, not a saved panel. It files nothing and
sends nothing for anyone who:

- already has an Action this turn (a travel stub counts — crossing zones spends
  the day),
- holds an `INCAPACITATING_SLUGS` tag,
- holds **no Laboring tag** — **unless they are standing in the Factory**,
  which is the one place a day is worth something without one. Everywhere else
  an unskilled Labor pays nothing, so filing one for somebody who never asked
  would buy them a `tired` for a day that bought them nothing. They can still
  file one by hand any turn they like,
- is **Tired**, unless they hold Laboring (Tireless). The pass works a
  character up to the first rung of the ladder and no further: the second one
  costs enough that stepping onto it should be somebody's decision, so it takes
  a Labor filed by hand. The practical shape of this is that an idle character
  works every other turn — they labor, they come out `tired`, they sit out the
  next turn while it clears, and they work again. Tireless is exempt because
  it is the tag that means fatigue doesn't stop you,
- is Exhausted, or is standing where none of their skills reach — the pass
  keeps skipping this case, even though the resolver would now hand back an
  `unskilled` 0 ⬢ rate for it, and for the same reason as the bullet above.

Everyone else gets a `LABOR` Action, `CONFIRMED` / `PASSED`, `gmNotes:
"auto:labor"`, effects applied and snapshotted onto `appliedEffects` (which is
what tells the staged push to skip the row), and one DM naming the place, the
kind that won, the roll and any tool that paid.

The old summary-post machinery (`shareInSummary` / `summaryMessage`) died with
`DefaultEffort`. The pass returns `dms` only.

## 9. The Examine button

Fourth button on every Location anchor, between Secret rooms? and Converse
(`db/lib/locationAnchorRow.js`, prefix `loc:examine:`; handler `handleExamine`
in `bot/src/events/interactionCreate.js`). It was the **Labor?** button until
it grew the other two halves.

**Information only.** It files nothing, costs nothing, and anyone standing
there can press it whether or not they hold a Laboring tag — scouting is the
point, and a scout reporting back to a hunter is a conversation the game wants.

Three parts, each dropped when it has nothing to say: what can be worked here,
what the place *is*, and what the ways out are doing.

Every line reads the same way — **a one-word topic, a colon, and the shortest
true sentence**. The labor readout was already shaped like that, and the prose
under it used to be written in three or four different voices, so a player had
to parse each line before knowing whether it mattered. Now the topic is the
first thing on the line and the eye can skip what it does not need.

The first part goes further than the other two: it drops each *kind*
individually, not just the whole line. A `LaborKind` with no `LocationYield`
row here (§3) never printed a useful `×` in the first place — it is a
permanent fact about the place, not something worth checking back on — so it
is left off the line entirely rather than clutter every readout with a kind
that can never work there. Customs is a Cave location with no `yield:` block
at all, so its labor line is dropped from the readout below — this is the
one case where the "each dropped when it has nothing to say" rule applies to
the whole first part, not just one kind inside it. A Location that supports
some but not all four — `hills-waterway`, say — prints only
`**Hunting**: Sufficient | **Fishing**: Modest`, with Farming and Prospecting
left off rather than shown as a permanent `×`.

```
» *Customs.*
**Indoors**: you can't equip a cart or horse here.
**Safe**: the Caving Die doesn't roll here. Nothing underground stalks this place.
**Noticeboard**: you can pin paper here.
**Approach**: the way stands open. Worked from the watchtower.
```

The second part is `db/lib/locationAttributes.js` reading
`Location.attributes`, authored per location in `docs/zones.yaml`; the third
walks the modular `LocationLink` rows through `db/lib/locationGraph.js#linksFor`
rather than trusting the anchor's own buttons, since a GM can flip an edge
without anyone refreshing a message. Note the gate lines say what is TRUE,
while the buttons beside them say what a click DOES — one of them would have to
be wrong if they were worded alike. A gate's topic word is the place on the far
side, which is also how a player reads the button row above it.

Structures print here too, one line each, and their `examine:` string in
`docs/tags.yaml` is authored as the **fragment after the colon** — the topic
is the structure's own name, so an `examine:` that named it again would say it
twice.

Words, never numbers. Working out that Bountiful beats Ample is the player's
job, and the numbers move anyway.

| `current` | word |
|---|---|
| no row | left off the line entirely (see above) |
| 0 | `×` |
| < 0.30 | Barren |
| < 0.60 | Scarce |
| < 0.90 | Modest |
| < 1.20 | Sufficient |
| < 1.55 | Ample |
| ≥ 1.55 | Bountiful |

At base, only `depths-obelisk` wears Bountiful. This button is the
**only** surface that shows a coefficient — not `#summary`, not the anchor.

## 10. File map

| File | What it owns |
|---|---|
| `db/lib/production.js` | The five ranges, and which tiers the global dial can't touch |
| `db/lib/laborAccess.js` | The gate, the candidates, the tools, the winner |
| `db/lib/laborYield.js` | Drift math, the turn pass, the quality words |
| `db/lib/autoLaborPass.js` | Filing a day for everyone who filed nothing |
| `db/lib/syncZones/parse.js` | `collectYields` |
| `db/lib/tagShapes.js` | `normalizeLaborBonus` / `validateLaborBonus` |
| `db/lib/locationAnchorRow.js` | The Examine button |
| `db/lib/locationAttributes.js` | The attribute registry and the prose it prints |
| `docs/zones.yaml` | Every `yield:` block |
| `docs/tags.yaml` | The five Laboring tags and every `laborBonus:` |


## Laboring (Tireless)

A `mastery` tag (`TAGS.md` §4a) gated on Laboring (Skilled): you can labor
while **Exhausted**, at half yield.

Two halves, and the second is the one that makes it worth 14 points:

1. **The gate.** `computeLaborAccess`'s first step refuses a holder of
   `exhausted`; Tireless passes it, and the yield is halved.
2. **The fatigue ladder needs no change at all.**
   `db/lib/laborFatigue.js#nextLaborFatigueSlug` already returns `null` for
   somebody who is *already* Exhausted, so laboring in that state grants
   nothing and — crucially — does not refresh the existing tag's clock. It
   still degrades to Tired on its own schedule. That is what lets a Tireless
   character work every turn instead of one turn in three.

The auto-labor pass needs no change either: it skips on `!rate.ok` from this
same resolver, so a Tireless character is picked up automatically.

**The halving compounds with Soft Hands**, and each is named separately in the
payout note (`halvedBy`). Someone who is both is working a soft-handed
quarter-day. A bare "halved by Soft Hands" on a day the character was merely
Exhausted would read as a bug, which is why the note lists reasons rather than
carrying one boolean.
