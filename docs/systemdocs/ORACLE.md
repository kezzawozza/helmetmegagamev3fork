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
the six pages back out of the database. Those numbers predate the two-phase
split below (§3b): they describe one call per zone, not the two smaller calls
each zone now gets. The reasoning they support — run the zones together, not
in a row — still holds, and is now spent twice, once per phase.

What made the calls sequential was real, though: a single mutable Set claiming
the once-a-turn lines as it went, which only means anything while the calls are
in order. That claim is settled before any of them start —
`oracleInput.js#aggregatesSeenByZone` walks the zones in the same order and
hands each one its own Set — so the six inputs are identical to what the
in-order version built. Each zone is attempted whatever its neighbours do, and
a failure comes back as a reason rather than costing the five pages behind it.

**The written pages are the ledger.** Leaving the thunk meant leaving
`step()`'s `Turn.sideEffectSteps` behind, so `runOracle`'s `skipIfComplete` asks
the database instead. What counts as "nothing left to do" is now phase-shaped
— see §3b — but the reason a half-finished **phase one** is redone whole rather
than patched zone by zone hasn't changed: six zone pages are one document, not
six jobs:

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
and three failed attempts stop the retries rather than spending the whole
window on a provider that is down — three per turn **per phase** now, so a
phase one that spent all three of its tries does not stop phase two from even
trying (§3b).

**What is not covered: a turn that closes without a page.** Once the turn ends,
`moveWindow().locked` is false again and nothing revisits it — a bot down for
the whole three hours, or a provider outage that ate its attempts, leaves a
hole. **Run now** on `/gm/dev` is the recovery, and it now defaults to the open
turn for exactly that reason.

## 3. What it is allowed to see

| Block | Source |
|---|---|
| Rulings | delivered `StagedMessage` (a GM's own words to the players) plus `Action.resultMessage` on every SOLVED Move — ground truth, read first |
| Moves | `Action` — description, `moveKind`, `diceRoll` **and** `diceModifier`, `resourceDelta`, `locationId`, review status |
| Tags | `CharacterTag`, filtered to categories `health` and `status` |
| Events | `AuditLog`, filtered — §4 |
| Beats | `ArchiveEntry` of kind DEATH, CHARACTER_CREATED, DESIRE_FULFILLED, LIFEWEB, TRAVEL |
| Chat | a 2,000-token random sample of `ArchiveEntry` kind MESSAGE, only when `oracleIncludeChat` — §3c |

`db/lib/oracleInput.js` is the whole of that access, on purpose: what a
correspondent may see is a question with a right answer, and it should be
answerable by reading one file.

### Rulings come first, and they are not evidence

A GM's own words — a message actually delivered to a player, the Result text
on a Move that has been solved — used to sit seventh of eight sections, filed
next to everything else as one more row to weigh. That was backwards: those
two things are not material a correspondent has to infer a story from, they
are the story, already decided. `rulingsBlock()` (`db/lib/oracleInput.js`)
pulls both into one block, first, headed plainly:

```
RULINGS — GROUND TRUTH
A gamemaster wrote these. They are what happened and what was decided. Every
other section below is evidence about things nobody has decided yet.
```

"Told to the players" holds every delivered `StagedMessage` in scope, PUBLIC
and PRIVATE both — a PRIVATE one went out as a DM with no other trace, and
this is a GM tool, not a player-facing feed, so the privacy argument that
keeps a DM off `/play` and the archive doesn't apply here. "Rulings on
resolved Moves" holds every SOLVED Move that carries a `resultMessage`, one
line for the Move and an indented `ruling:` line under it — a SOLVED Move with
an empty Result box contributes nothing here and is left to speak for itself
in the resolved bucket below. The prompt is told to report what a ruling
*means* happened, never the sentence itself: a GM's narration is often second
person, or written for one player alone, and quoting it verbatim would read
oddly in a document meant for every GM.

### Two tenses, bucketed by when a Move was filed

A page used to carry one `MOVES` section, and a Move that had not been ruled
on yet read exactly like one that had — the model had no way to tell "this
happened" from "this was only just asked for." Every Move in the window is now
bucketed by `Action.turnId` into two headed sections:

```
RESOLVED SINCE LAST PAGE (turn 11) — these happened
DECLARED THIS TURN (turn 12) — intentions, not yet resolved
```

A Move stamped the page's own turn is declared and not yet resolved; a Move
stamped an earlier turn is resolved, whatever `moveReviewStatus` says about it
— **the bucket is decided by the stamp, not by review status**, because a
skipped turn can put more than one earlier turn's worth of rows in one window,
and each row's own stamp is what places it correctly regardless. Every Move
line also carries its own `[turn 12 · 20:14]` stamp for the same reason: the
window holds two turns' rows and the model cannot otherwise tell which is
which. The "resolved" heading names the real turn numbers present in that
bucket, not a flat N−1, so a skipped-turn window reads "turn 9, 10" instead of
guessing at one.

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

## 3b. Two phases

The Oracle used to run once, at the cutoff, one long call per zone reading
everything the window held. It now runs **twice**, and the reason is the shape
of the input, not the shape of the model: most of a page's material — last
turn's resolved rows, the rulings, the chat sample, the memory — is knowable
well before the Moves lock. Only "Declared this turn" and "Needs a ruling"
actually depend on the lock itself.

- **Phase one, five minutes before the cutoff** (`PHASE_ONE_LEAD_MS` in
  `db/lib/oracleCutoff.js`). Drafts the whole page for every zone plus Threats
  — everything above, with no `DECLARED THIS TURN` section, since the Moves
  that section would report have not all been filed yet. Written to both
  `OracleSynopsis.body` and `OracleSynopsis.phaseOneBody`, and `phaseTwoAt` is
  cleared. Kept apart from `body` so a phase-two append lands on top of the
  draft rather than on top of its own previous output.
- **Phase two, at the cutoff itself.** Reloads the turn's material — this time
  the Moves filed in the five minutes since phase one drafted matter — and
  makes one short call per zone plus Threats, reading back only the page phase
  one wrote and this turn's declared Moves (`oracleInput.js#zoneDeclaredBlock`,
  no roster, no chat, no memory: it is all on the page already). The reply is
  appended to `phaseOneBody` and stored as the page's `body`; `phaseTwoAt` is
  stamped. Once every zone and Threats page carries `phaseTwoAt`, the editor
  runs and writes the front page, same as before.

