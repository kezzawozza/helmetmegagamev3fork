# The Player Desk

`/gm/players` — every player, and every conversation with one, on one screen.
Companion to [`ADJUDICATION.md`](ADJUDICATION.md) (its sibling desk) and
[`DEV-PANEL.md`](DEV-PANEL.md) (where a GM actually edits a sheet).

## 1. The structural fix

This desk merges the roster and the message inbox into one screen. The rail
is the **union** of "everyone with a conversation" and "everyone with a
character" (§4), which is what makes starting a first conversation possible
at all.

## 2. The shell

`web/app/(desk)/gm/players/`, the second page in the `(desk)` route group. Full
viewport minus the nav rail, on the same `.desk-*` classes as the adjudication
desk — the two are the same tool and should read as one.

```
┌ header: Players · turn chip · N tracked · N unread · N awaiting · Bulk message ┐
│ RAIL            │  ROSTER TABLE (nobody selected)  │  INSPECTOR     │
│ search, filters │  ─────────── or ─────────────────│  Sheet · Tags  │
│ zone filter     │  CONVERSATION                    │  Moves ·Archive│
│                 │  thread + composer                │  DMs           │
└─────────────────┴──────────────────────────────────┴────────────────┘
```

Fleet view, then person view. The middle column is the roster with nobody
selected and the conversation once somebody is picked. The **inspector is the
third column of the shell**, not of the person view (§6): it is there on the
roster too, and it does not get thrown away and rebuilt every time you open a
different conversation. Its tabs are the five base ones —
`Sheet · Tags · Moves · Archive · DMs`, same list as `/gm/turns` — plus this
desk's own **Scene**, the live feed where that character is standing (§6,
`CHAT.md` §8). Canon is not a sixth tab any more: it is folded into **Moves**
as the "This turn" section above that person's past turns (§6).

Under the shared `.desk-*` mobile breakpoint (720px, `DESIGN-SYSTEM.md` §8),
this desk is the exception to the rest of the family: the rail is the content
here, not a queue beside the work, so `.desk-body--players` and `.desk-rail`
are exempted from the shared single-column-stack / 45vh-cap rules
(`globals.css`, the players-desk mobile block) and the roster just runs full
width, full length, scrolling with the page. The **inspector** is not
exempted: it stacks and keeps the shared 45vh cap, exactly like the one on
`/gm/turns` — same column, same component, same rule. `/gm/turns` and `/gm/audit` keep
the 45vh cap on their rails — there, the rail is a queue and the main pane is
the work.

Two tiers above that one belong to the GM desks alone (`DESIGN-SYSTEM.md`
§9). **Under 1024px** the inspector stops being the third column and becomes
an overlay behind an **Inspector** button in the header — so the 720px note
above now only describes what the *rail* does, and the inspector no longer
stacks under the conversation at any width. **Under 800px**, opening somebody
hides the rail as well as the roster and the conversation takes the screen,
with **← Back** in the conversation header as the way out (the same
destination as Esc). With nobody open, the rail and the roster stack exactly
as they always did.

Routes are keyed on **`discordUserId`, not `characterId`**: that is what
`DirectMessage` keys on (no character FK, by design), every character has one,
and it keeps working for a conversation whose character is gone.
`/gm/messages` and `/gm/messages/:id` redirect here (307 — an internal tool
with no SEO to protect and a real chance of another reshuffle).

## 3. The rail

One lens. The rail is the inbox: with no search query it lists only players
with a conversation, sorted pinned → unread → recency, showing the last
message with a `You:` / `GM:` / `Bot:` prefix. There used to be a second,
Roster lens — everyone with a character, alphabetically — as the only way to
reach someone who had never written. It's gone: a search query does that job
instead (below), and it did not earn a whole second lens, a segmented toggle
and a sort-order tie-break of its own.

Typing a query widens the candidate set from "has a conversation" to "has a
conversation **or** a character" — that's what makes a first message
possible at all, since a character with no DM history still has a working
`href` to an empty thread. A query also **pauses** the zone filter and the
Needs-reply toggle rather than composing with them: without the pause a filter
would silently hide a cross-zone search hit, which is exactly the case search
exists for.

**The zones a GM chose to see are a different thing and a search does NOT lift
them** (`GAMEMASTERS.md` §1). A filter is a lens over your desk; the zone view
is what your desk is. Everything downstream of it reads the gated set —
mark-all-read included, or one click would handle another zone's mail. The rail
shows a small "Searching everyone — filters paused." line under the search
box while a query is active. Sort while searching is match score, then
conversation-havers before non-havers, then recency — a name hit with a
thread still usually outranks a name hit with none.

Search is `scoreMatch` (`web/lib/fuzzySearch.js` — keep that the one shared
engine) over name, role, faction, Discord username **and** global name, zone,
**held tag names** and message preview. `scoreMatch` tokenizes and folds diacritics, tolerates a
typo, and takes `field:term` scopes — `role:smith`, `zone:caves`, `@handle`
as shorthand for `username:handle` — so a bare word still matches anything
but a scoped one narrows to that field only.

The old All/Unread/Awaiting three-way toggle is one **Needs reply** button
now, filtering to rows where `unreadCount > 0` or the player wrote last
(`lastDirection === "INBOUND"`). Two of the three old lenses were sort orders
wearing a filter's clothes; a 100-player inbox needs "who is waiting on me",
not three mutually exclusive views of it. What used to be the "Awaiting"
filter is a row-level mark instead: any row where the player wrote last and
it's already read (`lastDirection === "INBOUND" && unreadCount === 0`) gets a
small muted, italic "awaiting" next to its time — the unread badge already
says as much when there's an unread count, so it only shows when there
isn't one.

