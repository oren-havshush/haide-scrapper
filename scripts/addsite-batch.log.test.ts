// Run: npx tsx scripts/addsite-batch.log.test.ts
//
// addsite-batch.ts log refused --outcome REVIEW and REQUEUE (owner,
// 2026-10-09), so a site that ended in either state could not be logged. Both
// are accepted now, and the summary counts each on its own line; neither is a
// scraped ACTIVE, a SKIPPED or an error. Run as the operator runs it, in child
// processes, against a temporary batch directory; with no --site-id nothing
// reaches the API.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = resolve(__dirname, "..");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const BATCH = join(ROOT, "scripts", "addsite-batch.ts");
const run = (args: string[]) => spawnSync(process.execPath, [TSX, BATCH, ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });

const dir = mkdtempSync(join(tmpdir(), "batch-log-"));
try {
  const logs: Array<[string, string]> = [
    ["https://a.test/jobs", "ACTIVE"],
    ["https://b.test/jobs", "REVIEW"],
    ["https://c.test/jobs", "REQUEUE"],
    ["https://d.test/jobs", "REVIEW"],
    ["https://e.test/jobs", "SKIPPED"],
  ];
  for (const [url, outcome] of logs) {
    const r = run(["log", "--batch-dir", dir, "--url", url, "--outcome", outcome, "--reason", `why ${outcome}`]);
    assert(r.status === 0, `log --outcome ${outcome} is accepted (exit ${r.status}; ${(r.stderr ?? "").trim().slice(-200)})`);
  }
  const bad = run(["log", "--batch-dir", dir, "--url", "https://f.test", "--outcome", "MAYBE", "--reason", "x"]);
  assert(bad.status !== 0 && /--outcome must be one of: .*REVIEW.*REQUEUE|--outcome must be one of: .*REQUEUE.*REVIEW/.test(bad.stderr ?? ""), `an unknown outcome is still refused, and the list names REVIEW and REQUEUE (${(bad.stderr ?? "").trim().slice(-200)})`);

  const lines = existsSync(join(dir, "batch-results.jsonl")) ? readFileSync(join(dir, "batch-results.jsonl"), "utf8").split("\n").filter(Boolean) : [];
  assert(lines.length === 5, `five rows logged (${lines.length})`);

  const s = run(["summary", "--batch-dir", dir]);
  const out = s.stdout ?? "";
  assert(s.status === 0, `summary exits 0 (${s.status})`);
  assert(/^\s+REVIEW\s+2$/m.test(out), `the summary counts REVIEW on its own line\n${out.slice(0, 600)}`);
  assert(/^\s+REQUEUE\s+1$/m.test(out), "and REQUEUE on its own line");
  assert(/^\s+ACTIVE\s+1$/m.test(out) && /^\s+SKIPPED\s+1$/m.test(out), "ACTIVE and SKIPPED keep their own counts");
  assert(/API scrapes triggered:\s+1$/m.test(out), "only the ACTIVE row counts as a scrape triggered");
  assert(/Batch complete — 5 URLs processed/.test(out), "every row is processed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("addsite-batch log: all assertions passed");
