// Run: npx tsx src/lib/fixItemUpdate.test.ts
//
// A fix item's minutes set by hand are not an estimate (owner, 2026-10-08):
// lilit's APPLY item was resolved with 65 minutes and still read "estimated",
// because updateFixItem wrote minutes and left minutesEstimated as the
// automatic count had set it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixItemUpdateData } from "./fixItemUpdate";

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

const NOW = new Date("2026-10-08T17:37:50.529Z");

eq(
  fixItemUpdateData({ resolved: true, minutes: 65, note: "n" }, NOW),
  { minutes: 65, minutesEstimated: false, note: "n", resolvedAt: NOW.toISOString(), resolvedBy: "MANUAL" },
  "minutes set by hand on resolve: written, and no longer an estimate",
);
eq(fixItemUpdateData({ minutes: 0 }, NOW), { minutes: 0, minutesEstimated: false }, "zero minutes by hand is a hand value too");
eq(fixItemUpdateData({ minutes: null }, NOW), { minutes: null, minutesEstimated: false }, "minutes cleared by hand: no estimate left either");
{
  const d = fixItemUpdateData({ resolved: true, note: "no minutes" }, NOW);
  assert(!("minutesEstimated" in d) && !("minutes" in d), "no minutes in the patch: minutes and the flag are left as they are");
}
eq(fixItemUpdateData({ resolved: true, resolvedBy: "CHECK" }, NOW), { resolvedAt: NOW.toISOString(), resolvedBy: "CHECK" }, "resolvedBy CHECK is kept");
eq(fixItemUpdateData({ resolved: false }, NOW), { resolvedAt: null, resolvedBy: null }, "reopening clears the resolve");
eq(fixItemUpdateData({ operator: "op" }, NOW), { operator: "op" }, "operator alone");

// The wiring: updateFixItem writes exactly this data.
{
  const svc = readFileSync(join(__dirname, "..", "services", "fixQueueService.ts"), "utf8");
  const at = svc.indexOf("export async function updateFixItem(");
  const body = at >= 0 ? svc.slice(at, svc.indexOf("\n}\n", at)) : "";
  assert(/data: fixItemUpdateData\(patch, new Date\(\)\)/.test(body), "updateFixItem writes fixItemUpdateData(patch, new Date())");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("fixItemUpdate: all assertions passed");
