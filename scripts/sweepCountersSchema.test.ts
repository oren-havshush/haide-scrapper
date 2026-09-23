// Run: npx tsx scripts/sweepCountersSchema.test.ts
//
// `closeSweep` writes the night's counters like this:
//
//     await prisma.scrapeSweep.update({ data: { status, finishedAt, ...counters, logText } })
//
// The spread is the whole point and the whole hazard. Every key of
// SweepCounters becomes a column name in that update, so a counter added to the
// type without a column in the schema is a runtime error — and it fires at the
// very END of the night, in the one call that records what happened.
//
// That is not hypothetical. The first real sweep, 2026-09-23, scraped all 145
// sites, wrote all 145 per-site items, rendered a correct report, and then died
// on `Unknown argument \`listingRefusals\``. The row stayed RUNNING with zero
// counters and no logText, and the report reached the journal only because
// Prisma echoed the failing arguments back in its error.
//
// Nothing caught it beforehand. computeCounters is pure and well tested in
// isolation; the write needs a database, and the schema is a different file in
// a different language. This is the seam between them, checked as text.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..");

// --- the counters the report computes --------------------------------------
const reportSrc = readFileSync(join(ROOT, "worker", "lib", "sweepReport.ts"), "utf8");
const typeBlock = /export type SweepCounters = \{([\s\S]*?)\n\};/.exec(reportSrc)?.[1];
assert(!!typeBlock, "the SweepCounters type was found");
const counterKeys = [...(typeBlock ?? "").matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1] as string);
assert(counterKeys.length >= 8, `and its keys were extracted (got ${counterKeys.length})`);

// --- the columns the row has -----------------------------------------------
const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const modelBlock = /model ScrapeSweep \{([\s\S]*?)\n\}/.exec(schema)?.[1];
assert(!!modelBlock, "the ScrapeSweep model was found");
const columns = new Set(
  [...(modelBlock ?? "").matchAll(/^\s{2}(\w+)\s+\w/gm)].map((m) => m[1] as string),
);
assert(columns.size >= 10, `and its columns were extracted (got ${columns.size})`);

// --- the seam ---------------------------------------------------------------
console.log("# every counter has a column");
for (const key of counterKeys) {
  assert(columns.has(key), `SweepCounters.${key} has a ScrapeSweep column`);
}
// The two that were missing, named, so this test is visibly about them.
for (const key of ["listingRefusals", "noJobs"]) {
  assert(counterKeys.includes(key), `${key} is a counter`);
  assert(columns.has(key), `${key} is a column`);
}

// --- and the write really is a spread, or none of the above matters ---------
console.log("# the write is still a spread of the whole object");
{
  const common = readFileSync(join(ROOT, "worker", "sweep", "sweepCommon.ts"), "utf8");
  const update = /prisma\.scrapeSweep\.update\(\{[\s\S]*?\n  \}\);/.exec(common)?.[0] ?? "";
  assert(update.length > 100, "the closeSweep update was found");
  assert(
    /\.\.\.counters/.test(update),
    "closeSweep spreads the counters object — which is why the column check above is the real rule",
  );
  assert(
    /computeCounters\(/.test(common),
    "and the object it spreads comes from computeCounters",
  );
}

// --- a migration exists for them --------------------------------------------
console.log("# and a migration adds them");
{
  const dir = join(ROOT, "prisma", "migrations", "20260924000000_add_sweep_listing_refusals_and_no_jobs");
  let sql = "";
  try {
    sql = readFileSync(join(dir, "migration.sql"), "utf8");
  } catch {
    /* reported below */
  }
  assert(sql.length > 0, "the migration file exists");
  assert(/ALTER TABLE "ScrapeSweep"/.test(sql), "it alters ScrapeSweep");
  for (const key of ["listingRefusals", "noJobs"]) {
    assert(new RegExp(`ADD COLUMN "${key}"`).test(sql), `it adds ${key}`);
  }
  // NOT NULL with a default: the column is read on every row the dashboard
  // renders, and a nullable counter would mean "unknown" where 0 is the truth.
  assert(
    /NOT NULL DEFAULT 0/.test(sql),
    "with a default, so existing rows read 0 rather than NULL",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nsweepCountersSchema: every counter the report computes has a column to land in");
