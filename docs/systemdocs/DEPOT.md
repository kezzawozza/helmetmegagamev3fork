# The Depot

The Merchant's station: a hangar door in the roof of the caves, a shuttle that
comes through it, a generator that has to be fed, a turret in the ceiling, and
a bank. This file is the source of truth for all of it.

Everything the Depot buys and sells has a real price. Price a new ware off the
tables below, not by feel. If you change a number here, change the tag's
`depotPrice` or `sellablePrice` in `docs/tags.yaml` in the same commit — this
file and that one are the same numbers written twice, and nothing checks that
they agree.

**The Depot has no tier ladder.** Smithing prices a weapon by picking a tier
(`SMITHING.md`); the Depot prices each ware on its own, because what a thing
costs is a fact about a civilisation Ravenheart cannot see. The tables below
are the ladder — there is nothing above them to derive a price from.

Unlike a brewing recipe, these numbers **are** enforced. `depotPrice` and
`sellablePrice` are read off the catalog row server-side by
`web/app/(app)/depot/actions.js` — never taken from the client — and a GM does
not adjudicate a purchase. The price is then snapshotted into `Request.effect`,
so re-tuning a number here never changes what an Undo of an older trade
reverses.

## 0. The rework, and what it changed

The Depot used to be a shop: two panels, a table, and ⬢ moving on and off the
Merchant's own sheet. It worked and nobody wanted to open it twice. The rework
turned it into a machine somebody operates, and five things are now true that
were not before.

- **The money is obols (¢), and one obol is one ⬢.** Nothing converts and
  nothing rounds. **The catalog still prices in ⬢** — `depotPrice` and
  `sellablePrice` are what a thing is *worth*, and that has to keep meaning the
  same number whether the Merchant is buying it or a player is haggling over
  it — so every authored price is already a whole number of obols too.
  An obol does not compress value, it makes value **physical**: a weightless
  stackable tag holding the same amount as the number on a sheet, but one you
  can carry, hand over, stash and have stolen.

  It used to be worth 5 ⬢, and that broke the bottom of the price table. A 3 ⬢
  cup of tea cost a whole coin to buy and paid nothing at all to sell, because
  the station took the ceiling one way and the floor the other. Thirty-two
  wares sold for under a coin and were therefore worth zero at the counter. The
  rate, the two rounding helpers and the ⬢/¢ display toggle are all gone.
- **The money belongs to the station, not the Merchant.** It lives on
  `Depot.accountObols`. The licence is tradeable, so handing it over hands over
  the balance too, and that is what makes the card worth stealing.
- **Goods arrive physically.** An order is paid for now and delivered later, as
  crates on a landing pad that anyone with a keycard can walk into.
- **The lights can go out.** A generator burns fuel every turn and takes the
  whole Depot down with it when the tank empties.
- **The room can kill you.** A turret, off by default, that reads faces.

Everything below describes the reworked system. `Character.depotDebt` is gone;
the line lives on `Depot.debtObols`.

## 0a. The moving parts

| Piece | Where it lives | Notes |
|---|---|---|
| Station state and tuning | `Depot` singleton, `id = 1` | `db/lib/depotState.js` — every mover is a locked clamp, per `lifeweb.js#bumpBlood` |
| The turret | `db/lib/depotTurret.js` | Weighted severity table, bent by the target's `Tag.ballisticArmor` |
| Crates | `db/lib/depotCrates.js` | Runtime `Tag` rows with `custom: true` |
| Per-turn upkeep | `db/lib/depotPass.js` | Fuel burn, shuttle clock, turret sweep |
| The console | `web/app/(app)/depot/`, `web/app/components/Depot*.js` | Cockpit strip + six tabs |
| GM tuning | `/gm/dev?s=depot` | `updateDepot` in `web/app/(app)/gm/dev/actions.js` |

## 0b. Who may do what

Three doors, deliberately different:

| Holder | Can |
|---|---|
| **Merchant's Licence** | Everything below, plus the money and the gun: order, the ATM, the credit line, arming and disarming the turret, and shutting the generator down. |
| **Depot Keycard** | Enter the landing pad. Open crates, including sealed ones. Call the shuttle down, load it and send it back up. Feed the generator and fire it up. Spends nothing. |
| **Superadmin** | Read the console. |
| Anyone else | Bounced off `/depot`. |

The licence is checked, never the Merchant **role** — the licence is tradeable
and a role check would quietly break that. The keycard is checked the same way
and for the same reason.

Everything except reading needs you **standing at the Depot**, and everything
except the fuel hatch and the two generator switches needs the generator
**running**.

**Reading really does mean from anywhere.** The console opens for a licence or a
keycard wherever its holder is standing, with every control greyed and the
banner reading "You're not at the depot." It used to redirect to `/character`
instead, which made the Depot rail item — the item follows the licence, not the
location — behave like a broken link for most of a Merchant's day. The gate that
stayed is the other one: somebody carrying neither the licence nor a keycard is
still bounced off the page entirely.

**The keycard used to operate nothing.** It read the console and cracked
crates, and that was all. The turn length is what changed it: one turn is one
real day, so "the Merchant will call the shuttle down when he wakes up" is a
day of nothing moving, and a player who paid yesterday is still waiting. The
split is between **labour and money**. A keycard does the work — three server
actions plus the crate one, all of them either free or paid for out of the
Docker's own pocket — and cannot spend an obol, draw on the credit line, or
point the gun at anybody.

Two edges of that are deliberate rather than accidental:

- **Sending the shuttle up is the sharp one.** A keycard can sell everything
  standing on the pad. That is the real cost of the change, and it is the same
  exposure the pad has always had — the room is a stash anyone with a card can
  walk into and carry off, so a card that can *load* the shuttle is not a new
  door, only a faster one. The payout lands in the station's account either
  way, so it moves goods, never money out of the Depot, and the ledger names
  whoever pressed it.
- **The generator is split by direction.** A keycard may start it, because a
  dead generator otherwise takes the whole station down for a day. Only the
  licence may shut it down, because the lights going out take the **turret**
  with them, and handing a keycard the off switch would hand it the security
  system.

The gates live in `web/app/(app)/depot/actions.js`:
`requireDepotStanding` does the standing, the ACT check and the power, and
`requireLicensedMerchant` / `requireDepotHand` sit on top of it.

## 0c. The generator

`Depot.generatorFuel` burns `fuelBurnPerTurn` every turn it runs and switches
itself off at zero. With it off, **nothing at the Depot works** — no ordering,
no shuttle, no ATM, no turret. The one exception is the power switch itself,
for the obvious reason.

