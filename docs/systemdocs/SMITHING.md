# Smithing

This is the canonical tier ladder for weapons and armor. Price a new combat
item off this table, not by feel. If you change a number here, also change
the price-scale comment at the top of the weapons block in `docs/tags.yaml`
and the mention in [`TAGS.md`](TAGS.md) §4a.

Changing `Turns` here also changes what a merchant pays for the finished item —
[`DEPOT.md`](DEPOT.md) §4 derives the Merchant's sell price from this table's
`⬢` and `Turns` columns plus the skill gate, not by feel either.

## 1. Skills

| Slug | Name | pt | Gate |
|---|---|---|---|
| `crafting` | Crafting | 2 | none |
| `smithing` | Smithing I | 5 | none |
| `smithing-skilled` | Smithing II | 5 | `parentTag: smithing` (cumulative, total 10) |
| `smithing-gunpowder` | Smithing (Gunpowder) | 9 | `requiredTag: smithing-skilled`, `mastery` |

A full gunsmith is `smithing` + `smithing-skilled` + `smithing-gunpowder` =
5 + 5 + 9 = **19 pt**.

**Smithing (Gunpowder) is a `mastery` tag** (2026-09-10, `TAGS.md` §4a), so
nobody starts the game a gunsmith — the rung is bought from `/store` with
points earned in play. Its 9 pt sits below the 12–15 mastery band on purpose:
the band prices a capstone that stands alone, and this one already costs 10 pt
of prerequisites before it can be bought at all.

## 2. Tiers

Materials cost (the ⬢ column) was cut ~15% across the ladder as a rebalance
pass, then a further ~5% (2026-09-12, the same pass that trimmed medical and
brewing). Dead Simple's 3 ⬢ and Simple's 6 ⬢ are unchanged — 5% off either
rounds back to itself — every rung above Simple moved again. `pt`, `Turns`,
and every gate are untouched.

| Tier | pt | ⬢ | Turns | Skill gate | Combat gate | Purchasable at start |
|---|---|---|---|---|---|---|
| Dead Simple | 2 | 3 | 0.25 | `crafting` OR `smithing` | none | yes |
| Simple | 5 | 6 | 1 | `smithing` | `melee-basic` / `ranged-basic` | yes |
| Moderate | 7 | 13 | 1 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| High Quality | 9 | 25 | 2 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Exceptional | 14 | 32 | 3 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Gunpowder | 14 | 28 | 2 | `smithing-gunpowder` | `ranged-basic` | no (mastery gate) |

Bows use `crafting` in place of `smithing` at every tier. The Crossbow does
not — its steel prod and lock are `smithing-skilled` work.

**Four small pieces of metalwork run under the Simple rung's Turns column.**
The Spear, Dagger, Silver Knife and Phrygian Spear are `turnsCost: 0.25` —
a spearhead or a knife is not a day at the anvil — so four of them fit in
one Routine ([`CRAFTING.md`](CRAFTING.md) §2a). Everything else about the
rung (6 ⬢, the pt, the skill gate, the forge) is unchanged, and they sell
at 8 rather than the tier's 16 ([`DEPOT.md`](DEPOT.md) §4): four a Routine
pays 8 ⬢ a turn, which stays under the Simple rung's own 10, and §4's rule
is that quick work is never paid better than the rung above it. They were
thirds selling at 9 until costs became decimals in 9/2026 — the price came
down with the extra unit. The Silver Knife is the odd one out and always was:
1 ⬢ in and a silver ingot, 9 out. The Gladius, Mace and Battle Axe stay a
full turn — a sword blade or a flanged head is real forging.

**The two gate columns mean different things and are enforced on different
surfaces.** The Skill gate is what it takes to *make* the item; the Combat
gate is what it takes to *use* it. Character creation and `/store` enforce
the Combat gate (`requiredTag`) — you can't buy a Crossbow at creation
without Ranged I. The **Craft menu enforces the Skill gate, not the
Combat gate** (`db/lib/medicalVision.js#satisfiedSkillIds`,
[`CRAFTING.md`](CRAFTING.md) §2, [`TAGS.md`](TAGS.md) §3b): the picker's "To
make: …" line shows the Skill gate as a requirement, checked server-side, not
just guidance. Nothing checks the Combat gate at craft time, so a smith with
`Smithing II` and no `Melee I` can still forge a sword they
can't swing; a fighter pulling a sword from their clan's armoury still files
the same request with the fiction as their justification — that half of the
honor system stands, it's just the Skill half that's now enforced.

