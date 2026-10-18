// Run: npx tsx scripts/workdaySkeleton.test.ts
//
// The Workday skeleton matched no jobs on a current board (developer's report
// 2026-10-18, item 6: flextronics) and called for a browser override the board
// did not need. The skeleton fingerprint emits for a Workday host now selects
// each job by its jobTitle link, takes the location from the subtitle or the
// "locations" automation id, leads with the jobs API, and has no
// browserOverrides. Checked as the onboarder sees it: `fingerprint --url` on a
// Workday host, in a child process (the host match returns before any browser
// or network), which reads scripts/site-patterns.json first; and in
// BUILT_IN_SKELETONS, which it falls back to.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const run = spawnSync(process.execPath, [TSX, join(ROOT, "scripts", "addsite-batch.ts"), "fingerprint", "--url", "https://flextronics.wd1.myworkdayjobs.com/he-IL/Careers"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 60_000,
});
assert(run.status === 0, `fingerprint exits 0 (got ${run.status}: ${run.stderr?.slice(0, 300)})`);
let fp: { vendor?: string; skeleton?: { itemSelector?: string; fieldMappings?: Record<string, { selector?: string }>; browserOverrides?: unknown; notes?: string } } = {};
try {
  fp = JSON.parse(run.stdout);
} catch {
  assert(false, `fingerprint prints JSON (got ${run.stdout.slice(0, 200)})`);
}
const sk = fp.skeleton ?? {};
assert(fp.vendor === "workday", "the host is Workday's");
assert(!("browserOverrides" in sk), `the skeleton has no browserOverrides key (got ${JSON.stringify(sk.browserOverrides)})`);
assert(/jobTitle/.test(sk.fieldMappings?.title?.selector ?? ""), `its title selector names jobTitle (got ${sk.fieldMappings?.title?.selector})`);
assert(/jobTitle/.test(sk.itemSelector ?? "") && !/jobItem/.test(sk.itemSelector ?? ""), `its item is the li holding a jobTitle link (got ${sk.itemSelector})`);
assert(/locations/.test(sk.fieldMappings?.location?.selector ?? "") && /subtitle/.test(sk.fieldMappings?.location?.selector ?? ""), "location from the locations automation id or the subtitle");
assert(/^First choice: Workday's jobs API, POST \/wday\/cxs\/<tenant>\/<site>\/jobs/.test(sk.notes ?? ""), "the notes lead with the jobs API");
assert(/browserOverrides only if blocked/.test(sk.notes ?? ""), "and say browserOverrides only if blocked");

// The built-in skeleton it falls back to says the same.
const src = readFileSync(join(ROOT, "scripts", "addsite-batch.ts"), "utf8");
const start = src.indexOf("  workday: {", src.indexOf("const BUILT_IN_SKELETONS"));
const block = src.slice(start, src.indexOf("\n  },", start));
assert(start !== -1 && !/browserOverrides:/.test(block), "BUILT_IN_SKELETONS.workday has no browserOverrides");
assert(/title: \{ selector: "a\[data-automation-id='jobTitle'\]" \}/.test(block), "BUILT_IN_SKELETONS.workday takes the title from the jobTitle link");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("workdaySkeleton: jobTitle link, locations or subtitle, the jobs API first, no browserOverrides");
