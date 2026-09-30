// Run: npx tsx worker/lib/fixQueuePlan.test.ts
//
// addsite2 phase two, step 1a: how one site's check findings for a run meet the
// site's open fix items. Step 2's value checks feed it; this pins the rules
// before any check exists.
//   - the same finding on two nights is one item, not two;
//   - a check code that no longer fires closes its item, resolvedBy CHECK;
//   - an operator's MANUAL item is never closed by a check.

import { planFixItems, type CheckFinding, type OpenFixItem } from "./fixQueuePlan";

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

const token: CheckFinding = { code: "apply_replay_token", field: "APPLY", detail: "_wpnonce", jobIds: ["j1"] };
const homograph: CheckFinding = { code: "location_homograph", field: "LOCATION", detail: "בחר", jobIds: ["j1", "j2", "j3"] };

// --- night one: nothing open, two findings -> two items ----------------------
{
  const p = planFixItems([token, homograph], []);
  eq(p.open.map((f) => f.code), ["apply_replay_token", "location_homograph"], "each finding opens an item");
  eq(p.open[1]?.jobIds, ["j1", "j2", "j3"], "carrying its job ids");
  eq(p.close, [], "nothing to close");
}

// --- night two: the same warning again -> no second item ----------------------
{
  const open: OpenFixItem[] = [
    { id: "i1", source: "CHECK", code: "apply_replay_token", field: "APPLY" },
    { id: "i2", source: "CHECK", code: "location_homograph", field: "LOCATION" },
  ];
  const p = planFixItems([token, homograph], open);
  eq(p.open, [], "the same warning on two nights gives one item");
  eq(p.keep, ["i1", "i2"], "the open items are kept");
  eq(p.close, [], "and none closed");

  const dup = planFixItems([token, token], []);
  eq(dup.open.length, 1, "the same code twice in one run is one item");
}

// --- a vanished code closes its item -----------------------------------------
{
  const open: OpenFixItem[] = [
    { id: "i1", source: "CHECK", code: "apply_replay_token", field: "APPLY" },
    { id: "i2", source: "CHECK", code: "location_homograph", field: "LOCATION" },
  ];
  const p = planFixItems([homograph], open);
  eq(p.close, [{ id: "i1", resolvedBy: "CHECK" }], "a code that no longer fires closes its item as resolvedBy CHECK");
  eq(p.keep, ["i2"], "the one still firing stays open");
  eq(p.open, [], "and nothing new opens");
}

// --- MANUAL items are never auto-closed --------------------------------------
{
  const open: OpenFixItem[] = [
    { id: "m1", source: "MANUAL", code: "manual", field: "APPLY" },
    { id: "m2", source: "MANUAL", code: "apply_replay_token", field: "APPLY" },
  ];
  const p = planFixItems([], open);
  eq(p.close, [], "no finding at all still closes no MANUAL item");
  assert(p.keep.includes("m1") && p.keep.includes("m2"), "both are kept");

  const q = planFixItems([token], open);
  eq(q.open.map((f) => f.code), ["apply_replay_token"], "a MANUAL item never stands in for a check's own item");
  eq(q.close, [], "and is still not closed");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("fixQueuePlan: one item per recurring code, closed by the check that opened it, MANUAL left alone");
