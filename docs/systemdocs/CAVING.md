# The Caves: the Caving Die and its loot

The Depths' one piece of automatic mechanics. Companion to `MAP.md` (zones
and travel), `TURN-ENGINE.md` (where this hooks into a turn advance),
`REQUESTS.md` (the apply-first-review-after pattern a loot find reuses),
`ADJUDICATION.md` (the `/gm/turns` desk this adds a third lens to) and
`TAGS.md` (the catalog fields `sellable`/`sellablePrice`/
`consumesIntoResources`/`consumesIntoOneOf` live in).

## 1. The two levels

`docs/zones.yaml`'s `underground` entry is a `kind: group` row — a GM seat and
a Discord category, never a place a character can stand — whose `levels:` list
is flattened by the sync into two real, standable `CAVE_LEVEL` zones: **Caves**
and **Depths** (`caves` / `depths`). Each is its own zone with its own
Locations, joined by ordinary zone-crossing edges in `docs/zones.yaml`'s
`connections:` — so they need no special cost rule. Going from the surface to
the Caves to the Depths costs a separate turn each, mount or no.

The kinds are kept, rather than promoting both to surface zones, because the
Die fires on a `CAVE_LEVEL` arrival and a `CAVE_LEVEL` needs a `CAVE_GROUP`
above it. Sharing `underground` as that parent also means the two share one GM
seat, which is what the old Caves seat already did across three levels.

The Bascinet 2 map replaced the old three levels — Caverns, Railroad and
Aberrant Pits, with their Customs, Station and Chrome City — with this pair.
Caves keeps Customs and gains the **Depot** as a Location of its own; the
Station and Chrome City are retired, their prose kept in a comment at the
bottom of `docs/zones.yaml`.

**A public declaration underground lands in every room.** Neither level has a
`#summary` — that is what "no channels of its own" means — so a GM's staged
public declaration for the Caves or the Depths posts into **every Location
channel in that level** instead, full size and word for word, one `Delivery` row
per channel (`db/lib/publicPostTargets.js`, `ADJUDICATION.md` §1). It is a blunt
answer and deliberately so: there is nowhere else down here for it to go, and
before this the declaration was simply marked "no summary channel configured"
and no player ever read it. One consequence to know when writing one: everybody
on the level reads it wherever they are standing, so word it as news travelling
the caves rather than as something happening in the room.

The public **Caving** document (`docs/documents.yaml`, key `caving`) is the
player-facing brief — what the levels are, what to bring, and that the die
exists. `Role.docElements` grants it to `migrant` and `mercenary`, and it's
public so anyone else can find it too.

**The Caving *skill* is a different thing entirely.** `caving` (3 points) opens
the four hidden crawls between the caves and the surface (`MAP.md` §2a). It has
no effect on the Die, and the Die does not care whether you have it — one is a
key, the other is what the dark does to you regardless.

## 2. The Caving Die

**Walking is what wakes the dark.** The Die rolls when a character *arrives* on
a Location in a `CAVE_LEVEL` zone, and at no other moment — a flat `1d6`, no
Gambit modifier, rolled by `db/lib/cavingPass.js#rollCaving(prisma, character,
turn, location, trigger)` and written to a `CavingRoll` row. Going deeper rolls.
Retreating rolls. Standing still does nothing at all.

There used to be a second trigger — `runCavingPass`, a turn-start sweep over
every `ALIVE` character already underground — and it is **gone**. It punished
the one thing a cave ought to reward, which is not moving: a party camped in a
dead end paid the same 1-in-6 as a party pushing into new tunnels, so there was
never a reason to stop. The arrival roll was a *bonus* on top of it; now it is
the whole rule. `CavingTrigger.TURN_START` stays in the Postgres enum rather
than being dropped, the same posture every other retired enum value in this
codebase gets — nothing writes it any more.

**`rollCavingOnArrival(prisma, character, location)`** owns the whole gate.
Four ways it quietly returns `null`, and one of them is new:

