# Player actions: acting, and the record it leaves

How a player changes their own sheet, and what a GM can do about it
afterwards. Companion to `ADJUDICATION.md` (the GM-facing Moves desk),
`CHARACTERS.md` (creation and the point economy) and `TAGS.md` (the tag
catalog).

## 1. The shape of it

The game runs one turn per real-world day for a month. Any mechanic that needs
a GM in the loop before it resolves costs a player a day. So there is no
approval step anywhere: the player clicks, the effect lands, and that is the
whole transaction.

1. The player clicks a button on their character sheet.
2. A popup collects the type-specific fields, if there are any. **It does not
   ask for a reason.** Nothing is being justified to anybody.
3. The player confirms.
4. The effect is applied and **one `AuditLog` row** is written, in the same
   transaction, through `logAudit()` in `web/lib/requests.js`.
5. A GM reads it on `/gm/audit`.

**There is no `Request` table, and no Undo.** An action applies its effect and
writes one `AuditLog` row — no approval gate, no reason field, no reversal
handler.

**A GM repairs a sheet by hand, from the Dev Panel:**
`TagEditor` adds a tag back or takes one off, "Transfer ⬢" reverses a transfer,
Teleport reverses a move (`DEV-PANEL.md`). For that to be possible the audit
`details` blob has to carry enough to rebuild what was destroyed, which is why
Destroy, Consume, Loot, Break Seal and Transfer all write a `restore`
snapshot — the tag's original `source`, `expiresTurn` and quantity — into
`details`. **A new destructive action must do the same**, or a GM can only put
back a fresh grant with a full duration.

### 1a. Three things that are not audit trail

`AuditLog` is normally a record. In three places it is read back as live game
state, so the row has to be written for the rule to work at all:

| Ration | Counts | Written by |
|---|---|---|
| A medic's free 0-turn cures a day (`MEDICAL_SIMPLE_PER_TURN`, `TAGS.md` §5c / `MEDICAL.md` §3) | `request_heal_character` rows for the open turn, filtered to `!gambit && turns === 0` | `healCharacterRequestImpl` |
| Dead Simple units a turn (`DEAD_SIMPLE_PER_TURN`) | `request_craft_tag` rows for the open turn | `grantCrafted` |
| A single recipe's own `requirementPerTurn` | the same craft rows, filtered to one `tagId` | `grantCrafted` |

All three read `AuditLog.turnId`, which exists for exactly this and is indexed
with `targetCharacterId` and `actionType`. **An action that a ration counts
must set `turnId`**, or the ration silently reads zero and stops being
enforceable. The `/depot` ledger reads the audit log too, though only to
display.

## 2. What the `details` blob carries

Every action writes one `AuditLog` row, and its `details` JSON is the entire
record of what happened. It is written from the **applied** values, never from
what the player asked for and never re-derived later from live state — a
character's sheet moves on, and a row that read the current sheet would
describe the wrong thing a day later.

Two rules for anyone adding an action:

- **Snapshot what a repair would need.** Anything destructive carries
  `restore: { tagId, source, expiresTurn, quantity }`, because the Dev Panel is
  the only way back and a GM can only type in what the row tells them.
- **Set `turnId` if a ration counts it** (§1a). It is also what `/gm/audit`'s
  turn filter reads.

The `request_` prefix on most `actionType`s is a fossil of the Request table
and is kept on purpose: renaming ~35 of them would orphan every row already
written under the old names, and what a GM reads is the family label
("Player action") rather than the key.

## 3. The actions

> These were `RequestType` enum values until the Request table was dropped.
> They are `AuditLog.actionType` strings now — `ADD_TAG` is `request_craft_tag`,
> `REMOVE_TAG` is `request_destroy_tag`, and so on. The mechanics below are
> unchanged; only where the row lands has moved.
>
> **Everything below that describes an Undo is history.** There is no Undo any
> more (§1). Those passages are kept because they document what each action
> actually changed — which is exactly what a GM needs in order to reverse one
> by hand from the Dev Panel — but no button runs them. This half of the doc
> has not been reworded line by line yet.

