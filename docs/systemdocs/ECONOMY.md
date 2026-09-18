# The economy

The source of truth for the money in Ravenheart, the ledger that records it,
and `/gm/economy`, the desk that reads it.

## 1. There is one unit of account, wearing several coats

**One obol is one ⬢.** Nothing converts, nothing has an exchange rate, and the
whole panel depends on that being true. What differs is the *form* the value is
in, and forms are what `EconomyEntry.form` names:

| Form | Where it lives | What is special about it |
|---|---|---|
| `BALANCE` | `resources` tag stacks, on a character or a Room | Raw material. A pound a unit, so a fortune is freight. The common case |
| `COIN` | physical `obol` tags | Weightless, can be looted. Also what is actually in the Keep's Vault |
| `ACCOUNT` | `BankAccount.balanceObols` | A claim. Most are claims on the Vault's coin; the Merchant's is offshore |
| `DEBT` | `Depot.debtObols` | Negative money, capped at `creditCapObols` (75) |
| `MANIFEST` | undelivered `DepotOrder` + unsettled `DepotSale` | Paid for or sold, still on the rails. Real money, in transit |
| `GOODS` | any tag with `sellablePrice` or `depotPrice` | Valued at its catalog price. A tag with no price is not money |

**`BALANCE` stopped being abstract in 9/2026.** It named two Int columns,
`Character.resources` and `Room.resources` — a number on a sheet nobody could
pick your pocket for. ⬢ are a Tag now (`resources`, one pound, beside `obol` in
`docs/tags.yaml`), held in the same `CharacterTag` / `RoomTag` stacks as every
other item, and read and written only through `db/lib/resourceStack.js`. The
form kept its name because the distinction it draws — raw material against
coin — is still the distinction the panel needs; what changed is that both
sides of it are now objects.

So both money tags carry a price in the catalog and neither is priced by it:
`db/lib/pricedTags.js` flags them `isObol` / `isResources`, and
`recordTagMoney` books them at **par**, one unit one ⬢, as `COIN` and `BALANCE`
rather than `GOODS`. Resources have a `depotPrice` of 2 and a `sellablePrice`
of 1 so the Depot's counter can trade them like any ware (`DEPOT.md`); that
spread is the Merchant's margin, not the value of a ⬢. **A ware priced on both
sides must never be counted as goods AND as balance** —
`goodsValueInWorld()` excludes both slugs for exactly that reason.

**⬢ and ¢ stopped being interchangeable in 9/2026, without stopping being equal.**
One obol is still one ⬢ and nothing converts — but ⬢ are a *material* now, spent
on a recipe or a cure and nothing else, and ¢ are the money: every price, wage,
balance and tax. The panel still counts both, because both are value; what
changed is which glyph a surface prints. See `DEPOT.md` §0.

**Never sum an account and the coin behind it.** A claim and the pile it draws
on are two things, and the ATM is the door between them (`DEPOT.md` §0g). A
panel that adds a TREASURY balance to the Vault's stash is counting the same
money twice and telling a lie on its front page.

`Depot.accountObols` — the station's single float, which used to be the whole of
form `ACCOUNT` — is **gone**. The Merchant's own OFFSHORE `BankAccount` replaced
it, and `db/scripts/ops/open-bank-accounts.js` writes the one `OPENING` row that
closes `depot:account` out at zero so the retired end does not drift forever.

## 2. Accounts, and the two that make the books close

Every entry has two ends, and each is one of:

- `character:<id>` — a purse
- `room:<id>` — a stash, **and also a faction treasury and the Keep's Vault**.
  `Faction.siloRoomId`; the `Silo` model was deleted in 9/2026 and does not come
  back, and the Vault needs no model either — it is `undercroft-vault`, a room
  with coin in it
- `bank:<accountId>` — one player's claim. `bank:clearing` is its book
  counterparty: no live balance, exempt from reconcile, exactly like mint and
  burn. It exists so that a movement whose coin leg is already booked by the tag
  hook can book its claim leg without double-counting the same money
