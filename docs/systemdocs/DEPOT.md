# The Depot

The station at the bottom of the caves: a counter anybody may walk up to, a
railway that brings goods down every other turn, a bank the whole town keeps its
money in, and a turret in the ceiling. This file is the source of truth for all
of it.

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
`web/app/(app)/depot/actions.js` and `db/lib/depotCounter.js` — never taken from
the client — and a GM does not adjudicate a purchase. The price is then
snapshotted onto the `DepotOrder` or `DepotSale` row, so re-tuning a number here
never changes what an older trade says it was worth.

## 0. The system

- **The money is obols (¢), and one obol is one ⬢.** Nothing converts and
  nothing rounds. **The catalog still prices in ⬢** — `depotPrice` and
  `sellablePrice` are what a thing is *worth*, and that has to keep meaning the
  same number whether the Merchant is buying it or a player is haggling over
  it — so every authored price is already a whole number of obols too. An
  obol makes value **portable**: a weightless stackable tag holding the same
  amount as a sack of ⬢, but one a fortune of which still fits in a pocket.
  ⬢ are a tag too, and a one-pound one (`TAGS.md`), so the difference
  between the two currencies is weight, and where the money is good. ⬢ are raw
  material anybody will take anywhere; an obol is paper the station honours.
- **Everybody has an account, and most of them are claims on the Keep.** A
  `BankAccount` is fingerprinted to one character. A TREASURY account — nearly
  everyone's — is backed by real `obol` tags in the Vault under the Keep, and a
  withdrawal the Vault cannot cover is refused. An OFFSHORE account, the
  Merchant's and his Dockers', is money the Company holds off-world and has no
  vault behind it at all.
- **Goods arrive physically, on a train nobody calls.** An order is paid for now
  and delivered at the next arrival, as crates in the Railyard, stamped with the
  buyer's name unless they paid to keep it off.
- **Selling is a box, not a negotiation.** Drop a thing in the box on the
  counter and it is gone; the money lands when the train next leaves, minus the
  Meister's cut.
- **The room can kill you.** A turret, off by default, that reads faces. It
  fires on **arrival**, so walking *through* the Depot on the way somewhere else
  is an arrival like any other — a multi-hop walk across the zone (`MAP.md` §3c)
  is the single-hop move repeated, and the gun does not care that you were only
  passing. A walk the turret kills stops there rather than delivering a body to
  the destination.

### What this replaced, and why none of it comes back

The Depot used to be one man's console. `/depot` opened for the Merchant's
Licence and bounced everybody else; goods came down on a shuttle he called by
hand; the money was `Depot.accountObols`, a single float; taxation was a button
on a Leader's sheet. Four things went, and each for its own reason:

- **The shuttle.** It was a button, so goods sat paid-for and undelivered until
  the Merchant woke up. One turn is one real day, so "he will do it later" was a
  day of nothing moving. A train on a fixed cycle cannot be forgotten.
- **The generator.** Fuel ran out and took ordering, the bank, the shuttle and
  the gun down with it. That was survivable when the Depot was a shop. It is a
  market now, and one person's empty tank should not be able to close it.
- **The station's float.** It was a second pot to explain, sitting beside the
  Merchant's own purse with the ATM between them. His OFFSHORE account is that
  pot now, and there is one kind of account in the game rather than two.
- **The tax button.** It filed a levy per person per turn, DM'd each target, and
  could be refused or part-paid. The sell tax is quieter and far harder to
  dodge: a percentage off every sale at the counter, before anybody is paid.

## 0a. The moving parts

| Piece | Where it lives | Notes |
|---|---|---|
| Station state and tuning | `Depot` singleton, `id = 1` | `db/lib/depotState.js` — every mover is a locked clamp, per `lifeweb.js#bumpBlood` |
| Accounts and the Vault | `db/lib/bankAccounts.js` | `BankAccount`, `bumpBankAccount`, the hard backing |
| The counter's three fixtures | `db/lib/depotCounter.js` | The ATM, the drop box and the gun — shared by both faces |
| The manifests | `db/lib/depotManifests.js` | Which shelf a ware is on, and what opens it |
| The train | `db/lib/train.js` + the two passes | `trainArrivalPass.js`, `trainDeparturePass.js` |
| The turret | `db/lib/depotTurret.js` | Weighted severity table, bent by the target's `Tag.ballisticArmor` |
| Crates | `db/lib/depotCrates.js` | Runtime `Tag` rows with `custom: true` |
| Per-turn upkeep | `db/lib/depotPass.js` | The turret sweep, and nothing else any more |
| The counter | `web/app/(app)/depot/`, `web/app/components/Depot*.js` | Status strip + six tabs |
| The Meister's terminal | `web/app/(app)/treasury/` | Every account, the backing, the tax rate |
| GM tuning | `/gm/dev?s=depot` | `updateDepot` in `web/app/(app)/gm/dev/actions.js` |

## 0b. Who may do what

**`/depot` opens for everyone, always.** It is a shop window: read-only unless
you are standing in the Depot, and the page says so. Nothing redirects anybody
any more.

What your tags decide is the **shelf**, and one seat's paperwork:

