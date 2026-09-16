# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## The double-dagger convention is retired

Every piece of prose Claude wrote used to end in a double dagger (U+2021), so
a rewrite pass could find the lines nobody had signed off on. **That is over.**
On 2026-09-10 the marks were swept out of the whole repository — 147 of them
across 28 files — and the rule was dropped with them.

**Do not add one, and do not put the rule back.** No game text carries a mark
now, so a single new one would read as a stray glyph to whoever met it.
`db/lib/tagShapes.js` no longer refuses one in a cooked taste, and the two Xom
tests that asserted every notice carried one are gone.

Write prose that is ready to read, and say in chat which lines you drafted if
Bascinet needs to know.

## How to write and talk

Everything below is about voice.

Apply ASD-STE100 principles to all responses.

* Keep each response concise, complete, and easy to understand.
* Remove information that does not help the user.
* Let the completed work show the result.
* Format according to the user's needs.
* Include all necessary context in your response.

Or... really, what I mean, is just write like a freaking human! Explain things
simply, just kind of... relax. Don't write these super jargon-y things.

## Delegation and orchestration

For significant multi-step work, the main Claude agent acts as the orchestrator.

The main agent remains responsible for:
- understanding Bascinet's actual goal
- architecture and consequential cross-cutting decisions
- decomposing work
- choosing appropriate workers
- resolving conflicts between workers
- integration
- final verification and acceptance

For important independent comparisons, obtain worker analyses independently before sharing one worker's conclusions with another when practical, to reduce anchoring.

### Claude subagents

