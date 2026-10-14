// Run: npx tsx worker/lib/textlessSignal.test.ts
//
// The text-less signal (owner, 2026-10-14): on every site a job with no text is
// stored as today and is a signal. The run warns "text_less: N of M cards"; the
// site gets ONE open COVERAGE fix item (source CHECK, code text_less,
// "N jobs with no text: page has text?"), refreshed per run and closed when N
// is 0; Needs attention names the site above 20% and 3; the header counts the
// night's text-less jobs. Nothing is dropped and no run is refused.

import { checkCodeLiveFrom, CHECK_CODE_LIVE_FROM } from "../../scripts/lib/cohortScore";
import { renderSweepReport, type ReportItem, type ReportSweep } from "./sweepReport";
import { planValueCheckItems, runValueChecks, VALUE_CHECK_QUEUE_CODES, type SavedJobForChecks } from "./valueChecks";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const job = (id: string, title: string, description: string | null, requirements: string | null = null): SavedJobForChecks => ({
  externalJobId: id,
  detailUrl: `https://x.example/jobs/${id}`,
  title,
  department: null,
  location: "תל אביב",
  locations: ["תל אביב"],
  description,
  requirements,
  publishDate: "2026-10-01",
  ageBucket: "fresh",
});
const base = { previous: [], formBlobs: [], idSeeds: [], listingItemsSeen: null, savedCount: 0 };
const run = (saved: SavedJobForChecks[]) => runValueChecks({ ...base, saved, savedCount: saved.length });

check("the run warning and the finding", () => {
  // egged's shape: 3 of 38 with no text, one of them only repeating its title.
  const saved = [
    ...Array.from({ length: 35 }, (_, i) => job(`d${i}`, `job ${i}`, "תיאור המשרה")),
    job("642", "קניין.ית רכש חלפים", null),
    job("674", "מכונאי.ת", "   "),
    job("627", "מיישב.ת תביעות צד ג", "מיישב.ת תביעות צד ג"),
  ];
  const r = run(saved);
  assert(r.warnings.includes("text_less: 3 of 38 cards"), `the warning (got ${r.warnings.filter((w) => w.startsWith("text_less")).join(" | ") || "none"})`);
  const f = r.findings.find((x) => x.code === "text_less");
  assert(f?.field === "COVERAGE", "a COVERAGE finding");
  assert(f?.detail === "3 jobs with no text: page has text?", `its detail (got ${f?.detail})`);
  assert(f?.count === 3 && JSON.stringify(f?.jobIds) === JSON.stringify(["642", "674", "627"]), "naming the three jobs by their key");
  assert(VALUE_CHECK_QUEUE_CODES.has("text_less"), "text_less is a queue code");
});

check("no text-less job: no warning, no finding", () => {
  const r = run([job("1", "a", "text"), job("2", "b", null, "req")]);
  assert(!r.warnings.some((w) => w.startsWith("text_less")), "no warning");
  assert(!r.findings.some((f) => f.code === "text_less"), "no finding");
});

check("one item per site: opened once, refreshed, closed at N = 0", () => {
  const firing = run([job("1", "a", null), job("2", "b", "text")]).findings;
  const opened = planValueCheckItems(firing, []);
  assert(opened.open.filter((x) => x.code === "text_less").length === 1, "the first run opens one item");
  const open = [{ id: "t1", source: "CHECK" as const, code: "text_less", field: "COVERAGE" as const }];
  const again = planValueCheckItems(firing, open);
  assert(!again.open.some((x) => x.code === "text_less") && again.keep.includes("t1"), "a run that fires again keeps (and refreshes) that one item, no second");
  const clean = planValueCheckItems(run([job("1", "a", "now text")]).findings, open);
  assert(clean.close.map((c) => c.id).includes("t1"), "the first run with none closes it");
});

check("scored only from its own deploy", () => {
  assert("text_less" in CHECK_CODE_LIVE_FROM && CHECK_CODE_LIVE_FROM.text_less === null, "a live-from entry, null until the deploy");
  assert(!("text_less" in checkCodeLiveFrom()), "so the fix score does not judge it before then");
});

const sweep: ReportSweep = {
  id: "w1",
  kind: "SCRAPE",
  status: "COMPLETED",
  trigger: "timer",
  startedAt: new Date("2026-10-15T23:01:00Z"),
  finishedAt: new Date("2026-10-16T01:30:00Z"),
  selectedCount: 3,
  haltReason: null,
};
const item = (siteUrl: string, warnings: string[]): ReportItem => ({
  siteId: siteUrl,
  siteUrl,
  phase: "scrape",
  outcome: "success",
  failureCategory: null,
  jobsBefore: 10,
  jobsAfter: 10,
  newestJobAt: new Date("2026-10-16T00:00:00Z"),
  siteStatus: "ACTIVE",
  wouldDemoteTo: null,
  wouldPromoteTo: null,
  warnings,
});

check("the morning report", () => {
  const report = renderSweepReport(
    sweep,
    [
      item("https://bontour.example/", ["text_less: 2 of 6 cards"]),
      item("https://egged.example/", ["text_less: 3 of 38 cards"]),
      item("https://board.example/", ["text_less: 4 of 10 cards"]),
      item("https://ok.example/", []),
    ],
    { timeZone: "Asia/Jerusalem" },
  );
  const attention = report.slice(report.indexOf("Needs attention"), report.indexOf("Outcomes"));
  assert(/https:\/\/board\.example\/\n\s+4 of 10 jobs with no text \(page has text\?\)/.test(attention), "40% and 4: named under Needs attention");
  assert(!attention.includes("bontour.example"), "2 of 6 (33%) is under 3 jobs: not named");
  assert(!attention.includes("egged.example"), "3 of 38 (8%) is under 20%: not named");
  assert(/\n {2}text-less 9 job\(s\) on 3 site\(s\)\n/.test(report), "the header counts every text-less job of the night");
  const quiet = renderSweepReport(sweep, [item("https://ok.example/", [])], { timeZone: "Asia/Jerusalem" });
  assert(!quiet.includes("text-less"), "a night with none prints no header line");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("textlessSignal: all assertions passed");
