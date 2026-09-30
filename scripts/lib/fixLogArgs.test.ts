// Run: npx tsx scripts/lib/fixLogArgs.test.ts
//
// scripts/fix-log.ts (addsite2 phase two, step 1a) turns its flags into the
// POST body for /api/dashboard/fix-queue. The body is checked against the same
// strict schema the route uses before anything is sent, so a typo fails here,
// on the operator's machine, and not as a 400 from production.

import { parseFixLogArgs } from "./fixLogArgs";

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

{
  const r = parseFixLogArgs(["--site", "cmq1", "--field", "APPLY", "--minutes", "12", "--note", "form moved"]);
  assert(r.ok, `the plan's example parses (${r.ok ? "" : r.error})`);
  eq(
    r.ok ? r.body : null,
    { siteId: "cmq1", field: "APPLY", code: "manual", minutes: 12, note: "form moved" },
    "into the route's body, code defaulted",
  );
}
{
  const r = parseFixLogArgs(["--site", "cmq1", "--field", "apply", "--minutes", "5", "--operator", "noa", "--resolved"]);
  eq(r.ok ? r.body : null, { siteId: "cmq1", field: "APPLY", code: "manual", minutes: 5, operator: "noa", resolved: true },
    "the field is case-insensitive; --resolved logs a done fix; --operator is carried");
}
{
  assert(!parseFixLogArgs(["--field", "APPLY"]).ok, "no --site is refused");
  assert(!parseFixLogArgs(["--site", "cmq1"]).ok, "no --field is refused");
  assert(!parseFixLogArgs(["--site", "cmq1", "--field", "WEBSITE"]).ok, "an unknown field is refused");
  assert(!parseFixLogArgs(["--site", "cmq1", "--field", "APPLY", "--minutes", "twelve"]).ok, "minutes that are not a number are refused");
  assert(!parseFixLogArgs(["--site", "cmq1", "--field", "APPLY", "--minutes", "-3"]).ok, "negative minutes are refused");
  assert(!parseFixLogArgs(["--site", "cmq1", "--field", "APPLY", "--bogus", "x"]).ok, "an unknown flag is refused");
  assert(!parseFixLogArgs(["--site", "cmq1", "--field", "APPLY", "--note"]).ok, "a flag missing its value is refused");
  const bad = parseFixLogArgs(["--site", "cmq1", "--field", "WEBSITE"]);
  assert(!bad.ok && bad.error.includes("JOB_ID"), "the refusal lists the valid fields");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("fixLogArgs: flags become the route's own body, checked before sending");
