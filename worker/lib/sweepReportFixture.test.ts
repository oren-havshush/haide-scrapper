// Run: npx tsx worker/lib/sweepReportFixture.test.ts
//
// The report, rendered from the step 9 catch-up run's REAL items
// (fixtures/sweep-2026-09-15.json), not from items written to fit the renderer.
//
// That night the stored report read "140 sites, 0 need attention". It was not a
// clean fleet: twelve sites had drifted and were only counted, never named, and
// maccabi4u had replaced 433 listings with 8 under a `success` outcome while its
// own ScrapeRun warned `job_count_drop … (-98%)`. The Needs attention list is
// the remediation queue, so it has to name all thirteen.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCounters,
  needsAttention,
  renderSweepReport,
  sweepDate,
  verdictLine,
  type ReportItem,
  type ReportSweep,
  type SkippedSite,
} from "./sweepReport";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

type FixtureItem = Omit<ReportItem, "newestJobAt"> & { newestJobAt: string | null };
type Fixture = {
  sweep: Omit<ReportSweep, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string };
  skipped: SkippedSite[];
  items: FixtureItem[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "sweep-2026-09-15.json"), "utf8"),
);

const sweep: ReportSweep = {
  ...fixture.sweep,
  startedAt: new Date(fixture.sweep.startedAt),
  finishedAt: new Date(fixture.sweep.finishedAt),
};
const items: ReportItem[] = fixture.items.map((i) => ({
  ...i,
  newestJobAt: i.newestJobAt ? new Date(i.newestJobAt) : null,
}));
const opts = { timeZone: "Asia/Jerusalem", skipped: fixture.skipped };

// The fixture is what it claims to be, or everything below checks air.
assert(items.length === 140, `the fixture holds the night's 140 items (got ${items.length})`);
assert(fixture.skipped.length === 5, `and its 5 selection exclusions (got ${fixture.skipped.length})`);

const text = renderSweepReport(sweep, items, opts);
const lines = text.split("\n");
const verdict = lines[0];

// ---------------------------------------------------------------------------
// The verdict, and the section it counts
// ---------------------------------------------------------------------------

assert(
  verdict === "Nightly sweep 2026-09-15: 140 sites, 13 need attention",
  `the verdict counts the twelve drifted sites and maccabi4u (got "${verdict}")`,
);
assert(verdict === verdictLine(sweep, items, opts), "and is the line verdictLine gives");

const attention = needsAttention(sweep, items, opts);
assert(attention.length === 13, `needsAttention lists 13 sites (got ${attention.length})`);

const start = text.indexOf("Needs attention (");
const end = text.indexOf("\n\n", start);
const block = start >= 0 && end > start ? text.slice(start, end) : "";
assert(block.startsWith("Needs attention (13)"), `the section header says 13\n${block.slice(0, 80)}`);

