/**
 * scripts/lib/company-extract.ts
 *
 * The deterministic half of the company-profile capture. Every function here
 * is PURE: it takes a PageHarvest (what scripts/company-profile.ts collected
 * from a real browser page) and returns candidates. No network, no Playwright,
 * no OpenAI — which is what lets scripts/lib/company-extract.test.ts cover the
 * parsing rules without a browser.
 *
 * The split matters for cost as much as for testability: the LLM is a FALLBACK
 * for the fields these rules could not fill, so the better these get, the fewer
 * sites pay for a model call.
 *
 * Nothing here decides what gets stored. It ranks candidates; the CLI applies
 * the gates (city.csv for the city, magic bytes for the logo) and only then
 * writes. A candidate is a guess until a gate accepts it.
 */

import { isAtsHost } from "../../src/lib/ats-hosts";
import {
  getPolicyDocumentType,
  isPolicyLinkText,
  isPolicyUrlPath,
} from "../../worker/policy/keywords";

// ---------------------------------------------------------------------------
// The browser-side harvest
// ---------------------------------------------------------------------------

export interface HarvestedLink {
  href: string;
  text: string;
  /** True when the anchor sits inside <header>/<nav> or <footer>. */
  inChrome: boolean;
}

export interface HarvestedImage {
  src: string;
  alt: string;
  /** Rendered size — 0 when the browser could not measure it. */
  width: number;
  height: number;
  /** True when the <img> sits inside <header>/<nav>. */
  inHeader: boolean;
  /** Nearest ancestor's class+id, lowercased — "logo" in here is a strong hint. */
  context: string;
}

export interface InlineLogo {
  /** PNG data: URL. */
  dataUrl: string;
  /**
   * <path> count and intrinsic area, used ONLY to order inline logos against
   * each other. A site commonly ships two: a bare glyph in the header and the
   * full lockup (glyph + wordmark) in the footer. flying-cargo.com carries a
   * 3-path 51x71 mark and a 14-path 79x153 lockup, both inside a[href="/"], and
   * they tie on every other signal — so without these the winner is decided by
   * document order, which picked the wordmark-less one.
   */
  pathCount: number;
  area: number;
}

export interface PageHarvest {
  /** Final URL after redirects — NOT the URL we asked for. */
  url: string;
  title: string;
  /** name/property -> content, lowercased keys ("og:url", "description", …). */
  metas: Record<string, string>;
  /** Raw <script type="application/ld+json"> bodies, unparsed. */
  jsonLd: string[];
  links: HarvestedLink[];
  images: HarvestedImage[];
  /** Visible text of <main>/<article>/<body>, scripts and nav stripped. */
  bodyText: string;
  /** Visible text of <footer> only — where the HQ address usually lives. */
  footerText: string;
  /**
   * Header/nav inline <svg> logos, ALREADY RASTERISED to PNG by the browser.
   * See the harvest in scripts/company-profile.ts for why the conversion has
   * to happen there rather than here.
   */
  inlineLogos: InlineLogo[];
}

export function emptyHarvest(url: string): PageHarvest {
  return {
    url,
    title: "",
    metas: {},
    jsonLd: [],
    links: [],
    images: [],
    bodyText: "",
    footerText: "",
    inlineLogos: [],
  };
}

// ---------------------------------------------------------------------------
// Homepage derivation
// ---------------------------------------------------------------------------

/**
 * Careers-board hosts now live in src/lib/ats-hosts.ts so the dashboard and this
 * script cannot drift — the UI warns that a site needs a homepage supplied by
 * hand using the very same list this uses to refuse to derive one.
 */
export { isAtsHost } from "../../src/lib/ats-hosts";

const SOCIAL_HOSTS =
  /(^|\.)(facebook|linkedin|twitter|instagram|youtube|tiktok|telegram|waze|pinterest)\.[a-z.]+$/i;

export function isSocialHost(host: string): boolean {
  return (
    SOCIAL_HOSTS.test(host) ||
    /(^|\.)wa\.me$/i.test(host) ||
    /(^|\.)(x|t)\.co$/i.test(host) ||
    /(^|\.)(google|apple)\.[a-z.]+$/i.test(host)
  );
}

/** Subdomains that front a careers site rather than the company itself. */
const CAREERS_SUBDOMAIN =
  /^(careers?|jobs?|job|hr|apply|recruit|recruiting|recruitment|work|drushim|meshiba)\./i;

/**
 * Ordered homepage guesses for a careers URL, best first.
 *
 * "https://careers.acme.co.il/jobs" yields ["https://acme.co.il",
 * "https://careers.acme.co.il"] — the careers origin is kept as a last resort
 * because plenty of small companies have no separate corporate site.
 *
 * Returns [] for an ATS host, which is the signal to fall back on the page's
 * own header/footer links and og:url instead of guessing from the hostname.
 */
