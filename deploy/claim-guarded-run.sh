#!/bin/sh
# Claim one API-requested guarded run (addsite2 phase two, step 3, option B).
#
# Run every two minutes by haide-sweep-claim.service. An idle tick must cost no
# container: ask the database for a PENDING GuardedRunRequest first, and check
# no sweep container is running, and only then start the sweep container. The
# claim itself (worker/sweep/nightly.ts --claim-request) re-checks the quiet
# window and running sweeps before it takes a row.
set -eu

pending=$(docker compose exec -T db psql -U postgres -d scrapnew -Atc \
  "SELECT count(*) FROM \"GuardedRunRequest\" WHERE status = 'PENDING'" 2>/dev/null || echo 0)
case "$pending" in
  ''|*[!0-9]*) pending=0 ;;
esac
if [ "$pending" -eq 0 ]; then
  exit 0
fi

# The nightly, the policy sweep, a hand-started --site run or an earlier claim:
# any haide-sweep- container means not now. The row waits for the next tick.
if [ -n "$(docker ps -q -f name=haide-sweep-)" ]; then
  echo "pending request(s): $pending; a sweep container is running, waiting"
  exit 0
fi

echo "pending request(s): $pending; claiming one"
exec docker compose run --name haide-sweep-claim -T sweep node_modules/.bin/tsx worker/sweep/nightly.ts --claim-request --trigger request
