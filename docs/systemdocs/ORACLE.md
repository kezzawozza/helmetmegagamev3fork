# The Oracle — a written record of each turn

When the Moves lock, a gamemaster has no readable account of what just
happened. What exists is the raw material: ninety-odd `Action` rows, a few
hundred `AuditLog` gestures and thousands of chat lines spread across Location
channels. Nobody reads that, so most of what players did is never seen by the
people adjudicating.

The Oracle writes it down. Six correspondents, one per zone, each handed only
their own zone's material; a seventh, the Threats correspondent, scoped to
antagonist seat-holders instead of a place (§3a); then an editor, which reads
all seven and writes the front page. It costs about a cent a turn.

It is **off by default** (`GameConfig.oracleEnabled`) and configured at
`/gm/dev?s=oracle`, which is superadmin-only. The desk that reads it,
`/gm/oracle`, is open to every GM — unless the **Playtest** switch is on, which
narrows it to superadmins while the thing is being tried out (§12).

## 1. Why it is shaped this way

Two assumptions turned out to be wrong, and the architecture is what is left
once they are removed.

**Cost is not a constraint.** The dense input tier — moves, the two live tag
categories, the filtered audit log, for ninety players — is about 34,000 tokens
a turn. On a cheap model that is well under a cent, roughly 50p for a
thirty-turn game. Including the entire chat transcript is closer to 650,000
tokens and still only a few pounds a game.

**Context is not a constraint either**, at least not the way it was assumed to
be. So the sharding is not a workaround for a window that is too small; it is
chosen, and for two reasons that survive any model:

- **A correspondent holding one zone writes a tighter page** than one asked to
  cover the whole map at once.
- **The shard boundary is the `GmZoneView` boundary.** One page per seat zone
  is exactly one page per thing a GM can be scoped to.

The second one has a limit worth stating plainly: `GmZoneView` on the desks is
**a view, not enforcement** — the server ships every row and the rail filters
it (`GAMEMASTERS.md` §1). The Oracle follows that convention rather than
breaking from it, so generating per zone makes stricter scoping *possible*
later; it does not by itself prevent anything.

The happy side effect of sharding is that **no single call is large**, so
swapping provider or model later costs nothing.

## 2. Where it runs, and where it must not

**Not a `TURN_PASSES` entry.** That is the obvious guess and it is wrong three
times over:

- A pass runs inside `resolveNeeds()`'s serial loop, and every name in
  `TURN_PASSES` (`db/index.js:194`) must record before `needsResolvedAt`
  stamps. A pass that spends two minutes on an HTTP call holds the whole
  advance open.
- The cron awaits `advanceTurn()` inline (`bot/src/lib/turnEngine.js`), so a
  slow pass blocks the bot process itself.
- The shared client runs `transactionOptions: { timeout: 15000 }`
  (`db/index.js:81`), raised because several passes contend for pool slots at
  exactly this moment.

`TURN-ENGINE.md` states the rule outright: *nothing above this line talks to
Discord; nothing below it touches the database.* Passes return data and never
make network calls, precisely so none can hold a turn advance open.

**It runs at the Move cutoff** (`db/lib/oracleCutoff.js`), a couple of minutes
after the Moves lock — 21:00 CT on a normal turn, three hours before the push.

That is the whole point of it, and it took a move to get right. The Oracle used
to run in the side-effect thunk at turn close, on the reasoning that a synopsis
arriving late costs nothing: a DM that arrives late is a bug, a synopsis that
arrives late is a synopsis. True, and beside the point. It is written **for the
gamemasters adjudicating**, and they adjudicate in the three hours between the
lock and the push — so the chronicle was arriving after the rulings it was
meant to inform. Now it is waiting for them when the window opens.

**There is no lock event, so this is a per-minute check, not a subscription.**
`moveCutoffAt()` is derived from `turn.startedAt` and `moveWindow()` only
answers when something asks (`TURN-ENGINE.md` §6a). The bot ticks once a minute,
loads the open turn, and asks; `cutoffDecision()` is the pure half of that and
every branch of it is tested. A fixed `0 21 * * *` cron would be wrong for a
turn a GM opened by hand and would fire during a frozen clock when no turn is
moving. Ticking is also what makes it self-healing: a bot that was down at the
cutoff drafts as soon as it is back, provided the turn is still open.

