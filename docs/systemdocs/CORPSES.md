# Corpses, butchering, and freeing a soul

What a body is once nobody is using it. This doc owns `db/lib/corpses.js`,
`db/lib/corpseMint.js`, `db/lib/corpseFollow.js`, `db/lib/corpseRotPass.js`,
`db/lib/headstone.js`, `bot/src/lib/deathSmell.js`, the Butcher/Bury/Engrave
actions, and `Tag.requirementItems`. Related: `CHARACTERS.md` (death and the
the curse), `CARRY.md` (room stashes and the reach rule), `REQUESTS.md`
(the three request types), `BREWING.md` (the two enforced ingredients).

## 1. The one idea

**A corpse is a handle to a dead character's sheet, not a container.**

When someone dies, `applyDeathToRow` writes one `Tag` row — "Ada's Corpse" —
and drops it into a random public Room at the Location they fell in. Their ⬢
and their gear do **not** move; they stay on the `Character` row exactly as
before, and `LOOT_CHARACTER` is completely unchanged.

What the tag adds is *position*. `db/lib/corpseFollow.js` keeps the dead
character's `locationId`/`zoneId` equal to wherever their corpse tag currently
is. Because `db/lib/presence.js#isHere` is Location-grain and already accepts
an unburied corpse, that one reconcile is the whole feature: carry a body to
another Location and it becomes lootable there, draggable there, and buriable
there, with **no edit to Loot, Move Player or Harm at all**.

The alternative — dumping the inventory on the floor — was considered and
dropped. It would have made `LOOT_CHARACTER` pointless for corpses while
leaving it necessary for the bound and the helpless, which is two mechanisms
for one verb.

### What a body weighs

A corpse used to weigh nothing, so a character could walk a pile of them across
the map while a Graga's corpse (75 lb) had always been real cargo.
`db/lib/corpseWeight.js` gives one two parts:

**The body.** 50 lb for a person, which is under the 71 lb base cap on purpose
— carrying somebody costs you most of your back and still lets you walk with
your own kit. It sits between the spindly nekker at 35 and the skinless at 55.
Build bends it, as multipliers so they compose: Giant ×1.5 (75, the Graga's
number), Fat ×1.3, Frail ×0.8, Dwarf ×0.7. A frail dwarf is 28 lb and nothing
goes under 20. **Strong is deliberately not on that list** — muscle does weigh
more, but the difference is small next to these and quietly taxing a trait
somebody spent points on is a poor way to buy realism.

**Their gear**, because of §1: a corpse is a handle to a sheet, not a
container, and their belongings never move off the `Character` row. So whoever
hauls the body hauls the plate armour still on it. A body in full harness is
105 lb, which is a hair under the 1.5× hard stop — you have to strip it before
you can carry it, and stripping drops it back to 50. That is the intended
lesson rather than an accident of the numbers.

The figure is **stored** on the corpse Tag's `weightLbs` rather than computed
at read time: `db/lib/carry.js#rowWeight` reads that one column and every
readout on both faces flows from it, so making one tag's weight dynamic would
have meant threading a dead character's sheet through all of them, client
components included. It is written at mint and recomputed by
`refreshCorpseWeight` whenever the body is looted.

## 1a. Gibbing — the death that leaves no body

Four deaths in the game vaporise a character outright: the Thanati **Rite of
Sacrifice**, the **Rite of Judgement**, the **bomb**, and a **GM-staged death
with Gib checked** (`DeathComposer.js`, `ADJUDICATION.md` §1) — the only one
of the four a GM triggers by hand rather than a scripted rite or the bomb.
All four pass `{ gib: true }` to `applyDeathToRow`, and that option is the
whole definition:

- **No corpse is minted at all.** Not minted-then-deleted, which is what the
  two rites used to do — simply never made. So there is nothing to loot, carry,
  butcher, bury or engrave, and `corpseFollow` has no tag to follow.
- **Every `CharacterTag` is deleted** and one **Gibbed** tag ("Vaporized.")
  replaces them. Their goods went up with them.
- **The sheet survives.** The row stays `DEAD` like any other, because the
  end-of-game reveal and the curse rule both read live `Character` rows.

