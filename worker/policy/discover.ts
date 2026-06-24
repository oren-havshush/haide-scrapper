/**
 * Policy page discovery.
 *
 * Discovers candidate URL(s) for terms-of-use, privacy policy, and legal pages
 * using the site itself as the primary source — no external search engine.
 *
 * Discovery order:
 *   1. Common URL patterns probed directly (lightweight, no browser needed).
 *   2. Homepage links: footer/header/nav links whose text or href matches policy keywords.
 *   3. (Optional) Sitemap URLs parsed from robots.txt or sitemap.xml path.
 *
 * Returns a deduplicated list ranked by confidence, capped to maxPages.
 */

import type { Page } from "playwright";
import {
  isPolicyLinkText,
  isPolicyUrlPath,
  getPolicyDocumentType,
  POLICY_URL_PATHS,
  POLICY_DOC_PATHS,
  EN_POLICY_LINK_TEXT,
  HE_POLICY_LINK_TEXT,
} from "./keywords";

const FETCH_TIMEOUT_MS = 10_000;
const COMMON_PATTERN_TIMEOUT_MS = 5_000;

export interface DiscoveredUrl {
  url: string;
  source: "common_pattern" | "page_link" | "sitemap";
  linkText?: string;
  score: number;
}

/**
 * Discover candidate policy page URLs for the given site.
 *
 * @param siteUrl   The base/career URL for the site.
 * @param page      An already-navigated Playwright page (on the site's homepage or career URL).
 * @param sitemapUrls  Optional URLs extracted from robots.txt Sitemap directives.
 * @param maxPages  Maximum number of candidate URLs to return (default: 4).
 */
export async function discoverPolicyUrls(
  siteUrl: string,
  page: Page,
  sitemapUrls: string[] = [],
  maxPages = 4,
): Promise<DiscoveredUrl[]> {
  const candidates: DiscoveredUrl[] = [];
  const seen = new Set<string>();

  function add(u: DiscoveredUrl) {
    const key = u.url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(u);
  }

  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    origin = siteUrl;
  }

  // 1. Probe common URL patterns (lightweight HEAD/GET requests, no browser)
  await probeCommonPatterns(origin, add);

  // 2. Extract links from the already-loaded page
  await extractPageLinks(page, origin, add);

  // 3. Filter sitemap URLs for policy-looking paths
  for (const u of sitemapUrls) {
    if (isPolicyUrlPath(u)) {
      add({ url: u, source: "sitemap", score: 3 });
    }
  }

  // Sort by score descending, deduplicated by URL
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, maxPages);
}

// ---------------------------------------------------------------------------
// Step 1: probe common URL patterns
// ---------------------------------------------------------------------------

async function probeCommonPatterns(
  origin: string,
  add: (u: DiscoveredUrl) => void,
): Promise<void> {
  // Probe both HTML policy paths and document (PDF/Word) policy paths.
  const allPaths = [...POLICY_URL_PATHS, ...POLICY_DOC_PATHS];
  // Run HEAD probes concurrently (capped)
  const checks = allPaths.map(async (path) => {
    const url = `${origin}${path}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), COMMON_PATTERN_TIMEOUT_MS);
      const res = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HaidePolicyBot/1.0)" },
      });
      clearTimeout(timer);
      if (res.ok) {
        const finalUrl = res.url || url;
        add({ url: finalUrl, source: "common_pattern", score: scoreByPath(finalUrl) });
      }
    } catch {
      // Not reachable or timed out — skip silently
    }
  });

  await Promise.allSettled(checks);
}

// ---------------------------------------------------------------------------
// Step 2: extract links from the already-loaded page
// ---------------------------------------------------------------------------

async function extractPageLinks(
  page: Page,
  origin: string,
  add: (u: DiscoveredUrl) => void,
): Promise<void> {
  type LinkInfo = { href: string; text: string };

  const links = await page
    .evaluate(() => {
      const out: LinkInfo[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = (a as HTMLAnchorElement).href?.trim();
        const text = (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
        if (href && (href.startsWith("http") || href.startsWith("/"))) {
          out.push({ href, text });
        }
      }
      return out;
    })
    .catch(() => [] as LinkInfo[]);

  for (const { href, text } of links) {
    // Resolve to absolute URL
    let absUrl: string;
    try {
      absUrl = new URL(href, origin).href;
    } catch {
      continue;
    }

    // Only consider same-origin links (policy pages of the site, not external)
    if (!absUrl.startsWith(origin)) continue;

    const matchesText = isPolicyLinkText(text);
    const matchesPath = isPolicyUrlPath(absUrl);

    if (!matchesText && !matchesPath) continue;

    let score = 2;
    if (matchesText && matchesPath) score = 8;
    else if (matchesText) score = 6;
    else if (matchesPath) score = 4;

    // Boost for footer/bottom-of-page context (heuristic: link is inside footer/small)
    // We can't easily detect this without DOM position, but path-only matches in nav get a small boost
    score += textScore(text);

    // A policy link pointing at a downloadable document (PDF/Word) is a strong
    // signal — many sites publish their only terms/privacy doc this way.
    if (getPolicyDocumentType(absUrl)) score += 2;

    add({ url: absUrl, source: "page_link", linkText: text, score });
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function scoreByPath(url: string): number {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.includes("terms") || pathname.includes("takanon")) return 7;
    if (pathname.includes("privacy") || pathname.includes("legal")) return 6;
    return 4;
  } catch {
    return 3;
  }
}

function textScore(text: string): number {
  const lower = text.toLowerCase();
  for (const kw of [...EN_POLICY_LINK_TEXT, ...HE_POLICY_LINK_TEXT]) {
    if (lower === kw.toLowerCase()) return 2; // exact match
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Fetch a discovered policy page and return its HTML
// ---------------------------------------------------------------------------

export async function fetchPolicyPage(
  url: string,
  page: Page,
): Promise<{ html: string; finalUrl: string; error?: string }> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: FETCH_TIMEOUT_MS,
    });
    const html = await page.content();
    const finalUrl = page.url();
    return { html, finalUrl };
  } catch (err) {
    return {
      html: "",
      finalUrl: url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
