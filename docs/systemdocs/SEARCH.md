# Searching somebody

The Search button on `/character` and on a person's row in `/chat`. Read
[`LESSONS.md`](LESSONS.md) §3 first — this is that Offer handshake with a third
button, a die, no skill, no Move and no turn pass, and everything below is a
delta from it.

It exists because the game had two ways to find out what somebody was carrying
and both of them were violence. **Loot** needs them helpless or dead.
**Torture** ([`TORTURE.md`](TORTURE.md)) takes everything on a 4 or higher and
costs them a `TORTURED` mood hit. There was nothing in between — no way to ask,
and no way for a guard on a gate to check a stranger without tying them up
first. This is that middle rung: you ask, they answer, and if they say yes they
get one chance to palm the thing they most want kept.

## 1. The rules

- Anyone picks somebody standing where they stand and presses **Search**. They
  get a DM with **Yes**, **No** and **Hide items**; **nothing happens until
  they press Yes or No.**
- **Hide items** opens a picker of what they could palm (§2). It is
  re-openable and changeable until they answer, and hiding is **not** an
  answer — the Yes/No pair stays where it is.
- On **Yes** a **d6** is rolled, whether or not anything was hidden.
  **Nobody is ever shown it** (§3b). Everything not hidden is revealed;
  of the hidden pile, `floor(die / 6 × hidden)` comes out, picked at random.
- On **No** the searcher is told *"{person} refused your search."* Nothing is
  rolled and nothing is revealed.
- **It costs no Move**, files no `Action`, and no turn pass touches it. What
  holds it back is one ration: **once per person per turn**, spent by the ASK
  (§3).
- Both sides must be at the same Location and both alive, and neither may be in
  a state that blocks `ACT`.
- **A hood does not refuse it** (§2a). A hood hides who you are, not what is in
  your pockets.
- Nobody else is told. The two people who were there are the only two who hear
  anything.

Constants and rules: `db/lib/search.js`. The hideable predicate lives in
`db/lib/medicalVision.js#hideableFromSearch`, beside `seenByBystander`.

## 2. What is at stake, and what may be hidden

Two different sets, and the difference is the whole of the Hide picker.

| | What it is | Where it comes from |
|---|---|---|
| **At stake** | everything **cargo** they carry | `Tag.tradeable`, the Loot filter |
| **Hideable** | of that, the `HIDDEN` and `WORN` ones | `Tag.inspectVisibility` |

**`visible: true` can never be hidden.** An `ALWAYS` tag is seen standing in
the road — the 🔍 inspect embed already prints it to anybody who asks — so
offering to hide it would be a lie, and it is revealed by every search whatever
the die says.

The readout carries a second line, *"In plain sight"*, and it holds the
`ALWAYS` rows that are **not** cargo: scars, statuses, a visible affliction.
That is the half a search was never about. An `ALWAYS` row that IS cargo — a
longbow over the shoulder — belongs in the pockets list and appears there once;
printing it in both read as the search finding the same bow twice.

**`visible: named` cannot be hidden either**, and it is not in the spec because
it is not really an item property: `NAMED` means "seen while you are under your
own name", which is an identity rule. Letting it be palmed would make it a
second hood.

**The allowlist fails open, and that is the deliberate half of a real trap.**
`seenByBystander` is a *vision* gate, so it fails closed by **hiding**;
`hideableFromSearch` fails closed by **revealing**. A fifth `TagVisibility`
value would therefore arrive searchable and unhideable, quietly. That is the
safer of the two wrong answers — a new tag leaking is a bug somebody notices,
a new tag being secretly unfindable is not — but it is still a wrong answer, so
a new enum value has to come back to that function.

Read it through `hideableFromSearch()`, never by comparing the enum at a call
site ([`TAGS.md`](TAGS.md) §5). It is genuinely a **second** predicate rather
than a wrapper around the first: an equipped `WORN` dagger **is** seen by a
bystander and is still hideable from a search, so `seenByBystander` cannot
answer this question.

### 2a. A hood is not a refusal

