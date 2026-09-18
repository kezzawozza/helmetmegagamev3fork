# Arelitz: the Stable, breeding, and breaking in

The single mount the game has now — bred in a Stable room, not bought or
crafted, and unrideable until someone breaks one in. Replaces the old
Horse / Arelitz (Warbeast/Ovum/Thoroughbred) family outright: horses are
gone, and there is one arelitz, not three bred variants.

Read this before touching `db/lib/arelitz.js`, `db/lib/stablePass.js`,
`db/lib/mounts.js`, `Room.stable`, or any of `arelitz` / `unruly-arelitz` /
`arelitz-hatchling` / `arelitz-youngling` / `arelitz-yearling` /
`arelitz-mastery` in `docs/tags.yaml`.

Related: [`CORPSES.md`](CORPSES.md) §6a (Butcher's livestock source),
[`CARRY.md`](CARRY.md) §2 (mount seats and the free zone move),
[`MAP.md`](MAP.md) (crossing mechanics `db/lib/mounts.js` feeds),
[`SOILERY.md`](SOILERY.md) (the Farms placeholder the Stable currently sits
inside).

## 1. Why it exists

`E:\bascinet\v3\Soilery.docx`'s Arelitz Breeding section specs a lifecycle
the old system never had: a stable room where arelitz eat scraps off the
floor and lay eggs, eggs that hatch on their own clock, a three-rung growth
ladder from hatchling to adult, a capacity the stable evicts past, and a
`gambit` to break an adult in before it can be ridden. The system it
replaced (`arelitz-warbeast` / `arelitz-ovum` / `arelitz-thoroughbred`, each
bred directly from a `horse` via an ordinary craft recipe, each charged
1 ⬢/turn upkeep) had none of that — no stable, no egg floor, no hatching, no
capacity, and no breaking-in at all. It's gone; this is what stands in its
place.

## 2. One mount type, not three

Bascinet's call: a single `arelitz` (rideable) and `unruly-arelitz`
(everything else identical, not rideable) rather than the old three
differently-statted variants. `unruly-arelitz` carries **no** `equippable` /
`equipSlot` / `equipLayer` — that omission is the entire "cannot be ridden"
enforcement. `db/lib/mounts.js` only ever reads the ACTIVE (equipped) slug
set, so a tag that can't equip can't appear in `FAST_TRAVEL_SLUGS` or
anywhere else that matters; no special-case "holds unruly vs. holds
broken-in" check exists anywhere.

An arelitz seats 2 (6 with a Cart), buys 1 free zone move (2 with
`arelitz-tack`, renamed from `horseshoes`), and — unlike a horse — costs
**no** per-turn upkeep. `db/lib/horseUpkeepPass.js` is deleted, not
repurposed; nothing else used that mechanism.

## 3. The Stable

A `Room.stable` boolean, not a Location attribute — `db/lib/stablePass.js`
resolves "the stable floor" as **every Room with `stable: true`**,
generically, never a hardcoded Room id. Currently one Room carries it:
`farms-stable`, a new Room inside the existing `farms:` Location (alongside
`farms-fields`), authored in `docs/zones.yaml`.

**Deliberately a Room flag, not the Soilery Location itself.** The whole
Farms Location is a placeholder pending its own rework (SOILERY.md §2), and
the Stable is placed inside it the same way — when that rework lands, moving
the Stable is a `docs/zones.yaml` edit (add `stable: true` to whatever Room
replaces `farms-stable`, drop it from this one). `db/lib/stablePass.js` needs
no code change to follow it, since it queries by the flag, never by slug.

`web/app/(app)/character/page.js`'s `canSeeBreakIn` reads this the same way
Farm's `canSeeFarm` reads the `soilery` attribute: any `stable: true` Room in
the character's current Location counts (Location grain, matching how
`corpsesInReach`/`livestockInReach` read "reachable").

## 4. The turn pass

`db/lib/stablePass.js#runStablePass`, run from `db/index.js#resolveNeeds()`
right after `"structureYield"` — same slot the old `arelitzLayPass.js` used,
and for the same reason: an egg lands on the stable Room's own floor, so this
must not run before `"carry"`'s overflow drop might already be putting
something there. **Keeps the `"arelitzLay"` key** in `TURN_PASSES` even
though the module was renamed and rewritten — same posture
`offerExpiryPass.js` takes for its own renamed-but-not-rekeyed pass, since the
key is written into `Turn.resolvedPasses` rows.

