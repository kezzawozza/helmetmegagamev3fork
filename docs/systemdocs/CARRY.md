# Weight, the free zone move, room stashes, and Transfer

What a character can hold, where they put the rest, and how it moves. This
doc owns `db/lib/carry.js`, `db/lib/carryPass.js`, `db/lib/roomStash.js`,
`db/lib/roomAnnounce.js`, `db/lib/mounts.js`, `db/lib/indoors.js`, the free
zone move in `db/lib/locationTravel.js`, the `room:` party kind, the merged
Transfer dialog and the Storage button. Related: `REQUESTS.md` (the two transfer request
types), `CHANNELS.md` §4 (Rooms), `MAP.md` §3 (the travel gate),
`TURN-ENGINE.md` (the carry pass), `TAGS.md` §5 (`carryBonus`).

## 1. The caps

A character carries two loads against two caps, both live on `/gm/dev`:

| Load | Counts | Base cap |
|---|---|---|
| Weight | `Tag.weightLbs` × quantity, over every `tradeable` tag. Three things weigh nothing: **Assets** (a horse carries itself, a house does not move), **untradeable** items (the Quickened Nerve Braid grafted into your neck), and everything that was never cargo — skills, injuries, statuses, beliefs. | `GameConfig.carryWeightLbs`, default 71 |
| ⬢ | `Character.resources` | `GameConfig.carryResourceCap`, default 25 |

**⬢ have one weight, and it is inside a crate.** Loose on a sheet a ⬢ weighs
nothing and counts on the row above instead; packed into a Depot crate it
weighs a pound (`RESOURCE_UNIT_LBS`, `DEPOT.md` §0e) so that it packs against
the crate's weight cap like any other freight. The two axes never count the
same ⬢ twice — once it is in the crate it is not on anybody's sheet.

Both caps are moved by the **sum** of every **active** `Tag.carryBonus`, which
is a signed distance from ×1: Cart `+4`, Giant `+0.75`, Pack Mule `+0.5`, Strong
`+0.1`, Frail `−0.1`. The cap is `base × (1 + sum)`, floored. Nothing carrying a
bonus is stackable, so the sum is per row.

**Additive, not multiplicative** — changed 2026-09-03, when bodies started
carrying penalties. Multiplied, Frail ×0.9 took 60 lb off a character pulling a
cart and 12 lb off a peasant: the same frailty, five times the bite, decided by
gear it had nothing to do with. Added, a frail body costs everyone the same 12
lb. The visible cost is that Cart + Giant is ×5.75 rather than ×8.75, which is
the point — a cart's wheels do not get better because the man pushing them is
large.

**There is a floor of ×0.25** (`MIN_MILLI` in `db/lib/carry.js`). Penalties add
up and the catalog holds enough of them to reach zero; a 0 lb cap would leave a
character permanently Overburdened with nothing they could put down to fix it.

**Active means equipped, for anything equippable.** A Cart you are not pulling
hauls nothing, so its bonus only counts while `CharacterTag.equipped` (§3). A
body — Strong, Pack Mule, Frail, a broken rib — is not `equippable` at all, and
so always counts. `multiplierApplies()` tests `Tag.equippable` rather than
listing slugs, which keeps the rule in the catalog where the rest of a tag's
behaviour lives.

`db/lib/carry.js` holds the math — `carryMultiplier` (the summing function kept
its name), `carryWeight`,
`carryCaps`, `carryHardCaps`, `carryAdmits`, `carryStatus` — with no prisma and
no I/O, so `/character` can render "60 / 71 lb" without dragging the barrel
into the client bundle. The cap on that row carries a `title=` breakdown: the
base, then a signed line per active bonus.

### 1b. What a body is worth

Bodies were decorative here until 2026-09-03: Frail, Old, Fat and every maiming
in the catalog said a character was weak and then changed nothing about what
they could haul, while Giant — the priciest tag in the game at 14 — bought no
carry at all.

