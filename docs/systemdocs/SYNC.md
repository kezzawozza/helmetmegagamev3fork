# YAML masters and the sync scripts

**Places moved off this page.** Zone, Location and Room are now authored on
`/gm/dev/zones` (`docs/systemdocs/DEV-PANEL.md` §Zones), not in
`docs/zones.yaml`. The old `db:sync-zones` was destructive — a dropped row
lost its Discord footprint and everything in it, which caused real
incidents — and that's exactly the kind of accident an admin UI with a soft
retire is meant to stop happening again. `docs/zones.yaml` still exists on
disk, but only as the one-shot, additive `db:import-zones` now (create
missing rows, skip existing, never update, never delete) — for standing a
game up the first time, or adding a new region to a running one. Treat the
`docs/zones.yaml` row below as history for everything else: hand-editing it
no longer reaches a running game on its own.

The remaining five hand-edited YAML files under `docs/` are the sole source
of truth for their tables. Each has a sync that reconciles the database to
it. They look alike and **differ on every axis that matters**, which is the
reason for this page.

There is deliberately **no admin UI** for any of these five. Editing the
YAML and running the sync is the only way their rows change.

## 1. The six at a glance

| Master | Script | Table(s) | Match key | Removal behaviour |
|---|---|---|---|---|
| `docs/zones.yaml` | `db:import-zones` | `Zone`, `Location`, `Room`, `LocationLink`, `LocationYield`, `Structure` | `slug` (a link by its endpoint pair, a yield/structure by location + kind/type) | **Additive, never deletes** — creates a row the database doesn't have yet, skips one that does, and never writes a `discord*Id` column. Keeping Discord true to the database afterwards is `db/lib/discordMirror/` (`npm run db:mirror`), not this importer |
| `docs/tags.yaml` + `docs/taggroups.yaml` | `db:sync-tags` | `Tag`, `TagGroup` | `slug` | **Upsert-only** — never deletes; a removed entry just stops receiving updates. `db:prune-tags` is the opt-in destructive half (§3b): it prunes a tag absent from `docs/tags.yaml`, and once no surviving tag sits in it, a group absent from `docs/taggroups.yaml` too |
| `docs/roles.yaml` | `db:sync-roles` | `Faction`, `Role` | `slug` | **Prunes only if unreferenced** — a Faction with members or roles is left in place and reported |
| `docs/desires.yaml` | `db:sync-desires` | `DesireTemplate` | `slug` | **Soft-retire** — a dropped slug is never deleted, only marked `retired: true` (hidden from every picker; existing `Desire` rows referencing it keep running). A slug that comes back has it cleared. See `DESIRES.md` §10 |
| `docs/documents.yaml` | `db:sync-documents` | `Document` | `key` | **Destructive** — pure reference content, no player state to preserve |
| `docs/labordrops.yaml` | `db:sync-labor-drops` | `LaborDropOption` | none (rebuilt whole) | **Destructive** — pure config, no player state ever points at a row. See `LABORDROPS.md` |

**Run order matters for the five routine syncs:** tags → roles → desires →
documents → labor drops. Roles
resolve a `starting_zone` and an optional `starting_location` by slug, and a
Faction's zone by name, and validate
`starting_tags` against the tag catalog; desires validate `requires.anyRoles`/
`notRoles` against the Role catalog and `requires.anyTags`/`notTags` against
the Tag catalog, so it runs after both; documents validate against tags,
roles *and* factions; labor drops validate every pool entry against the tag
catalog and every scope against the zone/location catalogs, and has no
dependents of its own, so it runs last. Running them out of order throws on a
reference that would have existed. `db:import-zones` is a one-shot standing
apart from this order — run it whenever `docs/zones.yaml` names a place that
isn't in the database yet, before or after the rest, and follow it with
`npm run db:mirror -- --apply` (or let the next bot restart or turn advance
do it).

`db:sync-narrowcast-channels` provisions the `radio` category from its own
registry; a zone role it grants against comes from whatever last ran
`db:import-zones` and `db:mirror`.

## 2. Where they differ, in detail

### Entry format: keyed maps, not sequences

