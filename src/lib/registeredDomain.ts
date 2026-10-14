// The registered domain of a site (H6, owner 2026-10-14), for the exact
// duplicate check: GET /api/sites?domain=tech.co.il finds tech.co.il and
// careers.tech.co.il, never naya-tech.co.il, horizontech, gtech or ness-tech,
// which the contains match of ?urlSearch= returns (and keeps returning for the
// dashboard's filter).

/** Second-level suffixes under which a name is registered one label deeper. */
const SECOND_LEVEL = new Set([
  "co.il", "org.il", "ac.il", "gov.il", "net.il", "muni.il", "k12.il", "idf.il",
  "co.uk", "org.uk", "ac.uk", "com.au", "co.za", "com.br",
]);

/** The registered domain of a URL or host, lower-case, without www.; null when it is not a host. */
export function registeredDomain(urlOrHost: string): string | null {
  let host = urlOrHost.trim().toLowerCase();
  if (!host) return null;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(host) ? host : `https://${host}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join(".");
  const take = SECOND_LEVEL.has(lastTwo) && labels.length >= 3 ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** True when the site's URL is on exactly that registered domain. */
export function sameRegisteredDomain(siteUrl: string, domain: string): boolean {
  const want = registeredDomain(domain);
  return want !== null && registeredDomain(siteUrl) === want;
}