| | slugs | `carryBonus` |
|---|---|---|
| Giant | `giant` | `+0.75` |
| Pack Mule | `pack-mule` | `+0.5` |
| Strong | `strong` | `+0.1` |
| Pack Mouse | `pack-mouse` | `−0.5` |
| standing traits | `frail`, `dwarf` | `−0.1` |
| standing traits | `old`, `fat` | `−0.05` |
| maiming | `missing-arm`, `missing-leg`, `crippled-leg` | `−0.1` |
| maiming | `peg-leg`, `missing-fingers`, `mangled-hand` | `−0.05` |
| chronic | `arthritis`, `consumptive` | `−0.05` |
| wounds | `grievous-wound`, `punctured-lung`, `gut-wound`, `broken-bone`, `cracked-ribs` | `−0.1` |
| wounds | `deep-wound`, `dislocated-shoulder`, `sprained-ankle`, `severe-burns`, `blunt-force-trauma`, `frostbite` | `−0.05` |

**A wound now moves a cap**, so anything that grants or heals one has to
re-settle carry or the sheet shows a stale number until the next turn pass. The
web writers already do, through `web/lib/afterInventoryChange.js`; so does the
bot's `/heal`. `overburdened` itself must never take a `carryBonus` — it is
granted *by* being over the cap, so lowering the cap from it is a loop.

## 1a. The weight bands

**0 is a real rung.** A key, a letter, a badge, a pair of spectacles: nobody's
carry is decided by their keyring, and pricing paperwork just makes players do
arithmetic about it. Written as an explicit `0` rather than omitted — omitting
`weight:` means the tag is not cargo at all, which is a different claim. A
0-weight unit is also never a candidate for the overflow drop (§5): shedding it
could not help, so the shuffle would only waste draws on letters while the
anvil stayed put.

**Price an item off this table, not by feel** — the same discipline the point
scale gets in [`TAGS.md`](TAGS.md) §4a. `db/lib/syncTags.js` throws if a
tradeable `items` tag omits `weight:`, so new gear cannot arrive weighing
nothing.

| Band | lb | Examples |
|---|---|---|
| Negligible | 0 | key, letter, badge, coin, spectacles, cigarette |
| Trivial | 0.5–1 | vial, tonic, dagger, sling, Graga sac |
| Light | 2–3 | meal, flask, sword, bow, cudgel, a book |
| Medium | 4–6 | spear, mace, helm, halberd, fishing rod |
| Heavy | 8–12 | crossbow, rifle, shield, bear trap, padded armor |
| Very Heavy | 20–30 | mail shirt, breastplate, pavise, Godflesh |
| Massive | 40–75 | plate armor, flamethrower, a corpse (a person's or a creature's) |
| Immense | 100 | workshop equipment, a nuclear device |

**A thing with an obvious real weight gets that weight**, and the band is for
what has none. A longsword is 3 lb, not 5; a halberd is 6, not 12; a war
hammer is 5; a crossbow 8; a knight's helm 6. The bands are ranges since the
realism pass of 2026-09-06 — earlier that day every weight had been cut 30%
by mistake, and the fix restored the old scale and then went item by item.
Light things are light (a dagger is 1 lb, a cigarette nothing) and heavy things
stayed heavy (plate 55, cataphract 65, a Graga corpse 75).

**The base cap is 71 lb** (120 until 2026-09-06, then 84 until later the same
day). A full harness (55) plus sword, dagger and shield (14) is 69 lb, which is
the whole cap: you can do the knight thing and carry nothing else at all. Two
pounds of slack is deliberate — the knight who wants to eat puts something
down, or pulls a cart.

**`{carry:slug}` in a tag description** renders the sentence Bascinet wrote,
computed from the live caps: "You can carry 5 more item tags, and 12 ⬢." Pack
Mule and Cart both end with it. `getCarryReference` in `web/lib/referenceData.js`
pre-formats one line per multiplier tag, streamed from the root layout into
`CarryProvider.js`; `RichText.js` and `ChipText.js` render it as plain text.
The multiplier lives once, in `docs/tags.yaml`, and the description only names
its own slug.

## 2. Over the cap, and the ceiling past it

There are two lines, not one.

| Load | What happens |
|---|---|
| ≤ cap | fine |
| cap → 1.5× cap | it lands; `overburdened` is granted |
| > 1.5× cap | **it cannot be yours at all** |

`HARD_CAP_RATIO` in `db/lib/carry.js` is that 1.5, derived from the cap rather
than stored, so a GM raising the base moves both lines together.

**The ceiling bites in two different places**, because things arrive in two
different ways:

