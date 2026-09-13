#!/usr/bin/env bash
# npm run push -- "Subject" "note" "note" [--hidden]
#
# Commit this worktree's changes, rebase them onto the newest master, write the
# changelog entry into the same commit, push to master, then announce that entry
# to Discord. The first argument is the heading; every plain argument after it
# is one changelog note, in plain language for the GMs.
#
#   npm run push -- "Laboring wears the good spots out" \
#     "The best labor Locations now drift down as they are worked" \
#     "+A Labor? button in #turns"
#
# Run it from a session's own worktree, on any branch: it pushes HEAD to master.
# Several sessions share this repo, and three habits kept losing work:
#   - `git add -A` in the shared checkout swept other sessions' files in;
#   - a push built on an old master overwrote what landed in between;
#   - a file written from a stale read reverted somebody's fresh lines.
# So it refuses the shared checkout while other worktrees are live
# (--allow-shared-checkout), always rebases before pushing (a conflict stops
# it, loudly), and runs scripts/revert-guard.js (--allow-revert).
#
# --hidden writes nothing and announces nothing. --tell-gms overrides the lore /
# antagonist hold-back. See scripts/changelog/log.js.
#
# The push refuses when db/prisma/migrations/ holds an untracked directory.
# --allow-untracked-migrations overrides that.
#
# It also refuses when committed code imports a @lifeweb/db module that is not
# itself in git. --allow-untracked-imports overrides that.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

subject=""
notes=()
flags=()
allow_untracked_migrations=0
allow_untracked_imports=0
allow_shared_checkout=0
allow_revert=0

for arg in "$@"; do
  case "$arg" in
    --hidden|--secret|--tell-gms) flags+=("$arg") ;;
    --allow-untracked-migrations) allow_untracked_migrations=1 ;;
    --allow-untracked-imports) allow_untracked_imports=1 ;;
    --allow-shared-checkout) allow_shared_checkout=1 ;;
    --allow-revert) allow_revert=1 ;;
    *)
      if [ -z "$subject" ]; then subject="$arg"; else notes+=(--note "$arg"); fi
      ;;
  esac
done

subject="${subject:-wip}"

# The main checkout is the one every session can see. `git add -A` there takes
# whatever anybody left lying around, so only a session with the repo to itself
# may push from it.
if [ "$allow_shared_checkout" -eq 0 ] && \
   [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
  all=$(git worktree list --porcelain | grep -c '^worktree ' || true)
  stale=$(git worktree list --porcelain | grep -c '^prunable' || true)
  live=$((all - stale - 1))
  if [ "${live:-0}" -gt 0 ]; then
    echo "push.sh: this is the shared checkout, and $live other worktree(s) exist." >&2
    echo "Push from your session's own worktree, or pass --allow-shared-checkout." >&2
    exit 1
  fi
fi

# A migration that reaches the database but never reaches GitHub leaves
# production's schema ahead of the code Railway builds, which is how
# Structure.linkId took the whole site down. Catch it before the push.
if [ "$allow_untracked_migrations" -eq 0 ]; then
  untracked_migrations=$(git ls-files --others --exclude-standard \
    --directory db/prisma/migrations/)
  if [ -n "$untracked_migrations" ]; then
    echo "push.sh: these migrations are not in git:" >&2
    echo "$untracked_migrations" >&2
    echo "Commit them first, or pass --allow-untracked-migrations." >&2
    exit 1
  fi
fi

# A GameConfig column with no registry entry is a knob nobody can reach.
node db/scripts/ops/check-config-registry.js || exit 1

git add -A

# A shared module that never reaches GitHub fails the WEB BUILD outright --
# "Can't resolve '@lifeweb/db/lib/dmKinds'" -- and Railway answers a failed
# build by keeping the old container alive. So the site silently serves stale
# code while every push looks like it worked. That is what happened on
# 2026-09-08: twelve consecutive failed web builds over 25 minutes, three
# separate files that existed on disk and were never committed.
#
# Checked AFTER `git add -A`, so what is measured is the tree being pushed.
if [ "$allow_untracked_imports" -eq 0 ]; then
  missing_imports=""
  for spec in $(grep -rhoE '@lifeweb/db/lib/[A-Za-z0-9_/-]+' \
      web bot db --include='*.js' 2>/dev/null | sort -u); do
    file="db/${spec#@lifeweb/db/}.js"
    if [ ! -f "$file" ] || ! git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
      missing_imports="$missing_imports  $spec -> $file"$'\n'
    fi
  done
  if [ -n "$missing_imports" ]; then
    echo "push.sh: this tree imports modules git does not have:" >&2
    printf '%s' "$missing_imports" >&2
    echo "The web build fails on these and Railway keeps serving the old container." >&2
    echo "Commit them first, or pass --allow-untracked-imports." >&2
    exit 1
  fi
fi

git diff --cached --quiet || git commit -q -m "$subject"

# Rebase, log, push. If another session pushes in the gap, the push is
# rejected: drop our changelog commit, rebase again, write the entry fresh on
# top of theirs. CHANGELOG.md is only ever touched after the rebase, so two
# sessions' entries never conflict with each other.
pushed=0
for attempt in 1 2 3 4 5; do
  git fetch -q origin master
  if ! git rebase -q origin/master; then
    git rebase --abort
    echo "push.sh: your commits conflict with master. Nothing was pushed." >&2
    echo "Run: git fetch && git rebase origin/master, fix the conflict, push again." >&2
    exit 1
  fi
  if [ -z "$(git rev-list origin/master..HEAD)" ]; then
    echo "push.sh: nothing to push."
    exit 0
  fi
  if [ "$allow_revert" -eq 0 ]; then
    node scripts/revert-guard.js origin/master || exit 1
  fi

  before=$(git rev-parse HEAD)
  node scripts/changelog/log.js --staged --range origin/master..HEAD --message "$subject" \
    ${flags[@]+"${flags[@]}"} ${notes[@]+"${notes[@]}"}
  git add CHANGELOG.md
  git diff --cached --quiet || git commit -q --amend --no-edit

  if git push -q origin HEAD:master; then
    pushed=1
    break
  fi
  echo "push.sh: master moved while pushing (attempt $attempt); rebasing again." >&2
  git reset -q --hard "$before"
done

if [ "$pushed" -eq 0 ]; then
  echo "push.sh: gave up after 5 attempts. Your commits are still here, unpushed." >&2
  exit 1
fi

# Keep the local master ref honest when pushing from a worktree branch.
[ "$(git rev-parse --abbrev-ref HEAD)" = "master" ] || \
  git fetch -q origin master:master 2>/dev/null || true

node scripts/changelog/log.js --announce --message "$subject" \
  ${flags[@]+"${flags[@]}"} ${notes[@]+"${notes[@]}"}