- `depot:debt`; `depot:account` is retired but still named by old rows
- `offworld:company` — the shuttle. The only door off-world
- `world:mint` and `world:burn`

Mint and burn are the only two things that change the money supply. That is
why they are named accounts rather than a null end: "where did 400 of it come
from" has to be answerable, and before this it was not.

## 3. The invariant

> For every account: the sum of its ledger legs equals its live balance.

This is the point of the whole system. `reconcile()` in
`web/lib/economyQuery.js` runs it, the Pulse section shows a badge, and the
Health section lists every account that drifts. **A drift is a finding, not a
bug in the ledger** — it means something moved money without saying so, and the
size of the drift is the size of the hole.

It covers three kinds now: characters and rooms over form `BALANCE`, and
**bank accounts over form `ACCOUNT`**. The bank half holds because every balance
move is one conditional `UPDATE` paired with exactly one `ACCOUNT` row inside
the same transaction (`db/lib/bankAccounts.js#bumpBankAccount`); `bank:clearing`
is skipped as a book account.

**The Vault's backing is a SEPARATE check and must never be folded into
reconcile.** Reconcile does not look at `COIN` at all, so a Health row claiming
it had checked the backing would be lying. The question it answers is different
anyway — not "do the books balance" but "is there enough coin in the Keep's
Vault to honour what the TREASURY accounts claim". Under that line the books are
perfectly balanced and somebody still walks up to the ATM and is told no.
`npm run db:audit-vault-backing` is the check; it exits 1 when the Vault is
short. See `DEPOT.md` §0g.

`db/test/economyLedger.test.js` asserts the invariant against the primitives
directly, including the two cases that are easy to get wrong: a transfer must
be one row rather than two, and the Spillway must record both the arrival and
the burn or the room reads as drifting when it is not.

## 4. The hooks

Everything that moves money goes through one of the four places below, or —
for the three decrements that cannot use them — through `recordSpentTagMoney`.
Each takes an optional trailing context; absent, the entry is recorded as
`UNATTRIBUTED`.

| Hook | File | Covers |
|---|---|---|
| `moveParty` | `db/lib/resourceTransfer.js` | every `BALANCE` move — over `db/lib/resourceStack.js`'s stack writes, not a column |
| `applyTransfer` | `db/lib/resourceTransfer.js` | a two-legged transfer, as ONE row |
| `bumpBankAccount` | `db/lib/bankAccounts.js` | `ACCOUNT` — one conditional `UPDATE` paired with exactly one row, which is what makes the bank reconcilable |
| `bumpDebt` | `db/lib/depotState.js` | `DEBT` |
| `addToStack` / `dropCharacterTag` / `addToRoomStack` / `dropRoomTag` | `db/lib/tagWrites.js` | `COIN` and `GOODS` |

The tag hooks are instrumented **inside** the functions rather than at their
call sites, because there are about 135 of those and threading a context
through every one would have been a diff nobody could review. They carry the
context on the existing options bag instead (`options.econ`), so an ordinary
call site is untouched.

**Three call sites spend a stack without going through `dropCharacterTag`** —
`riteEffects.js#spendFromHolder`, `thanatiActions.js#spendCharacterTag`, and
`cavingPass.js`'s musk lure — each a guarded conditional decrement, each for a
concurrency reason documented where it sits, because `dropCharacterTag` reads
then writes and that is the wrong shape for money. They skip the hook with it,
so they call **`recordSpentTagMoney`** right where they already call
`clampEquippedQuantity`: the same "you bypassed the primitive, so run this too"
bargain, one line further down. If you add a fourth such decrement, add both.

`db/lib/pricedTags.js` keeps a small TTL'd map of which tags carry a price, so
a tag write costs no extra query. An unpriced tag — a wound, a skill, a corpse
— records nothing at all.

### Two things that used to vanish

- **The Spillway.** `Room.destroysContents` silently dropped whatever was put
  into it. It now writes a `SPILLWAY` burn.