- the Location's zone is not a `CAVE_LEVEL`;
- the Location is **safe** — `hasAttribute(location, "safe")`, see below;
- there is no `OPEN` turn (mid-restart);
- anything at all threw.

It sends nothing itself; the DM comes back for the caller's own side-effect
half, the same split `performLocationMove` already uses for the zone-role swap.
Three callers:

- `db/lib/locationTravel.js#performLocationMove` — player travel, including a
  first placement and a mount's second crossing, which is just a second pass
  through the same function. Rolls for the mover and every dragged character;
  the DM(s) ride back on `moved[].cavingDm`.
- The Dev Panel's zone edit and **Bulk Move** — the raw GM relocations. They
  roll too, on purpose: being *dropped* into the Depths by a GM used to be the
  one free walk in, which is exactly how the die first looked broken. Both send
  the DM plainly rather than through `notifyCharacter()`, since the die is the
  game speaking, not the GM.
- The staged **"Relocate to"** on `/gm/turns`, which calls it from
  `db/index.js`'s side-effect half rather than from the staging code — it could
  not run inside `applyOneStagedEffect`, because `rollCaving` opens its own
  transaction and that function is already in one. Out in the side effects the
  write has committed, and it is where every other staged DM goes out from.
  It has to happen somewhere: the turn-start pass used to sweep up anyone a GM
  had dropped underground, and without this a staged relocation into the Depths
  would roll nothing at all until the character walked.

### 2a. The cave mouth is safe

`Location.attributes.safe` (`db/lib/locationAttributes.js`) exempts a Location
from the Die, and **Customs and the Depot are the only two places that wear
it**. Between them they are the cave mouth: a sentry, a floodlight, a campfire
and, one plain hop east, a shop. Nothing stalks a place that busy. Customs is
also where every migrant lands, and rolling a 1 on somebody's first step into
the game was the worst first impression the map had.

It is an attribute rather than a slug comparison in `cavingPass.js` for the
reason `MAP.md` §1b gives: a system that owns a place should ask what is true
about the place. Examine prints it on the spot — "**Safe**: the Caving Die
doesn't roll here." — so a player choosing where to camp can read the answer
instead of inferring it from a week of quiet rolls. The line names the Die
rather than just promising safety, because the attribute means *this* one
specific thing and a surface Location's silence must not read as a warning.

**One consequence worth stating plainly.** Same-zone travel is free, so a caver
who walks the level rolls once per step where the old turn-start pass rolled
once per day. Camping is free and exploring is expensive — which is the design,
but it is a large increase in TROUBLE for anyone actually moving, and the GM
load on the Caving lens rises with it. §2b is the other half of that arithmetic:
there is no ceiling on the steps.

### 2b. Every arrival rolls

**There is no cap.** Walk from one cave into the next and each rolls; walk
*back* through the four rooms you came in by and each of those rolls again.
First visit or fifth, the die does not care.

It used to care. `CavingRoll.@@unique([characterId, turnId, trigger,
locationId])` capped it at one roll per Location per turn, and `rollCaving`
swallowed the repeat's `P2002` as "already rolled". The argument was
anti-pacing: make the Die a cost of *exploration* rather than a slot machine
you feed by walking in and out of a doorway. What it actually produced was a
caver backtracking out of the Depths through four rooms of known monsters in
total silence, which reads as a broken die and not as a rule — nothing on the
way in tells you the way out is free. The index is dropped
(`20260914010000_caving_every_arrival`) and the P2002 branch is gone with it;
a P2002 out of `rollCaving` would now be a real bug.

**What replaced the brake: nothing, deliberately.** The only thing rationing
rolls now is `GameConfig.locationMoveCooldownSeconds` — the wait between two
walks inside one zone, **3 seconds** by default. So a player standing between
two adjacent cave rooms can roll every few seconds, all turn: an uncapped loot
faucet, an uncapped `CAVE_TROUBLE` mood drain (`MOOD.md`), and an uncapped
supply of unresolved `TROUBLE` rows on the Caving lens. That was chosen with the numbers
on the table, not overlooked. If it does start to bite, the lever is that
cooldown on `/gm/dev` — a GM can price a cave step at a minute without anybody
touching code, and a per-turn roll ceiling is the next thing to build if the
cooldown is not enough.

