# Torture

The Torture button, the die behind it, what a broken person gives up, the
Torturing Equipment kit, the Mutilate button beside it, and the Brand button
(§8). Read this before touching `db/lib/torture.js`, `db/lib/mutilate.js`, the
`torturer` tag, the `TORTURED`/`BRANDED` mood events, or anything that decides
who breaks under questioning or gets marked by it.

Shipped 2026-09-06. Before it, the Order's role text promised "your torturer's
tools" and the Torturer tag promised better Gambits, and both were prose a GM
had to honour by hand.

## 1. The button

**Torture** sits in the "People here" section of the character sheet's action
grid (`web/app/components/actionRegistry.js`) and is **hidden, not greyed**,
unless the character holds `torturer` — an own-sheet fact, which the grid's
metagaming rule allows hiding on. `/chat` does not mount the grid, and its
per-person menu (`HereList.js`) is unconditional with no pools access, so
Torture is deliberately not on it: a row there would tell every player that
torture exists whether or not they could do it.

The dialog is the Free picker with the same filter — everyone standing here
who is **Bound** — and the server re-checks all of it
(`tortureCharacterRequestImpl`, `web/app/(app)/character/requestActions.js`):
you hold `torturer`, the target is ALIVE, `isHere`, and holds `bound`.

It **spends your Move**. `requireFreeMove` refuses if you have acted, and the
Move is filed through `fileAutoRoutine` as a ROUTINE already PASSED, with the
whole story in its description — `Tortured Ada: Rolled a 5 +1 Cruel against 4
— they broke.` — because a GM never adjudicates it and that line on
`/gm/turns` is the record. It is a Routine and not a Gambit on purpose: the
torturer is told the result at once, and a GAMBIT row would have the turn-end
push announce the same die a second time (`stagedPush.js#gambitRollNotices`).

`torturer` itself is 2 points, purchasable by anyone at creation and from
`/store`. Every Order role except the Preacher starts with it
(`docs/roles.yaml`).

## 2. The roll

One d6, resolved in `db/lib/torture.js#resolveTorture`, Prisma-free and
tested in `db/test/torture.test.js`.

**The bar is set by the target:**

| Target holds | Needs |
|---|---|
| nothing special | 4 |
| `craven` | 2 |
| `brave` | 5 |
| `relentless` | 6 |

Hardest wins when several apply, which in practice means Relentless over Brave
(Brave and Craven already `conflictsWith` each other).

**The torturer adds to the die**, +1 each:

| Bonus | Read how |
|---|---|
| Torturing Equipment in reach | `hasEquipmentInReach` — held, in a Room stash you can get into here, or provided by a structure; the same three reaches as Surgical Equipment |
| Trench Knife | carried, any quantity; it need not be drawn |
| `cruel` | held |

Then the ordinary Gambit penalties — Hungry, Afraid, Panic from
`db/lib/gambitModifier.js` — count exactly as they would on any Gambit. Learn
and Confess already apply them; this is the third roll that does.

**A natural 1 always fails**, whatever the arithmetic says. Without that rule a
Cruel torturer with a knife in an equipped chamber would break anyone but a
Relentless target on every roll.

## 3. What a break gives up

On a success the torturer's DM is an embed (`buildTortureEmbed`, plain JSON —
no discord.js in `web/`), laid out like the bot's Examine card and carrying
the victim's **true** name and portrait. A hood or a disguise does not survive
being broken; `tortureReadout` in `db/lib/examine.js` reads `Character.name`
and the own avatar rather than `presentedIdentity`.

- **Their tags** — every row on the sheet **except** `Health` and `Status`
  (`REVEAL_EXCLUDED_CATEGORIES`). Wounds are not secrets, and the passing
  statuses (Bound, Hungry, the meal markers) would bury the
  ones that are. Everything else shows: items, personality, beliefs, skills,
  keys, and the secret-catalog tags — `thanati`, `demoness`, a body's mark —
  which is the point.
- **Their last three fulfilled Desires**, newest first (`Desire.status =
  FULFILLED`, ordered by `endedTurnNumber`). Omitted when there are none.
- **The Thanati**, only when the victim holds `thanati-leader`: the names of
  every other ALIVE character holding `thanati` (`db/lib/threats.js`).

The DM carries `meta: { embed: true }`, so `/gm/messages` leaves it out of the
conversation view (`web/lib/dmThread.js`). What was revealed is in the audit
row instead (`request_torture_character`, `details.revealedTagNames`,
`details.desires`, `details.thanatiNames`).

