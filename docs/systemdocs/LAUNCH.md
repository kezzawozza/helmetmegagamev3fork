# Opening a game: the launch runbook

What to do, in what order, to take the app from "deployed" to "players can
make characters". Written for a Restart Game wipe, which is how a playtest or
a new season starts.

Every step here exists because skipping it breaks something quietly. Nothing
in this list throws a visible error — you find out when a player says the
button isn't there.

Companion to [`SYNC.md`](SYNC.md) §3 (what the wipe re-syncs),
[`DEV-PANEL.md`](DEV-PANEL.md) (the panel itself) and
[`GAMEMASTERS.md`](GAMEMASTERS.md) (zone seats).

## 1. The three that bite

Read these before touching anything, because two of them are invisible until
someone complains and the third is irreversible in the wrong order.

**The wipe closes the doors behind you.** `wipeGameData` deletes and
recreates `GameState` (`web/app/(app)/gm/dev/actions.js`), and a fresh row is
**CLOSED** (`LOBBY.md` §1): nobody can ready up or make a character until a
superadmin presses **Open lobby** on the Game section. That is the point —
the syncs below run before anyone can touch the world.

`GameConfig` is **not** touched by the wipe any more. Every knob on the
Configuration section — player count, starting points, the caps, the feature
switches — carries over from the last game, so there is nothing to screenshot
and nothing to re-enter. The per-game state that used to share the row
(Lifeweb blood, the bomb, the bell, the archive gate, next-turn overrides)
lives on `GameState` and starts fresh.

**The `#turns` repost is best-effort.** `finishGameWipe` reposts the `#turns` console for the
fresh Turn 1 itself, so the channel is no longer left empty on Day 1 — but that
step is retried once and then recorded as a failure, not retried forever. If it
fails, the stale message pointer is the safety net: the bot reposts on its next
`ready`. Check the channel; restart the bot if it's bare.

**A zone seat costs a GM the threat briefs.** The polarity is inverted from
intuition: a *master GM* is one with **no** zone assignment, and secret
documents are visible only to master GMs (`web/app/(app)/documents/page.js`,
[`DOCUMENTS.md`](DOCUMENTS.md)). Seating a GM in a zone **removes** their
access to every threat brief. There is no way to be seated and see secrets. A
seat decides which zone their tables open on and hides nothing else, so leave
a GM unseated unless you specifically want the default.

## 2. What the wipe actually runs

`wipeGameData` does the database half synchronously — every player- and
turn-scoped row deleted in one transaction (in FK-dependency order), the old
`Game` given its epilogue and the next one opened, `GameState` recreated at
CLOSED, and a fresh Turn 1/DAWN opened. The transcript is **kept** under the
old game's id (`ARCHIVE.md`). It writes a
`SystemReport` row (`kind: WIPE`) **before** the Discord half starts, then hands
that half to `after()` and returns.

`finishGameWipe` is a **step runner**: each step is retried once, every failure
is collected, and the run lands on that report row. The panel no longer claims
a success it can't know about — and if the container dies partway, the report
is left unfinished (`finishedAt` null), which is itself the signal.

**Discord structure is no longer destroyed here.** Categories, channels and
roles stay; only messages go, and the Discord mirror is what repairs
anything the wipe emptied or the retries above still missed — see "DB is
master, Discord is a mirror" for why the old destructive zones sync is gone from this list
entirely.

The order, and why:

| # | Step | Why here |
|---|---|---|
| 1 | **Access sweep** (`revokeAccessForCharacters`) | First, while nothing has re-provisioned: strips every character's zone role and every stray member overwrite, channel-major |
| 2 | **Per character**: delete the personal role, drop turn-ping | Discord role state the DB transaction never touched. Sequential — 240+ simultaneous requests against two per-guild buckets is its own incident. Each character is its own step, so a failure names them |
| 3 | **Deadchat**: close every open seat, then a fresh provision (`ensureDeadchatChannel({ fresh: true })`) | Closing each seat by id is the belt; the fresh provision strips every member overwrite on the channel outright, which is the brace for a departed member or a failed call the loop missed. The mirror has no equivalent — it never touches a channel's raw per-member overwrites — so this stays its own step |
| 4 | **Message wipe** (`wipeGameMessages`) | Clears `#turns`, every `#archive`-named channel, every zone's `#summary` and every Location channel. A zone Room's thread is **kept** — its messages clear, and its starter id/hash are nulled so the mirror reposts into it. A quest Room's thread, and any thread that matches no Room at all (a Conversation), is deleted outright — neither needs to survive, and the mirror already knows how to rebuild a quest Room's thread from scratch. Anchors are nulled unconditionally, since every channel they sit in just emptied |
| 5 | **`#turns` console repost** | After the wipe, never before: step 4 bulk-deletes every message in `#turns`, including this one if it were posted first. Turn 1 is opened by a plain `turn.create`, so `runSideEffects()` never fires and the announcement that normally rides it never went out |
| 6 | **Tag sync** → 7. **Role sync** → 8. **Desire sync** → 9. **Document sync** → 10. **Mining drop sync** | Dependency order: roles resolve a `starting_zone` and validate `starting_tags`; desires validate `requires.anyRoles`/`notRoles` against roles and `requires.anyTags`/`notTags` against tags (`SYNC.md` §1, `DESIRES.md` §10); documents validate against tags and roles; mining drops run last, against the tag and location catalogs the steps above just rebuilt |
| 11 | **Discord mirror** (`runDiscordMirror`, full scope, apply) | The structural backstop: reconciles every category, channel, role, radio net, Deadchat channel, Location anchor and Room thread against the database, and reposts anything step 4 just cleared. Replaces the old zone sync, special-channels sync and channel doctor steps — one repair path instead of three |

## 3. The runbook

**Before the wipe**

1. Screenshot `/gm/dev` → Game Config (§1).
2. `./migrate.sh`, or `npm run db:migrate:deploy`. A wipe against an
   unmigrated database throws mid-transaction and wipes nothing. See
   "Deploy workflow" in `CLAUDE.md` for why this is not automatic.
3. Confirm each GM holds the Discord GM role and has signed into the web app
   with that same Discord account.

**The wipe**

4. `/gm/dev` → Restart Game → type `WIPE`, all caps. Superadmin only.
5. **Watch the System Reports section on `/gm/dev`**, not the server logs. The
   action returns in about a second; the Discord half runs in `after()` for
   minutes and reports itself. Refresh until the `WIPE` report shows a finish
   time. `clean` means every step landed; `issues` lists exactly which steps
   failed and why; `unfinished` after several minutes means the container died
   mid-pass — re-run the failed piece by hand, or press **Repair** to let the
   doctor sort out what it can.

**After the wipe**

6. `npm run db:sync-narrowcast-channels`, then delete the old `#radio` channel
   by hand if it is still there. The wipe *does* run the discord mirror (step
   11 above), which provisions both radio nets, so this is only needed when
   the ids are NULL — a fresh database, or right after the
   `watch_radio_channels` migration. It is safe to re-run either way: channel
   identity is one-time and everything else reconciles.
7. `npm run db:rebuild-info-channel`. `#info` is never rebuilt automatically
   and still carries the previous game's roles intro.
8. `npm run db:prune-orphan-roles` — dry run. Add `-- --apply` only if it
   lists leaks. The guild cap is 250 roles; past it, `ensureCharacterRole`
   silently stops creating them and new characters are unmentionable. (The
   doctor's cheap scope now reports orphan character roles too, and repairs
   them on apply — this script is the terminal path to the same check.)
9. **Do not run `db:prune-tags` here.** A wipe clears every `CharacterTag`
   first, so a prune would find every GM-created tag unheld and delete the
   lot ([`SYNC.md`](SYNC.md) §3b).
10. Check `#turns` shows the Turn 1 announcement and its button row. The
    wipe reposts it, but the step is best-effort — restart the bot if the
    channel is empty (§1).
11. Check the Configuration section still says what you want. It survives
    the wipe, so this is a glance, not a re-entry.
12. **Open the lobby last** (`/gm/dev?s=game`). A player also needs the
    player role — the two together are "the doors are open" and "you are on
    the list". Players ready up from here; when the roster is in, Close
    lobby, Preview, Start (`LOBBY.md` §3).

## 4. What the wipe does not clear

Worth knowing, because none of it is obvious from the confirm dialog.

