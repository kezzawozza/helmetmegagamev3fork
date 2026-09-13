# Quests

A quest is a piece of content a GM stages at runtime — anywhere on the map,
without a YAML edit and without a deploy.

It appears as a room: a Discord thread and a place on the web, wherever the GM
put it. Usually that is a cave, but nothing stops it being the Square. The room
carries one button, **Interact**, and pressing it spends the presser's Move for
the turn as a Gambit.

That is the whole mechanic, and it is deliberately the whole mechanic. A quest
adds no new economy, no new ration and no new die. It spends the one thing a
character already has to spend, and the GM adjudicates the result on
`/gm/turns` like any other Move.

## 1. Where it lives

| Thing | Where |
|---|---|
| The core | `db/lib/quests.js` — both faces call it |
| The words and the ids | `db/lib/questText.js` — **zero requires, ever** |
| The button | `db/lib/placeAffordances.js`, as the `questInteract` affordance |
| The panel | `/gm/dev?s=quests`, `web/app/(app)/gm/dev/quests/` |
| The panel's verbs | `web/app/(app)/gm/dev/questActions.js` |
| Discord's half | `bot/src/lib/questModal.js` + `interactionCreate.js` |
| The web's half | `QuestInteractDialog` in `web/app/(app)/chat/PlacePanel.js` |
| The clock | `expireQuestsPass`, run beside the noticeboard sweep in `db/index.js` |

`questText.js` has zero requires for the same reason `dmKinds.js` does: the
web's Interact dialog is a client component, and one require of `@lifeweb/db`
from there drags PrismaClient into the browser bundle. `db/test/quests.test.js`
fails the build if a require ever appears in it.

## 2. The one thing that can destroy a live game

**A quest room is the only Room in the game `docs/zones.yaml` does not master.**

Every other Room is authored in the YAML, and `db/lib/syncZones.js`'s pass-4
prune deletes every Room whose slug the YAML does not name — thread and row
together. A quest's slug is in no YAML file, so without a guard the next
`db:sync-zones`, or the next Restart Game (which calls the same function),
would silently delete every live quest.

The guard is `questId: null` on that prune's where-clause. `Room.questId`
exists for exactly this. `db/test/quests.test.js` asserts the clause still
carries it, because the failure mode is silent and the first anyone would hear
of it is a player asking where the cave they were standing in went.

Two things follow from a quest room being outside the sync:

- **It is not listed on its Location's anchor post.** The anchor's room list is
  built from the YAML parse. Adding quests to it would churn the anchor's hash
  every time one is staged or closed; the quest announces itself instead.
- **Deleting its Location still takes it.** `Location.zoneId` and
  `Room.locationId` are both `onDelete: Cascade`, so pruning a zone or a
  location out of the YAML takes any quest staged there with it. That is
  correct: the place stopped existing.

## 3. The gates

Two, and either one makes the room `PRIVATE`:

- **Required tags** — `Quest.accessTagSlugs`, mirrored onto the Room's own
  `accessTagSlugs`, so the existing private-thread machinery does the work.
- **An explicit allowlist** — `Quest.allowedCharacterIds`, a GM naming people
  by hand.

Empty both ways and the room is `PUBLIC`: anybody standing at the Location can
see it.

