/**
 * Tests for the shared challenge/block detection (scripts/lib/challenge-detect.ts).
 *
 * Run: npx tsx scripts/lib/challenge-detect.test.ts
 * Exits non-zero on the first failure.
 *
 * Fixtures are the real documents from the incidents that motivated this
 * module: LRN-WAF-6 (career.rafael.co.il Reblaze stub), LRN-WAF-5
 * (tikshoov.co.il Imperva block page) and www.ono.ac.il, an ACTIVE site whose
 * HEALTHY pages carry Incapsula plumbing. The Reblaze seed is truncated — it is
 * a per-session token and its value is irrelevant to detection.
 *
 * Each "alone" case is built so that only the rule under test can fire (past
 * the size floor, ordinary status), because the first draft of this file passed
 * with the Incapsula rule deleted: the size backstop was quietly catching a
 * 223-byte fixture and masking it.
 */
import {
  classifyResponse,
  MIN_REAL_HTML_BYTES,
  REBLAZE_BOOTSTRAP_RE,
  INCAPSULA_BOOTSTRAP_RE,
} from "./challenge-detect";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PAD = "<!--" + "padding ".repeat(400) + "-->"; // ~3.2 KB, no anchors

// --- fixtures --------------------------------------------------------------

/** career.rafael.co.il, 2026-09-22. Served under HTTP 247. Note: no "reblaze". */
const REBLAZE_STUB =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<script type="text/javascript" src="/kramericaindustries.ac_v2.lib.js"></script>' +
  '<script type="text/javascript">\n;;window.rbzns={"protocol":"https:","bereshit":"1",' +
  '"location_host":"career.rafael.co.il","seed":"NbfitBABuUI00UQPEXwpaRUZI","storage":3};' +
  "winsocks();</script></head><body></body></html>";

/** Reblaze bootstrap, padded past the floor, still no real content. */
const REBLAZE_SHELL_LARGE =
  '<!DOCTYPE html><html><head><script src="/x.ac_v2.lib.js"></script>' +
  '<script>;;window.rbzns={"protocol":"https:"};winsocks();</script></head><body>' +
  PAD +
  "</body></html>";

/** Imperva/Incapsula HeadlessChrome block page (tikshoov.co.il shape). */
const INCAPSULA_BLOCK =
  "<html><head><title>tikshoov.co.il</title></head><body>" +
  "<iframe src='/_Incapsula_Resource?CWUDNSAI=9'></iframe>" +
  "<div>Request unsuccessful. Incapsula incident ID: 1234-567890123456789-987654321</div>" +
  "</body></html>";

/** Same block page past the size floor and anchored: only block-text can catch it. */
const INCAPSULA_BLOCK_LARGE =
  "<html><head><title>tikshoov.co.il</title></head><body>" +
  "<div>Request unsuccessful. Incapsula incident ID: 1234-567890123456789-987654321</div>" +
  '<a href="/">home</a>' +
  PAD +
  "</body></html>";

/**
 * THE FALSE POSITIVE THIS MODULE MUST NOT REGRESS ON.
 * www.ono.ac.il is ACTIVE and healthy: from the worker it returns HTTP 200,
 * 314 KB and 501 anchors — and its HTML still contains `_Incapsula_Resource`,
 * because Imperva fronts the whole site. A bare-marker rule REDs it.
 */
const INCAPSULA_HEALTHY_PAGE =
  "<!DOCTYPE html><html><head><title>Careers</title>" +
  '<script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e"></script>' +
  "</head><body>" +
  Array.from({ length: 40 }, (_, i) => `<a href="/job/${i}">Job ${i}</a>`).join("") +
  PAD +
  "</body></html>";

const CLOUDFLARE_INTERSTITIAL =
  "<html><head><title>Just a moment...</title></head><body>" +
  "<div>Checking your browser before accessing the site.</div></body></html>";

/** A real (small) listing page: short, but has anchors and a normal status. */
const REAL_LISTING =
  "<!DOCTYPE html><html><head><title>Careers</title></head><body><table>" +
  Array.from(
    { length: 12 },
    (_, i) =>
      `<tr class="data-row"><td><a class="jobTitle-link" href="/job/tel-aviv/eng/${1000 + i}/">Engineer ${i}</a></td>` +
      `<td><span class="jobLocation">Tel Aviv</span></td></tr>`,
  ).join("") +
  "</table></body></html>";

// --- the regressions this module exists to prevent -------------------------