The public brief has always described it this way, incidentally: "each
movement from a location to another within the caves has a chance to trigger
an encounter", and "hunkering down in a single location reduces your chances"
(`docs/documents.yaml`, key `caving`). Only now is that exactly true.

`CavingRoll.locationId` is nullable only because the rows written before the
Die became arrival-only have none; every new row sets it. It gates nothing —
it is what lets the lens say *where*.

### 2c. A 1 pins you in the zone

**An unresolved `TROUBLE` row stops the caver leaving the zone it happened
in.** Until this existed the row waited for a GM and the caver did not wait
with it — they walked out of the Depths, and a GM ended up adjudicating a
monster in the dark for somebody standing in Town.

`cavingHoldFor(prisma, characterId, zoneId)` (`db/lib/cavingPass.js`) is the
one predicate. It is the Caving twin of `heldReasonFor` (`INTERCEPT.md`) and
deliberately not the same thing:

- **It is a query, not a comparison.** The answer lives in `CavingRoll`
  (`kind: TROUBLE`, `resolvedAt: null`) and nowhere on `Character`, so unlike
  a hold it costs a lookup — which is why the picker asks only when there is a
  zone crossing on offer to shut.
- **It takes the way OUT and nothing else.** Walking the level is still free,
  so a party can regroup, camp or push deeper while they wait. An intercept is
  a hand on your shoulder; this is a locked door at the top of the stairs.
- **It is scoped to the roll's own `zoneId` snapshot.** A GM who relocates
  somebody out of the caves has therefore not also stranded them wherever
  they land.

Four gates read it, and all four are player paths:

| Where | What it does |
|---|---|
| `db/lib/locationTravel.js#performLocationMove` | The authoritative refusal, inside the `crossedZone` branch |
| the same function's escort loop | A held follower is detached and left standing, `leftBehind` reason `caving` |
| `db/lib/locationGraph.js#resolveNeighbors` | Draws every zone crossing **shut** with the same sentence, so no picker offers a hop the mover will refuse |
| the Stepstone (`web/app/(app)/character/requestActions.js`) | The stone only lands on the SURFACE, so from underground it is exactly this crossing |

Every GM path is untouched on purpose — the Dev Panel's Teleport and Bulk
Move and the staged **Relocate to** never call `performLocationMove`, and a GM
moving somebody is the adjudication, not an escape from it. The Rite of
Summoning (`db/lib/riteEffects.js`) is untouched too, for the reason it
already ignores `heldUntil`: it is somebody else's act on the character, not a
walk.

**Nothing auto-resolves at turn end.** Only **Mark resolved** on the Caving
desk clears the row, so a 1 nobody adjudicates holds a player in place
indefinitely — which is the point, and is also new GM load on top of what §2a
already added. The Caving lens' default "Needs attention" filter is now the
list of people who cannot leave.

### What each face means