**The one thing the wipe must not take is an antagonist seat tag.**
`db/lib/epilogue.js` reads seats straight off live rows, and the bomb gibs
everyone above ground and *then* ends the game — so a blind delete would leave
the game's own ending naming nobody. `SEAT_TAG_SLUGS` is excluded from the
delete for that reason, and it is load-bearing rather than tidy.

**A gibbed player is cursed permanently.** The curse lifts when somebody buries
your body (§7), and a gib leaves no body to bury. That is the intended reading
of being gone — but it is the only death in the game with no way out, so it is
worth knowing before pricing anything against it.

## 1b. A body keeps its mask

A masked character who dies stays masked. The room sees "a young man" lying
there, not a name, until somebody takes the helmet off the body.

That needed a stored column, and it is the only part of concealment that is not
derived from scratch. Concealment counts an **equipped** mask
(`db/lib/presentedIdentity.js#concealmentFrom`) and death unequips everything
(`db/lib/characterDeath.js`), so dying used to take your hood off: a man who
went down in a Tribunal Helmet was named in the room's Loot menu a moment
later, and killing a stranger was the reliable way to learn who they were.

`Character.deathMaskTagId` is the memory of the piece. It is stamped in
`applyDeathToRow` **before** the unequip, and only when the hood was actually in
effect — the same `forced || concealed` rule the living are judged by, so a
helmet worn with the toggle off stays what it was, a helmet.

**The reading stays derived, and that is what makes looting mean something.** A
body counts as hooded only while it still *holds* that tag, so the moment
somebody takes the helmet the face comes back, with no second write and no
catch-up pass. A dangling id — the catalog pruned the tag, the helmet walked off
— reads as a bare face, which is the safe direction. A gib keeps nothing, since
`vaporizeTags` deletes the rows. A revive clears the column.

Two readers know about it: `presentRows` in `db/lib/whosHere.js` takes an
`includeDead` option, and so does `resolveHoodToken` — so Loot, Engrave, Bury and
Butcher can name a masked body and Heal cannot. See `PROXYING.md` §5.

## 2. Why the follow reconcile is pull-based

The obvious design is to push from whatever moved the tag. It cannot work.

**The case the feature exists for involves no tag write whatsoever.** You pick
a body up and walk somewhere: the only row that changed is *your own*
`locationId`. No tag writer fired, so no push from a tag writer could catch it.

So `reconcileCorpses(prisma)` takes no arguments and recomputes from current
state, the same reasoning `settleCarry` and `roomAccess.js#syncCharacterRoomAccess`
both give. It is bounded by the number of deaths in the game. Three call sites:

| Where | Why |
|---|---|
| `db/lib/locationMove.js#applyLocationMoveSideEffects` | **The important one.** Somebody arrived somewhere carrying a body. |
| `web/lib/afterInventoryChange.js` | A body changed hands, or went into or out of a room stash. Once per batch, not per character — a transfer has both ends in `ids`. |
| the `corpseFollow` turn pass | After `carry`, because the overflow drop can put a corpse on a floor. |

