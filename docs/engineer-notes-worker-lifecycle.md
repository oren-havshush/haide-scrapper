# Engineer notes — worker container lifecycle

> Status: **observed behaviour, verified on production 2026-09-14.** No design
> change follows from it; this exists so the next person does not rediscover it
> during an incident.

## A wedged or hand-killed worker is not self-healing

`docker kill` and `docker stop` suppress `restart: unless-stopped` until an
explicit `docker start`, and the compose healthcheck never restarts anything, so
a wedged or hand-killed worker is not self-healing. That is what the sweep's
"worker not draining" pre-flight is for.

## How it was observed

During verification #9 (killing the worker mid-scrape to prove boot recovery no
longer deletes listings), the container was stopped with:

```bash
docker kill -s KILL haide-scrapper-worker-1
```

It did not come back:

```
haide-scrapper-worker-1 | Exited (137) 2 minutes ago | exited
restart policy: unless-stopped   exit=137   oom=false
```

Docker records an explicit `kill`/`stop` as a *manual* stop and ignores the
restart policy until the container is started again by hand. `docker start` was
required, and that is what ran boot recovery.

## What this does and does not mean

- **A genuine crash or OOM is still auto-restarted.** The daemon only suppresses
  the policy for operator-initiated stops, so the boot-recovery design — which
  assumes the worker comes back after an unplanned death — is unaffected.
- **The healthcheck is not a restarter.** `docker-compose.yml` healthchecks mark
  a container unhealthy; nothing acts on that. An unhealthy-but-running worker
  stays running and stays wedged.
- **So there are two ways the queue silently stops draining:** a hand-stopped
  container that nobody restarted, and a live container that is stuck. Neither
  raises anything on its own.

Detecting that is the sweep pre-flight's job, not the container runtime's.

## `prisma migrate dev` will offer to drop the partial unique index

`worker_job_one_active_per_site_type` (one active `WorkerJob` per site and type)
is **not in `schema.prisma`** — Prisma cannot express a partial index — so it
exists only in the migration SQL. `prisma migrate dev` compares the database
against the schema, sees an index the schema does not describe, and proposes
dropping it.

Nobody runs `migrate dev` against production (`deploy.sh` runs `migrate deploy`,
which only applies migration files). But the next person to run it **locally**
must refuse that drop, and must not commit a generated migration containing it.
The same applies to any future partial index.

## `prisma migrate deploy` swallows `RAISE NOTICE`

A migration's `RAISE NOTICE` output does not appear in `./deploy.sh` output —
`migrate deploy` prints which migrations it applied, not what the server said
while applying them. So `20260914000000_add_sweep_models_and_scraperun_link`'s
`sweep migration: superseded N duplicate active WorkerJob row(s)` was never
visible at deploy time, and no future migration should rely on a NOTICE to
report anything that matters.

To see what that dedupe did, ask the table (on the box):

```sql
SELECT count(*) FROM "WorkerJob"
WHERE error = 'superseded: a newer active job exists for this site and type';
```

A migration that needs to fail loudly must `RAISE EXCEPTION`, which aborts the
migration and does reach the deploy output.

## Operational note

After any deliberate `docker kill`/`docker stop` of the worker — debugging, a
wedged scrape, verification work — **start it again explicitly**:

```bash
docker start haide-scrapper-worker-1
```

`./deploy.sh` recreates the container, so a deploy also clears this state.
