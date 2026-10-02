// Run: npx tsx scripts/systemdUnits.test.ts
//
// The unit files decide what happens on a box nobody is watching, and every
// mistake in them is discovered at 02:00 by its consequences.
//
// Four of them are worth asserting rather than re-reading:
//
//   1. The timers fire in Asia/Jerusalem, at hours chosen against the 07:01
//      public read — not at whatever the host clock calls 02:00.
//   2. `Persistent=true` is absent. A missed night must NOT be caught up on
//      boot: that starts a four-hour fleet scrape in the middle of a working
//      day and lands its writes after the public site has already read.
//   3. TimeoutStartSec is above what the sweep can take. Under it, systemd
//      SIGKILLs the container mid-scrape — potentially between a delete and its
//      inserts, which is the one thing the whole scheduled path exists to
//      prevent.
//   4. Container naming lines up with deploy.sh's guard, and ExecStopPost
//      removes the container. Without the removal one timed-out night leaves a
//      container holding the name and every following night fails to start.
//
// And the rule over all of them: deploy.sh INSTALLS these and never ENABLES
// them. Installing a file changes nothing; enabling is a decision.

import { readFileSync, readdirSync } from "node:fs";
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
const UNIT_DIR = join(ROOT, "deploy", "systemd");
const read = (name: string) => readFileSync(join(UNIT_DIR, name), "utf8");

/** One key's value from a unit file. systemd keys are Key=Value, one per line. */
function value(unit: string, key: string): string | null {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(unit);
  return m ? m[1]!.trim() : null;
}

const files = readdirSync(UNIT_DIR);
// Six since step 3 (option B): the guarded-run claim timer and its service.
assert(files.length === 6, `six unit files (got ${files.length}: ${files.join(", ")})`);

const scrapeSvc = read("haide-sweep-scrape.service");
const scrapeTimer = read("haide-sweep-scrape.timer");
const policySvc = read("haide-sweep-policy.service");
const policyTimer = read("haide-sweep-policy.timer");

// ---------------------------------------------------------------------------
console.log("# 1 — the hours, in the right timezone");
// ---------------------------------------------------------------------------
{
  // The timezone belongs INSIDE the calendar expression, and this assertion is
  // written the way it is because the first version of it was worthless.
  //
  // It asserted `Timezone=Asia/Jerusalem` in [Timer]. There is no such key.
  // systemd parses the file, logs "Unknown key name 'Timezone' in section
  // 'Timer', ignoring", and runs on the HOST clock — which on this box is
  // Etc/UTC. The sweep would have started at 02:00 UTC = 05:00 Jerusalem and
  // its 260-minute enqueue budget would have run to 09:20 local, two hours past
  // the 07:01 public read the budget exists to stay clear of. The test was
  // green the whole time, because a key systemd ignores is still a key a regex
  // can find.
  //
  // `systemd-analyze verify` on the box found it. So the assertion now checks
  // the form systemd actually honours, and forbids the one it does not.
  assert(
    value(scrapeTimer, "OnCalendar") === "*-*-* 02:00:00 Asia/Jerusalem",
    `the scrape sweep is at 02:00 Jerusalem (got ${JSON.stringify(value(scrapeTimer, "OnCalendar"))})`,
  );
  assert(
    value(policyTimer, "OnCalendar") === "*-*-* 06:00:00 Asia/Jerusalem",
    `the policy sweep is at 06:00 Jerusalem (got ${JSON.stringify(value(policyTimer, "OnCalendar"))})`,
  );
  for (const [name, t] of [["scrape", scrapeTimer], ["policy", policyTimer]] as const) {
    assert(
      value(t, "Timezone") === null,
      `${name}: no Timezone= key — systemd ignores it and would use the host clock`,
    );
    assert(
      /^OnCalendar=.*\s[A-Za-z]+\/[A-Za-z_]+$/m.test(t),
      `${name}: the calendar expression carries the timezone itself`,
    );
    assert(
      /\[Install\][\s\S]*WantedBy=timers\.target/.test(t),
      `${name}: the timer installs into timers.target`,
    );
  }

  // 02:00 is not arbitrary. It is chosen against the enqueue cap and the 07:01
  // public read, and sweepBudget.test.ts asserts the other end of the same sum
  // — so moving one without the other fails there.
  const cap = 260; // SWEEP_MAX_RUNTIME_MINUTES, src/lib/config.ts and compose
  const perSite = 18; // SWEEP_PER_SITE_TIMEOUT_MINUTES
  assert(2 * 60 + cap + perSite < 7 * 60, "02:00 + the cap + one site's budget lands before 07:00");
}

