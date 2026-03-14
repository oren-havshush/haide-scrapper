import type { Page } from "playwright";
import { calculateOverallConfidence } from "../lib/confidence";

// ---------------------------------------------------------------------------
// Types (Task 5)
// ---------------------------------------------------------------------------

/** Final result returned by the pattern matching analysis method. */
export interface PatternMatchResult {
  fieldMappings: Record<string, { selector: string; sample: string }>;
  confidenceScores: Record<string, number>;
  overallConfidence: number;
  listingSelector: string | null;
  itemSelector: string | null;
  itemCount: number;
}

/** Intermediate result from repeating-structure detection. */
export interface RepeatingGroup {
  containerSelector: string;
  itemSelector: string;
  count: number;
  score: number;
}

/** Intermediate result from field classification within a repeating group. */
export interface FieldClassification {
  field: string;
  selector: string;
  sample: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants (analysis timeout)
// ---------------------------------------------------------------------------

const ANALYSIS_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Zero-confidence fallback (reused in error & empty-result paths)
// ---------------------------------------------------------------------------

function zeroResult(): PatternMatchResult {
  return {
    fieldMappings: {},
    confidenceScores: {},
    overallConfidence: 0.0,
    listingSelector: null,
    itemSelector: null,
    itemCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry point  (Task 1.2 + Task 4)
// ---------------------------------------------------------------------------

/**
 * Analyse a page using DOM pattern matching to detect job listing structures
 * and classify fields within them.
 *
 * NEVER throws -- always returns a PatternMatchResult (NFR10).
 */
export async function analyzeWithPatternMatching(
  page: Page,
  siteUrl: string,
): Promise<PatternMatchResult> {
  try {
    // Wrap the entire analysis in a timeout (Task 4.3)
    const result = await Promise.race<PatternMatchResult>([
      runPatternAnalysis(page),
      new Promise<PatternMatchResult>((_, reject) =>
        setTimeout(() => reject(new Error("Analysis timed out after 60s")), ANALYSIS_TIMEOUT_MS),
      ),
    ]);
    return result;
  } catch (error) {
    console.error("[worker] Pattern matching failed:", {
      siteUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return zeroResult();
  }
}

// ---------------------------------------------------------------------------
// Internal analysis pipeline
// ---------------------------------------------------------------------------

async function runPatternAnalysis(page: Page): Promise<PatternMatchResult> {
  // Step 1: Find repeating structures (Task 1.3, Task 2)
  const groups = await findRepeatingStructures(page);

  if (groups.length === 0) {
    console.info("[worker] No repeating structures found on page");
    return zeroResult();
  }

  // Step 2: Classify fields in the best group (Task 1.4, Task 3)
  const bestGroup = groups[0]; // already sorted by score desc
  const classifications = await classifyFields(page, bestGroup);

  if (classifications.length === 0) {
    console.info("[worker] No fields classified in top repeating group");
    return zeroResult();
  }

  // Step 3: Build final field mappings (Task 1.5)
  const mappingsResult = buildFieldMappings(classifications);

  return {
    fieldMappings: mappingsResult.fieldMappings,
    confidenceScores: mappingsResult.confidenceScores,
    overallConfidence: calculateOverallConfidence(mappingsResult.confidenceScores),
    listingSelector: bestGroup.containerSelector,
    itemSelector: bestGroup.itemSelector,
    itemCount: bestGroup.count,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Find repeating structures  (Task 2)
// ---------------------------------------------------------------------------

async function findRepeatingStructures(page: Page): Promise<RepeatingGroup[]> {
  const candidates = await page.evaluate(() => {
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
        if (attr.name.startsWith("data-") && attr.value && attr.name !== "data-reactid") {
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

    /** Build a structural signature for an element (tag + stable classes) */
    function signature(el: Element): string {
      const stable = stableClasses(el);
      return `${el.tagName}${stable.length > 0 ? "." + stable.sort().join(".") : ""}`;
    }

    /** Score a set of sibling elements for how likely they are job listings */
    function calculateGroupScore(elements: Element[]): number {
      let score = 0;

      // Sample first 5 elements for scoring
      const sample = elements.slice(0, 5);

      // +2: each child has 3+ sub-elements
      const avgSubElements =
        sample.reduce((sum, el) => sum + el.children.length, 0) / sample.length;
      if (avgSubElements >= 3) score += 2;

      // +2: children contain <a> links
      const hasLinks = sample.some((el) => el.querySelector("a") !== null);
      if (hasLinks) score += 2;

      // +1: children contain heading elements
      const hasHeadings = sample.some(
        (el) => el.querySelector("h1, h2, h3, h4, h5, h6") !== null,
      );
      if (hasHeadings) score += 1;

      // +1: container has 5+ children
      if (elements.length >= 5) score += 1;

      // +3: children contain job-related keywords
      const jobKeywords = [
        "job",
        "position",
        "career",
        "vacancy",
        "opening",
        "role",
        "hiring",
        // Hebrew job terms
        "\u05DE\u05E9\u05E8\u05D4",
        "\u05E2\u05D1\u05D5\u05D3\u05D4",
        "\u05EA\u05E4\u05E7\u05D9\u05D3",
        "\u05D7\u05D1\u05E8\u05D4",
      ];
      const combinedText = sample
        .map((el) => (el.textContent || "").toLowerCase())
        .join(" ");
      const hasJobKeywords = jobKeywords.some((kw) => combinedText.includes(kw));
      if (hasJobKeywords) score += 3;

      // -2: navigation / footer / header items
      const containerTag = elements[0]?.parentElement?.tagName?.toLowerCase() || "";
      const containerClasses = (
        elements[0]?.parentElement?.className || ""
      ).toLowerCase();
      const isNav =
        containerTag === "nav" ||
        containerClasses.includes("nav") ||
        containerClasses.includes("footer") ||
        containerClasses.includes("header") ||
        containerClasses.includes("menu") ||
        containerClasses.includes("breadcrumb");
      if (isNav) score -= 2;

      // -1: very little text content per child
      const avgTextLen =
        sample.reduce((sum, el) => sum + (el.textContent || "").trim().length, 0) /
        sample.length;
      if (avgTextLen < 20) score -= 1;

      return score;
    }

    // ---- main logic ----

    const results: Array<{
      containerSelector: string;
      itemSelector: string;
      count: number;
      score: number;
    }> = [];

    const containers = document.querySelectorAll(
      "div, ul, ol, section, main, table > tbody, article",
    );

    for (const container of containers) {
      if (container.children.length < 3) continue;

      // Group children by structural signature
      const groups = new Map<string, Element[]>();
      for (const child of container.children) {
        const sig = signature(child);
        const arr = groups.get(sig) || [];
        arr.push(child);
        groups.set(sig, arr);
      }

      for (const [, elements] of groups) {
        if (elements.length < 3) continue;

        const score = calculateGroupScore(elements);
        // Only keep groups with positive score
        if (score <= 0) continue;

        results.push({
          containerSelector: generateSelector(container),
          itemSelector: generateSelector(elements[0]),
          count: elements.length,
          score,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Return top 5 candidates
    return results.slice(0, 5);
  });

  return candidates;
}

// ---------------------------------------------------------------------------
// Step 2: Classify fields  (Task 3)
// ---------------------------------------------------------------------------

async function classifyFields(
  page: Page,
  group: RepeatingGroup,
): Promise<FieldClassification[]> {
  const groupData = {
    containerSelector: group.containerSelector,
    itemSelector: group.itemSelector,
  };

  const classifications = await page.evaluate((gd) => {
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

    /** Filter out hash-based class names */
    function stableClasses(el: Element): string[] {
      return Array.from(el.classList).filter((c) => !isHashClass(c));
    }

    /** Generate a CSS selector for an element relative to a parent context */
    function relativeSelector(el: Element, contextEl: Element): string {
      // id-based
      if (el.id && /^[a-zA-Z]/.test(el.id) && !isHashClass(el.id)) {
        return `#${CSS.escape(el.id)}`;
      }

      // data-attribute based
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-") && attr.value && attr.name !== "data-reactid") {
          return `[${attr.name}="${CSS.escape(attr.value)}"]`;
        }
      }

      // tag + stable class
      const stable = stableClasses(el);
      const tag = el.tagName.toLowerCase();
      if (stable.length > 0) {
        return `${tag}.${stable.slice(0, 3).map((c) => CSS.escape(c)).join(".")}`;
      }

      // Build path from context element down
      const path: string[] = [];
      let current: Element | null = el;
      while (current && current !== contextEl) {
        const cur: Element = current;
        const parentEl = cur.parentElement;
        if (!parentEl) break;
        const siblings = Array.from(parentEl.children).filter(
          (s) => s.tagName === cur.tagName,
        );
        const curTag = cur.tagName.toLowerCase();
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          path.unshift(`${curTag}:nth-of-type(${idx})`);
        } else {
          path.unshift(curTag);
        }
        current = parentEl;
      }

      return path.join(" > ");
    }

    /**
     * Extract meaningful attribute text that hints at the element's semantic role.
     * Returns lowercase concatenation of class, id, aria-label, name, role, data-* attrs.
     */
    function semanticHints(el: Element): string {
      const parts: string[] = [];
      if (el.className && typeof el.className === "string") parts.push(el.className.toLowerCase());
      if (el.id) parts.push(el.id.toLowerCase());
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) parts.push(ariaLabel.toLowerCase());
      const role = el.getAttribute("role");
      if (role) parts.push(role.toLowerCase());
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-") && attr.value) {
          parts.push(attr.name.toLowerCase());
          parts.push(attr.value.toLowerCase());
        }
      }
      return parts.join(" ");
    }

    /** Hebrew city names for location detection */
    const hebrewCities = [
      "\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1",
      "\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD",
      "\u05D7\u05D9\u05E4\u05D4",
      "\u05D1\u05D0\u05E8 \u05E9\u05D1\u05E2",
      "\u05E8\u05DE\u05EA \u05D2\u05DF",
      "\u05E4\u05EA\u05D7 \u05EA\u05E7\u05D5\u05D5\u05D4",
      "\u05E0\u05EA\u05E0\u05D9\u05D4",
      "\u05D4\u05E8\u05E6\u05DC\u05D9\u05D4",
      "\u05E8\u05D0\u05E9\u05D5\u05DF \u05DC\u05E6\u05D9\u05D5\u05DF",
      "\u05D0\u05E9\u05D3\u05D5\u05D3",
      "\u05E8\u05D7\u05D5\u05D1\u05D5\u05EA",
    ];

    /** Check if text looks like a location */
    function isLocationText(text: string): boolean {
      const lower = text.toLowerCase();
      // English location patterns
      if (/\b(tel\s*aviv|jerusalem|haifa|israel|remote|hybrid)\b/i.test(text)) return true;
      // Hebrew cities
      for (const city of hebrewCities) {
        if (text.includes(city)) return true;
      }
      // Hebrew location keywords
      if (
        text.includes("\u05DE\u05D9\u05E7\u05D5\u05DD") ||
        text.includes("\u05D0\u05D6\u05D5\u05E8")
      )
        return true;
      // Common address patterns
      if (/\d{5,7}/.test(lower)) return false; // zip codes are numbers but not what we want
      return false;
    }

    /** Check if text looks like salary/compensation */
    function isSalaryText(text: string): boolean {
      // Currency patterns
      if (/[\u20AA$\u20AC\u00A3]/.test(text)) return true;
      // NIS / ILS / shekel
      if (/\b(nis|ils|shekel)\b/i.test(text)) return true;
      if (
        text.includes("\u05E9\"\u05D7") ||
        text.includes("\u05E9\u05E7\u05DC") ||
        text.includes("\u05DE\u05E9\u05DB\u05D5\u05E8\u05EA") ||
        text.includes("\u05E9\u05DB\u05E8")
      )
        return true;
      // Number ranges with commas/K
      if (/\d{1,3}([,\.]\d{3})+\s*[-\u2013]\s*\d{1,3}([,\.]\d{3})+/.test(text)) return true;
      if (/\d+[kK]\s*[-\u2013]\s*\d+[kK]/.test(text)) return true;
      return false;
    }

    // ---- main classification logic ----

    const container = document.querySelector(gd.containerSelector);
    if (!container) return [];

    // Find the repeating items by matching the item selector tag+class within the container
    const firstItem = container.querySelector(gd.itemSelector);
    if (!firstItem) return [];

    // Collect all sibling items that match the same tag and classes
    const itemTag = firstItem.tagName.toLowerCase();
    const itemStable = stableClasses(firstItem);
    let itemMatchSelector: string;
    if (itemStable.length > 0) {
      itemMatchSelector = `${itemTag}.${itemStable.slice(0, 3).map((c) => CSS.escape(c)).join(".")}`;
    } else {
      itemMatchSelector = `:scope > ${itemTag}`;
    }

    const allItems = container.querySelectorAll(itemMatchSelector);
    if (allItems.length === 0) return [];

    // Sample first 3 items for analysis
    const sampleItems = Array.from(allItems).slice(0, 3);

    // For each sample item, gather all descendant elements with text
    interface SubElementInfo {
      element: Element;
      tag: string;
      text: string;
      hints: string;
      textLength: number;
      isHeading: boolean;
      isLink: boolean;
      fontSize: number;
      position: number; // vertical position relative to item top
    }

    function getSubElements(item: Element): SubElementInfo[] {
      const result: SubElementInfo[] = [];
      const descendants = item.querySelectorAll("*");
      const itemRect = item.getBoundingClientRect();
      let idx = 0;

      for (const desc of descendants) {
        const text = (desc.textContent || "").trim();
        if (text.length === 0) continue;
        // Skip elements whose text is the same as a child element's text (avoid parent duplicates)
        const hasChildWithSameText = Array.from(desc.children).some(
          (c) => (c.textContent || "").trim() === text,
        );
        if (hasChildWithSameText && desc.children.length > 0) continue;

        const tag = desc.tagName.toLowerCase();
        const computed = window.getComputedStyle(desc);
        const fontSize = parseFloat(computed.fontSize) || 14;
        const rect = desc.getBoundingClientRect();

        result.push({
          element: desc,
          tag,
          text: text.substring(0, 200),
          hints: semanticHints(desc),
          textLength: text.length,
          isHeading: /^h[1-6]$/.test(tag),
          isLink: tag === "a",
          fontSize,
          position: rect.top - itemRect.top,
        });
        idx++;
        if (idx > 50) break; // limit elements per item
      }

      return result;
    }

    // Collect sub-elements from first sample item for classification
    const firstSample = sampleItems[0];
    const subElements = getSubElements(firstSample);

    if (subElements.length === 0) return [];

    const results: Array<{
      field: string;
      selector: string;
      sample: string;
      confidence: number;
    }> = [];

    // ---- Title detection (Task 3.2) ----
    {
      let bestEl: SubElementInfo | null = null;
      let bestScore = 0;

      for (const sub of subElements) {
        let score = 0;

        // Strong signals
        if (sub.isHeading) score += 0.35;
        if (sub.isLink && sub.textLength > 5) score += 0.25;
        if (/title|job[-_]?name|position[-_]?name|job[-_]?title/i.test(sub.hints)) score += 0.35;

        // Medium signals
        if (sub.fontSize >= 18) score += 0.15;
        if (sub.position < 50) score += 0.10; // near top of card

        // Weak signals
        if (sub.textLength > 10 && sub.textLength < 100) score += 0.05;

        // Negative signals
        if (sub.textLength > 200) score -= 0.20;
        if (sub.textLength < 5) score -= 0.30;

        if (score > bestScore) {
          bestScore = score;
          bestEl = sub;
        }
      }

      if (bestEl && bestScore > 0.1) {
        const confidence = Math.min(1.0, Math.max(0.0, bestScore));
        results.push({
          field: "title",
          selector: relativeSelector(bestEl.element, firstSample),
          sample: bestEl.text.substring(0, 100),
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }

    // ---- Company detection (Task 3.3) ----
    {
      let bestEl: SubElementInfo | null = null;
      let bestScore = 0;

      // Determine which element was chosen for title so we skip it
      const titleSelector = results.find((r) => r.field === "title")?.selector;

      for (const sub of subElements) {
        const sel = relativeSelector(sub.element, firstSample);
        if (sel === titleSelector) continue;

        let score = 0;

        // Strong signals
        if (/company|employer|org|firm|business|corp/i.test(sub.hints)) score += 0.40;
        // Hebrew company terms
        if (
          sub.hints.includes("\u05D7\u05D1\u05E8\u05D4") ||
          sub.hints.includes("\u05DE\u05E2\u05E1\u05D9\u05E7")
        )
          score += 0.35;

        // Medium signals -- secondary text near the top
        if (sub.position > 0 && sub.position < 80 && sub.textLength > 3 && sub.textLength < 80)
          score += 0.15;
        if (!sub.isHeading && !sub.isLink && sub.textLength < 60) score += 0.05;

        // Negative signals
        if (sub.textLength > 150) score -= 0.20;
        if (isSalaryText(sub.text)) score -= 0.40;
        if (isLocationText(sub.text)) score -= 0.30;

        if (score > bestScore) {
          bestScore = score;
          bestEl = sub;
        }
      }

      if (bestEl && bestScore > 0.1) {
        const confidence = Math.min(1.0, Math.max(0.0, bestScore));
        results.push({
          field: "company",
          selector: relativeSelector(bestEl.element, firstSample),
          sample: bestEl.text.substring(0, 100),
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }

    // ---- Location detection (Task 3.4) ----
    {
      let bestEl: SubElementInfo | null = null;
      let bestScore = 0;

      const usedSelectors = results.map((r) => r.selector);

      for (const sub of subElements) {
        const sel = relativeSelector(sub.element, firstSample);
        if (usedSelectors.includes(sel)) continue;

        let score = 0;

        // Strong signals
        if (/location|city|area|address|region|place/i.test(sub.hints)) score += 0.40;
        // Hebrew location keywords
        if (
          sub.hints.includes("\u05DE\u05D9\u05E7\u05D5\u05DD") ||
          sub.hints.includes("\u05D0\u05D6\u05D5\u05E8") ||
          sub.hints.includes("\u05E2\u05D9\u05E8")
        )
          score += 0.35;

        // Text content heuristics
        if (isLocationText(sub.text)) score += 0.30;

        // Icon sibling with location pin
        const prevSibling = sub.element.previousElementSibling;
        if (prevSibling) {
          const sibTag = prevSibling.tagName.toLowerCase();
          if (sibTag === "svg" || sibTag === "i" || sibTag === "img") score += 0.10;
        }

        // Medium signals
        if (sub.textLength > 2 && sub.textLength < 60) score += 0.05;

        // Negative signals
        if (sub.textLength > 150) score -= 0.20;
        if (isSalaryText(sub.text)) score -= 0.40;

        if (score > bestScore) {
          bestScore = score;
          bestEl = sub;
        }
      }

      if (bestEl && bestScore > 0.1) {
        const confidence = Math.min(1.0, Math.max(0.0, bestScore));
        results.push({
          field: "location",
          selector: relativeSelector(bestEl.element, firstSample),
          sample: bestEl.text.substring(0, 100),
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }

    // ---- Salary detection (Task 3.5) ----
    {
      let bestEl: SubElementInfo | null = null;
      let bestScore = 0;

      const usedSelectors = results.map((r) => r.selector);

      for (const sub of subElements) {
        const sel = relativeSelector(sub.element, firstSample);
        if (usedSelectors.includes(sel)) continue;

        let score = 0;

        // Strong signals
        if (/salary|pay|wage|compensation|price|cost/i.test(sub.hints)) score += 0.40;
        // Hebrew salary terms
        if (
          sub.hints.includes("\u05E9\u05DB\u05E8") ||
          sub.hints.includes("\u05DE\u05E9\u05DB\u05D5\u05E8\u05EA") ||
          sub.hints.includes("\u05E9\u05DB\u05D9\u05E8\u05D4")
        )
          score += 0.35;

        // Text content heuristics
        if (isSalaryText(sub.text)) score += 0.40;

        // Medium signals
        if (sub.textLength > 3 && sub.textLength < 40) score += 0.05;

        // Negative signals
        if (sub.textLength > 100) score -= 0.15;

        if (score > bestScore) {
          bestScore = score;
          bestEl = sub;
        }
      }

      if (bestEl && bestScore > 0.15) {
        const confidence = Math.min(1.0, Math.max(0.0, bestScore));
        results.push({
          field: "salary",
          selector: relativeSelector(bestEl.element, firstSample),
          sample: bestEl.text.substring(0, 100),
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }

    // ---- Description detection (Task 3.6) ----
    {
      let bestEl: SubElementInfo | null = null;
      let bestScore = 0;

      const usedSelectors = results.map((r) => r.selector);

      for (const sub of subElements) {
        const sel = relativeSelector(sub.element, firstSample);
        if (usedSelectors.includes(sel)) continue;

        let score = 0;

        // Strong signals
        if (/description|summary|details|about|excerpt|overview/i.test(sub.hints)) score += 0.40;

        // Hebrew
        if (
          sub.hints.includes("\u05EA\u05D9\u05D0\u05D5\u05E8") ||
          sub.hints.includes("\u05E4\u05D9\u05E8\u05D5\u05D8")
        )
          score += 0.30;

        // Longest text block (description tends to be the longest)
        if (sub.textLength > 80) score += 0.25;
        if (sub.tag === "p") score += 0.15;

        // Medium signals
        if (sub.textLength > 40 && sub.textLength < 500) score += 0.10;

        // Negative signals
        if (sub.textLength < 20) score -= 0.30;

        if (score > bestScore) {
          bestScore = score;
          bestEl = sub;
        }
      }

      if (bestEl && bestScore > 0.1) {
        const confidence = Math.min(1.0, Math.max(0.0, bestScore));
        results.push({
          field: "description",
          selector: relativeSelector(bestEl.element, firstSample),
          sample: bestEl.text.substring(0, 150),
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }

    return results;
  }, groupData);

  return classifications;
}

// ---------------------------------------------------------------------------
// Step 3: Build field mappings  (Task 1.5)
// ---------------------------------------------------------------------------

function buildFieldMappings(classifications: FieldClassification[]): {
  fieldMappings: Record<string, { selector: string; sample: string }>;
  confidenceScores: Record<string, number>;
} {
  const fieldMappings: Record<string, { selector: string; sample: string }> = {};
  const confidenceScores: Record<string, number> = {};

  for (const c of classifications) {
    // Only include fields with non-zero confidence (per story spec)
    if (c.confidence > 0) {
      fieldMappings[c.field] = {
        selector: c.selector,
        sample: c.sample,
      };
      confidenceScores[c.field] = c.confidence;
    }
  }

  return { fieldMappings, confidenceScores };
}