- **Deliberately** — a hand-over through Transfer. `carryAdmits()` refuses it
  before it lands, with a sentence the caller hands straight to the player.
  It has to: otherwise handing someone 300 lb would land, and then shed a
  random slice of what they were *already* carrying onto a public floor where
  anyone could take it. The other deliberate routes (Craft, `/store`, a Depot
  buy, Loot, a stash pull) do **not** call it yet — those are self-inflicted
  rather than a griefing vector, so today they land and shed. Wiring them is
  owed work.
- **Involuntarily** — a Labor payout (which is ⬢: `LABORING.md`), Caving loot,
  a GM grant, a `consumesInto` chain. It lands, and then `settleCarry` sets the
  excess down in a random public Room where they stand. This is the farmer who
  reaps more than they can carry: past the cap they are Overburdened, past the
  ceiling the rest is simply on the ground.

### What Overburdened costs

Being over the cap **zeroes your free zone moves** (§2a). It is no longer a
refusal: an overloaded character can still cross into another zone, they just
pay their Move to do it, and cannot then act. Only the mover is affected — the
dragged are corpses and the helpless. Escorting is not gated at all: a party
crosses on the leader's allowance.

The tag itself (`docs/tags.yaml`, `OVERBURDENED_SLUG` in
`db/lib/constants.js`) is granted the moment you are over either cap and
cleared the moment you are back under, never by a player and never on a clock.

## 2a. The free zone move

Crossing a zone used to always spend your Move, with a mount buying one extra
crossing per *day*. Now:

- Everyone gets `GameConfig.freeZoneMovesPerTurn` crossings a turn, default 1.
- An **equipped** mount adds one, and it refreshes every turn — a horse carries
  you at Dawn and again at Dusk. It is **spent first**: the mount's crossing
  goes before the base one and stays charged to the mount, so parking the horse
  at an indoors door later in the turn cannot take back a crossing you never
  spent. **Only while your escort party fits its
  seats**: go over `fastTravelCapacity` and the mount buys nothing this
  crossing (`MAP.md` §3a). On foot there are no seats and nothing to lose, so
  walking any number of people is free.
- Overburdened sets the allowance to **0**.
- A **lamed** character's allowance is also 0 — a leg too hurt to carry you
  (`crippled-leg`, `cripple`, `missing-leg`, `sprained-ankle`) or too dazed to
  find your way (`pain-shock`). `LAMED_SLUGS` in `db/lib/locationTravel.js`.
  A mount cancels it outright — the horse does the walking — and it's the
  free crossing that's gone, not the ability to cross: pay the Move, or have
  someone Escort you.
- Past the allowance, a crossing files the `MOVE` Action as it always did.
  Once you have acted, you cannot cross.
- A **free** crossing lands at once. A **paid** one is a day's walk and only
  lands next turn (`MAP.md` §3) — the Move goes now, the traveller stands still
  until the turn turns.

So a peasant walks Town → Forest for nothing, spends their Move to reach the
Fortress, and the way back waits for the next turn. That is the whole model.

`Character.zoneMovesTurnId` + `zoneMovesUsed` track it, and
`zoneMovesBonusUsed` counts how many of those crossings went on a mount's or a
boat's extra rather than the base allowance. All three are claimed by a
conditional `updateMany` whose WHERE is the check, so two tabs cannot both
spend the last one. A differing turn id resets the counter in the same
statement, so nothing ever sweeps the field. `freeZoneMoves()` and
`freeMovesLeft()` live in `db/lib/locationTravel.js`; the sheet shows the
number and Discord's Travel confirm says what the hop will cost before you take
it.

`freeMovesLeft()` takes an optional `crossing` (the same
`{ fromZoneSlug, toZoneSlug }` shape `freeZoneMoves()` does), and it matters:
the boat's bonus is earned per crossing, never banked, so it can only ever
show up once a destination is actually known. The sheet's ambient count
(before anyone has picked one) passes nothing and reads the honest
pre-commitment number. Every surface that DOES know the destination — the
Travel panel's per-node cost, `/map`'s per-node cost, and Discord's Travel
picker — has to pass the real crossing per node/option rather than reusing
one shared number for the whole list, or a boated character crossing
Forest↔Hills or Hills↔Marshes reads as costing the day when it would
actually be free.

