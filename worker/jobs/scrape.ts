import { prisma } from "../../src/lib/prisma";
import type { WorkerJob, Site } from "../../src/generated/prisma/client";
import { Prisma } from "../../src/generated/prisma/client";
import { launchBrowser, createPage, closeBrowser, type BrowserOverrides } from "../lib/playwright";
import { normalizeJobRecord } from "../lib/normalizer";
import type { NormalizedJobRecord } from "../lib/normalizer";
import { validateJobRecord } from "../lib/validator";
import type { ValidationResult } from "../lib/validator";
import type { Browser, Page } from "playwright";
import { emitWorkerEvent } from "../lib/emitEvent";
import { DOM_FIELD_EXTRACT_SOURCE } from "../lib/domFieldExtract";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-field mapping from Site.fieldMappings JSON (excluding _meta) */
interface FieldMappingEntry {
  selector: string;
  sample: string;
  sourceMethod: string;
  methodsDetected: number;
  /**
   * URL of the page the selector was captured on (set by the extension's
   * Element Picker). Used to route fields to the correct pageFlow step
   * during multi-page scrapes. Optional for legacy mappings.
   */
  capturedOnUrl?: string;
  /**
   * Optional attribute name (e.g. `data-job-id`, `href`). When set, we
   * extract `el.getAttribute(extractAttr)` for this field instead of the
   * element's visible text. Set by the extension's per-field advanced
   * editor; opaque to the rest of the worker.
   */
  extractAttr?: string;
}

/** A single page flow step from Site.pageFlow JSON */
interface PageFlowStep {
  url: string;
  action: string;
  waitFor?: string;
}

/** Result returned from handleScrapeJob (always returned, never throws) */
interface ScrapeResult {
  success: boolean;
  scrapeRunId: string;
  jobCount: number;
  totalJobs: number;
  validJobs: number;
  invalidJobs: number;
  error?: string;
  failureCategory?: string;
}

/** Scrape execution context for error categorization */
interface ScrapeContext {
  pageLoaded: boolean;
  selectorsMatched: boolean;
  itemsFound: number;
}

/** A normalized record paired with its validation result */
interface ValidatedRecord {
  normalized: NormalizedJobRecord;
  validation: ValidationResult;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRAPE_TIMEOUT_MS = 600_000; // 10 minutes (large infinite-scroll listings + per-row extraction)
const DETAIL_PAGE_TIMEOUT_MS = 15_000; // 15 seconds per detail page
const NAVIGATION_TIMEOUT_MS = 30_000; // 30 seconds for page navigation
const MAX_EXTRACTED_ITEMS = 2000;

/** Best-effort `networkidle` after `domcontentloaded` (non-blocking on timeout). */
const NETWORKIDLE_GRACE_MS = 8_000;

/**
 * Navigate without hanging on sites that never reach `networkidle` (chat widgets, analytics).
 */
async function gotoForgiving(
  page: Page,
  url: string,
  navTimeoutMs: number = NAVIGATION_TIMEOUT_MS,
): Promise<import("playwright").Response | null> {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: navTimeoutMs,
  });
  await page
    .waitForLoadState("networkidle", { timeout: NETWORKIDLE_GRACE_MS })
    .catch(() => {
      /* ignore */
    });
  return response;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function extractMappedFieldFromElement(
  fieldEl: import("playwright").ElementHandle<Element>,
  fieldName: string,
  attrName?: string,
): Promise<string> {
  return fieldEl.evaluate(
    (
      el,
      payload: { extractSrc: string; fieldName: string; attrName?: string },
    ) => {
      const fn = (0, eval)("(" + payload.extractSrc + ")");
      return fn(el, payload.fieldName, payload.attrName) as string;
    },
    {
      extractSrc: DOM_FIELD_EXTRACT_SOURCE,
      fieldName,
      attrName: attrName && attrName.length > 0 ? attrName : undefined,
    },
  );
}

async function readHrefFromFieldElement(
  fieldEl: import("playwright").ElementHandle<Element>,
): Promise<string | null> {
  return fieldEl.evaluate((el) => {
    const e = el as Element;
    if (e.tagName.toLowerCase() === "a") {
      return e.getAttribute("href");
    }
    const a = e.closest("a");
    if (a) return a.getAttribute("href");
    return (
      e.getAttribute("data-href") ||
      e.getAttribute("data-url") ||
      e.getAttribute("data-link")
    );
  });
}

/**
 * Scroll the listing to load infinite-scroll / virtualized job rows, then return to top.
 * No-op when `itemSelector` is missing.
 */
async function autoScrollUntilStable(
  page: Page,
  itemSelector: string | null,
  opts: { maxScrolls: number; settleMs: number; maxNoGrowth: number; maxItems: number } = {
    maxScrolls: 30,
    settleMs: 800,
    maxNoGrowth: 2,
    /** Stop loading more DOM rows — avoids megabytes of nodes + multi-minute extraction */
    maxItems: 200,
  },
): Promise<void> {
  if (!itemSelector) return;

  const countItems = async (): Promise<number> => {
    return page.evaluate((sel) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 0;
      }
    }, itemSelector);
  };

  let prevCount = await countItems();
  let noGrowth = 0;
  for (let i = 0; i < opts.maxScrolls; i++) {
    if (prevCount >= opts.maxItems) break;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleepMs(opts.settleMs);
    const count = await countItems();
    if (count <= prevCount) {
      noGrowth++;
      if (noGrowth >= opts.maxNoGrowth) break;
    } else {
      noGrowth = 0;
    }
    prevCount = count;
    if (prevCount >= opts.maxItems) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Click a "Load more" button repeatedly until items stop appearing or caps
 * are hit. Designed for append-style listings (each click adds rows to the
 * existing list — different from `pagination` which expects content to
 * replace). No-op when `loadMoreSelector` or `itemSelector` is missing.
 */
async function clickLoadMoreUntilStable(
  page: Page,
  loadMoreSelector: string | null,
  itemSelector: string | null,
  opts: { maxClicks: number; settleMs: number; maxNoGrowth: number; maxItems: number } = {
    maxClicks: 100,
    settleMs: 3_000,
    maxNoGrowth: 2,
    maxItems: 2000,
  },
): Promise<void> {
  if (!loadMoreSelector || !itemSelector) return;

  const countItems = async (): Promise<number> => {
    return page.evaluate((sel) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 0;
      }
    }, itemSelector);
  };

  let prevCount = await countItems();
  let noGrowth = 0;
  let totalClicks = 0;
  for (let i = 0; i < opts.maxClicks; i++) {
    if (prevCount >= opts.maxItems) break;
    const btn = await page.$(loadMoreSelector).catch(() => null);
    if (!btn) {
      console.info(`[scrape] loadMore: button not found after ${totalClicks} clicks (count=${prevCount})`);
      break;
    }
    const usable = await btn
      .evaluate((el) => {
        const e = el as HTMLElement;
        const disabled =
          (e as HTMLButtonElement).disabled ||
          e.getAttribute("aria-disabled") === "true" ||
          e.classList.contains("disabled");
        const visible = e.offsetParent !== null;
        return { disabled, visible };
      })
      .catch(() => ({ disabled: false, visible: true }));
    if (usable.disabled || !usable.visible) {
      console.info(`[scrape] loadMore: button disabled/hidden after ${totalClicks} clicks (count=${prevCount})`);
      break;
    }
    try {
      await btn.click({ timeout: 4_000 });
    } catch (e) {
      console.warn(`[scrape] loadMore: click failed — ${(e as Error).message}`);
      break;
    }
    totalClicks++;

    // Wait for the item count to grow, polling up to settleMs.
    const deadline = Date.now() + opts.settleMs;
    let count = prevCount;
    while (Date.now() < deadline) {
      await sleepMs(200);
      count = await countItems();
      if (count > prevCount) break;
    }

    if (count <= prevCount) {
      noGrowth++;
      if (noGrowth >= opts.maxNoGrowth) {
        console.info(`[scrape] loadMore: no growth after ${totalClicks} clicks (count=${prevCount})`);
        break;
      }
    } else {
      noGrowth = 0;
    }
    prevCount = count;
  }
  if (totalClicks > 0) {
    console.info(`[scrape] loadMore: ${totalClicks} clicks done, final count=${prevCount}`);
  }
}

// ---------------------------------------------------------------------------
// Helper: error categorization
// ---------------------------------------------------------------------------