export function deriveHomepageCandidates(siteUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    return [];
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
  if (isAtsHost(parsed.hostname)) return [];

  const out: string[] = [];
  const bare = parsed.hostname.replace(CAREERS_SUBDOMAIN, "");
  // A bare host must still have at least two labels beyond the public suffix
  // shape — stripping "jobs." off "jobs.co.il" would leave "co.il", which is a
  // registry suffix, not a company.
  if (bare !== parsed.hostname && bare.split(".").length >= 2 && !isRegistrySuffix(bare)) {
    out.push(`${parsed.protocol}//${bare}`);
  }
  out.push(parsed.origin);
  return out;
}

/** Bare registry suffixes that must never be treated as a company domain. */
const REGISTRY_SUFFIX =
  /^(co|com|net|org|gov|ac|muni|idf|k12)\.(il|uk|jp|za|au|nz|in|br)$/i;

export function isRegistrySuffix(host: string): boolean {
  return REGISTRY_SUFFIX.test(host);
}

/**
 * Pick the company homepage from links on the careers page. Used when the host
 * gave nothing — an ATS board, typically, where the only pointer back to the
 * company is a logo link or a "בית"/"Home" link in the chrome.
 *
 * Same-host links are skipped: they can only lead back into the board.
 */
export function homepageFromLinks(
  links: readonly HarvestedLink[],
  careersUrl: string,
): string | null {
  let careersHost: string;
  try {
    careersHost = new URL(careersUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  const HOME_TEXT = /^(בית|דף הבית|ראשי|לאתר החברה|אתר החברה|home|homepage|company site|our website)$/i;

  const scored: { origin: string; score: number }[] = [];
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href, careersUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    const host = url.hostname.toLowerCase();
    // isWidgetHost is as important here as in the logo picker, and was missed:
    // natali's careers page sits on an ATS host, so the homepage falls back to
    // page links, and the accessibility widget "נגיש לי" (nagish.li) linked in
    // the chrome won — which then dragged that vendor's about copy AND logo in
    // as the company's own. A vendor host is never the employer.
    if (
      host === careersHost ||
      isAtsHost(host) ||
      isSocialHost(host) ||
      isWidgetHost(host)
    ) {
      continue;
    }

    // POSITIVE EVIDENCE REQUIRED. Either the link says it points at the
    // company's own site, or the careers host is a subdomain of it — meaning
    // the link IS the parent site. Nothing else qualifies.
    //
    // "It is an external link sitting in the page chrome" is NOT evidence, and
    // treating it as such is how natali was captured twice over: its board is
    // on an ATS host, its only external chrome links belong to its
    // accessibility vendor, and blocking nagish.li merely promoted that
    // vendor's parent (localize.co.il) to the win. That board links nothing
    // belonging to natali at all, so the correct answer is NULL.
    //
    // Rejecting a real homepage costs one empty field. Accepting the wrong one
    // writes another company's identity — name, prose and logo — into this
    // site's row, permanently.
    const namedAsHome = HOME_TEXT.test(link.text.trim());
    const isParentDomain = careersHost.endsWith(`.${host}`);
    if (!namedAsHome && !isParentDomain) continue;

    let score = isParentDomain ? 5 : 0;
    if (namedAsHome) score += 4;
    // Weight only, never sufficient on its own.
    if (link.inChrome) score += 3;
    if (url.pathname === "/" || url.pathname === "") score += 2;

    scored.push({ origin: url.origin, score });
  }

  if (scored.length === 0) return null;

  // Sum per origin so a company linked from several places outranks a one-off.
  const byOrigin = new Map<string, number>();
  for (const { origin, score } of scored) {
    byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + score);
  }
  return [...byOrigin.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

export interface OrganizationLd {
  name?: string;
  url?: string;
  logo?: string;
  description?: string;
  streetAddress?: string;
  addressLocality?: string;
  postalCode?: string;
}

const ORG_TYPES =
  /^(organization|corporation|localbusiness|ngo|educationalorganization|governmentorganization)$/i;

/**
 * Pull the first Organization node out of the page's JSON-LD.
 *
 * Handles the three shapes real sites emit: a bare object, an array of nodes,
 * and the @graph wrapper. A malformed block is skipped rather than thrown on —
 * hand-written JSON-LD with a trailing comma is common enough that one bad
 * block must not cost the whole capture.
 */
export function parseJsonLdOrganization(blocks: readonly string[]): OrganizationLd | null {
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const found = findOrganizationNode(parsed, 0);
    if (found) return found;
  }
  return null;
}

function findOrganizationNode(node: unknown, depth: number): OrganizationLd | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOrganizationNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;

  if ("@graph" in obj) {
    const found = findOrganizationNode(obj["@graph"], depth + 1);
    if (found) return found;
  }

  const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
  const isOrg = types.some((t) => typeof t === "string" && ORG_TYPES.test(t));
  if (!isOrg) return null;

  const address =
    obj.address && typeof obj.address === "object" && !Array.isArray(obj.address)
      ? (obj.address as Record<string, unknown>)
      : {};

  // "logo" is sometimes an ImageObject rather than a URL string.
  const logoNode =
    obj.logo && typeof obj.logo === "object" && !Array.isArray(obj.logo)
      ? (obj.logo as Record<string, unknown>)
      : undefined;

  const org: OrganizationLd = {
    name: asString(obj.name),
    url: asString(obj.url),
    logo: asString(obj.logo) ?? asString(logoNode?.url),
    description: asString(obj.description),
    streetAddress: asString(address.streetAddress),
    addressLocality: asString(address.addressLocality),
    postalCode: asString(address.postalCode),
  };

  // An Organization node with nothing usable is not worth returning — keep
  // walking, since a later node may be the populated one.
  return Object.values(org).some((v) => v !== undefined) ? org : null;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// About page + about copy
// ---------------------------------------------------------------------------

const ABOUT_HREF =
  /(about|about-us|aboutus|our-story|our-company|who-we-are)(\/|$|\?|#)|אודות|עלינו|מי-אנחנו/i;
const ABOUT_TEXT =
  /^(about|about us|our story|who we are|the company|אודות|אודותינו|עלינו|מי אנחנו|קצת עלינו|החברה)$/i;

/** Loose keyword test for link text that is close but not an exact label. */
const ABOUT_LOOSE = /about|אודות|עלינו|מי אנחנו/i;

/**
 * "Contact" here means any page that exists to tell a visitor how to reach the
 * company, which includes the DIRECTIONS page. Israeli sites routinely split
 * the two: "צור קשר" carries a form and a phone number, while the street
 * address sits on a separate "כתובת ותחבורה" / "דרכי הגעה" page. That split
 * cost us מוזיאון ישראל, whose address lives at /he/content/כתובת-ותחבורה and
 * was found only because it was named by hand.
 *
 * A directions page is the better of the two sources, not a fallback: it exists
 * to say where the place IS, so it names the street. A contact form often names
 * nothing at all — which is exactly how מסוף came back with a phone number and
 * no address.
 */
const CONTACT_HREF =
  /(contact|contact-us|contactus|reach-us|our-offices|directions|find-us|how-to-get-here)(\/|$|\?|#)|צור-קשר|יצירת-קשר|צרו-קשר|כתובת|דרכי-הגעה|איך-מגיעים/i;
const CONTACT_TEXT =
  /^(contact|contact us|get in touch|our offices|directions|find us|how to get here|צור קשר|צרו קשר|יצירת קשר|דברו איתנו|כתובת|כתובת ותחבורה|כתובת והגעה|דרכי הגעה|איך מגיעים)$/i;
const CONTACT_LOOSE = /contact|צור קשר|צרו קשר|יצירת קשר|כתובת|דרכי הגעה/i;

/**
 * Highest-scoring same-host link matching a label/path keyword pair.
 *
 * Off-host links are refused outright: an "About" link pointing at Wikipedia or
 * LinkedIn is not the company's own copy, and a "Contact" link pointing at a
 * form vendor is not the company's own address.
 */
function pickByKeyword(
  links: readonly HarvestedLink[],
  pageUrl: string,
  exactText: RegExp,
  hrefPattern: RegExp,
  looseText: RegExp,
): string | null {
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  let best: { url: string; score: number } | null = null;
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.hostname.toLowerCase() !== host) continue;

    let score = 0;
    const text = link.text.trim();
    if (exactText.test(text)) score += 5;
    else if (text.length <= 40 && looseText.test(text)) score += 3;

    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      // A malformed %-escape is not worth failing over; match the raw path.
    }
    if (hrefPattern.test(pathname)) score += 3;

    // A deep path is usually a blog post ABOUT something, not the page itself.
    if (url.pathname.split("/").filter(Boolean).length > 3) score -= 2;

    if (score >= 3 && (!best || score > best.score)) best = { url: url.href, score };
  }
  return best?.url ?? null;
}