**It fires on the cutoff minute, and the six zone calls run at once.** Both of
those used to be the other way round, and together they cost the window its
first quarter of an hour: two minutes of settling, then seven calls one after
another, so the chronicle reached the desk at about 21:16 for a lock at 21:00.
The settle was there to stay out of the minute the Makeshift Stage sweep holds
(`0 3,9,15,21`, same timezone), which is a handful of queries against six
outbound HTTP calls — barely the same resource, and not worth the delay.

The two shapes, measured back to back on the same real turn: **818 seconds in a
row, 240 at once.** Six together cost about what the slowest zone costs (167s),
and the rest is the editor (71s), which is the part that cannot move — it reads
the six pages back out of the database.

What made the calls sequential was real, though: a single mutable Set claiming
the once-a-turn lines as it went, which only means anything while the calls are
in order. That claim is settled before any of them start —
`oracleInput.js#aggregatesSeenByZone` walks the zones in the same order and
hands each one its own Set — so the six inputs are identical to what the
in-order version built. Each zone is attempted whatever its neighbours do, and
a failure comes back as a reason rather than costing the five pages behind it.

**The written pages are the ledger.** Leaving the thunk meant leaving
`step()`'s `Turn.sideEffectSteps` behind, so `runOracle`'s `skipIfComplete` asks
the database instead: all seven rows present and there is nothing to do. It is
**all seven or none** — a half-finished run is redone whole rather than patched
zone by zone — because six zone pages are one document, not six jobs:

- the editor writes the front page over whatever zone pages it finds, so
  filling a missing zone in later leaves a front page that summarises the set
  without it, permanently and silently;
- the once-a-turn lines are claimed per zone from the turn's own rows, so a
  pass that rewrites only some of the zones can hand a line to a page that is
  being rewritten while the page that already carries it stands — and the same
  fact is reported twice.

**A failure can never fail a turn**, and now it cannot even reach one.
`runOracle` returns a reason rather than throwing, the cutoff run's `step`
logs and swallows per zone so one dead zone does not cost the five behind it,
and three failed attempts on a turn stop the retries rather than spending the
whole window on a provider that is down.

**What is not covered: a turn that closes without a page.** Once the turn ends,
`moveWindow().locked` is false again and nothing revisits it — a bot down for
the whole three hours, or a provider outage that ate its attempts, leaves a
hole. **Run now** on `/gm/dev` is the recovery, and it now defaults to the open
turn for exactly that reason.

## 3. What it is allowed to see

| Block | Source |
|---|---|
| Moves | `Action` — description, `moveKind`, `diceRoll` **and** `diceModifier`, `resourceDelta`, `locationId`, review status |
| Tags | `CharacterTag`, filtered to categories `health` and `status` |
| Events | `AuditLog`, filtered — §4 |
| Beats | `ArchiveEntry` of kind DEATH, CHARACTER_CREATED, DESIRE_FULFILLED, LIFEWEB, TRAVEL |
| Chat | `ArchiveEntry` of kind MESSAGE, only when `oracleIncludeChat` |

`db/lib/oracleInput.js` is the whole of that access, on purpose: what a
correspondent may see is a question with a right answer, and it should be
answerable by reading one file.

## 3a. The Threats correspondent

A seventh, zone-shaped page with no real Zone behind it — `db/lib/threats.js`'s
seat holders instead of a place, added to the front page's zone list as
`## Threats` the same way `## Black Hills` is. GM-tier, not superadmin: the
Threats and Objectives sections it draws on are already GM-tier
(`web/lib/devAccess.js`), and `threat_assigned` / `objective_*` rows already
reach every GM through `/gm/audit` — a summary of the same activity is not a
new leak.

Who counts as a seat-holder, and which party they answer for, is
`db/lib/objectives.js#membersByParty` — the same helper the end-of-game reveal
uses, so this page can never disagree with `/gm/dev?s=antagonists` about who is
seated. Its extra sources beyond the table above:

| Block | Source |
|---|---|
| Spawns | `ThreatSpawn`, windowed on `createdAt` **or** `resolvedAt` — the one lifecycle table with no audit row of its own |
| Rites | `RiteAttempt`, windowed on `firedAt` |
| Objectives | `db/lib/objectives.js#listObjectives`, one call per party that has a seat-holder this turn — a live snapshot, not a diff (`Objective` has no completion timestamp), so the model leans on its own three-turn memory to notice a change |
| Events | the seat-holders' own audit lines, **plus** `threat_assigned` / `threat_spawn_offered` / `threat_spawn_cancelled` / `objective_added` / `objective_pinned` / `objective_removed` / `rite_fired` — a new addition to `oracleAudit.js`'s allowlist, safe for the zone pages too since none of these rows carries a `locationId` |

