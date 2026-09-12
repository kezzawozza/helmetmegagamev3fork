# Adjudication

`/gm/turns` — the workspace where GMs arbitrate the turn. Rebuilt around one
rule after the first playtest broke the old flow:

> **Nothing a GM decides touches a player until the turn ends.**

A player locks in a Move; GMs spend the day *staging* — the canonical result,
private messages, public declarations, mechanical adjustments — all of it
freely editable until the turn-end cron (00:00 America/Chicago, nightly,
`TURN-ENGINE.md`) applies and delivers everything in one push. No more
resolve-a-move, DM-a-player, resolve-the-next drip: the whole turn lands at
once, for everyone.

## 1. The staged-arbitration model

Three kinds of staging, all held in real tables (not browser state — a GM's
day of work survives a refresh):

| What | Model | At the push |
|---|---|---|
| **Private messages** | `StagedMessage` (kind `PRIVATE`) + `StagedMessageRecipient` | One DM per recipient character's player, `»`-prefixed, logged to `DirectMessage` like every DM. |
| **Public declarations** | `StagedMessage` (kind `PUBLIC`, required `zoneId`) | Posted to **the row's own zone `#summary`** — except underground, where there is no `#summary` at all: a `CAVE_LEVEL` zone (Caves, Depths) fans the declaration out to **every Location channel in the level**, one `Delivery` row per channel (`db/lib/publicPostTargets.js`). Full size and verbatim in both places; a declaration is a GM speaking, not scenery, so it wears no `-#`. If there is nowhere at all to post — an unprovisioned `#summary`, or a cave whose Locations have no channels yet — the post is skipped and recorded on `deliveryFailures`, never lost. A post survives the wipe that runs later in the same push: the wipe only deletes what predates the push (`CHANNELS.md` §8). The cave copies then live under the Location cadence, which is **every** turn rather than Dawn-only, so they get one turn where a `#summary` copy gets up to two. |
| **Mechanical adjustments** | `StagedEffect` — `payload` `{ resources?, tagPoints?, tagOps?, zoneId? }` per target character | Resources through `addResources`' clamp, tag ops through `db/lib/tagOps.js` — the same engine the Dev Panel applies with, so a staged `remove` leaves the tag's treated-wound aftermath behind (`Tag.removesInto`, `TAGS.md` §5c) and records it as `granted` on the snapshot. `tagPoints` is an unclamped increment (a GM may take points back, and negative is legal). `appliedEffect` snapshots what actually moved (the payload-vs-effect rule from `REQUESTS.md` §2). EffectComposer's `+ Add` row carries a quantity stepper, so a GM can stage several at once; asking for more than one of a non-stackable tag stages `force: true` right alongside it (`TAGS.md` §5a). |
| **Transfers** | `StagedEffect` — `payload` `{ transfer: { from, to, amount } }`, mutually exclusive with `resources` | A character-to-character ⬢ move, not a mint/burn from nowhere, via `db/lib/parties.js` and `db/lib/resourceTransfer.js#applyTransfer` (the same primitive a player's Transfer and every GM transfer surface use). Staged from the tray's own "+ Transfer" button (`TransferComposer.js`), separate from the multi-target Effect composer because a transfer is 1:1 by nature. |

### 1a. One row per send: the `Delivery` table

**Every send a staged message makes has its own row** — one per PRIVATE
recipient, and one per CHANNEL a PUBLIC row posts into (a single `#summary`,
or one per Location for a cave fan-out) — and `db/lib/stagedDelivery.js` is the
only code that writes them. The push and the **Resend** button run the same
function.

They did not, and all three problems that caused were the same problem: nothing
recorded what happened to *one* recipient.

- The push recorded its progress as a step key on the closing turn
  (`delivery:<messageId>:<index>`) and swallowed each bounce inside the step —
  so a recipient whose DMs were closed was written down as **done**, and no
  resumed push ever tried them again.
- The key carried a loop **index**, so removing a recipient between a crash and
  its resume shifted everybody else's key onto somebody else's send.
- Resend was a second copy of the sending logic, reading the `deliveryFailures`
  JSON to work out who to retry — and it forgot the `/play` row that a public
  post writes, so a resent declaration reached Discord and never reached the
  Hall.

How it works now:

- `stagedPush.js` writes the PRIVATE rows **at selection**, before anything
  sends (`createMany` with `skipDuplicates` on the unique `dedupeKey`), so a
  push that dies after the first DM finds the rest sitting there `PENDING`. A
  PUBLIC row is not pre-written: `deliverPublic` is the only thing that ever
  touches it, and it writes the row itself.
- `dedupeKey` is `staged:<messageId>:<characterId>` — the **character**, not
  their Discord account, and never a position
  (`db/lib/dmPolicy.js#dedupeKey`). Keying on the Discord id looked equivalent
  and was not: a recipient who has never linked Discord has a null id, so every
  such recipient shared one key, `skipDuplicates` collapsed them into a single
  row, and the rest were neither delivered to nor listed as failing. A PUBLIC
  row's key ends in `public` for the same reason — that shared empty tail was
  also the one a public post used.
- **A cave fan-out's rows key on the LOCATION**, `public:loc:<locationId>`, and
  a `#summary` post keeps the bare `public` tail it has always had. That second
  half is load-bearing rather than tidy: production is full of
  `staged:<id>:public` rows, and changing that tail would write a second row on
  every declaration ever pushed — which reads as *never attempted*, so one GM
  pressing Resend re-posts a declaration already sitting in the channel.
  `db/test/stagedDelivery.test.js` asserts the surface key byte-for-byte.
  The Location and **not its channel id**, because `db:sync-zones` and the
  channel doctor both rewrite `Location.discordChannelId` on re-provisioning: a
  channel-id tail would orphan a SENT row the moment that happened, and the next
  push would post the declaration into the same room twice. Same lesson as "the
  character, not their Discord account" directly above.
- Each send **claims** its row first: `updateMany` from `PENDING`/`FAILED`
  (or a stale `IN_FLIGHT`) to `IN_FLIGHT`. Count 0 means somebody else has it —
  a concurrent push, or a GM pressing Resend mid-push — and this run sends
  nothing. That claim is the whole no-double-send promise;
  `db/test/stagedDelivery.test.js` is what holds it.
- A claim goes stale after **five minutes**, not the thirty
  `Turn.sideEffectClaimedAt` uses: that window covers a whole side-effect thunk,
  this one covers a single DM. A row still `IN_FLIGHT` past that window counts
  as **retryable** — for the claim, and for the Resend button's own "did
  anything fail?" gate, because a process killed mid-send left a player with
  nothing and never got to write down that it had.
- **A send that landed is never written down as a failure.** The send and the
  stamp that follows it are separate `try`s: if the database hiccups on the
  stamp, the row stays `IN_FLIGHT` and the log says so loudly. Marking it
  `FAILED` would invite the next attempt to send a DM the player has already
  read. The public half is the same shape — post, stamp, and only then the
  `/play` row, whose own failure costs the web feed one line and never costs
  Discord a second post. A fan-out has one post-and-stamp pair **per channel**,
  but still exactly **one `/play` row per message**: the Hall row is the zone's,
  and `db/lib/feedAccess.js` gives a cave character their zone's feed already,
  so seven copies of one declaration is precisely what a fan-out must not
  become. It is written below the loop, gated on at least one channel having
  landed — which is what keeps Resend's `writeSceneLine: !posted` correct now
  that a run can land partly: any SENT row means a run where something went
  out, and that run wrote the row.
- `StagedMessage.sentAt` and `deliveryFailures` are still written — the tray,
  the missed-push banner and every already-pushed turn read them — but they are
  **derived** from these rows now rather than being the only record. So a
  recipient whose retry finally lands drops off the failure list by itself.

The tray reads the rows too: the status pill counts them (`Sent · 1 failed`,
`Sending…`) and one line per recipient says what happened, instead of the single
`Sent, some failed`.

**A message pushed before this table existed** has a `sentAt` and no rows at
all, and production is full of them. The first Resend on one **reconstructs**
the rows from the only two things the old code wrote down — `sentAt` says every
recipient was attempted, and the `deliveryFailures` blob names the ones that
bounced, so everybody else was delivered to
(`stagedDelivery.js#backfillLegacyDeliveries`). Without that, the shared path
would write those rows fresh as `PENDING`, which reads as *never attempted*, and
one GM pressing Resend would re-DM every recipient who had already read the
message and re-post a declaration already sitting in the channel. Resend is
therefore **always** `onlyFailed` now; it has no "retry everyone" arm left.

**Resend reports three numbers, not two.** Sent, still failing, and **held** —
a row a push running right now has claimed. A held row is neither a send nor a
bounce, and leaving it out of the audit row made the counts fail to add up,
which reads as lost mail.

`Delivery` raises the desk's live channel through its **parent**: the trigger
notifies `bascinet_desk` with `{"t":"message","id":<stagedMessageId>}`, because
no desk row is a Delivery and a second GM's screen should not have to wait for
`StagedMessage` itself to be written next.

### Long messages split; they are never truncated

Both kinds cap at **6000 characters** (`GM_MESSAGE_MAX_LENGTH`), which is about
three Discord messages, not one. Anything over Discord's own 2000-character
limit is split by `chunkMessage` (`db/lib/chunkText.js`) and sent as several
messages in order — DMs through `postDmBatched`, public declarations through
`postMessageBatched`. The split prefers blank lines, so paragraphs stay intact;
only a single paragraph that alone exceeds 2000 is cut mid-sentence. The `»`
prefix lands on the first chunk only, which is what the prefix rule means
anyway.

The composers show the count and refuse to stage over the cap, leaving a long
paste **visible and trimmable**. They deliberately carry no `maxLength`: that
attribute silently truncated a long paste at 1990 with no error and the Stage
button still enabled, so a GM could post two thirds of a declaration and never
find out. Anything that shows a character counter in this app should block
rather than cut, for the same reason.

Two consequences worth knowing:

- **A multi-chunk declaration still survives the wipe.** The wipe's cutoff
  is the side-effect thunk's start time, and the public-post loop runs earlier
  in that same thunk, so every chunk postdates the cutoff. That holds for a cave
  fan-out too — its copies sit in Location channels, which are wiped every turn
  rather than Dawn-only, so they survive the turn they landed in and go with the
  next one.
- **Resend re-posts the whole body.** `postMessageBatched` and `postDmBatched`
  are sequential and throw on the first chunk that fails, so a failure partway
  leaves the earlier chunks delivered. Resending then duplicates them. This is
  rare by construction — a 429 is already retried, so the realistic failure is a
  channel that is gone or forbidden, which fails on chunk 1 and leaves nothing
  partial. It is not worth per-chunk bookkeeping; just delete the duplicate.

A staged message takes a *set* of recipients — you need to tell different
people different things, so a Move carries as many messages as the truth
requires, and a message needn't belong to any Move at all (the tray's
composers). A mass-apply ("Explosion Burns onto these four") writes one
`StagedEffect` per target under a shared `batchId`, so the tray shows and
deletes it as one line. Editing a batched row detaches it from its batch.