Every catalog block in the masters is a **map keyed by the entry's own id** —
`town:`, `hungerless:`, `drink-alcohol:` — not a sequence of `- id: town`. The
reason is authoring, not parsing: an editor's outline labels a map entry with
its key and a sequence entry with its index, so 500 tags used to read as
"{} 0, {} 1, {} 2". A sequence with no id of its own (`subLocations:`,
`roles.yaml`'s four `zones:`, every scalar list) stays a sequence.

Each sync reads its block through `entriesOf()` in `db/lib/yamlEntries.js`,
which accepts either shape and hands back the old array of objects with the
key folded back in — so document order, and every sync that depends on it,
is unchanged.

### Match keys

`slug` everywhere except `Document`, which uses `key`. **Zones, Locations and
Rooms share one slug namespace** — a Location named like its own zone would
make "which thing is `town`?" ambiguous everywhere slugs are read, so the sync
rejects a duplicate across all three lists.

Locations follow one naming rule, split between built places and open country.
A built place takes a bare slug — `keep`, `factory`, `cathedral`, `depot`.
Open country takes its zone as a prefix — `forest-creekside`, `hills-gullies`,
`marshes-village` — because every zone has a ravine and a river, and the slug
is also the Discord channel name.

A changed `id` is not a rename: the old entry is pruned and a new one
provisioned from scratch, losing its Discord objects. Rename by editing `name`.

### Create-only fields

`Faction.parentFactionId` is create-only. The hierarchy is authored in
`roles.yaml` (`parent:`), but once a faction row exists its parent is **live
game state** — a clan can break away mid-game, or be absorbed by another, and
that is a GM edit on `/gm/dev/factions`. An ordinary re-sync leaves it alone,
so it can't quietly re-parent a faction under the one it rebelled against —
so editing `parent:` in the YAML for a *future* game is still the right move,
it just doesn't reach a game already in progress. A Leader secedes from
`/faction` too, not just a GM (`FACTIONS.md` §3).

`Faction.siloRoomId` is a **floor** rather than create-only, which is one
notch weaker. `roles.yaml`'s `silo:` names a Room slug, and the sync writes it
only while the faction has no silo at all. Re-pointing a silo in play writes a
non-null id, which the sync never touches — so a Leader's choice is as safe as
under create-only, and a faction that predates the column still gets the one
the YAML names for it. Rooms come from `db:import-zones`; an unknown slug
warns and skips rather than throwing.

A room's `stash:` in `docs/zones.yaml` is history now, not instruction.
`db:import-zones` never seeds one — a stash line in the YAML for a newly
created room is reported with "seed from /gm/dev/zones, not the importer"
instead of being written. That is the fix for what used to be a real faucet:
the old sync restocked a stash on every run because taking the *last* unit
of an item deletes its `RoomTag` row (`db/lib/tagWrites.js#dropRoomTag`), so
a room players had stripped bare read as one that had never been seeded, and
on 2026-09-10 a single `db:sync` put 139 items back into a live game that
way. `Room.seededStashSlugs` still exists and still means "never seed this
slug again", but the only writer of it now is the "Seed these items now"
button on `/gm/dev/zones`. `db:dedupe-room-stash` (§4) is the cleanup that
followed the 2026-09-10 incident.

A Location's `structures:` is a promise the importer keeps at creation time
only. It lists the slugs of placement tags that are always standing there
(the Square's cross), and `db:import-zones` creates one `COMPLETE` `Structure`
row per slug for a **newly created** Location — no builder, no payer — only
while nothing of that type in `PRESENT_STATUSES` stands there yet. It never
touches structures on a Location that already existed (skipped by slug, like
everything else), and it never deletes one. Because tags may not have synced
yet, a database with no `Tag` rows warns and skips; run `db:sync-tags` and
`db:import-zones` again to pick those up.

### The importer plus the mirror

`db:import-zones` only ever writes the database, and only rows that don't
exist yet — it never touches Discord and never writes a `discord*Id` column.
Turning a freshly created row into a category, channel, role or thread is
`db/lib/discordMirror/`'s job instead, run by `npm run db:mirror -- --apply`
or picked up automatically on the bot's next restart, the next turn advance,
or the next queue drain.

That hash is also what makes a **live room** cheap. A Room may carry
`live: <key>` naming a renderer in `db/lib/roomLive.js`; its starter message
then ends with one line read off live state, and
`syncZones.js#refreshLiveRooms(prisma, key)` repaints every room on that key
whenever the state behind it moves — the Landing Pad saying whether the shuttle
is on it. Because the body is hashed, a refresh over unchanged state writes
nothing. The Landing Pad is the only one so far; the mechanism is general.

### The zones.yaml format

```yaml
zones:
  town:                   # the key IS the stable slug the sync matches on
    name: Town            # display name, used only at first provisioning
    kind: surface         # surface | group  (a group's levels become CAVE_LEVELs)
    sort: 1
    description: >-       # zone-level blurb; prose only, not shown on any anchor
    map:
      polygon: [[50, 30], [95, 30], ...]   # dormant — see MAP.md
      label: { x: 74, y: 50 }
    locations:             # → Location rows → one text channel + role each
      square:               # zones/locations/rooms share ONE slug namespace
        name: Square
        description: >-     # the anchor's -# subtext and the channel topic
        yield: { hunting: 0.5, farming: 0.3, fishing: 0.7 }
                             # → LocationYield rows. Optional, 0–2, omit a kind
                             #   rather than writing 0. An absent kind CANNOT be
                             #   worked here at all. See LABORING.md §3.
        rooms:               # → Room rows → threads under the Location channel
          the-charon:
            name: The Charon
            description: >-
            access: [barons-key]   # non-empty ⇒ PRIVATE; any-of these tags admits
            live: shuttle              # optional; a key from db/lib/roomLive.js.
                                       #   Appends one line read off live state to
                                       #   the starter message, repainted whenever
                                       #   that state moves. Unknown key ⇒ problem.
    levels:               # groups only; each becomes a standable CAVE_LEVEL zone
      caves:
        locations:
          ...

connections:              # the whole travel graph. ONE entry per edge — it is
                          # undirected, and listing it twice is an error.
  - [town/square, fortress/gatehouse]        # crosses zones: costs the Move
  - [town/square, town/cathedral]            # same zone: free, on the cooldown

  - pair: [fortress/gatehouse, fortress/road]   # the mapping form, for an
    announce: true_name                         #   edge that is not a plain
    modular:                                    #   open road
      roles: [cerberus]
      tags: [cerberon]
      open: true
  - pair: [fortress/undercroft, forest/forest-cliffs]
    hidden: elevator-key
  - pair: [fortress/road, hills/hills-underlocks]
    locked: mountaineering
    on_foot: true
```

A `connections` entry is either a **bare pair** — a plain open road, which is
most of the map — or a **mapping** carrying the edge's type. The keys compose,
because one real edge is a manned gate *and* a modular one at once:

| Key | Effect |
|---|---|
| `announce: true_name` | a **manned gate**: posts the crosser's real name into the destination zone's `#summary`. `/conceal` does not help |
| `announce: concealed` | an **unmanned gate**: posts only their concealed alias |
| `locked: <tag-slug>` | crossing needs the tag; the way is still **listed** |
| `hidden: <tag-slug>` | needs the tag **and** is absent from the travel list |
| `modular: { roles, tags, open }` | an Open/Close button on both anchors, impassable while shut |
| `keyed: true` | on crossing, DMs the key-holder "Leave open for the next 24 hours?" — needs a `locked` or `hidden` tag, since an open way has nothing to hold |
| `on_foot: true` | no horse or cart fits: a **mounted** character is refused at the threshold (`MAP.md` §2c) |

`locked` and `hidden` are the same requirement with different visibility, so an
entry may carry one or the other, never both. Each entry becomes exactly one
`LocationLink` row with endpoints in ascending slug order — see `MAP.md` §2a.

**`modular.open` is what a link is BORN with, not something the sync
re-asserts.** A gate somebody shut in play stays shut across a re-sync;
otherwise every sync would silently reopen the Gatehouse. `openUntil` is left
alone for the same reason — a keyed way somebody is holding open keeps standing
open for its 24 hours.

`modular.open` is stored as `LocationLink.authoredOpen` and **re-asserted on
every sync run**, unlike `isOpen` itself, which stays play state the sync never
touches. A Restart Game wipe resets `isOpen` back to `authoredOpen` and clears
`openUntil` on every edge, the same as any other play state the wipe returns
to its authored default.

A `kind: group` zone may carry `levels:` but **not** `locations:` (locations
belong on its levels), and its own id may never appear in `connections` — it
isn't a place you can stand, only its levels' locations are. A non-group zone
may not carry `levels:`. Every presence zone needs **at least one** Location —
the parser throws otherwise. All of that is checked in pass 0.

`access:` slugs are **not** validated against the tag catalog — zones sync
before tags, so `docs/tags.yaml` doesn't exist to check against yet. A typo
there doesn't fail the sync; it just makes a room nobody can ever hold a key
to, and the channel doctor's `room-membership` check (`CHANNELS.md` §6) is
where that shows up, not this one.

The Tag and Role slugs a connection names — `locked`, `hidden`, and
`modular`'s `roles`/`tags` — are unvalidated here for exactly the same reason,
and the doctor's **`connection-slug`** check is where a typo surfaces. It
matters more than the room case: a locked way naming a tag that does not exist
is a way nobody can ever pass, and a *hidden* one is that plus invisible, so
nobody would even report it missing.

### Strict vs soft validation

Most references throw rather than half-apply — an unknown `parentTag`,
`requiredTag`, `starting_zone` or `starting_tags` name aborts the run. A
`starting_zone` must additionally be a **presence** zone: the Underground group
is a container, and a character can't start inside a container.

The one soft case is `connections` coverage: a Location in no pair at all is
**warned** about, not thrown on. It's legal in principle (a dead end nobody
walks to) and almost always a typo.

`documents.yaml`'s `tags:` list is the other deliberate exception. It conflates
real Tag names, the Leader/Treasurer booleans, and free-text authoring notes
like `"any of the medical tags"`. Each entry is routed to whichever bucket it
belongs in, and **anything matching nothing is reported, not thrown** — a
placeholder is a note to a human. The explicit `roles:`/`factions:`/`flags:`
keys next to it are strict and throw on a typo.

`syncTags` validates `consumesInto` up front against the YAML's own slug set,
before any write, so a typo fails cleanly instead of half-applying. It also
throws on `concealsIdentity` without `equippable` — a mask nobody can equip
could never conceal anything.

The rest of the headgear family throws the same way: `concealsIdentity` with no
`concealSprite`, a `concealSprite` naming a file that isn't in
`web/public/assets/helms/`, `forcesConceal` without `concealsIdentity`, an
`equipSlot` on something not `equippable`, an `equipLayer` outside that slot's
own range — 1–3 on `HEAD` and `BODY`, 1–2 on `MOUNT` — or with no slot, a
`HEAD`/`BODY` slot with no layer, and a layer on a `WEAPON` or an
`ACCESSORY`, neither of which has one. The sprite check is the interesting one: it is the only validation here that
touches the filesystem outside `docs/`, and it deliberately treats a missing
directory as "cannot check" rather than as a failure, since `web/public` may
not be laid out the same way inside a Next standalone build.

### Pass structure

`syncTags` runs **five passes**, because tags and groups reference each other
by slug before every row necessarily exists: TagGroup scalars → Tag scalars +
`groupId` → `parentTag`/`requiredTag` links → `TagGroup.requiredTag` links →
`requirement.skills`. Each pass writes only when something actually changed.

Zones no longer have a multi-pass sync of their own. `db:import-zones`
(`db/lib/importZones.js`) is the one-shot, additive half: it parses
`docs/zones.yaml` with the same `parseZonesYaml`, creates a
Zone/Location/Room/LocationLink/LocationYield/Structure the database doesn't
have yet by slug, and skips — never updates, never deletes — anything that's
already there. Keeping Discord true to whatever the database now holds is the
other half, and it isn't the importer's job at all: `db/lib/discordMirror/`
(`npm run db:mirror`) diffs the live guild against the rows and provisions,
renames or reparents to match, on the bot's restart, the end of every turn,
and a queue drain, as well as by hand.

## 3. Restart Game

`wipeGameData` (`web/app/(app)/gm/dev/actions.js`, superadmin only) is the one
caller that runs the syncs together, from a retrying step runner. The full
order — and why each step sits where it does — is in `LAUNCH.md`; the sync half
is zones → special channels → tags → roles → desires → documents, then the
channel doctor.

**This flow has been bitten by foreign-key ordering before.** Anything deleted
there has to come out in dependency order, and it's the main reason new log-ish
tables (`ArchiveEntry`, `AuditLog`, `SystemReport`)
deliberately use plain indexed id columns rather than real relations — see
`ARCHIVE.md`.

## 3b. Pruning tags

`db:sync-tags` never deletes, which is the right default — a tag a character
holds must not vanish because someone tidied a YAML file — but it means the
catalog only ever grows. `npm run db:prune-tags` is the separately-invoked
counterpart, and the only tag/group operation in this repo that deletes
anything: it prunes a `Tag` absent from `docs/tags.yaml`, and — once no
surviving tag sits in it — a `TagGroup` absent from `docs/taggroups.yaml`
too.

**It is a dry run by default.** Nothing is removed without `-- --apply`, the
same posture as `db:prune-orphan-roles` and `db:doctor`.

**Retiring a chain may take two applies.** Blockers are computed per run, so
a parent (`laboring-basic` under a removed `laboring-skilled`, a base tag under
its removed variants) is reported as still-referenced until the run that
deleted its children is over — run `-- --apply` again and it goes.

A Tag is deleted only when *every* one of these holds. Anything failing even
one is reported with its reason and skipped — never cascaded, never forced,
because a prune that skips silently is worse than one that deletes:

- its slug is absent from `docs/tags.yaml`;
- `Tag.custom` is false (a GM's homebrew is not orphaned just because the
  YAML never mentioned it — see `DEV-PANEL.md` §8);
- no `CharacterTag` references it;
- nothing names it as a `Tag.parentTagId`, a `Tag.requiredTagId`, a
  `requirementSkills` entry, or a **`TagGroup.requiredTagId`** — that last one
  is the hidden-category gate, and dropping it would silently open Demoness to
  everyone;
- nothing consumes into it (`Tag.consumesInto`);
- no other tag lists it in `conflictsWith` (checked in both directions —
  `db:sync-tags` writes the edge symmetrically, but a custom tag's edge isn't
  guaranteed symmetric, so the blocker check reads both `conflictsWith` and
  `conflictedBy`);
- no **non-retired** `DesireTemplate` gates on it via
  `requiresAnyTags`/`requiresNotTags` — a gate held only by a retired
  template (`DESIRES.md` §10) no longer counts as a blocker;
- no `Role.startingTagSlugs` grants it and no `Document.tagSlugs` is assigned
  by it. Note `Role.startingTagSlugs` is misnamed and holds tag **names**,
  while `Document.tagSlugs` really does hold slugs.

It is deliberately terminal-only and **not** wired into Restart Game: a wipe
clears every `CharacterTag` first, so a prune running there would find every
custom tag unheld and delete the lot.

**A `TagGroup` prunes the same way, once it has no tags left.** After tags
are pruned, any group absent from `docs/taggroups.yaml` and holding no
surviving tag is deleted too. The `TagGroup.requiredTagId` blocker above
also has the mirror exception: a gate held by a group that's itself absent
from `docs/taggroups.yaml` no longer counts as a blocker on the tag it
gates, since that group is on its way out in the same run. Tag-to-tag
references work the same way: a `parentTag`, `requiredTag`, `conflictsWith`,
cure/craft skill or `consumesInto` reference made by a tag that is itself
being pruned does not pin its target, so a spell and its expiry marker can go
together. The prune loops to a fixpoint, so a tag that a character still
holds keeps everything it references.

## 4. Ops scripts

Everything that runs from a terminal lives under `db/scripts/`: `sync/` for
the YAML masters (§1) and `ops/` for the tools below. There are no repair
backfills left; `db:mirror` plus the channel doctor fix drift by diffing
rather than by a script per symptom, and a pre-launch wipe rebuilds
everything else from YAML.

| Command | What it does |
|---|---|
| `db:sync` | The five routine masters in order (tags, roles, desires, documents, labor drops), then a structure Discord mirror pass. Zones are not part of this run — see `db:import-zones` in §1. |
| `db:import-zones` | One-shot, additive: creates whatever `docs/zones.yaml` names that the database doesn't have yet, skips the rest, never deletes. **Dry run by default**; `-- --apply` writes. See §1. |
| `db:mirror` | Diffs the live Discord guild against the database and provisions, renames or reparents to match — the repair path for zones/locations/rooms/narrowcast/Deadchat now. **Dry run by default**; `-- --apply` writes, `-- --full` adds the member sweeps. `db/lib/discordMirror/`. |
| `db:doctor` | The channel doctor from a terminal. **Dry run by default**; `-- --apply` repairs, `-- --full` adds the expensive scope (overwrites, threads, invites, narrowcast) on top of the cheap role-membership checks. See `CHANNELS.md` §6. |
| `db:dedupe-room-stash` | Dry-run by default (`-- --apply`): removes room-stash items a re-sync re-created over a stack players had emptied, and the copies of those since picked up. Deletes the **floor** copy first — whoever looted the room keeps what they carried off — and reaches into a bag only where the injected unit was itself picked up, taking it from whoever took it, by the audit trail. Proof is a `RoomTag.createdAt` inside a known sync window, or a stack drawn to zero *before* that window with more drawn out after (the row that would prove it is destroyed when somebody empties it). Writes a `stash_dedupe` audit row per deletion and DMs each player "A duplicate item was removed."; idempotent — a second run reads those audit rows and takes nothing twice. Written for the 2026-09-10 incident above and kept because the evidence trail is worth having if it ever recurs. |
| `db:prune-tags` | Dry-run by default (`-- --apply`): the destructive counterpart to `db:sync-tags` — deletes any Tag row absent from `docs/tags.yaml`, skipping GM-created and referenced tags, then any TagGroup absent from `docs/taggroups.yaml` once no surviving tag sits in it. |
| `db:prune-orphan-roles` | Dry-run by default (`-- --apply`): deletes Discord character roles no living character claims. Only touches roles carrying the character-role signature (mentionable + `hashNameToColor` colour), so zone, divider and GM cosmetic roles are never candidates. Add `-- --include-catatonic` to also accept the Catatonic repaint (`CATATONIC_ROLE_COLOR` + the ` • Catatonic` suffix), which otherwise can never match — harmless while a character claims the role, but it strands one left by a finished game. "Permissionless" here means **`0` or exactly @everyone's bitfield**: Discord's create-role endpoint copies @everyone's permissions when the field is omitted, which `ensureCharacterRole` used to do, so a stricter test made this script a silent no-op. Guards the 250-role guild cap. |
| `db:prune-stale-channels` | Dry-run by default (`-- --apply`): deletes categories, channels and `Zone:`/`Location:` roles left behind by a **previous game** — objects no DB row points at any more, which nothing else reaches: `db:mirror` only ever adopts or creates, never deletes, and the doctor never deletes a channel either. So a retired layout lingers beside the live one under a category of the same name. Conservative by construction, with no hardcoded ids — a category is a candidate only when its name matches a live `Zone.name` *and* nothing in the DB references it, channels are only ever deleted as that category's children, and the run aborts outright if any candidate turns out to be referenced. |
| `db:report-inactive-characters` | Read-only: ALIVE characters with no activity since turn 1, and anyone who has left the guild. |
| `db:inspect-character` | Read-only, takes a name fragment: one character's `webOnly` (with the cooldown clock, and a warning when a flip left Room threads behind), `Character.concealed` against the gear actually equipped, any forced name, what `presentedIdentity` resolves to right now, and whether the equipped set would still pass the slot rules. Neither switch has a trace anywhere else a GM can read, and concealment is derived rather than stored, so "it says true and does nothing" is the normal state to have to explain. See `PROXYING.md` §5. |
| `db:sync-narrowcast-channels` | Provisions **and reconciles** the `radio` category and its `#cerberon` channel from the special-channels registry — the same structure `db:mirror` now also provisions, kept as a scoped standalone. |
| `db:rebuild-info-channel` | Destructive rebuild of `#info` from `infochannel.yaml` (`INFOCHANNEL.md`). |
| `db:set-bot-avatar` | Pushes `docs/assets/bot-icon.png` to the bot user's avatar. |
| `db:open-rp-channels` | Between games: opens every roleplay channel to the whole guild. Dry-run by default; writes an undo snapshot first. The next `db:mirror` re-walls them. |
| `db:backup` | Takes a Railway volume backup now (`scripts/db/railway-backup.sh`). `migrate.sh` runs it before every migration. |

## 5. Where the code lives

`db/lib/syncTags.js`, `syncRoles.js`, `syncDesires.js`, `syncDocuments.js`,
`syncSpecialChannels.js`, each with a thin `db/scripts/sync/*.js` terminal
wrapper (`db/scripts/sync/all.js` runs them in order). `db/lib/importZones.js`
is the zones importer, reusing `db/lib/syncZones/parse.js#parseZonesYaml`;
`db/lib/discordMirror/` is the reconciler now (`db/lib/channelDoctor.js` is a
thin alias over it); `db/lib/zoneChannelSpec.js` is the one description of a
zone's Discord layout; `db/lib/fullWipe.js` is the Restart Game nuke.
