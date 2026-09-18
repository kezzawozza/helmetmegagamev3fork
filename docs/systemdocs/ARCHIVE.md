# Archive

The game's transcript. Every proxied character message is written to
`ArchiveEntry` **at send time** — `db/lib/archive.js#recordArchiveMessage`,
called from `bot/src/lib/proxy.js#sendAsCharacter` (gateway) and from
`advanceTurn`'s `runSideEffects` for staged public posts (REST) — and read
back on the web at `/archive`.

This replaced archiving at *wipe* time, which `db/lib/messageWipe.js` used to do
by reading every message out of Discord and re-posting it into a single
`#archive` channel. That was the most expensive thing the bot did: one channel
is one ~1 msg/sec rate-limit lane, so a busy turn meant hundreds of sequential
posts, and it scaled with player count. It was also approximate — the character
was matched by *current* name (a rename mis-attributed everything they'd ever
said) and the turn was inferred by comparing timestamps against
`Turn.gameDate`. Recording at write time makes both exact and reduces the Dawn
wipe to deletes, which are the cheap half (100 messages per bulk request).
There is no `#archive` Discord channel any more.

`ArchiveKind` puts system events in the same table as messages so the two
interleave chronologically and the transcript reads as a diary rather than a
chat log with no context: `TURN_START` (the chapter divider, written in
`advanceTurn` where the turn is created rather than in `runSideEffects`, so a
failed announcement can't leave two days with no boundary — **one row per zone**
since phase 4 of Chat, each with `placeKey: zone:<id>`, so every zone's feed
on `/chat` carries the day line; the transcript still draws one divider, since
it keys on the day and never renders a `TURN_START` as a row), `CHARACTER_CREATED`,
`DEATH`, `DESIRE_FULFILLED`, `LIFEWEB`, and `TRAVEL`
— the last gated behind `GameConfig.archiveTravelEvents`, off by default,
since arrivals are what make a zone read like a story and also two rows per
character per turn before anyone speaks.

Five things about it are load-bearing:

- **The id columns are not foreign keys.** Same posture as
  `AuditLog`'s snapshots. A Zone can still be deleted (a superadmin hard-delete
  from `/gm/dev/zones`, refused only while something still references it) and
  `wipeGameData` clears Characters — a real relation would either take the
  transcript with it or fail on FK ordering (which Restart Game has been
  bitten by once already). Plain indexed ids plus `zoneName`/`characterName`
  snapshots survive both, and the snapshot is the more correct record anyway:
  who someone was known as *then*.

  **`gameId`** is the same shape: which `Game` the row belongs to, stamped by
  `db/lib/archive.js#currentGameId` from a thirty-second memo of
  `GameState.gameId`, never an FK. It is what lets a past game keep its
  transcript (`LOBBY.md` §7).

  The place columns are **`zoneId`/`zoneName`** — a row records the zone it
  was said in, and the Room or Conversation it was said in is `threadName`.
  `channelKind` reads `summary | location | watch | scene` (a plain
  string field, not a Prisma enum, so old rows can still say `mindlink`
  from before the Cult of Bacchus was archived, or `intercom` from before the
  PA wrote one row per zone).

  **`source` reads `DISCORD | WEB | SYSTEM`.** The third is what the WORLD
  says — a gate crossing, a smell, a bell, a turret, a noticeboard pin, the
  intercom, a staged public declaration. Those are `MESSAGE` rows with no
  character and `channelKind: "scene"`, written by
  `db/lib/scene.js#sceneLine` **beside** the Discord post rather than instead
  of it (CHAT.md §2). They carry the plain sentence with no `-#` prefix: that
  is Discord's rendering of subtext, and `/chat` draws a SYSTEM row as
  `.chat-subtext` on its own. The outbox never posts one — it handles `WEB`
  rows only — so a scene line can never be echoed back into the channel it
  came from.
- **Restart Game asks what to do with it, and either way the rows leave.**
  Every game is a `Game` row (dates, closing note, epilogue), and the
  wipe snapshots the old game's reveal onto it, opens the next, and points
  `GameState.gameId` at the new one. What happens to the transcript is now a
  choice — **discard** it, or **keep** it as a packet — and §6 below is the
  whole of it. The message wipe still deletes Discord messages and never the
  transcript, which is the entire point of recording at send time.

  This used to read "Restart Game keeps the table", and for a while before
  that the wipe deleted it outright, after a restart once left the previous
  game readable as if it were the current one. Keeping every game forever was
  the fix for that and it worked, right up until the game number hit 13
  before launch with twelve dead playtests in the picker.
- **Every write is best-effort and swallows its own failure**, logged not
  thrown. `recordArchiveMessage` runs inline with the proxy send; a transcript
  row is never worth breaking a player's message over.