## 3. Mounts, carts, and indoors

`horse`, `motorcycle` and `cart` are **equippable**, and
give nothing while stowed — no carry multiplier, no extra zone move, no
passenger seats. They sit in the `MOUNT` slot (`TAGS.md`, "equipSlot"): a
horse, a motorcycle or a boat is *ridden* (layer 1) and a cart is *towed*
(layer 2), so a horse and a cart go together and a horse and a boat do not.

`horseshoes` is a plain `ACCESSORY`, not a third `MOUNT` layer, and does
nothing on its own — `fastTravelBonus()` (`db/lib/mounts.js`) only counts it
while a plain **Horse** is equipped alongside it, turning that horse's one
extra crossing into two. It does nothing for the Thoroughbred or Warbeast
(already bred/built for speed) or the Motorcycle (no hooves).

**Seats, from `fastTravelCapacity()`:** a Horse alone is 2, and a Cart upgrades
that pair to 6 — the biggest ride there is. They count the **rider**, so a
horse seats you and one other. Overfilling them is not refused; it costs the
mount's extra crossing and nothing else (`MAP.md` §3a). This function had no
live caller at all until escorting gave it one. The **Motorcycle is 2 and cannot be
upgraded** — it is tested before the horse for exactly that reason, so the
Cart's clause can never reach it. A hand-cart towed behind a motorcycle is not a thing, and letting it fall
through would have quietly turned one seat into six.

The motorcycle was inert loot until 2026-09-06 — 100 lb of flavour with no
`equippable` at all. Making it a mount was one slug added to
`FAST_TRAVEL_SLUGS`: the indoors parking, the boat conflict and the Motion
Sickness refusal below all read that set rather than naming their slugs, so
every one of them picked it up for free.

**Motion Sickness** refuses equipping any of them outright
(`web/app/(app)/character/equipActions.js`) — a Motion Sick character never
rides. A Motion Sick character *dragged along* by someone else's mounted or
boated crossing doesn't get a say: `db/lib/locationTravel.js#vomitOnTheRide`
grants them Vomiting (and DMs them) the moment a mounted or boated mover
crosses a zone with them in tow.

A **connection** can keep a mount out too — `on_foot: true`, which dismounts a
mounted character crossing it rather than parking them on arrival (`MAP.md`
§2c). The two are complements: `indoors` covers a place, `on_foot` covers a
way in — and the timing has to differ: `on_foot` dismounts *inside* the
crossing's own transaction, before the free-move accounting reads it, or a
rider could bank the mount's bonus crossing on a ride that never survives the
threshold (`MAP.md` §2c).

A Location marked `indoors: true` in `docs/zones.yaml` — the Cathedral, the
Sanctuary, the Inn, the Keep, the Undercroft — is a place you walk
into, and you do not bring a horse into a chapel. On arrival
`db/lib/indoors.js#parkMountsIndoors` unequips them and DMs the character;
`equipOne` refuses to put them back on while they stand there. The anchor
message says so in its own `-#` line, written by `syncZones` and hashed with
the rest of the body, so it appears once and never again.

**`wheels: true` is the exception, and it is authored.** `indoors` was
answering two questions with one column — is there a roof over this place (the
mood dial, Sun Sensitivity, whether a palisade can be raised in it) and do
wheels stay outside — and a warehouse is a yes to the first and a no to the
second. So a Location may carry the `wheels` attribute (`MAP.md` §1b) and admit
a cart and a horse while keeping its roof for everything else. Three places
have it: the **Godard Factory**, whose Logistics Room has a ramp down to dry
ground and whose whole business is loading crates of Squeeze onto a wagon;
**Customs**, a gate built to be driven through; and the **Depot**, a shop that
ships by the wagonload. Without it the last hundred feet of every Squeeze run
were done on foot, one 68 lb crate a trip, because an unequipped cap is 71 lb.

Every reader that asks "may a mount be out here" goes through
`locationAttributes.js#parksMounts(location)` rather than the column — the
arrival parking, the equip refusal, the sheet's equip board, and the `·
indoors` marks on the /map and /chat travel pickers. Reading the column
directly in a new caller is how the Factory would come to admit a wagon on one
surface and refuse it on another. The readers that ask about the **roof** —
`examineVision.js`, `paper.js`, `mood.js#placeClassOf`, `structures.js` — keep
reading `indoors` straight, which is the entire point of the split.