Precedence is: in someone's hands → that holder's Location; lying in a Room →
that Room's Location; **nowhere → leave the dead row alone.** That last case is
real (a buried or butchered body's tag has no holdings) and must never be read
as "move them to null", which would unplace every buried character on the next
pass. The update is also filtered to `status: DEAD, buriedAt: null`, so a
revived character never gets teleported by their own old body.

**Escorting still carries corpses, and the tag is authoritative.** The
reconcile is strictly one-directional — tag position decides sheet position,
never the reverse. Do not add a reverse sync; two movers that can disagree is
how this gets confusing.

## 3. Rotting: the row is renamed, not chained

Three turns after death, "Ada's Corpse" becomes "Ada's Rotten Corpse".
`db/lib/corpseRotPass.js` does it by **mutating the same `Tag` row** — name,
description, `corpseKind`. `Tag.expiresInto` is sitting right there and is the
wrong tool, three times over:

- it names catalog **slugs**, and "Ada's Rotten Corpse" is per-character and
  never in `docs/tags.yaml`. There is no slug for it to name.
- `tagExpiryPass.js` walks `CharacterTag` only, and a corpse is almost always a
  `RoomTag` lying on a floor.
- a chain would leave the *holding* pointing at the old row, so a body someone
  was carrying would rot into a tag somewhere else.

Renaming sidesteps all three, and a body in your bag rots in your bag.

**The pass must run before `expirySweep`, and `TURN_PASSES` puts it there.**
That sweep is a blind `deleteMany` over `expiresTurn <= turn.number`, so a
corpse that reached its clock would be *deleted* rather than rotted. Nulling
`expiresTurn` on both holdings is what takes the row out of the sweep's reach —
no exemption list, no special case in `db/index.js`.

**Monster corpses never rot.** The three in `docs/tags.yaml` carry no
`durationTurns`, so nothing ever matches them. A Nekker left lying around stays
butcherable; only a person stinks.

## 4. Names collide, and both writers handle it

`Tag.name` and `Tag.slug` are both `@unique`, and two characters can share a
name. Both the mint and the rot rename retry with a `(2)` suffix on the unique
violation rather than pre-checking — two deaths resolving in the same turn
close would both pass a pre-check and then one would throw.

The rot rename re-derives its suffix rather than parsing the old name, because
the old name is the thing being replaced.

## 5. The smell

`bot/src/lib/deathSmell.js` posts **"It smells like death…"** to the channel
of every Location holding a rotten corpse — in a Room there, or in the pocket
of somebody standing there. A body in a bag smells as much as one on the floor.

**Every 4–10 hours, randomized, via a self-rescheduling `setTimeout` chain.**
`node-cron` cannot express that, and the randomness is the point: a fixed
cadence would make the smell a clock players could read, when what it is for is
nagging unpredictably until somebody buries the body. Each firing schedules the
next, so nothing may throw out of the tick or the chain dies silently.

**It needs no cleanup code.** The message wipe already deletes every top-level
message in a Location channel except the pinned anchor (`CHANNELS.md`). So the
obligations here are negative, and they matter: never pin the line, and never
record its id as an anchor. Do neither and it clears itself every Dawn.

An unburied corpse also costs the living: at turn close, everyone ending the
turn in a Location that still holds a rotten body takes −5 mood (`MOOD.md`).

## 6. Butcher

A new button, gated on the `butcher` tag (now a Mercenary starting tag).
**Free — no ⬢, no Move — and it consumes the body.**

It carried a labor bonus once — +1 ⬢ to a hunting Labor, and before that a
hardcoded bonus to every kind of Laboring but farming. Laboring is gone, and
only three tags carry a `miningBonus` now (`MINING.md` §4); Butcher is not one
of them. What it buys is the button, and the button is the whole of it.

| Corpse | Yields |
|---|---|
| Nekker Corpse | `nekker-pheromones` |
| Graga Corpse | `graga-sac` |
| Skinless Corpse | `skinless-brain` |
| anybody's corpse | `human-flesh`, plus whatever organs are still on the body |

**A human corpse also gives up its organs**, one Butcher instead of up to nine
Mutilate presses. `harvestableOrgans` (`db/lib/mutilate.js`) runs every
`MUTILATE_PARTS` ladder (`TORTURE.md` §6) to its end and hands the actor
however many rungs are left — an untouched body is the same nine pieces a full
Mutilate pass would leave (two eyes, two hands, two feet, one tongue, one
stomach, one heart), and a body already missing a part (a prior Mutilate, or
Torture that killed it by the stomach or heart) only gives up what's left.
The corpse's own sheet ends the same way a hand-pressed Mutilate would leave
it — holding the final rung of each part taken — so a second Butcher (or a
GM inspecting the dead character) sees the same ladder state either way.

`nekker-pheromones` **stopped being brewable** in the same change. It is
butchered now, and its row is gone from `BREWING.md` §2 and from the Alcohol &
Drugs document.

`human-flesh` is consumed exactly like any other raw foodstuff (SOILERY.md) —
it feeds you and settles the turn's hunger — and is deliberately **not
sellable**. Butchering is free and
every death mints a corpse, so a priced Human Flesh would be a code-enforced ⬢
faucet hanging off a free action. It stays `tradeable`, so players can still
sell it to each other for whatever they can get, which is the right market.

**Butcher is not the only body verb.** Mutilate takes one piece at a time and
leaves the body where it is (`TORTURE.md` §6); butchering is the whole corpse
at once and consumes it.

**Butchering does not free the soul.** Cutting someone up destroys the body
without burying it, so their player stays Cursed. That is a decision, not an
oversight, and Engrave is the way out of it.

Two Desires reward eating a person: `eat-human-flesh` (tier 2, gated on `cruel`,
repeatable) and `feast-on-human-flesh` (tier 4, gated on `glutton`, once per
life — an appetite has a first time exactly once). Neither is wired to the
Butcher action; a player claims it and writes what they did, and the
`request_butcher_corpse` audit row is the receipt a GM checks it against.

### 6a. Livestock — the Butcher verb's second source

An adult arelitz or a brood animal isn't a corpse — it's alive, held or
sitting in a stable's floor — but Butcher takes it the same way
(ARELITZ.md §5). `db/lib/corpses.js#livestockInReach` mirrors
`corpsesInReach`'s reach rule and row shape exactly (held, or stashed in a
Room at your Location you can get into), so `BodyDialog.js` never has to
tell the two apart: both rows carry `livestock`/`yields` now, `yields` being
`[{ slug, quantity }, ...]` rather than a single slug.