**Those three states are one weight ladder, not one pill.** `unread` >
`awaiting` > `read`, read off `data-unread` / `data-awaiting` on the row
(`globals.css`): an unread row's name is full strength at 700, an awaiting
row's is full strength at normal weight, a read row's is muted. Before this
the two live states were the same weight plus a small grey chip, so a rail of
a hundred rows had two visible states and one of them was "not selected". The desk header's meta row totals the same predicate as an
"N awaiting" chip beside "N unread".

**The ✓ under the star clears a row from that pile.** Some messages want no
answer — a thank-you, an "ok", something already handled in-game — and without
a way to say so they sit in the awaiting count forever, inflating the one
number the desk exists to answer. The second gutter button under each row's
pin marks the conversation as needing no reply: the `awaiting` chip goes, the
row drops out of **Needs reply**, the header's count falls, and the
conversation is marked read too (saying it needs no answer implies having read
it). Unlike the pin beside it, this is **server state and desk-wide**, on
`ConversationMeta.handledAt` — whether a conversation still wants an answer is
a fact about the conversation, not one GM's taste, and five GMs should see one
answer. It is a **dismiss, not a mute**: the mark is a timestamp, and the rail
only honours it while it is at or after the conversation's last message, so
the next inbound DM outruns it and the row is awaiting again with nothing to
clean up. Clicking ✓ again clears it outright.

**The ⊘ under it mutes the conversation outright.** Where ✓ says "nothing to
answer here, for now", ⊘ says "this thread is not part of my working set":
the row leaves the rail entirely and stops counting toward both unread and
awaiting. It is **desk-side only** — nothing about the bot's behaviour toward
that player changes, they are not blocked or told anything, and their DMs
still arrive and still read normally. It is also **standing**, unlike ✓: a
new message does not lift it, because a mute is a decision about a person
rather than about one message. `ConversationMeta.mutedAt` holds it until a GM
clicks ⊘ again.

**The rail's chrome is two lines.** Search inbox and the zone dropdown share
the first; **Needs reply**, "Searching everyone — filters paused", **Mark all
read** and **Show muted** share the second. It used to be up to five stacked
rows — a row per control — so on a laptop the first conversation started below
the fold. The adjudication rail's `RailFilters` follows the same shape
(`ADJUDICATION.md` §3).

Muted rows are hidden, not deleted. A **Show muted (N)** button appears among
the rail's filters whenever there are any; it reveals them **in their ordinary
place** in the rail, rendered greyed (`[data-muted]` in `globals.css`), with
the gutter buttons at full strength since unmuting is what a GM came there to
do. They are deliberately not sunk to the bottom: a muted row you are looking
for on purpose should be where you expect it, not at the end of a hundred
others. A
search query does **not** lift the mute on its own the way it pauses the zone
and Needs-reply filters — those are lenses over the inbox, this is a standing
decision — so finding a muted person means showing muted first.

**Content search is the server's half of the same box.** The fuzzy engine only
ever sees what the layout ships to the client, and that is *one preview line
per conversation* — so "find the thread where we talked about the barley"
could not work at all, whatever the preview happened to be. A query of three
characters or more is therefore also sent, debounced 300ms, to
`searchConversations` (`actions.js`): a Postgres `ILIKE` over
`DirectMessage.content` carrying the same noise predicate as the rest of the
desk, grouped per `discordUserId`, newest 50. Those hits merge in **under**
the fuzzy ones — a name match is still what a GM usually means — and only for
people the fuzzy pass could not already see, marked `in messages · N`.
Clearing the box drops them, because the hits are stored keyed by the query
that produced them and simply stop matching (clearing state from an effect is
what `react-hooks/set-state-in-effect`, an error in this repo, exists to
catch).

The **roster table** (§4) runs the same `scoreMatch` engine, over name, role,
faction, both zones (seat and standing-in) and Discord handle — as a filter
only, though: unlike the rail it keeps whatever column sort the GM chose
rather than reordering by match score, since the roster has real sortable
headers to preserve.

**Pins are shared with the adjudication desk** (`usePins.js`). This is a merge,
not a rename: the two desks kept separate keys in separate identity spaces —
`desk-pins` held `{ characterId }` objects, `messages-pins` held bare
`discordUserId` strings — so an entry now carries both ids and the old keys
migrate once on first read. Identity is `characterId` when there is one,
`discordUserId` otherwise.

Both desks now prune dead pins against what each one knows, via
`usePins({ knownIdentities })`: this desk passes both id spaces (it has
rows keyed on both), `/gm/turns` passes characters only. A pin whose
identity isn't in the caller's `knownIdentities` for its namespace drops
silently on load, instead of surviving as a pin to nothing.

## 4. The roster

Everything the old table had, plus what a GM actually asks about
mid-turn: **Acted this turn** and **tag count**.

**Eleven columns, not thirteen.** Cursed, Catatonic and Acted used to be three
columns of their own, each holding a word or a dash about a state nearly every
row does not have; they are one **Flags** cell of `StatusPill`s now. Empty they
cost nothing, and only "Not acted" is drawn for its *absence*, because absence
is what a GM hunts in the back half of a turn. Acted stopped being a sortable
column in the fold and became a **filter** instead, which is the better control
for that question anyway — it wants the other forty rows gone, not pushed to
page two — and it only appears while a turn is open. The table still does not
fit the middle column at 1440 (about 930px of content against 694px of room)
and keeps its horizontal scroll, but the fold cut the push from roughly 535px
to 235px.