Coal is the proper fuel (`coalFuel`, 50 by default); saltpeter is the fallback
and deliberately worse (`saltpeterFuel`, 15). At the shipped defaults a full
tank is five turns and one coal is two and a half, so the Merchant refuels
roughly every five turns and has to stay profitable to afford it. Overfilling
wastes the surplus rather than banking it.

`depotPowered(depot)` is the single predicate for "on". Fuel at zero is off
even if the switch says otherwise.

## 0d. The shuttle and the landing pad

The landing pad is a **real room** — a thread under the Depot channel,
authored in `docs/zones.yaml`. The lock sits on the Cargo Bay next door rather
than on the pad, which is only a hole in the roof; where a room IS gated,
membership is handled entirely by `db/lib/roomAccess.js` and reconciled by the
channel doctor, and the feature adds no access code of its own.

Its starter message says whether the shuttle is on it — `live: shuttle` in
`docs/zones.yaml`, rendered by `db/lib/roomLive.js` and repainted by
`refreshLiveRooms` on every move of the state. That is the general mechanism,
not a special case: any room may name a live key.

The cycle:

1. **Order** into a manifest. Obols leave the account now; the goods do not
   exist yet. That gap is the risk of the business.
2. **Call it down.** The manifest becomes crates in the landing pad's stash,
   and the shuttle is `DOCKED`. An empty manifest still brings it — he needs it
   down to load anything going up.
3. **Load and send it back.** The goods on the pad go up and come back as
   obols at their `sellablePrice`. An **unopened crate is worth what is inside
   it**, priced off the live catalog — otherwise returning a shipment would
   silently annihilate it. **Loose ⬢ in the stash go up too**, at 1 ¢ each
   (`RESOURCE_EXPORT_PRICE`). That is the only door out of ⬢ and into coin, and
   it costs half their face value to walk through.
4. Or **it leaves on its own** after `shuttleMaxTurns` (6). A timed departure
   takes nothing with it — the crates stay on the pad. Selling is a deliberate
   act and an unattended shuttle should not empty the room.

`shuttleCooldown` is the gap between landing and being able to send it back —
a *departure* gate, not an arrival one. (`ShuttleState.INBOUND` is declared and
never written; calling it down lands it immediately.)

`shuttleTurn` is **never null**. It used to be set from `getOpenTurn()`, which
is legitimately null between advances, and a null clock made both timers read
"landed this turn" forever: send-up stayed inside its cooldown, the automatic
departure never fired, and re-calling was refused because the state was not
`AWAY`. Only SQL could free it. It floors to 0 instead.

## 0e. Crates

A shipment does not arrive as a tidy pile of tags. It arrives packed, in
crates, and somebody has to open them. That makes unloading a job worth paying
a Docker for, puts a delay between buying a pistol and holding one, and means a
crate left on the pad can be stolen.

**A crate is packed by weight.** It fills to `PACKAGE_MAX_LBS` — 150 lb of
contents — and then a new one opens. That is the same constant the player-facing
Package button enforces (`FACTORY.md` §5), so a Depot shipment and a
hand-packed crate now agree on the ceiling as well as on the halving. What
comes out is a box with a volume rather than a counter: 99 tea in one crate, an
anvil most of the way through another.

Crates used to hold **3-8 units of anything**, which made a crate of tea and a
crate of anvils the same size and burst an order of ⬢ into eleven boxes. That
band is gone. What survives from it is the shuffle — units are mixed before
they are packed, so a crate holds a random handful rather than one tidy line
item — and `MAX_CRATES` (12), past which a huge order simply means fuller
crates rather than a landing pad buried in tag rows.

There is a second cap, on **count** rather than weight: `PACKAGE_MAX_UNITS`
(200). The weight cap does not bound the weightless, and seven Depot wares
weigh 0 lb — `cigarette`, `jewelry`, `spectacles` and the four animals — so
without it a weightless order packs into one crate however large it is.

**A crate is a `Tag` row created at runtime** with `custom: true`, so
`db:prune-tags` skips it (`db/lib/pruneTags.js`). Being a tag means crates get
carry weight (half what went in, §5 of `FACTORY.md`), transfers, room stashes and theft for free. The row is
deleted once nothing references it.

**A crate is opened by consuming it**, from `/character` or the Things drawer,
wherever the crate happens to be — not from a button on `/depot`. It used to
have its own control on the Hold tab, which was the wrong place the moment a
crate walked off the landing pad in somebody's arms. `crateTagData` sets
`consumable: true`, and `consumeTagRequestImpl` takes a third road out to
`openCrateRequestImpl` — beside the two that already existed for a sealed
letter and the Instant Camera, and for the same reason: what falls out of a
crate is a list of runtime tag IDs, which no catalog slug in `consumesInto`
can name. The keycard gate (`canOpenCrate`) is re-checked in there.

**A crate can hold ⬢.** They ride the manifest as a line with no `tagId` and
land on the crate row as `consumesIntoResources` — the field the ordinary
consume path already grants — so the Resources half of a shipment needs no
special case at all past the packing.

**A crated ⬢ weighs a pound** (`RESOURCE_UNIT_LBS`). That is the whole reason
⬢ need no cap of their own: they pack against the same 150 lb rule as
everything else and ride in a crate alongside other goods, so 150 ⬢ fill one
crate and it weighs 75 lb. A **loose** ⬢ still weighs nothing and counts
against `carryResourceCap` instead (`CARRY.md` §1) — this is freight, and the
two axes never count the same ⬢ twice.

The manifest is printed on the crate, in exactly this format:

```
[SHIPMENT ID RV-4471-K]: Coal x 4 | Bandage x 6 | ML-23
```

Unless something in it ships sealed, in which case the whole crate reads:

```
[SHIPMENT ID RV-4471-K]: SEALED
```

...and only a Depot Keycard opens it. **One sealed line item seals the crate it
lands in**, so nobody knows *which* crate the dangerous thing is in — only that
one of them is worse news than the others.

**A non-stackable ware can only be ordered one at a time.** `CharacterTag` is
unique on character+tag, so a crate reading `ML-23 x 2` could only ever hand
over one pistol; the order is refused rather than silently clamped. Opening a
crate also records what actually landed, not what the crate claimed — a
non-stackable ware you already hold is reported as skipped rather than granted.