## 2a. Workshop Equipment

**Smithing and building need a forge, where smith's work is unavoidable.** A
recipe requires **Workshop Equipment** in reach — held, sitting in a Room
stash you can get into at your Location, or served by a **COMPLETE** structure
whose `placement.provides` lists `workshop-equipment` (`db/lib/equipmentReach.js`,
the same predicate the private-room threads are synced with) — held kit, room
stash, or standing forge are the three reaches, and a Forge serves everyone
standing at its Location permanently, no hauling and no door. A `DAMAGED`
forge serves nobody — the same `COMPLETE`-only reading `structureTools` uses
for laboring tools (`LABORING.md` §5). All of this applies when the recipe
names a `smithing-*` or `builder-*` skill **and does not offer `crafting`**. A
recipe whose type carries `placement.fieldwork: true` — a light field
structure — skips the workshop rule entirely.

That second half matters, and **this paragraph used to get it wrong**. It said
every Dead Simple recipe listed `skills: [crafting, smithing]`, so none of them
needed a forge. The rung was written that way meaning "either skill", but
`requirementSkills` is an AND, so it demanded both — and it was split by
material to fix that. Nothing in the catalog lists the pair now. A sling or a
club lists `skills: [crafting]` and stays something you whittle; the five metal
Dead Simple recipes (work knife, hatchet, cudgel, pitchfork, armored gloves)
list `skills: [smithing]` and went behind a forge for the first time as a side
effect of the split. What is gated, then, is every Simple rung and up, those
five, plus the Cart and the Plow.

The rule is read off the recipe's own skills rather than a per-tag flag, so a
new sword is gated the moment it names a smithing skill and nobody has to
remember a second field. `needsWorkshop()` in `web/lib/tagRequests.js` is the
one copy, shared by the Craft dialog and `craftRequestImpl`.

`workshop-equipment` is itself a **High Quality** craftable — 9 pt, 25 ⬢, 2
turns, `smithing-skilled` — and **Immense (100 lb)**, so it is a real decision
to move one. It is the one recipe **exempt from its own gate**, and has to be:
gating it would mean nobody could ever build the first forge. You raise that
one in the open, and it is what lets you do the finer work after.

It replaced the old `workshop` **Asset**, which was 2 pt, creation-only, and
gated nothing — its own description admitted "You don't need this to craft".

Crafting is always filed as a Routine now, never a Gambit — the Craft button
(the old Add Tag) enforces a recipe's skills server-side, and Dead Simple
recipes bill their quarter of a Move the same as any other 0.25-turn rung
(`CRAFTING.md`).

A 0-turn recipe may also set **`requirement.perTurn`**, its own RATION —
there is no shared pool behind it any more, so this is the only free
allowance a `turnsCost: 0` recipe gets (bone-mask at 1). Work is never
written there: a recipe cheaper than a whole turn
authors a decimal `turnsCost` on a quarter, and `quantity × work` against the
Move is the only quantity limit a Move-costing recipe has
([`CRAFTING.md`](CRAFTING.md) §2–§2a). A plain `turnsCost: 1` rung — every
tiered weapon but the four 0.25-turn small pieces in §2 — makes one per
Routine by that arithmetic.

**Dead Simple costs a quarter of a Move now, not nothing.** It changed in
9/2026 (`DEPOT.md` §4): it used to be `turnsCost: 0` with a shared 4-a-turn
free ration, which meant four saleable things a day riding free on top of an
untouched labour day. It is `turnsCost: 0.25` now, ordinary `CRAFTING.md` §2a
Move math, and nothing more — four fill a Routine exactly, the same as any
other 0.25-turn rung. The shared pool (`DEAD_SIMPLE_PER_TURN`) is gone from
`web/lib/tagRequests.js` and does not come back; `craftAllowance()`
(`web/lib/requests.js`) now only honours a recipe's own `perTurn`, and Dead
Simple names none. Its flat markup is unchanged at **+3 ¢** — cutting it as well
was nerfing one rung twice for one problem (`DEPOT.md` §4).