// ---------------------------------------------------------------------------
console.log("# 2 — no catch-up on boot");
// ---------------------------------------------------------------------------
{
  for (const [name, t] of [["scrape", scrapeTimer], ["policy", policyTimer]] as const) {
    assert(
      value(t, "Persistent") !== "true",
      `${name}: Persistent is not true — a missed night is not caught up at 11:00`,
    );
    // Said explicitly rather than merely absent, so the next person sees it was
    // decided.
    assert(value(t, "Persistent") === "false", `${name}: and says so rather than leaving it out`);
  }
}

// ---------------------------------------------------------------------------
console.log("# 3 — systemd never kills a sweep mid-write");
// ---------------------------------------------------------------------------
{
  const toMinutes = (v: string | null): number | null => {
    if (!v) return null;
    const m = /^(\d+)\s*(min|m|h|s|sec)?$/.exec(v);
    if (!m) return null;
    const n = Number(m[1]);
    return m[2] === "h" ? n * 60 : m[2] === "s" || m[2] === "sec" ? n / 60 : n;
  };

  const scrapeTimeout = toMinutes(value(scrapeSvc, "TimeoutStartSec"));
  assert(scrapeTimeout !== null, `the scrape service sets TimeoutStartSec (${value(scrapeSvc, "TimeoutStartSec")})`);
  // The worst case the sweep itself allows: enqueueing until the cap, then the
  // last site's own budget, then the report.
  const worstCase = 260 + 18;
  assert(
    (scrapeTimeout ?? 0) > worstCase,
    `and it is above the sweep's own worst case (${scrapeTimeout}min vs ${worstCase}min)`,
  );
  // But not so long that a wedged sweep is still holding the box at lunchtime.
  assert((scrapeTimeout ?? 0) <= 360, `and not unbounded in practice (${scrapeTimeout}min)`);

  const policyTimeout = toMinutes(value(policySvc, "TimeoutStartSec"));
  assert((policyTimeout ?? 0) >= 60, `the policy service has a real budget too (${policyTimeout}min)`);

  for (const [name, s] of [["scrape", scrapeSvc], ["policy", policySvc]] as const) {
    assert(value(s, "Type") === "oneshot", `${name}: Type=oneshot — it is a job, not a daemon`);
    assert(
      value(s, "WorkingDirectory") === "@REMOTE_DIR@",
      `${name}: WorkingDirectory is templated, not hardcoded`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log("# 4 — the container names, and cleaning them up");
// ---------------------------------------------------------------------------
{
  const deploy = readFileSync(join(ROOT, "deploy.sh"), "utf8");
  // deploy.sh refuses to deploy while any container with this prefix runs.
  const guard = /docker ps -q -f name=([a-z-]+)/.exec(deploy)?.[1];
  assert(guard === "haide-sweep-", `deploy.sh guards on the haide-sweep- prefix (got ${guard})`);

  for (const [name, s] of [
    ["scrape", scrapeSvc],
    ["policy", policySvc],
  ] as const) {
    const exec = value(s, "ExecStart") ?? "";
    const container = `haide-sweep-${name}`;
    assert(exec.includes(`--name ${container}`), `${name}: the container is named ${container}`);
    assert(
      container.startsWith(guard ?? String.fromCharCode(0)),
      `${name}: which is what deploy.sh's guard looks for`,
    );
    assert(
      !exec.includes("--rm"),
      `${name}: --rm is not used — ExecStopPost owns the cleanup, so a killed run is still inspectable`,
    );
    const post = value(s, "ExecStopPost") ?? "";
    assert(
      post.includes(`docker rm -f ${container}`),
      `${name}: ExecStopPost removes the container (${post})`,
    );
    assert(
      post.startsWith("-"),
      `${name}: and is prefixed '-', so a container that is already gone does not fail the unit`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log("# the ExecStart actually runs the sweep, through the sweep service");
// ---------------------------------------------------------------------------
{
  const compose = load(readFileSync(join(ROOT, "docker-compose.yml"), "utf8")) as {
    services: Record<string, Record<string, unknown>>;
  };
  assert(!!compose.services.sweep, "the compose service the units name exists");

  for (const [name, s, script] of [
    ["scrape", scrapeSvc, "worker/sweep/nightly.ts"],
    ["policy", policySvc, "worker/sweep/policy.ts"],
  ] as const) {
    // ExecStart continues onto the next line with a trailing backslash, so the
    // whole command is the key's value plus what follows it.
    const raw = new RegExp(`^ExecStart=([\\s\\S]*?)(?=\\n[A-Za-z#\\[]|\\n\\n)`, "m").exec(s)?.[1] ?? "";
    const cmd = raw.replace(/\\\n\s*/g, " ").replace(/\s+/g, " ").trim();
    assert(cmd.includes("docker compose run"), `${name}: runs through compose`);
    assert(/\bsweep\b/.test(cmd), `${name}: names the sweep service`);
    assert(cmd.includes("-T"), `${name}: -T — there is no TTY on a timer`);
    assert(cmd.includes(script), `${name}: runs ${script}`);
    assert(cmd.includes("--now"), `${name}: with --now, not --dry-run`);
    assert(!cmd.includes("--dry-run"), `${name}: and definitely not both`);
    // Recorded on the sweep row and printed on the report's trigger line; a
    // timer night must not read "manual" (night one did).
    // Plain includes, not a regex: a \b written through a shell here once
    // landed in this file as a raw backspace, and the check matched nothing.
    assert(` ${cmd} `.includes(" --trigger timer "), `${name}: passes --trigger timer`);

    // The command REPLACES the image's CMD, which is ./worker/entrypoint.sh —
    // and that script runs `prisma migrate deploy` and then execs the
    // long-lived worker. A sweep that inherited it would migrate the database
    // and start a second worker instead of sweeping.
    assert(!cmd.includes("entrypoint.sh"), `${name}: does not go through the worker entrypoint`);
  }

  const dockerfile = readFileSync(join(ROOT, "Dockerfile.worker"), "utf8");
  assert(
    !/^ENTRYPOINT/m.test(dockerfile),
    "the worker image sets no ENTRYPOINT, so `compose run <svc> <cmd>` really does replace the command",
  );
  assert(
    /CMD \["\.\/worker\/entrypoint\.sh"\]/.test(dockerfile),
    "it sets CMD, which is the thing being replaced — this is why the above matters",
  );
  const entrypoint = readFileSync(join(ROOT, "worker", "entrypoint.sh"), "utf8");
  assert(
    /prisma migrate deploy/.test(entrypoint) && /worker\/index\.ts/.test(entrypoint),
    "and the entrypoint migrates and starts the worker — neither of which a sweep should do",
  );
}

// ---------------------------------------------------------------------------
console.log("# deploy.sh installs them and never enables them");
// ---------------------------------------------------------------------------
{
  const deploy = readFileSync(join(ROOT, "deploy.sh"), "utf8");
  assert(/deploy\/systemd/.test(deploy), "deploy.sh installs from deploy/systemd");
  assert(
    /sed "s\|@REMOTE_DIR@\|\$REMOTE_DIR\|g"/.test(deploy),
    "and substitutes @REMOTE_DIR@ from its own REMOTE_DIR",
  );
  assert(/systemctl daemon-reload/.test(deploy), "and reloads the daemon");

  // The rule. `systemctl is-enabled` reads state; `enable`, `disable` and
  // `start` change it, and none of them belongs in a deploy.
  //
  // Comments are stripped first: the block's own prose explains why it does not
  // enable anything, and a check that could not tell the explanation from the
  // act would fail on the comment that exists to prevent the act.
  const code = deploy
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert(code.length > 2000 && code.length < deploy.length, "deploy.sh code was extracted");
  for (const verb of ["enable", "disable", "start", "restart"]) {
    const re = new RegExp(`systemctl\\s+(--\\S+\\s+)*${verb}\\b`);
    assert(!re.test(code), `deploy.sh never runs systemctl ${verb}`);
  }
  assert(
    /systemctl is-enabled/.test(deploy),
    "it only READS the state — and prints it, so the deploy log answers 'are the timers on?'",
  );
  assert(
    /command -v systemctl/.test(deploy),
    "and skips the whole block where there is no systemctl, rather than failing the deploy",
  );
}

// ---------------------------------------------------------------------------
console.log("# the guarded-run claim timer (step 3, option B)");
// ---------------------------------------------------------------------------
// Every two minutes, claim one pending GuardedRunRequest and run the existing
// single-site driver. An idle tick must cost no container: the unit's script
// asks the database for a pending row first, and starts the sweep container
// only when one exists (review build note, 2026-09-30).
{
  let claimSvc = "";
  let claimTimer = "";
  let script = "";
  try {
    claimSvc = read("haide-sweep-claim.service");
    claimTimer = read("haide-sweep-claim.timer");
    script = readFileSync(join(ROOT, "deploy", "claim-guarded-run.sh"), "utf8");
  } catch {
    // red until the files exist
  }
  assert(claimSvc.length > 0 && claimTimer.length > 0, "the claim service and timer exist");
  assert(value(claimTimer, "OnCalendar") === "*:0/2", `the timer fires every two minutes (${value(claimTimer, "OnCalendar")})`);
  assert(value(claimTimer, "Persistent") === "false", "and does not catch up on boot");
  assert(value(claimSvc, "Type") === "oneshot", "the service is a oneshot");
  assert(value(claimSvc, "WorkingDirectory") === "@REMOTE_DIR@", "with a templated WorkingDirectory");
  assert(
    (value(claimSvc, "ExecStart") ?? "").includes("@REMOTE_DIR@/deploy/claim-guarded-run.sh"),
    "it runs deploy/claim-guarded-run.sh",
  );
  const timeout = /^(\d+)min$/.exec(value(claimSvc, "TimeoutStartSec") ?? "")?.[1];
  assert(Number(timeout) >= 25 && Number(timeout) <= 60, `TimeoutStartSec covers one site's 18-minute budget (${timeout}min)`);
  const post = value(claimSvc, "ExecStopPost") ?? "";
  assert(post.startsWith("-") && post.includes("docker rm -f haide-sweep-claim"), "ExecStopPost removes the claim container");

  // The script, comments stripped: the pending check comes before any container.
  const code = script
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const pendingCheck = code.indexOf(`status = 'PENDING'`);
  const busyCheck = code.indexOf("docker ps -q -f name=haide-sweep-");
  const run = code.indexOf("docker compose run");
  assert(pendingCheck > 0, "the script counts PENDING GuardedRunRequest rows");
  assert(busyCheck > 0, "and checks for a running haide-sweep- container");
  assert(run > 0, "and only then runs the sweep container");
  assert(pendingCheck < run && busyCheck < run, "both checks come before any docker compose run");
  assert(/exit 0/.test(code.slice(0, run)), "and an idle tick exits 0 before reaching it");
  const runLine = code.slice(run).split("\n")[0] ?? "";
  for (const part of ["--name haide-sweep-claim", "-T", "sweep", "worker/sweep/nightly.ts", "--claim-request"]) {
    assert(runLine.includes(part), `the run line has ${part}`);
  }
  assert(!runLine.includes("--rm"), "no --rm: ExecStopPost owns the cleanup");
  assert(!runLine.includes("--now") && !runLine.includes("--site"), "it claims; it does not start a fleet or a named site itself");

  const deploy = readFileSync(join(ROOT, "deploy.sh"), "utf8");
  assert(
    /for t in haide-sweep-scrape\.timer haide-sweep-policy\.timer haide-sweep-claim\.timer; do/.test(deploy),
    "deploy.sh prints the claim timer's is-enabled line with the other two",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nsystemdUnits: installed, never enabled — and nothing is killed mid-write");