- **The overdraw clamp.** `addResources` floors at zero — raw SQL with a
  `GREATEST(0, ...)` once, `resourceStack.js`'s clamped write now — so a debit
  larger than a balance destroyed the shortfall. It writes a `CLAMP` burn for
  the difference.

Neither left any trace anywhere in the game before the ledger. Both are real
money destruction and both are now on the Sinks section.

## 5. Reasons

`EconomyEntry.reason` is a plain string, not an enum — the vocabulary grows and
a migration per new reason is a tax nobody would pay, the same call
`AuditLog.actionType` makes. The list is authored in **one** place,
`db/lib/economyReasons.js`, which like `dmKinds.js` has **zero requires, ever**:
it is reachable from a client component, and one require of `@lifeweb/db` there
drags PrismaClient into the browser bundle.

Each reason declares a `flow` — `FAUCET`, `SINK`, `TRANSFER` or `INTERNAL` —
and that is what the charts group on. `INTERNAL` is the one worth
understanding: an ATM withdrawal is the same money changing coat, so counting it as
trade would make a quiet turn at the Depot look like a boom.

**Five reasons arrived with the Depot rework** (`DEPOT.md`): `BANK_DEPOSIT`,
`BANK_WITHDRAWAL` and `BANK_OPEN` are `INTERNAL`, because a claim becoming a
coin is the same money changing coat — the call `DEPOT_ATM` already made.
`TRAIN_DELIVERY` and `SELL_TAX` are `TRANSFER`. Three are kept and unwritten:
`DEPOT_ATM`, `DEPOT_REFUEL` and `DEPOT_SALE`'s old shuttle shape all still name
themselves on rows written before the rework, and deleting a reason blanks those
rows on the panel.

**`UNATTRIBUTED` is a feature.** A write that reaches a hook with no context is
recorded under that reason rather than dropped, so an un-hooked call site shows
up on the panel as its own bar instead of quietly missing. `applyTransfer` used
to override it with `TRANSFER`, which made every unnamed transfer look
deliberate and kept the four biggest un-hooked sites off the very list that
exists to find them. It does not any more, and no hook should acquire a
friendlier default.

**Never quiet a noisy entry by filtering its reason out on the read side** —
that is exactly the pattern `dmKinds.js` was built to replace. Give the call
site its reason.

## 6. History, and the plug

The ledger starts the day it ships. `npm run db:backfill-economy` reconstructs
what it can from `AuditLog` — dry run by default, `-- --apply` to write, and
idempotent on a partial unique index over `backfillKey`, so a second run is
cheap rather than doubling the book.

The adapter (`db/lib/economyAdapter.js`) is built against
`web/lib/auditNarrative.js`, which is the only file that already knows which
call site named its number `resourcesSpent` and which called it `total`.

**What cannot be recovered**: the per-character passes (upkeep, tax and carry
each wrote one summary row per pass — hunger did too, until it stopped moving
⬢ at all), the Spillway, and the clamp. So
after a backfill each account gets one `PLUG` row sized to the gap between its
reconstructed sum and its live balance. The books then close at the seam, and
**a plug's size is a diagnostic, not history** — Health reports them for
exactly that reason.

**Hunger is no longer one of these passes.** The hunger rework
(`db/lib/hunger.js`) replaced the old ⬢-upkeep-and-streak system with a
0-100 meter that costs no ⬢ at all — `HUNGER` stays in `economyReasons.js`
only because historic `EconomyEntry` rows still name it, and the sentence
above describes that history, not anything Hunger charges today.

## 7. Who sees what

`/gm/economy` is open to **every GM**, zone-scoped and redacted. Superadmins
read it unredacted.

- **Zone scoping** follows the desks' own rule — null means every zone, never
  an empty list, so branch on null rather than on length.
  Ledger rows are filtered on `EconomyEntry.zoneId`, stamped by the hooks from
  whichever end of the movement is a real place — `db/lib/parties.js` already
  selects `zoneId` onto every party, so it costs nothing. The id side rather
  than the name side because `db/lib/gmZoneView.js#visibleZoneIds` already
  folds a seat onto the cave levels it owns, which the name side has to redo by
  hand. Character and room rows (the Accounts table) still use the name-based
  `inVisibleZones`, because those are not ledger rows.
