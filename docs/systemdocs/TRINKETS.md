# Trinkets

The forge's own Gambit — a smith spends a whole Move not knowing what they are
about to make, and finds out when the turn ends. Read
[`SMITHING.md`](SMITHING.md) and [`CRAFTING.md`](CRAFTING.md) first; this is
built to sit beside both without duplicating either, and reads as a delta from
them the way `CONFESSION.md` reads as a delta from `LESSONS.md`.

## 1. The die and the tiers

Making a Trinket rolls a d6, same as any other Gambit
(`db/lib/advantage.js`), and the face maps straight onto a tier:

| Face | Tier | Sells for |
|---|---|---|
| 1 | Awful | 5 ⬢ |
| 2 | Poor | 8 ⬢ |
| 3 | Normal | 14 ⬢ |
| 4 | Good | 22 ⬢ |
| 5 | Excellent | 34 ⬢ |
| 6 | Masterwork | 60 ⬢ |

That is the whole reveal: a Trinket's price to the Merchant IS its tier, read
straight off the table (`db/lib/trinketPass.js`'s `TIERS` array). There is no
hidden second roll and no per-item variance — the die decides the tier, the
tier decides the price, full stop.

### The skilled floor

Holding `{tag:smithing-skilled}` clamps a 1 or a 2 up to 3 — a trained smith
never walks away with an Awful or a Poor Trinket, whatever the die actually
said. Plain `{tag:smithing}` has no floor at all: an apprentice takes the die
as it falls, faces 1 through 6 with nothing between them and disappointment.

This is a flat guarantee, not a nudge to the odds, and that is why it is
implemented as a post-roll clamp in the turn-end pass
(`db/lib/trinketPass.js#clampFace`) rather than as a modifier folded into the
roll the way Hunger and mood are for every other Gambit
(`db/lib/gambitModifier.js`). A modifier changes the number BEFORE the
threshold check happens; a floor has to look at the die face and override it
AFTER. Trying to write "clamp the modified total up to a Normal-equivalent"
gets complicated fast once a modifier can also push the total the other way,
and — more to the point — the promise a floor is supposed to make ("a trained
smith never rolls worse than Normal") would stop being true on the one turn it
matters most: a hungry skilled smith clamped up to face 3 and then knocked
back down by a −1 Hungry modifier is exactly the smith the floor exists to
protect, made a liar of by the same pass that promised them better.

So Trinket's Gambit is deliberately built with no modifier at all.
`Action.diceModifier` is never set on a Trinket Action, and
`db/lib/trinketPass.js` never imports `gambitModifier.js` — it reads
`Action.diceRoll` alone, clamps it, and stops. A hungry, panicking, Ecstatic
smith all roll exactly the same die everyone else does.

## 2. Why this is a Gambit and not a Craft

Every other recipe's `gambit` key in `docs/tags.yaml` is ignored —
`CRAFTING.md` says so plainly: crafting is always a Routine, because the whole
point of the Craft dialog is to show you exactly what a recipe makes before
you commit to it. A self-spoiling recipe would be a contradiction: the dialog
would have to either lie about the outcome or give it away, and either one
defeats the reason Trinket exists.

So Trinket does not go through the Craft dialog, and `{tag:trinket}` in
`docs/tags.yaml` is not a normal recipe row — it is `catalog: secret`
(nobody sees it; there is no "none" catalog value), `craftable: false`, and
carries no `requirement:` block at all. It exists
purely as a base SHAPE (category, group, weight, stackability…) for
`mintCustomCraft` (`db/lib/customCraftMint.js`) to clone once the die is cast.
The actual gate — Smithing, a forge in reach, the 4 ⬢ cost, a whole Move —
lives as plain constants in
`web/app/(app)/character/trinketActions.js`, the recipe's own bespoke request
action, rather than being read off that row.

One consequence worth being explicit about: `Tag.requirementGambit` (the
`requirement.gambit` key in the YAML) is a **different, unrelated flag** —
the schema comment on `Tag.requirementGambit` calls it out as cure-only, read
by the medical heal path (`web/lib/healRequests.js`) and nothing else. Trinket
does not set it and does not need to, because it never goes near
`craftRequestImpl` — the function that flag would have had to change — in the
first place. If a future recipe ever wants a SECOND Gambit-shaped Craft, that
flag is not the door to open; a bespoke action like this one is.

The filing side is otherwise the same shape as a lesson's learner half
(`db/lib/lessons.js`) or a confession (`db/lib/confession.js`): a whole-Move
`Action` with `moveKind: "GAMBIT"`, `moveReviewStatus: "OPEN"`,
`gmNotes: "auto:trinket"`, and the roll already stored on it
(`rollWithAdvantage`, so Lucky still applies). Filing charges the 4 ⬢ and
spends any inlay ingredient up front, the same "pay when the work starts"
rule every other recipe in `CRAFTING.md` follows — nothing about not knowing
the OUTCOME changes when the COST is paid.

## 3. Ingredients: inlay value, a second pool beside `cooked`

A smith may slot 0-2 raw materials into a Trinket, and each one adds its own
flat `inlayValue` to the finished price on top of the tier. Two new ores feed
this (Prospecting-sourced, `docs/miningdrops.yaml`): `{tag:malachite}` (6 ⬢)
and `{tag:hematite}` (3 ⬢), plus `{tag:iron}` — smelted from hematite at the
forge the same way `{tag:steel}` smelts from coal — which is worth less as an
inlay (3 ⬢) than the raw ore it came from is worth SOLD, on purpose: iron's
real value is as a smithing ingredient elsewhere, not as inlay filler.

`inlayValue` is `Tag.inlayValue` on the schema, a sibling column next to
`cooked` and validated the same permissive way (`db/lib/tagShapes.js`'s
`normalizeInlayValue`: a positive whole number, or absent — nothing like
`cooked`'s `taste`/`into`/`cures` machinery, because an inlay ingredient does
not need any of that).

**Cooking and Trinket are two separate ingredient pools, and they must stay
that way.** A recipe's ingredient SLOTS (`requirement.ingredientSlots`, the
same `{ min, max }` shape `COOKING.md` introduced) say how many slots a recipe
has; which tags are LEGAL to slot into them was never a list on the recipe —
it is "any tag carrying the relevant annotation", resolved by the caller and
handed to the shared `resolveIngredientSlots` (now exported from
`web/app/(app)/character/requestActions.js`) as a `cookableBySlug`-shaped map.
Cooking builds that map from `{ cooked: { not: null } }`; Trinket's own
request action (`trinketActions.js`) builds it from
`{ inlayValue: { not: null } }` instead. Same function, two disjoint pools —
a stew ingredient can never be slotted into a Trinket, and an inlay ore can
never season a stew, because each side only ever queries its own column.

The chosen ingredients are stored on the filed Action (see §4) and read back
at turn end, where their `inlayValue`s are summed and added to the tier's base
price. Nothing about which ingredients were used survives onto the minted
item's name or description — same posture cooking takes with a dish's own
ingredients (`COOKING.md` §5): the finished Trinket says what it IS, not what
it was made of.

## 4. Where the per-request words are stored

Lessons and Confessions never needed to store a per-request payload — a
Lesson's whole state lives on its `Offer` row, and a Confession is the same
shape. Trinket has no `Offer`; its state is genuinely per-Action: an optional
player name, an optional description, and 0-2 ingredient slugs, all of which
the turn-end pass needs back.

`Action.craftBudget` — the same `Json?` column the ordinary Craft ledger uses
(`CRAFTING.md` §2a) — is where this rides, deliberately reused rather than
given a new column: `{ kind: "trinket", name, description, ingredientSlugs }`.
This is safe precisely because the craft ledger and Trinket can never collide
on it — `checkCraftMove`/`spendCraftMove` only ever read this column on an
Action whose `gmNotes` contains `"auto:craft"`, and a Trinket Action's
`gmNotes` is `"auto:trinket"`, which that check does not match. Two different
`gmNotes` markers is what keeps two different `craftBudget` shapes from ever
being misread as each other.

## 5. Minting the result

At turn end (`db/lib/trinketPass.js`, in the same `TURN_PASSES` slot as
Lessons/Research/Confessions — order among the four does not matter, they
share no state): the stored die is clamped by the floor, mapped to a tier,
the ingredient values are summed on top, and the result is minted through
`mintCustomCraft` — moved to `db/lib/customCraftMint.js` for exactly this
reason (see §6) — with `literal: true` (the name is already decided, not
composed from words-plus-base the way a player-named custom craft is) and a
new `sellablePriceOverride` parameter that this pass is the only caller of.
Every other `mintCustomCraft` caller (cooking, the Death Mask, the arms and
armor) omits it and keeps copying `baseTag.sellablePrice` exactly as before.

The mint's dedup key (`cookedFrom`, cooking's own field, reused here the same
deliberate way `craftBudget` is above) is the sorted ingredient slugs PLUS a
synthetic `tier:<name>` entry — so a Good Trinket and a Masterwork Trinket
built from identical inlay never collide into one row just because a smith
typed the same words for both; the tier is as much a part of a Trinket's
identity as the ingredients are.

