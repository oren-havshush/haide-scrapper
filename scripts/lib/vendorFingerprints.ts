/**
 * Triage's vendor fingerprints (scripts/addsite-batch.ts fingerprint and
 * triage), moved here from the batch script so they can be tested (report
 * fixes 3, item 11).
 *
 * Every recipe named is a file under addsite3-recipes/ with an anchor that
 * resolves there (scripts/lib/vendorFingerprints.test.ts checks each): triage
 * named spa-frameworks.md#comeet under a recipes/ folder that does not exist
 * (the developer's 2026-10-19 to 20 report, item 9). A vendor with no recipe
 * yet names none rather than a guess.
 *
 * Kept in sync with src/lib/ats-hosts.ts, the one vendor list for identity.
 */

export type VendorFingerprint = { vendor: string; recipe: string | null };

const SPA = "addsite3-recipes/spa-frameworks.md";
/** form-capture.md §9, the only Top Match text in the recipes (its apply pages). */
const TOPMATCH_RECIPE = "addsite3-recipes/form-capture.md#9-redmatch--topmatch-apply-pages--no-form-element-bare-inputs-by-css-class";

export function fingerprintByHost(host: string): VendorFingerprint | null {
  const h = host.toLowerCase();
  if (h.endsWith("myworkdayjobs.com") || h.includes(".myworkdayjobs."))
    return { vendor: "workday", recipe: `${SPA}#workday` };
  if (h.endsWith("greenhouse.io") || h.includes("boards.greenhouse"))
    return { vendor: "greenhouse", recipe: `${SPA}#greenhouse` };
  if (h.endsWith("lever.co")) return { vendor: "lever", recipe: `${SPA}#lever` };
  if (h.includes("comeet.com") || h.endsWith("comeet.co"))
    return { vendor: "comeet", recipe: `${SPA}#comeet` };
  if (h.includes("icims.com")) return { vendor: "icims", recipe: `${SPA}#icims` };
  if (h.includes("smartrecruiters.com"))
    return { vendor: "smartrecruiters", recipe: `${SPA}#smartrecruiters` };
  if (h.includes("ashbyhq.com")) return { vendor: "ashby", recipe: `${SPA}#ashby` };
  // Civi board host (app.civi.co.il/promos/...). Onboarding the board URL directly
  // fingerprints GREEN → #civi recipe (listing-only setupScript, no skeleton). LRN-SPA-8.
  if (h.endsWith("civi.co.il")) return { vendor: "civi", recipe: `${SPA}#civi` };
  // Top Match's portal: every tenant is a path on careers.topmatch.co.il
  // (midrag, Analyst, tadiran), two of them live (the developer's reports,
  // 2026-10-19 to 20 and 2026-10-21).
  if (h === "careers.topmatch.co.il" || h.endsWith(".topmatch.co.il")) return { vendor: "topmatch", recipe: TOPMATCH_RECIPE };
  // AdamTotal's boards (career.adamtotal.co.il, railcareer.adamtotal.co.il);
  // the same board behind an employer's own front end is found in the page
  // (domVendorSignal). No recipe yet.
  if (h === "adamtotal.co.il" || h.endsWith(".adamtotal.co.il")) return { vendor: "adamtotal", recipe: null };
  // BambooHR: <tenant>.bamboohr.com, list and detail JSON (LRN-SPA-36). No recipe yet.
  if (h.endsWith(".bamboohr.com")) return { vendor: "bamboohr", recipe: null };
  return null;
}

// Known ATS hosts that a company careers page commonly embeds via <iframe>.
const ATS_IFRAME_HOSTS: { re: RegExp; vendor: string; recipe: string }[] = [
  { re: /(^|\.)myworkdayjobs\.com$/i, vendor: "workday", recipe: `${SPA}#workday` },
  { re: /(^|\.)greenhouse\.io$/i, vendor: "greenhouse", recipe: `${SPA}#greenhouse` },
  { re: /(^|\.)lever\.co$/i, vendor: "lever", recipe: `${SPA}#lever` },
  { re: /(^|\.)comeet\.(com|co)$/i, vendor: "comeet", recipe: `${SPA}#comeet` },
  { re: /(^|\.)icims\.com$/i, vendor: "icims", recipe: `${SPA}#icims` },
  { re: /(^|\.)smartrecruiters\.com$/i, vendor: "smartrecruiters", recipe: `${SPA}#smartrecruiters` },
  { re: /(^|\.)ashbyhq\.com$/i, vendor: "ashby", recipe: `${SPA}#ashby` },
  // Civi boards are commonly embedded in a company careers page via a cross-origin
  // <iframe src="https://app.civi.co.il/promos/id=...&src=...">. LRN-SPA-8.
  { re: /(^|\.)civi\.co\.il$/i, vendor: "civi", recipe: `${SPA}#civi` },
];

/** A host on ATS_IFRAME_HOSTS, with its vendor and recipe, or null. */
export function knownIframeHost(host: string): { vendor: string; recipe: string } | null {
  const a = ATS_IFRAME_HOSTS.find((x) => x.re.test(host));
  return a ? { vendor: a.vendor, recipe: a.recipe } : null;
}

/** The recipes the DOM sniffs name, by vendor. */
export const DOM_RECIPES = {
  greenhouse: `${SPA}#greenhouse`,
  comeet: `${SPA}#comeet`,
  lever: `${SPA}#lever`,
  elementor: "addsite3-recipes/setupscript-patterns.md#4-elementor-popups",
} as const;

/**
 * Vendors read from the page, not the host (report fixes 3, item 11):
 *   - Wix: the site builder's generator tag or its static hosts; a Wix Blog
 *     board when the page links blog posts (/post/<slug>) or carries the
 *     blog's post-list hooks (tema.co.il: 28 posts, 2 seen before scrolling);
 *   - AdamTotal behind the employer's own front end: the page calls or links
 *     its board host (shlomo.co.il).
 */
export function domVendorSignal(html: string): (VendorFingerprint & { signal: string }) | null {
  if (!html) return null;
  if (/adamtotal\.co\.il/i.test(html)) {
    return { vendor: "adamtotal", recipe: null, signal: "AdamTotal board host referenced by the page" };
  }
  const wix = /name="generator" content="Wix\.com|static\.wixstatic\.com|static\.parastorage\.com/i.test(html);
  if (wix) {
    const blog = /href="[^"]*\/post\/[^"/?#]+|data-hook="post-list|data-hook="post-title/i.test(html);
    return blog
      ? { vendor: "wix-blog", recipe: `${SPA}#wix`, signal: "Wix Blog board (blog post links)" }
      : { vendor: "wix", recipe: `${SPA}#wix`, signal: "Wix site" };
  }
  return null;
}

/**
 * A redirect, as triage reports it: the page the browser ended on is on
 * another host than the one asked for (a "www." alone does not count). Null
 * when it stayed. isracard.co.il and dbil.bamboohr.com were triaged as the
 * page asked for, the redirect unreported (the developer's 2026-10-21 report).
 */
export function redirectOf(requested: string, final: string): { to: string; host: string } | null {
  try {
    const a = new URL(requested).hostname.toLowerCase().replace(/^www\./, "");
    const bUrl = new URL(final);
    const b = bUrl.hostname.toLowerCase().replace(/^www\./, "");
    return a === b ? null : { to: bUrl.toString(), host: bUrl.hostname.toLowerCase() };
  } catch {
    return null;
  }
}
