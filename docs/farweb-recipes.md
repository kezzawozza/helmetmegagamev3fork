# Farweb recipes, scrounged

Everything Farweb let a player make, pulled out of the open-source release at
`SS13-Special-Codebases-Archive/OpenSourceWeb` (commit `edb003dc`, March 2022).
Farweb was the Brazilian-run successor to Lifeweb, so this is the closest
surviving picture of the kitchen, still, mushroom bench and forge that
Bascinet's own systems descend from. Reference only. Nothing here is wired
into the game.

One thing to know before reading: the archive ships a lot of files that are
**not compiled**. The build list is `farweb.dme`, and only what it includes
ran on the server. Two big recipe files are missing from it:
`recipes_microwave.dm` (134 stock SS13 microwave dishes) and `snacks_bs12.dm`
(a sandwich system). Both are left out below. What follows is what actually
ran.

## 1. The kitchen

### The Furnace

Farweb's oven is the SS13 microwave with the name changed
(`code/game/machinery/kitchen/microwave.dm`). A mason builds one from 5 stone.
You load ingredients in, then touch a lit torch to it. It waits 10 to 20
seconds, then either produces the one dish whose ingredient list **exactly**
matches what is inside, or burns the lot into a "burned mess" of carbon and
toxin. Extra ingredients count as a mismatch, so there is no throwing things
in and hoping.

Liquids count too. A recipe that wants 5 milk needs exactly 5 milk poured in
from a glass. Every recipe below that lists "milk 5" once wanted 15 flour as
well, but that line is commented out in the source, so flour never went into
a furnace dish directly. It went in as dough.

### Where raw ingredients come from

| Ingredient | Source |
|---|---|
| Egg | Chickens lay them. Also sold, "Eggs" 10 in the food vendor |
| Milk | Milk a cow or goat with a glass (5 to 10 a go). Also sold, 8 |
| Flour | Wheat through the Mill, or the vendor, 8. A sack holds reagent flour; each dough takes 5 |
| Raw meat | Butchering. Also sold, 25 |
| Butter | Sold as a "Butter pack" (6), sliced with a knife into 5 pats |
| Cheese wedge | Chemistry: 40 milk with 5 enzyme as a catalyst makes a cheese wheel, which knifes into 5 wedges. Enzyme is the catch, see §3 |
| Sugar | A **sweetpod** (a grown crop) on the millstone gives 3 sugar powder |
| Potato, carrot, apple, wheat | Hydroponics seeds |
| Dead rat | Catch one |

The vendor also stocks dough (10), salt, pepper and salami.

### Prep steps, done by hand

These happen on the counter, not in the furnace.

| Do this | Get this |
|---|---|
| Egg on a flour sack | Dough (uses 5 flour) |
| Rolling pin on dough | Flat dough |
| Knife on flat dough | 3 dough slices |
| Knife on raw meat | 3 raw cutlets |
| Knife on potato | Raw potato sticks |
| Knife on cheese wheel | 5 cheese wedges |
| Knife on butter pack | 5 butter |
| Sweetpod on millstone | 3 sugar powder |
| Bone on millstone | 3 bone powder |
| Raw meat in the Food Processor | Raw meatball |
| Carrot in the Food Processor | Carrot fries |

The Food Processor is stock SS13 machinery that needs power, so on a map
without it, the meatball recipe below is unreachable.

### The 19 furnace recipes

`code/modules/food/recipes_furnace_lw.dm`. "Nutriment" is what the dish
feeds you; a raw potato is about 1 for comparison. Every `lw/` dish also
fires a `goodfood` happiness event on eating, which is Farweb's mood system
noticing you ate something cooked.