| Holder | Can |
|---|---|
| **Anyone, standing there** | Order off the general manifest, use the ATM at the counter, put things in the drop box beside it, open an account. |
| **Silver Chip** | …plus the black market: drink, smoke and worse. |
| **Depot Keycard** | Enter the Railyard, where the crates land. Open one, sealed or not. Sell into the Merchant's account rather than their own. Spends nothing of its own. |
| **Merchant's Licence** | …plus the whole manifest, sealed goods included, the Company's credit line, the gun on the office wall, and the sight of everybody's staged selling. |
| **Meister's Terminal** | `/treasury`: every account, the Vault's backing, and the sell tax rate. |

The licence is checked, never the Merchant **role** — the licence is tradeable
and a role check would quietly break that. The keycard and the terminal are
checked the same way and for the same reason.

**The split is between a shelf and a job.** A keycard does the work — the
Railyard, the crates, selling into his books — and buys nothing extra and
spends nothing. The licence is the business.

The gates live in `web/app/(app)/depot/actions.js` and `db/lib/depotCounter.js`:
`requireDepotStanding` does the standing and the ACT check, `counterActor` is
its twin for the fixtures, and `requireLicensedMerchant` / `requireAccount` sit
on top.

## 0c. The Railyard, and the train

The Railyard is a **real room** — a thread under the Depot channel, authored in
`docs/zones.yaml` as `depot-railyard`, behind the keycard. It replaced the
Landing Pad. Its starter message says whether the train is at the platform —
`live: train` in `docs/zones.yaml`, rendered by `db/lib/roomLive.js` and
repainted by `refreshLiveRooms` every close.

**The train runs on turn parity and nothing else.** The parity is about what
happens at a turn's CLOSE, not about where the train is standing while the turn
is open: closing an even turn rolls it in and unloads, closing an odd turn loads
it and pulls it out (`db/lib/train.js`). So turn 1 is a departure close with an
empty drop box and nothing to load, and turn 2's close is the first arrival —
which brings down whatever was ordered on turn 1, exactly as Bascinet asked,
with no first-turn special case in either pass.

**Where the train IS is a different question, and `trainHere()` is the one that
answers it.** It lands at the close of an even turn and leaves at the close of
the odd turn after, so it stands at the platform for the length of an odd turn —
turn 1 excepted, since nothing has arrived yet. Reading presence off
`isArrivalTurn()` instead tells everybody the train is in on the one turn it
demonstrably is not; `db/test/train.test.js` pins that.

The cycle:

1. **Order** off a manifest. Obols leave your account now; the goods do not
   exist yet. That gap is the risk of buying.
2. **It arrives.** Every undelivered `DepotOrder` becomes crates in the
   Railyard, one stack of crates per order.
3. **It leaves.** Every unsettled `DepotSale` settles at the price frozen when
   it was dropped, the Meister's cut goes to the Vault as coin, and the net
   credits whichever account the row named.

**Parity decides which half RUNS; rows decide what MOVES.** Each pass opens with
a parity check and then works entirely off `deliveredAt: null` / `settledAt:
null`, claiming each row with a conditional `updateMany` before touching it. A
doubled or resumed turn advance therefore costs a turn of flavour and never a
shipment. `db/test/train.test.js` holds the parity half of that.

## 0d. Crates

A shipment does not arrive as a tidy pile of tags. It arrives packed, in
crates, and somebody has to open them. That makes unloading a job worth paying
a Docker for, puts a delay between buying a pistol and holding one, and means a
crate left in the Railyard can be stolen.

**A crate is packed by weight.** It fills to `PACKAGE_MAX_LBS` — 150 lb of
contents — and then a new one opens. That is the same constant the player-facing
Package button enforces (`FACTORY.md` §5), so a Depot shipment and a
hand-packed crate agree on the ceiling as well as on the halving. What comes out
is a box with a volume rather than a counter: 99 tea in one crate, an anvil most
of the way through another.

Units are mixed before they are packed, so a crate holds a random handful
rather than one tidy line item. `MAX_CRATES` (12) caps the count, past which a
huge order simply means fuller crates rather than a Railyard buried in tag rows.

There is a second cap, on **count** rather than weight: `PACKAGE_MAX_UNITS`
(200). The weight cap does not bound the weightless, and seven Depot wares
weigh 0 lb — `cigarette`, `jewelry`, `spectacles` and the four animals — so
without it a weightless order packs into one crate however large it is.

**A crate is a `Tag` row created at runtime** with `custom: true`, so
`db:prune-tags` skips it (`db/lib/pruneTags.js`). Being a tag means crates get
carry weight (half what went in, §5 of `FACTORY.md`), transfers, room stashes
and theft for free. The row is deleted once nothing references it.

**A crate is opened by consuming it**, from `/character` or the Things drawer,
wherever the crate happens to be — not from a button on `/depot`, since a crate
can walk out of the Railyard in somebody's arms. `crateTagData` sets
`consumable: true`, and `consumeTagRequestImpl` takes a third road out to
`openCrateRequestImpl` — beside the two that already existed for a sealed letter
and the Instant Camera, and for the same reason: what falls out of a crate is a
list of runtime tag IDs, which no catalog slug in `consumesInto` can name. The
keycard gate (`canOpenCrate`) is re-checked in there.