Prefer Haiku subagents, often many in parallel, for strictly bounded batch
tasks that are fully specified by the dispatching agent and need no judgment:
- Absorbing verbose tool output (builds, dumps, large search results) and returning only the distilled result
- Enumeration feeding a higher-level agent's judgment (e.g. per-table writer/reader maps, per-file import lists), keeping the expensive context for synthesis
- Delegate for context savings when the delegated material is genuinely verbose. Opus/Fable leads should usually read ordinary relevant code directly. Lower-tier leads benefit more from scout delegation.
- Pattern-matching sweeps where the parent specifies exact patterns, scope, and success criteria
- Independent replication of single-sourced negative claims during reviews.  The dispatcher supplies the independently worded patterns/methods (never the original agent's), devising them is judgment work that stays with the dispatcher.
- Scout returns are unverified input, not deliverable content. Never ship scout-derived claims without lead spot-checking.
- For a disciplined lead, a self-run grep sweep often beats a scout fan-out on both cost and context. Fan out for wall-clock speed or genuinely verbose per-item output, not by default.

Haiku task contract: return verifiable evidence (file:line, matched text, counts), never bare conclusions. Treat a Haiku "found nothing" as a data point, not a verdict — interpretation stays with the dispatching agent. On ambiguity, Haiku reports back rather than deciding. Never use Haiku for cross-cutting tracing, refutation/verification judgment, or anything where choosing what to look for is part of the task — that's Sonnet or above. If a Haiku worker fails or returns ambiguity, respecify or escalate to Sonnet rather than retrying with more Haiku.

Prefer Sonnet subagents for tasks that do not require higher-level reasoning or advanced coding skills, including routine bounded work such as:
- project-context gathering
- repository investigation
- verification — both the kind where the exact commands are already known and the kind where working out what to run is part of the job
- code review, including first-pass branch reviews
- research into existing implementation
- bounded, fully specified implementation
- straightforward isolated tasks

Prefer Opus subagents for more complex planning tasks, comprehensive code reviews, or situations where Sonnet has failed to arrive at a solution. This includes putting a reviewer or an implementer on Opus rather than Sonnet where warranted: for reviews, generally when the change spans multiple subsystems, touches concurrency, persistence, or security-sensitive paths, or is the final pre-merge review of substantial work.

Fable subagents: only for peer-review of Fable-authored designs at gate time, as one competitor on expensive-to-reverse design problems, or as the escalation terminus when an Opus subagent has failed. Never for routine delegation.

No subagent may run on a Fable-class model without explicit approval in the current session. When one seems warranted, say why and ask; if proceeding without a response, substitute Opus and flag the substitution.

Dispatch posture by tier (deliberate gradient):
- Haiku: unrestricted - see above.
- Sonnet: the routine default for bounded work needing judgment.
- Opus: deliberate, for complex planning/review.
- Fable: approval-gated per the rules above.

There is no custom agent roster in this repo — `.claude/agents/` is empty on
purpose, and the tiers above are about which **model** to dispatch on, not which
named agent to pick. Use `Explore` for broad read-only sweeps, `Plan` for design
work, and `general-purpose` for everything else, including anything that writes.
Always pass an explicit model, so a worker never silently inherits a Fable-class
session model.

For a side task that genuinely requires the full current conversation context, use a fork subagent (subagent_type: fork) rather than restating that context in a dispatch prompt. Do not fork routine exploration or bounded work — fresh context is the point of a normal subagent, and forks inherit the session model (Fable-gate approval applies).

Give each subagent a clear objective, scope, modification authority, and expected output.

Grant write authority explicitly in the dispatch prompt, and only to a
`general-purpose` worker — `Explore` and `Plan` cannot edit files at all. Never
run concurrent writers against the same working tree: parallel implementation
shards require per-worker isolation (pass `isolation: worktree` at dispatch);
otherwise serialize writers. That matters more here than in most repos, because
several sessions share this one checkout — see the local verification note under
**Commands** for how quickly it moves underneath you.

### When Bascinet says "verify"

"Verify" is a specific request, not a vague one. Dispatch **two Opus subagents
in parallel**, both read-only, both pointed at the work just finished. Keep each
one small and quick — a bounded look, not a full audit. Then read both returns,
resolve any conflict yourself, and report.

**Subagent A — REVIEW.** Three questions:

1. What would a player find weird, annoying, or confusing about this?
2. Does this break any other system we might not have noticed?
3. Does it hold up at the edges — 100+ players, a dead or Catatonic character, an
   empty zone, a turn already open, a GM mid-adjudication?

**Subagent B — SIMPLIFY.** One question: is anything here unnecessary? This
codebase grows by accretion, so look for the duplicated helper, the flag nobody
reads, the state that could be derived, the abstraction with one caller. Say what
could be deleted outright.

Both return findings with `file:line` evidence, not impressions. Neither writes.

## What this file is

This file is the map, plus the rules that apply everywhere. Each game system
has its own doc under `docs/systemdocs/` — see the table below. This file
does not repeat what those docs say.

## What Bascinet is

Bascinet is a big, month-long asynchronous megagame. The setting is a cryptic
mix of low fantasy and sci-fi.

It's half strategy, half roleplay. It's built to run smoothly with 100+
players, where each in-game day is one real-world day. A website and a Discord
bot automate the communication and the mechanics, so the game stays
asynchronous and low-friction.

The game has two faces: the Discord and the web app. For the web app, the
priorities are functionality, usability, cleanliness, responsiveness, and
browser performance. The thing to avoid is the typical slow, laggy Discord bot
dashboard. This one needs to feel fast and scroll smoothly.

### Bascinet is the project; the Lifeweb is a thing inside it

The Lifeweb is the Tower that keeps Ravenheart alive, fed by its people's
blood (`docs/lore.md`). The game used to be *called* Lifeweb before it was
retitled. So the name still shows up all over the codebase, and it looks like
an unfinished rename. It isn't. **A `grep -i lifeweb` hit is not a bug.**
Leave all of these alone:

- The in-fiction Tower: the `/lifeweb` route, `Lifeweb*.js` components,
  `LifewebIcon`, `db/lib/lifeweb.js`, `LIFEWEB_SPUTTER_THRESHOLD`, and the
  `lifewebBlood` / `lifewebDecayPerTurn` / `ArchiveKind.LIFEWEB` schema fields.
- The npm scope, frozen on purpose: `@lifeweb/db` and `@lifeweb/bot`, plus the
  Railway service name `@lifeweb/bot` in the root `redeploy` script.
- The local checkout directory, unchanged on purpose: `lifeweb`. (The
  GitHub repo itself was renamed to `peace-lock/helmetmegagame`. It is
  public again at the moment; it was private for a while after players
  found it.)
- The three Prisma migration directories with `lifeweb` in their names. Those
  names are checksummed rows in `_prisma_migrations`, so renaming them breaks
  Prisma.

## Read the system doc first

**Before you work on any system in this table, open its doc.** Each doc is
the source of truth for its system. The summaries below only exist to help
you pick the right doc — they are never enough to change code with.

| Doc | Read this when… |
|---|---|
| [`ARCHITECTURE.md`](docs/systemdocs/ARCHITECTURE.md) | You're deciding where a new module goes, or touching anything that talks to Discord from both faces |
| [`COMMANDS.md`](docs/systemdocs/COMMANDS.md) | You're adding or changing a slash command, button, modal or reaction |
| [`TURN-ENGINE.md`](docs/systemdocs/TURN-ENGINE.md) | You're touching how a turn advances — hunger, auto-labor, turn banners, the side-effect thunk |
| [`LAUNCH.md`](docs/systemdocs/LAUNCH.md) | You're opening a game or running a Restart Game wipe — the order that keeps players from being locked out |
| [`BACKUPS.md`](docs/systemdocs/BACKUPS.md) | You're touching backups or restoring one — point-in-time recovery, the nightly dump service in `ops/backup/`, or **anything that has just gone badly wrong with the database** |
| [`LOCAL-DEV.md`](docs/systemdocs/LOCAL-DEV.md) | You're setting up a local Postgres, testing a GM-gated page with no real Discord credentials, or about to run anything against the live database |
| [`SYNC.md`](docs/systemdocs/SYNC.md) | You're editing a YAML master or a sync script, or wondering what a sync deletes |
| [`MIRROR.md`](docs/systemdocs/MIRROR.md) | You're touching `db/lib/discordMirror/`, the `MirrorJob` queue, "Reconcile now", or anything that creates or renames a Discord object from a DB row |
| [`CHANNELS.md`](docs/systemdocs/CHANNELS.md) | You're changing Discord channel layout, visibility, or the Dawn wipe |
| [`CHARACTERS.md`](docs/systemdocs/CHARACTERS.md) | You're touching creation, roles, names, the point economy, death, or launch gating |
| [`TAGS.md`](docs/systemdocs/TAGS.md) | You're touching the tag catalog, **pricing or rebalancing a tag** (§4a is the canonical point scale), **pricing an injury or adding a health tag** (§5c is the canonical cure ladder), its gates, stacks, consuming, or equipment |
| [`COMBAT.md`](docs/systemdocs/COMBAT.md) | You're touching the fighting band — the eight words from Pitiful to Legendary, a tag's `fighting:` block, weapon classes, or **anything that asks how good somebody is in a fight** (`db/lib/fightingSkill.js`) |
| [`SMITHING.md`](docs/systemdocs/SMITHING.md) | You're pricing a weapon or armor, changing the crafting ladder, or touching the Smithing / Crafting / Fighting skill families |
| [`MEDICAL.md`](docs/systemdocs/MEDICAL.md) | You're touching curing an ailment by item instead of by medic (`cures`/`curesInto`/`administerSkill`), the medical Move economy, poisoning and resistance, or the prosthetics |
| [`BREWING.md`](docs/systemdocs/BREWING.md) | You're pricing a brew, changing a recipe, or touching the Brewing skill family |
| [`DEPOT.md`](docs/systemdocs/DEPOT.md) | You're pricing an imported ware, touching `/depot` or the Merchant's credit line, or setting a tag's `depotPrice` / `sellablePrice` |
| [`ECONOMY.md`](docs/systemdocs/ECONOMY.md) | You're touching the ⬢ ledger (`db/lib/economyLedger.js`), a money hook, `/gm/economy`, or **anything that asks where the money went** — the reconciliation invariant, the reason vocabulary, or the backfill |
| [`DESIRES.md`](docs/systemdocs/DESIRES.md) | You're touching the Desire catalog, its gates/cooldowns/locks, `conflictsWith`, or the Desires GM surface on `/gm/dev` |
| [`REQUESTS.md`](docs/systemdocs/REQUESTS.md) | You're adding or changing anything a player does to their own sheet — and **always** before adding one a per-turn ration counts |
| [`BIRD.md`](docs/systemdocs/BIRD.md) | You're touching the Bird's letters, the once-a-day send, or the Reply window |
| [`PAPERWORK.md`](docs/systemdocs/PAPERWORK.md) | You're touching paper, writing, wax seals, noticeboards, or **anything that asks whether a character can read** (`db/lib/reading.js`) |
| [`ADJUDICATION.md`](docs/systemdocs/ADJUDICATION.md) | You're working on `/gm/turns` — the arbitration workspace, staging, or the turn-end push |
| [`PLAYER-DESK.md`](docs/systemdocs/PLAYER-DESK.md) | You're working on `/gm/players` — the merged roster + conversations desk, GM notes, or ⌘K |
| [`LOBBY.md`](docs/systemdocs/LOBBY.md) | You're touching the game phases (`GameState.phase`), readying up, role priorities, the assignment roll, the creation window, Start Game / End Game, the epilogue, or what Restart Game keeps |
| [`SHEET.md`](docs/systemdocs/SHEET.md) | You're touching `/character` — the sheet: the band, the verb strip, the tag rail and its rows, the equip board, or Escape back to `/play` |
| [`DEV-PANEL.md`](docs/systemdocs/DEV-PANEL.md) | You're touching `/gm/dev/characters/[characterId]`, the GM microactions, `/gm/dev/tags`, or the `/gm/dev/zones` place editor |
| [`MAP.md`](docs/systemdocs/MAP.md) | You're touching geography, travel cost, **walking several hops across a zone** (§3c), or the `/map` panel — geography is authored live at `/gm/dev/zones` now, not by re-syncing YAML |
| [`INTERCEPT.md`](docs/systemdocs/INTERCEPT.md) | You're touching the Intercept verb — laying in wait, Safe and Ambush, the hold on somebody's movement and its Release, or **anything that asks whether a character may move** (`heldReasonFor`) |
| [`ATTACK.md`](docs/systemdocs/ATTACK.md) | You're touching the Attack verb — the band gate that refuses a hopeless fight, the hold it puts on **both** sides, Break off, or the **Other** lens on `/gm/turns` |
| [`QUESTS.md`](docs/systemdocs/QUESTS.md) | You're touching Quests — the `/gm/dev?s=quests` panel, a GM-staged room and its **Interact** button, the quest gates, the noticeboard manager or the zone broadcaster — or **anything that touches a Room's `questId`**, which marks a room a GM minted at runtime rather than one `docs/zones.yaml` named |
| [`CAVING.md`](docs/systemdocs/CAVING.md) | You're touching the Caving Die, the cave loot table, or the Caving lens on `/gm/turns` |
| [`PROXYING.md`](docs/systemdocs/PROXYING.md) | You're touching how a player's message becomes a character's — proxying, avatars, reactions, `/conceal`, mentions, nicknames, notes |
| [`FACTIONS.md`](docs/systemdocs/FACTIONS.md) | You're touching factions, or who can see a member's ⬢ (Leader/Treasurer) |
| [`GAMEMASTERS.md`](docs/systemdocs/GAMEMASTERS.md) | You're touching the zone colour code, **which zones a GM can see** (`GmZoneView`, the `GM: <Zone>` roles, `/zone`), or who can see the audit log |
| [`LABORING.md`](docs/systemdocs/LABORING.md) | You're touching Laboring — the tag ladder, a Location's `yield:` coefficients and their drift, the tools (`laborBonus`), the auto-labor pass, or the Examine button |
| [`LABORDROPS.md`](docs/systemdocs/LABORDROPS.md) | You're touching the labor drop die — `docs/labordrops.yaml`, `db/lib/laborDrops.js`, or the `laborDrop` entry in `db/lib/moveEffects.js` |
| [`FACTORY.md`](docs/systemdocs/FACTORY.md) | You're touching the Godard Factory — Extract, refining Godflesh into Squeeze, the Package button and crate weights, the Spillway, or what eating a cube does |
| [`CARRY.md`](docs/systemdocs/CARRY.md) | You're touching carry caps, Overburdened, Pack Mule / Cart, room stashes, the Transfer dialog, or the Storage button |
| [`CORPSES.md`](docs/systemdocs/CORPSES.md) | You're touching what a body is — the corpse tag, butchering, Bury or Engrave, the rot clock, the death smell, or an **enforced recipe ingredient** (`requirement.items`) |
| [`MOOD.md`](docs/systemdocs/MOOD.md) | You're touching the mood dial — the nine bands and the Mood box on the sheet, what sinks or lifts a mood, the phobias, Brave / Rough Camper / Outsider / Spelunker, `moodIntensity`, or the nightly mood pass |
| [`TORTURE.md`](docs/systemdocs/TORTURE.md) | You're touching the Torture button, the torture die and its thresholds, what a broken character reveals, the `TORTURED` mood hit, the Torturing Equipment kit, or the **Mutilate** button and the body parts it takes |
| [`THANATI.md`](docs/systemdocs/THANATI.md) | You're touching the cult — the THANATI buttons, Recall Comrades, the hideout and Purchase Gear, Flesh / Dark Inspiration / Black Robes / the Grimoire, or the **rites** (no button: robed, Inspired, ingredients on the floor, say the word), the word roll, the chant hook in `say.js` or the minute sweep. Placeholder until a human doc replaces it |
| [`LESSONS.md`](docs/systemdocs/LESSONS.md) | You're touching Learn Skill / Teach Skill, the Teaching tags, the Offer handshake (Bind's consent too), the lesson turn pass, or Break Restraints |
| [`SEARCH.md`](docs/systemdocs/SEARCH.md) | You're touching the Search verb — the consent handshake and its third **Hide items** button, what a search may turn up (`hideableFromSearch`), the reveal die nobody is shown, the once-a-turn ration, or Intercept's **automatically search?** box |
| [`KISS.md`](docs/systemdocs/KISS.md) | You're touching the Kiss verb — the consent handshake, the `KISS` capability and what blocks it, the +15 both sides take, its two rations, or the rule that nobody else is told |
| [`CONFESSION.md`](docs/systemdocs/CONFESSION.md) | You're touching Confess, the `psychological` tag flag, who may hear a confession, or the rule that a chaplain is never shown the sin |
| [`CRAFTING.md`](docs/systemdocs/CRAFTING.md) | You're touching Craft, Destroy, the four tag capability flags (`craftable` / `removable` / `healable` / `teachable`), multi-turn projects, or who pays for a recipe |
| [`COOKING.md`](docs/systemdocs/COOKING.md) | You're touching the meals, an ingredient's `cooked:` block, `requirement.ingredientSlots`, the taste line, or **anything that asks what eating a dish does** (`web/lib/cooking.js`) |
| [`TRINKETS.md`](docs/systemdocs/TRINKETS.md) | You're touching the forge's Gambit recipe, a tag's `inlayValue`, the tier table or the skilled floor, or **anything that mints a Trinket** (`db/lib/trinketPass.js`) |
| [`ARCHIVE.md`](docs/systemdocs/ARCHIVE.md) | You're touching the transcript, `/archive`, or **anything that exports, imports or deletes a game's transcript** — the archive packets and the archive-or-discard wipe |
| [`CHAT.md`](docs/systemdocs/CHAT.md) | You're touching `/play`, the live feed (`/api/feed`, the SSE hub, the bot's outbox), `ArchiveEntry.seq` / `placeKey`, or the per-character Play on Discord switch |
| [`DOCUMENTS.md`](docs/systemdocs/DOCUMENTS.md) | You're touching `/documents`, `docs/documents.yaml`, `/handbook`, or `docs/handbook.md` |
| [`INFOCHANNEL.md`](docs/systemdocs/INFOCHANNEL.md) | You're changing `#info` or `docs/systemdocs/infochannel.yaml` |
| [`PORTRAITS.md`](docs/systemdocs/PORTRAITS.md) | You're touching the portrait maker, avatar art, or `Character.avatarData` |
| [`DESIGN-SYSTEM.md`](docs/systemdocs/DESIGN-SYSTEM.md) | You're writing or restyling **any** web UI |
| [`THREATS.md`](docs/systemdocs/THREATS.md) | You're touching the antagonist seats — the threat catalog, Assign, mid-round Spawn, or the two Threats sections on `/gm/dev` |
| [`ORACLE.md`](docs/systemdocs/ORACLE.md) | You're touching the per-turn chronicle — `/gm/oracle`, the zone writers and the editor, the prompts, or **anything that calls a language model** |
| [`CRT-TERMINAL.md`](docs/systemdocs/CRT-TERMINAL.md) | Someone suggests a terminal/CRT look — read before rebuilding it |