/** Best "about" page URL reachable from these links, or null. */
export function pickAboutUrl(links: readonly HarvestedLink[], pageUrl: string): string | null {
  return pickByKeyword(links, pageUrl, ABOUT_TEXT, ABOUT_HREF, ABOUT_LOOSE);
}

/**
 * Best privacy/terms page URL, or null. A LAST RESORT for the HQ address.
 *
 * Israeli privacy policies and terms routinely carry the operating company's
 * registered postal address, because they have to identify who is processing
 * the data — flying-cargo.com publishes no address on its homepage, about page
 * or contact page, but states it plainly in /privacy/.
 *
 * Reuses the worker's policy vocabulary (worker/policy/keywords.ts) rather than
 * a second list, so the two cannot drift.
 */
export function pickPolicyUrl(links: readonly HarvestedLink[], pageUrl: string): string | null {
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  let best: { url: string; score: number } | null = null;
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.hostname.toLowerCase() !== host) continue;
    // A PDF/DOC policy needs a different reader; only HTML is useful here.
    if (getPolicyDocumentType(url.href)) continue;

    let score = 0;
    if (isPolicyLinkText(link.text)) score += 4;
    if (isPolicyUrlPath(url.href)) score += 3;
    // Privacy beats terms: terms-of-use pages more often omit the address.
    if (/privacy|פרטיות/i.test(decodeURIComponentSafe(url.pathname) + link.text)) score += 2;

    if (score >= 3 && (!best || score > best.score)) best = { url: url.href, score };
  }
  return best?.url ?? null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Best "contact" page URL, or null.
 *
 * Separate from the about page because the two carry different fields: the
 * about page has the prose, the contact page has the street address. Most
 * companies publish an HQ address on exactly one of them, and it is far more
 * often this one — a homepage footer usually carries only social links and a
 * phone number.
 */