The allowlist could **not** reuse `RoomGuest`. A guest grant is spent the
moment its holder walks off the Location (`db/lib/roomAccess.js` — "the door
shutting behind them is the point"), and a quest's allowlist has to outlast
that. So `accessibleRooms` gained a fourth argument:

```js
accessibleRooms(rooms, heldSlugs, guestRoomIds, allowedRoomIds)
```

It defaults to an empty Set, so every caller written before quests asks exactly
the question it always asked. `roomAccessKeys` returns `allowedRoomIds`
alongside the other two, which is how the door-deciding call sites get it.

The gates are stored on the Quest **as well as** the Room because closing a
quest deletes its Room, and the record has to outlive the door.

## 4. Interact

The dialogue, on both faces, is one sentence:

> Interacting will be a Gambit. Declare your intentions.

and the refusal, when they have already moved:

> You've already used your move this turn.

Both live in `questText.js`. Neither face gets to type its own copy — a player
who meets this on Discord and on the web must read the same words.

`questInteract` re-runs every gate at **submit**, never at open. A modal
outlives somebody walking out of the cave, and a hidden button is a hint, not a
lock. In order: the quest is still `OPEN`; the character is alive and still
standing at its Location; the door is still theirs; they have not already
filed a Move.

Then it calls `fileMove` (`db/lib/moves.js`) with `moveKind: "GAMBIT"` and
`description` of `<title> — <what they said>`. Everything that makes a Move a
Move — the open turn, the move window, the incapacitation gate, the
`@@unique([characterId, turnId])` backstop — is that function's, not this one's.

Afterwards: a `QuestInteraction` row joining the press to its `Action`, an
`AuditLog` row **with `turnId` set** (`REQUESTS.md` §1a — anything a per-turn
ration could ever count stamps the turn), and one ambient line into the room
saying somebody set to work. The room is never told what they said they were
doing; that is between them and the GM until the push.

## 5. The clock

`Quest.expiresTurn` is an absolute turn number, resolved through
`expiryFrom` — the same helper `NoticePost` uses, not a second date path. Null
means it stands until somebody closes it.

`expireQuestsPass` runs beside the noticeboard sweep in `db/index.js`, and for
the same reason: a GM sets an expiry so they do not have to remember to come
back. An expired quest closes with status `EXPIRED`; a GM closing one by hand
gets `CLOSED`. Nothing reads the difference yet, but "did somebody end this or
did it run out" is exactly what a GM asks a week later.

**Closing deletes the room and keeps the record.** The thread goes, the `Room`
row goes, the `Quest` row and its interactions stay. Only **Delete** — the one
superadmin verb in the panel — takes the record too.

## 6. The panel

`/gm/dev?s=quests`, tier `gm`. Three tabs, because they are one job in three
parts: stage the thing, then tell people it is there.

- **Quests** — a rail of what is staged, grouped by zone with cave zones first,
  each row showing its Location, status, turns remaining and how many people
  have pressed Interact. Beside it, the selected quest: its prose in an
  editable field, its gates, its expiry, and below that every press with what
  the presser said they were trying to do.
- **Noticeboards** — every Location with `noticeboard: true` in its attributes,
  each with its pinned papers, Read, Tear down and Pin. **No new mechanics
  here**: these are `gmReadNotice` / `gmTearNotice` / `gmPostNotice`, the same
  verbs Chat's board dialog and the Discord panel already call. What was
  missing was ever seeing every board at once.
- **Broadcast** — one line into as many zone `#summary` channels as you tick.
  This is `sendAmbientLine` called once per zone, sequentially (never
  `Promise.all` — that is how a bot earns a rate-limit ban).

**Advertise**, on a quest's detail pane, is the seam between them: it switches
to Broadcast with the quest's zone ticked and a teaser already written. That
handoff is why the tabs are client state rather than `?s=quests&t=…` links — a
link would reload the panel and drop the prefill.

Everything is scoped by `GmZoneView`: a GM cannot stage, edit or close a quest
in a zone they are not watching, and `questActions.js` re-checks it because a
`<select>` is a hint, not a lock. No rows means every zone, so nobody is locked
out by never having chosen.

Editing a description **rewrites the starter message in place**. It never
reposts — a repost pings every thread follower, the same reason
`db:sync-info-channel` edits by default. Changing a gate so the room flips
between public and private is the one case that recreates the thread, because
Discord cannot change a thread's kind after it is made; `syncZones.js` works
around the same limit the same way.

## 7. Editing a live quest at 100+ players

Saving a quest re-syncs room membership only for the people whose entitlement
could actually have moved: the union of the old and new allowlists, plus anyone
holding a key either version asked for. A full sweep would be a hundred
recomputes on every keystroke-and-save, and `syncCharacterRoomAccess` is a full
recompute per person.

A `PUBLIC` quest room costs nothing at all — Discord gates a public thread on
its parent channel, which the Location overwrite already handles.
