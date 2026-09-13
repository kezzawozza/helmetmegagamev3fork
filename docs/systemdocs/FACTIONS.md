# Factions

Who belongs to what, who can see what a member is holding, and where the
faction keeps its things.

Factions are **live**, not authored. `docs/roles.yaml` seeds them; after that
players join, leave, secede and rename them, and nothing in this system may be
re-derived from the YAML.

**A player cannot make one.** Which factions exist is Bascinet's to decide, in
`docs/roles.yaml` — a player picks between them, and the point of belonging to
one goes away if walking out and declaring yourself a faction of one is a
button. The Found verb existed until 2026-09-08 and is gone; §3a says what is
left of it.

## 1. Faction is game state, not a Discord role

`Faction` has **no Discord role backing it at all**. It's a pure Bascinet
concept, master-sourced from `docs/roles.yaml` (see `SYNC.md`) and editable by
players on `/faction` and by GMs on `/gm/dev/factions`. Discord's own roles —
used for faction pings and the like — are independent and unmanaged by
Bascinet.

Factions nest: `Faction.parentFactionId` forms a hierarchy.

The nesting is **authored, then live**. `roles.yaml`'s `parent:` seeds it when
a faction row is first created; after that it belongs to the game. A Leader
secedes from `/faction`, and a GM re-parents or detaches on
`/gm/dev/factions` (cycle-guarded there). Re-running `db:sync-roles` does
**not** undo either — see `SYNC.md` "Create-only fields".

## 1a. Match on `slug`, never on `name`

`Faction.slug` is non-null, unique and permanent. `Faction.name` is a Leader's
to change.

Eleven branches across web and bot used to compare
`faction.name === "Unaffiliated"`. One rename would have silently broken
empty-faction handling, delete protection and the same-faction visibility gate
at once. They all go through `db/lib/factionConstants.js` now:

- `UNAFFILIATED_SLUG` — the fixed `"unaffiliated"` id, in code rather than an
  env var for the reason `db/lib/roleIds.js` gives.
- `isUnaffiliated(faction)` — true for the placeholder faction **and** for no
  faction at all, which everywhere in the game are the same thing.
- `inRealFaction(subject)` — the inverse, for the visibility gates in §4a.

`web/lib/factionConstants.js` is the ESM shim. **Never write the string.**

## 2. Leader and Treasurer are booleans, not tags

`Character.isLeader` and `Character.isTreasurer`. They were tags once; they
aren't now, and nothing should reintroduce them as tags.

- **Leader** is set by a GM (`setFactionLeader`, `assignFactionMember`), or
  inherited. A Leader who walks out **or dies**
  hands the seat on: Treasurer first, then longest-standing, and a Catatonic
  member last — crowning somebody who has left Discord leaves the faction as
  stuck as leaving the seat with a corpse. `promoteSuccessor`
  (`faction/actions.js`) and `vacateFactionOffice`
  (`db/lib/characterDeath.js`) are the two halves of the same rule; death has
  to carry it too, or a dead Leader freezes rename, secede and every officer
  verb until a GM intervenes. A faction with nobody left is leaderless, not
  deleted.
- **Treasurer** is set by a GM *or* by the faction's current Leader.

A role can also grant either at creation, via `leader:`/`treasurer:` booleans
in `docs/roles.yaml`.

## 3. Membership moves, in four verbs

`Character.factionId` is still a plain FK — one faction, no history table. What
changed is who may write it. All four live in
`web/app/(app)/faction/actions.js` and return the `{ ok }` shape
(`web/lib/actionResult.js`), because a thrown error reaches a client component
as React #441.

| Verb | Who | What happens |
|---|---|---|
| **Leave** | any member | → Unaffiliated. Officer seats come off, pending handshakes are withdrawn, a Leader's seat is inherited. |
| **Apply** | any character | A PENDING `APPLICATION`. The faction's Leader and Treasurer get a DM. |
| **Invite** | Leader/Treasurer | A PENDING `INVITE`. The named character gets a DM and answers it themselves. |
| **Secede** | Leader | `parentFactionId = null`. Nobody moves. The parent's officers are told. |

Removing somebody is Leave with an officer's finger on it. A Treasurer cannot
remove the Leader they answer to.

**Unaffiliated is not a faction.** You cannot apply to it, be invited into it,
lead it, give it a silo or secede from it. Leaving *is* moving there.

### 3a. `FactionApplication`

One row per live handshake, in whichever direction it was opened, with a
partial unique index keeping one PENDING row per (faction, character) pair.
Settled rows stay as history.

