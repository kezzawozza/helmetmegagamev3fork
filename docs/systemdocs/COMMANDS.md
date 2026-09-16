# Commands, buttons, modals and reactions

The full player- and GM-facing Discord surface. Behaviour lives in the system
doc for each subsystem; this page is the index of what exists and where its
handler is.

Everything is dispatched from `bot/src/events/interactionCreate.js`, except
reactions (`bot/src/events/messageReactionAdd.js`).

## 1. Registration

Commands are defined in `bot/src/lib/commands.js` and registered **globally**
via `client.application.commands.set()` in `bot/src/events/ready.js`.

Global rather than per-guild because a guild command cannot appear in the
bot's DMs, whatever contexts it declares. The cost is propagation: a new or
renamed command can take up to an hour to appear. Registration is a full
replace, so removing a command from the array deregisters it.

`registerCommands` also **sweeps every guild's own command list empty** on
each boot. That full replace only ever replaces the *global* list, so when
registration moved from per-guild to global, everything the old code had
written into the guild stayed there — and Discord shows both copies in the
picker. `/gm` `/message` `/add` `/remove` appeared twice, and the four
retired `/hunt` `/fish` `/farm` `/herd` were still listed with no handler
left to answer them. Since registration is global, an empty guild-scoped
list is the correct state, so the sweep enforces it. Don't add a per-guild
registration back — it would be invisible in DMs *and* duplicate whatever the
global list already has.

Each command declares its contexts:

- `Guild` only — needs a channel or thread to act on.
- `Guild` + `BotDM` — usable anywhere, including the bot's DMs.

## 2. Slash commands

| Command | Options | Who | Contexts | Handler |
|---|---|---|---|---|
| `/move` | — | Living character | Guild, DM | `handleMoveOpen` |
| `/location` | — | Living character | Guild, DM | `handleTravelOpen` — the **Location** picker (§4) |
| `/travel` | — | Living character | Guild, DM | `handleTravelOpen` — the same picker, under the name people reach for |
| `/conceal` | — | Living character | Guild, DM | `handleConcealCommand` |
| `/message` | — | Living character | Guild, DM | `handleMessageCommand` |
| `/play` | — | Living character (an Instrument plays; without one, sings) | Guild | `handlePlayCommand` |
| `/shout` | `message` | Living character | Guild | `handleShoutCommand` — carries across the Location graph (§2d) |
| `/roll` | — | Anyone | Guild | `handleRollCommand` |
| `/add` | `character` (role) | Conversation or private-Room member, or GM | Guild | `handleThreadMemberCommand` |
| `/remove` | `character` (role) | Conversation or private-Room member, or GM | Guild | `handleThreadMemberCommand` |
| `/gm` | `message`, `attachment` | GM | Guild | `handleGmCommand` |
| `/dm` | `recipient` (user), `message` | GM | Guild | `handleGmDmCommand` |
| `/heal` | `character` (role) | GM | Guild | `handleHealCommand` |
| `/zone` | — | GM | Guild | `handleZoneCommand` — the select menu is `handleZoneViewPick` |

Notes:

- `/move`, `/location` and `/message` are the twins of the three console
  buttons in §3. Each opens the same flow.
- **`/travel` and `/location` are the same command.** `handleTravelOpen`
  answers both. `/location` is the historical name and stays registered so
  nobody's muscle memory breaks; `/travel` was added 2026-09-06 because that is
  what the thing is called everywhere else — the console button, the anchor
  button and this doc all say Travel. The BUTTON's `custom_id` is still
  `loc:open` and is not worth a migration; only the surface names changed.
  Retiring `/location` needs no deregistration step, since
  `client.application.commands.set` fully replaces the list.
- `/zone` is the Discord twin of the **Zones** control at the bottom of the
  inspector on `/gm/turns` and `/gm/players`. It takes no options: it opens an
  ephemeral select menu (`min_values: 0`) with the caller's current zones
  pre-selected, because toggling is something you do by looking at the current
  state rather than by retyping it. Choosing nothing means every zone. Both
  faces write `GmZoneView` and then call `syncGmZoneRoles`, which is what
  actually changes which Location channels the GM can see
  (`GAMEMASTERS.md` §6).
- `/conceal` toggles `Character.concealed`, a standing state rather than a
  per-message one — that's why it needs a DM context the same way `/location`
  does, rather than living only as a `/character` checkbox. See §2c.
- `/message` run inside a channel the player can already speak in skips the
  destination picker and posts there. Anywhere else — including a DM — it asks
  where first. See `PROXYING.md`.
- `/roll` is one flat 1d6, with no options and no game effect — it settles
  things at the table, nothing more. It reuses `rollDie()` from
  `db/lib/moveEffects.js` rather than adding a second source of randomness.
  Guild-only, because a die rolled in a DM has no audience. The result is
  posted as a **plain bot message**, not as a public interaction reply: a
  public reply carries Discord's "@account used /roll" header, which names the
  player behind the character (`PROXYING.md`). So the roll goes out anonymous,
  and the roller gets a separate ephemeral telling them which one was theirs.
- `/shout` takes a **string option** rather than opening a modal the way
  `/message` does. The modal exists so a player's real account never shows a
  typing indicator in a channel — filling in a slash-command option shows none
  either, so the protection is already there and the extra click buys nothing.
  See §2d.
- `/labor` is retired — laboring is now the **Labor checkbox** on the Move
  modal (`LABORING.md` §4).
- `/persistent` is retired too — Bascinet 2 dropped forum topics, private
  Create-a-Thread anchors and any long-lived form of a player-made thread.
  The only thread a player can open now is a Conversation, and every
  Conversation is wiped clean at the next Dawn regardless (`CHANNELS.md` §4).
- `/dm` was named `/message` until `/message` became the player-facing speak
  command.
- Commands taking a character take a **role** option, not a user option, so
  the picker names characters rather than Discord accounts. The role is the
  character's personal name-token role (`CHANNELS.md` §3).

### 2b. `/add` and `/remove` in detail