On a hold the torturer gets one plain line with the roll: `Rolled a 3 −1
Hungry against 4. They held out.`

## 4. What it does to the victim

**Mood.** `−40`, kind `TORTURED`, success or failure, through `applyMood`
inside the action's transaction (MOOD.md §3). Two statuses zero it —
`pain-immunity` and `opium-high`, both ×0 in `MULTIPLIERS` — and a 0 beats
Brave's ×0.5. Both are two-turn statuses, so a torturer who waits a day gets
the full hit.

**Depressed**, on a success only. Granted with `source: EVENT` and no expiry,
the same door Bind's `bound` and Crucify's `crucified` walk through. Depressed
`conflictsWith` most of the Personality group, but those are purchase-time
checks; an EVENT grant lands beside Cruel or Nobility exactly as a GM grant
would. A Chaplain's Confession or a Bliss cures it (CONFESSION.md,
`db/lib/hiddenCures.js`). There is no Undo; a GM takes it off from `/gm/dev`.

**The DM**, unattributed like every `notifyCharacter` line:

- broke: *You were tortured and failed to conceal your secrets. The torturer
  now knows everything about you.*
- held: *You were tortured, but held out. It won't be long, now...*

Both are Bascinet's words verbatim.

## 5. Torturing Equipment

The fourth standing kit beside Workshop, Surgical and Packaging Equipment
(`db/lib/equipmentReach.js`): `torturing-equipment`, 20 lb, tradeable,
`purchasable: false`, `pointCost: 0`. It carries no `group` on purpose, like
Surgical Equipment — the Recipes tab renders by group, and neither kit is a
recipe a player crafts off a shelf.

**Recipe:** 1 turn, 2 ⬢, `skills: [torturer]`, `items: [work-knife, hatchet,
cudgel]`, all three **spent**. The gate is the Torturer tag itself — a
recipe's `skills:` list is satisfied by holding the named tag, the same way
Bone Mask names `butcher` (CRAFTING.md §2) — so there is no smithing skill,
no forge, and no ladder tier. `craftFamily()` reads it as `torturer` work.

**One is seeded in the Order Chambers** (`docs/zones.yaml`,
`cathedral-order-chambers`, a stash floor). Anyone with an Order Key stands
within reach of it; anyone can carry it off.

## 6. Mutilate

The other thing you can do to somebody tied up, shipped 2026-09-07. Torture
takes what they know; **Mutilate** takes a piece of them.

**The gate is any one of these tags**: `cruel`, `torturer`, `thanati`, any
Medical skill (`medical-basic`, `medical-skilled`, `medical-expert`) or
`butcher` (`MUTILATE_GATE_SLUGS`). There is no single "would cut pieces off a
person" tag — Cruel is the personality, Torturer is the trade, the Thanati are
the ones who want the pieces, and a medic or a butcher already knows how to
take a limb off. **Hidden, not greyed**, the same rule Torture and Crucify
follow: which of them you hold is your own sheet.

**It is free.** No ⬢, no Move, no turn — the one action here that costs
nothing at all, and it has to be, because one press takes exactly one piece.
Want the other eye, press it again.

**Two subjects, one button.** A living person has to be **Bound** and standing
here, exactly as Torture requires; a corpse has to be one you hold or can reach
into a Room for, exactly as Butcher requires. Both branches come out as one
`Character` row to injure — a corpse is a handle to a dead sheet
(`CORPSES.md` §1), so a body's tags work like a living person's.
**Monster corpses are refused**: there is no sheet behind one.

**It does not consume the body.** Butcher does, and that is the difference
between the two verbs — butchering is the whole corpse at once, mutilating is
picking at one. A GM repairing a mistake still has a body to look at.

### The ladder

`db/lib/mutilate.js` — pure, prisma-free, off the barrel, and the same table
the dialog and the server action both read, so the menu and the gate can never
disagree. Each part is a ladder of at most two rungs, and the second press
**replaces** the first rung rather than stacking on it.

| Part | 1st press | 2nd press | 3rd |
|---|---|---|---|
| Eye | `missing-eye` | `blind` | refused |
| Tongue | `mute` | — | refused |
| Hand | `missing-fingers` | `missing-arm` | refused |
| Foot | `missing-leg` | `cripple` | refused |
| Stomach | `missing-stomach`, **kills** | — | refused |
| Heart | `missing-heart`, **kills** | — | refused |