Catatonic is computed from the `catatonic-afk` tag
rows the page already loads — the same AFK state the rail avatars mark with
a muted dot (`CharacterAvatar`'s `catatonic` prop; see `TAGS.md` §7 for
every surface the tag reaches). Since the guild-leave rework, a Catatonic
mark can also mean the player has left the server and the character is on
the death countdown (`CHARACTERS.md` §5). Selection is a `Set` of
character ids, so it survives paging, filtering and sorting. Select-all covers
the **filtered page**, not the whole roster — a header checkbox that quietly
picks up a hundred people you cannot see is how a broadcast goes to the wrong
room.

Two bulk verbs, both GM-safe:

| Verb | Action | Lives in |
|---|---|---|
| Message selected | `sendGmBroadcast`, through `BulkComposer` | this desk's `actions.js` (sequential, never a fan-out) |
| Tag / untag selected | `bulkTagCharacters` | `(app)/gm/actions.js` (one transaction **per character**) |

**There is one bulk-message UI, and it is `BulkComposer`.** "Message selected"
used to unfold its own inline panel under the filter bar — a bare textarea with
no editable recipient list, no character count and no zone/faction shortcuts —
beside a `BulkComposer` that had all four. Same modal now, opened with the
roster's ticked rows already in it (`initialSelectedIds`) and still fully
editable afterwards, so picking rows in the table and then adding a whole zone
is one flow rather than two products.

