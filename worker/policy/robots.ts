/**
 * Lightweight robots.txt reader.
 *
 * Serves two purposes:
 *   1. Secondary risk signal: detect whether the site broadly disallows crawling.
 *   2. Discovery hint: extract Sitemap directives that may point to policy pages.
 *
 * IMPORTANT: robots.txt is a crawl-directive file, NOT a legal/contractual
 * document. It never drives the headline policy status on its own. It is stored
 * as audit evidence only, and can produce a soft downgrade from
 * NO_EXPLICIT_RESTRICTION → UNCLEAR_NEEDS_REVIEW when `robotsInfluencesStatus`
 * is enabled in config.
 */

const FETCH_TIMEOUT_MS = 10_000;

export interface RobotsResult {
  checked: boolean;
  /** A broad Disallow: / rule found for * or our UA. */
  disallowsAll: boolean;
  /** Raw rule lines that touch career / job-related paths. */
  relevantRules: string[];
  /** Sitemap URLs found in the file (may help discover policy pages). */
  sitemapUrls: string[];
  error?: string;
}

const CAREER_PATH_PATTERNS = [
  /\/jobs/i,
  /\/careers/i,
  /\/work/i,
  /\/משרות/,
  /\/קריירה/,
];

/**
 * Fetch and parse `https://<host>/robots.txt`.
 * Never throws — on any error returns `checked: false` with an error message.
 */
export async function fetchRobots(siteUrl: string): Promise<RobotsResult> {
  let robotsUrl: string;
  try {
    const u = new URL(siteUrl);
    robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  } catch {
    return { checked: false, disallowsAll: false, relevantRules: [], sitemapUrls: [], error: "Invalid site URL" };
  }

  let text: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HaidePolicyBot/1.0)" },
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        checked: true,
        disallowsAll: false,
        relevantRules: [],
        sitemapUrls: [],
        error: `HTTP ${res.status}`,
      };
    }
    text = await res.text();
  } catch (err) {
    return {
      checked: true,
      disallowsAll: false,
      relevantRules: [],
      sitemapUrls: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return parseRobots(text);
}

function parseRobots(text: string): RobotsResult {
  const lines = text.split(/\r?\n/);
  const sitemapUrls: string[] = [];
  const relevantRules: string[] = [];
  let disallowsAll = false;

  // Track which user-agent block we're in.
  // We care about * (everyone) — we don't send a custom UA during policy checks.
  let inRelevantBlock = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      inRelevantBlock = value === "*";
      continue;
    }

    if (directive === "sitemap") {
      if (value) sitemapUrls.push(value);
      continue;
    }

    if (!inRelevantBlock) continue;

    if (directive === "disallow") {
      // Broad: Disallow: / means nothing is allowed
      if (value === "/" || value === "") {
        if (value === "/") disallowsAll = true;
        relevantRules.push(line);
        continue;
      }
      // Career/job path specific
      if (CAREER_PATH_PATTERNS.some((re) => re.test(value))) {
        relevantRules.push(line);
      }
    }
  }

  return {
    checked: true,
    disallowsAll,
    relevantRules,
    sitemapUrls,
  };
}
