# Soilery: the Farm button

A design-doc-driven farming verb: a character holding **Soilery**, the skill,
standing on `soilery`-attributed ground, spends a seed bag's licence and sows
up to a GM-tunable cap of crops (`GameConfig.farmMaxCrops`, 50 out of the
box, editable on `/gm/dev` mid-round with no deploy) in one Move. The crops
and a fatigue lockout land when the turn is pushed, not when the button is
pressed.

Read this before touching `db/lib/soilery.js`, `db/lib/locationAttributes.js`'s
`soilery` attribute, the `farmed` entry in `db/lib/moveEffects.js`,
`db/lib/fatigue.js`, or the seed-bag/sowing/crop tags in `docs/tags.yaml`.

Related: [`MINING.md`](MINING.md) (Soilery's sibling skill, the other button
that spends a day, and the fatigue ladder both share),
[`FACTORY.md`](FACTORY.md)
(the closest existing analog — a Location-attribute-gated verb with its own
pure module and turn-push resolution), [`CARRY.md`](CARRY.md) (what a full
harvest weighs), [`COOKING.md`](COOKING.md) §3 (`cooked.hunger`/`tasteForm`,
which the new crop and foodstuff tags carry), [`TAGS.md`](TAGS.md) (the
`items-seeds` group, and the tag catalog rules these tags follow), and
[`TURN-ENGINE.md`](TURN-ENGINE.md) §5/§5a (the 0-100 hunger meter — the other
half of this same body of work; its full mechanics live there, not here, see
§7 below).

## 1. Why it exists

`E:\bascinet\v3\Soilery.docx` specs a farming system: characters with the
farming skill, standing on farmland, consume seed bags and sow up to a
GM-tunable cap of crops (50 by default) in one action; the crops (with a
1-in-6 per-unit wither chance) and a fatigue lockout land when the turn is
pushed. Cooking (the doc's page 2) needed no new code at all — see §6.

Farming pays **no ⬢**. It pays in crops, which is the whole point of it — the
one button that puts food on the map rather than money in a purse. Mining is
the button that pays ⬢ (`MINING.md`), and the two skills are siblings in the
`skills-work` tag group with neither gating the other.

This used to need explaining at length, because `laboring-farming` had a
second life as a paying Laboring tier priced against a Location's
`yield.farming` coefficient, and the Farm button gated on the same tag without
being that. Laboring is gone and so is that tier. **Soilery** is one flat
7-point skill that turns on one button, and there is nothing else it does.

## 2. The `soilery` Location attribute

`db/lib/locationAttributes.js`'s `ATTRIBUTES.soilery` entry, right beside
`refinery` — the exact template Farming borrows:

```js
soilery: {
  type: "boolean",
  describe: () => "**Soilery**: you can sow and reap crops here.",
},
```

`hasAttribute(location, SOILERY_ATTRIBUTE)` is the one gate the server action
and the sheet's Farm-button visibility both read, so a tile either offers the
whole system or none of it.

**Currently one Location carries it**: `farms:` under the `forest` zone
(`docs/zones.yaml`). This is a **deliberate placeholder**, not an
oversight — the whole Farms Location is expected to be reworked later, and
`soilery: true` on it is a stand-in until that redesign lands. Both
`locationAttributes.js` and `zones.yaml` say so in a comment at the point of
use.

On a live game this attribute must also be ticked by hand at `/gm/dev/zones`
for any newly-authored Location, since `docs/zones.yaml` is one-shot/additive
sync (`db:import-zones` never updates an existing row — `CLAUDE.md`). The
checkbox appears automatically because `attributesFromInput` walks
`Object.keys(ATTRIBUTES)`.

## 3. The seed-bag → sowing-licence chain

A seed bag (`wheat-seed-bag`, `potato-seed-bag`, `tomato-seed-bag`,
`carrot-seed-bag`, `onion-seed-bag`, `plump-helmet-seed-bag`,
`pigtails-seed-bag` — real slugs, verified against `docs/tags.yaml`; naming
follows the ordinary "slug is the name, slugified" rule rather than the
plan's original literal `seed-bag-<crop>` draft, since the bag slugs
themselves are never referenced anywhere in code) is `consumable` with
`consumesInto: [sowing-<crop>]`. Consuming one grants the matching sowing
tag — `sowing-wheat`, `sowing-potato`, and so on — a **1-turn licence**
(`durationTurns: 1`, an ordinary hidden Status tag, cleared by the standard
turn-expiry sweep like any other 1-turn grant).

The Farm dialog and the server action both read which crops a character may
sow the same way: `db/lib/soilery.js#sowableCrops(characterTags)` filters its
`CROPS` table (the canonical sowing-slug/crop-slug pairing) down to whichever
sowing tags the character currently holds. **One bag licenses any amount of
that crop up to the cap** (`GameConfig.farmMaxCrops`, 50 by default, editable
on `/gm/dev` mid-round) — the doc caps the sowing, not the seed. Seed bags
are Merchant-stocked (`depotPrice: 4`); as of this writing no
starting stash of them has been added to `farms-fields`'s `stash.items`
(which still only stashes `work-knife: 1`) — a possible follow-up, not
something this pass shipped.

Seven crops, seven bags, seven sowing tags — `pigtails` included, even though
it is not a foodstuff (§5b).

## 4. The Farm action

`web/app/(app)/character/actions/soilery.js#farmRequestImpl`, modeled on
`extractGodfleshRequestImpl` (`FACTORY.md` §3) — the closest existing analog:
a Location-attribute-gated action with its own refusal chain, filed as a Move
that commits now and resolves its dice at push.

**Gating, checked in order:**

1. Standing on a `soilery`-attributed Location, or refused outright.
2. `db/lib/soilery.js#farmRefusalFor(characterTags, hasOpenAction)` — the
   **one function** the server action and the sheet's Farm-button tooltip
   both call, so the refusal text can never drift from what actually blocks
   the request:
   - Doesn't hold `soilery` → *"You don't know how to farm."*
   - Holds `exhausted` **or** `tired` → *"You're too worn out to farm right
     now."* (§5 — either rung of the fatigue ladder locks the farm out, not
     just the deeper one.)
   - Already has an action filed this turn → *"You already have an action
     this turn."*
