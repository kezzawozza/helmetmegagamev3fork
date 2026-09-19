# Rebuild /chat from the mockup's bones

A skeleton, not a finished design: the phases and the checklist are the point.
Tick items off here as phases close. `DESIGN-SYSTEM.md` still holds the app-wide
styling rules; this doc is only about the rebuild of `/chat`, and its **Phase 0**
section is where chat's own vocabulary gets written down.

**Nothing is dropped.** Every feature master has is ported onto the new
skeleton — that decision is settled, and the checklist at the bottom is what
holds the rebuild to it.

## Context

`/chat` was originally ported from `docs/design/mockups/chat/index.html` and
still carries its class vocabulary. The interface then grew by accretion on that
skeleton and stopped reading like it.

A CSS pass already landed — contrast (feed↔container separation 1.01 → 1.16),
type scale, the girder at one size, rail density, a composer that holds still.
That fixed what CSS can fix. It did not fix the structure underneath.

**Bascinet's decisions, and they change the shape of this plan:** keep the five
aside blocks, keep the fold chevrons *and persist them*, keep the composer's
tools row and in-box send, keep the places tail strip. Port everything.

So this is not a simplification. It is the same feature set, re-expressed on
clean bones.

## The number that decides how this is done

| | |
|---|---|
| Mockup's stylesheet | **307 lines** |
| `chat.css` | **3,104 lines** |
| Top-level classes ours defines that the mockup never does | **149** |

**About 90% of the chat's CSS styles surfaces the mockup has no vocabulary
for** — the composer box, tools row and command strip, the aside stack and its
eight blocks, the tail strip, travel nodes, the things drawer, the members
strip, search, notice cards, backlog edges. The mockup draws a places column, a
feed, three blocks and a three-control composer. That is it.

The consequence, and it is the whole plan: **copying the mockup is 10% of the
job.** The other 90% is deriving a *design language* from those 307 lines and
applying it deliberately to 149 surfaces that were each improvised on their own.
If the rebuild skips that step it will improvise again and land back here.

So Phase 0 is not scaffolding. It is writing the vocabulary down.

**What this buys, stated honestly.** With nothing removed and the CSS pass
already landed, the visible day-one change is moderate: consistency across those
149 surfaces, and folds that survive a reload. The lasting gain is that the next
surface added to chat has a rule to follow instead of a precedent to copy.

## The line: what is rebuilt, what is kept

**REBUILT** — every component that renders, plus `chat.css` in full. New files
under `web/app/(app)/chat/next/` so master keeps working until cutover.

**KEPT, untouched** — `actions.js` (~2,716 lines), `dmActions.js`, `commands.js`
(a registry and dispatch contract, not UI), and the transport stores.

**SPLIT WITH CARE** — `Chat.js` (SSE, reconnect/backoff, cursor and gap logic
tangled with all the layout) and `Feed.js` (2,408 lines: row rendering *and*
composer behaviour *and* command handling).

| | lines | |
|---|---|---|
| Kept outright | **4,392** | `actions.js` 2,716 · `commands.js` 241 · stores 1,435 |
| Rebuilt | **~6,500** | Chat, Feed, PlacesColumn, both asides, the blocks |
| Split with care | **~3,200** | hooks, dialogs, `PlacePanel.js`, `page.js` glue |

**The cutover is one line.** `ChatView.js` is a 29-line shim: `page.js` builds
one object and spreads it into `<Chat>`. Swapping that for `<ChatNext>` leaves
`page.js`, the snapshot machinery and both providers untouched.

### Two things that are NOT chat's to rewrite

- **`TranscriptLine.js` lives in `web/app/components/`**, and `/archive` and the
  GM desk's DM thread render through it too. Keep its variant contract; restyle
  via CSS only.
- **`seenStore` / `notifiedStore` hold a durable localStorage contract** —
  cross-tab, cross-reload. Keep the read/write API and storage format.

## The bones, and what they actually give us

The mockup contributes a *vocabulary*, not a layout to copy wholesale:

```
.app       grid: 186px | 8px | 1fr | 8px | 252px
.bar       a girder head — 26px, bg2.png, 10px caps, --text-hi
.rail      metal strip between columns
.place     an indented row under a .sect heading, with active/unread states
.block     a framed container whose h3 wears .bar
.you-frame a sprite plate with a recessed .you-well inside it
.feed      the lit ground; everything beside it is washed down
.composer  a say row over a foot
```

**The aside will be eight blocks, not the mockup's three**, and will not match
`screenshot.png`. That is the decision, made deliberately. The mockup's aside is
the reference for how a block *looks*, not for how many there are.

## Phase 0 — the vocabulary  ✅ done