| Die | Kind | What happens |
|---|---|---|
| 1 | `TROUBLE` | Nothing auto-applies. The row lands **unresolved** on the Caving lens for a GM to adjudicate — monsters are a GM call, briefed by the GM-only `cavingmonsters` document (`documents.yaml`). The player gets one short DM immediately: *"Caving Die: 1 — Something is wrong down here. A GM has been notified."* The caver also takes −10 mood, tripled by Teratophobia (`MOOD.md`), **and cannot leave the zone until it is resolved** (§2c). |
| 2–5 | `QUIET` | Stamped resolved at creation. No GM attention — the row exists as a record (so the lens' default filter, and a GM skimming the log, both read the truth). The player still gets one line: *"Caving Die: 3 — Nothing happens."* |
| 6 | `FIND` | Draws a loot tier and a tag (below), grants it, and DMs the player what they found. Also resolved at creation — the grant already landed. |

Every DM leads with the face — *"Caving Die: 6 — You found something: Padded
Armor."* — so a player reads their own roll and not just its outcome. A
`QUIET` used to send nothing, but players could not tell a quiet roll from
a die that never rolled, so it now says so in one line.

**A held Musk Lure eats a 1** (2026-09-07; docs/tags.yaml `musk-lure`, a
hidden butcher craft): when the die lands `TROUBLE` for a holder, one lure is
spent in the same transaction — the conditional write is the check — and the
row lands `QUIET`, already resolved, so nothing reaches the Caving lens and
no `CAVE_TROUBLE` mood hit fires. The DM says what happened: whatever it was
followed the stink instead. One lure, one trouble; the next 1 is real.

### 2d. The push lets go of what nobody adjudicated

**A `TROUBLE` roll still unresolved when the turn is pushed is resolved by the
push**, and §2c's hold lifts with it
(`db/lib/cavingPass.js#releaseUnresolvedCavingRolls`, run from `db/index.js`
directly after the staged push).

It has to be. The hold is right while the turn is open and a GM is working, and
wrong the moment the turn closes: the Caving lens goes **read-only** on a past
turn (`ADJUDICATION.md` §3), so a roll nobody reached is a roll nobody *can*
reach — and the caver is left standing in the dark with no way out and nobody
able to give them one. History caving stays read-only; this is the release valve
instead.

What it writes: `resolvedAt`, and nothing else. **`resolvedByDiscordUserId`
stays null, and that null is the marker** — a `TROUBLE` row is created
unresolved and the only hand that resolves one always writes an id, so resolved
with no resolver can only mean the push. `gmNotes` is untouched: the game has
nothing to say about a monster it never adjudicated. The Caving lens reads the
same rule and prints *"Resolved automatically at the push"*, so a GM reading
back a past turn is never told a colleague handled something nobody did.

A GM resolving the same roll at the same instant is not overwritten and not
double-counted: the pass re-reads only the rows its own update actually
changed (`resolvedAt` set, `resolvedByDiscordUserId` still null) before
naming names, so a roll the GM reached first is left with the GM's resolver
id and never shows up as the push's doing.

One `caving_auto_resolved` audit row per push names every roll and caver it let
go — "who can suddenly walk out of the Caves" being the question that row is
there to answer.

## 3. The loot table

`db/lib/cavingLoot.js` — **code, not YAML**, because this is mechanics (a
weighted draw), not player-facing catalog data the way a tag's price is. A
`FIND` draws in two stages: a tier by the standing zone's column below, then
a slug uniformly within that tier.

**The labor drop die speaks this vocabulary too** as of the cooking rework:
`docs/labordrops.yaml` entries carry one of these six tier names, and
`db/lib/labordropsRarity.js` draws in the same two stages. The names are
shared on purpose — two loot systems in one game should not need two
vocabularies — but the **numbers are not**, and should not be unified. This
column is keyed by zone because a cave is a place; the labor one is keyed by
die face, because a 1 and a 6 are different events. See `LABORDROPS.md` §2.

| Tier | Caves | Depths |
|---|---|---|
| Ultracommon | 65% | 15% |
| Common | 25% | 22% |
| Uncommon | 8% | 28% |
| Rare | 1.95% | 25% |
| Extremely rare | 0% | 7% |
| Nearly impossible | 0.05% | 3% |

Each column sums to 1, asserted by `validateCavingLoot()` at startup. The Caves
is where ultracommon loot dominates — that's where people go to farm
`{tag:cave-fungus}` — while Nearly Impossible barely exists there (a fixed
0.05%) and grows to 3% in the Depths; that top tier is meant to come mostly
from GM-run quests, not the die.

**Quests are hand-placed, and the public document now promises them by that
name.** Nothing spawns one — there is no schedule, no table, no
`LocationEvent`, and no GM tool. A Quest exists because a GM put it somewhere
and told people. The player brief says they "randomly appear in cave
locations", so if nobody places any, the caves are the die and nothing else.
This is the deliberate arrangement, not an omission: the top loot tier is meant
to be authored, not rolled.

The Depths took the **old Aberrant Pits column unchanged**, rather than the
middle Railroad one, because it is now the only deep place on the map and has
to carry what all three tiers below the surface used to.

`LOOT_TABLE`'s contents, by tier — see the file for the exact slug lists;
weapon/armor entries pull representative slugs off `SMITHING.md` §3/§4's
ladder rather than every entry in it:

- **Ultracommon** — Cave Fungus, Saltpeter, Purring Maggot, Rock.
- **Common** — Cudgel, Purse, Cracked Bone Club, Sling, Skinned Cave Rat, Old
  Coin, Coal.
- **Uncommon** — Alcohol, Cleaning Powder, Fine Meal, Bear Trap, Rope, Honey,
  Buckler, Spear, Work Knife, Knuckle Duster, plus low-tier weapons and armor.
- **Rare** — Ravenheart Red, Cat, Salvage Plate, Supply Kit, Jewelry, Bliss,
  Spyglass, Gas Mask, Instrument, Mining Helmet, plus mid-tier weapons and
  armor.
- **Extremely rare** — EMP Grenade, refined gunpowder, Skeleton Wedge,
  Jester Outfit, Starting Wares, Military Autoinjector, Autocannon Shell,
  Fragmentation Grenade, Neoclassic Duelista, plus top-tier weapons and armor.
- **Nearly impossible** — Energy Shield, Power Fist, the Neoclassic
  Revolver, Stepstone, Dark-Eye Lenses, Motorcycle.

`validateCavingLoot(prisma)` checks every table slug against the live Tag
catalog and every column's weights sum to 1, and throws loud if not — call it
once at process startup, not per roll, so a typo in the table fails the
deploy instead of handing a player nothing on the one 6 they rolled all
week.

Smoke test one loot draw from a scratch character with
`db/lib/cavingPass.js#rollCaving` directly rather than walking a real character
into a real cave — see the file's own comment for the cleanup order (delete the Request
before the character; `CavingRoll`/`CharacterTag` cascade).

