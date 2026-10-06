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
