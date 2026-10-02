// Run: npx tsx worker/lib/nightlyArgs.test.ts
//
// The driver's command line, and which detail mode each invocation runs in.
// The defaults are the policy: the timer's `--now` is incremental except on
// the Saturday run; `--site --now` is the verification step after a config
// change, so it is full unless told otherwise.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNightlyArgs, parseTriggerLabel, resolveDetailMode, type NightlyMode } from "./nightlyArgs";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const SAT = new Date("2026-09-25T23:00:00Z"); // Sat 26 Sep 02:00 IDT
const WED = new Date("2026-09-29T23:00:00Z"); // Wed 30 Sep 02:00 IDT

const p = (s: string) => parseNightlyArgs(s.split(" ").filter(Boolean));
const same = (a: NightlyMode, b: NightlyMode) => JSON.stringify(a) === JSON.stringify(b);

// --- the existing forms, unchanged -------------------------------------------
assert(same(p("--dry-run"), { kind: "dry-run" }), "--dry-run");
assert(same(p("--now"), { kind: "fleet", detailOverride: null }), "--now is the fleet");
assert(same(p("--site abc --now"), { kind: "single", siteId: "abc", detailOverride: null, email: false }), "--site abc --now");

// Owner, 2026-10-01: a single-site run no longer emails unless asked.
assert(
  same(p("--site abc --now --email"), { kind: "single", siteId: "abc", detailOverride: null, email: true }),
  "--email asks a single-site run to send its report",
);
assert(throws(() => p("--now --email")), "--email on the fleet is refused — the timer's runs always email");
assert(throws(() => p("--site abc --dry-run-details --email")), "and on a rehearsal, which sends nothing");
assert(throws(() => p("--site abc")), "--site without --now still refuses — it runs the scheduled path for real");
assert(throws(() => p("")), "no arguments refuses");

// --- the detail flags ----------------------------------------------------------
assert(
  same(p("--now --full-details"), { kind: "fleet", detailOverride: "full" }),
  "--full-details forces a full fleet night",
);
assert(
  same(p("--site abc --now --incremental-details"), { kind: "single", siteId: "abc", detailOverride: "incremental", email: false }),
  "--incremental-details on one site",
);
assert(throws(() => p("--now --full-details --incremental-details")), "both flags at once is refused, not guessed");
assert(throws(() => p("--dry-run --full-details")), "the fleet dry run has no detail phase to force");

// --- the read-only detail rehearsal ----------------------------------------
assert(
  same(p("--site abc --dry-run-details"), { kind: "dry-run-details", siteId: "abc", detailOverride: null }),
  "--site abc --dry-run-details",
);
assert(
  same(p("--site abc --dry-run-details --full-details"), { kind: "dry-run-details", siteId: "abc", detailOverride: "full" }),
  "it takes an override too",
);
assert(throws(() => p("--dry-run-details")), "--dry-run-details needs a site");
assert(throws(() => p("--site abc --now --dry-run-details")), "and never together with --now");
assert(throws(() => p("--site --now")), "a --site with no id is refused");

// --- the one-off mail test ------------------------------------------------------
assert(same(p("--test-email"), { kind: "test-email" }), "--test-email sends the latest stored report and exits");
assert(throws(() => p("--test-email --now")), "it never runs a sweep");
assert(throws(() => p("--test-email --site abc")), "and takes no site");
assert(throws(() => p("--test-email --dry-run")), "and is not combined with a dry run");

// --- the trigger label ---------------------------------------------------------
// Night one's timer run was recorded as "manual": the drivers hard-coded it.
assert(parseTriggerLabel(["--now"]) === "manual", "absent is manual — a human at a shell");
assert(parseTriggerLabel(["--now", "--trigger", "timer"]) === "timer", "the timer units pass --trigger timer");
assert(parseTriggerLabel(["--trigger", "timer", "--now"]) === "timer", "anywhere on the line");
assert(throws(() => parseTriggerLabel(["--now", "--trigger"])), "--trigger with no label is refused");
assert(throws(() => parseTriggerLabel(["--now", "--trigger", "--site"])), "a flag is not a label");
assert(throws(() => parseTriggerLabel(["--now", "--trigger", "Timer Night!"])), "labels are a-z0-9_- only");
assert(same(p("--now --trigger timer"), { kind: "fleet", detailOverride: null }), "and the mode parse ignores it");
{
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const nightly = strip(readFileSync(join(__dirname, "..", "sweep", "nightly.ts"), "utf8"));
  const policy = strip(readFileSync(join(__dirname, "..", "sweep", "policy.ts"), "utf8"));
  for (const [name, src] of [["nightly.ts", nightly], ["policy.ts", policy]] as const) {
    assert(src.includes("parseTriggerLabel("), `${name} reads --trigger`);
    assert(!/trigger:\s*"manual"/.test(src), `${name} no longer hard-codes trigger "manual"`);
  }
}

// --- which mode ----------------------------------------------------------------
const mode = (s: string, at: Date) => resolveDetailMode(p(s), at);
assert(mode("--now", WED) === "incremental", "a weekday fleet night is incremental");
assert(mode("--now", SAT) === "full", "the Saturday fleet night is full");
assert(mode("--now --full-details", WED) === "full", "unless forced");
assert(mode("--now --incremental-details", SAT) === "incremental", "either way");
assert(mode("--site abc --now", WED) === "full", "--site defaults to full: it is the check after a config change");
assert(mode("--site abc --now --incremental-details", WED) === "incremental", "and can be asked for incremental");
assert(mode("--site abc --dry-run-details", WED) === "incremental", "the rehearsal shows the night's own mode by default");
assert(mode("--site abc --dry-run-details", SAT) === "full", "which on a Saturday is full");

// --- --claim-request (step 3, option B): the claim timer's mode ------------------------
{
  let parsed: unknown = null;
  try {
    parsed = p("--claim-request");
  } catch {
    parsed = null;
  }
  assert(JSON.stringify(parsed) === JSON.stringify({ kind: "claim-request" }), `--claim-request alone parses (${JSON.stringify(parsed)})`);
  assert(throws(() => p("--claim-request --now")), "it is not combined with --now: the request names the site");
  assert(throws(() => p("--claim-request --site abc --now")), "nor with --site");
  assert(throws(() => p("--claim-request --email")), "nor with --email: a requested run never emails");
  assert(throws(() => p("--claim-request --full-details")), "nor with a detail override: a single-site run is always full");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("nightlyArgs: incremental on weekday nights, full on Saturday and on --site");