**Phase one is still all seven or none; phase two resumes zone by zone.** The
two hazards that make phase one all-or-nothing haven't gone anywhere — the
editor overwrites whatever zone pages it finds, and the once-a-turn audit
lines are claimed across the whole zone set in a single pass
(`aggregatesSeenByZone`) — so a partial phase-one run is redrafted whole
rather than patched. Phase two carries neither hazard: its input is one zone's
declared Moves and nothing is claimed across zones, so a run that appended to
three zones and then died picks up at the fourth, and `db/lib/oracle.js`'s
`isPhaseOneComplete` / `isPhaseTwoAppended` / `isComplete` ask three
increasingly strict questions about the same rows to tell a resumable phase
two apart from an all-or-nothing phase one. **A run that finished phase one but
not two is self-healing from the other end too**: if phase two starts and
finds phase one incomplete — the bot was down through its whole five-minute
lead — it runs phase one whole first, then continues into its own work.

The attempt cap (§2, three tries) is now spent **per phase**, keyed
`${turnId}:${phase}` in `db/lib/oracleCutoff.js`, so a phase one that used up
its three tries against a flaky provider does not stop phase two from even
attempting its own three. **Run now** and **Regenerate** (§7) both pass
`phases: "both"` — a full redraft, phase one then phase two — which is also
what makes either of them safe to press twice: redoing phase one clears every
page's `phaseTwoAt`, so a second press re-earns phase two rather than
appending "Declared this turn" onto itself a second time.

## 3c. The chat sample

Chat, when `oracleIncludeChat` is on, used to mean the whole zone transcript —
at scale that is the largest single input a correspondent gets, and most of it
is players talking to each other about nothing a GM needs summarised.
`db/lib/oracleChatSample.js` (pure, no Prisma) now takes a fixed 2,000-token
slice per zone instead, spread across the rooms that actually spoke: it groups
the window's `ArchiveEntry` rows by `placeKey`, splits the budget evenly across
the places that have any, and takes lines from each in random order until that
place's share is spent — skipping a line that would overflow the share rather
than truncating it, so a short line further down the shuffle can still fit.
Whatever one place's share leaves unspent is redistributed across places that
still hold unsampled lines, so a quiet room does not waste budget a busy one
could have used. The taken lines are re-sorted back into `sentAt` order before
rendering, so the sample still reads as a conversation rather than a shuffled
one. Token cost is estimated as `characters / 4` — cheap on purpose, within
about 20% for English, and a comfort limit rather than an accounting one: a
tokenizer dependency here would buy nothing. The section is headed plainly
about what it is:

```
CHAT — a random sample, not the whole transcript
## The Bear and Ragged Staff (sampled 14 of 96 lines)
Ada Vance: …
```

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

- Phase one's page opens with a sentence or two on the main thing, then
  `### Since last turn` — a paragraph per situation, not per person, with the
  situation bolded on first mention. It writes no `### Needs a ruling` and no
  `### Declared this turn`: phase one runs before all the Moves are in, so
  neither section exists to write yet (§3b).
- Phase two's short append (below) supplies both of those, under their own
  headings, once the Moves are in.
- The front page opens the same way and then runs `### Across the zones`.
- All three are told to write far less when little happened, and never to
  pad. An empty zone still gets one sentence and no headings at all.

Markdown was already safe to ask for: `OracleMarkdown` mounts `MESSAGE_PLUGINS`
with no element restriction, and the desk renders it inside `markdown-content`,
which styles `h1`–`h3`. Nothing needed adding for the headings to land.

**One rule is load-bearing rather than cosmetic.** `splitEditorReply` finds the
threads by matching a line holding the bare word `THREADS`, so the editor prompt
says outright that the line carries no heading marks and no bold. A model that
wrote `### THREADS` would cost the threads rail silently, and two tests in
`db/test/oracle.test.js` hold both halves of that.

The other thing worth stating: "prefer omission to inference" reads as "do not
connect anything" unless you also say the opposite somewhere. All three
prompts now do — *putting two rows you were both given beside each other is
not inference, that is the work* — because comparing is the entire reason the
thing exists.

### A third prompt, for the short append

`CORRESPONDENT_APPEND_PROMPT` (`db/lib/oraclePrompts.js#appendPrompt`) is what
phase two runs. Its whole input is the page phase one already wrote plus this
turn's declared Moves (`oracleInput.js#zoneDeclaredBlock`), so its job is
narrow and it is told so outright: output *only* the two sections below, no
preamble, no repetition of the page above.

```
### Declared this turn
Two to five short paragraphs or bullets, grouped by situation rather than by
person. Say what somebody has declared they will do and what it runs into —
including anything on the page above that it collides with. …

### Needs a ruling
One bullet per unsolved Move or open question that a gamemaster has to decide
tonight, and a clause on what turns on it. Leave this section out entirely if
there is nothing.
```

Same register, same facts-only rule, same `{char:Full Name}` mention grammar
as the other two — a reader should not be able to tell where phase one's
prose ends and phase two's begins. Configured the same way, too:
`GameConfig.oracleAppendPrompt`, NULL means "use the shipped default", edited
from the same panel as the other two.

### The prompts live in the database, and one bug meant they always had

All three prompts live in `GameConfig` and are edited from the panel, so the
voice can be tuned without a deploy — the same reasoning as `docs/handbook.md`
being read at runtime. NULL means "use the shipped default" in
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

**The same trap now has a second, sharper edge: a pinned prompt does not pick
up a shipped rewrite.** NULL means "use the shipped default," but a row
already holding a copy — CRLF-pinned or genuinely custom — keeps that copy
forever, including through a deploy that changes what the default *says*. The
two-tense paragraph, the phase-two headings and the rest of the rewording in
this release only reaches an install whose `oracleCorrespondentPrompt` and
`oracleEditorPrompt` columns are still NULL. **Check `/gm/dev?s=oracle` after
deploying.** If either textarea shows text nobody wrote by hand this turn, the
column is pinned to an old copy: clear the box and Save (which now stores NULL
and reads the shipped default), or run
`UPDATE "GameConfig" SET "oracleCorrespondentPrompt" = NULL, "oracleEditorPrompt" = NULL;`.
A genuinely custom prompt needs its two-tense paragraph pasted in by hand
instead. `oracleAppendPrompt` ships NULL on every install, so phase two works
with no operator action either way.