// Every site in the section is one line starting "  https://" — the count in the
// verdict must equal the sites actually printed, not a number computed apart.
const named = block.split("\n").filter((l) => /^ {2}https?:\/\//.test(l));
assert(
  named.length === 13,
  `the section prints exactly as many sites as the verdict counts (printed ${named.length})`,
);

// ---------------------------------------------------------------------------
// maccabi4u — a committed drop the run called success
// ---------------------------------------------------------------------------

const maccabi = attention.find((a) => a.siteUrl.includes("maccabi4u.co.il"));
assert(maccabi !== undefined, "maccabi4u is under Needs attention");
assert(
  maccabi !== undefined && /433 -> 8/.test(maccabi.why),
  `with both counts (got "${maccabi?.why}")`,
);

// ---------------------------------------------------------------------------
// Silent drift is named, with category, listing count and newest listing date
// ---------------------------------------------------------------------------

const soft = items.filter((i) => i.outcome === "soft_failure");
assert(soft.length === 12, `the fixture has 12 soft failures (got ${soft.length})`);

// Two kinds, and the split is what this fixture is for.
//
// Eight sites HAD listings and returned none: real drift, a site that changed
// under us on the night. Four had none to begin with — se.com, xnes,
// careers.jnj.com, safelog — which is not drift and never was; it is the shape
// a config that has never worked takes.
//
// Every one of those four turned out to be exactly that. xnes and safelog were
// rebuilt and are ACTIVE; se.com and careers.jnj.com were retired to SKIPPED.
// Which is the argument for naming them separately rather than dropping them:
// the distinction is real, and so is the problem on both sides of it.
const noJobs = soft.filter((i) => i.failureCategory === "empty_results" && i.jobsBefore === 0);
const drift = soft.filter((i) => !noJobs.includes(i));
assert(noJobs.length === 4, `four sites had no jobs and returned none (got ${noJobs.length})`);
assert(drift.length === 8, `and eight actually drifted (got ${drift.length})`);
assert(
  ["se.com", "xnes", "careers.jnj.com", "safelog"].every((s) =>
    noJobs.some((i) => i.siteUrl.includes(s)),
  ),
  "the four are the ones the remediation later rebuilt or retired",
);

for (const d of drift) {
  const a = attention.find((x) => x.siteUrl === d.siteUrl);
  assert(a !== undefined, `drifted site is named: ${d.siteUrl}`);
  if (!a) continue;
  assert(a.why.includes(d.failureCategory ?? "?"), `${d.siteUrl}: its category is on the line (${a.why})`);
  assert(a.why.includes(`${d.jobsAfter} listing`), `${d.siteUrl}: its listing count is on the line (${a.why})`);
  // The sweep's local date, like every other date in the report.
  const newest = d.newestJobAt ? sweepDate(d.newestJobAt, opts.timeZone) : "none";
  assert(a.why.includes(`newest ${newest}`), `${d.siteUrl}: its newest listing date is on the line (${a.why})`);
}

for (const n of noJobs) {
  const a = attention.find((x) => x.siteUrl === n.siteUrl);
  assert(a !== undefined, `a site with no jobs is still named: ${n.siteUrl}`);
  assert(
    a !== undefined && /no jobs, and has none stored/.test(a.why),
    `${n.siteUrl}: in its own words (${a?.why})`,
  );
  assert(
    a !== undefined && !/silent drift/.test(a.why),
    `${n.siteUrl}: and not as drift`,
  );
}

{
  // The counters follow the same split, so the Outcomes section and the queue
  // cannot tell different stories about the same night.
  const c = computeCounters(sweep, items);
  assert(c.silentDrift === 8, `silentDrift counts the eight (got ${c.silentDrift})`);
  assert(c.noJobs === 4, `noJobs counts the four (got ${c.noJobs})`);
  assert(c.listingRefusals === 0, "and that night had no listing refusals — the feature did not exist");
}

{
  const ashtrom = attention.find((a) => a.siteUrl.includes("ashtrom"));
  assert(
    ashtrom?.why === "silent drift (structure_changed): 62 listing(s) on the site, newest 2026-08-16",
    `the exact drift line for ashtrom (got "${ashtrom?.why}")`,
  );
}

// ---------------------------------------------------------------------------
// Skipped at selection, and warnings
// ---------------------------------------------------------------------------

for (const s of fixture.skipped) {
  assert(text.includes(`${s.siteUrl} — ${s.reason}`), `skipped site listed with its reason: ${s.siteUrl}`);
}
assert(
  text.includes("no usable fieldMappings (would fail immediately)"),
  "tikshoov's reason is in the report",
);
assert(
  !attention.some((a) => a.siteUrl.includes("tikshoov")),
  "and a skipped site is not counted as needing attention — it was never attempted",
);

assert(text.includes("\nWarnings ("), "the report has a Warnings section");
{
  const heading = text.indexOf("\n  job_count_drop (");
  const site = text.indexOf(
    "https://www.maccabi4u.co.il/careers/search-job-positions/? — 8 saved vs previous 433 (-98%)",
  );
  assert(heading >= 0 && site > heading, "maccabi4u's own run warning is in the report, under job_count_drop");
}
{
  const withWarnings = items.filter((i) => (i.warnings ?? []).length > 0).length;
  assert(
    text.includes(`Warnings (${withWarnings} sites)`),
    `the Warnings header counts every site whose run warned (${withWarnings})`,
  );

  // Every warning is COUNTED under its type; only the two that are about a
  // particular site name one. This fixture is the argument: 61 of these 140
  // sites warned, and naming all of them produced a section longer than the
  // rest of the report, almost entirely location-quality lines that are fixed
  // by changing a rule once — not by visiting 61 sites.
  const NAMED = new Set(["job_count_drop", "near_timeout"]);
  const section = text.slice(text.indexOf("\nWarnings ("));
  const seenTypes = new Set<string>();
  for (const i of items) {
    for (const w of i.warnings ?? []) {
      const [type, ...rest] = w.split(":");
      const t = (type ?? "").trim();
      seenTypes.add(t);
      assert(section.includes(`  ${t} (`), `every type is counted: ${t}`);
      const named = section.includes(`${i.siteUrl} — ${rest.join(":").trim()}`);
      if (NAMED.has(t)) {
        assert(named, `${t} names its site: ${i.siteUrl}`);
      } else {
        assert(!named, `${t} does NOT name its site: ${i.siteUrl}`);
      }
    }
  }
  assert(seenTypes.size >= 5, `the fixture exercises several warning types (${seenTypes.size})`);
  assert(seenTypes.has("job_count_drop"), "including the one that names sites");

  // The size of the thing, in the real numbers. That night: 61 sites warned,
  // 70 warnings across 6 types. 8 of them were job_count_drop and none was
  // near_timeout, so the section carries 8 site lines instead of 70 — and the
  // 41 location-quality warnings that dominate it are a count, which is what
  // an operator can act on anyway.
  const namedLines = (section.match(/\n {4}https:\/\//g) ?? []).length;
  const totalWarnings = items.reduce((n, i) => n + (i.warnings ?? []).length, 0);
  assert(withWarnings === 61, `61 sites warned (got ${withWarnings})`);
  assert(totalWarnings === 70, `70 warnings in total (got ${totalWarnings})`);
  assert(namedLines === 8, `and the section names 8 of them (got ${namedLines})`);
  assert(
    namedLines < totalWarnings / 5,
    "a small fraction of the warnings, which is the whole point of the change",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sweepReportFixture: last night's items read 13 need attention, maccabi4u among them");
