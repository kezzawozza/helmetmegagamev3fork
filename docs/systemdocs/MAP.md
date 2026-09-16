# Geography and travel

Where characters are and how they move. For the *Discord* side — channel
layout, provisioning, who can see what — see `CHANNELS.md`. This page is the
game side.

## 1. The model

There are two levels now. A **`Zone`** (Town, Fortress, Forest, Black Hills,
Marshes, and the two underground levels Caves and Depths) is a region — a
category, and for a `SURFACE` zone a `#summary` channel. A **`Location`** is
where a character actually **stands**: one text channel under its zone's
category, opened by a **per-member permission overwrite** rather than a role
of its own (`CHANNELS.md` §3 for why).
`Character.locationId` is the authoritative "where is this character"
answer; `Character.zoneId` is a **denormalized mirror** of
`location.zoneId` — every writer of `locationId` writes both, and the
channel doctor's `character-place` check flags a mismatch (`CHANNELS.md`
§6).

Geography is authored live at `/gm/dev/zones` now — a GM edits a Zone,
Location or Room's fields directly, and the change lands in the database
immediately, with Discord catching up behind it (`db/lib/discordMirror/`).
`docs/zones.yaml` survives only as the one-shot **importer** for a fresh
game's starting layout (`npm run db:import-zones -- --apply`): it's additive,
never updates an existing row and never deletes one — see `SYNC.md` for the
format and `DEV-PANEL.md` for the editor.

**How a Location is slugged.** A built place takes a bare slug and a bare
name — `keep`, `factory`, `cathedral`, `customs`. Open country takes its zone as
a prefix — `forest-creekside`, `hills-gullies`, `marshes-village`,
`depths-obelisk` — because a ravine and a river are things every zone has one
of, and the slug is also the Discord channel name. The wilderness used to be
numbered instead (`forest-7`, `Depths 3`), with the hand-drawn map's number
buried in the slug and a different one in the display name; the drawing's
number now lives in `map_node:`, which nothing but a person reads. The Black
Hills zone slug is `hills`.

Zones still come in three kinds:

| `kind` | Zones | Standable itself? | Discord |
|---|---|---|---|
| `SURFACE` | Town, Fortress, Forest, Black Hills, Marshes | no — its Locations are | category + `#summary`; each Location its own channel |
| `CAVE_GROUP` | Underground | no | the shared "Underground" category only |
| `CAVE_LEVEL` | Caves, Depths | no — its Locations are | no channels of its own; its Locations parent onto the Underground category |

`Underground` exists only to be that parent. The kinds are kept rather than
promoting Caves and Depths to surface zones because the Caving Die fires on a
`CAVE_LEVEL` arrival and a `CAVE_LEVEL` needs a `CAVE_GROUP` above it; sharing
one parent also means Caves and Depths share one GM seat, which is what the old
Caves seat already did across three levels. The consequence to know about is
that neither has a `#summary` of its own, so **a gate underground would have
nowhere to announce** — none is drawn there today. That is a gate's problem
specifically, not a general rule about the caves being unreachable: a staged
public declaration for either level fans out to every Location channel in it
instead (`ADJUDICATION.md` §1).

A zone itself is never a place you can stand in any more — only a Location
is. Every presence zone (`SURFACE` or `CAVE_LEVEL`) must list at least one
Location in `docs/zones.yaml`, or the sync throws. `Zone.seatZoneId` still
decides which GM table a row belongs to (`GAMEMASTERS.md` §2); it hasn't
moved, since a Location doesn't need its own seat.

New characters get their starting place from their role: `starting_zone` (and
an optional `starting_location`) in `docs/roles.yaml` resolve to
`Role.startingZoneId` / `Role.startingLocationId`, and `createCharacter`
grants the zone role and the Location role immediately (`CHARACTERS.md` §3).
If a role names no `starting_location`, it's the first Location (by `sort`)
of its `starting_zone`.

### 1a. What a Location is worth

A Location also carries up to four `LocationYield` rows — one per `LaborKind`
(HUNTING / FARMING / FISHING / PROSPECTING) — authored as a `yield:` block in
`docs/zones.yaml` and drifted every turn. **No row means that labor is
impossible there**, which is why no Location needs a "wilderness" or "water"
boolean anywhere in the schema: the row is the gate. See `LABORING.md`.

### 1b. What else a Location is