No `CHAT` section: chat is zone-scoped by Location channel and a seat-holder's
own lines already appear on their own zone's page, so pulling them again here
would double them up with nowhere single to attribute the duplicate to.

**The schema wrinkle.** `zoneId = null` used to mean exactly one thing, the
front page. The Threats page has no Zone row to point `zoneId` at either, so
`OracleSynopsis.kind` (`ZONE` / `FRONT` / `THREATS`) is what tells the two
null-zoneId rows apart now — in the run (`isComplete`, `findPage`, `isEdited`,
`memoryFor`, `writePage`, all in `db/lib/oracle.js`) and on the desk
(`front = rows.find(row => row.kind === "FRONT")`, `web/app/(desk)/gm/oracle/page.js`).

Three things there are easy to get wrong.

**The turn window is derived, not read, and it runs LOCK TO LOCK.** Turn N's
page covers turn N−1's cutoff through turn N's — not midnight to midnight. It
has to: the page is written at the cutoff, so the three hours after it do not
exist yet, and they belong to N+1's page, which is the first one drafted after
they happened. That is where the GM's own adjudications, the late chat, and
everything the midnight push fires (hunger, deaths, staged effects) get written
down. Nothing is lost; it shifts one turn.

Two consequences worth knowing before reading a page:

- **"Turn 12" here is not "turn 12" on the other desks.** `/gm/audit` windows
  midnight to midnight and `/archive` filters on `ArchiveEntry.turnNumber`. A GM
  cross-checking a page against either will find the last three hours of the day
  filed one turn later. That is inherent to drafting at the lock.
- **The floor is the last turn that was WRITTEN, not the last turn.**
  `moveCutoffAt()` is a pure function of `startedAt` and hands back a 21:00 for
  every turn that has one, lock or no lock — so anchoring on the previous turn
  would make a frozen Tuesday *read* as covered when nothing ever covered it.
  Anchoring on the last turn with a page puts the skipped days inside the next
  real page's window instead. `windowBetween()` is pure and tested, including
  the clamp that stops a turn a GM opened at 23:00 — whose derived cutoff is two
  hours before it began — from dragging the floor backwards and having two pages
  chronicle the same evening.

`AuditLog.turnId` is no help here and never was: it is NULL on most rows, since
the column exists for the per-turn rations and is not a general "which turn was
this" stamp. `/gm/audit` derives the same way. Filtering audit rows on `turnId`
would return almost nothing, and read as a quiet turn rather than as the bug it
is.

**Moves, beats and chat go by the window too, not by their turn stamp.** Each
carries one — `Action.turnId`, `ArchiveEntry.turnNumber` — and each stamp lies
about a page drafted at the cutoff:

- a Move the *game* files — a travel stub, a craft receipt, a lesson — can be
  written at the *push*. Those rows are stamped turn N and created after N's
  page exists, so on the FK they would appear in no page ever. (This was much
  the larger problem when an auto-labor pass filed a Move at the push for
  everybody who had filed none; in a hundred-player game those were most of the
  Moves there were. Nothing files itself at the close now — `TURN-ENGINE.md`
  §6 — but the window rule is what makes the rest of them land.)
- an `ArchiveEntry` sent after N's lock is stamped N, so N's page cannot see it
  and N+1's would never look for it.

A player's own Move is unaffected either way: it can only be filed before the
lock. `ArchiveEntry` is windowed on **`sentAt`**, not `createdAt` — every index
on that table is on `sentAt`, `createdAt` has none, and `sentAt` is also the
honest column, since the message catch-up sweep writes rows hours late carrying
the time the line was really said.

**Only two tag categories.** A character's Beliefs and Skills are bought at
creation and never move, so shipping all of them every turn pays repeatedly for
a constant and crowds out the moves. Health and status are the two that change.
Everything else reaches the Oracle as a *change*, through the audit lines.

**Both faces of a hood.** A concealed character is written
`Bram Holt (seen as "a young man")`. Writing only the true name hides that a
disguise was in play; writing only the alias makes somebody impossible to
follow across turns. Since this is a GM surface, it gets both.

### One approximation, stated

**People are placed by where they stand now, not by where they stood during the
turn.** There is no per-turn position history to read: `LocationVisit` records
the *first* time somebody saw a place, and `ArchiveKind.TRAVEL` rows are off by
default and fire only on a zone crossing, so within-zone movement is recorded
nowhere at all.

