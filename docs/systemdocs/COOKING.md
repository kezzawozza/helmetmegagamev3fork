# Cooking

31 named recipes across three skill tiers (Basic, Skilled, Skilled Lavish),
the ingredients that go in them, and what eating one does. Read this before
touching `Tag.cooked`, `Tag.cookedFrom`, `Tag.mealTaste`/`mealTasteForm`,
`Tag.requirementYield`, `requirement.ingredientSlots`, `web/lib/cooking.js`,
`db/lib/mood.js#dishMoodTerms`, or `IngredientSlots.js`.

Crafting in general is [`CRAFTING.md`](CRAFTING.md); this is the one recipe
family that does something crafting alone cannot.

## 1. What changed, and why

Cooking used to make two flat items, Fine Meal and Lavish Meal: a small base
mood (`mealMood`, 5 and 8) plus 0–1 or 1–2 player-chosen ingredients out of
any tag carrying a `cooked` block. Nothing named which dish a cook was
actually making — "Fine Meal" was the only name on the tin regardless of what
went in, unless the cook typed one themselves.

The design doc (`E:\bascinet\v3\Soilery.docx`) specs something more specific:
31 **named** recipes, each with its own FIXED base ingredients (consumed
automatically — Bread is always Wheat + Wheat) that also carry the recipe's
own small base taste/mood/hunger, plus a slot layer on top for whatever
additional ingredient a cook wants to add. That's what ships now — Fine Meal
and Lavish Meal are deleted (pre-launch, no compat shim needed), replaced by
the tables in §2a.

What carries over from the old system, unchanged in mechanism:

- A recipe's own base figure is still small next to what an ingredient can
  add, from **+45** (saffron) down to **−55** (feces) — see §2a's tables for
  each recipe's own base mood/hunger/taste.
- Additional ingredients still slot on top of the fixed base — 0–4 of them,
  the `IngredientSlots.js` dialog's own ceiling (the design doc names no cap).
- An ingredient brings its side effects with it. A dish made from a person
  makes the eater nauseous or worse; one made with Squeeze is a seizure.
- Every dish has a **taste**, and eating one says so — now the recipe's own
  base taste (`mealTaste`/`mealTasteForm`) reads FIRST, then each additional
  ingredient's.
- Naming your work is free.

### 1a. A meal is now the only way to be fed

Eating grants `ate-meal`, and since 9/2026 that tag **is** the whole of being
fed. The Hunger pass asks one question at the close of every turn — is
`ate-meal` on the sheet? — and consumes it if it is (`TURN-ENGINE.md` §5). A
character with none goes Hungry.

That is a bigger job than the tag used to have. Until then the pass **billed**
everyone 1 ⬢ a turn for food and you went hungry only if you could not cover
it, so `ate-meal` was a *shield*: it saved you the 1 ⬢ and dropped a tick of
the streak. Cooking was therefore a losing move on the arithmetic alone — a
Fine Meal costs 2 ⬢ to make and a Lavish 3 ⬢, to spare you a charge of 1 ⬢
— and anybody who never cooked was quietly taxed for existing anyway. The
charge is gone. Nobody pays to eat, and the only way to not be Hungry is for
somebody to have cooked.

So this file matters more than it did, not less. It does **not** mean every
dish must come from this recipe family: anything whose `consumesInto` reaches
`ate-meal` feeds a character, which today includes raw Human Flesh (§4).
Foodstuff items that grant it more ordinarily are the work coming next, and
`ate-meal` is the seam they plug into — nothing about the pass needs to change
to accept them.

## 2. A dish is a minted row

Every meal with words or ingredients on it is a **minted `Tag`** — the fifth
runtime authoring door, the one `CRAFTING.md` §4a already described, now
carrying more than a name. `mintCustomCraft` clones the recipe row
(`custom: true`, `ephemeral: true`, `craftable: false`) and writes two things
on the clone:

