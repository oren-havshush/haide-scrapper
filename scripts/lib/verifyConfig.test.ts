// Run: npx tsx scripts/lib/verifyConfig.test.ts
//
// addsite2 phase two, step 5 (g): verify-config could not see the setupScript,
// so an over-cap or truncated one looked saved. `--expect-setup-script <file>`
// compares the stored script with the file byte for byte.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareSetupScript } from "./verifyConfig";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const SCRIPT = "for (const item of document.querySelectorAll('.card')) {\n  item.dataset.x = 'כהנא';\n}\n";

{
  const r = compareSetupScript(SCRIPT, SCRIPT);
  assert(r.ok, "the same script: ok");
}
{
  const r = compareSetupScript(SCRIPT, SCRIPT.slice(0, 40));
  assert(!r.ok && r.detail.includes("40") && r.detail.includes(String(Buffer.byteLength(SCRIPT))), `a truncated store fails, naming both byte lengths (${r.detail})`);
}
{
  const r = compareSetupScript(SCRIPT, null);
  assert(!r.ok && /no setupScript/i.test(r.detail), `nothing stored fails (${r.detail})`);
}
{
  const changed = SCRIPT.replace("כהנא", "כהנה");
  const r = compareSetupScript(SCRIPT, changed);
  assert(!r.ok && /byte \d+/.test(r.detail), `one changed character fails, naming the first differing byte (${r.detail})`);
}
{
  const r = compareSetupScript(SCRIPT, SCRIPT.replace(/\n/g, "\r\n"));
  assert(!r.ok, "line endings are bytes too: CRLF vs LF fails");
}

// Wiring: verify-config reads the flag and fails on a mismatch.
{
  const src = readFileSync(join(__dirname, "..", "addsite-batch.ts"), "utf8");
  const body = src.slice(src.indexOf("async function cmdVerifyConfig"), src.indexOf("// Command: verify-jobids"));
  assert(/flagStr\(flags, "expect-setup-script"\)/.test(body), "verify-config reads --expect-setup-script");
  assert(/compareSetupScript\(/.test(body), "and compares through compareSetupScript");
  assert(/setupScriptOk/.test(body) && /itemOk && fieldsOk && formOk && listingUrlsOk && setupScriptOk/.test(body), "a mismatch fails the verdict");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("verifyConfig: the stored setupScript is compared byte for byte");
