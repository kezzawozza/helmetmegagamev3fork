# Desires

The tag-point earning half of the point economy. A Desire used to be
free-text on a 1–5 ladder; it is now a picked-from-catalog goal, drawn from
`docs/desires.yaml`, with its own gates, cooldowns and a per-tag-group
lock/unlock mechanism. Read `TAGS.md` §4 first for the point economy itself
and `REQUESTS.md` §5 for the request-level mechanics; this doc is the system
doc for the catalog, its gates, and the GM surface.

## 1. What a Desire is now

**A Desire is claimed retroactively.** You do the thing, then you open a slot,
pick the Desire out of the catalog, say how you pulled it off, and the points
land. That is the whole interaction. The 2026-09-02 rework deleted the other
half of it — there is no setting a Desire in advance, no `ACTIVE` row waiting
to be settled, and nothing to cancel.

What that replaced was a two-step contract, and the reason it went is that the
contract taxed the wrong thing: a player had to *predict* what their character
would do, and anything good they did without a slot already aimed at it earned
nothing. The old rule ("you can't fulfil a Desire retroactively — it had to be
set at the time") is now exactly backwards; if you find it written anywhere,
it's stale.

`DesireTemplate` is the catalog — one row per claimable goal, sourced from
`docs/desires.yaml`, upserted by `db:sync-desires`. `Desire` is one claim
against it: `slotIndex`, `status`, `templateId`, the template's `points`
snapshotted at claim time, and `setTurnNumber`/`endedTurnNumber` **both stamped
with the same open turn**, because the row is born ended. A free-text Desire
(still available, from a GM only — see §6) carries `templateId: null` instead.
A claim also carries `reason` (the player's own text, required — §8) and, once
a GM has looked at it, `reviewedAt`/`reviewedBy` (§6a) — `reason` is never
backfilled onto a pre-review-queue row, and neither is `reviewedAt`, so an old
row just shows less on the desk rather than erroring.

`status` is `FULFILLED` on every row a claim creates. `ACTIVE` is legacy and
nothing writes it any more, kept in the Postgres enum rather than dropped (same
posture as `MoveReviewStatus.WAITING_FOR_OPPONENTS`). `CANCELLED` still means
something real: a claim a GM revoked — from the Dev Panel's Revoke or the
review queue's Reject, both now `revokeDesireCore` (§6a) — and such a row has
its `endedTurnNumber` **cleared**, which is what releases the slot (§2).

`GameConfig.desireSlots` (default 2) is how many slots a character has. Slots
are independent: each cools down on its own clock, and the **bottom** one is
the slot an Addiction binds (§3).

**Tier doubles as the Tag Point award and the per-desire cooldown length.**
A tier-3 Desire is worth 3 points and, once fulfilled, can't be picked again
for 3 turns. The whitelist is `{1, 2, 3, 4, 5, 7}` — tier 6 is deliberately
absent, don't invent it (`db/lib/syncDesires.js#TIER_WHITELIST`).

## 2. The tier ladder + cooldowns

Two cooldowns exist, at different scopes, and neither of them is a turn
pass:

- **Per-desire cooldown** — once a *specific template* is fulfilled, that
  same template is unavailable again until
  `openTurnNumber >= endedTurnNumber + (cooldownTurns ?? tier)`. Exactly at
  the boundary turn it's available again, not still cooling. `cooldownTurns`
  is a per-entry override of the tier-length default, and after the 2026-09-02
  balance sweep it has 39 users. See the **COOLDOWN POLICY** block at the top of
  `docs/desires.yaml` for the rule that governs them; the two loads it carries
  are worth stating here too.

  First, **`cooldownTurns: 1` is inert**. The per-slot lock below already shuts
  a slot for the turn a claim lands in, so a per-desire cooldown of 1 is
  dominated by a gate that was going to fire anyway. (This tracks
  `desireSlotLockTurns`, which was **2** until 2026-09-07, **1** until
  2026-09-16, and is **2** again now. At a lock of 2 it is `1` **and** `2` that
  are inert, and 3 is the smallest value that changes anything.) One entry sits
  at 2 on purpose — `cause-chaos`, which is a Rage+Xom character's only goal and
  is written down at 2 so nobody tidies it up the ladder. It is dominated by the
  slot lock rather than wrong, so it was left where it is.

  Second, **a `requires` gate is not a throttle.** It decides who may take a
  goal, never how often, and a tag or role held permanently costs nothing on
  the second repetition. What throttles a Desire is a per-attempt *cost*: ⬢
  spent, an item consumed, a risk run. That is why Drink alcohol keeps its
  tier-length cooldown while Get a hug does not — the drink is the throttle, and
  the hug has none. The 38 entries that pay nothing per attempt were put on an
  inverted ladder (tier 1 → 5 turns, tier 2 → 4, tier 3 → 3) so the cheapest
  goals come back slowest and aiming higher always pays better per turn.
- **Per-slot lock** — claiming into a slot shuts that slot for
  `GameConfig.desireSlotLockTurns` whole turns afterwards:

  ```
  locked while  openTurnNumber <= maxEnded + lockTurns
  reopens on    maxEnded + lockTurns + 1
  ```

  where `maxEnded` is the largest `endedTurnNumber` over that slot's ended
  rows. `slotStates` also returns `lockedTurnsLeft` (`lockedUntilTurn −
  openTurnNumber`, never below 1), and every surface labels a locked slot by
  that — `Locked (1t)`, via `web/lib/desireLabels.js#lockedSlotLabel` — never
  by the absolute turn number, which means nothing to a player. At the default of **2**, a claim on turn N leaves the slot shut for the
  rest of N, shut through N+1 and N+2, and open on N+3. This is the throttle on
  income itself, independent of which template is being claimed. It has moved
  four times: one turn until 2026-09-02, then two, back to one on
  2026-09-07, and back to two on 2026-09-16 when Desire farming was paying out
  faster than the economy wanted — and it is a live `/gm/dev` knob rather than a constant. Note it is one TURN, not one day —
  `Turn.number` increments once daily, so each turn of lockout is a real day —
  and an in-game day, being two turns, is two of them.

  A row with `endedTurnNumber: null` is excluded from this **and** from the
  slot's "last claim" readout. That is the one lever the revoke/undo paths
  pull: a rejected claim costs the player their points but does not also cost
  them two turns of the slot.
- **Tier 7 — ONCE EVER.** `db:sync-desires` defaults `oncePerLife: true` for
  every tier-7 entry automatically; it's never written by hand in the YAML
  for a tier-7 row. `oncePerLife` can also be set by hand at any other tier,
  for the handful of entries where repeating the thing is absurd on its face
  (a second first-ever coronation, learning to read twice) — and, as the one
  documented opt-out, `oncePerLife: false` on a tier-7 entry turns the
  default *off* for that entry.

**Why these are stateless turn-number comparisons, not a turn pass.** Every
gate above reads as `openTurnNumber` vs. a stamped `endedTurnNumber`, computed
fresh on every read (`db/lib/desireGates.js`).
Nothing runs at turn-close to advance a Desire's cooldown counter — there is
no counter, only two absolute turn numbers and a comparison. This is
deliberate: it means a GM can rewind the open turn (superadmin-only, see
`ADJUDICATION.md`) and every cooldown recomputes correctly against the
rewound number with no separate fix-up pass, but it also means a turn
rewind genuinely does re-open or re-lock Desires as a side effect — the
same way it does everything else keyed off `Turn.number`.

## 3. `requires` semantics

`requires.anyTags` / `requires.allTags` / `requires.anyRoles` /
`requires.notTags` / `requires.notRoles` combine as **AND across the lists, OR
within each `any` one**. `requires.allTags` is the exception to "OR within":
every tag in it must be held. `butcher-a-human` is the only entry using it —
butchering a person takes the stomach (`cruel`) *and* the trade (`butcher`),
and neither alone will do. `allTags` is always AND and may never carry
`combine: or`; the sync rejects that pairing outright, since "all of these, or
something else entirely" is not a gate anyone writes on purpose. `anyTags: [dancer]` + `anyRoles: [minstrel, courtier]` reads "holds
Dancer, AND holds Minstrel or Courtier" — not "Dancer or Minstrel or
Courtier". Omit a sub-key entirely rather than writing an empty list; an
absent/empty list is no constraint at all (`db/lib/desireGates.js#evalRequires`).

`notTags`/`notRoles` are checked before `anyTags`/`anyRoles`, so a held
forbidden tag or role always wins the "locked" reason over an unmet `any`
gate — this only decides which reason string wins when more than one clause
fails; it changes nothing about whether the Desire is available.

### `combine: or` — when the tag alone should be enough

`requires.combine: or` is the one opt-out from "AND across the lists": it
joins `anyTags` and `anyRoles` with **OR**, so either one alone opens the
Desire. `notTags`/`notRoles` are never part of it — a forbidden pairing is
not something an OR may open.

It exists because AND makes a **purchasable** gating tag dead weight to
everyone outside the role. Esoteric costs 5 points and says "Unlocks Desires
about esotericism", but all four Desires behind it also demanded the
Scholastic role, so a Serpent who bought it saw nothing change — the rows
evaluated `locked`, and `/character` drops those server-side. The same shape
had also quietly killed **role** entries: `bury-a-body` offered `chaplain`,
who can never hold the role-exclusive `mortus` tag, and `imprison-someone`
offered `sheriff`, who never holds `cerberon`.

Both lists must be non-empty for `combine: or`; the sync throws otherwise,
because an OR over one populated list is a silent no-op that still reads
like a working gate. Note the asymmetry with AND: there an empty list means
"no constraint", while under OR an empty list must never be the thing that
*passes* the gate, or the Desire opens to everyone.

**AND is still the default and still the common case** — ten of the
twenty-three tag+role Desires keep it on purpose:

- the five Lifeweb `feed-*` ones — the Mortus's sacral job, not something the
  role-exclusive `mortus` tag should carry on its own;
- all five `corrupt` ones. Unlike Esoteric, `corrupt` is `visible: false` and
  promises no unlocks, so it reads as a Cerberon-flavoured tag rather than a
  broad purchase that disappoints. `sell-a-cerberon-secret` is the clearest
  case — you cannot sell Cerberon equipment you were never issued.

### Lock-clause grammar and the union rule

Separately from `requires`, a **held tag** can lock parts of the catalog
shut via its own `desires: { locks: [...] }` block in `docs/tags.yaml`
(`db/lib/desireShapes.js`). Each clause is exactly one of:

```yaml
- all: true                       # locks everything
- families: [alcohol, drugs]      # locks any template sharing a family
- tiers: [1, 2, 3, 4]             # locks templates at these tiers
```

plus an optional `exceptFamilies: [...]`, meaningful only alongside `all` or
`tiers` (a `families` clause already *is* the family list, so excepting from
it would be self-contradictory — `desireShapes.js` throws on that
combination). Precedence when a template is checked against a tag's clauses:
`all` beats `families` beats `tiers`, so an `all` clause always wins even if
a `families` clause from a different held tag would otherwise have matched
first (`db/lib/desireGates.js#lockedReasonForTemplate`).

### `slot: bottom`

A clause may also carry `slot: bottom`, which narrows it to the character's
**last** slot and leaves every other slot untouched. `bottom` is the only
accepted value: the rule is "your last slot", not "slot N", and `desireSlots`
is live-editable, so the grammar deliberately can't name an index.

That is what an Addiction is now (§5) — five of the six read:

```yaml
desires:
  locks:
    - all: true
      exceptFamilies: [alcohol]
      slot: bottom
```

i.e. **everything** outside its own family, in the bottom slot only. Note the
`tiers: [1, 2, 3, 4]` escape hatch is gone with it: an Addiction used to leave
tiers 5 and 7 open as a pressure valve, which stopped being needed once it only
costs one slot.

**`heroin-addict` is the sixth, and the exception.** It carries no
`slot: bottom`, so it shuts **every** slot rather than one, and the only thing
its holder can still want is the next dose:

```yaml
desires:
  locks:
    - all: true
      exceptFamilies: [heroin]
```

That makes it the harshest tag in the catalog outside Demoness, which is
deliberate — at −8 it is also twice any other Addiction's drawback and the
whole of a creation budget. Two things follow from the shape. It is not a
`bottomSlotAddiction`, so the panel draws no boxed bottom slot and no
`Addiction: …` caption for it; it reads as a plain total lock, which is what
it is. And the `heroin` family exists solely to hold the one Desire it leaves
standing — a lock reaches a FAMILY and never a single slug, so a Desire that
has to stand alone needs a family to itself.

Because the same template can be claimable in one slot and shut in another,
this half does NOT collapse into a template's `state`. `evaluateDesireCatalog`
takes `desireSlots` and gives every visible entry a `slotLocks` array — one
reason-or-null per slot — alongside `state`. `character/page.js` still drops
`locked` rows outright but ships `slotLocks` on the survivors, and
`DesireCatalog.js` re-filters on it whenever the target slot changes. The
server action checks `slotLocks[slotIndex]` on the way in, so retargeting a
slot in a stale tab can't smuggle a claim past it.

`describeDesireLocks` has a sentence for the scoped shape — *"Alcoholic shuts
your bottom Desire slot to everything outside Alcohol."* — and
`bottomSlotAddiction(heldTags)` finds the tag doing it, by the shape of the
clause rather than by its tag group, so the panel's boxed bottom slot and its
`Addiction: …` caption follow the data.

**Union rule**: when a character holds more than one tag with a
`desires.locks` block, every clause from every held tag applies —
locks only ever add, never subtract (`unionLockClauses` in
`desireGates.js`). There's no way for one held tag's lock to loosen
another's.

**A corollary that has already bitten: extra `families` on a template can be
LOCK-SURVIVAL KEYS rather than taxonomy.** Because the union only ever adds, a
character holding two all-but-one locks has *everything* shut unless some one
template sits in both exceptions. `cause-chaos` is the case to copy. It is the
only Desire `{tag:old-ways-xom}` leaves open (`exceptFamilies: [chaos]`), and
Xom's own turn table can hand its holder `{tag:rage}` (`exceptFamilies:
[cruelty]`) and, through Seizure's `expiresInto`, `{tag:stupid}`
(`exceptFamilies: [alcohol, stupidity]`). So the template carries
`families: [chaos, cruelty, stupidity]` — three families for a goal that is
plainly one thing — and its `requires.anyTags: [old-ways-xom]` keeps it out of
everyone else's picker regardless, so the extras cost nothing. Take one away
and a Rage+Xom character has a sheet with no reachable goal at all: benched
rather than changed, which is the failure the `stupidity` family was invented
to prevent. **If you add a tag with an all-but-one lock, check it against every
other one already in the catalog.**

The grammar can't express every intent. Nobility's "closed to Desires below
tier 1" plus "cheap standard food doesn't count" collapses to `tiers: [1]`
in the YAML with the second half left as a GM-adjudicated prose line in the
tag's description (Ruling R4) — the grammar has no way to except one family
*and* keep an exception's own exception. Kleptomaniac's `families: [wealth]`
lock similarly took a one-line data fix on two unrelated desires
(`sell-stolen-jewelry`, `pocket-60`) to drop `wealth` from their own family
list, since a clause can't combine `families` and `exceptFamilies` in one
breath (Ruling R7).

**A whole-catalog tier lock is silent in the summary.** `describeDesireLocks`
writes a sentence for every other clause shape, but not for `tiers` outside the
bottom slot: Nobility is the only tag carrying one, and each tier-1 template in
the catalog already reads `Locked by Nobility` on its own row, so the summary
line at the top of the panel was the same fact twice. The **bottom-slot** tier
clause keeps its sentence — an Addiction binds a slot rather than a row, and a
slot has nowhere else to say so.

## 4. Hidden templates and the identical-error oracle defense

A `requires.anyTags` gate whose gating tag is itself hidden (Demoness —
`TAGS.md` §3a) is a special case: failing it doesn't produce a
"locked" state at all. `evaluateDesireCatalog` **withholds the entry
entirely** from its `visible` array — it never reaches a picker, dimmed or
otherwise (`db/lib/desireGates.js` §evaluation order, step 1). Getting this
wrong leaks the existence of a hidden roster.

The matching defense sits in `evalRequires`: if a template's `anyTags` gate
fails and the gating tag is hidden, the function returns `{ hidden: true }`
rather than a `{ ok: false, reason }` — and the reason string for an
*ordinary* locked entry never names a hidden tag, on pain of becoming the
oracle the hidden rule exists to prevent. If a locked-reason string ever
told a non-holder "Requires the Demoness tag," that sentence
alone would out the category — which is exactly why the code path is
"withhold the row," not "show a generic reason." The two failure modes
(gated-and-hidden vs. gated-and-visible-but-locked) must produce
indistinguishable UI for anyone who can't already see the hidden category:
nothing at all, vs. a reason that never names what's actually gating it.

## 5. The two tag groups and `conflictsWith`

The rework first split the old scattered drawback/interest tags into three
`general` groups — Addictions, Restrictions, Interests. **The Personality
rework (2026-09-01) collapsed the last two into one.** The split had said a
Restriction only ever *closes* the catalog and an Interest only ever *opens*
it, and that made every Restriction a dead end: Pacifist cost 2 points, locked
`[violence, feud]`, and gave nothing back. A Personality tag is now free to be
negative **and** open Desires nobody else can reach, which is what Pacifist's
own two entries (`break-up-a-fight`, `stop-a-war`) demonstrate.

| Group | Shape | Price band |
|---|---|---|
| `general-addictions` | `exclusive: true`, `consumable: false` drawbacks — never `removable`, since Destroy is for items (`CRAFTING.md` §5). Each shuts the **bottom slot only**, to everything outside its own family — see §3. **One Addiction at a time** — that rule is why this stayed its own group. | −4 flat |
| `general-personality` | Everything else about who a character is. Nothing here is `exclusive`, so a character can hold Pacifist + Cruel + Schemer, or Pacifist + Craven. `Depressed` is the near-exception, and by named conflict rather than by the flag: because it locks the whole catalog it `conflictsWith` every tag here that also touches Desires, and only those — so Lazy, Insomniac, Guilt Ridden, Torturer and the phobias stay legal beside it (`TAGS.md` §3). Some members close the catalog down (`Depressed` locks everything; `Nobility` locks tier 1; `Eunuch` locks `romance`), some open it up (`Mad Doctor`, `Esoteric`, `Adventurer`, `Cruel`, `Charitable`, `Schemer`, and `Death Wish` — the Interest, not the old Bacchus tag), and the point of the merge is that one tag may do both. | −8…+5 |

`general-restrictions` and `general-interests` survive as **orphaned, empty
groups** in `docs/taggroups.yaml` — group sync is upsert-only and never
deletes, same as `status-health`. Don't reuse either slug.

**NO DRAWBACK IS PURCHASABLE AFTER START.** This reverses what this section
used to say about Addictions ("meant to be taken mid-game for the points").
Every negative-`pointCost` tag now carries `purchasableAfterStart: false`,
which `/store` enforces server-side (`web/app/(app)/store/actions.js`). The
consequence is deliberate and large: **fulfilling a Desire is the only way to
earn Tag Points mid-game.** It also closes the buy-a-drawback → get-cured →
keep-the-points loop at the door, which is where §7's clawback rule had been
patching it from behind.

**Pricing rule, from the 2026-09-02 sign-off:** a Personality tag that *locks
and also opens* is **0**; one that only locks is negative. Pacifist (locks
`violence`/`feud`, opens two of its own) and Kleptomaniac (locks `wealth`, opens
thievery) are both 0. Eunuch (−1), Prudish (−2), Craven (−3) and Depressed (−8)
only lock. `blood-feud` was removed entirely in that pass, along with the four
clan-feud desires that gated on it.

`ascetic` went the same way, came back the same day, and was pulled again for
good later on 2026-09-02 — with it went the `ascetic` Desire family and its one
member, `sit-in-bliss`. Because that second removal was a design retraction and
not a cure, §7's clawback deliberately did **not** apply: a one-off script
deleted the row and its seven holdings and left every holder's `tagPoints`
untouched.

The price band follows an income-based rationale: a tag is priced by how
much of the catalog it closes against how much it opens. Depressed, closing
everything and opening nothing, is the floor at −8. Eunuch, closing exactly
one family, is −1. An Interest-shaped tag costs points because it is pure
upside. Pacifist sits at −2 even with two Desires of its own, because what it
opens is narrow and what it forbids is not.

**Addictions are flat −4 as of 2026-09-02**, down from a −3…−6 spread
(Alcoholic −3, Drug Habit −4, Gambler −5, Vain −5, Glutton −6). The spread
priced how much of the *whole catalog* each one closed, and that variable
stopped existing when the lock moved to the bottom slot: those five shut
exactly one slot to exactly one family's worth of exceptions, so they are worth
the same thing.

**Heroin Addict, added later, is −8 and off that flat rate on purpose.** It is
the one Addiction that never moved to the bottom slot — it shuts the whole
catalog, so the variable the old spread priced is live again for exactly one
tag. At −8 it is also the entire creation drawback budget
(`GameConfig.maxDrawbackPoints`), which means a character who takes it at
creation can take no other drawback at all. Glutton losing two points is the biggest single move here, and
it is the right one — "food is the largest family" was compensation for closing
tiers 5 and 7, which it no longer does.

**`conflictsWith`** (`Tag.conflictsWith`, a self-referential m2m,
`SYNC.md` pass 6) is a named pairwise conflict, authored one-directional in
`docs/tags.yaml` and symmetrized by the sync — unlike `exclusive` (at most
one tag per character *per group*), a conflict isn't scoped to a group and
isn't carved out for a `requiredTag` pair. `conflictsWith` is what survives
the merge doing real work: every Addiction lists
`conflictsWith: [depressed, prudish]` so a character can't stack, say,
Alcoholic with Depressed (which already locks everything, making an
Addiction's own unlock moot and confusing) or with Prudish (which disapproves
of the very thing). Those edges are unaffected by the group merge,
because a conflict was never group-scoped in the first place.
`web/lib/characterCreation.js#conflictingTag` is the enforcement predicate,
same posture as `exclusiveConflict` — a GM grant bypasses it, like every other
creation-time gate.

## 6. The GM surface

`GoalsTab` (`web/app/(app)/gm/dev/characters/[characterId]/GoalsTab.js`) is
per-slot, mirroring the player-facing `DesirePanel`/`DesireCatalog`: each of
`GameConfig.desireSlots` slots shows what it last paid out, whether it is
cooling down, and an **Award** sub-form. This is a microaction rather than a
staged field — awarding a Desire moves `Character.tagPoints`, and staging a
point movement alongside a hand-edited `tagPoints` value on the Identity tab
would make the arithmetic ambiguous, so it commits on its own and the Identity
field always shows the result.

Two routes to award one, both **gates bypassed** (a GM grant is never
second-guessed, same rule as every other gate in the game):

- **Catalog** — pick any `DesireTemplate`, retired ones included and marked.
  No `requires`, no held-tag lock, no slot lock, no cooldown, no `onceEver`
  check.
- **Free text** — the kept fallback, 1..7 points (wider than the
  player-facing 1–5 ladder that used to be the whole system), `templateId`
  stays null.

Bypassing the gate does **not** bypass the bookkeeping. `awardDesireGmImpl`
stamps `endedTurnNumber` like any claim, so the award starts the normal
per-slot and per-desire cooldown clocks — there is no "GM award, no cooldown"
mode. What a GM grant skips is *who may claim*, not what claiming costs.

`revokeDesireGmImpl` is the inverse and the Dev Panel twin of undoing a
`FULFILL_DESIRE` request: it takes the points back (even into negative) and
sets the row `CANCELLED` with `endedTurnNumber` **cleared**, which releases the
slot. Both actions take the same `FOR UPDATE` row lock on `Character` as the
player path, so a GM award landing at the same moment as a player's own claim
serializes rather than one overwriting the other's `tagPoints`.

**Both operate on a specific `desireId`**, never on "the slot's current row",
so revoking or undoing an old claim after a newer one has landed in the same
slot is safe — it only ever touches the row it snapshotted. The visible effect
is that a slot carries a history of rows, and the cooldown math cares only
about the largest `endedTurnNumber` among them.

## 6a. The review queue

A claim pays the instant it lands (§1) and only afterward waits on a GM to
look. That waiting pile is a fifth lens on `/gm/turns`, beside Moves / Caving
/ Other / History — not a new tab on `/gm/dev`. It lives there because
`/gm/turns` is the desk a GM is already working a turn from, and because the
avatar-review queue already proved the shape: a row that pays first and asks
permission second, answered from the rail with two buttons and a mini
inspector.

**A row is a `FULFILLED`, catalog-backed `Desire` with `reviewedAt: null`.**
`desireNeedsReview` (`db/lib/desireReview.js`) is the pure predicate and
`desireReviewWhere()` is the identical Prisma `where` — the same "keep the
two in sync by hand" contract `avatarReview.js` states for its own pair, so a
change to one without the other is a bug waiting to be found by a claim that
silently stops showing up.

**Keep** stamps `reviewedAt`/`reviewedBy` and does nothing else — no audit
row, no DM, no `tagPoints` movement. It is a mark-as-seen, and the update is
conditional on `reviewedAt: null`, so a second Keep (another GM, a
double-click) finds nothing left to claim and just reports that rather than
throwing (`keepDesireClaimImpl`).

**Reject** is the load-bearing button. It runs `revokeDesireCore` — the same
transaction body the Dev Panel's `revokeDesireGmImpl` uses (§6), lifted out
so there is exactly one way a claimed Desire ever comes back off, rather than
two copies of a points reversal that could drift apart. It takes the points
back **even into negative**, flips the row `CANCELLED`, clears
`endedTurnNumber` (which reopens the slot — §2), writes a `gm_desire_cancelled`
audit row (both revoke paths snapshot `desireName` and `claimText`, the player's
`reason`, so `/gm/audit` shows what was claimed; rows from before that get the
same two fields read off the Desire by `withRevokedDesire` on the audit page),
and sends one DM: "Your desire was rejected." — a `NOTICE`, not a
`CONVERSATION`, for the reason every DM kind is chosen on: the game said it,
a person didn't. Reject then stamps `reviewedAt`/`reviewedBy` on the
same row inside the transaction, so a rejected claim is also a reviewed one.

**Reviewed rows stay in the queue.** `desireReviewWhere()` deliberately does
not filter on `reviewedAt` — it is a sort key for the caller (unreviewed
first), not a filter for the query. A reviewed row keeps its place in the
rail, dimmed and button-less, the same `[data-auto]` affordance an already-
resolved Travel Move wears. That makes the lens double as the claim history,
not just the inbox — a GM can see what they already cleared without
switching views.

**`templateId: null` rows never enter the queue.** That is a GM free-text
award (§6's other route, "Free text" 1..7 points) — a GM who typed the points
in by hand has nothing to review, so `desireNeedsReview` refuses it outright
regardless of `reviewedAt`.

**The tab's count is unreviewed rows, not the total.** The Moves tab counts
everything shown because every Move shown is something to look at; a Desires
tab counting reviewed rows too would tell a GM to open it when there is
nothing left to do.

**The honest limit, stated plainly rather than buried:** `AuditLog` records
mechanical acts, so "drink alcohol" leaves a trace a GM can search for and
"earn a compliment" leaves none — nothing about a compliment is mechanical.
The desk's mini audit-log filter (`DesireDesk.js`, prefilled from the
template's `verifyQuery` where one exists — §10) is a head start on the
minority of the catalog that's checkable, not a verdict on the rest. For
those, the Inspector's Archive tab beside the desk — what the character
actually said — is the real answer, and a GM reading the `reason` field
(required at claim time — see the rewritten §8 below) is still the whole
enforcement.

**The deliberate non-decision worth recording: these rows skip the desk
store and the notify triggers.** `ADJUDICATION.md` §3's four `_notify`
triggers wake every open desk live when a Move, Caving roll, staged effect or
staged message changes; a `Desire` row raises none of them, and
`web/lib/deskRows.js#deskPatchFor` doesn't know how to re-read one either —
both `DesireDesk.js` and `QueueRail.js`'s `DesireClaimRow` close the panel or
call the rail's own guarded `refresh()` instead. That is the same trade-off
`AvatarReviewRow` already made, for the same reason: a fifth row type through
the desk store, the live stream, and the trigger set is a lot of machinery
for two buttons nobody presses twice in the same turn.

## 7. The clawback rule

Curing an Addiction or a negative Personality tag (a Chaplain confessing
someone free of one, say) is a `HEAL_CHARACTER`-shaped GM adjudication, not a
code-enforced transaction — and when a GM does cure one, the rule is:
**deduct the points that tag granted, even into negative.** A character who took
Glutton for the −6 points and later gets cured of it loses those 6 points
back out of `Character.tagPoints`, even if that takes the balance below
zero. This closes the loop a curable, maximally valuable drawback would
otherwise be: buy a drawback for the points, get cured for free, keep the
points — a point farm with a Chaplain as the vending machine. Since §5 closed
mid-game drawback purchases entirely, this now guards a narrower case than it
was written for: a drawback taken at character creation and cured on day 3.
That case is still a farm, so the rule stands. There is no code enforcement of
this; it is GM-adjudicated the same way every other
Health-tag cure is (`TAGS.md` §5c), and it's written here because the
consequence (going negative) is the one a GM might otherwise hesitate over.

## 8. The anti-loop rule

"**A Desire arranged solely to fulfil a Desire is not fulfilled.**" A
character can't stage a scene whose entire content is manufacturing the
conditions for a Desire and then claim it — e.g. asking someone for a hug
purely to claim `get-a-hug`. The rule exists specifically against a tier-1,
high-frequency Desire like that one turning into a repeatable income tap with
no roleplay cost. This used to say a claim "files a `FULFILL_DESIRE` request and a GM reviews
it, same as any other Request," and that there was "no code check for this."
Both halves of that sentence were describing something that no longer exists
by the time it was written: the `Request` table is gone (§11's neighbour in
spirit — nothing files anything any more, an action just applies), and until
the review queue in §6a shipped there was, genuinely, no reason field and no
surface a GM could read it from. If you find that sentence quoted anywhere
else, it's stale in exactly the way §1 calls the old retroactive-claim rule
"now exactly backwards."

What's true now: `claimDesireImpl` refuses a claim with no reason
(`"Say how you pulled it off."`, `web/app/(app)/character/requestActions.js`),
and every claim lands in the §6a review queue. So the written standard
finally has a surface behind it — a GM opens the row, reads the reason field,
checks the audit slice if the claim is the checkable kind, and presses Keep
or Reject. That is still not a gate. The difference between an evening that
happened and an evening staged to be claimed is a judgement about fiction,
and no code path was ever going to make it — what changed is that the
judgement now has somewhere to be made.

**Since the retroactive rework this is the load-bearing rule of the whole
system, and it should be read that way.** It used to share the work with the
shape of the mechanic: having to commit to a goal in advance meant a player
could not simply survey their turn afterwards and pick whichever Desire best
described something they happened to do. That friction is gone on purpose —
it was taxing ordinary play far more than it was taxing farming — and what is
left standing between a claim and a farm is a GM reading the reason field.
Which is the right place for it: the difference between an evening that
happened and an evening staged to be claimed is a judgement about fiction, and
no gate was ever going to make it.

## 9. Config: `desireSlots` / `desireSlotLockTurns` / `maxDrawbackTags`

Three `GameConfig` knobs govern this system, all live-editable from
`/gm/dev` and all reset by a Restart Game wipe. There used to be a fourth, a
`desiresEnabled` master switch; it was deleted in the 2026-09-07 config trim,
since nobody had ever turned it off and Desires are the only faucet Tag Points
have in play:
- **`desireSlots`** (default 2) — how many slots a character has. The
  **bottom** one is what an Addiction binds (§3). Lowering this hides a slot
  rather than deleting what was claimed in it. See §1.
- **`desireSlotLockTurns`** (default 2) — whole turns a slot stays shut after a
  claim lands in it (§2). This is the tuning knob on how fast Tag Points enter
  the game, so it is the first number to reach for if income is running hot or
  cold. `0` disables the lock entirely, which is a debugging setting, not a
  balance one.
- **`maxDrawbackTags`** (default 6) — **not** a Desires-system knob itself,
  but the field every drawback counts against at character creation. It caps
  the *count* of point-bought drawback tags, not their combined point value —
  see `TAGS.md` §4a for the full rule and why this replaced the old
  points-based `maxNegativeTags`.

  It is enforced at **creation only** (`createActions.js`), and that is now
  enough: §5 made every negative-`pointCost` tag `purchasableAfterStart:
  false`, so `/store` refuses them outright and there is no mid-game path
  left for the cap to guard. `negativeTagCount` in
  `web/lib/characterCreation.js` counts by the sign of `pointCost`, not by
  group, so the Personality merge changed nothing about what it sees.

  **Ship order for this migration:** `20260831233000_drawback_tag_cap` is
  ADD-only — it adds `maxDrawbackTags` and leaves the old `maxNegativeTags`
  column in place, still carrying `@default(8)` in `schema.prisma`. That is
  deliberate: `bot` talks to the database over REST rather than a gateway
  push, so a bot deploy can lag or be skipped behind `web`'s Pre-Deploy
  migrate step (see CLAUDE.md "Railway bot skips db-only deploys" note), and
  every select-less `gameConfig.findFirst()` — there are around 15 of them
  across bot/db/web — throws `P2022` the instant a client expects a column
  the row no longer has. Do not drop `maxNegativeTags` in the same push that
  adds `maxDrawbackTags`. Once both the `bot` and `web` Railway services are
  confirmed running the build that introduced `maxDrawbackTags` (check each
  service's active deployment in the Railway dashboard), write and ship a
  follow-up migration that does `ALTER TABLE "GameConfig" DROP COLUMN
  "maxNegativeTags";` and remove the field from `schema.prisma`.

## 10. YAML format, sync behavior, run order

`docs/desires.yaml` is the sole master for `DesireTemplate`, same posture as
`docs/tags.yaml`: hand-edited, upsert-by-slug. Two top-level keys:

```yaml
familyGroups:                    # picker-only: the tab bar's hue clusters
  appetite:
    name: Appetite

families:
  alcohol:
    name: Alcohol
    group: appetite               # picker-only: which familyGroups entry
    color: "#d9a545"              # picker-only: freeform hex, see the palette rule
    # comment describing what belongs here

desires:
  drink-alcohol:                  # the key IS the slug
    name: Drink alcohol
    tier: 1
    families: [alcohol]
    requires:                    # optional
      anyTags: [dancer]
      anyRoles: [minstrel, courtier]
      notTags: [...]
      notRoles: [...]
      combine: or                 # optional, default "and"; ORs anyTags with
                                  #   anyRoles (both must be non-empty)
    cooldownTurns: 5              # optional, overrides tier as cooldown length
    oncePerLife: true             # optional; forced true at tier 7 unless set false
    verify: "Alcohol"              # optional, see below
    description: |-               # optional; the "counts / doesn't count" rule, see below
      Counts: ...
      Doesn't count: ...
```

**`description:` is the rule for what a claim has to be.** A name alone leaves
the edges to whoever is claiming — "Save someone's life" was being claimed for
a warning or a tip-off. So a vague Desire gets a `Counts:` line and a
`Doesn't count:` line, each starting with exactly those words. It is shown
in three places: under the row in the catalog, in the Claim dialog above the
reason box (so a player reads it at the moment they commit), and on the review
desk as **What counts** above the reason (`web/app/components/DesireRule.js`).
It is free text — the sync copies it as it is, nothing validates the labels — and
the desk reads the template's *current* wording, not a copy frozen at claim
time. Eight entries carry one so far: the three "save … life" Desires,
`warn-the-town`, `deliver-a-message`, `stop-a-war`, `prediction-comes-true`
and `call-it-out-loud`. Write a rule that names something the game can show — a
tag held (Dying), a seat somebody holds, a public room — rather than what a
character felt or meant.

**`verify:` is one search string**, synced to `DesireTemplate.verifyQuery`,
that prefills the review desk's audit-log filter (§6a) when a GM opens that
claim. It's optional, and most entries correctly carry none — write one only
where fulfilling the Desire leaves a mechanical trace worth searching for (a
named tag or item eaten, drunk, bought), spelled the way `docs/tags.yaml`
spells the thing, not the desire's own prose. About 25 entries carry one as
of this writing. The gambling Desires are the clean case for leaving it off:
there is no gambling mechanic anywhere in `db/lib`, so a claim like it is
pure GM adjudication and there is nothing in the audit log a `verify:` string
could ever find — writing one there would be decoration, not a head start.
It's validated in pass 0 (must be a non-empty string when present) and
written in pass 1 alongside the other scalars.

`families:` is the fixed vocabulary every entry's `families` list draws
from — nothing writes to it dynamically, and referencing an undeclared key
throws at sync time. `familyGroups:` and a family's `group:` / `color:` are
**picker-only**: the sync never reads them, `db/lib/desireFamilies.js` hands
them to the web app at runtime, and `DesireCatalog.js` builds its tab bar
from the groups and draws each family's colour as the left rule on its rows
and the swatch in its sticky header. The palette rule is written above the
`families:` header in the YAML and is the same one `docs/taggroups.yaml`
follows — one hue per group, families step in lightness inside it, every
value clears 3:1 against `--surface` on dusk and dawn. A family may appear in
several of a desire's `families`; the picker files it under the **first** one
and lists the rest beside its name.

**Desire names are plain prose — no `{tag:slug}` tokens.** A `name` may still
carry one as far as the sync is concerned (it is checked against
`docs/tags.yaml` like any other `{tag:…}` reference, and `RichText` would
render it), but none does, and none should. About twenty used to, and *which*
twenty was the problem: Sake and Ravenheart Red were linked chips while
alcohol and moonshine sitting beside them in the same family were flat text,
so the picker looked half-finished rather than deliberate. Write the ware's
name into the sentence instead. A common noun goes lowercase ("Drink sake",
"Have a lavish meal"); a proper noun or a named condition keeps its capital
("Drink Ravenheart Red", "Come back from Dying"), because there the line is
pointing at the mechanical state.

**Sync behavior — soft-retire, not upsert-only.** `db:sync-desires`
(`db/lib/syncDesires.js`, run via `npm run db:sync-desires` or automatically
inside the Restart Game wipe) differs from `db:sync-tags` here: a slug
present in the DB but absent from the file gets `retired: true` (hidden from
every picker, existing `Desire` rows referencing it keep running normally),
and a slug that comes back has `retired` cleared. `DesireTemplate` is pure
catalog with a cheap hide, not held state like a `Tag`, so there's no
`db:prune-desires` counterpart — nothing to prune, since nothing is ever
deleted.

Four passes, no writes until pass 0 validates everything (every unknown
`{tag:…}`/role/family reference throws before pass 1 touches the DB):

0. Parse + validate.
1. Upsert scalars (name, tier, families, `onceEver`, `cooldownTurns`,
   `sortOrder`), diffing arrays via `JSON.stringify`.
2. Resolve `requiresAnyTags`/`requiresNotTags` (m2m `set:`) and
   `requiresAnyRoleSlugs`/`requiresNotRoleSlugs` (plain slug arrays, same
   posture as `Document.roleSlugs` — a Role FK would block `db:prune-tags`-
   style pruning that never actually happens to roles here, but the
   reasoning is inherited from that convention).
3. Soft retire: DB slug absent from the file → `retired: true`; present →
   cleared.

**Run order: zones → tags → roles → desires → documents.** Desires sync
after roles because `requires.anyRoles`/`notRoles` validate against the Role
catalog, and before documents for no particular dependency but to keep the
whole chain in one linear pass (`web/app/(app)/gm/dev/actions.js`'s Restart
Game step list; see `SYNC.md` §1 and §3).

## 11. *(removed)* Auto-cancelling an orphaned Desire

`db/lib/desireOrphans.js` and its five call sites are **gone** as of
2026-09-02. It existed because a Desire's `requires` gate was checked when the
Desire was *set* and never again, so stripping a player's Pacifist tag left an
`ACTIVE` goal still worth full points. Nothing is in flight any more — a claim
is evaluated and paid in the same instant — so there is nothing left to orphan.

What went with it: the four in-transaction hooks (`requestActions.js`'s add /
remove / consume tag paths, `store/actions.js#buyTags`, and the Dev Panel's
`applyCharacterEditsImpl`), the `desireOrphans` pass in `db/index.js`'s
turn-advance sequence, and the `desire_auto_cancelled` audit writer. Old
`desire_auto_cancelled` rows still render; `web/lib/auditNarrative.js` keeps
its case for them.

The section number is kept rather than renumbering everything below it.

## 12. File map

| File | Role |
|---|---|
| `docs/desires.yaml` | Sole master for the `DesireTemplate` catalog — families header + desire entries |
| `db/lib/syncDesires.js` | `docs/desires.yaml` → DB. Four-pass soft-retire sync, `npm run db:sync-desires` / `db/scripts/sync/sync-desires.js` |
| `db/lib/desireFamilies.js` | Reads only the `families:` / `familyGroups:` headers — `desireFamilyKeys` for `db/lib/syncTags.js` to validate a tag's `desires.locks` families against, `desireFamilies` (key/name/group/colour) and `desireFamilyGroups` for the picker. Tolerates a missing `desires.yaml` |
| `db/lib/desireShapes.js` | Normalizes/validates `Tag.desires.locks` (the clause grammar in §3, `slot: bottom` included) — shared by `syncTags.js` and, eventually, a GM tag-form editor |
| `db/lib/desireGates.js` | Pure gate evaluator, no DB. `evaluateDesireCatalog` (visible/hidden catalog per character, plus per-entry `slotLocks`), `slotStates` (per-slot lock + last claim), `describeDesireLocks`, `bottomSlotAddiction` |
| `web/lib/desireProjection.js` | `projectDesireTemplateForGates` — the one path that resolves a `DesireTemplate`'s role-slug arrays into `{ slug, name }` for `desireGates.js`; every caller must go through it |
| `web/app/components/DesireCatalog.js` | Player-facing catalog picker modal, on the Point Buy layout: search + sort, a tab per family group, one scroller with sticky coloured family headers and `.select-card` rows, your slots in the side pane. Only ever sees what `character/page.js` leaves after dropping `locked`, and re-filters on `slotLocks` for the target slot. Posts nothing — it hands the pick back to `DesirePanel` |
| `web/app/components/DesirePanel.js` | Player-facing panel chrome — per-slot rows (last claim / cooldown / Claim button), the boxed Addiction slot, the reason dialog, opens `DesireCatalog` |
| `web/app/components/GoalsPanel.js` | Mounts `DesirePanel` on `/character` |
| `web/app/(app)/gm/dev/characters/[characterId]/GoalsTab.js` | GM Dev Panel surface — per-slot Award form (catalog or free text), Revoke on each past row, cooldown readout |
| `web/app/(app)/gm/dev/characters/[characterId]/actions.js` | `awardDesireGm`/`revokeDesireGm` — gates bypassed, bookkeeping not (§6) |
| `web/app/components/DesireRule.js` | Draws a template's `description` ("Counts: … / Doesn't count: …") in the catalog row, the Claim dialog and the review desk (§10) |
| `db/lib/desireReview.js` | `desireNeedsReview`/`desireReviewWhere` (the review-queue predicate and its `where` twin) and `revokeDesireCore`, the shared transaction body Reject and `revokeDesireGmImpl` both call (§6a) |
| `web/app/(desk)/gm/turns/actions.js` | `keepDesireClaim`/`rejectDesireClaim` (the desk's two buttons, §6a) and `getCharacterAuditSlice` (the mini audit-log filter behind `DesireDesk.js`) |
| `web/app/(desk)/gm/turns/DesireDesk.js` | The arbitration panel for one claim — reason, the audit-slice search box, Keep/Reject |
| `web/app/(desk)/gm/turns/QueueRail.js` | `DesireClaimRow` — the Desires lens's row and its unreviewed-only tab count (§6a) |
| `web/app/(app)/character/requestActions.js` | Player-facing `claimDesire` — the one player action, and the one that requires a reason (§8). Gates enforced via `evaluateDesireCatalog`/`slotStates`, re-validated inside the transaction under a `FOR UPDATE` row lock |
| `web/lib/tagEffects.js` | `FULFILL_DESIRE` re-score (`applyEdit`) and undo — the undo clears `endedTurnNumber`, releasing the slot |
| `bot/src/events/messageReactionAdd.js` | The 🔍/⚜️ embeds' `Last Desire` field — the most recent `FULFILLED` row, gated by `db/lib/inspectVision.js` |


## Manic

A `mastery` tag (`TAGS.md` §4a): the **slot** lock never applies. Each Desire's
own cooldown (§ the per-template table) is untouched — a Manic character may
refill a slot the instant it empties, but still cannot re-claim the same Desire
early.

It is a real bypass (`noLock` on `slotStates`), **not `lockTurns: 0`**, and the
difference matters. A `Desire` row is born ended — `setTurnNumber` and
`endedTurnNumber` are both stamped at claim — so at 0 the test still reads
`openTurnNumber <= maxEnded`, which is TRUE on the turn of the claim and shuts
the slot until the next one. Zero means "reopens tomorrow"; the tag says "no
cooldown". `db/test/masteryTags.test.js` pins that distinction.

`desireSlotsNeverLock()` is the one helper, called from all four places that
compute slot state — the claim action in `requestActions.js` (the only one that
*enforces*), plus `selfPools.js`, `devPanelData.js` and the sheet's own view.
They have to agree: a UI that offers a slot the action then refuses is the
failure this exists to prevent.