Rows freeze only when the push stamps them (`sentAt` / `appliedAt`). Until
then any GM may edit or delete any staging — concurrent GMs *append*
independent rows and merge harmlessly; edits to the same row are
last-write-wins, which five GMs can live with.

**Move links detach, never cascade.** `moveId` is `SetNull` on both staged
models: rejecting a Move (deleting its Action) leaves the staged work in the
tray as "unattached" for the GM to keep or drop.

## 2. What a Move is now

- **Submit = locked.** The Move modal is one shot ("Lock In Your Move");
  there is no draft window and no player edit. The GM-side escape hatch is
  **Reject**: deletes the Action, frees the turn, DMs the player "Your Move
  was returned to you — you can act again this turn." plus the reason,
  immediately — the one thing the desk sends in real time, because a freed
  turn the player doesn't know about is a wasted day. (The stored
  `source: "move_unlock"` / `actionType: "move_rejected"` values predate the
  rename and are kept — renaming them would orphan old audit rows and DM
  log entries.)
- **Declared numbers always pay.** Every confirmed Move's own
  `resourceDelta` (now only ever machine-written — the Labor roll; players
  can no longer type a delta at all) applies at the push, solved or not. A GM
  who disagrees stages a counter-effect; the composer's "offset declared"
  prefill is that in one click. Nothing pays at confirm any more — Routines
  and Labor included.
- **Solve is bookkeeping.** It stores the Result and Kind edit, stamps
  `reviewedBy`, and marks the staging complete. It applies nothing;
  Unsolve reverts nothing, because there is nothing yet to revert.
- **Silent close.** A Move still `OPEN` at the push closes `PASSED` with
  `auto:silent_close` appended to `gmNotes` and pays its declared numbers.