| Animal | Yields |
|---|---|
| Arelitz, Unruly Arelitz | 20 Meat, 10 Fat |
| Hatchling, Youngling, Yearling | 5 Meat, 2 Fat |

**Takes ONE unit off the stack, never the whole row** — the one real
difference from a corpse, which is always singular. A corpse held or
stashed is deleted outright (`takeCorpse`); livestock goes through
`takeLivestockUnit`, an ordinary `dropCharacterTag`/`dropRoomTag` at quantity
1, so butchering one arelitz out of a stable's five leaves four.

No organ harvest, no death DM, no curse — those are `corpse.human`'s branch,
and every livestock row carries `human: false`. The room announcement reads
"butchers an arelitz here" instead of "butchers a body here."

## 7. Bury and Engrave

**Both cost half a Move**, and they take it off the same ledger crafting uses
(`Action.craftBudget`, `CRAFTING.md` §2a) rather than the whole-Move
`fileAutoRoutine` path they used to file. So a burial and an afternoon at the
anvil fit in one turn, and so do two burials. They go through
`resolveCraftMove` outside the transaction and `spendCraftMove` inside it,
exactly like a 0.5-turn recipe, and pass `notes: "auto:craft auto:bury"` — the
`auto:craft` half is what `checkCraftMove` recognises as a shareable ledger,
the other half is the marker saying which button filed it.

They are the only two non-craft verbs on that ledger. Extract, Mine, Farm and
the build sites still take a whole clean Move through `requireFreeMove`.

Their ledger entries carry `family: "burial"` and no `tagId`, since neither has
a recipe behind it. `craftLedgerDescription` groups everything non-medical
together, so the desk reads `Crafting this turn: Buried Ada.`

**Bury needs the actual body.** It used to match a typed first name against the
dead in your zone; now you pick a corpse you hold or can reach, which is
strictly tighter (Location-grain, and you have to have it). It consumes the
corpse tag and stamps `buriedAt`, which is what lifts the curse
(`db/lib/curse.js`) — and the curse is now the whole right to make a new
character, not the old Migrant/Bum discount, so a mourner is handing somebody
their game back. A monster
corpse is refused — "There's no soul in that one."

**Engrave is the answer to a body nobody can find**, so it is the one action
here with no corpse and no reach check, and it searches **every zone**. It costs
**3 ⬢** and half a Move, frees the soul the way burying does, and leaves a
`{name}'s Headstone` tag on the engraver.

Engrave inherited Bury's **typed** first name, and the reasoning that kept it
typed is unchanged and now stronger: a dropdown would answer "who is dead?" to
anyone who opened the dialog, and the list would be every unburied body in
Ravenheart rather than the ones at your feet. **The `>1 match` refusal came
with it and matters more than it used to** — it is the only thing standing
between a mourner and freeing the wrong soul.

