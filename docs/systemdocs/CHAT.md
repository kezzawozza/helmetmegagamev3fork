# Chat: the web face of a scene (`/chat`)

The web page where a character reads and speaks in the place they stand,
mirroring the Location's Discord channel. Phase 0 shipped 2026-09-06; the rest
of this document is the design it is growing into, so a later phase does not
re-decide it.

## 1. Why it exists

Two reasons, and both are Bascinet's.

- **Anonymity.** A Discord channel's member sidebar lists every account that
  can see it, and a Location channel is opened with a per-member overwrite
  (`CHANNELS.md` §3). Standing in the Keep tells everyone else in the Keep
  which Discord account you are. Nothing short of not being there fixes that,
  which is what the "web only" switch (§6) will do.
- **A face that feels instant.** Earlier web UIs felt slow because a send went
  through a server action, a `revalidatePath`, and a re-render of the whole
  server-component tree. Chat cannot use that path. This page does not.

## 2. One write path, and the record it writes

Everything a character says goes through **`db/lib/say.js`**, on both faces.
Before phase 1 there were three copies of the decision — the proxy ran the
speech gate, the babble pass and the autocorrect pass inside the webhook
poster, the Speak modal ran a second copy of the gate, and the web's say route
ran neither — so `{tag:stupid}` garbled a Discord message and left a web one
perfectly articulate.

It splits into deciding and writing, because the two faces need the same
decision in a different order:

- `prepareSpeech` — where you are (a web send only; Discord's own channel
  permissions are the gate for a Discord one), the speech block, length, the
  slowmode (web only, none in a Room or Conversation, 300 s in a zone summary), then the babble and
  autocorrect transforms and the presented identity.
- `recordSpeech` — the `ArchiveEntry` row, with the place key, the source and
  the alias.
- `sayInPlace` — both, for the web. **Discord** goes prepare → post the webhook
  → record with the message id; **the web** goes prepare → record, and the
  outbox posts it after.

`editSpeech` and `deleteSpeech` sit beside them with the **five-minute window**
(`EDIT_WINDOW_MS`, Bascinet's call) and the ownership check, and a GM passes
`{ gm: true }` to skip both. An edit re-runs the transforms; a delete is soft.
Neither touches Discord — §4 does.

### The record: every message is a row first

`ArchiveEntry` was already written for every proxied message
(`ARCHIVE.md`). Phase 0 added the columns that make it a live feed:

| Column | What it is |
|---|---|
| `seq` | `BIGSERIAL`, the cursor. Monotonic and assigned by Postgres, so the bot and the web never need to agree on a clock. A BigInt in Prisma: it crosses JSON as a **string** and is compared with `BigInt()`, never `Number()`. |
| `placeKey` | Where it was said: `loc:<id>`, `room:<id>`, `conv:<playerThreadId>`, `zone:<id>`. A snapshot string, no FK. `db/lib/placeKey.js` is the only thing that mints one; `placeKeyForChannel` resolves a Discord channel or thread id to one, memoised for a minute. |
| `source` | `DISCORD`, `WEB` or `SYSTEM`. The outbox (§4) only ever posts `WEB` rows on to Discord, which is what keeps a proxied message from being echoed back into the channel it came from. |
| `editedAt`, `deletedAt` | Soft delete everywhere since phase 1, so a client holding the row can reconcile and the outbox has something to read when it goes to remove the Discord message. `/archive` and `/chat` filter on `deletedAt`. |
| `discordSyncedAt` | The outbox watermark. Null on a `WEB` row means the bot has not posted it yet. |

`recordArchiveMessage` / `recordArchiveEvent` (`db/lib/archive.js`) write
`placeKey` and `source`, then run `SELECT pg_notify('bascinet_feed', …)` with
the row's seq, place key and `op` — `new`, `edit` or `delete`
(`db/lib/feedNotify.js`). After the insert, never inside it: a listener woken before the commit would look the row up and find
nothing. The payload is tiny on purpose; every reader loads the row and
re-checks who may see it.

### What the world says is a row too

Since phase 4, an ambient line writes an `ArchiveEntry` beside the Discord
post it already made — `source: "SYSTEM"`, no character, `channelKind:
"scene"`, and the plain sentence with **no `-#`** in it. The prefix is
Discord's way of rendering subtext; the web renders a SYSTEM row as
`.chat-subtext` itself, so storing it would put literal `-#` on the page.
`db/lib/scene.js#sceneLine` / `#sceneLineAt` is the one writer, best-effort
like every other archive write.

Beside, never instead: the poster still posts. And never through the outbox,
which handles `WEB` rows only — a SYSTEM row can no more be re-posted into the
channel it came from than a proxied one can.

| Poster | Where the row lands |
|---|---|
| `worldBroadcast.js#ambientEverywhere` | every Location |
| `worldBroadcast.js#broadcastToZones` | every zone |
| `soundBroadcast.js#broadcastSound` (so the Cathedral bell too) | one row per Location in earshot — the same words at every distance, since a bell never muffles and all the distance decided was the `-#` |
| `locationMove.js#announceGateCrossing` | the destination zone |
| `intercom.js#broadcastIntercom` | one row per zone in range, the `@here` left off — a notification is not part of what was said |
| `turretBurst.js#announceTurretBurst` | the gun's Location and its neighbours |
| `deathSmell.js#runDeathSmell` | each Location that stinks |
| the noticeboard's pin and tear, on **both** faces | the Location |
| `roomAnnounce.js#announceInRoom` | the Room |
| `whisperPoll.js` | the Room, one line per fifteen minutes |
| `advanceTurn`'s staged public declarations | the declaration's zone |
| the turn opening | one `TURN_START` per zone, `placeKey: zone:<id>`, so every zone feed carries the day line |

The intercom used to write a single row from the Speak handler with no place
key at all. It read correctly in `/archive` and was invisible in Chat,
because a zone feed can only show a row filed against its own place key — so
it is one row per zone now.

`/archive`'s **Speech** view hides them (`source: { not: "SYSTEM" }` beside the
`MESSAGE` filter, with `TURN_START` kept for the day divider). The events those
lines narrate already fold into the muted `<details>` under **Everything**, and
printing both would show every arrival twice.

## 2a. Conversation membership is a row now

`PlayerThreadMember (playerThreadId, characterId, createdAt)` — primary key on
the pair, cascading with its `PlayerThread`, indexed on `characterId`.

Until phase 2 the answer to "who is in this conversation" lived **only in
Discord**, as a thread member list. Two things were wrong with that. The web
feed could not read it without a REST call per conversation per render, and a
player whose Discord account is out of the channels entirely — the phase 5
"web only" switch — could not be in one at all.

So the row is the truth and **Discord's thread membership is its projection**.
Every writer records the row first and then adds the account:

| Writer | Where |
|---|---|
| Converse | `handleConverseCreate`, the creator |
| `/add` on a conversation | `bot/src/events/interactionCreate.js` |
| A mention into a conversation, typed in Discord | `bot/src/events/messageCreate.js` |
| A mention into a conversation, typed on /chat | `bot/src/lib/feedOutbox.js#relayWebMentions` |
| The invite replay on arrival | `db/lib/threadInvites.js#applyPendingInvites` |
| `/remove` | deletes the row |

All five go through `db/lib/conversations.js` —
`addConversationMember` / `removeConversationMember` / `conversationsFor` —
which is also what fires the presence notify (§3), so a `/add` on Discord makes
the conversation appear on the target's web page with no reload.
`PlayerThreadInvite` stays beside it and keeps its old job: it is what replays
the **Discord** add when the target finally walks into the Location.

**A hood can be let in** (`PROXYING.md` §5). `placeMembers()` offers them by
alias, `addMember(placeKey, ref)` takes a character id or a hood token — told
apart the way `/look` and `removeMember` tell them apart, a token is 32 hex
characters and a cuid never is — and the web `/add` declares `hoods: true` on
its `person` arg. The reply line was already safe: `presentedNameOf` has always
written it, so letting somebody in says "a young man was added".

The message wipe needs no new step — `deletePlayerThread` cascades.

## 2b. Bascinet is a place too: the DM conversation

Most of what the game says to a player is a DM, not a channel post — the turn
result, a travel outcome, an offer, the Bird, a GM's reply — and until
2026-09-07 Chat showed none of it. Now the places column opens with
**Messages · Bascinet**: everything the game has ever said to this player by
DM, and a box to write back into.

**It is not an archive place.** The whole feed pipeline — `placesFor`, the
stream's catch-up, `history`, `say`, `feedStore`, the wipe floors — is keyed
on `ArchiveEntry.seq`. A DM has no seq, must never appear in `/archive` or a
GM's Scene tab, and must never be wiped by the turn. So Bascinet is a
**pseudo-place**, the shape the faction banner already had: it is in the
column and it round-trips through the hash (`#gm`, `DM_PLACE_KEY`), and what
its row opens is a panel of its own, `DmPane.js`, rather than `Feed`.

**The record is `DirectMessage`, read from the other chair.** The GM desk
already renders that table as a conversation (`PLAYER-DESK.md` §5), through
`web/lib/dmThread.js#withoutDmNoise`, and the pane reads the same rows through
the same filter in the **player chair** (`{ perspective: "player" }`) — an
inspect embed is not conversation on either face, and a mention relay
(`source: "mention"`) is conversation here and not on the desk. The pane draws
it as one quiet line with an **Open** link to the place it happened in
(`meta.placeKey`, `DmThread.js#MentionBody`), where the Discord DM carries a
Discord link. Beyond that one row the two surfaces cannot disagree about what
was said.
`web/app/(app)/chat/actions.js#gmThread` pages it from the newest backwards; the row shape
(`dmThread.js#PLAYER_DM_SELECT` / `playerDmRow`) **strips the author**: a
player never learns which GM answered. The renderer is the desk's own
`DmThread.js` with one new prop, `perspective="player"`, which flips exactly
two things — the NEW line marks the first unread *outbound* row, and the
reader's own send is an *inbound* one. Every outbound row wears one face,
**Bascinet** (`BASCINET_PROFILE`), whoever typed it; a `staged_push` row still
carries the desk's `turn result` chip, and runs of notices still collapse.

**Live, off a trigger.** `DirectMessage_notify`, an `AFTER INSERT` trigger in
`20260913060000_dm_notify`, raises `NOTIFY bascinet_dm` with `{ id,
discordUserId }` (`db/lib/dmNotify.js`). A trigger rather than a call in each
writer, because there are four writers across three packages and a fifth is
one `sendDm` away — and NOTIFY is transactional, delivered at COMMIT, so the
"after the insert, never inside it" rule of §2 is kept by Postgres itself.
`feedHub.js` holds the LISTEN on its one client, re-reads the row through the
noise filter, and fans the player's shape to `subscribeToDm(discordUserId)`;
the stream writes it as `event: dm`. The **GM desk rides the same
notification** — `subscribeToAllDms`, keyed on nothing, because a desk wants
every conversation at once (PLAYER-DESK.md §9a). The hub reads the row a
second time for that chair rather than reshaping this one: the two filters
disagree (a mention relay is the player's and not the desk's) and so do the
columns (the desk needs the author, the player must never see it). **No cursor and no catch-up**: the pane
fetches its page on open and again on every reconnect — the tab's own
reconnects included, since `Chat.js` reopens the stream itself (§3) — through
`dmStore.js#noteDmReconnect`, and the store dedupes by id. A `router.refresh()`
no longer reopens the stream at all; when it did, the reopen never counted as
a reconnect and a DM landing in that window was lost to an open pane.

**Writing back is one row and no Discord send.** `sendToGms` inserts an
INBOUND row, `source: "player"`, `meta: { via: "play" }` — exactly what the
bot logs for a DM typed into Discord (`messageCreate.js`). Nothing goes to
Discord because there is nothing to send: the bot cannot speak as the player
in their own DM. The row reaches the desk the same way it reaches
any other reader — the trigger above, fanned to whichever GM has the desk
open — and the GM's answer goes out through `sendDm` to Discord *and* the
table, so it reaches the player on whichever face they are on. The send is optimistic
the desk's way: the row draws `pending` at once and retires when its twin
lands, whichever of the stream or the action brings it first. Both actions
gate on the **account**, not on a living character — the page is what needs
one, and a player whose character died with the tab open can still read what
Bascinet said and write back. `sendToGms` re-reads `playPanelEnabled` (a tab
open when the switch flips keeps its stream) and refuses past twelve messages
a minute, since every other composer in Chat is throttled.

**The dot and the NEW line** use `seenStore` like every other place. The
"newest seq" of the pseudo-place is the newest outbound row's **epoch ms** —
`isUnread` compares BigInt strings, and epoch ms is one — seeded by `page.js`
before the pane has ever opened and moved by the store from the first `dm`
frame on. The mention chime rings for an outbound row while the pane is not
the open place: a DM is always about you.

**What it replaced.** `Yesterday.js` and `yesterday()` are gone — the same
`staged_push` / notice rows are in the thread, every day rather than only
the last close. There is no separate "Report to the GMs": writing to Bascinet
is the report. Restart Game **wipes** `DirectMessage` along with the rest of
the per-game state (`web/app/(app)/gm/dev/actions.js`, the wipe transaction),
so a new game opens with an empty thread — and a "my DM never showed up"
report from before a restart has no row left to check.

### The buttons work here too

