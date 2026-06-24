#!/bin/bash
# Run the policy backfill by spawning a one-off worker container with the scripts/ dir mounted.
export PATH=/c/Users/shayo/msys2/usr/bin:$PATH
ssh root@194.88.110.149 "cd /opt/haide-scrapper && docker compose run --rm -T --no-deps -v /opt/haide-scrapper/scripts:/app/scripts worker npx tsx scripts/backfill-policy-review.ts $*"
