import type { Page } from "playwright";
import { calculateOverallConfidence } from "../lib/confidence";

// ---------------------------------------------------------------------------
// Types (Task 7)
// ---------------------------------------------------------------------------

/** Final result returned by the crawl/classify analysis method. */
export interface CrawlClassifyResult {
  fieldMappings: Record<string, { selector: string; sample: string }>;
  confidenceScores: Record<string, number>;
  overallConfidence: number;
  listingSelector: string | null;
  itemSelector: string | null;
  itemCount: number;
  detailPagePattern: string | null;
  crawledPages: string[];
}

/** A content block classified by semantic role. */
export interface ContentBlock {
  text: string;
  classification: string;
  confidence: number;
  selector: string;
  parentSelector: string | null;
}

/** Result of page discovery / crawling. */
export interface DiscoveredPage {
  url: string;
  crawled: boolean;
  hops: number;
}

/** Result of scoring a link for job-listing likelihood. */
export interface LinkAnalysis {
  url: string;
  text: string;
  score: number;
  parentSelector: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANALYSIS_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Zero-confidence fallback
// ---------------------------------------------------------------------------

function zeroResult(): CrawlClassifyResult {
  return {
    fieldMappings: {},
    confidenceScores: {},
    overallConfidence: 0.0,
    listingSelector: null,
    itemSelector: null,
    itemCount: 0,
    detailPagePattern: null,
    crawledPages: [],
  };
}

// ---------------------------------------------------------------------------
// Public entry point (Task 1.2 + Task 6)
// ---------------------------------------------------------------------------

/**
 * Analyse a page using crawl/classify to detect job listings by crawling
 * links to find the listings page and classifying content blocks semantically.
 *
 * NEVER throws -- always returns a CrawlClassifyResult (NFR10).
 */
export async function analyzeWithCrawlClassify(
  page: Page,
  siteUrl: string,
): Promise<CrawlClassifyResult> {
  try {
    const result = await Promise.race<CrawlClassifyResult>([
      runCrawlClassifyAnalysis(page, siteUrl),
      new Promise<CrawlClassifyResult>((_, reject) =>
        setTimeout(
          () => reject(new Error("Crawl/classify timed out after 90s")),
          ANALYSIS_TIMEOUT_MS,
        ),
      ),
    ]);
    return result;
  } catch (error) {
    console.error("[worker] Crawl/classify failed:", {
      siteUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return zeroResult();
  }
}

// ---------------------------------------------------------------------------
// Internal pipeline (Task 1.3)
// ---------------------------------------------------------------------------

async function runCrawlClassifyAnalysis(
  page: Page,
  siteUrl: string,
): Promise<CrawlClassifyResult> {
  const crawledPages: string[] = [siteUrl];

  // Step 1: Discover the job listings page (Task 2)
  const discovered = await discoverJobsPage(page, siteUrl);
  if (discovered.crawled && discovered.url !== siteUrl) {
    crawledPages.push(discovered.url);
  }

  // Step 2: Classify content blocks semantically (Task 3)
  const blocks = await classifyContentBlocks(page);

  if (blocks.length === 0) {
    console.info("[worker] No classifiable content blocks found");
    return { ...zeroResult(), crawledPages };
  }

  // Step 3: Analyse links for detail page patterns (Task 4)
  const linkAnalysis = await analyzeLinks(page);

  // Step 4: Build field mappings from classified content (Task 5)
  const result = await buildCrawlClassifyMappings(blocks, linkAnalysis, page);

  return {
    ...result,
    crawledPages,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Discover Job Listings Page (Task 2)
// ---------------------------------------------------------------------------

async function discoverJobsPage(
  page: Page,
  siteUrl: string,
): Promise<DiscoveredPage> {
  // 1. Check if the current page already has job-listing characteristics
  const isJobsPage = await evaluateJobsPageLikelihood(page);

  if (isJobsPage >= 0.6) {
    return { url: siteUrl, crawled: false, hops: 0 };
  }

  // 2. Extract and score internal links
  const links = await extractAndScoreLinks(page, siteUrl);

  // 3. Navigate to the best candidates (max 2 hops, try top 3 links)
  for (const link of links.slice(0, 3)) {
    try {
      await page.goto(link.url, {
        waitUntil: "networkidle",
        timeout: 15_000,
      });
      const checkResult = await evaluateJobsPageLikelihood(page);

      if (checkResult >= 0.5) {
        return { url: link.url, crawled: true, hops: 1 };
      }
    } catch {
      // Navigation to this link failed -- try next candidate
      continue;
    }
  }

  // 4. If no good page found, return to original URL and analyze it anyway
  try {
    await page.goto(siteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
  } catch {
    // Could not return -- continue with whatever page we're on
  }
  return { url: siteUrl, crawled: true, hops: 0 };
}

/** Evaluate how likely the current page is a job listings page (0.0 - 1.0). */
async function evaluateJobsPageLikelihood(page: Page): Promise<number> {
  return page.evaluate(() => {
    // tsx/esbuild may emit __name(...) calls inside this serialized function.
    // Provide a no-op shim so browser-side evaluation never crashes.
    const __name = (fn: unknown) => fn;
    void __name;

    let score = 0;

    const bodyText = (document.body.textContent || "").toLowerCase();
    const title = (document.title || "").toLowerCase();

    // Job keywords in page title
    const titleKeywords = [
      "jobs",
      "careers",
      "positions",
      "vacancies",
      "openings",
      "hiring",
      "משרות",
      "דרושים",
      "קריירה",
    ];
    for (const kw of titleKeywords) {
      if (title.includes(kw)) {
        score += 0.2;
        break;
      }
    }

    // Headings with job keywords
    const headings = document.querySelectorAll("h1, h2, h3");
    for (const h of headings) {
      const hText = (h.textContent || "").toLowerCase();
      for (const kw of titleKeywords) {
        if (hText.includes(kw)) {
          score += 0.15;
          break;
        }
      }
    }

    // Repeating structures (multiple similar children)
    const containers = document.querySelectorAll(
      "div, ul, ol, section, main, table > tbody",
    );
    let hasRepeatingStructure = false;
    for (const container of containers) {
      if (container.children.length < 3) continue;
      const tags = new Map<string, number>();
      for (const child of container.children) {
        const sig = child.tagName + "." + Array.from(child.classList).sort().join(".");
        tags.set(sig, (tags.get(sig) || 0) + 1);
      }
      for (const count of tags.values()) {
        if (count >= 3) {
          hasRepeatingStructure = true;
          break;
        }
      }
      if (hasRepeatingStructure) break;
    }
    if (hasRepeatingStructure) score += 0.25;

    // Multiple links with similar URL patterns (job detail pages)
    const allLinks = document.querySelectorAll("a[href]");
    const jobLinkPatterns = [
      /\/jobs?\//i,
      /\/positions?\//i,
      /\/careers?\//i,
      /\/vacancies?\//i,
      /\/openings?\//i,
      /\/משרה\//,
      /\/משרות\//,
    ];
    let jobLinkCount = 0;
    for (const link of allLinks) {
      const href = link.getAttribute("href") || "";
      for (const pattern of jobLinkPatterns) {
        if (pattern.test(href)) {
          jobLinkCount++;
          break;
        }
      }
    }
    if (jobLinkCount >= 3) score += 0.25;
    else if (jobLinkCount >= 1) score += 0.10;

    // Job-related keywords density in body text
    const jobWords = [
      "job",
      "position",
      "career",
      "vacancy",
      "opening",
      "role",
      "hiring",
      "apply",
      "משרה",
      "תפקיד",
      "דרושים",
      "מועמדות",
    ];
    let kwCount = 0;
    for (const kw of jobWords) {
      const regex = new RegExp(kw, "gi");
      const matches = bodyText.match(regex);
      if (matches) kwCount += matches.length;
    }
    if (kwCount >= 10) score += 0.15;
    else if (kwCount >= 5) score += 0.08;

    return Math.min(1.0, score);
  });
}

/** Extract internal links and score them for job-listing likelihood. */
async function extractAndScoreLinks(
  page: Page,
  siteUrl: string,
): Promise<Array<{ url: string; text: string; score: number }>> {
  const baseUrl = siteUrl;

  const links = await page.evaluate((base) => {
    // tsx/esbuild may emit __name(...) calls inside this serialized function.
    // Provide a no-op shim so browser-side evaluation never crashes.
    const __name = (fn: unknown) => fn;
    void __name;

    const results: Array<{
      url: string;
      text: string;
      score: number;
    }> = [];

    let baseOrigin: string;
    try {
      baseOrigin = new URL(base).origin;
    } catch {
      return results;
    }

    const allLinks = document.querySelectorAll("a[href]");

    for (const link of allLinks) {
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;

      let fullUrl: string;
      try {
        fullUrl = new URL(href, base).href;
      } catch {
        continue;
      }

      // Only internal links
      try {
        if (new URL(fullUrl).origin !== baseOrigin) continue;
      } catch {
        continue;
      }

      // Skip same page
      if (fullUrl === base) continue;

      const linkText = (link.textContent || "").trim();
      let score = 0;

      // +5: URL path contains job-related segments
      const urlPath = fullUrl.toLowerCase();
      const jobUrlPatterns = [
        "/jobs",
        "/careers",
        "/positions",
        "/vacancies",
        "/openings",
        "/hiring",
        "/משרות",
        "/דרושים",
        "/קריירה",
      ];
      for (const pattern of jobUrlPatterns) {
        if (urlPath.includes(pattern)) {
          score += 5;
          break;
        }
      }

      // +3: Link text contains job-related words
      const lowerText = linkText.toLowerCase();
      const jobTextPatterns = [
        "jobs",
        "careers",
        "positions",
        "openings",
        "vacancies",
        "hiring",
        "משרות",
        "דרושים",
        "קריירה",
        "כל המשרות",
        "חיפוש משרות",
        "עבודות",
      ];
      for (const pattern of jobTextPatterns) {
        if (lowerText.includes(pattern)) {
          score += 3;
          break;
        }
      }

      // +2: Link is in the main navigation or header area
      const closestNav = link.closest("nav, header, [role='navigation']");
      if (closestNav) score += 2;

      // +1: Link is prominently positioned (within first 500px vertical)
      const rect = link.getBoundingClientRect();
      if (rect.top < 500) score += 1;

      // -3: URL contains negative path segments
      const negativePatterns = [
        "/about",
        "/contact",
        "/login",
        "/register",
        "/blog",
        "/news",
        "/privacy",
        "/terms",
        "/faq",
      ];
      for (const pattern of negativePatterns) {
        if (urlPath.includes(pattern)) {
          score -= 3;
          break;
        }
      }

      // -2: Link is in footer area
      const closestFooter = link.closest("footer, [role='contentinfo']");
      if (closestFooter) score -= 2;
      // Also check position-based footer detection
      const pageHeight = document.documentElement.scrollHeight || 1;
      if (rect.top > pageHeight * 0.8) score -= 2;

      if (score > 0) {
        results.push({ url: fullUrl, text: linkText, score });
      }
    }

    // Sort by score descending, deduplicate by URL
    const seen = new Set<string>();
    const unique: typeof results = [];
    results.sort((a, b) => b.score - a.score);
    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        unique.push(r);
      }
    }

    return unique;
  }, baseUrl);

  return links;
}

// ---------------------------------------------------------------------------
// Step 2: Classify Content Blocks Semantically (Task 3)
// ---------------------------------------------------------------------------

async function classifyContentBlocks(page: Page): Promise<ContentBlock[]> {
  return page.evaluate(() => {
    // tsx/esbuild may emit __name(...) calls inside this serialized function.
    // Provide a no-op shim so browser-side evaluation never crashes.
    const __name = (fn: unknown) => fn;
    void __name;

    // ---- helpers (must be defined inside page.evaluate) ----

    /** Check if a class name looks like a CSS-in-JS generated hash */
    function isHashClass(cls: string): boolean {
      if (/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/.test(cls)) return true;
      if (/^css-[a-zA-Z0-9]+$/.test(cls)) return true;
      if (/^[A-Z][a-zA-Z]+__[a-zA-Z]+-[a-zA-Z0-9]+$/.test(cls)) return true;
      return false;
    }

    /** Filter out hash-based class names and return stable ones */
    function stableClasses(el: Element): string[] {
      return Array.from(el.classList).filter((c) => !isHashClass(c));
    }

    /** Generate a reasonable CSS selector for an element */
    function generateSelector(el: Element): string {
      // 1. id-based
      if (el.id && /^[a-zA-Z]/.test(el.id) && !isHashClass(el.id)) {
        return `#${CSS.escape(el.id)}`;
      }

      // 2. data-attribute based
      for (const attr of el.attributes) {
        if (
          attr.name.startsWith("data-") &&
          attr.value &&
          attr.name !== "data-reactid"
        ) {
          return `[${attr.name}="${CSS.escape(attr.value)}"]`;
        }
      }

      // 3. tag + stable class
      const stable = stableClasses(el);
      const tag = el.tagName.toLowerCase();
      if (stable.length > 0) {
        const classPart = stable
          .slice(0, 3)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        return `${tag}${classPart}`;
      }

      // 4. tag + nth-child relative to parent (fallback)
      const parent = el.parentElement;
      if (parent) {
        const idx = Array.from(parent.children).indexOf(el) + 1;
        const parentSel = generateSelector(parent);
        return `${parentSel} > ${tag}:nth-child(${idx})`;
      }

      return tag;
    }

    /** Get the nearest label or preceding text that might describe this element */
    function getNearbyLabelText(el: Element): string {
      const parts: string[] = [];

      // Check aria-label
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) parts.push(ariaLabel.toLowerCase());

      // Check aria-labelledby
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl) parts.push((labelEl.textContent || "").toLowerCase());
      }

      // Check for associated <label>
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) parts.push((label.textContent || "").toLowerCase());
      }

      // Check previous sibling text
      const prevSibling = el.previousElementSibling;
      if (prevSibling) {
        const prevText = (prevSibling.textContent || "").trim();
        if (prevText.length > 0 && prevText.length < 50) {
          parts.push(prevText.toLowerCase());
        }
      }

      // Check parent element's class/id/data attributes for semantic hints
      const parent = el.parentElement;
      if (parent) {
        if (parent.className && typeof parent.className === "string") {
          parts.push(parent.className.toLowerCase());
        }
        if (parent.id) parts.push(parent.id.toLowerCase());
        for (const attr of parent.attributes) {
          if (attr.name.startsWith("data-") && attr.value) {
            parts.push(attr.name.toLowerCase());
            parts.push(attr.value.toLowerCase());
          }
        }
      }

      // Check element's own attributes
      if (el.className && typeof el.className === "string") {
        parts.push(el.className.toLowerCase());
      }
      if (el.id) parts.push(el.id.toLowerCase());

      return parts.join(" ");
    }

    /** Hebrew city names for location detection */
    const hebrewCities = [
      "תל אביב",
      "ירושלים",
      "חיפה",
      "באר שבע",
      "רמת גן",
      "פתח תקווה",
      "נתניה",
      "הרצליה",
      "ראשון לציון",
      "אשדוד",
      "רחובות",
      "כפר סבא",
      "רעננה",
      "הוד השרון",
      "מודיעין",
    ];

    /** Classify a single element based on heuristic signals. */
    function classifyBlock(
      el: Element,
      text: string,
    ): { type: string; confidence: number } {
      const labelContext = getNearbyLabelText(el);
      const tag = el.tagName.toLowerCase();
      const textLen = text.length;

      // --- Salary detection (highest priority -- very distinctive patterns) ---
      {
        let conf = 0;
        // Label proximity
        if (
          /salary|pay|compensation|wage/i.test(labelContext) ||
          labelContext.includes("שכר") ||
          labelContext.includes("משכורת")
        ) {
          conf += 0.50;
        }
        // Text pattern: currency symbols
        if (/[\u20AA$\u20AC\u00A3]/.test(text)) conf += 0.40;
        // Text pattern: NIS/ILS/shekel
        if (/\b(nis|ils|shekel)\b/i.test(text)) conf += 0.35;
        if (
          text.includes('ש"ח') ||
          text.includes("שקל") ||
          text.includes("משכורת") ||
          text.includes("שכר")
        ) {
          conf += 0.35;
        }
        // Number ranges with commas/K
        if (
          /\d{1,3}([,.]\d{3})+\s*[-\u2013]\s*\d{1,3}([,.]\d{3})+/.test(text)
        ) {
          conf += 0.25;
        }
        if (/\d+[kK]\s*[-\u2013]\s*\d+[kK]/.test(text)) conf += 0.25;

        if (conf >= 0.35) {
          return {
            type: "salary",
            confidence: Math.min(1.0, Math.round(conf * 100) / 100),
          };
        }
      }

      // --- Location detection ---
      {
        let conf = 0;
        // Label proximity
        if (
          /location|city|area|address|region|place/i.test(labelContext) ||
          labelContext.includes("מיקום") ||
          labelContext.includes("אזור") ||
          labelContext.includes("עיר")
        ) {
          conf += 0.45;
        }
        // English location patterns
        if (
          /\b(tel\s*aviv|jerusalem|haifa|israel|remote|hybrid|new york|london|san francisco|berlin)\b/i.test(
            text,
          )
        ) {
          conf += 0.40;
        }
        // Hebrew cities
        for (const city of hebrewCities) {
          if (text.includes(city)) {
            conf += 0.40;
            break;
          }
        }
        // Hebrew hybrid/remote
        if (text.includes("היברידי") || text.includes("מרחוק")) conf += 0.30;

        // Icon sibling hint
        const prevSibling = el.previousElementSibling;
        if (prevSibling) {
          const sibTag = prevSibling.tagName.toLowerCase();
          if (sibTag === "svg" || sibTag === "i" || sibTag === "img")
            conf += 0.10;
        }

        if (conf >= 0.35 && textLen < 80) {
          return {
            type: "location",
            confidence: Math.min(1.0, Math.round(conf * 100) / 100),
          };
        }
      }

      // --- Job title detection ---
      {
        let conf = 0;
        // Label proximity
        if (
          /title|position[-_]?name|job[-_]?name|job[-_]?title|role/i.test(
            labelContext,
          ) ||
          labelContext.includes("תפקיד") ||
          labelContext.includes("משרה") ||
          labelContext.includes("שם המשרה")
        ) {
          conf += 0.40;
        }
        // Element type
        if (/^h[1-6]$/.test(tag)) conf += 0.30;
        if (tag === "a" && textLen > 5 && textLen < 80) conf += 0.25;
        // Text pattern: reasonable title length, no currency
        if (textLen >= 5 && textLen <= 80 && !/[\u20AA$\u20AC\u00A3]/.test(text)) {
          conf += 0.10;
        }
        // Font size hint (headings tend to be bigger)
        const computed = window.getComputedStyle(el);
        const fontSize = parseFloat(computed.fontSize) || 14;
        if (fontSize >= 18) conf += 0.10;

        // Negative signals
        if (textLen > 200) conf -= 0.20;
        if (textLen < 5) conf -= 0.30;

        if (conf >= 0.30 && textLen >= 5 && textLen <= 150) {
          return {
            type: "job_title",
            confidence: Math.min(1.0, Math.round(conf * 100) / 100),
          };
        }
      }

      // --- Company name detection ---
      {
        let conf = 0;
        // Label proximity
        if (
          /company|employer|organization|org[-_]?name|firm|business|corp/i.test(
            labelContext,
          ) ||
          labelContext.includes("חברה") ||
          labelContext.includes("מעסיק") ||
          labelContext.includes("ארגון")
        ) {
          conf += 0.45;
        }
        // Text pattern: moderate length, capitalized
        if (textLen >= 3 && textLen <= 60) conf += 0.10;
        // Not a heading, not the longest text
        if (!/^h[1-6]$/.test(tag)) conf += 0.05;

        // Negative signals
        if (textLen > 150) conf -= 0.20;
        if (/[\u20AA$\u20AC\u00A3]/.test(text)) conf -= 0.30;
        if (
          /\b(tel\s*aviv|jerusalem|haifa|remote|hybrid)\b/i.test(text)
        ) {
          conf -= 0.20;
        }

        if (conf >= 0.25 && textLen >= 2 && textLen <= 100) {
          return {
            type: "company_name",
            confidence: Math.min(1.0, Math.round(conf * 100) / 100),
          };
        }
      }

      // --- Description detection ---
      {
        let conf = 0;
        // Label proximity
        if (
          /description|summary|details|about|excerpt|overview/i.test(
            labelContext,
          ) ||
          labelContext.includes("תיאור") ||
          labelContext.includes("פירוט")
        ) {
          conf += 0.40;
        }
        // Long text
        if (textLen > 80) conf += 0.25;
        if (tag === "p") conf += 0.15;
        if (textLen > 40 && textLen <= 500) conf += 0.10;

        // Negative
        if (textLen < 20) conf -= 0.30;

        if (conf >= 0.25 && textLen >= 30) {
          return {
            type: "description",
            confidence: Math.min(1.0, Math.round(conf * 100) / 100),
          };
        }
      }

      return { type: "unknown", confidence: 0 };
    }

    // ---- main logic ----

    const elements = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, dd, dt, label, div, strong, em, b, i",
    );

