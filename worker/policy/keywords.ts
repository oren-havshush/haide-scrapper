/**
 * Policy-page keyword lists for discovery and classification.
 * Two separate concerns:
 *   1. POLICY_LINK_KEYWORDS — used to recognise links/URLs pointing at terms/privacy/legal pages.
 *   2. RESTRICTIVE_TERMS — used as evidence hints when pre-filtering text before the LLM.
 */

// ---------------------------------------------------------------------------
// Link-text and URL-path keywords for policy page discovery
// ---------------------------------------------------------------------------

/** English link-text patterns that suggest a policy / terms page. */
export const EN_POLICY_LINK_TEXT: string[] = [
  "terms",
  "terms of use",
  "terms of service",
  "terms and conditions",
  "privacy policy",
  "privacy",
  "legal",
  "site terms",
  "user agreement",
  "conditions of use",
  "acceptable use",
  "disclaimer",
  "cookie policy",
];

/** Hebrew link-text patterns that suggest a policy / terms page. */
export const HE_POLICY_LINK_TEXT: string[] = [
  "תנאי שימוש",
  "מדיניות פרטיות",
  "תקנון",
  "הצהרה משפטית",
  "תנאי שימוש באתר",
  "פרטיות",
  "תנאים",
  "משפטי",
  "מדיניות",
  "תנאים והגבלות",
  "תנאי השירות",
];

/** Common URL path segments that often point to policy pages. */
export const POLICY_URL_PATHS: string[] = [
  "/terms",
  "/terms-of-use",
  "/terms-of-service",
  "/terms-and-conditions",
  "/tos",
  "/privacy",
  "/privacy-policy",
  "/legal",
  "/site-terms",
  "/user-agreement",
  "/takanon",
  "/takanim",
  "/conditions",
  "/disclaimer",
];

/**
 * Common locations where a policy is published as a downloadable document
 * (PDF / Word) rather than an HTML page. Probed directly with HTTP HEAD in
 * addition to the HTML POLICY_URL_PATHS above.
 */
export const POLICY_DOC_PATHS: string[] = [
  "/terms.pdf",
  "/privacy.pdf",
  "/takanon.pdf",
  "/legal.pdf",
  "/assets/terms.pdf",
  "/assets/privacy.pdf",
  "/assets/takanon.pdf",
  "/files/terms.pdf",
  "/files/privacy.pdf",
  "/docs/terms.pdf",
  "/uploads/terms.pdf",
];

/** Document file extensions we can extract policy text from. */
export type PolicyDocType = "pdf" | "docx" | "doc";

/**
 * Return the policy document type for a URL whose path ends in a supported
 * document extension, or null for ordinary (HTML) URLs. Query strings and
 * fragments are ignored so `/terms.pdf?v=2#top` is still detected.
 */
export function getPolicyDocumentType(url: string): PolicyDocType | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url.toLowerCase().split(/[?#]/)[0];
  }
  if (pathname.endsWith(".pdf")) return "pdf";
  if (pathname.endsWith(".docx")) return "docx";
  if (pathname.endsWith(".doc")) return "doc";
  return null;
}

// ---------------------------------------------------------------------------
// Restrictive terms for evidence matching and prompt guidance
// ---------------------------------------------------------------------------

/** English phrases that indicate a scraping/automation restriction. */
export const EN_RESTRICTIVE_TERMS: string[] = [
  "scraping is prohibited",
  "crawling is prohibited",
  "bots are prohibited",
  "automated access is prohibited",
  "data mining is prohibited",
  "harvesting information is prohibited",
  "collecting information is prohibited",
  "copying content is prohibited",
  "monitoring or copying",
  "automated means",
  "automated tools",
  "commercial use of site content",
  "commercial use of the content",
  "written permission is required",
  "prior written consent",
  "prior written permission",
  "robots",
  "spiders",
  "crawlers",
  "scrapers",
  "screen scraping",
  "data scraping",
  "web scraping",
  "web crawling",
  "systematic retrieval",
  "systematic collection",
  "bulk download",
  "automated download",
  "automated extraction",
  "automated querying",
  "may not use automated",
  "must not use automated",
  "prohibited from using automated",
  "without our prior written",
  "without prior written",
];

/** Hebrew phrases that indicate a scraping/automation restriction. */
export const HE_RESTRICTIVE_TERMS: string[] = [
  "סקרייפינג",
  "כריית מידע",
  "שאיבת מידע",
  "בוטים",
  "רובוטים",
  "שימוש אוטומטי",
  "גישה אוטומטית",
  "איסור העתקה",
  "אין להעתיק",
  "אין לאגור מידע",
  "אין לנטר",
  "אמצעי אוטומטי",
  "אין לעשות שימוש מסחרי",
  "שימוש מסחרי במידע",
  "ללא אישור מראש ובכתב",
  "נדרש אישור מראש ובכתב",
  "אסור לבצע",
  "אסור לאסוף",
  "scraping",
  "crawling",
  "data mining",
];

/** All restrictive terms merged for convenience. */
export const ALL_RESTRICTIVE_TERMS: string[] = [
  ...EN_RESTRICTIVE_TERMS,
  ...HE_RESTRICTIVE_TERMS,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the given link text (case-insensitive, trimmed) matches
 * any known policy link-text keyword.
 */
export function isPolicyLinkText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    EN_POLICY_LINK_TEXT.some((kw) => lower.includes(kw)) ||
    HE_POLICY_LINK_TEXT.some((kw) => lower.includes(kw))
  );
}

/**
 * Returns true if the given URL path contains a known policy path segment.
 */
export function isPolicyUrlPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return POLICY_URL_PATHS.some((seg) => pathname.includes(seg));
  } catch {
    return false;
  }
}

/**
 * Returns all restrictive terms found in the given text (lowercased comparison).
 */
export function findRestrictiveTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return ALL_RESTRICTIVE_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}
