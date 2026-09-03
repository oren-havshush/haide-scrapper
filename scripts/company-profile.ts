/**
 * scripts/company-profile.ts — one-shot company-profile capture.
 *
 *   npx tsx scripts/company-profile.ts --site <siteId|siteUrl> [--dry-run]
 *   npx tsx scripts/company-profile.ts --all [--status ACTIVE] [--limit 50]
 *                                      [--concurrency 3] [--dry-run]
 *
 * Flags:
 *   --site <id|url>   One site. Accepts a cuid or the exact siteUrl.
 *   --all             Every site with companyProfileAt = NULL (see --status).
 *   --status <S>      Restrict --all to one SiteStatus. Default: ACTIVE.
 *   --limit <N>       Cap how many sites --all processes. Default: 50.
 *   --concurrency <N> Sites in flight at once. Default: 3.
 *   --dry-run         Scrape and print, write nothing. Safe to run any time.
 *   --force           Overwrite a profile already captured. See the guard below.
 *   --no-llm          Deterministic extraction only, never call OpenAI.
 *   --out <path>      Append one JSON result per site to this file.
 *   --write-empty     Record a capture that found nothing. Off by default: an
 *                     empty result is usually a slow page, and writing it makes
 *                     that permanent (see isThinCapture).
 *   --probe <url>     Scrape an arbitrary URL and print what WOULD be captured.
 *                     No database, no token, no writes — implies --dry-run.
 *                     Use it to debug extraction before onboarding a site.
 *
 * WHAT THIS IS: company data is captured ONCE per site, at onboarding, and is
 * never refreshed by the weekly scrape. Job rows churn; a company's name, logo
 * and address do not. saveCompanyProfile() enforces that in code — a second run
 * without --force is rejected with 409 — so a re-run cannot silently clobber a
 * value someone corrected by hand.
 *
 * WHAT IT MUST NOT TOUCH: only the `company*` columns. Never `status`,
 * `configLocked`, `fieldMappings`, or `pageFlow`. The write goes through
 * PUT /api/sites/:id/company-profile, whose service-layer allowlist makes that
 * mechanical rather than merely intended.
 *
 * TWO GATES, both of which reject rather than approximate:
 *   - the city must be VERBATIM from "CSV files/city.csv" (scripts/lib/city-csv.ts)
 *   - the logo must pass magic-byte validation (src/lib/image-validate.ts),
 *     downloaded HERE via scripts/lib/fetch-image.ts and uploaded as raw bytes,
 *     so the server never fetches a URL found in scraped HTML
 *
 * The LLM is a FALLBACK, not the extractor. Deterministic rules run first; the
 * model is asked only for the fields they could not fill, and only for prose
 * (about copy, address line). It is never asked for the city — that always
 * comes from the gate.
 */

import "dotenv/config";
import { readFileSync, appendFileSync } from "node:fs";
import path from "node:path";

// Must be set before anything imports playwright, matching how the worker runs.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

import {
  addressFromJsonLd,
  classifyProfileStatus,
  collectLogoCandidates,
  deriveHomepageCandidates,
  emptyHarvest,
  extractAboutText,
  extractAddressLine,
  extractCompactAddressLines,
  extractLabelledAddress,
  extractOfficeListRuns,
  homepageFromLinks,
  parseJsonLdOrganization,
  pickAboutUrl,
  pickContactUrl,
  pickPolicyUrl,
  sanitizeModelText,
  type LogoCandidate,
  type OrganizationLd,
  type PageHarvest,
} from "./lib/company-extract";
import { canonicalCity, loadCityList, matchCityInAddress, type CityList } from "./lib/city-csv";
import { fetchImage, ImageRejected, type FetchedImage } from "./lib/fetch-image";
import { inspectImage } from "../src/lib/image-validate";

import type { Browser, Page } from "playwright";
import type { BrowserOverrides } from "../worker/lib/playwright";

const BASE = process.env.SCRAP_BASE ?? "https://scrapper.haide-jobs.co.il";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");
const NAV_TIMEOUT_MS = 25_000;
/** Second, more patient attempt — see the retry loop in harvest(). */
const NAV_TIMEOUT_RETRY_MS = 40_000;
const LLM_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "gpt-4o-mini";
/** Enough for a homepage plus an about page; more is menu noise, not signal. */
const LLM_MAX_CHARS = 12_000;
/** Timing for settle() — see that function for why a floor is required. */
const SETTLE_STEP_MS = 400;
/** Consecutive unchanged polls before a page counts as settled. */
const SETTLE_STABLE_POLLS = 3;
const SETTLE_MIN_MS = 1_800;
const SETTLE_MAX_MS = 8_000;
/** Used on the retry of a capture that came back almost empty. */
const SETTLE_MIN_PATIENT_MS = 4_000;
const SETTLE_MAX_PATIENT_MS = 20_000;
/**
 * Below this share of the logo clearing 3:1 contrast on a white page, warn.
 *
 * Chosen on principle — "more than half the mark has disappeared" — NOT fitted
 * to data. Measured across the first four sites the distribution was bimodal:
 * flying-cargo and biopharmax scored 0.0% visible on white, kley-zemer 100%.
 * Anything from roughly 0.1 to 0.9 classifies those identically, so the sample
 * does not pin the number down. Revisit after a full --all run shows whether
 * any real logo lands in the middle.
 */
const LOGO_VISIBLE_ON_WHITE_MIN = 0.5;

/**
 * How much better a dark backdrop must be before the warning recommends one.
 * Without this, a mid-grey logo that is low-contrast on white AND on dark would
 * be reported as fixable by a dark chip, which it is not.
 */
const LOGO_DARK_IMPROVEMENT_MIN = 0.25;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function intArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
function token(): string {
  if (cachedToken === null) cachedToken = readFileSync(TOKEN_PATH, "utf8").trim();
  return cachedToken;
}

interface SiteRow {
  id: string;
  siteUrl: string;
  companyName: string | null;
  /** Absent from the company-profile sub-resource; only --all supplies it. */
  status?: string;
  companyProfileAt: string | null;
  /**
   * Operator-supplied homepage for an ATS-hosted site, set from the dashboard
   * via PUT /api/sites/:id/company-homepage. Present BEFORE any capture,
   * because recording it deliberately does not stamp companyProfileAt.
   */
  companyHomepageUrl?: string | null;
}

interface SiteConfigResponse {
  data?: { fieldMappings?: { _meta?: { browserOverrides?: BrowserOverrides } } };
}

/**
 * Facts supplied by an operator for sites no amount of scraping can resolve.
 *
 * Keyed by SITE ID, never by host. Two of these three sit on a recruitment
 * vendor's domain that serves several unrelated employers, so a host key would
 * hand one employer's city to every other employer on the same board.
 *
 * A supplied city is AUTHORITATIVE and wins over anything scraped, for the same
 * reason a supplied homepage does: it exists because a human looked at a site
 * the capture could not read, and second-guessing it would defeat the point of
 * having asked. It is still put through the city.csv gate — an off-list
 * spelling would fragment the dashboard's city filter exactly like a scraped
 * one, and a typo here is silent otherwise.
 *
 * Prefer the dashboard for a homepage (PUT /api/sites/:id/company-homepage,
 * which stores it on the site row). The entry below is here only because the
 * URL was supplied in a session with no dashboard to hand; moving it costs
 * nothing and the DB value wins automatically.
 */
