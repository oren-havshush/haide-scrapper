// Run: npx tsx scripts/lib/verifyJobIds.test.ts
//
// addsite2 phase two, step 4. verify-jobids reads the site's stored
// setupScript: an addsite3 site (onboardingSkill 'addsite3') whose script
// hashes in the page (haideHash) or skips a repeated key (seen[...]) fails with
// exit 2; for an untagged site the same finding is only a warning, so the
// control cohort's gate outcome is unchanged.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptIdRules } from "./verifyJobIds";

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

// The shape of 4chef's script: a title hash and a silent skip of a repeated id.
const TITLE_HASH = `function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
var seen = {};
for (const item of document.querySelectorAll('.job')) {
  var id = 'h-' + haideHash(title);
  if (seen[id]) continue;
  seen[id] = 1;
}`;
const SEEN_ONLY = "var seen = {}; for (const a of links) { if (seen[a.href]) continue; seen[a.href] = 1; }";
const CLEAN = "for (const item of document.querySelectorAll('.job')) { const m = t.match(/(\\d+)/); if (m) span.textContent = 'x-' + m[1]; }";

{
  const r = scriptIdRules(TITLE_HASH, true);
  assert(r.fail.length === 2, `addsite3 + haideHash( and seen[: two failures (${JSON.stringify(r.fail)})`);
  assert(r.fail.some((f) => f.includes("haideHash(")) && r.fail.some((f) => f.includes("seen[")), "each named");
  eq(r.warn, [], "and no warnings");
}
{
  const r = scriptIdRules(SEEN_ONLY, true);
  assert(r.fail.length === 1 && r.fail[0]!.includes("seen["), "addsite3 + seen[ alone: one failure");
}
{
  const r = scriptIdRules(TITLE_HASH, false);
  eq(r.fail, [], "untagged + haideHash( and seen[: no failure (the control's gate is unchanged)");
  assert(r.warn.length === 2, `but two warnings (${JSON.stringify(r.warn)})`);
}
eq(scriptIdRules(CLEAN, true), { fail: [], warn: [] }, "a script that emits only a native id: nothing");
eq(scriptIdRules(null, true), { fail: [], warn: [] }, "no setupScript: nothing");
eq(scriptIdRules("", false), { fail: [], warn: [] }, "an empty one: nothing");

// Wiring: the command applies it, and its failures are hard (exit 2).
{
  const src = readFileSync(join(__dirname, "..", "addsite-batch.ts"), "utf8");
  const body = src.slice(src.indexOf("async function cmdVerifyJobIds"), src.indexOf("// Playwright-backed probes"));
  assert(/scriptIdRules\(/.test(body), "verify-jobids calls scriptIdRules");
  assert(/hardFails\.push\(\.\.\.scriptRules\.fail\)/.test(body), "its failures are hard failures");
  assert(/warnings\.push\(\.\.\.scriptRules\.warn\)/.test(body), "its warnings are warnings");
  assert(/onboardingSkill === "addsite3"/.test(body), "tagged means onboardingSkill addsite3");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("verifyJobIds: an addsite3 script that hashes or skips fails; an untagged one warns");