**A crate can hold ⬢.** They ride the order as a line with no `tagId` and land
on the crate row as `consumesIntoResources` — the field the ordinary consume
path already grants — so the Resources half of a shipment needs no special case
at all past the packing.

**A crated ⬢ weighs a pound** (`RESOURCE_UNIT_LBS`), so ⬢ pack against the
same 150 lb rule as everything else: 150 ⬢ fill one crate and it weighs 75 lb.

**A crate says whose it is.** The manifest is printed on the side with the
buyer's stamp in front of it:

```
[SHIPMENT ID RV-4471-K] · ADA VOSS · AV-2017: Coal x 4 | Bandage x 6 | ML-23
```

Ordering **anonymously** is a tick at the counter, and replaces the stamp with
`ANONYMOUS`. Only the `DepotOrder` row then remembers whose it was.

Unless something in it ships sealed, in which case the whole crate reads:

```
[SHIPMENT ID RV-4471-K] · ADA VOSS · AV-2017: SEALED
```

...and only a Depot Keycard opens it. **One sealed line item seals the crate it
lands in**, so nobody knows *which* crate the dangerous thing is in. The seal
hides *what* is in the box; whose box it is stays printed, because those are two
different secrets.

**A non-stackable ware can only be ordered one at a time.** `CharacterTag` is
unique on character+tag, so a crate reading `ML-23 x 2` could only ever hand
over one pistol; the order is refused rather than silently clamped. Opening a
crate never loses a non-stackable ware you already hold: the spare is set down
in a public room of your Location, where Transfer can pick it up, and the notice
says so. With no public room there, the crate refuses to open.

A ware ships sealed by setting `sealedShipping: true` in `docs/tags.yaml`. The
sync refuses it on a tag with no `depotPrice`, since the station cannot ship
what it does not stock. Currently sealed: the two firearms, the flamethrower,
Light Infantry Armour, Soporific, Phrygian Tears, the Amoeba Vial, the
Homunculus.

## 0e. The manifests

A manifest is a **shelf**, and the thing that opens it. It is the answer to
"what may THIS person order", which used to have one answer because there was
one buyer.

| Manifest | Opened by | Holds |
|---|---|---|
| `general` | nothing — anyone standing at the counter | ⬢ and Ration Boxes |
| `black-market` | **Silver Chip** | the drink and drug shelf |
| `merchant` | **Merchant's Licence** | everything priced, sealed goods included |

The catalog is `db/lib/depotManifests.js` — zero requires, like `dmKinds.js`,
because the Buying tab is a client component. A ware names its shelf with
`manifest:` in `docs/tags.yaml`; **absent means `merchant`**, which is the
strictest default on purpose: a newly priced ware is his to stock until the
catalog says wider. `db/lib/syncTags.js` refuses a manifest id that is not in
the catalog, and refuses one on a ware with no `depotPrice` — a shelf with
nothing on it says nothing and reads as a rule.

Adding a manifest is one entry in that file plus a `manifest:` line per ware.
Nothing else has to change.

**The Silver Chip** (`silver-chip`) is a metallic poker chip, weightless,
tradeable, and does nothing whatsoever except open that shelf. Not craftable:
a forge that could mint them would mint the market open for everybody.

## 0f. The drop box, and the sell tax

Selling used to be the Merchant sending a shuttle up with whatever was standing
on the pad, paid into the station's float. It is a box on the Storefront counter
now.

**On the Storefront and not in the Railyard**, and that is load-bearing: the
Railyard is behind a Depot Keycard, so a box in there would be a box only
Dockers could reach — and selling is the half of this counter that had to open
to everybody. The crates stay in the Railyard; the box is where a customer would
look for it.

- **What goes in is deleted at once.** That is what makes it a one-way door:
  nothing sits in a stash waiting to be stolen back out, and the seller has
  committed. What is left is a `DepotSale` row.
- **The price is frozen at the drop**, so re-tuning `docs/tags.yaml` between the
  drop and the departure cannot restate what was sold.
- **It is fingerprinted.** The row carries the account, the fingerprint and the
  holder's name as a snapshot.
- **The destination is per-row**, one of SELF / TREASURY / MERCHANT, and can be
  re-pointed from the Selling tab until the train takes it. MERCHANT needs the
  Licence or a Depot Keycard — that is the Docker's seat: selling into his books
  instead of their own. It is their default; everyone else's is SELF.
- **A licence sees everybody's staged selling.** Settled rows stay each seller's
  own business.

**The sell tax** is `Depot.sellTaxRate`, whole percent, set from the Meister's
terminal (§0h). It comes off every settled sale before the seller is paid and
lands in the Vault **as coin** — so the Keep's stash grows by exactly what the
sellers were docked, which is what keeps the backing honest while the rate is
above zero.

## 0g. The bank

**An account is a claim, and a TREASURY claim is hard-backed.**

- `BankAccount.balanceObols` is the claim. `Depot.accountObols` is gone.
- The **Vault** is `undercroft-vault`, a real room behind the Baron's key,
  seeded with **350 obols** in `docs/zones.yaml`. Every TREASURY account draws
  on that pile and nothing else.