The headstone mint is an **upsert**: two mourners can engrave the same person,
and the second gets a grant of the row the first made. One stone; more than one
person can have helped.

**Both say so where they happened.** A burial posts `{name} was buried.` and an
engraving `A headstone was engraved for {name}.` into the actor's own Location
channel, as ambient subtext (`speakHere` in `requestActions.js`, over the shared
`speakAtSite`/`ambientLine` pair). The Location is the actor's in both cases —
for Engrave that is the only sensible one, since the body may be anywhere and
the carving is not.

## 8. `Tag.requirementItems` — the enforced ingredient

`BREWING.md` was explicit that no code enforced a recipe, "least of all the
ingredient". Every ingredient in the game runs through this field now. Three
entry shapes:

```yaml
  cave-fungus-recipes:
    requirement:
      items: [cave-fungus]         # a bare string is a tag slug — SPENT
  miasma:
    requirement:
      items:
        - group: items-corpse      # any corpse, incl. a per-character one — KEPT
  lavish-meal:
    requirement:
      items:
        - anyOf: [tea, sweets, honey]   # the player picks one — SPENT
  bone-mask:
    requirement:
      skills: [butcher]            # a mask cut out of a human skull
      items:
        - group: items-corpse
```

The Bone Mask is the one of these outside brewing and cooking, and the one
that makes a corpse into something you *wear* — it is a `concealsIdentity`
piece, so the face it hides you behind is a skull (`PROXYING.md` §5).