The editor returns one document: prose, a bare `THREADS` line, then the
threads. Plain rather than JSON on purpose — a small model holds a flat shape
far more reliably than a nested one, and a malformed tail costs the threads
rail rather than the whole front page.

### How long a page may be

`max_tokens` is a ceiling on length, and the prompts above are the target: 150
to 400 words from a correspondent, 120 to 300 plus threads from the editor,
150 words from phase two's short append. The caps in `oracle.js` sit well
above that — 10,000 for a correspondent or the editor, 600 for the append,
sized to its own much smaller ask — so an ordinary page never comes near one.

They are generous because the failure is one-sided. A cap set too high costs
nothing; the model writes the length it was asked for and stops. A cap set too
low cuts the page off mid-sentence, and **that is the one failure that arrives
looking like a success.** A truncated reply is a 200 carrying a well-formed
string of exactly the right shape, so it is stored as an ordinary page, read as
the account of the turn, and handed to the writers of the turns after it as
fact.
The editor suffers worst, because its `THREADS` block is at the *end* — a front
page cut short loses the threads rail rather than a paragraph.

So `oracleClient.js` reads `finish_reason`, and `length` is an **error**, not a
short page. It is deliberately **not retryable**: the same request truncates the
same way and would only spend the money twice, which is the reasoning
`retryableStatus()` already applies to a 400. Every cap sits well clear of its
prompt's own ask, so hitting one means the model ignored its instructions by a
wide margin and the text was worth little anyway — treat one in the log as a
prompt problem, not a cap problem.

`testConnection` is the exception and passes `allowTruncated`. It budgets
sixteen tokens for one word, so a chatty model runs past it every time, and the
only question that button asks — does the key, the URL and the model name work
— has already been answered by a reply of any length.

**The timeout has to be the looser of the two**, or the cap is unreachable and
every long page dies as a timeout instead of arriving. `DEFAULT_TIMEOUT_MS` is
five minutes, which covers a page at these caps even on a provider generating at
three tokens a second — measured, on the nano-gpt endpoint this runs against.
Fourteen calls (phase one and phase two for six zones plus Threats) plus a
retry each, and one more for the editor, still fits inside the three-hour
window, and the bot's minute tick already refuses to start a second run while
one is in flight.

### One line per model call, in the run log

`db/lib/oracle.js#logCall` writes one line for every model call — each zone's
phase one, each zone's phase-two append, the Threats equivalents of both, and
the editor:

```
Oracle town: build 42ms · request 61304ms · 5123 in / 890 out
```

`build` is the time this codebase spent — the memory query and the block
build — and `request` is the provider's own round trip; splitting them out is
the diagnosis, since the provider is the part staying slow (§2) and the build
time is what would tell you if that ever changed. Tokens are whatever the
provider reported; nano-gpt returns usage, and a provider that does not shows
`?` rather than a guess.

**Where the line prints depends on who ran it.** The cutoff tick runs inside
the bot process, so its lines land in the bot's stdout — the same Railway log
that already carries `Oracle step "x" failed`. **Run now** and **Regenerate**
are both server actions on the web app, so a manual run's lines print to the
web service's stdout instead. Looking in the wrong service's log for a run you
triggered from the panel will find nothing.

## 7. Memory, and Regenerate

Every writer is shown two things regardless of `oracleMemoryTurns`, and one
thing that depends on it.

**The open threads are shown to every writer, always.** They are the
structured half of the memory — the editor's own `[{ name, state }]` list
from the most recent front page that has one, read fresh in
`db/lib/oracle.js#threadsMemory` and carried into every zone, Threats and the
editor's own next call as:

```
OPEN THREADS — carried from the front page
gatehouse watch | Three characters have circled it for two turns; none entered.
```

A thread more than three turns stale, or one nobody has restated since, is
treated as dead and dropped. This is deliberately *not* gated on
`oracleMemoryTurns`: turning the page count down to 0 should not blind a
writer to a thread it has carried for three turns — the thread list is
exactly the kind of memory a page count was never a good proxy for.

