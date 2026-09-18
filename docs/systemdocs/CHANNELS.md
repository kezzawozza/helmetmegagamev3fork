# Discord Channel Schematic

How Discord channels get their behavior in Bascinet, and how visibility is
controlled. Two independent mechanisms are involved — channel *type/name*
(what the channel is for) and *role* membership (who can see it) — and they're
easy to conflate, so this doc keeps them separate.

Since Bascinet 2 a zone is a category plus a `#summary` channel, and a
character actually **stands** in a Location — one text channel per Location,
with Rooms as threads under it. `MAP.md` is the game side of the same change.

## 1. Tupper / summary opt-in

A channel opts into tupper/summary behavior by being one of a zone's or a
Location's provisioned channels (§2), or a special channel whose registry
entry says `tupper: true` (§7), matched by Discord channel **ID** — there is
no name-based marker, and channel names are otherwise meaningless to this
system.

| Channel | Tupper | Summary |
|---|---|---|
| A zone's `#summary` | yes | yes — adjudication results and staged public declarations post here |
| A Location channel (surface or cave level) | yes | no |
| `#cerberon`, `#27.065` | yes | no — they are tied to no place, so there is no adjudication result to post there |

Two independent implementations check this: `bot/src/lib/channels.js`
(gateway cache, refreshed on ready and every 5 minutes) and
`web/lib/discordGuild.js` (`isSummaryChannel`/`isTupperChannel`, REST-based).
Keep them in sync if the rule changes.

The same refresh builds `channelContexts`: channel id → `{ zoneId, zoneName,
locationId, locationName, channelKind }`, so the proxy can stamp an archive
row with where a message was said without a DB round trip per message.
`channelKind` is one of `summary | location | intercom` or a special channel's
own slug — `cerberon`, `27.065` (a plain string field, not a Prisma enum — see
`ARCHIVE.md`). `intercom` no longer means the channel of that name, which is
gone: it is now what a PA broadcast is filed as in the archive (§7a). `watch`
is the Cerberon net's old name and survives only on rows written before the
rename, which is why the `net:` backfill migration maps it too. A Room thread or a
Conversation reports its parent Location
channel's context and keeps its own name as the scene.

## 2. Zone and Location channel layout

Everything is provisioned by `db/lib/discordMirror/` from the DB rows —
zones/locations/rooms are edited live at `/gm/dev/zones` now, and
`docs/zones.yaml` only ever seeds a fresh game once, additively, via
`npm run db:import-zones -- --apply` (`SYNC.md`). The layout itself is
described **once**, by `db/lib/zoneChannelSpec.js#zoneChannelSpec` (the zone's
category and `#summary`) and `#locationChannelSpec` (one Location's text
channel) — both as create payloads — and both the mirror's create ops and its
every-run reconcile build from them, so the two can never disagree.

**A zone** (Town, Fortress, Forest, Black Hills, Marshes, Underground) is a category and, for a
`SURFACE` zone only, a `#summary` channel:

| Channel | Type | Purpose | Notes |
|---|---|---|---|
| `#summary` | text | Abstracted, big-picture play. Adjudication results and staged public declarations land here. | 300s (5 min) slowmode — the slowmode is what stops it becoming a second moment-to-moment channel. Wiped at Dawn, and it is the one thing the wipe does not take every turn (§8). |

The `CAVE_GROUP` row (Underground) owns the shared category and nothing else —
no `#summary`, no role. Each `CAVE_LEVEL` (Caves, Depths) has no channels of
its own either; its Locations' channels parent straight onto the Underground
category, interleaved across levels in
`level.sortOrder * 10 + location.sortOrder` order, so the three levels' rooms
sit together the way `docs/zones.yaml` lists them rather than clumped by
level.

