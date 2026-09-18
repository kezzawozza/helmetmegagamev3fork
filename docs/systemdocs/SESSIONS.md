# Sessions

How a game runs in sittings rather than continuously, and what "the game isn't
in session" actually shuts. The turn engine itself is `TURN-ENGINE.md`; this is
the thing that stops it.

## 1. The two game types

`GameConfig.gameMode`, a knob on `/gm/dev?s=config` under **Turn clock**:

| | |
|---|---|
| **Persistent** | The default, and what every game so far has been. The clock runs continuously; there is no such thing as being out of session. |
| **Sessions** | The clock runs only while a session is open. Between sittings the whole game freezes. |

A session is a **sitting**, not a game. It sits beside the lifecycle in
`LOBBY.md` and never touches `GameState.phase`, so one RUNNING game can hold
four sessions and still be ended by the ordinary End Game button. Four 48-hour
sessions inside one game is the shape this was built for.

Switching modes mid-game is safe and takes effect immediately: Persistent is
simply "always in session", so flipping to it opens the game and flipping away
from it shuts the game unless a session is already open.

## 2. What the state actually is

Four nullable columns on `GameState` — per-game, so Restart Game clears them
for free:

| Column | Means |
|---|---|
| `sessionOpenedAt` | **Non-null IS "in session right now."** One boolean's worth of truth, kept as a timestamp so the panel can say how long it has been running. |
| `sessionClosedAt` | When the last one ended. For the panel; nothing gates on it. |
| `sessionScheduledStartAt` | When the next one opens by itself. Cleared when it does. |
| `sessionScheduledEndAt` | When the open one closes by itself. Cleared when it does. |

**There is deliberately no Session table.** Only the next window is ever needed
— a GM schedules the next sitting, it fires, they schedule the one after. A
queue of them is a calendar nobody asked for, and a calendar has to be edited,
reordered and rendered.

## 3. Opening and closing

Both halves go through `db/lib/session.js#openSession` / `#closeSession`, and
there are exactly two callers of each: the bot's per-minute poll
(`bot/src/lib/sessionClock.js#tickSessionClock`, when a scheduled stamp comes
due) and a superadmin's **Start now** / **Close now** on `/gm/dev?s=turn`. One
way a session changes state, so the row cannot end up in two shapes.

Both claim with a conditional `updateMany`, so the poll and a GM pressing the
button in the same second cannot both open — and only one posts the line.

**Opening restamps the open turn's clock.** `startedAt` moves to now and
`endsAt` to the next Chicago grid boundary after it. A session that opens at
15:00 must not hand players the tail end of a turn that has been sitting frozen
since Tuesday, whose cutoff is already in the past. Snapping to the boundary
rather than running a full length is the same rule a manual advance follows
(`TURN-ENGINE.md` §6a).

**Closing leaves the turn exactly as it is.** Closing a session is not a turn
advance, and a sitting that resumes tomorrow resumes on the same turn; the
reopen is what restamps it.

Each change writes an `AuditLog` row (`session_opened` / `session_closed`, with
`scheduled` saying which caller it was) and posts one `-#` subtext line into
`#turns` through `db/lib/sessionNotice.js`. The line is a courtesy; the row is
the truth, so the post is best-effort and never inside the write.

## 4. What the freeze shuts, and the trap underneath it

Out of session, `db/lib/gameState.js#isClockRunning` is false. That one change
reaches every deadline in the game for free, because everything that derives
one already routes through it — `moveWindow`'s `hasLock`, the turn
announcement, `web/lib/turn.js#getMoveWindow`, `LockChip`.

**But a frozen clock does not shut the game, and this is the sharp edge.**
`moveWindow` sets `hasLock: false` when the clock is frozen, and `locked` is
`hasLock && …` — so a frozen clock reports **`locked: false`**. Freezing
removes the DEADLINE; it says nothing about whether anybody may act. Every one
of the fourteen call sites that used to read `.locked` directly would therefore
have read "not in session" as **wide open**, which is the exact opposite of
what it means.