- **`❌` deletes the row and `✏️` updates it**, keyed on `discordMessageId`
  (`bot/src/events/messageReactionAdd.js`). Delete means gone, so a player can
  trust the button — the accepted cost being that the record is incomplete and
  someone can quietly retract what they said. The edit is only mirrored *after*
  Discord accepts it, or a rejected edit would leave `/archive` showing text
  that was never posted.
- **Attachments are a placeholder** (`[image]`/`[attachment]`) and nothing
  more. Discord's CDN urls now carry expiry parameters, so storing one would
  fill the archive with dead images; actually preserving them would mean
  downloading the bytes the way avatars are stored, a deliberate non-goal. The
  placeholder at least makes the gap visible rather than silent, which is what
  the old wipe-time archive did.
- **`discordChannelId` is a channel snapshot, not an FK** (same posture as the
  other id columns above). It's the channel the message was posted in — the
  THREAD's own id when it was said inside a thread, since that's what a jump
  link's channel slot needs — written by the bot's `resolveChannelContext`
  alongside `channelKind`/`threadName`. It has two jobs, and only one of them
  stays useful: the message wipe deletes every Discord message every turn, so a
  jump link built from this id is only live for the turn it was posted in
  (Room threads survive, emptied to their starter). The whisper poll
  (`bot/src/lib/whisperPoll.js`) is its other reader: "who spoke in this
  Conversation in the last fifteen minutes" is one query on this column. The other job — exact channel-identity grouping
  for the desk's archive-context popup — works regardless of the wipe, since it
  never depends on the Discord message still existing. Rows written before this
  column existed are null and stay null; the backfill that filled some of them
  is gone, and pre-existing thread rows (`threadName` set) never had their
  thread id captured anywhere else anyway.

## 5. `/archive`