| Dish | Put in the furnace | Nutriment |
|---|---|---|
| Baked potato | 1 potato | 8 |
| Steak | 1 raw meat | 8 |
| Cutlet | 1 raw cutlet | (stock SS13 item; an unused `lw/cutlet` at 8 exists beside it) |
| Meatball | 1 raw meatball | (stock SS13 item) |
| Fries | 1 raw potato sticks | 12 |
| Omelette | 2 eggs | 10 |
| Rat burger | 1 dead rat, 1 bun | 10 |
| Bun | 1 dough | (stock SS13 item) |
| Flatbread | 1 flat dough | 10 |
| Crackers | 1 dough slice | 8 |
| Loaf | 1 egg, 5 milk | 10 |
| Pancake | 1 dough, 1 butter | 12 |
| Waffles | 1 flat dough, 1 egg | (stock SS13 item) |
| Taco | 1 dough slice, 1 raw meat, 1 cheese wedge | 10 |
| Apple patty | 1 dough slice, 1 apple | (stock SS13 item) |
| Candied apple | 1 apple, 1 sugar powder | (stock SS13 item) |
| Apple pie | 1 dough, 1 butter, 1 apple | (stock SS13 item) |
| Carrot cake | 1 dough, 2 eggs, 2 carrots, 5 milk | (stock SS13 item, sliceable) |
| Cheesecake | 1 dough, 2 eggs, 2 cheese wedges, 5 milk | (stock SS13 item, sliceable) |

A "cheese rat burger" item exists (12 nutriment) but no recipe makes it.

The ingredient's own reagents carry into the dish, minus its nutriment, so a
poisoned apple makes a poisoned pie.

## 2. Drink

### The three machines

`code/modules/destilery/main.dm`. All three are powered SS13 machines with
one rule each.

| Machine | Takes | Gives |
|---|---|---|
| Mill | Wheat | Flour |
| Fermenter | Flour (and needs water topped up) | A bottle of beer |
| Still | A bottle of beer | A bottle of vodka |

That is the whole grain-to-spirit line. Anything else you put in jams the
machine.

### Fermenting by chemistry

The stock SS13 reactions are compiled in (`Chemistry-Recipes.dm`), and this
is the brewing half of them. Every one needs **5 enzyme** sitting in the
container as a catalyst. Enzyme is not sold and does not grow. It comes from
a supply crate or a cyborg's kitchen module, so on Farweb these were more
theory than practice. The bar drinks were bought from the vendor instead
(vodka 18, absinthe 20, rum 20, whiskey 30, wine 40, vintage wine 80,
vermouth 50, beer 8).

| Drink | Ferment |
|---|---|
| Beer | 10 flour |
| Vodka | 10 potato (the reagent) |
| Sake | 10 rice |
| Wine | 10 grape juice |
| Poison wine | 10 poisonberry juice |
| Mead | 1 sugar, 1 water (gives 2) |
| Red mead | 1 mead, 1 blood (no enzyme needed) |
| Moonshine | 10 nutriment |
| Kahlua | 5 coffee, 5 sugar |
| Grenadine | 10 berry juice |
| Melon liquor | 10 watermelon juice |
| Blue curacao | 10 orange juice |
| Cheese wheel | 40 milk |
| Tofu | 10 soy milk |

Also without enzyme: sbiten is 10 vodka and 1 capsaicin, hooch is 1 sugar,
2 ethanol and 1 fuel, a chocolate bar is 2 milk, 2 cocoa, 2 sugar. The rest
of the file is sixty-odd stock SS13 cocktails (gin and tonic, martini, and so
on) that need bar spirits Farweb did not make. Not copied here.

## 3. Alchemy: the nine mushroom powders

`code/modules/reagents/alchemy/`. Three mushrooms go in the mortar
(the tools are a mortar, a pestle and a retort), and out comes a powder holding 3 units of the potion, times
the alchemist's Alchemy skill. The mushrooms are cave crops; every one
carries the description "You probably shouldn't eat this."

