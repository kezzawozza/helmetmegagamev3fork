# Mining: the Mine button

How a character turns a day into ⬢. One skill, one button, one coefficient per
place — press **Mine** where there is a seam to work, spend the whole turn, and
get paid on the press.

Read this before touching `db/lib/mining.js`, `db/lib/miningYield.js`,
`web/app/(app)/character/actions/mine.js`, the `mining:` values in
`docs/zones.yaml`, or any `miningBonus:` in `docs/tags.yaml`.

Related: [`MININGDROPS.md`](MININGDROPS.md) (the 1d6 that rides on top of the
⬢), [`SOILERY.md`](SOILERY.md) and [`FACTORY.md`](FACTORY.md) (the other two
day-spending buttons), [`TURN-ENGINE.md`](TURN-ENGINE.md) (the drift pass's
slot), [`MAP.md`](MAP.md) (where the coefficients are authored and edited),
and [`ECONOMY.md`](ECONOMY.md) (the `MINING` faucet).

## 0. What this replaced

There was a system called **Laboring** here, and it was the largest in the
game. It is worth knowing what went, because a lot of the repo's history only
makes sense against it:

- Labor was a third `MoveKind` beside Routine and Gambit, picked from the Move
  modal. Filing nothing at all filed one for you — an auto-labor pass ran at
  the head of every turn close and worked the whole idle roster.
- It had an eight-rung tag ladder: two general tiers that paid anywhere, four
  side-grades (Hunting, Farming, Fishing, Prospecting) scaled by a per-kind
  coefficient on each Location, and two masteries.
- Every Location carried up to four `LocationYield` rows, one per kind.
- Two systems that are not Laboring were built on top of it because it was
  there: the Godard Factory's refining shift, and Soilery's Farm button.

All of it is gone. **A day's work is a button now**, pressed where the work
actually is, and mining is the only one of the four kinds left. Filing nothing
files nothing — the day simply passes.

**A day's pay has weight.** ⬢ is a one-pound item (`TAGS.md`, `CARRY.md`), so a
payout is a stack landing in somebody's hands like any other. Mining is an
*involuntary* gain, so it is never refused for want of room — it lands, and the
carry pass sets down whatever will not fit at the turn close.

## 1. The skill

One tag, `prospecting`, name **Prospecting**, 7 points. No `parentTag`, no
`requiredTag`, nothing above it and nothing below it. You either know rock from
ore or you do not.

It is **a gate, not a floor**: without it the Mine button refuses outright
("You wouldn't know rock from ore") rather than paying a skill-less zero. That
is the opposite of Laboring's last rule, and deliberately so — an unskilled
Labor that spent the day and paid nothing was a trap, and with a button there
is no reason to let somebody press it.

`soilery` is its sibling in the same tag group (`skills-work`) and gates the
Farm button. Neither gates the other.

## 2. What a place is worth

One `LocationMining` row per minable Location, and **the row is the gate**:

- **No row** — you cannot dig here at all. The Mine button does not appear, and
  Examine leaves the line off entirely rather than printing a permanent `×`.
  This is a permanent fact about the place, not something worth checking back
  on.
- **A row drifted to 0** — the button still appears and Examine still prints a
  word. That *is* worth checking back on.

**The sheet's Mine button only ever shows in the Caves.** `resolveMiningRateFrom`
still reads whatever `LocationMining` row a character stands on, so the
Black Hills and the Depths (`depths-chasm` included) are still priced and
still drift, but `/character` (`web/app/(app)/character/page.js`) shows the
button to anyone holding Prospecting and greys it — "You need to be in the
caves." — everywhere outside the `caves` zone. There is currently no player
surface that reaches a mining payout anywhere but the Caves.

`base` is authored in `docs/zones.yaml` as a bare `mining:` value and is what
`current` reverts toward. `current` is the live coefficient, re-drifted at
every turn close, and it is the only number a payout reads.

| Where | `base` |
|---|---|
| The Black Hills | 0.2–0.3 |
| The Caves | 0.9 |
| The Depths | 1.1 |
| `depths-chasm` | 1.4 |
| Everywhere else | no row |

The Black Hills are surface rock: worth working if you are already up there,
never worth the walk on its own. Underground is where mining actually pays.
`depths-chasm` is the exception the map earned — it is the one place with an
authored ore vein (`chasm-ore-vein`), and flattening it to the Depths' baseline
would have deleted the only "dig HERE" anybody wrote down.

Geography is authored live at `/gm/dev/zones` now, not by re-syncing YAML
(`MAP.md`). A superadmin edits one Location's `base` there; `db:import-zones`
creates a row only for a Location that does not have one, and never updates.

## 3. Resolving one day

`db/lib/mining.js#resolveMiningRateFrom` is the whole of it, in order:

1. **Exhausted** refuses. Tired does not — see §5.
2. **Incapacitated** refuses (`INCAPACITATING_SLUGS`): bound, bleeding out, on
   the floor, out cold.
3. **No row, or a row at 0** — "There's nothing to mine here."
4. **No Prospecting** — "You wouldn't know rock from ore."
5. The base range, **2–8**, times `GameConfig.productionCoefficient` (the
   global dial, 0.93 out of the box) times the Location's `current`.
