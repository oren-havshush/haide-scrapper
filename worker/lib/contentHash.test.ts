// Run: npx tsx worker/lib/contentHash.test.ts
//
// Job.contentHash for the public site (owner, 2026-10-08): SHA-256 hex,
// lowercase, 64 characters, over the row's title trimmed, a newline, and its
// description trimmed ("" when NULL). A pure function of the row; nothing is
// carried. Plus the wiring: buildJobRows sets it from the values it writes.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobContentHash } from "./contentHash";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function eq<T>(actual: T, expected: T, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  assert(ok, msg);
}

const TITLE = "Sales Manager";
const DESC = "Leads the northern region team.";
const h = jobContentHash(TITLE, DESC);

eq(jobContentHash(TITLE, DESC), h, "the same title and description give the same hash twice");
assert(/^[0-9a-f]{64}$/.test(h), `64 lowercase hex characters (${h})`);
assert(jobContentHash("Sales Managers", DESC) !== h, "a one-character change in the title moves it");
assert(jobContentHash(TITLE, "Leads the northern region teams.") !== h, "a one-character change in the description moves it");
eq(jobContentHash(TITLE, null), jobContentHash(TITLE, ""), "a NULL description and an empty one give the same hash");
eq(jobContentHash(`  ${TITLE}\n`, ` ${DESC}  `), h, "both values are trimmed first");
// The separator keeps the two fields apart: moving text across the boundary moves the hash.
assert(jobContentHash("ab", "c") !== jobContentHash("a", "bc"), "the newline separates title from description");

// A Hebrew pair, hashed from its UTF-8 bytes. The expected value is computed
// here by node's crypto from the spec, not pasted.
const HE_TITLE = "מנהל/ת מכירות";
const HE_DESC = "ניהול צוות באזור הצפון.";
const expected = createHash("sha256").update(Buffer.from(`${HE_TITLE}\n${HE_DESC}`, "utf8")).digest("hex");
eq(jobContentHash(HE_TITLE, HE_DESC), expected, "a Hebrew pair: SHA-256 of the UTF-8 bytes of title, newline, description");
const utf16 = createHash("sha256").update(Buffer.from(`${HE_TITLE}\n${HE_DESC}`, "utf16le")).digest("hex");
assert(jobContentHash(HE_TITLE, HE_DESC) !== utf16, "and not of its UTF-16 bytes");

// --- the wiring: buildJobRows writes it, from the values it writes ------------------
{
  const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const start = src.indexOf("function buildJobRows(");
  const end = src.indexOf("\n}\n", start);
  const body = start >= 0 && end > start ? src.slice(start, end) : "";
  assert(body.length > 0, "scrape.ts has buildJobRows");
  assert(/contentHash: jobContentHash\(title, description\)/.test(body), "buildJobRows sets contentHash from the title and description it writes");
  assert(/title,\s*\n\s*description,/.test(body), "and writes those same two values to the row");
  assert(/import \{ jobContentHash \} from "\.\.\/lib\/contentHash";/.test(src), "scrape.ts imports jobContentHash");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("contentHash: all assertions passed");