| Survives | Consequence |
|---|---|
| `#cerberon`, `#27.065`, `#info` messages | `wipeGameMessages` touches `#turns`, `#archive`-named channels and zone channels only. Last game's radio traffic on BOTH nets stays readable — clear it by hand if that matters. |
| Every category, channel and role | `wipeGameMessages` deletes none of them, and the mirror step only creates or repairs — it never tears one down. A restart no longer means a fresh set of Discord ids for anything |
| A zone Room's Discord thread | Kept on purpose (§2 step 4). Its messages clear like any other channel, and its starter reposts once the mirror runs |
| The `radio` category and its channel ids | Deliberate: provisioning is one-time, so the pointers persist. |
| The `#turns` console pointer | Deliberate, and the safety net for step 5 above: a stale id makes the bot repost on its next `ready`. |
| `GameConfig` | Every knob on the Configuration section. Per-game state is on `GameState`, which is recreated. |
| `PlayerPreference` rows | Role priorities, opt-ins and the fallback a player set in the lobby, keyed by Discord user. Next game they only press Ready. |
| `Game` and `ArchiveEntry` rows | The transcript of every past game, readable on `/archive` under its id, with the reveal on top. |
| `GmZoneView` rows | GMs keep the zones they chose across a restart. Clearing the table is safe: no rows means every zone. |
| `SystemReport` rows | The operational history is kept on purpose; the panel shows the latest per kind. |
| `Zone`, `Location`, `Room`, `Tag`, `Role`, `Document` | Kept as rows throughout — nothing here re-syncs them from YAML any more. |

A quest Room's thread and any Conversation thread do not survive — see §2
step 4 for why neither needs to.

## 5. If you are not wiping

Run the masters yourself, in dependency order — roles resolve a
`starting_zone` and validate `starting_tags`, so the order is load-bearing:

```
npm run db:sync-tags                 # upsert-only, never deletes; before zones,
                                     #   so a Location's `structures:` resolves
npm run db:import-zones -- --apply   # additive-only: creates what's missing,
                                     #   skips the rest, never deletes
npm run db:sync-narrowcast-channels  # after zones: its grants name the zone roles
npm run db:sync-roles                # prunes unreferenced
npm run db:sync-documents            # destructive; last
npm run db:mirror -- --apply         # creates/renames Discord structure to match
npm run db:doctor                    # dry run; -- --full --apply to repair
```

The old two-pass zones workaround ("the first run couldn't seed a Location's
`structures:` because the tags didn't exist yet, so run it again") is gone —
tags now run before the import, once, and the import never runs a second time
by design.

Then steps 7–8 above, which the wipe would not have covered either.

## 6. Who can do what

The Discord GM role and superadmin are independent. Superadmin is a hardcoded
list of Discord user IDs in `web/lib/superadmin.js` — adding one is a code
edit and a redeploy, not something you can do from a browser on the day.

A GM-role holder can run the whole game: Moves, Requests, kills, revives,
tags, DMs, the per-character dev panel, and the bot's `/gm` `/dm` `/heal`
(from a guild channel — none of them work in the bot's DMs).

A GM-role holder also runs the Dev Panel's Operations and Threats sections —
bulk actions, letters, ambient lines, the inactivity nudge, threat seats and
objectives (`DEV-PANEL.md` §11a).

A GM-role holder **cannot**: end a turn early, wipe or restart, edit Game
Config, set next turn's note, run the channel doctor's
Repair, or delete a character or a custom tag. All of those are superadmin.

The practical one is **ending a turn**. `forceAdvanceTurn` checks only
`isSuperadmin` and never consults the GM role, so if the superadmin is away,
turns roll on the bot's cron alone — 04:00 and 16:00 America/Chicago. Plan
around that or add a second superadmin before the game opens.

## 7. Pre-flight check

- [ ] `#turns` exists, is named exactly `turns`, and shows the console message
      with its button row. Both the announcement and the console find it by
      exact name; a rename loses all three player entry points.
- [ ] Every zone has its category and `#summary`, every Location has its own
      channel, and each Location channel shows its pinned anchor with a
      working **Who's here? / Secret rooms? / Converse** button row
- [ ] Every Location's Rooms exist as threads, public ones visible and
      private ones invisible to a keyless test account
- [ ] `/character` renders the creation wizard, not `CreationClosed`, for a
      test account holding the player role
- [ ] The role tree on step 2 is populated — empty means the role sync failed
- [ ] The point-buy menu on step 3 has tags
- [ ] `/documents` is populated
- [ ] `#cerberon` and `#27.065` both exist under a `radio` category, and the
      old `#radio` and `#intercom` are gone
- [ ] The Council Room's starter post carries an **Intercom** button, and
      pressing it reaches every `#summary` but the Black Hills'
- [ ] `npm run db:doctor -- --full` comes back with nothing (or nothing you
      didn't expect)
- [ ] Make one throwaway character end to end, then check it can see exactly
      one Location, travel once, and open a Conversation
- [ ] End one turn and confirm the announcement posts
