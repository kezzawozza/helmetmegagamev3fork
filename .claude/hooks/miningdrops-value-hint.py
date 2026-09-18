#!/usr/bin/env python3
# PostToolUse hook on Edit|Write: whenever docs/miningdrops.yaml is written,
# run `npm run db:audit-mining-drops -- --write` (docs/systemdocs/MININGDROPS.md
# §6a-§6b) to refresh the file's OWN mechanical comments in place — per-entry
# ⬢ value, per-roll own/combined EV and hit rate, and a per-category rollup —
# then hand the model a short reminder about the one thing that automation
# can't do: writing a "why" blurb for any pool entry that's new this edit.
#
# Informational only past the write itself: a missing local database, a
# Prisma error, anything at all going wrong here just means no refresh
# happens, not a broken edit. Ignores every other file — the matcher fires
# on Edit|Write broadly, so this script is what narrows it to one path.
import json
import os
import subprocess
import sys

MAX_OUTPUT_CHARS = 4000


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not file_path.replace("\\", "/").endswith("docs/miningdrops.yaml"):
        return 0

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    try:
        result = subprocess.run(
            ["npm", "run", "db:audit-mining-drops", "--", "--write"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=60,
        )
        output = ((result.stdout or "") + (result.stderr or "")).strip()
        wrote = result.returncode == 0 and "Wrote refreshed comments" in output
    except Exception as err:
        output = f"(db:audit-mining-drops --write could not be run: {err})"
        wrote = False

    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + "\n… (truncated)"

    if wrote:
        context = (
            "docs/miningdrops.yaml's own comments were just refreshed automatically "
            "(npm run db:audit-mining-drops -- --write) — every entry's ⬢ value, every "
            "roll's own/combined EV and hit rate, and a per-category rollup are current. "
            "The one thing that refresh can't do: if this edit added a NEW pool entry, "
            "give it a short \"why\" blurb — the convention is "
            "`slug  # why it's here — <mechanical value, already filled in>`, blurb first, "
            "then ' — ', then the value the tool wrote. Add the blurb by hand if it's "
            "missing; leave everything else alone, the tool already refreshed it.\n\n"
            f"{output}"
        )
    else:
        context = (
            "docs/miningdrops.yaml changed, but the automatic comment refresh "
            "(npm run db:audit-mining-drops -- --write) did not complete — check the "
            "database is reachable and re-run it by hand before trusting the file's "
            "comments.\n\n"
            f"{output}"
        )

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": context,
        }
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
