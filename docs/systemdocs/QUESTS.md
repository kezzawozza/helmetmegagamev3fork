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

Every other Room can be seeded from the YAML by the one-shot
`db:import-zones` importer. Neither that importer nor the Discord mirror
(`db/lib/discordMirror/`) ever deletes a Room, so a quest's row is safe from
both of them by construction now — there is no prune left to guard against on
that path. The place a quest room's row can still be lost is a superadmin's
hard delete from `/gm/dev/zones`; `db/lib/placeDeletable.js`'s
`hardDeleteBlockers` refuses that outright while `Room.questId` is set,
telling the GM to close the quest first.

Restart Game **does** still delete a quest room's live Discord *thread*
(`db/lib/fullWipe.js#wipeGameMessages` — a quest thread has nowhere to keep
its old messages, unlike an ordinary Room's thread, which is cleared and
reused). That's fine: `finishGameWipe`'s closing Discord-mirror pass rebuilds
it from the DB row, quest rooms included, so the quest survives with a fresh
thread rather than surviving with none.

`Room.questId` still exists for exactly this — telling every other pass a
quest built this room, not the importer. `db/test/quests.test.js` asserts the
guard on `placeDeletable.js` still checks it, because the failure mode is
silent and the first anyone would hear of it is a player asking where the
cave they were standing in went.

Two things follow from a quest room's slug living in no YAML file:

- **It DOES now appear on its Location's anchor post**, unlike under the old
  YAML-driven sync. The mirror builds the anchor's Public Rooms list straight
  from every `Room` row for the Location — quest rooms included, since it
  carries no `questId: null` filter the way the old sync's prune did
  (`db/lib/discordMirror/desired.js`). A quest still announces itself when
  staged; the anchor now also just lists it like any other public room.
- **Deleting its Location still takes it.** `Location.zoneId` and
  `Room.locationId` are both `onDelete: Cascade`, so hard-deleting a zone or
  a Location from `/gm/dev/zones` takes any quest staged there with it —
  `placeDeletable.js` blocks that delete while a live quest room hangs off it,
  same as it blocks deleting the quest room directly.

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

`/gm/dev?s=quests`, tier `gm`. Two tabs — stage the thing, and see every board
at once. Telling people it is there happens on `?s=bulk`, with every other
"say one thing to many" verb (`DEV-PANEL.md` §11b).

- **Quests** — a rail of what is staged, grouped by zone with cave zones first,
  each row showing its Location, status, turns remaining and how many people
  have pressed Interact, over a search box and an All/Open/Closed/Expired
  filter. Beside it, the selected quest: its prose in an
  editable field, its gates, its expiry, and below that every press with what
  the presser said they were trying to do.
- **Noticeboards** — every Location with `noticeboard: true` in its attributes,
  each with its pinned papers, Read, Tear down and Pin. **No new mechanics
  here**: these are `gmReadNotice` / `gmTearNotice` / `gmPostNotice`, the same
  verbs Chat's board dialog and the Discord panel already call. What was
  missing was ever seeing every board at once.
**Advertise**, on a quest's detail pane, is the seam to the bulk section: a
plain `<Link>` to `?s=bulk&verb=say&kind=zone&place=…&text=…`, which arrives
with the quest's zone ticked and a teaser already written. It used to be a
third tab here, with the prefill held in client state — which is why the tabs
were client state rather than `?s=quests&t=…` links, since a link would reload
the panel and drop it. Putting the prefill **in** the URL turns that reason
inside out: a reload now keeps it, and middle-click works. The tabs stay client
state anyway; there is simply no longer a reason either way.

The zone is ticked only when the picker actually offers it, and the **page**
decides that, not the client. **A cave has no `#summary` channel**, so the
usual kind of quest advertises from nowhere: the prefill used to seed the
cave's id anyway, which ticked nothing, read "0 of 5 picked", and still lit up
Say it — which then failed with "Nothing went out." Now it ticks nothing and
names the zone it could not reach.

### 6a. What the panel is built out of

Nothing here is bespoke. The surfaces are `.desk-card`, a heading that sits
beside something is `.section-title`, a row of verbs is `.ops-actions`, a rail
row is `.select-card .panel p-3` with `aria-pressed` like every other picker in
the app, and its second line is `.desk-staged-sub`. Only `.quest-rail-zone` is
still quest-specific. The two gates are `CheckPicker.js`, the shared component this
folder's own `GatePicker.js` became once a fourth call site outside it wanted
one (`DEV-PANEL.md` §11b).

Two cascade traps live here, and both bite silently. `.panel` carries **no
padding** on purpose, so a call site that forgets `p-3`/`p-4` gets a card with
its text against the border — which is what this panel looked like before.
And every `.btn*` is `all: unset`, which clears `margin-left`; since the
stylesheet is unlayered it **beats** Tailwind's `@layer utilities` rather than
losing to it, so `ml-auto` on a button does nothing. Put it on a wrapper.

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