    const blocks: Array<{
      text: string;
      classification: string;
      confidence: number;
      selector: string;
      parentSelector: string | null;
    }> = [];

    let count = 0;
    for (const el of elements) {
      if (count >= 100) break; // limit to 100 elements (anti-pattern rule)

      const text = (el.textContent || "").trim();
      if (text.length === 0 || text.length > 500) continue;

      // Skip elements whose text is identical to a child's text
      const hasChildWithSameText = Array.from(el.children).some(
        (c) => (c.textContent || "").trim() === text,
      );
      if (hasChildWithSameText && el.children.length > 0) continue;

      const classification = classifyBlock(el, text);
      if (classification.type === "unknown") continue;

      const parentEl = el.parentElement;
      blocks.push({
        text: text.substring(0, 200),
        classification: classification.type,
        confidence: classification.confidence,
        selector: generateSelector(el),
        parentSelector: parentEl ? generateSelector(parentEl) : null,
      });

      count++;
    }

    return blocks;
  });
}

// ---------------------------------------------------------------------------
// Step 3: Analyse Links (Task 4)
// ---------------------------------------------------------------------------

async function analyzeLinks(page: Page): Promise<LinkAnalysis[]> {
  return page.evaluate(() => {
    // tsx/esbuild may emit __name(...) calls inside this serialized function.
    // Provide a no-op shim so browser-side evaluation never crashes.
    const __name = (fn: unknown) => fn;
    void __name;

    // ---- helpers (must be defined inside page.evaluate) ----

    function isHashClass(cls: string): boolean {
      if (/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/.test(cls)) return true;
      if (/^css-[a-zA-Z0-9]+$/.test(cls)) return true;
      if (/^[A-Z][a-zA-Z]+__[a-zA-Z]+-[a-zA-Z0-9]+$/.test(cls)) return true;
      return false;
    }

    function stableClasses(el: Element): string[] {
      return Array.from(el.classList).filter((c) => !isHashClass(c));
    }

    function generateSelector(el: Element): string {
      if (el.id && /^[a-zA-Z]/.test(el.id) && !isHashClass(el.id)) {
        return `#${CSS.escape(el.id)}`;
      }
      for (const attr of el.attributes) {
        if (
          attr.name.startsWith("data-") &&
          attr.value &&
          attr.name !== "data-reactid"
        ) {
          return `[${attr.name}="${CSS.escape(attr.value)}"]`;
        }
      }
      const stable = stableClasses(el);
      const tag = el.tagName.toLowerCase();
      if (stable.length > 0) {
        const classPart = stable
          .slice(0, 3)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        return `${tag}${classPart}`;
      }
      const parent = el.parentElement;
      if (parent) {
        const idx = Array.from(parent.children).indexOf(el) + 1;
        const parentSel = generateSelector(parent);
        return `${parentSel} > ${tag}:nth-child(${idx})`;
      }
      return tag;
    }

    // ---- main logic ----

    const allLinks = document.querySelectorAll("a[href]");
    const results: Array<{
      url: string;
      text: string;
      score: number;
      parentSelector: string | null;
    }> = [];

    const currentOrigin = window.location.origin;

    for (const link of allLinks) {
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:"))
        continue;

      let fullUrl: string;
      try {
        fullUrl = new URL(href, window.location.href).href;
      } catch {
        continue;
      }

      // Only internal links
      try {
        if (new URL(fullUrl).origin !== currentOrigin) continue;
      } catch {
        continue;
      }

      const linkText = (link.textContent || "").trim();
      let score = 0;

      // URL containing job-related path segments
      const jobPatterns = [
        /\/jobs?\//i,
        /\/positions?\//i,
        /\/careers?\//i,
        /\/vacancies?\//i,
        /\/openings?\//i,
        /\/משרה\//,
        /\/משרות\//,
      ];
      for (const pattern of jobPatterns) {
        if (pattern.test(fullUrl)) {
          score += 3;
          break;
        }
      }

      // Link text length (typical job titles are 5-80 chars)
      if (linkText.length >= 5 && linkText.length <= 80) score += 2;

      // Link density: check if parent has multiple similar links
      const parentEl = link.parentElement?.parentElement; // go up 2 levels for container
      if (parentEl) {
        const siblingLinks = parentEl.querySelectorAll("a[href]");
        if (siblingLinks.length >= 3) score += 2;
      }

      // Does the link's parent have sibling data elements (company, location text)?
      const parentItem = link.closest("li, tr, article, div");
      if (parentItem) {
        const siblingCount = parentItem.children.length;
        if (siblingCount >= 3) score += 1;
      }

      if (score > 0) {
        results.push({
          url: fullUrl,
          text: linkText,
          score,
          parentSelector: link.parentElement
            ? generateSelector(link.parentElement)
            : null,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 50); // limit
  });
}

// ---------------------------------------------------------------------------
// Step 4: Build field mappings from classified content (Task 5)
// ---------------------------------------------------------------------------

async function buildCrawlClassifyMappings(
  blocks: ContentBlock[],
  linkAnalysis: LinkAnalysis[],
  page: Page,
): Promise<CrawlClassifyResult> {
  // Group blocks by classification type, keep highest confidence for each
  const bestByType = new Map<string, ContentBlock>();
  for (const block of blocks) {
    if (block.classification === "unknown") continue;
    const existing = bestByType.get(block.classification);
    if (!existing || block.confidence > existing.confidence) {
      bestByType.set(block.classification, block);
    }
  }

  // Map classification types to field names
  const typeToField: Record<string, string> = {
    job_title: "title",
    company_name: "company",
    location: "location",
    salary: "salary",
    description: "description",
  };

  const fieldMappings: Record<string, { selector: string; sample: string }> =
    {};
  const confidenceScores: Record<string, number> = {};

  for (const [type, block] of bestByType) {
    const field = typeToField[type];
    if (!field) continue;

    fieldMappings[field] = {
      selector: block.selector,
      sample: block.text.substring(0, 100),
    };
    confidenceScores[field] = block.confidence;
  }

  // Determine listing selector and item selector from block grouping
  const { listingSelector, itemSelector, itemCount } =
    await detectListingStructure(blocks, page);

  // Extract detail page URL pattern from link analysis
  const detailPagePattern = extractDetailPagePattern(linkAnalysis);

  const overallConfidence = calculateOverallConfidence(confidenceScores);

  return {
    fieldMappings,
    confidenceScores,
    overallConfidence,
    listingSelector,
    itemSelector,
    itemCount,
    detailPagePattern,
    crawledPages: [], // will be populated by caller
  };
}

/** Detect the listing container and item structure from classified blocks. */
async function detectListingStructure(
  blocks: ContentBlock[],
  page: Page,
): Promise<{
  listingSelector: string | null;
  itemSelector: string | null;
  itemCount: number;
}> {
  // Find common parent selectors among classified blocks
  const parentCounts = new Map<string, number>();
  for (const block of blocks) {
    if (block.parentSelector) {
      parentCounts.set(
        block.parentSelector,
        (parentCounts.get(block.parentSelector) || 0) + 1,
      );
    }
  }

  // Find the parent selector that contains the most classified blocks
  let bestParent: string | null = null;
  let bestCount = 0;
  for (const [sel, count] of parentCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestParent = sel;
    }
  }

  if (!bestParent || bestCount < 2) {
    return { listingSelector: null, itemSelector: null, itemCount: 0 };
  }

  // Use page.evaluate to find the listing container and count items
  const result = await page.evaluate((parentSel) => {
    // tsx/esbuild may emit __name(...) calls inside this serialized function.
    // Provide a no-op shim so browser-side evaluation never crashes.
    const __name = (fn: unknown) => fn;
    void __name;

    const parent = document.querySelector(parentSel);
    if (!parent) return { listingSelector: null, itemSelector: null, itemCount: 0 };

    // Look for the parent's parent as the listing container
    const container = parent.parentElement;
    if (!container) return { listingSelector: null, itemSelector: null, itemCount: 0 };

    // Count siblings with similar structure
    const tag = parent.tagName.toLowerCase();
    const classes = Array.from(parent.classList)
      .filter((c) => {
        if (/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/.test(c)) return false;
        if (/^css-[a-zA-Z0-9]+$/.test(c)) return false;
        if (/^[A-Z][a-zA-Z]+__[a-zA-Z]+-[a-zA-Z0-9]+$/.test(c)) return false;
        return true;
      })
      .slice(0, 3);

    let itemSelector: string;
    if (classes.length > 0) {
      itemSelector = `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`;
    } else {
      itemSelector = tag;
    }

    const matchingItems = container.querySelectorAll(`:scope > ${itemSelector}`);

    // Generate container selector
    function genSelector(el: Element): string {
      if (
        el.id &&
        /^[a-zA-Z]/.test(el.id) &&
        !/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/.test(el.id) &&
        !/^css-[a-zA-Z0-9]+$/.test(el.id)
      ) {
        return `#${CSS.escape(el.id)}`;
      }
      for (const attr of el.attributes) {
        if (
          attr.name.startsWith("data-") &&
          attr.value &&
          attr.name !== "data-reactid"
        ) {
          return `[${attr.name}="${CSS.escape(attr.value)}"]`;
        }
      }
      const stbl = Array.from(el.classList)
        .filter((c) => {
          if (/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/.test(c)) return false;
          if (/^css-[a-zA-Z0-9]+$/.test(c)) return false;
          if (/^[A-Z][a-zA-Z]+__[a-zA-Z]+-[a-zA-Z0-9]+$/.test(c)) return false;
          return true;
        })
        .slice(0, 3);
      const t = el.tagName.toLowerCase();
      if (stbl.length > 0) {
        return `${t}.${stbl.map((c) => CSS.escape(c)).join(".")}`;
      }
      return t;
    }

    return {
      listingSelector: genSelector(container),
      itemSelector,
      itemCount: matchingItems.length,
    };
  }, bestParent);

  return result;
}

/** Extract a detail page URL pattern from links (e.g., /jobs/:id). */
function extractDetailPagePattern(
  linkAnalysis: LinkAnalysis[],
): string | null {
  if (linkAnalysis.length < 2) return null;

  // Look for links with similar URL structures that differ only in a numeric/id segment
  const topLinks = linkAnalysis.slice(0, 20);
  const urlParts = topLinks.map((link) => {
    try {
      const url = new URL(link.url);
      return {
        pathname: url.pathname,
        segments: url.pathname.split("/").filter(Boolean),
      };
    } catch {
      return null;
    }
  }).filter((x): x is { pathname: string; segments: string[] } => x !== null);

  if (urlParts.length < 2) return null;

  // Find common path prefix and varying segment
  const first = urlParts[0];
  for (let segIdx = 0; segIdx < first.segments.length; segIdx++) {
    const segment = first.segments[segIdx];
    // Check if this segment varies across URLs
    const varies = urlParts.some(
      (u) => u.segments.length === first.segments.length && u.segments[segIdx] !== segment,
    );
    if (varies) {
      // This segment is the varying part (likely the ID)
      const patternSegments = [...first.segments];
      patternSegments[segIdx] = ":id";
      return "/" + patternSegments.join("/");
    }
  }

  return null;
}