export function pickContactUrl(links: readonly HarvestedLink[], pageUrl: string): string | null {
  return pickByKeyword(links, pageUrl, CONTACT_TEXT, CONTACT_HREF, CONTACT_LOOSE);
}

/**
 * Boilerplate that is never company description copy.
 *
 * Tested ANYWHERE in the paragraph, not just at the start. A prefix-only test
 * looks sufficient and is not: msh.co.il's consent banner opens "אתר זה עושה
 * שימוש בטכנולוגיות איסוף מידע כגון עוגיות (Cookies)…", which begins like
 * ordinary prose, is the longest paragraph on every page of the site, and so
 * won as the "about" copy — a cookie notice headed for the public jobs site as
 * the company's description.
 *
 * Cookie/privacy/terms language is the giveaway and effectively never appears
 * in a company's own description of itself, so one hit anywhere is enough to
 * reject the paragraph.
 */
const BOILERPLATE =
  /cookies?\b|עוגיות|מדיניות ה?פרטיות|privacy policy|terms of (use|service)|תנאי ה?שימוש|כל הזכויות שמורות|all rights reserved|הצהרת נגישות|accessibility statement|חווית גלישה|©|\d{4}\s*©/i;

/**
 * Promotional copy and its legal tail. A bank homepage's longest paragraph is an
 * offer, not a description of the company: bankhapoalim.co.il produced
 * "עד 20% הנחה באלפי בתי מלון בעולם ... בהתאם לתקנון ... הבנק אינו אחראי",
 * which cleared every other filter and would have become the bank's "about"
 * text on the public jobs site.
 *
 * Keyed on offer and disclaimer language, neither of which appears in a company
 * describing itself. Note "תנאי השימוש" above needed the definite article to
 * match at all — the article-less form alone missed this exact paragraph.
 */
const PROMO_COPY =
  /\d+%\s*הנחה|הנחה של|מבצע|הטבות|בהתאם לתקנון|כפופ(?:ים|ה)? לתקנון|הכפופים לתנאי|אינו אחראי|בכפוף לתנאי/i;

/**
 * Text that means the page BROKE, not text about a company.
 *
 * bankhapoalim.co.il throws a client-side exception under headless Chromium and
 * renders only "Application error: a client-side exception has occurred while
 * loading www.bankhapoalim.co.il (see the browser console for more
 * information)." That is 140 characters, has sentence punctuation, and contains
 * no cookie/legal vocabulary — so it cleared every other filter and was stored
 * as the bank's company description.
 *
 * Deliberately narrow. These are phrases that only appear on failure pages, not
 * words a real company might use about itself — "error" alone is NOT here,
 * because plenty of legitimate copy mentions error rates or margins of error.
 */
const ERROR_PAGE =
  /application error|client-side exception|server error|internal server error|502 bad gateway|503 service|page not found|404 not found|403 forbidden|access denied|הגישה נדחתה|העמוד לא נמצא|שגיאה בטעינת|enable javascript|javascript is disabled|please enable javascript|browser console|unhandled (exception|rejection)|\bat\s+\S+\s*\([^)]*:\d+:\d+\)/i;