The parking happens **before** the settle, so the reduced cap is what the
settle sees, and Overburdened goes on in the same pass. Nothing is dropped for
it — see §4.

## 4. Settlement: pull-based, post-commit

`settleCarry(prisma, characterId)` is the one function that makes a sheet agree
with its caps. It is **pull-based** — it recomputes from the current row
rather than being told what changed — for the same reason
`roomAccess.js#syncCharacterRoomAccess` is: the writers that change what a
character holds are many and scattered, ten of them bypass
`tagWrites.js#dropCharacterTag` with a raw `deleteMany`, and the ⬢ half moves
through a wholly different set. A push from any one of them would miss the
rest. And it is **post-commit**, never inside a caller's transaction, because
an overflow drop has to talk to Discord.

It runs, in this order, at:

- **Every web writer that touches tags or ⬢**, through
  `web/lib/afterInventoryChange.js`: settle → re-read the row → narrowcast
  sync → room-access sync → `deliverCarryDrop` in `after()`. That order is
  the rule: a drop can take a private-room key off the sheet, so membership
  must be recomputed from the post-drop holdings. Every request action in
  `requestActions.js`, the Depot's three, `/store`, the GM grant/revoke
  surfaces, the Dev Panel, `gmTransfer.js`, and — once, generically — the
  desk's `resolveRequest`, over every character id it can find on the
  request's effect. That last one keeps REQUESTS.md's promise that adding a
  type costs one `REQUEST_EFFECTS` entry.
- **Every arrival**, in `db/lib/locationMove.js#applyLocationMoveSideEffects`,
  immediately before the room-access sync and immediately after the mounts are
  parked (§3). This is the hook that retries a deferred drop (§5) and settles
  Caving loot picked up on the way in.
- **The bot's `/heal`**, beside its existing room-access sync.
- **Turn close**, as the `carry` pass (`db/lib/carryPass.js`), after `hunger`
  and before `lifewebDecay` so it sees the final sheet: Labor payouts, staged
  pushes, the expiry sweep and the ⬢ upkeep all happen earlier in the close
  and none of them may settle in place. One transaction per character, drops
  returned to `runSideEffects` rather than sent. Caving loot granted at turn
  open is settled by the next close or the next inventory action, whichever
  comes first.

Returned, never sent: `settleCarry` hands back
`{ characterId, over, granted, removed, drop }` and `deliverCarryDrop` does the
Discord half — the DM and the aliased room line (§6).

## 5. The overflow drop

**Drops are acquisition-driven, and only acquisition-driven.** Nothing comes
off a sheet because a cap SHRANK. Unequipping a cart at an inn door, handing
one over, a GM lowering the base cap — all of those make a character
Overburdened and no more.

**`Character.carryWeightSeen` / `carryResourcesSeen` are what tell the two
apart.** They hold the load at the last settle, and the shed fires only when
the load has **grown** past the ceiling — never when the cap fell beneath a
load that did not move. Without that comparison the settle cannot distinguish
"you picked something up" from "you put your cart down", and since §3 parks a
cart at every indoors door, the second reading would empty it onto the chapel
tiles every time you walked in. (The old watermark tracked the *multiplier*,
for the narrower job of noticing a Cart had left; this one tracks the load,
because the load is the thing the rule is actually about.)

The watermark advances to the post-shed load at the end of every settle —
**except** when the shed was deferred for want of a public room, where it is
deliberately left behind so the growth stays unclaimed and the next settle
retries. The write is a conditional `updateMany` on the previous pair, so two
settles racing on the same growth cannot both shed.

**What drops.** `drawDrops` shuffles the droppable units and takes from the
front until the excess is covered, shedding back to the **ordinary cap** rather
than to the ceiling — landing someone exactly on 1.5× would leave them one
letter from spilling again every turn. Weightless units are not candidates at
all, or the shuffle would spend its draws on letters while the anvil stayed
put. Two things are never in the bag: multiplier tags (dropping the Cart to fix
being over would shrink the cap again and loop) and equipped gear (being
disarmed by an overfull pack reads badly). Every ⬢ over the ⬢ ceiling spills
the same way. Audit: `carry_overflow_dropped` with the manifest.

