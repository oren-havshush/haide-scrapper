// Run: npx tsx src/lib/logoFloor.test.ts
//
// The logo dimension floor (owner, 2026-10-06). The automatic capture keeps
// 64 px — the rule that keeps favicons out of the logo store. A logo an
// operator uploads by hand through the company-logo route, marked with
// `x-logo-provenance: operator`, has a 32 px floor on the short side: a human
// looked at it. Magic bytes, format and size caps are the same on both paths.
//
// Fixture: oneline.co.il's real header logo, byte for byte
// (OneLine_Main_logo_4x_1-removebg-preview-1.png, 247x44, 9,953 bytes). The
// site publishes no larger version, and the 64 px floor refused it in dry run 3.

import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function reason(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { reason?: string }).reason ?? (e as Error).message;
  }
}

(async () => {
  // The logo store writes under COMPANY_LOGO_DIR, read at import time.
  process.env.COMPANY_LOGO_DIR = mkdtempSync(join(tmpdir(), "logo-floor-"));
  const { inspectImage, MIN_LOGO_DIMENSION, OPERATOR_MIN_LOGO_DIMENSION } = await import("./image-validate");
  const { storeLogo } = await import("./logo-store");

  const oneline = new Uint8Array(readFileSync(join(__dirname, "fixtures", "oneline-logo-247x44.png")));

  // The automatic path: refused, as in dry run 3.
  assert(MIN_LOGO_DIMENSION === 64, "the automatic floor stays 64");
  assert(reason(() => inspectImage(oneline, "image/png")) === "too_small_dimensions", "automatic: 247x44 is refused");

  // The operator floor.
  assert(OPERATOR_MIN_LOGO_DIMENSION === 32, "the operator floor is 32");
  const op = reason(() => inspectImage(oneline, "image/png", { minDimension: OPERATOR_MIN_LOGO_DIMENSION }));
  assert(op === null, `operator: 247x44 is accepted (got ${op})`);

  // 247x20, same bytes with the PNG header's height set to 20: under 32 on
  // either path, and a floor asked for below 32 is clamped up to it.
  const short = oneline.slice();
  new DataView(short.buffer).setUint32(20, 20);
  assert(reason(() => inspectImage(short, "image/png", { minDimension: OPERATOR_MIN_LOGO_DIMENSION })) === "too_small_dimensions", "operator: 247x20 is refused");
  assert(reason(() => inspectImage(short, "image/png", { minDimension: 1 })) === "too_small_dimensions", "no floor below 32 can be asked for");

  // Everything else is unchanged on the operator path.
  const notPng = oneline.slice();
  notPng[0] = 0;
  assert(reason(() => inspectImage(notPng, "image/png", { minDimension: OPERATOR_MIN_LOGO_DIMENSION })) === "unsupported_format", "magic bytes still checked");
  assert(reason(() => inspectImage(oneline, "image/jpeg", { minDimension: OPERATOR_MIN_LOGO_DIMENSION })) === "content_type_mismatch", "Content-Type still checked");

  // storeLogo: the operator flag reaches the gate; without it, the floor is 64.
  const siteId = "cmqkpv5d0001701p6r8dqdxkb";
  let automatic: string | null = null;
  try {
    await storeLogo(siteId, oneline, "image/png");
  } catch (e) {
    automatic = (e as Error).message;
  }
  assert(automatic !== null && automatic.includes("too_small_dimensions"), "storeLogo without operator refuses 247x44");
  const stored = await storeLogo(siteId, oneline, "image/png", { operator: true });
  assert(stored.inspection.width === 247 && stored.inspection.height === 44, "storeLogo with operator stores 247x44");
  assert(existsSync(join(process.env.COMPANY_LOGO_DIR!, `${siteId}.png`)), "and writes the file");
  assert(Buffer.compare(readFileSync(join(process.env.COMPANY_LOGO_DIR!, `${siteId}.png`)), Buffer.from(oneline)) === 0, "byte for byte unchanged");

  // The route sets operator only from the header; the capture never sends it.
  const route = readFileSync(join(__dirname, "..", "app", "api", "sites", "[id]", "company-logo", "route.ts"), "utf8");
  assert(/headers\.get\("x-logo-provenance"\) === "operator"/.test(route), "the route reads x-logo-provenance: operator");
  assert(/storeLogo\(id, bytes, contentType, \{ operator \}\)/.test(route), "and passes it to storeLogo");
  const capture = readFileSync(join(__dirname, "..", "..", "scripts", "company-profile.ts"), "utf8");
  assert(!capture.includes("x-logo-provenance"), "the automatic capture never marks its uploads as operator");

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("logoFloor: 64 px automatic, 32 px for an operator upload, everything else unchanged");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