## 4. A FIND is a Request

The grant goes through the same apply-first-review-after machinery every
player action uses (`REQUESTS.md`), just system-filed instead of
player-initiated: `rollCaving` grants the tag and writes the `CavingRoll` row
and an audit line in the same transaction as the grant — a roll can never
exist without its loot, or the reverse.

Taking a find back lives **on the Caving lens and nowhere else**, which is
what the loot is: a caving correction belongs in the caving log, not in a
general review queue. `undoCavingFind({ rollId })`
(`web/app/(desk)/gm/turns/actions.js`) drops the granted tag and stamps
`CavingRoll.lootUndoneAt`. The roll itself stands — a GM is undoing the loot,
not the die.

The stamp is the claim, not a flag read beforehand: the update matches only
while `lootUndoneAt` is still null, so two clicks drop exactly one tag. The
roll already carries `lootTagId` and `lootTagName`, so nothing else has to be
looked up — this used to point at a `CAVING_LOOT` Request and go through the
shared undo handler, until player actions stopped filing Requests at all
(`REQUESTS.md` §1).

## 5. The Caving lens

A third lens on `/gm/turns`, next to Moves and Requests
(`web/app/(desk)/gm/turns/QueueRail.js`), keyed `c` alongside `m`/`r`. Rows
show the die face, the character, the zone, and — for a `FIND` — the tier
and what was found. Default filter is **"Needs attention"**, which in
practice only ever matches an unresolved `TROUBLE` row — a hundred players
in the Depths would otherwise put a hundred quiet 2–5s in front of a GM every
day. Flip the filter to see the full log.

