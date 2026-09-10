// Run: npx tsx worker/lib/nonDestructiveRecovery.test.ts
//
// A source-level guard, not a unit test, and deliberately so.
//
// The dispatcher's catch and the boot-recovery loop both used to delete every
// Job row for a site and set it FAILED. Both carried the comment "mirror
// siteService path" — the wipe spread by copy-paste, and each copy looked
// correct in isolation. The behaviour needs a live database to exercise, so
// nothing else in this repo can catch it being pasted back in.
//
// These two files must never delete listings. That is the whole assertion.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const WORKER_DIR = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(WORKER_DIR, rel), "utf8");

const GUARDED = ["jobDispatcher.ts", "index.ts"];

for (const file of GUARDED) {
  const src = read(file);

  // Strip line and block comments so the prose above (which names deleteMany)
  // cannot satisfy or trip the check.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  assert(
    !/deleteMany/.test(code),
    `${file} must not delete rows — an escaped exception or a restart is evidence about the worker, not the site`,
  );

  assert(
    !/status:\s*"FAILED"[\s\S]{0,200}?failedAt/.test(code) || /rescueSite/.test(code),
    `${file} may only set a site FAILED behind the ANALYZING rescue`,
  );

  // Closing a ScrapeRun must be scoped to rows still IN_PROGRESS, or a run the
  // handler already completed gets relabelled FAILED.
  if (/scrapeRun\.updateMany/.test(code)) {
    assert(
      /scrapeRun\.updateMany\(\{\s*where:\s*\{[^}]*status:\s*"IN_PROGRESS"/.test(code),
      `${file} must scope its ScrapeRun close to status: "IN_PROGRESS"`,
    );
  }

  // Both callers must route the decision through the shared rule rather than
  // reimplementing it.
  assert(
    /planFailureCleanup/.test(code),
    `${file} must use planFailureCleanup so the rule has one definition`,
  );
}

// The rescue must not go through updateSiteStatus, which deletes every Job row
// on a FAILED transition (siteService.ts) — the exact wipe being removed.
for (const file of GUARDED) {
  const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(
    !/updateSiteStatus/.test(code),
    `${file} must not call updateSiteStatus — it wipes listings on a FAILED transition`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("nonDestructiveRecovery: dispatcher and boot recovery are non-destructive");