- **The ATM** moves obols between an account and physical `obol` tags. For a
  TREASURY account the coin comes physically out of the Vault, and a withdrawal
  the Vault cannot cover is **refused, never clamped** — a clamp would hand
  somebody less than they asked for and say nothing.
- An **OFFSHORE** account skips all of that. There is no pile behind it.
- **The Company's line** (`Depot.debtObols`, capped at `creditCapObols`, 75) is
  drawn and repaid in obols, and credits the Merchant's own account. The cap is
  **refused** rather than clamped. Nothing in code punishes a standing balance —
  the Company is not code.

**The Vault can be robbed, and that is the point.** It is a room with a stash in
it. Emptying it does not zero anybody's balance; it makes every balance
unwithdrawable, which is a far more interesting thing to do to a town.

**An account opens EMPTY.** A starting purse is physical obols from
`docs/roles.yaml`, because a seeded balance on day one would be a claim with
nothing behind it — exactly what the backing exists to prevent. Purses are
granted with a `Name xN` suffix (`Obol x25`), parsed by `db/lib/startingTags.js`.

**Who gets one at creation** is `bank_account:` in `docs/roles.yaml`:
`treasury` for nearly every seat, `offshore` for the Merchant and his Dockers,
and **absent for the Black Hills** — the Tribunal and the Brigands arrive
without one. Anyone else (a spawned antagonist, a threat handed a body
mid-game) opens one at the counter with a **Create an account** button: one
click, no cost, opens empty.

**THE ORDERING RULE, and it is the only one: room lock first, then the
account.** `db/lib/tagWrites.js#dropRoomTag` takes the room lock first, so a
deposit and a withdrawal that took them the other way round would deadlock.

**Debtor** is a separate faucet, off the drawback catalog rather than
`docs/roles.yaml`: taking the tag grants 20 obols in the creation transaction
(`DEBTOR_STARTING_OBOLS`, `db/lib/wantedPoster.js`), and the character owes
40 back. That debt is only ever paper — three notices go up ("DEBTOR:
{name}. Owes: 40 obols. Send the dockers."), a loose sheet each in the
Merchant's Office and the Storefront, and one pinned to the Depot
noticeboard. Nothing collects it automatically.

## 0h. The Meister's terminal

`/treasury`, gated on the **Meister's Terminal** tag the way `/lifeweb` is gated
on Mortus. A superadmin reads it (host access, not game permission) but does not
get the dial; `web/app/(app)/treasury/actions.js` re-checks the tag.

It shows every account — fingerprint, holder, role, class, balance — the Vault's
coin against the sum of the TREASURY claims, and what is staged to sell. The one
control is the **sell tax rate**, 0–100%, written to `Depot.sellTaxRate` with an
audit row.

The number worth reading first is the **backing**. Under the line, somebody is
going to walk up to the ATM and be told no through no fault of their own. Set
the rate too high and people stop selling; set it too low and the Vault drains
and the town's money stops working.

## 0i. The turret

The first automated harm mechanic in Bascinet. Nothing else in this codebase
rolls damage — injuries have always been GM-adjudicated (`HARM_CHARACTER`) or a
narrative Gambit outcome — so there was no armour model to extend. What it
borrows instead is the *shape* of `db/lib/cavingLoot.js`: a weighted draw whose
columns must sum to 1.

**The switch is a physical thing in a room now.** A red *Toggle Turret* button
on the Merchant's Office starter post (`db/lib/placeAffordances.js`), which is
what that room's description — "a desk, filing cabinets, and a big red button" —
has promised since before anything could press one. It works exactly like the
Censor's, and for the same reasons: you have to be standing in the office,
re-checked at *submit* rather than at open, and you have to type `ARM` or
`DISARM`. Discord has no confirm dialog and a misclick on a red button should
not be able to shoot the shop. The state is re-read at submit, so two people in
the office at once cannot both flip it the same way. It also wants the Licence,
which the Censor's does not: the gun is the business's, not the room's.

It used to be a control on `/depot`'s Station tab. A switch that kills people
should be a thing you walk to.

**There are two turrets.** This one, and the gun on the rotor in the Gatehouse
yard (`db/lib/gatehouseTurret.js`, §0j below). They share everything except
where they stand, what turns them on and who they spare, so the sweep, the
arrival roll and what a bullet does to a sheet live once in
`db/lib/turretPass.js`. The ballistics — the severity ladder, the armour curve,
the weighted draw — stay in `db/lib/depotTurret.js`.

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
block; the writer is in `db/lib/depotState.js`). There is no field for it on
`/gm/dev` — the face is the Merchant's, written at creation.

It is set **once and never resynced**, because a face does not change when the
papers do. Two consequences worth knowing, both deliberate:

- Concealing himself later still gets the Merchant shot — he presents an alias,
  which is not the face on file. That is the trap working, not a bug.
- A **dead Merchant's face stays on file.** The gun goes on sparing a name
  nobody is wearing until the next Merchant is created, which overwrites it, or
  a GM edits it. Nothing clears it on death.

It fires **on entry** (`db/lib/locationMove.js`, before the Discord guard —
being shot is a database fact) and **again at the end of every turn**
(`db/lib/depotPass.js`), the way Caving rolls do. **Armed is now the only
condition**: there is no generator left for it to depend on.

