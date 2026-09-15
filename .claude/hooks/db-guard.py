#!/usr/bin/env python3
# PreToolUse hook on Bash: refuse the commands that can destroy real data on
# the live database — a full reset, or a targeted destructive sync/prune run
# against it. There is now a single live production site with playtest users
# who care about the data (docs/systemdocs/LOCAL-DEV.md), so "just run it" is
# no longer the right default the way it was pre-launch.
#
# Two tiers:
#   - FULL RESET (migrate dev/reset, db push, npm run db:migrate): refused
#     outright against Railway, no bypass, ever. "Game one ended that way on
#     day 10" — see CLAUDE.md. Author migrations locally, apply with
#     'npm run db:migrate:deploy' (./migrate.sh).
#   - IRREVERSIBLE SQL (TRUNCATE, DROP TABLE) anywhere in the command:
#     refused against Railway, no bypass. This tier exists because the two
#     below match a FIXED LIST of known scripts, and on 2026-09-09 a throwaway
#     `node scratch-file.js` truncated seven tables on the live database
#     without matching any of them. The verb is the thing worth catching, not
#     the filename. db/lib/localDatabase.js is the same refusal one layer in,
#     at the Prisma client, where it cannot be routed around at all.
#   - TARGETED DESTRUCTIVE (db:import-zones -- --apply, db:prune-tags -- --apply, ...):
#     real rows get deleted, but it isn't a whole-database reset. Refused
#     against Railway UNLESS the command is prefixed with CONFIRMED=1 — that
#     prefix exists to be typed by hand after asking the user in chat, not
#     reached for on its own the moment this hook blocks something.
#
# Reads the tool call as JSON on stdin; prints a reason and exits 2 to block.
# Heredoc bodies are ignored so a script that merely *writes about* the verb
# (a doc edit, this file itself) is not mistaken for one that runs it.
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

RESET_PRISMA = re.compile(r"prisma\s+(migrate\s+(dev|reset)|db\s+push)")
# Matched against the command TEXT, so it catches psql, an inline `node -e`,
# and any ad-hoc script whose SQL is written on the command line. A script that
# hides the verb in a file it reads is caught by the client-side guard instead.
IRREVERSIBLE_SQL = re.compile(r"\b(TRUNCATE|DROP\s+(TABLE|SCHEMA|DATABASE))\b", re.I)
RESET_NPM = re.compile(r"npm\s+run\s+db:migrate(\s|$)")

# npm script name -> the direct node invocation some sessions use instead
# (also allowed by .claude/settings.json, so it needs the same guard).
DESTRUCTIVE_SCRIPTS = {
    "db:sync": "db/scripts/sync/all.js",
    "db:sync-documents": "db/scripts/sync/sync-documents.js",
    "db:sync-narrowcast-channels": "db/scripts/sync/sync-narrowcast-channels.js",
    "db:rebuild-info-channel": "db/scripts/sync/rebuild-info-channel.js",
    "db:prune-tags": "db/scripts/ops/prune-tags.js",
    "db:convert-lecturers": "db/scripts/ops/convert-lecturers.js",
    "db:dedupe-room-stash": "db/scripts/ops/dedupe-room-stash.js",
    "db:prune-orphan-roles": "db/scripts/ops/prune-orphan-roles.js",
    "db:prune-stale-channels": "db/scripts/ops/prune-stale-channels.js",
}

# `db:mirror` and `db:import-zones` are guarded only WITH `--apply` (see
# APPLY_ONLY_SCRIPTS below). A bare run of either is a read-only preview, and
# forcing CONFIRMED=1 onto a preview is the habit this file's header warns
# against. With --apply, db:mirror creates, renames and reparents live
# Discord objects, and db:import-zones writes real Zone/Location/Room rows
# (additive-only — it never deletes — but it writes), so both join the list.
APPLY_ONLY_SCRIPTS = {
    "db:mirror": "db/scripts/ops/mirror.js",
    "db:import-zones": "db/scripts/ops/import-zones.js",
    # Unequips gear on live characters after the HEAD/BODY slot collapse.
    # Bare, it only reports who is over the new limit.
    "db:collapse-equip-slots": "db/scripts/ops/collapse-equip-slots.js",
}

CONFIRM_TOKEN = "CONFIRMED=1"


def strip_heredocs(s):
    out, lines, i = [], s.split("\n"), 0
    while i < len(lines):
        m = re.search(r"<<-?\s*['\"]?(\w+)['\"]?", lines[i])
        out.append(lines[i])
        i += 1
        if m:
            term = m.group(1)
            while i < len(lines) and lines[i].strip() != term:
                i += 1
            i += 1
    return "\n".join(out)


def resolve_database_url(c):
    m = re.search(r"DATABASE_URL=(\S+)", c)
    if m:
        return m.group(1)
    try:
        with open(os.path.join(ROOT, ".env")) as f:
            for line in f:
                if line.startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def is_production(url):
    return "rlwy.net" in url or "railway" in url


def matches_script(c, npm_name, script_path):
    if re.search(rf"npm\s+run\s+{re.escape(npm_name)}(\s|$)", c):
        return True
    # node db/scripts/... — same script, invoked directly.
    return re.search(rf"node\s+{re.escape(script_path)}(\s|$)", c) is not None


def main():
    try:
        cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
    except Exception:
        return 0
    c = strip_heredocs(cmd)
    # A commit message that talks about the verb is not a run of it.
    c = re.sub(r"(-m|--message)(\s+|=)(\"[^\"]*\"|'[^']*')", r"\1\2''", c)

    url = resolve_database_url(c)
    if not is_production(url):
        return 0

    # Before the allowlist tiers: the verb, wherever it appears.
    m = IRREVERSIBLE_SQL.search(c)
    if m:
        verb = re.sub(r"\s+", " ", m.group(0)).upper()
        sys.stderr.write(
            f"db-guard: refused. '{verb}' against a Railway database is not recoverable, and "
            "DATABASE_URL resolves to the live one. No bypass — on 2026-09-09 a scratch script "
            "truncated seven tables here and emptied a real game. Point DATABASE_URL at a local "
            "Postgres (docs/systemdocs/LOCAL-DEV.md), and remember an EXPORTED DATABASE_URL beats "
            "any .env file: check `echo $DATABASE_URL`, not the file.\n"
        )
        return 2

    reset_verb = None
    if RESET_NPM.search(c):
        reset_verb = "npm run db:migrate"
    else:
        m = RESET_PRISMA.search(c)
        if m:
            reset_verb = m.group(0)

    if reset_verb:
        sys.stderr.write(
            f"db-guard: refused. '{reset_verb}' against a Railway database can reset it. "
            "Author migrations against a local Postgres and apply with "
            "'npm run db:migrate:deploy' (./migrate.sh). No bypass — this is the one that "
            "can lose everything in one command.\n"
        )
        return 2

    guarded = dict(DESTRUCTIVE_SCRIPTS)
    # Guarded only when --apply is on the command line; the dry run is free.
    if "--apply" in c:
        guarded.update(APPLY_ONLY_SCRIPTS)

    for npm_name, script_path in guarded.items():
        if matches_script(c, npm_name, script_path) and CONFIRM_TOKEN not in c:
            sys.stderr.write(
                f"db-guard: refused. '{npm_name}' changes real things, and DATABASE_URL points "
                "at the live database — the one with playtest users who care about this data. "
                "Stop and ask the user in chat before doing anything else; don't just retry with "
                f"the bypass below on your own judgment. Once they've said yes, re-run with "
                f"{CONFIRM_TOKEN} in front of the command.\n"
            )
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