Moves are unaffected — `Action.locationId` and `zoneId` are stamped at filing
time, deliberately, so a Refine filed on the Factory floor pays for the Factory
floor even if its author walked out afterwards. It is the **roster** and the
**audit lines** that are placed by current position.

At the cutoff, minutes after the Moves locked, that is very nearly exact and is
the right trade against building a position log — and it is if anything a
better moment for it than turn close was, since the roster then shows where
people stand for the rulings a GM is about to make rather than where the push
left them. It gets worse the further back you go: a **Run now** over a turn from
last week will group people by where they stand today. Re-running an old turn is
a debugging convenience, not a supported way to backfill a chronicle.

## 4. The audit filter

`db/lib/oracleAudit.js`. An **allowlist** of about forty `actionType`s, not a
denylist — a new action is invisible to the Oracle until somebody decides it is
a story fact, which is the safe direction to fail: a missing line reads as a
quiet turn, an invented one reads as a hallucination.

Three shapes:

- **Included** — adjudication outcomes, caving, heals, loots, transfers,
  crafts, consumes, intercepts fired, escorts, name changes, Lifeweb feeding,
  desires, shifts in who holds sway, deaths, arrivals.
- **Collapsed** — tag buys, adds and removes fold into one line per character.
- **Aggregated** — `hunger_resolved` and friends appear once for the whole
  turn, in whichever zone is built first, rather than once per character.

Everything else is dropped, which is most of the volume: the turn engine writes
a row per character per pass, so a hundred players' doings sit under thousands
of machine lines.

**This is not `web/lib/auditNarrative.js`.** That module renders a row into
React *segments* for `AuditFeed`, resolved against a DTO carrying a names map.
Reusing it would mean rebuilding that DTO inside `db/lib` to flatten it back
into a string, and `db/` cannot import from `web/` anyway. A model does not
need prose: `heal_character | Ada Vance -> Bram Holt | tagName: Splint` is
about as short as the English sentence and needs no renderer.

## 5. Names are resolved before they are stored

The model is told to write `{char:Ada Vance}`. What gets **stored** is the
canonical mention grammar, `{char:<id>|<Name>}`
(`db/lib/characterMentions.js`), rewritten by
`oracleInput.js#linkCharacterTokens` before the page is saved.

Resolving at write time rather than render time is what makes an invented name
harmless. A name no character answers to **loses its braces and becomes
ordinary prose**. So a model that hallucinates a person produces a sentence
about a stranger — never a live link to one, and never a link to the wrong one,
which is what matching loosely at render time would eventually do.

The two regexes cannot collide on the way: `characterMentions.js`'s `TOKEN_RE`
matches `[A-Za-z0-9_-]` only, so a name with a space in it is invisible to the
existing mention machinery right up until this function has finished with it.

## 6. The register, and the shape of a page

Encyclopedic. Plain, declarative, past tense, third person, no atmosphere and
no adjectives that carry judgement.

That was asked for, and it is also the best hallucination brake available: a
model told to write plainly and cite nothing but the rows it was handed has
very little room to invent, where one told to write atmospherically **must**
invent to comply.

### What a page is organised as

The register was never the problem. The first prompts said how to *write* and
nothing about how to *organise*, so the model organised a page the only way its
input is organised — one row at a time. What came back was a per-character
ledger: everybody's arrival, everybody's inventory in full, and `PRESENT` read
back at the reader as a list of who stood where. All of which a GM can already
get off the desks.

So each prompt now carries three things the first pair did not: what the page is
**for**, an explicit list of what to **leave out**, and the **headings** to write
under.

- A zone page opens with a sentence or two on the main thing, then `### What is
  going on` — a paragraph per situation, not per person, with the situation
  bolded on first mention — then `### Needs a ruling`, a bullet per unsolved
  move, omitted entirely when there is nothing.
- The front page opens the same way and then runs `### Across the zones`.
- Both are told to write far less when little happened, and never to pad. An
  empty zone still gets one sentence and no headings at all.

Markdown was already safe to ask for: `OracleMarkdown` mounts `MESSAGE_PLUGINS`
with no element restriction, and the desk renders it inside `markdown-content`,
which styles `h1`–`h3`. Nothing needed adding for the headings to land.

**One rule is load-bearing rather than cosmetic.** `splitEditorReply` finds the
threads by matching a line holding the bare word `THREADS`, so the editor prompt
says outright that the line carries no heading marks and no bold. A model that
wrote `### THREADS` would cost the threads rail silently, and two tests in
`db/test/oracle.test.js` hold both halves of that.