Rows show the die face, the kind, the character, the zone, and — for a `FIND`
— the tier and what was found. The kind's label comes from
`CAVING_KIND_LABELS` in `web/lib/cavingLabels.js`, shared by the rail's DTO
and the desk header; it lives in its own module because when the desk owned
the only copy, the rail printed every row's kind as "undefined" for months.

`CavingDesk.js` (modeled on `MoveDesk.js`, much thinner) is where a GM
narrates a `TROUBLE` roll. It carries the same **Result** box and **Stage as
message** bridge the Move desk has: the box is the GM-facing canon of what
happened, and Stage as message promotes it into a real DM to the roll's own
character (a `StagedMessage` wired to `cavingRollId`, delivered at the push
like any other). The Result box is *not* itself the thing the player receives
— Save and Mark resolved only store the notes, so narration left in the box
alone never reaches anyone. That gap is exactly why caving-desk
messages used to go missing: the desk had the notes box but no Stage-as-message
button, so a GM working "the same as a Move" had no send step. Alongside it are
the same `EffectComposer` / `MessageComposer` / `PublicComposer` trio every
desk uses (wired to `cavingRollId` instead of `moveId` — both `StagedMessage`
and `StagedEffect` carry the column, `SetNull` on delete same as `moveId`), and
a **Save** and a **Mark resolved** button. No cooperative lock like a Move — two GMs opening
the same roll can't race a solve that pays anyone twice, since resolving is a
one-way stamp with nothing to apply.

**Save is always there, resolved or not**, and it writes the Result box without
touching the roll's status or who resolved it. Mark resolved goes away once the
roll is resolved, and for a while it was the only button that ever stored the
notes — so a GM who resolved an encounter and then wanted to fix the Result
typed into a box that still accepted text and silently discarded it. That is the
same trap the Move desk fell into and fixed (`MoveDesk.js:415`); the two now
behave alike. Both buttons are the one server action,
`resolveCavingRoll({ mode })` in `web/app/(desk)/gm/turns/actions.js`, which
audits a save as `caving_roll_saved` and a resolve as `caving_roll_resolved`, so
`/gm/audit` doesn't read as if the roll was resolved five times.

A `FIND` row has nothing to resolve and no Result box, so it opens without
either button: what was found, and the **Undo this find** button described in
§4.