/**
 * Longest coherent prose block in the harvested text, as the "about" copy.
 *
 * Paragraph-level rather than sentence-level: a company description is several
 * sentences that belong together, and stitching arbitrary sentences produces
 * text that reads as broken on the public site. Returns PLAIN TEXT only — the
 * reader may render Site.companyAbout unescaped, so no markup may survive here.
 */
export function extractAboutText(text: string, maxChars = 1_200): string | null {
  if (!text) return null;

  // Split on ANY newline, not just blank lines. innerText emits a single "\n"
  // between block elements and only doubles it for <p>, so a div-based layout —
  // which is most of them — comes through as one unbroken run. Splitting on
  // blank lines alone therefore either merges a whole page into one "paragraph"
  // or finds none at all. Per-line is the reliable unit; menu entries are short
  // and get dropped by the length and punctuation filters below.
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 120)
    .filter((p) => !BOILERPLATE.test(p))
    .filter((p) => !ERROR_PAGE.test(p))
    .filter((p) => !PROMO_COPY.test(p))
    // A "paragraph" that is really a menu has many short fragments and no
    // sentence punctuation; real prose has terminators.
    .filter((p) => /[.!?׃]/.test(p));

  if (paragraphs.length === 0) return null;

  // Longest wins: on a real about page that is the description, and on a
  // homepage it is the closest thing to one.
  const best = paragraphs.sort((a, b) => b.length - a.length)[0];
  return best.length > maxChars ? `${best.slice(0, maxChars).trimEnd()}…` : best;
}

// ---------------------------------------------------------------------------
// HQ address
// ---------------------------------------------------------------------------

/**
 * An Israeli street address printed in a footer: a street noun, a name, and a
 * house number, optionally trailed by a city. Deliberately conservative — a
 * wrong address is worse than none, since nothing downstream re-checks it.
 */
const ADDRESS_LINE =
  /((?:רחוב|רח['׳]|שדרות|שד['׳]|דרך|שביל|סמטת|כיכר)\s+[^\n,|]{2,40}\s+\d{1,4}[^\n]{0,60})/;