A ware ships sealed by setting `sealedShipping: true` in `docs/tags.yaml`. The
sync refuses it on a tag with no `depotPrice`, since the station cannot ship
what it does not stock. Currently sealed: the two firearms, the flamethrower,
Light Infantry Armour, Soporific, Phrygian Tears, the Amoeba Vial, the
Homunculus.

## 0f. The turret

The first automated harm mechanic in Bascinet. Nothing else in this codebase
rolls damage — injuries have always been GM-adjudicated (`HARM_CHARACTER`) or a
narrative Gambit outcome — so there was no armour model to extend. What it
borrows instead is the *shape* of `db/lib/cavingLoot.js`: a weighted draw whose
columns must sum to 1.

**There are two turrets now.** This one, and the gun on the rotor in the
Gatehouse yard (`db/lib/gatehouseTurret.js`, §0g below). They share everything
except where they stand, what turns them on and who they spare, so the sweep,
the arrival roll and what a bullet does to a sheet live once in
`db/lib/turretPass.js`. The ballistics — the severity ladder, the armour curve,
the weighted draw — stay in `db/lib/depotTurret.js`, which is the file
both of them roll against.

**It reads faces, not papers.** The turret spares exactly one thing: a
character whose **presented** name matches `Depot.merchantFace`. Not the
licence, not the keycard, not the role. So:

- A concealed Merchant is shot by his own gun.
- A Docker who steals the card is still shot.
- Anyone who comes back wearing the Merchant's name walks past it.
- With no face on file it fires on **everyone**, so **arming it is refused
  until there is one**. That was a one-click suicide with a GM-only cure:
  disarming needs you standing in the Depot, and walking in rolls the gun on
  you first.

**The face is written when the Merchant is created.** Creating a character on
the `merchant` role calls `setMerchantFace` with that character's own name
(`web/app/(app)/character/createActions.js`, in the best-effort side-effect
block; the writer is in `db/lib/depotState.js`). It used to be a GM-only field,
which meant a new Merchant met a gun he was forbidden to arm and had to go and
ask somebody to type his name into a form. There is no field for it on
`/gm/dev` any more either — the face is the Merchant's, written at creation,
and nothing else sets it.

It is set **once and never resynced**, because a face does not change when the
papers do. Two consequences worth knowing, both deliberate:

- Concealing himself later still gets the Merchant shot — he presents an alias,
  which is not the face on file. That is the trap working, not a bug.
- A **dead Merchant's face stays on file.** The gun goes on sparing a name
  nobody is wearing until the next Merchant is created, which overwrites it, or
  a GM edits it. Nothing clears it on death.

It fires **on entry** (`db/lib/locationMove.js`, before the Discord guard —
being shot is a database fact) and **again at the end of every turn**
(`db/lib/depotPass.js`), the way Caving rolls do. It only fires when the
generator is running.

**Being shot is very bad.** This is what a burst does to somebody wearing
nothing — the shipped table, `DEFAULT_TURRET_TABLE` in `db/lib/depotTurret.js`:

| graze | minor | deep | grievous | dying | dead |
|---|---|---|---|---|---|
| 6% | 14% | 16% | 24% | 22% | 18% |

Two fifths dying or dead, two fifths badly hurt, one fifth walking. Standing in
front of an armed machinegun in shirtsleeves is not meant to be a coin flip on
being fine, and until this table it was — the old bare column gave a 35% chance
of a graze or a minor wound.

**Armour bends that curve; it does not replace it.** Every piece of gear carries
`Tag.ballisticArmor`, 0.0–1.0, and only while `equipped`. Worn pieces combine
multiplicatively on what gets *through*, capped at 0.95, and the combined figure
raises the roll to a power:

```
protection = min(0.95, 1 - Π(1 - ballisticArmor))
h          = random() ^ (1 + ARMOR_GAIN * protection)   // ARMOR_GAIN = 3
```

`h` then walks the table above. At zero protection the exponent is 1, so the
draw *is* the table. The exponent is deliberate rather than a subtraction or a
scale: both of those reach a point where death becomes literally impossible, and
"there exists a jacket that makes a machinegun safe" is a worse rule than any
number could fix.

| kit | protection | graze | minor | deep | grievous | dying | dead |
|---|---|---|---|---|---|---|---|
| nothing | 0.00 | 6% | 14% | 16% | 24% | 22% | 18% |
| a Censor's Helmet | 0.35 | 25% | 20% | 15% | 17% | 13% | 9% |
| plate and a helm | 0.51 | 33% | 20% | 14% | 15% | 11% | 8% |
| Light Infantry Armour | 0.80 | 44% | 19% | 12% | 12% | 8% | 6% |
| shield and armour both | 0.95 | 48% | 18% | 11% | 11% | 7% | 5% |

The best kit in the game still buries about one wearer in twenty.

This replaced a hardcoded list of seven body-armour slugs, which knew about
plate and mail and knew nothing about a single helmet, shield, buckler, pavise
or the spacesuit — so a character in a closed steel helm rolled bare. A number
on the tag cannot fall behind the catalog the way that list did the moment
somebody added a helmet. See §TAGS.md for the two columns and the word scale
players actually see.

Light Infantry Armour carrying the highest ballistic value in the game is the
catalog's own claim about it — "nothing forged in Ravenheart stops a bullet".
The turret is where that line finally means something mechanical, and it is why
nothing forged sits above 0.3 ballistic.

A GM retunes the unarmoured table from `/gm/dev?s=depot`. **The save is
refused** if it does not sum to 1 — a broken die is a typo, not a preference,
and silently normalising it would hide the mistake behind subtly wrong odds for
a month. A table that somehow reaches the database invalid (a hand-edited row, a
restored backup) is ignored at roll time in favour of the shipped one. Note that
tuning here moves *every* outcome at once, armoured included; a single piece of
gear is retuned on its own tag.

**The gun makes a noise, and it is heard past the room.**
`db/lib/turretBurst.js` posts `RRATATAT!` full-size into the Location the gun
stands in, and the same word as `-#` subtext into every other Location channel
in that zone. It fires on **every** burst, grazes included — a gun that only
made noise when it drew blood would be one nobody could learn to avoid — and
**once per burst, never once per victim**: the turn-end sweep shoots everyone
standing there in one go, and five identical lines for five people would read as
five guns. An empty room makes no noise at all.

**The DM names the wound.** The gun's own flavour line comes first, then the
plain fact on its own line: *"It does not check who you are first."* is the
right thing for a machinegun to say and tells a player nothing about whether
they are walking away or bleeding out, which they then had to open the web app
to discover (`turretDmFor` in `db/lib/turretPass.js`). A graze still sends no
DM — the channel burst already says the gun fired.

