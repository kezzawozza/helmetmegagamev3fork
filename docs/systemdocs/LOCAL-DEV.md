# Local development, and not touching the live database by accident

How to get a fully local stack running — local Postgres, no real Discord
credentials — and the rules around when it's ever okay to point anything at
the live one instead. Read this before running any `db:*` script, and before
telling a teammate (human or an AI agent) how to get started.

**The short version, if you're an AI agent skimming this:** there is a
single live production site now, with playtest users whose data is real.
Default to testing against a local database. If you're ever about to run
something that deletes or resets real rows, stop and ask the user in chat
first — don't infer permission from "they asked me to fix X." See §3.

## 1. Getting a local stack running

```
npm install
npm run dev:setup
```

`dev:setup` (`scripts/dev/setup-local.mjs`) does the whole thing, and is safe
to re-run any time — every step skips what's already there:

- Writes a `.env` at the repo root if one doesn't exist (or fills in only
  what's missing from an existing one — it never overwrites a value you've
  already set): a local `DATABASE_URL`, `LOCAL_MODE="true"`, a generated
  `AUTH_SECRET`, and placeholder Discord values (see §2 for why those don't
  need to be real).
- Symlinks `web/.env.local`, `db/prisma/.env` and `bot/.env` to that one
  `.env` — Next.js, the Prisma CLI, and the bot's `dotenv.config()` each look
  in a different place by default, and this is simplest way to make them all
  agree without hand-copying values into three files that can drift.