**Being shot is very bad.** This is what a burst does to somebody wearing
nothing — the shipped table, `DEFAULT_TURRET_TABLE` in `db/lib/depotTurret.js`:

| graze | minor | deep | grievous | dying | dead |
|---|---|---|---|---|---|
| 6% | 14% | 16% | 24% | 22% | 18% |

Two fifths dying or dead, two fifths badly hurt, one fifth walking. Standing in
front of an armed machinegun in shirtsleeves is not meant to be a coin flip on
being fine.

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
| a Censor's Helmet | 0.31 | 23% | 20% | 15% | 18% | 13% | 10% |
| plate and a helm | 0.45 | 30% | 20% | 14% | 16% | 11% | 8% |
| Heavy Infantry Armor | 0.70 | 40% | 19% | 12% | 13% | 9% | 6% |
| a full infantry kit | 0.90 | 47% | 18% | 11% | 11% | 8% | 5% |
| shield and armour both | 0.95 | 48% | 18% | 11% | 11% | 7% | 5% |

The best kit in the game still buries about one wearer in twenty.

Armour is read off `Tag.ballisticArmor` directly, so it can never fall behind
the catalog. See `TAGS.md` for the two columns and the word scale players
actually see.

No single piece forged in Ravenheart reaches Overkill on its own any more —
that takes a full kit, or the Tribunal's own Cataphract. The catalog's claim
about the place holds: "nothing forged in Ravenheart stops a bullet".
The turret is where that line finally means something mechanical, and it is why
nothing forged sits above 0.3 ballistic.

**The table is not tunable, from the Dev Panel or anywhere else.**
`turretTable()` in `db/lib/depotTurret.js` returns `DEFAULT_TURRET_TABLE` and
ignores its argument, so both guns roll the shipped odds and always have. The
Dev Panel used to carry a JSON editor for it and the code a column comment
saying one existed; neither was true. Retuning means editing that constant.
A single piece of gear is still retuned on its own tag, which is the knob that
does work.

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

## 0j. The other turret, in the Gatehouse

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

Its entire state is `GameConfig.gatehouseTurretArmed`, off by default. Its
switch is the same shape as the Merchant's: a red button on the Censor's Office
starter post, a typed word, re-checked at submit. Flipping it speaks one `-#`
line into the Gatehouse through `db/lib/ambientLine.js` and writes one
`gatehouse_turret_toggled` audit row naming the character who pressed it.

It fires on the same two triggers as the Merchant's: on entry
(`db/lib/locationMove.js`, which asks both guns; each checks the destination
slug first and costs one indexed read to say no) and at the end of every turn,
as its own `gatehouseTurret` pass. Separate from `depot` in `TURN_PASSES` so a
failed Depot pass cannot swallow it and a resume re-runs only the one that did
not finish.

## 0k. The counter

`/depot`. A status strip that never scrolls away — greeting, your balance, and
where the train is — over six tabs: **ATMs**, **Selling**, **Buying**,
**Manifests**, **Price list**, **Ledger**.

The strip is down to two things because those are the two facts that decide
whether anything you are about to do works, whichever tab you are on.

| Tab | What it is |
|---|---|
| **ATMs** | Your account, its class, the Vault's coin if it backs you, Withdraw / Deposit, the credit line if you hold the licence, and your own transactions. **Create an account** if you have none. |
| **Selling** | Your staged and settled sales, a destination dropdown per staged row, a **Default destination** that seeds the next drop, the drop box itself, and — with a licence — everybody's staged selling. |
| **Buying** | One section per manifest your tags open, a cart, an **Order anonymously** tick, and when the crates land. |
| **Manifests** | What each shelf holds and what opens it, the shut ones included. |
| **Price list** | The reference book: anything priced in either direction. |
| **Ledger** | Your own `DEPOT_*` audit rows. |

No paragraph of explanation, no tooltips: a control whose name does not say what
it does is the bug, not the missing tooltip.

There is no ⬢/¢ toggle and no need for one: an obol is one ⬢, so every price
column reads the same number in either unit. Prices print in ¢ throughout,
whole, with no decimals anywhere.

**The ATM, the drop box and the gun are not on this page.** They are fixtures on
walls — `db/lib/placeAffordances.js` — so each is a button on a Room's starter
post on Discord and a dialog in Chat's place panel on the web, and `/depot`
carries the tab you compare numbers on. The rules behind all three live once in
`db/lib/depotCounter.js` so both faces answer the same way; the Discord half is
deliberately thinner, because it is for the moment you are standing at the
machine with your phone out.

## 1. What it is

A railway terminus in the Caves, tethered to an orbital station the Merchant's
sponsors own. It is the only route in or out of Ravenheart for anything
manufactured, and since the rework it is **a public market**: anybody standing
there trades with it, off whatever shelf their tags open. The Merchant's seat is
still the best one — the whole manifest, the credit line, the gun — but it is a
seat at a counter other people also use.

Stock is infinite. Price is the only limiter, and it is meant to be
prohibitive — a working person saves for a Boombox and never sees a pistol.