// \b after the suffix is load-bearing: without it "St" matched the first two
// letters of "Statista", and Personetics stored the award caption
// "2025 by CNBC and Statista" as its head-office address.
const ADDRESS_LINE_EN =
  /(\d{1,4}\s+[A-Za-z'’.\- ]{3,40}\s+(?:St|Street|Rd|Road|Ave|Avenue|Blvd)\b\.?[^\n]{0,60})/;

/**
 * An address written after an explicit label — "כתובת: …", "Address: …".
 *
 * ADDRESS_LINE above needs a street noun AND a house number, which a great many
 * real addresses simply do not have. flying-cargo.com publishes
 * "כתובת דואר בית העסק: תעשיות צריפין, ראשל״צ." — an industrial zone and a city
 * abbreviation, no street and no number — so the structural pattern could never
 * see it, while the label makes it unambiguous.
 *
 * Returns ALL candidates rather than picking one, because a label is a weaker
 * guarantee than it looks: the same page opens with
 * "האתר פליינג קרגו כתובת: Flying-cargo.com", where the labelled value is a
 * domain. The caller resolves that by keeping only a candidate the city.csv
 * gate recognises, which rejects the domain and accepts the real address.
 */
/**
 * Up to three Hebrew qualifier words are allowed between the noun and the
 * colon. A fixed alternation of known qualifiers is not enough in practice —
 * flying-cargo.com writes "כתובת דואר בית העסק:", three words deep, and a
 * pattern accepting only one silently matched nothing at all.
 */
const ADDRESS_LABEL =
  /(?:כתובת(?:\s+[֐-׿"'׳״]{2,12}){0,3}|מען(?:\s+[֐-׿]{2,12}){0,2}|postal address|registered office|our address|address)\s*[:：]\s*/i;

/** Values that are labelled "address" but are not one. */
const NOT_AN_ADDRESS = /^(https?:\/\/|www\.|[\w.-]+@)|^[\w-]+\.(com|co\.il|net|org|io)\.?$/i;

export function extractLabelledAddress(text: string, maxCandidates = 5): string[] {
  if (!text) return [];

  const out: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const hit = ADDRESS_LABEL.exec(line);
    if (!hit) continue;

    // Everything after the label, to the end of the sentence.
    let value = line.slice(hit.index + hit[0].length).trim();
    value = value.split(/(?<=[^\d])\.\s|[|]/)[0].trim();

    // The same contact tail extractAddressLine() cuts, for the same reason. A
    // labelled address runs to the end of the line and so collects whatever
    // follows it: sinai-store publishes
    // "כתובת: … גולומב 32 תל אביב, ישראל, דוא״ל: ram@…", and without this the
    // stored address carried an email address.
    const tail = CONTACT_TAIL.exec(value);
    if (tail && tail.index > 0) value = value.slice(0, tail.index).trim();

    value = value.replace(/[.,;\s]+$/, "").trim();

    if (value.length < 4 || value.length > 300) continue;
    if (NOT_AN_ADDRESS.test(value)) continue;
    if (!/\p{L}/u.test(value)) continue;

    if (!out.includes(value)) out.push(value);
    if (out.length >= maxCandidates) break;
  }
  return out;
}

/** First address-looking line in the text, or null. */
/**
 * Contact details that follow an address on the same line and are NOT part of
 * it. Both address patterns end with a permissive run of trailing characters —
 * they have to, since what follows a house number varies wildly — and that run
 * happily swallows whatever comes next.
 *
 * bankhapoalim.co.il yielded
 * "שדרות רוטשילד 50 תל אביב-יפו, מיקוד 6688314, טלפון: 076-8012790 או בדוא״ל: m"
 * — a correct street and city, then a phone number and an email cut off
 * mid-word at the character cap.
 */
const CONTACT_TAIL =
  /[,;|]?\s*(?:טלפון|טל['׳]?|פקס|נייד|דוא["״']?ל|דואר אלקטרוני|מייל|וכן אצל|ב["״]כ |עו["״]ד |tel\.?|phone|fax|mobile|e-?mail|@)/i;

/**
 * Short lines that could be an address even though they name no street.
 *
 * Plenty of real addresses have no street noun at all. Both address misses in
 * one 20-site batch were this shape, and both were sitting in text already
 * being read:
 *   "ספיר 1 הרצליה"                            — globrands, homepage footer
 *   "פוליכד בע״מ, קיבוץ שפיים, 6099000, ישראל" — polycad, privacy page
 *
 * The caller gates every candidate through city.csv, so this only has to be
 * cheap and roughly right. Three constraints keep prose out: a length cap and a
 * word-count cap — that same privacy page opens with a 110-character sentence
 * which also contains "שפיים" — and a required digit, being a house number,
 * postal code or company number. The digit is also what stops a bare menu entry
 * like "סניף חיפה" from qualifying, which matters because a branch city must
 * never become the HQ city.
 */
// Two Hebrew traps in one short pattern, both found by test:
//   - \b is an ASCII word boundary and does not fire between a Hebrew letter
//     and a space, so /סניף\b/ never matched "סניף באר שבע 3"
//   - "סניף" ends in FINAL fe (ף, U+05E3) while its plural "סניפים" uses the
//     regular form (פ, U+05E4), so one spelling alone misses the other
const BRANCH_LINE = /^\s*(?:סני[פף]|branch(?:es)?\b|showroom\b)/i;

export function extractCompactAddressLines(text: string, maxCandidates = 6): string[] {
  if (!text) return [];

  const out: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 8 || line.length > 90) continue;
    if (!/\d/.test(line)) continue;

    // An address is either COMMA-SEPARATED or very short. A sentence is
    // neither, and this is what separates them: polycad's homepage says
    // "ב-3 משמרות להבטחת רציפות יצור" — "in 3 shifts to ensure production
    // continuity" — where משמרות is both the word for shifts and a real kibbutz
    // in city.csv. Five words, no comma, and it was being stored as the HQ.
    const words = line.split(" ").filter(Boolean);
    if (!line.includes(",") && words.length > 4) continue;
    if (words.length > 10) continue;
    if (!/\p{L}/u.test(line)) continue;
    if (BRANCH_LINE.test(line)) continue;
    if (CONTACT_TAIL.test(line)) continue;

    if (!out.includes(line)) out.push(line);
    if (out.length >= maxCandidates) break;
  }
  return out;
}

/**
 * A single line that is nothing but a place name — "Tel Aviv", "Hong Kong".
 *
 * Latin script ONLY. That is not a stylistic choice: scanning Hebrew page text
 * for city names was tried and removed on 2026-08-30 because Hebrew city names
 * collide with ordinary words ("כנות" inside "הסוכנות", "משמרות" meaning
 * shifts). Latin transliterations do not sit inside longer Hebrew words, so the
 * failure mode that killed the earlier attempt cannot occur here.
 */
const OFFICE_NAME_LINE = /^[A-Z][A-Za-z'’.\-]*(?: [A-Z][A-Za-z'’.\-]*){0,2}$/;

/**
 * Runs of consecutive lines that each hold nothing but a place name.
 *
 * This is the "Our Offices" list an international company puts on its contact
 * page, one office per line:
 *
 *   Our Offices
 *   Singapore        <- run starts
 *   Tel Aviv
 *   New York
 *   Paris            <- ... and so on
 *
 * STRUCTURE, not prose. Every entry must be a bare place name on its own line,
 * so this cannot read a city out of a sentence — which is exactly what the
 * removed prose scanner did wrong. The caller decides what to do with a run;
 * its rule is that exactly one entry may be an Israeli city (see officeListCity
 * in scripts/company-profile.ts).
 *
 * A run needs THREE entries. Two adjacent capitalised lines are common in nav
 * menus and footers ("Careers" above "Contact us"); three consecutive lines
 * that are each only a place name is a list.
 */
export function extractOfficeListRuns(text: string, minRun = 3): string[][] {
  if (!text) return [];

  const runs: string[][] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length >= minRun) runs.push(current);
    current = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    // A place name carries no digits and no Hebrew, and "Hong Kong" is as long
    // as these get.
    if (
      line.length >= 3 &&
      line.length <= 24 &&
      !/[\d\u0590-\u05FF]/.test(line) &&
      OFFICE_NAME_LINE.test(line)
    ) {
      if (!current.includes(line)) current.push(line);
      continue;
    }
    flush();
  }
  flush();

  return runs;
}