- Creates the local database (`createdb`) if it isn't there yet.
- Runs `prisma generate`, `prisma migrate deploy` (not `migrate dev` — that
  one's interactive and will just hang here), and `npm run db:sync` to seed
  the catalog (zones, tags, roles, desires, documents) from the YAML masters.

You need a Postgres server running locally first. Postgres.app
(postgresapp.com) is the easiest route on macOS; `brew install
postgresql@16 && brew services start postgresql@16` also works, as does any
Postgres you already have — just put its connection string in `.env` before
running `dev:setup`.

Then:

```
npm run dev:web                        # start the app
npm run dev:seed                       # a couple of throwaway characters + audit rows
node scripts/dev/session.mjs --gm      # print a session cookie for a local superadmin
npm run dev:check -- --gm /gm/audit    # load a GM page headlessly, check it actually rendered
```

There are two ways to actually get a signed-in browser session, and the two
call for different things:

- **Click "Sign in locally" on the landing page.** Only rendered when
  `LOCAL_MODE` is on (`web/app/components/HomeScreen.js`), it signs in as
  the first id in `web/lib/superadmin.js#SUPERADMIN_DISCORD_IDS` through a
  Credentials provider that `web/lib/auth.js` registers only under
  `LOCAL_MODE` — the ordinary "Sign in with Discord" button is still there
  and still tries real Discord, which fails without a real
  `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`. Use this for clicking around
  the app as a person would, including the character creation flow.
- **`node scripts/dev/session.mjs --gm`** prints a cookie value to paste
  into `document.cookie` by hand, or feeds `dev:check` for a headless
  fetch-and-inspect. This is a session cookie minted directly, since it's
  just a JWT signed with `AUTH_SECRET` — no request to the app at all, which
  makes it the right tool for scripted checks (`dev:check`, covered in
  `CLAUDE.md`'s "Verifying a change locally") rather than something to use
  from an actual browser tab.

`npm run dev:seed` (`scripts/dev/seed-test-data.mjs`) adds two characters
named `Seed Alpha (local)` / `Seed Beta (local)` (`discordUserId` prefixed
`local-seed-`, so they're unmistakable and trivial to query for) and two
`AuditLog` rows against them with different action types — enough to click
through something like `/gm/audit`'s filters without needing real turns or
real players. `npm run dev:seed -- --clean` removes them again. It refuses to
run against anything whose `DATABASE_URL` host isn't `localhost` — on its
own, independent of the hook in §3 — because it writes fake rows and that
must never land in the real database.

## 2. `LOCAL_MODE` — testing with no real Discord credentials

Set `LOCAL_MODE="true"` (which `dev:setup` does for you) and every Discord
REST call in the codebase is answered locally instead of reaching the
network. This works because `db/lib/discordRest.js#discordRequest` is the
**one** place every Discord call in the whole app goes through — web, bot
and db alike (`ARCHITECTURE.md` §5) — so one interception point covers
permissions and message-sending at once.

All of this lives in `db/lib/localMode.js`, and it's the only file that
should know what "local mode" means — nothing else should grow its own `if
(isLocalMode())` branch for Discord behavior:

- A member/role lookup answers with a synthetic member holding the Trial GM
  role, Playtest role, Player role, and Leader-Whitelist role (real hardcoded
  IDs from `db/lib/roleIds.js`, not the env-configured `DISCORD_GM_ROLE_ID`).
  Since `isGm`, `isPlaytester`, `isApprovedPlayer` and `isLeaderWhitelisted`
  (`web/lib/discordGuild.js`) all just read `member.roles`, none of them
  needed touching — they pass automatically once the lookup is faked.
- Anything that would post, edit or delete content (a channel message, a DM,
  a role, a permission overwrite — anything) is logged to
  `local-discord-outbox.jsonl` at the repo root instead, one JSON object per
  line, and answered with a plausible stand-in so a caller reading `.id` off
  the result doesn't throw.
- Everything else reads back empty (`[]` or `null`) — nothing exists
  locally, so that's the honest answer rather than an invented one.

`web/lib/superadmin.js#isSuperadmin` is the one thing that can't be reached
this way — it's a hardcoded Discord-user-ID allowlist with no Discord API
call in it at all — so it checks `isLocalMode()` directly instead. If you're
adding a new permission check, prefer the same shape: read off
`getGuildMember()`'s result if you can (LOCAL_MODE will already cover it),
and only add an explicit `isLocalMode()` branch if there's truly no Discord
call underneath the check to intercept.

**Why `DISCORD_TOKEN` and `DISCORD_GUILD_ID` still need to be set to
*something*:** several functions in `web/lib/discordGuild.js` return early
when either is empty, before ever reaching `discordRequest` — so
`dev:setup`'s placeholder values (`"local"`) exist purely to get past those
guards. Their actual contents are never read once `LOCAL_MODE` intercepts
the call underneath.

**What this doesn't fake:** real message delivery (obviously), real avatar
images, and anything that depends on genuine Discord IDs matching real
accounts. It's for testing web app logic and GM-gated pages, not for
verifying what a Discord embed actually looks like — that still needs a real
bot in a real (ideally throwaway) guild.

## 3. Never against the live database without asking

**`CLAUDE.md`'s "Game state" section is the actual policy — read it.** The
short version: there is a live production site now, with real playtest
users. A migration that drops a column, `db:import-zones -- --apply`,
`db:sync-documents`, `db:prune-tags -- --apply`, a Restart Game wipe — none
of these are "just run it" any more. Say what you're about to do and why,
and wait for a real yes in chat.

`.claude/hooks/db-guard.py` is the technical backstop, not a substitute for
asking. It's a `PreToolUse` hook on every Bash call, and it does two
different things depending on how bad the command is:

- **A full reset** — `prisma migrate dev`/`reset`, `db push`, or `npm run
  db:migrate` (which is `migrate dev`) — is refused outright against a
  Railway `DATABASE_URL`, with **no bypass at all**. This is the one that
  can lose everything in a single command, the way it did on day 10 of the
  first game, and that habit doesn't get to come back now that there are
  real players again.
- **A targeted destructive script** — `db:import-zones -- --apply` (additive,
  but writes), `db:mirror -- --apply` (creates/renames live Discord
  objects), `db:sync-documents`, `db:sync-narrowcast-channels`,
  `db:rebuild-info-channel`, `db:prune-tags`, `db:prune-orphan-roles`,
  `db:prune-stale-channels`, or `db:sync` (which runs several of those) —
  is refused the same way unless the command is prefixed with
  `CONFIRMED=1`.

**`CONFIRMED=1` exists to be typed by hand after the user has actually said
yes in the conversation — not reached for the moment the hook blocks
something.** If you're an AI agent and you see the refusal message, the
right next step is to stop and ask, in plain language, exactly what you're
about to run and why it's needed — not to retry with the prefix on your own
judgment. A hook can check *where* a command points; it cannot check whether
anyone actually agreed to run it.

- **Irreversible SQL** — a `TRUNCATE` or a `DROP TABLE` anywhere in the
  command — is refused against Railway with **no bypass**. This tier exists
  because the other two match a *fixed list of known scripts*, and on
  2026-09-09 a throwaway `node scratch-file.js` truncated seven tables on the
  live database without matching any of them. The verb is worth catching; the
  filename never was.

**The hook can only read the command line. `db/lib/localDatabase.js` is the
same refusal one layer in**, on the shared Prisma client, so SQL that lives
inside a file is caught too — which the hook cannot do. It refuses TRUNCATE and
DROP against any host that is not `localhost` / `127.0.0.1` / `::1`, it holds
inside `$transaction`, and it has no bypass at all. It costs nothing real:
every TRUNCATE and DROP in this repo is migration SQL, which the Prisma CLI
applies without going through that client.

**The trap that actually caused it, and the one to check first: an exported
`DATABASE_URL` beats every `.env` file.** `dotenv.config()` does not override a
variable that is already set, so a scratch script with a local `.env` beside it
read production and said nothing. `echo $DATABASE_URL` is the only honest
answer to "which database am I pointed at" — not the file, not the worktree.
Any throwaway harness that writes should call `requireLocalDatabase()` from
`db/lib/localDatabase.js` as its first statement, the way
`scripts/dev/seed-test-data.mjs` now does.

The hook resolves `DATABASE_URL` the same way for every check: an inline
`DATABASE_URL=...` on the command itself, falling back to the root `.env`.
It treats a host containing `rlwy.net` or `railway` as production and
anything else — `localhost`, `127.0.0.1`, a Docker service name — as fine.
That means the single most reliable way to make every one of these commands
safe by default is exactly what `dev:setup` already does: keep the root
`.env`'s `DATABASE_URL` pointed at a local database, always.

**A backup still comes first for anything destructive that's been approved.**
`npm run db:backup`, or `npm run deploy`'s automatic one ahead of a
migration. Approval is not a reason to skip it.

## 4. Troubleshooting

- **`prisma migrate dev` seems to hang** — it's interactive (it wants to name
  a migration, or confirm a reset), and a non-interactive shell has nothing
  to answer it with. Use `npm run db:migrate:deploy` for a fresh local
  database instead; it applies every migration with no prompts.
- **`Environment variable not found: DATABASE_URL` from the Prisma CLI**,
  even though it's in your root `.env` — the Prisma CLI reads a `.env`
  relative to its own working directory (`db/prisma/.env` when run through
  the workspace scripts), not the repo root. `dev:setup`'s symlink step
  covers this; if you're running Prisma commands by hand from somewhere
  else, make sure that symlink still exists.
- **Every page 500s with `Module not found`** after pulling someone else's
  commit — the checkout's `node_modules` is stale relative to a dependency
  the merge added. `npm install` at the repo root, then restart `dev:web`.
- **`PrismaClientValidationError` on a field that's plainly in
  `schema.prisma`** — the running dev server has a stale generated client.
  `npm run db:generate` **and restart `dev:web`**; regenerating alone
  doesn't reach the process that already imported it.