6. **Tools** are added flat, after the scaling, so a tool is worth the same
   everywhere (§4).
7. **Soft Hands** halves what is left, rounded down.
8. **Lifeweb failure** keeps a twentieth of that (`LIFEWEB_SPUTTER_THRESHOLD`).

The result is a machine `"min-max"` string on `Action.resourceRollExpression`,
parsed back by `db/lib/resourceDelta.js#rollResourceRange`. **Never append
anything to it** — "(+3 Pick)" fails that regex and pays nothing. Say the bonus
in the note instead.

**Lazy takes its quarter after the roll**, not off the range, and the stored
expression is cut the same way so the sheet prints the range the payout is
actually inside.

The payout lands **at the press**, not at the turn close: the ⬢, the drop die
and the fatigue step all apply inside the filing transaction, and
`appliedEffects` is stamped so the staged push skips the row. That is what
Labor did, and for the same reason — a roll against a range is not a judgement
anybody makes, so there is nothing to wait for.

## 4. Tools

A tag with a `miningBonus:` block adds a flat number of ⬢ while it is held (or
worn — `equipped` defaults true). Three carry one:

| Tag | Bonus |
|---|---|
| Prospector's Pick | +1 |
| Mining Helmet | +1 |
| Claim Stake (a Structure, `placement.miningBonus`) | +1 |

There was a `kind:` key naming which of the four Laboring types a bonus paid
into, and a typo in it silently made a tool worthless. A bonus is just a bonus
now.

**Structures pay everyone standing at their Location**, as synthetic tools, and
they do **not** stack: the best one only, so a location-wide bonus cannot
multiply by occupancy. Ties keep the older structure. A structure must be
`COMPLETE` — the same reading `equipmentReach.js` takes, which is what gives
Damage teeth.

**Weapon bonuses do not stack either** — only the best-paying weapon counts.
Nothing mining carries one today, but the rule is cheap and a pick is one edit
away from being a weapon.

## 5. Fatigue

A day's mining steps the **Tired → Exhausted** ladder
(`db/lib/fatigue.js#nextFatigueSlug`). Tired blocks nothing by itself; a second
day running escalates it to Exhausted, which refuses the next day until it
decays. Left alone, Exhausted degrades to Tired and Tired clears, so the
practical shape is that somebody mining flat out works every other turn.

That module is **not** a mining file, despite living beside one for a long
time. Two of its three callers have nothing to do with a day's work: the dawn
affliction pass escalates it for a bad night's sleep, and travel push-on
escalates it for the Exert die (`MAP.md` §3). Keep it neutral.

## 6. Drift — what the land does on its own

`db/lib/miningYield.js`, `TURN_PASSES` slot `"miningYield"`, late in the close.
Mean-reverting random walk with occasional jump events:

```
target  = in an event ? eventTarget : base
current = clamp(current + reversion * (target - current) + noise, 0, 2)
```

An event moves the **target**, not `current`, so a swing arrives over turns and
decays on its own once the window closes — there is no separate recovery path.

The slot is late on purpose: what this writes is what the **next** turn's
mining is worth, so a day already paid keeps the coefficient it was priced at.
This mattered more when the auto-labor pass ran at the head of the same close;
it is still the right ordering.

There were four sets of these parameters, one per Laboring kind, and farming's
rolled a single world-wide event so a blight hit every field at once. A seam
runs out one seam at a time, so the global-event path went with the rest.

## 7. The Examine button

Fourth button on every Location anchor
(`db/lib/locationAnchorRow.js`, handler `handleExamine`). **Information only**:
it files nothing, costs nothing, and anyone standing there may press it whether
or not they hold Prospecting. Scouting is the point.

It is the **only** surface that shows what the ground is worth — not `#summary`,
not the anchor, not the Mine button's own tooltip. And it shows a **word, never
a number**. Working out that Bountiful beats Ample is the player's job, and the
numbers move anyway.

| `current` | word |
|---|---|
| no row | the line is left off entirely |
| 0 | `×` |
| < 0.30 | Barren |
| < 0.60 | Scarce |
| < 0.90 | Modest |
| < 1.20 | Sufficient |
| < 1.55 | Ample |
| ≥ 1.55 | Bountiful |

At base, only `depths-chasm` wears Ample; nothing wears Bountiful.

## 8. File map

| File | What it owns |
|---|---|
| `db/lib/mining.js` | The gate, the range, the location cut, the tools |
| `db/lib/miningYield.js` | Drift math, the turn pass, the quality words |
| `web/app/(app)/character/actions/mine.js` | The button: files the Move and pays it |
| `db/lib/fatigue.js` | The Tired → Exhausted ladder (shared, not ours) |
| `db/lib/syncZones/parse.js` | `collectMining` |
| `db/lib/tagShapes.js` | `normalizeMiningBonus` / `validateMiningBonus` |
| `db/lib/examineLocation.js` | The Examine readout |
| `docs/zones.yaml` | Every `mining:` value |
| `docs/tags.yaml` | Prospecting, Soilery, and every `miningBonus:` |