A `dead` result goes through `db/lib/characterDeath.js#applyDeathToRow`, so it
gets a corpse, an archive line and the Discord role owed back like any other
death.

## 0g. The other turret, in the Gatehouse

The triple-barrelled gun on the rotor in the fortress yard, which the Baron's
charter has described as "off" since before anything could switch it on.
`db/lib/gatehouseTurret.js`.

It is this turret's opposite in the one way that matters: **it spares nobody.**
No face, no keycard, no rank. Armed, it fires on whoever is standing in the
Gatehouse — the Cerberon, the Baron, the person who armed it. Armour still picks
a column, which is the point of the Cerberon's mail: the gun is survivable if
you are dressed for it, and not otherwise.

It carries no tunable table and no Dev Panel section. `rollTurret(tags, source)`
reads only `source.turretTable`, so passing `null` gets the shipped table for
free — that is the whole reason a second gun needed no new config.

Its entire state is `GameConfig.gatehouseTurretArmed`, off by default.

**The switch is a physical thing in a room.** A red *Toggle Turret* button on
the Censor's Office starter post (`db/lib/roomStarterRow.js`), answered by
`handleTurretOpen` / `handleTurretSubmit` in the bot. It is the only red button
in the game, on purpose. Two guards, and neither is a permission check:

- You have to be **standing in the Censor's Office**, re-checked at *submit*,
  never at open — an ephemeral modal outlives somebody walking out of the
  Garrison. Reaching the wall is the safeguard.
- You have to **type `ARM` or `DISARM`** into the modal. Discord has no confirm
  dialog and a misclick on a red button should not be able to shoot the Keep.
  Case and stray spaces are forgiven; it is a speed bump, not a password. The
  state is re-read at submit, so two people in the office at once cannot both
  flip it the same way.

Flipping it speaks one `-#` line into the Gatehouse through
`db/lib/ambientLine.js` — the machine spinning up is the only warning anybody in
the yard gets — and writes one `gatehouse_turret_toggled` audit row naming the
character who pressed it.

It fires on the same two triggers as the Merchant's: on entry
(`db/lib/locationMove.js`, which now asks both guns; each checks the destination
slug first and costs one indexed read to say no) and at the end of every turn,
as its own `gatehouseTurret` pass. Separate from `depot` in `TURN_PASSES` so a
failed Depot pass cannot swallow it and a resume re-runs only the one that did
not finish.

## 0g. The bank

The Merchant is the only faucet of currency in the game.

- **The ATM** moves obols between `Depot.accountObols` and physical `obol`
  tags. It is the only door coins enter and leave the world through, which is
  what makes lending something only he can do.
- **The Company's line** (`Depot.debtObols`, capped at `creditCapObols`, 75)
  is drawn and repaid in obols. Drawing puts money in the account. The cap is
  **refused** rather than clamped, so he is told he hit the ceiling. Nothing in
  code punishes a standing balance — the Company is not code.
**There is no ⬢ counter any more.** There was one, briefly: a marginless till
that turned his Resources into obols and back, one for one. It made ⬢ and
obols the same thing wearing two hats, and it meant importing food was free
money. ⬢ are a **ware on the shuttle** instead (§3, §4) — the only place they
change form, and never for nothing.

**There are two pots, and they are not the same money.** The station's account
is `Depot.accountObols`; the Merchant's purse is physical `obol` tags on his
sheet. Spending one never touches the other, and the ATM is the only door
between them — which is the point, because the licence is tradeable and handing
it over hands over the account but not his pockets.

The **station opens with 20 ¢**, and the only place that number lives is the
`accountObols` default in `db/prisma/schema.prisma`. Restart Game deletes the
Depot row and recreates it bare, so a new game picks the default up on its own
and nothing has to remember to seed it.

**Purses** are granted through `docs/roles.yaml` using a `Name xN` suffix
(`Obol x25`), parsed by `db/lib/startingTags.js`. Baron 25, Merchant 20, Hand
10, Esculap 10, Baroness / Heir / Meister 5 each, Arbiter 4, Censor 2,
Cerberus 1 — 87 ¢ across ten roles.

His float is deliberately thin, and thinner than the rest of the cast's scaled
with it: the Company's line, 75 ¢, is nearly four times the station's opening
balance, and it is where most of his first order has to come from. It has to be
paid back.