**Nowhere to put it down** — unplaced, or a Location with no public room — and
the character simply stays over the ceiling with the watermark held back; the
next settle, on arrival or at turn close, retries for free. Audit:
`carry_drop_deferred`.

## 6. Room stashes

Every Room, public or private, holds unlimited ⬢ (`Room.resources`) and
unlimited tag stacks (`RoomTag`, one row per tag, `@@unique([roomId, tagId])`).
A room is where you put what you can't carry.

**Two rooms hold nothing at all.** `Room.destroysContents` — the Godard
Factory's Spillway and the Servant Wing's Latrines — makes both writers into a room
(`giveTagTo`, `moveParty`) no-ops, so what goes in is gone. Undo can still hand
it back to the sender, because the effect records `destroyed: true` and skips
the receiving half; without that the ordinary path throws on a stash that never
held anything. See `FACTORY.md` §9.

Two things a stash does differently from a pocket, both in
`db/lib/tagWrites.js`:

- `addToRoomStack` has **no non-stackable pin**. Two players can each leave
  their Longbow and the row goes to 2; the pin is a rule about what one
  character can hold, and `addToStack` re-applies it on the way out. That is
  also why `transferRequest` clamps a non-stackable pull out of a room to 1,
  and refuses it outright to someone who already holds one — a silent pin
  would move 1 while the request said 2, and Undo would take 2 back.
- `dropRoomTag`'s **decrement is the check** — a conditional `updateMany` —
  because a room is the game's first multi-actor inventory: two players in
  the same public room can pull the same stack in the same tick.

`expiresTurn` rides along from the holder's row (the earlier clock wins when
stacks merge), and the two blind sweeps in `db/index.js` shed `RoomTag` rows
the same way they shed `CharacterTag` ones — a stashed meal still rots.
`tagExpiryPass.js` stays character-only, so no *affliction* chain fires on a
floor. **One progression does reach a room stash**: a corpse left lying in one
goes off after three turns (`db/lib/corpseRotPass.js`, `CORPSES.md` §3). It
runs before the sweep and nulls the holding's `expiresTurn`, which is what
stops the blind `deleteMany` deleting the body instead of rotting it — so the
sweep never sees it and needs no exemption list.

One trap while you are in here: `RoomTag.tagId` cascades from `Tag`, but
`CharacterTag.tagId` is **RESTRICT**. Deleting a catalog row somebody is
carrying throws; clear the holdings first.

**Who can reach a stash.** Standing in the room's Location, and admitted to
the room — `roomAccess.js#accessibleRooms`, the same predicate the
thread-membership sync uses, so the transfer gate and the door can never
disagree about The Charon. `web/lib/transferReach.js#canReachParty` carries
the rule.

"Admitted" is two things, not one: holding one of the room's `access:` tags,
**or** a `RoomGuest` row somebody wrote with `/add` (`CHANNELS.md` §4a). A
guest reaches the stash exactly as a key-holder does — being in the room is
being in the room, and a visitor who can read the thread but is told the floor
isn't theirs would just be confusing. Load both halves with
`roomAccessKeys(prisma, characterId)`; passing keys alone is how the two
answers drift apart.

Since the 9/2026 roster change every reach rule is Location-grain
(`db/lib/presence.js`), so a room and a person are judged at the same grain.

**A public stash is public.** Anyone at the Location can list its contents
(the Storage button, or the Transfer dialog) and walk off with them. That is
the point of a floor, and it is also a trace: the goods often say who passed
through. Private rooms leak nothing to anyone their key — or their host — hasn't
admitted.

The stash survives the message wipe (it lives in the database, not the thread),
is cleared by a Restart Game wipe (`wipeGameData` deletes `RoomTag` and zeroes
`Room.resources`), and cascades away with its Room when `db:sync-zones` prunes
one. Deleting a Tag from the catalog cascades its **room** stacks
(`RoomTag.tagId` cascades) but not the copies people carry
(`CharacterTag.tagId` is RESTRICT) — see the trap above.

## 7. Transfer

> One exception to everything below: your own faction's **silo**. It is an
> ordinary Room stash, but you can put things into it from anywhere in that
> room's zone, and take things out only by standing in it — even when the door
> is locked to you. See `FACTIONS.md` §4.