The other thing worth stating: "prefer omission to inference" reads as "do not
connect anything" unless you also say the opposite somewhere. Both prompts now
do — *putting two rows you were both given beside each other is not inference,
that is the work* — because comparing is the entire reason the thing exists.

### The prompts live in the database, and one bug meant they always had

Both prompts live in `GameConfig` and are edited from the panel, so the voice
can be tuned without a deploy — the same reasoning as `docs/handbook.md` being
read at runtime. NULL means "use the shipped default" in
`db/lib/oraclePrompts.js`, and a prompt matching that default is stored as NULL
rather than as a copy, so editing the default in a later deploy still reaches
anyone who has pressed Save.

**That comparison could never match.** A `<textarea>` submits its value with
CRLF line endings and every default is written with LF, so pressing Save on a
form nobody had edited pinned a CRLF copy of the default into the row — forever,
and invisibly, since the panel then showed exactly the text it was supposed to.
Both columns were found in that state, which meant production had quietly
stopped reading the shipped prompts altogether and any later edit to them did
nothing at all. `clean()` in `web/app/(app)/gm/dev/oracleActions.js` normalises
the line endings now, which fixes it for every field on that form at once.

The repair for a row already pinned is to clear the column back to NULL. There
is no button for it; it is a one-line update, and a GM who genuinely wants a
custom prompt is unaffected either way.

The editor returns one document: prose, a bare `THREADS` line, then the
threads. Plain rather than JSON on purpose — a small model holds a flat shape
far more reliably than a nested one, and a malformed tail costs the threads
rail rather than the whole front page.

### How long a page may be

`max_tokens` is a ceiling on length, and the prompts above are the target: 150
to 400 words from a correspondent, 120 to 300 plus threads from the editor. The
caps in `oracle.js` sit at roughly three times that — 1800 and 1400 — so an
ordinary page never comes near one.

They are generous because the failure is one-sided. A cap set too high costs
nothing; the model writes the length it was asked for and stops. A cap set too
low cuts the page off mid-sentence, and **that is the one failure that arrives
looking like a success.** A truncated reply is a 200 carrying a well-formed
string of exactly the right shape, so it is stored as an ordinary page, read as
the account of the turn, and handed to the next three turns' writers as fact.
The editor suffers worst, because its `THREADS` block is at the *end* — a front
page cut short loses the threads rail rather than a paragraph.

So `oracleClient.js` reads `finish_reason`, and `length` is an **error**, not a
short page. It is deliberately **not retryable**: the same request truncates the
same way and would only spend the money twice, which is the reasoning
`retryableStatus()` already applies to a 400. At three times the asked length,
hitting a cap means the model ignored its instructions by a wide margin and the
text was worth little anyway — so treat one in the log as a prompt problem, not
a cap problem.

`testConnection` is the exception and passes `allowTruncated`. It budgets
sixteen tokens for one word, so a chatty model runs past it every time, and the
only question that button asks — does the key, the URL and the model name work
— has already been answered by a reply of any length.

**The timeout has to be the looser of the two**, or the cap is unreachable and
every long page dies as a timeout instead of arriving. `DEFAULT_TIMEOUT_MS` is
five minutes, which covers a page at these caps even on a provider generating at
three tokens a second — measured, on the nano-gpt endpoint this runs against.
Seven calls plus a retry each still fits inside the three-hour window, and the
bot's minute tick already refuses to start a second run while one is in flight.

## 7. Memory, and the one correction

Every writer is shown the last `oracleMemoryTurns` turns of pages for its own
scope — three by default. That is what lets the Oracle say somebody has been
circling the gatehouse for three turns, which is the observation a GM cannot
get from a spreadsheet.

It reads `body`, which is **the edited text where a GM has rewritten one**.

That is the entire correction mechanism. **There is no regenerate.** If a page
is wrong, a GM rewrites it, and:

- the rewritten text is what later turns are told;
- `editedAt` is stamped and never cleared, so a later run or a Run now will not
  overwrite it (`oracle.js#isEdited`).

The cost of this design, stated plainly: **a page nobody notices is wrong
carries forward for three turns.** That was accepted deliberately in exchange
for not building a reroll. It makes prompt quality load-bearing in a way a
reroll would not, and it is the first thing to revisit after a few real turns.

## 8. The desk