One `$transaction` per stable Room, four steps in this exact order:

**1. Age the brood, oldest rung first.** `arelitz-yearling` → `unruly-arelitz`,
`arelitz-youngling` → `arelitz-yearling`, `arelitz-hatchling` →
`arelitz-youngling`, oldest converted first so a hatchling this same pass
adds in step 3 can never climb more than one rung. This is a three-rung tag
ladder, not a duration/expiry timer — `db/lib/tagExpiryPass.js` only walks
`CharacterTag` rows, never `RoomTag`, and the *ordinary* expiry sweep runs
well before this pass in `TURN_PASSES`'s order, so using `RoomTag.expiresTurn`
as the maturation clock would **delete** the youngling instead of maturing
it. Same idiom as the existing Exhausted → Tired fatigue ladder
(`db/lib/laborFatigue.js`).

A consequence worth knowing: a brood animal taken out of the stable (sold,
carried off, butchered) simply stops aging. It's a defensible reading of "an
egg left on the floor of the stable" — the ladder only advances rows that are
still on that floor when the pass runs.

**2. Feed and lay.** Every adult actually on the floor counts —
`arelitz` **and** `unruly-arelitz` both, since the doc says "each arelitz
located in the stable," not only the broken-in ones (and includes any
yearling that just matured THIS pass, in step 1 — `stablePass.js` adds that
count back in rather than re-querying). The floor's food is every other
`RoomTag` in the room where `db/lib/hunger.js#foodHungerFor(tag) > 0` — any
foodstuff or cooked dish, eaten **cheapest first** (lowest hunger value, then
oldest). Two units per adult, **all-or-nothing**: an adult that can't get a
full two eats and lays nothing this turn (the doc's "if possible"). One
`arelitz-egg` lands on the stable floor per adult fed — the floor, not the
owner's pocket, since that's what step 3 then hatches.

**3. Hatch.** Every `arelitz-egg` unit on the floor independently rolls
1-in-`HATCH_IN` (30) — same per-unit-loop shape as `db/lib/soilery.js#reap`'s
wither die, for the same reason: real variance, not a rounded average.
Hatched eggs become `arelitz-hatchling` on the same floor.

**4. Evict past capacity.** Total arelitz + unruly + all three brood rungs,
against `GameConfig.stableCapacity` (default 10, GM-tunable at `/gm/dev`,
same pattern as `farmMaxCrops`). Over capacity, evict the excess to
`GameConfig.stableOverflowRoomSlug` (default `"farms-fields"`) —
**youngest brood first, then unruly, then broken-in last** (somebody's
property is the last thing shoved out the door). A missing or unresolvable
overflow Room slug skips the eviction and logs, rather than deleting
anything.

## 5. Butchering

Adult (arelitz or unruly-arelitz) → 20 meat + 10 fat. Any brood rung → 5 meat
+ 2 fat. Full writeup in [`CORPSES.md`](CORPSES.md) §6a — Butcher's second
source, reusing the same verb, dialog and reach rule a corpse uses
(`db/lib/corpses.js#livestockInReach`), with one real difference: it takes
**one unit** off the stack rather than the whole row, since a stable's worth
of arelitz is a stack of several, not a lone body.

## 6. Breaking in

`arelitz-mastery` (a fresh 15-point mastery skill — not a repurposed
`arelitz-breeding`, since that tag's whole reason for existing was gating
four craft recipes that no longer exist) lets a character attempt to break
in an unruly arelitz, held or standing on a `stable` Room's floor, via a
**Gambit**.

**The verb**, `breakin` (`web/app/components/actionRegistry.js`), same
HIDE-not-grey posture Farm uses: `canSeeBreakIn` (any stable Room here) hides
the button, `canBreakIn`/`breakInBlocked` (`db/lib/arelitz.js#breakInRefusalFor`
— holds `arelitz-mastery`, no action filed yet this turn) greys it with a
reason. `BreakInDialog.js` picks which unruly arelitz, reusing the same
`corpses` pool Butcher reads (`livestockInReach` concatenates onto it),
filtered to `unruly-arelitz`.

**The request**, `web/app/(app)/character/actions/arelitz.js#breakInArelitzRequestImpl`,
modeled directly on `healCharacterRequestImpl`'s Gambit branch
(`actions/medical.js`): inside one transaction (character lock, then a room
lock if the target is stashed), the target is re-checked under the lock,
`rollWithAdvantage(character.tags, 6)` rolls the die
immediately (Lucky applies the same as on any other Gambit), and an
`Action` row is created directly — `moveKind: "GAMBIT"`,
`moveReviewStatus: "OPEN"`, `diceRoll`/`diceModifier` stamped,
`gmNotes: "auto:break_arelitz"`, and a `breakInPlan` —
`{ v, kind: "room"|"character", roomId|characterId, tagId, tagName }` —
riding along the same way `farmPlan` does. `appliedEffects` stays null, so
the turn-push's staged-push claim still sees the row as unresolved and
rolls its outcome at push time, exactly like Farming's `farmed` entry.

**Resolution — the one deliberate departure from the Heal precedent.** A
Heal Gambit rolls immediately and leaves the outcome entirely to a GM
reading `/gm/turns` at their own pace — fine for a single patient, but a
stable's worth of break-in attempts sitting unresolved for days doesn't
scale to 100+ players. So `db/lib/moveEffects.js`'s `brokeIn` entry
**auto-resolves at push**: `diceRoll + diceModifier >= BREAK_IN_TARGET`
(5, roughly 1-in-3 base success before mood/hunger modifiers — Bascinet's
chosen difficulty; the design doc names no threshold) swaps
`unruly-arelitz` → `arelitz` wherever the plan points. The target is
re-checked once more at apply time (sold, transferred or butchered between
filing and push reads as `gone`, not a crash) so nothing is granted from
nothing. The `Action` row still carries `moveReviewStatus: "OPEN"`, so a GM
can still see and override it at the desk — auto-resolution doesn't remove
that door, it just stops the animal waiting on it.

`stagedPush.js` carries the same narrow `"auto:"` close-DM carve-out
`farmPlan` has (`db/lib/arelitz.js#breakInDm`), and is excluded from the
generic pre-emptive "🎲 Your Gambit: **N**" notice every other open Gambit
gets — `breakInDm` already says the roll AND the outcome in one line, so the
bare roll notice would just be a confusing, contextless second message ahead
of it (same reasoning `auto:lesson`/`auto:research` are already excluded
for).

## 7. Complete horse removal

`horse`, `arelitz-breeding`, `arelitz-warbeast`, `arelitz-ovum`,
`arelitz-thoroughbred` are deleted from the catalog outright (pre-launch, no
compat shim needed — CLAUDE.md). Every dependent tag repointed at arelitz:
`plow`'s `laborBonus.requiresTag` (a HOLD check, so an unruly arelitz can
still pull a plough even though nobody can ride it), `horseshoes` renamed to
`arelitz-tack`, the Courier role's `consumesInto` grant, Motion Sickness's
copy, Fishing Boat's conflict text. `db/lib/mounts.js` collapsed from
per-variant branches to one `arelitz` branch throughout.

