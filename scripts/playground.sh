#!/bin/bash
# Bascinet playground: the whole game running on your own Mac, no Discord, full
# GM and superadmin controls. For trying the UI and saying what to fix.
#
# Run it (paste into Terminal):
#   curl -fsSL https://raw.githubusercontent.com/peace-lock/helmetmegagamev3/master/scripts/playground.sh | bash
#
# Run it again any time: it pulls the newest version, keeps your world, and
# opens the browser. Ctrl+C in the Terminal window stops it.
#
#   BASCINET_RESET=1   ...| BASCINET_RESET=1 bash   wipes the world and starts fresh
#   BASCINET_DIR       where it lives (default ~/Bascinet)
#   BASCINET_PORT      which port (default 3000)
#
# Installs Homebrew, Node and Postgres 16 if they're missing. Everything runs
# locally; LOCAL_MODE answers every Discord call, so nothing reaches Discord.

set -euo pipefail

DIR="${BASCINET_DIR:-$HOME/Bascinet}"
PORT="${BASCINET_PORT:-3000}"
DB="${BASCINET_DB:-bascinet_playground}"
REPO="https://github.com/peace-lock/helmetmegagamev3.git"

# Whatever the shell exports must never beat the playground's own database.
unset DATABASE_URL

step() { printf "\n\033[1;33m== %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m!! %s\033[0m\n" "$1"; exit 1; }

# Homebrew, from wherever it is already installed, or freshly.
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)"
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  step "Installing Homebrew (it will ask for your Mac password)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)"
  done
  command -v brew >/dev/null 2>&1 || fail "Homebrew didn't install. Open a new Terminal window and run this again."
fi

command -v git >/dev/null 2>&1 || { step "Installing git"; brew install git; }

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  step "Installing Node"
  brew install node
fi

# Postgres: use one that's already running (Postgres.app, say), else Homebrew's.
if ! command -v pg_isready >/dev/null 2>&1 || ! pg_isready -q -h localhost 2>/dev/null; then
  if ! brew list postgresql@16 >/dev/null 2>&1; then
    step "Installing Postgres"
    brew install postgresql@16
  fi
  export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
  step "Starting Postgres"
  brew services start postgresql@16 >/dev/null
  for _ in $(seq 1 30); do pg_isready -q -h localhost && break; sleep 1; done
  pg_isready -q -h localhost || fail "Postgres didn't start. Try: brew services restart postgresql@16"
fi

FIRST_RUN=0
if [ -d "$DIR/.git" ]; then
  step "Updating to the newest version"
  git -C "$DIR" pull --ff-only || echo "   (couldn't update, keeping the version you have)"
else
  step "Downloading Bascinet into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
  FIRST_RUN=1
fi
cd "$DIR"

# The playground's own database, written before dev:setup so setup never
# falls back to the default one.
# The user is named outright: Prisma won't fall back to the Mac account the
# way psql does, and a Homebrew Postgres's superuser IS that account.
if [ ! -f .env ]; then
  printf 'DATABASE_URL="postgresql://%s@localhost:5432/%s"\n' "$(whoami)" "$DB" > .env
fi

if [ "${BASCINET_RESET:-0}" = "1" ]; then
  step "Wiping the world"
  dropdb --if-exists "$DB"
  FIRST_RUN=1
fi

step "Installing packages (a few minutes the first time)"
npm install --no-audit --no-fund --loglevel=error

step "Building the world"
npm run dev:setup

if [ "$FIRST_RUN" = "1" ]; then
  step "Adding a couple of test characters"
  npm run dev:seed || true
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Something is already using port $PORT. Close it, or run again with BASCINET_PORT=3100."
fi

step "Starting the game on http://localhost:$PORT"
(cd web && exec npx next dev -p "$PORT") &
SERVER=$!
# Ctrl+C takes the whole group down, next's own children included.
trap 'kill 0 2>/dev/null; exit 0' INT TERM

for _ in $(seq 1 120); do
  curl -fs -o /dev/null "http://localhost:$PORT" && break
  sleep 1
done
[ -n "${BASCINET_NO_OPEN:-}" ] || open "http://localhost:$PORT"

cat <<EOF

  Bascinet is running at http://localhost:$PORT

  - "Sign in (LOCAL_MODE, no Discord)" makes you the superadmin: every GM page,
    /gm/dev, the lot. Nothing reaches Discord.
  - "Start as a player (LOCAL_MODE)" rolls a fresh character, to see the game
    the way a player does.
  - Sign out from the top bar to switch between the two.

  Leave this window open while you play. Ctrl+C stops it.
  Run the same command again later to update.

EOF
wait $SERVER
