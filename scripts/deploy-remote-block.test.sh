#!/usr/bin/env bash
# Run: bash scripts/deploy-remote-block.test.sh
#
# Verification 12e — a failing migration must abort the deploy BEFORE
# `docker compose up -d` starts the new images against the old schema.
#
# This was a live deployment bug, not a hypothetical: the remote heredoc set no
# shell options, so `prisma migrate deploy` could fail and the script would
# carry on, start the new containers, and — because remote bash returns the
# status of its LAST command — report success. A deploy that ships a broken
# schema and says OK is the worst possible failure mode for the sweep migration,
# which is a backfill, a dedupe and a partial unique index on real data.
#
# The block under test is EXTRACTED FROM deploy.sh, not copied here, so this
# tests the script that actually ships. `docker` is stubbed to a recorder so the
# failure can be forced deterministically — a real stack cannot be made to fail
# a migration on demand, and the thing being asserted is control flow, not
# Docker behaviour.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SH="$REPO_ROOT/deploy.sh"

failures=0
assert() {
  if [ "$1" != "0" ]; then
    echo "FAIL: $2"
    failures=$((failures + 1))
  fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- extract the real remote block -------------------------------------
awk '/<<.REMOTE.$/{f=1;next} /^REMOTE$/{f=0} f' "$DEPLOY_SH" > "$WORK/remote.sh"
BLOCK_LINES=$(wc -l < "$WORK/remote.sh")
# If extraction silently produced nothing, every assertion below would "pass"
# against an empty script. That is the exact way a guard test stops guarding.
if [ "$BLOCK_LINES" -lt 40 ]; then
  echo "FAIL: extracted only $BLOCK_LINES lines from deploy.sh — the heredoc markers moved"
  exit 1
fi
# Anchored and comment-stripped: `# set -euo pipefail` must NOT satisfy this.
grep -qE '^[[:space:]]*set -euo pipefail' "$WORK/remote.sh" \
  || { echo "FAIL: the remote block does not set -euo pipefail"; exit 1; }

# --- a docker stub that records what was called ------------------------
# FAIL_ON: substring of the argv that should exit non-zero (the forced failure).
make_stub() {
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALL_LOG"
argv="$*"
if [ -n "${FAIL_ON:-}" ] && [[ "$argv" == *"$FAIL_ON"* ]]; then
  echo "stub: forced failure on: $argv" >&2
  exit 1
fi
case "$argv" in
  # No sweep running, so the guard lets the deploy proceed.
  "ps -q -f name=haide-sweep-") ;;
  "ps --format "*) ;;
  "network ls"*) echo "haide-scrapper-default" ;;
  "image inspect"*) ;;
  "compose ps web --format json") echo '{"Health":"healthy"}' ;;
  "compose ps") ;;
  *) ;;
esac
exit 0
STUB
  chmod +x "$WORK/bin/docker"
}

run_block() {
  # $1 = FAIL_ON substring ("" for none). Returns the block's exit status and
  # leaves the call log at $WORK/calls.log.
  : > "$WORK/calls.log"
  ( cd "$WORK" \
    && PATH="$WORK/bin:$PATH" \
       CALL_LOG="$WORK/calls.log" \
       FAIL_ON="$1" \
       bash "$WORK/remote.sh" deploy-test "$WORK" >"$WORK/out.log" 2>&1 )
  echo $?
}

make_stub
echo 'POSTGRES_PASSWORD=test-password' > "$WORK/.env"

# --- 1. a failing migration must abort before `compose up -d` ----------

status=$(run_block "prisma migrate deploy")
[ "$status" != "0" ]; assert $? "a failed migration makes the remote block exit non-zero (got $status)"

if grep -qE '^docker compose up -d$' "$WORK/calls.log"; then
  echo "FAIL: 'docker compose up -d' RAN after the migration failed — new images against the old schema"
  failures=$((failures + 1))
