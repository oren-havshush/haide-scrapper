// Run: npx tsx src/lib/acceptedGates.test.ts
//
// Accepted gates on the nightly report (owner, 2026-10-07). naya-tech, mor and
// allegronet are ACTIVE below the 60% description gate by the owner's decision
// (each adminNote records it), so every night printed "would have demoted to
// REVIEW" for them under Needs attention. _meta.acceptedGates records the
// decision per gate with the fill it was accepted at; the nightly lists such a
// site under "Accepted below gate (n)" with its current fill instead, until the
// fill falls 20 points or more below the accepted level, when the Tier-A line
// is back under Needs attention.
//
// Setting it is not a scrape change: an acceptedGates-only write keeps the
// site's status and savedAt, opens no fix item, and the fix command runs no
// guarded run for it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  acceptedBelowGate,
  descriptionFillFromGateReason,
  onlyAcceptedGatesChanged,
  readAcceptedGates,
} from "./acceptedGates";
import { updateSiteConfigSchema } from "./validators";
import { fieldsForWrite } from "./autoFix";
import { needsAttention, renderSweepReport, type ReportItem, type ReportSweep } from "../../worker/lib/sweepReport";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
};

const ACCEPTED = { description_fill: { fill: 0.5, note: "owner 2026-10-01: JB-5/6/8 publish only requirements" } };
const REASON = (pct: number, extra = "") =>
  `Tier-A gate: description fill ${pct}% < 60%${extra} — sampled 6 jobs from current run`;

// --- reading the key -------------------------------------------------------------
eq(readAcceptedGates({ title: {}, _meta: { acceptedGates: ACCEPTED } }), ACCEPTED, "readAcceptedGates reads _meta.acceptedGates");
eq(readAcceptedGates({ _meta: {} }), null, "absent is null");
eq(readAcceptedGates({ _meta: { acceptedGates: { description_fill: { fill: "half" } } } }), null, "a malformed entry is ignored");
eq(readAcceptedGates({ _meta: { acceptedGates: { title_fill: { fill: 0.5, note: "x" } } } }), null, "an unknown gate is ignored");

// --- the gate reason ----------------------------------------------------------------
eq(descriptionFillFromGateReason(REASON(50)), 0.5, "the description fill is read from the gate's reason");
eq(descriptionFillFromGateReason(REASON(50, "; no apply path (no formCapture, applicationInfo, or detailUrl on any job)")), null, "not when another Tier-A item failed too");
eq(descriptionFillFromGateReason("Tier-A gate: title fill 40% < 90% — sampled 5 jobs from current run"), null, "not for another gate");
eq(descriptionFillFromGateReason(null), null, "no reason, no fill");

// --- accepted below the gate ----------------------------------------------------------
const demote = (pct: number, extra = "") => ({ wouldDemoteTo: "REVIEW", gateReason: REASON(pct, extra) });
eq(acceptedBelowGate(demote(50), ACCEPTED), { fill: 0.5, acceptedFill: 0.5 }, "allegronet at its accepted 50% is accepted");
eq(acceptedBelowGate(demote(33), ACCEPTED), { fill: 0.33, acceptedFill: 0.5 }, "a fall of 17 points is still accepted");
eq(acceptedBelowGate(demote(30), ACCEPTED), null, "a fall of 20 points is not: the Tier-A line is back");
eq(acceptedBelowGate(demote(50), null), null, "a site with no accepted gate is not accepted");
eq(acceptedBelowGate(demote(50, "; no apply path (x)"), ACCEPTED), null, "another failing Tier-A item is never hidden");
eq(acceptedBelowGate({ wouldDemoteTo: null, gateReason: null }, ACCEPTED), null, "nothing withheld, nothing to accept");

