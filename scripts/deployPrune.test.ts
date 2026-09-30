// Run: npx tsx scripts/deployPrune.test.ts
//
// deploy.sh prunes old deploy images (owner, 2026-10-01): each deploy leaves
// ~2.4 GB of unique image layers, and on 2026-09-30 the box reached 89% of its
// disk. After a deploy has passed its health check, the remote block keeps the
// three most recent deploy tags per image and prunes build cache older than
// 72 hours. It runs outside the rollback branch, never names :latest or
// :previous (the rollback point), and never fails the deploy.
//
// Two halves: where the block sits in deploy.sh, and what it actually does,
// run in bash against a stub `docker` that records every rmi.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const sh = readFileSync(join(__dirname, "..", "deploy.sh"), "utf8").split("\r\n").join("\n");
const START = "# --- Prune old deploy images";
const END = "# --- end prune";
const start = sh.indexOf(START);
const end = sh.indexOf(END);
const block = start >= 0 && end > start ? sh.slice(start, end) : "";

// --- where it sits ---------------------------------------------------------------
{
  assert(block.length > 0, "deploy.sh has a prune block between its markers");
  assert(sh.split(START).length - 1 === 1, "exactly one");
  const healthy = sh.indexOf('echo "==> Web service is healthy!"');
  const rollback = sh.indexOf('echo "==> Rollback complete');
  const rollbackEnd = sh.indexOf("\nfi\n", rollback);
  const sentinel = sh.indexOf('echo "REMOTE_BLOCK_COMPLETE:$DEPLOY_TAG"');
  assert(start > healthy && healthy > 0, "after the health check");
  assert(start > rollbackEnd && rollbackEnd > rollback, "after the rollback branch has closed — never inside it");
  assert(start < sentinel, "inside the remote block, before its sentinel");
  const code = block.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert(!/latest|previous/.test(code), "the code never names latest or previous");
  assert(/tail -n \+4/.test(code), "it keeps three deploy tags per image");
  assert(/docker builder prune -f --filter until=72h/.test(code), "and prunes build cache older than 72 hours");
}

// --- what it does, against a stub docker ------------------------------------------------
function runBlock(tags: Record<string, string[]>, opts: { failImages?: boolean; failRmi?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "prune-"));
  const log = join(dir, "calls.log").split("\\").join("/");
  const listing = Object.entries(tags)
    .map(([repo, ts]) => `    ${repo}) printf '%s\\n' ${ts.map((t) => `'${t}'`).join(" ")} ;;`)
    .join("\n");
  const script = [
    "set -euo pipefail",
    "COMPOSE_PROJECT=haide-scrapper",
    "docker() {",
    `  echo "$*" >> '${log}'`,
    '  if [ "$1" = "images" ]; then',
    opts.failImages ? "    return 1" : "    :",
    '    case "$2" in',
    listing,
    "    esac",
    '  elif [ "$1" = "rmi" ]; then',
    opts.failRmi ? "    return 1" : "    :",
    "  fi",
    "}",
    block,
    'echo "AFTER_PRUNE"',
  ].join("\n");
  const file = join(dir, "run.sh");
  writeFileSync(file, script);
  const r = spawnSync("bash", [file.split("\\").join("/")], { encoding: "utf8" });
  let calls: string[] = [];
  try {
    calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  } catch {
    calls = [];
  }
  return { status: r.status, stdout: r.stdout ?? "", calls };
}

const d = (s: string) => `deploy-${s}`;
{
  const web = [d("20260917-200205-83b5d12"), d("20260930-235343-296cb96"), "latest", "previous", d("20260930-152737-c81609f"), d("20260928-125857-9c032ee"), d("20260930-221408-071fb3c")];
  const r = runBlock({ "haide-scrapper-web": web, "haide-scrapper-worker": web });
  const rmi = r.calls.filter((c) => c.startsWith("rmi"));
  const removed = rmi.flatMap((c) => c.split(" ").slice(1)).sort();
  eq(
    removed,
    [
      "haide-scrapper-web:deploy-20260917-200205-83b5d12",
      "haide-scrapper-web:deploy-20260928-125857-9c032ee",
      "haide-scrapper-worker:deploy-20260917-200205-83b5d12",
      "haide-scrapper-worker:deploy-20260928-125857-9c032ee",
    ],
    "only the deploy tags older than the three newest are removed, per image",
  );
  assert(!removed.some((t) => /latest|previous/.test(t)), "latest and previous are never removed");
  assert(r.calls.some((c) => c.startsWith("builder prune -f --filter until=72h")), "the build cache is pruned");
  assert(r.status === 0 && r.stdout.includes("AFTER_PRUNE"), "and the deploy carries on");
}
{
  const r = runBlock({ "haide-scrapper-web": [d("20260930-235343-296cb96"), "latest"], "haide-scrapper-worker": [d("20260930-235343-296cb96")] });
  eq(r.calls.filter((c) => c.startsWith("rmi")).length, 0, "three or fewer deploy tags: nothing removed");
  assert(r.status === 0 && r.stdout.includes("AFTER_PRUNE"), "and no failure under set -euo pipefail when grep matches nothing");
}
{
  const failing = runBlock({ "haide-scrapper-web": [] }, { failImages: true });
  assert(failing.status === 0 && failing.stdout.includes("AFTER_PRUNE"), "a docker images that fails never fails the deploy");
  const many = Array.from({ length: 6 }, (_, i) => d(`2026093${i}-000000-aaaaaa${i}`));
  const rmiFails = runBlock({ "haide-scrapper-web": many, "haide-scrapper-worker": many }, { failRmi: true });
  assert(rmiFails.status === 0 && rmiFails.stdout.includes("AFTER_PRUNE"), "nor does an rmi that fails");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("deployPrune: three deploy tags kept per image after a healthy deploy; latest and previous untouched; never fatal");