fi
grep -q 'prisma migrate deploy' "$WORK/calls.log"
assert $? "the migration was actually attempted (the test reached the right line)"

# --- 2. the pre-migration backup runs, and before the migration --------

backup_line=$(grep -n 'compose --profile backup run --rm db-backup' "$WORK/calls.log" | head -1 | cut -d: -f1)
migrate_line=$(grep -n 'prisma migrate deploy' "$WORK/calls.log" | head -1 | cut -d: -f1)
[ -n "$backup_line" ]; assert $? "a backup is taken during the deploy"
[ -n "$backup_line" ] && [ -n "$migrate_line" ] && [ "$backup_line" -lt "$migrate_line" ]
assert $? "the backup runs BEFORE migrate deploy (backup@$backup_line, migrate@$migrate_line)"

# --- 3. a failing backup must abort too, without migrating -------------

status=$(run_block "backup run --rm db-backup")
[ "$status" != "0" ]; assert $? "a failed backup aborts the deploy (got $status)"
if grep -q 'prisma migrate deploy' "$WORK/calls.log"; then
  echo "FAIL: migrated despite the pre-migration backup failing"
  failures=$((failures + 1))
fi

# --- 4. the happy path still completes ---------------------------------

status=$(run_block "")
[ "$status" = "0" ]; assert $? "an unforced run succeeds (got $status); output: $(tail -3 "$WORK/out.log")"
grep -qE '^docker compose up -d$' "$WORK/calls.log"
assert $? "and it does start the services"

# --- 5. the sweep guard refuses, before building -----------------------

cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALL_LOG"
case "$*" in
  "ps -q -f name=haide-sweep-") echo "abc123def456" ;;
  "ps --format "*) echo "12 minutes" ;;
  *) ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/docker"

status=$(run_block "")
[ "$status" != "0" ]; assert $? "a running sweep refuses the deploy (got $status)"
if grep -q 'compose build' "$WORK/calls.log"; then
  echo "FAIL: built images before refusing — a refused deploy must cost nothing"
  failures=$((failures + 1))
fi
grep -q 'Refusing to deploy' "$WORK/out.log"
assert $? "and it says why"

# --- 6. no matching docker network: the fallback must be reachable -----

# `grep` exits 1 when it matches nothing. Under pipefail + set -e that kills the
# deploy inside the command substitution, and the `if [ -z "$NETWORK" ]`
# fallback right below never runs — a safeguard made unreachable by the very
# flag added to make the script safer. `|| true` has to be INSIDE the
# substitution for that fallback to work.
make_stub
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALL_LOG"
case "$*" in
  "ps -q -f name=haide-sweep-") ;;
  "network ls"*) echo "bridge"; echo "host" ;;   # nothing matching 'default'
  "compose ps web --format json") echo '{"Health":"healthy"}' ;;
  *) ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/docker"
echo 'POSTGRES_PASSWORD=test-password' > "$WORK/.env"

status=$(run_block "")
[ "$status" = "0" ]; assert $? "an unmatched network name falls back instead of aborting (got $status)"
grep -q 'prisma migrate deploy' "$WORK/calls.log"
assert $? "and the deploy still reaches the migration"

# --- 7. a missing POSTGRES_PASSWORD aborts before migrating ------------

make_stub
: > "$WORK/.env"
status=$(run_block "")
[ "$status" != "0" ]; assert $? "an absent POSTGRES_PASSWORD aborts the deploy (got $status)"
if grep -q 'prisma migrate deploy' "$WORK/calls.log"; then
  echo "FAIL: migrated with no password rather than refusing"
  failures=$((failures + 1))
fi
grep -q 'refusing to migrate' "$WORK/out.log"
assert $? "and says what is missing rather than 'unbound variable'"

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "$failures assertion(s) failed"
  exit 1
fi
echo "deploy-remote-block: a failed migration or backup aborts before the services start"