## 8. Where the code lives

| Concern | File |
|---|---|
| Break-in refusal text, the success threshold, the close DM | `db/lib/arelitz.js` |
| The Stable's four-step turn pass | `db/lib/stablePass.js` |
| Mount mechanics (seats, free move, stow) collapsed to one slug | `db/lib/mounts.js` |
| `Room.stable`, the Stable Room itself | `db/prisma/schema.prisma`, `docs/zones.yaml` (`farms-stable`), `db/lib/syncZones/parse.js`, `db/lib/importZones.js` |
| The break-in Gambit request | `web/app/(app)/character/actions/arelitz.js` |
| Turn-push resolution: the roll check, the tag swap | `db/lib/moveEffects.js` (`brokeIn`) |
| The `"auto:break_arelitz"` Move marker and desk label | `web/lib/moves.js` |
| The harvest-shaped close DM carve-out | `db/lib/stagedPush.js` |
| The Break In verb strip entry and its dialog | `web/app/components/actionRegistry.js`, `web/app/components/actions/BreakInDialog.js` |
| Livestock's yields, and Butcher's second reach-list | `db/lib/corpses.js` (`LIVESTOCK_YIELDS`, `livestockInReach`) |
| Livestock's own Butcher branch (one unit off the stack) | `web/app/(app)/character/actions/corpse.js` (`takeLivestockUnit`) |
| The catalog tags themselves | `docs/tags.yaml` |
| `GameConfig.stableCapacity` / `stableOverflowRoomSlug` | `db/prisma/schema.prisma`, `db/lib/gameConfigFields.js` (`/gm/dev?s=config`, "Economy" group) |