One dialog — **Move things** (`web/app/components/actions/MoveThingsDialog.js`,
modes `transfer` and `loot`) — is Transfer, Loot, Take, Drop and Give. Two
chip rows say the direction (From: you, a Room here, or somebody helpless;
To: you, a person here, a Room, your silo), then every stack the source
offers is a row with a count (`StackRow.js`: name · − n + · All), plus a ⬢
box.

**The name is a `TagChip`, and the weight sits beside it** (2026-09-10). This
dialog was the one list in the app showing a bare name, and a player said what
that cost: *"Right now I have to pick up equipment and try putting it on to
figure out where it goes."* The chip's hover is the same card the Depot, the
Tag Catalog and the sheet's own rail already show — In a fight, Armour, Weight,
**Worn** (`describeEquipFit`: "Held · takes two", "Head · Liner"), Cost. The
weight is inline rather than on the hover because it is the fact that decides
the answer while the dialog is open, with the carry cap in the projection line
below. **A helpless person's pockets are the exception**: those rows keep a
plain name and a weight and get no chip, because the loot filter is `tradeable`
rather than `catalogVisibility`, so a secret tag somebody is carrying is already
named there and handing over its description, recipe and cost too would be a
second leak (`REQUESTS.md` §5b). It replaced two dropdowns, a checkbox list with a "How many?" field per
tick, and a separate Loot dialog that was a third dropdown over the same body.
The people are the same roster every picker uses (web/lib/peopleHere.js), and
the whole thing is re-read the moment the dialog opens
(`actions/useRoster.js`). Out of a person's pockets **is** Loot — the server
hands that source to `lootCharacterRequest`, so the helpless gate, the mood
hit and the "your body was searched" notice fire whichever button opened it;
you can't reach into a standing person's pockets, and listing what's in them
would show their hidden tags (REQUESTS.md §5b). The Loot button opens the same
dialog with you left off the From row. The projection line
("After this you carry 60 / 71 lb and 6 / 25 ⬢") warns in accent when the
result is over a cap and submits anyway — going over is allowed up to the ceiling (§2).

Server side, `transferRequest` in `requestActions.js` resolves both parties
(`db/lib/parties.js`, which now knows `room:<id>`), checks reach once,
validates every line against the source's holdings, and in one transaction
files **one `TRANSFER_TAG` per line and one `TRANSFER_RESOURCES` for the ⬢** —
so a GM can still undo any single piece from `/gm/turns`. The two request
types are unchanged in kind; `TRANSFER_TAG`'s effect gained `from`/`to`
parties beside its legacy `fromCharacterId`/`toCharacterId` mirrors, and Undo
synthesizes the pair from the legacy fields for rows filed before rooms
existed. `moveParty` maps the three kinds through a table so `applyTransfer`'s
`(kind, id)` lock ordering is untouched.

After the commit: `afterInventoryChange` for every character end, the usual
DM to a receiving character, and for a room end an **aliased line in the
room's thread** (`db/lib/roomAnnounce.js`, the whisper poll's alias):
"*An old woman leaves Graga Sac ×3 and 12 ⬢ here.*" / "*A young man takes a
Lantern.*" The room learns an age and a presentation, never a name.

**You can hand something to a stranger in a hood** — the one action that
reaches a concealed person. The row reads "a young man" and its value is
`hood:<token>` rather than `character:<id>`; `PROXYING.md` §5 has the rule and
the handle. Transfer also sits on a hood's row in the HERE column now, beside
Converse and Add, because the dropdown used to be the only way to find it.