`resolveMutilation` walks the ladder from the **top down**, not the bottom up.
A sheet can carry both rungs — Blind bought at creation on top of a Missing Eye
a GM granted — and counting upward would read that as the first rung and take a
third eye. Tested in `db/test/mutilate.test.js`.

Nine of those slugs already existed; `cripple`, `missing-stomach` and
`missing-heart` are new, permanent (`purchasable: false`, no `healable` block)
and come off only from `/gm/dev`.

**The two organs kill only somebody still using them.** A corpse takes the tag
and stays dead — no second death, no second death DM. A living victim goes
through `killCharacter`, the one death path, so nothing sends two.

### What the actor gets

Every press, whatever rung it landed on, drops one item on the actor's sheet:
Eyeball, Tongue, Hand, Foot, Stomach, Heart — six tags in the
**`items-remains`** group.

**The station buys them, and the prices are small on purpose.** They started
unpriced, on the argument that mutilating is free and every death mints a body,
so a part the Depot bought would be a ⬢ faucet hanging off a free action. That
argument was right about the shape and the answer is the number rather than a
refusal: what matters is the LADDER, not one press. `MUTILATE_PARTS` takes nine
pieces off one subject — two eyes, two hands, two feet, tongue, stomach, heart —
so a whole body is 49 ⬢ at 8/8/5/4/4/3, against 30–42 ⬢ for a specialised day's
labour. Butchering a prisoner is worth about a day of honest work, which is the
line it should sit on. The first pass priced it at 94 ⬢, nearly three days, and
that is the mistake to avoid if these are ever retuned: price the ladder, never
the piece. They stay `tradeable` too, so the market between players is still the
livelier one.

**Butchering a human corpse takes every part in one action** now, rather than
making the butcher press Mutilate nine times — `harvestableOrgans` in the same
file runs each ladder above to its end, skipping whatever's already gone
(`CORPSES.md` §6).

The group is deliberately **not `items-corpse`**. That slug is
`CORPSE_GROUP_SLUG`, what `db/lib/corpses.js#isCorpseTag` matches on, so an eye
filed there would answer a `group: items-corpse` recipe ingredient and turn up
in the Butcher and Bury pickers.

The rites eat them now (`THANATI.md` §9): Reanimation and Panic take a heart,
Judgement takes a heart and two eyes. That is why the eye and the heart are the
two dear ones — a cultist and the Merchant want the same organs.

### What it does to the victim

**Mood −50**, kind `MUTILATED`, on a living subject only — a corpse feels
nothing, and `applyMood` on a dead row would move a dial nobody reads. There
are no ×0 rows for it: `pain-immunity` and `opium-high` zero `TORTURED` on
purpose, and losing a hand is not a question of pain tolerance.

**The DM** is unattributed like every other request that acts on someone else —
*"Somebody cut off your hand."*, or *"Somebody has been cutting pieces off your
body."* to a dead player whose corpse someone is picking at. A body taken from
a Room stash also posts a line in the room, said vaguely: the room learns a
body was cut, not what came off it.

### The dialog

Two dropdowns, no helper text, no yield preview. **The part list is
unfiltered** — narrowing it to the rungs a subject has left would answer "what
are they already missing?" to anybody who opened the dialog. You find out by
trying, and the server refuses with `There's no eye left to take.`

The subject dropdown holds two id spaces in one control (`person:` /
`corpse:`), the way the Craft dialog splits `project:` from `site:`.

### Where the code lives

- `db/lib/mutilate.js` — `MUTILATE_PARTS`, `partFor`, `resolveMutilation`.
- `db/lib/constants.js` — `MUTILATE_GATE_SLUGS`.
- `db/lib/mood.js` — `EVENTS.MUTILATED`.
- `web/app/(app)/character/requestActions.js#mutilateRequestImpl`.
- `web/app/components/actionRegistry.js` (mode `mutilate`),
  `RequestActionsProvider.js`, `character/page.js` (`canMutilate`),
  `icons.js#ShearsIcon`.
- `docs/tags.yaml` (the six part items, three new injuries), `docs/taggroups.yaml`
  (`items-remains`).
- `db/test/mutilate.test.js`.

## 7. Where the code lives

- `db/lib/torture.js` — thresholds, bonuses, `resolveTorture`, `revealedTags`,
  `formatTortureRoll`, `buildTortureEmbed`. Off the barrel; require by path.