So the session question is asked **first**, and separately, by the one gate:

```js
// db/lib/turnGate.js
async function movesOpen(db, { now, turn })  // -> { ok, reason, message, turn, window }
```

Order: no open turn, then **not in session**, then the lock window. Its
`gateMessage(reason)` is the only place the refusals are worded:

| reason | text |
|---|---|
| `NO_TURN` | No turn is open. |
| `NOT_IN_SESSION` | **The game isn't in session.** |
| `NOT_RUNNING` | The game isn't running. |
| `PAUSED` | The turn clock is paused. |
| `LOCKED` | Moves are locked for this turn. |

**This gate is new, and its absence was the real bug.** Fourteen sites each
loaded the turn, called `clockFrozen()`, called `moveWindow()`, read `.locked`
and hardcoded their own copy of the refusal — in four different wordings. They
all go through `movesOpen` now: `db/lib/moves.js` (`fileMove`,
`moveIsEditable`), `db/lib/lessons.js` and `db/lib/confession.js` (whose two
near-identical private helpers collapsed into it), the four
`character/actions/*` files, `trinketActions.js`, `web/lib/moveSpend.js`, and
`bot/src/events/interactions/actions.js#moveLockNotice`.

`moveIsEditable` stays pure and takes `inSession` as an option, checked before
everything else for the same reason.

`advanceTurn` has its own refusal, `refused: "NOT_IN_SESSION"`, beside
`NOT_RUNNING` — so no turn ever ticks between sittings, from the poll or from a
GM who forgot the game was shut.

## 5. What a player sees

- The header chip on every page reads **`NOT IN SESSION`** instead of the lock
  countdown (`web/app/components/LockChip.js`).
- The Move button on `/chat` and `/character` is disabled, and the dialog says
  *The game isn't in session.*
- `/move` and the `#turns` buttons refuse with the same sentence.
- The `#turns` announcement replaces its countdown clause with it — out of
  session there is no deadline, and saying so is more use than a time nobody is
  counting down to.

**Only the Move economy is shut.** Travel, Speak and roleplay are not gated on
this, exactly as they are not gated on the Move cutoff (`TURN-ENGINE.md` §6a):
the freeze is about the queue a GM has to adjudicate, not about whether people
may talk to each other.

## 6. The GM surface

`/gm/dev?s=turn`, under Current Turn. Superadmin-only like the rest of that
page (`web/app/(desk)/gm/dev/SessionPanel.js`, actions in
`web/app/(app)/gm/dev/gameActions.js` beside the phase transitions).

- A status line: in session since …, or not in session and when the next one
  opens.
- Two `datetime-local` boxes for the next window, **read as Chicago time** —
  parsing a GM's typed time as the *server's* local time would put a session
  an hour or six out depending on where the container happened to run.
- **Start now** and **Close now**. Closing confirms first, since it shuts the
  game for everybody.

Both boxes may be cleared. A GM taking the schedule off is how a session
becomes hand-driven, so an empty box is an instruction rather than a slip.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/session.js` | `openSession`, `closeSession`, `sessionDue`, `sessionSnapshot` |
| `db/lib/gameState.js` | `inSession`, `isClockRunning`, `frozenReason`, `clockStatus` |
| `db/lib/turnGate.js` | `movesOpen`, `gateMessage` — the chokepoint |
| `db/lib/sessionNotice.js` | The `#turns` line, REST, shared by both faces |
| `bot/src/lib/sessionClock.js` | The per-minute turn and session polls |
| `web/app/(desk)/gm/dev/SessionPanel.js` | The GM panel |
| `web/app/(app)/gm/dev/gameActions.js` | `scheduleSession`, `startSessionNow`, `closeSessionNow` |
| `db/test/session.test.js` | The predicates, the scheduler, and the trap in §4 |