The reveal DM names both things a bare die face cannot: the tier, and what got
made — "🎲 Your Gambit for turn 14: **6**. The forge gives you a
**Masterwork** Trinket: **Masterwork Trinket** (worth 60 ⬢ to the merchant)."
(An inlaid Malachite would read 66 ⬢ instead — the tier's base price plus the
ingredient's own `inlayValue`, §3.) A player with no memory of this table has
no way to know a 6 is good news without being told in the same breath.

## 6. Why `mintCustomCraft` had to move

`mintCustomCraft`/`unmintCustomCraft` used to live only in
`web/app/(app)/character/requestActions.js` — fine while the only caller was
the web Craft dialog. Trinket's turn-end pass is different: it runs from
`db/index.js#resolveNeeds()`, which both the bot and the web app call, and
`db/lib` **never** requires anything under `web/` — that dependency direction
does not exist anywhere else in this codebase, and a turn pass was not going
to be the first place to start it.

So the mint itself now lives in `db/lib/customCraftMint.js`, and
`requestActions.js#mintCustomCraft` is a thin wrapper that catches the plain
`Error` the db-side version throws (there is no `UserError` down there — a
turn pass has no notion of a web request) and re-throws it as one. Every
existing caller keeps importing from the same place and behaves exactly as
before; only the implementation moved.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/trinketPass.js` | The turn-end pass: clamp, tier, price, mint, DM, resolve |
| `db/lib/customCraftMint.js` | The shared mint (`mintCustomCraft`/`unmintCustomCraft`), moved here so both faces can reach it |
| `db/lib/tagShapes.js` | `normalizeInlayValue` — the validation on `Tag.inlayValue` |
| `db/lib/syncTags.js` | Writes `inlayValue` from `docs/tags.yaml` |
| `db/lib/constants.js` | `SMITHING_SKILLED_SLUG`, `WORKSHOP_EQUIPMENT_SLUG` |
| `db/lib/advantage.js` | `rollWithAdvantage` — the shared Gambit d6, Lucky included |
| `web/app/(app)/character/trinketActions.js` | The request action: the gate, the charge, the filed Gambit |
| `web/app/(app)/character/requestActions.js` | `resolveIngredientSlots` (now exported, shared with Trinket's own `inlayValue` pool), `resolveCraftPayer`, the `mintCustomCraft` wrapper |
| `docs/tags.yaml` | `{tag:trinket}` (the base shape), `{tag:malachite}`, `{tag:hematite}`, `{tag:iron}` |
| `docs/miningdrops.yaml` | Where `malachite`/`hematite` turn up prospecting |
| `db/test/trinketPass.test.js` | The pure half — the tier table and the skilled floor |