| | |
|---|---|
| Page | `/depot` (`web/app/(app)/depot/page.js`) — open to everyone, read-only unless you are standing there |
| Location | `depot` — the berth at the cave mouth, one plain hop east of `customs`, with its own edge to Customs. `db/lib/depot.js#DEPOT_LOCATION_SLUG` names it. Reading works anywhere; trading needs you standing there. |
| Rooms | `depot-storefront` (the ATM and the drop box), `depot-railyard` (the train and the crates, behind a keycard), `depot-merchants-office` (the gun), `depot-cargo-bay` |
| Gates | the manifests (§0e), plus `depot-keycard` for the Railyard and `meisters-terminal` for `/treasury` |
| Audit kinds | `request_depot_order`, `request_depot_drop`, `request_depot_atm`, `request_depot_credit`, `request_depot_account_open`, `request_depot_crate_open`, `depot_turret_toggled`, `sell_tax_rate_set`, `train_ran` |
| Constants | `db/lib/depot.js`, `db/lib/train.js`, `db/lib/depotManifests.js` |

## 2. The Licence

`merchants-license` is no longer the door to the page — nothing is. What it is
now is the **widest shelf** plus the business: the whole manifest including
sealed goods, the Company's credit line, the gun on the office wall, and the
sight of everybody's staged selling. It is re-checked inside every server action
that depends on it. The Merchant starts with it.

It is `tradeable: true` on purpose. Handing it over really does hand over the
business — and, per its own text, the turret's goodwill. That is a decision
worth being able to make, and it is why the gate is the tag and never the role:
a role check would quietly break the trade.

There is no GM half to this page, and it needs none: `/depot` opens for a GM the
same way it opens for a player, and `/gm/dev` already does everything a GM would
want beyond that. A superadmin reads `/treasury` without the Meister's Terminal
— host access rather than game permission, the way `/lifeweb` works — but does
not get the tax dial.

## 3. Buying

What the station charges, per unit. Almost every ware is `purchasable: false` —
not buyable at character creation — and almost every ware sits on the
**merchant** manifest, so for those the Licence really is the only way to get
one made offworld. That is the point of the seat; what changed is that ⬢ and
Ration Boxes are on the general shelf, and the drink and drug shelf is one chip
away (§0e).

**⬢ themselves are a ware, at 2 ⬢ each in and 1 ⬢ each out.** They are the
one line on either table the order path handles by hand — `RESOURCE_WARE_ID` is
the `resources` tag's own slug rather than a cuid, so it can never collide with
a real ware's id, and `depotOrderImpl` splits it out before anything reaches a
`Tag` lookup. It is on the general manifest, so anybody may order it. The 2:1 spread is doing real work. It means
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

**Sell-back is 60% of the buy price**, rounded, with a floor of 1 ⬢. The
station still takes 40%, which is margin enough that round-tripping a rifle
for its own sake is a slow way to lose money.

Six wares carry a **wage floor** instead: `alcohol`, `distilled-coca`,
`trapping-gear`, `phrygian-tears`, `gladiator-helmet` and
`workshop-equipment`. Each is craftable or brewable, so its `sellablePrice` is
what a *maker* earns under §4's bands, not what a reseller gets back. 60% is a
raise for most of them and would have been a pay cut for `alcohol` (4) and
`distilled-coca` (10), so those two keep the higher number. The rule is that
the wage never goes down.

That rule bites on a rebalance, not just on the original pricing: re-price a
rung and check this list before shipping, since a wage floor can never drop.