Other reference docs, outside `systemdocs/`:

- `docs/lore.md` — the setting.
- `docs/handbook.md` — the player handbook, read at runtime by the web app
  (`web/lib/handbook.js`) rather than repo-only reference. It renders on two
  live surfaces: the pinned "Player Handbook" card on `/documents` and the
  public, no-sign-in `/handbook` page. Editing it changes what players see on
  the next request, no sync or deploy of any other file required.

## Repository layout

This is an npm-workspaces monorepo with three packages:

- `bot/` — the Discord bot (discord.js v14). It holds a **gateway**
  connection. Entry point: `bot/src/index.js`.
- `web/` — the web app (Next.js 16, App Router, JavaScript, Tailwind v4).
  It talks to Discord over **REST only**. Standard Next.js structure, rooted
  at `web/app`.
- `db/` — the shared data layer (`@lifeweb/db`). The Prisma schema is at
  `db/prisma/schema.prisma` and targets PostgreSQL. `db/index.js` exports a
  singleton `PrismaClient` (`const { prisma } = require("@lifeweb/db")`), so
  the bot and the web app read and write the same game state.

If both faces need something, put it in `db/lib/` — don't write it twice.
Add the dependency with `npm install @lifeweb/db --workspace=<bot|web>`.

Deployment is on Railway, built straight from this GitHub repo
(`peace-lock/helmetmegagame`). `bot` and `web` run as two separate Railway services
from the same repo, and both point at one Railway Postgres instance.

See `ARCHITECTURE.md` for the barrel rules, the REST/gateway twin convention,
the returned-side-effects pattern, rate-limit discipline, and why log tables
store snapshot columns instead of foreign keys.

## Commands

Run from the repo root unless noted.

```
npm install                          # installs all workspaces (bot, web, db)

npm run dev:web                      # next dev, in web/
npm run dev:bot                      # node --watch src/index.js, in bot/

npm run db:generate                  # prisma generate. Runs on `npm install`
                                     #   via a root postinstall, but if you
                                     #   only pulled a schema change (no new
                                     #   dependency), run it explicitly — a
                                     #   stale generated client throws
                                     #   `PrismaClientValidationError: Unknown
                                     #   argument` for fields that are right
                                     #   there in schema.prisma, which reads
                                     #   like a schema bug but isn't.
npm run db:migrate                   # prisma migrate dev. LOCAL POSTGRES ONLY.
                                     #   Against Railway it offers a full reset
                                     #   on drift, which is how game one died.
                                     #   .claude/hooks/db-guard.py refuses it
                                     #   when DATABASE_URL points at Railway.
npm run db:migrate:deploy            # prisma migrate deploy (production).
                                     #   ./migrate.sh wraps it with a Railway
                                     #   backup first.
npm run db:backup                    # one pg_dump into the backup bucket, now.
                                     #   ./migrate.sh runs it before migrating.
npm run archive:export               # one game's transcript -> a packet in the
                                     #   bucket. `-- --final` makes the
                                     #   permanent one and stamps the Game row,
                                     #   which Restart Game requires before it
                                     #   will keep a game. See ARCHIVE.md.
npm run archive:import -- --key K    # load a packet back. Prints every column
                                     #   it dropped or defaulted.
npm run archive:pull                 # every packet in the bucket -> ./archives
                                     #   (gitignored). Skips what it has,
                                     #   verifies each download, EXITS 1 on a
                                     #   bad file. `-- --recheck` re-verifies
                                     #   what is already there.
npm run archive:exports              # what packets exist. EXITS 1 if the
                                     #   current game's newest is over 36h old.
npm run db:backups                   # what is in the bucket. EXITS 1 if the
                                     #   newest dump is over 36h old, which is
                                     #   how a dead backup system announces
                                     #   itself. See BACKUPS.md.

# YAML masters -> DB. `db:sync` runs the five routine ones in the working
# order, then a Discord mirror pass; the individual scripts exist for one
# master at a time. See SYNC.md.
npm run db:sync                      # tags, roles, desires, documents, labor
                                     #   drops, then db:mirror -- --apply.
npm run db:import-zones              # docs/zones.yaml -> Zone/Location/Room/
                                     #   LocationLink/LocationYield/Structure.
                                     #   One-shot, additive: creates what's
                                     #   missing, skips what exists, never
                                     #   updates or deletes, never writes a
                                     #   discord*Id. DRY RUN unless given
                                     #   `-- --apply`. Not part of db:sync.
npm run db:sync-tags                 # docs/tags.yaml       (upsert-only)
npm run db:sync-roles                # docs/roles.yaml      (prunes unreferenced)
npm run db:sync-desires              # docs/desires.yaml    (upsert-only; soft-
                                     #   retires a template absent from the
                                     #   YAML — see DESIRES.md §10)
npm run db:sync-documents            # docs/documents.yaml  (destructive)
npm run db:sync-labor-drops          # docs/labordrops.yaml (destructive; last)
                                     #   — see LABORDROPS.md
npm run db:sync-narrowcast-channels  # #watch provisioning + reconcile —
                                     #   db:mirror also provisions this now,
                                     #   this is the scoped standalone.
npm run db:sync-deadchat             # #deadchat provisioning + reconcile
                                     #   (db/lib/deadchat.js). Safe to re-run;
                                     #   touches no per-member seat —
                                     #   db:mirror also provisions this now,
                                     #   this is the scoped standalone.
npm run db:sync-info-channel         # #info, edited in place. The default:
                                     #   an edit notifies nobody, a repost
                                     #   pings every thread follower.
                                     #   `-- --dry-run` to preview,
                                     #   `-- --prune` to delete threads the
                                     #   YAML no longer names.
npm run db:rebuild-info-channel      # destructive rebuild of #info. Only when
                                     #   the ORDER is wrong or the channel is
                                     #   a mess — it reposts everything.

# Ops. Scripts live in db/scripts/ops/. See SYNC.md §4.
npm run db:doctor                    # the channel doctor: diffs Discord roles/
                                     #   channels/threads against the DB. DRY
                                     #   RUN unless given `-- --apply`; add
                                     #   `-- --full` for overwrites + threads.
                                     #   Also runs cheap+apply on every bot
                                     #   start. See CHANNELS.md.
npm run db:mirror                    # the Discord mirror: treats the DB as the
                                     #   master and lists everything the guild
                                     #   does not match. DRY RUN unless given
                                     #   `-- --apply`, which creates, renames
                                     #   and reparents real Discord objects —
                                     #   ask first. `-- --full` adds the
                                     #   per-member sweeps, `-- --json` for a
                                     #   script. The channel doctor is one
                                     #   shape of this run now, and
                                     #   db:sync-narrowcast-channels /
                                     #   db:sync-deadchat are scoped wrappers
                                     #   over it. See CHANNELS.md 6a.
npm run db:prune-tags                # deletes tags absent from docs/tags.yaml.
                                     #   DRY RUN unless given `-- --apply`.
npm run db:collapse-equip-slots      # one-off: takes off whatever no longer
                                     #   fits after HEAD became a single slot
                                     #   and BODY collapsed to Mail/Over. DRY
                                     #   RUN unless given `-- --apply`. Not
                                     #   optional tidying — a pre-existing
                                     #   clash refuses every LATER equip, so
                                     #   this is what unbricks equipping. Run
                                     #   it after db:sync-tags. See TAGS.md.
npm run db:convert-lecturers         # one-off: moves everyone off the retired
                                     #   Teaching (Lecturing) tag onto plain
                                     #   Teaching. DRY RUN unless given
                                     #   `-- --apply`. Run db:prune-tags after
                                     #   it. See LESSONS.md 6.
npm run db:prune-orphan-roles        # deletes Discord character roles no living
                                     #   character claims. DRY RUN unless given
                                     #   `-- --apply`. Guards the 250-role cap.
                                     #   `-- --include-catatonic` also accepts
                                     #   the Catatonic repaint, which can never
                                     #   match the normal signature.
npm run db:prune-stale-channels      # deletes categories, channels and zone/
                                     #   location roles from a PREVIOUS game
                                     #   that no DB row references. Nothing
                                     #   else reaches these — db:mirror only
                                     #   ever creates or adopts. DRY RUN unless
                                     #   given `-- --apply`.
npm run db:check-config              # the GameConfig field registry vs. the
                                     #   schema (db/lib/gameConfigFields.js).
                                     #   push.sh runs it; exits 1 on drift.
npm run db:audit-labor-drops         # read-only: prices docs/labordrops.yaml
                                     #   off disk (no sync needed first) — each
                                     #   entry's Depot sell value and every
                                     #   pool's ⬢ expected value. LABORDROPS.md §6a.
npm run db:inspect-character -- "Ada"  # read-only: one character's two hiding
                                     #   switches and what they RESOLVE to —
                                     #   discordMirrored and its cooldown, the
                                     #   conceal wish against what is actually
                                     #   equipped, any forced name, and the
                                     #   equip set. The first thing to run on
                                     #   "my hood doesn't work".
npm test --workspace=db              # node --test over db/test/ (the
                                     #   assignment roll, so far).
npm run db:report-inactive-characters  # read-only inactivity report
npm run db:open-rp-channels          # between games: open every roleplay
                                     #   channel to the guild. DRY RUN unless
                                     #   given `-- --apply`.

