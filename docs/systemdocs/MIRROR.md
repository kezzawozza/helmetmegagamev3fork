# The Discord mirror

The database is the source of truth for a Zone, Location and Room. Discord
is a mirror of it — `db/lib/discordMirror/`. Read this before touching
anything that creates, renames or reconciles a Discord category, channel,
role or thread from game data.

## What it does

`runDiscordMirror(prisma, { apply, scope })` reads the DB rows
(`desired.js`), takes one snapshot of the live guild (`live.js`), diffs the
two into an ordered op list (`diff.js`), and — only with `apply: true` —
runs the ops sequentially against the live rate-limit breaker (`apply.js`).
`apply: false` is a dry run: it reports what it would do and writes nothing.
Scopes: `structure` (objects only), `cheap` (role membership, no structure —
this is what `runChannelDoctor` aliases to), `full` (both, plus the member
sweeps).

## What triggers it

A web server action's `after()` (an editor save, most reliably), the bot's
`ready` pass, turn advance, and the superadmin "Reconcile now" button on
`/gm/dev`. Each of those enqueues a `MirrorJob` row rather than running the
mirror inline; the queue coalesces repeat saves to the same target
(`@@unique([targetType, targetId])`) and caps retries at 5 attempts. A stuck
job behind an open circuit breaker shows on `/gm/dev`, not silently.

## Adopt by name

Before creating anything, the mirror checks for a same-named live object
(exact name for a role, name+parent for a category, channel or thread,
normalized the way Discord normalizes names) and adopts it — writes its id
to the DB column — instead of making a duplicate. This is what makes a
crash mid-run, or two overlapping runs, safe: re-running finds what the
first run already made and does nothing to it.

## What it never does

**The mirror never deletes anything.** Retiring a place (`retiredAt`) or
hard-deleting one is an editor action at `/gm/dev/zones`, not a mirror op.
`npm run db:prune-stale-channels` is the one script that still deletes
Discord structure, and only for objects left behind by a previous game that
no DB row points at any more.

## GMs: Discord will look quieter than the game is

New characters default to `discordMirrored: false` — web-only. A GM reading
only `#turns` and the zone summaries will see far fewer players acting than
actually are. Read `/chat` and `/gm/turns` instead (`GAMEMASTERS.md`).