**The floor never applies to a 0-turn recipe.** At `turnsCost: 0` the Dead
Simple ration mints margin as a FREE action, so `fishing-rod` sells at the
Dead Simple convention (cost + the rung's flat markup, currently 5) instead of
60% of its import price.

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
| `rat-mask` | 5 | 3 | Force conceal (`PROXYING.md` §5). Not craftable — the Merchant is the only source, and it is priced below real gear on purpose: a paper-thin disguise shouldn't compete with it. |
| `cigarette` | 5 | 3 | A Mudghara import, and the pricier vice — it costs more than a `tea` or a `coffee`. |
| `coal` | 7 | 4 | Smelts into `steel` (`SMITHING.md`). It used to be the generator's fuel; there is no generator. |
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
| `energy-shield` | 145 | 87 | **The dearest thing on the shelf that is not a gun.** Stops bullets outright and softens a melee blow — the best odds against the Fortress turret in the game, though a minor wound is still very possible. Caving loot he also imports. |
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

**`steel` is the fourth**, and the first that isn't a brew — a
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

**⬢ sell back at 1 ¢ each**, through the drop box like any other ware. This is
the only way Resources become money, and it costs half their face value, since
the station charges 2 ⬢ for the same ⬢ coming down (§3). Anybody may do it
now, which is the point: a labourer with a cart of material and no buyer has a
counter to walk it to.

Four bands, about 106 tags in total:

| Band | Priced at | Examples |
|---|---|---|
| Brews | build cost + margin; the batch recipes get a thinner one | `ravenheart-red` 14, `forgiveness` 18, `bliss` 3, `dreamers-draught` **60** |
| Smithed gear | its own `resourceCost` + a turn-scaled markup — see below | Dead Simple 4, Simple 9 (its four 0.25-turn pieces 8), Moderate 21, High Quality 42, Exceptional 61, Gunpowder 59 (Bore Pistol 45) |
| Cave and bulk goods | unchanged from the Caves Update | `graga-sac` 8, `cave-fungus` 3, `saltpeter` 3, `skinless-brain` **25** |
| Factory goods | a day's output at ~3× a good farming day | `squeeze` 7 a cube — 8 cubes is a shift (`FACTORY.md` §6). Buy-only in the other direction: the station sells nobody a cube |
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

**Three prices sit off the bands above on purpose.** `skinless-brain` is 25 —
clear of a Graga Sac's 8, without standing level with a whole day of industry
(it is the only ingredient in the catalog that has to be talked out of being a
person first). `dreamers-draught` is 60, above its own ingredient, because the
point of that recipe is that the brain is the cheap part. `painting` is 41 —
over its 4 turns that is ~10 ⬢/turn, still the best rate a craftable pays.

**`human-flesh` is deliberately not sellable at all.** Butchering is free and
every death mints a corpse, so a price on it would be a code-enforced ⬢ faucet
hanging off a free action. It stays `tradeable`, so the market for it is other
players.

**Smithed gear's markup is `resourceCost + round(rate(skill) × turnsCost^1.3)`, per item —
not a flat multiplier of the tier.** A flat "+1/3 of the tier" markup makes
Exceptional (3 turns, `smithing-skilled`) pay out *worse* per turn than Moderate or High
Quality (1–2 turns, the same skill gate), and makes Dead Simple's turn-free 4-a-turn cap
look like a strictly better business than ever touching the higher rungs. Two things must
be paid for on purpose: the skill it took to unlock the tier, and
the turns sunk into one item once you're there.

`rate(skill)` scales with the cumulative point cost of the skill chain a tier is gated
behind:

| Skill gate | Cumulative pt | Rate | Why |
|---|---|---|---|
| `crafting` / `smithing` | 5 | 2 ⬢/turn | Dead Simple and Simple both sit here. Crafting and `smithing` gate the same Dead Simple rung, so both read the same 5-pt rate — it should not pay two different wages |
| `smithing-skilled` | 10 | 5 ⬢/turn | Moderate, High Quality, Exceptional |
| `smithing-gunpowder` | 19 | 9 ⬢/turn | Gunpowder — nearly double the skill investment, so nearly double the rate |

The `turnsCost^1.3` exponent makes rate-per-turn climb *inside* a skill bracket
too, not just jump between brackets — a deliberate, mild superlinear curve so tying up
more turns in one item is rewarded a little more than proportionally. The formula's raw
rates read 2 → 5 → 6 → 7 → 11 ⬢/turn; the shipped prices sit above it, a deliberately
wider smith's margin (see `SMITHING.md` §2 for `resourceCost`). What
must hold is the SHAPE: never falling. The shipped per-turn profits are

| rung | 0.25-turn | Simple | Moderate | High Quality | Gunpowder |
|---|---|---|---|---|---|
| ⬢/turn | 8 | 10 | 16 | 18 | 22.5 |

with Dead Simple's 4 sitting under the curve for the reason below. The curve is
deliberately flat — nearly two and a half fold bottom to top, not the five-fold spread a
naive multiplier gives — because a smith could not otherwise make a living against a
Merchant who sets his own buy price, and the low rungs paid worst of all.

**Set these by the WAGE, not by a multiplier on the price.** A quarter off a 9 ⬢ sword
is most of its 3 ⬢ profit; a quarter off a 59 ⬢ musketoon is half again of its 30. The
margin is a small difference of two larger numbers, so a percentage on the price lands
as a wildly uneven percentage on the wage. Pick the ⬢/turn you
want, multiply by the turns, add the `resourceCost`. Then read the table above and check
nothing overtook the rung above it. 1.3 is a judgment
call, not a derived constant: high enough to feel like a real reward for committing
turns, low enough that Exceptional doesn't dwarf Moderate the way a steeper exponent
would. Re-tune it here first if a tier ever needs adjusting, rather than hand-editing
one item's `sellablePrice`.

**Dead Simple is the one exception, kept outside the formula on purpose**, and it
changed in 9/2026. It used to cost **0** turns with a shared 4-unit/turn ration,
which meant four saleable things a day riding FREE on top of an untouched labour
day — fine while only the Merchant could sell, and an income on every sheet the
moment the counter opened to everybody. It costs **0.25 of a Move** now: the
same four a day, paid for out of the day.

A quarter and not a tenth because the Move budget is exact rational arithmetic
in quarters (`db/lib/tagShapes.js` refuses anything finer, and a cost the budget
cannot hold exactly is work somebody did not pay for).

Its flat markup came down with it, **+3 ⬢ to +1 ⬢**. Four a day at +1 is
4 ⬢/turn, comfortably under the Simple rung's quarter-pieces at 8. The bottom
rung pays least, which is the shape this whole section asks for.

The shared pool is **gone** and does not come back — `web/lib/tagRequests.js`
carries the note. A recipe's own `perTurn` ration still works; there is simply no
pool behind it.

**It is still the number worth watching, for a smaller reason now.** Four a day
means one ⬢ on the price is four on the wage, so the smallest change available at
this rung is ±4 ⬢/turn. What it no longer does is stack on top of an untouched
labour day — that was the whole problem, and the quarter-Move cost is the fix.

The Dead Simple rung spans two skills — `crafting` gates the cloth and wood half,
`smithing` the metal — and **both halves take the same markup**, for the same
reasoning the rate table above gives for pricing `crafting` at the `smithing`
rate. A padded cap and a work knife are one rung and pay one wage.

The four 0.25-turn Simple pieces (Spear, Dagger, Silver Knife, Phrygian Spear —
`SMITHING.md` §2) get the same treatment for the same reason: `2 × 0.25^1.3` is 0.33 and
rounds to 0, so they carry a flat markup instead and sell at **8**. Four a turn is
8 ⬢/turn, against the rung's full-turn 10 — quick work is paid about the rung's rate,
never a better one. They were thirds at 9 until costs became decimals in 9/2026, which
came to the same 9 ⬢/turn; the quarter buys a fourth unit, so the price came down to
keep the day's pay under the rung above. Round the quick pieces DOWN when they will not
land clean on an integer, never up, or the rung above them is overtaken.

Two items break from their tier's baseline `resourceCost` and price accordingly: Bore
Pistol (18 ⬢ to make, cheaper than Musketoon/Bomb's 28) still prices under them, at 56
against 74 — same relative gap as the tier.

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

### The two open holes in this — both closed

This used to be real. Before the Request table was dropped (2026-09-11,
`REQUESTS.md`), `ADD_TAG` trusted a client-supplied `resourcesSpent` with no
server-side charge and no per-turn cap, so a Merchant who also took Brewing
(Skilled) could file it for `ravenheart-red` declaring 0 ⬢ spent, sell the
brew here for a code-enforced 14 ⬢, and repeat — unbounded within a single
turn.

It closed as a side effect of that rework, not a dedicated fix aimed at this
page. `craftRequestImpl` (`web/app/(app)/character/requestActions.js`)
computes a recipe's cost from its own catalog `requirementResources` — never
from anything the client posts — and `resolveCraftPayer` refuses outright,
re-checked inside the transaction's lock rather than trusted from the
fast-fail read, if `cost > payer.balance`. There is no path left where a
craft is charged for less than the recipe says.

**The second hole opened the day the counter did, and it is the reason two
numbers moved.** Selling used to be the Merchant's alone, which meant
`sellablePrice` was a reference figure with no button behind it — so a free
4-a-turn craft ration was a convenience rather than an income. Once anybody
standing at the Depot can drop a thing in a box and be paid for it, the same
ration is 12 ⬢ a day, free, on every sheet in the game. Dead Simple costs a
quarter of a Move now and pays +1 rather than +3 (§4), which closes it.

**The third was the mint.** A smith could strike `obol` at Smithing (Skilled),
1 ⬢ in and 1 obol out, ten a turn, for no Move at all. At par that looks like no
margin — but an obol is weightless and a ⬢ is a pound, so it turned a cart of
raw material into something that fits in a pocket, free, forever. The recipe is
gone from `docs/tags.yaml` and does not come back. Coin enters the world through
the station and nowhere else, which is what makes a purse worth exactly as much
as your ability to reach a counter. Paying a recipe's cost *with* held obols
still works (`resolveObolSpend` in `requestActions.js`); that half was never the
problem.

## 5. The credit line

**Superseded by §0g.** The line is denominated in obols, lives on
`Depot.debtObols`, is capped by `Depot.creditCapObols`, and now credits the
Merchant's own account rather than a station float. `Character.depotDebt` was
dropped long ago — the licence is tradeable, so the debt travels with the
business rather than with whoever is holding the card.

Everything else is unchanged: draw puts money in the account, repay takes it
back out, the cap is refused rather than clamped, and nothing in code punishes a
standing balance. It is visible to GMs, and that is the enforcement.

## 6. Retail

Selling to another **player** is still not on this page. It is the existing
`TRANSFER_TAG` and `TRANSFER_RESOURCES` pair on `/character`, which requires
both parties in the same zone (`FACTIONS.md` §3b).

What changed is that selling to the **station** is no longer the Merchant's
alone: the drop box (§0f) takes anything from anybody. That does not make him
redundant, it moves what he sells — he is the only shelf with the good things on
it, and the trip down to the Caves is still a trip. The Docker seat is if
anything sharper for it: a keycard sells into his books rather than its own,
which is a job you can hire somebody for.

## 7. Where a player reads this

The **Merchant** document (`docs/documents.yaml`, key `merchant`) carries the
price bands and how the counter works, and goes to the Merchant and his Dockers.
The role charter in `docs/roles.yaml` carries the pitch. What a ware *does*
lives in the tag's own description and shows on hover, the same way a brew's
effect does — don't restate it in the document, it is already two places.

Since the counter opened to everybody, the parts that are no longer his alone —
that there is an account with your name on it, that the box in the Railyard buys
things, that the train runs every other day — belong in the **handbook**
(`docs/handbook.md`) rather than in a document only two people are handed.