Two things specific to this dialog. The recipient list is **one `whosHere()`
call**, named people and hoods together, and not `peopleHere()` plus
`whosHere()`: those split on different things — the `concealed` column versus
what is actually over the face — so a character in a sack was offered twice,
the second time under their real name. And the receiving DM ("You were handed
…") names no giver, the same silence the aliased room line above keeps.

The two older actions, `transferTagRequest` and `transferResourcesRequest`,
still exist for their `LOOT` direction and for anything else that calls them.

## 8. The Storage button

Every Room's starter post carries one button, **Storage**
(`db/lib/roomStarterRow.js`, `room:storage:{roomId}`, hashed into
`Room.postHash` with the body so existing threads get it on the next
`db:sync-zones` and never again). `bot/src/lib/roomStorage.js` answers it,
ephemeral, to anyone standing in the room's Location, in Bascinet's format:

```
-# 15 ⬢ | **Tags**: Graga Sac ×3, Lantern, Cart
-# Nothing is stored here.
```

Reading is free; moving things is the web's Transfer. A Discord select menu
caps at 25 options, which is why there is no native deposit/withdraw flow.

**Taking things out of a stash is From: the room, To: yourself.** You are in
your own "To" list — that is the whole of looting a room, and the dialog left
it out for a while, which made every stash in the game a one-way drop.

## 9. Where the code lives

| Piece | File |
|---|---|
| Math, `settleCarry`, `deliverCarryDrop` | `db/lib/carry.js` |
| Turn-close pass | `db/lib/carryPass.js`, wired in `db/index.js` (`TURN_PASSES` `"carry"`) |
| Random public room, manifest and Storage formatting | `db/lib/roomStash.js` |
| Aliased room line | `db/lib/roomAnnounce.js` (+ `aliasSubject` in `db/lib/concealedIdentity.js`) |
| Room stack writes | `db/lib/tagWrites.js#addToRoomStack` / `dropRoomTag` |
| `room:` party, balance table | `db/lib/parties.js`, `db/lib/resourceTransfer.js` |
| Reach | `web/lib/transferReach.js` |
| Corpses in reach (same rule) | `db/lib/corpses.js` (`CORPSES.md`) |
| Post-commit tail | `web/lib/afterInventoryChange.js` |
| Merged action | `web/app/(app)/character/requestActions.js#transferRequest` |
| Undo, party-shaped moves | `web/lib/tagEffects.js#takeTagFrom` / `giveTagTo` |
| Dialog, grid, readout | `components/actions/MoveThingsDialog.js`, `StackRow.js`, `ActionGrid.js`, `LedgerBand.js` |
| `{carry:slug}` | `web/lib/referenceData.js#getCarryReference`, `CarryProvider.js`, `RichText.js`, `ChipText.js` |
| Free zone moves, travel gate | `db/lib/locationTravel.js#performLocationMove`, `freeZoneMoves`, `freeMovesLeft` |
| Mounts: what counts while equipped | `db/lib/mounts.js` |
| Parking at an indoors door | `db/lib/indoors.js`, `db/lib/locationMove.js` |
| Storage button | `db/lib/roomStarterRow.js`, `db/lib/syncZones.js`, `bot/src/lib/roomStorage.js` |
| Caps on `/gm/dev` | `web/app/(desk)/gm/dev/page.js`, `web/app/(app)/gm/dev/actions.js` |
| Constants | `OVERBURDENED_SLUG` in `db/lib/constants.js` |
| Load watermark | `Character.carryWeightSeen` / `carryResourcesSeen` |
| Weight bands | `weight:` in `docs/tags.yaml`; `Tag.weightLbs` |

## Crates

A crate weighs **half what is in it**, rounded up, never under 1 lb
(`db/lib/depotCrates.js#crateWeight`). That is the whole point of packing
something, and it is why a wagon of Squeeze reaches the Depot at all
(`FACTORY.md` §5). It was a flat 15 lb until 9/2026, which made a crate of obols
heavier than the obols and a crate of armour lighter than one piece of it.

Two things make crates now, on one arithmetic:

- **A Depot shipment** lands as several, split by `splitIntoCrates`.
- **The Package button**, from anywhere with Packaging Equipment in reach: up to
  150 lb of what you are carrying, plus a line you type yourself, which is
  **not** checked against the contents.

Both are runtime `Tag` rows, `custom: true`. They are ordinary cargo for every
purpose here: they count against the cap, they can be transferred, stashed and
stolen. Opening one replaces its weight with whatever was inside, which is
always heavier. A player-packed crate is an ordinary `consumable`, so the
Consume button opens it; the Depot's own sealed ones want the keycard and the
`/depot` panel.

Obols are the other end of the ladder: `weight: 0`, the Negligible band, the
same as a key or a letter. Compressing ⬢ into something you can actually carry
is most of the point of them. See `docs/systemdocs/DEPOT.md` §0e and §0g.