**[`docs/design/chat-vocabulary.md`](../design/chat-vocabulary.md)** — chat's
visual language, derived rule by rule from the mockup's 307 lines. Seven rules:
the depth ladder (well / block / column / ground / chip / control / float), the
three edges, the three type rungs, the two kinds of heading, the canonical row,
what is allowed to float, and the sprites.

Read it before adding any surface to chat. A thing that fits no rule there is a
decision to make in that doc first, in one line, before it is built. That is the
whole guard against improvising these 149 surfaces a second time.

All 149 orphan classes are bucketed against it. That turned up **five surfaces
the mockup's own language had no name for** — the rail between columns, the
sprite plate around the You well, a clickable content card, a sticky bar, and
the fact that GROUND is painted twice — so the vocabulary gained rules for them
rather than the rebuild improvising a second time.

It also turned up **nine rules already broken** and **six pairs doing one job
under two names**, both listed in that doc's §8 and §9. The clearest: the three
sticky bars in chat today use three different backgrounds (`--surface-raised`,
`--surface`, `--bg`), which is what a missing rule looks like from the outside.


## Phases

Each ends with something that runs.

1. **Scaffold** ✅ — `web/app/(app)/chat/next/ChatNext.js` and
   `web/app/chat-next.css`, reachable at **`/chat?next=1`**. The five grid
   tracks, both rails, a girder at the head of each column, and the places
   column's groupings rendering real data. Measured against the mockup: girders
   26px/10px, rows 21.6px, column at `rgba(0,0,0,.3)`.

   `chat-next.css` is scoped under `[data-chat-next]`, which only `ChatNext`
   sets — `[data-chat-next] .bar` is (0,2,0) against `chat.css`'s (0,1,0), so
   it wins inside the new tree and is invisible outside it. Verified: live
   `/chat` has no such root and is byte-identical in behaviour. **At cutover**,
   strip the prefix from every selector and rename the file; the class names
   are already final, which is why this is scoped rather than prefixed.

   Fixed on the way in, from the §8 list: the girder pinned to one height, the
   row resting at `--text`, `--row-hover` for hover, `--rivet` for the occupied
   row, one QUIET rung, the coarse-pointer floor scoped to coarse pointers, and
   `--zone-ink` so the zone divider stops borrowing `--warning` (gated in
   `audit:contrast` at 8.13).
2. **Places column** ✅ — `next/PlacesColumn.js` and `next/foldStore.js`. Every
   grouping, the mail glyph, unread, the notified badge, vantage, hover-card
   descriptions, the tail strip and the foot slot. Bascinet's row is
   synthesised here the way `../Chat.js` does it, so the column matches the
   live one row for row.

   **Folds persist.** Verified: fold a section, reload, still shut; a second tab
   follows within the same session; and with `localStorage` throwing (a private
   window with site data blocked) the column still draws every row with no page
   error.

   Two §9 collapses done: one fold control instead of `.chat-fold` and
   `.chat-details-fold`, and one row recipe instead of `.place`,
   `.chat-person` and `.chat-search-row`. The column also stopped threading
   `selected`/`seen`/`notified`/`newest`/`onSelect` through every section — the
   grouping reads each row's state once and hands sections rows that already
   know what they are.
