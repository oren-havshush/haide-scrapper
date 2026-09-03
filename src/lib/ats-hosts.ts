/**
 * src/lib/ats-hosts.ts
 *
 * Hosts that belong to a careers-board vendor rather than to an employer.
 *
 * Lives in src/lib so there is exactly ONE list: the dashboard uses it to warn
 * that a site needs a homepage supplied by hand, and
 * scripts/lib/company-extract.ts uses it to refuse to derive one. Two copies
 * would drift, and the failure mode of drift here is silent — a site would stop
 * being flagged in the UI while the scraper still could not resolve it.
 *
 * Why it matters at all: a company hosted on one of these has no relationship
 * between its careers URL and its own domain, so deriving a homepage from the
 * hostname would point every employer on that vendor at the vendor itself.
 *
 * Kept in sync with fingerprintByHost() in scripts/addsite-batch.ts.
 */

const ATS_HOSTS: readonly RegExp[] = [
  /(^|\.)myworkdayjobs\.com$/i,
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)comeet\.(com|co)$/i,
  /(^|\.)icims\.com$/i,
  /(^|\.)smartrecruiters\.com$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)civi\.co\.il$/i,
  /(^|\.)niloosoft\.co\.il$/i,
  /(^|\.)drushim\.co\.il$/i,
  /(^|\.)alljobs\.co\.il$/i,
  /(^|\.)jobmaster\.co\.il$/i,
  // Israeli recruitment vendors that host an employer's board on their OWN
  // domain, so stripping the "careers." subdomain lands on the vendor:
  //   careers.topmatch.co.il/tadiran  -> topmatch.co.il
  //   bdo-career.hunterhrms.com       -> hunterhrms.com  (Niloosoft "Hunter")
  //   railcareer.adamtotal.co.il      -> adamtotal.co.il (אדם טוטאל, staffing)
  // Tadiran was captured with Top Solutions' homepage, about copy and logo
  // before topmatch was listed here. The giveaway in the data: one host serving
  // several unrelated employers is a vendor by definition.
  //
  // Consequence, accepted deliberately: a vendor that is ALSO an employer in
  // the fleet (Top Match is) can no longer derive its own homepage and must be
  // given one by hand. One extra manual entry beats storing the wrong company.
  /(^|\.)topmatch\.co\.il$/i,
  /(^|\.)hunterhrms\.com$/i,
  /(^|\.)adamtotal\.co\.il$/i,
];

export function isAtsHost(host: string): boolean {
  return ATS_HOSTS.some((re) => re.test(host));
}

/**
 * True when this site's careers URL cannot yield the employer's own homepage,
 * so someone has to supply it. Safe to call with anything: an unparseable URL
 * counts as needing help rather than throwing.
 */
export function needsManualHomepage(siteUrl: string): boolean {
  try {
    const { hostname, protocol } = new URL(siteUrl);
    if (protocol !== "http:" && protocol !== "https:") return true;
    return isAtsHost(hostname);
  } catch {
    return true;
  }
}