Both work on two things, and **the channel decides which**:
a `PlayerThread` row means a **Conversation**, a `Room` row means a **private
Room** (§2b-ii). A public Room takes neither — everyone standing in the
Location can already read it — and anywhere else refuses.

#### 2b-i. In a Conversation

**`/add` works on any `ALIVE` character, wherever they stand.** There is no
location gate. Discord refuses (or quietly sheds) a thread member who can't
view the parent Location channel, so the command records a
**`PlayerThreadInvite`** row first — that is what survives when the Discord
add can't land yet — and then attempts the add. If the target is already
standing **here** (`target.locationId === row.locationId`) it lands
immediately; otherwise `db/lib/threadInvites.js#applyPendingInvites` replays
it the moment they arrive, called from `applyLocationMoveSideEffects` on
every move (`MAP.md` §4). Adds are **silent**: the REST thread-members
endpoint is used rather than `channel.members.add`, which would ping-mention
them in the channel. The target is DM'd instead — where they were let in, and
a link, never the content. Discord's own "added to a thread" notice is easy to
miss and says nothing about where.
Mentions into a Conversation follow the same contract — a character-role
mention there is also an invite (`bot/src/events/messageCreate.js`).

**`/remove`** deletes the invite row and then removes the thread member. If the
bot is missing `Manage Threads` the caller is told so, rather than seeing "the
application did not respond".

#### 2b-ii. In a private Room

The other way into a private Room, and the only one that isn't a key
(`CHANNELS.md` §4a). `/add` writes a **`RoomGuest`** row, adds the thread
member and sends the same DM.

Three differences from the Conversation form, all downstream of the grant
being **spent when the guest leaves the Location**:

- **The target must already be standing there.** A row handed to somebody
  across the map would be deleted before they ever saw the door.
- **They stay until they leave.** `syncCharacterRoomAccess` drops every guest
  row that isn't where the character now stands, so walking out is what shuts
  the door. Coming back needs a fresh `/add`.
- **`/remove` refuses a key-holder** — *"Their key admits them. Take the
  key."* Removing them would undo itself on their next arrival, so the honest
  answer is to name the real removal.

A guest gets the room's **full reach**, not just the thread: the stash, the
Transfer dialog, Storage, equipment standing there, corpse handling. That
falls out of `accessibleRooms()` being the one predicate behind all of them.

Both forms are open to anyone already in the thread (checked via
`channel.members.fetch`), plus GMs — the same posture as pinging someone in,
which any participant can already do.

### 2c. `/conceal` in detail

`Character.concealed` is a standing toggle, not a per-message prefix — there
is no more typed prefix to open a message with. `handleConcealCommand`
(`bot/src/events/interactionCreate.js`) flips it, writes a
`character_conceal_toggled` `AuditLog` row, and replies naming the alias:
"You now speak as **a young man**. Nobody sees your name until you run
`/conceal` again." / "You speak under your own name again."

While concealed, every message proxies under `concealedAlias(character)`
with the unknown-silhouette avatar (`messageCreate.js`), and the **Who's
here?** anchor button lists the character under that same alias, with no
Role shown (§4). The web app carries the identical toggle as a `<Switch>` on
`/character`, next to turn-ping (`AvatarField.js`).

### 2d. `/shout` in detail

The one thing a character can say that leaves the room they said it in. It is
the only speech in the game that crosses the Location graph.

**Who hears it.** `db/lib/locationGraph.js#soundRange` BFSes out from wherever
the character *stands* — not from whatever channel the command was typed in;
those can disagree and only one of them is a place a voice comes from — and
returns every Location within three hops, each with the distance and the
direction. **Every edge counts.** Locked, hidden, shut, on-foot — sound does
not care, because none of those are about sound. A portcullis you
cannot open is still a portcullis you can yell through. It is deliberately the
one traversal in the game that never calls `crossingCheck`.

**Who may shout.** The SHOUT capability (`TAGS.md` §5f) — so Paralyzed,
Unconscious and mid-Seizure refuse, **Mute refuses here and nowhere else**, and
**Bound deliberately does not refuse at all** — it *muffles*. Being tied up
takes your hands, not your voice, so the yell still happens and the people
standing with you still hear it; it simply does not carry past where you are,
and the line says so ("but it's muffled"). Somebody who can see you tied up
can obviously hear you, so a gag takes the **hops**, never the room. That
lives in `db/lib/say.js#loadVoiceState` as `shoutMuffled` rather than in
`incapacitation.js`'s table, because the table is about what is *refused* and
a muffle refuses nothing — the cooldown is still spent, and no error is shown.
Mute is the mirror of that: an ordinary talker whose voice will not carry. The check runs *before* the cooldown is claimed, so
a refused shout does not burn the throat timer.

**What they hear**, from `db/lib/shout.js`:

| Distance | The line |
|---|---|
| 0 — your own Location | Full size: **who shouted**, and the words |
| 1 | `-#` subtext: "…from the direction of *X*", words clear |
| 2 | the same, 40% of the letters replaced with `░ ▒ ▓` |
| 3 | "…from the direction of *X*." — no words at all |

It used to run one hop further, with a 70%-static ring before the wordless
one; Bascinet cut it on 2026-09-07 because at that much static the text said
nothing and only looked like it did.

Distance takes the **words** away before it takes the **direction** away. You
always learn which way to run; you stop learning what was said.

**The direction is never the source.** `viaName` is the *hearer's own
neighbour* on the shortest path back — the next step toward the noise, which is
the only part of it a person standing there could actually tell. Ties between
two equally-short ways back resolve by lowest slug, so a shout cannot name one
direction on Tuesday and another on Wednesday for no reason a player can see.

**And it is withheld entirely when that step is a hidden way.** Sound still
carries through a secret crawl — that is the rule — but the line drops to "you
hear someone shout somewhere nearby", because naming the crawl would tell a
player a way exists where every travel list has told them none does. That is
the whole reason `hidden` refuses in the same words a nonexistent edge does
(`MAP.md` §2a), and a shout must not be the hole in it. The suppression is
**not** sticky: only the hearer's own step counts, so a shout from deep in the
caves still tells somebody out on the road which way down the road it came
from.