- **Aggregates stay whole.** A GM who cannot see the Caves still sees the
  Caves' ⬢ in the total supply. The moment a total depends on who is looking,
  every number becomes a different number per reader and the books stop
  balancing. Scoping and redaction hide **who**, never **how much**.
- **`secret`** marks a cult purchase, a rite's cost, a concealed character's
  dealings. The amount, reason and turn survive; the counterparty reads
  `someone` — the same word `remarkDiscord.js` prints for a mention it will not
  resolve, so the panel speaks the language the rest of the app speaks.
- Lifeweb Blood is **not** on this page. It stays a Mortus surface.

## 8. Per-turn numbers are grouped, not cached

`flowsByTurn()` groups the ledger directly. There was an `EconomyTurnRollup`
cache here briefly and it is gone, for two reasons worth remembering before
anyone adds it back:

- **Nothing ever built it during play.** It was written only by the backfill
  and by a button, so in a live game it was empty or stale, and every read
  fell through to the groupBy anyway — the same aggregation at the same grain,
  in seven lines.
- **Its refresh button destroyed data.** The rebuild skipped every row with no
  turn number, which is most of them, so pressing it permanently shrank the
  charts.

A cache that is never written is not a cache, it is a second answer to the
same question. If the groupBy becomes slow — it is the kind of thing that
would, on a month-old game — cache it somewhere that is actually kept warm,
and make the read path merge rather than choose.


## 9. What each section of the desk answers

| Section | The question |
|---|---|
| Pulse | What is the town worth, is the supply growing, and is one person sitting on it |
| Flows | Where does money come from, where does it go, and who trades with whom |
| Faucets | Which sources pay, and how much |
| Sinks | What spends money, and what destroys it — the Spillway and an overdrawn purse have their own panel, because those two are destruction rather than spending |
| Ledger | The book: every entry, filterable, newest first |
| Accounts | Every purse and stash, and what moved through it this turn |
| Goods | The catalog against reality — prices, what exists, what actually trades, and any ware whose round trip prints money |
| The Depot | Every account in the game, split TREASURY from OFFSHORE, against the coin in the Vault. A claim and its backing are shown APART, always (§1) |
| Factions | Silo treasuries, and what went in and out this turn |
| Health | Drift, un-hooked call sites, and the backfill seam |

Two numbers the desk deliberately does not compute:

- **Labor drops show what they paid, not what they were designed to pay.** The
  expected value needs `docs/miningdrops.yaml` parsed and the roll shares
  simulated (`db/lib/miningdropsEv.js`), which is not a page render's job. Run
  `npm run db:audit-mining-drops` for that side. Inventing a plausible number
  there would be worse than leaving it out.
- **No per-faction balance history.** There is no per-turn snapshot to group
  off, so a sparkline would cost a query per faction.

## 9. Things not to do

- **Don't make the ledger a source of truth for a balance.** Balances stay on
  the holdings — a ⬢ balance IS its stack row, the Depot's are its own
  columns. The ledger exists to be compared against them. Two writable copies
  of one number is how this goes wrong, and it is why ⬢ becoming a tag meant
  DELETING the columns rather than keeping them in step with the stacks.
- **Don't write a ledger row outside the caller's transaction.** A row
  recording a write that rolled back is worse than no row.
- **Don't let a ledger failure fail a money move.** A try/catch is NOT enough:
  Postgres aborts the whole transaction on a failed statement and refuses every
  statement after it, so catching the error in JavaScript does not un-abort
  anything. The write is fenced between `SAVEPOINT` and `ROLLBACK TO SAVEPOINT`.
  Keep it, and keep the test proving the savepoint is issued — the version of
  the fake transaction that never threw could not tell the difference.
- **Don't bring back a `Silo` model.** A faction treasury is a Room.
- **Don't sum the Depot account and the Merchant's purse.**