npm run build --workspace=web        # production build of the web app
npm run lint --workspace=web         # eslint over the web app
npm run audit:contrast --workspace=web   # AA gate over globals.css themes
npm run assets:letters --workspace=web   # regenerate default letter-plaque avatars
```

### Verifying a change locally

The app signs in only through Discord, so `next dev` starts fine but every page
redirects — which used to mean UI work could be compiled but never actually
looked at. Two dev-only scripts close that, and **neither touches application
code**: sessions here are JWTs signed with the `AUTH_SECRET` already in
`web/.env.local`, so a valid cookie can just be minted.

```
npm run dev:session -- --gm               # print a session cookie for a superadmin
npm run dev:session -- --character "Ada"  # ...or for a named ALIVE character
npm run dev:check                         # load every route as the right persona
npm run dev:check -- --gm /gm/turns       # load named routes as a superadmin
npm run dev:check -- --anon /character    # no cookie, to confirm a gate still shuts
```

`npm run dev:web` must already be running. `dev:check` also asserts the negative
cases — that a player is still bounced off `/gm/*` — so loosening a gate by
accident fails the run.

Two things it knows that a plain `curl` does not. A `redirect()` called from a
page rather than a layout arrives as a **200** with `NEXT_REDIRECT` buried in the
streamed payload, and a server component that throws also answers **200**, with
the error encoded as a flight row. Status alone is not a verdict, so the body is
what's judged.

If a route reports `PrismaClientValidationError` on a field that plainly exists
in `schema.prisma`, the running dev server is holding a stale generated client:
run `npm run db:generate` **and restart `dev:web`** — regenerating alone does not
reach the process that already imported it. This happens most often right after
someone else's commit lands, since several sessions share this one checkout.

Environment variables (see `.env.example`): `DATABASE_URL`, `DISCORD_TOKEN`,
`DISCORD_GUILD_ID`, `DISCORD_GM_ROLE_ID`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `AUTH_SECRET`.

**None of the above needs to be real.** `npm run dev:setup` builds a whole
local stack — a local Postgres, migrated and seeded from the YAML masters —
and `LOCAL_MODE=true` (also written by that script) answers every Discord
call locally, so `isGm` and friends pass with no bot token, guild, or GM role
anywhere. See [`LOCAL-DEV.md`](docs/systemdocs/LOCAL-DEV.md) for the full
walkthrough — read it before reaching for the live database to check whether
something works.

The player and spectator role IDs are **not** env vars. They're hardcoded in
`db/lib/roleIds.js` — see "Discord permission model" below for why.

`db/` has `node --test` under `db/test/`; the web app and the bot have no test
setup.

## How the bot populates the database

On `ready`, the bot upserts a `GameConfig` singleton row and runs its
catch-up passes for anything it missed while it was gone. `guildMemberAdd`
writes a `member_joined` `AuditLog` entry.

**`ready` is `once: true`, so that burst is once per PROCESS, not once per
connect.** A gateway drop the process survives re-runs none of it — which is
fine for the passes that only reconcile drift (a stale nickname stays stale
until the next deploy), and was not fine for messages, because a message the
bot never saw is lost for good. So `bot/src/lib/messageCatchUp.js` is the one
pass that also hangs off `shardReady`: it re-proxies anything typed while the
bot was away, deletes the raw message that was sitting there under the
player's real Discord name, and files it in the archive. Anything older than
two hours is filed and deleted but not put back in the room.

Two **privileged intents** must be turned on for the bot in the Discord
Developer Portal (Bot → Privileged Gateway Intents). Without them, the bot
either fails to log in or silently sees nothing:

- **Server Members** (`GuildMembers`) — needed for nickname sync and member
  events.
- **Message Content** (`MESSAGE_CONTENT`) — needed for the whole proxy
  pipeline.

## Web app auth

Auth is Auth.js (`next-auth@5`, `web/lib/auth.js`) with the Discord provider.
`session.discordUserId` holds the Discord user ID, attached in the
`jwt`/`session` callbacks. `Character` rows are looked up by `discordUserId`.
There is no separate user table.

**Leave `AUTH_URL` unset. The app signs in on any host it is served from.**
Here's the problem it solves: behind Railway's proxy, Next.js builds
`request.url` from the container's own listener (`https://localhost:8080`)
and ignores the Host header. The real domain is in `x-forwarded-host` and
`host`. This only breaks one path. The `signIn()`/`signOut()` server actions
are fine, because `@auth/core`'s `createActionURL` already reads
`x-forwarded-host`. But the `/api/auth/*` route handler gets its origin from
the request URL — and that's where the OAuth `redirect_uri` is built. So
`web/lib/auth.js` wraps `handlers` and rebuilds the origin from the forwarded
headers before Auth.js sees the request.

The hosts in that file are an **allowlist**, not just accepted as-is. An
origin taken from a client-controllable header would be an open-redirect hole
in an OAuth flow. Any host it doesn't recognize falls back to the canonical
origin. **To add a domain, do two things:** add it to `ALLOWED_HOSTS`, and
register `<host>/api/auth/callback/discord` in the Discord Developer Portal.
Register the full callback path, not the site root — Discord matches it
exactly.

Setting `AUTH_URL` overrides all of this and pins every redirect to one host.
That is the emergency rollback (`railway variable set
AUTH_URL=https://ravenheart.quest --service web`) and nothing else. One
gotcha: `railway variable delete` does not reliably trigger a redeploy, so
you may need `railway redeploy -s web --from-source -y` to make the change
take effect.

GM-only pages (`web/app/gm`) check the signed-in user's guild roles through
`web/lib/discordGuild.js`. That calls the Discord REST API with the bot token
against `DISCORD_GUILD_ID`/`DISCORD_GM_ROLE_ID`. It does not trust anything
from the OAuth profile itself.

**A server action is a public endpoint.** Every one of them re-validates
everything the client sent, resolves the acting character from the session
(never from a posted id), and re-checks any gate the UI already applied. A
disabled input or a hidden button is a hint, not a lock.

## Discord permission model

There is no single unified permission system. A few independent kinds of
Discord role each control one thing, each synced from a different piece of
state, plus one env-configured admin role. `Faction` is **not** one of them
(`FACTIONS.md` §1).

| Role | Source | What it gates |
|---|---|---|
| **Zone role** | `Zone.discordRoleId`, one per presence zone ("Zone: Town"), created by `db:mirror` | Opens the zone's `#summary`, and — via `#turns`'s own role grants — the standing channels. Swapped by travel; reconciled by the channel doctor. |
| **Location overwrite** (not a role) | A per-member permission overwrite on the Location's channel, written by `db/lib/locationMove.js` | Channel access: holding it is what shows you the one Location channel a character actually stands in. Swapped by every location change; reconciled by the channel doctor's `location-occupancy` check. Locations wear **no** Discord role — 56 of them would have eaten 56 of the guild's 250, and Discord allows 1000 overwrites per channel. |
| **Personal character role** | `Character.discordRoleId`, one per `ALIVE` character, titled after the **bare** name | A mentionable **name token only** (`PROXYING.md` §6) — held by nobody and granting nothing. Channel access is the **zone role and the Location overwrite** instead (`CHANNELS.md` §3). |
| **GM role** | `DISCORD_GM_ROLE_ID` env var, **or** `TRIAL_GM_ROLE_ID` in `db/lib/roleIds.js` | `/gm` pages, the `/gm` and `/message` slash commands, and the GM's standing channel overwrites. Checked via REST (`isGm`), not stored on any model. The two are access-identical — `gmRoleIds()` is the only list, and the roster on `/gm/dev?s=gamemasters` is the one surface that tells them apart. |
| **Spectator role** | `SPECTATOR_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | A standing read-only observer seat, applied at provisioning time. See `CHANNELS.md`. |
| **Player role** | `PLAYER_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Who may ready up in the lobby or create a character, paired with `GameState.phase` (`LOBBY.md` §1, `CHARACTERS.md` §4b). |
| **Playtest role** | `PLAYTEST_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Counts as on the roster without the Player role, and is on the playtest-mode allowlist. It does **not** skip the lobby or the phase gate — only a GM gets the Skip button (`LOBBY.md` §2). Testing access, nothing else. |
| **Contributor role** | `CONTRIBUTOR_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | A separate seat from Playtest: the people who work on Bascinet. Read by exactly one gate — `GameConfig.playtestModeEnabled`, which narrows the roster to GMs, playtesters and Contributors (`LOBBY.md` §2). Grants nothing else. |
| **Leader Whitelist role** | `LEADER_WHITELIST_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Who may pick or prioritise a role flagged `whitelist: true`, and tick a whitelisted antagonist box. Always required — that used to be a `/gm/dev` switch (`CHARACTERS.md` §2, `THREATS.md` §1). |
| **~~Ghost role~~** | **Deleted 2026-09-15.** | It was an out-of-character leak: Discord prints a member's roles on their profile card, so "Ghost" told anyone who clicked that a player was dead, and pinning the colour to 0 only ever hid it from the member list. Do not add it back. A dead player is now answered by `db/lib/ghost.js` (who they are) and a per-member overwrite on the Deadchat channel (`db/lib/deadchat.js`) — an overwrite is visible only inside the channel it opens, and everyone who can open that one is already dead. The watching seat is **web-only** now; see **Death, ghosts and Deadchat** below. |
| **Turn-ping role** | `DISCORD_TURN_PING_ROLE_ID` env var | Plain opt-in notification, toggled from `/character`. |

There is one more role family, and it is per-zone rather than global. A
**`GM: <Zone>`** role (`Zone.gmRoleId`, provisioned by `db:mirror` beside
the access role) is what opens that zone's category, `#summary` and Location
channels to a GM — the global GM roles above no longer open any of them. Which
ones a GM holds comes from `GmZoneView`, the zones they picked from the
inspector's Zones control or with `/zone`, materialized as roles by
`db/lib/gmZoneRoles.js`. **No rows means every zone**, so nobody is ever
locked out by not having chosen. The same rows hide desk rows on `/gm/turns`
and `/gm/players`.

This replaced `GmAssignment`, which was a soft seat that picked a default
filter and hid nothing. Read
[`GAMEMASTERS.md`](docs/systemdocs/GAMEMASTERS.md) before changing it — three
separate sweeps have to know about the new roles or they delete them.

`/gm/dev` (the GM roster included, at `?s=gamemasters`) is **superadmin-only**, not GM-visible —
those are host access, not game permission. `/gm/audit` is **open to every
GM**: it used to be the master's alone, on the argument that with five GMs the
log is a record *of* them, but that left four people unable to answer "who
changed this", which is what the log is for.

`/lifeweb` is a **Mortus** surface, not a GM one. How much Blood is in the
Tower is the secret that role exists to keep, so a plain GM gets no rail item
and is bounced off the page — the same vague omen line in the turn
announcement is what they and the players both get. A superadmin reads it and
keeps the panel that moves the Blood, host access again rather than game
permission, and `web/app/(app)/lifeweb/actions.js` gates on the same thing the
page does.

**Why these role IDs live in code instead of env vars:** a role ID is not a
secret — anyone in the guild can read it. Bascinet runs in a single guild, so
there is exactly one correct value, and it can never differ per environment.
Meanwhile, a missing env var would have failed silently: a deploy where the
player gate locked everyone out, or the spectator overwrite did nothing. The
Trial Gamemaster role is there for the same reason, and a sharper version of
it: half-configured, it would be a GM who can open the web panel but cannot
see the channels, or the reverse. `web/lib/superadmin.js` uses the same
reasoning. `DISCORD_TOKEN` is a real
credential, so it stays in `.env`.

## Death, ghosts and Deadchat

**Two predicates, and they are not the same predicate.** They were one until
2026-09-15, which meant burying a body — the act that is supposed to *lift* a
penalty — also threw that player out of the game they were still watching.

| | `db/lib/curse.js` | `db/lib/ghost.js` |
|---|---|---|
| Asks | who pays the re-roll penalty | who gets the watching seat |
| Rule | most recent body still unburied, **and** no living character | a body, **and** no living character |
| Reads `buriedAt` | yes | **no** |
| Ends when | the body is buried or the name engraved, or they live again | they live again, and nothing else |
| Decides | Migrant/Bum only, six fewer points | `/chat` over every zone, and a voice in Deadchat |

Keep them apart. A `cursed` check standing in for a ghost check hands a buried
player's seat away; a `ghost` check standing in for a curse check hands out free
full-points re-rolls.

**The trap in `ghost.js` fails open, so it is worth knowing.** The rule has to
see the rows that are *not* dead. A caller who narrows the query —
`where: { discordUserId, status: "DEAD" }` — never loads the ALIVE row and gets
back "ghost" for somebody still playing, which seats a living player in the dead
room. Never filter by status; load the player's rows and let `isGhostIn` decide.

**A ghost watches on the web only.** There is no Ghost role any more (see the
table above). They read every zone summary, Location and public Room, plus the
nets flagged `ghostsMaySee` — that flag is web-only now, since there is no role
left to grant it with.

**Private Rooms and conversations stay out, and not because Discord said so.**
Adding a ghost to a private thread posts a visible system message *and* puts
them in its member list; either announces the death to the room. The only way
around it is `MANAGE_THREADS`, which is worse. The limit outlived the role that
used to explain it.

**Deadchat** (`db/lib/deadchat.js`) is the one room the dead talk in, and the
one exception to "a watcher speaks nowhere". Place key `dead:main`, provisioned
by `npm run db:sync-deadchat`, opened by **per-member overwrites** rather than a
role. A ghost speaks as `Solomon Baker (Pub Fries)` — their character's name and
their account handle, composed at send time and frozen into
`ArchiveEntry.characterName`, keeping the avatar the character had in game. It
is **not** a `SPECIAL_CHANNELS` entry, and `db/lib/deadchat.js`'s header says
why — three things in that registry are actively wrong for it, one of them a
spectator overwrite that would publish the death list.

It persists across turns on both faces: `runMessageWipe` never walks it, and
`db/lib/feedWipe.js#isPersistentPlace` is what stops the web disagreeing.

A GM reads Deadchat and does not speak in it, matching every other place on the
desk. Send is denied to the GM roles on the channel, not merely ungranted.

## Slash commands

The full reference is [`COMMANDS.md`](docs/systemdocs/COMMANDS.md) — read it
before adding or changing a command. Three things cause real problems:

- **Registration is global**, not per-guild
  (`client.application.commands.set` in `bot/src/events/ready.js`). A guild
  command can never appear in the bot's DMs, no matter what contexts it
  declares — and `/move` `/location` `/message` `/conceal` need to work there.
  The cost of global registration is real: a new or renamed command takes
  **up to an hour** to show up. `set` fully replaces the list, so removing a
  command needs no separate deregistration step.
- **Use contexts, not `setDMPermission`.** Any command that needs a channel
  or thread to act on (`/gm`, `/dm`, `/add`, `/remove`, `/heal`) declares
  `Guild` only. That way it never shows up in a DM picker
  where it could only refuse to run.
- **`interaction.guild` and `interaction.member` are null in a DM.** No
  player handler may use them directly. Go through
  `bot/src/lib/interactionGuild.js#resolveActingMember`, and use `isGmMember`
  from the same module for the GM gate.

**Acknowledge before you work.** Discord gives the bot three seconds to
acknowledge an interaction, and every handler that touches the database calls
`ack()` from `bot/src/lib/respond.js` as its first statement, then answers with
`respond()` instead of `interaction.reply` — which also clamps the reply to
2000 characters. Doing the work first means a slow turn-open shows the player
"The application did not respond" for something that already committed, and
retrying tells them they have already acted. The exception is a handler that
opens a modal: `showModal` **is** the acknowledgement, and a deferred
interaction can no longer open one.

Player-facing work happens in **modals**, not in messages typed into a
channel. The reason: typing in a channel shows a typing indicator under the
player's *real* account, and a modal never does. The three entry points are
buttons on one anchor message in `#turns` (`bot/src/lib/turnsConsole.js`),
and each button has a slash-command twin.

## Direct message logging

Every DM the bot or web app sends or receives is logged to `DirectMessage`
(`discordUserId`, `direction: INBOUND|OUTBOUND`, `content`). That's what lets
`/gm/messages` show a full per-player conversation with a reply box.

There are **three `sendDm` functions with three signatures**, one per calling
context. Never send a DM any other way, or it goes unlogged:

| Context | Function | Signature |
|---|---|---|
| Bot, gateway | `bot/src/lib/dm.js` | `sendDm(user, payload)` |
| Web, REST | `web/lib/discordGuild.js` | `sendDm(discordUserId, content)` |
| `db/`, REST | `db/lib/dm.js` | `sendDm(prisma, discordUserId, content)` |

The `db/` one takes `prisma` as a parameter, because requiring `db/index.js`
back from inside `db/lib/` would resolve to a partial exports object. It is
deliberately **not** exported from the `@lifeweb/db` barrel — three exports
with the same name would make it easy to grab the wrong one. Require it by
path.

**The three share one policy, and it lives in `db/lib/dmPolicy.js`.** The `»`
prefix, the `kind`/`source` defaults, the exact `DirectMessage` row and what a
bounced send is written down as are one decision, not three. Each transport
keeps its own body and calls `applyDmPrefix` / `dmLogRow` for the rest, so a new
column is added in one place. Like `dmKinds.js` it has **zero requires, ever** —
it is reachable from a client component, and one require of `@lifeweb/db` there
drags PrismaClient into the browser bundle.

A GM-sent DM also writes an `AuditLog` row at the call site. The desk's reply,
`/gm/dev`'s message box, a threat assignment and `/dm` all do;
`web/app/(desk)/gm/players/actions.js#sendGmDm` is the shared one. A DM that
reached a player with no record of who sent it is the gap `/gm/audit` exists to
close.

Inbound DMs are logged directly in `bot/src/events/messageCreate.js`.

### Every DM says what kind of thing it is

`DirectMessage.kind` — `CONVERSATION`, `NOTICE` or `QUIET`, from
`db/lib/dmKinds.js` — decides how much of the GM inbox a line is entitled to.
`source` is a separate column and only decides how the line is *drawn*. Keep
them orthogonal.

- **`CONVERSATION`** — a person composed these words for this reader. It sorts
  the GM inbox, wins the preview, and counts as unread.
- **`NOTICE`** — the game said it. Invisible to the rail; a quiet grey line
  once a GM opens the person.
- **`QUIET`** — plumbing (an inspect embed, a reaction refusal). Logged, never
  drawn.

**All three `sendDm` functions default to `NOTICE`, and so does the database
column.** Conversation is the thing you opt into:

```js
sendDm(discordUserId, text);                              // a notice
sendDm(discordUserId, text, { kind: DM_KIND.CONVERSATION }); // a person wrote it
```

So **a new DM needs no thought to behave** — which is the point. This used to
be a `source` string whose absence read as "a person wrote this", so every line
anybody added showed up in the GM inbox as mail until somebody remembered to
tag it, and "You are the Baroness" sat at the top of the inbox for weeks.
**Never fix a misbehaving DM by adding its `source` to a filter list** — that
is the exact pattern this replaced. Set its `kind`.

A raw `prisma.directMessage.create` gets no `sendDm` default, so the four
inbound writers each set `kind` by hand. The read-side predicates all live in
`web/lib/dmThread.js`. See `PLAYER-DESK.md` §5.

## Bot message style ("aura")

Bot-authored Discord text should feel understated, not like a typical bot
dashboard. No big colorful emoji — small unicode marks only.

Discord's `-#` subtext is part of the vocabulary too. Use it for a line of
guidance that shouldn't compete with the message itself — the
Move-declaration DM uses it to explain Routine/Gambit under the
dropdowns. Use it sparingly: it's for explaining a control, not for
footnoting prose.

**A line the WORLD says into a channel is `-#` subtext, and it goes through
`db/lib/ambientLine.js`.** A gate crossing into a zone's `#summary`, a smell in
a Location, a whisper overheard in a Room, somebody moving goods around a
stash — all of it is scenery. It arrives unprompted, often mid-scene, and
full-size bot text competing with player prose read as an interruption. Subtext
sits under the conversation instead of in it. Two things are easy to get wrong
by hand and the helper handles it: `-#` is **per line**, so a multi-line block
needs the prefix on every line.

**The intercom is the deliberate exception** (`db/lib/intercom.js`). A PA is
not scenery, it is a loudspeaker, and it carries an `@here` — delivering the
loudest notification Discord has in the quietest text it renders was
backwards. Full size, no helper. If something else ever needs to be *heard*
rather than noticed, it belongs on that side of the line too.

**Discord's angle-bracket syntax is safe on both faces now.** A `<t:EPOCH:R>`
in DM text renders as a live relative time on Discord *and* on the web, in each
reader's own timezone — so prefer it over a pre-formatted date. The same goes
for `<@…>`, `<#…>`, `<:name:id>` and `@here`, though the web deliberately
prints no id: a mention reads `someone`, a channel `somewhere`. The vocabulary
is defined once in `db/lib/discordMarkup.js` and rendered by
`web/app/components/remarkDiscord.js`; `db/test/discordMarkup.test.js` fails
the build on a token neither has been taught. Before this existed, two lobby
DMs showed players a literal `<t:1757700120:F>`.

Lines that quote or restate player/character content get a `»` prefix — e.g.
`» {move description}`. `web/lib/discordGuild.js#sendDm` adds that prefix
**automatically** to every DM a GM sends a player, so those callers pass raw
text. Bot-composed DMs write the `»` at the call site instead, because
they're mixed with other formatting (zone, dice roll) that doesn't go through
`sendDm`.

**An ephemeral reply is `» *italics*`, and `bot/src/lib/respond.js` writes it.**
Every refusal, confirmation and one-line answer the bot gives to one player goes
out through `respond()`, and the format is applied there — the way `sendDm`
applies its `»` and `ambientLine.js` applies its `-#`. The chevron is there
because an ephemeral reply is the game restating your own action back at you;
the italics because it's a note in the margin, not a line in the scene. Before
this, 158 call sites had two formats between them: about a hundred hand-wrote
`» *text*`, three whole modules answered in bare prose, and a refusal coming up
from `db/lib` arrived unformatted and stayed that way — so the same kind of
message reached players in two different voices.

So **call sites pass a bare sentence.** Don't write the chevron by hand and
don't write the italics. `db/lib` especially: those strings are shared with the
web and must stay plain.

Four things are left alone, each for a reason. **Anything with a newline** is a
readout with its own shape — Examine, Who's here?, the Move confirmation — and
italicising a whole block isn't the same act as marking one sentence.
**Anything whose payload carries components**: the line above a picker is a
prompt, not a notice, and "Where would you like to go?" shouldn't arrive in the
voice of a refusal. **Anything already opening with `»` or `-#`**, so the pass
is idempotent and subtext stays subtext. And **anything opening with `*`** —
`**Here:**` would become `» ***Here:**`, and wrapping italics in italics reads
as bold, which says the opposite of quiet.

If a reply needs a shape this can't give it, that's a sign it's a readout, and
it should be built as one.

## Resources glyph (`⬢`)

`⬢` is the Resources glyph. It **replaces the word — it never sits next to
it**. This applies everywhere text is written: the YAML masters, bot/DM
strings, and the web UI.

- Prose that names Resources **as a concept** uses the plain
  word and no glyph: "you are only limited by your Resources".
- Anywhere a **quantity** is shown, drop the word and write `{number} ⬢`:
  `0–4 ⬢`, `3 ⬢`, `+5 ⬢`, `30 ⬢ flat`. Never `3 Resources ⬢`.
- In the UI, the label carries the word and the value carries the glyph —
  `<th>Resources</th>` over cells reading `12 ⬢` — never the other way
  around. A number `<input>` just gets a plain label.

One exception. A `{resource:…}` bubble already renders its own glyph via
`ResourceChip.js`, so never write a glyph after one. Also, literal syntax a
player is meant to *type* (`/move`, `/conceal`) is quoted as-is. The glossary
line in
`docs/systemdocs/infochannel.yaml` is, on purpose, the one place the glyph is
introduced to players.

## Typography in game text

These apply everywhere a player can read the words: the YAML masters, bot and
DM strings, the web UI, `docs/handbook.md`.

- **Straight quotes and apostrophes**, never curly. In JSX text that means
  `&apos;` and `&quot;` — `react/no-unescaped-entities` is an error in this
  repo, and most of the curly ones that used to be here were somebody working
  around it rather than a choice.
- **`…`**, not three dots.
- **An em dash gets its spaces**: `word — word`. The repo already writes it
  that way about 326 times against 8.
- **An en dash, tight, for a numeric range**: `0–4 ⬢`.
- **A number a player counts or pays is a digit** — `3 turns`, `2 ⬢`, `150 lb`,
  `a 5 or a 6`. Ordinary prose still spells one through nine: "one crate",
  "two hands". And a sentence never opens with a numeral, so "One turn is one
  real day" stays as it is.
- **No double dagger, ever.** See the top of this file.

Two things that look like mistakes and are not. A **trailing space on a bot
string** is nearly always a concatenation joint — strip it and two words run
together. And in Markdown, **two trailing spaces are a hard line break**;
`docs/handbook.md` has 55 of them on purpose.

`scripts/copy/` is the tool for a pass over all of it: `npm run copy:extract`
pulls every player-facing string into `worksheets/`, and `npm run copy:reinject`
writes edits back, refusing anything that would break a Discord length cap. It
knows what is copy and what is a code comment, which a grep does not.

### `⬢` and `¢` are two currencies, not one

`⬢` is Resources. `¢` is obols, the physical coin. **One obol is one ⬢**
(`DEPOT.md` §0) — that is parity, not identity, and the game converts between
them: `DepotOrderTab.js` renders `{cartResources} ⬢ = {cartTotal} ¢`.

So **never swap one glyph for the other in bulk.** A value read off an
`*Obols`/`obols` field prints `¢`; `resources` prints `⬢`. Getting this wrong
is quiet — the GM's Depot page spent a while showing the station account in ⬢
while the player's own Bank tab showed the same number in ¢.

### Editing Bascinet's text

A comment saying "Bascinet's words, verbatim" means **do not rewrite the
voice**. It does not mean do not touch.

When Bascinet hands over new text — or you meet old text that missed a pass —
bring it in line with everything above without asking: quotes, dashes,
ellipses, digits, the glyphs, a missing full stop. The wording, the structure
and the tone stay Bascinet's. Fixing a plain error in that text (a subject
disagreeing with its verb, a doubled word) is welcome too; say in chat what you
changed.

## Confirm dialog

For any "are you sure?" moment in the web app, use the shared confirm dialog.
Don't roll a one-off modal or `window.confirm`.
`web/app/components/ConfirmProvider.js` mounts once in `web/app/layout.js`
and exposes `useConfirm()`, a promise-based hook:

```js
const confirm = useConfirm();
if (!(await confirm({ title, message, confirmLabel, cancelLabel }))) return;
```

All fields are optional, and it reuses the existing `.modal-overlay` /
`.modal-panel` styling. If the confirm needs a typed reason plus arbitrary
JSX, use `RequestDialog.js` instead (`REQUESTS.md`).

## Web UI conventions

Full detail in [`DESIGN-SYSTEM.md`](docs/systemdocs/DESIGN-SYSTEM.md) — read
it before writing any UI. Four rules apply everywhere:

- **Never hardcode a hex/rgb colour.** Always use `var(--x)`, so the colour
  follows the active theme. There are currently zero hardcoded colours in the
  whole app; keep it that way. Run `npm run audit:contrast --workspace=web`
  after touching a colour.
- **Use the shared components, not hand-rolled markup.** `PageShell` +
  `PageHeader` for every top-level page, `DataTable`/`useTableState` +
  `Pager` for every long list, `.panel` / `.btn` / `.field` / `.chip` for
  everything else. A bare `<select>` outside `.field` visibly breaks the
  theme.
- **`--font-mono` is for data only** (numbers, IDs, timestamps), applied with
  `.mono`. Headings get their serif automatically from the tag — never
  hand-apply a font class. `--font-display` (blackletter) is for a handful of
  thematic moments.
- **`react-hooks/set-state-in-effect`, `react-hooks/immutability` and
  `no-undef` are errors in this repo.** Reset paging inside the setter, not
  in an effect. Read `localStorage` through `useSyncExternalStore`, not an
  effect. The Next preset turns `no-undef` off because it assumes TypeScript
  is catching those — but this is a JavaScript codebase, so nothing was. The
  result: a component referenced without its import built clean, linted
  clean, and threw only when someone opened the page. That's why the rule is
  on.

## Game state: the live data is real — ask before anything destructive

**There is a single live production site, and the characters, turns and
messages in it are real.** Do not treat production as a sandbox you can
rebuild from the YAML masters and a wipe — someone's afternoon is in that
database.

- **Stop and ask before anything that can lose data on the live database.**
  A migration that drops a column, `db:sync-documents`,
  `db:prune-tags -- --apply`, `db:prune-orphan-roles -- --apply`,
  `db:prune-stale-channels -- --apply`, a `#info` rebuild, a Restart Game
  wipe — none of these are "just do it" any more. **Restart Game got sharper,
  not softer:** it now takes the transcript out of the database too, and on
  "discard" that is gone for good with no packet behind it (`ARCHIVE.md` §6). Say exactly what you're
  about to run and why, in chat, and wait for a real yes before running it.
  "The user asked me to fix X" is not the same as "the user approved
  wiping/pruning rows to do it" — a destructive step inside a bigger task
  still needs its own confirmation. `db:import-zones -- --apply` is **not**
  on this list in the old sense — it's additive-only, creates whatever
  `docs/zones.yaml` names that the database doesn't already have, and never
  deletes or updates a row — but it still writes, so it goes through
  `db-guard.py`'s `CONFIRMED=1` gate the same as any other apply-flagged
  script. The actual destructive act for a place now is a superadmin's hard
  delete from `/gm/dev/zones`, which still needs the same "ask first."
- **`.claude/hooks/db-guard.py` backs this up technically, not just in
  prose.** It refuses the destructive `db:*` scripts above outright when
  `DATABASE_URL` resolves to the live Railway database, unless the command
  is prefixed with `CONFIRMED=1`. That prefix exists to be typed by hand
  *after* the user has actually said yes in chat — reaching for it the
  moment the hook blocks something defeats the entire point of the hook.
  A full reset (`prisma migrate dev`/`reset`, `db push`, `npm run
  db:migrate`) has **no bypass at all**, confirmed or not — see the next
  bullet.
- **`echo $DATABASE_URL` before you run anything that writes. The variable
  wins, and a `.env` file proves nothing.** `dotenv.config()` does NOT override
  a variable that is already exported, so a scratch script with a local `.env`
  sitting right beside it will happily write to Railway and say nothing about
  it. That is not hypothetical: on 2026-09-09 a throwaway regression harness
  truncated seven tables on the live database exactly this way and emptied a
  real game. Two guards now stand behind this, and neither replaces looking:
  `db/lib/localDatabase.js` refuses TRUNCATE/DROP through the shared Prisma
  client against any non-local host (no bypass, and it holds inside
  `$transaction`), and `.claude/hooks/db-guard.py` refuses the same verbs typed
  on a command line. The client guard is the one that catches SQL living inside
  a file; the hook cannot see that far.
- **A throwaway harness that writes calls `requireLocalDatabase()` first**, from
  `db/lib/localDatabase.js`, before it opens a connection — the way
  `scripts/dev/seed-test-data.mjs` does. One line, and it names the host it
  refused.
- **Test locally first, by default.** There is close to never a reason to
  need the live database just to check whether a change works.
  [`LOCAL-DEV.md`](docs/systemdocs/LOCAL-DEV.md) covers `npm run dev:setup`
  (a local Postgres, migrated and seeded from the YAML masters) and
  `LOCAL_MODE` (every Discord call answered locally — no real bot token,
  guild, or GM role needed to test a GM-gated page).
- **Still never `prisma migrate reset` or accept a `migrate dev` reset
  prompt.** That is how game one died on day 10, and the habit was gone
  before this launch for exactly that reason — it does not get looser now.
  Author migrations so `migrate deploy` applies them.
- **A backup comes first**, even once the user has approved something
  destructive — `npm run db:backup`, or `npm run deploy`'s automatic one
  ahead of a migration. Approval is not a reason to skip it.

None of this applies to a local Postgres under `LOCAL_MODE` — that database
holds nobody's real anything, and the whole point of `LOCAL-DEV.md` is to
make that the place syncs, wipes and migrations get tried first.

## Git workflow

**This file describes two different workflows, and which one applies depends
on whose checkout this is.** Detect it before touching git — don't guess from
a commit author or a display name, check the remotes:

```
git remote -v
```

- `origin` resolves to `peace-lock/helmetmegagame` → this is **Bascinet's own
  checkout**. Follow "Bascinet: master-only" below.
- `origin` resolves to somewhere else — a fork, e.g. a contributor's own
  GitHub account — typically alongside an `upstream` remote pointing at
  `peace-lock/helmetmegagame` → this is a **contributor's checkout**. Follow
  "Contributors: fork's master, then a PR into upstream" instead.

### Bascinet: master-only

**Bascinet is master-only. There are no branches and no pull requests.** All
work is committed straight to `master` and pushed as soon as it's finished,
so it can be pulled locally the moment it's done. That immediacy is the point
of the whole setup, and a feature branch defeats it. Railway also builds from
`master`, so work sitting on a branch is work that hasn't shipped.

```
npm run push -- "Commit message"   # git add -A, commit, git push -u origin master
npm run push                       # same, with a "wip" message
```

Never `git checkout -b`, never open a PR, never ask which branch to use. If a
remote session gets handed a throwaway `claude/<slug>` branch, it abandons it
for `master`. `.claude/hooks/session-start.sh` (a `SessionStart` hook) does
that automatically, and in the same pass deletes any `origin/claude/*` branch
that holds nothing `master` doesn't already have. It refuses to move off a
branch with uncommitted changes or unmerged commits, and it never deletes an
unmerged branch — so it can't lose work. It just prints what it skipped.

That hook also **fetches**, which matters more than it sounds. A remote
container clones once at session start and then goes stale. Without the
fetch, a session can spend an hour editing files that `master` moved past
hours ago.

**Pushing to `master` is a deploy.** Read the Deploy workflow section before
pushing anything that carries a schema change.

### Running several local sessions at once

**Never point two local Claude Code sessions at this checkout directly, at
the same time.** Two sessions editing the same working tree and the same
`.git` index have no isolation from each other — one session's edit, `git
add`, or revert can land on top of another session's unfinished work with no
error and no conflict, just silent corruption. This is exactly how the
checkout has ended up, more than once, with a large uncommitted diff that
touches dozens of unrelated files and that no session recognizes as its own
— two or more sessions' half-finished edits merged together by accident, not
one session's coherent work.

**Each local session gets its own git worktree instead.** A worktree is a
second folder off the same `.git` — same commit history and objects, its own
files, its own index — so sessions in separate worktrees can never step on
each other's uncommitted state. This doesn't weaken the master-only rule
above: work still lands on `master`, fast, no PR, no review. It just moves
where a session's WIP briefly lives before that.

```
claude -w                      # or EnterWorktree inside a session
# ...edit...
npm run push -- "Subject" "note"   # from the worktree, on any branch
```

**`npm run push` does the landing for you.** It commits the worktree, rebases
onto the newest `origin/master`, writes the changelog entry into the top
commit, and pushes `HEAD:master`, rebasing again if another session got there
first. Three refusals guard it:

- **The shared checkout, while other worktrees exist.** `git add -A` there
  sweeps up other sessions' files. `--allow-shared-checkout` overrides, and
  `git worktree remove` your old ones so the count stays honest.
- **A rebase conflict.** Nothing is pushed; fix it in the worktree and push again.
- **A stale-copy revert** (`scripts/revert-guard.js`): the push deletes 5+
  lines that some other commit added in the last 48h. That is the shape of
  be5c3d7c, which silently reverted a day of work on 2026-09-12.
  `--allow-revert` when you really mean it.

Keep it to about five live sessions. Past that, the bottleneck is merging and
checking the work, not writing it; group related bugs into one session.

In Claude Code itself, call `EnterWorktree` at the start of the session — it
creates an isolated worktree under `.claude/worktrees/` on a fresh branch and
switches the session into it automatically; `ExitWorktree` merges and cleans
up when the session is done. Do this every time more than one local session
will be touching the repo, not just when a task feels risky — the corruption
above comes from ordinary concurrent edits, not from anything unusual.

The "never `git checkout -b`" rule further up is about not letting work sit
on a long-lived feature branch instead of shipping to `master`. A
session-scoped worktree branch that exists for one working session and gets
fast-forwarded into `master` and deleted before the session ends is not
that — it's the required setup for any session that isn't the only one
touching the checkout.

If a push to `master` gets rejected because another session pushed first,
that's fine and cheap: `git fetch && git rebase origin/master`, then push
again. That failure is loud and easy — the one worth avoiding is the quiet
one above, where two sessions share a working tree and neither ever finds
out until a page crashes.

Cloud sessions don't need this — each already runs in its own isolated
environment and only ever meets `master` at push time, which is the ordinary
git-conflict case, not the shared-working-tree one.

### Contributors: fork's master, then a PR into upstream

A contributor's checkout mirrors Bascinet's master-only habit, just one repo
over: commit straight to **your own fork's `master`** (no feature branch),
push it to `origin`, then open a pull request from your fork's `master` into
`upstream`'s `master`. This is the established pattern — see e.g. "Merge pull
request #24 from Erdromian/master" in the git log — not a new convention.

```
# ...commit straight onto master, same as Bascinet's own flow...
git push origin master                                       # push to YOUR fork's master
gh pr create --repo peace-lock/helmetmegagame --base master \
  --head <your-github-username>:master                       # fork:master -> upstream:master
```

- **Never push to `upstream`.** You don't have write access to it, and even
  if you did, the master-only flow above is Bascinet's, not a contributor's —
  `origin` (your fork) is the only remote a contributor ever pushes to.
- **A branch works too, if you'd rather.** Nothing here forbids the ordinary
  `git checkout -b my-change` + PR-from-a-branch shape; it is just not the
  pattern this repo has actually used. Either way, the PR's base is always
  `upstream`'s `master`, never `origin`'s.
- **`.claude/hooks/session-start.sh` is safe to leave alone.** It only ever
  fast-forwards or moves the checkout onto `master` when doing so loses
  nothing — it never discards a commit `origin/master` (your fork's master)
  doesn't already have. Committing straight to your fork's `master`, the way
  this section describes, is exactly what it expects.
- **`npm run push`, `npm run changelog` and `npm run deploy` are Bascinet-only
  conveniences** — they push straight to `master`, post to the live Discord
  server, and (deploy) touch the production Railway services and database.
  Don't run them from a contributor checkout; plain `git`/`gh` is the whole
  job.
- **The changelog and Discord announcement for a merged contribution are
  Bascinet's to write when accepting the PR**, not something a contributor
  adds to `CHANGELOG.md` themselves. Describe what changed and why in the PR
  body instead.

### The changelog

**Bascinet-only** — see "Contributors: fork's master, then a PR into upstream" above for what a
contribution's changelog entry should look like instead.

**Every push writes an entry in `CHANGELOG.md` and posts the same entry to
Discord.** `npm run push` does both for you — the entry is written *before* the
commit, so it rides along inside that commit instead of trailing behind in a
second one, and the Discord post goes out after the push succeeds.

**The changelog is GM-facing, and it says what changed in the game — never
which files moved.** A path means nothing to a GM. Write the sentence you would
say out loud: "the good labor spots now wear out as they are worked", not
`✎ db/lib/autoLaborPass.js`. The heading is that sentence; each note under it is
one more.

```
npm run push -- "Subject" "a note" "another note"   # commit, push, log, announce
npm run push -- "Subject" --hidden                  # push, log nothing, say nothing
npm run changelog                                   # log HEAD + announce, for a hand commit
npm run changelog -- --dry-run                      # preview the CHANGELOG.md entry
npm run changelog -- --announce --dry-run           # preview the Discord message
```

The first argument is the heading. Every plain argument after it is one note.
Three glyphs, and a note with none is a change:

```
## 2026-09-03 · Laboring wears the good spots out

✎ The best labor Locations now drift down as they are worked, so nobody camps one
✚ A Labor? button on the turn console
− The old /labor command
```

A note may lead with its own glyph — `"+A Labor? button"`, `"-The old /labor
command"`, plain text for `✎`. The glyphs are `✚ − ✎` rather than `+ - ~`
because none of those three is a Markdown list marker, so the lines render
literally with no code fence around them — and prose inside a fence does not
wrap, which is the whole reason the old file-list format could get away with
one.

Commit by hand and nothing is logged, so run `npm run changelog` afterwards. It
reads HEAD, and takes its notes from the **commit message body** — any body line
starting with a glyph, a `-` or a `*`. A bullet wrapped over several lines is
folded back into one note, so a body wrapped at 72 columns announces whole
sentences rather than first lines.

**Two things stay out of it.**

- **`--hidden`.** If Bascinet says a push is hidden, pass `--hidden` (or
  `--secret`) and nothing is written and nothing is posted. There is no partial
  version — a heading alone still tells the GMs something happened.
- **Lore and antagonists, by default.** A push touching `docs/lore.md`,
  `docs/archive/`, `db/lib/threats.js` or `docs/systemdocs/THREATS.md` is held
  back on its own, with a line printed saying so. The GMs get briefed on that
  material deliberately and in order, not by changelog. `--tell-gms` overrides it for the
  odd case where the change really is theirs to see. The same applies to your
  own wording: don't describe a secret in a note about some other file.

The Discord half is **best-effort and never fails the push** — a missing
`DISCORD_TOKEN` or a Discord outage prints a warning and the run stays green.
The channel id is hardcoded in `scripts/changelog/log.js` for the reason
`db/lib/roleIds.js` gives: a channel id is not a secret, there is one guild, and
a missing env var would have failed silently.

## Deploy workflow

**Bascinet's checkout only** — see "Git workflow" above for how to tell.
`npm run deploy` pushes straight to `master` and touches the live Railway
services and database; a contributor's checkout has no business running it
and almost certainly lacks the `RAILWAY_TOKEN` to anyway. A contribution
gets deployed when Bascinet merges and pushes it, not by the contributor.

Unless the user says otherwise, after finishing a set of changes, run
`npm run deploy` from the repo root.

```
npm run deploy      # git push origin master, ./migrate.sh, redeploy web + bot
npm run redeploy    # just the redeploy, no push, no migration
```

`./migrate.sh` takes a Railway backup first (`npm run db:backup`), then
migrates. It sits **between** the push and the redeploy on purpose. If you
migrate first, new columns just sit unused for a few seconds — harmless. If
you redeploy first, you ship code that queries columns the database doesn't
have yet, for the whole length of a build.

**A bare `git push` is a complete deploy now.** Railway builds from this
GitHub repo, so pushing to `master` triggers a deploy. Two settings on the
Railway services make that deploy correct, and both are set:

- **Pre-Deploy Command on `web`: `npm run db:migrate:deploy && npm run
  db:sync-deploy`.** It runs after the build and before the new version takes
  traffic, so a failed migration aborts the deploy instead of shipping a
  half-migrated app. `db:sync-deploy` runs tags, desires, documents, then labor
  drops — the four syncs that touch no Discord and hold no player state (tags
  and desires upsert; documents and labor drops rebuild pure config tables), so
  a YAML edit to any of them lands with the push, no hand sync. A YAML error
  there fails the deploy loudly, which is the point. Zones and #info still move
  Discord objects, and stay hand-run steps. Scoped to `web`
  on purpose — `bot` shares the database and would only race it. Don't use a
  root `railway.json`, which would apply to both services.
- **Watch Paths are empty on both services**, so every push rebuilds both.

Neither was set for a long time, and each caused its own outage.

Without the Pre-Deploy Command, a deploy carrying a new migration shipped code
querying columns the database didn't have. The symptom is brutal to diagnose
from the browser: the page throws `P2022` server-side, and Next redacts it to
a bare digest (`ERROR 330354103`). The whole route goes down, not just the
feature that needed the column.

The Watch Paths were worse, because they failed *silently*. `web` watched
`/web/**` and `bot` watched `/bot/**`, so **nothing watched `/db/**`** — the
schema, the migrations, and every shared module in `db/lib/`. A push touching
only shared code was marked `SKIPPED` and the old container kept running, with
the old **generated Prisma client** baked into its image. That is
`PrismaClientValidationError: Unknown argument` in production, for exactly the
reason the stale-client note under "Verifying a change locally" gives. Nothing
watched `/docs/**` either, and `web/lib/handbook.js` reads `docs/handbook.md`
off disk at runtime. Leave the Watch Paths empty; the few build-minutes are
cheaper than one skipped deploy.

If a route ever throws `P2022` again, check the other direction too: a
migration applied to production from a working tree whose code was never
pushed leaves the **database ahead of the deployed build**, and a dropped
column reads identically from the browser. `scripts/push.sh` refuses a push
while `db/prisma/migrations/` holds an untracked directory, which is the half
of that this repo can actually catch.

`npm run deploy` is still the path that takes a **backup** first — the
Pre-Deploy Command does not. Use it for anything destructive. (`db:migrate` is
`migrate dev` — **never** point that at production.) `./migrate.sh` is the
one-liner: it sources the root `.env` first, since npm won't load the file for
you.

Two more things that cause real problems:

- **`--from-source` is required — don't drop it.** A plain
  `railway redeploy` re-runs the *existing* deployment, meaning the same
  commit. Both scripts already pass the flag.
- **A `RAILWAY_TOKEN` must be in the environment.** It has to be a *project*
  token (Railway dashboard → the project → Settings → Tokens), not an account
  token. A project token needs no `railway link`. Without one, the CLI fails
  unauthenticated and nothing deploys.

The service names in the scripts (`web`, `bot`) must match the names in the
Railway project.

## Cloud session setup (Claude Code on the web, and similar)

A fresh remote container clones the repo and nothing else — no `.env`, no
global CLIs. To make one able to build, run, and deploy:

1. **Secrets.** Set every key from `.env.example` as an environment variable,
   plus `RAILWAY_TOKEN`. The bot and the Prisma CLI read a root `.env` file,
   so a setup step should also write those values to
   `/home/user/lifeweb/.env` (it is gitignored; never commit it).
2. **Railway CLI.** `npm i -g @railway/cli` — it is not preinstalled.
3. **The database is not reachable by default.** `DATABASE_URL` points at
   Railway's public TCP proxy on a non-443 port. Sandboxed sessions route
   their traffic through an HTTPS proxy that can't carry raw-TCP Postgres. So
   `prisma migrate` and seed scripts fail with `P1001` even though the URL is
   correct. Run DB commands from a machine with direct network access, or
   against a local throwaway Postgres.
4. **Next.js does not read the root `.env`.** It loads env from its own
   project root, so local `npm run dev:web` needs a `web/.env` (a symlink is
   enough). Railway is unaffected — there, the service supplies the vars.

## Notes for future work

- `web/CLAUDE.md` / `web/AGENTS.md` are generated and maintained by the
  Next.js tooling itself (regenerated by `next dev`). They carry
  version-specific Next.js guidance and are separate from this file.
- The bot has no ESLint config yet; the web app's linting is scoped to
  `web/`.
- **Waiting for Opponents** (`MoveReviewStatus.WAITING_FOR_OPPONENTS`),
  `MoveReviewStatus.IN_PROGRESS`, and `ActionStatus.PENDING_OPPOSED` are legacy
  values from the removed Opposed flag. Nothing writes any of them any more;
  they're kept in their Postgres enums rather than dropped, same as
  `ActionStatus.ADJUDICATED`. `TagSource.DESIRE_REWARD` and
  `TagSource.LEADER_GRANT` are the same shape from an earlier tag-sourcing
  design — declared in the enum, written and read nowhere.
  `Character.travelToLocationId` / `travelTurnId` joined them on 2026-09-14,
  when deferred travel was removed and every crossing started landing at once
  (`MAP.md` §3) — `db/lib/travelArrivalPass.js` still reads them, purely as a
  drain for anybody left mid-journey by that change, and should be deleted once
  they have landed.
  `TagGroup.color` joined them on 2026-09-15: a chip's colour comes from its
  `Tag.category` now (the `--tag-*` tokens) and a group is marked by an icon
  instead, so the column is unread, unwritten, and gone from
  `docs/taggroups.yaml`. Do not give a group a colour again — see
  `DESIGN-SYSTEM.md`.
  `GameConfig.mindlinkChannelId` is the same kind of orphan: the column
  stays in the schema, but nothing reads or writes it since the Cult of
  Bacchus was archived (`docs/archive/bacchus.yaml`), and `Character.missedMealStreak`
  joined it the same way when the fear dial replaced the Disappointed track
  (`MOOD.md`). `TagSource.CONDITION` became the newest of them when the mood
  rework stopped projecting the dial onto a tag at all. `Character.autoMount`
  joined them when the "Automatically ride my mount" switch was removed.
- The **mid-game tag store is `/store`**: the shared `PointBuy.js` experience
  mounted with `afterStartOnly`, spending `Character.tagPoints`, each cart
  filed as one `BUY_TAGS` request. What's still open is the rules for earning
  points during play (Desires are currently the only faucet).
- **`AuditLog` is the whole record of what a player did.** There is no
  `Request` table any more — player actions apply their effect and write one
  audit row, there is no reason field and no Undo, and a GM repairs by hand
  from `/gm/dev`. Three per-turn rations (the medic's cure cap, Dead Simple,
  a recipe's own `requirementPerTurn`) COUNT those rows, so a new action a
  ration covers must set `AuditLog.turnId`. See `REQUESTS.md` §1a.
- **`prisma migrate diff` proposes dropping `ArchiveEntry_content_trgm_idx`.**
  That index lives only in raw migration SQL, so Prisma's schema doesn't know
  about it. Decline the drop; it is not drift you introduced.
  `FactionApplication_pending_unique` is the same shape of ghost: a PARTIAL
  unique index (`WHERE status = 'PENDING'`), which Prisma's schema language
  cannot express. Decline that drop too — without it a character could hold
  two live applications to one faction. `ThreatSpawn_pending_unique` is the
  third of these, and the same answer: without it a player could hold two live
  spawn offers (`THREATS.md` §4). `AuditLog_details_trgm_idx` is the fourth,
  and the reason `/gm/audit`'s text search is not a full-table scan.
  `DirectMessage_clientNonce_key` is the fifth and the same answer: a PARTIAL
  unique index (`WHERE "clientNonce" IS NOT NULL`), so every DM writer with no
  composer behind it can go on passing null. Decline that drop too — without
  it a retried send can reach a player twice. The
  `DirectMessage_notify` trigger (`CHAT.md` §2b) is the fifth — Prisma does
  not model triggers, so `migrate diff` never mentions it either way, but a
  hand-written "fix drift" migration must not drop it. The adjudication desk's
  four are the same shape and the same answer: `Action_notify`,
  `CavingRoll_notify`, `StagedEffect_notify` and `StagedMessage_notify`, which
  raise `bascinet_desk` so a second GM's desk updates live (`ADJUDICATION.md`
  §3). `Action_notify` is COLUMN-SCOPED; recreating it without its `UPDATE OF`
  list would wake every open desk for every write in a turn-end push.
  `Delivery_notify` is the sixth, and the odd one: it announces its PARENT
  `StagedMessage`, because no desk row is a `Delivery` (`ADJUDICATION.md` §1a).
- The **Dev Panel doesn't surface the REST breaker yet.** `GameConfig` now
  carries `restInvalidCount` / `restInvalidWindowStart` /
  `restBreakerOpenUntil`, and `getInvalidResponseStats()` reads them, but the
  only reader is the startup line in `bot/src/events/ready.js`. A GM-visible
  number would be a small addition.