Beyond its name and description, a Location carries a sparse map of
**attributes** — `Location.attributes`, a JSON object authored as an
`attributes:` block in `docs/zones.yaml` — and, optionally, a `structures:`
list of the built things that were always standing there (the Square's cross),
seeded as `COMPLETE` `Structure` rows by the zone sync (`SYNC.md` §2):

```yaml
depot:
  name: Depot
  attributes:
    depot: true
```

Two more keys feed the mood dial (`MOOD.md`): `wilderness` marks a Location
where arriving and ending the turn cost mood (every Forest, Black Hills and
Marshes Location except the factory, the farms and the marshes village), and
`haven` marks a Location whose roof gives extra relief at turn close — the
Inn, the Keep and the Sanctuary.

A third, `wheels`, is the one authored exception to the `indoors` column: an
indoors Location wearing it admits a cart and a horse anyway (`CARRY.md` §3).
The Godard Factory, Customs and the Depot carry it. It changes nothing else —
those three keep their roof for the mood dial, for Sun Sensitivity and for
whether anything can be built in them. `indoors` itself only parks a mount at
all **underground** (`zone.kind === "CAVE_LEVEL"`) — a surface roof no longer
takes the reins away, so `wheels` matters in practice on Customs and the
Depot, the two underground places that carry it.

Every key must exist in the registry in `db/lib/locationAttributes.js`, which
is the only module that reads the column. An unknown key is reported as a sync
**problem** rather than dropped, because a typo would otherwise be a place that
quietly never says what it is.

The registry maps each key to the sentence the **Examine** button prints
(`LABORING.md` §9). Systems that own a place should ask `hasAttribute(location,
"depot")` rather than comparing slugs — that is the point of the layer.

Two things are deliberately *not* attributes. `indoors` stays a real column,
because carts and mounts act on it (`db/lib/indoors.js`, `db/lib/mounts.js`)
and a JSON field is not something to query on; Examine merely prints it
alongside the attributes as though it were one. And gate state is never
authored — it is read live off the `LocationLink` rows, since a GM can flip an
edge at any time.

JSON rather than a column per fact because these are sparse, additive prose
triggers. The moment something needs a `where` clause, it wants a column.

## 2. The adjacency graph

`connections:` in `docs/zones.yaml` is the master. Each entry becomes **one
`LocationLink` row** — one row per undirected edge, not a mirrored pair, with
`aId`/`bId` held in ascending Location slug order. That is what makes an
attribute impossible to disagree between the two directions, and a modular gate
impossible to leave open one way and shut the other. The graph is over
Locations, not zones, and spans zones freely.

**Nothing decides passability outside `db/lib/locationGraph.js`.** A few places
read `LocationLink` rows for other reasons — the doctor validates the slugs an
edge names, and the bot's gate and keyed handlers read one row to check
*authority* — but no second implementation of "may this character cross"
exists, and none should. `db/lib/locationGraph.js` is the one
module that knows an edge could have your location on either side:

| Function | Use |
|---|---|
| `linksFor(prisma, locationId)` | every edge touching a location |
| `linkBetween(prisma, a, b)` | the one edge between two locations, either way round |
| `crossingCheck(link, { tagSlugs })` | the pure verdict: `{ listed, passable, refusal }` |
| `resolveNeighbors(prisma, character, locationId)` | every destination, gated and sorted |
| `travelOptions(…)` | the same, filtered to what may be *shown* |

`performLocationMove` refuses a hop with no edge — or one the character may not
use — with the verdict `crossingCheck` returns, and refuses standing still with
"You're already there." An unreachable Location is a sync **warning**, not an
error.

### 2a. Typed edges

An edge is not just "you may walk this." Six behaviours, and they **compose** —
the Gatehouse-to-Road edge is a manned gate *and* a modular one at once, which
is why `LocationLink` carries fields rather than one enum.

| Behaviour | Column | Effect |
|---|---|---|
| Open | — | the default |
| Gate | `announce: TRUE_NAME` | posts the crosser's **real name** into the destination zone's `#summary`. `/conceal` does not help: there is a Cerberus here reading papers |
| Unmanned gate | `announce: CONCEALED` | posts only what a passer-by would have seen — "An old woman has entered the Gate" |
| Locked | `requiredTagSlug` | crossing needs the tag, and the way is **listed**, so a player sees the door and learns what opens it |
| Hidden | `requiredTagSlug` + `hidden` | needs the tag **and** is absent from every travel list. Refuses in the same words a nonexistent edge does, deliberately — a different refusal would tell a player the way is there |
| Modular | `modular`, `isOpen` | an Open/Close button on the **watchtower** at the gate; impassable while shut. Anyone the tower admits may work it |
| Keyed | `keyed`, `openUntil` | on crossing, DMs the key-holder "Leave open for the next 24 hours?" — yes and the way ignores its tag and becomes listed until the window lapses |
| On foot | `onFoot` | too tight, steep or enclosed for a horse or a cart. A **mounted** character is dismounted crossing it, same as walking into an indoors Location |

**A modular gate is also a window, open or shut.** A line said in a PUBLIC,
non-soundproof Room at one end is echoed into every such Room at the other end,
as the speaker, with each line `-#` (`db/lib/gateEcho.js`, called from
`say.js#recordSpeech`). Private Rooms and Conversations never echo either way.
And Who's here? plus the web HERE column list the people at the far Location
under that Location's name (`whosHere(…, { withAcross: true })`), in rows that
carry no hood token and no menu, so nothing can be done to them through the bars.

**Stealth is the one tag that reads on a crossing**, and it moves the
announcement down exactly one step rather than switching it off
(`db/lib/locationMove.js#announceLevelFor`, a pure function with its own test
in `db/test/gateAnnounce.test.js`):

| the edge says | an ordinary traveller | a **Stealth** traveller |
|---|---|---|
| `TRUE_NAME` (manned) | their real name | what a passer-by saw |
| `CONCEALED` (unmanned) | what a passer-by saw | **nothing at all** |
| `NONE` | nothing | nothing |

The asymmetry is the point, and it is Bascinet's call: you can be quiet, but
you cannot be quiet past a Cerberus who is reading your papers. So a stealthy
traveller through the Fortress gatehouse lands exactly where an ordinary one
lands at a Town gate. This is also the only thing in the game that suppresses
an *individual's* arrival — everything else about announcing is a property of
the edge and treats every traveller alike.

**The winch is in the tower, and reaching the tower is the whole permission
model.** A modular gate's Open/Close button renders on one Room's starter post
— the watchtower at that gate — and on neither endpoint's Location anchor,
which is where it used to live. The four rooms are named in
`db/lib/roomStarterRow.js#WATCHTOWER_ROOM_SLUGS`; the row is composed by
`syncZones.js#roomComponents` and redrawn after a flip by `#refreshGateRooms`,
which every caller of `refreshLocationAnchor` also calls.

**Anyone who can see the button may pull it.** A gate used to carry its own
opener list as well, so two predicates decided one act and had to be kept in
agreement: the tower's `access:` list is computed from held **tags**, while the
opener list also accepted a **Role**, so a gate could authorise somebody who
could not reach it — or admit somebody to the tower who then found the winch
refused them. Only one of those can be the rule, and the room is the one a
player can see. `toggleGate` still checks that the clicker is **standing at the
gate**, because a thread member need not be, and that is the only check left.

A tower whose thread is missing renders a flip nowhere at all, since there is
no longer an anchor copy to fall back on; the Discord mirror and the channel
doctor are the repair.

Two things about the gating that are easy to get wrong:

- **`listed` is weaker than `passable`.** A locked edge is listed and refuses.
  A hidden one is neither. Any surface that renders a list must filter on
  `listed`; the mover checks `passable`. `travelOptions` does the first for you.
- **The refusal is re-derived server-side, every time.** A picker that dropped
  an option is a hint; `performLocationMove` runs `crossingCheck` again on
  its own — once for the mover and once per follower (§3a) — because a server
  action is a public endpoint and a client can post any location id it likes.
- **A propped-open keyed way satisfies its own tag requirement**, which also
  makes a hidden one listed. That is not a leak, it is the whole feature: a
  door somebody held open has to be visible to the people meant to follow them
  through it.

A gate's **announcement is posted from the Discord half**
(`applyLocationMoveSideEffects`), derived from the edge rather than passed in,
so every writer of `Character.locationId` gets it for free and a GM's teleport
onto a non-adjacent Location announces nothing. It is a plain bot message, not
`postAsCharacter` — a webhook post under the traveller's own name and face
would defeat the whole point of the unmanned form.

### 2b. Keyed ways

A **keyed** way asks the person who just used their key whether to hold it open
behind them. `shouldPromptKeyed` gates that: only a key-holder is asked, because
propping a door is the key-holder's decision and not a courtesy anyone walking
through inherits, and only while the way is shut, so a stream of traffic through
an open one does not re-ask every single person.

The ask is a **DM**, never anything in a channel — a keyed way is usually
secret, and asking in the open would tell the room it exists. The crossing
itself only poses the question; `openUntil` is stamped by the button handler,
so a player who never answers leaves the door shut, which is the safe default.

Nothing closes it again. `isHeldOpen` compares `openUntil` against the clock,
so the window lapses on its own with no pass, no cron and no row to clean up.
`resolveNeighbors` takes one clock reading for a whole list, so a way cannot
lapse halfway down it and render as both open and shut at once.

Neither `db:import-zones` nor the editor ever rewrites `openUntil` or `isOpen`:
both are play state, not authoring. Restart Game is the one thing that resets
`isOpen` — back to `authoredOpen`, the gate's born value — as part of the
wipe, not as part of importing or mirroring.

### 2c. On-foot ways

`onFoot` is the edge-level sibling of `Location.indoors`: same effect
(`db/lib/indoors.js#dismountForNarrowWay`, right beside `parkMountsIndoors`),
earlier moment. Both keep a horse and a cart out of somewhere they do not
fit; `onFoot` used to refuse the crossing outright rather than dismount for
it, on purpose — see the timing note below for why that mattered, and why
dismounting works just as well now.

**Timing is the whole reason it isn't a plain reuse of `parkMountsIndoors`.**
An equipped mount buys one extra free zone-crossing per turn (`freeZoneMoves`,
`db/lib/locationTravel.js`), so dismounting only on arrival — after that
crossing's own cost was already computed — would let a rider bank the bonus
on a ride that never survives the threshold, which made every secret passage
into the Fortress rideable for free. `performLocationMove` dismounts them
*first*, inside its own transaction, before `freeZoneMoves` ever runs, so the
crossing is costed as the walk it actually is. `applyLocationMoveSideEffects`
never repeats the check itself when the caller already has the answer — see
the comment on its `dismounted` parameter.

It is also the one gate that reads what a character has **equipped** rather than
what they hold: `isMounted(equippedSlugs(tags))`, so a horse stowed in a pack is
not a horse you are riding. `resolveNeighbors` therefore loads tags in
equip-shape rather than through `heldTagSlugs`, which returns bare slugs and
would have counted a stowed horse. The refusal is listed rather than hidden,
because unequipping the horse is a fix the traveller can apply on the spot.

The **modular button** is `loc:gate:{linkId}` on the watchtower's starter post.
The handler re-checks only that the clicker is standing at the gate — the room
they clicked in is the authority for the rest. The flip is a row lock and a
re-read carrying the state the clicker saw, so two watchmen clicking at once
means one close and one "somebody just did." Both endpoints are redrawn, since
either may have a tower. **A re-sync never reopens a gate somebody shut in
play** — `modular.open` in the YAML is the value a link is *born* with, not one
the sync re-asserts.

## 3. What a move costs

**`db/lib/locationTravel.js#performLocationMove(prisma, character,
targetLocation, { dragged })`** is the one function both faces call for the
database half of a move. It does **no Discord work** — same split
`advanceTurn()`/`runSideEffects()` uses, and for the same reason: the bot has
a gateway client and the web app only has REST.

**A first placement is free.** A character with no `locationId` yet can land
anywhere, spends nothing, and files no Action — it isn't travel, it's
arrival. The adjacency gate is skipped entirely.

**A hop inside the same zone is free, on a cooldown.**
`GameConfig.locationMoveCooldownSeconds` (default 3, edited on `/gm/dev`; it
was 60 until 2026-09-08, which was long enough to feel like a wall)
gates it, enforced by a **conditional `updateMany`** whose `WHERE` clause
*is* the check (`lastLocationMoveAt` null or old enough) — the same shape the
hunger decrement and the mount's daily claim use, so two clicks in one tick
can't both pass. A refusal reports the exact seconds left. A **walk** of several
hops claims it once, at its first hop, and swaps the clock for a position check
on every hop after — §3c.

**An Overburdened character can't cross into another zone at all.** Over a
carry cap (`CARRY.md` §2), `performLocationMove` refuses the crossing with a
plain `{ ok: false, reason }` before it opens its transaction; hops inside the
zone stay free so they can walk to a room and stash. Only the mover is gated.

**A hop whose edge crosses into another zone spends a FREE ZONE MOVE first,
and only costs the character's Move once those run out.** Everyone gets
`GameConfig.freeZoneMovesPerTurn` a turn (default 1), an **equipped** mount
adds one, and being Overburdened takes them all away — the full rule lives in
[`CARRY.md`](CARRY.md) §2a. So a peasant walks Town → Forest for nothing,
spends their Move to reach the Fortress, and the way home waits for next turn.

**A crossing lands at once, whatever it cost.** The Move is spent and the
character is standing at the destination by the time the call returns — same as
a free crossing and same as a same-zone hop.

It was not always so. Until 2026-09-14 a crossing that cost the Move was a day
on the road: the Move went at once, `Character.locationId` did not move, the
destination was parked on `Character.travelToLocationId`, and
`db/lib/travelArrivalPass.js` walked the traveller and their party over at the
next advance. The point of that was the destination's Discord channels — they
stayed shut for the rest of the turn you left in, instead of opening under you
the second you pressed Confirm. Removing it is Bascinet's call, and the cost is
exactly that: **press Confirm and the far zone's category, `#summary` and
Location channel are yours within the minute**, along with the gate
announcement, the Caving Die, the turrets, arrival mood and the carry settle.
Anyone standing there can Bind, Loot or Harm you the same turn you set out.

Two smaller things moved with it. The turn passes now settle a crosser at the
**destination** rather than the origin — auto-labor pays the yield of the place
they ended the day in, and the night's mood reads its `wilderness`/`haven`. And
`travelArrivalPass` is now a **drain**: nothing files work for it, and it is
kept only to land anybody who was mid-journey when the change deployed. Delete
it once they have.

The two columns stay in the schema, unwritten, beside `missedMealStreak` and
`mindlinkChannelId`.

**Being HELD is the one thing that stops a move outright.** Somebody laid in
wait where you walked in and stopped you — see
[`INTERCEPT.md`](INTERCEPT.md). `performLocationMove` refuses with the hold's
own sentence, beside its incapacitation gate, and `travelOptions` draws every
way shut and says why. A held follower is left behind rather than carried out
(§3a).

UNDOING a Move gives back what the crossing SPENT, and not the crossing:
`web/lib/moveEconomy.js#deleteActionRestoringTurn` — shared by the Dev
Panel's "Give their turn back" and the Moves desk's Reject — deletes the
auto-resolved `Action` a paid crossing filed, and
`db/lib/locationTravel.js#travelClaimsToUndo` is what tells it to also zero
`zoneMovesUsed`/`zoneMovesTurnId` when this turn's free-crossing claim
belongs to that Action (`Action.turnId` is unique per character, so a match
can only ever mean this one). Left alone, the day's free crossings stayed
spent even though the Move that spent them just came back.

**It does not walk them home.** When a paid crossing was a day on the road,
undoing the Action really did call the journey off, because nobody had moved
yet. They have now — a GM who wants them back where they started teleports
them. `travelClaimsToUndo`'s `travelTo*` branch survives only as a drain for
a straggler, and goes with the arrival pass. `escortedById` is not restored
either: a crossing overwrites it with `null` and never remembers what it
was, so there is nothing to give back.

Spending the Move is written as a real, auto-resolved `Action`
(`type: MOVE`, `status: CONFIRMED`, `moveReviewStatus: SOLVED`,
`gmNotes: "auto:zone_change"`), landing in `/gm/turns`' Moves history rather
than the pending queue. Its `zoneId` is the **seat** zone of the destination
(`seatZoneIdFor`) — a hop into the Depths files work the Caves GM can see.
A free move files no Action at all. **Acting and crossing on your Move are
mutually exclusive within a turn, in either order** — the enforcement is
`@@unique([characterId, turnId])` on `Action`.

**Pushing on.** Once the free crossings are gone AND the Move is spent — on a
paid crossing or on anything else — a walker can take one more crossing a turn
on a die: the extra gamble to go the distance, a Push on button in Go's place
on the Travel panel, `/map` and the `#turns` picker — Go (Discord's Confirm)
is hidden once the Move is spent, since it could only refuse, and the node's
foot reads `exertion`, or `next turn` when the push on would be refused too
(the refusal is written on the confirm strip). The crossing lands like any
other, files no Action, and is refused while the Move is still unspent (the
surfaces read the turn's Action row, `performLocationMove` reads it again).
So three zones a day on foot is the ceiling: free, paid, pushed. The d6, Lucky keeping the better of
two and nothing else on it (no mood or hunger modifier — a hungry, frightened
walker is exactly who pushes on, and a −4 would make the injury a certainty the
confirm text does not admit): **1** grants Sprained Ankle, **2–3** Exhausted,
**4–5** one rung up the Tired ladder (`db/lib/laborFatigue.js`), **6** Winded — a
turn's visible mark with no effect (`docs/tags.yaml`).
Fatigue is granted at turn N+1 so it costs the whole next turn, the same clock
a day's Labor runs on — so a Tired walker reads 1 ankle, 2–5 Exhausted, 6
Winded. Winded itself is granted at N and swept when this turn closes: it only
marks that you pushed on today, with nothing to carry over. A few traits pull the die (`db/lib/advantage.js#rollWithEdge`): Lucky,
Quick-Footed, Caffeinated and Stimulant High each vote to keep the better of
two dice, Fat and Old to keep the worse; the count decides and a tie rolls
once (`EXERT_BETTER_SLUGS` / `EXERT_WORSE_SLUGS`). Refused while riding,
boated on the water, lamed, too hurt to march (`EXERT_REFUSAL_SLUGS`: Arterial
Bleed, Punctured Lung, Gut Wound, Sepsis, Blind Drunk — none of which restrict
ACT), Exhausted (top of the ladder: nothing left to lose but the ankle would
make it a free gamble) or Overburdened, and once a turn — `exertRefusal` is
the list, and the surfaces ask it before drawing the button. No Action is filed, so a push on never shows
in the Moves history; the `AuditLog` row `exert_crossing` is the record.
`performLocationMove(..., { exert: true })`, `pushOn`, `exertOutcome`.

**Mounts.** `horse` and `motorcycle`
(`db/lib/mounts.js#FAST_TRAVEL_SLUGS`) each add one free crossing, **and it refreshes every
turn** rather than once a day — a horse carries you at Dawn and again at Dusk.
They only count while **equipped**, and they are unequipped for you at the door
of any indoors Location (`CARRY.md` §3).

**A bonus crossing is spent before the base one.** The mount's move goes
first, and it stays charged to the mount for the rest of the turn — so
stabling the horse at an indoors door gives nothing back and, more to the
point, takes nothing back. Before this, the allowance was one number
recomputed from scratch on every read: a rider with two crossings who rode
into the Customs house had their ride charged to their base move, and then
watched the horse's move leave with the horse. Two, ride once, none left. The
narrow-way case is untouched, because `dismountForNarrowWay` runs *inside* the
transaction before any of this arithmetic — a rider who cannot get their horse
through the gap never earns the bonus to begin with (§2c).

The allowance is tracked on `Character.zoneMovesTurnId` / `zoneMovesUsed`, with
`zoneMovesBonusUsed` counting how many of those went on a bonus, all three
claimed by a conditional `updateMany` whose WHERE is the check, so two tabs
cannot both spend the last one. A push on claims `zoneMovesUsed` too, and
never the bonus counter, so the base pool reading OVER the base allowance is
how `exertedThisTurn` knows it already happened — there is no column for it.
A GM's undo of a paid Move zeroes both counters (`travelClaimsToUndo`) and so
forgets the push on along with the free crossings; GM-gated, accepted.

The **`FAST_TRAVEL` Request is retired** — there's no separate route through
`requestActions.js`; a mount is just a larger allowance.

**Travel brings your escort party.** Who follows is not a parameter and never
reaches `performLocationMove` from a client — it is read off
`Character.escortedById` inside the move's own transaction. See §3a. Party
members get no Action, no cooldown claim and no mount claim of their own —
one `updateMany` moves them all — and the move writes one
`characters_escorted` `AuditLog` row naming the mover, the destination,
everyone brought and everyone the way refused. `lastLocationMoveAt` is set
for them too, so a character who's just been walked somewhere doesn't get an
extra free hop the instant they can act again.

**The Caving Die rolls on arrival** for the mover and everyone in their
party, on any `CAVE_LEVEL` destination — and arrival is now the *only*
time it rolls, so walking is what wakes the dark. A Location wearing the
`safe` attribute is exempt; Customs and the Depot are the two (`CAVING.md` §2).

`performLocationMove` returns `{ ok, oldLocation, oldZone, targetLocation,
targetZone, crossedZone, spentTurn, usedHorse, moved: [{ character,
fromLocationId, fromZoneId, toLocationId, toZoneId, zoneChanged, cavingDm },
...], leftBehind: [{ character, reason }], interceptDms }` (mover first) on
success, or `{ ok: false, reason, retryAfterSeconds? }` on refusal. There is
one shape now — the `deferred: true` / empty-`moved` / `travelers` form went
with the deferral. `leftBehind` is the caller's cue to DM, and `interceptDms`
is sent the same way `cavingDm` is: built here, sent by the caller, never
inside a transaction.

## 3a. Escorting — the party you carry

**You attach people once and they follow you.** This replaced two mechanics
that answered the same question with the same predicate written twice: the
`MOVE_CHARACTER` request, which shoved one person one hop for free with no
consent, and the drag picker on the Travel confirm, which had to be re-ticked
before every single hop. Both are gone. `db/lib/escort.js` is the one
authority, and `Character.escortedById` is the one column.

**`escortAuthority(leader, target, turnNumber)` is the whole rule set**, and
it is pure, so the panel, the bot's picker and the server-side re-check share
one answer:

| Verdict | Who | On click |
|---|---|---|
| `FORCED` | a corpse; anyone holding an `INCAPACITATING_SLUGS` tag; a member of the faction you lead | attaches at once |
| `CONSENTED` | somebody whose standing agreement to *you* has not lapsed | attaches at once |
| `ASK` | any other living character standing with you | files an `ESCORT` `Offer` and DMs them |
| `null` | not standing with you, hooded, yourself, buried, **willingly** following somebody else, or **you yourself are being brought along** | not offered |

**Force beats an arrangement.** The three `FORCED` branches are reached
*before* the `escortedById` guard, so a captor takes their prisoner off
whoever is holding them, and the same goes for a corpse and for a member of
the faction you lead. It read the other way round until a player found it:
tie somebody up while they were walking with a friend, and the friend kept
them, because asking first had won the column. `attach()` re-asserted the
same rule in its `updateMany` WHERE, so it takes a `takeover` flag that only
a `FORCED` verdict may pass — everybody else keeps the conditional write,
because the race it guards is real: two people asking the same willing
follower still resolve to one party.

**A refusal says which rule refused** (`escortRefusal`, the opposite number of
`escortReason`). It used to be one flat "You can't take them along", which on
a picker that silently omits whoever it will not take reads as the game
pretending somebody standing in front of you is not there. `hereWhere` has
already dropped the far away, the hooded, the buried and yourself before a
candidate is judged, so after the reordering above the only branch a
co-located person can hit is *already with somebody* — and that is safe to
say, because walking with somebody is plain to see. **Their leader is not
named**: the refusal does not need it. The METAGAMING rule
(`web/app/components/HereList.js`) is why the sentence arrives on the click
rather than as a greyed row in the picker.

Three things about it are easy to get wrong:

- **It is Location grain.** The old `canDrag` scooped the whole **zone**, so a
  body could be picked up from across the map. You walk to somebody now.
- **It needs the faction RELATION, not `factionId`.** `isUnaffiliated` reads
  `leader.faction`, and returns `true` for `undefined` — so a select that
  loaded only the id quietly refused every faction leader. That was live in
  `canDrag`, which `performLocationMove` re-ran against a `CHARACTER_SELECT`
  row that had no `faction`. `ESCORT_SELECT` carries it, and
  `db/test/escort.test.js` pins the case.
- **`ESCORT_SELECT` is a strict superset of `CHARACTER_SELECT`**, because
  every caller now loads a mover with it and hands that row straight to
  `performLocationMove`. Drop `zoneMoves*` and free crossings never run out;
  drop `heldUntil` and an ambush stops working. A test asserts the superset
  holds.

**Consent lasts two turns.** Accepting stamps `escortConsentToId` and
`escortConsentUntilTurn` (`turn.number + CONSENT_TURNS`) on the **responder's**
row and attaches them there and then. Inside the window they are picked back
up with no second DM; outside it, they are asked again. One agreement at a
time — you cannot promise your feet to two people. The ask rides the existing
`Offer` table and the existing `bot/src/lib/offers.js` router; only
`handleOfferAccept`'s kind switch knows it is new. Its buttons are green and
grey (`escortButtonRow`) rather than the blurple `offerButtonRow`, because
being taken along is an invitation and refusing one is not a refusal.

**A follower the way will not take is dropped, not a refusal.** Each one is
run through `crossingCheck` with **their own** tags and their own mount — a
crawl the leader has the Caving for is still a crawl their companion cannot
follow them down. One who fails is detached and left standing, and the mover
goes on. Dragging used to throw the whole hop away instead. **The leader's DM
must never say why**: naming a hidden edge's refusal would announce that the
edge is there (§2a). It says only "You can't move X through here."

**Walking under your own power detaches you.** Every branch of
`performLocationMove` clears the mover's own `escortedById`, so a willing
follower leaves by leaving. A helpless one never reaches that line. Death
releases everyone following the dead character and clears their own standing
agreement — but **not** their `escortedById`, because a corpse is still
something a person can carry.

**A passenger is not a driver.** `escortAuthority` returns `null` for every
target the instant `leader.escortedById` is set — no exception, FORCED
included, or a captor who gets swept up themselves would still be walking off
with their prisoner in tow. This closed a real hole: somebody already being
brought along could still open their own picker and attach followers of their
own, which left an orphaned sub-party the moment their own leader moved —
nobody's walk ever reads two levels of `escortedById` deep. The web's
`PartyRack.js` reflects this rather than fighting it: while `escortedById` is
set, the rack draws who you're being brought along **with** (your leader,
plus anyone else the same leader has) instead of a "Bring somebody" picker.
`attach()` and `acceptEscort()` are the other half of the same rule — either
one releasing the target's own party (`releaseParty`) the moment somebody
picks them up, so a chain can never form by attaching in the other order
either (an already-leading character getting picked up themselves).

**Seats decide the mount's bonus, not the party's size.** There is no cap on
how many people you take. `fastTravelCapacity` (horse 2, horse + cart 6,
motorcycle 2, on foot 0 — the rider counts) gates the `isMounted` branch of
`freeZoneMoves`: fit, and the mount buys its usual extra crossing; go over,
and it buys nothing. On foot there is no bonus to lose, so walking any number
of people is free — an overloaded horse is never *worse* than legs, only no
better. This is `fastTravelCapacity`'s first live caller; it had none from the
day it was written until this rework.

**A stale attachment is inert, not dangerous.** `escortAuthority` returns
`null` the moment two people are not co-located, so a row left behind by a GM
teleport costs one poll of a wrong-looking panel and nothing else. The raw
relocation writers clear it anyway.

**Somebody being held is not available to be picked up.** `escortAuthority`
returns `null` for them — above the FORCED branches, so an ambusher cannot walk
off with their own prisoner either; taking them somewhere is what the Gambit is
for. `performLocationMove` re-checks it per follower, because a hold can land
between the pick and the walk, and drops them into `leftBehind` with the reason
`held`. That is the one `leftBehind` reason the leader IS told, because it is
plain to see. See [`INTERCEPT.md`](INTERCEPT.md).

## 3b. The Stepstone — the one move that is not travel

A `catalog: secret` item that a player spends to stand somewhere else. It is a
**raw relocation**, the same shape the Dev Panel's Teleport uses: no ⬢, no Move,
no adjacency check, no cooldown, and no Action filed. It reaches **every
surface Location, known or not** — the fog behind /map does not narrow it.

**The one refusal is the underground.** A `CAVE_LEVEL` zone is never a target,
and `stepstoneRequest` re-checks that server-side rather than trusting the
picker. The test is written as "is `SURFACE`" rather than "is not a cave":
`ZoneKind` has three values and `CAVE_GROUP` is not a place anybody stands, so
phrasing it positively keeps a zone kind added later out of the stone's reach
until somebody decides it should be in. Destination only — stepping *out* of
the caves is fine.

**There is no STOOD-only restriction, deliberately, and the consequence is
real: the stone is a way past every locked gate on the surface.** The `seen`
half of the fog is written for every **listed** neighbour, and §2 above is
explicit that `listed` is weaker than `passable` — a locked door or a shut
portcullis is listed on purpose, so you know it's there and cannot open it.
The stone does not care. The Undercroft is reached
by a `hidden: elevator-key` connection and the Charon is down there; the
Brigand camp, the Keep and the Underquarter are all surface Locations behind
gates a stone-holder no longer needs to open. The caves are the one thing still
walled off, which is what keeps the caving gate and the Caving Die meaning
something.

**A hold stops it**, the same as it stops a walk (`INTERCEPT.md`): an ambush is
a hand on your shoulder, and the stone is not the way out of one.

It writes `locationId` **and** `zoneId`, clears `travelToLocationId` /
`travelTurnId` / `escortedById`, and then calls `applyLocationMoveSideEffects`
(§4) like every other writer of `locationId` — which is what gets it the
`LocationVisit` row, the channel overwrite, the zone role, the carry settle and
the corpses it is carrying, for free. `rollCavingOnArrival` runs after, because
stepping into the dark wakes it the same as walking in.

**Anyone escorting the stepper is cut loose**, not merely left behind — the
step clears their `escortedById` the way `db/lib/characterDeath.js` does when a
leader leaves play. Left dangling, `partyOf()` would go on counting followers
standing in another zone, which can cost a mounted leader the horse's extra
crossing for a party that is not with them.

And because a teleport crosses no graph link, `announceGateCrossing` has no
edge to read and posts nothing: you arrive without the gate line a walker would
set off, which is the closest thing the item has to stealth.

## 3c. Walking across a zone

**Pick somewhere farther in your own zone and the game walks you there, hop by
hop.** `db/lib/locationWalk.js#walkWithinZone` is the whole of it, and the first
thing to know about it is what it is **not**: it is not a mover, and it is not a
teleport. Every step is the ordinary single-hop pair every other caller runs —
`performLocationMove` for the database half, then `applyLocationMoveSideEffects`
for the Discord and game half. This file writes no `Character.locationId` of its
own.

That is the design rather than an implementation detail. Because each hop is the
real one, **everything fires at every stop on the road**: the Depot and
gatehouse turrets, anybody laying in wait, the gate lines, arrival mood, the
Caving Die, the carry settle and the fog write. Walking past a watched
crossroads gets you caught there. A walk is a shortcut through the clicking, not
a shortcut past the game.

**It costs nothing**, because a hop inside a zone costs nothing (§3). No travel,
no Move, no confirm dialog. That is also exactly why it is the only thing the
map's double-click may do (§6c).

**The road is fog-limited.** `routesWithinZone` / `pathWithinZone` in
`db/lib/locationGraph.js` are the second multi-hop question in that file, beside
`soundRange` and allowed there for the same reason — nothing outside it may read
`LocationLink`. Three rules, and each is load-bearing:

- **Only through places the character already knows.** The fog set is `seen`,
  not `stood`, because `loadMap`'s own `visible()` draws the board off `seen` —
  a finder using the narrower set would refuse a rhombus the player is looking
  at, for a reason they cannot see.
- **The fog set is handed IN, never read here.** `db/lib/locationVisits.js`
  already requires `locationGraph.js`, so requiring it back would close a cycle
  and resolve to a half-built exports object at require time — a silent
  `undefined`, not a clean error. Callers pass `knownLocations(…).seen`.
- **Same zone, every step of it, not just the endpoints.** It falls out of the
  `where: { zoneId }` on the location query rather than being re-checked per
  node, so a road cannot duck out of the zone and back in through somewhere
  nobody looked at.

Every edge is judged by `crossingCheck`, the very verdict `performLocationMove`
reaches again at each hop — there is no second copy of the gating rule here. The
hold and the Caving Die are deliberately **not** asked: the mover asks them, in
its own words, at the hop that meets them. Neighbour lists are sorted by slug
before the search, `soundRange`'s reason sharpened — the surface that *shows* a
route and the walk that *takes* it must pick the same road, or somebody is shot
by a turret on a street they were never told they would pass.

`WALK_HOPS` is a module constant, not a `GameConfig` field: a safety rail so a
mistake in the graph cannot become a thirty-hop run of Discord calls.

**The debounce is claimed once, by the first hop.**
`GameConfig.locationMoveCooldownSeconds` is a debounce on clicking, not a game
rule, and waiting it out between hops would make a four-hop walk nine seconds of
refusals. So hop 1 makes the ordinary claim — two tabs starting a walk in the
same tick still resolve to one — and every later hop passes `skipCooldown`,
which **swaps** the conditional `updateMany`'s clock for `locationId: <where we
read them>` rather than dropping it. That is a narrower guard, not a missing
one, and the right one for a walk: the thing a walk must never do is step on
from a position it no longer occupies, so an escort, a GM teleport or a Stepstone
landing mid-route stops it. `data` is untouched either way, so every hop
re-stamps `lastLocationMoveAt` and the **last** hop is the one the next click
waits on. `skipCooldown` is refused outright on anything but a same-zone hop, so
it can never become the hole that skips the free-crossing arithmetic.

**It stops at the first refusal and keeps the ground covered.** `ok: false` only
when the very first hop refused and nobody moved; anything later is `ok: true,
complete: false` with `stoppedBy`, and the player is standing where the last hop
put them. Every surface leads with **"You got as far as the Yard."** and then
prints **the mover's own sentence**, never one written at the surface — that is
what keeps a hidden crawl's refusal identical to a nonexistent edge's (§2a).

**The mover has no death gate, and the walk supplies one.** This is the sharpest
edge in the feature. `performLocationMove`'s incapacitation check is
`blockerFor(tags, ACT)`, and death sets `status: "DEAD"` while *stripping* tags
rather than granting a blocker — so a walker the Depot gun killed at hop 2 would
march on and be delivered to the destination as a corpse. The loop re-reads the
mover between hops and checks `status` itself. The re-read is mandatory for
three more reasons besides: `status`, `heldUntil` and `tags` are all written by
`applyLocationMoveSideEffects` *after* the mover already returned. It re-reads
with `ESCORT_SELECT`, because the next hop hands that row straight back to the
mover, which re-authorises the party off it (§3a's missing-`faction` trap).

**The party follows the whole way, and nothing was needed to make it so.** Each
hop reads `escortedById` inside its own transaction, so followers are carried
step by step and roll their own turret and Caving dice at every stop. One the
road refuses at hop 3 is left standing at hop 3 rather than back at the start —
which is right, they walked that far. The mover's own `escortedById` is cleared
at hop 1, the ordinary "walking under your own power detaches you" rule (§3a),
so setting off on a walk puts down whoever was carrying *you*.

**The caller must not run its own side-effect loop.** `walkWithinZone` returns
`sideEffectsApplied: true` and both faces branch on it. Reusing the single-hop
loop over the merged `moved` list would fire every turret twice and re-roll
every Caving Die — the easiest thing here to get wrong.

**What it costs in traffic** is worth knowing rather than discovering. Each hop
is a transaction plus a full `applyLocationMoveSideEffects`: the channel
overwrite swap, room access, thread invites, `notifyPresence`, a gate line. A
long walk with a party is a genuinely multi-second action and the Discord sidebar
visibly steps through each Location. That is correct — each stop really happened
— and it is what `WALK_HOPS` is small for. Same-zone hops write no archive rows
either way, since those are gated on `crossedZone`.

## 4. The Discord half

**`db/lib/locationMove.js#applyLocationMoveSideEffects(prisma, entry)`** is
the single function every caller runs after its DB write commits — never
from inside the transaction, the same reasoning `db/lib/dm.js` documents.
Grant-before-revoke throughout: it swaps the Location role, and — only if
the zone changed too — the zone role and the narrowcast reconcile; then
`syncCharacterRoomAccess` for wherever the character now stands and
`applyPendingInvites` for any standing Conversation invite there. Every call
is individually catch-logged; the channel doctor is the safety net for
whatever it misses. See `CHANNELS.md` §3–§4 for the roles and the private
Room membership it drives.

Every caller — the Travel button on `#turns`, `/location`, character
creation, a GM's raw edit or teleport, GM Bulk Move, and the staged
"Relocate to" applied at the turn push — runs
`performLocationMove` (or a raw relocation, for the GM/creation paths) then
this function. Any new writer of `Character.locationId` must call both, or a
player either sees the wrong place or none.

### 4a. Two fogs, and they never mix

There are two "fog" tables and they have opposite lifetimes. Do not reach for
one when you mean the other.

- **`LocationVisit`** (`db/lib/locationVisits.js`) is the **map** fog, behind
  `/map` (§6). It is per character, it only ever grows, and **nothing ever
  unlearns a row** — seen once, drawn forever.
- **`Vantage`** (`db/lib/vantages.js`) is the **channel** fog, per turn. A row
  says "this character walked out of here and is still watching it", and every
  row goes the moment they leave the zone or the day turns
  (`CHANNELS.md` §3aa).

`applyLocationMoveSideEffects` writes both, a few lines apart, which is exactly
why they need different names. It takes a `walked` flag, defaulting **false**,
and only the Travel button and the web's own travel action pass it — a
teleport, a rite, a spawn, Xom and a staged "Relocate to" record the visit on
the map but light nothing, because nobody walked out of anywhere.

## 5. Tax runs and the Lifeweb

Travel cost is also what a **tax run** costs. Handing ⬢ or an item to a
person requires the same zone — so a payment across zones is still a journey
somebody physically makes, checked against `Character.zoneId` exactly as
before. See `FACTIONS.md` §3b.

The Lifeweb is the same rule with a fixed address: bleeding or feeding
someone to the Web needs the Mortus **and** the target standing in the
Fortress zone, because that is where the tower is (`REQUESTS.md` §5a).

## 6. The web `/map` panel

`/map` is the travel graph drawn over the Ravenheart plate: one rhombus per
Location, one line per edge the character may see, with the plate itself
underneath. It replaced the retired four-rhombus zone panel, which went out
with per-zone-only travel and left this note in its place for a while.

Two hosts, **one component** (`web/app/(app)/map/MapBoard.js`): the `/map`
route, and an overlay on `/chat` opened by the place card's **Open map** and
closed with Escape, the backdrop or Return to game. On a folded viewport the
button navigates to the route instead of opening the overlay — a full-bleed
board inside the phone's "Here" sheet would be a dialog inside a dialog, and
§6e is what makes the route the better place to land anyway.

**Drag to pan, pinch or wheel to zoom**, with `−` / `+` / Reset as the path
for anyone who does neither. The whole view is `{x, y, k}` in a ref, written
straight onto one `<g>`; nothing about the board is React state, because a
pointermove that re-rendered fifty nodes and eighty lines drops frames on a
phone.

### 6a. The fog

**A player sees the country they have walked, not the board.** Two grades:

| Grade | Means | Draws |
|---|---|---|
| `stood` | been there | solid core, full label, description |
| seen | only ever one step away from it | hollow core, muted label, **no** description |
| — | neither | absent from the payload entirely |

**Seen once, drawn forever.** Walking away never takes a place back off the
map, so it only ever grows — which is also why the board can count itself
("12 of 55") and have that mean something.

`LocationVisit` is the record, and `db/lib/locationVisits.js` is the only
module that touches it. There was nowhere to derive this from: `AuditLog` has
no `locationId`, `ArchiveEntry` is keyed to a zone rather than a Location, and
a free in-zone hop files no `Action` at all.

Three things about it are easy to get wrong:

- **The write hangs off `applyLocationMoveSideEffects`**, not
  `performLocationMove` — §4's rule is that the first is what *every* writer of
  `Character.locationId` runs, so a GM teleport, a first placement, a rite and
  the arrival pass all record themselves. Hooking the mover would have left
  each of those a hole.
- **The neighbour write is a `createMany` with `skipDuplicates`**, and that is
  load-bearing rather than an optimisation: it is what makes walking past a
  door unable to downgrade a place you have actually stood in back to a
  sighting.
- **It reads `travelOptions`, never `LocationLink`.** A hidden crawl the
  character cannot use is therefore never recorded, and can never be revealed
  by the map later.

`loadMap()` re-records the character's current Location on every open, so a
sighting the post-commit hook dropped heals itself the next time they look.

**The fog does not start fully closed.** A character is made knowing the places
their life would have taught them — the home cluster, plus the road their trade
actually walks. A Headman opens the board already seeing the Farms he has taxed
for years; a Banneret sees every step of the run up to town. The table is
`db/lib/startingMemories.js`, keyed by role slug, with a second half keyed by
the Commoner kit crates so a farmer and a hunter wake up knowing different
roads. `createCharacter` calls `seedMemories()` once, after the transaction
commits — after, because `travelOptions` reads the tags it just granted.

**Leaving a slug out of that table is not a guarantee it stays dark**, and it is
worth being clear about why. `recordArrival` paints every *listed* neighbour of
a seeded Location, and a locked way is listed — so `hills-mountain` reaches all
thirteen Fortress seats through the locked `servant-wing` climb whether the
table names it or not, which is correct: you can see a mountain from the road.
What leaving a slug out really protects is a **hidden** way, since
`travelOptions` drops those before the sighting write ever runs. The table is
therefore written to the standard of "would this seat's life have taught them
this", not "is this a secret" — the cargo-bay seats stop at `caves-approach`
rather than the Migrants' camp, because the camp is one open road from the
brooding grounds and two from the mouth of the Depths.

### 6b. What the fog must never leak

**The fog is server-side, not CSS.** An unknown Location is absent from
`loadMap`'s payload; it is not sent and hidden. A server action is a public
endpoint.

**An edge draws only when both ends are known *and* `crossingCheck` says
`listed`.** That is the §2a rule applied to a picture: a locked door draws
dashed and says why, a hidden crawl draws nothing at all and reads exactly like
two places with no way between them. The three `hidden: caving` crawls are the
only unknown ways into the Depths, and this is what keeps them that way.

**The Underground switch is hidden until the character knows somewhere
underground.** Offering it earlier would announce that a second layer exists.
`customs` draws on both layers — it is the threshold, and hiding it from the
surface would make the way down start nowhere.

### 6c. Travel

The map is a second **door** onto travel, never a second mover. Picking a
reachable node opens the same confirm strip the Travel panel uses, reading the
same numbers through `web/lib/travelCost.js#travelFoot` — extracted from
`TravelNodes.js` precisely so the two surfaces cannot disagree about what a hop
costs — and Go calls the same `travelTo`, which re-derives every gate
server-side regardless.

**A click only picks**, on both surfaces and every pointer, and the card's (or
the strip's) **Go** is the ordinary door onto `travelTo` — including for a place
several hops away, which is how a walk is taken on a phone. A second click on
the place you already picked unpicks it on the map, and on the Travel panel
leaves the strip where it is.

**A zone crossing asks again on top of that.** Go opens the shared
`useConfirm()` dialog, naming the zone, what the crossing spends, and how many
people come with you. Both surfaces build that sentence from one place,
`web/lib/travelCost.js#crossingConfirm`, for the same reason they share
`travelFoot`.

#### The gesture, and the two limits on it

**A double-click on the map walks you there, and Enter does the same thing.**
It is a shortcut for a mouse, not the way the feature works — everything it can
do, Go on the card can do, on any device.

This was taken out once, and the history is why the limits are shaped the way
they are. The second click used to be Go for a hop inside your own zone. Two
complaints ended it. A player double-clicked while reading the menu, crossed a
zone he had not chosen and took somebody with him; then on a phone, where the
Travel panel is a drawer full of small nodes, a tap that landed on the node
already chosen moved somebody with no sentence in front of it at all.

So the gesture is back under exactly the two limits that answer those two
complaints, and `canGestureTo` in `MapBoard.js` is both of them in one place:

- **Never across a zone.** That is the first complaint, closed at the root
  rather than warned about: a hop inside your own zone spends no travel, no
  Move, and nothing anybody else has to live with. There is nothing left for a
  stray double-click to waste. A crossing still wants the strip, the confirm
  dialog and a deliberate press — `canGestureTo` is deliberately a SHORTER list
  than `canTravelTo`, and that gap is the whole design.
- **Never down a road that would take your horse off you.** The one thing a
  walk does that cannot be undone for free (§2c). Go still offers it, with
  `· on foot` written on the node first.
- **A mouse, tested on the pointer itself.** `PointerEvent.pointerType`, kept in
  a ref on every `pointerdown`, and **not** a `(pointer: fine)` media query —
  which is true on a tablet with a mouse paired to it *while a finger is on the
  glass*, and would hand the second complaint straight back. A finger reports
  `"touch"` and a pencil `"pen"`, so a tap can never be a gesture on any device.
  `.map-hint` is hidden under `(pointer: coarse)` for the same reason, so a
  phone is never told about a shortcut it does not have.

**And the stops are named before the gesture is made.** The card reads
`Through the Market and the Yard.` above Go, from
`web/lib/travelCost.js#walkLine`. That sentence is what turns "a gesture moved
me somewhere" back into "I chose to walk through the Market and the Yard", and
it is load-bearing rather than decorative: if it ever gets cut for space, the
gesture should be cut with it.

**Order matters in the handler, and is easy to get wrong.** A browser fires
`click`, `click`, `dblclick` — so the second-click unpick has *already* set
`sel` to null by the time `onDoubleClick` runs. The handler therefore acts on
its own node and asks `sel` nothing; written as `if (sel === n.id)` it would
never once fire, and would read as the feature simply not working.

**Enter is the same affordance with a keyboard.** It is a **document-level**
`keydown` that only exists while a node is picked, not a focusable rhombus.
Fifty SVG `<g>`s in the tab order in front of Go is worse than no keyboard
support at all, and `role="button"` on each would have a screen reader read the
whole plate as a toolbar. It stands aside whenever `document.activeElement` is a
`button`, `a`, `input`, `textarea`, `select` or anything in a `[role=dialog]` —
so Enter on Go, on the layer switch, or inside the confirm dialog this very
handler can open is never handled twice. There is still deliberately **no
Escape**: on `/chat` the map sits in a Modal that already owns it.

**Tapping the plate itself unpicks**, on both surfaces. A node's own handler
owns its clicks and the drag guard still applies, so this is only ever a tap on
open ground. It is a second way out of a card, beside Cancel and the node's own
second click, because on a phone a description sitting over most of the board
with nothing obvious to do about it is a trap.

`canTravelTo(node, here)` is the one predicate the board and the card read for
**Go**, so a place can never offer it while its own card is showing a refusal.
It has two ways to say yes: next door and open, or `walkable` — somewhere
farther in your own zone, reached through places you already know (§3c).
`canGestureTo` is the narrower second predicate above, and the only one the
double-click and Enter read.

### 6d. The plate

`docs/assets/map-nodes.json` places every Location on the art in image pixels,
read at runtime through `web/lib/mapNodes.js` (the `web/lib/handbook.js`
pattern, `docsPath()` rather than `__dirname`). A Location the table does not
place is simply not drawn, rather than stacked on the origin. Surface nodes sit
on the drawing; Caves and Depths are a schematic layer, since the plate draws no
tunnels.

`docs/assets/map-prototype.psci` is the ASCII-editable source for the plate,
opened in [Playscii](http://vectorpoem.com/playscii/). The PNG beside it is an
export, so a change to the map is made in the `.psci` and exported over the
`.png` — editing the raster directly leaves the two out of step and the next
export throws the edit away. Nothing at runtime reads the `.psci`.

The art is a raster and never follows the theme — but it was drawn with exactly
one accent in it, `#57a9bc`, the water, and that blue answered to nothing. So
the river is cut to an alpha mask (`docs/assets/make-map-river.py` →
`web/public/assets/map-river.png`) and painted through it with `--map-river`,
which each theme sets for itself. Everything else drawn on the plate — the
rims, the cores, the ways — is tokens all the way down.

`Zone.mapPolygon` / `mapLabelX` / `mapLabelY` are still there and still always
null: they described the retired panel's four rhombi, and nothing reads them.

### 6e. The board on a phone

For a while the map was readable on a desktop and a picture of a map on a
phone: there was no pinch handler at all, `touch-action: none` had already
taken the browser's own away, and the only zoom left was two ~20px buttons in
a corner. Three things fix it, and they are all in `MapBoard.js` and the
`/map` block of `globals.css`.

**Pinch is two pointers and one number.** Every pointer down on the board is
kept by id in a ref; a second one ends the pan and starts a pinch, measured by
`gauge()` as the distance between the fingers and the plate pixel between
them. Each move hands `zoomBy` the ratio of the distances, the **old**
midpoint as its anchor and the **new** one as where that anchor should land —
which is the whole trick, because it makes a two-finger drag pan and zoom in a
single write. `to` defaults to `at`, so the wheel and the buttons are
unchanged. Two things are easy to get wrong and are handled: lifting one
finger of two re-seats the pan on the finger that is *left* (on the midpoint,
the map leaps by half the gap between them), and `panned` is set the moment a
second finger lands, so the click that fires when the last one lifts is never
read as picking a place.

**The zoom floor of 1 still holds**, and pinch-panning survives it: at the
clamp the factor is swallowed and the translation is not, so a two-finger
drag at full extent still moves the board.

**A node is about two pixels across at the floor**, so each carries an
invisible `.map-node-hit` square — the `.check-hit` idea in SVG. It is inert
on a mouse, which does not need it and would only lose precision. `HIT` is 27
plate pixels half-width, which is not a taste: the two closest Locations on
the plate sit 54.6 apart, and anything wider turns a tap in the Fortress into
a lottery. `applyView` writes `--map-hit` on every frame to shrink that toward
44 CSS px once you are zoomed in far enough to have the room. Below about
2.7× the cap binds and the target is simply as big as it may be — which is
honest: fifty nodes over 375px cannot each own 44px, and pinch is the answer
to that, not arithmetic.

**There is no zoom bar on a phone.** Pinch is the zoom, and the bar was sitting
over the top-left corner of the plate — Headwaters and the Mountain live under
it — to buy back a control nobody was reaching for. Reset went with it and is no
loss: `applyView`'s clamp means you cannot get lost off the plate, and pinching
out to the floor shows the whole thing. Only the layer switch is left up there,
and a tablet wide enough for the two-column layout keeps the bar.

**Under 640px the card is a sheet over the board, not a column beside it.**
It used to be a strip underneath taking 40% of an already short screen, which
letterboxed the plate. Over it, the drawing runs on underneath and anything
the sheet covers is one drag away. Its two heights come off `sel` and nothing
else, through a `data-picked` attribute — nothing picked is a caption and its
Ways out list, something picked opens far enough to show Go. The `.map-hud` wrapper is
`display: contents` on a desktop, so the layer switch and the zoom bar each keep
the corner they have always had; on a phone it is a column, which is what let
the two stack rather than fight over 486px of a 390px screen — and is now
carrying the layer switch alone.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/locationTravel.js` | `performLocationMove` — validation, the cooldown or the Move, walking the party, the Caving roll; no Discord |
| `db/lib/locationWalk.js` | `walkWithinZone` — several hops inside one zone on one press (§3c). NOT a mover: every hop is `performLocationMove` and then `applyLocationMoveSideEffects`, which is what makes the turrets and the ambushes real at every stop |
| `db/lib/escort.js` | The escort authority, the party, and the consent handshake — §3a. The ONLY module that decides who follows whom |
| `db/lib/travelArrivalPass.js` | a DRAIN. Nothing files work for it; it lands anybody left mid-journey by the removal of deferred travel (§3) |
| `db/lib/intercept.js` | Laying in wait, and the hold it puts on somebody — [`INTERCEPT.md`](INTERCEPT.md). The ONLY module that decides who a watch catches |
| `db/lib/locationMove.js` | `applyLocationMoveSideEffects` — the Discord half, shared by every caller |
| `db/lib/roomAccess.js` | `syncCharacterRoomAccess` — private Room membership |
| `db/lib/threadInvites.js` | `applyPendingInvites` — replays standing `/add` invites on arrival |
| `db/lib/seatZone.js` | `seatZoneIdFor` — the presence-zone → seat-zone mapping |
| `db/lib/mounts.js` | `FAST_TRAVEL_SLUGS`, `isMounted`, `fastTravelCapacity` (the seat count §3a gates the mount's bonus on) |
| `db/lib/turnFormat.js` | `turnDay` — the in-game day a mount's second crossing is claimed against |
| `db/lib/locationGraph.js` | `LocationLink` reads and the gating verdict — the only module that touches the edge model. Also the two multi-hop questions: `soundRange` for how far a shout carries, and `routesWithinZone` / `pathWithinZone` for a walk (§3c) |
| `db/lib/locationAttributes.js` | The attribute registry, its sync-time validation, and the prose Examine prints |
| `db/lib/locationVisits.js` | The fog: what one character knows of the map. The ONLY module that reads or writes `LocationVisit` |
| `db/lib/startingMemories.js` | The map a character is made knowing — role slug and Commoner kit to Location slugs — §6a |
| `web/app/(app)/map/` | `loadMap()`, the board, and the route — §6 |
| `web/lib/travelCost.js` | `travelFoot` — what a hop costs, in the words both travel surfaces print. `walkFoot` / `walkLine` are the same job for a walk |
| `docs/zones.yaml` | The master: zones, Locations (with their seeded `structures:`), Rooms, and `connections:` with its edge types |