| Column | What |
|---|---|
| `cookedFrom` | the ingredient slugs, **sorted** |
| `mealMood` | copied off the recipe |
| `mealHunger` | copied off the recipe |
| `mealTaste` / `mealTasteForm` | copied off the recipe (§2a) |

A meal with **no words and no additional ingredients** does not mint. It has
nothing to carry, and an ephemeral clone of the base row would only make it
un-Depot-listable and Restart-Game-deletable for no gain. A recipe with a
`requirement.items` entry that names a real ingredient (nearly all of them —
see §2a) still consumes that fixed base without minting, unless the cook also
adds something extra or a name.

**The ingredients are part of the mint's identity.** Reuse keys on name +
description + `cookedFrom`, so two cooks who both type "Steak Dinner" over
Steak — one adding saffron, one adding feces — get two rows. Nothing on any
surface tells them apart, which is the point. Miss this and one of them is
serving the other's dinner.

**A dish nobody named is named after its taste** — "Steak (rich)". That rule
is for the cook's own pantry rather than for anyone else's secrecy: a recipe
that mints (because it took an additional ingredient) needs some way to tell
the saffron batch from the feces batch before biting, if the cook named
neither. A taste is coarser than an ingredient ("meat" covers a boar loin and
a human foot), and the two undetectable poisons have no taste at all, so it
gives away less than it looks. A cook who wants to hide something types a
name.

Sorted rather than kept in slot order because Postgres array equality is
order-sensitive; the cost is that the taste sentence reads alphabetically.

Dishes are swept like disguises — `db/index.js`'s expiry pass deletes
`ephemeral` `custom-craft-` rows nobody holds, that no room holds, and that
no Offer or CraftProject pins.

## 2a. The three tiers

31 recipes in `docs/tags.yaml`, gated on `cooking-basic` (Basic) or
`cooking-skilled` (Skilled, Skilled Lavish — `cooking-skilled` carries
`parentTag: cooking-basic`, so a skilled cook can still make every Basic
recipe). Exact values (base mood/hunger/taste, turn cost, ingredients) live
in the catalog, not duplicated here — this is the shape, not the numbers.

**Fixed base ingredients**, authored as an ordinary `requirement.items` list
— the same mechanism every other craft recipe uses, not a special case.
Consumed automatically the moment the recipe is picked; the cook never
chooses them. A base ingredient that is itself a cooked dish (most of the
Skilled/Skilled Lavish tier builds on Bread) is named with `customOf:`, never
`tag:` — a cooked Bread never keeps the bare `bread` slug once it's minted,
so a plain `tag:` reference would never see one.