function categorizeError(
  error: Error,
  context: ScrapeContext,
): string {
  if (error.message.includes("timeout") || error.message.includes("Timeout")) {
    return "timeout";
  }
  if (context.pageLoaded && !context.selectorsMatched) {
    return "structure_changed";
  }
  if (context.pageLoaded && context.selectorsMatched && context.itemsFound === 0) {
    return "empty_results";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Helper: parse field mappings from Site.fieldMappings JSON
// ---------------------------------------------------------------------------

function parseFieldMappings(
  fieldMappingsRaw: unknown,
): Record<string, FieldMappingEntry> {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") {
    return {};
  }

  const raw = fieldMappingsRaw as Record<string, unknown>;
  const mappings: Record<string, FieldMappingEntry> = {};

  for (const [key, value] of Object.entries(raw)) {
    // Skip _meta key which contains training data
    if (key === "_meta") continue;
    if (!value || typeof value !== "object") continue;

    const entry = value as Record<string, unknown>;
    if (typeof entry.selector !== "string") continue;

    const extractAttrRaw = entry.extractAttr;
    const extractAttr =
      typeof extractAttrRaw === "string" && extractAttrRaw.trim()
        ? extractAttrRaw.trim()
        : undefined;

    mappings[key] = {
      selector: entry.selector as string,
      sample: (entry.sample as string) ?? "",
      sourceMethod: (entry.sourceMethod as string) ?? "UNKNOWN",
      methodsDetected: (entry.methodsDetected as number) ?? 1,
      capturedOnUrl: typeof entry.capturedOnUrl === "string" ? entry.capturedOnUrl : undefined,
      extractAttr,
    };
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Helper: classify each field as "listing" or "detail" based on its
// capturedOnUrl vs. the saved pageFlow steps. Fields without capturedOnUrl
// fall back to the legacy default of "detail" when there is a multi-page
// flow (preserves prior behavior).
// ---------------------------------------------------------------------------

/** Test if `url` matches `pattern` (with `*` wildcard). */
function urlMatchesPagePattern(url: string, pattern: string): boolean {
  if (!url || !pattern) return false;
  if (url === pattern) return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp("^" + escaped + "$").test(url);
  } catch {
    return false;
  }
}

function classifyFieldsByPage(
  fieldMappings: Record<string, FieldMappingEntry>,
  pageFlow: PageFlowStep[],
): { listingFields: Record<string, FieldMappingEntry>; detailFields: Record<string, FieldMappingEntry> } {
  const listingFields: Record<string, FieldMappingEntry> = {};
  const detailFields: Record<string, FieldMappingEntry> = {};

  // Single-step or no flow → everything is listing-scoped.
  if (pageFlow.length < 2) {
    return { listingFields: fieldMappings, detailFields: {} };
  }

  const listingPattern = pageFlow[0]?.url ?? "";
  // The detail pattern is the URL recorded on step 2+. Patterns may include `*`.
  const detailPattern = pageFlow[1]?.url ?? "";

  for (const [name, m] of Object.entries(fieldMappings)) {
    const capUrl = m.capturedOnUrl;
    if (!capUrl) {
      // Legacy mapping: keep previous behavior (extract on detail page).
      detailFields[name] = m;
      continue;
    }
    if (listingPattern && urlMatchesPagePattern(capUrl, listingPattern)) {
      listingFields[name] = m;
    } else if (detailPattern && urlMatchesPagePattern(capUrl, detailPattern)) {
      detailFields[name] = m;
    } else {
      // Unknown — default to detail (most field-rich page).
      detailFields[name] = m;
    }
  }

  return { listingFields, detailFields };
}

// ---------------------------------------------------------------------------
// Helper: parse page flow from Site.pageFlow JSON
// ---------------------------------------------------------------------------

function parsePageFlow(pageFlowRaw: unknown): PageFlowStep[] {
  if (!Array.isArray(pageFlowRaw)) return [];

  const steps: PageFlowStep[] = [];
  for (const item of pageFlowRaw) {
    if (!item || typeof item !== "object") continue;
    const step = item as Record<string, unknown>;
    if (typeof step.url !== "string" || typeof step.action !== "string") continue;

    steps.push({
      url: step.url,
      action: step.action,
      waitFor: typeof step.waitFor === "string" ? step.waitFor : undefined,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Auto-detect repeating item containers from absolute selectors and extract
// fields using child-index paths (works even with nth-child absolute selectors).
// ---------------------------------------------------------------------------

async function extractWithAutoItemDetection(
  page: Page,
  fieldMappings: Record<string, FieldMappingEntry>,
  revealSelector: string | null = null,
): Promise<Record<string, string>[]> {
  const selectorMap: Record<string, string> = {};
  const attrMap: Record<string, string> = {};
  for (const [name, m] of Object.entries(fieldMappings)) {
    selectorMap[name] = m.selector;
    if (m.extractAttr) attrMap[name] = m.extractAttr;
  }

  for (const [name, sel] of Object.entries(selectorMap)) {
    const found = await page.$(sel).catch(() => null);
    console.info(
      `[scrape] Selector "${name}": ${found ? "MATCHED" : "NOT FOUND"} — ${sel.substring(0, 80)}`,
    );
  }

  // Phase 1: Expand the FIRST item only so we can discover structure from
  // its expanded state. Clicking all reveals at once breaks mutually-exclusive
  // accordions where only one panel can be open at a time.
  if (revealSelector) {
    const firstReveal = await page.$(revealSelector);
    if (firstReveal) {
      try {
        await firstReveal.click();
        await page.waitForTimeout(300);
      } catch {
        /* skip */
      }
    }
  }

  // Phase 2: Discover repeating item structure and build child-index paths
  // from the first (now expanded) item to each field element.
  const discovery = await page.evaluate(
    (payload: {
      selectors: Record<string, string>;
      attrs: Record<string, string>;
      extractSrc: string;
    }) => {
      const domFieldExtract = (0, eval)("(" + payload.extractSrc + ")") as (
        el: Element,
        fieldName: string,
        attrName?: string,
      ) => string;
      const selectors = payload.selectors;
      const attrs = payload.attrs;
      const fieldEls: Record<string, Element> = {};
      for (const [name, sel] of Object.entries(selectors)) {
        try {
          const el = document.querySelector(sel);
          if (el) fieldEls[name] = el;
        } catch {
          /* invalid selector */
        }
      }

      const titleEl = fieldEls["title"];
      if (!titleEl) return null;

      const titleTag = titleEl.tagName.toLowerCase();

      let itemContainer: Element | null = null;
      let current: Element | null = titleEl.parentElement;
      while (current && current !== document.body) {
        const parent = current.parentElement;
        if (!parent) break;
        const sameTagSiblings = Array.from(parent.children).filter(
          (sib) =>
            sib.tagName === current!.tagName &&
            sib.querySelector(titleTag) !== null,
        );
        if (sameTagSiblings.length >= 2) {
          itemContainer = current;
          break;
        }
        current = parent;
      }
      if (!itemContainer) return null;

      const itemParent = itemContainer.parentElement!;
      const itemTag = itemContainer.tagName;
      const itemClasses = Array.from(itemContainer.classList);

      const allItems = Array.from(itemParent.children).filter((child) => {
        if (child.tagName !== itemTag) return false;
        for (const cls of itemClasses) {
          if (!child.classList.contains(cls)) return false;
        }
        return true;
      });

      const buildPath = (root: Element, target: Element): number[] => {
        const path: number[] = [];
        let node: Element | null = target;
        while (node && node !== root) {
          const p: Element | null = node.parentElement;
          if (!p) return [];
          path.unshift(Array.from(p.children).indexOf(node));
          node = p;
        }
        return node === root ? path : [];
      };

      // Classify fields into inside-paths, sibling-paths, and outside values
      const insidePaths: Record<string, number[]> = {};
      const outsideValues: Record<string, string> = {};
      const siblingPaths: Record<
        string,
        { siblingOffset: number; path: number[] }
      > = {};

      for (const [name, el] of Object.entries(fieldEls)) {
        if (itemContainer.contains(el)) {
          const path = buildPath(itemContainer, el);
          if (path.length > 0) insidePaths[name] = path;
        } else {
          // Check if field is in a sibling of the item (accordion content panel)
          let sib = itemContainer.nextElementSibling;
          let offset = 1;
          let found = false;
          while (sib && offset <= 3) {
            if (sib.contains(el)) {
              const path = buildPath(sib, el);
              if (path.length > 0) {
                siblingPaths[name] = { siblingOffset: offset, path };
              }
              found = true;
              break;
            }
            sib = sib.nextElementSibling;
            offset++;
          }
          if (!found) {
            outsideValues[name] = domFieldExtract(el, name, attrs[name]);
          }
        }
      }

      // Build a CSS selector for the item parent so we can re-find it later
      let parentCSS: string;
      if (itemParent.id) {
        parentCSS = `#${itemParent.id}`;
      } else {
        const pTag = itemParent.tagName.toLowerCase();
        const pClasses = Array.from(itemParent.classList).slice(0, 3);
        parentCSS =
          pClasses.length > 0 ? `${pTag}.${pClasses.join(".")}` : pTag;
      }

      const itemCSS =
        itemClasses.length > 0
          ? `${itemTag.toLowerCase()}.${itemClasses.join(".")}`
          : itemTag.toLowerCase();

      return {
        parentCSS,
        itemCSS,
        itemTag,
        itemClasses,
        itemCount: allItems.length,
        insidePaths,
        outsideValues,
        siblingPaths,
      };
    },
    {
      selectors: selectorMap,
      attrs: attrMap,
      extractSrc: DOM_FIELD_EXTRACT_SOURCE,
    },
  );

  if (!discovery || discovery.itemCount === 0) return [];
  console.info(
    `[scrape] Auto-detect found ${discovery.itemCount} repeating items`,
  );

  // Phase 3: Extract ALL items in one async evaluate call.
  // Uses native DOM click() per-item for reveals — no Playwright round-trips.
  const results: Record<string, string>[] = await page.evaluate(
    async (args: {
      parentCSS: string;
      itemTag: string;
      itemClasses: string[];
      insidePaths: Record<string, number[]>;
      outsideValues: Record<string, string>;
      siblingPaths: Record<
        string,
        { siblingOffset: number; path: number[] }
      >;
      revSel: string | null;
      extractSrc: string;
      attrs: Record<string, string>;
    }) => {
      const domFieldExtract = (0, eval)("(" + args.extractSrc + ")") as (
        el: Element,
        fieldName: string,
        attrName?: string,
      ) => string;
      const attrs = args.attrs;

      const followPath = (
        root: Element,
        path: number[],
      ): Element | null => {
        let node: Element = root;
        for (const idx of path) {
          const child = node.children[idx];
          if (!child) return null;
          node = child;
        }
        return node;
      };

      function findReveal(item: Element, sel: string): HTMLElement | null {
        try {
          const r = item.querySelector(sel);
          if (r) return r as HTMLElement;
        } catch {
          /* skip */
        }
        if (item.parentElement) {
          const candidates = item.parentElement.querySelectorAll(sel);
          const itemIdx = Array.from(item.parentElement.children).indexOf(
            item,
          );
          for (const c of candidates) {
            if (c !== item && !item.contains(c)) {
              const cIdx = Array.from(item.parentElement!.children).indexOf(c);
              if (Math.abs(cIdx - itemIdx) <= 2)
                return c as HTMLElement;
            }
          }
        }
        return null;
      }

      const parent = document.querySelector(args.parentCSS);
      if (!parent) return [];

      const allItems = Array.from(parent.children).filter((child) => {
        if (child.tagName !== args.itemTag) return false;
        for (const cls of args.itemClasses) {
          if (!child.classList.contains(cls)) return false;
        }
        return true;
      });

      const records: Record<string, string>[] = [];

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];

        // Scroll item into view so lazy-loaded content and scroll-triggered
        // handlers fire before we try to reveal/extract.
        (item as HTMLElement).scrollIntoView({ block: "center" });
        await new Promise((r) => setTimeout(r, 100));

        if (args.revSel) {
          const reveal = findReveal(item, args.revSel);
          if (reveal) {
            reveal.click();
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        const rec: Record<string, string> = {};

        // Fields inside the item container
        for (const [name, path] of Object.entries(args.insidePaths)) {
          const el = followPath(item, path);
          if (el) {
            rec[name] = domFieldExtract(el, name, attrs[name]);
            const anchor =
              el.tagName === "A"
                ? el
                : el.closest("a") ?? el.querySelector("a");
            if (anchor) {
              const href = anchor.getAttribute("href");
              if (href && !href.startsWith("#") && !href.startsWith("javascript:"))
                rec[`${name}_href`] = href;
            }
          } else {
            rec[name] = "";
          }
        }

        // Fields in sibling panels (accordion content)
        for (const [name, info] of Object.entries(args.siblingPaths)) {
          let sib: Element | null = item;
          for (let s = 0; s < info.siblingOffset; s++) {
            sib = sib?.nextElementSibling ?? null;
          }
          if (sib) {
            const el = followPath(sib, info.path);
            if (el) {
              rec[name] = domFieldExtract(el, name, attrs[name]);
              const anchor =
                el.tagName === "A"
                  ? el
                  : el.closest("a") ?? el.querySelector("a");
              if (anchor) {
                const href = anchor.getAttribute("href");
                if (href && !href.startsWith("#") && !href.startsWith("javascript:"))
                  rec[`${name}_href`] = href;
              }
            } else {
              rec[name] = "";
            }
          } else {
            rec[name] = "";
          }
        }

        // Global values (outside all items)
        for (const [name, val] of Object.entries(args.outsideValues)) {
          rec[name] = val;
        }

        if (Object.values(rec).some((v) => v.length > 0)) {
          records.push(rec);
        }
      }

      return records;
    },
    {
      parentCSS: discovery.parentCSS,
      itemTag: discovery.itemTag,
      itemClasses: discovery.itemClasses,
      insidePaths: discovery.insidePaths,
      outsideValues: discovery.outsideValues,
      siblingPaths: discovery.siblingPaths,
      revSel: revealSelector,
      extractSrc: DOM_FIELD_EXTRACT_SOURCE,
      attrs: attrMap,
    },
  );

  console.info(
    `[scrape] Auto-detect extraction completed: ${results.length} records`,
  );
  return results;
}

// ---------------------------------------------------------------------------
// Explicit item-scoped extraction: uses itemSelector + relative field selectors.
// This is the preferred path when the extension has set up container/item structure.
// ---------------------------------------------------------------------------

/**
 * Dump rich diagnostics when an explicit item selector matches nothing, so we
 * can tell apart: wrong selector vs empty container vs page never rendered vs
 * blocked/challenged page. Runs entirely best-effort; errors are swallowed.
 */
async function logSelectorDiagnostics(
  page: Page,
  listingSelector: string | null,
  itemSelector: string,
): Promise<void> {
  try {
    const diag = await page.evaluate(
      ({ listingSel, itemSel }) => {
        const safeCount = (sel: string): number => {
          try {
            return document.querySelectorAll(sel).length;
          } catch {
            return -1; // selector parse error
          }
        };

        // Break the item selector into fragments so we can see which part fails.
        // e.g. "div.warp_jobs_list_order.row" -> ["div", ".warp_jobs_list_order", ".row"]
        const itemFragments: string[] = [];
        {
          const tagMatch = itemSel.match(/^[a-zA-Z][\w-]*/);
          if (tagMatch) itemFragments.push(tagMatch[0]);
          for (const cls of itemSel.match(/\.[\w-]+/g) || []) itemFragments.push(cls);
          for (const id of itemSel.match(/#[\w-]+/g) || []) itemFragments.push(id);
          for (const attr of itemSel.match(/\[[^\]]+\]/g) || []) itemFragments.push(attr);
        }
        const fragmentCounts: Record<string, number> = {};
        for (const frag of itemFragments) fragmentCounts[frag] = safeCount(frag);

        // Inspect the listing container
        let listingContainer: Element | null = null;
        let listingChildrenSample: Array<{ tag: string; classes: string; id: string }> = [];
        let listingInnerHtmlLen = 0;
        let listingInnerHtmlPreview = "";
        if (listingSel) {
          try {
            listingContainer = document.querySelector(listingSel);
          } catch {
            listingContainer = null;
          }
          if (listingContainer) {
            listingInnerHtmlLen = listingContainer.innerHTML.length;
            listingInnerHtmlPreview = listingContainer.innerHTML.slice(0, 800);
            listingChildrenSample = Array.from(listingContainer.children)
              .slice(0, 10)
              .map((c) => ({
                tag: c.tagName.toLowerCase(),
                classes: Array.from((c as Element).classList).join(" "),
                id: (c as Element).id || "",
              }));
          }
        }

        // Find elements whose class list contains any of the item's class tokens
        const itemClassTokens = (itemSel.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
        const partialMatches: Array<{ tag: string; classes: string; id: string }> = [];
        if (itemClassTokens.length > 0) {
          const all = document.querySelectorAll("body *");
          for (const el of Array.from(all)) {
            const cls = Array.from(el.classList);
            const hits = itemClassTokens.filter((t) => cls.includes(t)).length;
            if (hits > 0) {
              partialMatches.push({
                tag: el.tagName.toLowerCase(),
                classes: cls.join(" "),
                id: el.id || "",
              });
              if (partialMatches.length >= 8) break;
            }
          }
        }

        return {
          url: location.href,
          title: document.title,
          htmlLen: document.documentElement.outerHTML.length,
          bodyTextLen: (document.body?.innerText || "").length,
          bodyTextSample: (document.body?.innerText || "").trim().slice(0, 400),
          listingSelector: listingSel,
          listingSelectorCount: listingSel ? safeCount(listingSel) : null,
          listingInnerHtmlLen,
          listingInnerHtmlPreview,
          listingChildrenSample,
          itemSelector: itemSel,
          itemSelectorCount: safeCount(itemSel),
          itemFragmentCounts: fragmentCounts,
          partialClassMatches: partialMatches,
          hasCloudflare:
            !!document.querySelector('[class*="cf-"]') ||
            /cloudflare|challenge|just a moment|access denied|forbidden/i.test(
              document.body?.innerText || "",
            ),
        };
      },
      { listingSel: listingSelector, itemSel: itemSelector },
    );
    console.warn("[scrape] Selector diagnostics:", JSON.stringify(diag, null, 2));
  } catch (err) {
    console.warn("[scrape] Could not collect selector diagnostics:", err);
  }
}

async function extractWithExplicitItemSelector(
  page: Page,
  fieldMappings: Record<string, FieldMappingEntry>,
  listingSelector: string | null,
  itemSelector: string,
  revealSelector: string | null,
): Promise<{
  records: Record<string, string>[];
  matchedItemCount: number;
}> {
  const containerSel = listingSelector ?? "body";
  const fullSelector = `${containerSel} ${itemSelector}`;

  const selectorMap: Record<string, string> = {};
  const attrMap: Record<string, string> = {};
  for (const [name, m] of Object.entries(fieldMappings)) {
    selectorMap[name] = m.selector;
    if (m.extractAttr) attrMap[name] = m.extractAttr;
  }

  // Determine which selector variant matches items on the page
  let effectiveSelector = fullSelector;
  const initialCount = await page
    .$$eval(fullSelector, (els) => els.length)
    .catch(() => 0);
  if (initialCount === 0) {
    const fallbackCount = await page
      .$$eval(itemSelector, (els) => els.length)
      .catch(() => 0);
    if (fallbackCount > 0) effectiveSelector = itemSelector;
  }

  const itemCount =
    initialCount > 0
      ? initialCount
      : await page.$$eval(itemSelector, (els) => els.length).catch(() => 0);

  console.info(
    `[scrape] Explicit itemSelector matched ${itemCount} items (selector: ${effectiveSelector})`,
  );
  if (itemCount === 0) {
    await logSelectorDiagnostics(page, listingSelector, itemSelector);
    return { records: [], matchedItemCount: 0 };
  }

  // ---------------------------------------------------------------------------
  // All extraction happens inside ONE async page.evaluate call.
  // Native DOM click() is used for reveals — no Playwright round-trips per
  // item. For 107 items this completes in seconds instead of minutes.
  // ---------------------------------------------------------------------------
  const results: Record<string, string>[] = await page.evaluate(
    async (args: {
      selector: string;
      fields: Record<string, string>;
      attrs: Record<string, string>;
      revealSelector: string | null;
      extractSrc: string;
    }) => {
      const domFieldExtract = (0, eval)("(" + args.extractSrc + ")") as (
        el: Element,
        fieldName: string,
        attrName?: string,
      ) => string;
      const attrs = args.attrs;

      const items = document.querySelectorAll(args.selector);
      const records: Record<string, string>[] = [];

      function findReveal(item: Element, sel: string): HTMLElement | null {
        // Inside the item
        try {
          const r = item.querySelector(sel);
          if (r) return r as HTMLElement;
        } catch {
          /* skip */
        }

        // Previous siblings (button may precede the item)
        let sib: Element | null = item.previousElementSibling;
        let checked = 0;
        while (sib && checked < 3) {
          try {
            const m = sib.matches(sel) ? sib : sib.querySelector(sel);
            if (m) return m as HTMLElement;
          } catch {
            /* skip */
          }
          sib = sib.previousElementSibling;
          checked++;
        }

        // Next siblings
        sib = item.nextElementSibling;
        checked = 0;
        while (sib && checked < 3) {
          try {
            const m = sib.matches(sel) ? sib : sib.querySelector(sel);
            if (m) return m as HTMLElement;
          } catch {
            /* skip */
          }
          sib = sib.nextElementSibling;
          checked++;
        }

        // Parent wrapper
        if (item.parentElement) {
          try {
            const m = item.parentElement.querySelector(sel);
            if (m && m !== item && !item.contains(m))
              return m as HTMLElement;
          } catch {
            /* skip */
          }
        }

        return null;
      }

      function extractFieldsFromItem(
        item: Element,
        fields: Record<string, string>,
        hasReveal: boolean,
      ): Record<string, string> {
        const rec: Record<string, string> = {};

        for (const [fieldName, fieldSelector] of Object.entries(fields)) {
          let fieldEl: Element | null = null;
          let source: "item" | "sibling" = "item";

          try {
            fieldEl = item.querySelector(fieldSelector);
          } catch {
            /* invalid selector */
          }

          // Check sibling panels for accordion content
          if (!fieldEl && hasReveal) {
            let sib = item.nextElementSibling;
            let count = 0;
            while (sib && count < 3) {
              try {
                const match = sib.querySelector(fieldSelector);
                if (match) {
                  fieldEl = match;
                  source = "sibling";
                  break;
                }
              } catch {
                /* skip */
              }
              sib = sib.nextElementSibling;
              count++;
            }
          }

          if (fieldEl) {
            rec[fieldName] = domFieldExtract(fieldEl, fieldName, attrs[fieldName]);
            const anchor =
              fieldEl.tagName === "A"
                ? fieldEl
                : fieldEl.closest("a") ?? fieldEl.querySelector("a");
            if (anchor) {
              const href = anchor.getAttribute("href");
              if (
                href &&
                href !== "#" &&
                !href.startsWith("#") &&
                !href.startsWith("javascript:")
              ) {
                rec[`${fieldName}_href`] = href;
              }
            }
          } else {
            rec[fieldName] = "";
          }

          if (fieldName === "description") {
            const rootTag = fieldEl ? fieldEl.tagName.toLowerCase() : null;
            const rawTextLength = fieldEl ? (fieldEl.textContent ?? "").length : 0;
            rec["_debugDescription"] = JSON.stringify({
              selector: fieldSelector,
              matched: !!fieldEl,
              rootTag,
              rawTextLength,
              source: fieldEl ? source : null,
            });
          }
        }

        return rec;
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Scroll item into view so lazy-loaded content populates before reveal.
        (item as HTMLElement).scrollIntoView({ block: "center" });
        await new Promise((r) => setTimeout(r, 100));

        let revealFound = false;
        let revealClicked = false;
        if (args.revealSelector) {
          const reveal = findReveal(item, args.revealSelector);
          if (reveal) {
            revealFound = true;
            try {
              reveal.click();
              revealClicked = true;
            } catch {
              /* click can throw on detached/disabled nodes */
            }
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        const wrapperHasOpen = item.classList.contains("open") ||
          !!item.querySelector(".open") ||
          (item.nextElementSibling?.classList.contains("open") ?? false);

        const rec = extractFieldsFromItem(
          item,
          args.fields,
          !!args.revealSelector,
        );

        if (rec["_debugDescription"]) {
          try {
            const dbg = JSON.parse(rec["_debugDescription"]);
            dbg.revealConfigured = !!args.revealSelector;
            dbg.revealFound = revealFound;
            dbg.revealClicked = revealClicked;
            dbg.wrapperHasOpen = wrapperHasOpen;
            rec["_debugDescription"] = JSON.stringify(dbg);
          } catch {
            /* ignore */
          }
        }

        if (Object.values(rec).some((v) => v.length > 0)) {
          records.push(rec);
        }
      }

      return records;
    },
    {
      selector: effectiveSelector,
      fields: selectorMap,
      attrs: attrMap,
      revealSelector,
      extractSrc: DOM_FIELD_EXTRACT_SOURCE,
    },
  );

  console.info(
    `[scrape] Explicit extraction completed: ${results.length} records (${itemCount} DOM item(s))`,
  );
  return { records: results, matchedItemCount: itemCount };
}

// ---------------------------------------------------------------------------
// Single-page listing extraction -- returns raw field maps
// ---------------------------------------------------------------------------

async function extractRawFieldsFromListingPage(
  page: Page,
  fieldMappings: Record<string, FieldMappingEntry>,
  listingSelector: string | null,
  itemSelector: string | null,
  revealSelector: string | null = null,
  pagination: PaginationConfig | null = null,
): Promise<Record<string, string>[]> {
  // If pagination is configured, repeat extraction per page and merge.
  // We dedupe across pages so the same item from page 1 doesn't double up if
  // the SPA leaves it in the DOM. Uses the same key tuple as
  // dedupeAndCapRawFields (title + location + externalJobId + url).
  if (pagination) {
    const all: Record<string, string>[] = [];
    for (let pageIdx = 1; pageIdx <= pagination.maxPages; pageIdx++) {
      const sig = await firstItemSignature(page, itemSelector);
      const pageResults = await extractRawFieldsFromListingPageOnce(
        page,
        fieldMappings,
        listingSelector,
        itemSelector,
        revealSelector,
      );
      console.info(
        `[scrape] pagination page ${pageIdx}: extracted ${pageResults.length} items`,
      );
      all.push(...pageResults);
      if (pageIdx === pagination.maxPages) break;
      const advanced = await advanceToNextPage(page, itemSelector, pagination, sig);
      if (!advanced) break;
      // Some sites trigger their own scroll-to-load after the page change.
      await autoScrollUntilStable(page, itemSelector);
    }
    return dedupeAndCapRawFields(all);
  }

  return extractRawFieldsFromListingPageOnce(
    page,
    fieldMappings,
    listingSelector,
    itemSelector,
    revealSelector,
  );
}

async function extractRawFieldsFromListingPageOnce(
  page: Page,
  fieldMappings: Record<string, FieldMappingEntry>,
  listingSelector: string | null,
  itemSelector: string | null,
  revealSelector: string | null = null,
): Promise<Record<string, string>[]> {
  // Preferred path: explicit itemSelector from extension container setup.
  // Field selectors are relative to each item element.
  if (itemSelector) {
    const { records: rawFieldsList, matchedItemCount } =
      await extractWithExplicitItemSelector(
        page,
        fieldMappings,
        listingSelector,
        itemSelector,
        revealSelector,
      );
    if (rawFieldsList.length > 0) {
      const explicitDeduped = dedupeAndCapRawFields(rawFieldsList);
      // If itemSelector hits one wrapper that contains many rows (e.g.
      // `.cvs_wrapper` around multiple `.cv_item`), querySelector inside the
      // wrapper only ever returns the first card — one row. Auto-detect finds
      // repeating row containers from global field selectors and fixes this.
      const likelyWrongItemScope =
        (matchedItemCount === 1 && rawFieldsList.length > 0) ||
        rawFieldsList.length < matchedItemCount;
      if (likelyWrongItemScope) {
        const autoList = await extractWithAutoItemDetection(
          page,
          fieldMappings,
          revealSelector,
        );
        const autoDeduped = dedupeAndCapRawFields(autoList);
        if (autoDeduped.length > explicitDeduped.length) {
          console.info(
            `[scrape] Preferring auto-detect (${autoDeduped.length} vs ${explicitDeduped.length} explicit rows); itemSelector matched ${matchedItemCount} DOM node(s)`,
          );
          return autoDeduped;
        }
      }
      console.info(
        `[scrape] Explicit item-scoped extraction: ${explicitDeduped.length} records`,
      );
      return explicitDeduped;
    }
    console.warn("[scrape] Explicit itemSelector matched 0 items, falling through to auto-detect");
  }

  // Fallback: auto-detect repeating item containers from absolute selectors
  const rawFieldsList = await extractWithAutoItemDetection(page, fieldMappings, revealSelector);
  if (rawFieldsList.length > 0) {
    console.info(
      `[scrape] Auto-item-detection extracted ${rawFieldsList.length} records`,
    );
    return dedupeAndCapRawFields(rawFieldsList);
  }

  console.warn("[scrape] All extraction strategies found 0 records");
  return [];
}

function isUsableUrl(url: string): boolean {
  return (
    url.length > 0 &&
    !url.startsWith("#") &&
    !url.startsWith("javascript:") &&
    url !== "/"
  );
}

function dedupeAndCapRawFields(
  rawFieldsList: Record<string, string>[],
): Record<string, string>[] {
  const seen = new Set<string>();
  const deduped: Record<string, string>[] = [];

  for (const raw of rawFieldsList) {
    const title = (raw["title"] ?? "").trim().toLowerCase();
    const location = (raw["location"] ?? "").trim().toLowerCase();
    const externalJobId = (raw["externalJobId"] ?? "").trim().toLowerCase();
    const rawUrl = (raw["title_href"] ?? raw["_detailUrl"] ?? "").trim().toLowerCase();
    const url = isUsableUrl(rawUrl) ? rawUrl : "";

    // Skip empty junk rows.
    if (!title && !location && !url) continue;

    const fingerprint = url || externalJobId || `${title}|${location}`;
    if (seen.has(fingerprint)) {
      if (deduped.length <= 1) {
        console.warn(
          `[scrape] Dedup collision at item ${seen.size}: fingerprint="${fingerprint.substring(0, 60)}" title="${title.substring(0, 40)}"`,
        );
      }
      continue;
    }
    seen.add(fingerprint);
    deduped.push(raw);

    if (deduped.length >= MAX_EXTRACTED_ITEMS) break;
  }

  if (deduped.length < rawFieldsList.length) {
    console.info(
      `[scrape] Dedup: ${rawFieldsList.length} → ${deduped.length} records`,
    );
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Multi-page navigation flow extraction -- returns raw field maps
// ---------------------------------------------------------------------------

async function extractRawFieldsWithPageFlow(
  page: Page,
  fieldMappings: Record<string, FieldMappingEntry>,
  pageFlow: PageFlowStep[],
  listingSelector: string | null,
  itemSelector: string | null,
  revealSelector: string | null = null,
  formCaptureConfig: FormCaptureConfig | null = null,
  pagination: PaginationConfig | null = null,
): Promise<Record<string, string>[]> {
  const rawFieldsList: Record<string, string>[] = [];

  // Navigate to the first page flow URL (listing page)
  const listingStep = pageFlow[0];
  await gotoForgiving(page, listingStep.url, NAVIGATION_TIMEOUT_MS);

  // Wait for the listing page's waitFor selector if specified
  if (listingStep.waitFor) {
    try {
      await page.waitForSelector(listingStep.waitFor, {
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch {
      console.warn(
        `[scrape] waitFor selector "${listingStep.waitFor}" not found on listing page`,
      );
    }
  }

  await autoScrollUntilStable(page, itemSelector);

  // If there's only one step in pageFlow, extract directly from listing page
  if (pageFlow.length < 2) {
    return extractRawFieldsFromListingPage(
      page,
      fieldMappings,
      listingSelector,
      itemSelector,
      revealSelector,
    );
  }

  // Split fields into listing-page fields (extracted from each item card)
  // vs detail-page fields (extracted from each detail page after navigation).
  // This is what unlocks multi-page sites where, e.g., title lives only on
  // the listing card and description lives only on the detail page.
  const { listingFields, detailFields } = classifyFieldsByPage(
    fieldMappings,
    pageFlow,
  );
  console.info(
    `[scrape] Field classification: ${Object.keys(listingFields).length} listing-scope, ${Object.keys(detailFields).length} detail-scope`,
  );

  // Multi-page: collect all detail page URLs first.
  // We also remember each URL's containing listing item so we can extract
  // listing-scope fields from it before navigating away.
  const detailUrls: string[] = [];
  const listingFieldsByUrl: Record<string, Record<string, string>> = {};
  const detailStep = pageFlow[1];
  const linkSel = detailStep.action !== "navigate" ? detailStep.action : null;

  // Helper: extract listingFields from a single item element.
  async function extractListingFieldsFromItem(
    itemHandle: import("playwright").ElementHandle<Element>,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (Object.keys(listingFields).length === 0) return out;
    for (const [fieldName, mapping] of Object.entries(listingFields)) {
      try {
        // 1. Inside the item.
        let fieldEl = await itemHandle.$(mapping.selector);
        // 2. Anchored fall-back: search the document for the same selector
        //    and pick the closest match by DOM proximity (used when the
        //    selector is a global one like `p.position-title` recorded on
        //    the listing — it should still match inside the item).
        if (!fieldEl) {
          fieldEl = await itemHandle.$(mapping.selector);
        }
        if (fieldEl) {
          const text = await extractMappedFieldFromElement(
            fieldEl,
            fieldName,
            mapping.extractAttr,
          );
          out[fieldName] = text ?? "";
          const href = await readHrefFromFieldElement(fieldEl);
          if (href) out[`${fieldName}_href`] = href;
        } else {
          out[fieldName] = "";
        }
      } catch {
        out[fieldName] = "";
      }
    }
    return out;
  }

  // The URL-collection block below runs per listing page. With pagination,
  // we run it for each clicked page, accumulating into the same detailUrls /
  // listingFieldsByUrl. With no pagination, this loop runs once.
  const maxListingPages = pagination ? pagination.maxPages : 1;
  for (let listingPageIdx = 1; listingPageIdx <= maxListingPages; listingPageIdx++) {
    const sigBefore = pagination
      ? await firstItemSignature(page, itemSelector)
      : "";
    const urlsBefore = detailUrls.length;

  if (linkSel) {
    // The Navigate Mode records the full selector of the ONE item the user
    // clicked, which often includes per-item classes like .post-97432 that
    // only match that single item. Generalize by stripping class fragments
    // that contain digits (IDs), so "li.post-97432.job_listing > a" becomes
    // "li.job_listing > a" and matches ALL items.
    const generalizeSel = (sel: string): string =>
      sel
        .replace(/:nth-child\(\d+\)/g, "")
        .replace(/:nth-of-type\(\d+\)/g, "")
        .replace(/:first-child/g, "")
        .replace(/:last-child/g, "")
        .replace(/\.[\w-]*\d[\w-]*/g, "");

    const scopedSel = listingSelector
      ? `${listingSelector} ${linkSel}`
      : linkSel;

    // Try original selector first
    let els = await page.$$(scopedSel);
    let usedSel = scopedSel;

    // If it matched ≤1 item, the selector is probably too specific — generalize
    if (els.length <= 1) {
      const genScoped = generalizeSel(scopedSel);
      if (genScoped !== scopedSel) {
        const genEls = await page.$$(genScoped);
        if (genEls.length > els.length) {
          els = genEls;
          usedSel = genScoped;
        }
      }
    }

    // Last resort: fall back to unscoped selector (original or generalized)
    if (els.length <= 1) {
      const genLink = generalizeSel(linkSel);
      for (const fallback of [linkSel, genLink]) {
        if (fallback === usedSel) continue;
        const fbEls = await page.$$(fallback);
        if (fbEls.length > els.length) {
          els = fbEls;
          usedSel = fallback;
        }
      }
    }

    console.info(`[scrape] Using Navigate Mode linkSelector: ${usedSel} (found ${els.length} links)`);

    for (const el of els) {
      try {
        const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
        let href: string | null = null;
        if (tagName === "a") {
          href = await el.getAttribute("href");
        } else {
          const anchor = await el.$("a");
          if (anchor) {
            href = await anchor.getAttribute("href");
          }
        }
        if (href) {
          const absUrl = new URL(href, page.url()).toString();
          detailUrls.push(absUrl);
          // Walk up to a likely "item" wrapper to extract listing-fields.
          // Item is either the link itself or the closest itemSelector
          // ancestor (when itemSelector is configured). We fall back to
          // the link's parent.
          if (Object.keys(listingFields).length > 0 && !listingFieldsByUrl[absUrl]) {
            try {
              let itemHandle: import("playwright").ElementHandle<Element> | null = null;
              if (itemSelector) {
                itemHandle = await el.evaluateHandle(
                  (node, sel) => (node as Element).closest(sel) ?? node,
                  itemSelector,
                ) as import("playwright").ElementHandle<Element>;
              } else {
                itemHandle = await el.evaluateHandle((node) => (node as Element).parentElement ?? node) as import("playwright").ElementHandle<Element>;
              }
              if (itemHandle) {
                listingFieldsByUrl[absUrl] = await extractListingFieldsFromItem(itemHandle);
              }
            } catch {
              // Listing-field extraction failed for this item — leave empty.
            }
          }
        }
      } catch {
        // Skip items where URL extraction fails
      }
    }
  } else {
    // Fallback: use itemSelector + first <a> inside each item
    const containerSelector = listingSelector ?? "body";
    const itemSel = itemSelector ?? "a";

    const linkElements = await page.$$(`${containerSelector} ${itemSel}`);
    const elements = linkElements.length > 0 ? linkElements : await page.$$(itemSel);

    console.info(`[scrape] Using itemSelector fallback: ${containerSelector} ${itemSel} (found ${elements.length} items)`);

    for (const element of elements) {
      try {
        let href: string | null = null;
        const tagName = await element.evaluate((el) => el.tagName.toLowerCase());

        if (tagName === "a") {
          href = await element.getAttribute("href");
        } else {
          const anchor = await element.$("a");
          if (anchor) {
            href = await anchor.getAttribute("href");
          }
        }

        if (href) {
          const absUrl = new URL(href, page.url()).toString();
          detailUrls.push(absUrl);
          if (Object.keys(listingFields).length > 0 && !listingFieldsByUrl[absUrl]) {
            try {
              listingFieldsByUrl[absUrl] = await extractListingFieldsFromItem(element);
            } catch {
              // Listing-field extraction failed — leave empty.
            }
          }
        }
      } catch {
        // Skip items where URL extraction fails
      }
    }
  }

    // ---- Pagination: advance to next listing page or stop. ----
    if (!pagination) break;
    const gainedUrls = detailUrls.length - urlsBefore;
    console.info(
      `[scrape] listing page ${listingPageIdx}: collected ${gainedUrls} detail URLs (running total ${detailUrls.length})`,
    );
    if (listingPageIdx === maxListingPages) break;
    const advanced = await advanceToNextPage(page, itemSelector, pagination, sigBefore);
    if (!advanced) break;
    // Some sites lazy-load rows after the pagination click (in-page scroll).
    await autoScrollUntilStable(page, itemSelector);
  }

  // Deduplicate URLs while preserving order
  const uniqueUrls = [...new Set(detailUrls)];
  console.info(`[scrape] Found ${uniqueUrls.length} unique detail page URLs (${detailUrls.length} total)`);

  // Visit each detail page sequentially (do NOT process concurrently)
  for (let urlIdx = 0; urlIdx < uniqueUrls.length; urlIdx++) {
    const detailUrl = uniqueUrls[urlIdx];
    console.info(
      `[scrape] Visiting detail page ${urlIdx + 1}/${uniqueUrls.length}: ${detailUrl}`,
    );
    let detailNavStatus: "ok" | "timeout" | "http_error" | "skipped_no_url" = "ok";
    if (!detailUrl) {
      detailNavStatus = "skipped_no_url";
    }
    try {
      const response = await gotoForgiving(page, detailUrl, DETAIL_PAGE_TIMEOUT_MS);
      if (response && !response.ok()) {
        detailNavStatus = "http_error";
      }

      // Wait for detail page selector if specified
      if (detailStep.waitFor) {
        try {
          await page.waitForSelector(detailStep.waitFor, {
            timeout: DETAIL_PAGE_TIMEOUT_MS,
          });
        } catch {
          console.warn(
            `[scrape] waitFor selector "${detailStep.waitFor}" not found on detail page: ${detailUrl}`,
          );
        }
      }

      // Seed the row with listing-scope fields collected earlier from the
      // item card on the listing page. Detail-scope fields are extracted
      // below from the detail page DOM and overwrite empty seeds.
      const rawFields: Record<string, string> = {
        ...(listingFieldsByUrl[detailUrl] ?? {}),
      };
      let descDebug: {
        selector: string;
        matched: boolean;
        rootTag: string | null;
        rawTextLength: number;
      } | null = null;

      // Choose which fields to run on the detail page. If we already
      // collected something for the field on the listing, prefer the
      // detail-page value only when it is non-empty.
      const fieldsToRunOnDetail = Object.keys(detailFields).length > 0
        ? detailFields
        : fieldMappings; // legacy fall-through: no capturedOnUrl info

      for (const [fieldName, mapping] of Object.entries(fieldsToRunOnDetail)) {
        try {
          const fieldEl = await page.$(mapping.selector);
          if (fieldEl) {
            const extracted = await extractMappedFieldFromElement(
              fieldEl,
              fieldName,
              mapping.extractAttr,
            );
            const trimmed = (extracted ?? "").trim();
            // Overwrite listing seed when detail produced any stored value
            // (including identifiers from hidden inputs / data-*).
            if (trimmed.length > 0 || !rawFields[fieldName]) {
              rawFields[fieldName] = extracted ?? "";
            }

            const href = await readHrefFromFieldElement(fieldEl);
            if (href) {
              rawFields[`${fieldName}_href`] = href;
            }

            if (fieldName === "description") {
              const rootTag = await fieldEl.evaluate((el) => el.tagName.toLowerCase());
              descDebug = {
                selector: mapping.selector,
                matched: true,
                rootTag,
                rawTextLength: (extracted ?? "").length,
              };
            }
          } else {
            // Detail page didn't have it. Keep the listing seed if any.
            if (rawFields[fieldName] === undefined) rawFields[fieldName] = "";
            if (fieldName === "description") {
              descDebug = {
                selector: mapping.selector,
                matched: false,
                rootTag: null,
                rawTextLength: 0,
              };
            }
          }
        } catch {
          if (rawFields[fieldName] === undefined) rawFields[fieldName] = "";
          if (fieldName === "description") {
            descDebug = {
              selector: mapping.selector,
              matched: false,
              rootTag: null,
              rawTextLength: 0,
            };
          }
        }
      }

      if (descDebug) {
        rawFields["_debugDescription"] = JSON.stringify({
          ...descDebug,
          source: "detailPage",
        });
      }

      rawFields["_detailNavStatus"] = detailNavStatus;
      // Add the detail page URL to raw fields
      rawFields["_detailUrl"] = detailUrl;

      // Extract application form data if configured
      if (formCaptureConfig) {
        // If there's an apply step (pageFlow[2]), navigate to it first
        const applyStep = pageFlow.length > 2 ? pageFlow[2] : null;
        if (applyStep && applyStep.action !== "navigate") {
          try {
            const applyLink = await page.$(applyStep.action);
            if (applyLink) {
              const applyHref = await applyLink.getAttribute("href");
              if (applyHref) {
                await gotoForgiving(
                  page,
                  new URL(applyHref, page.url()).toString(),
                  DETAIL_PAGE_TIMEOUT_MS,
                );
              }
            }
          } catch {
            // Stay on current page if apply navigation fails
          }
        }
        const formData = await extractFormDataOrFallback(
          page,
          formCaptureConfig,
        );
        if (formData) rawFields["_formData"] = formData;
      }

      rawFieldsList.push(rawFields);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[scrape] Failed to extract from detail page: ${detailUrl}`,
        msg,
      );
      const status: "timeout" | "http_error" = /timeout/i.test(msg)
        ? "timeout"
        : "http_error";
      rawFieldsList.push({
        _detailUrl: detailUrl,
        _detailNavStatus: status,
        _debugDescription: JSON.stringify({
          selector: fieldMappings.description?.selector ?? "",
          matched: false,
          rootTag: null,
          rawTextLength: 0,
          source: "detailPage",
          navError: msg.slice(0, 200),
        }),
      });
    }
  }

  return dedupeAndCapRawFields(rawFieldsList);
}

// ---------------------------------------------------------------------------
// Helper: get listing/item selectors from fieldMappings JSON
// ---------------------------------------------------------------------------

function getStructuralSelectors(
  fieldMappingsRaw: unknown,
): { listingSelector: string | null; itemSelector: string | null; revealSelector: string | null } {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") {
    return { listingSelector: null, itemSelector: null, revealSelector: null };
  }

  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;

  let listingSelector: string | null = null;
  let itemSelector: string | null = null;
  let revealSelector: string | null = null;

  // _meta is the canonical location (set by extension save)
  if (meta && typeof meta["listingSelector"] === "string") {
    listingSelector = meta["listingSelector"];
  } else if (typeof raw["listingSelector"] === "string") {
    listingSelector = raw["listingSelector"];
  }

  if (meta && typeof meta["itemSelector"] === "string") {
    itemSelector = meta["itemSelector"];
  } else if (typeof raw["itemSelector"] === "string") {
    itemSelector = raw["itemSelector"];
  }

  if (meta && typeof meta["revealSelector"] === "string") {
    revealSelector = meta["revealSelector"];
  }

  if (listingSelector) console.info(`[scrape] listingSelector: ${listingSelector}`);
  if (itemSelector) console.info(`[scrape] itemSelector: ${itemSelector}`);
  if (revealSelector) console.info(`[scrape] revealSelector: ${revealSelector}`);

  return { listingSelector, itemSelector, revealSelector };
}

// ---------------------------------------------------------------------------
// Pagination config (currently click-based only): worker clicks the "next"
// button until it disappears, becomes disabled, the first item stops
// changing, or maxPages is hit. SPA-friendly because we don't trust URL.
// ---------------------------------------------------------------------------

interface PaginationConfig {
  type: "click";
  nextSelector: string;
  maxPages: number;
  settleMs: number;
}

function getPaginationConfig(
  fieldMappingsRaw: unknown,
): PaginationConfig | null {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return null;
  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;
  if (!meta) return null;

  const p = meta["pagination"] as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object") return null;
  if (p["type"] !== "click") return null;
  if (typeof p["nextSelector"] !== "string" || !p["nextSelector"]) return null;

  const maxPages = typeof p["maxPages"] === "number" && p["maxPages"]! > 0
    ? Math.min(p["maxPages"] as number, 100)
    : 20;
  const settleMs = typeof p["settleMs"] === "number" && p["settleMs"]! > 0
    ? Math.min(p["settleMs"] as number, 10_000)
    : 1200;

  console.info(
    `[scrape] pagination: type=click nextSelector="${p["nextSelector"]}" maxPages=${maxPages} settleMs=${settleMs}`,
  );
  return {
    type: "click",
    nextSelector: p["nextSelector"] as string,
    maxPages,
    settleMs,
  };
}

/**
 * Advance to the next listing page by clicking the configured selector.
 * Returns true if the click happened and content changed; false if there's
 * no next page (button missing, disabled, or list content didn't update).
 *
 * "Content changed" = the first item's outerHTML signature changes within
 * `settleMs * 4` ms. Avoids matching the same page twice on SPAs that don't
 * touch the URL.
 */
async function advanceToNextPage(
  page: Page,
  itemSelector: string | null,
  cfg: PaginationConfig,
  signatureBefore: string,
): Promise<boolean> {
  const btn = await page.$(cfg.nextSelector).catch(() => null);
  if (!btn) {
    console.info("[scrape] pagination: next button not found — stopping");
    return false;
  }
  const isDisabled = await btn
    .evaluate((el) => {
      const e = el as HTMLElement;
      return (
        (e as HTMLButtonElement).disabled ||
        e.getAttribute("aria-disabled") === "true" ||
        e.classList.contains("Mui-disabled") ||
        e.classList.contains("disabled")
      );
    })
    .catch(() => false);
  if (isDisabled) {
    console.info("[scrape] pagination: next button is disabled — stopping");
    return false;
  }

  try {
    await btn.click({ timeout: 4_000 });
  } catch (e) {
    console.warn(`[scrape] pagination: click failed — ${(e as Error).message}`);
    return false;
  }

  if (itemSelector) {
    try {
      await page.waitForFunction(
        ({ sel, prev }) => {
          const first = document.querySelector(sel);
          if (!first) return false;
          return first.outerHTML.slice(0, 4000) !== prev;
        },
        { sel: itemSelector, prev: signatureBefore },
        { timeout: cfg.settleMs * 4 },
      );
    } catch {
      console.info("[scrape] pagination: content did not change after click — stopping");
      return false;
    }
  } else {
    await page.waitForTimeout(cfg.settleMs);
  }
  // small extra settle for downstream queries
  await page.waitForTimeout(300);
  return true;
}

async function firstItemSignature(
  page: Page,
  itemSelector: string | null,
): Promise<string> {
  if (!itemSelector) return "";
  return page
    .evaluate(
      (sel) => document.querySelector(sel)?.outerHTML.slice(0, 4000) ?? "",
      itemSelector,
    )
    .catch(() => "");
}

// ---------------------------------------------------------------------------
// Helper: get setup script from fieldMappings JSON. Runs once in the page
// context after page load and before extraction. Use when an SPA hides
// content behind app state (e.g. Angular scope) and needs a poke to render.
// ---------------------------------------------------------------------------

function getSetupScript(fieldMappingsRaw: unknown): string | null {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return null;
  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;
  if (!meta) return null;
  const s = meta["setupScript"];
  if (typeof s !== "string" || !s.trim()) return null;
  return s;
}

async function runSetupScript(page: Page, script: string): Promise<void> {
  try {
    await page.evaluate((src: string) => {
      new Function(src)();
    }, script);
    await page.waitForTimeout(1_500);
    console.info(`[scrape] setupScript executed (${script.length} chars)`);
  } catch (e) {
    console.warn(`[scrape] setupScript error — ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Helper: get loadMoreSelector from fieldMappings JSON. When set, the worker
// clicks the matching element repeatedly after page load to expand
// append-style listings (e.g. "טען עוד" / "Load more"). Independent from
// `pagination` (which expects content to replace, not grow).
// ---------------------------------------------------------------------------

function getLoadMoreSelector(fieldMappingsRaw: unknown): string | null {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return null;
  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;
  if (!meta) return null;
  const s = meta["loadMoreSelector"];
  if (typeof s !== "string" || !s.trim()) return null;
  return s.trim();
}

// ---------------------------------------------------------------------------
// Helper: get per-site browser-context overrides from fieldMappings JSON.
// Lets onboarders unblock WAF-protected sites that reject the worker's
// default Playwright UA / headers without touching global env defaults.
// ---------------------------------------------------------------------------

function getBrowserOverrides(fieldMappingsRaw: unknown): BrowserOverrides | null {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return null;
  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;
  if (!meta) return null;
  const bo = meta["browserOverrides"];
  if (!bo || typeof bo !== "object") return null;

  const src = bo as Record<string, unknown>;
  const overrides: BrowserOverrides = {};

  if (typeof src["userAgent"] === "string" && src["userAgent"].trim()) {
    overrides.userAgent = src["userAgent"].trim();
  }

  if (src["extraHeaders"] && typeof src["extraHeaders"] === "object") {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(src["extraHeaders"] as Record<string, unknown>)) {
      if (typeof k === "string" && k.trim() && typeof v === "string") {
        headers[k] = v;
      }
    }
    if (Object.keys(headers).length > 0) overrides.extraHeaders = headers;
  }

  if (src["bypassCSP"] === true) {
    overrides.bypassCSP = true;
  }

  if (!overrides.userAgent && !overrides.extraHeaders && !overrides.bypassCSP) return null;
  console.info(
    `[scrape] browserOverrides present: userAgent=${overrides.userAgent ? "yes" : "no"} extraHeaders=${Object.keys(overrides.extraHeaders ?? {}).length} bypassCSP=${overrides.bypassCSP ? "yes" : "no"}`,
  );
  return overrides;
}

// ---------------------------------------------------------------------------
// Helper: get form capture config from fieldMappings JSON
// ---------------------------------------------------------------------------

interface FormCaptureConfig {
  formSelector: string;
  actionUrl: string;
  method: string;
  // Pre-built JSON blob to write into rawFields._formData when live
  // re-extraction fails OR when formSelector is an image-capture placeholder
  // that doesn't match any real DOM element. Sourced from the saved
  // fields[] array in _meta.formCapture. null when no static fields were
  // recorded (extension-captured forms typically rely on live re-extract).
  staticBlob: string | null;
}

function getFormCaptureConfig(
  fieldMappingsRaw: unknown,
): FormCaptureConfig | null {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return null;
  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;
  if (!meta) return null;

  const formCapture = meta["formCapture"] as Record<string, unknown> | undefined;
  if (!formCapture) return null;

  const formSelector =
    typeof formCapture["formSelector"] === "string"
      ? (formCapture["formSelector"] as string)
      : "";
  const actionUrl = (formCapture["actionUrl"] as string) || "";
  const method = (formCapture["method"] as string) || "GET";
  const fields = Array.isArray(formCapture["fields"])
    ? (formCapture["fields"] as unknown[])
    : null;
  const staticBlob =
    fields && fields.length > 0
      ? JSON.stringify({ actionUrl, method, fields })
      : null;

  // Nothing usable in this saved formCapture entry — skip.
  if (!formSelector && !staticBlob) return null;

  return { formSelector, actionUrl, method, staticBlob };
}

/**
 * Live-extract the apply form from the current page; on failure (no form
 * found, selector mismatch, page.evaluate threw), fall back to the static
 * fields blob recorded during onboarding. The fallback is how
 * image-captured forms (where formSelector is a non-replayable
 * placeholder) surface on the dashboard, and it also keeps the
 * Application Form panel alive when a live form temporarily breaks.
 */
async function extractFormDataOrFallback(
  page: Page,
  cfg: FormCaptureConfig,
): Promise<string | null> {
  try {
    const live = await extractFormData(page, cfg);
    if (live) return live;
  } catch {
    // fall through to static
  }
  return cfg.staticBlob;
}

// ---------------------------------------------------------------------------
// Helper: extract form data from current page
// ---------------------------------------------------------------------------

async function extractFormData(
  page: Page,
  formCaptureConfig: FormCaptureConfig | null,
): Promise<string | null> {
  const result = await page.evaluate((cfg) => {
    let form: HTMLFormElement | null = null;

    if (cfg?.formSelector) {
      form = document.querySelector(cfg.formSelector) as HTMLFormElement | null;
    }
    if (!form) {
      form = document.querySelector("form") as HTMLFormElement | null;
    }
    if (!form) return null;

    const actionRaw = form.getAttribute("action") || "";
    const actionUrl = actionRaw ? new URL(actionRaw, window.location.href).toString() : window.location.href;
    const method = (form.getAttribute("method") || "GET").toUpperCase();

    const fields: Array<{
      name: string;
      label: string;
      fieldType: string;
      required: boolean;
      tagName: string;
    }> = [];

    const elements = form.querySelectorAll("input, select, textarea");
    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : "text");

      if (type === "submit" || type === "button" || type === "image" || type === "reset") continue;

      const name = el.getAttribute("name") || "";

      // Infer label
      let label = "";
      const htmlEl = el as HTMLElement;
      if (htmlEl.id) {
        const labelEl = document.querySelector(`label[for="${CSS.escape(htmlEl.id)}"]`);
        if (labelEl?.textContent) label = labelEl.textContent.trim().slice(0, 100);
      }
      if (!label) {
        const parentLabel = htmlEl.closest("label");
        if (parentLabel) {
          const clone = parentLabel.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
          label = clone.textContent?.trim()?.slice(0, 100) || "";
        }
      }
      if (!label) label = el.getAttribute("placeholder")?.trim()?.slice(0, 100) || "";
      if (!label) label = el.getAttribute("aria-label")?.trim()?.slice(0, 100) || "";
      if (!label && name) label = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").trim();
      if (!label) label = `${type} ${tag}`;

      fields.push({
        name,
        label,
        fieldType: type,
        required: el.hasAttribute("required"),
        tagName: tag,
      });
    }

    return JSON.stringify({ actionUrl, method, fields });
  }, formCaptureConfig);

  return result;
}

// ---------------------------------------------------------------------------
// Main: handleScrapeJob
// ---------------------------------------------------------------------------

export async function handleScrapeJob(
  job: WorkerJob,
  site: Site,
): Promise<Record<string, unknown>> {
  // Extract scrapeRunId and optional maxJobs from job payload
  const payload = job.payload as Record<string, unknown> | null;
  const scrapeRunId = payload?.scrapeRunId as string | undefined;
  const maxJobs = typeof payload?.maxJobs === "number" ? payload.maxJobs : null;

  if (!scrapeRunId) {
    console.error("[scrape] No scrapeRunId in job payload:", job.id);
    return {
      success: false,
      error: "No scrapeRunId in job payload",
    };
  }

  console.info(
    `[scrape] Starting scrape for site: ${site.siteUrl} (scrapeRunId: ${scrapeRunId}${maxJobs ? `, maxJobs: ${maxJobs}` : ""})`,
  );

  let browser: Browser | null = null;
  const context: ScrapeContext = {
    pageLoaded: false,
    selectorsMatched: false,
    itemsFound: 0,
  };

  // Parse site configuration
  const fieldMappings = parseFieldMappings(site.fieldMappings);
  const pageFlow = parsePageFlow(site.pageFlow);
  const { listingSelector, itemSelector, revealSelector } = getStructuralSelectors(
    site.fieldMappings,
  );
  const formCaptureConfig = getFormCaptureConfig(site.fieldMappings);
  const pagination = getPaginationConfig(site.fieldMappings);
  const setupScript = getSetupScript(site.fieldMappings);
  const loadMoreSelector = getLoadMoreSelector(site.fieldMappings);
  const browserOverrides = getBrowserOverrides(site.fieldMappings);

  if (Object.keys(fieldMappings).length === 0) {
    const result = await failScrapeRun(scrapeRunId, site.id, {
      error: "Site has no field mappings configured",
      failureCategory: "other",
    });
    return { ...result };
  }

  // Wrap entire scrape execution in a timeout (NFR2: 2 minutes)
  const timeout = createTimeoutPromise(scrapeRunId, site.id);
  try {
    const scrapeResult = await Promise.race<ScrapeResult>([
      executeScrape(
        site,
        scrapeRunId,
        fieldMappings,
        pageFlow,
        listingSelector,
        itemSelector,
        revealSelector,
        formCaptureConfig,
        context,
        maxJobs,
        (b: Browser) => {
          browser = b;
        },
        pagination,
        setupScript,
        loadMoreSelector,
        browserOverrides,
      ),
      timeout.promise,
    ]);

    timeout.cancel();
    return { ...scrapeResult };
  } catch (error) {
    timeout.cancel();

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const failureCategory = categorizeError(
      error instanceof Error ? error : new Error(errorMessage),
      context,
    );

    // Check if jobs were already saved incrementally before the error/timeout
    const run = await prisma.scrapeRun.findUnique({
      where: { id: scrapeRunId },
      select: { jobCount: true, totalJobs: true, status: true },
    });

    const savedJobs = run?.jobCount ?? 0;

    // If the timeout handler already set PARTIAL, don't overwrite it
    if (run?.status === "PARTIAL") {
      console.warn(
        `[scrape] Scrape timed out but ${savedJobs} jobs were already saved (PARTIAL)`,
      );
      return {
        success: true,
        scrapeRunId,
        jobCount: savedJobs,
        totalJobs: run?.totalJobs ?? 0,
        validJobs: savedJobs,
        invalidJobs: 0,
      };
    }

    // If we saved some jobs but the timeout handler didn't get to run yet
    if (savedJobs > 0) {
      console.warn(
        `[scrape] Scrape errored but ${savedJobs} jobs were already saved — marking PARTIAL`,
      );
      await prisma.scrapeRun.update({
        where: { id: scrapeRunId },
        data: {
          status: "PARTIAL",
          error: `${errorMessage} (${savedJobs} jobs saved)`,
          failureCategory,
          completedAt: new Date(),
        },
      });
      await prisma.site.update({
        where: { id: site.id },
        data: { status: "ACTIVE", activeAt: new Date() },
      });
      return {
        success: true,
        scrapeRunId,
        jobCount: savedJobs,
        totalJobs: run?.totalJobs ?? 0,
        validJobs: savedJobs,
        invalidJobs: 0,
      };
    }

    console.error("[scrape] Scrape failed:", {
      siteId: site.id,
      scrapeRunId,
      error: errorMessage,
      failureCategory,
    });

    const result = await failScrapeRun(scrapeRunId, site.id, {
      error: errorMessage,
      failureCategory,
    });

    return { ...result };
  } finally {
    await closeBrowser(browser);
  }
}

// ---------------------------------------------------------------------------
// Core scrape execution (runs within the timeout race)
// ---------------------------------------------------------------------------

async function executeScrape(
  site: Site,
  scrapeRunId: string,
  fieldMappings: Record<string, FieldMappingEntry>,
  pageFlow: PageFlowStep[],
  listingSelector: string | null,
  itemSelector: string | null,
  revealSelector: string | null,
  formCaptureConfig: FormCaptureConfig | null,
  context: ScrapeContext,
  maxJobs: number | null,
  setBrowser: (b: Browser) => void,
  pagination: PaginationConfig | null = null,
  setupScript: string | null = null,
  loadMoreSelector: string | null = null,
  browserOverrides: BrowserOverrides | null = null,
): Promise<ScrapeResult> {
  // Launch browser
  const browser = await launchBrowser();
  setBrowser(browser);
  const { page } = await createPage(browser, browserOverrides ?? undefined);

  // Inject __name shim so tsx-transpiled function decorators don't crash
  // inside page.evaluate calls that run in the browser context.
  await page.addInitScript(
    'if(typeof __name==="undefined"){globalThis.__name=function(fn){return fn}}',
  );

  // Determine scrape strategy
  const hasPageFlow = pageFlow.length > 0;

  let rawFieldsList: Record<string, string>[];

  if (hasPageFlow) {
    // Multi-page flow
    console.info("[scrape] Using multi-page flow extraction");
    rawFieldsList = await extractRawFieldsWithPageFlow(
      page,
      fieldMappings,
      pageFlow,
      listingSelector,
      itemSelector,
      revealSelector,
      formCaptureConfig,
      pagination,
    );
    context.pageLoaded = true;
    context.selectorsMatched = rawFieldsList.length > 0;
    context.itemsFound = rawFieldsList.length;

    // Multi-page may visit detail pages and capture per-job form data inline,
    // but a single-step pageFlow leaves us back on the listing page with the
    // form embedded there. Capture once and attach to every record.
    if (
      formCaptureConfig &&
      rawFieldsList.length > 0 &&
      !rawFieldsList.some((r) => r["_formData"])
    ) {
      const formData = await extractFormDataOrFallback(
        page,
        formCaptureConfig,
      );
      if (formData) {
        for (const raw of rawFieldsList) {
          raw["_formData"] = formData;
        }
      }
    }
  } else {
    // Single-page extraction
    console.info("[scrape] Using single-page extraction");

    // ---- Diagnostic listeners (capture console + JS errors + key responses)
    const consoleMessages: Array<{ type: string; text: string }> = [];
    const pageErrors: string[] = [];
    const subResources: Array<{ url: string; status: number }> = [];
    const onConsole = (msg: import("playwright").ConsoleMessage) => {
      if (consoleMessages.length < 50) {
        consoleMessages.push({ type: msg.type(), text: msg.text().slice(0, 300) });
      }
    };
    const onPageError = (err: Error) => {
      if (pageErrors.length < 20) pageErrors.push(err.message.slice(0, 300));
    };
    const onResponse = (r: import("playwright").Response) => {
      const url = r.url();
      // Capture WAF-relevant assets: anti-bot lib, all sub-document HTML, any
      // response with a "rbz" / "akamai" / "datadome" hint
      if (
        /\.lib\.js$|rbz|akamai|datadome|cf_chl|challenge/i.test(url) ||
        r.request().resourceType() === "document"
      ) {
        if (subResources.length < 30) {
          subResources.push({ url, status: r.status() });
        }
      }
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("response", onResponse);

    // Navigate to the site URL -- domcontentloaded + best-effort networkidle
    const navResponse = await gotoForgiving(page, site.siteUrl, NAVIGATION_TIMEOUT_MS);
    context.pageLoaded = true;

    // Many Israeli sites sit behind Reblaze (kramericaindustries.ac_v2.lib.js
    // → winsocks() → reload). The challenge page has an empty <body> until
    // the PoW completes and the page reloads. Give that reload a chance to
    // land before we try to extract.
    try {
      await page.waitForFunction(
        () => !!document.body && document.body.children.length > 0,
        { timeout: 25_000 },
      );
    } catch {
      console.warn("[scrape] Body never populated within 25s (likely WAF challenge stuck)");
    }

    // Optional setupScript: SPA hook for sites that hide most content behind
    // app state (Angular scope, React store). Runs once after page load and
    // before any extraction step.
    if (setupScript) {
      await runSetupScript(page, setupScript);
    }

    await autoScrollUntilStable(page, itemSelector);
    await clickLoadMoreUntilStable(page, loadMoreSelector, itemSelector);

    // If load-more was configured, re-run setupScript so newly-appended items
    // get the same enrichment (hidden data attrs, noscript stripping, etc.).
    // setupScripts are expected to be idempotent — they guard with
    // `if (!el.querySelector(injected))` so a second pass only touches the
    // items that arrived after the first run.
    if (setupScript && loadMoreSelector) {
      await runSetupScript(page, setupScript);
    }

    // Log the main navigation response so we can see status / redirect / size
    // when the page comes back empty. This is the single most important signal
    // for distinguishing "blocked" vs "empty SPA shell" vs "geo redirect".
    if (navResponse) {
      try {
        const status = navResponse.status();
        const finalUrl = navResponse.url();
        const headers = navResponse.headers();
        const bodyBuf = await navResponse.body().catch(() => Buffer.alloc(0));
        const bodyLen = bodyBuf.length;
        const requestChain: Array<{ url: string; status: number }> = [];
        let req = navResponse.request();
        while (req) {
          const r = await req.response().catch(() => null);
          requestChain.push({ url: req.url(), status: r ? r.status() : -1 });
          const redirectedFrom = req.redirectedFrom();
          if (!redirectedFrom) break;
          req = redirectedFrom;
        }
        console.info("[scrape] Main navigation response:", {
          requestedUrl: site.siteUrl,
          finalUrl,
          status,
          contentType: headers["content-type"],
          contentLength: headers["content-length"],
          server: headers["server"],
          setCookie: headers["set-cookie"]?.slice(0, 200),
          bodyBytes: bodyLen,
          bodyPreview: bodyBuf.toString("utf8").slice(0, 1500),
          redirectChain: requestChain.reverse(),
        });
      } catch (err) {
        console.warn("[scrape] Could not inspect navigation response:", err);
      }
    } else {
      console.warn("[scrape] page.goto returned null response (no main document loaded)");
    }

    // Wait for the title selector to appear (dynamic / SPA sites)
    const titleSelector = fieldMappings["title"]?.selector;
    if (titleSelector) {
      try {
        await page.waitForSelector(titleSelector, { timeout: 10_000 });
        console.info("[scrape] Title selector appeared on page");
      } catch {
        console.warn(
          `[scrape] Title selector not found after 10s, proceeding anyway: ${titleSelector}`,
        );
      }
    }

    rawFieldsList = await extractRawFieldsFromListingPage(
      page,
      fieldMappings,
      listingSelector,
      itemSelector,
      revealSelector,
      pagination,
    );

    // If nothing matched, give the page a chance: scroll to bottom to trigger
    // lazy-load, wait a beat, then retry once. This recovers many SPAs that
    // hadn't finished hydrating when `networkidle` fired.
    if (rawFieldsList.length === 0 && itemSelector) {
      console.warn("[scrape] 0 items on first pass — scrolling to trigger lazy-load and retrying");
      try {
        await page.evaluate(async () => {
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          for (let y = 0; y < 3; y++) {
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(800);
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(1500);
      } catch {
        /* scroll is best-effort */
      }

      rawFieldsList = await extractRawFieldsFromListingPage(
        page, fieldMappings, listingSelector, itemSelector, revealSelector, pagination,
      );
    }

    // Still nothing → dump WAF-challenge diagnostics: did lib.js load? did
    // winsocks() throw? did any subsequent navigation happen?
    if (rawFieldsList.length === 0) {
      console.warn("[scrape] WAF/challenge diagnostics:", {
        subResources,
        consoleMessages,
        pageErrors,
        cookies: await page.context().cookies(site.siteUrl).catch(() => []),
      });
    }

    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);

    context.selectorsMatched = rawFieldsList.length > 0;
    context.itemsFound = rawFieldsList.length;

    // Extract form data once from the single page and attach to all records
    if (formCaptureConfig && rawFieldsList.length > 0) {
      const formData = await extractFormDataOrFallback(
        page,
        formCaptureConfig,
      );
      if (formData) {
        for (const raw of rawFieldsList) {
          raw["_formData"] = formData;
        }
      }
    }
  }

  // Apply maxJobs limit if set (e.g. "Test 1 Job" from dashboard)
  if (maxJobs && rawFieldsList.length > maxJobs) {
    console.info(`[scrape] Limiting to ${maxJobs} of ${rawFieldsList.length} extracted records (maxJobs)`);
    rawFieldsList = rawFieldsList.slice(0, maxJobs);
  }

  console.info(`[scrape] Extracted ${rawFieldsList.length} raw job records`);

  // Handle empty results (AC #5)
  if (rawFieldsList.length === 0) {
    const result: ScrapeResult = {
      success: true,
      scrapeRunId,
      jobCount: 0,
      totalJobs: 0,
      validJobs: 0,
      invalidJobs: 0,
      failureCategory: "empty_results",
    };

    await prisma.scrapeRun.update({
      where: { id: scrapeRunId },
      data: {
        status: "COMPLETED",
        jobCount: 0,
        totalJobs: 0,
        validJobs: 0,
        invalidJobs: 0,
        failureCategory: "empty_results",
        completedAt: new Date(),
      },
    });

    console.info("[scrape] Scrape completed with zero results (empty_results)");
    return result;
  }

  // Normalize and validate each record using dedicated modules
  const validatedRecords: ValidatedRecord[] = rawFieldsList.map((rawFields) => {
    const normalized = normalizeJobRecord(rawFields);
    const validation = validateJobRecord(normalized);
    return { normalized, validation };
  });

  // Log validation warnings for records with quality issues
  for (const { normalized, validation } of validatedRecords) {
    if (validation.warnings.length > 0) {
      console.warn(
        `[scrape] Quality warnings for job "${normalized.title || "(untitled)"}":`,
        validation.warnings,
      );
    }
  }

  const validCount = validatedRecords.filter(
    (r) => r.validation.isValid,
  ).length;
  const invalidCount = validatedRecords.length - validCount;

  // Dedup using normalized values (catches edge cases the raw dedup misses,
  // e.g. accordion wrappers matching the item selector).
  const dedupSeen = new Set<string>();
  const recordsToPersist = validatedRecords.filter((r) => {
    if (!r.validation.isValid) return false;
    const n = r.normalized;
    const key =
      n.externalJobId ||
      n.url ||
      `${(n.title || "").toLowerCase()}|${(n.location || "").toLowerCase()}`;
    if (!key || key === "|") return true;
    if (dedupSeen.has(key)) return false;
    dedupSeen.add(key);
    return true;
  });

  if (recordsToPersist.length === 0) {
    const result: ScrapeResult = {
      success: true,
      scrapeRunId,
      jobCount: 0,
      totalJobs: validatedRecords.length,
      validJobs: 0,
      invalidJobs: invalidCount,
      failureCategory: "structure_changed",
    };

    await prisma.scrapeRun.update({
      where: { id: scrapeRunId },
      data: {
        status: "COMPLETED",
        jobCount: 0,
        totalJobs: validatedRecords.length,
        validJobs: 0,
        invalidJobs: invalidCount,
        failureCategory: "structure_changed",
        completedAt: new Date(),
      },
    });

    console.warn("[scrape] No valid records after validation; skipping persistence", {
      siteUrl: site.siteUrl,
      totalExtracted: validatedRecords.length,
      invalidCount,
    });

    return result;
  }

  // Save jobs in chunks so progress is preserved even if a timeout occurs.
  // Delete old jobs first, then insert in batches of CHUNK_SIZE, updating the
  // ScrapeRun progress after each chunk.
  const CHUNK_SIZE = 20;
  await prisma.job.deleteMany({ where: { siteId: site.id } });

  let savedCount = 0;
  for (let offset = 0; offset < recordsToPersist.length; offset += CHUNK_SIZE) {
    const chunk = recordsToPersist.slice(offset, offset + CHUNK_SIZE);

    await prisma.$transaction(async (tx) => {
      for (const { normalized, validation } of chunk) {
        await tx.job.create({
          data: {
            title: normalized.title || "Untitled",
            description: normalized.description || null,
            requirements: normalized.requirements || null,
            location: normalized.location || "Unknown",
            department: normalized.department || null,
            externalJobId: normalized.externalJobId || null,
            publishDate: normalized.publishDate || null,
            applicationInfo: normalized.applicationInfo || null,
            rawData: normalized.rawFields as Prisma.InputJsonValue,
            validationStatus:
              validation.warnings.length > 0
                ? `${validation.status};warn:${validation.warnings.join(",")}`
                : validation.status,
            siteId: site.id,
            scrapeRunId,
          },
        });
      }

      savedCount += chunk.length;

      // Update ScrapeRun progress after each chunk
      await tx.scrapeRun.update({
        where: { id: scrapeRunId },
        data: {
          status: savedCount < recordsToPersist.length ? "IN_PROGRESS" : "COMPLETED",
          jobCount: savedCount,
          totalJobs: validatedRecords.length,
          validJobs: savedCount,
          invalidJobs: invalidCount,
          ...(savedCount >= recordsToPersist.length
            ? { completedAt: new Date() }
            : {}),
        },
      });
    });

    console.info(
      `[scrape] Saved chunk: ${savedCount}/${recordsToPersist.length} jobs (${context.itemsFound} found on page)`,
    );
  }

  await prisma.site.update({
    where: { id: site.id },
    data: {
      status: "ACTIVE",
      activeAt: new Date(),
    },
  });

  const result: ScrapeResult = {
    success: true,
    scrapeRunId,
    jobCount: recordsToPersist.length,
    totalJobs: validatedRecords.length,
    validJobs: recordsToPersist.length,
    invalidJobs: invalidCount,
  };

  console.info("[scrape] Scrape completed successfully:", {
    siteUrl: site.siteUrl,
    foundOnPage: context.itemsFound,
    jobCount: result.jobCount,
    validJobs: result.validJobs,
    invalidJobs: result.invalidJobs,
  });

  // Emit SSE event for scrape completion
  await emitWorkerEvent({
    type: "scrape:completed",
    payload: { siteId: site.id, jobCount: result.jobCount },
  });

  await emitWorkerEvent({
    type: "site:status-changed",
    payload: { siteId: site.id, status: "ACTIVE" },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Timeout promise (2-minute overall scrape limit)
// ---------------------------------------------------------------------------

function createTimeoutPromise(
  scrapeRunId: string,
  siteId: string,
): { promise: Promise<ScrapeResult>; cancel: () => void } {
  let timerId: ReturnType<typeof setTimeout>;
  const promise = new Promise<ScrapeResult>((_, reject) => {
    timerId = setTimeout(async () => {
      try {
        // Check if any jobs were already saved by incremental persistence
        const run = await prisma.scrapeRun.findUnique({
          where: { id: scrapeRunId },
          select: { jobCount: true, totalJobs: true },
        });

        const savedJobs = run?.jobCount ?? 0;
        const totalJobs = run?.totalJobs ?? null;

        if (savedJobs > 0) {
          // Partial success: jobs were saved before the timeout hit
          console.warn(
            `[scrape] Timeout after saving ${savedJobs}/${totalJobs ?? "?"} jobs — marking as PARTIAL`,
          );
          await prisma.scrapeRun.update({
            where: { id: scrapeRunId },
            data: {
              status: "PARTIAL",
              error: `Timeout after saving ${savedJobs}/${totalJobs ?? "?"} jobs`,
              failureCategory: "timeout",
              completedAt: new Date(),
            },
          });
          await prisma.site.update({
            where: { id: siteId },
            data: { status: "ACTIVE", activeAt: new Date() },
          });
          await emitWorkerEvent({
            type: "scrape:completed",
            payload: { siteId, jobCount: savedJobs },
          });
          await emitWorkerEvent({
            type: "site:status-changed",
            payload: { siteId, status: "ACTIVE" },
          });
        } else {
          await failScrapeRun(scrapeRunId, siteId, {
            error: "Scrape execution exceeded 10-minute timeout",
            failureCategory: "timeout",
          });
        }
      } catch (updateError) {
        console.error("[scrape] Failed to update ScrapeRun on timeout:", updateError);
      }

      reject(new Error("Scrape execution exceeded 10-minute timeout"));
    }, SCRAPE_TIMEOUT_MS);
  });
  return { promise, cancel: () => clearTimeout(timerId) };
}

// ---------------------------------------------------------------------------
// Helper: fail a ScrapeRun and update site status
// ---------------------------------------------------------------------------

async function failScrapeRun(
  scrapeRunId: string,
  siteId: string,
  details: { error: string; failureCategory: string },
): Promise<ScrapeResult> {
  try {
    await prisma.scrapeRun.update({
      where: { id: scrapeRunId },
      data: {
        status: "FAILED",
        error: details.error,
        failureCategory: details.failureCategory,
        completedAt: new Date(),
      },
    });

    await prisma.site.update({
      where: { id: siteId },
      data: {
        status: "FAILED",
        failedAt: new Date(),
      },
    });
  } catch (dbError) {
    console.error("[scrape] Failed to update ScrapeRun/Site on failure:", dbError);
  }

  // Emit SSE events for scrape failure and site status change
  await emitWorkerEvent({
    type: "scrape:failed",
    payload: { siteId, error: details.error, category: details.failureCategory },
  });
  await emitWorkerEvent({
    type: "site:status-changed",
    payload: { siteId, status: "FAILED" },
  });

  return {
    success: false,
    scrapeRunId,
    jobCount: 0,
    totalJobs: 0,
    validJobs: 0,
    invalidJobs: 0,
    error: details.error,
    failureCategory: details.failureCategory,
  };
}