Kiss refuses a covered face outright (`KISS.md` §2). Search deliberately does
not, and `searchAuthority` passes `allowConcealed: true` to
`presence.js#isHere` — the second caller in the game after Transfer.

That makes Search the **first Offer kind either end of which may be hooded**,
and that had consequences well outside this file. Every other kind refuses a
covered face at the gate, so four surfaces had been free to print
`Character.name` straight:

- the waiting-on-you list in `/chat` (`chat/actions.js#waitingOnYou`),
- the sheet's pending-offer line (`character/page.js` → `SheetTurn.js`),
- the decline wording (`lessons.js#declineOffer`),
- and the turn-close expiry notice (`offerExpiryPass.js`).

All four now go through `seenAs(identityOf(row))`. Without that, asking to
search somebody while hooded would put your real name in their own to-do
list — the exact unmasking [`INTERCEPT.md`](INTERCEPT.md) §2 built `seenAs()`
to close. **Every line this verb speaks names both sides by the face the room
saw**, the refusals and the audit rows included.

## 3. The ration is a table, not an AuditLog count

`SearchAttempt`, and the `@@unique([searcherId, targetCharacterId, turnId])`
**is** the rule — the insert is the claim, the `InterceptHit` discipline
(`INTERCEPT.md` §5).

This is the one place Search does **not** copy Kiss, and the reason is worth
keeping. `applyKissMood` counts `AuditLog` rows because that ration is
idempotent and harmless to lose: a kiss that moves no dial is still a kiss. A
count-then-create is not race-proof, and `createKissOffer` gets away with it
only because a two-hour ask cooldown stands behind it.

Search has no cooldown, and its ration is **spent by the ask and not refunded
by a No** — so it has to survive a refusal, which a pending-duplicate query
cannot do, because a refused offer is not pending any more. The unique is what
makes it honest.

It is keyed to the **searcher**, never to the offer. An offer is churn — asked,
refused, asked again — and keying the ration to one would make refusing a way
to be asked all afternoon.

Three audit actions, and like Kiss's three they are not interchangeable:

| `actionType` | Written by | What it is for |
|---|---|---|
| `search` | the ask (`createSearchOffer`) | the record of asking; `presented`, never the row name |
| `search_accepted` | `acceptSearch`, one per side | the record of what was found, and **the only place the die is written down** |
| — | | there is no third: the ration is `SearchAttempt`, not a row here |

Both set `turnId` (`REQUESTS.md` §1a).

### 3a. Hiding one thing beats hiding five

The floor is the whole texture of the verb, and it is the opposite of what a
player will guess. Hide **one** thing and it survives anything but a 6 — an
83% hold. Hide **five** and a 3 gives two of them away.

Nobody can work this out from play, because the die is never shown and the
sample is one roll. So the game says it out loud instead: the Hide picker
prints a line about it on both faces. `db/test/search.test.js` pins it.

The dominant play is therefore to hide the single most incriminating thing and
let the rest be found, so the readout reads complete and honest. That is the
intended texture, not an accident of the arithmetic.

### 3b. Nobody sees the die

Not the searcher, not the target, not the room. There is no roll line anywhere,
and `formatAdvantage()` has nothing to print into.

It lives on `Offer.outcome` — `{ die, rolls, advantage, hiddenCount,
revealedTagIds }` — so a GM auditing the row can see exactly what happened. No
player surface reads that column.

**One admission.** The roll goes through `db/lib/advantage.js#rollWithAdvantage`
because that is the repo's rule for every d6 a character throws, which means
**Lucky quietly applies here** — a Lucky searcher rolls twice and keeps the
better, permanently and unobservably. That is defensible (Lucky is meant to be
quiet) but it is a real rebalance of Lucky into a search skill, so it is written
down rather than left to be discovered.

## 4. Where it dies

Three ways, and only the first is new code.