**Named at distance zero, and nowhere else.** Standing in it you can simply
look, so your own Location and the thread you shouted from get
`Baroness Ophidia shouts: » …`. From one hop out it is `You hear someone
shout…` exactly as before — which is the half of the old rule that was doing
the work, because you hear a shout before you find out whose it was.

The name is the **presented** one (`db/lib/presentedIdentity.js`), so
concealment survives at zero distance too: a hood shouts as `A young man`, a
Beast as `Beast`. It is `aliasSubject()`'s lower-case form rather than
`identity.name`, which is Title Case because it doubles as a webhook username
and would read as somebody actually called Young Man. An identity that fails
to load falls back to the old anonymous line — erring toward hiding somebody
who should be visible, never the reverse.

Distance 0 is full size and everything past it is `ambientLine` subtext, the
same split `/play` makes: the room hears the performance, the street outside
only notices it. Only Location **channels** get it, never the Room threads under
them — somebody in a private back room is behind a door.

**Except the room you are standing in.** Shout from inside a Room or a
Conversation and the thread gets the full-size line too, before the loop runs.
Without that one exception the only room that certainly heard you would be the
only room that didn't.

**Two things muffle, at two different distances.** A soundproof room is
*sealed*: nothing leaves the thread. A bound character is *gagged*: the shout
reaches their own Location and stops there. Both append `, but it's muffled.`
and both still cost the cooldown; bound inside a soundproof room is sealed,
the stricter of the two. See `db/lib/shout.js`.

**And some rooms keep it.** A Room may be `soundproof: true` in
`docs/zones.yaml` (`Room.soundproof`). Shout from inside one and the thread is
the *whole* delivery: the parent Location channel and every Location in earshot
get nothing, the BFS is skipped entirely, and the line everyone in the room
sees gains `, but it's muffled.` — as does the shouter's own acknowledgement.
It is not a refusal, so it still costs the five-minute cooldown; a hostage who
has spent their throat on a room nobody can hear has spent it.

Fifteen rooms carry it, and they are the places you would tie somebody up in:
the Vault, the Oubliette, the Dungeons, the Order Chambers, the Charon, the
Nook behind the painting, the windowless Operating Theater, the Underquarter
Basements and Organ Shop, and the cellars and crypts — the Inn's, the Manor's,
Creekside's Root Cellar, the North Hills Basement, the flooded Village cellar,
the drowned Marshes Crypt. The Graga Pit deliberately is **not**: the thing
rumbling under the throne room is supposed to be heard. Neither are the
Echoing Halls, whose whole description is that sound carries there.

A Conversation inherits the flag from the Room it hangs under, so a private
thread opened inside the Vault is muffled and one opened out on the open
Location is not. A Location itself is never soundproof — standing in the street
outside a vault is not being in the vault.

It is a **shout** boundary, not a sound boundary. The whisper poll still leaks
Conversation fragments up into the parent Room every fifteen minutes
(`db/lib/whisperLeak.js`); only `subtle` suppresses that.

**Every place that hears a shout gets a row as well as a post.** The archive
row is what Chat draws and what `/archive` keeps, and it is the only half a
web-only player ever sees; the Discord post is the other face. Neither is
downstream of the other — the outbox carries `WEB` rows only, so a `SYSTEM`
row is never echoed into a channel (`db/lib/scene.js`) — so writing the row
beside the post is not a double post, it is the whole delivery.
`db/lib/shout.js#deliverShout` does both, for all three callers: Chat, the
bot, and the turn engine's Xom scream.

One thing it has to watch. `soundRange` counts the shouter's own Location at
distance 0, so a caller shouting from a `loc:` place key names that place
twice — once as where the shout was made, once as the nearest thing that heard
it. `shoutAudience` drops the second. A shout made from a Room or a
Conversation can never collide, which is why only the Xom scream was ever
posting itself twice.

**Rate limits.** One shout is up to a couple of dozen REST posts, so the posting
loop is sequential with every post individually caught, the discipline
`bot/src/lib/deathSmell.js` documents — never `Promise.all`. On top of that
there is a 5-minute per-character cooldown — an `AuditLog` row, not an in-memory
Map, so it survives a bot restart and the two faces share one throat — and it is
**claimed before the loop rather than after**: the loop takes real seconds,
which is exactly long enough for a second `/shout` to slip past a cooldown
stamped at the end.

### 2d-bis. Pray, at the Shrine of an Old Man

One room button, in `chasm-shrine-of-an-old-man` at the bottom of the Chasm
(`docs/zones.yaml`, gated `access: [caving]`). It grants `{tag:old-ways-xom}`
and is the only way into that tag — nothing else in the game hands it out.
Declared like every other room-bound button, as one `ROOM_AFFORDANCES` entry in
`db/lib/placeAffordances.js` with a `when:` on the room slug, and the shared
domain half lives in `db/lib/xom.js#grantXom` so the two faces cannot drift.

**A plain confirm, not the bell's type-the-word modal**, and the difference is
the point. `RING` is a speed bump on a **loud** act: typing a word says "you
are about to disturb a hundred people". Pressing Pray disturbs nobody. What it
does is hand you a permanent tag that puts you on a weighted table once per
turn close for the rest of your life (`TURN-ENGINE.md` §8a-bis), take whatever
you believed in before, and shut every goal on your sheet but one. The friction
that fits *that* is being told what the bargain is, so the dialog says it and
then offers a Danger button. Bot: `handlePrayOpen` → an ephemeral confirm →
`handlePrayConfirm`, which **re-runs every gate**, because the ephemeral
outlives somebody climbing back out of the Chasm. Web: `pray({ roomId })` in
`chat/actions.js`, gated the same way — a server action is a public endpoint.