- `db/lib/constants.js` — `TORTURER_SLUG`, `TORTURING_EQUIPMENT_SLUG`.
- `db/lib/examine.js#tortureReadout` — the unfiltered read.
- `db/lib/mood.js` — `EVENTS.TORTURED`, the two ×0 rows.
- `db/lib/discordRest.js` — `embeds` on `postMessage` / `postDmOnce` /
  `postDmBatched`, forwarded by both `sendDm`s and `notifyCharacter`. Added for
  this; the bot's own embeds go through discord.js and never touched it.
- `web/app/(app)/character/requestActions.js#tortureCharacterRequestImpl`.
- `web/app/components/actionRegistry.js`, `RequestActionsProvider.js` (mode
  `torture`, sharing the Bind/Free roster), `character/page.js` (`canTorture`).
- `web/app/components/icons.js#TortureIcon` — Lucide's flame.
- `db/test/torture.test.js`, and the TORTURED case in `db/test/mood.test.js`.

## 8. Branding

The third "do something to somebody who can't stop you" verb, shipped
alongside Torture and Mutilate but held to a broader target class than either
of them.

**The gate is one tag, and it's an item rather than a skill.** Holding
`branding-iron` (Dead Simple, `skills: [smithing]`, `SMITHING.md` §2) is the
*whole* ability — there is no Torturer-style skill tag on top of it, unlike
Torture. **Hidden, not greyed**, the same rule every button on this page
follows: whether you're carrying the iron is your own sheet's fact.

**The target class is wider than Torture and Mutilate's.** Both of those
require the victim to hold `bound` specifically. Brand instead uses
`INCAPACITATING_SLUGS` (`db/lib/incapacitation.js`) — Bound, Dying, Catatonic,
Paralyzed, Seizure, Unconscious, Crucified — the same broader "helpless"
class Harm's own-target check, Loot and Poison's "dose a helpless person" all
use. A brand doesn't need the victim able to struggle for it to work, so there
was no reason to hold it to the narrower Bound-only gate the other two use.

**It costs nothing.** No Move, no ⬢, no turn, and the iron is never consumed
— reusable, the same standing-kit shape as Torturing Equipment (§5).

**The words are the player's, capped like any other custom craft.** The
dialog takes a description (`CUSTOM_DESCRIPTION_MAX` = 300, `web/lib/
customCraft.js`), and `brandCharacterRequestImpl`
(`web/app/(app)/character/requestActions.js`) mints a fresh custom+ephemeral
copy of the base `brand` catalog tag reading `A permanent brand.
<description>` — `mintCustomCraft`/`db/lib/customCraftMint.js`, the same
mechanism a customized weapon or a named dish mints through. `brand` itself
carries no `craftable`/`customizable` flags: the mint is the only door onto
it, granted straight from `brandCharacterRequestImpl` rather than through the
Craft dialog.

### What it does to the victim

**`aching`** (2 turns, `TAGS.md` §5c's pain tags) and the minted **Brand**
tag, both `source: EVENT`, permanent for Brand and on `aching`'s own clock for
the pain.

**Mood −40**, kind `BRANDED`, through `applyMood` inside the action's
transaction (MOOD.md §3). The same two statuses that zero `TORTURED` zero
this too — `pain-immunity` and `opium-high`, both ×0 in `MULTIPLIERS`
(`db/lib/mood.js`) — because it's the same kind of harm: a hot iron held to
someone who can't stop it.

**The DM**, unattributed like every other request that acts on somebody else:
*"Somebody held a hot iron to you. It'll never fade."*

### Where the code lives

- `docs/tags.yaml` — `branding-iron` (the gate item, beside Torturing
  Equipment), `brand` (the mint's base row, beside `scarred`).
- `db/lib/mood.js` — `EVENTS.BRANDED`, the two ×0 rows.
- `db/lib/incapacitation.js` — `INCAPACITATING_SLUGS`, the target gate.
- `db/lib/customCraftMint.js#mintCustomCraft` — the same mint Craft and
  Cooking use.
- `web/app/(app)/character/requestActions.js#brandCharacterRequestImpl`.
- `web/app/components/actionRegistry.js`, `RequestActionsProvider.js`,
  `character/page.js` (`canBrand`), `actions/BrandDialog.js` (reuses Poison's
  `doseTargets` pool), `icons.js#BrandIcon` — Lucide's stamp.
- `docs/desires.yaml` — `brand-someone`.
