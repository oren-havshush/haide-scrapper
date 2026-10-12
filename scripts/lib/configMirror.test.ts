// Run: npx tsx scripts/lib/configMirror.test.ts
//
// The config export's write rules (developer report, 2026-10-12): a per-site
// export leaves INDEX.md alone and touches only that site's files; a full
// export refuses to overwrite a mirror file whose config is newer than the one
// it would write, and does not rewrite a file whose only change is _exportedAt.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planMirrorWrite, writesIndex, type MirrorDoc } from "./configMirror";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const doc = (savedAt: string, exportedAt: string, extra: Record<string, unknown> = {}): MirrorDoc => ({
  _exportedAt: exportedAt,
  id: "site1",
  fieldMappings: { title: { selector: ".t" }, _meta: { savedAt } },
  ...extra,
});
const text = (d: MirrorDoc) => JSON.stringify(d, null, 2) + "\n";

// Another session exported a config saved at 12:00 and has not committed it;
// this export fetched the config as saved at 10:00.
assert(
  planMirrorWrite(text(doc("2026-10-12T12:00:00Z", "2026-10-12T12:01:00Z")), "a()", doc("2026-10-12T10:00:00Z", "2026-10-12T12:30:00Z"), "a()") === "refuse_newer",
  "a mirror file from a newer config is not overwritten",
);
// The same config, exported again: nothing but _exportedAt would change.
assert(
  planMirrorWrite(text(doc("2026-10-12T10:00:00Z", "2026-10-12T11:00:00Z")), "a()", doc("2026-10-12T10:00:00Z", "2026-10-12T12:30:00Z"), "a()") === "skip_identical",
  "a file whose only change is _exportedAt is left alone",
);
// A newer config than the file: written, as today.
assert(
  planMirrorWrite(text(doc("2026-10-12T10:00:00Z", "2026-10-12T11:00:00Z")), "a()", doc("2026-10-12T12:00:00Z", "2026-10-12T12:30:00Z"), "b()") === "write",
  "a file from an older config is overwritten",
);
// The same savedAt but a different setup script: written.
assert(
  planMirrorWrite(text(doc("2026-10-12T10:00:00Z", "2026-10-12T11:00:00Z")), "a()", doc("2026-10-12T10:00:00Z", "2026-10-12T12:30:00Z"), "b()") === "write",
  "a changed setup script is written",
);
assert(planMirrorWrite(null, null, doc("2026-10-12T10:00:00Z", "x"), null) === "write", "a new site is written");
assert(planMirrorWrite("{not json", null, doc("2026-10-12T10:00:00Z", "x"), null) === "write", "an unreadable file is written over");

// INDEX.md: only the full export regenerates it.
assert(writesIndex({ oneSite: "cmabc" }) === false, "a per-site export leaves INDEX.md alone");
assert(writesIndex({ oneSite: undefined }) === true, "a full export regenerates INDEX.md");

// The script is wired to both rules.
const src = readFileSync(join(__dirname, "..", "export-site-configs.ts"), "utf8");
assert(/planMirrorWrite\(/.test(src), "export-site-configs.ts plans each write");
assert(/if \(!dryRun && writesIndex\(\{ oneSite \}\)\)/.test(src), "INDEX.md is written only when writesIndex says so");
assert(!/--site regenerates INDEX\.md from ONLY that site/.test(src), "the old LRN-API-4 caution is gone from the header");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("configMirror: a per-site export leaves the index alone; a full export never overwrites a newer mirror");