It is deliberately **not** a `Request` (`REQUESTS.md` §2). A Request lands
immediately and is reviewed afterwards, carrying an applied-and-undoable
`effect` snapshot. An application's whole nature is that it sits pending until
somebody answers it, which that model has no status for.

An application is withdrawn automatically when the applicant joins somewhere
else, leaves, is moved by a GM, or dies (`db/lib/characterDeath.js`).

**A faction founded before 2026-09-08 is never pruned.** Nothing mints
`Faction.foundedById` any more, but rows that carry it are still in the live
database, and `db:sync-roles` deletes factions absent from `roles.yaml` — which
a founded one is by nature. So the prune still skips any row with `foundedById`
set, and the Restart Game wipe still deletes them. Both stay until the last of
those rows is gone; neither is dead code while one exists.

## 4. Silos are rooms

`Faction.siloRoomId` points at a `Room`. The room's own `Room.resources` and
`RoomTag` stacks **are** the silo — there is no faction-level balance, and the
`Silo` model removed in 9/2026 is not coming back. That is also why a silo
stores tags: a room always did (`CARRY.md`).

Two factions may share a room. The Church and the Order both sit in the
Cathedral. A silo must be **in the faction's own zone** — deposits are
zone-scoped, so one anywhere else could never be used; both pickers filter to
that zone and `setSiloRoom` re-checks.

**The picker only offers rooms the officer has stood in and can open**
(`db/lib/locationVisits.js#knownRooms`, the map's own rule: `stood`, not
`seen`, and `accessibleRooms` for the door). It used to be a plain `findMany`
over the zone, which read out the name and address of every secret room in the
district — the Inn's Cellar, the Order Chambers, the Depot's Cargo Bay — to
anyone who opened the dropdown. `setSiloRoom` re-checks with the same call, so
the list and the gate cannot drift apart.

The faction's **current** silo is pinned onto that list whether or not the
filter keeps it. An officer who never had the key still has to see where their
faction banks — and the dialog seeds its `<select>` from `Faction.siloRoomId`,
so an option that is not there renders blank and "Set silo" would post `null`
and quietly un-silo the faction. Re-posting the current silo is allowed for the
same reason. This is the same pinning §4a describes for the Transfer dialog.

Two of the ten authored silos — the Storehouse and the Mess Hall — are
**public rooms**, and that is deliberate. Anyone standing there can walk off
with the faction's treasury. A faction that wants a door has to move its silo
behind one.

**Think twice before authoring a door onto a silo**, and never one whose key
means something elsewhere. `web/app/(app)/faction/actions.js#siloKeySlugs`
grants a silo's whole access list on an accepted **INVITE**, no picker — so a
lock on the Mess Hall would have handed every new Cerberon a `cerberus-key`,
which opens all four watchtowers and so the winch of every modular gate
(`MAP.md` §2a). That is the faucet the
comment at `actions.js:561` refuses, arriving through `docs/zones.yaml`
instead of through that file.

- **Deposit** works from anywhere in the silo room's **zone**. You walk your
  loot home to the district, not to the exact door.
- **Withdraw** keeps the ordinary rule: stand in the room, and pass its door
  (`db/lib/roomAccess.js#accessibleRooms`). A silo stays a place somebody has
  to go, and an occupied storeroom is actually occupied.
- **Changing the silo** is a Leader/Treasurer call, and it **moves nothing**.
  The old room keeps whatever is in it. Both confirm dialogs say so, because
  "change silo" reads like "move the goods".

### 4a. A locked silo is a mail slot

Eight of the authored silos are private rooms: the Inn's Cellar, the Order
Chambers, the Cathedral's Pantry, the Sanctuary's Supply Storage, the Ravine
Camp, the Town's Warehouse, the Depot's Cargo Bay and the Factory's Logistics
Room. A member without the key **can still deposit** from across the
zone. They cannot withdraw, and they cannot see what is inside.

This is deliberate: refusing the deposit would make a locked silo useless to
everybody but the key-holder, and a Cerberus handing in loot should not need
the Censor present. Both surfaces say it out loud rather than letting a
player post goods into a hole — the Silo tab's banner, and the Transfer
dialog's footnote when the silo is the destination.

One thing a keyless officer can no longer do is **re-point** the silo at a
locked room: the picker and `setSiloRoom` both ask whether the door opens for
them (§4). You have to be able to open your own treasury. Nothing else here
changes — the eight private silos above are authored in `docs/zones.yaml` and
never go through that picker, a keyless *member* still deposits from across the
zone, and the balance and contents stay withheld exactly as below.

Two consequences worth stating, because both were bugs once:

- The **balance is withheld too**, not just the contents. Otherwise a member
  without the key could watch the treasury rise and fall directly under a
  banner promising they could not see inside.