3. `blockerFor(character.tags, ACT)` — Bound, Dying, Paralyzed or Catatonic,
   mirroring `misc.js`'s equivalent gate.
4. `requireFreeMove(character, openTurn)` (`web/lib/moveSpend.js`) — refuses
   on no open turn, the Move-lock window, or an existing `Action` row this
   turn via `@@unique([characterId, turnId])`. This is the "not already
   submitted an action" rule.
5. `sowableCrops(character.tags)` → `validatePlan(lines, licensed, maxCrops)`
   — full server-side re-validation (the client's plan is advisory only):
   rejects an unlicensed crop, a non-integer or non-positive count, a total
   of 0, or a total over `maxCrops` (read from `GameConfig.farmMaxCrops`,
   falling back to `FARM_MAX_CROPS` (50) if unset — editable on `/gm/dev`
   with no deploy).

**Inside one `$transaction`**: `lockCharacter`, then the sowing licences are
**re-checked under the lock** (so two tabs can't both spend one bag's one
ticket), one sowing tag dropped per crop actually used (spending the ticket
once per crop, not once per unit planted), `fileAutoRoutine(..., {
deferEffects: true, farmPlan })`, and one `logAudit({ actionType:
"request_farm", ... })`. `web/lib/auditNarrative.js`'s `request_farm`
renderer shows the **plan** filed, not the outcome — the harvest isn't
decided yet at filing time.

**The wither roll**, `db/lib/soilery.js#reap(planted, rng = Math.random)`:
rolls `planted` **independent** 1-in-`WITHER_IN` (6) chances, not a rounded
average — a small planting can wholly fail or wholly survive, which a rounded
average can never produce. `harvestLine(rows)` composes the turn-close prose
("sowed 30 Wheat and reaped 25, ..."), and `farmDm(turn, rows)` wraps it as
the DM sent when the turn closes.

## 5. Why resolution happens at turn-push, not a new pass

Chosen over a new `turnSideEffects` step, for four reasons verified against
the code — the same shape `refined` (`FACTORY.md` §4) already establishes:

1. **The idempotent claim already exists.** `db/lib/stagedPush.js` claims
   each Action row with a conditional write (`appliedEffects: DbNull → {}`,
   `stagedPush.js:411-414`) before applying effects, so a resumed
   turn-advance can't double-roll the wither dice. A new pass would have had
   to invent this idempotency itself.
2. **Push ordering already puts staged-push before the carry pass**
   (`TURN-ENGINE.md` §2), so a 50-crop harvest's 25 lb (`CARRY.md`) gets
   weighed in the same close it lands.
3. **Undo comes free** via `revertMoveEffects` (`db/lib/moveEffects.js`) —
   every `MOVE_EFFECTS` entry's `revert` is called automatically by the
   existing GM Unsolve path.
4. **The exact precedent already exists**: `refined` is a Move that commits
   at press and resolves its outcome at push, discussed in `FACTORY.md` §4.

**The mechanism**, `web/lib/moveSpend.js#fileAutoRoutine`'s `deferEffects`
option: the Move is spent and the seed bag's licence is gone at submission,
but `Action.appliedEffects` stays `null` (rather than `{}`) so the turn-push's
staged-push claim still sees the row as unresolved and rolls the dice at push
time. `farmPlan` (`{ v: 1, rows: [{ slug, tagId, tagName, planted }, ...] }`)
rides along on the `Action` row for that later resolution.

**`db/lib/moveEffects.js`'s `farmed` entry**, after `refined`:

- `read(action)` — `1` if `action.farmPlan?.rows?.length`, else `0`.
- `apply(tx, action)` — per row, `reap(row.planted)`, `addToStack`s the
  survivors onto the character, then calls `grantExhaustedOutright` (§5a) —
  **never `tired` directly**, since Exhausted → `expiresInto: [tired]` →
  gone **is** the doc's two-turn lockout. Returns `{ rows, fatigue }` as the
  snapshot stamped on `appliedEffects`.
- `revert(tx, action, snapshot)` — drops each reaped stack back off, deletes
  the granted `exhausted`, and restores a snapshotted prior `tired` at its
  original `expiresTurn` if the grant had replaced one.

`describeMoveEffects` renders a `farmed` value via `harvestLine(value.rows)`.

**The turn-close DM.** `stagedPush.js`'s close-DM suppression skips anything
whose `gmNotes` contains `"auto:"` (the travel stub and the Mine button's own
row already speak for themselves) — which would otherwise swallow the farm harvest DM too, since
Farming files as `"auto:farm"` (`web/lib/moves.js#AUTO_FARM`). A narrow
carve-out reads `action.farmPlan && applied.farmed` and sends `farmDm` instead
of skipping, rather than loosening the generic `"auto:"` skip for every other
auto-filed Routine.

## 5a. The exhausted/tired lockout

`db/lib/fatigue.js#grantExhaustedOutright(tx, characterId, turnNumber)` —
a small helper beside `nextFatigueSlug`, the function that already owns
the ordinary Tired → Exhausted ladder a day's mining climbs one rung at a
time (`MINING.md` §5).

Farming's lockout does **not** climb that ladder. A day at the plough grants
`exhausted` **outright**, with no lesser rung to pass through first. If the
character already holds `tired` (say, from a bad night's sleep), it is deleted
and replaced rather than left to stack
alongside `exhausted` — its `expiresTurn` is snapshotted first, so Undo can
restore it exactly.

This produces the doc's "one every three turns" cadence using tags that
**already existed** for ordinary fatigue, not a new one:

- Turn the farm resolves: `exhausted` lands. Farm refused (`exhausted` held).
- Next close: `exhausted` decays into `tired` (`expiresInto`,
  `docs/tags.yaml`). Farm still refused — `farmRefusalFor` checks **both**
  tags.
- The close after that: `tired` expires on its own clock. Farm available
  again.

Three closes, two of them refused — "every third turn" — for free, off the
ordinary `expiresInto` chain plus the two existing gates `farmRefusalFor`
already checks.

## 6. The tag catalog additions

All verified directly against the current `docs/tags.yaml`.

**Six growable crops** (`weight: 0.5`, `group: items-food`, `catalog: all`,
`consumable: true`, `cooked.tasteForm: "adjective"`):

| slug | taste | mood | hunger | note |
|---|---|---|---|---|
| `wheat` | crunchy | −5 | 6 | raw is Nauseous — `consumesInto: [nauseous]`, `cooked.into: []`, same raw/cooked split as `blind-fish` |
| `potato` | earthy | 2 | 12 | |
| `tomato` | acidic | 3 | 12 | |
| `carrot` | earthy | 3 | 12 | |
| `onion` | acrid (edited in place — was `mood: 8`, no `hunger`) | 2 | 12 | |
| `plump-helmet` | earthy | 1 | 9 | |

**One non-foodstuff crop**, sown the same way but not a meal: `pigtails`
(`category: items`, `group: items-gear`, no `cooked:` block, not
`consumable`) — grown in the fields, its Crafting use (crushed into fibre) is
a later page and out of scope here.

**Ten non-growable foodstuffs**, same base shape as the crops:

| slug | taste | mood | hunger | note |
|---|---|---|---|---|
| `meat` | meaty | 5 | 12 | |
| `rations` | acrid | −5 | 12 | raw/cooked split, `consumesInto: [nauseous]` |
| `dead-rat` | meaty | −10 | 9 | raw/cooked split, `consumesInto: [nauseous]` |
| `sugar` | sweet | 20 | 12 | |
| `cheese` | cheesy | 15 | 12 | deliberate near-duplicate of `hard-cheese`, not a rename |
| `rendered-fat` | creamy | 10 | 12 | renamed from the doc's "Fat" — that slug is taken by an unrelated general trait |
| `eel` | fishy | 7 | 15 | deliberate near-duplicate of `river-eel`, not a rename |
| `dustfish` | acidic | −15 | 15 | raw/cooked split, `consumesInto: [nauseous]` |
| `haggar` | fishy | 5 | 15 | |
| `tunnel-trout` | fishy | 5 | 15 | |

**Existing foodstuff tags edited in place** to carry `hunger` (and, for
`onion`, a retuned `mood` and `tasteForm`): `onion`, `arelitz-egg`,
`maggot-milk`, `tinned-butter`, `fish-roe`, `honey`, `crayfish`. `hard-cheese`
and `river-eel` were deliberately left untouched.

**Seven seed bags** (`wheat-seed-bag` … `pigtails-seed-bag`, `group:
items-seeds`, `depotPrice: 4`, `weight: 1`, `consumable`,
`consumesInto: [sowing-<crop>]`) and **seven sowing tags**
(`sowing-wheat` … `sowing-pigtails`, `category: status`, `group:
status-buffs`, `durationTurns: 1`). §3 above.

**Two new `cooked:` block fields**, validated in
`db/lib/tagShapes.js#normalizeCooked`:

- **`hunger`** — a whole number from 0 to 100 (`HUNGER_MAX`), how much this
  ingredient restores on the hunger meter. Stored only when present, same
  opt-in posture as `cures`. Absent means "not really food" — it still grants
  `ate-meal` if tagged for that, but restores nothing.
- **`tasteForm: "adjective"`** — the only other legal value is absent.
  Extends `web/lib/cooking.js`'s taste-line template so a taste renders bare
  ("It tastes acidic.") instead of the default noun form ("It tastes like
  onions."), without touching any of the 58 existing noun-style tastes, which
  are all left unmarked.

**`Tag.mealHunger`**, a new schema column beside `mealMood`, copied onto a
minted `custom-craft-…` dish by `db/lib/customCraftMint.js` (miss that step
and every minted dish restores zero hunger — verified still wired correctly)
and synced from `docs/tags.yaml` by `db/lib/syncTags.js`. `fine-meal` and
`lavish-meal` carry `mealHunger: 12` / `18` (alongside their existing
`mealMood` 5 / 8) so a cooked plate outhungers its raw ingredient — scaled
×3 with every other inferred hunger number when the meter moved to 0-100
(Context §6).

**New tag group**: `items-seeds` (`docs/taggroups.yaml`, category `items`),
with a `Sprout` icon glyph wired in `web/lib/tagIcons.js`.

## 7. The hunger meter — see TURN-ENGINE.md, not here

The Soilery design doc's other half (pages 1 and the hunger section) is a
full rebuild of Hunger: the old ⬢-upkeep/streak/Gambit-penalty system is torn
out and replaced by a 0-100 meter (`Character.hungerValue`, `db/lib/hunger.js`)
that decays every turn and is raised only by eating — Consume reads the
`cooked.hunger`/`mealHunger` fields §6 introduces. This is thoroughly
documented already and **is not repeated here** to avoid drift between two
copies of the same mechanics:

- [`TURN-ENGINE.md`](TURN-ENGINE.md) §5/§5a/§5b — the full mechanics: decay,
  thresholds, banding, the `dying` chain, the horse-upkeep ordering.
- [`REQUESTS.md`](REQUESTS.md) §4 — Hunger and the Gambit modifier, the
  eating path, the DM copy.
- [`TAGS.md`](TAGS.md) — `ate-meal`'s current lifecycle (see the note below)
  and the automatic-tag-writer conventions it follows.
- [`MOOD.md`](MOOD.md) — the `HUNGRY`/`STARVING` mood events and the one-time
  onset hits.
- [`ECONOMY.md`](ECONOMY.md) §6 — why Hunger is no longer a ⬢ sink.
- [`SHEET.md`](SHEET.md) — the sheet's hunger warning copy (never a number).

**One correction worth flagging here**, since Soilery's own tag work touched
it: `ate-meal` now carries `durationTurns: 1` in `docs/tags.yaml` and expires
through the ordinary turn-expiry sweep, exactly like `hungry`/`starving`/
`tired` — **not** through a bespoke consumption step. It used to be cleared by
the old streak-based hunger pass, which no longer touches it at all under the
new meter; without a duration it would never have expired. `db/lib/hunger.js#foodHungerFor`
only ever *reads* `ate-meal` (as the "this unpriced item still counts as
food" fallback signal), never writes or clears it. The `dined` tag (Nobility's
separate marker, cleared by the mood pass instead — `MOOD.md` §8) carries a
corrected comment in `docs/tags.yaml` reflecting the same fact: it no longer
claims the hunger pass eats `ate-meal`, since nothing does that any more.

## 8. Cooking, and the Fertilizer addendum

Cooking (the design doc's page 2) needed no new code **for this crop/
foodstuff pass**: any tag with a `cooked:` block — including every new crop
and foodstuff tag from §6 — is automatically a valid Cooking ingredient the
moment `docs/tags.yaml` is synced. `cooked.hunger` and `cooked.tasteForm` are
the two additions Cooking's own code needed to learn to read (`COOKING.md`
§3), and both are opt-in fields on the same block Cooking already parsed. A
**later** pass did rebuild the rest of Cooking, replacing the old Fine/Lavish
Meal pair with the design doc's 31 named recipes — see `COOKING.md` §2a,
which is unrelated to the crop/foodstuff catalog this file covers.

The design doc's Addendum — Fertilizer disables the wither roll and replaces
it with an independent 1-in-6 (`BOUNTY_IN`) chance of double yield per
planted unit — lives in `db/lib/soilery.js#reap`'s `fertilized` option, not a
separate function: same per-unit loop shape, opposite outcome table, and the
two are mutually exclusive per unit. `farmRequestImpl` reads whether the
character holds `fertilized-fields` (unconsumed — the buff's existing 2-turn
duration already covers exactly one farm, since the Exhausted-outright
lockout is 3 turns) and stamps it onto `farmPlan` (`v: 2` now,
`{ fertilized: boolean }` added), read at push by `moveEffects.js`'s `farmed`
entry the same way every other farmPlan field is.

## 9. Where the code lives

| Concern | File |
|---|---|
| The crops, the wither die, plan validation, refusal text | `db/lib/soilery.js` |
| The `soilery` Location attribute | `db/lib/locationAttributes.js` |
| The Farm server action | `web/app/(app)/character/actions/soilery.js` (`farmRequestImpl`) |
| The thin request wrapper | `web/app/(app)/character/requestActions.js` (`farmRequest`) |
| Turn-push resolution: the wither roll, the harvest, the fatigue grant | `db/lib/moveEffects.js` (`farmed`) |
| The Exhausted-outright lockout helper | `db/lib/fatigue.js` (`grantExhaustedOutright`) |
| Deferred-effects filing (`deferEffects`, `farmPlan`) | `web/lib/moveSpend.js` (`fileAutoRoutine`) |
| The `"auto:farm"` Move marker and desk label | `web/lib/moves.js` |
| The harvest DM carve-out past the `"auto:"` suppression | `db/lib/stagedPush.js` |
| The audit-log renderer for a filed plan | `web/lib/auditNarrative.js` (`request_farm`) |
| The seed bags, sowing tags, crop and foodstuff tags | `docs/tags.yaml` |
| The `items-seeds` tag group and its icon | `docs/taggroups.yaml`, `web/lib/tagIcons.js` |
| `cooked.hunger`/`cooked.tasteForm` validation | `db/lib/tagShapes.js` (`normalizeCooked`) |
| `Tag.mealHunger` schema, sync, and mint-copy | `db/prisma/schema.prisma`, `db/lib/syncTags.js`, `db/lib/customCraftMint.js` |
| The Farms placeholder geography | `docs/zones.yaml` (`farms:`) |
| The sheet-side Farm gate (`canSeeFarm`/`farmBlocked`/`canFarm`) | `web/app/(app)/character/page.js` |
| The Farm verb strip entry | `web/app/components/actionRegistry.js` (`mode: "farm"`) |
| The Farm dialog itself | `web/app/components/actions/FarmDialog.js`, registered in `web/app/components/actions/index.js` |
| The GM-tunable sow cap (`GameConfig.farmMaxCrops`, default 50, `FARM_MAX_CROPS` is the code fallback) | `db/prisma/schema.prisma`, `db/lib/gameConfigFields.js` (`/gm/dev?s=config`, "Economy" group) |