**The History lens reads Caving too.** `/gm/turns`'s History lens carries a
**Moves / Caving** switch beside its Turn picker (`historyKind` on the rail's
sessionStorage). Flip it to Caving and the lens lists that resolved turn's
rolls, mapped by the same `cavingRollRow` (`web/lib/moveRows.js`) the open turn
uses. Opening one shows `CavingDesk` in **read-only** mode — no composers, no
Mark resolved, the Result box disabled — but its staged rows still show, and an
unapplied one stays editable, the same rule `MoveHistoryDesk` follows. No Save
there either — a pushed turn's narration is settled. A
`/gm/turns/caving/<id>` link naming a past roll deep-links straight to it
(`page.js`'s `initialCaving`, the Caving twin of `initialHistory`).

## 6. `sellable` / `sellablePrice`

Two `Tag` columns, the seller's half of `purchasable`/`purchasableAfterStart`
— whether the Merchant's Depot will buy a tag off him, and for how many ⬢.
`syncTags.js` requires the two to travel together: `sellable` without a
positive `sellablePrice` is an error, and so is a price set without
`sellable: true`.

This update set them on six tags and left them inert, with no sell flow
reading either. **The Merchant Update built that flow** — `/depot` and the
`DEPOT_SELL` request — and widened the six to about 106, across brews, smithed
gear, bulk goods and salvage. The six originals kept their numbers: Graga Sac
(8), Cave Fungus (3), Saltpeter (3), Jewelry (8), Old Coin (1), Military
Autoinjector (10). See [`DEPOT.md`](DEPOT.md) §4, which is now canonical for
all of it.

Three of the caving artifacts are also on the Depot's *buy* shelf — the
Motorcycle and the Flamethrower, which the station has no trouble sourcing and
Ravenheart has every trouble hauling out of the Caves, and the **Mining
Helmet** (14 ⬢), which is station work rather than forge work: the plates are
a Simple Helm's, the lamp is not. Nothing else on the loot table is purchasable
at any price.

**Two of the new entries are not only loot.** `rock` is seeded by hand into
thirteen rooms across the Caves, the Depths, the Black Hills, the Mountain and
the Headwaters (`docs/zones.yaml`), so the ground is a source and the die is a
bonus. `purring-maggot` is the loot; **`maggot-milk` is not on the table at
all** — it is what a holder of Brewing (Basic) makes of one maggot for 1 ⬢, and
it calms exactly as much as tea does (`db/lib/mood.js` `CONSUME_RELIEF`) while
the raw maggot only poisons.

## 7. Two catalog fields this update added

Both documented in full in `schema.prisma`'s `Tag` model comments and read by
`web/lib/consumeGrants.js`; see `TAGS.md` §5b for `consumesInto` itself.

- **`consumesIntoResources`** — the Resources half of consuming a tag.
  `Purse` (consumes into 3 ⬢, no tag) and `Supply Kit` (8 ⬢ plus one
  Alcohol) are the first users. Applied by `consumeTagRequest`
  (`web/app/(app)/character/requestActions.js`) through the ordinary
  `creditResources` primitive, and snapshotted into `Request.effect` so
  `CONSUME_TAG`'s Undo debits it back exactly.
- **`consumesIntoOneOf`** — a parallel array to `consumesInto`, same length
  and order, for an even random pick between alternatives —
  `{ oneOf: [...] }` in `docs/tags.yaml`, the same shape `expiresInto`
  already used. `Skinned Cave Rat` is the first user: 50/50 Ate Meal or
  Vomiting. Nothing is previewed on `/character` — a player clicks Consume in
  the tag's tooltip and finds out — so `resolveConsumeGrants`, which commits
  to one, runs only in the server action.

## 8. The Radio rename

Unrelated to the die itself but shipped in the same update: `radio-system`
and `radio-bracelet` were renamed to `radio-system-watch` /
`radio-bracelet-watch`, both descriptions gaining "Tuned to the Watch's
frequency." `syncTags.js` upserts by slug and never renames, so the old rows
are simply left behind for `db:prune-tags` once nothing holds them.

They were renamed a second time when the Watch became the Cerberon, and are
now `radio-system-cerberon` / `radio-bracelet-cerberon` ("Radio System
(Cerberon)" / "Radio Bracelet (Cerberon)"). Same mechanic, same leftovers.

## 9. Where the code lives

| Concern | File |
|---|---|
| The die | `db/lib/cavingPass.js` |
| The loot table | `db/lib/cavingLoot.js` |
| The one trigger | `db/lib/cavingPass.js#rollCavingOnArrival` |
| The zone hold a 1 puts on you | `db/lib/cavingPass.js#cavingHoldFor` (§2c) |
| Its callers | `db/lib/locationTravel.js#performLocationMove` (mover + dragged), the Dev Panel's `teleportCharacterImpl`, `web/app/(app)/gm/dev/actions.js#bulkMoveCharacters` |
| The safe-Location exemption | `db/lib/locationAttributes.js` (`safe`), authored in `docs/zones.yaml` |
| Arrival DM senders | whichever face's location-move caller runs `performLocationMove` sends `moved[].cavingDm`; the two GM paths send their own |
| Kind labels | `web/lib/cavingLabels.js` |
| Loot grant, and taking it back | `db/lib/cavingPass.js`, `web/app/(desk)/gm/turns/actions.js#undoCavingFind` |
| Consume mechanics | `web/lib/consumeGrants.js`, `db/lib/syncTags.js` |
| The Caving lens | `web/app/(desk)/gm/turns/QueueRail.js`, `CavingDesk.js` |
| The document | `docs/documents.yaml` (key `caving`) |
| The public brief text | same entry — kept in sync with players by hand |