**Not every Dead Simple smith recipe is a weapon.** `branding-iron` gates on
`skills: [smithing]` the same as Work Knife and Hatchet, but it's a standing
kit rather than a Recipes-tab rung — no `group`, `pointCost: 0`, same shape as
Torturing Equipment (§5 note in `TORTURE.md`) — so it doesn't appear in the
weapon table below. See `TORTURE.md` §8 for what it does once crafted.

**Past four a turn, the Move is simply gone.** Dead Simple has no allowance
of its own to overflow past any more — at 0.25 of the Routine each, four of
them already spend the whole thing, the same as any other 0.25-turn rung
(`CRAFTING.md` §2a), and a fifth is refused for the ordinary reason: no Move
left. Filing one also locks that Routine to the recipe's family of work, so a
smith who spends the day on knives cannot also file a sling or a Simple sword.
A recipe that still carries its own `perTurn` (bone-mask's 1, `bliss`'s 2) is
a different case — those stay `turnsCost: 0` and keep the old overflow rule,
where a unit past the ration bills `1/perTurn` of the Move instead of being
refused outright. [`CRAFTING.md`](CRAFTING.md) §2a is the full rule.

The Skill gate itself (a recipe's `requirementSkills`) is an **AND list and is
enforced** — see [`TAGS.md`](TAGS.md) §3b. The rung splits by material:
`crafting` for the wood-and-cord items, `smithing` for the metal ones, which
puts the metal half behind a forge.

Every combat item is `purchasable: true, purchasableAfterStart: false` — buy
at creation or have someone craft one in play. Found-only items
(`purchasable: false`) sit outside the ladder — a craftable gated behind a
hidden-category skill (§3a of `TAGS.md`, or a future one like it) works the
same way: it's priced on its own terms, not a rung of this table. The Cult
of Bacchus's `smithing-bacchus` craftables (Nailgun, Armor Robes, Nails of
Life) used to be the example; they're archived in
`docs/archive/bacchus.yaml`.

## 3. Weapons

**Eleven of the weapons below are `customizable:`** — the plain ones. Cudgel,
Work Knife, Dagger, Spear, Gladius, Mace, Battle Axe, Halberd, Broadsword,
War Hammer, Bastard Sword. +1 ⬢ lets the smith stamp their own name and
words on the piece, the same door as the Badge and Hat (`CRAFTING.md` §4a),
and it takes **Smithing II** to open — whatever tier the piece itself
is, so a basic smith forges a plain dagger and cannot sign it.

Nothing else on this ladder carries the flag. The named and exotic pieces are
somebody else's design already (Katana, Lucerne, Phrygian Spear, the silver
pair), the bows and the sling are `crafting` work rather than smith work, the
guns and the Bomb are Gunpowder, and the Pitchfork is a farm tool. Trench
Knife has a harder reason: its torture bonus is keyed to the held tag's exact
slug, which a mint never matches (`CRAFTING.md` §4a on `customOfSlug`).