It has three doors, all the same component: the roster's **Message selected**,
**Bulk message** in the desk header (reachable from the rail, where the
roster's checkboxes are not), and **Message pinned** in the inspector's pin
row.

Its roster is `CheckPicker` — the same picker the Dev Panel's bulk section
wears (`DEV-PANEL.md` §11b) — so ticking characters looks and behaves the same
on both desks. What stays here is what is actually about messaging: the
character cap, the two one-shot "check this whole zone / faction" selects, and
the send. It passes `scoreMatch` as the picker's `search`, which is how the
filter still reaches a role or a faction rather than just a name.

**Two search boxes on this desk, not four.** The rail's is **Search inbox** —
it reaches every character *and* message text. The roster's is **Filter roster**
— it only narrows the rows on screen, and is labelled for what it does rather
than borrowing the rail's verb. The inspector's own "Look up a character…" box
is **off here** (`InspectorColumn`'s `lookup={false}`): the rail already reaches
anybody, so it was the fourth search field on one screen and the weakest of
them. The inspector still gets `roster`, because it reads the inspected
person's handle and role out of it, and it keeps its **pins row**. `/gm/turns`
and `/gm/oracle` keep the box — there the rail is Moves or zones, not people,
so it is the only way to reach somebody.

**"Why this row matched" has one form across the surfaces that have one** — the
rail, this roster and (on the other desks) the inspector's lookup box
(`MatchHint.js`): a muted
`· <what matched>` suffix, the value where the row has one (the role title,
the faction, the matched tag names) and the field's own word where it does
not. A name hit says nothing, because the name is already the biggest thing on
the row. The three used to print the bare field name, the bare field name with
a different dot, and the value with no dot at all.

**The inspector with nobody picked shows where the desk stands** — unread,
awaiting a reply, conversations, pinned, muted — instead of seventy per cent
of a column holding one sentence of advice. The advice is still underneath it,
and now says to pick somebody **in the rail** rather than pointing at a lookup
box this desk no longer draws.
The adjudication desk fills the same slot with its own turn's standing
(`InspectorColumn.js`'s `emptyStanding`).

**Bulk zone moves are deliberately absent.** Moving people is a place-editing
verb, not a roster one, and it lives with its five siblings on `/gm/dev?s=bulk`
(`applyBulkAction`, tier `gm` — this paragraph used to name a
`bulkMoveCharacters` that has not existed for some time, and claimed a
superadmin gate it never had).

The faction hierarchy is a view of this table rather than a separate tab, and
`/gm/players?tab=factions` still selects it — `/faction` sends a GM here.
A faction's **name** is the door out to `/faction`'s per-faction detail view
(member roles, add/remove) — there is no separate "Manage" link.
Clicking a faction from a **player** row still stays in the desk: it switches
to the Factions tab and highlights that row instead of navigating away.

## 5. The conversation

A real chat pane: the transcript takes the height that's left and scrolls
inside itself, with the composer pinned at the bottom. It reads like a chat
client, not a support inbox.

- **Rows, not bubbles** (`DmThread.js`, shared with the inspector's DMs tab).
  Flat, left-aligned rows. A run of messages from the same person within
  seven minutes gets one header — avatar, name, time — and the rest are
  continuation lines whose time shows in the gutter on hover. GM names take
  the accent colour; the player's rows carry their character avatar. Day
  dividers (`Today`, `Yesterday`, then the date) and the source chips
  (`turn result`, `broadcast`) are the only other furniture. Times come from
  `web/lib/dmTime.js` and tick with `useNowTick`, so "Today" flips at
  midnight.
- **An inbound image renders inline** (`DmThread.js#AttachedImages`,
  `db/lib/dmAttachments.js`), reusing the raw Discord CDN url a player's
  attachment carried — no re-hosting, no click-to-reveal gate. Discord's
  attachment urls are signed and expire (roughly a day), and nothing
  refreshes a stale one, so an old DM's photo can go on to 404; a non-image
  attachment still shows as `*(attachment: name)*` text, same as always.
- **The NEW line.** The route loads this GM's `ConversationRead` cursor and
  hands it to the thread, which draws a `NEW` rule above the first inbound
  message after it. Where it sits is decided once when the thread opens
  (state seeded from the prop), so the mark-read that fires a moment later
  can't move it.
- **The scroll follows only if you were following.** On a new row the pane
  scrolls to the bottom when the reader was already within ~80px of it, or
  when the row is the GM's own send. A player's message landing while the GM
  is reading history doesn't yank them; a `↓ N new messages` pill sticks to
  the bottom of the scroll area instead and jumps down on click. Older pages
  load on their own as the reader nears the top (an `IntersectionObserver`
  sentinel), with the button left as the fallback.
- **Enter sends, Shift+Enter makes a newline** (`useSubmitOnEnter.js`).
  Two guards that are not optional: `isComposing`, because an IME uses Enter to
  accept the candidate being composed and sending there posts half a word; and
  `useIsCoarsePointer`, because on a phone Return is the only way to make a
  paragraph. Touch sends with the button.
- **The composer grows with the draft**, one line to ten, measured in the
  change handler. There is no permanent hint line under it: the counter only
  appears past 90% of the cap, and the Enter/Shift+Enter hint lives on the
  textarea's tooltip and the send button's. Send is a compact icon button,
  always present because touch has no Enter-to-send.
- Drafts persist per conversation in `localStorage`, read through
  `useSyncExternalStore` — the textarea's value *is* the store's value, so
  there is no `setState` in an effect to seed it.
- **Send is optimistic.** The row appears and the draft clears the instant you
  press Enter, styled pending (`data-pending` on the row) until the server
  answers. The server half matches: `sendGmDm` awaits the Discord POST (a GM
  must know if *that* failed) and returns the one created row instead of
  re-reading the whole thread page.
- **Every send carries a nonce** — `DirectMessage.clientNonce`, minted in the
  composer before the send. It does two jobs. It is what pairs the optimistic
  line with the row that comes back: the pairing used to be on the TEXT, so
  sending "ok" twice retired both placeholders against the first row to land
  and the second send looked as though it had never happened. And it makes a
  re-send safe — `sendGmDm` looks the nonce up before it posts anything, so a
  send that was **logged** and then lost its answer returns the row already
  there rather than delivering a second copy. The nonce is written with the
  log row, which `sendDm` writes *after* the Discord POST, so one window stays
  open and is worth knowing about: a send that reached Discord and then lost
  its log write (the container swapped between the two, or the insert failed
  for something other than the nonce already being there) leaves nothing for
  Retry to find, and Retry delivers twice. Closing it means reserving the
  nonce before the POST and filling the row in after, across all three
  `sendDm` transports. A partial unique index backs the dedupe up
  in the database (`db/test/dmNonce.test.js`); every writer with no composer
  behind it passes null, which the index allows.
- **A failed send stays where it was written.** The row keeps its place with
  the error on it and quiet **Retry** / **Discard** beside it, rather than
  vanishing and pushing the words back into the box. Putting them back was
  safe only while a GM sat still waiting for the answer: the draft is per
  conversation and shared with whatever they have started typing since, so a
  slow failure overwrote a sentence in progress. Retry re-sends under the same
  nonce, so exactly one message is delivered in every case the
  nonce can see — and the one case it cannot is named above.
- **The player's side arrives live.** The pane's page state is seeded once,
  and used to stay that way until the GM sent something. Now it unions that
  page with the live feed for this conversation (§9a) during render — never
  copied into state — and a pending optimistic row retires as soon as its
  nonce comes back on a real row, whichever path brings it first.
- **Claim/release** is advisory (`ConversationMeta`), so five GMs don't answer
  the same player twice. The same table carries `handledAt` and `mutedAt`, the
  rail's ✓ "needs no reply" mark and its ⊘ mute (§3).
- **A player can write here from the web too.** Chat's Bascinet pane
  (`CHAT.md` §2b) inserts an INBOUND row with `source: "player"` and
  `meta.via = "play"`, the same shape the bot logs for a Discord DM, so it
  arrives on this desk through the ordinary delta poll and nothing here had
  to learn a new value. `via` is the only tell, for a GM reading the record.
  The reply path is unchanged: `sendGmDm` reaches the player on both faces.
- The thread is a **conversation**, not a raw `DirectMessage` dump, and what
  decides that is **`DirectMessage.kind`** — `CONVERSATION`, `NOTICE` or
  `QUIET`, from `db/lib/dmKinds.js`. A row's `kind` is what it WEIGHS here;
  its `source` only says how it is DRAWN. The two are orthogonal on purpose.

  | kind | What it is | The rail | The pane |
  |---|---|---|---|
  | `CONVERSATION` | a person wrote it — a GM's reply, `/dm`, a broadcast, a staged turn result, the player writing in | sorts, previews, counts as unread | a full row |
  | `NOTICE` | the game said it — a seat assignment, a letter arriving, hunger, a travel outcome | **nothing at all** | a centred `SystemLine`, collapsing in runs of 3+ |
  | `QUIET` | plumbing — inspect/dossier embeds, the ✏️ edit-flow prompt (`bot/src/lib/editModal.js`), proxy hand-back, reaction refusals | nothing | not drawn |

  **All three `sendDm` functions default `kind` to `NOTICE`, so conversation
  is the thing you opt into.** That is the whole design. It used to be the
  other way round: `source` was a free string, `web/lib/discordGuild.js`
  defaulted it to `null`, and `null` read as "a person wrote this" — so every
  DM anybody added landed in the inbox looking like mail unless they
  remembered to tag it, and nine strings nobody had ever added to a list
  (`lobby_assignment` — "You are the Baroness" — plus `bird`, `rite`,
  `threat_assign`, `gm_dev_panel` and the other `lobby_*`) sat at the top of
  the inbox as if a stranger had just written in. A forgotten `kind` is now
  quiet rather than loud.

  A `NOTICE` is **invisible to the rail**: it cannot put a player in the
  inbox, move one up it, win the preview slot, or un-tick a GM's ✓. It is
  still perfectly readable the moment you open the person. Two consequences
  worth knowing: somebody the game has only ever *notified* is reachable by
  search and not by the empty-query rail (the rail's third union leg is
  "everyone the game has ever DM'd", which is what keeps a lobby entrant with
  no character findable at all); and there is still **no surface that lists
  pending seat or antagonist offers**, which used to be visible only as an
  accident of them counting as conversation.

  An `@mention` relay is the one row the two chairs disagree about. It is a
  `NOTICE` like any other, but it also carries `source: "mention"`, and the
  filter takes a chair: the desk (`perspective: "gm"`, the default) drops it,
  the player's Chat pane keeps it — a ping is about the player, and on
  Discord that DM is simply in their inbox.

  The predicates all live in `web/lib/dmThread.js` so a hand-rolled copy
  cannot drift: `railKindSql` (`kind = CONVERSATION`) for the rail, the
  unread counts and the nav badge; `withoutDmNoise` (`kind <> QUIET`) for a
  thread, plus its raw twin `threadKindSql` for the one raw-SQL caller that
  asks the thread question, the desk's message-content **search**. Search
  deliberately uses the *thread* predicate: a GM who remembers reading a line
  on somebody's thread and cannot search for it has been told the search is
  broken.

  This replaced a three-query arrangement — a noise filter, a second
  `DISTINCT ON` for "the last thing a *person* said", and a muted
  `previewIsSystem` state for a row whose only content was a turret notice.
  All three existed only because a notice could put a row on the rail with
  nothing to say, so all three are gone. The `You: / GM: / Bot:` preview
  prefix is folded into `dmThread.js#dmPreview`, shared with the live delta so
  the two can't drift.

  (Tag search covers **living** characters only — the layout's tag load is
  bounded to `ALIVE`, since it re-runs on every revalidation; a dead
  character is still found by name, role, faction and handle.)

- Mark-read fires from a client effect, never during RSC render — otherwise
  a render marks a conversation read without anybody opening it. (The rail
  no longer prefetches — its rows are buttons now, §5a — but the rule stands
  on its own.) It is the one action on the desk that deliberately does **not**
  `revalidatePath`: the cursor it moves is this GM's alone, the stream sees it
  within seconds, and re-running the whole layout for it was the desk's most
  frequent full re-render.

## 5a. Opening somebody is not a navigation

Clicking a name in the rail used to be a real Next navigation into a
`[discordUserId]` segment, and it was the slowest thing a GM did. Three
separate causes, all measured:

- **Every rail row was a prefetching `<Link>`**, and the rail draws all of
  them with no pagination. Each prefetch was an RSC request into a segment
  costing a hundred DM rows and two Discord REST calls. Ten of those in flight
  together took five seconds, essentially serialised — so the click a GM
  actually meant waited behind a queue they never asked for.
- **Two of those Discord calls were the same call.** `getGmProfiles()` was
  fetching the whole guild separately from `listGuildMembers()`, on a second
  five-minute TTL that expired independently. It derives now.
- **An RSC navigation cannot be cancelled.** Even with the first two fixed,
  clicking a third person still meant the first two renders ran to completion.

So selection is client state. `selection.js` holds who is open;
`DeskMiddle.js` draws that conversation over the roster; `threadStore.js`
caches what has been loaded; and the thread comes from `GET /api/gm/thread`,
which is **abortable** — a click you have moved on from stops costing anything
the moment you move on. Reopening somebody you looked at a minute ago makes no
request at all.

**The URL is still real.** Every selection writes `history.pushState` and
`popstate` writes back, so Back and Forward work, a pasted
`/gm/players/<id>` works, ⌘K works, audit-log links work, and the
`next.config` redirect from the old `/gm/messages/<id>` still lands. The URL
follows the selection instead of causing it.

That `pushState` passes **`null`**, not the current `history.state`. Next
patches `pushState`/`replaceState` and its patch early-returns on any state
that already carries Next's own `__NA` marker — which every entry Next wrote
does. Handing the current state back therefore skipped the patch: the router's
`canonicalUrl` never moved, so a `router.refresh()` refetched whoever was open
*before*, Next's own `HistoryUpdater` put the old address back in the bar, and
Back onto an entry the router had not marked reloaded the whole page. Passing
`null` lets the patch copy `__NA` and the router tree onto the new entry and
move `canonicalUrl` with it.

**The roster is hidden, never unmounted.** `DeskMiddle.js` used to swap it out
for the conversation, and its search, column filters, sort and half-built bulk
selection went with it — open somebody to check one thing, come back to a
roster that had reset itself. It now sits under a `display: contents` wrapper
that only flips `hidden`, so its position in the tree — and everything it is
holding — never changes.

**The desk has one route.** `[[...selection]]/page.js` is an optional
catch-all — the shape `/gm/turns` already uses — rather than a roster page
beside a `[discordUserId]` sibling. It has to stay mounted whether or not
somebody is open, so that closing a conversation reveals the roster rather
than an empty column. It never reads its own `selection` param; that is the
store's job.

**An unsent reply pauses the poll.** The composer registers with
`useDirtyGuard` while there is anything in it, so the desk's 30s
`router.refresh()` stands down rather than refetching the page under a
half-written sentence. It deliberately does *not* arm the browser's
beforeunload prompt: the draft is mirrored to storage (`dmDraft.js`) and comes
back after a reload, so asking "are you sure" on every ⌘R would warn about
nothing.

It pauses the poll only while somebody is **actually writing** — the same
10-minute freshness rule the adjudication desk's Result box follows
(`useDirtyGuard.js#alsoDirtyHoldsPoll`, `turns/deskDraft.js`). A draft is
stamped when it is typed into and counts as cold once it is that old, or as
soon as it comes back out of storage on a reload. Before that, a half-typed
reply left in some conversation last week stood the backstop poll down for
ever, and the desk simply stopped refreshing.

**What is still a server action, and why.** Sending a DM, claiming, muting and
✓-ing still are: they are mutations, they are rare, and they want the
revalidation. What moved to GETs is everything a GM does *while meaning to do
something else* — the rail's content search, the thread's first page, and
paging back through history. A pending server action blocks client-side
navigation, and those three were the ones most likely to be in flight when a
GM clicked.

## 6. The inspector

`Sheet · Tags · Moves · Archive · DMs · Scene`, the first five fetched on
demand and memoized per
`${characterId}:${tab}` for the life of the page view. **Moves** is that
person's turns: this desk's **Canon** section on top ("This turn"), then that
person's past turns underneath ("Past turns", ADJUDICATION.md §3). One
question, one tab — Canon used to be a sixth tab pointing at Moves with a
"Past moves →" button, which made the GM click twice to read one story.

This used to be `DossierColumn`, a column of the **person view** — which meant
it did not exist on the roster at all, and every navigation between two
players threw it away and rebuilt it. It is the adjudication desk's inspector
now, literally: one component, `web/app/components/InspectorColumn.js`, mounted
by both desks. There the character is context for a Move, here the Move is
context for a character, but it is the same five base tabs over the same
`getCharacterInspector` / `getArchiveSlice` fetchers, the same staged quick
edits (✕ a tag to stage its removal, click Resources or Tag points to stage a
± delta — which is why the player desk's `layout.js` loads this turn's
unapplied `StagedEffect`s too), the same DM composer, the same
`ArchiveContextModal`, and the same **`+ Custom tag`** door on the Tags tab —
which draws the character sheet's own cards now, Status first, with a filter
box (ADJUDICATION.md §3), over a Sheet tab carrying the sheet's Combat tile.
The door differs by desk and only by desk: `/gm/turns` defaults to *staging*
the new tag because that desk is mid-push, `/gm/players` defaults to
*applying* it because this one is a conversation.

**Canon is this desk's one extra**, and the seam it arrives through is
`tabPreludes` — `{ [tabKey]: (ctx) => node }`, a desk-specific section the
shared column renders *above* a base tab's own body. It replaced `extraTabs`
(whole tabs appended after the base five), because a prelude is the narrower
seam: the only thing a desk wants above a tab is the part that changes, and a
section can't fork the tab list or the tab-bar layout the way an extra tab
could. The adjudication desk passes none.

**`extraTabs` came back for exactly one thing, and it is not a regression of
that argument.** `Scene` (`SceneTab.js`) is the live feed where the inspected
character is standing — Chat's own `Feed` component, read-only, over that
Location, its Rooms and its Conversations, on the same `/api/feed` stream and
the same GM gate (`CHAT.md` §8). It is not a section above anything: there is
no base tab it belongs over, it fetches nothing the shared fetchers know about,
and it must NOT take a slot in the per-`(character, tab)` cache, because a
stream cached for the life of the page view is a stream pointed at wherever
somebody used to be. `extraTabs` is `{ [tabKey]: (ctx) => node }` like
`tabPreludes`, appended after the base five, with `useInspectorData` skipped
for it entirely.

**The caching story is the whole reason a prelude is not a tab.** A prelude
owns its own fetching and its own freshness and takes **no** slot in the
shared per-`(character, tab)` cache: `CanonTab` refetches on every mount by
design, because staged rows and the open Move change under the GM all day.
Past moves are settled history, so they stay cached for the page view like
every other base tab. The prelude also renders *before* the loading/error/data
branches, so this turn paints without waiting on the past-turns fetch.

`InspectorHost.js` is the client half. Which person the column shows is
**derived, never stored**:

- `useSelection()` is who the rail has open (`players/selection.js`), so
  opening a conversation points the inspector at that player with nobody
  having to tell it. It used to be `useSelectedLayoutSegment()`, back when
  opening somebody was a route;
- a `useState` **override** holds the last person clicked in the inspector's
  own search box or pin row, which is how a GM looks at somebody *other* than
  the open conversation.

The override remembers which segment it was set under and is ignored once the
route moves on, so navigating to another player follows the route again
instead of staying stuck on a stale pin. All of it is computed during render:
there is no context, and no effect syncing state to a prop — the latter is a
lint **error** here (`react-hooks/set-state-in-effect`).

**Canon** is the player's open Move, staged messages and staged effects, with
"Insert into reply" buttons that write into the composer's draft. The wire
used to be a ref handed down from `PersonShell` while the two were siblings;
the inspector is a column of the shell now, so it writes the draft's
`localStorage` key directly (`players/dmDraft.js`) and the composer — whose
value *is* that store, read through `useSyncExternalStore` — picks it up.

## 7. GM notes (removed)

There is no GM-notes tab. `GmCharacterNote` still exists in the schema —
nothing reads or writes it — and stays orphaned on purpose; dropping it is a
separate, deliberate migration.

## 8. Getting between the desks

- **⌘K** (`CommandPalette.js`) — a player, an open Move or Request, a zone, a
  faction, or any page including the ones with no rail item at all
  (`/gm/dev/tags`, `/gm/dev/factions`). It also offers
  "Audit: about <name>" and "Audit: by <name>" per character, which are just
  pre-filtered `/gm/audit` URLs — the audit desk keeps its whole filter state
  in the query string, so anything can link into a view of it. Built
  on `Modal` so it inherits the focus trap and the topmost-Escape stack; its
  `.modal-overlay` also stands the adjudication desk's Escape and 45s refresh
  down, the way every other dialog does. The index is fetched on first open and
  held for a minute.
- A **Move or Request** links to that player's conversation; the
  conversation's **Canon** section (top of the Moves tab) links back to that
  Move already selected.
- A roster row's name opens the conversation; the icon beside it opens the Dev
  Panel.

## 9. Revalidation

The rail lives in `layout.js`, and **a page path does not invalidate what is
below it**. So every `revalidatePath("/gm/players")` is
`revalidatePath("/gm/players", "layout")` — without it a GM sitting in a
conversation never sees the list move. There are a dozen call sites across
`faction/`, `gm/`, `gm/dev/`, `lifeweb/`, `gamemasters/` and the adjudication
desk's own actions. `markConversationRead` is the deliberate exception (§5).

## 9a. The live inbox

A player's reply reaches an open desk because Postgres says so, not because
the desk asked. The chain is the one Chat already runs (CHAT.md §3), with one
link added for the GM chair:

    a DirectMessage is inserted, by anyone
      -> the DirectMessage_notify trigger raises NOTIFY bascinet_dm
         -> web/lib/feedHub.js, one LISTEN per web process
            -> subscribeToAllDms, the desk's fan-out
               -> /api/gm/inbox-stream, one SSE stream per desk tab
                  -> InboxStream.js -> liveInbox.js -> the rail and the pane

**The trigger fires for every row and always did.** Nothing in code sends this
notification — `db/lib/dmNotify.js` explains why a trigger rather than a call
in each writer — so the three `sendDm` twins, the bot's inbound logger, Chat's
composer and the next one somebody adds are all covered without knowing it.

**What the desk subscribes to is the firehose.** A player's conversation
belongs to one account, so `subscribeToDm` is keyed by recipient; the desk's
inbox is every conversation at once, and keying that would mean a few hundred
subscriptions and a resubscribe whenever somebody new wrote in. So
`subscribeToAllDms` takes no key at all. It is a nudge and never an
authorisation — `/api/gm/inbox-stream` has already established the reader is a
GM through `getGmSession()`, and re-reads every row it sends through the
desk's own filter. A non-GM gets 204 and no stream.

**The row is read twice, once per chair.** `handleDm` and `handleGmDm` in the
hub do not share a read, because the two chairs disagree about both rows and
columns: the player's filter keeps mention relays and drops the author, the
desk's drops the relays and needs the author to say who answered. Sharing one
read would mean one chair quietly inheriting the other's rules — the class of
bug `withoutDmNoise`'s `perspective` exists to prevent. `GM_DM_SELECT` /
`gmDmRow` in `web/lib/dmThread.js` are the desk's half.

**The payload did not change when the trigger did.** A frame on the stream is
the same `{nowMs, cursorMs, rail, thread}` that `web/lib/inboxDelta.js` has
always produced, folded by the same `applyDelta`. What moved is only *when* it
is built: on a notification instead of every three seconds. Bursts — a
broadcast, a turn announcement reaching a hundred players — are coalesced over
120ms so the delta's query runs once rather than a hundred times.

**Every timestamp still comes from Postgres's clock**, never `Date.now()`: the
web container and the database are different machines, and a few hundred ms of
drift the wrong way would blind the cursor for good. Both sides now read that
clock BEFORE the queries it stamps, so a stamp is a floor rather than a
ceiling — never later than the data it describes. Read the other way round, a
layout's watermark could land after a message its own queries had missed, and
then `mergeRailRows` discarded the patch carrying that message as "older than
the rows". The desk chimed and showed nothing until a reload.

**A patch that is older than what is held is dropped.** Two paths feed this
store, and the 30s `full=1` backstop builds its answer from a read that can
predate a frame the stream already delivered. Folding it in unconditionally is
how a row that had just gone to zero unread came back saying three.

**The read cursor is a local override until the server catches up.** Marking a
conversation read deliberately revalidates nothing (§9), so the rail had to
wait for the next frame to learn about it and the nav rail's Players badge —
server-rendered, with no patch consumer at all — never learned about it. Now
the pane notes the read in the store the moment it fires
(`liveInbox.js#noteConversationRead`), `markConversationRead` hands back the
cursor it actually wrote, and the override is re-noted with that value —
**replacing** the first note rather than having to beat it. That distinction is
the whole of a bug: the first note guesses the cursor from the BROWSER's clock,
so a machine running two minutes fast claimed to have read two minutes of
messages it had never seen, and because the store only ever raised an override,
the server's real answer was thrown away. Every message the player sent in that
window arrived already counted as read and the badge simply never came back.
Raising is right between two guesses; the server's answer is not a guess. It
clears when the server's own rows echo a `lastReadAtMs` at or past it
(`reconcileReadOverrides`, called from an effect so `mergeRailRows` stays
pure), or on age if that echo never comes. An override touches one field, the
unread count — not `lastDirection`: having read somebody does not make it your
turn to have written last. `DeskInboxCounts.js` publishes the merged number to
the rail badge through `navBadge.js`, and withdraws it on unmount, so the two
can never disagree and no other page inherits the desk's count.

**The merge rule.** A patch lays over a rail row only when the patch is newer
than the row (`liveInbox.js#mergeRailRows`), as a whole — its fields came from
one consistent read. The merge happens *before* the rail's ✓/⊘ overrides look
at a row, because the ✓ override is keyed on the row's last-message time and
has to see the live one to un-stick when a new message lands. The header's
`N unread · N awaiting` chips count the same merged rows
(`DeskInboxCounts.js` over `railCounts.js`), so the header cannot disagree
with the rail. Someone the rail has never seen — a guild member with no
character writing for the first time — arrives as a whole row inside the
patch, built server-side from the member cache.

**Two backstops, because one live path is not enough.** This section used to
argue against a stream outright: "a dropped stream that looks alive is exactly
the failure class this desk has already been burned by." That objection was
right about the risk and wrong about the alternative — the failure it feared
had already happened inside the poll, which latched itself off after a deploy
and stopped rescheduling while the chime went on ringing. So the stream is
carried by two independent things:

- **`resyncDm`.** When the hub's pg client drops and reconnects, rows written
  in the gap were fanned out to nobody. Every open stream is handed a
  `{resync:true}` sentinel, winds its cursor back, and re-asks. The cursor
  cannot have advanced during the outage — no frames went out — so everything
  missed is above it.
- **A 30s poll**, the old fast path demoted. It hits the same
  `/api/gm/inbox-delta` with `full=1`, so the open thread (which has no other
  backstop) is repaired outright rather than from a cursor. It rings the chime
  too: a GM whose stream died should still hear their mail.

And the desk **says** when it is running on the backstop. `InboxStreamChip.js`
over `inboxStreamStore.js` puts "Catching up" in the header after two
consecutive drops, or "Live feed off" if the stream never opened at all (a 204
closes an `EventSource` without ever firing `open`, which is what being signed
out looks like from here). A live path that has quietly stopped is worse than
one that never existed; this is the part §9a was right to insist on.

**The tab owns its reconnect**, not `EventSource`. Its own retry replays the
URL it was opened with, pinning `since` to a cursor that is stale by the
second attempt. `InboxStream.js` closes and reopens from wherever this tab
actually got to, backing off 1s to 30s with jitter so five GMs who dropped
together do not return in the same millisecond. `visibilitychange`, `online`
and `pageshow` each retry at once rather than waiting out a backoff.

**The chime** rings for an inbound message on any conversation but the open
one, or on any conversation while the tab is hidden. The first frame of a
connection is never announced — it reports what was already there, and a
reconnect is not news. `chime.js` remembers when it last rang, so
`InboxChime.js` (fed by the 30s refresh's badge count) does not ring a second
time for the same arrival.

**Deploys.** Every frame carries the build version; a mismatch latches the
same `stale` flag (`useDeskVersion.js#noteDeskVersion`) and the header offers
the reload. It does **not** stop the stream or the backstop: both are plain
GETs into a client store, and neither can reach Next's build-mismatch full
navigation. That hazard belongs to `router.refresh()`, which is
`InboxPoller`'s job and is still correctly stood down by the latch.

## 10. File map

| File | Role |
|---|---|
| `(desk)/gm/players/layout.js` | Desk shell + all rail data (the union query), stamped with the DB clock |
| `InboxStream.js` / `liveInbox.js` | The SSE stream and the store it fills — patches for the rail, the message feed for the open pane (§9a) |
| `inboxStreamStore.js` / `InboxStreamChip.js` | Whether the desk is live or on its backstop poll, and the header chip that says so (§9a) |
| `InboxPoller.js` | The 30s `router.refresh()` for everything the stream cannot see — roster edits, staged effects, another GM's action |
| `DeskInboxCounts.js` / `railCounts.js` | The header's unread/awaiting chips, counted over the live-merged rows |
| `web/lib/inboxDelta.js` | The delta query — the payload for BOTH the stream and the backstop poll |
| `app/api/gm/inbox-stream/route.js` | The desk's SSE stream: GM-gated, pushed off `bascinet_dm` (§9a) |
| `app/api/gm/inbox-delta/route.js` | The same delta as a GET, for the 30s backstop |
| `web/lib/feedHub.js` | `subscribeToAllDms` + `handleGmDm` — the desk's half of the DM fan-out |
| `PlayerRail.js` | The inbox rail: search (widens to the roster, pauses filters), zone filter, Needs-reply toggle, pins, the ✓ needs-no-reply mark, the ⊘ mute and its Show-muted toggle |
| `[[...selection]]/page.js` / `RosterTable.js` | The fleet view + bulk verbs. The desk's ONLY route — the catch-all keeps it mounted while a conversation is open (§5a) |
| `selection.js` | Who is open, as client state, with the URL kept in step by pushState (§5a) |
| `threadStore.js` | The conversations this tab has loaded, so reopening one costs no request (§5a) |
| `DeskMiddle.js` | Draws the open conversation over the roster, and owns the abortable fetch (§5a) |
| `FactionsPanel.js` | The faction hierarchy view |
| `actions.js` | DM send/page, content search, canon load, read cursors, claims, staging, broadcast |
| `app/api/gm/thread/route.js` | One conversation as a GET: header + newest page, or an older page from a cursor (§5a) |
| `conversation/PersonShell.js` | The person view's wrapper (conversation only) |
| `conversation/ConversationPane.js` | Thread + composer, optimistic send |
| `InspectorHost.js` | The shared inspector's player-desk half: derived selection, pins, the Canon prelude |
| `components/InspectorColumn.js` | The shared inspector itself (ADJUDICATION.md §3) |
| `SceneTab.js` | The **Scene** tab — Chat's `Feed`, read-only, on one place at a time through `/api/feed?place=` (CHAT.md §8) |
| `CanonTab.js` | The "This turn" section — current Move, staged messages/effects, stage-a-DM box — rendered as the Moves tab's `tabPreludes` entry, refetched per mount |
| `dmDraft.js` | The composer draft's `localStorage` key, shared with Canon |
| `BulkComposer.js` / `BulkMessageButton.js` | The broadcast modal and its header door |
| `components/usePins.js` | Pins, shared with `/gm/turns` |
| `components/useSubmitOnEnter.js` | Enter-to-send, IME- and touch-guarded |
| `components/DmThread.js` + `web/lib/dmTime.js` | The chat-style thread: author runs, day dividers, the NEW line, follow-if-following scroll |
| `components/useNowTick.js` | The beat behind every relative time on the desk |
| `components/CommandPalette.js` + `paletteActions.js` | ⌘K |