**Debtor** is a separate faucet, off the drawback catalog rather than
`docs/roles.yaml`: taking the tag grants 20 obols in the creation transaction
(`DEBTOR_STARTING_OBOLS`, `db/lib/wantedPoster.js`), and the character owes
40 back. That debt is only ever paper — three notices go up ("DEBTOR:
{name}. Owes: 40 obols. Send the dockers."), a loose sheet each in the
Merchant's Office and the Storefront, and one pinned to the Depot
noticeboard. It shares the Wanted poster machinery (`NOTICE_SPECS.DEBTOR`),
just with different rooms and no zone name, since the debt is the debt
wherever the debtor is standing. Nothing collects it automatically — the
notices are a standing invitation to a GM or another player, not a clock.

## 0h. The console

`/depot`. A cockpit strip that never scrolls away — greeting, balance,
generator gauge, shuttle state, turret lamp — over six tabs: **Order**,
**Price List**, **Hold**, **Bank**, **Station**, **Ledger**.

The **Bank** is the ATM and Credit, and nothing else. The **Hold** is the
landing pad, and nothing else. Both used to carry a paragraph of explanation
under every header and a tooltip on every button; all of it is gone. A control
whose name does not say what it does is the bug, not the missing tooltip.

There is no ⬢/¢ toggle any more, and no need for one: an obol is one ⬢, so
every price column reads the same number in either unit. Prices print in ¢
throughout, whole, with no decimals anywhere — the row figure, the cart total,
the Hold payout, the account and the credit line are all the same kind of
number now.

The strip is pinned because all four of those facts matter whichever job you
are doing; hiding the generator behind a tab is how you order three hundred
obols of coal onto a dead one.

The **Ledger** reads existing `Request` rows of the eight `DEPOT_*` types
rather than a ledger table of its own — those rows already snapshot what moved,
already appear on the GM desk, and already undo.

`DEPOT_CRATE_OPEN` is still the ledger kind, but the row is filed from
`/character` now that opening a crate is a Consume (§0e). The Ledger reads it
the same way.

`DEPOT_SHIP` and `DEPOT_CRATE_OPEN` have **no undo handler**, deliberately.
A shuttle that went up cannot be recalled and its cargo no longer exists; an
opened crate has scattered its contents into an inventory that has moved on.
The rows stay visible and a GM corrects by hand.

## 1. What it is

A shuttle parked at the Depot, in the Caves, tethered to an orbital station the
Merchant's sponsors own. It is the only route in or out of Ravenheart for
anything manufactured, and it is not a public shop: **only the Merchant trades
with it.** He buys imports into his own inventory at the station's price, then
sells them on to Ravenheart at whatever he can get.

Stock is infinite. Price is the only limiter, and it is meant to be
prohibitive — a working person saves for a Boombox and never sees a pistol.

| | |
|---|---|
| Page | `/depot` (`web/app/(app)/depot/page.js`) |
| Location | `depot` — the merchant's berth at the cave mouth, one plain hop east of `customs`. The gate used to be the whole Caverns zone, which meant trading from anywhere underground. The Depot was then split off as a Location of its own with **no edge to Customs**, so a migrant who cleared customs could not walk to the shop; the two were merged to fix that, and are two again now that the edge is authored. `db/lib/depot.js#DEPOT_LOCATION_SLUG` names it. Reading the list works anywhere; trading needs him standing there. |
| Gate | the `merchants-license` tag, **not** the Merchant role |
| Requests | `DEPOT_BUY`, `DEPOT_SELL`, `DEPOT_CREDIT` — auto-applied, GM-reviewed, undoable |
| Constants | `db/lib/depot.js` |

## 2. The Licence

`merchants-license` is the whole permission model. Holding it opens `/depot`,
puts the Depot on the nav rail, and is re-checked inside every server action.
The Merchant starts with it.

It is `tradeable: true` on purpose. Handing it over really does hand over the
Depot — and, per its own text, the escape route and the turret's goodwill. That
is a decision worth being able to make, and it is why the gate is the tag and
never the role: a role check would quietly break the trade.

There is no GM half to this page. A GM with no licensed character is redirected
like anyone else; `/gm/dev` already does everything they would want here. The
one exception is a **superadmin**: they get the page read-only — the live
price lists, no held counts, no credit line, every control disabled — and the
Depot rail item so they can reach it. Every trade action still re-checks the
licence server-side, so the view grants nothing.

## 3. Buying

What the station charges him, per unit. Almost every ware is
`purchasable: false` — **for those, the Merchant is the only source in the
game**, which is the whole point of the seat.

**⬢ themselves are a ware, at 2 ⬢ each in and 1 ⬢ each out.** They are the
one line on either table that is not a tag — `RESOURCE_WARE_ID` stands in for a
catalog row that does not exist, and `depotOrderImpl` splits it out before
anything reaches a `Tag` lookup. The 2:1 spread is doing real work. It means
importing food is a losing trade, which is the whole reason it exists: the
Merchant should be shipping things Ravenheart cannot make, not undercutting its
farmers with cheaper grain. And because the buy price is strictly above the
sell price, no amount of round-tripping prints an obol — the same invariant
`db/lib/syncTags.js` enforces for every priced tag, just held by hand here
since there is no row to check.

**Paper undercuts everything, and the station sells it by the ream.** A
`stack-of-paper` is 3 ⬢ and consumes into twenty sheets, so writing costs a
scribe almost nothing — which it has to, or nobody writes and the whole of
`PAPERWORK.md` is a menu people look at once. Loose `paper` is no longer on the
shelf: a weightless 1 ⬢ line was a thing every order padded itself out with,
and the ream is the same paper at a fifth the price. It is also the only ware
with no sell-back price at all: a resale market in blank paper is not a thing
anybody needs.

**Sell-back is 60% of the buy price**, rounded, with a floor of 1 ⬢. It used to
be ~44%, and the counter was a bad place to stand: the spread ate so much of a
resale that stocking goods to trade on was barely a living, and the Merchant's
own seat is supposed to be a trade. Import prices came down ~18% in the same
pass, so buying in is cheaper and selling on actually pays. The station still
takes 40%, which is margin enough that round-tripping a rifle for its own sake
is a slow way to lose money.

Six wares carry a **wage floor** instead: `alcohol`, `distilled-coca`,
`trapping-gear`, `phrygian-tears`, `gladiator-helmet` and
`workshop-equipment`. Each is craftable or brewable, so its `sellablePrice` is
what a *maker* earns under §4's bands, not what a reseller gets back. 60% is a
raise for most of them and would have been a pay cut for `alcohol` (4) and
`distilled-coca` (10), so those two keep the higher number. The rule is that
the wage never goes down.

That rule bites on a rebalance, not just on the original pricing. The
2026-09-11 pass set the Simple rung by wage, and `trapping-gear` sits on that
rung — which would have cut it from its 16 ⬢ floor. It carries **24**
instead, its rung's wage paid on its own dearer materials. Re-price a rung and check this list before shipping.

The `fishing-rod` used to be the seventh, and it is the one place the floor
was wrong: at `turnsCost: 0` the Dead Simple ration mints the margin as a
FREE action, so 60% of its 12 ⬢ import price (7, against 3 ⬢ of materials)
was +16 ⬢ a turn on top of an untouched labor day. It sells at the Dead
Simple convention (cost + the rung's flat markup, so 5 since 2026-09-11)
instead — the floor never applies to a 0-turn recipe.

Six are also creation picks, marked in the Notes column: `jewelry` (2 pt),
`instant-camera` (2), `sword-cane` (7), `surgical-equipment` (9),
`poison-snooper` (9) and `neoclassic-rw10` (14). All six are
`purchasableAfterStart: false`, so there is still no mid-game second source —
you bought one on day one or you buy one off him. The Poison Snooper is the
deliberate addition of the six: knowing which cup is poisoned, over and over,
is worth three-quarters of a starting budget, and its ⬢ price stays steep so
buying one mid-game is still a real decision.

| Ware | ⬢ | Sells back | Notes |
|---|---|---|---|
| `coffee` | 2 | 1 | Consumes into `caffeinated` (2t) |
| `tea` | 2 | 1 | +15 mood (`MOOD.md` §5), the same as Maggot Milk |
| `art-supplies` | 3 | 2 | What a `painting` spends — the Artist's one running cost |
| `stack-of-paper` | 3 | — | **The cheapest paper on the shelf**, deliberately. A ream: consumes into twenty blank sheets, and writing on one mints the letter (`PAPERWORK.md`). Sells back for nothing, so buying and reselling is pure loss. Loose `paper` is not stocked. |
| `firecracker` | 3 | 2 | |
| `honey` | 4 | 2 | Consumes into `ate-meal` |
| `sky-lantern` | 4 | 2 | |
| `sweets` | 4 | 2 | Consumes into `ate-meal` |
| `alcohol` | 5 | 4 | He stocks the local brew too |
| `rat-mask` | 5 | 3 | Force conceal (`PROXYING.md` §5). Not craftable — the Merchant is the only source. Cut from 12 ⬢: at that price it was competing with real gear, and a paper-thin disguise is not real gear. |
| `cigarette` | 5 | 3 | A Mudghara import, and the pricier vice — it costs more than a `tea` or a `coffee`. |
| `coal` | 7 | 4 | The generator's own fuel (§2) — missing from this table until 2026-09-09, though it has always had this `depotPrice`. |
| `silver` | 8 | 5 | What `silver-knife`/`silver-spear` spend (`SMITHING.md`). Prospecting's to source cheaper (`LABORDROPS.md` §2b); this is the fallback. |
| `boombox` | 11 | 7 | |
| `distilled-coca` | 11 | 10 | Also a Skilled brew, at 4 ⬢ — see §4 |
| `sake` | 11 | 7 | Consumes into `tipsy`. Under `ravenheart-red`'s 14 — its only price, since it has no `depotPrice` of its own |
| `whip` | 11 | 7 | Equippable |
| `censer` | 12 | 7 | |
| `jewelry` | 13 | 8 | Also a 2-pt creation pick |
| `steel` | 13 | 8 | Craftable (`smithing`, spends `coal` — `SMITHING.md`) — the fourth exception to "almost nothing here is craftable," below. |
| `mining-helmet` | 14 | 9 | Caving loot he also imports. A Simple Helm's plates plus a lamp, so it prices level with one — the lamp is station work, not forge work |
| `black-body-bag` | 22 | 13 | |
| `monkey` | 22 | 13 | |
| `poison-snooper` | 22 | 13 | **The exception:** also buyable at creation, 9 pt |
| `sword-cane` | 23 | 14 | Also a 7-pt creation pick |
| `instant-camera` | 26 | 16 | Also a 2-pt creation pick |
| `microscope` | 29 | 17 | |
| `surgical-equipment` | 31 | 19 | Also a 9-pt creation pick |
| `light-infantry-armour` | 34 | 20 | Stops a bullet. Nothing forged here does. |
| `phrygian-tears` | 36 | 22 | Also a Skilled brew, at 4 ⬢ — see §4 |
| `hound` | 38 | 23 | |
| `soporific` | 45 | 27 | Inflicts `asleep` (1t) |
| `amoeba-vial` | 52 | 31 | |
| `bb-pistol` | 61 | 37 | Equippable |
| `silencer` | 74 | 44 | Equippable. The Merchant starts holding one |
| `homunculus` | 75 | 45 | |
| `antibiotics` | 82 | 49 | Cures every stage of infection |
| `horse` | 90 | 54 | **The dearest thing that is not a weapon or armour.** Also a 9-pt creation pick, and `purchasableAfterStart: false` — so mid-game the Merchant is the only horse in Ravenheart |
| `silver-sword` | 123 | 74 | |
| `chainsaw` | 126 | 76 | Cuts two Godflesh per Extract, and farms at +2 ⬢ — `FACTORY.md` |
| `neoclassic-rw10` | 134 | 80 | Neoclassic R&W10. Also a 14-pt creation pick. |
| `energy-shield` | 145 | 87 | **The dearest thing on the shelf that is not a gun.** Stops bullets outright and softens a melee blow — the best odds against the Fortress turret in the game, though a minor wound is still very possible. Caving loot he also imports, and GM-granted until now. |
| `ml-23` | 149 | 89 | A 9mm pistol |
| `motorcycle` | 171 | 103 | Caving loot he also imports |
| `adamantium-sword` | 189 | 113 | |
| `flamethrower` | 194 | 116 | Caving loot he also imports |
| `ctt43-rifle` | 213 | 128 | A .308 semi-automatic |
| `kpfw-6-avtomat` | 443 | 266 | The dearest thing on the counter |

Three of these need code, not just catalog data:

- **`horse`** and **`motorcycle`** are `FAST_TRAVEL_SLUGS`
  (`db/lib/mounts.js`), so each buys the same extra zone crossing every turn
  while equipped. "Not through the caves" is **adjudicated, not enforced** —
  as the horse's own catalog text already says. Worth knowing, since he buys
  the thing standing in the Caves.
- **`coffee`** consumes into `caffeinated`, a status tag that exists only for
  it. **`soporific`** does *not* consume into `asleep`, and that is on purpose:
  you administer it to somebody else, so a self-targeting grant would put the
  drinker to sleep instead of the victim. It is spent by a Move and a GM
  applies `asleep` to whoever it happened to — the same "empty **Consumes
  into**" convention `BREWING.md` documents for a thrown flask or a poison.
  Nothing else in the catalog grants `asleep`.

The rest of the caving loot table stays found-only. The Motorcycle and the
Flamethrower are the only two artifacts the station will sell, on the reasoning
that it has no trouble getting either — it is Ravenheart that has trouble
hauling one up out of the Caves.

**Almost nothing here is `craftable`.** That is the point: if Ravenheart could
make it, importing it would be pointless. The three exceptions are all brews —
`alcohol`, `distilled-coca` and `phrygian-tears` — which he stocks for a
Merchant who would rather not wait on a brewer. Each is priced well above what
brewing one costs, and that gap is the market a brewer sells into (§4).

**`steel` (2026-09-09, repriced 2026-09-10) is the fourth**, and the first that isn't a brew — a
smith with no Prospector bringing up ore can buy the ingot outright instead
of smelting it himself. Same reasoning as the three brews: priced above what
the `smithing` recipe itself costs (`SMITHING.md`), so the Merchant is a
faster source, not a cheaper one. `silver` is not craftable at all, so it
never faced this question — it is simply stocked, the same as `coal`.

### Laboring tools

Two of the tools in `LABORING.md` §5 are Merchant stock rather than smith work:
`fishing-rod` at 12 and `trapping-gear` at 26. Both are craftable too, so the
depot price is the impatience premium, not a monopoly. The Plow is deliberately
**not** stocked — it is smith work, and the horse it needs is the real cost.

## 4. Selling

What the station pays him, per unit. This is the other half of the loop —
players make things, he buys them for whatever he can talk them down to, and
the difference between that and the column below is his margin. Nothing in code
sets what he pays a player; that is his negotiation.

**⬢ sell back at 1 ¢ each**, off the pad's stash rather than off anybody's
sheet — put them in the landing pad and send the shuttle up. This is the only
way Resources become money, and it costs half their face value, since the
station charges 2 ⬢ for the same ⬢ coming down (§3).

Four bands, about 106 tags in total:

| Band | Priced at | Examples |
|---|---|---|
| Brews | build cost + margin; the batch recipes get a thinner one | `ravenheart-red` 14, `forgiveness` 18, `bliss` 3, `dreamers-draught` **60** |
| Smithed gear | its own `resourceCost` + a turn-scaled markup — see below | Dead Simple 4, Simple 9 (its four 1/3-turn pieces 7), Moderate 21, High Quality 42, Exceptional 61, Gunpowder 59 (Bore Pistol 45) |
| Cave and bulk goods | unchanged from the Caves Update | `graga-sac` 8, `cave-fungus` 3, `saltpeter` 3, `skinless-brain` **25** |
| Factory goods | a day's output at ~3× a good farming day | `squeeze` 5 a cube — 8 cubes is a shift (`FACTORY.md` §6). Buy-only in the other direction: the station sells nobody a cube |
| Salvage and valuables | what portable wealth is worth | `jewelry` 8, `heirloom` 12, `old-coin` 1, `painting` **41** |
| Body parts | low, on purpose | `eye` 8, `heart` 8, `hand` 5, `foot` 4, `stomach` 4, `tongue` 3 |

**The station buys body parts now** (`CORPSES.md`, `TORTURE.md` §6). It is a ⬢
faucet hanging off a free action — Mutilate costs nothing and every death mints
a body — so the number that matters is the whole LADDER, not one part:
`db/lib/mutilate.js` takes nine pieces off one subject, which at these prices is
**49 ⬢ a body**, against 30–42 ⬢ for a specialised day's labour. Price the
ladder, never the piece; the first pass priced the piece and a corpse came to
94 ⬢. The eye and the heart are dearer than the rest because the rites eat those
two (`THANATI.md` §9), so a cultist and the Merchant now want the same organs.

**The Thanati's own shelf is not this depot** (`THANATI.md` §3). It is a code
list, `THANATI_WARES`, with one price per ware, spent out of the hideout room's
floor and the buyer's pockets — ⬢ and obols together, since an obol is one ⬢.
No `depotPrice` on any of it, and nothing there ever reaches the station.

**Three numbers moved in the Butchering change** (`CORPSES.md`), and they are
off the bands above on purpose. `skinless-brain` went 10 → 40 then **40 → 25**
when the Godard Factory opened: the 10 read the Skinless as a slightly harder
Graga, which they are not — they are the only ingredient in the catalog that has
to be talked out of being a person first — but at 40 a single organ stood level
with a whole day of industry, and read as a shortcut past it. 25 keeps it well
clear of a Graga Sac without competing with a wagon.
`dreamers-draught` went 16 → **60**, staying
above its own ingredient, because the point of that recipe is that the brain is
the cheap part. `painting` went 60 → 48, a flat 20% nerf, and then 48 →
**41**, a further 15%; over its 4 turns that is ~10 ⬢/turn, still the best
rate a craftable pays.

**`human-flesh` is deliberately not sellable at all.** Butchering is free and
every death mints a corpse, so a price on it would be a code-enforced ⬢ faucet
hanging off a free action. It stays `tradeable`, so the market for it is other
players.

**Smithed gear's markup is `resourceCost + round(rate(skill) × turnsCost^1.3)`, per item —
not a flat multiplier of the tier.** A flat "+1/3 of the tier" markup used to make
Exceptional (3 turns, `smithing-skilled`) pay out *worse* per turn than Moderate or High
Quality (1–2 turns, the same skill gate), and made Dead Simple's turn-free 4-a-turn cap
look like a strictly better business than ever touching the higher rungs. Two things now
have to be paid for on purpose, not by accident: the skill it took to unlock the tier, and
the turns sunk into one item once you're there.

`rate(skill)` scales with the cumulative point cost of the skill chain a tier is gated
behind:

| Skill gate | Cumulative pt | Rate | Why |
|---|---|---|---|
| `crafting` / `smithing` | 5 | 2 ⬢/turn | Dead Simple and Simple both sit here. Crafting's own price fell to 2 on 2026-09-10, but the rate is left at the 5-pt `smithing` reading — the two gate the same Dead Simple rung and it should not pay two different wages |
| `smithing-skilled` | 10 | 5 ⬢/turn | Moderate, High Quality, Exceptional |
| `smithing-gunpowder` | 19 | 9 ⬢/turn | Gunpowder — nearly double the skill investment, so nearly double the rate |

The `turnsCost^1.3` exponent is what makes rate-per-turn climb *inside* a skill bracket
too, not just jump between brackets — a deliberate, mild superlinear curve so tying up
more turns in one item is rewarded a little more than proportionally, not just
proportionally. The formula's raw rates read 2 → 5 → 6 → 7 → 11 ⬢/turn, and the shipped
prices now sit well above it. Two passes put them there and neither re-derived the
formula: the ~15% materials rebalance cut every rung's `resourceCost`, and then on
2026-09-11 **every sell price on the ladder was lifted and the curve deliberately
flattened** — a smith could not make a living against a Merchant who sets his own buy
price (§4), and the bottom of the ladder paid worst of all. What still has to hold is
the SHAPE: never falling. The shipped per-turn profits are now

| rung | ⅓-turn | Simple | Moderate | High Quality | Gunpowder |
|---|---|---|---|---|---|
| ⬢/turn | 9 | 10 | 16 | 18 | 22.5 |

with Dead Simple's 12 sitting outside the curve for the reason below.

**Flatter is the point, and it is a reversal.** The ladder used to run 3 → 7 → 8 → 15,
a nearly five-fold spread from the bottom rung to the top, which meant the first two
rungs were somewhere you passed through rather than somewhere anybody worked. It now
runs 9 → 22.5, two and a half fold. The top was left where it was and everything under
it brought up: the low rungs a little, the middle a good deal more.

**Set these by the WAGE, not by a multiplier on the price.** A quarter off a 9 ⬢ sword
is most of its 3 ⬢ profit; a quarter off a 59 ⬢ musketoon is half again of its 30. The
margin is a small difference of two larger numbers, so a percentage on the price lands
as a wildly uneven percentage on the wage — the 2026-09-11 pass started as a flat 25%
and had to have two rungs hand-corrected before it even shipped. Pick the ⬢/turn you
want, multiply by the turns, add the `resourceCost`. Then read the table above and check
nothing overtook the rung above it. (Moderate was 8 for a while, exactly tying High
Quality — the flat-wage bug — and dropped a point on 2026-09-07 to restore the climb.)
1.3 is a judgment
call, not a derived constant: high enough to feel like a real reward for committing
turns, low enough that Exceptional doesn't dwarf Moderate the way a steeper exponent
would. Re-tune it here first if a tier ever needs adjusting, rather than hand-editing
one item's `sellablePrice`.

**Dead Simple is the one exception, kept outside the formula on purpose.** It costs 0
turns, so `rate × 0^1.3` would price it at raw material cost with no margin at all.
Instead it keeps a flat token markup — **+3 ⬢** since the 2026-09-11 pass, up from +1 —
and its rationing stays the 4-unit/turn cap (`SMITHING.md` §2) rather than a turn cost.
It was never meant to compete turn-for-turn with the ladder above it, so it does not have
to clear the same per-turn bar.

**It cannot be tuned finely, and it is the number here worth watching.** The 4-unit
ration means one ⬢ on the price is four on the wage, so the smallest change available at
this rung is ±4 ⬢/turn — which is why it reads 12 now, above the two rungs over it, with
no intermediate setting to reach for. And it costs no turn, so it stacks on top of an
untouched labor day: exactly the shape that made the `fishing-rod`'s 60% floor a problem
further up this section. If any part of this pass wants revisiting, it is this one.

The Dead Simple rung spans two skills — `crafting` gates the cloth and wood half,
`smithing` the metal — and **both halves take the same markup**, which is the same
reasoning the rate table above gives for leaving `crafting`'s rate at the `smithing`
reading. A padded cap and a work knife are one rung and pay one wage.

The four 1/3-turn Simple pieces (Spear, Dagger, Silver Knife, Phrygian Spear —
`SMITHING.md` §2) get the same treatment for the same reason: `2 × (1/3)^1.3` rounds to
0, so they carry a flat markup instead and sell at **9**. Three a turn is 9 ⬢/turn,
against the rung's full-turn 10 — quick work is paid about the rung's rate, never a
better one. Integer prices are why it is 9 and not exactly 10; round the quick pieces
DOWN when they will not land clean, never up, or the rung above them is overtaken.

A further 5% came off the Gunpowder tier on 2026-09-10 (31→29, 20→19), again without
re-deriving `sellablePrice`, which widens that margin once more on purpose.

Two items break from their tier's baseline `resourceCost` and price accordingly: Bore
Pistol (19 ⬢ to make, cheaper than Musketoon/Bomb's 29) still prices under them, at 56
against 74 — same relative gap as the tier. A materials-cost rebalance dropped the Gunpowder tier's
`resourceCost` ~15% (37→31, 23→20) without re-deriving `sellablePrice` off the formula,
so both sit a little above what a fresh `resourceCost + rate × turnsCost^1.3` run would
give today — a slightly wider margin for the smith, on purpose, not drift.

`ravenheart-red` is the top of the ordinary brews on purpose. It costs 4 ⬢ and
needs no ingredient at all, so a Skilled brewer with nothing else going on can
make 10 ⬢ a turn off it — and it is the one thing on this planet an offworlder
actually wants. The tag's own description has called it "Ravenheart's only
export" since long before any of this was wired up.

**Two brews are on both tables.** `phrygian-tears` and `distilled-coca` cost 4 ⬢
to brew and 40 and 12 to import. That is not an error and it is not a loophole:
the import price is what you pay for having no brewer, and the gap is exactly
the market a brewer sells into.

A buy price at or below a sell price would let anyone with a licence print ⬢ in
a loop. `db/lib/syncTags.js` warns on every sync if that ever inverts.

### The open hole in this, and it is a real one

That warning guards the *Depot's own* two prices. It does not guard the other
loop, which runs through crafting:

> **Nothing in code charges a recipe.** `BREWING.md` says so outright — not the
> ⬢, not the turns, not the skill, least of all the ingredient. `ADD_TAG` takes
> `resourcesSpent` **from the client**, and there is no per-turn cap on filing
> one.

So a Merchant who also takes Brewing (Skilled) can file `ADD_TAG` for
`ravenheart-red` declaring 0 ⬢ spent, sell it here for a code-enforced 14 ⬢,
and repeat — unbounded within a single turn. 71 craftable tags are sellable,
topping out at 49 ⬢ for the Gunpowder rung.

Until the Merchant Update the sell side was inert data, so an uncharged recipe
only ever produced a *tag* a GM could look at. Pricing the output in code is
what turned it into a faucet. The only thing standing in front of it today is
a GM reading the `ADD_TAG` queue, which is the same backstop crafting has
always had — but it is now guarding money rather than goods.

Two ways to close it, neither taken yet: charge the recipe's ⬢ in code inside
`addTagRequestImpl`, or cap `DEPOT_SELL` per turn. The first is the real fix
and the larger change.

## 5. The credit line

**Superseded by §0g.** The line is now denominated in obols and lives on
`Depot.debtObols`, capped by `Depot.creditCapObols`. `Character.depotDebt` was
dropped in the rework — the licence is tradeable, so the debt travels with the
station rather than with whoever is holding the card.

Everything else about it is unchanged: draw puts money in the account, repay
takes it back out, the cap is refused rather than clamped, and nothing in code
punishes a standing balance. It is visible to GMs, and that is the enforcement.

## 6. Retail

Selling to a player is **not** on this page. It is the existing `TRANSFER_TAG`
and `TRANSFER_RESOURCES` pair on `/character`, which requires both parties in
the same zone (`FACTIONS.md` §3b).

That friction is the design. He sits at the Depot at the bottom of the Caves, so
either the buyer comes down to him or a Docker carries the goods up — which is
the entire reason the Docker seat exists. If it ever proves too much in play,
the fix is a courier request, not loosening reach.

## 7. Where a player reads this

The **Merchant** document (`docs/documents.yaml`, key `merchant`) carries the
price bands and how the counter works, and goes to the Merchant and his Dockers.
The role charter in `docs/roles.yaml` carries the pitch. What a ware *does*
lives in the tag's own description and shows on hover, the same way a brew's
effect does — don't restate it in the document, it is already two places.