**A recipe needing more than one choice** (Vegetable Stew: "Potato +
(Carrot/Onion), Carrot + Onion") authors **several `anyOf` pickers** in one
`items:` list — `db/lib/tagShapes.js` stamps each with a 0-based
`pickerIndex`, and the Craft dialog posts one choice per picker
(`ingredientPicks: string[]`) instead of the single `ingredientChoice` every
one-picker recipe (and the Death Mask's corpse pick) still uses. Two pickers
naming the same options (Fried Fish's two fish choices, Sweets — here,
"Honeyed Sweets", see below) are legal; `resolveRecipeItems` merges a spend
by tagId when two pickers land on the same slug, so it reads as one
cumulative need against the actual stack, not two independent short reads.

**"Quantity Produced"** — `Tag.requirementYield`, authored as
`requirement.yield`. Null means 1; Hash Brown/Egg in the Hole/Scones make 2,
Pizza Slice makes 3. Multiplies onto the stack `grantCrafted` writes
(`quantity * (recipeTag.requirementYield ?? 1)`), same point in the pipeline
Distilling's doubling already lives — downstream of the ingredient spend and
the ⬢ cost, which price off the craft's own `quantity` alone. The "made:"
label reflects the produced count; Distilling's doubling deliberately still
doesn't (`craftRequestImpl#producedQuantity`, precedent kept on purpose).

**The additional-ingredient layer sits on top**, unchanged from the old Fine/
Lavish mechanism: `ingredientSlots: { min: 0, max: 4 }` on every recipe (4 is
`IngredientSlots.js`'s own ceiling; the design doc names no cap), and what
the cook slots there is what the minted dish actually carries on eating —
§7's mood sum and §8's taste line both read the additional ingredients, never
the fixed base.

One authored collision, worth knowing about: the design doc's "Sweets"
(Honey/Sugar + Honey/Sugar) collides with the pre-existing `sweets` Depot
candy — both would read "Sweets" on one sheet. The new recipe ships as
**Honeyed Sweets** (`honeyed-sweets`) instead; the old candy is renamed
`sugar-candy` (Sugar Candy) rather than the other way round, since the recipe
is the newer, doc-specified thing and the candy is an incidental curio.

## 3. `cooked:` — what a tag contributes as an ingredient

```yaml
  fish-roe:
    cooked:
      taste: "little crunchies"
      mood: 28
      into: [nauseous]        # OPTIONAL — read §4

  tomato:
    cooked:
      taste: acidic
      tasteForm: adjective    # OPTIONAL — see below
      mood: 3
      hunger: 12              # OPTIONAL — see below
```

**The presence of this block is the only thing that makes a tag cookable.**
There is no `ingredient: true`, and no recipe names a legal ingredient
anywhere. **58 tags carry one** — the thirteen new ones plus every brew, drug,
body part and relic worth putting in a pot — and adding the fifty-ninth is one
YAML entry and a `db:sync-tags`.

- **`taste`** is a *fragment*, dropped into the middle of one sentence, so it
  is lowercase and under 40 characters. `taste: ""` is legal and means
  **undetectable** — Phrygian Tears and Adder's Bite, the two things a cook
  can hide in a meal with no tell at all. The key is still required, so an
  empty taste is a claim somebody made rather than a field somebody forgot.
- **`mood`** is signed, on the `MOOD.md` scale.
- **`into`** is what it grants the eater, in the same shapes `consumesInto`
  takes (`oneOf` included).
- **`hunger`** is optional — a whole number from 0 to 100, how much this
  ingredient restores on the 0-100 hunger meter (`foodHungerFor`,
  `db/lib/hunger.js`). Absent means "not really food" — eating it still grants
  `ate-meal` if it's tagged for that, but restores nothing.
- **`tasteForm`** is optional and only ever `"adjective"`. By default
  `web/lib/cooking.js` renders `taste` as a noun ("It tastes like onions.");
  `tasteForm: "adjective"` renders it bare instead ("It tastes acidic.").
  Existing tags leave this unset and are unaffected — nobody rewrote the 58
  noun-style tastes to add it.

Both fields were added for the new Soilery crop and foodstuff tags (wheat,
potato, meat, cheese, and the rest) — see [`SOILERY.md`](SOILERY.md) §6 for
the full list and where each one lives.

## 4. Raw is not cooked

**An ingredient with no `into` contributes its own `consumesInto`.** That is
not a fallback, it is the mechanism, and it makes the tag's two halves say two
different things:

| | Raw (`consumesInto`) | Cooked (`cooked.into`) |
|---|---|---|
| Onion | `[]` — nothing | absent → nothing |
| Deep Morel | `[nauseous]` | `[]` — cooking takes the nausea off |
| Moonshine | tipsy, blind-drunk, damaged-vision | absent → all three, still |
| Human Flesh | `[ate-meal]` | `[{oneOf: [nauseous, vomiting]}]` |
| Squeeze | `[seizure]` | absent → a seizure, still |

`into: []` and an absent `into` are **different claims**. The first says
"contributes nothing"; the second says "whatever I do raw". Nine of the
thirteen new ingredients do nothing raw and say so with `consumable: true`
and an empty `consumesInto` — you can put a raw onion in your mouth, and then
nothing happens, which is a real answer rather than a missing one.

**Cookable and edible are different claims.** The six body parts are not
consumable at all and carry `cooked` blocks: nobody gnaws a raw hand, and a
hand in a stew is very much a thing that can happen.

## 5. Medicine in a stew

Half of this needed no hook and half of it did. The half that did is the more
interesting one, so it goes first.

### `cooked.cures` — the opt-in

The medical pass put cures on their own `Tag.cures` column rather than on
`consumesInto`, and a separate column travels nowhere by itself. So an
ingredient's cures ride through the pot only when the ingredient says so:

```yaml
white-honey:
  cooked:
    taste: "medicine"
    mood: 15
    cures: true
```

Default is **off**, because not every cure is swallowed. A tonic somebody
drinks works in a stew; something injected, applied or strapped on does not,
and cooking one into dinner ruins the dinner and cures nothing.

| Rides through the pot | Does not |
|---|---|
| White Honey, Antidote, Fever Draught, Purifier, Antibiotics, Forgiveness | Burn Dressing, Leeches, Cleaning Powder, the two autoinjectors, all six prosthetics |

`db/lib/tagShapes.js#validateCooked` refuses the two shapes that are always
authoring slips: `cures: true` on a tag carrying `administerSkill` (that whole
column is cures a doctor *fits*), and `cures: true` on a tag that cures
nothing. `mergeDishCures` in `web/lib/cooking.js` does the union, and
`curesInto` — the aftermath a cure leaves — merges beside it, last ingredient
winning a collision.

A **dish never carries cures of its own.** A minted dish is a custom craft
off a recipe with no cure on it; the ingredients are the only place one can
come from.

### `into` — the half that was free

White Honey, Mercy, the Cat and the rest carry a `taste` and a `mood`
and **no `into`**, deliberately. They therefore contribute their own live
`consumesInto`, read at the moment somebody eats the dish rather than frozen
in when it was cooked. Whatever the medical pass makes a medicine *grant*, it
grants in a stew too — for every dish already sitting in every pocket, on the
next bite, with no re-mint, no backfill and no code here.

That is the whole reason effects are derived late (§6). A *new* medical
consumable wants a `cooked:` block with a taste and a mood, `into` left alone,
and `cures: true` only if it is a thing you drink.

## 5a. Poison in a dish

Poison reaches a meal by two routes and they behave differently, which is
worth holding in your head before changing either.

**Laced.** Somebody ran `poisonItemRequest` over the finished dish, or over an
ingredient the cook then used. Either way the taint rides the real stack as
`poisonedCount` / `poisonPayload`, drawn hypergeometrically when units leave,
and the medical pass's existing marker catches it.

**Cooked in.** The cook simply used something poisonous — phrygian tears.
This is *not* lacing: the poison rides through
`mergeDishGrants` as the ingredient's own `consumesInto`, and there is no
`poisonedCount` anywhere to notice. This route used to be invisible to Poison
Sense, so a palate that caught a laced bowl missed a bowl that came out of the
pot poisonous.

`dishCarriesPoison` closes that: a dish also reads as tainted when any slug in
its `cookedFrom` is flagged `poison: true`. Derived off `cookedFrom` at read
time like everything else here, so re-flagging an ingredient fixes every dish
already in every pocket.

**Phrygian Tears becomes visible in a dish**, which its authored-empty taste
deliberately hides. That is the intended trade: the tell costs a 5-point trait
or a held gadget (`db/lib/poison.js`), so a Phrygian dish still reads as an
ordinary meal to everyone at the table who has not paid for a palate.

**Iron Constitution shrugs off `nauseous`** alongside the `vomiting` it
already resisted. The seven flesh ingredients roll `oneOf: [nauseous,
vomiting]`, so before this the trait worked on exactly half of a mouthful of
hand, at random — and a raw Deep Morel or Blind Fish got through it entirely.
It stops there on purpose: `phrygian-toxin`, `seizure`, `hallucinating` and
`damaged-vision` are what their items are *for*, not upset stomachs.

## 6. Eating one

`consumeTagRequestImpl`, when the row has a `cookedFrom`:

1. Load the ingredient rows, put back in `cookedFrom` order. A slug that no
   longer resolves is dropped rather than throwing — the dish is already in
   somebody's hands.
2. `mergeDishGrants` (`web/lib/cooking.js`) concatenates the meal's own
   `consumesInto` with each ingredient's cooked contribution, and
   `resolveConsumeGrants` runs **once** over the merged list. One call is
   load-bearing: it tracks what the eater *will* hold across the list, which
   is how the drinking ladder resolves against a rung the same swallow just
   granted. Two calls would each resolve against a stale sheet and
   double-grant.
3. `mergeDishCures` unions the `cures` of every ingredient that opted in with
   `cooked.cures: true` (§5), and the medical pass's cure loop reads that
   merged list rather than the dish row's own.
4. `applyHiddenCures` for the meal **and each ingredient**, so a pie made with
   leeches still takes the bruise off. (Hidden cures are a separate, older
   mechanism from `Tag.cures` — `db/lib/hiddenCures.js` — and they need no
   opt-in.)
5. Mood (§7).
6. Return `{ line }` — the taste sentence.

## 7. Mood

**[`MOOD.md` §6a](MOOD.md) is canonical** — it sits with the rest of the mood
tables, which is where somebody asking "what moves the dial" will look. In
short: `dishMoodTerms` sums the meal's own small figure and its ingredients'
(rather than taking a max, the way every other consume does), returns harm and
relief as two terms so only the harm half is scaled, and flags the harm
`noMultiplier` so nothing in the fright table makes disgust free.

The recipe's own figure is deliberately tiny beside its ingredients' — 2 to
10 across the 31 recipes (§2a), against +45 (saffron) to −55 (feces).

## 8. The taste line

One sentence, in the bottom-right notice (`NoticeProvider`). `tasteLine(mealName,
entries)` (`web/lib/cooking.js`) takes the meal's own name and an array of
`{ taste, adjective }` — the recipe's own `mealTaste`/`mealTasteForm` FIRST,
then one entry per additional ingredient's `cooked.taste`/`cooked.tasteForm`
(§2a/§3). The design doc's exact wording: "You eat the [meal], it tastes
[flavour], [flavour], …, and [flavour]." — replacing the old, ingredient-only,
mealess "You ate a meal. It tastes like X." Empty tastes are dropped rather
than printed as a gap; no fragments at all reads as "bland" (the two
undetectable poisons, or a plain Bread eaten alone, both land here).

A taste fragment renders bare (`tasteForm: "adjective"` — "acidic") or as a
noun (`"like onions"`, the default, unmarked on the 58 legacy tastes) — same
rule `cooked.tasteForm` always had, now shared with the recipe's own
`mealTaste`.

**Both eating paths raise it.** The one-click Consume on the tag rail is how
people actually eat; it used to throw the server's result away, which would
have meant the taste line only ever reaching the handful who go through the
Actions grid.

**One real bug fixed alongside this rewrite**: `cooked.tasteForm` was
validated and stored since the Soilery pass (SOILERY.md §6) but never
actually read anywhere — `web/lib/tagChipRows.js#cookedTasteOnly` (the
server-side cut before a tag's `cooked` block reaches the browser) dropped it,
so every adjective-form taste (every Soilery crop) printed as "like acidic"
in the Craft dialog's ingredient chips. Both are fixed now: `cookedTasteOnly`
keeps `tasteForm` alongside `taste`, and `tasteLine` actually reads it.

## 9. `ingredientSlots`

```yaml
    requirement:
      ingredientSlots: { min: 1, max: 2 }
```

A **sibling** of `requirement.items`, not another `anyOf`. The legal set is
"any tag carrying a `cooked` block", which no authored list could keep up
with. `requirement.items`'s own `anyOf` no longer caps at one picker per
recipe (§2a — Cooking's multi-ingredient tiers needed more), but
`ingredientSlots` is still the separate door for "any cookable tag, not a
named list" — the Death Mask and the Dreamer's Draught still use `anyOf`/
`group` because they need a *specific* item or a corpse, not "anything that
tastes of something."

Refused on anything not craftable, on a `placement`, and on a **multi-turn
project**: the mint happens on the finishing turn, days after the cook picked,
and nothing carries the slugs that far. Put slots on a 2-turn recipe and they
would have to ride on `CraftProject.custom`.

The server re-checks membership, possession and the count in
`resolveIngredientSlots`. **The same slug twice is refused** — it keeps "it
tastes like onion and onion" off the notice, and it keeps the spend honest.

### The Honey discovery moved, and got better

**`isNonPublicRecipe` must ignore `requirementIngredientSlots`**
(`character/page.js`, which says why at the function). A slots recipe names no
ingredient, so reading its slots the way `items` is read would mark both meals
non-public and hide dinner from the whole game. The secret lives in the chip
list now: Honey appears as something you can slot only if you hold a jar.

## 10. The dialog

Cooking is a **branch inside the Craft dialog**, not a screen of its own: a
cook spends the same Move, pays the same way and stacks the same batch, and
forking `CraftDialog.js` to change one control would double the maintenance.

`IngredientSlots.js` draws a `.slot-row` of `max` slots over `ChipPicker`'s
own row — boxed in a bounded `.pantry` that scrolls, since 58 cookable tags is
well past the "short, local list" ChipPicker's header asks for — borrowed
rather than re-typed — the one thing it needed that
ChipPicker lacked (more than one live answer at a time) is now a per-option
`active`. Click a chip, it fills the first empty slot; click a slot's ✕, it
comes back out.

**The cook is told the taste and nothing else.** No mood figure, no effect
list, no hint that the thing they are about to serve will make somebody vomit
(Bascinet, 2026-09-09). You learn an ingredient by using it, and poisoning
somebody is meant to be a gamble the poisoner takes too.

That is enforced a layer down, not just left to the component:
`web/lib/referenceData.js#cookedTasteOnly` cuts the `cooked` block to its
taste on the server before it crosses, so there is nothing in the browser to
leak. **`cookedFrom` is not in `TAG_CHIP_FIELDS` at all** — a dish says what
it tastes of and never what it was made with. Do not add it.

`/gm/turns` keeps the full block (`moveRows.js`), which is right: a GM
adjudicating should see everything.

## 11. Where the ingredients come from

| Source | What |
|---|---|
| Hunting | Boar Loin, Deer Liver, Goose Fat |
| Fishing | Crayfish everywhere; River Eel in the Forest, Lamprey in the Marshes, Blind Fish in the Caves |
| Farming | Onion (the commonest and cheapest of the thirteen, on purpose) |
| Caving | Rock Salt, `ultracommon` in `db/lib/cavingLoot.js` |
| Room stashes | 3 Deep Morels scattered across the Caves and Depths, 4 more in the Godshroom; 5 Hard Cheeses across the cellars |
| The Depot | Saffron (15 ⬢, three cigarettes), Tinned Butter (10 ⬢) |

Room stashes are a **seed, never a top-up** — the "Seed these items now"
action at `/gm/dev/zones` (`seedRoomStash`, `web/app/(app)/gm/dev/zones/actions.js`):
once the five cheeses are eaten there are no more.

**The fragmentation grenade lands at 0.067% — about 1 in 1,500 draws.**
Getting there is what made the old mining drop die adopt caving's rarity
tiers: under the old uniform draw the floor was 1/poolsize and it would have
shipped eight times too common. (That die is gone now — `MINING.md` §3b — but
the tier vocabulary it borrowed is still `CAVING.md` §3's.)

## 12. A catalog bug fixed here

Found wiring this up, and load-bearing for it — a poison ingredient has to
actually poison somebody.

- **Phrygian Tears** promised `{tag:phrygian-toxin}` and had **no
  `consumesInto` at all**, so the most expensive poison a Brewer can make did
  nothing when drunk. Only Adder's Bite and the installed poison tooth ever
  granted the toxin.

The Cat and the Mindbreaker Toxin also moved to `catalog: gm`, on Bascinet's
call — they are hidden recipes the way Honey and White Honey are.