const MANUAL_PROFILE: Record<string, { homepage?: string; city?: string }> = {
  // מוזיאון ישראל — every URL on imj.org.il returns the same ~101KB obfuscated
  // JS anti-bot challenge, and headless Chromium renders an empty DOM from it:
  // no title, no links, no text. Nothing is extractable, address included.
  cmqymqkbn004101nzck442rnv: { city: "ירושלים" },
  // TADIRAN GROUP — siteUrl points at careers.topmatch.co.il, a recruitment
  // vendor's board. The employer's own site (tadiran-group.co.il) is not linked
  // from it, so the homepage cannot be derived and neither can the address.
  cmqykv29i003i01nzvw1z5jpw: { city: "פתח תקווה" },
  // מסוף שירותי לוגיסטיקה — publishes no address anywhere: the צור-קשר page
  // carries a form, a phone number and an email, and the only iframe on it is
  // reCAPTCHA, not a map. Its about page is the sole clue, and it describes a
  // facility rather than a head office ("מרכז תפעול שליטה ובקרה (מרלו״ג) …
  // הנמצא באזור התעשייה בחולון"), so the city is confirmed by hand rather than
  // inferred from that sentence.
  cmqyc59mw001701nzdz2bfcz7: { city: "חולון" },
  // כפיר מעליות — hosted on app.civi.co.il, an ATS board that links nothing
  // belonging to the employer. Supplying the homepage lets the capture read the
  // company's own site for the address, about copy and logo.
  cmqz4xfcn004o01nzebbuhdfj: { homepage: "https://www.kfir-elevators.com/" },
};

/**
 * Per-site browser overrides, read from the SAME place the worker reads them
 * (Site.fieldMappings._meta.browserOverrides).
 *
 * Onboarders set these to unblock WAF-protected sites, and without them this
 * script gets a different answer than the worker does for the very sites that
 * needed the most work to onboard: msh.co.il serves bare headless Chromium a
 * 403 "הגישה נדחתה" page, and its stored UA override is what gets past it.
 */
async function browserOverridesFor(siteId: string): Promise<BrowserOverrides | undefined> {
  try {
    const res = await api<SiteConfigResponse>("GET", `/api/sites/${siteId}/config`);
    return res.data?.fieldMappings?._meta?.browserOverrides ?? undefined;
  } catch {
    // A site with no saved config is normal; defaults are the right fallback.
    return undefined;
  }
}