**The Death Mask (2026-09-07) is the second corpse craft, and the one recipe
whose OUTPUT is named by its ingredient.** An `artist` casts it over a held
corpse (kept, like every group entry) plus a spent `saltpeter`; the craft
binds a SPECIFIC corpse (the dialog asks "Whose face?" when several are
held), and the finished item is minted as "Death Mask of {the dead's name}"
through the custom-craft machinery's literal mode. **A face is taken ONCE per
body, ever**: the craft appends "The face has been taken." to the corpse
tag's own description at project START (an abandoned mask still ruined the
face) under a compare-and-swap, so two artists racing over one body cannot
both cast — and that sentence IS the one-off record, visible on Examine and
checked by the next attempt. The audit row carries `details.sourceCorpseTagId`
for a GM tracing whose face a mask is. All in
`character/requestActions.js` (`resolveDeathMaskSource`, `takeFace`,
`mintCustomCraft`'s `literal`).

**SPENT BY DEFAULT, and the default differs by shape.** A slug entry, and an
`anyOf` pick, costs `quantity` units per craft: three molotovs take three
Alcohol, the same scaling ⬢ has. A `group:` entry is **kept** — a body has its
own lifecycle, and "any member of a group" names no single stack to decrement,
so `keep: false` on a group is refused at sync rather than guessed at. Bottling
a second Miasma over the same corpse is still fine. `keep: true` on a slug
turns it back into a hold-check if a recipe ever wants one.

**Spent when the work STARTS**, the rule the ⬢ already lived under. A
multi-turn project pays its ingredients up front, so `continueCraft`
deliberately does **not** re-check them — an honest continue would fail its own
check on turn 2. Cancelling keeps nothing. The finishing audit row snapshots
what was spent (`details.consumed`) — the record a GM reversing a craft by
hand reads (`CRAFTING.md` §4).

**Json, not a `Tag[]` relation**, and the group form is why: a corpse written at
death is never in `docs/tags.yaml`, so no authored relation could ever name one.
Each normalized entry carries a denormalized `label`, because
`formatTagRequirement` is pure and synchronous and is called from four surfaces
with four different selects; the sync rewrites the label every run. An `anyOf`
entry also carries `options: [{ slug, name }]`, for the same reason: the Craft
dialog's picker needs the members' names and has only the recipe row.

Validated by `db/lib/tagShapes.js#validateRequirementItems`, which throws on an
unknown slug or group, a duplicate, a second `anyOf` in one recipe (the dialog
posts one `ingredientChoice`), an `items` block on a tag that is **not
craftable** — the only enforcement point is the Craft path — and an `items`
block on a `placement:` recipe, which is raised by a crew over several turns
and has no one sheet to take an ingredient off.

Three functions in `requestActions.js` do the work:

| | |
|---|---|
| `resolveRecipeItems` | outside the transaction: resolves the entries against what the crafter holds and fails fast. **Their own sheet only** — never a room stash they could reach. |
| `lockCharacter` | the `FOR UPDATE` row lock, taken before anything is counted or spent. |
| `consumeRecipeItems` | inside the payment transaction: **the write is the check**. A conditional `updateMany ... quantity: { gte: n }` (or a delete at exactly n) matches only while the stack still covers the draw, and a count of 0 refuses. `dropCharacterTag` is deliberately NOT used — it deletes the row on an overdraw rather than refusing, which would make "3 off a stack of 2" free. |

The snapshot `consumeRecipeItems` returns is the same shape `replaced` uses
(`{ tagId, tagName, quantity, source, expiresTurn }`). A multi-turn project
keeps it on `CraftProject.consumed` until the finishing craft copies it into
the audit row's `details.consumed`.

**Adding a surface that renders a Recipe line means adding `requirementItems`
to its select.** A caller that forgets it renders no ingredient line rather
than throwing, which is the quiet failure to watch for.

## 9. The three kinds of Tag row

`TAGS.md` §5d describes two authoring doors. There are three:

| | `docs/tags.yaml` | GM, at `/gm/dev/tags` | **System** |
|---|---|---|---|
| Written by | the sync | a person | `corpseMint.js`, `headstone.js` |
| `custom` | false | true | **true** |
| `corpseKind` | FRESH, if in `items-corpse` | never | FRESH → ROTTEN |
| `corpseOfCharacterId` | null | null | **the body** |
| Touched by `db:sync-tags` | upserted | never | never |
| Touched by `db:prune-tags` | if unreferenced | never | never |

`corpseOfCharacterId` is `@unique` (one corpse per death, so the mint is an
upsert and a revive is a delete-by-character) and **`onDelete: Cascade`**, which
is load-bearing: it is the only thing stopping these rows outliving a Restart
Game. `wipeGameData` deliberately never touches the catalog, and its existing
order already clears `CharacterTag` and `RoomTag` before `character.deleteMany()`
— so the cascade lands clean and **the wipe needed no edit at all.**

## 10. Two traps

**`CharacterTag.tagId` is RESTRICT; `RoomTag.tagId` is Cascade.** Deleting a
corpse tag somebody is *carrying* throws a foreign-key error. Use
`corpseMint.js#deleteCorpseFor`, which clears both holding tables first. This
is exactly the bug that bit `reviveCharacterImpl`, and `CARRY.md`'s claim that
"deleting a Tag from the catalog cascades its stacks too" is only half true.

**A GM Revive must clear the corpse** (`deleteCorpseFor`). The Cascade fires on
a Character *delete*, and a revive is an update — so without it a walking
person leaves a body anyone could pick up, and the follow reconcile would keep
dragging their sheet to wherever it went.

**Butcher and Bury deliberately do NOT delete the Tag row** — only the holding.
A GM repairing a mistake has to be able to put the body back.

## 11. Where the code lives

| Piece | File |
|---|---|
| Reach, yields, the shared vocabulary | `db/lib/corpses.js` |
| Minting a body, and removing one | `db/lib/corpseMint.js` |
| Sheet-follows-corpse | `db/lib/corpseFollow.js` |
| Rot | `db/lib/corpseRotPass.js` (`TURN_PASSES` `"corpseRot"`) |
| The smell | `bot/src/lib/deathSmell.js`, armed in `bot/src/events/ready.js` |
| Headstones | `db/lib/headstone.js` |
| The three actions | `web/app/(app)/character/requestActions.js` |
| Buttons, dialogs | `actionRegistry.js`, `RequestActionsProvider.js`, `icons.js` |
| Ingredient shape | `db/lib/tagShapes.js`, `db/lib/syncTags.js`, `db/lib/formatTagRequirement.js` |
| Constants | `CORPSE_GROUP_SLUG`, `BUTCHER_SLUG`, `HUMAN_FLESH_SLUG`, `ENGRAVE_RESOURCE_COST`, `CORPSE_ROT_TURNS` in `db/lib/constants.js` |
