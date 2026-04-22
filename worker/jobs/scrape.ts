import { prisma } from "../../src/lib/prisma";
import type { WorkerJob, Site } from "../../src/generated/prisma/client";
import { Prisma } from "../../src/generated/prisma/client";
import { launchBrowser, createPage, closeBrowser } from "../lib/playwright";
import { normalizeJobRecord } from "../lib/normalizer";
import type { NormalizedJobRecord } from "../lib/normalizer";
import { validateJobRecord } from "../lib/validator";
import type { ValidationResult } from "../lib/validator";
import type { Browser, Page } from "playwright";
import { emitWorkerEvent } from "../lib/emitEvent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-field mapping from Site.fieldMappings JSON (excluding _meta) */
interface FieldMappingEntry {
  selector: string;
  sample: string;
  sourceMethod: string;
  methodsDetected: number;
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

const SCRAPE_TIMEOUT_MS = 300_000; // 5 minutes
const DETAIL_PAGE_TIMEOUT_MS = 15_000; // 15 seconds per detail page
const NAVIGATION_TIMEOUT_MS = 30_000; // 30 seconds for page navigation
const MAX_EXTRACTED_ITEMS = 500;

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

    mappings[key] = {
      selector: entry.selector as string,
      sample: (entry.sample as string) ?? "",
      sourceMethod: (entry.sourceMethod as string) ?? "UNKNOWN",
      methodsDetected: (entry.methodsDetected as number) ?? 1,
    };
  }

  return mappings;
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
  for (const [name, m] of Object.entries(fieldMappings)) {
    selectorMap[name] = m.selector;
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
    (selectors: Record<string, string>) => {
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
            outsideValues[name] =
              ((el as HTMLElement).innerText || "").trim();
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
    selectorMap,
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
    }) => {
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

      function cleanTextContent(el: Element): string {
        const clone = el.cloneNode(true) as Element;
        clone
          .querySelectorAll("style, script, noscript, link, template, svg, iframe")
          .forEach((n) => n.remove());
        return (clone.textContent || "").replace(/\s+/g, " ").trim();
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
            rec[name] = cleanTextContent(el);
            const anchor =
              el.tagName === "A" ? el : el.closest("a");
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
              rec[name] = cleanTextContent(el);
              const anchor =
                el.tagName === "A" ? el : el.closest("a");
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
): Promise<Record<string, string>[]> {
  const containerSel = listingSelector ?? "body";
  const fullSelector = `${containerSel} ${itemSelector}`;

  const selectorMap: Record<string, string> = {};
  for (const [name, m] of Object.entries(fieldMappings)) {
    selectorMap[name] = m.selector;
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
    return [];
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
      revealSelector: string | null;
    }) => {
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

      function cleanTextContent(el: Element): string {
        const clone = el.cloneNode(true) as Element;
        clone
          .querySelectorAll("style, script, noscript, link, template, svg, iframe")
          .forEach((n) => n.remove());
        return (clone.textContent || "").replace(/\s+/g, " ").trim();
      }

      function extractFieldsFromItem(
        item: Element,
        fields: Record<string, string>,
        hasReveal: boolean,
      ): Record<string, string> {
        const rec: Record<string, string> = {};

        for (const [fieldName, fieldSelector] of Object.entries(fields)) {
          let fieldEl: Element | null = null;

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
            rec[fieldName] = cleanTextContent(fieldEl);
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
        }

        return rec;
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Scroll item into view so lazy-loaded content populates before reveal.
        (item as HTMLElement).scrollIntoView({ block: "center" });
        await new Promise((r) => setTimeout(r, 100));

        if (args.revealSelector) {
          const reveal = findReveal(item, args.revealSelector);
          if (reveal) {
            reveal.click();
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        const rec = extractFieldsFromItem(
          item,
          args.fields,
          !!args.revealSelector,
        );
        if (Object.values(rec).some((v) => v.length > 0)) {
          records.push(rec);
        }
      }

      return records;
    },
    {
      selector: effectiveSelector,
      fields: selectorMap,
      revealSelector,
    },
  );

  console.info(
    `[scrape] Explicit extraction completed: ${results.length} records`,
  );
  return results;
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
): Promise<Record<string, string>[]> {
  // Preferred path: explicit itemSelector from extension container setup.
  // Field selectors are relative to each item element.
  if (itemSelector) {
    const rawFieldsList = await extractWithExplicitItemSelector(
      page, fieldMappings, listingSelector, itemSelector, revealSelector,
    );
    if (rawFieldsList.length > 0) {
      console.info(
        `[scrape] Explicit item-scoped extraction: ${rawFieldsList.length} records`,
      );
      return dedupeAndCapRawFields(rawFieldsList);
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
): Promise<Record<string, string>[]> {
  const rawFieldsList: Record<string, string>[] = [];

  // Navigate to the first page flow URL (listing page)
  const listingStep = pageFlow[0];
  await page.goto(listingStep.url, {
    waitUntil: "networkidle",
    timeout: NAVIGATION_TIMEOUT_MS,
  });

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

  // Multi-page: collect all detail page URLs first
  const detailUrls: string[] = [];
  const detailStep = pageFlow[1];
  const linkSel = detailStep.action !== "navigate" ? detailStep.action : null;

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
          detailUrls.push(new URL(href, page.url()).toString());
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
          detailUrls.push(new URL(href, page.url()).toString());
        }
      } catch {
        // Skip items where URL extraction fails
      }
    }
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
    try {
      await page.goto(detailUrl, {
        waitUntil: "networkidle",
        timeout: DETAIL_PAGE_TIMEOUT_MS,
      });

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

      // Extract fields from the detail page using absolute selectors
      const rawFields: Record<string, string> = {};
      for (const [fieldName, mapping] of Object.entries(fieldMappings)) {
        try {
          const fieldEl = await page.$(mapping.selector);
          if (fieldEl) {
            const text = await fieldEl.innerText();
            rawFields[fieldName] = text ?? "";

            // For links, also extract href
            const href = await fieldEl.getAttribute("href");
            if (href) {
              rawFields[`${fieldName}_href`] = href;
            }
          } else {
            rawFields[fieldName] = "";
          }
        } catch {
          rawFields[fieldName] = "";
        }
      }

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
                await page.goto(new URL(applyHref, page.url()).toString(), {
                  waitUntil: "networkidle",
                  timeout: DETAIL_PAGE_TIMEOUT_MS,
                });
              }
            }
          } catch {
            // Stay on current page if apply navigation fails
          }
        }
        try {
          const formData = await extractFormData(page, formCaptureConfig);
          if (formData) rawFields["_formData"] = formData;
        } catch {
          // Form extraction is best-effort
        }
      }

      rawFieldsList.push(rawFields);
    } catch (error) {
      console.warn(
        `[scrape] Failed to extract from detail page: ${detailUrl}`,
        error instanceof Error ? error.message : String(error),
      );
      // Skip this detail page and continue with the next one
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
// Helper: get form capture config from fieldMappings JSON
// ---------------------------------------------------------------------------

interface FormCaptureConfig {
  formSelector: string;
  actionUrl: string;
  method: string;
}

function getFormCaptureConfig(
  fieldMappingsRaw: unknown,
): FormCaptureConfig | null {
  if (!fieldMappingsRaw || typeof fieldMappingsRaw !== "object") return null;
  const raw = fieldMappingsRaw as Record<string, unknown>;
  const meta = raw["_meta"] as Record<string, unknown> | undefined;
  if (!meta) return null;

  const formCapture = meta["formCapture"] as Record<string, unknown> | undefined;
  if (!formCapture || typeof formCapture["formSelector"] !== "string") return null;

  return {
    formSelector: formCapture["formSelector"] as string,
    actionUrl: (formCapture["actionUrl"] as string) || "",
    method: (formCapture["method"] as string) || "GET",
  };
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
): Promise<ScrapeResult> {
  // Launch browser
  const browser = await launchBrowser();
  setBrowser(browser);
  const { page } = await createPage(browser);

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
    );
    context.pageLoaded = true;
    context.selectorsMatched = rawFieldsList.length > 0;
    context.itemsFound = rawFieldsList.length;
  } else {
    // Single-page extraction
    console.info("[scrape] Using single-page extraction");

    // Navigate to the site URL -- use networkidle to let JS-rendered content load
    await page.goto(site.siteUrl, {
      waitUntil: "networkidle",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    context.pageLoaded = true;

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
        page, fieldMappings, listingSelector, itemSelector, revealSelector,
      );
    }

    // Still nothing → rich selector-level diagnostics are already emitted by
    // extractWithExplicitItemSelector; nothing to add here.

    context.selectorsMatched = rawFieldsList.length > 0;
    context.itemsFound = rawFieldsList.length;

    // Extract form data once from the single page and attach to all records
    if (formCaptureConfig && rawFieldsList.length > 0) {
      try {
        const formData = await extractFormData(page, formCaptureConfig);
        if (formData) {
          for (const raw of rawFieldsList) {
            raw["_formData"] = formData;
          }
        }
      } catch {
        // Form extraction is best-effort
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
            validationStatus: validation.status,
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
            error: "Scrape execution exceeded 5-minute timeout",
            failureCategory: "timeout",
          });
        }
      } catch (updateError) {
        console.error("[scrape] Failed to update ScrapeRun on timeout:", updateError);
      }

      reject(new Error("Scrape execution exceeded 5-minute timeout"));
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