console.log("Reblaze (LRN-WAF-6):");
{
  const v = classifyResponse(REBLAZE_STUB, 247);
  check("581-byte ac_v2 stub is challenged", v.challenged, `reason=${v.reason}`);
  check(
    "the stub does NOT contain the literal string 'reblaze'",
    !/reblaze/i.test(REBLAZE_STUB),
    "fixture drifted — the old marker-only rule would pass again",
  );
  check("REBLAZE_BOOTSTRAP_RE matches rbzns/winsocks/ac_v2", REBLAZE_BOOTSTRAP_RE.test(REBLAZE_STUB));

  // Bootstrap rule in isolation: past the floor, ordinary status, so neither
  // the size backstop nor the status rule can rescue it.
  const big = classifyResponse(REBLAZE_SHELL_LARGE, 200);
  check("large contentless Reblaze shell is challenged", big.challenged, `reason=${big.reason}`);
  check("and the reason is the Reblaze bootstrap", big.reason === "reblaze-bootstrap", `reason=${big.reason}`);
  check("fixture really is past the floor", REBLAZE_SHELL_LARGE.length > MIN_REAL_HTML_BYTES);

  // The exact failure reach hit: 247 < 400, so a naive status check passed it.
  const statusOnly = classifyResponse('<html><body><a href="/x">x</a>' + PAD + "</body></html>", 247);
  check("HTTP 247 alone is challenged on an otherwise normal page", statusOnly.challenged, `reason=${statusOnly.reason}`);
  check(
    "and the reason names the status",
    statusOnly.reason === "nonstandard-status-247",
    `reason=${statusOnly.reason}`,
  );
}

console.log("Incapsula reaching reach/triage (LRN-WAF-5):");
{
  const v = classifyResponse(INCAPSULA_BLOCK, 200);
  check("Imperva block page is challenged", v.challenged, `reason=${v.reason}`);
  check("credited to block text", v.reason === "block-text", `reason=${v.reason}`);

  // Past the floor AND anchored, so only the block-text rule can fire.
  const big = classifyResponse(INCAPSULA_BLOCK_LARGE, 200);
  check("large anchored Imperva block page is challenged by BLOCK TEXT alone", big.challenged, `reason=${big.reason}`);
  check("and the reason is block-text", big.reason === "block-text", `reason=${big.reason}`);
  check("fixture really is past the floor", INCAPSULA_BLOCK_LARGE.length > MIN_REAL_HTML_BYTES);
}

console.log("Healthy WAF-fronted page must NOT be flagged (ono.ac.il):");
{
  const v = classifyResponse(INCAPSULA_HEALTHY_PAGE, 200);
  check("healthy page carrying _Incapsula_Resource is NOT challenged", !v.challenged, `reason=${v.reason}`);
  check(
    "fixture really does carry the Incapsula marker",
    INCAPSULA_BOOTSTRAP_RE.test(INCAPSULA_HEALTHY_PAGE),
    "fixture drifted — it no longer reproduces the false positive",
  );
  check("fixture really has anchors", /<a[\s>]/.test(INCAPSULA_HEALTHY_PAGE));
}

console.log("Generic interstitials still caught:");
{
  const v = classifyResponse(CLOUDFLARE_INTERSTITIAL, 503);
  check("Cloudflare 'Just a moment' is challenged", v.challenged, `reason=${v.reason}`);
}

console.log("Size backstop for WAFs we have not seen:");
{
  const unknownStub = "<html><head></head><body></body></html>";
  const v = classifyResponse(unknownStub, 200);
  check("tiny anchorless doc with no known marker is challenged", v.challenged, `reason=${v.reason}`);
  check("reason names the size", (v.reason || "").startsWith("stub-"), `reason=${v.reason}`);
}

console.log("No false positives on real pages:");
{
  const v = classifyResponse(REAL_LISTING, 200);
  check("a real listing is NOT challenged", !v.challenged, `reason=${v.reason}`);

  // A short page is fine as long as it has links — the floor needs BOTH.
  const shortButReal = '<html><body><a href="/job/1">Job</a></body></html>';
  check(
    "short page WITH anchors is not challenged",
    !classifyResponse(shortButReal, 200).challenged,
    "the size floor must require an anchorless document",
  );
  check("fixture is genuinely under the floor", shortButReal.length < MIN_REAL_HTML_BYTES);

  check("redirect 301 is not challenged", !classifyResponse(REAL_LISTING, 301).challenged);
  check("404 is left to the caller's status check", !classifyResponse(REAL_LISTING, 404).challenged);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll challenge-detect checks passed.");