- **Somebody walks away.** `cancelSearchOffersOnMove`, called from
  `locationMove.js#applyLocationMoveSideEffects` beside `cancelWatchOnMove` —
  the writer *every* relocation runs, so a GM teleport, a Bulk Move and a rite
  end it as surely as legs do. Above the `DISCORD_TOKEN` guard, the
  `recordArrival` reasoning: the offer dying is a database fact and must not
  depend on there being a token; only the letter waits for one. Behind
  `fromLocationId`, so a revive and a first placement are not moves.

  **The test is CO-LOCATION, not "somebody moved", and that is load-bearing.**
  `performLocationMove` fires the watches — which is where an auto-search offer
  is *born* — and only then does its caller loop
  `applyLocationMoveSideEffects` over everyone who arrived, landing here with
  the fresh offer's own responder as the mover. A naive "they moved, so cancel"
  killed every auto-search the instant it was created: ration spent, consent DM
  delivered with dead buttons, and the interceptor told their catch had walked
  away while the two of them stood in the same room. Asking where both of them
  are *now* is immune to that ordering and says the truer thing besides.

  A consequence worth knowing: two people who **travel together** keep their
  pending search. Nobody walked away from anybody.

  It fires for **either** party. The line always goes to the searcher and always
  names the responder — which of the two is which depends on which end moved,
  and getting that backwards does not crash, it just quietly tells the searcher
  that they themselves walked away. The searcher is told:

  > {person} refused your search and walked away.

  Worth knowing: that is the line **whichever** of them moved, so a searcher who
  walked off themselves reads a sentence that blames the other party. It is the
  settled wording.

  **The ration is not refunded** — the ask spent it (`KISS.md` §4), or walking
  out of a room and back in would be a free second attempt.
- **They never answer.** `offerExpiryPass.js` expires every PENDING offer at turn
  close, kind-agnostically, so this is free.
- **Somebody dies.** `characterDeath.js` voids PENDING offers already.

### 4a. Which half of the answer goes where

`dmAnswer.js#answerOffer` hands `line` back to **whoever pressed the button** —
the responder, the person being searched — and fans `dms` out to whoever each
one is addressed to. So `acceptSearch` returns the **target's** readout as
`line` and the **searcher's** as an addressed DM to the initiator.

Worth writing down because the two are the same shape and swapping them does
not throw: it just tells each of them the other's sentence, with their own name
in it as the person doing the searching.

## 5. The third button

The one piece of genuinely new plumbing. Yes and No wear
`OFFER_ACCEPT_PREFIX` / `OFFER_DECLINE_PREFIX` unchanged — the
`escortButtonRow` trick, same custom ids and different chrome — so the bot's
router and the web's `DmActionRow` reach `acceptSearch` with **no new branch**.

**Hiding is not an answer**, and that is why it is not a `DM_CHOICE`. It edits
a pending row, the Yes/No pair has to survive it, and the picker has to be
re-openable. So it gets its own prefix and its own label slot:

- `SEARCH_HIDE_PREFIX` (`search:hide:`) — the button on the DM.
- `SEARCH_HIDE_PICK_PREFIX` (`search:hidepick:`) — the select inside the
  ephemeral that button opens.
- `DM_ACTION_LABELS.SEARCH` — a **variant**, the way `ESCORT` is, so the KIND
  stays `OFFER` and every reader of that table keeps working. `hide` is a
  fourth slot beside `partial`.

It is deliberately **not** `partial`: that slot is the tax's number field, the
web renders it as *"How much do you want to pay instead?"*, and
`chat/dmActions.js` truncates its payload to six characters.

**Two Discord traps, both about which message is being edited.**
`handleSearchHideOpen` must **not** call `settle()` — that strips the
components, which is how Accept and Decline finalise — so it replies
ephemerally and leaves Yes/No on the DM. `handleSearchHidePick` then updates
that **ephemeral**, never the DM.

**Discord caps a select menu at 25 options**, and `max_values` must track the
slice or the whole component is rejected. The picker shows the **25 heaviest**
stacks and prints a `-#` line saying so, pointing at the website. The web face
has no cap and draws the whole sheet.

## 6. The Intercept box