| Potion | Mushrooms | What it does |
|---|---|---|
| Hero's Drops | Gryab, Gryab, Zheleznyak | Resets the "tired in bed" cooldown |
| Blessing Baccus | Gryab, Gryab, Bezglaznik | Grows the drinker's member. Past 30 it tears off, 30 to 45 groin damage |
| Bridge of the True Faith | Ovrajnik, Ovrajnik, Otorvyannik | "Walk on air, a short ways." No effect coded |
| Impossible Targets | Zelegreeb, Zelegreeb, Krovnik | "Neither bullets nor arrows catch you." No effect coded |
| Thief's Friend | Zelegreeb, Gryab, Krovnik | Near invisible while it lasts; skill makes it last longer |
| Angel's Mercy | Ljutogreeb, Bezglaznik, Krovnik | Heals 0.5 of every damage type per tick, times skill |
| Lucky Shot | Zelegreeb, Krovnik, Krovnik | "Never miss." No effect coded |
| Rotcleaner | Barhovik, Barhovik, Krovnik | Cleans wound infection by skill; at skill 5+ revives a dead limb |
| Berserker's Sweat | Bezglaznik ×3 | Strength buff, 0.2 per unit, scaled and lengthened by skill |

Three of the nine are names with no code behind them. Other cave mushrooms
exist (Podgnylnik, Plump-helmet, Slezjak, Corniy) but no recipe uses them.

## 4. Farweb's own medicine bench

`code/modules/reagents/lifeweb/lifeweb-recipes.dm`. Farweb replaced SS13's
chemistry dispenser with a set of made-up elements (gallium, cesium,
thorium, californium, rellurium, tantalum, lithium, morphite, iridium,
thaesium, selenium, europium, hassium, lutetium, barium, technetium,
molybdenum). Mix equal parts:

| Makes | From |
|---|---|
| Dentrine (the trauma drug) | inaprovaline, californium, selenium |
| Dylovene | europium, tantalum, hassium |
| Kelotane | europium, lutetium |
| Bicaridine | inaprovaline, lutetium |
| Tricordazine | inaprovaline, dylovene |
| Alkysine | hassium, technetium, dylovene |
| Antibiotic | tantalum, morphite, iridium |
| Vaccine | dylovene, antibiotic |
| Gelabine | selenium, tantalum, molybdenum |
| Oxycodone | thorium, iridium, lithium |
| RAQUE | thorium, europium, lithium |
| Mentats | alkysine, iridium |
| DOB | morphite, rellurium, europium |
| MDMA | lutetium, alkysine, thorium |
| Changa | 2 buffout, 2 cesium, 4 inaprovaline (gives 2, "poor yield because it's a very powerful and abusable drug") |
| **Explosion** | californium, gallium, tantalum |

The stock goon chemistry (styptic powder, saline, ephedrine, and so on) is
compiled too, but it wants elements the Farweb dispenser did not hand out.

## 5. Crafting

`code/modules/crafting/crafting_recipes.dm`. Each is a skill and a level, a
pile of materials, and one thing built. "Wood" is shroomwood logs. Skill
levels ran 0 to 10 or so.

### Furniture (Craft skill)

| Build | Needs | Skill |
|---|---|---|
| Wooden chair | 2 wood | 3 |
| Bed | 2 wood | 3 |
| Chest | 3 wood | 5 |
| Bookcase | 3 wood | 5 |
| Wooden rack | 2 wood | 5 |
| Hearth | 2 wood | 5 |
| Toilet | 3 stone | 5 |
| Wood floor | 1 wood | 7 |
| Wood wall | 3 wood | 7 |
| Wooden door | 3 wood | 7 |
| Wooden table | 2 wood | 7 |
| Wooden coffin | 6 wood | 7 |
| Training doll | 3 wood | 7 |
| Wooden mining cart | 5 wood | 7 |
| Fireplace | 4 stone, 1 coal | 7 |

Survival skill instead: Campfire (2 wood, 3), Torch (1 wood, 2, makes up to
3), Wooden stake (1 wood, 2, makes up to 5).

### Masonry (Mason skill)