export function extractAddressLine(text: string): string | null {
  if (!text) return null;
  const flat = text.replace(/[ \t]+/g, " ");
  const hit = ADDRESS_LINE.exec(flat) ?? ADDRESS_LINE_EN.exec(flat);
  if (!hit) return null;

  let value = hit[1].replace(/\s+/g, " ").trim();

  const tail = CONTACT_TAIL.exec(value);
  if (tail && tail.index > 0) value = value.slice(0, tail.index).trim();

  // Trailing separators left behind by the cut.
  value = value.replace(/[\s,;|.–—-]+$/, "").trim();

  return value.length > 0 ? value.slice(0, 300) : null;
}

/**
 * Assemble an address from JSON-LD PostalAddress parts. Preferred over the
 * footer regex when present: it is the company's own structured statement of
 * its address, not something inferred from prose.
 */
export function addressFromJsonLd(org: OrganizationLd | null): string | null {
  if (!org) return null;
  const parts = [org.streetAddress, org.addressLocality, org.postalCode].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ").slice(0, 300) : null;
}

// ---------------------------------------------------------------------------
// Logo candidates
// ---------------------------------------------------------------------------

export interface LogoCandidate {
  /** An http(s) URL, or a PNG data: URL for a rasterised inline <svg>. */
  url: string;
  source: "json-ld" | "og:image" | "header-img" | "inline-svg";
  score: number;
}

