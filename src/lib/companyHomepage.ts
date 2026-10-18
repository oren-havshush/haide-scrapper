/**
 * The origin of an operator-supplied company homepage (m), owner 2026-10-06.
 *
 * The capture stores the homepage it harvested as an origin
 * (scripts/company-profile.ts originOf), so an operator homepage stored with a
 * path — diplomat's https://www.diplomat.co.il/he/ — was rewritten at capture
 * and opened a COMPANY fix item that was not a fix. Stored as the origin, the
 * capture's write is no change. null clears, as before. A value that is not an
 * http(s) URL is returned trimmed and unchanged; the route's schema has already
 * refused anything that is not a URL.
 */
/** A path that is a language prefix alone: /he, /en/, /he-il. */
const LANGUAGE_PREFIX_ONLY = /^\/[a-z]{2}(?:[-_][a-z]{2})?\/?$/i;

/**
 * The company homepage as stored (developer's report 2026-10-18, item 3). A
 * subsidiary's homepage is often a path on its group's host (Elipse;
 * careers.deloitte.co.il), and storing the origin gave it the group's
 * homepage. So a path is kept, without its query, fragment or trailing slash,
 * unless it is a language prefix alone, which collapses to the origin as
 * before (diplomat's /he/). null clears; a value that is not an http(s) URL is
 * returned trimmed and unchanged.
 */
export function companyHomepageValue(url: string | null): string | null {
  if (url == null) return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return trimmed;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path || LANGUAGE_PREFIX_ONLY.test(parsed.pathname)) return parsed.origin;
    return parsed.origin + path;
  } catch {
    return trimmed;
  }
}

/**
 * The homepage a capture writes. The operator's stored value is kept when the
 * page the capture loaded is on its origin: the capture compares the stored
 * value against its own derivation and reports no change where they agree.
 * Otherwise (no stored value, or the page moved to another host) it is the
 * harvested page's origin, as before.
 */
export function capturedHomepage(stored: string | null | undefined, harvestedUrl: string): string | null {
  const harvestedOrigin = homepageOrigin(harvestedUrl);
  let originOk = false;
  try {
    originOk = new URL(harvestedUrl).protocol.startsWith("http");
  } catch {
    originOk = false;
  }
  if (!originOk) return null;
  const kept = stored ? companyHomepageValue(stored) : null;
  if (kept && homepageOrigin(kept) === harvestedOrigin) return kept;
  return harvestedOrigin;
}

export function homepageOrigin(url: string | null): string | null {
  if (url == null) return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return trimmed;
    return parsed.origin;
  } catch {
    return trimmed;
  }
}
