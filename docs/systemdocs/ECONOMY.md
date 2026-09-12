# The economy

The source of truth for the money in Ravenheart, the ledger that records it,
and `/gm/economy`, the desk that reads it.

## 1. There is one unit of account, wearing several coats

**One obol is one ⬢.** Nothing converts, nothing has an exchange rate, and the
whole panel depends on that being true. What differs is the *form* the value is
in, and forms are what `EconomyEntry.form` names:

| Form | Where it lives | What is special about it |
|---|---|---|
| `BALANCE` | `Character.resources`, `Room.resources` | Abstract and weightless. The common case |
| `COIN` | physical `obol` tags | Has weight, can be looted, is the Merchant's actual purse |
| `ACCOUNT` | `Depot.accountObols` | The station's float. Opens at 20 ¢ |
| `DEBT` | `Depot.debtObols` | Negative money, capped at `creditCapObols` (75) |
| `MANIFEST` | `Depot.manifest` | Paid for, not yet landed. Real money, in transit |
| `GOODS` | any tag with `sellablePrice` or `depotPrice` | Valued at its catalog price. A tag with no price is not money |

**Never sum the Depot's account and the Merchant's purse.** They are two pots
and the ATM is the only door between them (`DEPOT.md` §0g). A panel that adds
them together is telling a lie on its front page.

## 2. Accounts, and the two that make the books close

Every entry has two ends, and each is one of:

- `character:<id>` — a purse
- `room:<id>` — a stash, **and also a faction treasury**. `Faction.siloRoomId`;
  the `Silo` model was deleted in 9/2026 and does not come back
- `depot:account`, `depot:debt`, `depot:manifest`
- `offworld:company` — the shuttle. The only door off-world
- `world:mint` and `world:burn`

Mint and burn are the only two things that change the money supply. That is
why they are named accounts rather than a null end: "where did 400 ⬢ come
from" has to be answerable, and before this it was not.

## 3. The invariant

> For every account: the sum of its ledger legs equals its live balance.

This is the point of the whole system. `reconcile()` in
`web/lib/economyQuery.js` runs it, the Pulse section shows a badge, and the
Health section lists every account that drifts. **A drift is a finding, not a
bug in the ledger** — it means something moved money without saying so, and the
size of the drift is the size of the hole.

`db/test/economyLedger.test.js` asserts the invariant against the primitives
directly, including the two cases that are easy to get wrong: a transfer must
be one row rather than two, and the Spillway must record both the arrival and
the burn or the room reads as drifting when it is not.

## 4. The hooks

Everything that moves money goes through one of four places. Each takes an
optional trailing context; absent, the entry is recorded as `UNATTRIBUTED`.

| Hook | File | Covers |
|---|---|---|
| `moveParty` | `db/lib/resourceTransfer.js` | every `BALANCE` move |
| `applyTransfer` | `db/lib/resourceTransfer.js` | a two-legged transfer, as ONE row |
| `bumpAccount` | `db/lib/depotState.js` | `ACCOUNT` and `DEBT` |
| `addToStack` / `dropCharacterTag` / `addToRoomStack` / `dropRoomTag` | `db/lib/tagWrites.js` | `COIN` and `GOODS` |

The tag hooks are instrumented **inside** the functions rather than at their
call sites, because there are about 135 of those and threading a context
through every one would have been a diff nobody could review. They carry the
context on the existing options bag instead (`options.econ`), so an ordinary
call site is untouched.

`db/lib/pricedTags.js` keeps a small TTL'd map of which tags carry a price, so
a tag write costs no extra query. An unpriced tag — a wound, a skill, a corpse
— records nothing at all.

### Two things that used to vanish

- **The Spillway.** `Room.destroysContents` silently dropped whatever was put
  into it. It now writes a `SPILLWAY` burn.
- **The overdraw clamp.** `addResources` floors at zero with
  `GREATEST(0, ...)`, so a debit larger than a balance destroyed the shortfall.
  It now writes a `CLAMP` burn for the difference.

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
understanding: an ATM withdrawal is the same ⬢ changing coat, so counting it as
trade would make a quiet turn at the Depot look like a boom.

**`UNATTRIBUTED` is a feature.** A write that reaches a hook with no context is
recorded under that reason rather than dropped, so an un-hooked call site shows
up on the panel as its own bar instead of quietly missing. **Never quiet a
noisy entry by filtering its reason out on the read side** — that is exactly
the pattern `dmKinds.js` was built to replace. Give the call site its reason.

## 6. History, and the plug

The ledger starts the day it ships. `npm run db:backfill-economy` reconstructs
what it can from `AuditLog` — dry run by default, `-- --apply` to write, and
idempotent on a partial unique index over `backfillKey`, so a second run is
cheap rather than doubling the book.

The adapter (`db/lib/economyAdapter.js`) is built against
`web/lib/auditNarrative.js`, which is the only file that already knows which
call site named its number `resourcesSpent` and which called it `total`.

**What cannot be recovered**: the per-character passes (hunger, upkeep, tax,
carry each wrote one summary row per pass), the Spillway, and the clamp. So
after a backfill each account gets one `PLUG` row sized to the gap between its
reconstructed sum and its live balance. The books then close at the seam, and
**a plug's size is a diagnostic, not history** — Health reports them for
exactly that reason.

## 7. Who sees what

`/gm/economy` is open to **every GM**, zone-scoped and redacted. Superadmins
read it unredacted.

- **Zone scoping** reuses the desks' own filter: `getVisibleZones()` (null
  means every zone, never an empty list) and `inVisibleZones`.
  `EconomyEntry.zoneName` is named to match what that filter already reads.
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


## 9. Things not to do

- **Don't make the ledger a source of truth for a balance.** Balances stay on
  `Character` / `Room` / `Depot`. The ledger exists to be compared against
  them. Two writable copies of one number is how this goes wrong.
- **Don't write a ledger row outside the caller's transaction.** A row
  recording a write that rolled back is worse than no row.
- **Don't let a ledger failure fail a money move.** Every write here is
  wrapped, the same way `chargeWoundMood` is — a bookkeeping hiccup must never
  cost a player their purchase. Reconciliation is what catches the miss.
- **Don't bring back a `Silo` model.** A faction treasury is a Room.
- **Don't sum the Depot account and the Merchant's purse.**