| Weapon | Tier | Notes |
|---|---|---|
| Cudgel | Dead Simple | `smithing` |
| Work Knife | Dead Simple | `smithing` |
| Hatchet | Dead Simple | `smithing` |
| Truncheon | — | Not craftable at all, by design. Cerberi and Order issue. |
| Sling | Dead Simple | `crafting` |
| Quarterstaff | Dead Simple | `crafting` |
| Pitchfork | Dead Simple | `smithing`. Carries the farming `laborBonus`, moved off the Hatchet. |
| Shortbow | Dead Simple | `crafting` |
| Spear | Simple | 0.25 turns — four to a Routine (§2) |
| Dagger | Simple | 0.25 turns — four to a Routine (§2) |
| Silver Knife | Simple | 0.25 turns — four to a Routine (§2). Spends one `silver` — its 6 ⬢ total is unchanged, the resourceCost is just 1 ⬢ of it now (2026-09-09). |
| Gladius | Simple | |
| Phrygian Spear | Simple | 0.25 turns — four to a Routine (§2) |
| Javelin | Simple | `ranged-basic` — it is thrown, not held. |
| Longbow | Simple | `crafting` |
| Mace | Simple | |
| Battle Axe | Simple | |
| Knuckle Duster | Moderate | `visible: worn` — pocketable. Priced at 5 pt, not the tier's 7 — a pre-existing outlier, not introduced by the Combat Update. |
| Halberd | Moderate | Renamed from Bardiche in the Combat Update; the slug moved with it. |
| Broadsword | Moderate | |
| War Hammer | Moderate | |
| Bastard Sword | High Quality | |
| Rapier | High Quality | Spends one `steel`. 1 turn / 17 ⬢ now, not the tier's 2 / 25 — the other turn moved into steel's own recipe, and 8 ⬢ comes off for the ingot (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |
| Sabre | High Quality | |
| Katana | High Quality | Spends one `steel`. 1 turn / 17 ⬢ now, not the tier's 2 / 25 — same move as Rapier (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |
| Silver Spear | High Quality | Spends one `silver` — its 25 ⬢ total is unchanged, the resourceCost is just 20 ⬢ of it now (2026-09-09; materials cut a further ~5% 2026-09-12). |
| Lucerne | High Quality | |
| Zweihander | High Quality | |
| Crossbow | High Quality | |
| Musketoon | Gunpowder | Priced at 18 pt, not the tier's 14 — a pre-existing outlier, not introduced by the Combat Update. |
| Bore Pistol | Gunpowder | Materials cost 18 ⬢, not the tier's 28 — a pre-existing outlier, not introduced by the Combat Update. Priced accordingly in `DEPOT.md` §4. |
| Bomb | Gunpowder | `purchasable: false` (craft-only). Spends one `black-powder` per unit on top of its 28 ⬢ — the one ladder recipe with an ingredient. |

**Off-tier recipes with ingredients.** Three smaller recipes sit under their
own prices, each spending an ingredient (`requirement.items`, enforced and
consumed like any brew's):

| Recipe | Skill | ⬢ | Turns | Spends |
|---|---|---|---|---|
| `black-powder` | `smithing-gunpowder` | 3 | 1 | `saltpeter` (raw, mined) |
| `gunpowder-grenade` (**Crude Grenade**) | `smithing-skilled` | 6 | 1 | `saltpeter` (raw, mined) |
| `steel` | `smithing` | 4 | 0.25 | `coal` (Merchant stock or mined) |

The grenade came over from Brewing II on 2026-09-05 — a powder device
out of a still was always odd — and its group moved to `items-weapons` with
it, the Smithing-family group the Recipes tab renders by.
Renamed **Crude Grenade** and dropped to Smithing II on 2026-09-06
(Chris): it packs raw saltpeter, not powder, so the Gunpowder rung keeps only
the true powder-work — `black-powder`, the Bomb, the guns. The slug stays
`gunpowder-grenade`. `black-powder` is the refining step between mined
saltpeter and the Bomb; its numbers (3 ⬢, sells 6) are drafted, not signed
off.

**`steel`** (2026-09-09, repriced 2026-09-10) is the same shape as
`black-powder` — priced at cost, no smith's margin, `sellablePrice` (8) equal
to its own `resourceCost` (4) plus coal's (4). Gated at plain `smithing`
rather than `smithing-skilled` on purpose: smelting ore into a usable ingot is
basic forge work, and it's only the four recipes that SPEND it — `katana`,
`rapier`, `brigandine`, `plate-armor` — that need the higher skill to shape it
into something fine.

It is the fifth recipe under the Simple rung's Turns column (§1): `turnsCost:
0.25`, four ingots to a Routine, for the same reason the Spear and the Silver
Knife run there — an ingot is not a day at the anvil. Each of the four recipes
that spend one gave up a full turn of its own (the smelting the smith no
longer does inside them) and 8 ⬢, the ingot's value — so a smith who smelts
his own pays the ladder's ⬢ exactly, and a quarter of a turn on top. **This
undercuts the ladder's Turns column on purpose:** High Quality steel gear is
a 1.25-turn job now rather than 2, Plate 2.25 rather than 3. See the Weapons and
Armor tables above. `{tag:silver}` got the same
`Prospecting`-sourced treatment the same day, but stays a raw material with
no recipe of its own — silver needs no smelting, so there was nothing to
split out of `silver-knife`/`silver-spear` beyond the ingredient itself.

Off the ladder — no recipe, no smithing gate:

| Weapon | pt | Notes |
|---|---|---|
| Sword Cane | 7 | Sold complete. `visible: worn` — it reads as a cane until it's drawn. |
| Neoclassic R&W10 | 14 | Bought at creation only — not craftable. Requires `ranged-basic`. |
| Cracked Bone Club | 0 | Found only. |
| Neoclassic Duelista | 0 | Found only. |
| Disabler | 0 | Cerberon-issued. |

### The Plow

Not a weapon, but it is smith work: `plow`, 5 points, `turnsCost: 1`,
`resourceCost: 10`, `skills: [smithing]`. It is an **Asset**, not an Item, so
it never weighs on your back — it lives in your shed and the horse does the
hauling. It is the one Laboring tool that needs no equipping and the only one
gated on holding something else — without a `horse` it does nothing at all. Worth +4 ⬢ to Farming, the largest single tool
bonus in the game, because two tags and a smith stand behind it
(`LABORING.md` §5).

## 4. Armor

Every piece below is `customizable:` (2026-09-09) — the same +1 ⬢ and the
same **Smithing II** rung as the eleven weapons in §3, including the
pieces that are `crafting` work to make. Armor is where a maker's mark is
most worth having, so the whole table gets it rather than a chosen few.

It needed one more change first: armor was never `stackable`, which
`validateCustomizable` requires (`CRAFTING.md` §4a), because one Breastplate
ever was the entire enforcement of "you already have that tag." Bascinet's
call: it's fine for a character to carry more than one, so every recipe here
is now `stackable: true` too. Nothing else about the equip rig needed to
change — a stackable, layered, equippable tag already worked (the Hat proved
it), so a second Breastplate just contests the first one's BODY/3 layer
exactly like a second Hat would (`db/lib/equipSlots.js`). Armored Gloves
(§2a) got the same treatment even though it isn't in the table below — and
it is one of the pieces `db/lib/godflesh.js` reads back by slug, so a signed
pair still counts at the Spillway (`CRAFTING.md` §4a).

| Armor | Tier | Notes |
|---|---|---|
| Padded Armor | Dead Simple | `crafting` |
| Padded Cap | Dead Simple | `crafting` |
| Buckler | Dead Simple | |
| Simple Helm | Simple | |
| Mail Coif | Simple | |
| Shield | Simple | `crafting` |
| Pavise | Simple | `crafting` |
| Mail Shirt | Moderate | |
| Gladiator Helmet | Moderate | Also on the Merchant's shelf at 45 ⬢ (`DEPOT.md`). Optional conceal. |
| Knight's Helmet | High Quality | Force conceal — a closed helm is not a face (`PROXYING.md` §5). |
| Censor's Helmet | High Quality | Force conceal |
| Brigandine | High Quality | `visible: worn` — plates inside a coat, so it shows only while worn. Spends one `steel`. 1 turn / 17 ⬢ now, not the tier's 2 / 25 (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |
| Breastplate | High Quality | |
| Plate Armor | Exceptional | Spends one `steel`. 2 turns / 25 ⬢ now, not the tier's 3 / 32 (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |

Off the ladder:

| Armor | pt | Notes |
|---|---|---|
| Salvage Plate | 2 | No skill gate. |
| Energy Shield | 0 | Not smith work at all — Merchant stock at 145 ⬢, or the rarest rung of cave loot. |

Off the ladder in the other direction: **Trinket**, `smithing`-gated and a
whole Move like everything above, but priced by a die roll rather than a
row in either table — see [`TRINKETS.md`](TRINKETS.md).
