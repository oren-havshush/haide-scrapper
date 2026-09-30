// Run: npx tsx worker/lib/firstDatesBackfill.test.ts
//
// Step A: Site.firstActiveAt and Site.firstScrapedAt are backfilled from a list
// the owner reviewed first (first_dates_proposed.tsv, built read-only on the
// box). The tool applies exactly that list — it derives nothing itself — so
// the parser refuses anything it cannot read unambiguously.

import { parseFirstDatesList } from "./firstDatesBackfill";

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

const TAB = String.fromCharCode(9);
const HEADER = [
  "id",
  "siteUrl",
  "status",
  "activeAt_now",
  "activeAt_earliest_backup",
  "PROPOSED_firstActiveAt",
  "from",
  "PROPOSED_firstScrapedAt",
].join(TAB);
const row = (...cells: string[]) => cells.join(TAB);

{
  const tsv = [
    HEADER,
    row("s1", "https://a.test", "ACTIVE", "2026-09-30 19:24:35", "2026-08-13 16:25:59", "2026-08-13 16:25:59", "backup", "2026-06-09 19:50:00"),
    row("s2", "https://b.test", "REVIEW", "", "", "", "", "2026-09-01 10:00:00"),
    row("s3", "https://c.test", "ANALYZING", "", "", "", "", ""),
  ].join("\n");
  const r = parseFirstDatesList(tsv);
  eq(r.errors, [], "a well-formed list parses without errors");
  eq(r.rows.length, 3, "every site row is read");
  eq(r.rows[0]?.firstActiveAt?.toISOString(), "2026-08-13T16:25:59.000Z", "dates are read as the UTC the database stores");
  eq(r.rows[0]?.firstScrapedAt?.toISOString(), "2026-06-09T19:50:00.000Z", "both columns");
  eq([r.rows[1]?.firstActiveAt, r.rows[1]?.firstScrapedAt?.toISOString()], [null, "2026-09-01T10:00:00.000Z"], "a blank cell is null");
  eq([r.rows[2]?.firstActiveAt, r.rows[2]?.firstScrapedAt], [null, null], "a site with neither is read with neither");
}
{
  const bad = parseFirstDatesList([HEADER, row("s1", "u", "ACTIVE", "", "", "yesterday", "now", "")].join("\n"));
  assert(bad.errors.length === 1 && bad.errors[0].includes("s1"), `an unreadable date is refused, naming the row (${bad.errors})`);
  const dup = parseFirstDatesList(
    [HEADER, row("s1", "u", "ACTIVE", "", "", "", "", ""), row("s1", "u", "ACTIVE", "", "", "", "", "")].join("\n"),
  );
  assert(dup.errors.some((e) => e.includes("s1")), "a site listed twice is refused");
  const noHeader = parseFirstDatesList(row("s1", "u", "ACTIVE", "", "", "", "", ""));
  assert(noHeader.errors.length > 0, "a list without its header is refused — the columns are found by name");
  const crlf = parseFirstDatesList([HEADER, row("s1", "u", "ACTIVE", "", "", "", "", "2026-09-01 10:00:00")].join("\r\n"));
  eq(crlf.rows[0]?.firstScrapedAt?.toISOString(), "2026-09-01T10:00:00.000Z", "CRLF line endings are read the same");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("firstDatesBackfill: the reviewed list, read exactly or refused");