- **Every Routine gets a close DM**, whatever its review status, built to
  match the auto-labor DM: the description, `**Applied:** …`, and the
  resource roll. This is the *only* place a hand-filed Routine's payout is
  reported — nothing pays at confirm — so a player who declared used to learn
  less about their turn than one who slept through it. A **tail** ("passed
  without any special adjudication notes…") is appended only when nothing else
  spoke for the Move; a private staged message that actually went to *that*
  player, or a staged effect targeting them, drops the tail and keeps the
  summary. The one skip is `gmNotes` carrying any `auto:` marker — a default
  move and a travel stub send their own DM, and this would double it. Gambits
  are excluded here and get their die reveal instead.
  See `TURN-ENGINE.md` for where in the push it fires.
- **A Gambit's die is revealed by the push, and only by the push.** The d6 is
  rolled and stored at submit so the desk has it immediately, but the player
  reads it in one DM at the turn close (`formatGambitRollDm`,
  `db/lib/stagedPush.js`) — landing beside the staged private messages that
  say what it actually did. Nothing else shows a player their own roll: not
  the confirm DM, not `/character`. Every confirmed Gambit gets the DM
  regardless of what else the push sent them.
- **Some Gambits never reach a GM at all.** A heal Gambit (`TAGS.md` §5c)
  sits OPEN on this desk because a GM has to read the roll and decide what it
  did. Lessons and Research don't: each is resolved entirely by its own turn
  pass — Lessons rolls, grants and DMs a learner before this desk ever sees
  the row; Research does the same for a Scholastic's studied ingredient
  (`TURN-ENGINE.md` §2, `CRAFTING.md` §2b) — so by the time either shows up
  here it is already `SOLVED`, `resultMessage` filled in, and the DM already
  sent. The row still surfaces between file and close like any other Move; a
  GM overwriting `resultMessage` on it is a real edit, not a no-op, and the
  written line stands — the same guard a Lesson's own GM-authored result
  gets.
- **One auto-filed craft Routine can hold several crafts.** Still one Action
  per character per turn — that does not move — but a craft may cost a
  *fraction* of it, so the row reads "Crafting this turn: 2× Alcohol, 1× Cat.
" and carries a ledger in `Action.craftBudget` (`CRAFTING.md` §2a).
  Rejecting it hands back the whole turn, every craft in it included; there
  is no per-craft Undo — a GM reversing one craft works by hand from its
  audit row, and no budget comes back with it (`CRAFTING.md` §2a).
- **The Result box is canon.** One GM-facing field (`resultMessage`) holding
  what actually happened. `gmNotes` survives as a column for the `auto:*`
  machine markers only and renders nowhere.

## 3. The workspace

A full-viewport workspace: `web/app/(desk)/gm/turns/`, in the `(desk)` route
group with no PageShell and no centred max-width (the sanctioned deviation —
tokens and the shared control classes still apply; the `.desk-*` family in
`globals.css` is its layout). It **does** carry the nav rail, which is how you
leave; `/gm/players` is its sibling in the same group.

The route is `/gm/turns/[[...selection]]`, and the URL carries which row is
open **in a search param** — `/gm/turns?sel=move/<id>`,
`?sel=caving/<id>`, `?sel=history/<id>`. Build one with
`turnsSelectionHref` (`web/lib/routes.js`) rather than by hand. Selection
changes never touch the server — `setSelected` is `useState` and the URL is
mirrored with `history.replaceState`, so picking a row leaves the queue, every
DTO, the inspector cache and the tray untouched.

**A search param, never a path segment, and that is load-bearing.** It used to
be a path (`/gm/turns/move/<id>`), and that is what made the desk "randomly
redraw and wipe what I was typing". Next patches `history.replaceState`, so
mirroring the selection in moved the router's canonical URL with it; the next
`router.refresh()` — every mutation does one — refetched the route with
*different dynamic params*, which Next treats as a different segment and
**remounts**. The workspace, the rail, the open Move and every piece of React
state under them were rebuilt: the Result box, an open composer, the
inspector's zone view, the selection itself. No navigation, no reload, nothing
in the console. Measured: 5 of 5 refreshes remounted before, 0 of 5 after.
A search param changes no segment, so the same refresh is a plain props
update. The old path URLs still work — the catch-all route stays and redirects
onto the query form, so nobody's bookmark breaks.

Two more guards sit behind that one. `SnapshotPage` (`web/lib/snapshot/`)
holds the last payload it painted, so a snapshot scope nothing has been stored
under yet never swaps a live desk for the route skeleton. And `deskStore.js`
only lets a payload wipe the queue or prune drafts if it is not OLDER than the
last one seeded — a stored snapshot from a previous turn used to be able to
delete the draft being typed.

**The black box.** `blackBox.js` keeps the last ~20 desk events (mounts,
selections, resets) in `sessionStorage` and prints one
`desk reset: <reason chain>` line when the workspace mounts twice without a
reload, or when a panel opens onto a draft it never saved. If the desk ever
resets itself again, that line is the first thing to ask a GM for.

Two consequences worth knowing. The route file has to genuinely exist, because
the desk polls `router.refresh()` against the *current* URL and a GM parked on
a selection would otherwise 404 on the first poll. And a revalidation of this
page must be `revalidatePath(TURNS_PATH, "page")` (`web/lib/routes.js`) — a
dynamic route needs its pattern, not a path that happens to match it. Only
the **cross-page** actions carry that call now (depot, store, dev panel,
player desk…); the desk's own actions dropped theirs. What is left in
`actions.js` is only ever another page's — `/character` after a Reject or a
portrait takedown, `/gm/audit` after a fight is called off — never this one's.

### What the Move desk looks like

Top-down, the card is one job: who and where (with the side trips — Message
them, Past moves, the dev panel — behind a `⋯` menu so `Close` is the only
other control in the header), then the Move as they wrote it, then the Kind /
Dice / Declared line, then **the Result box as the visually primary panel** —
a raised surface with an accent edge, because it is the thing a GM came here
to fill in and it used to be the fourth of five identical hairline-ruled
slabs. Staged rows come after it, then Reject / Save / Solve.

The Kind switch's consequence line ("Saving rolls a fresh d6…") is always
rendered, empty or not, so changing Kind no longer shoves the Result box down
the screen mid-sentence.

Staged rows are two lines now: what it will do, then a quiet line carrying who
staged it and which turn. Delivery detail rides the state pill's tooltip — a
**bounce stays spelled out**, because it is the one thing on a staged row a GM
has to act on.

### Narrow screens

Three fixed columns crush the middle one on anything smaller than a big
laptop, so the desk drops a column at a time (`DESIGN-SYSTEM.md` §9 has the
rules; this is what a GM sees).

- **Under 1024px** the inspector is no longer beside the work. An
  **Inspector** button in the desk header opens it as an overlay from the
  right, and `Close inspector` inside it puts it away; clicking any character
  name opens it too, so looking somebody up still answers. Whether it is open
  is per-tab view state, shared with `/gm/players` so it stays as you left it
  between the desks.
- **Under 800px** the queue and the open row take turns. Picking a Move hides
  the rail and gives the Move the screen, with **← Back to queue** at the top
  of it — the same deselect the panel's own Close does, dirty guard included.
  Nothing picked, and the queue is the whole desk.

Above 1024px nothing changed: three columns, as before.

### The desk owns its own rows

What the workspace draws is not its props. Every row page.js ships is folded
into a client store (`deskStore.js`), the workspace reads its Moves, Caving
rolls and staged rows back out of it, and **every mutation hands back the rows
it changed** — `patch`, built by `web/lib/deskRows.js#deskPatchFor` and folded
into the same store. So a Solve marks the row Solved because the Solve
happened, not because a page refetch came back afterwards and said so.

That distinction is the whole point. The desk used to write, call
`router.refresh()`, and hope: when the refresh didn't run — the deploy-stale
gate had latched (`useDeskVersion.js`), or the answer raced something else —
the write had landed in the database and the screen never moved. A GM pressed
Solve, saw Solve still offered, and pressed it again. Nothing on the desk waits
on a refetch any more. The 120-second poll is a correctness backstop, not the
way anybody's work appears.

**The reconciliation rule.** Every row carries `asOfMs`, the database's own
clock at the moment it was read (`web/lib/pgClock.js` — never the web
container's `Date.now()`, because the two machines drift and a few hundred
milliseconds the wrong way is enough to make a fresh row lose to a stale one).
A newer read replaces a held row **whole**; a tie keeps what is held. Never
field by field: the fields of one row came from one consistent read, and half
of a fresh row over half of a stale one can say things neither read ever said.
A page payload is additionally authoritative about **membership** at its own
stamp — a row it doesn't name, whose held copy is no older, is gone, which is
how another GM's Reject reaches you. A patch never is: it says "these
changed", never "and nothing else exists". Deletes are remembered as
tombstones, capped, so a payload already in flight when a row was deleted
can't put it back.

A GM's own half-typed text is not in the store and never should be. The Result
box and the Caving notes live in `deskDraft.js`, keyed by row and mirrored to
`localStorage`, which is what lets a payload land underneath a GM mid-sentence
without taking the sentence with it.

### The live channel

The other GMs' half. Four Postgres triggers announce every change to an
`Action` (column-scoped), a `CavingRoll`, a `StagedEffect` or a `StagedMessage`
on `bascinet_desk` (`db/lib/deskNotify.js`, migration
`20260921030000_desk_notify`); `web/lib/feedHub.js` fans the bare `{t, id, op}`
out to every open desk; `/api/gm/desk-stream` coalesces a quarter-second of ids
and re-reads them in **one** `deskPatchFor()` call; `DeskStream.js` folds the
result through the very same `applyDeskPatch()` a button's patch goes through.
A frame from the stream and a frame from a Solve are indistinguishable once
they land, and the store's newer-wins rule arbitrates between them without
either knowing about the other.

Four things about it are deliberate.

**A trigger, not a `pg_notify()` in each writer.** The writers are spread
across all three packages — the actions here, `db/lib/stagedPush.js`, the
caving pass, `db/lib/moveEconomy.js`, the Dev Panel — and the next one is one
`create()` away. Same reasoning as `DirectMessage_notify` (CHAT.md §2b).

**The `Action` trigger is column-scoped.** `Action` is written on every filing,
every travel stub and the whole turn-end push. It fires only for the seven
columns a queue row actually draws — `moveReviewStatus`, `resultMessage`,
`moveKind`, `reviewedByDiscordUserId`, `lockedByDiscordUserId`,
`lockExpiresAt`, `appliedEffects` — plus every INSERT and DELETE, because a new
Move belongs on the queue and a rejected one has to leave it. A `craftBudget`
or a `confirmDmMessageId` write wakes nobody.

**The stream sends only what belongs on a desk.** `deskPatchFor`'s
`onDeskOnly` flag re-applies page.js's own membership rule — the open turn's
Moves and Caving rolls, staged rows of the open turn or not yet delivered.
Without it, closing a turn would deal a hundred of LAST turn's Moves onto every
open queue, because `stagedPush.js` stamps `appliedEffects` on all of them and
the store holds rows rather than queries. An id dropped this way is reported as
neither a row nor a removal: off the desk is not the same as gone.

**A frame for a row somebody is typing into is buffered, not folded.** Their
text is already safe — the draft wins over the row wherever one exists — but
the rest of the card would still swap, and a Kind switch flipping mid-sentence
is the desk moving while somebody writes on it. The frame lands when the draft
clears, which is what every save, solve and reject does. **Removals are never
buffered**: if another GM rejected the Move being written on, holding that back
would leave a GM narrating a row that no longer exists. **Nor is a Solve**, for
the same reason — a solved Move has nothing left to write on it, so the frame
lands and the editor drops its draft rather than showing half a sentence over a
Solved badge. And a frame is only ever buffered while an editor holding that
draft is actually **mounted**: a draft left behind on a row nobody has open is
recoverable text, not an interrupted sentence.

**Every patch carries its turn, and a patch for another turn is dropped.** A
mutation asks about rows by id and does not test whether they are still on the
desk, so a Solve pressed as the turn-end push lands comes back holding a row
from the turn that just closed. The store holds rows rather than queries, so
nothing downstream would catch it dropping into the new turn's queue —
`deskPatchFor` stamps the open turn on the patch and `applyDeskPatch` ignores
one that does not match the turn the desk is showing.

**No zone gate, matching the page — and that means the stream really does send
a GM rows from zones their `GmZoneView` excludes.** `/gm/turns` ships every row
and the rail filters client-side, so a GM widening their zones with a click
finds the rows already there; a stream that shipped less than the page would
make the click a lie. The zone seat on this desk is a **view**, not a
confidentiality boundary — every GM is trusted with every row, and what
`GAMEMASTERS.md` §1 gates is the Discord channels, not the desk's payload. If
that ever has to become a real gate, both halves move together: the page's
queries and the stream's `deskPatchFor`, not one of them. The stream is not a
gate in the other direction either — the route establishes the reader is a GM
and re-reads everything it sends; subscribing to the hub grants nothing.

When the hub's Postgres client drops and comes back, rows written in the gap
reached nobody. Unlike the inbox there is no cursor to re-ask from — a patch is
a list of ids, not a window in time — so the tab is told to fetch the page
once, through the same deploy gate every other refresh here goes through. If
the stream itself drops twice in a row, a "Catching up" chip says so
(`deskStreamStore.js`, `DeskStreamChip.js`) and the 120s poll carries the desk:
a live path that has quietly stopped is worse than one that never existed.

**One replica, and this depends on it.** The live channels behind the desks
(`web/lib/feedHub.js`) are a module singleton holding a single Postgres
`LISTEN` client on `globalThis`. That is correct for exactly one web replica
and silently wrong for two: each would hold its own hub, and a browser would
hear only whatever its replica happened to be told. Scaling `web` past one
instance is a change to the hub, not a slider.

```
┌ header: turn chip · push times · Preview push ─────────────────────┐
│ QUEUE RAIL      │  ARBITRATION DESK          │  INSPECTOR          │
│ Moves/Caving/   │  the selected Move or      │  Sheet · Tags ·     │
│ Other/History   │  Request: result box,      │  Moves · Archive ·  │
│ lens, zone-seat │  staged items, composers   │  DMs for the last-  │
│ filters, search │                            │  clicked one + pins │
├ PUSH TRAY: counts · every staged row · missed-push banner ─────────┤
```

- **Queue rail** — the open turn's Moves and Caving rolls, as
  selectable rows. **Shows only the zones the GM chose to see**
  (`GAMEMASTERS.md` §1) — a hard gate now, not the soft opening default the
  zone seat used to be, and a search does not lift it. The rail's own Zone
  dropdown narrows within that. The **Zones** control that sets it is at the
  bottom of the inspector, on the right. A live lock renders as a small `GmAvatar`
  chip beside the row's real status pill — **never as a status of its own**.
  It used to be: a Move under a live lock displayed "In Progress" regardless
  of its actual `moveReviewStatus`, which let a GM's OWN lock on a Move they
  had just Solved make the desk they were sitting in read back
  `solved = false` and offer Save/Solve on a row already SOLVED in the DB —
  the incident this section's model fixes. Search runs the shared
  `scoreMatch` engine (`web/lib/fuzzySearch.js`) over name, role, faction,
  both zones, Discord handle, tag names, Move/Request kind and status, and
  the free text (a Move's description, a Request's reason/summary, GM notes)
  — a bare word matches anything, `field:term` (`role:smith`, `zone:caves`)
  or `@handle` narrows to one field, and a query reorders the list by match
  strength instead of the default sort — Open Moves first, Solved then
  Passed sinking toward the bottom (a locked-but-Solved row sinks too — the
  avatar is just riding along), newest-first within each rank. The
  Kind/Status/Type/Reviewed dropdowns always list every value the enum has,
  even at `(0)`, so "Open" never looks like it vanished just because nothing
  is open right now — Zone stays derived from what's actually loaded. The
  whole view survives a reload, split across three `sessionStorage` keys by
  write frequency (`web/app/components/useSessionState.js`): `gm-turns-rail`
  (filters per lens, the two travel toggles, the active lens — subscribed,
  click-frequency), `gm-turns-desk` (tray open/expanded, the inspected
  character, the History turn — Workspace.js's half), and `gm-turns-view`
  (search text and queue scroll position per lens — unsubscribed
  `readSession`/`writeSession`, debounced with a `pagehide` flush, restored
  by a post-hydration one-shot in `QueueRail.js`).
  Auto-filed **Travel** Moves (`db/lib/travel.js#performTravel`, no
  Routine/Gambit to review) render as "Travel" and stay hidden by default
  behind a "Show N travel" toggle beside the Kind dropdown; picking Travel
  from that dropdown always overrides the hide.
- **Other lens** — everything holding somebody in place this turn: attacks,
  ambushes and Safe intercepts in one list (`ATTACK.md` §7). To a GM reading
  the queue those are one question — who cannot leave, and who is standing over
  them — and knowing it before reading the Gambits is the point. Named for the
  shape rather than the contents; it is where the next thing that is neither a
  Move nor a die goes. A row is one **fight**, not one pairing — a group ambush
  is one row — and everybody in it rides inline under the row with a chip each
  for what they filed, which flips the lens to Moves and opens that Gambit.
  Inline rather than a desk because the point of the lens is seeing at a glance
  whether anything is happening, and a fight you have to click twice to read is
  one a GM scrolls past. So a row still has **no desk**: clicking it, or `⏎`,
  opens the inspector on the person being held, and so does clicking any name
  in the strip. Each live pairing carries a ✕ that calls that one fight off.
- **History lens** — the same rail over any turn, the open one included.
  Its two parameters sit on **one line of selects** above the filters —
  **Showing** (Moves or Caving) and **Turn** (the open turn first, marked
  `· open`, then the resolved ones newest first). The kind used to be a second
  `.segmented` stacked directly under the lens segmented: same control, same
  width, two of the same four words, eight pixels apart, so the pair read as
  one eight-button control with nothing saying which row meant what. The lens
  picks the lens; inside History, kind is a parameter of the view exactly the
  way the turn is, so it is drawn the way the turn is. A GM used to have to go to
  `/gm/audit` to see what somebody did last turn. Nothing is loaded with the
  page: for a **resolved** turn the lens fetches on demand
  (`actions.js#getMoveHistory`) and caches it for the page view, so the open
  turn's desk never pays for history nobody opened and the 45s refresh never
  re-sends it. The **open turn** costs nothing at all — its rows come straight
  from the live queue data `page.js` already ships, so the two lenses can't
  disagree, and picking a row opens the ordinary **live** desk rather than the
  read-only one. (That also means `MoveHistoryDesk` never renders for an
  unpushed turn, so a declared-vs-paid or unsent-message display can't be
  incoherent, and `getMoveHistory`'s RESOLVED guard stays intact.) Rows go
  through the same mappers the live queue does (`web/lib/moveRows.js`); on a
  pushed turn they open a **`MoveHistoryDesk`**: the
  Move's kind, dice, what was declared, what actually **paid**
  (`appliedEffects`), the Result, and everything that was sent on it. No lock,
  no composers, no Solve, no Reject — but a staged row the push never carried
  keeps its Edit/Delete, and a failed delivery keeps its Resend, because those
  are the two things about a past turn that can still need doing. Setting
  **Showing** to Caving (`historyKind`) reads back
  that turn's Caving Die rolls instead, mapped by the same `cavingRollRow`
  the live Caving lens uses and opening a **read-only `CavingDesk`** — see
  `CAVING.md` §5.
- **Desk** — the selected item. For a Move: situation, dice, declared
  numbers, the Result box, everything staged on it, and the three composers. The
  **effect composer** is the longest dialog on the desk, so it is drawn as
  headed, ruled-off groups — Targets, What it does to them, Tag changes, Their
  tags, Add from the catalog — with a **sticky footer** carrying Cancel and
  Stage it. Unheaded, six unrelated zones ran together as one column of
  controls whose only landmark was a bare field label two thirds down, and with
  a tag catalog open the two buttons sat a full screen below the fields. The
  Tag changes group only renders once there is a change to show; a headed,
  ruled-off group holding nothing reads as a bug.
  Every button derives from `moveReviewStatus`, never from a display label or
  a lock: **Save · Solve · Reject** on an open Move, **Save · Reopen ·
  Reject** once it's Solved — Save stays live on a Solved Move (it edits
  freely; the status guard that used to block it protected nothing, since
  Solve is bookkeeping and nothing pays until the push), so fixing a Result
  after Solving no longer needs the Reopen → edit → re-Solve dance. For a
  Request: the old panel's sections, semantics untouched (§5). The
  90s cooperative lock, its 30s heartbeat and the `sendBeacon` release all
  carry over unchanged (`useMoveLock.js`,
  `web/app/api/move-lock/release/route.js`). Every card's meta line under the
  name leads with `roleTitle` (Move/Request/Caving desks alike), so who's
  acting reads at a glance before you open anything.
- **The composers do not cover the desk.** Every staging dialog here — message,
  declaration, effect, transfer, and the push preview — is **modeless**
  (`DESIGN-SYSTEM.md` §8): no backdrop, clicks pass through, and the header
  drags, so a GM can pull someone up in the inspector while writing about them.
  Escape only closes one while focus is actually inside it. Under 1024px they
  revert to ordinary blocking modals.

- **Inspector** — *"quickly pull up the guy he was talking to"*. Every
  character name in the workspace is a click target that swaps the column to
  that character: Sheet (live facts + gambit modifier), Tags, **Moves**, their
  archive slice, their DM thread. **Moves** is that person's own history —
  their newest 40 Moves on **past** turns, each row linking to
  `/gm/turns/history/<id>`. Both Move desks carry a **Past moves** button that
  opens it (`onInspect(characterId, name, "Moves")`). On `/gm/players` the
  same tab carries that desk's Canon section above the list, so this turn sits
  over everything before it (PLAYER-DESK.md §6). The header carries name, `@username`, and role on
  the line below, all from the roster DTO already on the client — no fetch
  needed just to see who someone is. A search box above the pin row
  (`InspectorSearch`, fuzzy-matched via `web/lib/fuzzySearch.js#scoreMatch`
  over name/role/faction/username/zone) opens anyone the same way, not just
  names already on screen. Pin the ones an arbitration keeps returning to.
  Fetched on demand via server actions, cached for the page view. Three quick
  edits live here too: the DMs tab carries a composer that sends immediately
  (»-prefixed, logged, not staged — `sendGmDm`, the player desk's own
  action, shared rather than reimplemented); clicking an archived
  line opens `ArchiveContextModal` (`web/app/components/`), the ~30 messages before/after it in the
  same Discord channel/thread with a jump link when the message still exists
  (`getArchiveContext`); and the Sheet/Tags tabs stage deltas in place — ✕ a
  held tag to stage its removal, click Resources or Tag points to stage a
  ± delta. All three route through the same `createStagedEffects` the tray
  uses, so they land at the push like any other staged effect. `EffectComposer`'s
  own tag browser carries a "+ Custom tag" door too (`CustomTagDialog.js`,
  `DEV-PANEL.md` §8a) for inventing a one-off tag against the composer's
  current targets without leaving the modal.
- **Tray** — the push, honestly: counts (including how many open Moves will
  silently close), every staged row with edit/delete, batches as one line,
  unattached and detached rows, and the composers for staging outside any
  Move. **Preview push** groups it all by recipient — the DMs they'll get,
  net staged deltas, their declared payout — plus the public posts.
- **Missed-push banner** — staged rows a resolved turn's push never carried
  (a crash, a validation skip, the turn-boundary race) stay visible here
  with one verb: carry them onto the current turn for the next push.

**Responsiveness.** Five GMs share this page for a day at a time, so it
keeps itself current and stays reachable from the keyboard:

- The queue **refreshes itself** every 45s (`router.refresh()`), paused while
  a modal is open, while any panel holds unsaved edits
  (`useDirtyGuard.js#isAnyDirty`), or while the tab is hidden — a GM
  mid-sentence never gets the page yanked out from under them. The header
  carries an "updated HH:MM" stamp, a **countdown** to the nightly midnight
  CT push, and an `N/M solved` progress chip.
- The poll is **version-aware** (`useDeskVersion.js` + `/api/desk-version` +
  `web/lib/deployVersion.js`): it only calls `router.refresh()` after the
  server answers with the same build the page rendered from. Refreshing
  across a deploy trips Next's build-mismatch fallback — a full browser
  navigation that destroys all view state — and this repo deploys many times
  a day, which is exactly how the desk used to "refresh for no reason". Now
  a deploy latches a quiet **"Updated — reload when ready"** chip in the
  header — whose tooltip says what a reload actually brings back: the rail's
  filters and scroll, who is open, and anything typed into a Result box or a
  reply, but **not** a half-filled composer (auto-refresh stands down until the GM clicks it), a switchover 5xx
  or dropped connection is a silently skipped tick, and once the flag has
  latched, a mutation that fails from the stale build says to reload
  (`mutationErrorMessage`) instead of "something went wrong". **That window
  is closed from both ends now.** Every server action hands its build back in
  its own result (`guarded()` in `web/lib/actionResult.js`), and the desks
  pass the result through `noteActionVersion()`, so the very first mutation
  after a deploy latches the chip rather than the next poll. And every
  refresh under the desk — the post-mutation ones included — goes through
  `safeRefresh` (`useRefresh.js`), which asks `/api/desk-version` first and
  simply does not refresh across a build boundary. A mutation that still
  throws Next's `UnrecognizedActionError` (the action ids died with the old
  build) latches the chip on the way past, instead of reaching `error.js`
  and taking the column away.
- **Keyboard**: `↑↓` / `j k` walk the rail, `⏎` opens the focused row,
  `m`/`r`/`c`/`o`/`h` flip the lens, Escape peels the layers below. All of it stands down while a
  field has focus or a modal is open.
- **GM identity** shows as a small avatar (`GmAvatar.js`, roster from
  `web/lib/gmProfiles.js`) wherever a GM is named: the lock holder on an
  In Progress row, a staged row's author, a Move's solver, and the actor
  column on `/gm/audit`. The player desk's conversations get none —
  `DirectMessage` records the player, not which GM typed the reply.
- The **push preview is a way in**, not just a readout: a character name
  swaps the inspector to them, and a staged line closes the preview, opens
  and expands the tray, and scrolls to that row with a brief flash.
- **Pins survive a reload** and are **shared with the player desk**
  (`web/app/components/usePins.js`, `localStorage` read through
  `useSyncExternalStore`). Pin someone while adjudicating and they are pinned
  when you go talk to them. They self-heal on load, though: this desk passes
  `usePins({ knownIdentities })` with the live roster's character ids, so a
  pin for a character a wipe or a death removed quietly drops off the list
  instead of pointing at nothing. A message whose push left `deliveryFailures` grows
  a **Resend** button that retries only the recipients that failed
  (`resendStagedMessage`). The Result box has a **Stage as message** button
  that opens the message composer prefilled with the result text and the
  Move's own character.

Escape is layered, topmost-first, and there are four rungs
(`Workspace.js`, `escapeLayers.js`):

1. An open blocking `Modal`, or a modeless one that currently holds focus,
   handles its own Escape and the workspace yields to it.
2. A focused field just blurs.
3. An **open composer** closes — even one the GM has clicked away from. A
   modeless dialog deliberately does not own the keyboard, so
   `EffectComposer` / `MessageComposer` / `PublicComposer` /
   `TransferComposer` each push a layer onto `escapeLayers.js` while they are
   open, and the workspace asks that stack before it touches the selection.
   Without it the first Escape closed the whole Move and took the composer
   and the Result box with it.
4. Only then does the selected Move/Caving roll deselect, through its own
   dirty guard.

A composer holding anything typed into it also counts in `isAnyDirty()`, so it
stands the backstop poll down and makes switching rows ask first — an
`existing` row being edited is exempt, since that text is already saved.

**Every mutation on the desk catches a throw.** `guarded()` turns a
`UserError` into `{ ok: false, error }`, but anything else rejects — and an
uncaught rejection inside a server-action call reaches `(desk)/error.js`,
which replaces the entire desk with an error page over one failed button.
Every call site (`MoveDesk`, `CavingDesk`, `StagedItems`, `StagingTray`, the
four composers, `QueueRail`'s avatar and hold rows) wraps its call and puts
the message in its own `FormError` via `mutationErrorMessage`.

**One "+ Effect / + Message / + Public" strip** (`StagingStrip.js`), used by
the Move desk, the Caving desk and the tray — the tray is the only one with a
`+ Transfer`. And **one Preview push**, on the tray beside the rows it
previews; the desk header used to carry a second.

The **Result box on both desks is a draft, not component state**
(`web/app/(desk)/gm/turns/deskDraft.js`) — the Move desk's Result and Kind
together, the Caving desk's Result, each keyed by row and mirrored to
`localStorage` the way the reply box already was (`dmDraft.js`). Memory is the
source of truth and storage is a best-effort mirror, never the other way
round. A draft **wins over the saved row** while it exists, counts as dirty
(so the poll stands down and closing asks first), and is cleared by the save,
solve, reject or resolve that puts it on the row. Before this, those two
boxes were the only editors on either desk in no storage tier at all: anything
that replaced the column took the narration with it.
With nothing selected **Escape does nothing**. It used to navigate to
`/gm/players`, which made the desk read as a mode you were trapped in rather
than a page — one stray keystroke and the whole workspace was gone. The rail
is how you leave. The tray also
grew a search box, an All/Effects/Messages/Public filter, and an Expand
toggle for combing through a big push (`StagingTray.js`).

## 4. The push, from this page's side

The mechanics live in `db/lib/stagedPush.js` (ordering and crash-resume
guarantees: `TURN-ENGINE.md` §2–3). What a GM needs to know:

- Effects apply one transaction per row — one bad row can't roll back the
  batch. A row that no longer validates (the tag left the catalog, the
  staged zone was reworked away) is stamped errored with the reason on
  `appliedEffect`, shown in the tray.
- A staged relocation writes `Character.zoneId` in that same transaction;
  the Discord half (zone role, narrowcast, thread invites) runs afterwards
  in the side-effect thunk via `db/lib/zoneMove.js`, with the channel
  doctor as the safety net (`CHANNELS.md` §3).
- Messages are stamped `sentAt` after their sends are attempted, per-recipient
  state on its own `Delivery` row (§1a), the failures also summarised on
  `StagedMessage.deliveryFailures` and in one `staged_push_delivery_failed`
  audit row carrying `{attempted, delivered}`. A crash mid-delivery leaves the
  rest visibly unsent, not falsely delivered — and a resumed push finishes
  exactly the ones that did not get through.
- **An unresolved `TROUBLE` caving roll is resolved by the push** and its hold
  on the caver lifts (`CAVING.md` §2d). The Caving lens is read-only on a past
  turn by design, so a roll nobody got to is a roll nobody can get to.
- A staged row created in the seconds around the cron retargets itself to
  the new open turn; anything that slips through lands in the missed-push
  banner. Honest beats locked.

## 5. Where player actions went

**There is no Requests lens any more.** The desk carries Moves, Caving, Other
and History; a player action files no `Request` row, asks for no reason, and
cannot be undone (`REQUESTS.md` §1).

What a GM watches instead is **`/gm/audit`**, which now defaults to the player
band — the machine's own per-turn rows are one click away rather than on top
of everything. A single character's story is the **Audit** tab on
`/gm/dev/characters/[characterId]`.

Correcting a player action is a Dev Panel job, by hand: add the tag back, take
one off, transfer the ⬢ the other way, teleport them back. The audit row
carries a `restore` snapshot for exactly this — see `REQUESTS.md` §2, and
`DEV-PANEL.md` for the controls.

## 6. Structures at the desk

Damage, Repair, Destroy and Clear are a GM's ruling on a built thing — never a
Request, and never staged for the push. `/gm/structures` is a GM-visible page
reachable through ⌘K; it carries no rail item of its own.

All four are **immediate microactions**, the Dev Panel posture: a conditional
`updateMany` claims the row (so two GMs clicking at once land exactly one
change), each writes one `AuditLog` row (`structure_damaged` /
`structure_repaired` / `structure_destroyed` / `structure_cleared`), speaks an
ambient line into the structure's Location channel, and — Damage, Repair and
Destroy only, not Clear — DMs the structure's contributors and payer
(`stakeholderCharacterIds`, `db/lib/structures.js`). Clearing a wreck sends no
DM: the stakeholders already heard about the destruction or abandonment, and
"the rubble was tidied" is not news anyone needs.

**Destroy** takes any of the three present statuses
(`UNDER_CONSTRUCTION`/`COMPLETE`/`DAMAGED`) to `RUINED`. Sabotaging a site
still under construction destroys the work done, never silently — the crew
still get the destruction DM, same as a finished structure's contributors.

**Player demolition is a GAMBIT adjudicated at the desk, never an apply-first
Request.** The GM resolves the die, stages the public outcome through the
ordinary composer (§1), and clicks Destroy (or Damage, for a lesser outcome)
on `/gm/structures` in the same sitting — the ruling and its mechanical
consequence happen together, by hand.

**The Oracle is waiting when you sit down.** Moves lock at 21:00 CT, and a
couple of minutes later the chronicle for the turn is drafted onto `/gm/oracle`
— six zone pages and a front page, covering the day up to the lock. It is meant
to be read *before* working the desk, which is the whole reason it stopped being
written at turn close. One thing to know while cross-checking: an Oracle page
runs lock to lock, so the last three hours of a day appear on the next turn's
page rather than that turn's. `ORACLE.md` §3.

**The two-turn siege.** An assault on a structure or a shut gate is staged as
a PUBLIC declaration into the defenders' `#summary` on turn N; it can only
resolve turn N+1, never the same turn — Moves lock at 21:00 CT and a sleeping
defender has to get their hours before the blow lands. The Destroy confirm
dialog on `/gm/structures` restates the rule at the point of clicking, so the
GM working the desk sees it again right before committing.

**The Move card's "Standing here:" line**
(`web/lib/moveRows.js#standingHereLines`) prints each structure's
`defenseNote` only while it is `COMPLETE` or `DAMAGED` — a ruin never grants
its clause. This is the siege licence in practice: the Battering Ram's note is
what makes storming a shut gate adjudicable at all, and it stops being
adjudicable the moment the Ram is a ruin.

## 7. Where the code lives

| File | Role |
|---|---|
| `web/app/(desk)/layout.js` | The full-viewport route group's GM gate |
| `web/app/(desk)/gm/turns/page.js` | RSC: queue, staged rows, catalog, roster — all DTOs |
| `.../Workspace.js` | Client shell: selection, inspector context + cache, layout |
| `.../QueueRail.js` | Lens, filters (zone-seat seeded), the queue |
| `web/lib/moveRows.js` | The Move / staged-effect / staged-message DTO mappers, shared by `page.js` and the History fetchers so they can't drift |
| `.../deskStore.js` | The desk's client-owned rows: seed, patch, the newer-wins reconciliation rule |
| `.../deskDraft.js` | What a GM has typed and not saved — the Result boxes and the Kind switch, keyed by row, mirrored to `localStorage`. Also the desk's record of WHICH rows are dirty, which is what `DeskStream.js` buffers against |
| `db/lib/deskNotify.js` | `bascinet_desk` — the channel four Postgres triggers announce a changed desk row on (migration `20260921030000_desk_notify`) |
| `web/app/api/gm/desk-stream/route.js` | The live channel's server half: coalesces a beat of ids from the hub and answers with one `deskPatchFor` frame |
| `.../DeskStream.js` / `deskStreamStore.js` / `DeskStreamChip.js` | Its client half: the EventSource and its own reconnect, the dirty-row buffer, and the chip that says when the desk has dropped to its backstop poll |
| `web/lib/deskRows.js` | The other half, server-side: the shared row CONTEXT (usernames, Catatonic, Location names, the open turn, the clock) and `deskPatchFor`, the patch every mutation hands back and the live channel re-reads with |
| `web/lib/pgClock.js` | `pgNowMs()` — the database's clock, which is the only stamp the store reconciles on. Shared with the player desk's `inboxDelta.js` |
| `.../MoveDesk.js` / `CavingDesk.js` | The desks |
| `.../MoveHistoryDesk.js` | The read-only desk for a Move on a pushed turn |
| `.../EffectComposer.js` / `MessageComposer.js` / `PublicComposer.js` | The staging composers (create + edit) |
| `.../StagedItems.js` / `StagingTray.js` / `PushPreview.js` | Staged-row lists, the tray, the per-recipient preview |
| `web/app/components/InspectorColumn.js` | Sheet / Tags / Moves / Archive / DMs + pins — **shared with `/gm/players`**, which puts its Canon section above the Moves tab through `tabPreludes` (PLAYER-DESK.md §6) |
| `web/app/components/ArchiveContextModal.js` | The "in context" slice behind an Archive row, moved alongside it |
| `web/app/components/GmAvatar.js` | The small GM pfp, fed by `web/lib/gmProfiles.js` |
| `web/app/components/useSessionState.js` | The generic `sessionStorage` hook behind rail-state persistence — one key (`gm-turns-rail`) shared by `QueueRail.js`'s filters/toggles and `Workspace.js`'s `lens`, plus the unsubscribed `readSession`/`writeSession` pair behind `gm-turns-view` |
| `web/app/components/useDeskVersion.js` / `web/lib/deployVersion.js` / `web/app/api/desk-version/route.js` | The deploy-awareness triad: the 45s poll refreshes only on a same-build answer, a deploy shows the reload chip instead of letting Next's build-mismatch fallback hard-reload the desk |
| `.../useMoveLock.js` | The lock's client half |
| `.../actions.js` | Every server action: staging CRUD, solve/save/unsolve, unlock, locks, the Caving find undo, inspector fetchers, the two history fetchers (`getMoveHistory`, `getCharacterMoveHistory`), retarget |
| `db/lib/stagedPush.js` | The push pass |
| `db/lib/tagOps.js` | The tag-op engine (shared with the Dev Panel) |
| `web/lib/tagOpAlgebra.js` | `mergeTagOp`, the client-side staging algebra |