Two refusals worth knowing. Somebody who already holds it is told the face is
already watching them. A **Thanati** cultist is refused outright rather than
converted: dropping `{tag:thanati}` would quietly pull them out of their
objectives, rites and hideout with nothing said to anybody, so the cult simply
got there first. Every other Belief comes off (all of them — Fundamentalist
stacks on Post-Christian, so two is a legitimate state).

### 2e. The bell and the trumpet

The two things that are *loud* rather than spoken. They share one machine,
`db/lib/soundBroadcast.js#broadcastSound`, which is `/shout`'s cousin over the
same `soundRange` BFS — with the two things that make a shout a shout removed.

**Nothing muffles.** A shout loses its words with distance because a shout *is*
words. Neither of these has any to lose, so all distance changes is whether the
line lands in the conversation or under it. **And no direction**: `soundRange`
offers a `viaName` and a shout needs it, but a bell hangs in a tower you can see
from the square, so naming the way to it tells nobody anything.

So the only thing left is a volume band, and it is purely a formatting call —
full size near the source, `ambientLine` subtext past it.

| | Origin | Reach | Full size | Cooldown |
|---|---|---|---|---|
| **Bell** | the Cathedral, fixed | 7 hops | 0–4 | 30 min, global (`GameConfig.bellRungAt`) |
| **Trumpet** | wherever the holder stands | 5 hops | 0–3 | 30 min, per character, in memory |

The trumpet's numbers are **derived** from the bell's at 0.75×, rounded, rather
than written out — the ratio is the design, so retuning the bell moves the
trumpet with it instead of leaving the two to disagree (`db/lib/trumpet.js`).

From the Cathedral the bell is 20 Locations loud and 16 quiet; the trumpet is
12 and 16.

**Rock stops sound, and the rule is symmetric** — a Location hears it only if
its `Zone.kind` matches the origin's. A bell in the Cathedral must not ring in
the Depths, which any version of this gives you; but a trumpet blown underground
must still be heard by the people standing next to the trumpeter, and a plain
"surface only" filter made it audible everywhere *except* down there. Comparing
against the origin says the actual thing rather than describing the wiring.

That filter replaced an allowlist of four zone slugs posting into zone
`#summary` channels, which could not say that the Square hears the bell better
than the far Marshes do, and made the Black Hills deaf to a bell they stand
close enough to hear.

**Who may.** The bell is whoever can reach the rope — the Bell Tower's `Sound
Bell` button, confirmed by typing `RING` into a modal, because one click is
heard across most of the barony and cannot be taken back. The trumpet is
whoever holds the `trumpet` tag, and its button is on the **web Character
page**, not in Discord: "only if you have one" is a per-reader question, and a
Discord button sits on an anchor message everybody shares. It asks for a
confirm for the same reason the rope does. Sounding it takes ACT, not SPEAK — a
trumpet needs breath *and* hands, so Bound stops it where it deliberately would
not stop a shout.

Both write an AuditLog row (`bell_rung`, `trumpet_sounded`), and both claim
their cooldown **before** the posting loop, for `/shout`'s reason: the loop is
two or three dozen REST posts and takes real seconds.

## 3. The `#turns` console

The buttons ride on the rolling turn announcement — `#turns` is one message,
reposted each turn by `db/lib/turnAnnouncement.js#postTurnsConsole`, so the
console is always the last thing in the channel (see `TURN-ENGINE.md` for why
it stopped being three separate messages).