**The last `oracleMemoryTurns` pages of prose are shown on top of that** —
the "PREVIOUS PAGES — already reported, do not restate as new" section,
reading `body`, which is **the edited text where a GM has rewritten one**.
The shipped default dropped from three pages to one with this release
(`GameConfig.oracleMemoryTurns @default(1)`), on the reasoning that the open
threads above now carry the multi-turn continuity that used to need three
pages of prose to reconstruct — one page of "what just happened" is plenty on
top of a thread list that already says what has been running for longer.
**Production rows are not rewritten by the migration.** An install with
existing games still reads 3 until somebody sets it to 1 by hand at
`/gm/dev?s=oracle`; the column default only governs a fresh row.

**Regenerate replaces "there is no regenerate".** A page nobody notices is
wrong used to carry forward silently for as many turns as it was cited —
there was no reroll, only a GM rewrite. There now is one: **Regenerate turn**,
next to the turn picker on `/gm/oracle`, superadmin-only (`isSuperadmin`,
checked in the server action regardless of what the button did —
`web/app/(desk)/gm/oracle/actions.js#regenerateTurn`). It redrafts the whole
turn — every page a GM has not rewritten, through both phases, then the front
page — and it does this the same way **Run now** does
(`phases: "both"`, no `skipIfComplete`): a full top-to-bottom redraft is what
makes either of them idempotent to press twice, since redoing phase one
clears every page's `phaseTwoAt` and re-earns phase two rather than appending
its short paragraph a second time. **An edited page is skipped exactly the
way it always was** — `isEdited()` is checked inside `runCorrespondent`, the
phase-two append and `runEditor` themselves, not by Regenerate's own code, so
a GM's rewrite survives a Regenerate over the rest of the turn untouched. The
desk asks for confirmation first (`useConfirm()`), since a press touches every
unedited page in the turn at once.

The gate is a second, narrower one than the desk's own: `/gm/oracle` is
GM-tier and its ordinary Save action is GM-tier too, so Regenerate is a
deliberate exception in the same file — rewriting one page is a GM's
correction, replacing the whole turn is host access, matching Run now's own
`requireDev("super")` on `/gm/dev`.

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
| `db/lib/oracle.js` | The run: correspondents, the editor, both phases, the memory, the edit guard |
| `db/lib/oracleInput.js` | The ONLY access to game state, the rulings block, the tense buckets, and the name resolver |
| `db/lib/oracleChatSample.js` | The budgeted, per-place random sample behind the CHAT section (§3c) |
| `db/lib/oracleAudit.js` | Which audit rows are story facts, and how one is written |
| `db/lib/oraclePrompts.js` | The three default prompts and the editor-reply parser |
| `db/lib/oracleClient.js` | The one outbound call — a timeout and a single retry |
| `db/lib/oracleCutoff.js` | The trigger: when to draft which phase, and the per-phase attempt cap |
| `web/app/(desk)/gm/oracle/` | The desk, its markdown renderer, Save, and Regenerate |
| `web/app/(app)/gm/dev/oracleActions.js` | Settings, the key, Test connection, Run now |
| `web/app/(app)/gm/dev/OracleForm.js` | The panel |
| `db/test/oracle.test.js` | The pure halves — the audit filter above all |
| `db/test/oracleCutoff.test.js` | The phase decision at every point around the lead window and the cutoff |
| `db/test/oracleInput.rulings.test.js` | The rulings block and the two tense buckets |
| `db/test/oracleChatSample.test.js` | The chat sampler's budget, skip-not-truncate rule and seeded determinism |

The Threats correspondent (§3a) has no files of its own — it lives inside the
rows above, reading `db/lib/threats.js` and `db/lib/objectives.js` for who is
seated and how their objectives currently score.

## 11. Things not built, and why

- **No needs-a-ruling or quiet list, as a standalone surface.** A "Needs a
  ruling" section now exists (§6, §3b) — it is phase two's own second heading,
  built from this turn's unsolved Moves — but a *cross-turn* list a GM could
  triage from is still not built; the `DESTRUCTIVE` set in
  `auditNarrative.js:332` is the ready-made priority seed if that is ever
  wanted.
- **Nothing player-facing.** The zone shards would make a per-zone rumour sheet
  nearly free, but it would need a far more restricted input tier than this
  one.
- **No Discord post and nothing in the archive packet.** Both were considered;
  neither is in v1.
- **No circuit breaker.** `db/lib/discordRest.js` has one because Discord is on
  the hot path of every request the game serves. This runs a turn's worth of
  calls once a day — up to fourteen zone/Threats calls across both phases plus
  one editor call, not the single daily call it used to be.

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