`/gm/oracle`, a fifth desk beside `turns`, `players` and `audit`, under the
`(desk)` layout that already gates `isGm`. Three columns, the shape
`.desk-body` already provides: zone rail, one page, inspector.

**The right column is `web/app/components/InspectorColumn.js`** — the same
component the other two desks mount, with the same Sheet / Tags / Moves /
Archive / DMs tabs. Nothing about it is rebuilt. Clicking a name in the prose
asks it for the Moves tab through `requestedTab`, exactly the way the
adjudication desk's "Past moves" button does.

A name is a real `<button>`, not a styled span: it is a control, so it has to
be reachable by keyboard and announced as one. It is drawn inline with a dotted
underline rather than as a chip — a synopsis is prose, and a paragraph studded
with pills stops reading like one.

`OracleMarkdown.js` is the third renderer built on `MESSAGE_PLUGINS`, after
`MarkdownContent` (a DM) and `DocumentMarkdown` (a document): same plugins, its
own `richtoken` component. That is the established way to say "this surface
speaks the short token vocabulary and means something different by one of
them".

## 9. The API key

`GameConfig.oracleApiKey`, write-only in the panel: masked after saving, never
returned to a client, replaced rather than edited. An empty box means "leave it
alone", so an ordinary save cannot wipe the credential.

This is a **deliberate departure** from `DISCORD_TOKEN`, which lives in an env
var because it is a credential. The trade is that the provider and model can be
swapped without a deploy. The cost, stated so nobody discovers it later:

- **it is in every `pg_dump` in the backup bucket**, and
- **it must never enter an archive packet** — check `ARCHIVE.md`'s export
  column list before touching either.

`web/app/(app)/gm/dev/oracleActions.js` is the only module that reads it
outside a run, and it is a separate file from `actions.js` for exactly that
reason: "one function writes it, none reads it back to a client" is far easier
to keep true when it lives alone.

## 10. Where the code lives

| File | Role |
|---|---|
| `db/lib/oracle.js` | The run: correspondents, the editor, the memory, the edit guard |
| `db/lib/oracleInput.js` | The ONLY access to game state, and the name resolver |
| `db/lib/oracleAudit.js` | Which audit rows are story facts, and how one is written |
| `db/lib/oraclePrompts.js` | The two default prompts and the editor-reply parser |
| `db/lib/oracleClient.js` | The one outbound call — a timeout and a single retry |
| `db/lib/oracleCutoff.js` | The trigger: when to draft, and the attempt cap |
| `web/app/(desk)/gm/oracle/` | The desk, its markdown renderer, and the edit |
| `web/app/(app)/gm/dev/oracleActions.js` | Settings, the key, Test connection, Run now |
| `web/app/(app)/gm/dev/OracleForm.js` | The panel |
| `db/test/oracle.test.js` | The pure halves — the audit filter above all |

The Threats correspondent (§3a) has no files of its own — it lives inside the
four rows above, reading `db/lib/threats.js` and `db/lib/objectives.js` for who
is seated and how their objectives currently score.

## 11. Things not built, and why

- **No regenerate.** §7.
- **No needs-a-ruling or quiet list.** Both were designed and cut; the
  `DESTRUCTIVE` set in `auditNarrative.js:332` is the ready-made priority seed
  if either is ever wanted.
- **Nothing player-facing.** The zone shards would make a per-zone rumour sheet
  nearly free, but it would need a far more restricted input tier than this
  one.
- **No Discord post and nothing in the archive packet.** Both were considered;
  neither is in v1.
- **No circuit breaker.** `db/lib/discordRest.js` has one because Discord is on
  the hot path of every request the game serves. This runs seven times a day.

## 12. The two switches

They answer different questions, which is why they are two columns and not one.

- **Enable** (`oracleEnabled`) — whether a chronicle is **written** at the Move
  cutoff. Off, the run returns a reason and no rows are created.
- **Playtest** (`oraclePlaytest`) — who may **read** one. On, `/gm/oracle` is
  superadmin-only.

So a turn can be drafted and reviewed before the other gamemasters ever meet a
page, which is the state this ships in: enable it, leave playtest on, read a
few turns, then take playtest off.

Playtest is **enforced in the page**, not merely hidden from the rail. Dropping
the nav item is presentation; the redirect in
`web/app/(desk)/gm/oracle/page.js` is the lock. That is the split
`playPanelEnabled` already uses for `/chat`, and the reason is the one CLAUDE.md
gives for every server action: a hidden control is a hint.