- The silo appears in the Transfer dialog's destination list **even when the
  locked room is at your own Location**. `rooms` there is access-filtered, so
  a locked silo is in neither list on its own; without the pinned entry a
  keyless member could deposit from across the zone but not from the doorway.

**The Armory and the Baron's Study are not silos**, and should not become
them. They are locked storerooms. A silo that is also the faction's weapon
rack invites a Leader to re-point the silo at it and firewall the faction out
of its own treasury.

### 4b. The wiring

The silo is **not a new party kind** — it resolves as `room:{id}` like any
other stash, so `db/lib/parties.js`, `db/lib/resourceTransfer.js`'s `BALANCE`
map and the `TRANSFER_RESOURCES`/`TRANSFER_TAG` request types are all
untouched, and a GM can still undo a deposit from `/gm/turns`.

> Do **not** revive a `silo:` party kind. One existed before 9/2026, and
> `db/lib/resourceTransfer.js#moveParty` silently no-ops on the kind it no
> longer knows. Reintroducing the name would re-animate dormant pre-9/2026
> rows on Undo.

One function carries the whole rule.
`web/lib/transferReach.js#canReachParty` takes a `direction` (`"from"` /
`"to"`); on `"to"`, a room that is the acting character's own faction's
`siloRoomId` and sits in their current zone is reachable, skipping both the
Location check and `accessibleRooms`. Every other caller leaves `direction`
unset and gets the strict, pre-silo answer.

### 4c. The ledger

The Silo tab carries a **Ledger** under the contents: what went in and out of
the silo room, newest first. It answers the question the tab could not before —
the treasury dropped 80 ⬢ overnight and nobody could say whose hands did it.

**Two conditions, both required: an officer, and the key.** A keyless officer
is already told they cannot see inside (§4a), and a ledger would contradict
that banner; a member with the key is not the faction's bookkeeper. Neither
gets it.

**It is reading, so it reads like reading.** `db/lib/reading.js#readBlock`
gates it exactly as it gates a letter or a noticeboard — the `literate` tag,
plus eyes: blind, blind drunk, nearsighted with your spectacles in a sack,
sun-sensitive outdoors at Dawn. A blocked officer gets the one line every
unreadable thing gets and is never told which of those stopped them. The rows
are withheld **server-side** rather than hidden in the browser, so the gate is
a lock and not a hint.

**A view over `AuditLog`, not a table of its own** — the same call the Depot's
ledger makes. Those rows already snapshot what moved; a second ledger would be
a second thing to keep in step with the first. `web/lib/siloLedger.js` holds
the whole query.

Four things about it that will look like bugs and are not:

- **A rolling seven turns.** Not the whole game. The `createdAt` bound is also
  what keeps this off a full scan of the app's biggest table — `details` has no
  expression index, and the trigram one over `details::text` does not serve an
  equality path filter.
- **Player hands only.** `request_transfer_tag` and `request_transfer_resources`
  and nothing else. `gm_transfer_resources` shares the exact same party shape
  and is deliberately left out, so the ledger will **not** always reconcile
  against the balance: a GM correction moves ⬢ the books never mention. A
  staged effect applied at turn close writes no audit row at all
  (`db/lib/stagedPush.js`), so there is nothing to show for those either.
- **Names are frozen at deposit time**, in `details.by`, written by the
  transfer in `web/app/(app)/character/requestActions.js`. Somebody who
  deposited under a hood stays under it in the books forever. Resolving the
  name when the ledger is drawn would unmask every deposit they ever made the
  moment the mask came off — the reason `ArchiveEntry.concealedAlias` is frozen
  too. `details.from.name` beside it is the real name and the ledger never
  renders it. A row written before this existed has no `by` and prints `—`.
- **One line per act, not per row.** A transfer writes one audit row per tag
  stack plus one for the ⬢, all sharing a `details.moveId`; the ledger groups
  on it. Rows older than `moveId` have none and stand alone.

**A Restart Game wipe takes the ledger with it.** `wipeGameData` deletes every
`AuditLog` row unconditionally — archive or discard, there is no branch. Say so
before anybody relies on these books across a restart.

## 5. Role is same-faction knowledge, not officer authority

Role (`Character.roleTitle`) is visible on both faces of the game, gated on
**sharing a faction** — deliberately not on Leader/Treasurer status.

- `/faction`'s roster carries an unconditional Role column, on both the
  player and GM branches.
- The bot's 🔍 inspect embed adds a `Role` field only when the viewer's own
  ALIVE character shares `factionId` with the subject (and neither is
  Unaffiliated). Absent, never masked. A `/conceal`ed message never reaches
  this branch at all.
