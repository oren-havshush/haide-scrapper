// Run: npx tsx worker/lib/fillFallGuard.test.ts
//
// Candidate A of the guard gap (owner, 2026-10-10): a scheduled write is refused
// when description fill falls by 25 points or more against the stored rows,
// crossing 60% or not. isFieldFillDrop judged only the crossing, so civi's
// 2026-10-08 night (3 stored at 100% -> 5 saved at 60%) and tnuva's 2026-10-10
// (100% -> 67%) both committed. Replayed over seven nights it refuses those two
// and nothing ordinary.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DROP_THRESHOLDS,
  FILL_FALL_POINTS,
  describedJobsLost,
  isFieldFillFall,
  planScheduledPersist,
  type DescribedRow,
} from "./scheduledRun";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const row = (id: string, description: string | null): DescribedRow => ({ externalJobId: id, description });
const NO_WALK = { paginationTruncated: false };
function plan(stored: DescribedRow[], next: DescribedRow[]) {
  const filled = (rs: DescribedRow[]) => rs.filter((r) => (r.description ?? "").trim().length > 0).length;
  return planScheduledPersist(next.length, stored.length, DEFAULT_DROP_THRESHOLDS, NO_WALK, {
    description: {
      previous: { filled: filled(stored), total: stored.length },
      next: { filled: filled(next), total: next.length },
      lost: describedJobsLost(stored, next),
    },
  });
}

assert(FILL_FALL_POINTS === 0.25, "the rule is 25 points");

// civi, 2026-10-08: 3 stored, all described; 5 written, 3 described (100% -> 60%).
// Not a crossing (60% is not below 60%) and no stored job lost its text.
{
  const stored = [row("a", "x"), row("b", "x"), row("c", "x")];
  const next = [row("a", "x"), row("b", "x"), row("c", "x"), row("d", null), row("e", "")];
  const p = plan(stored, next);
  assert(p.mode === "field_fill_drop", `civi-shaped 100% -> 60% is refused (got ${p.mode})`);
  if (p.mode === "field_fill_drop") {
    assert(p.rule === "fell_points", `by the 25-point rule (got ${p.rule})`);
    assert(Math.round(p.previousFill * 100) === 100 && Math.round(p.newFill * 100) === 60, "with both fills on the plan");
  }
}

// iec, an ordinary turnover night: 30 stored described, 7 out, 6 in, 29 saved described.
{
  const stored = Array.from({ length: 30 }, (_, i) => row(`j${i}`, "x"));
  const next = [...stored.slice(7), ...Array.from({ length: 6 }, (_, i) => row(`n${i}`, "x"))];
  const p = plan(stored, next);
  assert(p.mode === "commit", `iec-shaped turnover, fill unchanged, is written (got ${p.mode})`);
}

// dreamjobs: fill unchanged, a few more rows.
{
  const stored = Array.from({ length: 360 }, (_, i) => row(`d${i}`, "x"));
  const next = Array.from({ length: 365 }, (_, i) => row(`d${i}`, "x"));
  assert(plan(stored, next).mode === "commit", "dreamjobs-shaped, fill unchanged, is written");
}

// The boundary, on the plain function: 25 points refuses, 24 does not; crossing 60% or not.
assert(isFieldFillFall({ filled: 100, total: 100 }, { filled: 75, total: 100 }), "100% -> 75% (25 points) is a fall");
assert(!isFieldFillFall({ filled: 100, total: 100 }, { filled: 76, total: 100 }), "100% -> 76% (24 points) is not");
assert(isFieldFillFall({ filled: 55, total: 100 }, { filled: 30, total: 100 }), "55% -> 30%, below 60% all along, is a fall");
assert(!isFieldFillFall({ filled: 0, total: 0 }, { filled: 0, total: 5 }), "nothing stored: no verdict");
assert(!isFieldFillFall({ filled: 5, total: 5 }, { filled: 0, total: 0 }), "nothing new: no verdict");
assert(!isFieldFillFall({ filled: 60, total: 100 }, { filled: 90, total: 100 }), "a rise is not a fall");

// A site already below 60% falling 25 points is refused too (isFieldFillDrop alone let it through).
{
  const stored = [...Array.from({ length: 11 }, (_, i) => row(`s${i}`, "x")), ...Array.from({ length: 9 }, (_, i) => row(`b${i}`, null))];
  const next = [...Array.from({ length: 6 }, (_, i) => row(`s${i}`, "x")), ...Array.from({ length: 14 }, (_, i) => row(`m${i}`, null))];
  const p = plan(stored, next);
  assert(p.mode === "field_fill_drop", `55% -> 30% on 20 rows is refused (got ${p.mode})`);
}

// The existing rules keep their names: a crossing is still "crossed_threshold".
{
  const stored = Array.from({ length: 10 }, (_, i) => row(`c${i}`, "x"));
  const next = Array.from({ length: 10 }, (_, i) => row(`c${i}`, i < 5 ? "x" : null));
  const p = plan(stored, next);
  assert(p.mode === "field_fill_drop" && p.rule === "crossed_threshold", `100% -> 50% is named a crossing (got ${p.mode === "field_fill_drop" ? p.rule : p.mode})`);
}

// The wiring: the run's refusal names the rule, so the report line does.
{
  const scrape = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const at = scrape.indexOf('if (plan.mode === "field_fill_drop")');
  const block = at > 0 ? scrape.slice(at, at + 2500) : "";
  assert(/FILL_RULE_TEXT\[plan\.rule\]/.test(block), "scrape.ts puts the rule's text in the field_fill_drop message and warning");
  const src = readFileSync(join(__dirname, "scheduledRun.ts"), "utf8");
  assert(/25 points/.test(src.slice(0, src.indexOf("export function planScheduledPersist"))), "scheduledRun.ts states the rule in its doc comment");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("fillFallGuard: all assertions passed");