**A Location** — where a character actually stands — is one text channel,
named after its slug, parented to its zone's category (or the Caves category
for a cave-level Location). Its topic is the Location's `description`
(truncated to Discord's 1024-character cap). Its Rooms (§4) are threads under
it that only the bot may create. It is opened by a per-member overwrite, not a
role (§3).

> **The Location channel is the street's SCENERY, not its speech**
> (Bascinet, 2026-09-06). Standing characters hold no Send at top level: what
> lands there is arrivals, gate crossings, smells, the turret, the noticeboard
> and the turn line. **Talk happens in a Room thread, a Conversation or the
> zone's `#summary`** — all of them a scene somebody chose to be in. Three
> things carry the rule: the `@everyone` **`SendMessages` deny** in
> `locationChannelSpec` (§3) — which the bot posts straight past, as it does for
> arrivals, smells and the turn line, and now for a cave level's public
> declarations, which have no `#summary` to land in (`ADJUDICATION.md` §1) —
> `bot/src/lib/channels.js#isDesignatedTupperChannel` stops treating a
> top-level Location channel as a tupper channel (so a GM typing there is left
> alone rather than reposted under a mask), and `/chat` draws no composer on a
> Location (`CHAT.md` §5b).

**Room threads carry no slowmode.** The 5-minute one is `#summary`'s alone; a
Room is moment-to-moment talk. The mirror still asserts `rate_limit_per_user:
0` on every pass, the same way it re-asserts `archived: false`, because Discord
keeps a thread's rate limit per thread and nothing else would ever clear one a
thread once had. `db/lib/say.js` enforces the same: no wait in a Room or a
Conversation, 300 s in a zone summary.

**Creation adopts by name first; a lot is reconciled every run.** The mirror
only creates a channel/category/role whose id column is null, and only after
checking for a same-named live object to adopt instead (so a crash mid-run
never doubles up). **Renaming a zone or Location in the editor DOES rename the
live channel** now — unlike the old YAML sync, which never touched a name
after creation — behind a confirm dialog, since a typo renames history
pointers too. For everything already provisioned the mirror re-applies
channel **topics** and slowmode, the full set of **permission overwrites**,
category and channel **ordering**, each Location's **Room threads** and
**pinned anchor** (§4), and the cursed role's colour. So `npm run db:mirror --
--apply` (or "Reconcile now" on `/gm/dev`) is the repair path for a zone or
Location whose channels drifted. The mirror never deletes anything — retiring
or hard-deleting a place is done from the editor.

> **Ordering: `parent_id` must not ride along in a bulk position call.**
> Positions are bulk; reparenting is not — Discord rejects the whole request
> with `400` code `40009`, *"Only one channel can have a parent_id modified at a
> time"*. So a channel that drifted out of its category is repaired first with
> its own `PATCH`, and only when the live tree says it is actually misplaced.
> Categories are sorted by zipping YAML order onto the position slots those
> categories already hold, so non-zone categories keep their places.

## 3. Visibility: two access roles, zone and Location

Every channel is hidden from `@everyone` and opened by one of **two**
different mechanisms, and the difference matters.

A **zone role**, `Zone: {Name}` (e.g. `Zone: Town`), is a real Discord role,
created by the sync and held by every living character standing anywhere in
that zone. It opens `#summary`, `#turns` (§3a) and the narrowcast channels
(§7).

A **Location** opens its own channel with a **per-member permission
overwrite** instead — one `ViewChannel` grant per character standing there,
written directly onto the channel. There is no `Location: {Name}` role any
more, and nothing creates one.

> **Why the asymmetry.** There are 5 presence zones with locations in them but
> **56 Locations**, and Discord caps a guild at **250 roles** while capping a
> channel at **1000 permission overwrites**. A role per Location would have
> spent a quarter of the guild's role budget on geography, on top of one
> personal name-token role per living character, and broken outright somewhere
> past a hundred players. Overwrites have no ceiling this game can reach. The
> cost is that an overwrite is invisible in the member list and has no
> equivalent of `db:prune-orphan-roles`, which is why the doctor's occupancy
> check (§6) exists.

Either way a Location's Rooms inherit channel visibility the way any thread
does, and a character always has exactly one zone role while alive. Travel
swaps it as needed (§ below); nothing else grants access.

### 3aa. The fog of war: one overwrite per street you have been in

A character does **not** hold exactly one Location overwrite. They hold one for
the street they stand in, and one for **every street they walked out of this
turn and have not left the zone of** — the fog of war
(`db/lib/vantages.js`). Walking into a Location lights it, and it stays lit
until one of exactly two things puts every light out at once:

- **leaving the zone**, or
- **the turn shifting**.

The difference between the two states is the overwrite's **masks** — the
overwrite itself is the same call either way (`db/lib/zoneChannelSpec.js`):

| | Allow | Deny | What it buys |
|---|---|---|---|
| **Standing** here | `LOCATION_MEMBER_ALLOW` — View + SendMessagesInThreads + AddReactions | nothing | read the street, talk in its Rooms |
| **Watching** it | `LOCATION_VANTAGE_ALLOW` — View | `LOCATION_VANTAGE_DENY` — SendMessages + SendMessagesInThreads + AddReactions | read the street and its public Rooms, and nothing else |

**The deny is load-bearing.** Leaving a bit out of an allow takes nothing
away: the guild's `@everyone` role grants SendMessagesInThreads and
AddReactions, and the Location channel's `@everyone` overwrite denies neither.
The first fog-of-war build wrote the view with no deny, and watchers could
still talk in Room threads and react. So the watcher's own overwrite denies
those bits, and the channel doctor's `location-occupancy` sweep compares the
deny as well as the allow — which is also how the overwrites written before
the fix got repaired. Presence is what gives you a voice. A private Room
whose thread the character is a member of reappears under a vantage for the
same reason a public one does — the parent channel is viewable again — and is
mute for the same reason.

Only a **walk** lights anything. `applyLocationMoveSideEffects` takes a
`walked` flag that defaults to false, and only the two travel callers pass it;
a GM teleport, a rite, a threat spawn, a staged "Relocate to", Xom and a first
placement all leave nothing behind, because the character never walked out of
anywhere.

Where a character **stands** is still `Character.locationId` and is never a
`Vantage` row. That is what makes the turn wipe a bare `deleteMany` with
nothing to put back.

Each row carries two **snapshot columns** — the turn it was lit in and the zone
it sits in — and every reader filters on both. A wipe that fails to run
therefore leaves rows that already read as dark to `placesFor` and to the
doctor, rather than a leak; the doctor takes their overwrites off on its next
pass (§6). The wipes are the belt, the filter is the braces.

The web says the same thing from the same rows: `placesFor` lists each watched
Location and its rooms with `canSpeak: false` and draws them under
**Elsewhere** in Chat's left column (`CHAT.md` §3). The composer there reads
*"You aren't in this location."*

One consequence worth knowing: a Location anchor's buttons are pressed **in the
channel**, and the channel is now open to more people than stand in it. Who's
here?, Examine, Secret rooms? and Converse each check that the presser actually
stands there and refuse with that same sentence otherwise
(`bot/src/events/interactions/scene.js`). The noticeboard and a Quest's
Interact already did.

> **`managedOverwriteIds()` must never learn to delete a member target.**
> `db/lib/syncZones.js` reconciles each channel's overwrites against a spec,
> and that function is the allowlist of targets it is permitted to DELETE. It
> contains only role ids. A wildcard there — or a member id finding its way
> into it — would evict every player from every Location on the next sync.

> **A channel does not reliably inherit its category.** Discord "syncs" a
> channel to its category by *copying* the overwrites at creation; the two
> drift apart afterwards, and a later change to the category never reaches a
> channel that has come unsynced. Relying on inheritance is what once left
> every channel except the one that named `@everyone` itself world-visible
> after a clean re-sync. Every target now states its own privacy in full, and
> the category keeps a copy as defense-in-depth.

The overwrites every target carries (`baseOverwrites`):

- **`@everyone` denied `ViewChannel` + `AttachFiles`.** The `ViewChannel` half
  is the entire privacy mechanism; everything else is an allow layered back on
  top of it.
- **The zone's GM role** (`Zone.gmRoleId`, "GM: Town"), allowed explicitly on
  every channel, not just the category — Discord resolves channel overwrites
  after category ones, and a role with no entry of its own falls through to
  whatever `@everyone` says there.

  **Not the global Gamemaster role.** A GM used to hold a blanket grant on all
  56 Location channels, which is more sidebar than anyone can read; now they
  hold the `GM: <Zone>` role for the zones they picked, and that is what opens
  these (`GAMEMASTERS.md` §6). The global roles keep their blanket grant on
  everything that is not a zone — `#turns`, the narrowcast channels, the report
  channel.
- **The spectator seat** (`db/lib/spectatorAccess.js`) — read-only, and
  **phase-gated**: the overwrite is always present, but it allows View only
  while `GameState.phase` is RUNNING or ENDED and denies it in CLOSED and
  LOBBY, so pre-launch testing pings no spectator (`LOBBY.md` §1). Every
  spec producer takes the flag from its caller (`spectatorsVisibleNow`);
  every phase transition runs `syncSpectatorAccess`, which PUTs only where
  the live bits differ; and the doctor's **cheap** scope carries a
  `spectator-visibility` check as the backstop.
- **The ghost seat** (`db/lib/ghostAccess.js`) — see §5.

On top of that: the zone role gets `ViewChannel` + `SendMessages` +
`AddReactions` on `#summary`. Each character standing in a Location gets
`ViewChannel` + `SendMessagesInThreads` + `AddReactions` on that channel, as a
member overwrite (`LOCATION_MEMBER_ALLOW` in `db/lib/zoneChannelSpec.js`) —
**no `SendMessages`**, because the Location channel is scenery rather than
speech (§2); thread talk covers both a public and a private Room, which is
where the speech went. Note that this grant is **not** part of
`locationChannelSpec`: the spec is the channel's standing shape, and who is
standing there changes every turn.

Send came off that bit set on 2026-09-06, and an overwrite already written
does not update itself. The doctor's `location-occupancy` check therefore
compares the **allow bits**, not merely whether a target is present, so one
`npm run db:doctor -- --apply` rewrites every existing occupant (§6).

> **Taking a bit out of an allow denies nothing.** Dropping `SendMessages` from
> `LOCATION_MEMBER_ALLOW` was, on its own, decorative: Discord resolves a
> channel from the guild-level `@everyone` permissions first, and `@everyone`
> carries Send Messages guild-wide. So for two days the street was quiet on the
> web and still open on Discord — and worse than open, because
> `isDesignatedTupperChannel` had already stopped watching, so anything typed
> there posted under the player's real Discord name, unproxied and unarchived.
> The deny that carries the rule lives on `@everyone` in `locationChannelSpec`,
> the same shape `#turns`, the spectator seat and the ghost seat all use. The
> allow mask says what an occupant gains over `@everyone`; only a deny takes
> something away.

**Send, Room creation and Conversation creation are all denied to `@everyone`
on every Location channel.** `SEND_MESSAGES`, `CREATE_PUBLIC_THREADS` and
`CREATE_PRIVATE_THREADS` are denied, while `SEND_MESSAGES_IN_THREADS` stays
open — a separate bit, so the quiet street does not reach into its rooms — so players can talk
inside any thread they can see but can never open one themselves. The bot
alone creates a Room (the sync, from `docs/zones.yaml`) or a Conversation (the
Converse button, §4). Players hold no create permission anywhere, which is
what keeps `PlayerThread` a complete record of every Conversation that exists.

**Per-member overwrites on zone and Location channels are gone.** The old
model added a `ViewChannel` overwrite keyed on `Character.discordUserId` to
every channel of a Location and removed it from the old one. Two role calls
now replace many overwrite writes per hop, and the channel doctor treats *any*
member overwrite on a zone or Location channel as a stray to be deleted (§6).
The only surviving member overwrites in the game are the special channels'
grants (§7) and each private Room's thread membership (§4).

Every `ALIVE` character still has a **personal Discord role**
(`Character.discordRoleId`), titled after their **bare** name — first + last via
`formatBareName`, never the honorific or the granted title — and coloured
deterministically by `db/lib/roleColor.js#hashNameToColor` from that same bare
string. It is **assigned to nobody and grants nothing**: putting the player in
it would list their account under the character's name and deanonymize the
game. It exists to be `@`-mentioned (`PROXYING.md` §6) and to be the option in
the `/add` and `/remove` pickers.

### 3a. `#turns`: seen by anyone with a character

`#turns` sits outside the zone spec — nothing in the repo creates it, and both
its writers find it by exact name (`isTurnsChannel` in
`db/lib/turnsChannelAccess.js`). Its access is still built from the zone roles,
in `db/lib/turnsChannelAccess.js#syncTurnsChannelAccess`:

- `@everyone` denied `ViewChannel` + `SendMessages` + `AttachFiles`. The
  channel stays bot-only; the console's Move/Travel buttons are
  components, not messages, so nobody needs send.
- **every** zone role allowed `ViewChannel`. This is the gate. A living
  character holds exactly one zone role from the moment `createCharacter` runs,
  and travel only swaps it — so "has a character" and "holds some zone role"
  are the same set, and the channel appears the instant a character exists.
- the GM role, the spectator seat and the ghost seat, each via the helper that
  already exists for it.

It used to manage nothing but `SendMessages`, so *visibility* was whatever had
been clicked by hand in Discord — a player finished creation and still saw
nothing until a GM added an override. That list above is now the **complete**
description of who may see the channel, so the sync deletes every overwrite it
doesn't name: the per-member grants GMs added one player at a time, and the
**Player** role's view grant, which said "approved to make a character", not
"has one". A bot's own overwrite is the single exception, left alone so a guild
whose bot isn't an administrator can't lock itself out of the channel it posts
to.

Re-applied on every bot ready (`bot/src/lib/turnsConsole.js`), at the end of
every full-scope mirror run (a repaired zone role has a **new** id, and the old
grant would point at a dead one), and by the channel doctor's full scope.

### One function does the Discord half of every location change

`db/lib/locationTravel.js#performLocationMove` does no Discord work — it's the
database half only (validation, the cooldown or the Move it files, dragging;
`MAP.md` §4). Every caller, whichever face it runs on, hands the result to the
same function for the Discord half:

`db/lib/locationMove.js#applyLocationMoveSideEffects(prisma, entry)` — grants
the member overwrite on the destination channel before deleting the one on the
origin, announces the crossing if the edge is a gate (`MAP.md` §2a), and (only
if the zone changed too) swaps the zone role and reconciles narrowcast access;
then
resyncs private-Room membership for wherever the character now stands
(`db/lib/roomAccess.js#syncCharacterRoomAccess`) and replays any standing
Conversation invites there (`db/lib/threadInvites.js#applyPendingInvites`).
Every call inside it is individually catch-logged, never thrown — the channel
doctor is the safety net for whatever one call misses.

It's pure REST, so the Travel button on `#turns`, `/location`, the web's
writers (creation, GM raw edit, GM Bulk Move) and the staged
"Relocate to" applied at the turn push all call it after their own DB write
has committed. Grant-before-revoke throughout, deliberately: an interrupted
swap leaves the player seeing two Locations for a moment (harmless,
self-healing) rather than none (a lockout a player can't diagnose).

Any new writer of `Character.locationId` must call
`applyLocationMoveSideEffects`. A raw Prisma write alone leaves the old
overwrite standing and the new one missing, and the player either sees the
wrong place or none.

### Death and departure

`db/lib/accessSweep.js#revokeAllCharacterAccess` strips every zone role (a
removal of a role the member doesn't hold is a no-op, so this costs less than
working out which ones they held from possibly-stale state) and sweeps their
member overwrites off every Location channel, zone channel and special
channel. Its callers are `killCharacter`, `guildMemberRemove` and
`wipeGameData`; any new path that ends a character must call it too.

**That overwrite sweep is load-bearing now, not tidy-up.** A Location grants
sight by overwrite, and an overwrite has no equivalent of the role strip
`db:prune-orphan-roles` performs — so this is the only thing that stops a
corpse from going on reading the room it died in. `allAccessChannelIds()`
already enumerates every Location channel, which is why the shape did not have
to change when the roles went away.

`revokeAccessForCharacters` in the same file is the bulk form for Restart Game:
one paginated member-list read, then one removal per (member × zone role
actually held), plus a channel-major overwrite sweep — read each channel once,
delete only what's actually on it. That's what keeps a full-roster wipe at
hundreds of calls instead of tens of thousands. Both return counts and failure
lists rather than nothing, because a revoke that silently fails leaves a
departed player still reading rooms.

### A non-mirrored character holds no Discord access at all

`Character.discordMirrored` — the **Play on Discord too** switch on the Bio
card (`CHAT.md` §6), default **off** — is the one state in which a living
character standing in a Location has none of the grants this section
describes. This used to be `Character.webOnly`, an opt-**out** default false;
it's `discordMirrored`, an opt-**in** default false, now — same polarity of
consequence, opposite polarity of the flag, so a character that never touches
the switch is web-only by default. No member overwrite on the Location
channel, no zone role (so no `#summary` and no `#turns`, whose view grants
ride the zone roles), no narrowcast overwrite, and no membership in any Room
or Conversation thread — **and no turn-ping role**, because the turn ping is a
`<@&…>` inside the `#turns` console and `#turns` is one of the channels the
line above has just closed to them. Keeping it meant a ping twice a day about
a message they could not open, and the console is replaced every turn, so it
was gone by the time they looked. Their DMs are untouched.

Since most characters now default to this state, Discord itself reads emptier
than the game actually is — a GM reading only `#turns` and the zone summaries
sees far fewer players than are really acting. `GAMEMASTERS.md` covers where a
GM should actually be looking (`/chat`, `/gm/turns`) instead.

The fiction does not change: they still stand where they stand, they still show
in Who's here?, they still hold their keys and their guest rows, and they are
still a member of every Conversation they were in — the `PlayerThreadMember`
row is the truth and Discord's thread list is only its projection (`§4`,
`CHAT.md` §2a). What changes is that the projection is empty.

**Every re-materialiser checks the flag, or the next pass puts them back.**
That is the whole maintenance burden of the feature, and it is not optional:
the mover (`db/lib/locationMove.js#applyLocationMoveSideEffects` skips its
Discord half), the mirror and channel doctor (`location-occupancy`, the zone
`role-membership`, `room-membership` and `narrowcast` should-have sets all
exclude them), `db/lib/roomAccess.js#syncCharacterRoomAccess` (entitlement is
empty, so the diff evicts rather than adds), the invite replay
(`db/lib/threadInvites.js` writes the membership row and skips the Discord add,
keeping the invite for the day the switch comes on), the three Conversation
thread-adds (`/add`, a mention, Converse — the row yes, the account no), the
guest add in a private Room, and the rejoin restore in
`bot/src/lib/locationTravel.js#restoreStandingRoles`. Miss one and an overnight mirror or doctor pass quietly un-hides
somebody who believes they are hidden.

## 4. Anchors, rooms and conversations

### The pinned anchor

Every Location channel carries one pinned anchor message, hash-reconciled on
`Location.anchorHash` (body + its button row) so a mirror run with nothing
changed makes no Discord writes at all (`db/lib/syncZones.js#syncLocationAnchor`,
the successor to the old `zoneAnchorRow.js`). A body change is edited in place; a
message a GM deleted by hand 404s and gets reposted. Its shape
(`buildAnchorBody`, `db/lib/locationAnchorRow.js`):

```
**Square**
-# An open clearing — …

**Public Rooms**: <#t1> | <#t2>
[Travel] [Who's here?] [Secret rooms?] [Examine] [Converse]
[Noticeboard]
```

Private Rooms are deliberately absent from the index — **Secret rooms?** is
what surfaces those. Four of the buttons (`loc:who:{id}`, `loc:secret:{id}`,
`loc:examine:{id}`, `loc:converse:{id}`) are keyed on the Location's id and
routed by prefix; **Noticeboard** appears only where `docs/zones.yaml`
declared one.

**Travel is the odd one and was added 2026-09-06.** Its id is the bare
`loc:open`, with no Location in it, because `handleTravelOpen` reads the
mover's own `locationId` rather than the channel's — which is what lets the
identical button serve the #turns console, every anchor, and `/travel`. It
carries **no emoji** here, unlike the console's 🗺️: on an anchor it sits in a
row of plain-text buttons and the one emoji only made it shout.

Adding it took the boarded Locations to six buttons, past Discord's five-per-
row cap, so `locationAnchorRows()` now returns the buttons chunked into rows
rather than one hand-placed row. The next button to arrive needs no thought.
Rooms are synced **before** the anchor, since the anchor body embeds their
thread mentions.

### Rooms: public and private

A Room is a thread under its Location's channel, authored in `docs/zones.yaml`
(`SYNC.md`) and owned end-to-end by the sync — **players cannot create one.**

**One exception, and only one: a quest room.** A GM stages a Quest at runtime
from `/gm/dev?s=quests` and it mints a Room whose slug is in no YAML file
(`QUESTS.md`). Nothing that prunes Rooms today is allowed to delete it —
`db:prune-stale-channels` is the one script that still deletes Discord
structure at all, and its DB-row query carries `questId: null` for exactly
this reason. Anything that prunes Rooms must carry the same guard. Players
still cannot create one; a GM can.

**A room's id is always `<location-stem>-<room>`** — `keep-throne-room`,
`inn-cellar`, `customs-watchtower`. Zones, locations and rooms share one slug
namespace, so without the stem the obvious id is often already gone: there are
four rooms called "Watchtower" and two called "Road". Display names are
unaffected. Four room slugs are also hardcoded in JS and must move with the
YAML — `INTERCOM_ROOM_SLUG` (`db/lib/intercom.js`), `BELL_ROOM_SLUG`
(`db/lib/bell.js`), `CENSOR_OFFICE_ROOM_SLUG` and `WATCHTOWER_ROOM_SLUGS`
(`db/lib/roomStarterRow.js`) — as must every `silo:` in `docs/roles.yaml`,
which `db/lib/syncRoles.js` resolves by slug and *throws* on a miss.

**The id (slug) is immutable once set** — it's `placeKey`, archive keys,
`roles.yaml`/`labordrops.yaml`/threat references — so the old "a changed id is
a new room" trap is gone with the sync that made it: the `/gm/dev/zones`
editor doesn't let a slug be edited at all, only the display `name`. A rename
there edits `name` and *does* rename the live Discord thread, behind a confirm
dialog. Public rooms are ordinary public threads; private rooms are
non-invitable private threads (`Room.accessTagSlugs` non-empty makes a room
PRIVATE), never locked, so nothing here stops the roleplay inside once you're
in. Both auto-archive after 10080 minutes (a week) idle, and the mirror
re-asserts `archived: false` on every run — so a Room that idled into the
archive comes back at the next `npm run db:mirror -- --apply` (or the next
"Reconcile now"), not seven days of dead air.

Each Room's first message is its body (name + description) plus a button,
**Storage** (`db/lib/roomStarterRow.js`, `room:storage:{id}`), which prints
what is lying in the room's stash — every Room holds unlimited ⬢ and tags,
moved through the web's Transfer and surviving the wipe since they live
in the database (`CARRY.md` §5). The message is reconciled by content hash on
`Room.postHash` (body + button row); a changed body is rewritten **in place**
(clear every reply but the starter, edit it, re-post overflow). Because a
thread's starter has its own message id, distinct from the thread id itself —
unlike a forum post, where they're the same — `Room.starterMessageId` is
tracked separately, and it's what the wipe clears down to (§8) rather
than the thread id.

**Private-room membership is pull-based, not pushed from a tag writer.**
`db/lib/roomAccess.js#syncCharacterRoomAccess(prisma, character)` recomputes,
for every PRIVATE room, whether the character should be a thread member: any
of `Room.accessTagSlugs` held — **or** a `RoomGuest` row (§4a) — **and**
standing in that Room's Location adds them; anything else removes them. It's called from both travel side-effect
paths (§3) and from every existing call site that already calls
`syncCharacterNarrowcastAccess` when tags, location or life status change —
`/heal`, a character joining the guild, and the ~15 web request/GM-action
writers that grant, revoke, consume, transfer, heal, loot, bind, free or harm
tags. A miss is logged and left for the doctor's `room-membership` check (§6)
to catch and repair. Hold the Baron's Key and you're admitted to The Charon
the moment you next arrive or the key changes hands — there is no separate
"open the door" action.

### 4a. Room guests: `/add` in a private Room

A key is not the only way in. Somebody already inside a private Room can
`/add` a character standing in the same Location, which writes a **`RoomGuest`**
row and lets them in at once — the Baron waving a visitor into his office.

- **Who may work the door:** anyone already in the room, or a GM. Membership
  is pulled from standing there with a key or a guest row, so "in the room" is
  already exactly the set the fiction wants; there is no separate owner.
- **The target must be standing in the Location.** The grant is spent on
  leaving (below), so inviting somebody across the map would hand them a row
  that dies before they ever saw the door.
- **The grant is spent when they leave.** `syncCharacterRoomAccess` deletes
  every `RoomGuest` row whose Room is not where the character now stands, and
  every mover already calls it with the destination — so walking out of the
  Keep is what shuts the door behind you. A guest who comes back needs a fresh
  `/add`. This is the one way room access differs from a key, which readmits
  you forever.
- **`/remove` refuses a key-holder**, and says so: *"Their key admits them.
  Take the key."* Removing them would undo itself on their next arrival or tag
  change, so the honest answer is that the key is the thing to take.
- **A guest gets full reach**, not just the thread: the stash, the Transfer
  dialog, the Storage button, workshop and surgical equipment standing in the
  room, and corpse handling. That falls out of `accessibleRooms()` being the
  one predicate behind all of them (below) — being in the room is being in the
  room.
- **The target is DM'd** where they were let in, plus a link. Discord's own
  "added to a thread" notice is easy to miss and says nothing about where. The
  Conversation `/add` sends the same DM, so the two feel alike.
- Death and departure spend every grant
  (`accessSweep.js#revokeAllCharacterAccess`).

> **`accessibleRooms(rooms, heldSlugs, guestRoomIds)` is the one door.** It
> answers for the Storage button, the Transfer dialog, `/character`'s room
> list, **Secret rooms?**, the Converse picker, corpse placement, equipment
> reach and the doctor's `room-membership` check. Any new reader loads both
> halves with `roomAccessKeys(prisma, characterId)` — passing keys but not
> guests is how a guest ends up standing in a room the Transfer dialog says
> they cannot touch.

### Conversations

A **Conversation** is the one thread a player can open: a private thread
linked to a Room, created from the anchor's **Converse** button and tracked as
a `PlayerThread` row (`locationId`, optional `roomId` — the room the
whispering is heard in, §below).

**Membership is a database row now, and Discord's thread member list is its
projection.** `PlayerThreadMember (playerThreadId, characterId)` is written
first by all four writers — Converse (the creator), `/add`, a mention into the
conversation, and the invite replay — and `/remove` deletes it; the Discord
add follows. All four go through `db/lib/conversations.js`, so there is one
answer to "who is in this". The reason is `CHAT.md` §2a: the web feed could
not read a Discord member list without a REST call per conversation, and a
player whose account is out of the channels entirely (the coming "web only"
switch) could not be in a thread at all. The row cascades with its
`PlayerThread`, so the wipe needs no new step.

`/add` and `/remove` work here too, and the
handler tells the two apart by the channel: a `PlayerThread` row means a
Conversation, a `Room` row means §4a. A Conversation's `/add` is the looser of
the two — it takes a character wherever they stand, and a standing
`PlayerThreadInvite` is replayed the moment its target next arrives at the
Conversation's `locationId`
(`db/lib/threadInvites.js#applyPendingInvites`) — Discord refuses to add a
member who can't see the parent channel, so the invite waits for them to be
able to.

Leaving a Location does **not** drop you from a Conversation you're already in
— you stay a member, exactly as before. There is no more per-message
`/conceal` prefix, no `persistent` flag, no forum tags, and no inactivity
expiry on a Conversation: every one of them is wiped clean at the end of the
turn (§8), so nothing needs to age out on its own.

**The whisper poll.** Every 15 minutes, each Conversation linked to a Room
posts one line into that Room naming who's been talking in it — "You hear a young man
and an old woman whispering." — built from `ArchiveEntry` rows in the last
15 minutes (up to 5 named, then "and others"), aliased the same way a
concealed message is, so the Room never learns who's actually inside.

Under that line the Room also hears **fragments of what was said**, on one
`»` line: a few contiguous runs of 4–10 words pulled out of the window at
random and muffled at 65% by the same `db/lib/muffle.js` the shout uses (heavier
than any shout now — the shout's last ring with words loses 40%), joined
by an ellipsis. Punctuation is ignored on purpose — a fragment that starts and
ends mid-thought reads as something overheard, where a whole sentence would
read as something quoted.

Three caps keep that honest, and none of them is cosmetic. A fragment is bounded
in **characters** as well as words, because a pasted URL or blob contains no
whitespace, counts as one word, and would otherwise come back whole — and at a
few thousand characters Discord refuses the message outright, which would cost
the room the name line too (`postMessage` does not chunk). A message that is a
single long token gets a **character window** instead of a word window, so
Chinese, Japanese and Thai — none of which space their words — are sampled like
everything else rather than leaked entire. And no one message counts for more
than `MESSAGE_WEIGHT_CAP` words when the pool is weighed, so pasting a wall of
text is not a way to drown your own conversation or to inflate the ladder. How many fragments scales on the words said in the
window: 1 below 80, then 2, 3, 4, 5 and 6 at 80, 200, 450, 900 and 1800. The
thresholds are stretched because a busy Conversation clears a few hundred words
in fifteen minutes, so the top of the ladder has to be hard to reach.

**Subtle** (`db/lib/whisperLeak.js`, `bot/src/lib/whisperPoll.js`) keeps a
character out of the name line *and* out of the fragment pool — both halves, or
the tag would only half work. An all-Subtle Conversation still posts nothing at
all. A speaker whose `Character` row does not load is treated as Subtle rather
than as audible: a privacy feature fails **shut**, and a missing name line is
the cheaper mistake. The post also passes `allowedMentions: { parse: [] }`,
because the line now carries player text and "@everyone" is a plain word no
mention-stripper catches. The leak is rolled once per tick and handed to both the Discord post and
Chat's scene row, and so is a faraway shout's static (`db/lib/shout.js#
renderShout`): re-rolling per face would blank or pick different letters on
each, which is two leaks rather than one thing heard twice — a reader who
sees both could fill in the gaps.

**Who's here?** names the characters standing in the Location: the concealed
ones only as what a stranger could tell at a glance, and anyone wearing a
forced identity (`Tag.forcedName`, `PROXYING.md` §5) under that name with no
Role.

### What's gone

Persistence, the three forum tags, `/persistent`, quest posts
(`bot/src/lib/questPost.js`) and inactivity expiry (`threadExpiryPass.js`) are
all retired — a Conversation has no long-lived form any more, and a
GM-made off-catalog thread is simply adopted by the wipe the same way an
ordinary unknown thread is (§8). The web `/map` panel is gone too (`MAP.md`).

## 5. The ghost seat, and Deadchat

**There is no Ghost role.** It was deleted on 2026-09-15, not retired. Discord
prints a member's roles on their profile card, so a role named "Ghost" told
anyone who clicked a player's name that they were dead — an out-of-character
leak that pinning the colour to `0` never touched, because the colour only ever
governed the member list. Do not add it back.

Two things replaced it, and they answer different questions.

**Who is a ghost** is `db/lib/ghost.js`: a body, and no living character. It
reads no `buriedAt`, so burial and engraving do not end the seat — only living
again does. That is the split from `db/lib/curse.js`, which still owns the
re-roll penalty and still turns on `buriedAt`. CLAUDE.md's **Death, ghosts and
Deadchat** section has the table; the short version is that one predicate doing
both jobs meant burying a body evicted that player from the game.

**What a ghost sees** is now web-only (`db/lib/feedAccess.js#ghostPlacesFor`,
`CHAT.md` §5a): every zone summary, every Location and its public Rooms, plus
the nets flagged `ghostsMaySee`. That flag is a web-only flag now — there is no
role left to grant it with on Discord, and `syncSpecialChannels` no longer tries.

**Private Rooms and conversations stay out, and the reason is no longer "that is
what the role sees".** Adding a ghost to a private thread posts a visible system
message *and* adds them to its member list. Either one announces the death to
everybody in the room. The only way around that is granting `MANAGE_THREADS`,
which is worse than the problem. So the limit outlived the role that used to
explain it, and has its own reason now.

### Deadchat

One channel, `#deadchat`, under its own **Beyond** category — provisioned and
reconciled by `npm run db:sync-deadchat` (`db/lib/deadchat.js`), which also runs
inside `db:sync`. Its id is `GameConfig.deadchatChannelId`.

It is opened by **per-member permission overwrites**, the way a Location channel
is (§3) and never by a role. That is the whole point: an overwrite is visible
only inside the channel it opens, and everyone who can open this one is already
dead. `@everyone` is denied view and send; the GM roles get view and are
**denied** send; there is deliberately **no spectator overwrite**, because a
spectator seat reading this channel would be the full death list at a glance.

A seat is written when a character dies (`deathTeardown.js`, the turn engine's
death step, `killCharacter`) and taken back when the player lives again
(re-roll, Metempsychosis, a spawn, a rite, a GM revive). Burial and engraving
touch it not at all. The channel doctor reconciles the set from
`ghostUserIds()`, and unlike the old ghost-role sweep it is **bidirectional**:
the overwrite *is* the access now, so a seat nobody should hold is taken back
rather than left as harmless drift. It reports at 800 seats, well under
Discord's 1000-overwrite cap, because that failure is otherwise silent.

A ghost speaks there as `Solomon Baker (Pub Fries)` — the character's name and
the player's account handle, composed at send time and frozen into
`ArchiveEntry.characterName` so an account rename never rewrites what the room
read. The avatar is the character's own, resolved live off the dead row.
Deadchat is out-of-character, so naming the account is the point rather than a
leak, and no hood or forced name the corpse is still wearing is applied.

It is **not** a `SPECIAL_CHANNELS` entry, and it looks like it should be. The
module header lists the three reasons; the sharpest is that
`locationMove.js#reconcileNarrowcastAccess` deletes the member overwrite for
every registry entry whose `member(ctx)` returns null, so every living player's
every move would fire a delete against it.

Deadchat survives the nightly wipe on both faces: `runMessageWipe` never walks
it, and `db/lib/feedWipe.js#isPersistentPlace` gives it the previous-game floor
instead of the per-turn one, so the web agrees. A new game still starts it empty.

## 6. The channel doctor

`db/lib/channelDoctor.js` is the reconciliation sweep that makes this system
self-healing instead of drift-until-someone-notices. It compares what the
database says the game looks like against what Discord actually shows, reports
every mismatch, and — with `apply` — repairs it. **Dry run by default.**

Two scopes:

- **cheap** — role membership (zone roles vs `Character.zoneId`, turn-ping vs
  `turnPingOptIn` **and `discordMirrored`**, cursed vs the dead-and-not-yet-rerolled
  set), character
  roles existing/orphaned, **`location-occupancy`** (below), a
  **`connection-slug`** check that every tag and Role a `LocationLink` names
  actually exists in the catalogs — they cannot be foreign keys, because tags
  and roles sync *after* zones — and the structural checks: zone channels and
  roles exist, Location channels exist, a **`character-place` check** that
  `Character.zoneId` agrees with `location.zoneId` (repaired from the location,
  the authority), the **bot's own highest role sits above every zone role** (or
  the swaps 403 — report-only, moving roles is a human decision), cursed colour
  0, and no seat-scoped `zoneId` pointing at a cave level. One member-list read
  plus a handful of requests.

  **`location-occupancy` is the successor to the old Location-role membership
  check, and it matters more than that one did.** The member overwrites on a
  Location channel must be exactly the living characters standing there **plus
  the ones still watching it** (§3aa), each with the right allow mask; extras
  are deleted, missing ones added, and a wrong mask is rewritten. It is the
  only sweep that catches a location grant the move pipeline failed to swap, or
  one a dead character kept — an overwrite has no `db:prune-orphan-roles` to
  fall off through. It costs one extra query (every valid `Vantage` row, in one
  read) and no extra requests, because the overwrites arrive on the channel
  object the structure pass already fetched.

  Standing beats watching: somebody who walked back into a street they were
  watching gets the full mask, not the mute one.

  This is also the **backstop for the turn shift.** A `Vantage` row is invalid
  the moment its turn is no longer the open one, so the cheap pass that runs at
  the end of every turn advance closes whatever the expiry step missed. The
  expiry step is what makes it prompt, not what makes it correct.
- **full** — all of the above plus the expensive halves: zone and **Location
  channel overwrites** vs the spec (the *role* half; occupancy is cheap-scope),
  leftover per-member overwrites on zone channels — **`member-overwrite`**, and
  it skips Location channels on purpose, because there the per-member overwrite
  is the access mechanism rather than a leftover. It used to sweep those too,
  which meant one `--full --apply` threw every player out of every Location
  channel at once and left them out until the next run, since `location-occupancy`
  has already gone by the time the full scope starts — **`room-thread`** (a Room's thread exists and is
  unarchived — recreating a missing one is the sync's job, so this is
  report-only), **`room-membership`** (a private Room's actual thread
  membership vs who currently holds one of its `accessTagSlugs` **or a
  `RoomGuest` row** and stands in its Location, via `listThreadMembers`),
  **`room-guest`** (rows whose character is dead or has wandered out of the
  room's Location), `PlayerThread` rows whose threads
  404, dead `PlayerThreadInvite` rows, the special channels' member overwrites
  vs the registry rules, and `#turns`'s own overwrites vs
  `db/lib/turnsChannelAccess.js` (§3a).

Where it runs: **cheap + apply on every bot ready** (`bot/src/events/ready.js`),
after every turn advance, as the
final step of Restart Game, from the Dev Panel's System Reports buttons (full
scope, dry or repair), and from a terminal with `npm run db:doctor`
(`-- --full`, `-- --apply`).

Every check is independently caught and the whole run is persisted as a
`SystemReport` (`kind: DOCTOR`) the Dev Panel renders. That is the structural
answer to the old wipe-time complaint: instead of hoping every removal in a
hundred-call loop lands, a miss becomes visible and repairable.

## 6a. The Discord mirror

`db/lib/discordMirror/` is the reconciler. The database is the master and
Discord is a picture of it, and the mirror's job is to keep the picture true.
It reads the rows, takes one snapshot of the guild, and works out an ordered
list of everything that does not match — roles first, then categories, then
channels, then Room threads and pinned anchors. Then it does it: creates what
is missing, renames and reparents what has drifted, and rewrites a room's
starter post that no longer matches its row.

**The channel doctor is a name for one shape of mirror run now.**
`runChannelDoctor` maps its two scopes onto `runDiscordMirror` and hands back
the same result, so the bot's restart pass, the end-of-turn reconcile and the
Dev Panel's Repair button all come through here. What changed for them is that
a missing channel is rebuilt instead of reported with a sync command that no
longer exists attached. There are three scopes:

| Scope | What runs |
|---|---|
| `structure` | the op list only — objects, no member walk |
| `cheap` | plus zone role membership, Location occupancy, the Deadchat seats |
| `full` | plus channel overwrites, threads, narrowcast and `#turns` access |

**It adopts by name before it creates anything.** A channel the database has
forgotten the id of, but which is still sitting in the guild under the right
name in the right category, is adopted rather than cut a second time — which is
what makes a run safe to kill halfway through. Two channels of the same name is
nobody's guess to make, so that becomes a `mirror-ambiguous` finding and no
create. Adoption compares Discord's version of a name, not ours
(`live.js#normalizeChannelName`): ask for "The Old Mill" and Discord stores
"the-old-mill".

**A second run must do nothing.** That is the property everything else rests
on, and it is what `db/test/discordMirrorApply.test.js` pins down. If a routine
pass ever proposes work on a world it has just finished with, the pass is the
bug.

### The queue

Nothing waits for Discord. A save that changes a place writes its row, calls
`enqueueMirror(prisma, targetType, targetId, reason)` and returns; the
`MirrorJob` row it leaves behind says a place is out of date. Repeat saves of
the same place coalesce into one job, so hammering a form costs one
reconcile.

`drainMirrorQueue` runs the mirror scoped to whatever is pending. The **web
`after()` is the primary trigger** — the web app is the half that is always
up — with the bot's ready pass and the turn wrapup behind it as the backstop. A
job is deleted only when its ops all succeeded; otherwise `attempts` goes up,
and at five the mirror stops trying and leaves the row with its `error`. A job
stuck behind an open circuit breaker is not retried forever and not silently
forgotten: `/gm/dev?s=reports` shows how much is waiting, how much is retrying,
and whether Discord is refusing calls.

### Running it by hand

`npm run db:mirror` is a dry run — it reads and reports and writes nothing.
`-- --full` adds the per-member sweeps, `-- --json` prints the lot, and
`-- --apply` does the work. Against the live database that last one goes
through `.claude/hooks/db-guard.py` like every other destructive script: ask
first, then `CONFIRMED=1`. `db:sync-narrowcast-channels` and `db:sync-deadchat`
are thin wrappers over the same thing, scoped to the radio nets and to
Deadchat. Every run lands as a `SystemReport`.

## 7. Special channels (`#cerberon`, `#27.065`, `#243.000`)

Standing channels outside the zone system, under one `radio` category (id on
`GameConfig.radioCategoryId`). All three are radio nets.
`db/lib/specialChannels.js` is a **registry**:
one entry fully describes a channel — its `GameConfig` id columns, topic,
tupper routing, wipe behaviour, ghost visibility, static role grants, an
optional `slowmode`, and the per-character access rule. Adding a future
special channel is one entry plus one `GameConfig` column.

The rules stay **code**, deliberately: a special channel's access condition is
real logic over tags and zones, and a YAML mini-language would only be a worse
programming language. What the registry buys is that the logic lives in one
self-contained object instead of being smeared across a provisioning script,
two access twins and the wipe.

| Channel | Who sees it | Who speaks |
|---|---|---|
| `#cerberon` | **Radio Bracelet (Cerberon)** or **Radio System (Cerberon)** holders (per-member overwrite) | Radio System (Cerberon) holders only |
| `#27.065` | **Radio (27.065)** holders (per-member overwrite) | the same — everyone who hears may answer |
| `#243.000` | **Radio (243.000)** holders (per-member overwrite) | the same — everyone who hears may answer |

The Radio tags are transferable, so possession is what matters — a bracelet
handed to a character outside the Cerberon still opens `#cerberon`. Nobody
buys a **Radio (27.065)** in point-buy either; the Thanati shelf is the only
source, at 20 (`db/lib/thanati.js`). **Radio (243.000)** is the Tribunal's
own frequency — a `starting_tags` grant on the Tribune and Tribunal Ordinator
roles (`docs/roles.yaml`), and on `db/lib/threats.js`'s `assign.tagSlugs` for
both, never bought. The three nets are separate frequencies and never mix.

Both are **also places on `/chat`**, as the `net:<slug>` place kind — see
`CHAT.md` §5d. The rule there is this same `member` function, so the two faces
cannot disagree about who hears what, and a web-only character finally hears
their own radio.

The **name is reconciled on every sync**, not just written at provisioning.
That is new, and it is why `#cerberon` spent two migrations still called
`#watch`: the name was set once, nothing ever read it back, and the doctor
checks member overwrites only. A rename keeps the channel's id and its
history.

The sync still enforces `roleViewZones` in both directions: it grants the
listed zone roles view *and* deletes any zone-role grant the registry no longer
lists. Nothing currently uses the field — `#intercom` was its only client — but
that deletion half is why dropping the channel really silenced it.

### `#intercom` is gone; the PA is a button now

There is no `#intercom` channel and no **Intercom** tag. The PA is a button
on the Council Room's starter post instead, broadcasting into every zone's own
`#summary` (§7a) — which is what `docs/zones.yaml` always said was on that
table.

The reason is not tidiness. A PA you travel to is not a PA — the announcement
landed somewhere nobody was standing, and hearing it meant being in a channel
rather than in a room. Now it arrives where people already are.

### 7a. The intercom

`db/lib/intercom.js`. The **Intercom** button sits on the Council Room's
starter row (`db/lib/roomStarterRow.js`, keyed on `INTERCOM_ROOM_SLUG =
"council-room"`, hardcoded for the `roleIds.js` reason). It opens a modal, and
the modal posts one line into each zone's `#summary`:

```
@here You hear a voice from the intercom: {text}.
```

**This is the one world-narration line that is NOT `-#` subtext**, and the
exception is deliberate. Everything else the world says is scenery and belongs
under the conversation; a PA is a loudspeaker. Delivering the loudest
notification Discord has in the quietest text it renders was backwards. Full
size also means the body may carry newlines safely — there is no per-line
prefix left to break, which is what `ambientLine` has to handle for everyone
else.

- **The gate is standing in the Council Room**, and nothing else the code
  checks. That table is now behind a door — `access: [barons-key, hands-key,
  meisters-key, censors-key]` — so in practice the PA belongs to those four
  seats. Re-checked at *submit*, never at open — an ephemeral modal outlives
  somebody walking out of the Keep.
- **The button must not be `ack()`'d.** `showModal` **is** the acknowledgement,
  and a deferred interaction can no longer open one (`COMMANDS.md`), so the
  button handler does no database work at all.
- **The Black Hills do not hear it** (`OUT_OF_RANGE_ZONE_SLUGS`, the slug
  `hills`). The barony's writ
  thins out across the river and no speaker was ever strung that far. The cave
  levels need no exclusion: they have no `#summary`, so the rock swallows the
  PA for free.
- **Sequential fan-out, each zone individually caught.** Never `Promise.all`
  this (`TURN-ENGINE.md`). A run that reached four zones of five says so to the
  speaker rather than swallowing it.
- **`allowed_mentions: { parse: ["everyone"] }`** — the one place this game
  uses a channel-wide ping. It does two jobs: it lets the `@here` through, and
  it makes every user and role ping a player types into the box inert, the same
  posture `proxy.js` takes with character speech pointed the other way. The
  modal caps the body at 1200 characters so the message never chunks, because
  chunking would ping `@here` once per chunk.
- **Archived.** One `ArchiveEntry` per broadcast (not per zone — it was one
  thing said, heard in several places), `channelKind: "intercom"`, naming the
  speaker even though the channel line names nobody. The old `#intercom` was a
  tupper channel, so its traffic was proxied and archived; a bot post is not,
  and without this the PA would be the one kind of public talk missing from
  `/archive`.
- Audited as `intercom_broadcast`.

`#mindlink` used to be the Cult of Bacchus's own telepathy channel, and set
the `slowmode` field — `entry.slowmode` is still optional on a registry
entry and only applied when present, but nothing currently in the registry
uses it. `#mindlink` is gone along with the Cult, archived in
`docs/archive/bacchus.yaml`.

`db/lib/syncSpecialChannels.js` provisions and **reconciles every run** (topic,
slowmode, `@everyone` deny, GM allow, spectator, ghost, and the
`roleViewZones` grants) — a channel that misses its role grants is a channel
nobody can hear. Channel identity (name, id) stays one-time, and a same-name
channel that already exists is adopted rather than duplicated. Run it with
`npm run db:sync-narrowcast-channels` — **after** `db:import-zones` and
`db:mirror`, since the grants name zone roles those may have just created.

Per-character access is applied by the two `syncCharacterNarrowcastAccess`
twins: `db/lib/locationMove.js#reconcileNarrowcastAccess` (REST, shared by bot
and web, run from `applyLocationMoveSideEffects` on every zone-crossing move
and from `/heal` when a tag moves) and `web/lib/discordGuild.js` (REST, from
the web travel action, GM raw edits, Bulk Move, character creation and
`grantTag`/`revokeTag`).
Both build the context with `buildNarrowcastContext` and run
`computeNarrowcastAccess` against the registry.

## 8. Wipes: three of them, and what survives

| Pass | When | What it does |
|---|---|---|
| **Message wipe** (`db/lib/messageWipe.js`) | **every** turn, while `GameConfig.messageWipeEnabled` | clears roleplay content per the table below — on two different cadences |
| **Full wipe** (`db/lib/fullWipe.js`) | Restart Game only | spares nothing (`LAUNCH.md`) |
| **`#turns` sweep** (`db/lib/turnAnnouncement.js#postTurnsConsole`, via `discordRest.js#clearMessagesExcept`) | every turn, Dawn or Dusk | deletes everything in `#turns` except the console message just posted — a stray GM post, an orphaned console from before a config reset |

**Two cadences, and the split is the point.** A turn is one real day, but Dawn
and Dusk alternate, so anything gated on Dawn only comes round every 48 hours.
Roleplay should not outlive the day it happened in, so the wipe runs every
turn — with one exception:

- **every turn** — Location channels, Rooms, Conversations, and every special
  channel the registry marks `wipe: "clear"` (`#cerberon`).
- **Dawn only** — a zone's `#summary`. It is the abstracted, slowmoded channel
  the adjudication results land in, so it gets the longer life the rest no
  longer does.

It was Dawn-only for everything until 2026-09-07, back when a turn was half a
day and a Dawn came round every 24 hours anyway.

`GameConfig.messageWipeEnabled` is **not a GM knob** — there is no form control
for it. The wipe is how the game works. The column survives as a
hand-flippable escape hatch for the day Discord starts rate-limiting the sweep.

`#turns` is **not** in `SPECIAL_CHANNELS` and the message wipe never reaches it
— it is one rolling message (the turn announcement, turn banner, and player
console) that gets deleted and reposted every turn regardless of
`messageWipeEnabled`. It is best-effort: a sweep failure is logged but never
costs the turn announcement that already went out. Its *access* is managed
though — see §3a.

The wipe is wired into `db/index.js#advanceTurn()`'s side-effect thunk, so it
fires identically whether the turn came from the bot's nightly cron or a GM's
"End Turn" button.

**The web has a watermark instead of a delete — two of them.** The same pass
sets `GameConfig.feedWipeSeq` to the newest `ArchiveEntry.seq` as it BEGINS,
and `feedWipeSummarySeq` alongside it on a Dawn
(`db/lib/feedWipe.js#markFeedWiped`, called from `db/index.js` immediately
before `runMessageWipe`). Every feed query on `/chat` then reads `seq >` the
floor for **that place's own cadence**: a `zone:` key against the summary
watermark, everything else against the turn one. The instant is deliberately
the same one `cutoffMs` names below, so a message posted while the wipe is
walking survives on both faces or neither. See `CHAT.md` §7 — the unread dots
reset with it for free.

**The message wipe only deletes.** The transcript is recorded at *send* time
(`db/lib/archive.js`, read at `/archive` — `ARCHIVE.md`), so nothing here reads
message content and there is no `#archive` channel. Deleting is the cheap half:
`bulkDeleteMessages` moves 100 messages per request, and it splits by age
because Discord rejects an entire 100-message batch if a single member is over
14 days old. Rooms go through the same batching (`clearMessagesExcept`, moved
into `db/lib/discordRest.js` so both the Location channel's own clear and a
Room's use it); they used to be cleared one message per request, which on a
busy turn was the single largest cost in the whole pass.

**Every rule below is bounded by a cutoff, and that is the important part.**
The wipe takes a `cutoffMs` — the moment `advanceTurn()`'s side-effect thunk
began — and touches nothing created at or after it. A Discord snowflake carries
its own creation time, so this needs no exemption list and no stored message
ids: `fetchAllMessages` is handed a synthetic `before` snowflake, and a thread
newer than the cutoff is skipped whole.

Two things depend on it. The first is that the turn's own adjudication
survives: the staged public declarations are
posted to `#summary` — or, for the two cave levels, into every Location channel
in the level (`ADJUDICATION.md` §1) — at the top of the same thunk that runs the
wipe at the
bottom, and before the cutoff existed they were deleted seconds after landing —
`StagedMessage` stamped `sentAt`, so nothing showed it had happened. The second
is that a player posting *during* the wipe keeps their message. The wipe is
long and walks zones in order, so without a cutoff whether your post survived
depended on where you were standing.

Per target, for every zone including cave levels, and per Location in it. The
zone loop runs every turn either way — it has to, for the Locations under it:

| Target | When | Behaviour |
|---|---|---|
| a zone's `#summary` | **Dawn only** | every message deleted |
| a Location channel | every turn | every top-level message deleted **except the pinned anchor**. Underground this also carries the level's public declarations, which therefore live one turn rather than a `#summary`'s two |
| a Room | every turn | every message deleted **except the starter** (`Room.starterMessageId`); unarchived if it had idled into the archive |
| a Conversation | every turn | deleted outright — thread, `PlayerThread` row and its invites. There is no persistence any more |
| a thread newer than the cutoff | every turn | left entirely — a Conversation someone opened while this very wipe was running isn't destroyed mid-use; it comes under the ordinary rules next turn |
| an untracked thread (no `PlayerThread` row, not a Room) | every turn | **adopted**: a `PlayerThread` row is written rather than the thread destroyed, so a GM's hand-made thread gets one full turn and a visible record instead of vanishing |
| every registry entry with `wipe: "clear"` (`#cerberon`) | every turn | every message deleted — a radio net is not a summary, and two days of standing traffic read wrong |

**Each Location is wiped inside its own `try`**, so one stale channel id costs
one Location rather than every Location after it plus the special channels.
Fetching a channel allows a 404 — one a GM deleted by hand is an ordinary
state for a blind sweep, not a reason to stop. The whole run is entirely
sequential (no `Promise.all` fan-out) to avoid bursting Discord's rate-limit
buckets, and lands on a `SystemReport` row (`kind: DAWN_WIPE` — the enum value
predates the rename and this schema drops none) the Dev Panel shows. Its
`summary.summaries` flag says which of the two cadences the run was.

That report now carries a **per-step breakdown** — elapsed ms, Discord request
count, and time spent asleep on a rate limit, one row per zone's `#summary`,
per Location, and per special channel, with the five slowest shown on the Dev
Panel. The wipe is the longest
thing either face does, and before this nobody could say which part of it was
slow. Check the breakdown before optimising anything here; the answer has been
guessed at twice already.

Private-channel content **is** in the transcript. The privacy tradeoff is
handled by `/archive` being GM-only, always, not by the wipe's own code.

**But the thunk does not run itself.** `advanceTurn()` returns every side
effect as one `runSideEffects()` thunk, because the wipe walks every zone's
channels sequentially and awaiting it inside the Dev Panel's server action held
the request open — and a pending server action blocks client-side navigation,
so the whole web app appeared to freeze. The bot's cron awaits the thunk
inline; the web action passes it to `next/server`'s `after()`. Channels
clearing out a little after the turn flipped is expected, not a stall.
See `TURN-ENGINE.md`.

## 9. Testing visibility: the guild owner always sees everything

Discord's permission system exempts the **guild owner** from every overwrite —
denies, category-level or channel-level, never apply to them. If the account
you're testing with owns the server (true for whoever ran the bot setup), every
category will look visible to you regardless of what is actually set, even with
zero bugs. To observe the gating, test from a non-owner account, or read the
raw overwrites over REST. `npm run db:doctor -- --full` is the faster answer:
it diffs the live overwrites against the spec for you.

## The Railyard

`depot-railyard`, a PUBLIC thread under the Depot Location's channel, authored
in `docs/zones.yaml` with no `access:` list at all. It replaced the Landing Pad,
which was PRIVATE behind `depot-keycard` — so the membership work the channel
doctor used to do for that room is simply gone, and the Depot feature adds
**no access code of its own** either way.

Crates land in a room anyone can walk into, which is a known hole, open on
purpose (`DEPOT.md` §0c).

Its starter description is static and sync-owned like every other room's,
but says whether the train is at the platform through `live: train` in
`docs/zones.yaml` (rendered by `db/lib/roomLive.js`, repainted by
`refreshLiveRooms` every close) rather than a hash-reconciled line — a
generic live-room mechanism, not a Depot special case. There is no shuttle
any more; the train runs on turn parity alone, nobody calls it
(`DEPOT.md` §0c).

See `docs/systemdocs/DEPOT.md` §0c.