Some of what the game DMs a player *asks* something, and carries Discord
buttons to answer with: an offer's Accept/Decline (a lesson, a confession, a
bind, an escort), a threat spawn's, a lobby seat's Decline, the keyed way's
Yes/No. Those used to be answerable on Discord alone. All three `sendDm` twins
forward `opts.components` to Discord but log only `content`, so nothing on this
side ever learned a button existed — and the people worst served by that were
exactly the ones with no other face.

The DM does not carry Discord's component JSON across. A button here is a
**view of a pending row**: the DM records only which row it is about, in
`meta.action` (`db/lib/dmActions.js`), and the web derives the rest. So a
button cannot outlive the thing it answers — `web/lib/dmActions.js` asks which
rows are still answerable by this reader and only those draw, where a Discord
button stays clickable forever and merely refuses.

`db/lib/dmAnswer.js` is the load, the ownership check and the order of the
tail, shared so the two faces cannot drift; each keeps only what is its own
(the bot edits the interaction's message, the web re-renders the row). The GM
chair draws no buttons — `DmThread` gates them on `perspective === "player"`,
because a GM answering somebody else's offer is not a thing.

One trap worth knowing: an offer DM is `kind: NOTICE`, so without care it
renders as a system line and a run of three or more collapses into "N automated
messages". A row with live buttons is a question, not texture, so `isEffect`
excludes it. Do **not** reach for `kind: CONVERSATION` to solve that — "Ada
wants to bind you" sitting in the GM inbox as mail is the exact bug `kind` was
built to end.

## 3. Realtime: server-sent events from the web process

`web/lib/feedHub.js` keeps **one** `pg.Client` per web process (on
`globalThis`, the same trick as the Prisma singleton, so `next dev` does not
leak a listener per hot reload). It holds **five** LISTENs on that one client,
with one reconnect and one backoff between them all:

| Channel | Raised by | Fanned out to |
|---|---|---|
| `bascinet_feed` | `db/lib/feedNotify.js`, at every archived message | place key → open streams |
| `bascinet_presence` | `db/lib/presenceNotify.js`, when somebody's place list changes | character id → open streams |
| `bascinet_typing` | `db/lib/typingNotify.js` (§3, the third channel) | place key → open streams; the only payload the hub ENRICHES, resolving the presented name |
| `bascinet_dm` | the `DirectMessage_notify` trigger (§2b) | account id → open panes, **and** the GM desk's inbox stream, keyed on nothing |
| `bascinet_desk` | four triggers on `Action` / `CavingRoll` / `StagedEffect` / `StagedMessage` (`db/lib/deskNotify.js`, ADJUDICATION.md §3) | the adjudication desk's streams, keyed on nothing. The **only channel the hub reads nothing for** — the bare `{t, id, op}` goes straight out and `/api/gm/desk-stream` re-reads a whole beat's worth in one query |

Feed notifications run one at a time (a row lookup and an avatar lookup sit
between the notification and the fan-out, and two arriving in order could
otherwise reach a stream out of order). The other four stay off that chain
deliberately: none is ordered against anything, and a typing frame held up
behind a slow row lookup is a worse trade.

`GET /api/feed?since=` is **one stream per tab, for every place the viewer may
read**. Phase 0 opened a stream per place, which was fine when there was one;
a Chat has a Location, its Rooms, the conversations you are in and the zone
summary, and a browser allows six connections per origin — two tabs would have
starved the rest of the site.

The stream's order is: send the place list, catch up (`seq > since` across
every allowed place), then subscribe. Doing the read before the subscribe would
leave a gap a row written in between could fall into. It drops anything at or
below the last seq it sent, and writes `: ping` every 25 s so Railway's proxy
keeps the connection.

Four event names now, plus `dm` (§2b), which is not about a place at all.
`message` carries a whole row (a new one, or an edited
one the client replaces by seq); `delete` carries a seq and its place and
nothing else — the words somebody took back never come back down the wire; and
`places` carries the whole place list and a `reason` — `"open"` for the
announce every connection starts with, `"presence"` for one the character's
own movement raised. Only a new row moves the high-water mark, since an edit
and a delete both name a seq the stream has already sent.

**The tab owns the reconnect, not the browser.** `Chat.js` opens ONE stream
per mount and keeps it across every `router.refresh()`; it tracks the newest
seq the stream has *delivered* — not the page-load seq, and not the store's
newest, which a history fetch can push past another place's unread rows — and
on `error` it closes the `EventSource` and opens a new one from that cursor,
backing off from a second to half a minute with a little jitter. The
browser's own retry is deliberately not used: it replays the URL the stream
was opened with, which after a long session is a cursor the capped catch-up
can never reach the gap from. A tab coming back to the front (`visibilitychange`),
the network coming back (`online`) or a page restored from the back-forward
cache (`pageshow`) reopens at once. A drop says nothing about why — an
`EventSource` reports no status — so from the second failure in a row the tab
asks `GET /api/feed/places?probe=1` once, which answers off the session alone:
a 401 there is a session that has expired, and the tab stops and says so
(`streamStore.js`, a quiet line under the tab strip: the first drop says
nothing, the second says *Reconnecting…*); anything else is the server or the
network, and worth waiting for.

**The catch-up is capped, and the cap is honest.** Two full pages of
`CATCH_UP_LIMIT` rows is the most a reconnect replays. If the second page is
full as well, the gap was too long to fill row by row, so the stream moves its
cursor past it and writes `event: gap`; the tab answers by marking every
place's history idle (`feedStore.js#resetHistory`) and bumping a counter the
selection effect and the prefetch hang off, so both re-read each place from
the history route — which is also the only path that repairs a line deleted
or changed while the tab was away.

**Presence.** `db/lib/presenceNotify.js#notifyPresence(prisma, characterId)`
carries a character id and nothing else, because "which places may they see
now" is a query the listener has to run again anyway — and running it on the
reader's side is what keeps a notification from being an authorisation. Five
things fire it: the feet (`applyLocationMoveSideEffects`), a key
(`syncCharacterRoomAccess`, only when the entitled set actually changes),
being let into or out of a conversation (`db/lib/conversations.js`), a room
guest being added or shown out (`web/app/(app)/chat/actions.js`), and the "web only" switch
(`db/lib/webOnly.js` — the place list is unchanged, the chip in the column is
not). The stream re-reads the character (its Location moved, and the viewer it
opened with is stale), recomputes the place list, moves its subscriptions,
sends `places` with `reason: "presence"`, and catches the newly visible places
up from its own high-water mark rather than from zero — so walking into a room
does not replay a day of it. The page asks for that with
`GET /api/feed/history?place=` when the reader actually opens it.

The tab refreshes its right column (the shared transition refresh,
`useRefresh.js`) on a `places` frame whose reason is `presence`, or on a
reconnect whose list came back a different shape from the one it holds
(`feedStore.js#setPlaces` says) — and never on a reconnect that re-announced
the same list. It used to refresh on every frame after the first, which on a
reconnect was a full page refetch outside a transition, a loading-skeleton
flash, and the stream torn down and reopened; and the router's own URL
rewrite on that refresh is what dropped the open place (§5, `openPlace.js`).

**Prefetch, capped at twelve, and never for a GM.** After the first paint
`Chat.js` warms the backlogs of the other places one at a time so opening a
room is instant. A player's list is a Location, its rooms, their conversations
and a summary; past twelve of those the warmth is not worth the requests. A GM
is exempt outright — their list is every zone, Location and Room they may
watch, which is two hundred and more, and warming a Chat they will open one
room of is a storm the database pays for and nobody sees. A GM fetches on
selection.

`GET /api/feed/places` answers the same list on its own, for a client that has
reason to think it moved and no stream open to be told.

**`?place=`** narrows a stream to one place. The GM desk's Scene tab (§8) is
what asks: a GM's place list is every place in every zone they may see, and
subscribing to hundreds of them to watch one room is silly. It narrows the
subscription and nothing else — the place still has to be in `placesFor`.

**Typing.** A third channel, `bascinet_typing`
(`db/lib/typingNotify.js#notifyTyping`), carrying `{ placeKey, characterId }`
and no name. Two things raise it: `bot/src/events/typingStart.js` (the
`GuildMessageTyping` intent, not a privileged one; never in a DM and never for
a web-only character) and `POST /api/feed/typing { place }` from the composer,
gated by `mayWritePlace` and throttled to one notify per character per place
per 4 s in the route. The hub holds the LISTEN on the same single pg client as
the other two, resolves the **presented** name itself
(`loadForcedName`/`loadConcealment` + `presentedIdentity`, memoised 30 s per
character) and fans `event: typing` `{ placeKey, characterId, name }` — never
to the viewer's own character.

The name is resolved on the READER's side for the same reason the presence
payload carries nothing: a notify that shipped a name would let a typing event
out a name the reader is not owed. A concealed character types under their
alias, exactly as they speak under it.

The client holds each person for 6 s after their last event
(`play/typingStore.js`) and draws one line above the composer: *"X is typing…
"*, *"X and Y are typing…"*, *"Several people are typing…"*. Three is
where naming people stops helping. A Discord-side echo of a WEB typist is
**not** built — Discord has no API for a bot to type as somebody else.

**Why not a WebSocket service.** Sends are an ordinary `POST` either way, and
the optimistic append hides their latency, so bidirectional traffic buys
nothing. Railway runs `next start` as one long-lived Node server with one
replica. Revisit only if that ever becomes more than one.

## 4. The outbox: the bot owns Discord

`bot/src/lib/feedOutbox.js` is the **only** thing that posts, edits or deletes
a webhook message — since phase 1, on either face. The web never holds a
Discord token for chat, and neither does the reaction handler: a ✏️ or a ❌ in
Discord writes the row and lets the outbox do the rest.

Three verbs, chosen off the **row** rather than off the notification's `op`
(the op is a hint; the drain has no op at all):

| Row looks like | The outbox |
|---|---|
| `source = WEB`, no `discordMessageId` | Posts it through `db/lib/discordRest.js#postAsCharacter`, loading the forced name and concealment the way `messageCreate.js` does, and stores the id. |
| `editedAt` newer than `discordSyncedAt` | `editWebhookMessage`. |
| `deletedAt` newer than `discordSyncedAt` | `deleteWebhookMessage`. The row and its `discordMessageId` stay, so nothing ever reposts what somebody took back. |

Everything runs through one serialised queue — two posters against one channel
webhook would interleave a scene — and every verb **re-reads the row right
before acting** and stamps `discordSyncedAt` after, so a row picked up twice
acts once. `drainFeedOutbox()` sweeps the last 24 h on `ready` through that
same queue, which is what makes a bot restart mid-send, mid-edit or
mid-delete harmless.

**The outbox has a mirror going the other way.**
`bot/src/lib/messageCatchUp.js` sweeps Discord for messages typed while the bot
was down — ones that never became a row, because `messageCreate` never fired —
and re-proxies or files them. Same posture, opposite direction: windowed,
sequential, safe to run twice. Unlike this drain it also runs on `shardReady`,
because a web row waits patiently for the next restart while a Discord message
is lost the moment nobody hears it. `PROXYING.md` §2 has the detail.

Every place kind is wired: `db/lib/placeKey.js#discordTargetForPlaceKey` gives
back `{ channelId, threadId }`, because a Room or a Conversation is a thread
and Discord will not hang a webhook off one — the webhook belongs to the parent
channel and the call carries `?thread_id=`.

Discord-origin messages take the old path: proxy, webhook, then the row, now
stamped with `placeKey` and `discordSyncedAt`. The web hears about them from
the same NOTIFY.

## 5. The page

`web/app/(app)/chat/`. Rail item **Chat**, right under Character
(`web/lib/navItems.js`). **`GameConfig.playPanelEnabled`** is the switch, in
the Features group on `/gm/dev`, on by default. Off, the rail drops Chat,
`/chat` bounces to `/character` (GMs included — they have the desk's Scene
tab), ⌘K stops offering places and people, and the "Play from the web" switch
is neither drawn nor honoured — except for a character already `webOnly`, who
keeps it so they can come back, and is otherwise **not** flipped: check
`/gm/players` for them before turning it off. `/api/feed/*` stays up for the
Scene tab. Since phase 2 it has **left PageShell**: Chat owns
its whole screen the way the `(desk)` workspaces do, as the `.chat-*` family in
`globals.css` — a `100dvh` column whose regions scroll inside it, because a
chat that scrolled the document would drag the header off the top every time
somebody spoke. Tokens only; `npm run audit:contrast --workspace=web` gates it
like everything else.

### The 2026-09-09 pass

The page worked and was not pleasant: nothing on it had visual weight. Every
section header in all three columns was the same 11px uppercase muted label,
every right-column card was styled identically, the feed row mixed `.chat-*`
with loose Tailwind and had no hover state at all, and the composer had no
Send button on a desktop. What changed, beyond the aside tabs and the section
cards described under `ChatAside.js` below:

- **A filed Move reads as its words.** Its kind was a `.chip` in the turn chip
  row — filled, bordered, fully rounded — with the player's own sentence
  underneath reading as the badge's caption. It is `.chat-move-kind`, a quiet
  word in front of the words, and the `»` house mark stays.
- **The feed row lights up under pointer AND keyboard.** Hover moved out of
  React (`useState` off `onMouseEnter`, re-rendering a row on every mouse
  crossing) into `:hover` / `:focus-within`. The row action bar is now always
  in the DOM and revealed by CSS, which is what makes it reachable by tab at
  all — a keyboard fires no `mouseenter`, so it could never see the bar
  before. The cost is that the bar's buttons are in the tab order on every
  row; a roving-tabindex pattern would be the fix if that ever bites.