3. **Feed** — `next/Feed.js`. The scroller: every row variant (driven through
   `TranscriptLine`'s speech / system / block, which is why a shout, an emote,
   an ambient line and a decree each look like themselves), run-grouping at
   7 minutes, the turn daybreak rule, the NEW bookmark, the backlog edge, the
   skeleton, the empty state, the live-arrival fade, sticky-bottom scroll with
   a derived "N new" pill, backlog paging with anchor-preserving restore, and
   the row action bar with its ⋯ touch twin.

   `ChatNext` also gained the per-place history load — `seedInitial` covers the
   OPENING place only, so without it walking into a room drew an empty scene.

   **Still owed, and carried rather than claimed:** in-feed search, notice
   cards, the row-action handlers themselves (Change / Delete / Look at /
   Photograph / Save to Notes / Remove are wired as props and land with phase
   4's action plumbing), and the LIVE STREAM. The SSE connection, its
   reconnect/backoff and gap recovery live in `../Chat.js` tangled with that
   file's layout; splitting them out is the plan's "split with care" and is
   its own piece of work. Until then the rebuilt feed renders seeded history
   and pages backwards through it — everything except lines arriving while you
   watch.
4. **Composer** — `next/Composer.js`. Say / Shout / OOC off the same `where`
   gate the slash list takes, the `/` and `@` menus, the tools row, the in-box
   send, per-place drafts, the slowmode countdown with its 429 retry, autosize,
   the per-command counter, and the refusal line for a place that is not
   speech. Verified end to end: a line sends optimistically, the box clears,
   and it is still there after a reload; picking Shout moves the feed **0px**.

   `useComposerCommands` and `commands.js` are KEPT and driven, not rebuilt —
   speech is already a command, so Say/Shout/OOC drive command mode rather
   than adding a second send path, and the cap, the clearing and the
   hand-back-on-refusal stay written once.

   Carried from the CSS pass: the command strip does **not** draw for a voice
   picked from the dropdown beside it, because the dropdown already reads
   "Shout" and repeating it cost a whole row of the scene.

   **Still owed:** chip arguments (a command that wants a person or a
   destination), the "somebody is typing" line (the ping goes out; the readout
   does not), the GM system composer, and `lettersMenu` — the ✉ tools menu is
   built but nothing feeds it yet.
5. **Aside** — `next/ChatAside.js`. The You plate over its well, then Turn,
   Here, Waiting on you, the place card, the party, the room (only while one
   is open), travel, and the two fold drawers — Things and Desires — with the
   Sheet link under them.

   The WIRING is `../ChatAside.js`'s, unchanged on purpose: the two polls, the
   one `usePlaceActions` bag that owns every dialog, the fixture filter, the
   Move dialog's `onDone` chain. Those are load-bearing and already right, and
   rewriting them would only be a chance to lose one.

   What is rebuilt is the SHAPE. The old column ran nine sections under four
   headings — the place card, the room, travel and the party each arrived as a
   bare body with nothing naming it, so a reader scrolling met three unlabelled
   boxes in a row. Every framed section wears a girder head now
   (chat-vocabulary.md §4); the two that already carry their own fold heading
   keep it rather than being given a second.

   That turned up two real duplicates, and both are fixed at the child rather
   than hidden in CSS: `PlaceCard` and `TravelNodes` take `showTitle`, the way
   `HereList` already did. It defaults true, so the live chat is untouched.
   Travel's count is not a title, so it stays either way — it just stops
   carrying the repeated word.

   The CHILDREN are mounted, not rewritten. `PlaceCard` carries the fixtures
   and the Depot / Factory / Research doors, `TravelNodes` the crossing
   confirm, `PartyRack` the escort offers; they are deep game surfaces, and
   the named risk here is a rewrite losing one quietly. They are restyled from
   `chat-next.css` instead.

   **Still owed:** the four handlers `../Chat.js` owns rather than this column
   — `onPlaceChanged`, `travelPick`, `addPlace`/`onAddMember` and the map
   overlay. Each is a piece of the stream or of a surface phase 6 and 7 build,
   and each defaults to null, which every child already handles.
6. **GM aside + DM pane** — `next/GmAside.js` and `next/DmPane.js`.

   The GM's column follows the player's, which is the rule it already had
   (CHAT.md §8): every `.chat-card` with a `.chat-section-title` inside it is
   a `.block` with an `h3.bar` over it. Same readouts, same words, on the
   vocabulary's container. `PlaceCard` here gets the same `showTitle={false}`
   the player's does, for the same reason.

   The TAB STRIP stays, though the player's column dropped its own. It is on
   the checklist, and it is doing work here the player's was not: a GM's Place
   tab alone runs to every room in a Location with every room's stash under
   it, and four of those stacked is a column nobody reaches the bottom of.

   The DM pane is the smallest rebuild of the eight, because it was already
   the shape the vocabulary asks for — one composer row with the send inside
   the box, a foot that exists only when it has something to say. What went is
   the SHELL: it drew its own `.chat-main` and its own `ChatHead`, since it
   used to replace the whole centre column, and the rebuilt shell owns the
   girder head for every place. `drawers` went with that head — the phone's
   controls live on it, and that is phase 7's. Verified end to end: a line
   sends, the box clears, and it is still there after a reload.
7. **Phone** — drawers, swipe, tap floors, ⋯ sheet.
8. **Cutover** — flip `ChatView.js`, delete the old files in one commit.

## Persistent folds — the one new behaviour

Everything else is a port. This is the only thing that changes how chat behaves.

Today `PlacesColumn.js:211` holds fold state in `useState(() => new Set())`, and
the comment above it (`:29`) explains why it is session-only: a bug where
`.bar`'s flex-grow shorthand swallowed the column's free space once it stopped
overflowing. **That bug is already fixed** — `.bar` pins `flex: 0 0 auto`
longhand, which the CSS pass preserved, and the comment itself says folding no
longer breaks the column. So persistence is safe to reinstate.

Build `foldStore.js` on `asideTabStore.js` as a template — it is the same shape
and already solves the hard parts:

- `useSyncExternalStore`, **never an effect** (`react-hooks/set-state-in-effect`
  is an error in this repo, per `DESIGN-SYSTEM.md`).
- A stable cached snapshot, invalidated on write, or the hook spins.
- A `storage` listener so a second tab stays in step.
- `readServer()` returning empty, or it is a hydration mismatch.
- Every read and write wrapped against a throwing accessor (private windows).

Differences from `asideTabStore`: the value is a set of fold keys rather than one
string, keyed per zone+section. Prune keys for places that no longer exist so the
entry cannot grow forever.

One consequence worth accepting knowingly: a folded section stays folded across
reloads, so a new place appearing inside it is not seen until it is opened.
Discord behaves the same way.

## Feature checklist

Nothing gets dropped. Every item below has to exist in the rebuild.

**Places column** — Mail (DM, Deadchat) · Radio (nets, party) · per-zone groups
in server order · zone divider only when ≥2 zones · Summary/Here/Rooms/
Conversations/Elsewhere · "Here" vs "Locations" pluralisation · active · unread ·
notified count badge · vantage · mail glyph · hover-card descriptions · **folds,
now persistent** · tail (view-as, push bell, mark-all-read) · foot slot.

**Feed rows** — speech · emote · system/ambient · shout / shout-near / muffled ·
OOC · whisper · intercom block · decree block (blackletter) · daybreak · NEW
divider · backlog edge · skeleton · empty state.

**Feed interactions** — hover action bar + touch ⋯ twin · inline edit (5-min
window) · ArrowUp recalls last line · delete own · GM remove any · look at ·
photograph · save to Notes · mentions · alias/hood with GM real-name · search
(debounced, everywhere/here, jump + flash) · sticky scroll + "N new" pill ·
backlog pagination with anchor-preserving restore · notice cards · run-grouping
(7-min) · live-arrival fade.

**Composer** — speech/command modes · voice dropdown · GM system composer · `/`
menu · `@` mentions · chip arguments · per-command limits + counter · command
answer line · refusal returns text · **tools ✉ menu** · **in-box send** · drafts
· slowmode (countdown, optimistic hold, 429 retry) · autosize · typing ping and
indicator · disabled states per place kind · Enter-vs-send by pointer type.

**Slash commands (12)** — `/move` `/travel` `/conceal` `/shout` `/ooc` `/roll`
`/play` `/look` `/converse` `/decree` (GM) `/add` `/remove`.

**Player aside (all eight blocks)** — You frame (mood, resources, purse, carry,
StatusStrip) · TurnCard · HereList + per-person menu · Waiting on you ·
PlaceCard (fixtures, Examine, Depot/Factory/Research/Map) · PartyRack ·
RoomPanel (stash) · TravelNodes · ThingsDrawer · DesiresBlock · Sheet link.

**GM aside** — tab strip (Place/Room/Travel/GM) · GmHereList opening the Dev
Panel · hooded rows showing real names · zone picker rail · GmPlaceBox.

**Dialogs** — Noticeboard (player + GM) · Converse · Word · Bell · Pray ·
Turret · ATM · Dropbox · Depot-turret · Quest-interact · Intercom · Move ·
Decree · PhotoReadout · LookReadout · Map overlay.

**DM pane** — pseudo-place, no seq · renders `DmThread` (shared with the GM
desk) · optimistic send with `clientNonce` · visibility-gated seen marks · own
length cap.

**Realtime** — one SSE connection with reconnect/backoff and wake-on-visibility ·
typing · deletes · places diff · gap recovery · mention detection into
notifiedStore · push notifications · row-cache instant paint · backlog prefetch
(players, capped 12).

**Phone** — Places drawer (≡, swipe) under 720px · aside drawer under 900px ·
MembersStrip face-pile · Enter becomes newline · ⋯ sheet replaces hover bar ·
map becomes a route not an overlay · nav links in the drawer foot.

## Risks

- **A rewrite loses things quietly** — the checklist is the mitigation.
- **Phase 0 is skippable and must not be skipped.** Without it the 149 surfaces
  get improvised a second time.
- **Scale** — ~6,500 lines of presentation, nothing removed to offset it.
- **Two implementations live at once** through phases 1-7.
- Constraints that still hold: no new copy, no hardcoded colours, no
  `position`/`z-index`/`transform` on the columns (traps `Modal.js`'s in-tree
  overlay), no `overflow` on the composer box, keep `.bar`'s `flex: 0 0 auto`.

## Verification

Per phase: `npm run lint --workspace=web`, `npm run build --workspace=web`,
`npm run audit:contrast --workspace=web`, `npm run dev:check`.

Visual: boot the local stack and screenshot each phase. **`echo $DATABASE_URL`
first** — this container exports a Railway one that shadows the local `.env`,
along with `AUTH_SECRET`, `DISCORD_TOKEN` and `RAILWAY_TOKEN`; prefix with
`env -u`.

Folds specifically: fold a section, reload, confirm it is still shut; open a
second tab and confirm it agrees; check a private window does not throw.

At cutover: walk the whole checklist item by item, with a living character and a
GM seat, desktop and phone.
