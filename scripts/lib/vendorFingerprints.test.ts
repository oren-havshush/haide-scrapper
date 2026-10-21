// Run: npx tsx scripts/lib/vendorFingerprints.test.ts
//
// Report fixes 3, item 11 (the developer's 2026-10-19 to 20 report, items 6
// and 9, and her 2026-10-21 report):
//   - a "|" in an INDEX.md cell is written "\|" (Gal HR's name split its row);
//   - every recipe triage names exists under addsite3-recipes/, with an anchor
//     that resolves there (it named recipes/..., a folder that does not exist);
//   - four fingerprints: Top Match (every tenant on careers.topmatch.co.il),
//     AdamTotal (its host, and behind an employer's own front end), Wix (the
//     Wix Blog board), BambooHR (<tenant>.bamboohr.com);
//   - triage reports a redirect as a redirect, with the final host.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..", "..");
const batch = readFileSync(join(ROOT, "scripts", "addsite-batch.ts"), "utf8");

// --- recipe paths: read from the source, so a path anywhere is checked (HEAD lacks these) --------
const libPath = join(__dirname, "vendorFingerprints.ts");
const lib = existsSync(libPath) ? readFileSync(libPath, "utf8") : "";
{
  assert(!/["'`]recipes\//.test(batch) && !/["'`]recipes\//.test(lib), "no recipe path starts with the folder that does not exist");
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens; or its {#id}. */
function anchorsOf(md: string): Set<string> {
  const out = new Set<string>();
  for (const line of md.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const explicit = /\{#([\w-]+)\}\s*$/.exec(m[1]);
    if (explicit) out.add(explicit[1]);
    const text = m[1].replace(/\{#[\w-]+\}\s*$/, "").trim();
    out.add(text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-"));
  }
  return out;
}

(async () => {
  const { mdCell } = await import("./configMirror");
  const { DOM_RECIPES, domVendorSignal, fingerprintByHost, knownIframeHost, redirectOf } = await import("./vendorFingerprints");

  // --- the pipe -----------------------------------------------------------------------------------
  assert(mdCell("Gal HR | גל אייץ׳ אר") === "Gal HR \\| גל אייץ׳ אר", `a pipe is escaped (got ${mdCell("Gal HR | גל אייץ׳ אר")})`);
  assert(mdCell("a|b|c") === "a\\|b\\|c" && mdCell("plain") === "plain", "every pipe, and nothing else");
  const exp = readFileSync(join(ROOT, "scripts", "export-site-configs.ts"), "utf8");
  assert(/cells\.map\(mdCell\)/.test(exp), "the index writes every cell through mdCell");

  // --- every recipe named resolves on disk ---------------------------------------------------------------
  const named = new Set<string>();
  for (const src of [lib, batch]) for (const m of src.matchAll(/addsite3-recipes\/[\w.-]+\.md(?:#[\w-]+)?/g)) named.add(m[0]);
  for (const h of ["x.myworkdayjobs.com", "boards.greenhouse.io", "jobs.lever.co", "www.comeet.com", "x.icims.com", "jobs.smartrecruiters.com", "jobs.ashbyhq.com", "app.civi.co.il", "careers.topmatch.co.il"]) {
    const r = fingerprintByHost(h)?.recipe;
    if (r) named.add(r);
  }
  for (const r of Object.values(DOM_RECIPES)) named.add(r);
  assert(named.size >= 10, `the recipes were found (${named.size})`);
  for (const ref of named) {
    const [file, anchor] = ref.split("#");
    const p = join(ROOT, file!);
    if (!existsSync(p)) {
      assert(false, `${ref}: no such file`);
      continue;
    }
    if (anchor) assert(anchorsOf(readFileSync(p, "utf8")).has(anchor), `${ref}: no heading for #${anchor}`);
  }

  // --- one host per fingerprint ---------------------------------------------------------------------
  assert(fingerprintByHost("careers.topmatch.co.il")?.vendor === "topmatch", "Top Match's portal");
  assert(fingerprintByHost("career.adamtotal.co.il")?.vendor === "adamtotal" && fingerprintByHost("railcareer.adamtotal.co.il")?.vendor === "adamtotal", "AdamTotal's boards");
  assert(fingerprintByHost("dbil.bamboohr.com")?.vendor === "bamboohr", "a BambooHR tenant");
  assert(fingerprintByHost("www.comeet.com")?.vendor === "comeet" && knownIframeHost("app.civi.co.il")?.vendor === "civi", "the old ones still");
  assert(fingerprintByHost("www.shlomo.co.il") === null && fingerprintByHost("bamboohr.com.evil.test") === null, "an employer's host is not a vendor");
  const front = `<html><script>fetch("https://career.adamtotal.co.il/api/jobs?c=shlomo")</script></html>`;
  assert(domVendorSignal(front)?.vendor === "adamtotal", "AdamTotal behind the employer's own front end");
  const wixBlog = `<meta name="generator" content="Wix.com Website Builder"><a href="https://www.tema.co.il/post/מהנדס-ת">x</a>`;
  assert(domVendorSignal(wixBlog)?.vendor === "wix-blog" && /#wix$/.test(domVendorSignal(wixBlog)?.recipe ?? ""), "a Wix Blog board");
  assert(domVendorSignal(`<img src="https://static.wixstatic.com/media/a.png">`)?.vendor === "wix", "a Wix site without a blog");
  assert(domVendorSignal("<html><body>WordPress</body></html>") === null, "nothing on an ordinary page");

  // --- the redirect ---------------------------------------------------------------------------------
  const r = redirectOf("https://www.dbisrael.co.il/careers", "https://dbil.bamboohr.com/careers?source=site");
  assert(r?.host === "dbil.bamboohr.com", `a redirect to another host is reported with the final host (got ${JSON.stringify(r)})`);
  assert(redirectOf("https://isracard.co.il/careers", "https://www.isracard.co.il/he/careers") === null, "a www. alone is not a redirect");
  const triage = batch.slice(batch.indexOf("async function cmdTriage("), batch.indexOf("// fix — one site's config fix"));
  assert(/redirect: \{ from: url, to: redirect\.to, host: redirect\.host \}/.test(triage), "triage's output carries the redirect");
  assert(/fingerprintByHost\(redirect\?\.host \?\? host\)/.test(triage), "and fingerprints the host it landed on");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("vendorFingerprints: pipes escaped, every recipe resolves, four vendors known, redirects reported");
})().catch((e) => {
  console.error(`FAIL: vendorFingerprints test threw — ${(e as Error).message}`);
  process.exit(1);
});
