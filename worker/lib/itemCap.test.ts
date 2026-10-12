// Run: npx tsx worker/lib/itemCap.test.ts
//
// The item cap is no longer silent (owner, 2026-10-13, LRN-WRK-30). When
// MAX_EXTRACTED_ITEMS (2,000) bit, the dedupe loop simply stopped: a scheduled
// run wrote the first 2,000 and recorded nothing, a quiet partial set of the
// kind the listing guards exist to refuse (Maof lists 2,524). Now the run
// records item_cap_reached: 2,000 of <n> cards; a scheduled run refuses the
// write like suspicious_drop (rows kept, a Needs-attention line), and a manual
// run writes the first 2,000 and carries the warning.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capItems, itemCapWarnings, ITEM_CAP_WARNING } from "./itemCap";
import { newExtractGuard, onExplicitZeroMatch, zeroMatchRefusal } from "./zeroMatch";
import { challengeWarnings } from "./challengeWait";
import { classifyOutcome, ITEM_CAP } from "./sweepSelection";
import { needsAttention, type ReportItem, type ReportSweep } from "./sweepReport";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));

// Maof-shaped: 2,524 distinct cards against a cap of 2,000.
{
  const guard = newExtractGuard(true);
  const kept = capItems(items(2524), 2000, guard);
  assert(kept.length === 2000, `the first 2,000 are kept (got ${kept.length})`);
  assert(guard.itemCap === 2524, `the run records how many there were (got ${guard.itemCap})`);
  assert(ITEM_CAP_WARNING === "item_cap_reached", "the warning type is item_cap_reached");
  const w = itemCapWarnings(guard);
  assert(JSON.stringify(w) === JSON.stringify(["item_cap_reached: 2,000 of 2,524 cards"]), `the warning reads 2,000 of 2,524 (got ${JSON.stringify(w)})`);
}
// Exactly at the cap, and under it: nothing recorded.
{
  const guard = newExtractGuard(true);
  assert(capItems(items(2000), 2000, guard).length === 2000 && guard.itemCap === null, "2,000 of 2,000 is not capped");
  assert(capItems(items(10), 2000, guard).length === 10 && guard.itemCap === null, "10 is not capped");
  assert(itemCapWarnings(guard).length === 0, "no cap, no warning");
}
// Two capped calls in one run (a per-page cap, then the site's): the larger count is kept.
{
  const guard = newExtractGuard(true);
  capItems(items(2100), 2000, guard);
  capItems(items(2524), 2000, guard);
  capItems(items(2050), 2000, guard);
  assert(guard.itemCap === 2524, `the largest count seen is kept (got ${guard.itemCap})`);
}
// The warning reaches the run on every path: written (manual), refused, crashed.
{
  const guard = newExtractGuard(false);
  capItems(items(2524), 2000, guard);
  assert(challengeWarnings(guard, true).includes("item_cap_reached: 2,000 of 2,524 cards"), "a written (manual) run carries it");
  assert(challengeWarnings(guard).includes("item_cap_reached: 2,000 of 2,524 cards"), "a refused or crashed run carries it");
  onExplicitZeroMatch(guard, ".x", "x");
  assert((zeroMatchRefusal(guard, 0)?.warnings ?? []).includes("item_cap_reached: 2,000 of 2,524 cards"), "a zero-match refusal carries it");
}
// The refusal is classified like suspicious_drop and has its own line.
{
  assert(ITEM_CAP === "item_cap", "the category is item_cap");
  assert(classifyOutcome({ status: "COMPLETED", failureCategory: ITEM_CAP }) === "suspicious_drop", "an item_cap refusal is a refused write, like suspicious_drop");
  const SWEEP: ReportSweep = { id: "sw", kind: "SCRAPE", status: "COMPLETED", trigger: "timer", startedAt: new Date("2026-10-13T23:00:00Z"), finishedAt: new Date("2026-10-14T01:00:00Z"), selectedCount: 3, haltReason: null };
  const item = (o: Partial<ReportItem>): ReportItem => ({ siteId: "s", siteUrl: "https://s.test", phase: "scrape", outcome: "success", failureCategory: null, jobsBefore: 1, jobsAfter: 1, newestJobAt: null, siteStatus: "ACTIVE", wouldDemoteTo: null, wouldPromoteTo: null, ...o });
  const lines = needsAttention(SWEEP, [
    item({ siteId: "m", siteUrl: "https://maof.test", outcome: "suspicious_drop", failureCategory: ITEM_CAP, jobsBefore: 1990, jobsAfter: 1990, scrapedCount: 2000, warnings: ["item_cap_reached: 2,000 of 2,524 cards"] }),
    item({ siteId: "a" }),
    item({ siteId: "b" }),
  ]);
  const why = lines.find((l) => /maof/.test(l.siteUrl))?.why ?? "";
  assert(
    why === "item cap refused: 2,000 of 2,524 cards, more than a run may write — nothing written, 1990 listing(s) kept",
    `the Needs-attention line (got "${why}")`,
  );
}
// scrape.ts: every dedupe goes through capItems with the run's guard, and a
// scheduled run refuses the write before any detail page or row.
{
  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
  assert(!/if \(deduped\.length >= MAX_EXTRACTED_ITEMS\) break;/.test(src), "the silent break is gone");
  assert(/capItems\(deduped, guard\?\.maxItems \?\? MAX_EXTRACTED_ITEMS, guard\)/.test(src), "dedupeAndCapRawFields caps through capItems with the guard, at its max (siteLimits)");
  const calls = src.split("dedupeAndCapRawFields(").length - 2; // minus the definition
  const withGuard = (src.match(/dedupeAndCapRawFields\((all|rawFieldsList|autoList|seeds), guard\)/g) ?? []).length +
    (src.match(/dedupeAndCapRawFields\(merged\.items, runMode\.extract\)/g) ?? []).length +
    (src.match(/\], runMode\.extract\);/g) ?? []).length;
  // Two calls go without the guard by design: the auto-detect comparison (a
  // cap is recorded only on rows the run returns) and planDetailsReadOnly (a
  // read-only plan, not a run).
  assert(calls === 9 && withGuard === 7, `seven of the nine calls pass the run's guard (got ${withGuard} of ${calls})`);
  assert(/\/\/ Compared without the guard: a cap is recorded only on rows the run returns\.\n\s+const autoDeduped = dedupeAndCapRawFields\(autoList\);/.test(src), "the auto-detect comparison records nothing");
  const after = src.slice(src.indexOf("const zeroMatch = zeroMatchRefusal(runMode.extract, rawFieldsList.length);"));
  assert(/runMode\.extract\?\.itemCap && scheduled/.test(after.slice(0, 1500)), "a scheduled run refuses right after the zero-match check");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("itemCap: a capped run says so; a scheduled one refuses the write");
