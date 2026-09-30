// Run: npx tsx worker/lib/firstSeen.test.ts
//
// Step A (owner, 2026-09-30): Job.firstSeenAt. Every scrape deletes and
// re-creates a site's rows, so a row's createdAt is when the job was LAST seen.
// firstSeenAt is carried forward from yesterday's row with the same identity,
// and set to now only for a job never seen before. Rows from before this
// existed carry null, and take the first night's date.

import { firstSeenFor } from "./firstSeen";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const NOW = new Date("2026-10-01T23:05:00Z");
const FIRST = new Date("2026-09-12T23:04:00Z");

eq(firstSeenFor(null, NOW), NOW, "a job never seen before is first seen now");
eq(firstSeenFor({ firstSeenAt: FIRST }, NOW), FIRST, "a job seen yesterday keeps the date it was first seen");
eq(firstSeenFor({ firstSeenAt: null }, NOW), NOW, "a row from before firstSeenAt existed takes the first night's date");
eq(firstSeenFor({}, NOW), NOW, "and so does one whose previous row did not carry the column");
eq(
  firstSeenFor({ firstSeenAt: new Date("2026-10-02T00:00:00Z") }, NOW),
  NOW,
  "a stored date later than now is not trusted: a job cannot be first seen in the future",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("firstSeen: carried from yesterday's row, now only for a job never seen");