`web/app/(app)/archive/` is **server-side paged over `?page=`**, the second
such surface after `/gm/audit` and for the same reason — a finished game's
worth of rows can't be a client-side `useTableState`. Sorted oldest-first by
default (it's a diary to read forward, not a log to skim), with `id` breaking
`sentAt` ties so a burst of same-millisecond messages can't put one row on two
pages.

**One game at a time.** `?game=N` picks a `Game`; the current one is the
default. A game with an epilogue shows it on top — the closing note, the
facts line, and "who was who" folded under a click. The zone and character
filters are `groupBy`s over the game's own rows, not the live tables: a past
game's characters are gone and its zones may have been re-synced under new
ids, but the snapshot names on the rows are exactly what was.

**The transcript is dense** (`ArchiveTranscript.js`): the page's rows grouped
by consecutive day, then scene, at the audit log's sizes. A `TURN_START` row
becomes the sticky day line — "Day 12 · Dusk" — and is never a row itself. A scene line is
`zoneName · threadName`. Speech rows are time / speaker / words, the speaker
reading `Young Man (Sir Alder)` for a concealed send. A run of system rows
(arrivals, deaths, moves, desires) folds into one muted `<details>` line
counted per kind — "3 moved · 1 died" — with the rows inside. The **Show**
filter is Speech (the default: `MESSAGE` rows that are not `SYSTEM`, plus the
day dividers) or Everything. SYSTEM scene lines are out of the default view on
purpose — the arrivals, deaths and moves they narrate are already in the fold,
and showing both would print each one twice.
No jump links: the message wipe would have killed them anyway. **Faces are a
toggle**, off by default — `presentedAvatarPath` is frozen onto the row at send
time precisely so a later disguise or a Mulligan rename cannot rewrite what a
line looked like, and a line said under an alias before that column existed
draws the plate rather than a guess. Every row goes through
`db/lib/archive.js#archiveRowsShape`, which wraps `feedRowShape`: the archive
names the character behind a hood in `realName`, and still withholds
`characterId` on that row so a browser cannot correlate a hooded line with a
named one by id.

**The words go through `ChatMarkdown`**, the same renderer `/chat` draws a line
with, so a transcript reads the way the scene read. It used to go through
`RichText`, which renders no Markdown at all — asterisks, `-#` and `||spoilers||`
all reached the reader literally — *and* resolved the whole catalog, so a
player could type `{tag:apex-form}` into a message and mint a live chip in the
transcript. See `CHAT.md`'s renderer section for the scene-or-prose rule and
the test that holds it.

A **mention** in an archived line prints the name the room heard, off the token
itself (`{char:<id>|<Name>}`, `PROXYING.md` §6) rather than a live lookup — so a
disguise or a Mulligan rename after the fact cannot rewrite what a line said,
the same reason `characterName`, `concealedAlias`, `presentedAvatarPath` and
`presentedState` are frozen columns beside the row. Rows written before that
fall back to resolving live, and are not backfilled: stamping today's names
onto them would be the rewrite the freeze exists to prevent.

`presentedState` is the newest of the four and the widest: what the room could
*see* of the speaker — their appearance, the tags they held and which were worn
— so that looking at an old line answers for that moment rather than for now
(`PROXYING.md` §4a). It rides in a packet like any other scalar column, since
the exporter reads its field list off Prisma's own datamodel rather than a
hardcoded array. It is deliberately **not** a strict field: a packet written
before it existed imports fine and those rows simply read live, which is the
behaviour they had anyway.

**The gate.** A GM tool, always — every game, current or past, requires a GM
(`web/lib/archiveAccess.js`), enforced in the page and mirrored in the nav
(which shows the link only to a GM). There is no toggle that opens it to
players: the archive shows every zone regardless of where a character stood
and names the character behind every `/conceal`, and a GM could already see
through both of those everywhere else on the desk.

## 6. Packets: a finished game as one file

The transcript is the only game data that was meant to outlive a wipe, and
keeping it in the live database was doing three jobs badly at once.

- **Every playtest left a permanent game behind.** Thirteen of them before
  launch, all in the `/archive` picker.
- **Backups could not give you just the archive.** PITR and the nightly
  `pg_dump` (`BACKUPS.md`) are both all-or-nothing, and the dumps are pruned to
  the newest 30 — about a month. Recovering one old game meant restoring a
  whole database into a scratch service and copying rows out, if a dump that
  old still existed.
- **The schema keeps moving between games.** A dump from four months ago
  restores against four-month-old code.

So a finished game becomes **one file**, and the live database holds only the
current game. `/archive` gets faster forever as a side effect: its two
unfiltered `groupBy`s run on every page load and now only ever see one game.

### The file

Gzipped JSONL in the backup bucket, under a new prefix:

```
archives/final/<gameId>.jsonl.gz          the permanent one. Never pruned.
archives/live/<gameId>/<stamp>.jsonl.gz   the nightly. Newest 3 kept.
```

Line 1 is a manifest — `gameId`, the whole `Game` row, `entryCount`, `minSeq`,
`maxSeq`, a sha256 of the entry lines, and the column list as it stood. Every
line after it is one `ArchiveEntry`.

**Not CSV**, which was the first idea. `content` is multi-line prose full of
commas and quotes, `epilogue` is JSON, `seq` is a BigInt, and CSV cannot tell
NULL from empty string — which matters here, because a null `concealedAlias`
means "not concealed" and an empty one would mean a mask with no name.

Three rules make a packet readable after a year of drift, and
`db/lib/archiveExport.js` is where they live:

1. **Every column is written explicitly, nulls included**, so a reader can tell
   "the column existed and was null" from "the column did not exist".
2. **The column list comes from Prisma's DMMF at runtime**, so the exporter
   cannot fall behind the schema.
3. `seq` crosses as a **string** (CHAT.md's rule for the cursor), dates as ISO.

### Two buttons, and why they are two

**Archive this game** exports, verifies, uploads, and stamps `Game.exportKey` /
`entryCount` / `exportMaxSeq`. It deletes nothing, so it is safe to press
early, twice, or mid-game. **Restart Game** only ever *checks* that stamp.

They are separate because the export is minutes of work and a multi-megabyte
upload, and Restart Game's own button promises it returns "in a second or two"
and says *"Nothing was changed"* when it cannot reach the server — a promise a
long upload in front of it turns into a lie the first time a request times out.
Worse, `wipeGameData` commits the epilogue stamp and the next `Game` row
*before* its transaction, so a failure after that point already leaves an
orphan; a several-minute step in between would have made that easy to hit.

### Nothing is deleted on the strength of an exit code

Under this design the packet is the **only** copy. So `verifyPacket()` re-reads
the gzip that was actually written and recomputes the hash over it before
anything is told the file exists. A truncated packet is the same shape and
roughly the same size as a good one, and you find out which it was on the worst
possible day — the same reason `ops/backup/backup.sh` runs `pg_restore --list`
on every dump before uploading it.

### Three things about the delete

- **Not inside the wipe's `$transaction`.** A month-long game is tens of
  thousands of rows, and deleting them means index maintenance across nine
  indexes plus the trigram GIN on `content`, inside a transaction already
  holding write locks on some twenty-five tables. It is the likeliest statement
  there to hit a timeout, and if it did the whole wipe would roll back —
  `gameState.create` included — while the epilogue stamp and the next `Game`
  row stayed committed.
- **Bounded by `Game.exportMaxSeq`** when a packet is standing behind it. The
  bot keeps writing between the export and the wipe, and those rows are not in
  the file.
- **Batched**, so a timeout leaves a smaller job rather than no progress.

### Importing, and the one thing that can go badly wrong

`npm run archive:import -- --key <s3 key>` loads a packet back. It prints every
column it dropped and every one it let default, which is the point: a tolerant
importer that says nothing rots silently as the schema moves.

It is **strict** about `id`, `seq`, `gameId`, `kind`, `content`, `sentAt`,
`source`, `discordMessageId`, `sourceDiscordMessageId` and `deletedAt`, and
refuses a packet missing any of them. Defaulting those is not a gap, it is a
silent corruption — `sentAt` especially, because
`bot/src/lib/feedOutbox.js#drainFeedOutbox` claims rows by age, so a defaulted
`sentAt` would have the bot narrate a dead game into today's channels. (That
drain now also filters on the current `gameId`, which it always should have.)

**The seq guard.** Every feed reader leans on one invariant (`CHAT.md` §7): seq
only climbs, so every row of a finished game sits below every row of the
current one. `db/lib/feedWipe.js#previousGameFloor` turns that into the floor
`/chat` filters above.

Deleting old rows is safe — it can only lower that floor, and the rows it would
have hidden are gone. **Importing is the dangerous direction.** A packet whose
seq range reaches into the live game lifts the floor *above* the live rows, and
`/chat`, the SSE stream, history and the unread dots all go dark at once. So
the importer refuses that outright, and `--remap-seq` is the escape hatch that
imports with fresh cursor values instead.

`db/test/archiveExport.test.js` holds all of this: a full round-trip comparing
every column, a damaged packet being refused, the seq guard firing, and the
sequence never moving backward. It wants a real Postgres, so it skips unless
`ARCHIVE_TEST_DATABASE_URL` points at a throwaway one.

### Identity: a game is its id

**`Game.number` is gone** (2026-09-09). It was a creation ordinal, every
playtest wipe consumed one, and it reached 13 before the game had launched
once. The picker had already stopped showing it; the column went with the last
two places that did — the **Game Ended** post in `#turns`, and the chip on
`/gm/dev?s=game`, which is the game's short id now.

So `/archive` keys on `Game.id`, names a game by `Game.label` or its dates
(`web/lib/gameLabel.js#gameTitle`), and orders the picker by `createdAt`, which
is the same order the ordinal gave. An id nobody has is not a game: the page
redirects rather than falling through to the current one, which matters because
`?game=3` links from the numbered era exist and a 3 means nothing now.

Archive packets are unaffected. `decodeGame` walks the **current** schema's
fields and ignores anything else in the file, so a packet written while games
had numbers still imports; it simply carries a column nothing reads.

### A copy on your own disk

A packet is the only copy of a finished game, and the bucket is one place. So
`npm run archive:pull` syncs every packet in it down to a folder here.

```
npm run archive:pull                      # -> ./archives, everything
npm run archive:pull -- --dest ~/packets  # somewhere else
npm run archive:pull -- --final           # only the permanent packets
npm run archive:pull -- --recheck         # re-verify what is already here
```

It touches no database at all, so it runs anywhere the `S3_*` credentials do.
It reuses `listObjects`/`getObject` and `verifyPacket` rather than growing a
third S3 client or a second verifier, and it exits 1 if anything failed, so it
is safe on a cron.

Two things it will not do.

**It never trusts the transfer.** A download lands on a `.part` file, is
verified, and is only then renamed into place — so a half-written file never
occupies the name and the next run re-fetches it rather than skipping it as
already there. `--recheck` re-verifies files that are already local, and a bad
one is renamed to `.corrupt` for the same reason: bit rot does not change a
file's size, so leaving it on the name would have every later run skip it.

**It never lets a packet reach git.** The transcript names the character behind
every `/conceal` and this repo is public. `archives/` and `*.jsonl.gz` are in
the root `.gitignore`, and the destination folder is given its own
`.gitignore` holding `*`, so a folder somewhere else is covered too.

### Where the code lives

| File | What |
|---|---|
| `db/lib/archiveExport.js` | `exportGame`, `verifyPacket`, `importPacket`, the seq guard |
| `db/lib/archiveBucket.js` | SigV4 against the bucket, for the web action and the scripts |
| `scripts/db/bucket.py` | the same, for a terminal: `archives`, `put`, `getkey`, `rm` |
| `db/scripts/ops/archive-*.js` | `npm run archive:export` / `import` / `pull` / `exports` |
| `web/app/(app)/gm/dev/actions.js` | `archiveCurrentGame`, and the delete inside `wipeGameData` |

`npm run archive:exports` exits 1 when the current game's newest nightly is
over 36 hours old, exactly as `npm run db:backups` does. The way a backup
system fails is not loudly; it is by going quiet months before anyone looks.
