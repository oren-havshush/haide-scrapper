// Run: npx tsx scripts/composeSweep.test.ts
//
// The sweep runs as its own compose service, and four properties make that safe
// to put on a timer. Each of them fails quietly if it is wrong, which is why
// they are asserted here rather than discovered at 02:00.
//
//   1. It never starts on its own. `docker compose up -d` runs on every deploy;
//      a sweep service without a profile would start a full fleet scrape in the
//      middle of one.
//   2. It has no healthcheck. It reuses the worker image, and the worker's
//      healthcheck greps for `worker/index.ts` — which a sweep process is not.
//      Inherited, it would mark every sweep container unhealthy for its whole
//      run and make `docker compose ps` useless exactly when it is being read.
//   3. Its environment IS the worker's, through a YAML anchor rather than a
//      copy. The two must agree about SWEEP_* and DATABASE_URL: the sweep
//      driver enqueues the work and the long-lived worker performs it, and a
//      drifted SWEEP_DROP_* between them means the guard the driver reports on
//      is not the guard the worker applied.
//   4. It reuses the worker's image rather than building a second one.
//
// The file is parsed, not grepped: an anchor that has been turned back into a
// copied block looks identical in the text and is exactly what this has to
// catch.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..");
const raw = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
const doc = load(raw) as {
  services: Record<string, Record<string, unknown>>;
};

const worker = doc.services?.worker;
const sweep = doc.services?.sweep;

assert(!!worker, "the worker service exists");
assert(!!sweep, "the sweep service exists");
if (!worker || !sweep) {
  console.error("\ncannot continue without both services");
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log("# 1 — it never starts on its own");
// ---------------------------------------------------------------------------
{
  const profiles = sweep.profiles as string[] | undefined;
  assert(Array.isArray(profiles) && profiles.length > 0, "sweep is behind a profile");
  assert(
    (profiles ?? []).includes("sweep"),
    `the profile is named "sweep" (got ${JSON.stringify(profiles)})`,
  );
  // The comparison that gives the claim its force: nothing else the deploy
  // starts is profiled, and the one service that is profiled is the other one
  // nobody wants running by itself.
  assert(
    worker.profiles === undefined && doc.services.web?.profiles === undefined,
    "while worker and web are not profiled — they DO start with up -d",
  );
  assert(
    Array.isArray(doc.services["db-backup"]?.profiles),
    "and db-backup is profiled the same way, which is the precedent",
  );
  assert(sweep.restart === "no", 'restart is "no" — a sweep that exits is finished, not crashed');
}

// ---------------------------------------------------------------------------
console.log("# 2 — no healthcheck");
// ---------------------------------------------------------------------------
{
  const hc = sweep.healthcheck as { disable?: boolean } | undefined;
  assert(!!hc && hc.disable === true, "the sweep service disables the healthcheck explicitly");
  // Explicitly disabled, not merely absent: the image it reuses carries the
  // worker's, and `docker compose run` would apply it.
  const workerHc = worker.healthcheck as { test?: unknown } | undefined;
  assert(!!workerHc?.test, "the worker HAS a healthcheck, which is what makes this necessary");
  assert(
    JSON.stringify(workerHc?.test ?? "").includes("worker/index.ts"),
    "and it greps for worker/index.ts, which a sweep process is not",
  );
}

// ---------------------------------------------------------------------------
console.log("# 3 — one environment block, shared by anchor");
// ---------------------------------------------------------------------------
{
  const wEnv = worker.environment as Record<string, string>;
  const sEnv = sweep.environment as Record<string, string>;
  assert(!!wEnv && !!sEnv, "both services declare an environment");

  // The anchor test. A YAML alias resolves to the SAME object; a copied block
  // parses to an equal but distinct one, and js-yaml preserves that.
  assert(
    (wEnv as unknown) === (sEnv as unknown),
    "the sweep environment is the worker's own object — a YAML anchor, not a copy",
  );
  assert(/&worker-env/.test(raw) && /\*worker-env/.test(raw), "and the anchor is spelled out");

  // What the block has to carry, whichever way it got there.
  for (const key of [
    "DATABASE_URL",
    "API_TOKEN",
    "SWEEP_ENABLED",
    "SWEEP_TZ",
    "SWEEP_FRESH_WINDOW_HOURS",
    "SWEEP_MAX_RUNTIME_MINUTES",
    "SWEEP_PER_SITE_TIMEOUT_MINUTES",
    "SWEEP_POLL_INTERVAL_MS",
    "SWEEP_POLICY_MAX_PER_NIGHT",
    "SWEEP_DROP_MIN_PREVIOUS",
    "SWEEP_DROP_KEEP_RATIO",
  ]) {
    assert(key in sEnv, `the shared environment carries ${key}`);
  }

  // The compose default overrides the one in src/lib/config.ts, so it is the
  // number that actually applies in production. 260 minutes from 02:00 stops
  // enqueueing at 06:20 — see worker/lib/sweepBudget.test.ts.
  assert(
    /SWEEP_MAX_RUNTIME_MINUTES:-260/.test(String(sEnv.SWEEP_MAX_RUNTIME_MINUTES)),
    `the compose default for the runtime cap is 260 (got ${sEnv.SWEEP_MAX_RUNTIME_MINUTES})`,
  );
}

// ---------------------------------------------------------------------------
console.log("# 4 — it reuses the worker image, and waits for the database");
// ---------------------------------------------------------------------------
{
  assert(
    typeof worker.image === "string" && (worker.image as string).length > 0,
    "the worker image is named explicitly, so another service can refer to it",
  );
  assert(
    sweep.image === worker.image,
    `sweep uses the worker's image (${String(sweep.image)} vs ${String(worker.image)})`,
  );
  assert(
    sweep.build === undefined,
    "and builds nothing of its own — a second build of the same Dockerfile is a second image to keep in step",
  );

  const dep = sweep.depends_on as Record<string, { condition?: string }> | undefined;
  assert(
    dep?.db?.condition === "service_healthy",
    "the sweep waits for a healthy database before it starts enqueueing",
  );

  // The image name is now written in two places that must agree: here, and
  // deploy.sh, which derives `${COMPOSE_PROJECT}-worker` from REMOTE_DIR and
  // uses it to tag rollback images and to run `prisma migrate deploy`. Pinning
  // it in compose only stays harmless while the two match.
  const deploy = readFileSync(join(ROOT, "deploy.sh"), "utf8");
  const remoteDir = /^REMOTE_DIR="([^"]+)"/m.exec(deploy)?.[1];
  assert(!!remoteDir, "deploy.sh declares REMOTE_DIR");
  const project = (remoteDir ?? "").split("/").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "-");
  assert(
    worker.image === `${project}-worker`,
    `the pinned image matches the name deploy.sh derives from REMOTE_DIR ` +
      `(compose "${String(worker.image)}", deploy.sh "${project}-worker")`,
  );
  assert(
    /\$\{COMPOSE_PROJECT\}-worker/.test(deploy),
    "and deploy.sh really does build that name — so this comparison is not vacuous",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\ncomposeSweep: the sweep has its own service, and it never starts itself");