`bot/src/lib/turnsConsole.js#ensureTurnsConsole` runs on ready and is only the
cold start: it locks the channel down and posts the message if none exists —
a fresh guild, or a repost that failed. Restart Game used to be the common
case: it clears `#turns` and does not advance a turn, so the channel stayed
empty through Day 1. It now reposts the console itself
(`web/app/(app)/gm/dev/actions.js#finishGameWipe`), and this is the backstop
behind it. The buttons themselves are one shared definition in
`db/lib/turnsConsoleRow.js`, plain component JSON because the REST side (the
web Dev Panel's End Turn) and the gateway side both post it.

`@everyone` is denied `SendMessages` in `#turns`. Anything typed there is
deleted and files nothing.

| Button | Emoji | customId | Opens |
|---|---|---|---|
| Travel | 🗺️ | `loc:open` | The Location picker (§4) |
| Move | ⚜️ | `move:open` | The Move modal (§5) |

Tracked on `GameConfig.turnsConsoleChannelId` / `turnsConsoleMessageId`.

## 4. Component custom IDs

`namespace:verb` for singletons, `namespace:verb:{id}` where an id is needed,
parsed by literal `startsWith` + `slice`.

| customId | Type | Does |
|---|---|---|
| `loc:open` | Button | Offer the connected Locations |
| `loc:pick` | Select | Pick a destination Location |
| `loc:bring` | Select | Set your escort party — who comes with you (min 0) |
| `loc:confirm:{locationId}` | Button | Execute the travel |
| `loc:cancel` | Button | Dismiss |
| `loc:who:{locationId}` | Button | Reply privately with who's standing here (§ below) |
| `loc:secret:{locationId}` | Button | Reply privately with the private Rooms and Conversations here you can see |
| `loc:converse:{locationId}` | Button | Offer the Rooms you can link a new Conversation to |
| `room:storage:{roomId}` | Button | Reply privately with what's lying in the Room's stash (`CARRY.md` §7) |
| `room:intercom:{roomId}` | Button | Show the Intercom modal. **Council Room only**, and the one button here that must NOT be `ack()`'d — `showModal` is the acknowledgement |
| `intercom:send:{roomId}` | Modal | Broadcast the PA (`CHANNELS.md` §7a) |
| `conv:room:{locationId}` | Select | Pick which Room to link the Conversation to, then show the Converse modal |
| `conv:new:{roomId}` | Modal | Create the Conversation |
| `move:open` | Button | Show the Move modal |
| `say:open` | Button | Retired — answers with a pointer to `/message` (§5) |
| `heal:pick:{characterId}` | Select | Clear the chosen afflictions |
| `edit:open:{messageId}` | Button | Show the Edit-message modal, prefilled |
| `edit:send:{messageId}` | Modal | Rewrite a proxied message |
| `offer:accept:{offerId}` | Button | Accept a Lesson or Bind `Offer` |
| `offer:decline:{offerId}` | Button | Decline a Lesson or Bind `Offer` |

Retired with the zone rework: `zone:place`, `zone:confirm:{zoneId}`,
`zone:cancel`, `zone:who:{zoneId}`, `topic:new:{zoneId}`,
`topic:create:{zoneId}`, `priv:new:{zoneId}`, `priv:create:{zoneId}`.

**The two `edit:` ids arrive in a DM**, from the button the ✏️ reaction sends
(`bot/src/lib/editModal.js`, `PROXYING.md` §4). `interaction.guild` and
`.member` are null there, so both handlers resolve the author from
`recentProxies` rather than from the guild — and `edit:open:` opens a modal, so
it is one of the handlers that must **not** ack first.

**The two `offer:` ids also arrive in a DM**, on the message `db/lib/offerRow.js`
builds for a Lesson or Bind `Offer`'s responder (`LESSONS.md` §3). Handled by
`bot/src/lib/offers.js`, routed in `interactionCreate.js` alongside the `edit:`
namespace. The click's acknowledgement is `interaction.update()`: the buttons
come off the message and the outcome is written under it in place, so nothing
can be clicked twice and no message id needs to be stored elsewhere.

**The travel flow lives in `bot/src/lib/locationTravel.js`, all
`loc:`-namespaced** (`bot/src/events/interactionCreate.js`). The console
button keeps its historical id, `loc:open` — that id is baked into every
standing `#turns` console message, so renaming it would break every console
posted before the rework, and it is also the id the three anchor buttons'
namespace was chosen to match. `handleTravelOpen` (the `/location` twin too)
offers the current Location's direct neighbours, then everywhere **farther in
the same zone** the character already knows and could walk to (`MAP.md` §3c), or
every non-cave Location for a character who has none yet — arriving is not
travel. Neighbours come first, which is the whole of the grouping a Discord
select gives us: when the 25-option cap bites it eats the walks and never a way
out, since a way out is the common case and the only way to leave the zone. Picking one (`handleTravelPick`) shows the cost as an option
description and a `-#` line rather than asking the server anything: "Same
zone" (free, on a cooldown), "Crosses into {Zone} — costs your Move", or
"Arriving costs you nothing" on a first placement.

**Every hop offers the party**, on the same message as the Confirm/Cancel
row: `loc:bring` lists everyone standing **here** with a verdict from
`db/lib/escort.js#escortCandidates` — a corpse, anyone helpless, a member of
the faction you lead, or somebody you'd have to ask. The select is
`minValues: 0`, is pre-ticked with whoever is already following you, and
`buildBringRow` returns `null` (dropping the row entirely) when there is
nobody to bring, since Discord rejects an empty select.

**Nothing is parked between the two clicks any more.** The drag select this
replaced could not carry its picks on the component — Discord hands the
Confirm click no memory of what a select last held — so it kept them in an
in-memory `Map` with a ten-minute TTL, and a bot restart between the two
clicks silently cost a player their passengers. An escort is a row on the
follower now (`Character.escortedById`), so `handleTravelBring` writes it
straight away and `handleTravelConfirm` reads it back out of the database.
The `Map`, its TTL and its three helpers are gone. Anyone ticked who could say
no gets the Accept DM instead of being attached; anyone unticked is put down.
The party is re-authorized inside `performLocationMove`'s own transaction, and
a follower the way refuses is dropped there rather than failing the hop. See
`MAP.md` §3a.

**The three anchor buttons ride on the Location anchors**
(`db/lib/locationAnchorRow.js` — plain component JSON, because the sync
posts them over REST from `db/`, which has no discord.js, while the bot
answers the clicks over the gateway). The Location id rides in the custom id
so the handlers need no channel→Location lookup; change a prefix in that
file and you must change it in `interactionCreate.js` too.

- **Who's here?** (`handleWhosHere`) lists everyone `ALIVE` and standing in
  this Location. Since phase 3 of Chat the rule itself is
  **`db/lib/whosHere.js#whosHere`**, and the handler only speaks the answer —
  `/chat`'s people column reads the same function, so the street and the page
  cannot disagree about who a stranger is. Named characters first (with their `roleTitle` shown to a
  fellow member of the same real faction, same rule the 🔍 inspect gate
  uses), then concealed characters as their alias with an article — "a young
  man" — and no title, since a Role is as identifying as a name. Nobody here
  ⇒ "Nobody is here."
- **Secret rooms?** (`handleSecretRooms`) lists the private Rooms this
  character's held tags admit them to (`db/lib/roomAccess.js#accessibleRooms`)
  and the Conversations here they created or were invited to — two separate
  lines, each dropped when empty; nothing at all ⇒ "No secret rooms for you
  here."
- **Converse** (`handleConverseOpen`) offers every Room here the character
  can see (public, plus private ones their tags admit) via `conv:room:`; that
  select's handler, `handleConverseRoomPick`, must **not** ack — it goes
  straight to `showModal` — so the picker outliving a player's departure is
  caught on submit instead. `handleConverseCreate` re-checks the character is
  still standing in the Room's Location, opens a private, non-invitable
  thread on the **Location channel** (Discord has no threads inside threads,
  so the Room is only the link the whisper poll reads), adds the creator
  silently, and writes the `PlayerThread` row (`locationId`, `roomId`) plus a
  `conversation_opened` `AuditLog` entry.

## 5. Modals

Four modals. All need discord.js >= 14.27 for the component types involved:
`Label` (18) wrapping a `TextInput` (4), `RadioGroup` (21) or `Checkbox` (23),
plus a bare `TextDisplay` (10) for the `-#` line.

A modal must be shown within 3 seconds of the interaction and **cannot be
deferred first**. That is why the Move button opens its modal directly — it
makes the single cheap cutoff check below and falls through to the modal if
that read fails, since submit checks it again — and why `/message` tests
speakability before it acks anything, taking the modal path or the refusal but
never both. Converse still goes through a picker first (enumerating Rooms costs
API calls), so its handler shows the modal with nothing awaited and every real
gate runs on submit instead.

### Move — `move:new` (`bot/src/lib/moveModal.js`)

| Field | customId | Type |
|---|---|---|
| Your Move | `move:body` | Paragraph, required, max 1800 |
| Kind | `move:kind` | Radio: `ROUTINE` / `GAMBIT`, required |
| Labor | `move:labor` | Checkbox — Routine only, refused on a Gambit |

Moves close three hours before the turn ends — 9:00 AM / 9:00 PM
America/Chicago — so a GM can adjudicate what was filed before the push
(`TURN-ENGINE.md` §6a). Both `move:open` and the submit handler check it: the
button refuses to open the modal after the cutoff, and submit re-checks because
a modal can sit open on screen across it. Either way the refusal is ephemeral
and names the cutoff and the next turn's start. Travel, Speak, requests and the
auto-labor pass are untouched.

Submitting runs every gate the old `#turns` message flow ran — living
character, open turn, before the cutoff, hasn't already acted, non-empty body,
Labor resolved **before** any `Action` row exists so a refusal never costs a
turn — then
locks the Move in through `bot/src/lib/moveConfirm.js#confirmMove` and
replies ephemerally. **Submit = locked**: there is no edit window, the dice
and resource roll happen now, and the payout — like every Move payout — lands
at the turn-end push (`ADJUDICATION.md`). See `TURN-ENGINE.md`.

### Converse — `conv:new:{roomId}` (`bot/src/lib/converseModal.js`)

| Field | customId | Type |
|---|---|---|
| Name | `conv:name` | Short, required, max 90 |

Replaces the two creation modals of the zone rework (Create a Topic, Create a
Private Thread) — players no longer make Rooms, only Conversations, and a
Conversation is always private and always linked to a Room. The Room id rides
the custom id, coming straight off the `conv:room:` select that opened this
(§4), so submit needs no channel→Room lookup; every gate runs on submit
(`handleConverseCreate`): a living character, still standing in the Room's
Location — the select lives on an ephemeral message that can outlive a
player walking out of the Location, same posture the old topic/private
modals took toward the zone.

On success the bot opens a private, non-invitable thread on the Room's
**Location channel** (Discord has no threads inside threads), adds the
creator silently, and writes the `PlayerThread` row (`locationId`, `roomId`)
plus a `conversation_opened` audit entry. Players hold no create-thread
permission anywhere — the bot makes every Conversation, which is what keeps
`PlayerThread` a complete record. See `CHANNELS.md` §4.

### Speak — `say:send:{channelId}` (`bot/src/lib/speakModal.js`)

| Field | customId | Type |
|---|---|---|
| Message | `say:body` | Paragraph, required, max 1800 |

The Conceal checkbox and the attachment field are both gone. Concealment is
no longer asked per-message — it's the standing `Character.concealed` toggle
(`/conceal`, §2c), read off the character rather than the modal, so a post
while concealed goes out under `concealedAlias(character)` with no extra
choice to make on submit.

**There is one entry point, `/message`, and the destination is wherever you
ran it.** `bot/src/lib/speakTargets.js#canSpeakInTarget` is the only question
asked: does Discord say this member may post here? That is the live answer to
every narrowcast rule without a second copy of them, so a channel added later
works automatically.

"May post in" is two different permissions, and conflating them is a bug:

| Target | Needs |
|---|---|
| Text channel | `ViewChannel` + `SendMessages` |
| Thread | `ViewChannel` + `SendMessagesInThreads` |

A standing character holds `SendMessagesInThreads` on the Location channel they
are in, and `locationChannelSpec` **denies** `SendMessages` to `@everyone`
there. The deny is the part that carries the rule — taking a bit out of an allow
mask denies nothing, which is why the street stayed typeable for two days
(`db/lib/zoneChannelSpec.js`). So `/message` opens on a Room thread, a
Conversation or the zone `#summary` and refuses on the street, which is the rule
`CHANNELS.md` §2 states.

Run somewhere you cannot speak — a DM, or `#turns` — it answers with a pointer
rather than a list. The destination is re-checked on submit anyway: an open
modal outlives its player walking out of the room.

**Retired: the 🔊 button and its destination picker.** The picker enumerated
every place a player could speak, grouped Room / Threads / Broadcast. It could
never list a Room thread or a Conversation: it reached threads only through
their parent Location channel, and that channel stopped being a designated
tupper channel when Send came off the street on 2026-09-06 (`CHAT.md` §5b), so
the branch collecting them was unreachable and the THREADS group was always
empty — the picker offered `#summary` and `#cerberon` and nothing else.
`say:open` is now a stub answering with a pointer to `/message`, kept only
because `#turns` is one rolling message and a console posted before the deploy
keeps a live button for up to a real day.

### Intercom — `intercom:send:{roomId}` (`bot/src/lib/intercomModal.js`)

| Field | customId | Type |
|---|---|---|
| Announcement | `intercom:body` | Paragraph, required, max 1200 |

The button lives on the Council Room's starter post, and standing in that room
is the whole gate — there is no tag any more (`CHANNELS.md` §7a). Like Speak,
the gate is re-checked on **submit**, because an ephemeral modal outlives its
player walking out of the Keep.

The SPEAK check rides along on submit, and never on open (`showModal` *is*
the acknowledgement, so that handler cannot `ack` first). Hearing is not
checked at all: a shout and a PA both land in shared Discord channels, so
nothing can hide a broadcast from one character, and not hearing stays
roleplay. See `TAGS.md` §5f.

1200 characters is not arbitrary. The composed line has to fit one Discord
message per zone: the broadcast pings `@here`, and a chunked message would ping
once per chunk.

## 6. Reactions

All in `bot/src/events/messageReactionAdd.js`, all gated on `recentProxies`
except 🌫️ and ⭐. Each is stripped back off after being processed.

| Emoji | Who | Does |
|---|---|---|
| ❌ | Owner or GM | Delete the message and its `ArchiveEntry` |
| ✏️ / 📝 | Owner | DM-based edit |
| 🔍 / 🔎 | Anyone | Inspect embed, gated by the viewer's own tags |
| ❓ | Anyone | DM the character's bio |
| ⭐ | Anyone | Save a personal `Note` — works on any bot- or webhook-authored message, not just a tracked proxy (`PROXYING.md` §7) |
| 📸 / 📷 | Anyone holding an Instant Camera | Mint a **Photo** tag of the speaking character |
| ⚜️ | GM | Full dossier on the speaking character |
| 🌫️ | GM | Delete and repost as the bot, de-attributing it |

**A ghost has no voice.** No `GhostWhisper` table, no `db/lib/ghostWhisper.js`.
The thing that reports an unburied body is the body: `bot/src/lib/deathSmell.js`
nags the Location it is
lying in every 4–10 real hours (`CORPSES.md` §5), which says the same thing
without needing the dead player to be at their keyboard to say it.

Every refusal except the cooldown is silent, on purpose: a visible "you can't
do that" would tell the living that someone specific is watching. The cooldown
answers by DM for the same reason.

⚜️ applies **no** vision gates — every tag, the Desire, this
turn's Action, and the real name even on a concealed message. It has **no
channel fallback** when the DM bounces, unlike every other embed here:
posting it in the channel would hand the room everything it hides.

⚜️ is also the Move button's emoji. Buttons and reactions share no namespace,
so this is not a collision.

**📸 is 🔍 that stopped moving.** Both run
`readoutForReaction()` — one function on purpose, for `db/lib/examine.js`'s own
reason: a divergence between what you see when you look and what the camera
catches would be invisible until a player noticed one surface saying something
the other wouldn't. The difference is what happens next. 🔍 DMs the embed and
that is the end of it; 📸 also freezes the readout onto a runtime `Tag` row
(`db/lib/photoMint.js`), which is a real object — it can be handed over,
stashed, stolen, and shown to somebody who was not there, long after the
subject has changed clothes. Both refuse a blind reactor.

Three rules follow from a print being permanent and transferable where a DM is
neither:

- **The camera reads as a bystander** (`bystander: true`). No doctor's eye, no
  Seductive — a lens has no medical training. Without it a surgeon could
  photograph their own diagnosis and hand the print to a layman, which is the
  one way that gate could be laundered.
- **A hood photographs as a hood, even one since taken off.** Concealment is
  derived from live equipment, so a plain re-read would unmask somebody
  retroactively; the reaction passes `wasConcealedAs` (the alias the room
  actually saw, off `recentProxies`) and `examineReadout` honours it outright.
  For 🔍 that was one wrong DM; for 📸 it would be a print filed forever under
  a real name nobody present ever heard.
- **One shot per message per photographer.** Nothing is spent, so re-reacting
  would otherwise mint unbounded permanent catalog rows. Photographing the same
  moment twice is the same photo.

**The camera is not spent.** Holding one is the entire gate; film is not a
system anybody asked for. It is not consumable, and `consumeTagRequestImpl`
refuses it by slug as well — a Use button that swapped it for a blank Photo
used to eat players' cameras.

### Four handlers that are now only Discord

`handleGateToggle`, `handleKeyedPrompt`, `handleMoveSubmit` and
`handleWhosHere` hold no game logic any more. Each acknowledges, calls one
`db/lib` function (`gates.js`, `gates.js`, `moves.js`, `whosHere.js`) and
says the sentence that comes back — Chat's dialogs call the same
functions, so a rule can no longer be true on one face and not the other.
The one thing that stays bot-side is the **anchor redraw** after a gate
flips: `refreshLocationAnchor` and `refreshGateRooms` edit Discord messages
the bot owns, and `toggleGate` hands back the two location ids for whoever
has messages to redraw. A web flip therefore leaves the Discord anchor a
click behind until the bot's next redraw or the channel doctor's pass, which
is the cheaper half of the two options — a NOTIFY would have been a second
long-lived listener for one message.

## 6a. The web twins

Every **player** command in §2 now has a web twin in Chat's composer
(`CHAT.md` §5). Typing `/` at the start of the box opens the same list; the
registry is `web/app/(app)/chat/commands.js`, and each entry lands on a server
action in `web/app/(app)/chat/actions.js`.

That matters for three of them in particular. `/conceal`, `/shout` and `/roll`
were **guild-only and Discord-only**, which meant a character on the "web only"
switch (`CHAT.md` §6a) had no way to hide their face, yell, or roll a die at
all. The web is not a second implementation of any of them: the rule was pulled
out of the handler into `db/lib` and both faces call it.

| Command | Rule | Web action |
|---|---|---|
| `/conceal` | `db/lib/conceal.js#toggleConceal` | `toggleConceal()` |
| `/shout` | `db/lib/shout.js#shout` | `shoutHere(text, placeKey)` |
| `/roll` | `db/lib/roll.js#castDie` | `rollHere(placeKey)` |
| `/add`, `/remove` (room half) | `db/lib/roomGuests.js` | `addMember` / `removeMember` |
| `/add`, `/remove` (conversation half) | `db/lib/conversations.js` | the same two |
| `/move` `/travel` `/converse` | already shared | `submitMove`, `TravelNodes`, `ConverseDialog` |

**The bot is rewired.** It was not for a while, and each of those `db/lib`
modules carried a `TODO(rewire)` naming the handler it duplicated. The
handlers call the shared rule now and keep only what is genuinely Discord's:
acknowledging the interaction, resolving the character from the user id, the
place gate off the channel, and — for `/add` and `/remove` — turning the role
picker's choice into a character id.

Three things the drift had cost, for the record, because each was live:

- **`/shout` had two cooldowns.** The bot's was a five-minute in-memory `Map`,
  the shared one an `AuditLog` row (there is no timestamp column on
  `Character`). A player who shouted on Discord and then on the web beat the
  timer once. One throat now.
- **A shout made on Discord reached nobody on the web.** The bot's copy posted
  to channels and wrote no archive row, and the bot's own posts are never
  archived (`bot/src/events/messageCreate.js` skips bot authors), so the shout
  was missing from Chat and from `/archive` both.
- **`/roll` recorded nothing on the bot's side**, for the same reason.

**Where the moment-to-moment three may be used, on either face.** `/shout`,
`/play` and `/roll` run in a **Room or a conversation and nowhere else**. One
predicate says so for both faces — `db/lib/placeKey.js#isScenePlaceKey`, which
takes a place key and answers `room` or `conv`, true; `loc` or `zone`, false.
The bot resolves its channel to a key with `placeKeyForChannel` and asks it;
the web asks it of the key the browser sent.

Two things it rules out. A **zone summary** is a broadcast rather than a place
anybody stands in, so a die cast into one has no audience to see it thrown. A
**Location channel** is the street's scenery — its members hold no Send there
(`CHANNELS.md` §3), and what happens on it happens through the anchor's
buttons — so a voice in one is a voice in a room the game says nobody is
talking in.

Before this the two faces disagreed and neither was right. The bot asked
`resolveChannelContext` for `channelKind === "location"`, which resolves the
same for the street and for every thread hanging off it, so `/shout` and
`/play` worked on the open street; `/roll` had no place gate at all and posted
into whatever channel it was typed in, `#turns` included. On the web the
composer's own `where: ["room", "conv"]` was already right, but a server action
is a public endpoint: `shoutHere` refused only a `loc:` key, so a `zone:` one
fell through and shouted from wherever the character actually stood, and
`rollHere` asked `mayWritePlace`, which counts the summary as speakable.

**`/add` and `/remove` need you INSIDE the private room, not merely at its
Location.** On Discord that gate is implicit — the command is typed into the
room's own thread, and a thread is only visible to a character entitled to it
— so the extraction into `db/lib/roomGuests.js` had to state it. Both faces now
test the same pair: one of `Room.accessTagSlugs` held, or a `RoomGuest` row
for that room (`db/lib/roomAccess.js#roomAccessKeys`). Without it, anybody
standing in the street could have let anybody through a door they could not
open themselves. `web/app/(app)/chat/actions.js#privateRoomHere` applies the
identical test, so the members strip never draws a guest list for somebody
outside the room either.

Two smaller rules on the same pair:

- **A key-holder is not offered in the Add picker.** They are already in, by
  their key, and a guest row written for one grants nothing and cannot be taken
  back — `/remove` refuses a key-holder on purpose ("their key admits them,
  take the key").
- **`/remove` on a conversation takes a living character**, the same `ALIVE`
  gate `/add` applies. A dead character is off the roster on both faces.

## 7. Where the code lives

| File | Role |
|---|---|
| `bot/src/lib/commands.js` | Definitions and global registration |
| `bot/src/events/interactionCreate.js` | Every command, button, select and modal handler |
| `bot/src/lib/turnsConsole.js` | The `#turns` anchor message |
| `bot/src/lib/moveModal.js` | The Move modal |
| `bot/src/lib/locationTravel.js` | The Location picker/drag/confirm rows, the pending-drag map, `performMove` — which picks between a single hop and a walk (`MAP.md` §3c) |
| `db/lib/locationTravel.js` | `performLocationMove` — validation, the cooldown or the Move, dragging (`MAP.md` §3) |
| `db/lib/locationMove.js` | `applyLocationMoveSideEffects` — the Discord half of a move, shared by bot and web (`MAP.md` §4) |
| `db/lib/placeAffordances.js` | **The affordance catalog** — the label and the predicate for every place-bound button, plus `affordancesFor(prisma, character)` for Chat's place panel. Both row builders below read it, so a new button is one entry |
| `db/lib/locationAnchorRow.js` | The anchor buttons as Discord component JSON, styled off the catalog's tones |
| `db/lib/roomStarterRow.js` | A Room starter's buttons, the same way |
| `db/lib/gates.js` | `toggleGate` / `holdKeyedOpen` — the transactional flip and the 24-hour hold, shared with `/chat` |
| `db/lib/moves.js` | `fileMove` — every gate in front of an `Action` row, shared with `/chat` |
| `db/lib/whosHere.js` | `whosHere` / `whosHereLines` — who is standing here, shared with `/chat` |
| `db/lib/examineLocation.js` | `examineLines` — the Examine readout, read by `/chat` |
| `db/lib/roomAccess.js` | `syncCharacterRoomAccess`, `accessibleRooms`, `heldTagSlugs` — private Room membership |
| `db/lib/roomGuests.js` | `addRoomGuest` / `removeRoomGuest` / `roomGuests` — the Room half of `/add` and `/remove`, extracted for the web (§6a) |
| `db/lib/conceal.js` | `toggleConceal` — `/conceal`'s rule, both faces (§6a) |
| `db/lib/shout.js` | `shoutLine` / `shoutParts` / `shout` — what a shout sounds like at N hops, and who hears it (§6a) |
| `db/lib/roll.js` | `castDie` — one d6 as a `SYSTEM` archive row beside its Discord post (§6a) |
| `web/app/(app)/chat/commands.js` | The web twin registry Chat's composer reads (§6a) |
| `bot/src/lib/converseModal.js` | The Converse modal |
| `bot/src/lib/whisperPoll.js` | The 15-minute Room whisper cron |
| `bot/src/lib/moveConfirm.js` | Resolving a Move |
| `bot/src/lib/speakModal.js` | The Speak modal |
| `bot/src/lib/speakTargets.js` | Where a character may speak |
| `bot/src/lib/interactionGuild.js` | Guild/member resolution for DM-run commands, the GM gate |
| `bot/src/events/messageReactionAdd.js` | Every reaction |