// --- the report -----------------------------------------------------------------------
const STARTED = new Date("2026-10-06T23:00:26Z");
const sweep: ReportSweep = {
  id: "sw", kind: "SCRAPE", status: "COMPLETED", trigger: "timer", startedAt: STARTED,
  finishedAt: new Date(STARTED.getTime() + 60 * 60_000), selectedCount: 3, haltReason: null,
};
const item = (url: string, pct: number, gates: typeof ACCEPTED | null): ReportItem => ({
  siteId: url, siteUrl: url, phase: "scrape", outcome: "success", failureCategory: null,
  jobsBefore: 6, jobsAfter: 6, newestJobAt: new Date(STARTED.getTime() + 60_000), siteStatus: "ACTIVE",
  wouldDemoteTo: "REVIEW", wouldPromoteTo: null, gateReason: REASON(pct),
  ...({ acceptedGates: gates } as Record<string, unknown>),
});
const items = [
  item("https://www.allegronet.co.il/careers/", 50, ACCEPTED),
  item("https://fell.test/", 30, ACCEPTED),
  item("https://plain.test/", 50, null),
];
const attention = needsAttention(sweep, items, { timeZone: "Asia/Jerusalem" }).map((a) => a.siteUrl);
eq(attention, ["https://fell.test/", "https://plain.test/"], "an accepted site is not under Needs attention; a 20-point fall and an unaccepted site are");
const text = renderSweepReport(sweep, items, { timeZone: "Asia/Jerusalem" });
assert(/^Accepted below gate \(1\)$/m.test(text), "a separate count line: Accepted below gate (1)");
assert(
  text.includes("  https://www.allegronet.co.il/careers/ — description fill 50% (accepted at 50%)"),
  "listing the site with its current fill and the accepted level",
);
const attentionBlock = text.slice(text.indexOf("Needs attention"), text.indexOf("Accepted below gate"));
assert(!attentionBlock.includes("allegronet"), "and not in the Needs attention block");

// --- setting it is not a scrape change ------------------------------------------------
const parsed = updateSiteConfigSchema.safeParse({ fieldMappings: {}, pageFlow: [], formCapture: null, acceptedGates: ACCEPTED });
assert(parsed.success && JSON.stringify((parsed.data as Record<string, unknown>).acceptedGates) === JSON.stringify(ACCEPTED), "the config schema keeps acceptedGates");
assert(!updateSiteConfigSchema.safeParse({ fieldMappings: {}, pageFlow: [], formCapture: null, acceptedGates: { title_fill: { fill: 0.5, note: "x" } } }).success, "and refuses an unknown gate");
assert(!updateSiteConfigSchema.safeParse({ fieldMappings: {}, pageFlow: [], formCapture: null, acceptedGates: { description_fill: { fill: 0.5 } } }).success, "and an entry without a note");

const cfg = (meta: Record<string, unknown>) => ({ fieldMappings: { title: { selector: ".t" }, _meta: { itemSelector: ".i", savedAt: "a", ...meta } }, pageFlow: [] });
assert(onlyAcceptedGatesChanged(cfg({}), cfg({ acceptedGates: ACCEPTED, savedAt: "b" })), "adding acceptedGates alone is not a scrape change");
assert(!onlyAcceptedGatesChanged(cfg({}), cfg({ acceptedGates: ACCEPTED, itemSelector: ".j" })), "with another key changed, it is");
assert(!onlyAcceptedGatesChanged(cfg({}), cfg({ savedAt: "b" })), "and no change at all is not an acceptedGates change");
eq(fieldsForWrite({ kind: "config", before: cfg({}), after: cfg({ acceptedGates: ACCEPTED, savedAt: "b" }) }), [], "an acceptedGates-only write opens no fix item");

const svc = readFileSync(join(__dirname, "..", "services", "siteService.ts"), "utf8");
const save = svc.slice(svc.indexOf("export async function saveSiteConfig("), svc.indexOf("export async function saveSiteConfig(") + 6000);
assert(/acceptedGates:\s*config\.acceptedGates\s*\|\|\s*null/.test(save), "saveSiteConfig stores acceptedGates in _meta");
assert(/onlyAcceptedGatesChanged\(/.test(save) && /transitionToReview\s*=\s*site\.status === "ACTIVE" && !reportOnly/.test(save), "and an acceptedGates-only write keeps the site's status");

const batch = readFileSync(join(__dirname, "..", "..", "scripts", "addsite-batch.ts"), "utf8");
const fix = batch.slice(batch.indexOf("async function cmdFix("), batch.indexOf("async function cmdFix(") + 9000);
assert(/onlyAcceptedGatesChanged\(/.test(fix) && fix.indexOf("onlyAcceptedGatesChanged(") < fix.indexOf("// 3. Guarded run"), "the fix command stops before the guarded run for an acceptedGates-only patch");

const nightly = readFileSync(join(__dirname, "..", "..", "worker", "sweep", "nightly.ts"), "utf8");
assert(/acceptedGates:\s*r\.acceptedGates/.test(nightly), "the nightly passes the site's acceptedGates to the report item");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("acceptedGates: an owner-accepted gate is reported apart until the fill falls 20 points further");