| Build | Needs | Skill |
|---|---|---|
| Torch fixture (on a wall) | 2 stone | 5 |
| Stone floor | 1 stone | 7 |
| Stone wall | 3 stone | 7 |
| Stone column | 2 stone | 7 |
| Furnace (the oven above) | 5 stone | 7 |
| Forge | 5 stone, 1 coal | 7 |
| Anvil | 6 stone | 7 |
| Smelter | 6 stone | 7 |

Oddly filed under Mason: Wooden club (2 wood, 5), Wooden spear (3 wood, 5),
Wooden sword (2 wood, 5).

### Odds and ends (Craft)

Shovel (2 wood, 3), Mug (1 wood, 3, up to 5), Bucket (3 wood, 3).

### Tanning (Tan skill 5, 2 leather each)

Satchel, leather pants, apron, leather helmet, leather gloves.

### Cult statues (Craft, 5 stone each)

Angel statue (7, anyone). Stone cross (7, Gray Church only). For the Old
Ways, at skill 3: Lazaro, Boto, Guarani, Alefau, Irineo, Lula.

## 6. Smithing

`code/game/objects/structures/forja/`. The loop is: ore and one coal in the
smelter, light it, wait 16 seconds, get an ingot. Heat the ingot in the
forge, put it on the anvil, pick what it becomes, then hit it with the carver
hammer until it is done. Each swing adds your Smithing skill plus a roll;
below skill 3 there is a 21% chance per swing of breaking the bar. A finished
bar can be worked further to raise its quality (up to 4), with a break
chance that shrinks as skill grows. Quench it in the water barrel to finish.
Wielding the hammer two-handed adds 3 a swing.

### Ores

Iron, copper, silver, gold, adamantine, plus coal as the fuel. **Steel** has
no ore: the big smelter given exactly 3 iron ore and 1 coal throws out 4
steel ingots. Broken iron tools and weapons smelt back into an iron ingot,
and a medal back into gold.

### What each ingot becomes

"×3" means one ingot gives three of the thing.

**Iron.** Long sword, bastard sword, sabre, bardiche, spear, falchion, axe,
sledgehammer, club, light club, carver hammer, tongs, shovel, pickaxe;
pitchfork ×3, iron boots ×3, iron mask ×3, dildo ×3; elite helmet ×2, elite
helmet II ×2, skull-open iron helmet ×2; iron plate armor, iron cuirass, iron
breastplate, squire armor.

**Steel.** Steel rapier, hauberk, hauberk hood, steel gauntlets ×3.

**Copper (bronze).** Copper sword, bronze axe, bronze mace, bronze spear,
bronze buckler; copper dagger ×3, bronze throwing knife ×3, copper cross ×3,
copper bracer ×3, copper dildo ×3, copper earring ×2.

**Silver.** Silver sword, silver bastard sword; silver dagger ×3, silver
throwing knife ×3, silver goblet ×2, silver earrings ×2.

**Gold.** Golden sword, golden breastplate, golden shield; golden necklace
×2, golden bracer ×2, golden goblet ×2, golden earrings ×2; golden censer ×3,
golden dildo ×3, golden teeth ×7. A Golden Medal, only when someone has been
nominated for one.

**Adamantine.** Adamantium plate armor, adamantium sword, adamantium helmet
×2, adamantium dagger ×3, adamantium throwing dagger ×3.

## 7. What is here that is not really Farweb

For the record, so nobody re-scrounges it:

- `recipes_microwave.dm`: 134 stock SS13 dishes (telebacon, diona roast,
  and so on). Not in the build.
- `snacks_bs12.dm`: bread-and-butter sandwiches, salami sandwiches, the
  "sammich". Not in the build. The compiled `snacks.dm` has the same
  meat-to-cutlet code commented out, and instead makes raw meat a
  sliceable, which is how cutlets actually happened.
- The bun combinations in `snacks.dm` (bun + cutlet = hamburger, bun +
  meatball = burger, bun + brain, bun + clown mask) are compiled and would
  work, but are SS13's, not Farweb's.
- The `html/recipes.html` page is a 33-line stub.
