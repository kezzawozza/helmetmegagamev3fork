# Proxying: how a player's message becomes a character's

Every word a character says in Discord is a webhook repost of something a
player typed. This doc covers that pipeline end to end — proxying, avatars,
the reactions that act on a proxied message, concealment, and mentions.

Companion to `CHANNELS.md` (which channels opt in) and `ARCHIVE.md` (where
the transcript is written).

## 1. Which channels proxy

Not configured by hand. A channel opts in **only** by being one of a zone's
provisioned channels, or a special channel whose registry entry says
`tupper: true`:

| Channel | Tupper | Summary |
|---|---|---|
| A zone's `#summary` (text) | yes | **yes** |
| Every Room or Conversation thread under a Location's channel | yes | no |
| `#cerberon` | yes | no |

The special channels aren't tied to a place, so they're never summary.

Two independent implementations of that rule, kept in sync by hand — the
gateway/REST twin pattern (`ARCHITECTURE.md` §3):

- `bot/src/lib/channels.js` — gateway cache.
- `web/lib/discordGuild.js` — `isSummaryChannel` / `isTupperChannel` /
  `listGuildChannels`, REST-based.

There is **no name-based marker**. Channel IDs are checked directly.

## 2. The proxy itself

`bot/src/events/messageCreate.js` auto-proxies every message from a user with
an `ALIVE` character in a tupper channel: `bot/src/lib/proxy.js#sendAsCharacter`
runs the one write path (`db/lib/say.js` — `prepareSpeech`, post, `recordSpeech`),
reposting through a per-channel webhook under the character's name and avatar,
then deletes the original. The gates, the babble and autocorrect passes and the
identity all live in `say.js` now, so a message typed into `/chat` is decided
by exactly the same code (`CHAT.md` §2).

**No bracket or trigger syntax.** Each player has exactly one living character
at a time, so there is nothing to disambiguate.

`sendAsCharacter` sets `allowedMentions: { parse: ["users"] }`. That is
load-bearing for §6: a role mention still *renders* as a chip but notifies
nobody, so the relay DM is the single notification path.

`bot/src/lib/proxy.js#postAsCharacterTo(channel, character, {content, files,
discordUserId, conceal})` is the **core send** — webhook, tracking, no source
message. `sendAsCharacter` is the message-driven wrapper around it, and is the
only thing that deletes an original. The Speak modal (`COMMANDS.md` §5) has no
message to delete, only an interaction, which is why the split exists.

### The original is deleted on every path, including the failing ones

This is the load-bearing rule of the whole file. The game's premise is that a
player's account and their character are separate, and a message left sitting
un-proxied under a real Discord name breaks that premise for everyone reading
the channel. For `/conceal` it is worse still: the text they wanted anonymous,
over their real name.