- **Only a line that ARRIVED animates.** `chat-row-in` ran on every
  `.chat-row`, so opening a place faded its whole backlog in at once. `Feed.js`
  keeps a lazily-filled ref of the seq the place painted with — a ref rather
  than state, since `react-hooks/set-state-in-effect` is an error here — and
  sets `data-live` above it.
- **The jump-to-bottom pill floats** over the feed as *"N new ↓"* instead of
  taking a layout row between the scroller and the typing line, which pushed
  the scene up every time somebody scrolled away.
- **The composer got a Send button on every pointer.** It rendered only under
  `coarse`, so a mouse had no submit affordance and nothing said Enter would
  send. The keys are spelled out beside it. The slowmode clock shows before it
  bites rather than only once it has, and a character count is drawn where a
  command actually caps its text.
- **Command mode is a strip** (`.chat-cmd-strip`) across the top of the box —
  name, what it does, an ✕ — replacing `.chat-cmd-chip`, an accent-tinted
  floating pill.
- **The `/` and `@` menus highlight under a mouse**, and pointing at a row
  makes it the active one, so Enter picks what the mouse is over.
- **Sections in the places column fold** (`sectionFold.js`, same
  `useSyncExternalStore` shape). A folded section **still shows anything
  unread in it**, with a count of what it is holding back: folding is for
  shortening a column, not for going deaf.
- **A breadcrumb** — Zone · Location — above the open place's name, since a
  conversation and the zone summary are both opened from somewhere.
- **`.chat-row-head` / `-name` / `-time` / `-body`** replaced the loose
  Tailwind, and `[data-alias]` tints a name somebody is speaking under a hood
  or a forced name with.
- **Touch targets.** `.chat-place` and `.chat-person` were 4px of vertical
  padding everywhere except inside the phone's sheet; they hold a floor now,
  44px under a coarse pointer.

**Corrected the same day.** HERE went in as a tab beside the other four, and
the first playtester to see it said pressing one to find out who is in the room
was tedious. It is not a tab any more — the people are drawn at the top of the
Place panel. The reasoning is under `ChatAside.js` below.

### The wireframes Bascinet chose

Desktop, three columns — `15rem minmax(0,1fr) 20rem`, carried as
`--chat-rail` and `--chat-aside-w` on `.chat-body` rather than as literals
repeated across the media queries below. The right column grew from 17rem in
the second pass: it is the game suite now, not a button strip. The feed's own
content is capped at `70ch` (`.chat-feed-inner`) — the scrollbar stays at the
column's edge and only the words are measured.

The right column below is drawn as the pre-tab stack, which is what it looked
like when Bascinet picked this. Read it for what is IN the column, not for how
it is arranged: PLACE, ROOM, TRAVEL and YOU are one tab at a time now, and HERE
sits at the top of PLACE rather than under the place card. The tab strip runs
where `[Place] [Zone]` is drawn — those two chips are the place card's own, and
they stayed.

```
┌───────────────┬────────────────────────────────────────────┬──────────────────────┐
│ PLACES        │ Council Room                     ◔ Dusk 4  │ THE KEEP             │
│               │ A long table under a cold window…          │ Fortress             │
│               │────────────────────────────────────────────│                      │
│ ✉ Bascinet  ● │                                            │                      │
│ ▤ Summary   ● │                                            │ [Place] [Zone]       │
│               │ ◉ Alexandra Hristov  13:58                 │ A high hall of black │
│ ▸ The Keep    │   Nobody saw it leave.                     │ stone; the winch for │
│   Council     │                                            │ the gate is in the   │
│   Kitchens  ● │ ──────────────── NEW ─────────────────────│ tower.               │
│   ▪ Vault     │                                            │ [Noticeboard]        │
│               │ ◉ Knife Hristov  14:02             ✎  ✕   │──────────────────────│
│ » Alexandra   │   "Where did the tithe go?"                │ HERE · 3             │
│               │                                            │ ◉ Knife Hristov  you │
│               │ ◉ Alexandra Hristov  14:03        🔍  📷   │ ◉ Alexandra      🔍  │
│               │   Ask the Censor.                          │ ◉ a hooded figure 🔍 │
│               │                                            │──────────────────────│
│               │ · Alexandra is typing…                     │ THIS ROOM            │
│               │────────────────────────────────────────────│ Storage · 2 loaves,  │
│ 🔔  web-only  │ [ Say something in Council Room…         ] │ a key                │
│               │                                            │ [Drop][Take][Transfer]│
│               │                                  4 s       │ [Intercom]           │
│               │                                            │──────────────────────│
│               │                                            │ TRAVEL · 1 free      │
│               │                                            │ ┌────────┐┌────────┐ │
│               │                                            │ │Gatehse ││Road    │ │
│               │                                            │ │FORTRESS││FOREST  │ │
│               │                                            │ │free    ││the turn│ │
│               │                                            │ └────────┘└────────┘ │
│               │                                            │ ┌────────┐           │
│               │                                            │ │Barracks│           │
│               │                                            │ │FORTRESS│           │
│               │                                            │ │shut    │           │
│               │                                            │ └────────┘           │
│               │                                            │──────────────────────│
│               │                                            │ YOU                  │
│               │                                            │ DAY 4 · DUSK  5 h    │
│               │                                            │ [Routine]  Ask the   │
│               │                                            │ Censor about…  [✎]   │
│               │                                            │ 12 ⬢  31/71 lb       │
│               │                                            │ Hungry  Dying        │
│               │                                            │ DESIRES              │
│               │                                            │ [Claim]              │
│               │                                            │ Opens on turn 9      │
│               │                                            │ [Sheet ›]            │
│               │                                            │ Waiting on you · 1   │
│               │                                            │                      │
└───────────────┴────────────────────────────────────────────┴──────────────────────┘
```

Three widths above the phone, one breakpoint each (`globals.css`, the
"ladder" comment above the `.chat-*` media blocks):

```
>= 1200        15rem | 1fr | 20rem     three columns
900 - 1200     12rem | 1fr | 17rem     the flanks shrink
720 - 900      11rem | 1fr   [👥]      the aside folds into the right drawer
<= 720         [≡] head [👥] / feed    one column, a drawer each side
```

The aside folds at 900px in the CSS **and** in `useAsideFolded.js`, and the
places column folds at 720px in the CSS **and** in `useNarrow.js` — the same
number in both places each time, or there is a band where a column is gone
and the button that opens it is hidden too. `.chat-drawer` itself is
unscoped: a drawer mounts only when its hook says its column is folded, so a
media query on the class was a second source of truth.

**Under 720px Chat is Discord's channel view** (2026-09-11). Before this a
phone stacked the app header with its turn chip, a tab strip of places, the
place head, a strip of faces, the members row, the typing line, a two-row
composer with Send and ⋯, and then the app's fixed bottom bar — and the
scene got what was left, which on a 390×844 phone was about a quarter of the
screen and less with the keyboard up. Now it gets everything but a 48px head
and a one-line box:

```
┌────────────────────────────────────┐
│ ≡•   The Keep              🔍  👥³ │
│────────────────────────────────────│
│ -# Somebody has entered from the   │
│    Square.                         │
│ ⊙ Cersei · Baroness         12:04  │
│   "Shut the door behind you."      │
│                                    │
│ ⊙ a young man               12:05  │
│   *pulls his cloak tighter*        │
│                                    │
│                                    │
│ Old Tom is writing…                │
│────────────────────────────────────│
│ ⊕  ▢ Say something…             ➤ │
└────────────────────────────────────┘
```

