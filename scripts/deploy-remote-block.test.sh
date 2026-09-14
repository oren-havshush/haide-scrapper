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
# Anchored to the `ssh` line that opens the heredoc — not merely to the marker,
# which also appears in the comment above it. Not anchored to end-of-line
# either, since that line now carries a `| tee`. The closing marker is matched
# separately by /^REMOTE$/.
awk "/^ssh .*<<'REMOTE'/{f=1;next} /^REMOTE\$/{f=0} f" "$DEPLOY_SH" > "$WORK/remote.sh"
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

# --- how does deploy.sh hand the script to the remote bash? -------------
#
# This is not a detail. `ssh host bash -s <<'REMOTE'` makes the remote bash read
# its own script FROM STDIN, and `docker compose run` attaches stdin by default —
# so the container swallows the rest of the script, bash hits EOF, and exits 0.
# The deploy then reports success having skipped the migration and the restart.
#
# That is not hypothetical: it happened on 2026-09-14, on the first deploy after
# a backup step was added mid-script. `set -euo pipefail` cannot catch it,
# because nothing fails.
#
# So the harness replicates whichever invocation deploy.sh actually uses, and
# the stub below eats stdin the way a real container does.
# Read the line that OPENS the REMOTE heredoc, so the unrelated SETUP block
# earlier in the file cannot decide this.
REMOTE_OPEN_LINE=$(grep -E "^ssh .*<<'REMOTE'" "$DEPLOY_SH" | head -1)
if [ -z "$REMOTE_OPEN_LINE" ]; then
  echo "FAIL: could not find the line opening the REMOTE heredoc in deploy.sh"
  exit 1
fi
if echo "$REMOTE_OPEN_LINE" | grep -q 'bash -s'; then
  INVOCATION="stdin"   # the unsafe shape
else
  INVOCATION="file"    # script written to a file first; stdin already at EOF
fi

# --- a docker stub that records what was called, AND consumes stdin -----
# FAIL_ON: substring of the argv that should exit non-zero (the forced failure).
make_stub() {
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALL_LOG"
argv="$*"

# `docker compose run` attaches stdin by default. Modelling that is the whole
# point of this stub: a version that ignores stdin would let the deploy script
# pass here and still truncate itself in production. Deliberately done even when
# -T is present, so the test proves the FILE-based invocation is what saves us
# rather than crediting a flag that only disables TTY allocation.
case "$argv" in
  "compose "*" run "*) cat > /dev/null 2>&1 || true ;;
esac

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
  if [ "$INVOCATION" = "stdin" ]; then
    # Reproduces `ssh host bash -s ARGS <<'REMOTE'`: the script arrives on stdin.
    ( cd "$WORK" \
      && PATH="$WORK/bin:$PATH" \
         CALL_LOG="$WORK/calls.log" \
         FAIL_ON="$1" \
         bash -s deploy-test "$WORK" <"$WORK/remote.sh" >"$WORK/out.log" 2>&1 )
  else
    # Reproduces `cat > file && bash file ARGS`: bash reads the file, stdin is EOF.
    ( cd "$WORK" \
      && PATH="$WORK/bin:$PATH" \
         CALL_LOG="$WORK/calls.log" \
         FAIL_ON="$1" \
         bash "$WORK/remote.sh" deploy-test "$WORK" >"$WORK/out.log" 2>&1 </dev/null )
  fi
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

# Matched on `db-backup`, not the full argv: flags like -T get added and this
# assertion is about ordering, not about how the container is invoked.
backup_line=$(grep -n 'db-backup' "$WORK/calls.log" | head -1 | cut -d: -f1)
migrate_line=$(grep -n 'prisma migrate deploy' "$WORK/calls.log" | head -1 | cut -d: -f1)
[ -n "$backup_line" ]; assert $? "a backup is taken during the deploy"
[ -n "$backup_line" ] && [ -n "$migrate_line" ] && [ "$backup_line" -lt "$migrate_line" ]
assert $? "the backup runs BEFORE migrate deploy (backup@$backup_line, migrate@$migrate_line)"

# --- 3. a failing backup must abort too, without migrating -------------

status=$(run_block "db-backup")
[ "$status" != "0" ]; assert $? "a failed backup aborts the deploy (got $status)"
if grep -q 'prisma migrate deploy' "$WORK/calls.log"; then
  echo "FAIL: migrated despite the pre-migration backup failing"
  failures=$((failures + 1))
fi

# --- 4. the happy path completes, AND reaches its last line -------------

status=$(run_block "")
[ "$status" = "0" ]; assert $? "an unforced run succeeds (got $status); output: $(tail -3 "$WORK/out.log")"
grep -qE '^docker compose up -d$' "$WORK/calls.log"
assert $? "and it does start the services"

# The assertion that would have caught 2026-09-14. Exit status 0 is not evidence
# the script finished — a truncated script exits 0 too. Only the sentinel proves
# the last line ran.
grep -q 'REMOTE_BLOCK_COMPLETE' "$WORK/out.log"
assert $? \
  "the block reached its final line (sentinel present) — a container that eats stdin \
truncates the script and still exits 0; output tail: $(tail -2 "$WORK/out.log")"

grep -q 'prisma migrate deploy' "$WORK/calls.log"
assert $? "the happy path actually migrated"

# The script must not be handed to bash on stdin, or any container command added
# later can swallow whatever follows it.
assert \
  "$([ "$INVOCATION" = "file" ] && echo 0 || echo 1)" \
  "deploy.sh runs the remote script from a FILE, not from stdin (detected: $INVOCATION)"

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

# --- 8. the LOCAL half checks the sentinel -----------------------------
#
# The remote sentinel is only half the fix. If the local script does not verify
# it, a truncated deploy still ends with "Deployment complete" — which is the
# line that made 2026-09-14 look like a success. These assertions cover the part
# of deploy.sh that lives outside the heredoc, which run_block cannot reach.

# The sentinel must be the last command in the block, or it proves less than it
# claims: anything after it could be skipped and still leave it in the output.
last_cmd=$(grep -vE '^\s*(#|$)' "$WORK/remote.sh" | tail -1)
echo "$last_cmd" | grep -q 'REMOTE_BLOCK_COMPLETE'
assert $? "the sentinel echo is the final command of the remote block (last line: $last_cmd)"

local_half=$(awk "/^REMOTE\$/{f=1} f" "$DEPLOY_SH")
echo "$local_half" | grep -q 'grep -q "REMOTE_BLOCK_COMPLETE'
assert $? "deploy.sh checks for the sentinel locally after the remote block"
echo "$local_half" | grep -q 'exit 1'
assert $? "and exits non-zero when it is absent"

# The success line must come after the check, not before it.
check_at=$(echo "$local_half" | grep -n 'REMOTE_BLOCK_COMPLETE' | head -1 | cut -d: -f1)
done_at=$(echo "$local_half" | grep -n 'Deployment complete' | head -1 | cut -d: -f1)
[ -n "$check_at" ] && [ -n "$done_at" ] && [ "$check_at" -lt "$done_at" ]
assert $? "\"Deployment complete\" is printed only after the sentinel check (check@$check_at, print@$done_at)"

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "$failures assertion(s) failed"
  exit 1
fi
echo "deploy-remote-block: a failed migration or backup aborts before the services start"