It used to delete only after a successful send, so anything the webhook
rejected stayed on screen with nobody told — a message over 2000 characters
(Nitro types 4000; the bot's repost still has to fit 2000), an attachment over
the guild's upload limit, a sticker-only message, or a webhook a GM had
deleted. The first three are now refused *before* the send and the rest are
caught after it; either way the original goes and `handBack` DMs the player
their words, in pieces if the reason it failed was length.

**Losing a message is recoverable, and handBack recovers it. Losing the mask is
not.** `sendAsCharacter` returns `null` when it refused, and the delete is
logged rather than swallowed — a swallowed delete is the same leak by another
route.

The webhook cache un-learns an entry on Discord's `Unknown Webhook` code and
rebuilds once, keyed on the error code and never on its message text. The
`WebhookClient` itself is cached too: a fresh one starts with zero knowledge of
the rate limits it is about to hit, so building one per message meant N
simultaneous messages in a busy room fired N blind requests into a ~5-per-5s
bucket.

Every reaction below finds its message by looking the `ArchiveEntry` row up on
`discordMessageId`, so a message the transcript has is a message the reactions
work on — including one posted before the bot last restarted.

`db/lib/discordRest.js#postAsCharacter` is the REST twin, used for staged public
summaries posted from `advanceTurn`'s side effects.

**Speaking without being seen to type.** Discord fires the typing indicator
under the player's *real* account, before the proxy ever runs — so composing
in a channel announces who you are regardless of what the webhook posts. The
Speak flow (`/message`) composes in a modal instead: the text arrives as an
interaction, and there is no typing indicator and no message to delete. It
posts into whichever channel or thread you ran it in — which does not hide the
typing indicator if you were already typing there, but it does stop the message
existing in plain sight under your real name before the proxy removes it. The
🔊 button that used to front this flow is gone; `COMMANDS.md` §5 says why.

**There is no in-memory proxy map.** `ArchiveEntry.discordMessageId` is
unique, so the transcript itself ties a proxied message back to its player
and character: `bot/src/lib/proxy.js#proxyRowFor` reads the row, and a
database row survives a restart where a memory map would not.

### Who is allowed to speak at all

`postAsCharacterTo` is the only funnel a character's words reach a channel
through — ordinary chat, whispers and the Speak modal all end up there. No
slug currently blocks SPEAK (`TAGS.md` §5f, `db/lib/incapacitation.js`), so
that funnel is a gate with nothing standing at it today — its `/shout` twin
(`db/lib/shout.js`) still refuses Bound, Mute, Paralyzed, Unconscious and
mid-Seizure. It used to also refuse Paralyzed, Unconscious and mid-Seizure for
ordinary speech, until that stranded a player with no way to even say OOC that
they were out — the same mistake `mute` had already made once, for the same
reason: silencing the character silenced the person.

**Voice state is read from the sheet, not from the character object handed in.**
Every caller arrives through a different `include` — `messageCreate.js` loads a
*filtered* tag list for identity that does not even select `slug`, and the Speak
modal's `findAliveCharacter` loads no tags at all — so `loadVoiceState` does one
query of its own and hands the result down.

That mismatch was a live bug, not a hypothetical. `speaksBabble` reads
`ct.tag.slug`, so against `messageCreate`'s include it read `undefined` and
returned false every time: **{tag:stupid} had never garbled ordinary channel
chat**, only the Speak modal, which happened to take the old fallback query.
The same round trip now answers both questions. Blocked beats garbled — a
Stupid Paralytic is silent, not babbling.

### The one message replaced by the *bot* rather than a character

A GM pressing Discord's own **New Post** button in a location forum is the
single case where a human's message is re-authored as **Bascinet itself**, not
as a character webhook. `bot/src/lib/questPost.js` deletes the post and
re-creates it verbatim as the bot, tagged **Quest** — see `CHANNELS.md`
§ "Quest posts" for the whole rule. It is hooked into `messageCreate` **before**
`isDesignatedTupperChannel`, which is load-bearing: a GM who also has a living
character would otherwise have that starter message proxied, and deleting a
forum post's starter message destroys the entire post.

### What happens to a message typed while the bot was down

Nothing proxies it, because `messageCreate` never fires. That fails three ways
at once, and the first is the one that matters:

1. **The mask leaks.** The raw message stays in the channel under the player's
   real Discord account — the exact thing §2 exists to prevent.
2. **The web never sees it.** `/chat` and `/archive` render `ArchiveEntry` rows
   and never read Discord, so with no row it is invisible on the site forever.
3. **The turn wipe deletes it**, so it disappears having never been recorded.

`bot/src/lib/messageCatchUp.js` sweeps for these on boot and again whenever the
gateway hands the bot a **fresh session** — the mirror of `feedOutbox.js`'s
drain, which replays web rows that never reached Discord. It is not a rare
case: Railway rebuilds both services on every push, so the bot restarts many
times a day and every restart is one of these windows.

**Under two hours old**, the message is handed straight back to
`messageCreate.execute` and gets the entire ordinary treatment — proxied,
recorded, deleted, mentions relayed. A recovered message is meant to be
indistinguishable from one caught live, and running the same code is the surest
way to manage that.

**Older than that**, the words are written to `ArchiveEntry` with the message's
**real** timestamp and the raw message is deleted, but nothing is posted back
into the channel: dropping an hours-old line into a room that moved on reads as
somebody talking to themselves. The author gets one quiet DM per sweep saying
so. Such a row carries no `discordMessageId`, and `feedOutbox.js#pushRow`
refuses anything whose `source` is not `WEB`, so it can never be posted later.

**There is no cursor and no watermark column.** The ordinary path deletes the
player's message as its last step, so a raw message still standing *is* the
marker of one nobody handled — which also makes the sweep safe to run twice.
The obvious alternative is wrong in a way worth recording: the newest
`ArchiveEntry.discordMessageId` for a channel is the **webhook repost's** id,
minted later than the raw messages still queued behind it, so an `after:`
cursor built from it would skip every older message still waiting — and skip it
on every future run.

Two things bound the damage. A channel where the bot lacks **Manage Messages**
is skipped whole and logged, because reposting without being able to delete
would duplicate the message on every restart until the next wipe. And a
message younger than ten seconds is left to the live handler, which may have it
in hand already.

One thing to know as a reader: `ArchiveEntry.seq` is assigned at INSERT and
`/chat` is cursored on it, so a recovered row appears at the **bottom** of the
live feed whatever its timestamp. `/archive`, ordered by `[sentAt, id]`, puts
it where it belongs. For a sub-minute deploy gap this is invisible; for a long
outage it is the honest cost of not renumbering the cursor the whole feed rests
on.

## 3. Avatars and letter plaques

Profile pictures are stored **as bytes on the row** —
`Character.avatarData`/`avatarMimeType`, resized and compressed with `sharp` at
upload — not in a third-party bucket, and served by the web app itself at
`/api/avatar/<characterId>`. The bot builds a full URL from `WEB_BASE_URL` when
it needs an `avatarURL` for a webhook.

Uploading is gated on `GameConfig.avatarUploadsEnabled` (Dev Panel, off by
default). `AvatarField.js` hides the file input when it's off, but the real gate
is `updateCharacterProfile` ignoring a posted `avatar` field regardless — a
server action is a public endpoint. Flipping the flag changes nothing about
existing `avatarData`.

A character with no uploaded picture gets a **letter plaque**: a teal-tinted
stone tile bearing a blackletter capital of the first letter of their **first
name** — never the honorific or the granted title, so `Sir Alder "the Blind"
Crane` gets an **A**. The 27 tiles (A–Z plus `_default`) live in
`web/public/assets/letters/`, generated by `web/scripts/generate-letters.js`
(`npm run assets:letters --workspace=web`) from
`web/public/assets/background.png` and the vendored
`web/assets/fonts/UnifrakturMaguntia.ttf` — the same face `--font-display`
uses, vendored as TTF because `sharp`'s pango renderer cannot read the `.woff2`
that `next/font/google` caches.

Two things about the generator are load-bearing:

- It **tints in a second `sharp` pass, alone**. Chaining `.tint()` with
  `.modulate()` in one pipeline silently drops the tint and yields a flat grey
  plate.
- It **trims each glyph, then fits it into a fixed box**. Blackletter capitals
  differ enough in width that one point size makes some tower over others.

Output is WebP, matching what an uploaded avatar is stored as — ~145KB for the
set instead of ~1MB as PNG.

**Nothing regenerates an avatar on rename.**
`web/app/api/avatar/[characterId]/route.js` picks the plaque at *read* time from
the live row, so a rename follows implicitly, and an uploaded `avatarData`
always wins so nobody's own picture is overwritten. The `?v=<updatedAt ms>`
cache-buster every caller appends is what gets past the route's `immutable`
header. An accented, non-Latin, numeric or empty initial falls through to
`_default.webp` rather than 404ing.

Every successful proxy (and `/speak`) also touches
`Character.lastActivityTurn` via `db/lib/characterActivity.js#touchCharacterActivity`
— the clock `db/lib/catatonicPass.js` reads to lift the Catatonic (AFK) tag
(and, since the guild-leave rework, to stop the death countdown that runs
while it's held — `TURN-ENGINE.md` §2 7b).
It's a separate write from the `ArchiveEntry` above on purpose: the archive
row is best-effort and a ❌ reaction deletes it outright, neither of which
should un-flag the activity that already happened.

## 4. Reactions on a proxied message

All in `bot/src/events/messageReactionAdd.js`. Every one of them looks the
message up as an `ArchiveEntry` row by `discordMessageId`
(`bot/src/lib/proxy.js#proxyRowFor`) and checks the reactor against that
character's own player — so a restart no longer makes an older message inert,
and a **five-minute window** (`db/lib/say.js#EDIT_WINDOW_MS`) applies to ✏️ and
❌ on both faces. Past it: *"That was said more than five minutes ago and
stands."*

| Emoji | Does |
|---|---|
| ❌ | Soft-deletes the row; `bot/src/lib/feedOutbox.js` removes the Discord message. Owner, or a GM (who is not held to the window). |
| ✏️ | Edit, via a DM button and a modal — see below. The modal writes the **row**, through `editSpeech`, and the outbox carries the change to Discord. Owner only. |
| 🔍 | Inspect embed, as of that line — see §5. Same readout as **Look at** on `/character` (§4a). |
| 📸 / 📷 | The same readout, as of that line, frozen onto a **Photo** tag in the reactor's hands. Needs an Instant Camera, which is not spent. `COMMANDS.md` §6. |
| ⭐ | Saves a personal `Note` — see §7. |
| 🌫️ | GM-only fog. |

DMs no longer carry any reaction-driven flow; the bot does not request the
`DirectMessageReactions` intent.

### 4a. 🔍 has a twin on the web: **Look at**

`db/lib/examine.js` is the one readout behind both, and neither surface
builds its own. The bot maps it to an `EmbedBuilder`, the web app to JSX
(`web/app/components/ExamineDialog.js`), but every rule that decides *what is
in it* — the doctor's eye, the concealed read, the Role — is
decided once, in that file. Add a field to one and both get it. (The ⬢ figure
is the one thing that used to be in it and is not: it rode on sharing a faction,
and with factions gone only a GM reads it.)

**The Role is in it again, for most seats.** `Role.examineVisible` decides —
true for nearly everybody, false for the two Brigands and the two Tribunal
seats, who read as having no seat at all (`CHARACTERS.md` §2). A hood carries no
Role for the same reason it carries no name. A photograph carries it: the same
readout builds `db/lib/photo.js#photoCaption`, so the prose frozen onto the
Photo tag says what the modal says.

**They no longer differ in who they can be pointed at.** They used to: 🔍
hung off an archived row and so only ever reached somebody who had **spoken**,
while Look at reached anyone standing at your Location, silent or not. That
asymmetry was argued for — a guard on a gate should be able to size up a
traveller without striking up a conversation first — and it went the other way
in the end. A silent stranger is a stranger. Sharing a room with somebody
should not hand you a reading of them, and a dialog that listed everyone
present was a presence oracle besides.

So every look now needs a **line**, and answers for the identity that line was
said under (§5a). One function does it: `db/lib/examineRow.js#examineRow`,
pressed against an `ArchiveEntry.seq` rather than a character id. That is what
lets a hooded line carry an eye at all — the server resolves the speaker, so
the page can offer the look without ever being told who is under the hood, and
the hood token in `db/lib/whosHere.js` is no longer what a look is keyed on.

**And it answers for the whole of that moment, not just the identity.** The
name, the face, the appearance, the gear, the wounds and the Role all
come off `ArchiveEntry.presentedState`, frozen at send time beside the alias
and the face (`db/lib/examineSnapshot.js`). One rule decides every question
about what is frozen and what is not:

> **Character-side frozen. Catalog-side live. Viewer-side live.**

What the room could *see* of somebody is frozen. What a tag *is* — its name,
its armour value, what it costs to treat — is read live off `Tag`, because
that is a rule rather than a disguise and a rebalance should reach an old line.
And nothing of the looker's own is ever frozen: the doctor's eye, Seductive,
the officer's seat and a Thanati's sight are faculties you have *now*.

A row written before that column falls back to the live character, which is
what every row did before. It is never backfilled — stamping today's state onto
yesterday's line is the bug, not the fix.

A look also reaches back exactly as far as Chat itself renders, and no further
(`db/lib/feedWipe.js`). A seq is a guessable number and these are server
actions, so without that floor a player could hand one any line ever said in a
place they can currently read — the whole history of a radio net, which is
audible from anywhere.

Five surfaces, one implementation: 🔍 and 📸 in Discord, the eye on a row in
the web feed, the eye in the HERE column, which points at the last line it
watched that person say, and the web's own camera. All five read a hood the
same impoverished way (§5), all five are free, spend no Move, file no
`AuditLog` row and tell the subject nothing.
`web/app/(app)/character/examineActions.js` is the sheet's half, and its picker
lists who you have heard rather than who is nearby.

The web camera was the fifth late, and was a second copy until then — its own
row fetch, its own place gate, its own subject load, its own readout. The
copies had drifted twice over: it told a hood from a forced name by whether
`concealedAlias` was set rather than by `wasHooded()`, so a Disguise Kit
photographed as an impoverished hood on the web and as an ordinary read in
Discord; and its sight gate was Blind alone where the eye's is the full
`examineBlock`, so a nearsighted player could not look but could photograph.

**✏️ is a button and a modal, and writes no inbound DM at all**
(`bot/src/lib/editModal.js`). A reaction carries no interaction token, so a
modal cannot open straight off ✏️. The path is: reaction → a DM carrying one
"Edit text" button → the click is an interaction → modal, prefilled with the
current text. `edit:open:<messageId>` opens it, `edit:send:<messageId>`
submits. The prompt DM is `kind: QUIET`, so no GM surface shows it.

`handleEditOpen` must **not** ack first — `showModal` is the acknowledgement.
The prefill comes from an in-memory stash armed when ✏️ is pressed, not from a
REST fetch, because a fetch could blow Discord's three-second window and there
is no deferring your way out of it. Both handlers run in a DM, where
`interaction.guild` and `.member` are null, so ownership is
`interaction.user.id` against the row's own character
(`bot/src/lib/proxy.js#proxyRowFor`). After a restart the stash is empty and the
box prefills from the row's text instead of refusing.

**Why it stopped being a DM collector.** ✏️ used to DM "Reply here with the
new text (60 seconds)" and eat the answer with `awaitMessages`. Sixty seconds
is not enough to retype a paragraph, and nothing was prefilled, so the player
rewrote the whole post from scratch. Worse, every one of those replies was
logged as a `DirectMessage` — about 21 a day — and a long in-character post
sitting in the GM inbox reads exactly like mail. A first fix tagged them
`source: "prompt_reply"` via a `pendingPrompts` map so the desks could skip
them; the tagging worked, but the rail badge in `web/lib/navItems.js` had no
noise predicate at all, so it still counted every edit. The map and its
source are gone now that the flow produces no DM to tag, and `prompt_reply`
is not read by anything either: the `dm_kind` migration reclassified those
historical rows as `kind: QUIET`, so they stay off every GM surface without a
filter naming them. Which rows a GM sees is `DirectMessage.kind` now
(`db/lib/dmKinds.js`), written by `sendDm` rather than remembered by whoever
adds the next DM — see `PLAYER-DESK.md` §5.

`/conceal`'s prompt never needed any of this; it is plumbing like the rest,
and the player retypes in the channel.

The bot needs the `MESSAGE_CONTENT` privileged intent for any of this
(Developer Portal → Bot → Privileged Gateway Intents), alongside `GuildMembers`.

## 5. Concealed identity (`/conceal`)

Concealment is a property of **what is over your face**. `Character.concealed`
is only the player's wish, flipped by the `/conceal` slash command (registered
everywhere, the bot's DMs included) or the switch beside turn-ping on
`/character`; it takes effect solely while a `Tag.concealsIdentity` item is
**equipped**. While it is in effect, every message the character sends — typed
into a channel or through the Speak modal — is reposted under an anonymous
alias instead of the name, and **Who's here?** on a Location's anchor lists
them under that alias too (`CHANNELS.md` §4). The old per-message `/conceal`
text prefix and the Speak modal's checkbox are gone: a player who wants to be
unnamed is unnamed until they say otherwise.

**A hood hides WHO you are, not THAT you are standing there. It costs you
your name and nothing else.** That is the whole rule, and every people-picker
in the game now follows it.

It did not always. `hereWhere` in `db/lib/presence.js` used to drop a concealed
character from most rosters, on the reasoning that Heal, Loot, Bind, Free, Harm,
Kiss, Learn, Teach and Confess act on an **identity** and that naming somebody
to heal them would undo the thing they put the helmet on for. The verbs came off
that rule one at a time — Attack, Bind and the rest of the body verbs, then
Search — and Heal and Loot were the last two held back, with this reason written
into `presence.js`:

> their pickers carry the target's tag list, and an inventory or a wound list
> identifies a person nearly as well as a name does

Two players found the end of that argument the hard way: a man in a closed
helmet could not be treated, could not be dosed, could not be handed a cure, and
could not have his pockets gone through when he went down dying. **A hood made
you immortal by neglect.** The reasoning had also been overtaken — §6a below
already prints a hood's visible ailments and visible gear on the 🔍 embed, and
`SEARCH.md` already lets you go through their pockets. Concealment hides the
identity, not the inventory; that line was true on one surface and denied on two.

**So: one roster, in two halves — and ONE predicate splits it.**
`rosterHere` in `web/lib/peopleHere.js` takes `presentRows`' answer and sorts the
rows into named and hooded, and `web/lib/peoplePools.js` composes both into every
picker on `/character` and `/chat`.

The single predicate is the load-bearing part, not a tidiness point. The first
version of this split with `hereWhere`'s SQL on one side and `presentRows` on the
other, and those two disagree in both directions: a body that died in a helmet
came back in the NAMED half under its real name and its real id (hereWhere's dead
arm knows nothing about `deathMaskTagId`) *and* in the hooded half under its
alias — the same inventory listed twice in one Loot dropdown, one row of it
holding the id that `/api/avatar` answers with a face. Speaking hooded and then
unconcealing put a living player in both halves the same way, alias beside real
name; doing it the other way round dropped them out of both — Heal, Miracle, Loot, dosing, administering a cure, Bind, Free,
Crucify, Shackle, Torture, Harm, Mutilate, Brand, Attack, Search, Transfer,
Converse, Learn, Teach, Confess, Kiss, and letting somebody through a door.
`pickerName` and `pickerKey` beside it are the only two places that have to know
which half a row came from.

Two of those deserve a note, because their answer is narrower than "yes":

- **Heal and Miracle** show a hooded patient only the wounds the reader could
  actually see — `medicallyVisibleTags(tags, satisfied, false)` in
  `db/lib/medicalVision.js`, which is the same rule the 🔍 concealed embed
  follows, so the two surfaces cannot disagree. Visible afflictions, plus
  whatever this medic's own training lets them diagnose, and nothing else. A
  Saint gets the bystander read alone: sainthood is not a medical training.
  `healCharacterRequestImpl` re-checks it, because a picker is a hint.
- **Kiss** goes in with everything else and comes straight back out, because
  `kissBlock` refuses a covered face. That is deliberate rather than a special
  case: one rule for the whole roster means the day a concealing item leaves the
  mouth free, nothing has to change.

**What still turns on a name, and must:** the `@`-mention directory
(`web/lib/mentionDirectory.js`), the command palette, an arrest warrant
(`db/lib/wanted.js`) and Intercept's `matchesArrival` (`db/lib/intercept.js`).
Those **name** somebody rather than act on a body in front of you, and naming a
hood is the unmasking. Both of those files say so in their own headers.

Every picker hands the browser a **hood token** instead of a character id — an
HMAC of the id under `AUTH_SECRET` (`db/lib/whosHere.js#hoodToken`), posted
back as `hood:<token>` and resolved by `resolveHoodToken`, which re-queries who
is actually standing at the caller's Location and re-derives concealment from
their tags. So a token names somebody in the room you are in and nobody
anywhere else, and a stale one resolves to nothing. The id never crosses the
wire, because `/api/avatar/<id>` takes an id and answers with a face — shipping
one IS the unmasking, whatever the page chooses to draw. `rosterHere` strips the
id and the real name on the way out rather than never selecting them, so a pool
cannot leak one by writing its `select` carelessly.

**One resolver turns a key back into a person**, `db/lib/targetKey.js`:
`character:<id>` for somebody in the open, `hood:<token>` for somebody in a
mask, and `resolveTargetKey` is the one place it happens.
`web/lib/hereTarget.js#resolveHereTarget` wraps it with the `isHere` re-check
and — this matters — blanks the refusal for a hood key, so a "no" never prints
the name the helmet was bought to hide. `resolveParty` in
`character/actions/shared.js` knows both shapes too, which is what lets a masked
stranger pay for a cure. `allowConcealed` is not "the one caller" of anything
any more; it is on for every verb that acts on a body.

`whosHere(..., { withHoodIds: true })` adds a server-only `hoodIds` map —
token to character id — for the callers that have to filter hoods by id before
offering them. A sibling key rather than an id on the rows, because those rows
go straight to a browser.

**One function decides who is hidden**, `presentRows` in the same file, and
`resolveHoodToken` reads it too. It did not, and that was a bug players could
reach: the lists judge by your **sighting** (what you last heard somebody
called), the resolver judged by the **live** row, and the two disagree the
moment a hood takes the helmet off. You would see "a young man" in the
dropdown, hand him a coin, and be told "Unknown recipient." about a man
standing in front of you. `db/test/whosHere.test.js` pins both halves.

Before this, a rider who spent the game masked had to take the helmet off to be
invited into a conversation or handed a toll, which is the whole disguise
undone at the door.

**It is not open to everyone.** With a bare face there is nothing to toggle and
both surfaces refuse. This is `Tag.concealsIdentity`, which sat inert in the
catalog for a long time and is now the gate it was always kept for.

`Tag.forcesConceal` is the stricter version, and the difference is the whole
point of the pair: a hood is a choice, a sack tied over the head is not. While
a forcing item is equipped the character is concealed whatever the column says,
and **both toggles refuse in both directions** — there is no choice to make, so
the stored preference is left alone and comes back when the thing comes off.
Being **Bound** blocks unequipping entirely (`TAGS.md`), which is what makes a
sack worth tying on.

**A body keeps whatever was over its face when it died**, and that needed one
stored column to work at all. Death unequips everything
(`db/lib/characterDeath.js`), and concealment only ever counts an EQUIPPED
mask — so dying used to take your hood off, and a masked man who went down was
listed in the room's Loot menu under his real name a moment later. Killing
somebody was the reliable way to learn who they were.
`Character.deathMaskTagId` is the memory of the piece, stamped just before that
unequip and only when the hood was actually in effect. The reading stays
derived, though: a body counts as hooded **only while it also still holds that
tag**, so looting the helmet off a corpse gives it a face back with no second
write and no catch-up pass. A gib keeps nothing — the tags are vaporized. A
revive clears it. `presentRows` takes `includeDead` for the verbs that may name
a body, and `resolveHoodToken` takes it too, so Loot can reach one and Heal
cannot.

Concealment is otherwise **derived at read time**, never written. Nothing has to
happen when a mask is put on or taken off, no catch-up pass exists, and a row
left `concealed: true` after the mask came off simply resolves back to the real
face on its own. `concealmentFrom(tags)` in `db/lib/presentedIdentity.js` is the
whole of it, and `CONCEALMENT_TAG_FIELDS` beside it is the field list every
call site selects — miss one and concealment silently stops working at that
surface only.

Because it resolves back on its own, **the stored wish is never overwritten on
the player's behalf**. The switch on `/character` is drawn `disabled` whenever
there is nothing to toggle, and a disabled checkbox posts nothing, so
`updateCharacterProfile` leaves the column out of the write entirely rather
than reading a missing field as "off". It used to read it: take a hood off for
a moment, save the Bio card for any other reason — the appearance, the turn
ping, **Play from the web** — and the hood no longer worked when it went back
on, with nothing said and no way to set it again from the page that broke it.

**The relay is the other half, and it has to pass the answer through
unchanged.** `db/lib/discordRest.js#postAsCharacter` is the REST twin of
`bot/src/lib/proxy.js#postAsCharacterTo`, and it is the path every line typed
on `/chat` takes to Discord. It used to keep a concealment only when the gear
*forced* it, and override `Character.concealed` to match, on the reasoning that
the player's own `/conceal` choice was not that path's business. It was: a
voluntary hood was resolved correctly into the archive row and then posted to
the channel under the speaker's real name and real face, so the hood worked on
`/chat` and did nothing on Discord. `db/test/presentedIdentity.test.js` holds
the invariant now — a hood somebody chose conceals exactly as hard as one tied
on for them.

The slash command only flips the column and replies; the message itself still
rides the ordinary proxy path, so ✏️/❌/⭐/🔍 all behave unchanged.

The alias comes from `db/lib/concealedIdentity.js` (pure, in the barrel beside
`characterName.js`):

- `Young` / `Old` / nothing, from `Character.age` — under 25, 55+, nothing
  between, nothing when age is null.
- `Man` / `Woman` / `Person`, straight off `Character.gender`. NEUTRAL reads
  Person.

**This used to be inferred from the title**, which meant an untitled character
was always "Person" however they present, and so was a Censor. Gender is a
real column now (`CHARACTERS.md` §1c), so the alias simply says it: an untitled
woman conceals as "a young woman". Concealing hides the name, the face and the
seat — it was never meant to hide how someone presents, which is what the
line above has always claimed it carries.

The alias is frozen into `ArchiveEntry.concealedAlias` at send time, so a later
gender correction never rewrites the archive. That is correct: it records who
someone was as they were known then.

The avatar is the concealing item's own `Tag.concealSprite`, served straight
out of `public/` as `/assets/helms/<sprite>.webp` and **identical for every
wearer of that item** — a per-character concealed avatar would be a
fingerprint. The sprite says *what* is over the face, never *who* is behind it,
so a room full of Tribunal helmets is a room full of identical Tribunal
helmets. Two things follow: no per-character render, and no cache-busting,
because the file never changes.

`syncTags.js` refuses a `concealsIdentity` tag with no sprite, and refuses a
sprite naming a file that isn't there — a typo would otherwise stay invisible
until somebody equipped the thing in play and Discord served a broken image.
The images are built from the source sprites in `web/assets/helms/` by
`npm run assets:helms --workspace=web`; `PORTRAITS.md` covers the sizing.

When two concealing items are worn at once, the **outermost** wins — highest
`Tag.equipLayer` — because that is the one an onlooker can actually see. A coif
under a knight's helm is a coif nobody can see.

`web/public/assets/unknown.png` is gone. What replaced it is the **question-mark
plate**, drawn in CSS by `web/app/components/CharacterAvatar.js` under the
`unknown` prop — the same circle a faceless row has always drawn, holding a
literal `?` rather than the first letter of a name, because one letter is
enough to tell two hoods apart. It stands for a face you have not been shown:
an archived line said before `ArchiveEntry.presentedAvatarPath` existed, a note
starred before `Note.presentedAvatarPath` did, and — the common case — somebody
standing in the room you have not watched speak. Where a real URL is needed
instead, because Discord cannot render CSS, the blank letter plaque
`/assets/letters/_default.webp` stands in.

**A sprite is not published by presence.** The mask is what somebody looks like
*while you are watching them speak in it*, and drawing it in the HERE column
for anybody who walked into the room announced a cult meeting to the first
person through the door. So a face and an eye are earned: see §5a.

The row records the alias it was posted under (`ArchiveEntry.concealedAlias`),
which holds a forced name as well as a hood's, so reading a line back means
telling the two apart. `presentedIdentity.js#wasHooded` is the one answer, and
both faces ask it — `proxyRowFor` here and `db/lib/examineRow.js` for the web's
Look at. It reads only what the ROW froze at send time: the
`presentedAvatarPath`, since a hood wears the concealing item's own sprite
under `/assets/helms/` and nothing else does, and failing that the alias
itself, since a hood's can only ever be one of the nine
`concealedIdentity.js#CONCEALED_ALIASES` can build.

**This used to compare the alias against the character's *current* forced
name**, which was right until the name went away — and one of them is built to.
A Disguise Kit lasts three turns and is swept at turn advance, so after it
expired every line the character had spoken under it flipped to reading as a
hood, on both faces at once. The live forced name is still passed, but only as
the tiebreaker for a row too old to carry a face whose forced name happens to
read like an alias; an ambiguous row reads as a hood, which is the safe
direction. Three handlers read it:

- **🔍** returns a **hardcoded** embed *before* any of the normal field logic:
  the concealed line, plus only the visible ailments and the visible gear —
  the same `seenByBystander()` gate the ordinary embed uses, so a `visible:
  worn` dagger shows here exactly when it is drawn (`TAGS.md` §5). Concealment
  hides the *identity*, not the inventory. No appearance, name, Desire, or
  Resources, even for a viewer whose gates are open. "Ailments" resolves as
  `tag.category === "Health"` — Health is its own category now (`TAGS.md` §5c)
  and so *is* the ailment set, which is what this used to reach for the
  `status-health` group slug to approximate. Mind the capital: `Tag.category`
  stores the display name, not the YAML slug. The doctor's eye below does
  **not** apply here — a concealed subject stays deliberately impoverished, and
  a surgeon reading a hood is still just reading a hood.
- **⭐** files the alias in `Note.characterName` rather than the real name.

The unconcealed 🔍 path carries one rule worth knowing here, described in full
at `TAGS.md` §5c: **an affliction you could treat as routine is one you can
see**, even when it's `visible: false` to everyone else. A medic inspecting
someone gets their Appendicitis; the man beside them gets nothing. Those rows
are marked `· your diagnosis`, because the patient isn't showing it to the room
— repeating it aloud is saying something nobody else could know.
`db/lib/medicalVision.js` decides it, and a cure needing a Gambit stays hidden
even from an Expert, since guessing isn't diagnosing. Those Health rows are
also the only ones that print what the tag costs (`TAGS.md` §5) — everything
else on the embed is a bare name.

The **Desire** field on that same embed is bought by exactly one tag, the
Demoness's Seductive (`db/lib/inspectVision.js`). A subject with no active
Desire renders `Nothing you can read.`, so the field never reports more than
it has. Mindreading buys no field at all: it reads a Desire on a
Gambit after a conversation, and that is the GM's call, not the bot's. Being
free and silent is what the Demoness tag is paying its extra point for.
- **✏️/❌** are unchanged; both already gate on `proxy.discordUserId`.

The archive records **both halves** — `ArchiveEntry.concealedAlias` alongside
the real `characterId`/`characterName` — so `/archive` renders
`Young Man (Sir Alder)`. That is one more surface where concealment is
undone, and it is fine that it is: `/archive` is GM-only, always
(`ARCHIVE.md`), and a GM could already see through `/conceal` everywhere
else.

### Forced identity (`Tag.forcedName`)

The opposite case: a held tag that **fixes** the name and face rather than
hiding them. Apex Form carries `forcesName: Beast` (`TAGS.md`, "`forcesName`").
`db/lib/presentedIdentity.js` is the one resolver, and every surface above
calls it instead of branching on `concealed` by hand:

```
presentedIdentity(character, { forcedName }) -> { name, avatarPath, alias, concealed, forced }
```

Precedence is **forced > concealed > own name**. A forced identity posts under
the forced name with the static plaque `/assets/letters/<Initial>.webp` — not
`/api/avatar`, so nothing about the character's real face is ever fetched for
it. `alias` is "the name the room saw when it was not the real one" and is set
for both a hood and a forced name; it is what `recordArchiveMessage` freezes
into `concealedAlias` and what ⭐ files under. `concealed` stays true only for
a real hood, so the impoverished 🔍 embed and the no-relay rule below keep
applying only to hoods — a Beast is not hiding.

Call sites that already hold `character.tags` use `forcedNameFrom(tags)`; the
two proxy paths that load a bare `Character` (`messageCreate.js`, the Speak
modal) run `loadForcedName(prisma, id)`, one indexed query. The REST twin
takes `forcedName` from its caller in `db/index.js`, since `discordRest.js`
has no prisma of its own.

While a forced name is held, `/conceal` refuses and the switch on `/character`
renders disabled; `updateCharacterProfile` writes `concealed: false` whatever
the form posted, and drops any upload.

**The @-mention role follows the forced name.** This
used to say the role kept the real bare name on purpose, and the Disguise Kit is
what changed the answer: a disguise's whole job is to put somebody behind a
false name, and a scene where the false name is in the prose and the real one
is in the `@`-token beside it is not a disguise. So the role is titled after
the forced name, and — the load-bearing half — **coloured by it too**
(`db/lib/characterRoleAppearance.js`). `hashNameToColor` is deterministic, so
titling by the false name while colouring by the real one would leave a stable
per-character swatch beside every disguise that character ever wore: a
fingerprint that survives the thing meant to hide them, which is worse than not
renaming at all. The `/add` picker names a Beast as Beast.

**A hood renames nothing.** `/conceal` presents as "Young Woman", which is a
description rather than a name — a guild of identical `@Young Woman` tokens is
unmentionable in practice, and concealment is already answered by the rule that
a concealed message relays nothing at all (§6). Only a forced *name* moves the
role.

**The member sidebar no longer undoes it.** This used to read as a known hole:
the nickname sync wrote `Rowan | Sir Alder`, so anybody could pair that against
`@John` and see through the disguise. The game stopped writing nicknames
entirely (§8), so there is nothing left there to pair against — whatever a
member's nickname says is something they chose themselves.

There is a **grant path** now, where there used to be none, and it is a
reconcile rather than a hook: `db/lib/characterRoleNames.js` asks Discord what
the roles are called and PATCHes only the ones that disagree, run from
`advanceTurn` beside the Catatonic pass's own role updates and merged with them
so one role is never edited twice in a turn. The reason it is not a hook is
arithmetic — a `forcedName` tag can arrive or leave through the Disguise Kit,
an early drop, `advanceTurn`'s bulk expiry `deleteMany` (which has no
per-character seam at all), a GM grant or revoke, a trade, a loot, a corpse
strip and a Restart. That is eight or more generic tag writes, none of which
knows a Discord role exists. One comparison covers all of them and costs
nothing in a steady state. The Disguise Kit action also calls
`ensureCharacterRole` directly, because a disguise that only takes hold at the
next turn roll is a disguise that did not work when it was put on; taking one
*off* waits for the pass. It is capped at 25 renames a turn so a Restart cannot
spend the guild's role budget in one go.

### 5a. A face and an eye are earned

Presence is public. **Who** is standing in a room is not a secret and never
was: the HERE column on `/chat` and the **Who's here?** button both list
everyone there, hooded or not, under the name or the alias they are wearing.

What is over somebody's face is a different question, and the two used to be
answered together. The column drew every concealed person wearing their own
`Tag.concealSprite`, so opening it in the Underquarter announced *two silver
masks are standing here* — which is precisely what a Thanati in a basement is
not supposed to broadcast. Standing somewhere silently should not publish what
you are wearing.

So a **sighting** is what buys a face, and the same sighting is what buys a
look. `db/lib/sightings.js#lastSightings` answers it:

> You have seen a character **this turn** if a line of theirs sits in a place
> your own feed shows you, in the open turn.

The scope is `db/lib/feedAccess.js#placesFor` — anywhere you could read it, not
only where you are standing, because you did read it. Sightings die with the
turn, and nothing stores them: they are two queries over `ArchiveEntry`, which
already froze both halves of a presented identity at send time.

**What you saw is frozen, and that is the whole of it.** The name, the face,
the appearance, the gear and everything else Examine answers for all come from
the LINE you saw, never from live state. Somebody who chats bare-faced and then
pulls a mask on in private is still listed under their own name with their own
face until the turn rolls — a hood put on after you heard them speak does not
protect them from you. It follows that a sighting decides which of `whosHere`'s
two lists somebody lands in, rather than their concealment now.

That sentence used to be true of the name and the face and false of everything
else, which is how the hole players found worked: a Thanati could chat
bare-faced in Town, walk two zones off, robe up and start a rite, and anyone
who scrolled back to the Town line and clicked the eye saw the robes. The look
read the *character*, live, and the character had moved on. Now the row carries
what the room could see of him (`ArchiveEntry.presentedState`, §4a) and the
look reads that instead. Gear picked up after the fact no longer appears on a
line said before it, the same way a mask does not.

The Role rides in the payload's `rt` alongside all that, and is **written only
when the seat is one a look may read** — an opaque seat's title is not in the
row at all, so it cannot come out of a database read or an exported archive
packet either. A line said before the key existed carries none, and is never
backfilled: rewriting a frozen line is the thing the freeze exists to prevent.

Mentions follow the same rule, and used to break it in miniature: a `{char:…}`
kept the name the row froze, but the little portrait beside it was drawn from a
directory rebuilt live, which dropped anybody currently masked. So the face on
an old mention winked out the moment its subject pulled a hood on anywhere in
the world and came back when it came off — a mask detector readable by anybody
who could see any line that ever named them. Nobody is dropped from that list
now (`web/lib/mentionDirectory.js`); the frozen name in the token is what
decides whether a face is drawn.

**And the face the chip draws is the PRESENTED one.** `CharMention`
(`web/app/components/messageTokens.js`) used to hand `CharacterAvatar` only a
`characterId`, which builds `/api/avatar/<id>` — a route that is deliberately
identity-blind and serves the real portrait whatever is over it. The frozen-name
check was the only gate, and it only ever caught a **rename**: pulling a hood up
never touches `Character.name`, so the chip printed the correctly-hooded name
beside the true face. The directory now carries the presented `avatarPath` and a
`hidden` flag, both straight off `presentedIdentity()`, and the chip passes that
path through — a hooded or forced-name subject falls to the question-mark plate
instead. The **name** text is untouched: a row records who somebody was as they
were known then.

Four states, and only the eye's absence marks the difference in the column:

| | you have heard them | you have not |
|---|---|---|
| **under a name** | their face, and an eye | their face, no eye |
| **under a hood** | the mask you saw, and an eye | the question-mark plate, no eye |

An unseen named row keeps its own face because there was never anything to hide
there. The eye is *absent* rather than greyed: the row already drops it for
yourself, so that is one rule instead of two, and a disabled eye would need a
sentence explaining itself.

Your own row is always seen. Nobody should have to speak to learn what they
look like.

**Discord needs none of this** and is unchanged. Its list is text with no faces
in it, and 🔍 has always required the subject to have spoken — so
`whosHere(..., { withSightings: true })` is opt-in, and only the web asks.

## 6. Mentions and conversations

A character's personal Discord role is a **mentionable name token and nothing
else** — held by nobody, granting nothing (`CHANNELS.md` §3). `Character.discordRoleId`
is `@unique`, so a mentioned role id resolves straight back to one character.
While the character is Catatonic (AFK, or their player left the guild —
`CHARACTERS.md` §5), the token itself says so: the role
reads `<name> • Catatonic` in flat grey, renamed by the turn pass (or the
leave handler, on the spot) and
restored the moment they act — composed only by
`db/lib/characterRoleAppearance.js`, which is also what `ensureCharacterRole`
uses, so a profile save mid-catatonia keeps the suffix. Mentioning the
renamed role still resolves normally; the id never changes. Mentioning a GM/spectator/player role resolves to nothing
and is silently ignored.

`bot/src/lib/mentions.js` owns both things a mention does;
`bot/src/events/messageCreate.js` calls it after proxying.

### The row spells it differently, on purpose

Since Chat's phase 6, `<@&roleId>` is **Discord's** spelling and the
archive row stores a face-neutral **`{char:<id>|<Name>}`** instead — the same
inline token syntax the web renders everywhere else
(`web/app/components/richTokens.js`). `db/lib/characterMentions.js` is the pair
of translations, and neither face ever sees the other's:

- **In.** `db/lib/say.js#prepareSpeech` returns two strings for a Discord-origin
  send: `content`, which is what the webhook posts (unchanged, or the chip the
  player meant becomes literal text), and `rowContent`, with every mention that
  names a character role folded into a token. `recordSpeech` stores the second.
  `editSpeech` runs the same rewrite, so a ✏️ that adds a mention lands the same
  way.
- **Out.** `bot/src/lib/feedOutbox.js` rewrites tokens back to `<@&roleId>`
  when it posts or edits a WEB row, and DMs the relay — the same "where and a
  jump link, never the text" DM this section describes, through
  `db/lib/dm.js#sendDm` rather than the gateway twin, because the outbox is a
  pg listener with no discord.js client. Same earshot rule, same ten-target
  cap, and a **concealed** send still relays nothing at all.

Only a role id that IS a character's name token is ever rewritten —
`Character.discordRoleId` is `@unique`, so the lookup answers with one
character or with nothing. A GM/spectator/player role passes through
untouched, exactly as it always has.

### The token carries the name it was sent under

The half after the `|` is the name the room heard, frozen at send time.

Everything else about a row's identity was already frozen —
`ArchiveEntry.characterName`, `.concealedAlias`, `.presentedAvatarPath`
(`db/lib/archive.js`). The mention was the exception: it resolved live against
the roster on every render, which made a past sentence editable by its own
subject. A Mulligan rename renamed somebody in every line that had ever named
them, and putting a hood on collapsed all of those to "someone" — retroactively
erasing a name that was public when it was said. A row records who someone was
as they were known then, and that rule now covers the people a speaker named as
well as the speaker.

**In the token rather than a column beside the row**, because the text gets
copied. A ⭐ lifts a body into `Note.content` (both star paths do, and the
Discord one never reads the `ArchiveEntry` for its text at all), and a journal
entry is its own store. A sidecar would have needed a column on three tables
and hand-carried copy code down every path, where a missed one falls back to
live resolution — which is the bug. A name in the token travels with the words
for free, and needed no migration.

The name written is the **presented** one (`db/lib/presentedIdentity.js`):
forced > concealed > own. A row must never print a name the room could not have
heard, so a hooded target mentioned from Discord — where any name role can be
pinged — freezes as `Young Woman`, and a Beast freezes as `Beast`.

`stampMentionNames` runs on both faces and **overwrites** whatever is there.
The web composer writes the name in as it inserts the chip so the draft reads
right, and a server action is a public endpoint, so a posted
`{char:<victim>|Some Fake Name}` is a claim until the server re-resolves it.
`freezeMentionName` strips `{`, `}` and `|` and caps at 64 — a disguise name is
player-typed and `normalizeDisguiseName` only collapses whitespace, so a
character called `Bob}` is reachable today and would otherwise break the
grammar.

An **edit** re-stamps the whole text, so a mention added by a ✏️ freezes as of
now. That does re-date a mention the edit kept; the edit window is five
minutes, and the alternative is diffing two strings to work out which tokens
are old.

A token with **no `|`** was written before this existed and resolves live,
exactly as it always did. There is deliberately **no backfill** — stamping
today's names onto old rows would perform the retroactive rewrite this exists
to prevent, once, in bulk, and permanently.

On the way out, a token whose character has no role falls back to printing the
frozen **name** as plain text rather than the raw braces. Braces were the best
answer available while the token held nothing a human could read.

Two things scan a row for a mention — the unread dot (`feedStore.js`) and the
feed's own mention gate (`web/lib/feedAccess.js`) — and each used to build
the string itself. They go through `mentionsCharacter`
now (`db/lib/characterMentions.js`, and a client twin in `richTokens.js`),
which knows both spellings: a widened grammar otherwise stops matching at one
call site and not the others, and the failure is silent.

The composer on `/chat` writes tokens directly, over an `@` autocomplete of
`whosHere().named`: you can only name somebody you can see, and a row only
renders a name its reader could have seen too (CHAT.md §5).

### The `@` menu opens inside `/ooc` and `/shout` too

The composer's `@` list used to be switched off for the whole of **command
mode** along with the slash list — and Speak, Shout and OOC are one control
driving that same mode (`Feed.js`, the speech-mode strip), so pressing **OOC**
silently disabled the `@` key in a box that looked identical to the one beside
it. What went out was the literal text `@Alice`, which nothing downstream can
rescue: `stampMentionNames` rewrites tokens and `rolesToTokens` rewrites real
`<@&roleId>` entities, and neither does a free-text name lookup.

A command opts in with `mentions: true` in `web/app/(app)/chat/commands.js`.
Only the two that put words in a room have it — a `/move` description or a
`/look` target is not a place to mint a character chip. The **slash** list
stays off in command mode, since you are already inside a command, and the open
`@` list takes Enter before the command branch does, so Enter means "take the
name I am pointing at" rather than "send the line".

**A shout carries a mention only as far as the words go.** `shout()` builds
three spellings of the same sentence: the `{char:…}` one for the archive row,
the `<@&roleId>` one for Discord, and a **flat** one — `tokensToNames`, the
token replaced by the name it froze — for two hops out and beyond. The flat one
is what gets muffled. Run a token through `muffle()` and it comes out as broken
braces with the named person's name sitting perfectly legible inside a redacted
sentence, which is the one word the distance was there to take away.

A shout gets no relay DM: everyone the mention could reach already heard it,
and the widest broadcast in the game is not a place to open a new ping path.

**Mentions must be read before the message is proxied** — `sendAsCharacter`
deletes the original, taking `message.mentions` with it — but the jump link
needs the *proxied* message's id. So the order is **capture → proxy → relay**.

### The relay DM

**Pinging your own character does relay.** There used to be a filter dropping
the sender's own characters — nobody needs telling they pinged themselves —
but because the proxy suppresses the ping itself (§2), a self-ping was the one
case that looked exactly like a broken relay while working as intended, and it
is the first thing anyone reaches for to test the feature. A redundant DM to
yourself is much cheaper than a feature nobody can verify.

Every rejection on this path is a bare return. `handleMentions` logs one
`[mentions]` line per ping — the role ids, how many resolved, and each
target's gate outcome — so the Railway logs can tell "out of earshot" from
"resolved nobody" without a debugger.

Otherwise, gated so a ping can't carry further than a voice would. Without a gate,
pinging is a free cross-map signalling channel. Two rules, because the two
kinds of channel mean different things by "in earshot":

- **Location channels** (and the Rooms and Conversations under them) gate on
  the **location** — you can call for someone standing where you stand, not
  for someone across the zone.
- **The special channels** have no zone at all, so they gate on whether the
  target currently *hears that channel* — `computeNarrowcastAccess` from
  `db/lib/specialChannels.js`, keyed on `NARROWCAST_SLUGS` rather than a
  hardcoded pair, so a future entry is covered by adding it to the registry.

The DM carries **where and a jump link, never the message text**. A ping into a
private thread the target hasn't joined would otherwise leak the room's
content, and a `DirectMessage` row outlives the ❌ that deletes the message it
quoted.

**A concealed message relays nothing at all** — the room isn't meant to know
who spoke, and a DM naming the place would hand the target a thread to pull
on.

**An OOC line relays too, and it has to do it itself.** An OOC row is a
`SYSTEM` row (`db/lib/scene.js`) and the outbox carries `WEB` ones only, so
`relayWebMentions` never saw it and a name in an OOC line notified nobody at
all — the character role it points at is held by nobody, so the DM is the whole
notification. `db/lib/ooc.js#relayOocMentions` sends it, same contract as the
two above: where and a jump link, never the words. The gate is
`canHearPing(prisma, character, placeKey)` in `db/lib/characterMentions.js`,
which answers for a place key of any kind — earshot for a Location, Room,
Conversation or zone, `computeNarrowcastAccess` for a special channel. Deadchat
and a party thread answer **no**: neither is a place, both are memberships, and
a relay that guessed would be a ping carrying further than the room it was
typed in.

`deliverOoc` also posts the **role** spelling rather than the body it was
handed. It used to post the raw text, so a web-typed mention arrived on Discord
reading `{char:cl9…|Ada}`, braces and all.

### Adding to a conversation

In a Conversation (a `PlayerThread` row, `CHANNELS.md` §4), a mention also
**adds that character's player to it**.
Discord does this for free today by auto-adding a mentioned role's members, but
that stops working the moment the roles have zero members, so the bot takes it
over.

`/add` and `/remove` are the same operation by command, both taking a **role
option** rather than a user option on purpose: the picker then names
characters, never Discord accounts, so inviting someone can't reveal who plays
them. Anyone already in the thread may add or remove, plus GMs.

**Every sentence either of them answers with uses the presented name**
(`db/lib/presentedMembers.js#presentedNameOf`). They said `Character.name` out
loud, in a channel, about somebody who might have been standing there in a
hood — so the disguise came apart at the door. Same for the Room half's four
replies, and for `removeRoomGuest`'s own `line`.

### Who is IN a place, and what face it draws

`db/lib/presentedMembers.js` is the resolver for a Conversation's members and a
private Room's guests, and it is the same rule `whosHere` applies to the HERE
column. It is a second function rather than an argument to that one because
**membership is not presence** — a member may be standing anywhere, since the
row persists when they walk away — and what the two share is the projection.

Before it existed, `conversationMembers()` and `roomGuests()` selected
`Character.name` and shipped the character's id beside it. `MembersStrip.js`
draws that under `.chat-head`, at the top of the pane, which is why "inviting
people into a conversation breaks disguises" was a true sentence: the strip
named a hooded member outright and drew their real portrait. The *candidate*
picker was always right, because it was built from `whosHere()`.

**A concealed row carries no `characterId` at all.** `/api/avatar/<id>` takes
an id and answers with a face, so shipping the id is the leak whatever the page
then chooses to draw. It carries `hoodToken(id)` instead — the same HMAC handle
the HERE column mints, moved to its own leaf `db/lib/hoodToken.js` so this
module can use one without dragging `whosHere` → `sightings` → `feedAccess` →
`conversations` round in a circle. `removeMember` takes either an id or a
token, told apart the way `/look` tells them apart (32 hex characters, and a
cuid never is), and `resolveMemberToken` recomputes it **only over the roster
of the place the caller already gated on** — so a token names somebody in a
room you are in and nobody anywhere else.

The face is on §5a's sighting rule, unchanged: a mask is drawn only for
somebody you have watched speak in it this turn, and the question-mark plate
until then. The sightings Map is an **argument** rather than a query made
inside — `placeMembers` already pays for one to build the candidate list in the
same breath, and two identical queries would be two answers to one question.

A forced name is not hiding, so a Beast is named openly with their id intact,
and loses only their portrait for the letter plaque.

**A mention is an invite, on the same contract as `/add`** (`COMMANDS.md` §2b),
and it reads the same typed into `/chat` as typed into Discord — the web half
lives in `bot/src/lib/feedOutbox.js#relayWebMentions`, which used to send the
notification and stop there:
a `PlayerThreadInvite` row is recorded, the Discord add is attempted now, and
if the target is standing somewhere else `applyPendingInvites` replays it the
moment they arrive in that Location. Discord still requires a thread member to
be able to view the parent channel — that view is the location role now — so
an add from elsewhere would put a thread in their sidebar they can't open. The pinger is told who was
invited rather than notified (collected into one DM, not one per target), since
a proxied message has no interaction to reply to and silence would read as a
bug.

One thing worth knowing rather than fixing: removing a member the bot didn't
add needs `MANAGE_THREADS`, which comes from the bot's own role and is not
granted by `locationChannelSpec` — `/remove` reports that failure rather than
silently timing out.

## 7. Notes (⭐) and the Journal

`/notes` has two tabs, `NotesBoard.js`: **Starred** (this section) and
**Journal** — a player's own written entries, unrelated to proxying and
covered here only because it shares the page. Neither tab is ever
GM-visible or shared between players; see below.

There are two ways in now: the reaction in Discord, and the ★ on a row's
action bar on `/chat` (`web/app/(app)/chat/actions.js#starRow`, `CHAT.md` §5).
Both write the same row. A line with no Discord message behind it — a web-only
player's, or one the outbox has not pushed yet — is filed under `seq:<seq>`
instead of a message id, so the `(discordMessageId, discordUserId)` unique
still holds and a ⭐ in Discord and a ★ on the web make one note, not two.

Reacting ⭐ to any guild message saves it as a personal `Note` for whoever
reacted — not just a proxied one. `handleStarReaction` upserts a row keyed on
`(discordMessageId, discordUserId)` with a speaker, a zone snapshot, content,
and `sentAt`. Unlike every other reaction here, ⭐ works on a message with no
archived row at all, and resolves the speaker in two tiers:

1. **A character message** — its `ArchiveEntry` row, which is durable
   (`db/lib/archive.js`), so starring works on anything ever said.
2. **No row** — a bot-as-itself post (turn announcement, GM declaration,
   `/gm`, ghost whisper) or another webhook's message. Filed under the
   poster's display name with `characterId: null`; a real player's own message
   still isn't starrable.

**The bot always strips the reaction back off** right after processing
(`reaction.users.remove(user.id)`), for any user, on any message — so Discord
never shows an accumulating star count, and the note on `/notes` is the only
lasting record. There's no "react again to unstar"; unstarring is the web UI's
`[★]` button (`unstarNote` in `web/app/(app)/notes/actions.js`), which just
deletes the row.

A starred card shows the speaker's face (`CharacterAvatar`) beside their name —
**gated**. `Note.characterId` is stored unconditionally even when the message
was concealed (`characterName` becomes the alias instead — see §6 above), so
`notes/page.js` only passes `characterId` through when the stored name still
matches the character's current real name; on a mismatch it ships `null`,
which `CharacterAvatar` renders as a letter plaque. This fails safe in both
directions: a merely-renamed character just loses its face, and a concealed
one never gains one. The check happens server-side, so a concealed
character's id never reaches the client at all.

`/notes` is **strictly personal and identical for both roles**: every signed-in
user, GM or player, only ever sees `Note` and `JournalEntry` rows matching
their own `discordUserId`. There is no shared or all-players view. Both tabs
render as sortable-by-time, filterable cards over the shared list shell
(`DESIGN-SYSTEM.md` §7), not a table — each tab holds its own independent
filter/sort/paging state, since the two row shapes are never interleaved.

**The Journal** (`JournalList.js` / `JournalComposer.js` / `journalActions.js`)
is a private, freeform record: a title, a body, an optional pin-to-top, the
open turn number at the time it was written, and up to a handful of
free-text labels. A body can `@`-mention a character, which is stored as a
`{char:<characterId>}` token (the same `{kind:payload}` grammar `RichText.js`
already uses for `{tag:…}` and friends) and renders inline as a face + name.

The mention roster is `web/lib/mentionDirectory.js#loadMentionDirectory`, the
same one `/chat` uses, asked for `{ includeUnburiedDead: true }` — every
character `ALIVE`, or `DEAD` and not yet buried (mirroring `character/page.js`'s
own zone-roster precedent). It is passed once to
`CharacterMentionsProvider.js`, mounted only by this page.

**This page used to roll its own `findMany` with no concealment filter at all**,
which meant a hooded or disguised character was offered by name in the
autocomplete and drew their real portrait in an entry — while `/chat`, one
directory over, withheld both. The forced/concealed rule has three cases and a
precedence order, and the second copy of it is always the one that never got
written; there is one now.

What the roster supplies is the **face**. The NAME comes off the token itself,
frozen when the entry was written (§6), so an entry naming somebody who has
since put a hood on keeps saying what its author wrote and simply loses the
portrait. A mention of a character outside the roster (buried, or simply
invented) draws the neutral chip, the token pipeline's behaviour for any
unresolvable reference.

## 8. Nicknames are the player's own

**The game never writes a Discord nickname.** Not on character creation, not on
a rename, not on death, not on a wipe — in neither direction, set or cleared.
Whatever a member's nickname says is something they typed themselves, and
nothing here touches it.

It used to. An `ALIVE` character's member was kept at `{base} | {characterName}`
by a pair of syncs, gated behind `GameConfig.nicknameSyncEnabled` — which was
off by default and never turned on. The clears were not gated, which is the
asymmetry that made this worth removing rather than leaving dormant: a switch
nobody had ever flipped on still had death, mirror-off and the launch wipe
writing `nick: null` over whatever a player had chosen for themselves.

Removed with it: `bot/src/lib/nickname.js`, `db/lib/nicknameFormat.js`,
`web/lib/discordGuild.js#syncCharacterNickname`, `setGuildNickname` /
`updateGuildNickname`, the `userUpdate` event that existed only to re-sync, and
the `nicknameSyncDiscordUserId` side effect. `GameConfig.nicknameSyncEnabled`
is kept as a column and listed as an orphan in `CLAUDE.md`, the same as
`TagGroup.color`.

The one that made this urgent was **Metempsychosis** (`CHARACTERS.md`), which
called `setGuildNickname` directly and so honoured neither the config gate nor
`discordMirrored`: dying with the tag renamed your Discord account to the
stranger you woke up as.

Nicknames are still **read** — `/gm/players` and the dev panel's band show a
member's `nick`, which is useful to a GM precisely because it is the player's
own choice.

## 9. Where the code lives

| Concern | File |
|---|---|
| Proxy send (gateway) | `bot/src/lib/proxy.js` |
| Proxy send (REST) | `db/lib/discordRest.js#postAsCharacter` |
| Message pipeline | `bot/src/events/messageCreate.js` |
| Reactions | `bot/src/events/messageReactionAdd.js` |
| Channel opt-in | `bot/src/lib/channels.js`, `web/lib/discordGuild.js` |
| Concealed alias | `db/lib/concealedIdentity.js` |
| Presented identity (forced > concealed > own) | `db/lib/presentedIdentity.js` |
| Presented membership (a conversation, a room) | `db/lib/presentedMembers.js` |
| Hood handle (HMAC, no id) | `db/lib/hoodToken.js` |
| Role title follows a forced name | `db/lib/characterRoleAppearance.js`, `db/lib/characterRoleNames.js` |
| Mentions, `/add`, `/remove` | `bot/src/lib/mentions.js`, `bot/src/lib/commands.js` |
| Inspect gates | `db/lib/inspectVision.js` |
| Doctor's eye on inspect | `db/lib/medicalVision.js` (`TAGS.md` §5c) |
| Avatar route | `web/app/api/avatar/[characterId]/route.js` |
| Plaque generator | `web/scripts/generate-letters.js` |
| Notes UI (Starred + Journal) | `web/app/(app)/notes/` |
| `{char:…\|…}` mention token | `db/lib/characterMentions.js`, `web/app/components/messageTokens.js`, `CharacterMentionsProvider.js` |