`InterceptWatch.autoSearch`, off by default: when this watch catches somebody,
also ask to search them.

**It buys the ask and never the answer.** The consent DM is the ordinary one,
No is a real answer, and the hide picker works exactly as it does by hand.
Catching somebody is not being handed their pockets.

Three things about it are deliberate:

- **It is not a "who".** The three chips above it in the dialog say who a watch
  catches; this says what happens once it has them. So it sits under the mode
  picker rather than in that row, nothing clears it the way *Any person* clears
  *Any concealed person*, and a watch with only this ticked still catches
  nobody — `fireWatches`' own `WHERE` needs a who.
- **It runs last**, after the `InterceptHit` ration has claimed the catch and
  after an Ambush has filed. An Ambush that filed nothing caught nobody
  (`hit.held`), and searching somebody you did not actually stop would be a lie.
- **A spent ration is not silent, and not loud.** The target is told nothing —
  they must not hear about a search that never happened. The person who ticked
  the box gets a `-#` line under their own catch confirmation, because silence
  there reads as a bug. Only reachable when the same searcher already searched
  the same person by hand this turn, since `InterceptHit` is itself once per
  person per turn.

`fireWatches` requires `db/lib/search.js` **lazily**, at call time, for exactly
the reason it requires `attack.js` that way: search.js requires this module back
for `seenAs` / `identityOf` / `IDENTITY_SELECT`. A cycle resolved at call time,
so neither half ever sees a partial exports object.

## 7. Known warts

- **No ask cooldown.** The ration is per *person*, so one turn buys an ask at
  everybody in the room at no cost, and that is a lot of DMs. Kiss has a
  two-hour ask cooldown for precisely this (`KISS.md` §4). Search was shipped
  without one on purpose — a search is a public, social act in a way a kiss is
  not, and refusing costs the refuser nothing — but if the picker turns into a
  way to pester people, the brake is one constant.
- **A hood coming off makes an unreadable refusal.** Search "a young man" on
  turn 7, he unhoods, press Search on *Lord Greeblus* and you are told *"You
  already searched Lord Greeblus this turn."* — naming somebody you were never
  told about, off a search you do not remember making. The ration is keyed to
  the id, which is correct; the refusal string is the leak, and it is a small
  one in the harmless direction (it tells you two faces were one person, after
  they chose to show you).
- **Stacks are all-or-nothing.** `CharacterTag` is
  `@@unique([characterId, tagId])`, so "hide two of my three daggers" has
  nowhere to live. Hiding a row hides the stack.

## 8. Where the code lives

| File | What |
|---|---|
| `db/lib/search.js` | the rules, the arithmetic, the readout, the offer |
| `db/lib/medicalVision.js` | `hideableFromSearch` |
| `db/lib/tradeable.js` | `isTradeable`, lifted out of `web/lib` so db/ can read it |
| `db/lib/offerRow.js` | `searchButtonRow` and the two prefixes |
| `db/lib/dmActions.js` | the `SEARCH` label variant, with its `hide` slot |
| `db/lib/dmAnswer.js` | the one-line accept branch |
| `db/lib/intercept.js` | the auto-search pass in `fireWatches` |
| `db/lib/locationMove.js` | the walk-away cancel |
| `db/test/search.test.js` | the pure half |
| `web/app/(app)/character/actions/offers.js` | `searchRequestImpl` |
| `web/app/(app)/chat/dmActions.js` | `loadSearchHideables`, `setSearchHidden` |
| `web/lib/peoplePools.js` | `searchParties` (hood-capable) |
| `web/app/components/actions/SearchDialog.js` | the asker's picker |
| `web/app/components/SearchHidePanel.js` | the responder's picker |
| `bot/src/lib/offers.js` | the Discord hide picker |

`SearchAttempt` is no longer the only table of this shape: `PickpocketAttempt`
([`THEFT.md`](THEFT.md) §2d) is the second, for the same reason §3 gives here —
no cooldown behind it, and a ration that has to survive a bad outcome. It goes
one step further and carries the authorization for a second act as well.