/** SVG is refused at the gate (src/lib/image-validate.ts) — don't propose it. */
const SVG_URL = /\.svgz?($|\?|#)/i;

/**
 * Third-party widgets that inject their OWN branded logo into the page chrome.
 *
 * These are indistinguishable from a real logo by shape alone: bankhapoalim.co.il
 * ships the Butterfly accessibility button, whose image is
 * butterfly-button.web.app/img/butterfly-logo-200.png — "logo" in the filename,
 * sitting in the header, correctly sized. It won, and Bank Hapoalim's profile
 * came out carrying an accessibility vendor's butterfly.
 *
 * Accessibility, chat, consent and analytics widgets are the recurring
 * offenders, and they are always on a vendor host, so the host is the reliable
 * discriminator.
 */
const WIDGET_HOSTS =
  /(^|.)(butterfly-button.web.app|userway.org|accessiway.com|nagich.co.il|nagish.li|negishut.com|enable.co.il|equalweb.com|tawk.to|intercom.(io|com)|zendesk.com|hotjar.com|cookiebot.com|onetrust.com|trustpilot.com|gravatar.com|googletagmanager.com|facebook.com|doubleclick.net)$/i;

/** True for a third-party widget/vendor host — never the company itself. */
export function isWidgetHost(host: string): boolean {
  return WIDGET_HOSTS.test(host);
}

/** The registrable-ish domain, for "is this the company's own host" tests. */
function baseDomain(host: string): string {
  const parts = host.toLowerCase().split(".");
  // Handles the co.il / org.il / ac.il shapes that dominate here.
  const take = parts.length >= 3 && /^(co|org|ac|gov|muni|net)$/i.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join(".");
}

/**
 * Logo URLs to try, best first. The caller downloads them through
 * scripts/lib/fetch-image.ts, which is where the real validation happens; a
 * candidate rejected there just means moving on to the next one.
 *
 * Favicons are NOT proposed. Site.companyLogoPath is documented as "NULL means
 * render nothing, not a placeholder, not a favicon" — a 32px favicon upscaled
 * on the public site looks broken, and it would fail the 64px floor anyway.
 */
export function collectLogoCandidates(
  harvest: PageHarvest,
  org: OrganizationLd | null,
): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const seen = new Set<string>();

  let pageDomain = "";
  try {
    pageDomain = baseDomain(new URL(harvest.url).hostname);
  } catch {
    // A harvest with an unparseable URL just loses the same-domain bonus.
  }

  const add = (raw: string | undefined, source: LogoCandidate["source"], score: number) => {
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw, harvest.url);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (SVG_URL.test(url.pathname)) return;
    if (WIDGET_HOSTS.test(url.hostname)) return;
    if (seen.has(url.href)) return;

    // Served from the company's own domain, so it is far more likely to be the
    // company's own mark. Only a bonus, never a requirement: plenty of real
    // logos are legitimately on a CDN.
    const sameDomain = pageDomain !== "" && baseDomain(url.hostname) === pageDomain;

    seen.add(url.href);
    out.push({ url: url.href, source, score: score + (sameDomain ? 3 : 0) });
  };

  // The company's own structured claim about its logo — most reliable.
  add(org?.logo, "json-ld", 10);

  // Inline <svg> logos, already rasterised to PNG by the harvest. Ranked just
  // below JSON-LD and above every <img>: the harvest only collects an inline
  // SVG that sits in the header inside the home link, which is about as strong
  // a logo signal as a page offers, and being vector it upscales cleanly.
  //
  // These arrive as data: URLs, so the add() helper's URL parsing and its
  // host-based widget/same-domain rules do not apply — pushed directly.
  // Richest first, so the full lockup beats a bare glyph. Ordering happens
  // WITHIN the inline group rather than via the score, so that a wordmark
  // bonus can never leapfrog the company's own JSON-LD declaration; the final
  // sort is stable, so this order survives it among equal scores.
  const rankedInline = [...harvest.inlineLogos].sort(
    (a, b) => b.pathCount - a.pathCount || b.area - a.area,
  );

  for (const logo of rankedInline) {
    if (seen.has(logo.dataUrl)) continue;
    seen.add(logo.dataUrl);
    // 9 base + 3 for provenance. The bonus is the same one add() gives a
    // same-domain URL, and it belongs here for the same reason, only more so:
    // this markup was not merely served by the company's domain, it was lifted
    // out of the company's own page. Without it a header <img> (6 + 2 + 3)
    // would outrank an inline SVG that is a strictly better source.
    out.push({ url: logo.dataUrl, source: "inline-svg", score: 12 });
  }

  for (const img of harvest.images) {
    const hint = `${img.alt} ${img.context} ${img.src}`.toLowerCase();
    if (!/logo|לוגו/.test(hint)) continue;
    let score = 6;
    if (img.inHeader) score += 2;
    // Tracking pixels and spacers dressed up as logos.
    if (img.width > 0 && img.width < 32) score -= 6;
    add(img.src, "header-img", score);
  }

  // og:image is meant for social cards, so it is often a banner rather than a
  // logo. Tried last, below anything explicitly named a logo.
  add(harvest.metas["og:image"], "og:image", 4);

  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

/**
 * Clean one string returned by the LLM fallback.
 *
 * Model output is untrusted text heading for a column the public site may
 * render UNESCAPED, so tags are stripped here rather than trusted to the
 * reader. The model is also told to return null for anything the source does
 * not state, and returns the STRING "null" (or "N/A", or "לא ידוע") often
 * enough that treating those as values would put them on the public site.
 */
export function sanitizeModelText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;

  let s = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^["'“”]+|["'“”]+$/g, "").trim();

  if (!s || /^(null|none|n\/?a|unknown|לא ידוע|אין מידע)$/i.test(s)) return null;
  return s.length > maxChars ? `${s.slice(0, maxChars).trimEnd()}…` : s;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface ProfileFields {
  companyHomepageUrl: string | null;
  companyAbout: string | null;
  companyLogoPath: string | null;
  companyHqAddress: string | null;
  companyHqCity: string | null;
}

/**
 * COMPLETE / PARTIAL / FAILED for Site.companyProfileStatus.
 *
 * COMPLETE requires the three fields the public site actually renders — a
 * homepage link, about copy, and a logo. The HQ address is excluded on purpose:
 * plenty of companies simply do not publish one, and letting that pin the
 * status at PARTIAL forever would make the marker useless for finding the sites
 * actually worth a second look.
 */
export function classifyProfileStatus(fields: ProfileFields): "COMPLETE" | "PARTIAL" | "FAILED" {
  const core = [fields.companyHomepageUrl, fields.companyAbout, fields.companyLogoPath];
  const filled = core.filter((v) => v !== null && v !== "").length;
  if (filled === core.length) return "COMPLETE";
  const any = [...core, fields.companyHqAddress, fields.companyHqCity].some(
    (v) => v !== null && v !== "",
  );
  return any ? "PARTIAL" : "FAILED";
}
