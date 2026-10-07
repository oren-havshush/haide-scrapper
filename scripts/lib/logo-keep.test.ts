// Run: npx tsx scripts/lib/logo-keep.test.ts
//
// Owner, 2026-10-07: the capture must not replace a stored logo. oneline's
// hand-set header logo (247x44, stored through the operator route under the
// 32 px floor) fails the automatic 64 px floor, so a capture went on to the
// next candidate that passed, Hurt.png (a sector illustration whose alt text
// says "לוגו"), and would have replaced it. A stored logo is now kept unless
// --replace-logo is given; --force alone does not replace it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keepStoredLogo, type LogoStepOutcome } from "./logo-keep";

let failures = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL: ${msg}\n  got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
    failures++;
  }
}

const STORED = {
  companyLogoPath: "/logos/cmqkpv5d0001701p6r8dqdxkb.png",
  companyLogoSourceUrl:
    "https://oneline.co.il/wp-content/uploads/2026/01/OneLine_Main_logo_4x_1-removebg-preview-1.png",
};

// The capture's logo step, stubbed: the hand-set file is refused at 64 px and
// the next candidate passes and is uploaded — what the oneline dry run showed.
function passingCandidate() {
  let calls = 0;
  const run = async (): Promise<LogoStepOutcome> => {
    calls++;
    return {
      logoPath: "/logos/cmqkpv5d0001701p6r8dqdxkb.png",
      sourceUrl: "https://oneline.co.il/wp-content/uploads/2026/01/Hurt.png",
      candidateUrl: "https://oneline.co.il/wp-content/uploads/2026/01/Hurt.png",
      visibility: null,
      attempts: [
        { url: STORED.companyLogoSourceUrl, source: "header-img", result: "rejected (too_small_dimensions)" },
        { url: "https://oneline.co.il/wp-content/uploads/2026/01/Hurt.png", source: "header-img", result: "uploaded" },
      ],
    };
  };
  return { run, calls: () => calls };
}

async function main() {
  // 1. A stored logo and a passing candidate: kept, and the step never runs.
  {
    const c = passingCandidate();
    const out = await keepStoredLogo(STORED, false, c.run);
    eq(out.logoPath, STORED.companyLogoPath, "a stored logo keeps its path");
    eq(out.sourceUrl, STORED.companyLogoSourceUrl, "and its source URL");
    eq(out.kept, true, "and says it was kept");
    eq(c.calls(), 0, "the logo step does not run at all (nothing is fetched or uploaded)");
    eq(out.attempts, [{ url: STORED.companyLogoSourceUrl, source: "stored", result: "kept the stored logo" }], "the attempt log says so");
  }

  // 2. The same site with --replace-logo: the candidate.
  {
    const c = passingCandidate();
    const out = await keepStoredLogo(STORED, true, c.run);
    eq(out.sourceUrl, "https://oneline.co.il/wp-content/uploads/2026/01/Hurt.png", "--replace-logo gets the candidate");
    eq(out.kept, undefined, "and is not marked kept");
    eq(c.calls(), 1, "the logo step runs once");
  }

  // 3. No stored logo: the candidate, as before.
  for (const none of [{}, { companyLogoPath: null, companyLogoSourceUrl: null }]) {
    const c = passingCandidate();
    const out = await keepStoredLogo(none, false, c.run);
    eq(out.sourceUrl, "https://oneline.co.il/wp-content/uploads/2026/01/Hurt.png", `no stored logo (${JSON.stringify(none)}) gets the candidate`);
    eq(c.calls(), 1, "the logo step runs");
  }

  // A stored inline-svg logo has a path and no source URL: still kept.
  {
    const c = passingCandidate();
    const out = await keepStoredLogo({ companyLogoPath: "/logos/x.png", companyLogoSourceUrl: null }, false, c.run);
    eq([out.logoPath, out.sourceUrl, out.kept, c.calls()], ["/logos/x.png", null, true, 0], "a stored logo with no source URL is kept too");
  }

  // --- wiring in scripts/company-profile.ts ----------------------------------
  const src = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  const capture = src.slice(src.indexOf("async function captureSite("), src.indexOf("async function writeProfile("));
  const direct = capture.match(/await captureLogo\(/g) ?? [];
  const wrapped = capture.match(/keepStoredLogo\(\s*site,\s*opts\.replaceLogo,\s*\(\)\s*=>\s*captureLogo\(/g) ?? [];
  eq(wrapped.length, 2, "both logo steps in captureSite (homepage and careers board) go through keepStoredLogo");
  eq(direct.length, 0, "and neither calls captureLogo directly");
  eq(/const replaceLogo = flag\("replace-logo"\);/.test(src), true, "--replace-logo is its own flag");
  eq(/replaceLogo\s*=\s*[^;]*force/.test(src), false, "--force does not imply --replace-logo");
  eq(/companyLogoPath\?: string \| null;/.test(src.slice(src.indexOf("interface SiteRow"), src.indexOf("interface SiteConfigResponse"))), true, "SiteRow carries the stored logo path");
  eq(/console\.log\(`\[company-profile\]   NOTE \$\{note\}`\)/.test(src), true, "notes are printed, in the dry run and the real run alike");

  const skill = readFileSync(join(__dirname, "..", "..", "company-profile.md"), "utf8");
  eq(/--replace-logo/.test(skill), true, "the skill says a stored logo is kept unless --replace-logo is given");

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("logo-keep: a stored logo is kept unless --replace-logo; --force alone keeps it");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