Deliberately uncounted — a stale number outlived three counts here already;
the table below and the `RequestType` enum are the record. Most live in
`web/app/(app)/character/requestActions.js`, the two Lifeweb types in
`web/app/(app)/lifeweb/requestActions.js`, `BUY_TAGS`
in `web/app/(app)/store/actions.js`, the Depot family in
`web/app/(app)/depot/`, and `CAVING_LOOT` is filed by the turn
engine rather than by anybody. Each one
authenticates, **re-validates everything the client sent** (a server action is
a public endpoint, and the client's filtered menus are only advisory), applies
the effect, and writes the `Request` plus an `AuditLog` row carrying the same
reason.

| Type | What the player does | GM can edit | Undo |
|---|---|---|---|
| `TRANSFER_RESOURCES` | Moves ⬢ from you or a Room stash at your Location to a person at your Location or a Room stash there (`CARRY.md`). Nothing is ever pulled off a living person — Loot is the only way to take from someone. `direction: "LOOT"` pulls ⬢ off a corpse in the same room | — | Reverses the movement |
| `ADD_TAG` | Craft: makes a tag whose `requirement.skills` you hold, charging its `resourceCost` up front to a payer — yourself, a Room stash here, or a person here (`CRAFTING.md`). `turnsCost` is a decimal number of Moves: 0 is Dead Simple (no Move, rationed per turn); 0.25 / 0.5 / 0.75 are shares of this turn's Routine; 1 is the whole of it; 2+ opens a `CraftProject`, continued from the same dialog. Stackable tags take a quantity and stay on the menu once held. Desk label: **Craft** | cost; remove what this request added | Drops what it added, refunds the cost, marks any project CANCELLED |
| `BUY_TAGS` | Checks out a whole `/store` cart with Tag Points — one request per cart, `effect.items` listing every tag | — | Returns every tag in the cart, refunds the points |
| `REMOVE_TAG` | Destroy: drops one of their own items, no ⬢ field and nothing refunded, in a quantity if it stacks. `Tag.removable` is derived from the category — Items and Assets only (`CRAFTING.md` §5) — so a Health tag is healed rather than thrown away, and a Belief cannot be dropped at all. A tag with `removesInto` leaves its treated form behind (`TAGS.md` §5c). Desk label: **Destroy** | — | Restores the tag and its count, takes back the aftermath it granted |
| `CONSUME_TAG` | Uses up one of their own `consumable` tags — always exactly one, even from a stack — and gains whatever it `consumesInto` | — | Restores the one unit with its original expiry, takes back what it granted |
| `TRANSFER_TAG` | Hands an Item or Asset from you or a Room stash to a person at your Location or a Room stash there, in a quantity if it stacks. Nothing is ever taken from another person this way. The merged Transfer dialog files one of these per tag line (`CARRY.md` §6). `direction: "LOOT"` lifts one off a corpse at your Location | — | Moves that many back to where they came from |
| `FULFILL_DESIRE` | Claims one active, slotted Desire (`desireId`, not "the" active one — a character can hold several at once, one per slot) | Tag Points awarded | Revokes the points and reopens the *row*. Because a GM Fulfil/Cancel operates on a specific `desireId` rather than "whatever's in the slot now," an Undo is safe even after a new Desire has since been set in that same slot — it only ever touches the row it snapshotted, never the slot's current occupant |
| `DONATE_BLOOD` | Mortus bleeds someone into the Lifeweb | blood added; clear Drained | Draws the blood back, clears Drained |
| `FEED_PERSON` | Mortus feeds someone to the Lifeweb | blood added | Draws the blood back (never revives) |
| `HEAL_CHARACTER` | Treats a `healable` affliction on anyone at their Location who isn't concealed, on whoever's tab they choose, billed to a payer — yourself, a Room stash here, or a person here. An affliction with `removesInto` leaves its treated form on the patient (`TAGS.md` §5c) | cost; put the affliction back (which also takes the aftermath off) | Restores the tag with its original expiry, takes back the aftermath, refunds the payer |
| `RESEARCH` | A Scholastic in the Cathedral spends their Move as a GAMBIT studying a held ingredient — the die and the Hunger/Mood modifier are rolled and stored at submit, same as a Lesson's. Nobody adjudicates it: the Research pass resolves it at turn close, not a GM (`TURN-ENGINE.md` §2, `CRAFTING.md` §2b) | — | Nothing to undo once the pass has resolved it; before then, Reject the Action to give the Move back |
| `request_whisper` | Spends a Raven Draught to send one typed sentence to any character in the game, immediately (`BIRD.md` §8a). No zone guess, no letter, no literacy, no reply. It reports "Sent." whatever happened — the row's `delivered` is the only record, and a whisper to a dead name is silently spent | — | Restores the bottle |
| `request_stepstone` | Spends a Stepstone to stand in any **surface** Location, known or not (`MAP.md` §3b) — the underground is the one refusal, so the stone cannot drop somebody past the caving gate. No ⬢, no Move, no adjacency, no Action, but a hold still stops it. Escorts are cut loose and no gate line is posted | — | Restores the bottle and the old `locationId`/`zoneId` |
| `CHANGE_NAME` | Takes a new honorific/first/last name | — | Restores the previous name |
| `CAVING_LOOT` | Nothing — the turn engine files it when a Caving Die rolls a 6 (`CAVING.md`) | — | Drops the find |
| `LOOT_CHARACTER` | Searches a body, **or** anyone Bound/Dying/Paralyzed/Catatonic in their zone, taking Items, Assets and ⬢ in one act | — | Returns every tag with its original expiry, and the ⬢ |
| `BIND_CHARACTER` | Ties up anyone at their Location who isn't concealed. A conscious, unhelpless target must accept an Offer first (`LESSONS.md` §3b); a target who is dead or already holds an incapacitating tag is bound on the spot | — | Cuts them loose |
| `FREE_CHARACTER` | Cuts someone in their zone loose — ropes or shackles (`bound` or `shackled`) | — | Puts the restraint back with its original expiry |
| `SHACKLE_CHARACTER` | Turns a Bound person's `bound` into `shackled`. Needs a `COMPLETE` `dungeons` Structure where the actor stands (seeded in the Cathedral, Garrison and Lifeweb; nobody can build one). **No consent and no Move**, anyone may. Shackled is Bound in every way except Break Restraints, which only an Escape Artist can attempt (`LESSONS.md` §3c) | — | Swap `shackled` back to `bound` from `/gm/dev` |
| `CRUCIFY_CHARACTER` | Puts the `crucified` status on anyone standing at their Location. Needs the `fundamentalist` tag and a `COMPLETE` `crucifix` Structure standing there. **No consent and no Move** — the cross is the gate. Crucified blocks ACT and not SPEAK (`TAGS.md` §5f), becomes Dying at the close of the turn, and the Dying pass kills at the next | — | Drops `crucified`. After the close only Dying is left, and Undo leaves it — heal that |
| `TORTURE_CHARACTER` | A Torturer works on someone Bound and standing here. One d6 resolved on the spot (`TORTURE.md`): a break DMs the torturer every tag but wounds and statuses, the last three Desires and, off a Thanati Leader, the cult roster, and puts Depressed on the victim; either way the victim takes −40 mood and the torturer's Move is spent as an auto-Routine | — | Take Depressed off from `/gm/dev`; the mood is a dial edit. Reject the Action to give the Move back |
| `HARM_CHARACTER` | Inflicts a Health affliction on someone already helpless, **kills** them, or both — see §5b | — | Heals what was inflicted; never revives |
| `BURY_CHARACTER` | Puts a body into the ground, lifting the **Cursed** role off the dead player's Discord account. Needs their **actual corpse tag**, held or reachable in a room here, and spends the filer's Move | — | Raises the body and puts the corpse back where it came from; does **not** re-curse, and the Move stays spent |
| `ENGRAVE_HEADSTONE` | Frees a soul with a stone instead of a body, for **4 ⬢** and the filer's Move. Target is **typed**, first name only, matched **game-wide**. Leaves a `{name}'s Headstone` tag | — | Refunds the ⬢, takes the stone, reopens the grave; does **not** re-curse |
| `BUTCHER_CORPSE` | Cuts a corpse up for what is in it — an organ from a monster, Human Flesh from a person. Free, and it destroys the body. Gated on `butcher` | — | Takes the yield back and returns the corpse to the party it came from |
| `FAST_TRAVEL` | **Retired.** A mount now adds a free zone move instead (CARRY.md §2a). Old rows stay undoable | — | Sends them back and returns the ride |
| `EXTRACT_GODFLESH` | Cuts Godflesh out of a marsh tile. Costs no Move — once per in-game day, claimed on `Character.extractDayKey`. Needs a blade equipped, rolls a d6 — a 6 pays an extra, a 1 rolls an injury table that Armored Gloves dominate (`FACTORY.md` §3) | — | Takes the Godflesh back and heals what it cost; the day stays claimed |
| `PACKAGE_ITEMS` | Packs up to 150 lb of held goods into one crate weighing half that, with a line the packer types. Needs Packaging Equipment in reach; costs no Move (`FACTORY.md` §5) | — | Prises the crate open, returns the contents, deletes the runtime Tag |
| `BIRD_MESSAGE` | Sends one written letter to a named person in a **guessed** zone. Once a day, gated on `bird` + `literate`. A wrong guess or a dead recipient means it never arrives, and the sender is told a turn later (`BIRD.md`) | — | Hands the day back and closes the reply window; **cannot unsend a letter that landed** |
| `DEPOT_BUY` | Buys an import off the orbital station at its `depotPrice`. Licence + standing at the Depot (`DEPOT.md`) | — | Returns the goods, refunds the ⬢ |
| `DEPOT_SELL` | Sells a `sellable` tag to the station at its `sellablePrice` | — | Buys it back with its original expiry, takes the ⬢ |
| `DEPOT_CREDIT` | Draws on or repays the Company's 60 ⬢ credit line | — | Reverses the ⬢ and the tab together |
| `INTERCEPT` | Lays in wait where they stand: names who they are watching for (or "anyone", or "anyone concealed"), writes a line to hand them, and picks Safe or Ambush. Costs no Move and no ⬢. When one of them walks in, they are stopped — two minutes, or until the turn ends. **A typed name never catches a hooded face**; that is what "anyone concealed" is for (`INTERCEPT.md`) | — | Nothing to undo: the hold lapses on its own, and the holder can Release early |
| `BUILD_STRUCTURE` | Filed by whoever's crew-turn FINISHES a build site — the one Request a structure ever files, carrying type, ground, cost, payer and every contributor (docs/systemdocs/ADJUDICATION.md §6) | — | Tears the structure down, refunds the payer, and restores any edge it flipped (conditionally — see the Discord note below); the crew's spent Moves stay spent |

(`DAMAGE_STRUCTURE` is also in the enum, declared ahead of use because
Postgres cannot drop enum values — nothing files one; GM structure rulings
are AuditLog microactions on `/gm/structures`, not Requests.)

**Two buttons on that grid file no `Request` at all**, and both are reads
rather than acts: **Read** (`ReadDialog.js`, a purely local decode of a
ciphered letter) and **Look at** (`examineActions.js`, examining somebody
standing where you stand — `PROXYING.md` §4a). Neither moves anything, costs
anything or spends a Move, so there is nothing for a GM to review and nothing
to undo. Both skip `RequestDialog` — `NO_REQUEST_MODES` in
`RequestActionsProvider.js` — and get their own plain modal, because the
universal "what is your reason?" popup has nothing to ask them.

The per-type behaviour lives in `web/lib/tagEffects.js` as one
`REQUEST_EFFECTS` entry each. **Adding a type means adding one entry
there, one renderer in `web/lib/auditNarrative.js`'s table, and one value in the
`RequestType` enum — nothing else in the adjudication surface changes.** That
extensibility was an explicit requirement, and every type added since — the
two Lifeweb ones, the eight of the Actions grid, then the Depot's three — cost
exactly that.

The Depot's three are the only ones whose **counterparty is not in the game**.
An orbital station has no balance to debit and no stock to run down, so each
moves exactly one side, and there is nothing to reverse but his own. They are
also the only three where the price is enforced rather than adjudicated: a GM
does not sign off a purchase, which is why none of them is editable — ⬢ and
stock moved together, and a price nudged afterwards would leave them out of
step with no way back. Undo is the whole correction.

**Validation is returned, never thrown.** Every one of these actions and
`resolveRequest` reports a validation failure as `{ ok: false, error }` via
`guarded()`/`UserError` (`web/lib/actionResult.js`), because a production
Next.js build redacts anything thrown out of a Server Action and shows React
error #441 instead — which made every `catch (e) => setError(e.message)` in
the feature dead code. Anything that isn't a `UserError` still throws, so real
faults keep their stack and `redirect()` keeps working.

**`BIRD_MESSAGE` is the first type whose effect Undo cannot reverse.** Every
other row above moves something inside the database, and `effect` is enough to
put it back. A letter is a Discord DM in somebody's inbox, and there is no
un-sending it. So its Undo does the two things it still can — returns the day
the letter cost and shuts the reply window — and its note says plainly that the
message itself stands. Worth knowing before adding another type whose real
effect leaves the database: the honest move is to reverse what you can and say
what you can't, not to pretend the handler is a full inverse.

Three notes on deliberate choices:

- **Transfer never takes from another person.** From is you or a Room stash at
  your Location; To is a person at your Location (who isn't concealed) or a
  Room stash there. Pulling ⬢ or an item out of someone else's pocket is no
  longer a Transfer at all — Loot is the only way to take from somebody, and
  only from the helpless or dead. This replaced an earlier design where the
  source could be anyone in reach; that let a player pick another player's
  pocket with nothing but a written reason, which was more of the fiction's
  "action at a distance" than Bascinet wanted once the menus went
  Location-scoped (see §6).
- **Transfer Tag is send-only for the living, plus a LOOT direction for
  corpses.** There is no "request a tag from a live someone", because
  browsing another player's inventory to pick something is the abuse the
  one-way flow prevents. But a dead character is a lootable pile: filing a
  `TRANSFER_TAG` with `direction: "LOOT"` names a corpse at the same Location
  as the counterparty and pulls the item OFF it. Being in the same place is
  folded into the same `WHERE` clause in both directions. `TRANSFER_RESOURCES`
  mirrors this: a `LOOT` request pulls ⬢ off a corpse and can only credit the
  initiator. See `CHARACTERS.md` §5.
- **Every request whose subject is a different character notifies that
  character.** `TRANSFER_TAG`, `TRANSFER_RESOURCES`, `HEAL_CHARACTER`,
  `LOOT_CHARACTER`, `BIND_CHARACTER`, `FREE_CHARACTER`,
  `CRUCIFY_CHARACTER`, `HARM_CHARACTER`, `BURY_CHARACTER`, `DONATE_BLOOD` and
  `FEED_PERSON` all DM
  their target through `web/lib/notifyCharacter.js` — one line, fired after
  the transaction commits, same posture as the Dev Panel's own notifier
  (`DEV-PANEL.md`). **The DM never names the actor.** Several of these only
  work on someone helpless (a bind, a looting, a forced move), so telling the
  victim what changed while leaving out who did it keeps that information in
  the fiction rather than handing it to them for free. A self-targeting act
  (healing yourself, donating your own blood) sends nothing — you already
  know what you just clicked. `killCharacter`
  (`web/lib/discordGuild.js`) carries the one death DM for every path that
  kills a character, so a GM's Kill button and an adjudicated lethal outcome
  never send two.
- **A dead target's notice is swallowed once its player has moved on.**
  `LOOT_CHARACTER`, a corpse Mutilate, Butcher, Bury and Engrave can all act on
  a character who is no longer ALIVE. If that Discord user already controls a
  different living character — a Metempsychosis reroll, or an ordinary Cursed
  one — `notifyCharacter` no-ops instead of DMing them about their old body,
  using the same `stillAlive` check `db/lib/reincarnate.js` and the death
  teardown already rely on. A corpse whose player hasn't come back yet still
  gets the DM as before.
- **Consume has no resource field and no quantity field.** A meal already
  cost ⬢ to make, and Consume is where it restores hunger now (§4) — a
  resource charge on top would be the same meal paid for twice; and taking
  one unit at a time is the point of a stack. See `TAGS.md` §5b.
- **Transfer Tag and Loot both filter on `tradeable`.** Not on `category`,
  which is what they used to do and which was wrong in both directions — it
  let a corpse be stripped of its Drone, and it ignored the
  Items that already said `tradeable: false`. One flag covers handing over and
  taking off a body alike. `web/lib/tagRequests.js#isTradeable` is the only
  reader, so the menus and the server-side re-checks can't disagree. See
  `TAGS.md` §5.
- **Add Tag is the crafting menu, and only that.** It used to admit a second
  route — `purchasable && purchasableAfterStart` — so a tag could be *bought*
  here as well as made. That was 155 tags, every one of them also priced in
  `/store`, and Add Tag costs nothing but a written reason. It was therefore
  strictly cheaper than paying Tag Points, and players used it that way:
  Butcher, Horse, Stealth, Literate, Ranged (Basic), Workshop, Game Master.
  The help text asking them not to was the tell that the option should never
  have been on the menu. The two economies are now split at the door —
  `/store` spends points against catalog prices, Add Tag (Craft) spends turns
  and ⬢ against a recipe.
- **The recipe's `requirement.skills` is enforced now, not honor-system.**
  A Longbow's `requiredTag: ranged-basic` says who can *shoot* it; its
  `requirement.skills: [crafting]` says who can *make* it. Creation and
  `/store` always enforced the former. Craft used to leave the latter to the
  picker's "To make: …" hint and the GM review as the backstop
  (`TAGS.md` §3b); it now checks server-side that the crafter holds every
  listed skill or a higher tier, the same walk Heal uses
  (`CRAFTING.md` §2). A smith with no combat skill can still forge weapons to
  sell; a fighter still pulls one from an armoury the fiction gives them, but
  only by actually holding the skill. The hidden-category group gate stays
  unconditional on top of that, so a craftable in a hidden category is still
  invisible outside it.
- **Undo never re-syncs Discord.** `resolveRequest` (`gm/turns/actions.js`)
  runs a request's `undo()` entirely inside one transaction, and no network
  call may run inside a `$transaction` (`ARCHITECTURE.md` §5) — so undoing
  `ADD_TAG`/`REMOVE_TAG`/`CONSUME_TAG` leaves `#cerberon` access
  stale until the next Move reconciles it, and undoing `CHANGE_NAME` leaves
  the personal Discord role stale until the player's next Bio save
  (`ensureCharacterRole` always re-PATCHes off the live DB name, so that save
  self-heals it). Accepted rather than fixed: the forward path already pays
  for the Discord call outside the transaction, and a bespoke undo path for
  each type would be the `killRequestTarget` treatment for something this
  minor.


## 4. Hunger and the Gambit modifier

Hunger is the Needs layer, and one of two things that modify a Gambit die
(the other is mood).

It is now a 0-100 meter, `Character.hungerValue` (`db/lib/hunger.js`), not a
streak. Two Status tags read off it — `hungry` (`docs/tags.yaml`,
`durationTurns: 1`, granted at `HUNGRY_THRESHOLD` (30) or below) and
`starving` (granted at `STARVING_THRESHOLD` (0) or below) — neither
`purchasable`, neither destroyable (Status never is).

Riding the tag system means the per-turn expiry sweep already in
`db/index.js#resolveNeeds` handles their removal for free —
`characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } })` —
with no bespoke expiry column to keep in step. Eating also drops them
immediately, outside the sweep — see below.

> **Create Item and the zone cache are gone.** `CREATE_TAG` let a player invent
> an Item that wasn't in the catalog and have it become a real `Tag` row on their
> sheet; `DROP_ITEM` / `PICK_UP_ITEM` let them leave an Item on the ground in a
> zone for anyone standing there to take, backed by a `ZoneCache` table. The
> buttons, the server actions, the `REQUEST_EFFECTS` entries and the table were
> all removed, and `db/prisma/migrations/20260828150000_drop_zone_cache` drops
> `ZoneCache`. Bascinet didn't want a player-facing tag-creation system, and the
> cache never earned its complexity — `db/lib/pruneTags.js` had no `zoneCaches`
> survival check, so a prune could delete a Tag that was lying on the ground.
> **The three `RequestType` values survive**, because Postgres cannot drop an
> action type in place; `auditNarrative.js` still names them so a row filed before
> the removal reads as prose, but nothing renders a body for it and nothing can
> undo it. GM-authored custom tags at `/gm/dev/tags` are a separate system and
> are untouched (`TAGS.md` §5d).

> **There is no `SET_MOOD` request, no `happy`/`unhappy` tags, no Set Mood
> button.** Drinks leave `tipsy`, `high` or `euphoric` instead (`MOOD.md`).

### Hunger

Nothing player-initiated ever grants or removes Hungry, Starving, or the
`dying` chain prolonged Starving leads to — there is no request type, no
picker entry, no `tagEffects.js` case for any of the three.
`db/lib/hungerPass.js#runHungerPass` is the only turn-pass writer of
`hungerValue`, `starvingSinceTurn`, and the two band tags, called from
`resolveNeeds()` at the close of every turn:

1. Holds `hungerless` → **skipped entirely**. Pinned at `HUNGER_MAX` (100),
   `starvingSinceTurn` cleared — this is immunity, not eating, so it is
   always a full reset rather than the ordinary decay below.
2. Holds `fast-metabolism` → decays **20** instead of the flat 10.
3. Everyone else → decays **10**, floored at 0.

**Hunger costs no ⬢ at all.** The old upkeep — pay 1 ⬢ (2 with Fast
Metabolism) or go Hungry — and the escalating streak penalty it drove are
both gone outright. `Character.hungerStreak` is an orphan column now, the
same fate as `Character.missedMealStreak` (`TURN-ENGINE.md` §5a); nothing
writes or reads it.

What raises the meter is eating, not a turn spent fed. Consume restores
`foodHungerFor(tag)` — a raw foodstuff's own `cooked.hunger`, a minted dish's
`Tag.mealHunger` (summed across every ingredient for a cooked plate), or a
flat fallback for an unpriced item that still grants `ate-meal` — in one
atomic, clamped write (`LEAST(HUNGER_MAX, "hungerValue" + restored)`,
`web/app/(app)/character/actions/misc.js#consumeTagRequestImpl`). The
Hungry/Starving tags come off the moment the meter crosses back over their
threshold, not at the next sweep — `db/lib/hungerBands.js#clearHungerBands`,
shared with the Dev Panel's Feed Them button.

**Bands, not a streak.** `db/lib/hunger.js#crossings` reports, per turn,
whether the meter crossed DOWN into Hungry or Starving for the first time
(never merely for remaining there) — each fresh crossing grants the tag
(`expiresTurn` one turn out, `createMany({ skipDuplicates: true })`) and
charges a one-time **−30** mood hit (`HUNGRY_ONSET`/`STARVING_ONSET`,
`MOOD.md`); crossing back UP over a threshold drops the tag. Starving sits
*inside* the Hungry range — a character at or below 0 holds both tags
together — and only the Gambit modifier picks one, below.

**Three consecutive closes at 0 or below** (`STARVING_DEATH_TURNS` — an
inference this rework made; the doc names no such rule) grants `dying`, the
same terminal tag every untreated-wound chain lands on (see `TURN-ENGINE.md`
§3's "NOTHING HERE KILLS ANYONE"). The pass itself still kills nobody;
`dying` carries a one-turn clock, and the Dying death pass (`TURN-ENGINE.md`
§2 4b) is what ends it at the next close. `Character.starvingSinceTurn` is
the clock: stamped the turn the meter first reads at or below 0, cleared the
instant it eats back above 0 — eating on the second of three starved turns
resets the count to zero, not merely pauses it.

**The expiry arithmetic**, and why the pass runs *after* the sweep, is
unchanged from before the rework:

| moment | what happens |
| --- | --- |
| close of turn **N** | sweep deletes `expiresTurn <= N` — clears a band tag granted at the close of N−1 |
| close of turn **N** | pass grants Hungry/Starving with `expiresTurn = N + 1` |
| turn **N+1** open | tag is live; every Gambit rolled this turn takes the modifier |
| close of turn **N+1** | sweep (`lte: N+1`) deletes it |

Run the pass *before* the sweep instead and a still-hungry character's
re-grant collides with `@@unique([characterId, tagId])` and is silently
dropped, leaving them holding a tag that expires immediately.

The DM copy for each crossing — `hungry` / `starving` / `recovered` / `dying`
— lives in `db/lib/hunger.js#hungerDm`/`DYING_DM`. None of the four lines
names a number, per the design: a player learns their band from the tag chip
on their own sheet, never a figure. `runHungerPass` does not send any of
these itself. It returns `hungerNotices` on its summary — one entry per
character who freshly crossed into Hungry or Starving this close, carrying
`discordUserId`, a `kind` (`"hungry"` / `"starving"`), and `justDied` — and
the sending happens in `advanceTurn()`'s `runSideEffects()` thunk, alongside
the turn announcement and the message wipe. The pass is therefore reads and
bulk writes with no network call in it at all — which matters because at
100+ players the DMs are sequential Discord round-trips, and awaiting that
inside the Dev Panel's server action used to hold the request open long
enough to freeze the web app's navigation.

The pass writes **one summary `hunger_resolved` audit row** per turn, not one
per character — at 100+ players the latter would push 200 entries a day into
`/gm/audit` and drown every human-authored line.

### The summed modifier

Hunger and mood are the two contributors. `db/lib/gambitModifier.js` is still
the single source of the sum, shared by the bot and the web app so the number
a player is shown and the number applied cannot drift — the same posture as
`specialChannels.js`. It still returns a *list* of named contributions rather
than a bare number, because the confirm DM names them and because adding a
third contributor should be an append there rather than a rewrite of five
call sites.

Hunger is no longer a Character column feeding a formula — `hungerBandOf`
reads the `hungry`/`starving` tags straight off the character's own held
tags, the same list every other tag-driven modifier reads, and picks
**Starving over Hungry, never both**: `−1` Hungry, `−3` Starving.
`gambitModifiers`/`gambitModifierTotal` take that tag list and `{ mood }` —
mood still rides in as a second argument, since it lives on `Character`, not
a tag.

Only a Gambit rolls a die, so only a Gambit can carry the modifier.
`bot/src/events/interactionCreate.js#handleMoveConfirm` stores the **raw** roll
on `Action.diceRoll` and the **sum** separately on `Action.diceModifier`.
Keeping them apart is deliberate: a GM has to be able to tell a modified 5
from a natural 5, and a re-roll during adjudication must not compound the
modifier. `Action.diceModifier` is one `Int`, so the per-contributor breakdown
is display-only — rebuilt for the DM, and mirrored into the `move_confirmed`
audit entry's `diceModifiers`, which is the only place it survives.

The DM reads `🎲 **4** −1 Hungry → **3**`. It is keyed on whether *any*
contributor applied rather than on the total, so a contributor worth 0 would
still show its work instead of pretending nothing happened.
The sheet band's Gambit tile (`LedgerBand.js`) reads the same module.

## 5. Desires

A Desire is now picked from a catalog (`DesireTemplate`, sourced from
`docs/desires.yaml`) rather than typed as free text on a fixed ladder — the
1–5 points-and-ladder system is gone. Full writeup of the catalog, its
gates, cooldowns and the tag-group lock mechanism:
[`DESIRES.md`](DESIRES.md). This section covers only the request-level
mechanics.

`Desire` holds one row per set/cancel/fulfil attempt, `slotIndex`-scoped: a
character can hold up to `GameConfig.desireSlots` (default 2) `ACTIVE` rows
at once, one per slot, each independent of the others. At most one `ACTIVE`
row per slot is enforced in the server action rather than the schema (the
constraint is "one ACTIVE per slot", not "one row"). Setting a new one in an
already-occupied slot — from the player's `setDesire` or the Dev Panel's
`setDesireGm` — cancels that slot's current one first, in the same
transaction.

**Setting and cancelling are still not requests** — nothing has been
granted, so there is nothing for a GM to undo. Both go through
`useConfirm()`. Only **fulfilling** moves Tag Points, so only fulfilling is
a `Request` (`FULFILL_DESIRE`) with a reason and a review.

Ending a Desire either way (cancel or fulfil) stamps `endedTurnNumber`,
which drives two independent cooldowns, not one — see `DESIRES.md` §2 for
the full mechanics:

- the **slot** locks until the next turn regardless of which template
  ended, so a slot can't be cancelled and immediately refilled in the same
  turn;
- the specific **template**, once fulfilled, is unavailable again for its
  own tier-length (or `cooldownTurns`-overridden) cooldown, independent of
  the slot.

The confirm dialog warns about the slot lock before the player commits.

Undoing a fulfillment revokes the points **even if that drives the balance
negative**. That is intended: if the player already spent them, digging out
is their problem, not a GM's. The same "even into negative" posture applies
by adjudication, not code, to curing an Addiction or Restriction tag —
`DESIRES.md` §7's clawback rule.

`GameConfig.desiresEnabled` used to be a Dev Panel switch that closed the
faucet without freezing what was already in flight. It was deleted in the
2026-09-07 config trim, unused — Desires are the only way Tag Points are
earned in play, so closing them stops
mid-goal. `/character` greys the "set a new Desire" form and shows
"Temporarily disabled." in its place. Unaffected: `setDesireGm`/`endDesireGm`
on the Dev Panel (host access, not game permission — same split
`/lifeweb`'s GM panel uses; a GM grant also bypasses every catalog gate, per
`DESIRES.md` §6) and the Discord 🔍/⚜️ inspect surfaces, which stay
read-only regardless.

## 5a. The Lifeweb

`/lifeweb` is gated on the `mortus` tag. Its two buttons are Requests like any
other — they land immediately and a GM reviews afterwards — with three wrinkles.

**Both of you have to be in the Fortress.** The tower is up the Keep stairs, so
tending the Web is the same reach rule as every other person-touching Request
(`MAP.md` §3): `requireMortusCharacter()` refuses a Mortus standing anywhere
else, and the target lookup folds `zone: { slug: FORTRESS_SLUG }` into its WHERE
clause, so a person elsewhere on the map simply isn't found. Getting a victim to
the tower is a journey somebody physically makes. The page stays readable from
anywhere — a Mortus in Town sees the gauge with both buttons disabled and the
reason underneath — and the picker only offers people already at the tower. The
**GM panel on the same page is not gated**; that's host access, not game
permission.

**Whose blood it is decides what it's worth.** Keyed on the *target's* tags,
not the Mortus doing the bleeding: Nobility 40, Courtier 30, anyone else 20;
holding both pays the higher. Feeding a whole person is a flat 100.
`db/lib/lifeweb.js` is the single source of those numbers, shared with the GM
panel on the same page (`web/app/(app)/lifeweb/actions.js`) so the two paths
can't grant different amounts — the same posture as `gambitModifier.js`.

**The pool caps at 100, so the nominal amount is not the applied amount.**
Donating 40 onto a pool at 90 moves 10. `applyBlood()` returns that delta and
it is `bloodDelta` on the effect that Undo reverses — §2's payload-vs-effect
rule applied to the blood pool. Reversing the nominal 40 would mint 30 blood
out of nothing.

**Feed Person kills, on the click.** It used to stop short — fill the pool,
raise a mark in the audit line, and wait for a GM's Kill on the Dev Panel — on the
argument that a player must not end another player's game from a dropdown.
What that bought in practice was a character everyone had watched be fed to
the Tower still walking around until someone worked the queue.

The gates are what protect a player, not the delay, and every one of them is
still checked server-side: a living **Mortus**, standing in the **Fortress**,
against a living target standing there too, with a **reason** that is required
and logged. A GM reads it afterwards rather than before.

The kill is claimed inside the same transaction that moves the blood, with the
conditional `status: "ALIVE"` where-clause every death path uses
(`db/lib/characterDeath.js`), so two Mortii feeding the same person in the same
second cannot both claim it; the Discord half (`killCharacter()`) runs after
the commit, never inside the transaction. `effect.killed` and `effect.killedAt`
are stamped there.

The **Kill** button that used to sit on the Requests row is gone with the rest
of that tab, and so is `killRequestTargetImpl`. The fallback it covered — the
claim not landing because the target was already dead — is a Dev Panel job
now: `/gm/dev/characters/[characterId]` has Kill directly (`DEV-PANEL.md`).
Nothing revives on its own.

Both buttons ask twice: the `RequestDialog` reason, then `useConfirm()` before
anything is written. They act on someone else's character, which is the one
place in the Requests system where that second gate is worth the friction.

## 5b. Coercion: Bind, Loot, Move, Harm

Four requests that act on somebody else, and one tag holding them together.

`bound` is the hinge. `LOOT_CHARACTER`, `HARM_CHARACTER` and the "or
helpless" branch of escorting (`db/lib/escort.js`) all read
`db/lib/incapacitation.js`'s
`INCAPACITATING_SLUGS` — `dying / catatonic / paralyzed / bound` — and for a
long time nothing in the game **granted** Bound. A GM had to place it by hand,
which is the day of real time §1 exists to save, so `BIND_CHARACTER` and its
counterpart `FREE_CHARACTER` close the loop.

**Neither one is gated beyond co-presence — but Bind now needs consent unless
the target is already helpless.** A conscious target who holds no
`INCAPACITATING_SLUGS` tag gets an Offer (kind `BIND`), not an instant bind: a
DM asking "Accept?", answered from the same handshake Learn/Teach uses
(`LESSONS.md` §3b). A dead or already-incapacitated target is bound on the
spot, as before. Free is unchanged — anyone standing there can cut somebody
loose again, no consent asked — so a captor who wants their prisoner kept has
to keep other people out of the room, which is a fiction problem rather than a
permissions one. Co-presence for all four of these is now **Location**-grain,
not zone-grain (`db/lib/presence.js` / `web/lib/peopleHere.js`): the target
has to be standing in the same Location and not concealed. The reason field
and the GM's review are the anti-abuse mechanism, exactly as everywhere else.

**Binding someone also costs them their day's labor.** Every
`INCAPACITATING_SLUGS` slug is read on the *afflicted* character's own side
too: `db/lib/autoLaborPass.js#runAutoLaborPass` silently skips filing a Labor
for anyone holding one, so a bound target loses their next turn, not just
their ability to defend themselves (TURN-ENGINE.md §6).

**And it now costs them nearly everything else.** The actor's own side used to
be checked by four requests and forgotten by the rest, so a bound character
could hand over their purse, butcher a corpse, buy from the Depot, write a
letter or simply walk out of the room they were being held in. Every request
in this file that is a physical act now goes through
`requireCharacter({ needs: ACT })`, and travel is gated at
`db/lib/locationTravel.js#performLocationMove` — the one crossing every path
in the game funnels through. What ACT covers, what it does not, and why Bound
still lets you shout, is `TAGS.md` §5f.

**Harm is Wound and Finish in one request**, because they are one act: you
stand over someone who can't stop you and decide how far to take it. Either
half alone is valid — a beating that leaves them alive, a clean kill with no
new injury — but not neither. The target must **already** be helpless; knifing
someone who could fight back is a Gambit, and a GM adjudicates that.

**It kills**, on submit, the same posture `FEED_PERSON` takes above and for
the same reasons — the claim is made in the request's own transaction, the
Discord teardown runs after the commit, and the **Kill** button survives only
as the fallback for a claim that did not land. What makes it safe is the gate,
not a delay: the target has to be helpless **already**, and `FINISHABLE_SLUGS`
narrows it further than the loot gate — you can rob a Paralyzed character, but
only someone **Dying or Bound** can be finished off. Paralysis is a moment's
stumble; those two are a body that is not getting up on its own.

**Catatonic is not finishable**, though it is lootable and draggable. It was
added to `FINISHABLE_SLUGS` briefly and pulled back out once the lethal half
started killing on its own: Catatonic doesn't mean a helpless character, it
means an **absent player** — AFK, or gone from the guild. With no GM step left
behind the gate, allowing it would turn "stopped logging in" into a dead
character at another player's discretion. The engine already answers that case
itself, on its own clock and its own GM-facing dial
(`db/lib/catatonicDeathPass.js`, `TURN-ENGINE.md` §2 7b).

**Harm offers wounds, not the whole Health category.** The picker used to run
off `category: Health, custom: false`, which is all 75 rows — so a player
standing over a Bound character could give them Exploded Chest ("a larva
slithered out"), Appendicitis, Dying, or Hungover. But that category is the set
the cure ladder *treats* (`TAGS.md` §5c), and most of it is downstream of an
injury rather than an injury: `health-recovery` is the aftermath a treatment
leaves, `health-infection` is what the engine grants when a wound goes
untended, `health-illness` is disease, `health-minor` is mostly jokes. Two
groups are things one person does to another — `health-wounds` and
`health-maiming` — plus four out of `health-mind` a beating plainly causes
(Concussed, Shell Shocked, Blind, Mute). That is `isInflictable()` in
`web/lib/healRequests.js`, 33 rows, read by both the picker and the server
action for the same reason `isHealable` is. **Paralyzed is deliberately not on
it**: it is in `INCAPACITATING_SLUGS`, so inflicting it would let one player
lock another out of their day's labor indefinitely, at will.

The lethal half is also the only place besides billing someone else for a cure
where the dialog asks twice.

**Move Player does not spend the target's turn**, and it moves nobody but the
target — the copy says to walk there yourself afterwards. It takes a body too,
which is how a corpse gets anywhere: bodies are lootable and Lifeweb-feedable
but would otherwise be pinned where they fell. A corpse needs no authority
over it, so the leader gate is skipped and no Discord role is swapped — and
neither does anyone helpless, so a Catatonic, Dying or Paralyzed character can
be carried as well as robbed.

**The target menus list who is at your Location and not concealed — a corpse
still shows for Loot and Move.** That's a change from the earlier design,
where every one of these listed every living player so nobody learned who was
nearby just by opening a menu; the game now filters by co-presence
(`web/lib/peopleHere.js`, `db/lib/presence.js`), so a menu can show a name a
player isn't actually allowed to act on (Bound already, out of reach by the
time of submit) and the server rejects the rest with its own wording. See §6
on why the buttons themselves don't grey out for who's near you — that rule is
unrelated and still holds.

## 5c. Healing

The Heal button on `/character` sits beside Consume and is the third request
that touches someone else's sheet — and the first whose price the **catalog**
owns rather than the player.

**Three gates, all re-checked server-side.** The button only renders for a
character holding `medical-basic`; the patient must share the healer's
Location and not be concealed; and the affliction's own `requirementSkills`
must be satisfied —
a Deep Wound names Medical (Skilled), so a character with only the Basic tier
sees it in the menu labelled "— Gambit" and may still attempt it — it files a
GAMBIT Move rather than curing anything, and the GM resolves the roll
(TAGS.md §5c). A cure costing any part of a turn — including the 2 ⬢
Simple rung, which now always bills 0.25 rather than drawing on the pool —
bills the medical family's Move directly instead of any ration; only a
0-turn cure draws on a shared daily pool of 4 first-aids a medic — of any
tier — instead (`MEDICAL_SIMPLE_PER_TURN`, `MEDICAL.md` §3), replacing the
older per-tier 2/3/4 daily cap. The menu is
advisory as always: `healCharacterRequestImpl` re-derives every one of those
from the database before it writes anything.

**Holding a higher tier satisfies a lower requirement.** Medical tiers
*replace* each other up `Tag.parentTagId` (Basic → Skilled → Expert), so a
surgeon must be able to do a nurse's job. `buildSkillAncestry` walks that chain
once over the flat catalog and `satisfiedSkillIds` unions it across everything
the character holds — cheaper than three nested Prisma includes, cycle-guarded,
and pure, so the picker and the server action can never disagree. Both live in
`db/lib/medicalVision.js` (re-exported by `web/lib/healRequests.js`, where they
used to sit) because the bot asks the same question: the doctor's eye on 🔍
inspect shows a medic the hidden afflictions they are qualified for, and the
two faces must not drift on who counts as qualified. See `TAGS.md` §5c.

**What counts as treatable** is data, not a heuristic: `Tag.healable`, a flag
in `docs/tags.yaml` (`CRAFTING.md` §1), re-checked by
`web/lib/healRequests.js#isHealable`. This replaced the old rule — a held tag
in the `Health` category that carried *any* requirement field — which
conflated "curable" with "has a cure cost" closely enough that it worked, but
the flag is the thing actually read now, not the inference. A Health tag with
`healable: false` and no requirement block is tier 0 of the cure ladder —
Vomiting, a Migraine, a Concussion: realistically untreatable, quick,
harmless, and deliberately not something a doctor bills for. Setting
`healable: true` (with a `requirement:` block) on a Health tag in
`docs/tags.yaml` is the whole of "make this curable", and `TAGS.md` §5c has
the eight rungs to copy rather than invent.

**The cost is `Tag.requirementResources`, and a payer is demanded even at
zero.** `schema.prisma` documents the requirement block as covering whichever
direction is narratively relevant — crafting reads it as the price of gaining
a tag, healing as the price of shedding one. A rung with no `resourceCost`
would cure for 0 ⬢; the payer is still asked for and still recorded, because
who was on the hook is the part a GM needs. The turns and any Gambit are shown
as reference and enforced by nobody — which is what makes "you may always
attempt something above your tier, as a Gambit" a rule a GM adjudicates rather
than one the button blocks.

**Who pays is yourself, a Room stash at your Location, or a person there** —
the same payer choice Craft offers (`CRAFTING.md` §2), and a person picked
this way is DM'd what they were charged. Billing someone other than yourself
asks twice: the reason dialog, then a `useConfirm()` naming the payer and the
amount. Treating another character does not, which is the opposite of the
Lifeweb rule below and deliberate — a cure is not a harm, and being charged
for one is.

The shared Location is re-validated inside the target's `WHERE` clause rather
than by a second read, so a patient who walked out between page load and
submit fails closed with "They aren't here" and nothing is written.

It is also the one type whose subject is a different character from the one
who filed it: `request.characterId` is the medic, `effect.targetCharacterId`
the patient, and every tag write in `tagEffects.js` takes the latter. A
GM can re-price the cure or tick "put the affliction back but keep the
payment" — the treatment that didn't take, the one partial outcome a full
Undo can't express.

## 5d. Bodies

Four requests that each break one rule the others keep. Three of them are about
corpses; the full design is [`CORPSES.md`](CORPSES.md), and this section covers
only what is peculiar to them *as requests*.

**Bury needs the body, not a name.** It used to match a typed first name against
the dead in the filer's zone. It now takes a corpse **tag** the filer is holding
or can reach in a room at their Location — strictly tighter, since you have to
have actually found it — and consumes that tag. It also **spends the filer's
Move** now, filed automatically as a passed Routine by `fileAutoRoutine`. A
monster corpse is refused: there is no soul in a Nekker.

**Engrave is the one that kept the typed name**, and it kept it for the reason
Bury originally had it. Every other target menu in the app is a dropdown built
from the roster; a dropdown here would be a list of the dead, readable by anyone
who opened the dialog, and the whole reason `/character`'s panels never render a
status pill on a corpse is that who died is not supposed to be free information.
So the dialog holds one text field.

It matches the **whole name** now, not the first name. First names repeat
constantly in a game this size, so a mourner who knew exactly whose stone they
meant was told "more than one dead person answers to that name" and had to go
find a GM — the refusal firing on a case it was never written for. The
comparison is `matchesTypedName()` (`db/lib/characterName.js`), which accepts
either form: the full display name (`Sir Jorren "the Blind" Vask`) or the plain
`First Last`, since an honorific the mourner never learned should not be a wall.
Both are exact, trimmed and case-folded — there is no fuzzy matching anywhere in
this game. `Character.name` is composed rather than stored in parts Prisma can
compare, so the unburied dead come back on a `WHERE` scoped to `status: DEAD`
and `buriedAt: null` and the filter runs in JS. The Arrest Warrant (§5g) uses
the same matcher against the living.

**And Engrave's search is game-wide** — no zone clause at all, because the whole
point is a body nobody can find. Two consequences follow, and both are accepted
deliberately. The leak is bigger than Bury's was: a hit tells you that person is
dead *somewhere*, where before it only told you they were not a corpse in your
zone. And **the `>1 match` refusal still does real work**, though it is rare now
that the match is on the whole name: two dead people sharing a full name
anywhere in Ravenheart is a plain error — "More than one dead person answers to
that name. A GM will have to do it." — rather than a guess, because it is the
only thing standing between a mourner and freeing the wrong soul. Do not soften
it into picking the first match.

**Butchering destroys a body without freeing the soul.** This reads as an
oversight and is not: cutting someone up is not a burial, so their player stays
Cursed, and Engrave is the way out of that. It is also the only one of the three
that is entirely free — no ⬢, no Move — because the cost of butchering is
supposed to be what other people think of you.

**No gate beyond co-presence**, same as Bind and Free (§5b). The Mortii's job
in the fiction (`docs/roles.yaml`) is not a permission in the code.

**It is the one request whose real effect lands on Discord rather than a
sheet.** `removeCursedRole` runs *after* the transaction commits — no network
call may run inside one (`ARCHITECTURE.md` §5) — which is also why **Undo does
not re-curse**. It raises the body and says so in its note; putting the role
back is a GM's manual edit, the same posture escorting and `CHANGE_NAME`
already take with their Discord halves.

**A buried body is out of the world.** `Character.buriedAt` is both the flag and
the record of when. Five places treat a corpse as a target and all five now
refuse a buried one — the `LOOT` direction of `TRANSFER_RESOURCES` and
`TRANSFER_TAG`, `LOOT_CHARACTER`, and the zone roster in
`character/page.js` that feeds all five target menus. A GM Revive clears it, so
a revived character is never a live person marked buried.

**Fast Travel is retired as a Request, and its mechanic has moved.** There is
no `fastTravelRequestImpl` any more, no `FAST_TRAVEL` row is ever written, and
`Character.fastTravelTurnId` is gone from the schema. What the `horse` and
`motorcycle` tags promise is now part of ordinary travel: an **equipped**
mount adds one to the free-zone-move allowance every character gets each turn,
and it refreshes each turn rather than once a day. See [`CARRY.md`](CARRY.md)
§2a for the allowance and [`MAP.md`](MAP.md) for the crossing itself.

`db/lib/mounts.js#fastTravelCapacity` **has a live caller now.** It sat unused
from the day the `FAST_TRAVEL` request was retired until escorting arrived, and
this is what it was kept for: the catalog text promises a horse carries two and
a cart six, and escorting is what finally enforces it. Overfilling the seats is
not refused — it costs the mount's extra crossing (`MAP.md` §3a). It reads the
mount only while equipped.

Old `FAST_TRAVEL` rows stay undoable; nothing files a new one.

**The gates on these four all follow §6's rule rather than bending it.** Owning
a horse is a fact about your own sheet, so Fast Travel's icon may grey out. So
is knowing how to butcher, so Butcher greys on holding the `butcher` tag — but
**never** on whether a body is nearby, which is a fact about the world; you find
that out by opening the dialog. Bury and Engrave carry no gate at all for the
same reason: whether a corpse lies where you stand, or whether the name you have
in mind belongs to someone dead, is exactly what you are not supposed to learn
from a greyed-out icon.

## 5g. The Cerberon: Arrest Warrant, Check Wanted

Two buttons in a `CERBERON` section of the Actions grid, both **hidden** rather
than greyed — which badge you carry, and whether you are sworn, are your own
sheet's facts, and a dead Arrest Warrant icon on a brigand's sheet would teach
him nothing except that the warrant book exists. They live in
`web/app/(app)/character/cerberonActions.js`, the `thanatiActions.js` shape:
one actor resolver, each verb re-checking the tag the button's `show` already
read.

**Arrest Warrant** is gated on the **badge, not the role**:
`censors-key`, `sheriffs-badge` or `cerberus-helmet` (`WARRANT_BADGE_SLUGS`,
`db/lib/wanted.js`). Every other button on the sheet gates on a tag, and this
way the authority travels with the thing — including when it is looted off a
body, which is a story the game should be able to tell.

It types the name rather than picking it, the Engrave reasoning (§5d) and it
applies harder here: a dropdown would be a roster of everybody alive, handed to
anyone holding a badge. Same `matchesTypedName()` matcher, against
`status: ALIVE`. **Three** refusals: nobody by that name, everybody who answers
to it already wanted, and — only when nothing else is left — yourself.

**A name two living men answer to warrants both of them.** There is no
disambiguation step and no bounce to a GM: the law does not know which
Alexander Ivanov it wants, so it wants both, and a namesake who had nothing to
do with it is caught up in the warrant. That is the intended shape rather than
a rough edge. This used to be a fourth refusal — *"More than one living man
answers to that name. A GM will have to do it."* — which meant that with two
Alexander Ivanovs alive, no badge holder could act on either through the button
at all. Names carry no unique constraint (`Character.name`) and character
creation runs no duplicate check, so the collision is reachable and recurs.

Two matches are dropped from the set rather than aborting it, which is the half
that is easy to get wrong: **yourself**, and **anyone already wanted**. A
warrant on a name you happen to share must still catch the other man, and a
namesake who is already in the book must not stop a clean one being caught.
Only when nothing survives does it refuse, and each refusal says which of the
three cases it is — "nobody by that name" and "they are all wanted already"
look identical from the officer's side otherwise. The selection is
`warrantTargets()` in `db/lib/wanted.js`, which is pure and covered by
`db/test/wantedVisibility.test.js`.

Catching two men writes **two `AuditLog` rows**, not one. `/gm/audit` is read
by target, so a single row naming both would leave the second man's sheet with
no record of why he is wanted; the rows carry `answeringToThatName` when the
name was ambiguous, so a GM can see he was caught by a namesake's warrant.

**It costs nothing** — no Move, no ⬢, no Routine filed. And it deliberately
does **not** put paper up: `postWantedPosters` (`db/lib/wantedPoster.js`) stays
a character-creation thing. Granting the tag is the whole act, and the only way
anyone finds out is by looking the man in the face — which is exactly what
`visible: named` (`TAGS.md`) makes worth doing. There is no cooldown either, so
a Censor could paper the roster; `AuditLog` is the record (`request_arrest_warrant`)
and a GM repairs by hand from `/gm/dev`. If that turns out to matter, the cheap
fix is Recover Equipment's shape — count the last two turns' audit rows — and it
needs no column.

**Check Wanted** is the warrant book, open to anyone holding the `cerberon`
tag. `listWanted()` (`db/lib/wanted.js`), returned as notice rows under the
officer's own cursor, exactly like Recall Comrades (`THANATI.md`). Costs
nothing, spends no Move.

**Names and nothing else.** The book used to print each man's role beside his
name, which handed every badge holder a slice of the roster nobody has earned —
it is a list of names the Cerberon want, not a directory of who those people
are. The cost is that two men sharing a name read as two identical rows, which
is the honest answer: the law has two Alexander Ivanovs and cannot tell them
apart either. No renderer changed for this — `NoticeProvider.js` already draws
a row's note only when there is one.

**It lists a hooded man the same as a bare-faced one, on purpose.** It is a
*record*, not an act of looking: a name does not come off the book because
somebody pulled a hood up. That is the whole point of the pairing with
`visible: named` — the book says Jorren Vask is wanted, the stranger in the
Square reads as an unknown young man, and closing that gap is the game.

**A Mulligan Potion clears the tag** (`changeNameRequestImpl`,
`requestActions.js`). A new name is a new man, and that is what the bottle is
for. The posters already nailed up are not recalled — they are paper, on their
own 30-turn clock.

## 6. The player-facing surface

`RequestDialog.js` is the universal popup. It is a rendered component taking
`children`, not a promise-returning hook like `useConfirm()` — the second half
is arbitrary JSX per call site, which a hook API handles badly. It reuses the
existing `.modal-overlay` / `.modal-panel` styling, so it matches every other
modal for free, and it only mounts its body while open, which resets the
reason field between openings without an effect syncing state.

The sheet's band (`LedgerBand.js`) lays the four numbers out as tiles, and
**every player action sits under them as one wrapping strip** (`ActionGrid.js`
with `variant="strip"`, each button labelled; a greyed one writes the reason
from `actionRegistry.js#gateReason` to a line under the strip rather than into
a tooltip, since the sheet has none). `/chat`'s YOU column draws the same
registry as an icon grid, with the HERE list (`HereList.js`) above it.

That grid replaced three separate surfaces: a row of text buttons inside the
Tags panel, a Transfer Resources button in the Status panel's own footer, and
a whole "Bodies here" panel for looting corpses. It is a grid rather than a
vertical strip because eleven icons in one column would run far past the
four `<dl>` rows next to them and drag the panel's height with them.

`actionRegistry.js` now lays the grid out as three captioned rows rather than
one undifferentiated block, grouped by who the action touches: **You** (Craft,
Destroy, Consume, Transfer, Learn Skill, Teach Skill), **People here** (Heal,
Loot, Bind, Free, Harm, Move Player, Bury Person), **Letters** (Send Bird,
Read). The caption is presentation only — every button still greys or opens
its dialog by the same per-action rule as before; grouping them by subject
just makes the "acts on you" / "acts on someone else" split legible at a
glance, which matters more now that co-presence actually filters who shows up
in the dialog (§5b).

**The state had to move up to make that work.** `TagRequestButtons.js` used to
own both the buttons and the dialogs, and handed its opener up to the tag panel
through an `onReady` callback so a chip click could open Consume. The buttons
now live in the band's verb strip (`LedgerBand.js`), a **sibling above** the
tag rail (`TagRail.js`), so no component contains both. `RequestActionsProvider.js` holds the mode state and routes each
click — an instant verb, a fast path, or one dialog file under
`components/actions/` (DESIGN-SYSTEM.md §8) — and the consumers read the
opener off context, the same shape `ConfirmProvider` uses for the same
reason. Every success is said once, as a notice (`NoticeProvider.js`). It is mounted only in `self` mode,
which is what keeps another player's chips read-only for free.

**A button greys out only for a fact about your own sheet** — nothing to
remove, nothing to hand over, no Medical training. **Never** for a fact about
who is standing near you. A greyed-out Loot icon would announce "nobody here
is helpless" to anyone who glanced at their own sheet, and a live one would
announce the opposite: free scouting, on every page load, without anyone
choosing to look. So the co-presence actions are always lit and you learn who
is here only by opening the dialog. §3 covers the corresponding rule for the
target *menus* themselves — Location-filtered now, not unfiltered — which is
a separate concern from button greying and doesn't change it.

The tag menu inside the Add and Harm dialogs shares `filterTagsByQuery` with
`PointBuy.js`, so the in-play menu and the creation menu find the same tags
for the same words, and its pane is `60vh` rather than the 16rem box that used
to show three rows of a hundred-tag catalog.

### 6a. The same dialogs on `/chat`

Since phase 3 of Chat (`CHAT.md` §5) the **people** dialogs have a second
home. `/chat`'s HERE column mounts the same `RequestActionsProvider` with the
same pools and calls `open(mode, null, { targetId })` from a person's own row,
so clicking somebody standing in the Keep opens the very dialog the sheet
opens, already pointed at them. Nothing is forked, and no rule is stated twice.

Two things carry that:

- **`web/lib/peoplePools.js#loadPeoplePools(character, { discordUserId,
  openTurn })`** is now the ONE build of the people pools — the roster
  standing here, the medical gate and its day's allowance, and the Loot /
  Move / Bind / Harm lists. `character/page.js` calls it too. It lived inside
  that page while the sheet was the only surface that could act on somebody
  near you; a second copy of "who is helpless" would have been a second
  answer.
- **`open()` takes an optional third argument**, `{ targetId | patientId |
  toKey }`, applied AFTER the dialog's own reset — a preset is the exception
  to the blank slate, not part of it. Only those three fields are seedable:
  everything else in a dialog is a decision, not a context.

The sheet keeps everything else. Craft, the paperwork verbs, the Bird and the
Factory are not mounted in Chat, and `ActionGrid` is not either — the
column is a list of people, not a second grid.

`/chat` also carries two player actions that were Discord-only, both of them
in `play/actions.js` and both re-checking every gate the panel drew:
**Move** (`db/lib/moves.js#fileMove`, the same call the `#turns` Move modal
makes) and **Waiting on you** — the Accept/Decline for a pending offer, a
threat spawn or a lobby seat, calling the same `db/lib` functions the DM's
buttons call. Neither files an `Action` twice: `fileMove` is guarded by
`@@unique([characterId, turnId])`, and the rest write no Move at all.
`fileMove` refuses a Routine or Labor for anyone who can't `ACT`, but a
**Gambit** only for `GAMBIT_BLOCKING_SLUGS` (Unconscious, Paralyzed, Seizure,
Dying) — someone Bound, Crucified or Catatonic can still file one.

One consequence worth knowing: `CharacterSheet#groupTagsByCategory` now groups
the **`CharacterTag` rows**, not the bare `Tag`s. The wrapper carries
`expiresTurn`, which the per-tag countdowns need; the old version discarded it.

## 7. Audit trail

Every request writes an `AuditLog` row through
`web/lib/requests.js#logRequest`, carrying the player's reason verbatim. That
fills the new **Reason** column on `/gm/audit`, which is blank for every
non-request entry. The audit table is a fixed-height scroller with a pinned
header (`.table-scroll`) over 50 rows a page — the same shell every other
list in the app uses, though `/gm/audit` is the one that pages server-side,
over the URL, so a filtered view stays linkable.

## 8. Where the code lives

| Concern | File |
|---|---|
| Request creation, reason validation, audit helper | `web/lib/requests.js` |
| `UserError` + `guarded()` result wrapper | `web/lib/actionResult.js` |
| The player-facing server actions | `web/app/(app)/character/requestActions.js` |
| The Cerberon's two (§5g) | `web/app/(app)/character/cerberonActions.js`, `db/lib/wanted.js` |
| Matching a typed name against a character | `db/lib/characterName.js#matchesTypedName` (Engrave §5d, Arrest Warrant §5g) |
| Universal popup | `web/app/components/RequestDialog.js`, `actions/ActionDialog.js` on top of it |
| The result notice | `web/app/components/NoticeProvider.js`, `actions/noticeLines.js` |
| The sheet's band: numbers, turn card, verb strip | `web/app/components/LedgerBand.js` (`SHEET.md` §2) |
| The mode state, instant verbs, fast paths | `web/app/components/RequestActionsProvider.js`, `actions/index.js` |
| One dialog per verb | `web/app/components/actions/*Dialog.js`, `CraftAction.js`, `ExamineAction.js` |
| A dialog's roster, read when it opens | `web/app/components/actions/useRoster.js`, `web/app/(app)/character/rosterActions.js` |
| The Actions grid | `web/app/components/ActionGrid.js`, `ActionButton.js`, `icons.js` |
| Which held tags each menu offers | `web/lib/tagRequests.js` |
| Who is standing in your zone (one roster, five menus) | `web/app/(app)/character/page.js` |
| Co-presence at Location-grain (web / db) | `web/lib/peopleHere.js`, `db/lib/presence.js` |
| Bind, both doors (instant vs. consent Offer) | `db/lib/bind.js` (`LESSONS.md` §3b) |
| Action-grid rows and per-action entries | `web/app/components/actionRegistry.js` |
| Who counts as helpless, and who can be finished off | `db/lib/incapacitation.js` |
| Heal gate, tier chain, `healable` filter | `web/lib/healRequests.js` |
| One end of a resource movement | `web/app/components/actions/MoveThingsDialog.js` (chips), `PartySelect.js` (Craft's payer) |
| Reach gate — same zone | `web/lib/transferReach.js` |
| Tag rail + click-a-row-to-consume | `web/app/components/TagRail.js`, `TagRow.js`, `TagChip.js` |
| Desires — panel shell, catalog picker, GM surface, gate evaluator | `web/app/components/GoalsPanel.js`, `DesirePanel.js`, `DesireCatalog.js`; `gm/dev/characters/[characterId]/GoalsTab.js`; `db/lib/desireGates.js`. Full file map: `DESIRES.md` §11 |
| Lifeweb blood tiers + cap, shared bot/web | `db/lib/lifeweb.js` |
| Lifeweb requests, GM bypass panel | `web/app/(app)/lifeweb/requestActions.js`, `actions.js` |
| Lifeweb player buttons | `web/app/components/LifewebRequestButtons.js` |
| The Dying clock's auto-kill | `db/lib/dyingDeathPass.js` |
| The audit feed a GM reads instead | `web/lib/auditNarrative.js`, `web/lib/auditQuery.js`, `web/app/(desk)/gm/audit/` |
| Shared tag/⬢ write primitives | `web/lib/tagEffects.js` |
| Gambit roll + modifier | `bot/src/events/interactionCreate.js#handleMoveConfirm` |
| Expiry sweep | `db/index.js#resolveNeeds` |

## The Depot's kinds

All obol-denominated, all moving `Depot.accountObols` rather than anyone's own
⬢ stack. They are audit `actionType`s now
(`request_depot_order`, `request_depot_atm`, `request_depot_credit`,
`request_depot_crate_open`, `request_depot_refuel`,
`request_depot_shuttle_call` / `_send`), and the
Depot's own visible Ledger on `/depot` is built by reading exactly that set
back out of `AuditLog` — `DEPOT_LEDGER_KINDS` in `web/app/(app)/depot/page.js`
is the one list, so a new depot verb has to be added there or it moves obols
invisibly.

**Two have no undo handler, deliberately.** `DEPOT_SHIP` and
`DEPOT_CRATE_OPEN` are irreversible the way a sent Bird letter is: a shuttle
that went up cannot be recalled and its cargo no longer exists to hand back,
and an opened crate has scattered its contents into an inventory that has moved
on. With no `REQUEST_EFFECTS` entry the rows stay visible on the desk and in
the Depot's own Ledger — they simply cannot be undone, which is honest. A GM
corrects one by hand.

The rest follow the ordinary rule: `effect` snapshots what actually moved and
undo reads only that. `DEPOT_ORDER` restores the manifest to the snapshot taken
before it rather than subtracting its own lines, so a second order filed since
is not silently thrown away.