- **≡ opens the places as a drawer from the left** — the SAME `PlacesColumn`
  the desktop draws, sections, folds, unread dots and the chime/push/mark-all
  foot included, so nothing forks. The dot on ≡ means some other place has
  something unread (the column's own `isUnread` test). The drawer's title is
  `Town · DAY 6 · DUSK`: the app header is hidden on this route under 720px
  (`.chat-shell > .desk-header`), and this is where its turn chip went.
  Picking a place closes the drawer. Its foot carries the app's own links,
  drawn the way the bottom bar's More sheet draws them — because **the bottom
  bar is hidden on /chat under 720px** (`body:has(.chat-shell) .app-rail`),
  which is the one route in the app that does that (`DESIGN-SYSTEM.md` §9).
  `page.js` hands `Chat` the rail's own item list for it
  (`web/lib/navItems.js#loadNavItems`). GM mode's zone picker rides the same
  foot wherever the right column it lived in is folded.
- **👥 opens the right column as a drawer from the right**, with the count of
  people standing here on the button — the same `ChatAside`, the same four
  tabs, full height now rather than an 80dvh bottom sheet so Travel and You
  have room. The avatar strip that sat under the head is gone: the people
  are one tap away and the count is on the button.
- **Swipe** the scene right for the places and left for the people
  (`useSwipeOpen.js`: a mostly-horizontal touch move of 70px or more; the
  opposite swipe inside a drawer closes it). Touch events only, passive, no
  follow-the-finger — the drawer slides in on its own once the gesture
  lands.
- **The head is `ChatHead.js`**, one component the feed, the Bascinet pane
  and the faction panel all wear (each used to hand-roll its own). On a phone
  the crumb is dropped, the name is one line, and the description shows only
  once the name has been tapped.
- **The box is one line and grows** as you type, to about six lines
  (`Feed.js` sets the height off `scrollHeight` — on a desktop too, where two
  rows is the floor). Send is the ➤ glyph, and the ✉ and the hood fold behind
  one ⊕ at the left edge (Discord's +). The textarea is 16px there, or iOS
  zooms the page on focus.
- **Nothing else takes height.** The typing line sits OVER the last line of
  the scene rather than in a row of its own; the noticeboard scrolls away
  with the feed rather than pinning; the members row of a conversation folds
  to overlapping faces, a count and Add until it is tapped open
  (`MembersStrip.js`).
- **The keyboard.** `web/app/layout.js` exports `viewport.interactiveWidget:
  "resizes-content"`: Chrome on Android otherwise leaves the layout viewport
  alone when the keys come up and the composer sits under them. The three
  scrollers carry `overscroll-behavior: contain`, so the end of the feed is
  not pull-to-refresh.

### The parts

- **`Chat.js`** holds the one `EventSource` (opened once per mount — two
  effects, one that re-seeds the store from fresh props and one that owns the
  stream, §3), the place list, and which place is open.
- **`openPlace.js`** is where the open place lives: a module store read through
  `useSyncExternalStore`, never an effect. The URL hash *follows* it and is
  read only as input — on the first render (a `/chat#…` link, a notification)
  and on `hashchange` — and a place this browser last had open is remembered
  in `localStorage`, so a bare `/chat` (the rail, a reload, a notification)
  comes back to it. The hash used to be the truth, and the app router wrote
  over it: it never learns about a `window.location.hash =` write, and on its
  next state change (any refresh) it put its own URL back with
  `history.replaceState`, the hash was gone, and Chat fell back to the street.
  `setOpenPlace()` writes the URL through `history.pushState`, which Next
  patches to keep its copy in step, so the address bar stays right and Back
  still leaves the room the way it came. A remembered place you have since
  left falls back to the first place.
- **`streamStore.js`** says whether the stream is up, and Chat draws the one
  line for when it is not, under the tab strip — the row that is on screen
  whichever pane is open and on a phone, which is where a stream drops most.
- **`PlacesColumn.js`** draws **Here** (the Location), **Rooms** (public, then
  the private ones a key or a guest row opens, marked `▪`), **Conversations**,
  **Summary**, and exports `PlacesTabs` — the same list as the phone's
  `.tab-bar`. Only one of the two is ever drawn.
- **The unread mark** is one comparison: the newest **notable** seq in a place
  against the newest seq this browser has seen there. An unread place reads at
  full strength against a column that is otherwise `--muted`, and keeps its
  dot — the same move `/gm/players` makes on its own rail.

  Notable means **somebody spoke**: the row is not yours, and its `source` is
  not `SYSTEM`. That is the whole predicate,
  `feedStore.js#isNotableRow`.

  `SYSTEM` is what keeps this honest. Any-row-is-unread meant a place lit up
  for scenery — somebody lifting a stamp off a table — so the mark stopped
  meaning anything, which is the whole failure of an unread mark. The scenery
  is exactly what `source: SYSTEM` names: the ambient lines, the turn banners,
  everything the game says rather than a person.

  It used to be far narrower — a row **in a conversation**, or one **carrying
  this character's `{char:…}` token**, and nothing else. Ordinary roleplay in a
  Room therefore moved no mark at all, and a **GM got none whatever**:
  `notableWatermarks` returned an empty map for a viewer with no character, on
  the reasoning that they are watching rather than being spoken to. In
  practice the one person reading every channel had nothing to read them by,
  and was opening a hundred places in turn to find where a scene was. Speech
  subsumes both old arms — a conversation row is a person speaking, and so is
  a mention — so widening it deleted a query rather than adding one.

  The first half comes down with the place list (`notableSeq`, a string — the
  column is a bigint, computed by `web/lib/feedAccess.js#notableWatermarks`)
  **and** from whatever the tab has heard live; the LARGER of the two wins, so
  a mention that landed while the page was shut is not hidden by a quieter one
  since. `newestSeq` still rides along beside it, because that is what seeds a
  first-time browser's read marks.

  The second half is `hall:seen:<placeKey>` in `localStorage`, read through
  `useSyncExternalStore` in `seenStore.js` and written when the reader scrolls
  to the bottom, never merely on selection. It only ever moves forward, and it
  is the newest seq **overall** — so reading a place to the bottom clears its
  dot however the dot was lit.

  **Mark all read** is the tick in the column's foot, beside the chime and
  notify icons: `seenStore.js#markAllSeen` over every place's own `newest`,
  forward-only per place and one repaint for the lot.

  The **chime** is deliberately narrower than the mark and did **not** widen
  with it: `Chat.js` rings on the mention half only. A busy conversation ringing on every line is a reason to
  mute Chat rather than to look at it — a dot is patient, a sound is not.
- **A ping in a conversation adds them to it**, the way Discord does when you
  @ a stranger in a thread. `POST /api/feed/say` calls
  `db/lib/conversations.js#pullMentionedIntoConversation` after the row is
  written: it reads the `{char:…}` tokens, re-checks each against the DB
  (a token is player-typed text), and for anyone living and not already a
  member writes the `PlayerThreadMember` row plus the `PlayerThreadInvite`
  beside it. The route then does the Discord half — `addThreadMember` for
  somebody standing in the Location and not `webOnly`, and a DM either way.
  It can never fail the send: the words are the point.

  Conversations only. A room is opened by a key or a guest row and a mention
  is neither; the street is already open to everyone standing in it. And the
  web path only — a mention typed into Discord is Discord's own to handle.

- **`Feed.js`** (phase 0's `PlayFeed.js`, generalised) draws one place: its
  name, its own words under the name, a search button, the runs, and the
  composer.
- **The head says where you are, in the place's own words.** Under the name
  sits that place's `description` — `Room.description`, `Location.description`
  or `Zone.description`, whichever kind is open — as one clamped line of
  subtext you open with a click and close with another. `db/lib/feedAccess.js`
  already carries it on every row of the place list, so nothing is fetched for
  it; a place with none (a conversation) draws no line at all.

  A **room** is the reason it is there. `PlaceCard.js` in the right column
  draws the *Location's* description and the zone's, never the room's, and the
  hover card on the room's row in `PlacesColumn.js` is gone the moment you
  click through — so standing in a room, the words written for it were on no
  surface at all. The line is deliberately not the fixed-height strip with a
  "more" button that used to live here: that one sat *over* the scene, this
  one is a single line until asked.
  Enter appends the pending row in the same frame and clears the box; the POST
  swaps the real row in behind it. A failed send stays on screen as "Not sent.
  Retry". Runs group one speaker's messages within seven minutes, the same rule
  as `DmThread.js`. The list scrolls itself, never the document, and only while
  the reader is already at the bottom; otherwise a "New messages" pill. On a
  coarse pointer, Enter is a newline and a Send button appears, as in Discord's
  app. An edited row says "(edited)" after the time.
- **The row action bar** (`.chat-row-actions`) floats at a row's top-right the
  way Discord's does — absolute, over the corner, so appearing on hover never
  reflows the sentence under it. Shown on hover with a mouse and always on a
  touch screen, and never on a row that has not confirmed yet. What it holds
  depends on whose line it is:

  | Row | Buttons |
  |---|---|
  | Yours | ✎ **Change** · ✕ **Take back**. The five-minute window is checked when the button is pressed, not while the page sits open, and again by `deleteSpeech`. Take back goes through the shared `useConfirm()`. |
  | Somebody else's | 🔍 **Look at**, on every line including a hooded one; and 📷 **Photograph**, only while the sheet holds an `instant-camera`. |
  | Any row, viewer is a GM with no character | ✕ **Remove**, confirmed, through the same `/api/feed/delete` route with `{ gm: true }`. |
  | Any row that has a `seq` | ★ **Save to Notes** — the web twin of Discord's ⭐ (`PROXYING.md` §7), writing the same `Note` row through `starRow`. Offered on your own lines too, exactly as the reaction is, which is why the bar is now drawn on every row rather than only on one somebody can act against. |

  **The eye is offered on every line somebody else said, hooded ones
  included.** It used to be withheld from a row written under an alias, because
  opening a dialog on its character id would have been looking a hood up BY ID
  — the whole thing the token in `whosHere.js` exists to prevent. That was a
  fact about how the eye was wired, not a rule anybody wanted: speaking in
  front of somebody is exactly what lets them look at you.

  So the eye is pressed against a **seq** now, the way the camera beside it
  always was, and lands on `lookAtRow(seq)` → `db/lib/examineRow.js`. The
  server resolves the speaker, so the page can offer a look at a hood without
  ever being told who is under it, and the readout answers for the hood worn
  when the line was said rather than the one being worn now.

  **The camera works the same way**, and always did: it
  is pressed against a **seq**, the server resolves the speaker itself, and
  what it prints is the impoverished concealed readout — the hood the ROOM SAW
  at the time, not the one they are wearing now (`examineReadout`'s
  `wasConcealedAs`). `photographRow(seq)` in `web/app/(app)/chat/actions.js` is the web twin
  of the 📸 reaction and mirrors it exactly: blind refuses, no camera refuses,
  the viewer's own sight is stripped (`viewerTags: []`, an empty `satisfied`)
  so a surgeon's photograph carries no diagnosis, and `mintPhoto` files the
  print as an ephemeral Tag row. **One shot per line per photographer**,
  because nothing is spent and a second press would otherwise mint a second
  permanent catalog row: the bot keeps that bound in memory, which a restart
  empties and a web process cannot share, so this face keeps it as an
  `AuditLog` row — `photo_taken`, with the seq in `details`. No `turnId`: that
  column is for the per-turn rations, and this ration is per line.

  **GM remove** is the same route the player's Take back uses. It pays for the
  `isGm` REST check only when there is no living character to be, writes a
  `gm_feed_remove` audit row after the removal, and a GM who DOES have a living
  character takes the player path — the rule `loadFeedViewer` already applies.
- **The words themselves go through `ChatMarkdown.js`**, not
  `MarkdownContent.js`, which is still the DM renderer. It is `react-markdown`
  + `remark-gfm` + `remarkTokens` + **`remarkChat.js`**, which adds the three
  things a chat line does that a document never does: `||spoilers||` (a
  `.chat-spoiler` button, click to reveal, stays revealed) and **quoted
  speech** — a `"…"` span becomes `<span class="speech">`, tinted
  with the `--speech` token declared in every theme block and gated at AA by
  `npm run audit:contrast`. The tint is there because a Chat row is narration
  and dialogue mixed, and the words somebody actually said are what a reader
  scans for.

  **Both marks hold formatting now, and that took a rewrite.** `remark-parse`
  builds the whole inline tree before any plugin runs, so a paragraph arrives
  already cut into siblings wherever a `*star*`, a `` `tick` ``, a `~~tilde~~`
  or a `[link](…)` sits — and both passes were built on
  `mdast-util-find-and-replace`, which sees one text node at a time. So
  `he said "*get out*"` was never tinted and `||a *hidden* word||` was never
  hidden. Players write with emphasis constantly, so that was most quotes and
  most spoilers, for as long as the tint has existed. `chatRuns.js` is the fix:
  it scans a parent's **child list** rather than one string, an opener and a
  closer still have to sit in text nodes, and everything between them — an
  emphasis, a link, a resolved mention, a `<t:…>` — goes inside the wrapper
  whole. The old refusals all survive it: no newline or hard break inside, a
  400-character cap, a quote opens only on a real character, and an opener with
  no partner is left as a character rather than swallowing the rest of the line.
  `db/test/chatFormatting.test.js` is the guard.

  **A token is the opposite case, and gets the opposite fix.** A
  `{kind:payload}` payload is `[^}]+` — a name like `Bob *the Blade* Marley`, a
  price like ``{info:costs `5` ⬢}`` — and formatting does not belong *inside* a
  token, it just cuts the paragraph in half and leaves the reader a raw
  `{char:cmtt…`. So `tokenEscape.js` backslashes every Markdown-active
  character inside a `{…}` **before** anything parses, remark hands the payload
  back as one text node, and `remarkTokens` matches it whole. It runs on the raw
  string at render, so it repairs rows already in the database and nothing
  stored has to change. A token written between backticks keeps its bar bare —
  somebody demonstrating the syntax should not see a backslash in it.

  **The plugin order flipped, and that is deliberate** (`markdownPlugins.js`):
  `remarkSubtext → remarkTokens → remarkDiscord → remarkChat`. Chat's own marks
  go last because they can now wrap a resolved mention or a timestamp as one
  more sibling, and because a name like `Bob "Ace" Smith` would otherwise have
  had its own speech tinted in the middle of a mention.

  **The rule the two renderers split on is scene-or-prose, and only that.** A
  surface does not get to know a different *syntax* from its neighbours; what
  it gets to decide is which tokens it *resolves*, and that is the `components`
  map, not the plugin list. There are two lists now — `MESSAGE_PLUGINS` and
  `CHAT_PLUGINS`, differing by `remarkChat` alone. There used to be three, and
  the third (`BASE_PLUGINS`, the DM one) was missing `remarkTokens`, which is
  the same drift one layer down from the `<t:…>` bug below: a mention is stored
  as `{char:…}` on **both** faces, so a DM quoting one, the audit inspector and
  the archive peek all printed a cuid in braces at the reader. The vocabulary a
  message may resolve is `messageTokens.js` — `char`, `info`, `cmd` and nothing
  else, shared by both renderers, so a player still cannot mint a live
  `{tag:…}` chip mid-scene.

  Everything that draws a body somebody *wrote* now goes through one of the
  two: `/chat`, the `/notes` Starred tab and Journal, the `/archive` transcript,
  DM threads, the audit inspector, the archive peek. Three of those did not.
  `StarredList.js` drew a **bare string** — a starred line showed its reader
  `{char:cmtt1148600jgql0pyydw04pn}` and literal asterisks — and the transcript
  and the Journal went through `RichText`, which renders no Markdown at all
  *and* resolves the whole catalog, so a player could type `{tag:apex-form}`
  into a journal entry and get a live hoverable chip out of it. `RichText`
  remains the right renderer for authored prose (a tag description, a Desire,
  an appearance); it just no longer draws messages. `db/test/messageRenderers.test.js`
  is the guard — the plugin-list assertions moved there from
  `discordMarkup.test.js`, which had been checking the Discord passes on every
  list while one of them quietly shipped without the token pass.

  One consequence worth eyeballing: nothing wires `remark-breaks`, so a single
  `\n` folds. `StarredList` and `JournalList` used `whitespace-pre-wrap` and
  now do not — Markdown owns the layout, the way it already did on `/chat`.
  Adding `remark-breaks` to bring the old look back would silently change every
  feed row too, which is the divergence this removed.
- **`-#` subtext is `remarkSubtext.js`, and every renderer runs it.** It used
  to sit inside `remarkChat`, which meant only `/chat` understood it — so the
  lobby seat DM reached players with a literal `-#` on its last line, beside a
  literal `<t:…>`. It is Discord's syntax rather than a style we chose, so it
  belongs wherever Discord-written text is read. It is block-level and must run
  on RAW text, before any inline pass has cut the paragraph into children,
  which is why it is first in every list.
- **What the three renderers now share is `remarkDiscord.js`.** Chat, DMs and
  documents all run it, and the plugin lists live in one file
  (`markdownPlugins.js`) so they cannot drift again — which they had, and the
  cost was two lobby DMs showing players a literal `<t:1757700120:F>` where a
  time belonged. It renders Discord's angle-bracket vocabulary: the seven
  `<t:…>` timestamp styles, `<@…>` / `<@&…>` / `<#…>`, `<:name:id>` custom
  emoji and `@here`. The vocabulary itself is defined once in
  `db/lib/discordMarkup.js` — a zero-requires leaf, the `dmKinds.js` rule — and
  `db/test/discordMarkup.test.js` scans the source with the same patterns, so a
  syntax the renderer has not been taught fails the run rather than reaching a
  player. **No id is ever printed**: a mention resolves to a neutral `someone`,
  a channel to `somewhere`, an emoji to its `:name:`.
- Plugin order is load-bearing: `remarkChat` runs **before** the token passes,
  or a mention in the middle of a quote splits the text node and the quote
  stops matching itself. `remarkDiscord` splits text nodes the same way, so it
  sits after `remarkChat` for the same reason.
- **DMs still get no `remarkChat`.** No speech tint, no spoilers — a DM is a GM
  and a player talking, not a scene. Discord's raw syntax is a different thing:
  it is not styling we chose, it is characters that leaked in, and it belongs
  everywhere the text is read.
- **Mentions are `{char:<id>|<Name>}` in the row, on both faces.** The name
  half is the name the room heard, frozen at send time — a mention used to
  resolve live, so a disguise or a Mulligan rename rewrote what every past line
  had said. PROXYING.md §6 has the whole argument. The composer's `@`
  autocomplete (`MentionMenu.js`) runs over `whosHere().named` — the people
  standing here, concealed ones deliberately absent — and inserts the token;
  `CharacterMentionsProvider` is mounted on the page with the same roster, so
  the chip renders back. What crosses to Discord is `<@&roleId>`, rewritten by
  the outbox; what comes back from Discord is rewritten to the token in
  `prepareSpeech`. See PROXYING.md §6 and `db/lib/characterMentions.js`.
  Being named rings the shared `chime.js`, muted per browser by
  `hall-chime-muted` (`useChatChimeMuted.js`) with the toggle at the foot of
  the places column.
- **Slash commands in the composer** (`commands.js`, `CommandMenu.js`). Typing
  `/` at the START of the box opens a popover — the sibling of `MentionMenu`,
  same ↑↓ / Enter / Tab / Escape wiring — listing the commands the OPEN PLACE
  allows. Picking one, or typing its whole name and a space, puts the composer
  in **command mode**: an accent-tinted `.chat-cmd-chip` sits above the
  textarea, the textarea holds the command's one free-text argument with that
  argument's placeholder, and any other argument it wants is a `.chip-row`
  under the box — everyone standing here for a `person`, the three Move kinds
  for a `moveKind`, the reachable places for a `destination`. Enter runs it
  through `useActionRunner`; Escape, or Backspace on an empty box, drops the
  chip and hands the text back. **An unknown `/word` stays plain speech** — the
  chip is the tell that it parsed.

  | Command | What it runs | Extracted for it |
  |---|---|---|
  | `/move` | `submitMove` | — |
  | `/travel` | selects that node in `TravelNodes` and opens its confirm strip. It never moves anybody: Go still does | — |
  | `/conceal` | `toggleConceal()` | `db/lib/conceal.js` |
  | `/shout` | `shoutHere(text, placeKey)` | `db/lib/shout.js#shout` |
  | `/roll` | `rollHere(placeKey)` | `db/lib/roll.js#castDie` |
  | `/look` | `lookAt(ref)` — a character id or a hood token, told apart server-side | — |
  | `/converse` | opens the same `ConverseDialog` the right column's Converse opens | — |
  | `/add`, `/remove` | `addMember` / `removeMember` (below) | `db/lib/roomGuests.js` |

  **`where` is a filter, not a greying.** `/roll` is absent in the street and
  `/add` is absent in the zone summary, because a list of things you can type
  is not a menu of things you are being refused. `/roll` is absent in the zone
  summary too, for the reason `/shout` is: a summary is a broadcast, not a
  place anybody stands in.

  **The street gets NO composer at all.** A Location is `canSpeak: false`
  (§5b). It carried a command-only box for two days — drawn only so `/shout`,
  the one command whose point is being heard outdoors, had somewhere on the web
  to be typed — and then shouting from the street stopped being a thing you can
  do either (`/shout` is `["room", "conv"]` now, and `shoutHere` refuses a
  `loc` place key server-side). With nothing left to run in it, the box went:
  what stands there is one grey italic line, *"Go into a room, the zone summary
  channel, or a conversation to speak."*, and the quill and the hood beside it,
  which are things you do with your own hands anywhere.

  Three of these are the first web twins of commands that were **Discord-only**
  — `/conceal`, `/shout` and `/roll` — which is to say a "web only" character
  simply could not do them before. The bot has been switched over too, so
  there is one implementation of each and one cooldown: `/shout`'s is the
  newest `AuditLog` row with `actionType: "shout"` for the character, read by
  both faces, because there is no timestamp column on `Character` to share.

  **A shout writes to both faces itself.** `db/lib/shout.js#shout` answers who
  hears it and what they hear; the action then writes one `sceneLine` row per
  hearing Location **and** posts the same line to that Location's channel,
  sequentially. Both halves are needed, because the outbox carries `WEB` rows
  only and a `SYSTEM` row is deliberately never echoed into a channel (§2). The
  room or conversation you are standing IN hears the distance-0 line too — the
  street loop is Location channels only, and without that the one door you are
  inside of would be the only place that did not hear you. `db/lib/roll.js`
  does the same two-sided write for one die.
- **The members strip** (`MembersStrip.js`) sits under the feed's name for a
  `conv:` place and for a PRIVATE `room:` place, and nowhere else — a public
  room needs no guest list, and `placeMembers()` says so with a null `members`
  rather than a refusal. It is a 20px avatar chip per member with a `×`, and a
  plain, always-visible `+ Add` opening a picker of everyone standing here
  who is not already in. `HereList`'s person menu gains **Add to `<name>`**
  for the same two kinds of place.

  Until now the only way to let somebody into either was `/add` on Discord,
  which a web-only player cannot type. The rules are unchanged and all on the
  server: a conversation asks that you are a **living** member; a private room
  asks that you are INSIDE it and that they are standing at its Location, and
  refuses to show out somebody whose own key admits them ("take the key").

  **Inside, not merely outside the door.** Being inside is a key (one of
  `Room.accessTagSlugs`) or a `RoomGuest` row — `roomAccessKeys` in
  `db/lib/roomAccess.js`, the same pair `accessibleRooms` tests. On Discord
  that half of the gate was implicit, because `/add` is typed into the room's
  own thread and a thread is invisible to anybody not entitled to it; lifting
  the code out of the bot dropped it, and for a moment anybody in the street
  could hand out a door they could not open. Both `db/lib/roomGuests.js#doorwayFor`
  and `web/app/(app)/chat/actions.js#privateRoomHere` now test it, which also stops
  `placeMembers()` handing a guest list to somebody outside.

  A **key-holder is not offered in the picker**: they are already in by their
  key, `roomGuests()` deliberately does not list them, and a guest row written
  for one grants nothing and cannot be taken back.

  **That filter skips hoods**, who stay in the picker even holding a key. A
  hood you can see standing there, absent from both the strip and the picker,
  is a hood with a key to this room — which is the fact a hideout's masks
  exist to keep, and the metagaming rule already forbids a control leaking one
  about the person it names. The cost is a guest row granting what they had.

  A hood's chip wears whichever face the HERE column gave them — the mask if
  you have watched them speak in it, the question-mark plate if not
  (`PROXYING.md` §5a). Not always the plate: the picker sits directly under
  that column, and one hood drawn two ways in one viewport reads as two.

  The row is written first and Discord's thread membership follows,
  `PlayerThreadInvite` included — §2a's rule, not a second one. Every write
  calls `notifyPresence`, so the added person's own places column updates
  without a reload. The strip re-reads on three things: the stream's `places`
  frame (the viewer's own presence), any message in the open `conv:`/`room:`
  place (which is the cheapest honest sign that a third party was let in or
  shown out — no frame is sent for somebody ELSE's add), and a 60-second
  interval while it is mounted, for a key granted while the room stays quiet.
- **A `SYSTEM` row renders as `.chat-subtext`**: muted, small, no face. That is
  the web half of the `-#` those lines go out as on Discord
  (`db/lib/ambientLine.js`). Phase 4 is what actually writes them.
- **The composer is hidden where `canSpeak` is false** — every place for a GM
  (§5a). In its place, one line saying so. The **Location is the exception**:
  it is `canSpeak: false` and still draws the box, command-only, so `/shout`
  has somewhere to be typed. See the slash-commands bullet above.
- **`ChatAside.js`** is the right column — and, under 900px, everything
  inside the 👥 drawer. One component either way, because the phone's version
  is the same sections in the same order; only the box around them changes,
  and the drawer is a `Modal` wearing `.chat-drawer` rather than a drawer of
  its own, so it keeps Escape, the focus trap and the backdrop `Modal`
  already owns.

  **The sections are TABS, not a stack** (2026-09-09) — Place · Room · Travel ·
  You. Three of them are unbounded (the place card is as long as its prose, the
  travel grid is 6rem per exit, YOU is four sub-blocks plus a waiting list), so
  stacked down one scroller the tallest of them decided how far you travelled
  to reach anything under it; and two of them render nothing at all when they
  have nothing to say, which moved the column's height on every walk. One panel
  open at a time fixes both. **ROOM** appears only when a room is open. Which
  tab you left open is remembered per browser in `localStorage` through
  `asideTabStore.js` — `useSyncExternalStore`, never an effect — and a stored
  tab this place does not have falls back to Place. The `dialogs` node hangs
  OUTSIDE the panel on purpose: a dialog opened from one tab must not unmount
  because the reader pressed another.

  **HERE IS NOT A TAB** (2026-09-09, later the same day). It was one for an
  afternoon, and a playtester said what was wrong with that: *"Bit tedious I
  think having to click to see who's in the same room. Could be merged with
  'place' maybe?"* They were right. Who you are standing with is the question
  the page exists to answer, so you want it answered the whole time rather than
  on request — and HERE has none of the problem the tabs solve, being as tall
  as the room is full rather than as long as somebody's prose. So the people
  are drawn at the top of **PLACE**, which is the tab the column opens on, and
  the four tabs left are the things you go and look at. The party rack sits
  BELOW the place card rather than with the people, even though it belongs with
  them: it fetches its party on mount and draws nothing until that lands, so
  above the card it shoved the Location's prose down a card-height on every
  visit to the default tab. Anything that appears late goes under the things
  that do not.

  The cost of this is named rather than hidden: HERE is unbounded too, one row
  per occupant, so a launch-day Town can push the place card below the fold of
  the default tab. A `max-height` with a scroller is the obvious answer and is
  the wrong one today — the person menu is a plain absolutely-positioned
  `.chat-menu` inside the list, and an overflow would trap it in a scrollbox.
  `.chat-menu-portal` exists for exactly that (it is how `placePanel()` escapes
  its own container); the menu moves onto it first, then the cap.

  **Neither the list nor the party rack is gated on the drawer any more**, and
  both used to be. The HERE tab was `!inSheet` on the stated grounds that the
  phone's avatar strip (since removed) made a second poller — which was never
  true: that strip was rendered with no `poll` prop and never polled anything.
  What that gate did cost was real. The sheet was mounted from 900px down
  (`useAsideFolded.js`) and the strip only appeared from 720px down, so
  between the two **who is standing here was drawn nowhere at all** — and
  under 720 the sheet was titled "Here" and had no people in it. The party
  rack was worse off again: living inside a desktop-only tab, it was
  unreachable on a phone entirely.

  What that costs is one poll. A desktop reader sitting on Place pays two slow
  re-reads a minute where the tabbed version paid none until you pressed HERE —
  which is not new load, it is the load the stacked column always had, and
  `useVisiblePoll` stands both of them down whenever the BROWSER tab is in the
  background (it reads `document.visibilityState`, not which aside tab is
  open — that standing-down comes from the closed panels being unmounted). On a
  phone both mount only while the 👥 drawer is open.

  The list is keyed on `hereKey` (exported from `ChatAside.js`): `HereList`
  seeds the server's rows into `useState`, so a move — which hands down a new
  list — has to remount it rather than leave the old street's people in place.

  Each section is a **card** — `--surface`, a border and `--r-md`, the same
  treatment `.panel` gets everywhere else. They were a hairline `border-bottom`
  and nothing else, which gave a Location's long prose and a one-chip status
  strip identical weight.

  It owns the affordance list the sections share through `usePlaceActions`.
  The numbers below are the sections, not the tabs — 1 and 2 both sit in the
  **Place** panel, and the people are drawn ABOVE the place card rather than
  under it:
  1. **`PlaceCard.js`** — the Location's name, its zone muted under it, a
     `Place` / `Zone` chip pair and the chosen text, always on the page inside
     a scrolling `max-height`. **Place** is `Location.description` plus the
     `examineLines` (`db/lib/examineLocation.js`) the page renders server-side;
     **Zone** is `Zone.description`, which nothing on the web drew before.
     Under the text, the Location's own fixtures — the noticeboard, a gate a
     watchtower opens to this character, a keyed door they hold the key to —
     and **Converse**, which is otherwise only reachable from a person's row
     in HERE and so left somebody standing alone with no way to open one.
     The old **Examine** dialog is gone: this is what it said.
  2. **`HereList.js`** (`web/app/components/`, since `CharacterSheet.js` draws
     it too) — drawn at the TOP of the Place panel, on every width. Everyone
     standing here, hooded or not, off
     `db/lib/whosHere.js#whosHere` called with `{ withSightings: true }`. A row
     is a 24px avatar, the presented name (their Role for a fellow member of a
     real faction, `you` on your own) and, **once you have heard them speak**,
     an eye at the row's right edge that opens **Look at** in one click. The
     name opens a `.chat-menu` of the SHEET's own people dialogs — Heal,
     Transfer, Loot, Bind, Free, Harm, **Converse** — by mounting
     `RequestActionsProvider` on the page with the people pools and calling
     `open(mode, null, { targetId })`. Nothing is forked: same dialogs, same
     server actions — and Bind, Free and a one-affliction Heal opened this
     way skip the dialog for their one question (`actions/index.js#FAST_PATHS`).
     A hood gets the same row; its menu is Converse alone.

     **The face and the eye are earned** (`PROXYING.md` §5a). A row you have
     not heard speak this turn shows no eye at all, and a hooded one shows the
     question-mark plate rather than the mask — a column that drew every mask
     to anybody who walked in announced a cult meeting to the first person
     through the door. What a row does show is FROZEN at the last line you
     heard, so somebody who chatted bare-faced and then masked up in private
     stays listed under their own name and face until the turn rolls.

     The eye points at that line — `sightingSeq` — not at the person, so
     looking at a hood needs no token: `lookAtRow(seq)` resolves the speaker
     server-side (`db/lib/examineRow.js`) and the browser is never handed a
     name. `hoodToken` still exists for the party rack and `/look`, but a look
     is no longer keyed on it. The metagaming rule (`actionRegistry.js`) still
     holds: no row is greyed for a fact about the person it names.
  3. **`RoomPanel.js`** — drawn only when the OPEN place is a Room, and it is
     the fix for the Intercom-in-every-Keep-room complaint. `affordancesFor`
     answers what this character can do where they stand, which at a Location
     with six rooms is six rooms' buttons at once; the panel groups by
     `roomId` and shows the open one. Its storage line comes from
     `readStash`, and every stack in it is a button: clicking one opens the
     sheet's Transfer dialog with the room as the source and that stack
     already ticked. Under it, **Drop** / **Take** / **Transfer** — the same
     dialog seeded three ways (self→room, room→self, and nothing assumed).
     Then that room's own fixtures — Intercom in the Council Room, the Bell in
     the tower, the red Turret in the Censor's office.
  4. **`TravelNodes.js`** — the ways out as a grid of square nodes, two to a
     row, off `loadTravel`. Each node carries the destination, its zone in
     small caps, the Location's own description in italics (clamped to the
     square, with the whole of it on the node's title) and one foot line:
     `free` for a local hop or a crossing with a free move left, `the turn` for a crossing that spends the Move and lands
     next turn (MAP.md §3), and `shut` / `locked` / the refusal for one that
     will not open — dimmed, still drawn, because knowing the way is there and
     shut is what sends you to find the winch. A zone crossing is tinted. The
     header is `Travel · N free` with `freeReason` as its title. Clicking a
     node opens an inline confirm strip under the grid — the sentence, the count
     of who comes with you, `Go` and `Cancel` — not a modal. A click only ever
     picks: `Go` is the one thing that moves anybody, here and on the map
     alike (MAP.md §6c). While somebody has hold
     of you the grid still draws, every way shut with its reason on it, under
     one banner saying so (INTERCEPT.md). It used to be replaced outright while
     a journey was pending; travel lands at once now (MAP.md §3).
  5. **`YouPanel.js`** — below.
- **`PlacePanel.js`** is no longer a panel. It is `usePlaceActions()` plus the
  dialogs the sections open: Noticeboard, Converse, Bell, Turret, Intercom.
  The hook owns the affordance list and the refresh rule — anything that
  changes a label a button wears re-reads the whole list rather than patching
  a row, which is what keeps this column and the Discord anchor saying the
  same thing. The web filters the ids `travel`, `whosHere`, `secretRooms` and
  `examine` out of that list; they stay in
  `db/lib/placeAffordances.js` for the anchor, which has no column beside it.
- **`YouPanel.js`** draws **YOU**, in the order a player asks it — and every
  section of it is about the character rather than the street they are
  standing in:
  1. **`TurnCard.js`** — `DAY 4 · DUSK`, a `closes in 5 h` countdown
     computed in the browser off an ISO end time on a 60-second tick (absent
     entirely when `moveWindow` reports no lock: a frozen clock or a short
     manual turn has no honest end to count to), and then either the **Move…**
     button or the Move already filed — its kind joining the chip row, and its
     text behind a `»`, clamped to three lines until clicked. There is no Edit:
     a filed Move is final (TURN-ENGINE.md §6a-i).
  2. **`StatusStrip.js`** — one wrapping row of data chips: `{n} ⬢`, the carry
     line against the cap, and every held tag whose `Tag.category` is
     **Status** or **Health**. The category test is the sheet's own
     (`web/lib/sheetCards.js`), so a new affliction appears here the day it is added to
     `docs/tags.yaml`. Overburdened, Dying and Catatonic — and a carry line
     over its cap — wear the danger tone.
  3. **`ThingsDrawer.js`** — **Things**, the pockets drawer, collapsed by
     default and remembered in `localStorage`. Every tag
     whose category is **Items** or **Assets**, grouped in that order, as one
     chip each (`Paper ×23`, a `·` after anything equipped). A chip opens a
     menu of at most four: **Equip / Unequip** (`equippable`, the sheet's own
     instant `equipOne`/`unequipOne`), **Use** (`consumable`), **Give** (`tradeable`)
     and **Destroy** (`removable`) — the last three open the SHEET's dialogs
     through `RequestActionsProvider.open(mode, tagId)`, with the item already
     picked. The flags come off the catalog through `web/lib/tagRequests.js`,
     built once in `play/thingRows.js` so the first paint and the `myThings()`
     re-read after every verb cannot disagree. It polls on its own minute, and
     only while it is open.
  4. **`DesiresBlock.js`** — the sheet's slot view, in the column: per slot
     either **Claim** or `Opens on turn N`, the last claim as a muted
     line, and the Addiction note on the bottom slot. The claim is the real
     one (`claimDesire`), over `DesireCatalog` and `RequestDialog`, exactly as
     `DesirePanel.js` does it. What is different is *when* the catalog
     arrives: the page carries the slots only, and the ~271 evaluated
     templates are fetched by `desireCatalogView()` the first time somebody
     opens the picker.
  5. **`Sheet ›`** — the link to `/character`. The sheet carries the way
     back: a Back link in its header, and Escape (`SHEET.md` §1). Its band
     reuses this column's turn card and status strip, so the two never
     disagree about your Move.
  6. **`WaitingList`** — the pending offers, threat spawns, unanswered bird
     letters and a lobby assignment. Accept and Decline call the **same**
     `db/lib` functions the DM buttons call (`lessons.js`, `bind.js`,
     `confession.js`, `threatSpawn.js`, `lobby.js`), so an answer given here
     and one given in Discord are one answer, and the second surface finds
     nothing left to answer.
  7. ~~**`Yesterday.js`**~~ — gone. What the last close said is in the
     Bascinet conversation at the top of the places column (§2b), with every
     other day.

  The card and the waiting list share **one** 60-second interval (`myMove()`
  and `waitingOnYou()` on the same tick), so a Move filed from the `#turns`
  console shows up here without a reload.
- **The composer's two hand controls**, beside the send (behind one ⊕ on a
  phone).
  A ✉ (`QuillIcon`) opens a small menu of **Write**, **Seal** and **Send
  by bird** — each shown only where the sheet would show it, each opening
  the sheet's own dialog through
  `RequestActionsProvider.open("write"|"seal"|"bird")`. Bind a Book used to sit
  in that menu; a blank book is an ordinary craft recipe now and Write is what
  fills one (`PAPERWORK.md` §4a). The bird is
  the one that greys rather than hides: with one already gone today it reads
  **Sent today**. Beside it, a hood (`HoodIcon`, `aria-pressed`) calls
  `toggleConceal()` — drawn only where `db/lib/conceal.js` would not refuse
  outright, and while it is up the composer's placeholder and label read
  *Say something as {alias}…*, which is the name every row it writes will
  wear. A toggle ends in `router.refresh()`, because that name is a server
  prop.
- **The place card's two doors** (`PlaceCard.js`). A **Depot ›** link when
  this character is standing at the Depot AND holds the merchant licence or
  the keycard — offered only where it would open, since `/depot` bounces
  anybody without one — and a **Factory** button on godflesh ground, opening
  the sheet's Extract dialog. Both decided server-side in `play/page.js`; the
  page and the action re-check their own gate.
- **`web/lib/selfPools.js#loadLettersView`** builds the paperwork half of a
  character's own state — the four gates plus the paper, letter, seal, book,
  bird-target and bird-zone lists — named as the props
  `RequestActionsProvider` takes, so the sheet and Chat hand the dialogs
  one list. The raw text of a paper never comes back from it: only an excerpt,
  and only for a reader. Both surfaces strip `paperText` off the tags they
  hand to a client component for the same reason.
- **`web/lib/selfPools.js#loadDesireView`** is to a character's own state what
  `peoplePools.js` is to the people near them: one build of the Desire slots
  and, on request, the evaluated catalog. The sheet asks for both; Chat
  asks for the slots and fetches the catalog when the picker opens. Every gate
  is evaluated server-side — the client never runs the gate logic and never
  receives a hidden template.
- **`web/lib/peoplePools.js#loadPeoplePools`** is the one build of every
  people pool — the roster standing here, the medical gate, the Loot / Move /
  Bind / Harm lists. It came out of `character/page.js`, which calls it too:
  a second copy of "who is helpless" would have been a second answer.
- **The right column refreshes on a MOVE, not on a timer.** Everything in it
  — the place card, the Examine lines, who is here, the rooms a Transfer can
  reach — is a server prop off `page.js`, so `TravelNodes`' Go and the
  stream's own `places` event both refresh through `useRefresh()` — the
  shared transition, never a bare `router.refresh()`, which drops the route
  to its loading skeleton for the length of the refetch. The event refreshes
  only when the server says the viewer's own presence changed (§3), and the
  feed store is client state, so a refresh costs nothing that was on screen.
- **One aside is ever mounted.** The right column and the phone's 👥 drawer
  are the same `ChatAside`, and CSS hiding the column under 900px still left
  both live — two travel loads, two stash reads, two affordance states.
  `useAsideFolded()` picks one; the CSS rule stays as belt and braces. The
  places column and the ≡ drawer are the same arrangement one step down, on
  `useNarrow()`.
- **Nothing ever flashes "Nothing has been said here yet."**, and getting
  there took three separate fixes, because the empty state had three ways to
  win a race:
  1. `Chat.js` seeded the store from an **effect**, so the first client render
     drew an empty feed and the server's own rows landed a frame later. It is
     a `useState` initializer now — client-guarded and in a try/catch, with
     the effect left behind as the idempotent guard for a client-side
     navigation back onto the page.
  2. Opening another place fetched its history AFTER the empty state had
     already drawn. So `feedStore.js` tracks a history state per place —
     `"idle" | "loading" | "loaded"`, read through `useHistoryState(place)` —
     and `Feed.js` draws the empty state only when it is `loaded` and empty.
     While it is anything else it draws `.chat-skeleton`: three faded rows,
     tokens only, no text, `aria-hidden`, so a screen reader is not read a
     placeholder.
  3. The store is a module-level CLIENT store, so its server snapshot is empty
     by construction and the SERVER paint of a busy street was the skeleton.
     `Feed` takes the server's own rows as `fallbackRows` and uses them while
     the store holds nothing for that place — which, after hydration, is
     never.

  And then the switch itself: after the first paint, `Chat.js` walks the rest
  of the place list and fetches each one's history, **one at a time** on
  `setTimeout(0)` chaining, skipping what is already loaded and stopping on
  unmount. Opening a room is then instant rather than a skeleton and a round
  trip. One at a time on purpose — six parallel requests would compete with
  the thing the reader is actually looking at.
- **A server string a player reads is rendered by `ChatMarkdown`, never
  `{text}`.** The same sentences go out to Discord, so they carry its markers:
  `**Ways out**` from `examineLines`, a `-#` from anything that came through
  `ambientLine`. The column used to print them raw, asterisks and all, and the
  place card went the other way and *stripped* the `**` — throwing the
  emphasis away rather than rendering it. Everything prose now goes through
  the renderer: the place card's body, a notice's text when the reader could
  actually read it, and every action `line` / `note` shown in
  `.chat-quiet-line`. A bare label — a name, a chip — stays text.

  The one thing that did not become markdown is the room stash.
  `readStash` answers with **rows** now (`{ resources, items: [{ tagId, name,
  quantity }] }`) rather than with `formatStashLine`'s Discord sentence, and
  `RoomPanel` draws a `.chip-mono` `12 ⬢` and one `.chip` per stack —
  `Paper ×23`, the `×` only where there is more than one — collapsing past
  twelve behind `+9 more`. `formatStashLine` stays exactly as it is for the
  bot, which is talking into a channel that renders those markers.
- **The noticeboard is in the street, not behind a button.** When the open
  place is the Location and it has a board
  (`db/lib/noticeboard.js#hasNoticeboard`, an attribute on the Location), the
  pinned notices draw as `.chat-notice-card`s **pinned at the top of the feed
  scroller** — the paper is standing there, and filing it into the scroll in
  the order it went up would bury it under fifty lines of scene. Each card is
  the notice's name, **Read** and **Tear**; Read opens the same block the
  Noticeboard dialog draws (`NoticeCards.js#NoticeText`), so a paper read from
  the street and one read from the dialog are one rendering. The dialog keeps
  its own job — pinning one of YOUR papers, which needs a picker — and a pin
  or a tear from either side bumps one counter in `Chat.js` that makes the
  other re-read.

  `db/lib/noticeboard.js#boardFor(prisma, locationId)` is the loader that made
  this possible: Location-keyed, knowing nothing about who is asking. The
  ACTOR gate — you have to be standing here — stays with the caller, which is
  the one line `web/app/(app)/chat/actions.js#boardHere` is now.
- **Search the scene** (`/api/feed/search?q=&place=`). An `ILIKE '%q%'` over
  `ArchiveEntry.content`, which is exactly the shape
  `ArchiveEntry_content_trgm_idx` covers — the GIN trigram index that lives
  only in raw migration SQL, and the reason `prisma migrate diff` keeps
  proposing to drop it. Raw SQL rather than a Prisma `contains`, parameterised
  and never concatenated, the same shape the GM desk's conversation search
  uses.

  **The gate is the place list.** It searches inside `placesFor` and nowhere
  else, so a zone summary a character cannot hear is not searchable from the
  Chat and a GM's search is bounded by their `GmZoneView` exactly as their
  feed is. A named `?place=` has to be one of theirs, or it is a 403 rather
  than a silent widening. `q` is trimmed and 2..80 characters; the floor is
  the same Dawn watermark every other feed reader uses.

  The UI is a magnifier in the feed header opening `.chat-search` under it —
  a bar rather than a dialog, because the results are places to go in the
  scene behind them. A hit is a name, a place, a time and a snippet; clicking
  one loads the window around its seq (`/api/feed/history?around=<seq>`, 50
  rows either side inclusive), opens that place, scrolls to the row by
  `data-seq` and flashes it once with `.chat-row[data-hit]`. The window is
  loaded FIRST, because the store holds the newest hundred and a hit from
  three days ago is not in it.
- **⌘K reaches Chat.** `paletteActions.js#getPaletteIndex` gains two kinds
  for a signed-in user with a living character: `place` entries for everywhere
  `placesFor` says they can hear, and `person` entries for everyone
  `whosHere().named` puts beside them — a hood deliberately absent, exactly as
  it is from the composer's `@` list. Both are the same functions Chat
  itself uses, so the palette can never offer a place they may not read.

  The href is `/chat#<encoded placeKey>`, because a hash is what
  `openPlace.js` reads on the way in, so a link into a place needs no client
  plumbing at all. One catch the palette had to learn: `router.push` uses
  `history.pushState`, which does **not** fire a `hashchange` — so from Chat
  itself, a jump to another place sets `window.location.hash` directly, and
  the store's `hashchange` listener takes it from there. The GM branches are
  untouched, and the empty-query default still shows pages only.
- **`feedStore.js`** is a module-level store read through
  `useSyncExternalStore`, modelled on the GM inbox's `liveInbox.js`. Confirmed
  rows are keyed by seq, pending rows by a client id, both per place. A
  confirmed row carrying the same client id evicts its pending twin,
  **whichever of the stream or the POST answer arrives first** (the stream
  usually wins). It also holds the place list and which places have had their
  history fetched.

### 5a. Who may read and speak where

`db/lib/feedAccess.js#placesFor(prisma, character, { gm, discordUserId })` is
the **one** answer, and `mayReadPlace` / `mayWritePlace` derive from it rather
than the other way round — a rule that only exists in the list could never
disagree with the rule that guards a send. The web routes and `db/lib/say.js`
both call these; no route re-implements them.

Each entry is:

```
{ placeKey, kind: "loc" | "room" | "conv" | "zone" | "net", name, description,
  roomKind, canSpeak, slowmodeSeconds, newestSeq }
```

in the order the column draws them: the Location, its public Rooms, the private
Rooms `accessibleRooms` opens (keys **and** guest rows, the same door every
other reader of that function sees), the conversations `conversationsFor` says
you are in **at this Location**, then the zone Summary, then the **radio nets**
(§5d), which the column lifts up under Summary. `newestSeq` is added by
`web/lib/feedAccess.js`, not by the rules — the dot is a page concern.

Two things are read-only:

- **A Location is scenery, not speech** (§5b). `canSpeak: false`. The box is
  still drawn there, but only as a command line — nothing typed into it is
  ever said aloud (see the slash-commands bullet under "The parts").
- **A GM speaks nowhere.** A GM with no living character gets a read-only Chat
  over every place inside `visibleZoneIds(prisma, discordUserId)`
  (`db/lib/gmZoneView.js`; no rows means every zone). Watching is not standing
  there — a GM who wants to say something says it as a GM.

Slowmode is 300 s per character in a zone summary and nothing anywhere else,
enforced in `prepareSpeech` by the character's newest row there. Discord's
channel slowmode is the same: five minutes on `#summary`, none on a Room
thread, which `db:sync-zones` asserts as `rate_limit_per_user: 0` on every pass
(§5b).

### 5d. The radio nets are places

`#cerberon` and `#27.065` (`CHANNELS.md` §7) are the fifth place kind,
**`net:<slug>`** — and the slug, not a row id, because a special channel has no
row. They were Discord-only until 2026-09-10, which meant a **web-only**
character could hold a radio and never hear a word: no error, and nowhere on
the page to look.

The kind carries its own weight and almost nothing else changed:

- `db/lib/placeKey.js` resolves the channel id both ways —
  `resolveChannelKey` for a line typed on Discord, `discordTargetForPlaceKey`
  for one typed here, which is the whole of the web→Discord relay because
  `feedOutbox` already posts any `source: "WEB"` row whose key resolves.
- **The access rule is not copied.** `feedAccess.js#netPlacesFor` asks
  `computeNarrowcastAccess`, the same function that writes the Discord
  overwrites, so a Cerberon bracelet is `canSpeak: false` here for the same
  reason it holds no Send bit there. One rule, two faces.
- A net belongs to no zone and no Location, so it is built from the character
  alone and survives having nowhere to stand.
- The stream, the typing store and ⌘K are keyed on placeKey strings and needed
  no edit at all. `isSummaryPlace` is `startsWith("zone:")`, so a net takes the
  **turn** floor — right, because `wipe: "clear"` empties the channel every
  turn.

It is **not** a scene: `isScenePlaceKey` excludes it, so `/shout`, `/play` and
`/roll` are not offered. You cannot shout across a frequency.

A GM reads both nets and speaks on neither, flat and last in `gmPlacesFor` —
`GmZoneView` has nothing to say about a channel that is in no zone, and
withholding them would make the desk the one place a GM cannot read a
frequency.

### 5b. Decision 5: the Location channel is scenery

Bascinet, 2026-09-06 evening. A Location channel is the open street. What lands
there is arrivals, smells, the turret, the noticeboard, the turn line — and
talk belongs in a Room thread, a Conversation or the zone summary, all of which
are a scene somebody chose to be in. Four changes carry it:

- `LOCATION_MEMBER_ALLOW` in `db/lib/zoneChannelSpec.js` **drops Send**
  (view, send-in-threads and reactions stay). The doctor's `location-occupancy`
  check compares the **allow bits**, not just whether a target is present, so
  one `npm run db:doctor -- --apply` rewrites every existing occupant. That
  alone was not enough — an allow mask grants, it does not deny, and
  `@everyone` has Send Messages guild-wide — so `locationChannelSpec` denies
  `SendMessages` to `@everyone` outright. See `CHANNELS.md` §3.
- Room threads get `rate_limit_per_user: 30` at creation, re-asserted the way
  `archived: false` is (`db/lib/syncZones.js`).
- `bot/src/lib/channels.js#isDesignatedTupperChannel` no longer treats a
  **top-level** Location channel as a tupper channel. Threads and `#summary`
  still are. What is left at top level is a GM typing, and a GM's own words are
  theirs.
- On the web the Location place is `canSpeak: false` and draws **no composer**
  — see §3's note. It briefly kept a command-only box for `/shout`; a shout is
  not something you do from the street either, so both are gone.

### 5c. One affordance catalog, two faces

`db/lib/placeAffordances.js` is the list of every place-bound button, and it
is the reason the Discord anchor and Chat's place panel cannot drift. Each
entry carries an id, the **label a player reads**, a Discord custom-id prefix
and a **tone** — `go`, `plain`, `danger`. A tone says what the affordance
MEANS, never a colour: Discord maps it to a button style and the web maps it
to a `.btn` variant, so neither face can reach for a look the other cannot
express.

Two halves, and they cannot be one function. `locationAffordances(location)`
and `roomAffordances(room)` are what a **place** offers — that is all an
anchor can carry, because it is one message for everybody standing in the
street. `db/lib/locationAnchorRow.js` and `db/lib/roomStarterRow.js` are now
only Discord's shape around those two: rows, styles and the five-per-row cap.

`affordancesFor(prisma, character)` is what a **person** can do where they are
standing, and it is what `/chat` renders: the place's own, plus a Storage
button per Room this character can actually get into, plus a gate for every
modular way they can work from a watchtower they can reach, plus a keyed door
they hold the key to. On Discord those last two are answered by a refusal
instead, because an anchor cannot know who is reading it.

Adding an affordance is one entry in the catalog, one dialog in
Chat's right column and one server action. It is not two lists to keep in step.

## 5a. Notifications: the chime, and Web Push

Three things can tell a player something happened, and they are deliberately
different sizes.

**The chime** is for a tab that is already open. A row landing on the stream
with `{char:<your id>}` in it plays a short tone (`playChime`), per browser
rather than per character, muted with the bell at the foot of the places
column (`web/app/components/useChatChimeMuted.js`). Never for your own words,
and rate-limited by `chimedRecently()` so a busy room is not a bell tower.

**The DM** is unchanged and is still the record: every mention relay writes a
`DirectMessage` row, on both faces (`bot/src/lib/mentions.js` for a
Discord-origin mention, `bot/src/lib/feedOutbox.js#relayWebMentions` for a web
one). It carries where and a link and never the text, and since 2026-09-07 it
also shows in the player's Bascinet thread on `/chat` (§2b) — before that the
plumbing classification hid it there, which read as "pinging from the web does
nothing".

**Web Push** is for a tab that is closed, and it is the new half. A browser
that has agreed is one `PushSubscription` row — `discordUserId`, the endpoint
the push service minted, and the two keys. Per BROWSER, not per character: one
player may hold a laptop's row and a phone's, and a character dying does not
end them.

- **The toggle** sits beside the chime bell in the places column: `Notify me`
  / `Notifications on`, `aria-pressed`. Pressing it registers `/sw.js`, asks
  for permission, subscribes and posts the subscription; pressing it again
  unsubscribes. It draws only when the browser has a `PushManager` **and**
  `/api/push/key` answers — the state is a module store read through
  `useSyncExternalStore` (`web/app/(app)/chat/pushStore.js`), never an effect
  writing state.
- **The service worker does one job.** `web/public/sw.js` draws the
  notification and, on a click, focuses an open tab and navigates it to the
  url the payload carries. It caches nothing: `/chat` is a live feed, and a
  worker serving it out of a cache would be showing yesterday's scene.
- **What is sent.** Two things, and only two. A **mention** — after the DM, at
  both call sites, `"{name} was named"` / `"in {place}"`, pointing at
  `/chat` (the web-origin one at `/chat#<placeKey>`, which is the same hash the
  places column round-trips). And the **turn opening**
  (`db/lib/turnAnnouncement.js`), after the announcement is posted, to every
  Discord account holding an ALIVE character, one at a time with a small gap.
- **Nothing else may depend on it.** `db/lib/webPush.js` never throws. A 404 or
  410 from the push service deletes the row — a browser that is gone for good
  is the one thing an endpoint failure reliably means — and anything else is
  logged and left alone.
- **Unconfigured is the normal case.** Without `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, `pushToUser` returns
  `{ sent: 0, reason: "unconfigured" }` before it touches the database, the key
  route answers 404, and the toggle never draws. The chime and the DM are
  unaffected. The three go on **both** Railway services, since the bot sends
  the mention pushes and the web app serves the key.

## 5c. Snapshots: the page paints before the server answers

Every page used to be a skeleton until its server load finished, on every
visit. Bascinet's complaint (2026-09-07): "it's honestly very hard to see
anything because it always loads". So a page now keeps its **last data in the
browser** and paints it in the first frame; the server's answer replaces it
when it lands. `web/lib/snapshot/`:

- **`snapshotStore.js`** — a module store read through `useSyncExternalStore`,
  mirrored to `localStorage` under `bascinet:snap:<VERSION>:<discordUserId>:<scope>`.
  The account is in the key, so a shared browser never shows the next person
  the last person's sheet, and `SnapshotGuard` (mounted by the public layout,
  where a signed-out browser lands) clears every key when there is no account
  on the page. `VERSION` is bumped whenever a page's shape changes; an old
  snapshot is ignored, never handed to a renderer expecting the new shape.
  1.5 MB per scope, every read and write try/caught — a refused localStorage
  just means the page paints from the server, as before.
- **`SnapshotPage`** — the shell. `page.js` reads only the session, mounts
  `<SnapshotPage scope userId render={View} fallback={<Loading />}>`, and
  streams the old async body in behind it inside `<Suspense fallback={null}>`.
  A client component with nothing awaited mounts at once, so the stored data
  is on screen before the RSC payload has finished arriving.
- **`SnapshotFresh`** — the async body's last line: the fresh, serialisable
  props, round-tripped through JSON (a Date becomes the string the snapshot
  would have held, so the view is written against ONE shape) and written into
  the store. The shell re-renders the view off it.
- **One remount, at the moment stored gives way to fresh.** A client island
  that copies a prop into state on mount would keep the stale copy after the
  server answered. `SnapshotPage` keys the view `"stored"` while it is showing
  what it painted first and `"fresh"` from the first server answer on — exactly
  one flip per mount, so a `router.refresh()` after an action is a props
  update like it always was and an open dialog survives it. `Chat.js` opts
  out (`remountOnFresh={false}`): its seed effect re-seeds the store from the
  changed props, and the stream is *not* reopened — it was opened once, from
  the seq the mount painted with. A stale snapshot of `/chat` is still safe,
  for a better reason than the reopen ever was: the stored seq is the *lower*
  cursor and therefore the more inclusive one, and the per-place history
  prefetch covers whatever the capped catch-up does not.

**What it is not.** Not a cache the server honours and not a source of truth.
Every server action re-validates from the database (CLAUDE.md), so acting on
a stale sheet is safe; the fresh data simply replaces it.

**Which pages.** Snapshotted: `/chat`, `/character`, `/documents`, `/depot`,
`/notes`, `/gm/players` and a player's conversation, `/gm/turns`, `/gm/audit`,
`/gm/crafts`, `/gm/structures`, `/gm/dev/tags` and the dev panel for one
character. Not yet, because their bodies are hand-built server JSX rather
than one client component: `/archive`, `/faction`, `/lifeweb`, `/gm/dev` and
its Characters / Factions tables. Those still show their skeleton on every
visit; converting one means lifting its JSX into a client view first.

**Converting a page** is: split the default export into a session read plus
the old body renamed `Fresh<Page>`; make the body end in
`<SnapshotFresh scope userId data={props} />` with every early return
expressed as a `kind` in that object; write a `<Page>View.js` client
component that draws each `kind`. `/chat` (`page.js#FreshPlay`, `PlayView.js`)
is the model.

## 6. What comes next, in order

1. ~~**One write path**~~ — done (§2, §4). `db/lib/say.js` decides for both
   faces, `messageCreate` is "prepare, post, record, delete the original", and
   `/message` and Speak call the same three. The reactions (✏️ ❌ 🔍 📸) look
   their message up as an `ArchiveEntry` row by `discordMessageId` instead of
   the in-memory `recentProxies`, which a restart emptied — so an hour-old
   message is no longer inert. Edit and delete have a **5-minute window on both
   faces** (Bascinet's call), `/chat` draws ✎ and ✕ on your own rows, and
   delete is soft everywhere.
2. **The other places.** Public Rooms, private Rooms you can reach
   (`accessibleRooms`), Conversations you are in, the zone Summary. The place
   list becomes the left column; on a phone, tabs. Conversation membership
   moves into a `PlayerThreadMember` table, because today it lives only in
   Discord and a web-only player cannot be in a thread.
3. ~~**The right column**~~ — done (§5). The people standing here come from
   `db/lib/whosHere.js` and open the sheet's own people dialogs; the place
   panel is rendered from `db/lib/placeAffordances.js`, the one registry both
   faces read (§5c); Travel with drag-along, Examine, Storage,
   Noticeboard, Converse, Bell, Intercom, Turret, gates and keyed doors are
   all dialogs now. The console affordances came with it — Move
   (`db/lib/moves.js#fileMove`), the turn line, the Sheet link, "Report to
   the GMs", and a **Waiting on you** panel answering offers, threat spawns
   and a lobby seat through the same functions the DM buttons call. What is
   still Discord-only is **Speak** (Chat's composer is the same thing)
   and the anchor redraw after a web gate flip.
4. **Ambient lines write rows.** None of them archive today, so a web player
   never sees a gate crossing, a smell, a turret burst or a noticeboard pin.
5. ~~**The "web only" switch**~~ — done, and described below.
6. ~~**Typing, markdown, mentions, the wipe, the GM view**~~ — done (§3, §5,
   §7, §8). What was deliberately left out: **Web Push** (VAPID keys, a service
   worker and iOS install guidance — its own change), **attachments**, and a
   Discord-side "is typing" echo for a web typist, which Discord's API cannot
   express.

The desktop and mobile wireframes Bascinet chose are in §5.

### 6a. The "web only" switch

**Play from the web**, a `Switch` under the picture on the Bio card, right
after the turn ping. What it does is in its own `InfoIcon` now rather than in a
paragraph under the row — the same treatment the hood switch beside it got. It is the answer to §1's first reason: a Discord channel
lists every account that can see it, so standing in the Keep tells everybody
else in the Keep which Discord account you are, and the only fix is not being
there.

`Character.webOnly`, `Character.webOnlyChangedAt`, and
`WEB_ONLY_COOLDOWN_SECONDS` in `db/lib/webOnly.js` (7200 — **two hours**;
it was a `GameConfig` column nothing ever wrote until the 2026-09-07 config
trim). One function flips
it: `db/lib/webOnly.js#setWebOnly(prisma, character, on)`, returning
`{ ok: true }` or `{ ok: false, error, minutes, readyAt }`.

**The same switch is offered during character creation**, on the wizard's
Identity step beside name and age (`CreateCharacterWizard.js`, gated on
`GameConfig.playPanelEnabled` exactly as the Bio card's copy is). It is not a
flip: `createCharacter` writes `Character.webOnly` as a plain column inside the
creating transaction, so `applyLocationMoveSideEffects` and everything under it
already read it as on and grant nothing. The point is that a web-only player is
never added to the Location channel, the zone role, the narrowcast channels, the
Room threads or the standing Conversations in the first place — before this, the
only place to ask was a page you could not reach until the character existed, so
they were added to all of it and then removed again. `setWebOnly` is not called
there: its Discord half would revoke access that was never granted, and its
cooldown guard would fight the create. `webOnlyChangedAt` is left **null**, so
an accidental tick can be undone on the Bio card immediately rather than two
hours later.

**ON** takes the account out of Discord: `revokeAllCharacterAccess(prisma,
character, { keepGuests: true })` strips the zone role and every per-member
overwrite (the Location channel, the zone channels, the narrowcast channels),
then the Room threads named in `Character.roomThreadRoomIds` and every
Conversation in `PlayerThreadMember` are left, and the column is cleared. The
new `keepGuests` option is the whole difference from a death sweep: a
`RoomGuest` row is **game state, not Discord state** — somebody let them into
that room and they are still standing in it. `PlayerThreadMember` rows survive
for the same reason, which is what §2a was built for.

**OFF** puts it all back: `db/lib/locationMove.js#materializeDiscordPresence`
— the Location overwrite, the zone role, narrowcast,
`syncCharacterRoomAccess`, the Conversation thread adds for where they stand,
and `applyPendingInvites`. It is built on the same four helpers a move uses
rather than a second copy of them; the only difference is that there is no
origin to swap away from, so every call is a pure grant.

**The order is the load-bearing part.** The database flip lands FIRST, inside
the cooldown guard, and every Discord call after it is best-effort and
individually logged. A failed REST call must never un-flip the switch: the flag
is what every re-materialiser reads, so a half-applied ON that stays ON is
repaired by the doctor's next pass, while one that rolled back would leave a
player believing they were hidden when they were not.

**The cooldown** is the travel pattern (`db/lib/locationTravel.js`): one
`updateMany` whose WHERE carries `webOnly: !want` and `OR [{ null }, { lte
cutoff }]`, so two clicks in one tick cannot both pass and re-saving the Bio
card in the state you are already in spends nothing. A refusal reads *"You
switched N minutes ago. You can switch again at HH:MM."* and **leaves the
rest of the save standing** — the appearance somebody just typed is not thrown
away because a cooldown had two minutes left on it.

**What survives either way:** DMs, the OOC report channel (opened by the Player
role, not per character), guest rows, conversation membership, and the fiction —
they still stand there and still appear in Who's here?. The places column shows
one quiet `.chip`, **Playing from the web**.

**The turn-ping role does NOT survive**, and it used to. The line here said it
did, on the grounds that a turn ping "is a DM, not a channel" — which was simply
wrong. The ping is a `<@&DISCORD_TURN_PING_ROLE_ID>` inside the `#turns` console
(`db/turnCalendar.js#buildTurnAnnouncement`, posted with no `allowed_mentions`
so it really pings), and `#turns` is opened by the **zone role** this switch has
just taken away (`db/lib/turnsChannelAccess.js`). So a web-only player was being
pinged twice a day about a channel they could not open — and since the console is
deleted and reposted every turn (`db/lib/turnAnnouncement.js#postTurnsConsole`),
by the time they went looking the message that pinged them was gone. A player
reported it as ghost pings.

**Two writers enforce it**, and `db/lib/webOnly.js` is deliberately not one of
them. The Bio save (`web/app/(app)/character/actions.js`) already writes the
role on the line after it calls `setWebOnly`, and it has to: it is the only
place that sees somebody *already* web-only ticking the turn-ping box, which
the flip itself never runs for. Doing it in both was two identical REST calls
per flip. The other writer is `db/lib/channelDoctor.js`'s `turn-ping` reconcile
(`turnPingOptIn && !webOnly`) — bidirectional, so that one predicate both takes
the role off everybody already in the bad state and hands it back the moment
they switch web-only off, with no backfill script.

Two things to know about that split. `setWebOnly` is an exported `db/lib`
function with exactly one caller today; a future bot-side caller would skip the
role and wait on the doctor. And `/gm/dev/characters/[id]` writes the
`turnPingOptIn` COLUMN (`characterWrite.js`) with no Discord effect at all
(`planDiscordEffects` has no turn-ping case), so a GM ticking that box also
waits on the doctor — which predates this change.

The player is told, rather than left to notice: while Play from the web is on,
the Bio card draws a line under the turn-ping switch saying the ping has
nowhere to arrive and that their answer is kept for when they switch back
(`web/app/components/AvatarField.js`). The box still records the preference —
silently keeping a notification switch that cannot fire is the thing this whole
entry is about.

Which re-materialisers had to learn the flag is in `CHANNELS.md` §3, and it is
the list to check against when adding another.

## 7. The wipe: a watermark, not a delete

The message wipe (`CHANNELS.md` §8) empties every Discord channel. Chat
cannot do the same thing and should not want to: `ArchiveEntry` **is** the
transcript `/archive` reads, so deleting a row to tidy a screen would burn the
record.

So the web reads past the wipe instead — and since 2026-09-07 there are **two
watermarks**, because the wipe has two cadences:

| Column | Moves | Floors |
|---|---|---|
| `GameConfig.feedWipeSeq` | every turn | `loc:` / `room:` / `conv:` places |
| `GameConfig.feedWipeSummarySeq` | Dawn only | `zone:` places |

Both are set in one `update` so the pair can never half-land.
`db/lib/feedWipe.js` is the whole of it — `markFeedWiped(prisma, { summaries })`
sets them, `feedWipeFloors(prisma)` reads them back as
`{ turn, summary }` BigInts (both zero when the wipe is off, so a game running
without it behaves exactly as it did before this existed), and three helpers
apply them:

- `floorForPlace(floors, placeKey)` — one place, one floor. The two routes that
  only ever look at a single place use this.
- `placeSeqWhere(floors, placeKeys, extra)` — a Prisma `where` fragment for a
  **mixed** set, ORing a zone clause and a non-zone clause. With one kind
  present it collapses back to a plain single clause, which is the common case.
- `lowestFloor(floors)` — for the one reader that has to pick a single number
  for a mixed stream. See the trap below.

Five readers, and they have to agree or the page and the stream disagree about
where the day starts: the stream's catch-up (`/api/feed`), the history route
(`/api/feed/history`), the search route (`/api/feed/search`, raw SQL, so it
picks with a `CASE WHEN ae."placeKey" LIKE 'zone:%'`), the page's first render
(`play/page.js`), and the `newestSeq` watermark `web/lib/feedAccess.js`
decorates the place list with.

**The trap is the stream's high-water clamp.** `/api/feed` keeps one `lastSeq`
for the whole connection and drops anything at or below it as already sent.
That number must be the **lower** of the two floors, never the turn floor — a
zone-summary row sitting between the two is legitimately older, because its
channel is wiped on the slower schedule, and clamping to the turn floor would
silently swallow it.

The floors are read once per connection, and a connection now lives across
every refresh — hours, not minutes. A scene wiped mid-connection stays on that
tab's screen until it reloads, on purpose: it is the same thing that happens
to a Discord client that had the channel open.

There is a **second floor underneath that one, and it is never off**: every
row belonging to a previous game. Restart Game keeps `ArchiveEntry` on purpose
(`LOBBY.md` §8), but Chat is the live room rather than the record, so last
game's scenes have no business rendering under the names of characters who no
longer exist. `seq` only ever climbs, so every row of every finished game sits
below every row of this one, and `previousGameFloor` reads the highest of them
back. It asks for the highest seq NOT in this game rather than the lowest seq
in it, so a freshly wiped game with nothing said in it yet shows an empty Chat
rather than yesterday's; a row with no `gameId` predates the column and is old
by definition. `feedWipeFloors` folds it into whichever of its two watermarks
is higher, which is why fixing this took no change to any of the readers
above.

**It is set as the pass BEGINS**, from `db/index.js#advanceTurn`'s side-effect
thunk, immediately before `runMessageWipe`. That is the same instant `cutoffMs`
names on the Discord side, and the reason is the same: a message posted while
the wipe is still walking the map survives on Discord, so it has to survive
here too. Taking the watermark afterwards would have made where you were
standing decide whether what you said still exists.

One thing falls out for free. **The unread dots reset with the wipe**, because
a dot is "the newest seq here against the newest seq this browser saw here" and
after a wipe there is no newest seq here until somebody speaks. No second pass,
no `localStorage` to clear.

## 8. The GM's Scene tab

The player desk's inspector (`PLAYER-DESK.md` §6) gains a **Scene** tab: what
is being said where the inspected character is standing, live.

It renders Chat's own `Feed`, not a GM-flavoured copy of it —
`(desk)/gm/players/SceneTab.js` is a place picker, a stream and that component.
The runs, the faces, the subtext, the tinted speech and the typing line all
come out identically, which is the point: a GM reading a scene should be
reading the player's page, not a transcript of it.

Read-only twice over. `Feed`'s `readOnly` drops the composer, and the GM place
list carries `canSpeak: false` on every entry anyway (§5a).

`getCharacterScene({ characterId })` builds the list by asking
`placesFor(prisma, null, { gm: true, discordUserId })` for the GM's **own**
list and keeping the entries belonging to that character's Location — its
Rooms and Conversations included. So a zone a GM's `GmZoneView` does not open
has no scene in it, and the gate is the same one every request re-applies.

It is the first thing to use `InspectorColumn`'s `extraTabs` — a whole tab
rather than a `tabPreludes` section, because a prelude sits above a base tab's
own body and this has no base tab to sit above, and because it is a live stream
that must not take a slot in the shared per-(character, tab) fetch cache.