async function api<T>(
  method: string,
  pathname: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body !== undefined && !(body instanceof Uint8Array)
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : body instanceof Uint8Array
          ? Buffer.from(body)
          : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathname} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function resolveSites(): Promise<SiteRow[]> {
  // --probe scrapes an arbitrary URL with no database behind it: no token, no
  // API call, nothing written. It exists so the extraction can be debugged on
  // a site before onboarding it, and so this script is testable without a
  // deployed server. It implies --dry-run (enforced in main()).
  const probe = arg("probe");
  if (probe) {
    return [
      {
        id: "probe0000000000000000",
        siteUrl: probe,
        companyName: null,
        status: "PROBE",
        companyProfileAt: null,
      },
    ];
  }

  const single = arg("site");
  if (single) {
    // A cuid, or the exact siteUrl. Both are exact lookups — no fuzzy match,
    // so this can never capture a profile onto the wrong site.
    if (/^[a-z0-9]{20,32}$/.test(single)) {
      // NOT `GET /api/sites/:id` — that route exposes only PATCH and DELETE and
      // answers a GET with 405. The company-profile sub-resource returns
      // COMPANY_PROFILE_SELECT, which already carries every field needed here.
      const res = await api<{ data: SiteRow }>("GET", `/api/sites/${single}/company-profile`);
      return [res.data];
    }
    const res = await api<{ data: SiteRow[] }>(
      "GET",
      `/api/sites?siteUrl=${encodeURIComponent(single)}&pageSize=5`,
    );
    if (res.data.length === 0) throw new Error(`no site with siteUrl ${single}`);
    if (res.data.length > 1) {
      throw new Error(`${res.data.length} sites share siteUrl ${single} — pass --site <id>`);
    }
    return res.data;
  }

  if (!flag("all")) {
    throw new Error("pass --site <id|url> or --all (see the header of this file)");
  }

  const status = arg("status") ?? "ACTIVE";
  const limit = intArg("limit", 50);
  const force = flag("force");

  const out: SiteRow[] = [];
  for (let page = 1; out.length < limit; page++) {
    const res = await api<{ data: SiteRow[]; meta?: { total: number } }>(
      "GET",
      `/api/sites?status=${encodeURIComponent(status)}&page=${page}&pageSize=100`,
    );
    if (res.data.length === 0) break;
    for (const site of res.data) {
      // Skip already-captured sites here rather than discovering it after a
      // full scrape — the server would reject the write anyway.
      if (site.companyProfileAt && !force) continue;
      out.push(site);
      if (out.length >= limit) break;
    }
    if (res.data.length < 100) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

/**
 * Load one URL and collect everything the extraction rules need, in a single
 * page.evaluate() so the DOM is walked once.
 *
 * Returns null when the page cannot be loaded at all. A company with an
 * unreachable homepage is a normal outcome, not an error worth aborting on.
 */
/**
 * Wait until the page stops adding links and images, or the cap expires.
 *
 * This replaced a flat 1.5s sleep, which produced NON-DETERMINISTIC captures:
 * biopharmax.com yielded its HQ address on one run and nothing on the next,
 * minutes apart, purely because its nav had not hydrated inside that window and
 * so pickContactUrl() saw no contact link. Since a capture is write-once, a
 * slow run does not merely return less — it permanently stores less.
 *
 * Anchors and images are the right things to watch because they are exactly
 * what the extraction consumes: links drive about/contact discovery, images
 * drive logo discovery.
 */
async function settle(page: Page, patient = false): Promise<void> {
  const started = Date.now();
  const maxMs = patient ? SETTLE_MAX_PATIENT_MS : SETTLE_MAX_MS;
  const minMs = patient ? SETTLE_MIN_PATIENT_MS : SETTLE_MIN_MS;

  let previous = -1;
  let stablePolls = 0;

  for (;;) {
    let count: number;
    try {
      count = await page.evaluate(
        () => document.querySelectorAll("a[href]").length + document.querySelectorAll("img").length,
      );
    } catch {
      return; // navigated away mid-poll; the caller handles what it got
    }

    if (count === previous) stablePolls++;
    else {
      stablePolls = 0;
      previous = count;
    }

    const elapsed = Date.now() - started;

    // BOTH conditions, and the floor is the one that matters most. Requiring
    // only stability made this WORSE than the flat 1.5s sleep it replaced:
    // biopharmax.com ships its 121 links in the server-rendered HTML, so the
    // count is stable on the second poll and harvesting began at ~400ms, while
    // the page was still loading (its image count was still climbing, 18 -> 34).
    if (elapsed >= minMs && stablePolls >= SETTLE_STABLE_POLLS && count > 0) return;
    if (elapsed >= maxMs) return;

    await page.waitForTimeout(SETTLE_STEP_MS);
  }
}

async function harvest(page: Page, url: string, patient = false): Promise<PageHarvest | null> {
  try {
    // Two attempts, the second more patient. A nav timeout is a TRANSIENT
    // failure and worth retrying: biopharmax.com times out on roughly one load
    // in four, and losing its contact page that way silently costs the HQ
    // address on an otherwise COMPLETE capture — which then gets written and
    // locked in. A non-OK HTTP status is NOT retried; 404 is a real answer.
    let response = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: attempt === 0 ? NAV_TIMEOUT_MS : NAV_TIMEOUT_RETRY_MS,
        });
        break;
      } catch (error) {
        if (attempt === 1) throw error;
        console.info(`[company-profile] nav retry: ${url}`);
      }
    }

    // page.goto() does NOT throw on an HTTP error status, so without this a WAF
    // block page is harvested as though it were the company site. msh.co.il
    // answers headless Chromium with a 403 "הגישה נדחתה" page, and that page
    // has a <title>, a body and an <img> — enough to look like a successful
    // capture and to put the block notice itself into companyAbout.
    // A null response means a same-document navigation, which is fine.
    if (response && !response.ok()) return null;

    await settle(page, patient);
  } catch {
    return null;
  }

  try {
    const collected = await page.evaluate(async () => {
      const CHROME_SELECTOR = "header, nav, footer";

      const metas: Record<string, string> = {};
      for (const el of Array.from(document.querySelectorAll("meta"))) {
        const key = (el.getAttribute("property") || el.getAttribute("name") || "")
          .trim()
          .toLowerCase();
        const content = (el.getAttribute("content") || "").trim();
        if (key && content && !(key in metas)) metas[key] = content;
      }

      const jsonLd: string[] = [];
      for (const el of Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      )) {
        const raw = (el.textContent || "").trim();
        if (raw) jsonLd.push(raw.slice(0, 200_000));
      }

      const links: { href: string; text: string; inChrome: boolean }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]")).slice(0, 400)) {
        const anchor = a as HTMLAnchorElement;
        const href = (anchor.getAttribute("href") || "").trim();
        if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
        links.push({
          href,
          text: (anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
          inChrome: !!anchor.closest(CHROME_SELECTOR),
        });
      }

      const images: {
        src: string;
        alt: string;
        width: number;
        height: number;
        inHeader: boolean;
        context: string;
      }[] = [];
      for (const el of Array.from(document.querySelectorAll("img[src]")).slice(0, 200)) {
        const img = el as HTMLImageElement;
        const src = (img.getAttribute("src") || "").trim();
        if (!src || src.startsWith("data:")) continue;
        const parent = img.closest("[class], [id]");
        images.push({
          src,
          alt: (img.getAttribute("alt") || "").slice(0, 120),
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0,
          inHeader: !!img.closest("header, nav"),
          context: `${parent?.className ?? ""} ${parent?.id ?? ""}`.toLowerCase().slice(0, 200),
        });
      }

      // Logos set as a CSS background rather than an <img>. Common enough on
      // Israeli sites (and on every Elementor/Wix theme) that skipping them
      // costs real coverage — an img[src] scan simply cannot see them. Only
      // elements that already name themselves "logo" are inspected, so this
      // stays a handful of getComputedStyle calls rather than a whole-DOM walk.
      for (const el of Array.from(
        document.querySelectorAll("[class*='logo' i], [id*='logo' i]"),
      ).slice(0, 20)) {
        const background = getComputedStyle(el).backgroundImage;
        const hit = /url\((['"]?)([^'")]+)\1\)/.exec(background || "");
        const src = hit?.[2]?.trim();
        if (!src || src.startsWith("data:")) continue;
        const rect = el.getBoundingClientRect();
        images.push({
          src,
          alt: (el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 120),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          inHeader: !!el.closest("header, nav"),
          // "logo" is guaranteed to be in here by the selector above, which is
          // what makes collectLogoCandidates() pick these up.
          context: `${el.className ?? ""} ${el.id ?? ""} background`.toLowerCase().slice(0, 200),
        });
      }

      // Read the LIVE element, never a clone. innerText is layout-aware — it
      // is what turns block elements into the blank-line-separated paragraphs
      // that extractAboutText() splits on — and on a DETACHED node the browser
      // has no layout to consult, so it silently degrades to textContent and
      // every paragraph break disappears. Reading the live node also means
      // script/style/noscript and display:none content are excluded for free,
      // because innerText only ever returns rendered text.
      //
      // <main> is PREFERRED but not TRUSTED. Accessible Israeli sites routinely
      // ship a <main> that holds nothing but "דלג לתפריט הראשי" skip-links,
      // with the real content in sibling divs — taking it blindly yielded three
      // lines of navigation and no about copy at all. So <main> has to earn it:
      // enough text to be real, and a real share of the page.
      const body = document.body;
      const fullText = body instanceof HTMLElement ? body.innerText : "";

      let narrowed: string | null = null;
      for (const selector of ["main", "article", "[role='main']"]) {
        const el = document.querySelector(selector);
        if (!(el instanceof HTMLElement)) continue;
        const text = el.innerText;
        // Enough text to be real content, and a real share of the page.
        if (text.length < 200 || text.length < fullText.length * 0.25) continue;
        if (narrowed === null || text.length > narrowed.length) narrowed = text;
      }
      const bodyText = (narrowed ?? fullText).slice(0, 60_000);

      const footerEl = document.querySelector("footer");
      const footerText = (footerEl instanceof HTMLElement ? footerEl.innerText : "").slice(0, 8_000);

      // Inline <svg> logos, rasterised to PNG right here in the page.
      //
      // Three things force this. (1) An inline <svg> is neither an <img> nor a
      // CSS background, so nothing else in this harvest can see it — and it is
      // how a lot of modern themes ship the logo (flying-cargo.com's is a
      // 741-byte inline SVG in the header). (2) src/lib/image-validate.ts
      // rejects SVG outright, deliberately: a crafted "SVG" is a script
      // delivery vehicle. (3) These marks are usually small — that one declares
      // 51x71 — which is under the 64px floor even before any of the above.
      //
      // Rasterising in the browser answers all three at once: the server only
      // ever receives PNG bytes and still validates them, and because SVG is
      // vector the upscale to clear the floor is lossless rather than a blurry
      // stretch of a small bitmap.
      const inlineLogos: { dataUrl: string; pathCount: number; area: number }[] = [];
      const svgCandidates = Array.from(
        document.querySelectorAll("header svg, nav svg, a[href='/'] svg"),
      ).slice(0, 6);

      for (const svg of svgCandidates) {
        try {
          const markup = svg.outerHTML;
          // An SVG referencing anything external taints the canvas, making
          // toDataURL() throw. Those are animations and sprites, not logos.
          if (markup.length > 100_000) continue;
          if (/xlink:href|<image\b|url\(\s*['"]?https?:/i.test(markup)) continue;

          const clone = svg.cloneNode(true) as SVGElement;
          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

          // Intrinsic size, falling back to the viewBox — the rendered box is
          // the wrong source, since CSS often shrinks the mark.
          let width = parseFloat(clone.getAttribute("width") || "") || 0;
          let height = parseFloat(clone.getAttribute("height") || "") || 0;
          const viewBox = (clone.getAttribute("viewBox") || "").split(/[\s,]+/);
          if ((!width || !height) && viewBox.length === 4) {
            width = parseFloat(viewBox[2]) || 0;
            height = parseFloat(viewBox[3]) || 0;
          }
          if (!width || !height) continue;

          // Clear the 64px floor with room to spare on the SHORTER side.
          const scale = Math.max(1, Math.ceil(256 / Math.min(width, height)));
          const targetW = Math.round(width * scale);
          const targetH = Math.round(height * scale);
          if (targetW > 4_000 || targetH > 4_000) continue;

          clone.setAttribute("width", String(targetW));
          clone.setAttribute("height", String(targetH));

          const encoded = new XMLSerializer().serializeToString(clone);
          const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(encoded)}`;

          const image = new Image();
          const loaded = await new Promise<boolean>((resolve) => {
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = dataUrl;
          });
          if (!loaded) continue;

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.drawImage(image, 0, 0, targetW, targetH);

          // No visibility measurement here on purpose. It used to live in this
          // loop and so ran ONLY for inline SVGs — which meant biopharmax.com,
          // whose JSON-LD PNG logo is equally invisible on a white page, was
          // never flagged. measureLogoVisibility() now checks whichever
          // candidate actually wins, whatever its source.
          inlineLogos.push({
            dataUrl: canvas.toDataURL("image/png"),
            // Ordering signals only — see InlineLogo in company-extract.ts.
            pathCount: svg.querySelectorAll("path").length,
            area: Math.round(width * height),
          });
        } catch {
          // One unrasterisable SVG must not cost the whole harvest.
        }
      }

      return {
        url: document.location.href,
        title: (document.title || "").slice(0, 300),
        metas,
        jsonLd,
        links,
        images,
        bodyText,
        footerText,
        inlineLogos,
      };
    });

    return collected as PageHarvest;
  } catch {
    // A page that navigated but refuses to be read (hostile CSP, immediate
    // redirect mid-evaluate) still gives us its URL.
    return { ...emptyHarvest(page.url()) };
  }
}

// ---------------------------------------------------------------------------
// LLM fallback
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT = `You extract company facts from the text of a company's own website.

STRICT RULES:
1. Use ONLY the supplied text. Never use outside knowledge about the company.
2. If the text does not state something, return null for it. Never guess, never
   infer, never write a generic description of the industry.
3. "about" must be copy the company wrote about ITSELF, in the language of the
   source text (usually Hebrew). Plain text only — no HTML, no markdown, no
   bullet characters, no surrounding quotes.
4. "about" must be at most 600 characters. Prefer whole sentences, copied or
   lightly condensed from the source. Do not translate it.
5. "hq_address" is the company's own street address, as printed. Do not include
   a phone number, an email, a PO box, or a country name. Return null unless an
   actual street address appears in the text.
6. Never return a city on its own as "hq_address".

Respond with ONLY a JSON object, no markdown fences:
{"about": string|null, "hq_address": string|null}`;

interface LlmFields {
  about: string | null;
  hqAddress: string | null;
}

/**
 * Ask the model for the prose fields the deterministic rules could not fill.
 *
 * `need` gates the call entirely: if the rules already produced everything, no
 * request is made and no tokens are spent. Any failure returns nulls — a
 * missing about-line is never worth failing a capture over.
 */
async function llmFallback(
  texts: { url: string; text: string }[],
  need: { about: boolean; address: boolean },
): Promise<LlmFields> {
  const empty: LlmFields = { about: null, hqAddress: null };
  if (!need.about && !need.address) return empty;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[company-profile] OPENAI_API_KEY not set — skipping the LLM fallback");
    return empty;
  }

  const joined = texts
    .map((t) => `SOURCE: ${t.url}\n${t.text}`)
    .join("\n\n---\n\n")
    .slice(0, LLM_MAX_CHARS);
  if (joined.trim().length < 200) return empty;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, timeout: LLM_TIMEOUT_MS });
  const model = process.env.COMPANY_PROFILE_MODEL || DEFAULT_MODEL;

  const wanted = [need.about ? "about" : null, need.address ? "hq_address" : null]
    .filter(Boolean)
    .join(" and ");

  // This line is the only visible evidence that tokens are being spent, and it
  // is also how you tell "the model found nothing" apart from "the model was
  // never called" — the two look identical in the result otherwise. Mirrors
  // the "[policy] classifying:" log in worker/policy/classify.ts.
  console.info("[company-profile] llm fallback:", {
    model,
    wanted,
    chars: joined.length,
    sources: texts.length,
  });

  try {
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: LLM_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract ${wanted} for this company. Return null for anything the text does not state.\n\n${joined}`,
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}") as Record<
      string,
      unknown
    >;
    return {
      about: need.about ? sanitizeModelText(parsed.about, 600) : null,
      hqAddress: need.address ? sanitizeModelText(parsed.hq_address, 300) : null,
    };
  } catch (error) {
    console.warn(
      "[company-profile] LLM fallback failed:",
      error instanceof Error ? error.message : String(error),
    );
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/**
 * Turn the PNG data: URL produced by the in-page rasteriser into the same shape
 * fetchImage() returns, so captureLogo() can treat both alike.
 *
 * Throws ImageRejected on anything malformed or failing the byte gate, exactly
 * as the fetch path does, so the caller just moves to the next candidate.
 */
function decodeDataUrlImage(dataUrl: string): FetchedImage {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new ImageRejected("bad_data_url", "inline logo is not a base64 PNG data URL");
  }

  const bytes = new Uint8Array(Buffer.from(match[1], "base64"));
  // The same inspection the server runs — magic bytes, dimensions, size caps.
  const inspection = inspectImage(bytes, "image/png");

  return {
    bytes,
    contentType: "image/png",
    // No network hop happened, so there is no source URL to record. NULL here
    // is honest: scripts/rehydrate-logos.ts cannot re-fetch an inline SVG, and
    // pretending otherwise would make it report a repairable gap that is not.
    finalUrl: "",
    inspection,
  };
}

interface LogoVisibility {
  /** Fraction of opaque pixels clearing 3:1 against a white page, 0..1. */
  onWhite: number;
  /** Same, against a dark backdrop. */
  onDark: number;
  /** True when the image has meaningful transparency. */
  hasAlpha: boolean;
}

/**
 * How much of a logo actually survives on the page it will be shown on.
 *
 * Runs on the DECODED PIXELS of whichever candidate won, so it covers a JSON-LD
 * PNG, a header <img> and a rasterised inline <svg> alike. That generality is
 * the point: the first version of this check lived inside the SVG rasteriser,
 * caught flying-cargo.com, and silently missed biopharmax.com — whose plain
 * RGBA PNG scores an identical 0% visible on white.
 *
 * The criterion is WCAG 3:1 for non-text graphics, per pixel, with a proper
 * sRGB -> linear luminance. An earlier "% near-white" heuristic on raw channel
 * values only correlated with the real thing.
 *
 * Measured in the page because the browser already decodes PNG/JPEG/WebP; there
 * is no image decoder on the Node side. Returns null if it cannot be measured —
 * a missing measurement must never fail a capture.
 */
async function measureLogoVisibility(
  page: Page,
  bytes: Uint8Array,
  contentType: string,
): Promise<LogoVisibility | null> {
  try {
    return await page.evaluate(
      async (payload: { b64: string; type: string }) => {
        const img = new Image();
        const loaded = await new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = `data:${payload.type};base64,${payload.b64}`;
        });
        if (!loaded || !img.naturalWidth) return null;

        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);

        // A data: URL is same-origin, so this cannot taint.
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        // Relative luminance of the two backdrops (white, #111).
        const LIGHT = 1.0;
        const DARK = 0.0057097;

        let opaque = 0;
        let translucent = 0;
        let okLight = 0;
        let okDark = 0;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 250) translucent++;
          if (data[i + 3] < 32) continue;
          opaque++;

          let luminance = 0;
          const weights = [0.2126, 0.7152, 0.0722];
          for (let channel = 0; channel < 3; channel++) {
            const s = data[i + channel] / 255;
            luminance +=
              weights[channel] * (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
          }

          const vsLight = (Math.max(luminance, LIGHT) + 0.05) / (Math.min(luminance, LIGHT) + 0.05);
          const vsDark = (Math.max(luminance, DARK) + 0.05) / (Math.min(luminance, DARK) + 0.05);
          if (vsLight >= 3) okLight++;
          if (vsDark >= 3) okDark++;
        }

        if (opaque === 0) return null;
        return {
          onWhite: okLight / opaque,
          onDark: okDark / opaque,
          hasAlpha: translucent / (canvas.width * canvas.height) > 0.02,
        };
      },
      { b64: Buffer.from(bytes).toString("base64"), type: contentType },
    );
  } catch {
    return null;
  }
}

interface LogoOutcome {
  logoPath: string | null;
  sourceUrl: string | null;
  /** The candidate URL that won — matches an inlineLogos entry for data URLs. */
  candidateUrl: string | null;
  /** Contrast measurement of the winning logo; null when unmeasurable. */
  visibility: LogoVisibility | null;
  attempts: { url: string; source: string; result: string }[];
}

/**
 * Try candidates in rank order until one passes the byte gate, then upload it.
 *
 * Every rejection is recorded rather than swallowed: "no logo" and "six logos
 * that were all 40px GIFs" look identical in the database, and the difference
 * is what tells you whether the ranking needs work.
 */
async function captureLogo(
  page: Page,
  siteId: string,
  candidates: LogoCandidate[],
  referer: string,
  dryRun: boolean,
): Promise<LogoOutcome> {
  const attempts: LogoOutcome["attempts"] = [];

  for (const candidate of candidates.slice(0, 6)) {
    try {
      // A rasterised inline <svg> arrives as PNG bytes already in hand, so
      // there is nothing to fetch and no URL to guard — fetchImage() speaks
      // http(s) only. It still goes through inspectImage(), the same gate the
      // server re-applies, so a logo that came from the page's own DOM is
      // validated exactly as strictly as one downloaded from a URL.
      const image =
        candidate.source === "inline-svg"
          ? decodeDataUrlImage(candidate.url)
          : await fetchImage(candidate.url, referer);

      if (dryRun) {
        attempts.push({
          url: candidate.url,
          source: candidate.source,
          result: `would upload (${image.inspection.format} ${image.inspection.width}x${image.inspection.height}, ${image.inspection.byteLength}B)`,
        });
        return {
          logoPath: "(dry-run)",
          sourceUrl: image.finalUrl,
          candidateUrl: candidate.url,
          visibility: await measureLogoVisibility(page, image.bytes, image.contentType),
          attempts,
        };
      }

      const uploaded = await api<{ data: { logoPath: string } }>(
        "POST",
        `/api/sites/${siteId}/company-logo`,
        image.bytes,
        {
          "Content-Type": image.contentType,
          "x-logo-source-url": image.finalUrl.slice(0, 1_000),
        },
      );
      attempts.push({ url: candidate.url, source: candidate.source, result: "uploaded" });
      return {
        logoPath: uploaded.data.logoPath,
        sourceUrl: image.finalUrl,
        candidateUrl: candidate.url,
        visibility: await measureLogoVisibility(page, image.bytes, image.contentType),
        attempts,
      };
    } catch (error) {
      attempts.push({
        url: candidate.url,
        source: candidate.source,
        result:
          error instanceof ImageRejected
            ? `rejected (${error.reason})`
            : `error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { logoPath: null, sourceUrl: null, candidateUrl: null, visibility: null, attempts };
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

interface CaptureResult {
  /** Non-fatal notes an operator should see — see LIGHT_LOGO_RATIO. */
  warnings?: string[];
  siteId: string;
  siteUrl: string;
  companyName: string | null;
  outcome: "WRITTEN" | "DRY_RUN" | "SKIPPED_ALREADY" | "SKIPPED_THIN" | "ERROR";
  status: "COMPLETE" | "PARTIAL" | "FAILED" | null;
  fields: {
    companyHomepageUrl: string | null;
    companyAbout: string | null;
    companyLogoPath: string | null;
    companyHqAddress: string | null;
    companyHqCity: string | null;
  };
  /** Where each field came from — the audit trail for a hand-check later. */
  provenance: Record<string, string>;
  logoAttempts: LogoOutcome["attempts"];
  error?: string;
}

async function captureSite(
  browser: Browser,
  site: SiteRow,
  cities: CityList,
  opts: { dryRun: boolean; force: boolean; useLlm: boolean; patient?: boolean; writeEmpty?: boolean },
): Promise<CaptureResult> {
  const result: CaptureResult = {
    siteId: site.id,
    siteUrl: site.siteUrl,
    companyName: site.companyName,
    outcome: "ERROR",
    status: null,
    fields: {
      companyHomepageUrl: null,
      companyAbout: null,
      companyLogoPath: null,
      companyHqAddress: null,
      companyHqCity: null,
    },
    provenance: {},
    logoAttempts: [],
  };

  if (site.companyProfileAt && !opts.force) {
    result.outcome = "SKIPPED_ALREADY";
    result.error = `already captured at ${site.companyProfileAt}`;
    return result;
  }

  // --probe has no site row behind it, so it always runs with defaults.
  const overrides = site.status === "PROBE" ? undefined : await browserOverridesFor(site.id);
  if (overrides) result.provenance.browserOverrides = "site config";

  const { context, page } = await (
    await import("../worker/lib/playwright")
  ).createPage(browser, overrides);

  // An operator-supplied city is resolved BEFORE the homepage, because it must
  // survive the paths that never reach the city step. TADIRAN is exactly that
  // case: its careers URL is on a recruitment vendor's board, so no homepage can
  // be derived, and the capture returns early with a board logo — skipping
  // section 4 entirely. The city a human supplied was being dropped on the floor
  // for the very sites the table exists to serve.
  const manualCity = MANUAL_PROFILE[site.id]?.city;
  const gatedManualCity = manualCity ? canonicalCity(manualCity, cities) : null;
  if (manualCity && !gatedManualCity) {
    (result.warnings ??= []).push(
      `MANUAL_PROFILE city "${manualCity}" is not in city.csv and was ignored`,
    );
  }
  if (gatedManualCity) {
    result.fields.companyHqCity = gatedManualCity;
    result.provenance.city = "operator-supplied (gated)";
  }

  try {
    // --- 1. Homepage ------------------------------------------------------
    let homepage: PageHarvest | null = null;

    // An operator-supplied homepage is AUTHORITATIVE and tried first. It exists
    // precisely for the sites where derivation cannot work — an ATS board whose
    // URL says nothing about the employer and which links nothing belonging to
    // them — so second-guessing it with a derived guess would defeat the point
    // of having asked a human. natali is the worked example: nothing on its
    // board identifies natali.co.il.
    // The site row wins over the code table: the dashboard is the real channel,
    // and MANUAL_PROFILE is a stopgap for URLs supplied where no dashboard was
    // to hand. Once someone records it properly, this line stops using the
    // hardcoded copy with no further edit.
    const supplied = site.companyHomepageUrl?.trim() || MANUAL_PROFILE[site.id]?.homepage;
    if (supplied) {
      homepage = await harvest(page, supplied, opts.patient);
      if (homepage) {
        result.provenance.homepage = `operator-supplied (${supplied})`;
      } else {
        (result.warnings ??= []).push(
          `the supplied homepage ${supplied} could not be loaded`,
        );
      }
    }

    // Only guess when no usable homepage was supplied.
    for (const candidate of homepage ? [] : deriveHomepageCandidates(site.siteUrl)) {
      homepage = await harvest(page, candidate, opts.patient);
      if (homepage) {
        result.provenance.homepage = `derived from siteUrl (${candidate})`;
        break;
      }
    }

    // An ATS-hosted careers page, or a homepage that would not load: fall back
    // to what the careers page itself points at.
    let careers: PageHarvest | null = null;
    if (!homepage) {
      careers = await harvest(page, site.siteUrl, opts.patient);
      const fromLinks = careers ? homepageFromLinks(careers.links, careers.url) : null;
      const fromOg = originOf(careers?.metas["og:url"]);
      const target = fromLinks ?? fromOg;
      if (target) {
        homepage = await harvest(page, target, opts.patient);
        result.provenance.homepage = fromLinks ? "careers-page link" : "og:url";
      }
    }

    if (!homepage) {
      // No company site — but the careers page itself may still carry the
      // employer's LOGO, and on an ATS board it usually does: Civi serves it
      // from companyfile.php?c=<companyCode>, where the code is the same one in
      // the site's own URL, so the file belongs to this employer by
      // construction. natali has no derivable homepage at all and still
      // publishes a perfectly good 216x98 logo there.
      //
      // LOGO ONLY. No about copy and no address are taken from a job board:
      // its prose is job listings and vendor boilerplate, not a company
      // describing itself. A logo is a self-contained artefact that the byte
      // gate validates independently, which is what makes it safe to accept
      // here when nothing else is.
      const boardLogo = careers
        ? await captureLogo(
            page,
            site.id,
            collectLogoCandidates(careers, null),
            careers.url,
            opts.dryRun,
          )
        : null;

      if (boardLogo?.logoPath) {
        result.fields.companyLogoPath = boardLogo.logoPath;
        result.logoAttempts = boardLogo.attempts;
        result.provenance.logo = `careers board (${boardLogo.sourceUrl || careers?.url})`;
        result.status = classifyProfileStatus(result.fields);
        (result.warnings ??= []).push(
          "no company homepage found — only the logo was captured, from the careers board",
        );

        if (opts.dryRun) {
          result.outcome = "DRY_RUN";
          return result;
        }
        await writeProfile(site.id, result, opts.force);
        result.outcome = "WRITTEN";
        return result;
      }

      // Deliberately NOT written. Writing FAILED here would stamp
      // companyProfileAt and permanently lock the site out of a later capture —
      // for what is usually a transient reachability problem.
      result.status = "FAILED";
      result.outcome = opts.dryRun ? "DRY_RUN" : "SKIPPED_THIN";
      result.error = "no reachable company homepage";
      result.logoAttempts = boardLogo?.attempts ?? [];
      if (!opts.dryRun && opts.writeEmpty) {
        await writeProfile(site.id, result, opts.force);
        result.outcome = "WRITTEN";
      }
      return result;
    }

    result.fields.companyHomepageUrl = originOf(homepage.url);

    // --- 2. Deterministic extraction --------------------------------------
    const org: OrganizationLd | null = parseJsonLdOrganization(homepage.jsonLd);

    let about = extractAboutText(homepage.bodyText);
    if (about) result.provenance.about = "homepage prose";

    // An explicit about page beats homepage marketing copy, so it is fetched
    // even when the homepage already yielded something usable.
    const aboutUrl = pickAboutUrl(homepage.links, homepage.url);
    let aboutPage: PageHarvest | null = null;
    if (aboutUrl) {
      aboutPage = await harvest(page, aboutUrl, opts.patient);
      const fromAboutPage = aboutPage ? extractAboutText(aboutPage.bodyText) : null;
      if (fromAboutPage) {
        about = fromAboutPage;
        result.provenance.about = `about page (${aboutUrl})`;
      }
    }
    if (!about && org?.description) {
      about = org.description.slice(0, 1_200);
      result.provenance.about = "JSON-LD description";
    }

    let address = addressFromJsonLd(org);
    if (address) result.provenance.address = "JSON-LD PostalAddress";
    if (!address) {
      address = addressFrom(homepage.footerText, cities);
      if (address) result.provenance.address = "homepage footer";
    }
    if (!address && aboutPage) {
      address = addressFrom(aboutPage.footerText, cities) ?? addressFrom(aboutPage.bodyText, cities);
      if (address) result.provenance.address = "about page";
    }

    // The contact page is where an HQ address usually actually lives, so it is
    // worth one more navigation — but ONLY when nothing above found one, since
    // it is a page load spent on a single field.
    let contactPage: PageHarvest | null = null;
    const contactUrl = !address ? pickContactUrl(homepage.links, homepage.url) : null;
    if (contactUrl) {
      contactPage = await harvest(page, contactUrl, opts.patient);
      if (contactPage) {
        address =
          addressFrom(contactPage.bodyText, cities) ?? addressFrom(contactPage.footerText, cities);
        if (address) result.provenance.address = `contact page (${contactUrl})`;
      }
    }

    // Last resort: the privacy policy or terms page. An Israeli policy page has
    // to identify the company processing the data, so it routinely carries the
    // registered postal address even when the homepage, about page and contact
    // page all omit it — flying-cargo.com states its address only in /privacy/.
    //
    // Tried last because it is a third page load for a single field, and
    // because policy prose also names OTHER companies' addresses (processors,
    // hosting providers); the labelled-address + city.csv gate inside
    // addressFrom() is what keeps those out.
    let policyPage: PageHarvest | null = null;
    const policyUrl = !address ? pickPolicyUrl(homepage.links, homepage.url) : null;
    if (policyUrl) {
      policyPage = await harvest(page, policyUrl, opts.patient);
      if (policyPage) {
        address =
          addressFrom(policyPage.bodyText, cities) ?? addressFrom(policyPage.footerText, cities);
        if (address) result.provenance.address = `policy page (${policyUrl})`;
      }
    }

    // --- 3. LLM fallback, only for what is still missing -------------------
    if (opts.useLlm && (!about || !address)) {
      const sources = [{ url: homepage.url, text: homepage.bodyText }];
      if (aboutPage) sources.push({ url: aboutPage.url, text: aboutPage.bodyText });
      if (contactPage) sources.push({ url: contactPage.url, text: contactPage.bodyText });
      if (policyPage) sources.push({ url: policyPage.url, text: policyPage.bodyText });
      if (homepage.footerText) {
        sources.push({ url: `${homepage.url}#footer`, text: homepage.footerText });
      }

      const llm = await llmFallback(sources, { about: !about, address: !address });
      if (!about && llm.about) {
        about = llm.about;
        result.provenance.about = "llm";
      }
      if (!address && llm.hqAddress) {
        address = llm.hqAddress;
        result.provenance.address = "llm";
      }
    }

    result.fields.companyAbout = about;
    result.fields.companyHqAddress = address;

    // --- 4. City, through the gate ----------------------------------------
    // Tried in order of directness. The LLM is never asked for the city: an
    // off-list value fragments the dashboard's city filter and nothing
    // downstream repairs it (LRN-LOC-4).
    // The city is derived ONLY from an actual address — never scanned out of
    // loose page text. Scanning a footer looks like free extra coverage and is
    // a false-positive machine: bankhapoalim.co.il yielded "בניה", a real
    // moshav in city.csv that is also the ordinary Hebrew word for
    // construction, lifted out of a banking menu item. It had no address at
    // all, and its HQ is in Tel Aviv.
    //
    // No address means NULL. A city with nothing to anchor it is a guess, and a
    // wrong city is worse than a missing one: it fragments the dashboard's city
    // filter and nothing downstream repairs it (LRN-LOC-4).
    // The city comes ONLY from a real address — JSON-LD's addressLocality, or a
    // matched address line. Scanning loose "our offices are in X" prose was
    // tried and REMOVED (2026-08-30): across 25 live sites it produced zero
    // correct cities and two wrong ones.
    //
    // It read "כנות", a real moshav, out of the middle of the word "הסוכנות" —
    // the worker's place scanner tolerates a leading ו so that "וחיפה" resolves,
    // and הסוכנות happens to put one immediately before the match. And it read
    // the region "אזור מרכז" off an about page belonging to a company whose own
    // address says Ramat Gan.
    //
    // A city with no address behind it is a guess, and a wrong city is worse
    // than a missing one: it fragments the dashboard's city filter and nothing
    // downstream repairs it (LRN-LOC-4).
    //
    // Two exceptions to "no address, no city", both added deliberately:
    //   - an operator-supplied city, which is a human answer, not a guess
    //   - an office LIST, which is structure rather than prose (officeListCity)
    const cityAttempts: [string, string | null][] = [
      // Resolved and gated before the homepage step; see the top of captureSite.
      ["operator-supplied", gatedManualCity],
      [
        "JSON-LD addressLocality",
        org?.addressLocality ? canonicalCity(org.addressLocality, cities) : null,
      ],
      ["address line", address ? matchCityInAddress(address, cities) : null],
      // Last, and only reachable when no address was found at all.
      [
        "office list",
        contactPage ? officeListCity(contactPage.bodyText, cities) : null,
      ],
    ];
    const cityHit = cityAttempts.find(([, value]) => value !== null);
    result.fields.companyHqCity = cityHit?.[1] ?? null;
    if (cityHit) result.provenance.city = `${cityHit[0]} (gated)`;

    // --- 5. Logo -----------------------------------------------------------
    const candidates = collectLogoCandidates(homepage, org);
    // A careers page already loaded for the homepage hunt is free to reuse.
    if (careers) candidates.push(...collectLogoCandidates(careers, null));

    const logo = await captureLogo(page, site.id, candidates, homepage.url, opts.dryRun);
    result.fields.companyLogoPath = logo.logoPath;
    result.logoAttempts = logo.attempts;
    if (logo.logoPath) {
      result.provenance.logo = logo.sourceUrl || "inline <svg>, rasterised";

      // A light-on-dark logo is a valid image that passes every byte check and
      // is then invisible on the public site's light background.
      //
      // Flagged, never altered. Compositing a backdrop into the stored PNG was
      // considered and rejected (decision 2026-08-26): companyLogoPath is
      // write-once and the public site reads it directly, so a baked-in
      // background is irreversible short of a --force recapture, and for an
      // inline-SVG logo there is no companyLogoSourceUrl for rehydrate-logos.ts
      // to repair from. The fix belongs at render time — a dark chip behind the
      // logo — which stays reversible and adapts if the site gains a dark mode.
      //
      // This warning is therefore the ONLY signal that a logo needs that
      // treatment. It must stay accurate, and it must cover every source.
      const seen = logo.visibility;
      if (seen && seen.onWhite < LOGO_VISIBLE_ON_WHITE_MIN) {
        const wouldHelp = seen.onDark - seen.onWhite >= LOGO_DARK_IMPROVEMENT_MIN;
        (result.warnings ??= []).push(
          `only ${Math.round(seen.onWhite * 100)}% of this logo clears 3:1 contrast on a white ` +
            `page (${Math.round(seen.onDark * 100)}% on dark) — ` +
            (wouldHelp
              ? "render it on a dark chip"
              : "it is low-contrast on both; it may need replacing by hand"),
        );
      }
    }

    // --- 6. Write ----------------------------------------------------------
    result.status = classifyProfileStatus(result.fields);

    if (opts.dryRun) {
      result.outcome = "DRY_RUN";
      // Report the decision a real run would make. Without this a dry run shows
      // PARTIAL and looks like it would be stored, when in fact the thin-capture
      // guard below would refuse to write it at all.
      if (isThinCapture(result.fields) && !opts.writeEmpty) {
        result.error = "would NOT be written (thin capture) — a real run retries it";
      }
      return result;
    }

    // A capture that found nothing but a homepage URL is almost always a timing
    // failure rather than a company with no published information — a nav that
    // had not hydrated, a page still painting. Writing it would set
    // companyProfileAt and make that bad luck PERMANENT, since the once-only
    // guard then rejects every later attempt without --force.
    //
    // So: leave companyProfileAt NULL and let the site be picked up again. The
    // caller retries once with a longer settle before giving up. --write-empty
    // overrides this for an operator who wants the attempt recorded.
    if (isThinCapture(result.fields) && !opts.writeEmpty) {
      result.outcome = "SKIPPED_THIN";
      result.error = "captured only a homepage URL — not written, so it can be retried";
      return result;
    }

    await writeProfile(site.id, result, opts.force);
    result.outcome = "WRITTEN";
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * PUT the profile.
 *
 * companyLogoPath is deliberately NOT sent: the logo endpoint already recorded
 * it server-side, and the profile schema refuses it so no client can point the
 * public site at an arbitrary path.
 */
async function writeProfile(siteId: string, result: CaptureResult, force: boolean): Promise<void> {
  await api(
    "PUT",
    `/api/sites/${siteId}/company-profile${force ? "?force=1" : ""}`,
    {
      companyHomepageUrl: result.fields.companyHomepageUrl,
      companyAbout: result.fields.companyAbout,
      companyHqAddress: result.fields.companyHqAddress,
      companyHqCity: result.fields.companyHqCity,
      companyProfileStatus: result.status ?? "FAILED",
    },
  );
}

/**
 * True when a capture found nothing worth keeping.
 *
 * The homepage URL is excluded on purpose — it is derived from siteUrl by
 * string manipulation and is present even when every page load failed, so
 * counting it would make an empty capture look successful.
 */
/**
 * An address from one page's text: structural pattern first, then a labelled
 * one gated through city.csv.
 *
 * The gate is what makes the labelled path safe to use on prose-heavy pages. A
 * privacy policy is full of lines like "כתובת: Flying-cargo.com" and mentions
 * of other companies; requiring the value to contain a city.csv entry keeps the
 * real registered address and discards the rest. The structural pattern needs
 * no such gate because a street noun plus a house number is already specific.
 */
function addressFrom(text: string, cities: CityList): string | null {
  // A SCANNED address must name a city.csv city, or it is not an address.
  //
  // "רחוב"/"דרך" are ordinary Hebrew words as well as street nouns, so the
  // structural pattern fires on any prose that happens to put a number after
  // one. Three of thirteen addresses in one 20-site batch were not addresses:
  //   "דרך בחר שנה 1969"                      — a year-picker label
  //   "דרך שהיא. 3. הרשאה לדיוור…"            — "בכל דרך שהיא", legal prose
  //   "2025 by CNBC and Statista"             — an award caption
  // None produced a wrong city, because the gate rejected them — which is
  // exactly the signal. Real addresses in this fleet carry their city; text
  // that carries none is prose that merely looks like an address.
  //
  // JSON-LD addresses skip this: addressFromJsonLd() reads a structured
  // PostalAddress the company published itself, which needs no corroboration.
  const structural = extractAddressLine(text);
  if (structural && matchCityInAddress(structural, cities)) return structural;

  for (const candidate of extractLabelledAddress(text)) {
    if (matchCityInAddress(candidate, cities)) return candidate;
  }

  // Last: a short line that names a city but no street. Only reachable once the
  // two stricter patterns have failed, and still gated, so the risk is a line
  // that is short, carries a digit AND names a real city yet is not an address.
  for (const candidate of extractCompactAddressLines(text)) {
    if (matchCityInAddress(candidate, cities)) return candidate;
  }
  return null;
}

/**
 * The one Israeli city in an international company's office list.
 *
 * Personetics is the worked example. It publishes no address anywhere, but its
 * contact page lists its offices one per line — Singapore, Tel Aviv, New York,
 * Paris, Berlin, London, Sydney, Hong Kong — and only one of those is a place
 * this fleet cares about.
 *
 * EXACTLY ONE gated hit is required, and that is the whole safety argument. A
 * list with two Israeli cities gives no way to tell the head office from a
 * second site, so it returns null rather than guess; a list with none is a
 * navigation menu that happened to look like a list of places. The rule can
 * therefore only ever fire where the answer is unambiguous.
 *
 * Restricted to Latin-script lists (see extractOfficeListRuns) because the
 * Hebrew prose scanner was removed for reading city names out of the middle of
 * ordinary words. This reads no prose at all: every entry is a whole line that
 * is nothing but a place name.
 *
 * A branch list is still refused everywhere else — extractCompactAddressLines
 * drops "סניף חיפה 3" on sight. The difference is that a branch line claims to
 * be an address and is not, while this makes no claim to be an address at all:
 * it is used ONLY when no address was found, and only for the city.
 */
function officeListCity(text: string, cities: CityList): string | null {
  for (const run of extractOfficeListRuns(text)) {
    const hits = new Set<string>();
    for (const name of run) {
      const city = matchCityInAddress(name, cities);
      if (city) hits.add(city);
    }
    if (hits.size === 1) return [...hits][0];
  }
  return null;
}

function isThinCapture(fields: CaptureResult["fields"]): boolean {
  return !fields.companyAbout && !fields.companyLogoPath && !fields.companyHqAddress;
}

function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --probe implies --dry-run: it has no site row to write back to, and the
  // whole point is that it touches nothing.
  const dryRun = flag("dry-run") || arg("probe") !== undefined;
  const force = flag("force");
  const useLlm = !flag("no-llm");
  const concurrency = intArg("concurrency", 3);
  const outFile = arg("out");
  // Records an attempt that found nothing, stamping companyProfileAt and so
  // locking the site out of future captures. Off by default — see isThinCapture.
  const writeEmpty = flag("write-empty");

  const sites = await resolveSites();
  if (sites.length === 0) {
    console.log("[company-profile] nothing to do — no site matched");
    return;
  }

  const cities = loadCityList();
  console.log(
    `[company-profile] ${sites.length} site(s), concurrency ${concurrency}, ` +
      `${dryRun ? "DRY RUN (writes nothing)" : "WRITING"}, llm ${useLlm ? "on" : "off"}`,
  );

  const { launchBrowser, closeBrowser } = await import("../worker/lib/playwright");
  const browser = await launchBrowser();
  const results: CaptureResult[] = [];

  try {
    // A simple index-cursor pool: each worker takes the next site as it frees
    // up, so one slow site cannot stall a whole batch the way chunking would.
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, sites.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= sites.length) return;
        const site = sites[index];
        let result: CaptureResult;
        try {
          result = await captureSite(browser, site, cities, {
            dryRun,
            force,
            useLlm,
            writeEmpty,
          });

          // One retry, more patient, for a capture that came back empty. The
          // first attempt wrote nothing (see isThinCapture), so this cannot
          // collide with the once-only guard. Sites that are genuinely empty
          // cost one extra load; sites that were merely slow get their data.
          if (result.outcome === "SKIPPED_THIN") {
            console.log(
              `[company-profile] thin capture for ${site.siteUrl} — retrying with a longer settle`,
            );
            result = await captureSite(browser, site, cities, {
              dryRun,
              force,
              useLlm,
              writeEmpty,
              patient: true,
            });
          }
        } catch (error) {
          result = {
            siteId: site.id,
            siteUrl: site.siteUrl,
            companyName: site.companyName,
            outcome: "ERROR",
            status: null,
            fields: {
              companyHomepageUrl: null,
              companyAbout: null,
              companyLogoPath: null,
              companyHqAddress: null,
              companyHqCity: null,
            },
            provenance: {},
            logoAttempts: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
        results.push(result);
        logResult(result);
        if (outFile) appendFileSync(outFile, `${JSON.stringify(result)}\n`, "utf8");
      }
    });
    await Promise.all(workers);
  } finally {
    await closeBrowser(browser);
  }

  summarize(results);
  // Exit 2 when nothing at all was captured for at least one site, so a batch
  // caller can tell "ran and found nothing" from "ran and worked".
  if (results.some((r) => r.outcome === "ERROR")) process.exit(2);
}

function logResult(r: CaptureResult): void {
  const f = r.fields;
  const filled = [
    f.companyHomepageUrl ? "homepage" : null,
    f.companyAbout ? `about(${f.companyAbout.length}c)` : null,
    f.companyLogoPath ? "logo" : null,
    f.companyHqAddress ? "address" : null,
    f.companyHqCity ? `city=${f.companyHqCity}` : null,
  ].filter(Boolean);

  console.log(
    `[company-profile] ${r.outcome.padEnd(15)} ${r.status ?? "-"} ${r.siteId} ` +
      `${r.companyName ?? r.siteUrl} :: ${filled.join(" ") || "nothing"}` +
      (r.error ? ` :: ${r.error}` : ""),
  );

  for (const warning of r.warnings ?? []) {
    console.log(`[company-profile]   WARN ${warning}`);
  }

  // Only worth printing when it failed — a successful upload is self-evident.
  if (!f.companyLogoPath && r.logoAttempts.length > 0) {
    for (const a of r.logoAttempts) {
      console.log(`[company-profile]   logo ${a.source}: ${a.result} <- ${a.url}`);
    }
  }
}

function summarize(results: CaptureResult[]): void {
  const by = (fn: (r: CaptureResult) => boolean) => results.filter(fn).length;
  console.log(
    JSON.stringify(
      {
        sites: results.length,
        written: by((r) => r.outcome === "WRITTEN"),
        dryRun: by((r) => r.outcome === "DRY_RUN"),
        skippedAlready: by((r) => r.outcome === "SKIPPED_ALREADY"),
        skippedThin: by((r) => r.outcome === "SKIPPED_THIN"),
        errors: by((r) => r.outcome === "ERROR"),
        complete: by((r) => r.status === "COMPLETE"),
        partial: by((r) => r.status === "PARTIAL"),
        failed: by((r) => r.status === "FAILED"),
        withLogo: by((r) => !!r.fields.companyLogoPath),
        withAbout: by((r) => !!r.fields.companyAbout),
        withCity: by((r) => !!r.fields.companyHqCity),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