- The **Who's here?** button (`zone:who:{zoneId}`, `db/lib/zoneAnchorRow.js`,
  `CHANNELS.md` §4) runs the same test.

Resources works the same way but narrower: a faction's own Leader or
Treasurer (`getMyFactionRole(...).isOfficer`, `db/lib/factionPermissions.js`)
sees what each member is holding — on `/faction`'s roster and on the bot's 🔍
inspect embed. Absent, never masked. `getMyFactionRole` only ever answers for
the viewer's own faction; there is no ancestor walk.

**Obols get the same officer-only column, on `/faction`'s roster only.** An
obol is physically a `Tag` stack rather than a balance column (`DEPOT.md`),
so it is read off the member's `CharacterTag` row for the `obol` slug instead
of a field on `Character` — see `web/lib/factionView.js`. The bot's 🔍 inspect
embed is unchanged; it has never carried per-tag quantities at all.

One more thing the player roster shows that fate never is: a **Catatonic**
chip next to an AFK member's name. Death stays hidden there on purpose, but
Catatonic is a visible tag whose entire job is telling the faction a player is
away (`TAGS.md` §7). Since the guild-leave rework the chip can also mean the
player has **left the server** (`CHARACTERS.md` §5); the roster deliberately
doesn't distinguish the two.

## 6. The surfaces

`/faction` is a tabbed console (`web/app/components/FactionConsole.js`),
copying `DepotConsole.js`: a status strip that never leaves the screen —
name, silo, silo ⬢ and obols, member count, Leader, pending count — and tabs
under it.

| Tab | Who sees it | What it does |
|---|---|---|
| Roster | everyone | The members table of §5. Officers also see each member's Obols beside their Resources, and get Treasurer and Remove. |
| Silo | everyone | Contents (including any obols banked, same withholding rule as the ⬢ figure), the deposit/withdraw rules, and for officers a Change silo picker. |
| Applications | officers | Two lists — people asking to join, invitations sent — each Accept/Decline. |
| Standing | everyone | Parent and subjects, your own pending handshakes, Rename, Secede, Leave. |

A character with **no faction** gets a directory instead: every real faction,
its Leader, its member count, and an Apply button. That replaces a dead end
that read "You aren't assigned to a faction yet." with nothing to do about it.

Accepting somebody into a faction whose silo is locked hands them the key.
Which keys travel depends on **who is answering**, and that is a permission
check, not a preference:

- An officer answering an **application** chooses, with a checkbox under the
  queue. The choice is bounded to slugs already in that room's
  `accessTagSlugs`, so the handshake can't become a general-purpose tag faucet.
- An **invitation** is answered by the invitee, so their `grantTagSlug` is
  ignored outright — honouring it would let anyone holding an invitation post
  themselves a key the officer chose not to give. The silo's keys are granted
  in full instead, because an officer who invited somebody has already decided
  they belong there. Without this an invited Brigand could never get the camp
  tag at all: `ravine-camp` is untradeable and unremovable, so no later
  hand-over exists.

Every hidden tab and disabled button is a hint. The actions re-resolve the
acting character from the session and re-check the officer seat inside their
own transactions.

**GM side.** `/gm/dev/factions` carries rename, re-parent, **set silo**,
delete, a member mover (any character into any faction, either seat, in one
write) and a read-only list of every pending application. It has **no create**
— it never did, and now that the player's Found verb is gone, `docs/roles.yaml`
plus `db:sync-roles` is the only way a new faction comes into existence at all.
If a GM ever needs to raise one mid-game without a sync, that button has to be
built. The
applications are read-only on purpose: answering one would be answering for a
faction's officers. `/faction?factionId=…` is still the per-faction GM detail
view.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/factionConstants.js` | `UNAFFILIATED_SLUG`, `isUnaffiliated`, `inRealFaction` — §1a |
| `db/lib/factionPermissions.js` | `getMyFactionRole`, `getFactionAncestorIds` |
| `web/lib/factionConstants.js` / `web/lib/factionPermissions.js` | ESM shims |
| `web/lib/transferReach.js` | `canReachParty`'s `direction` and the silo rule — §4b |
| `web/app/(app)/faction/page.js` | The server half: loads and shapes, GM detail view |
| `web/app/(app)/faction/actions.js` | Every verb in §3, plus `setSiloRoom` |
| `web/lib/siloLedger.js` | The ledger query and its window — §4c |
| `web/app/components/SiloLedger.js` | The ledger table inside the Silo tab — §4c |
| `web/app/components/FactionConsole.js` | The console — §6 |
| `web/app/(app)/gm/dev/factions/` | The GM toolkit |
| `docs/roles.yaml` | The master: `parent:` and `silo:`, both create-only (`SYNC.md`) |
