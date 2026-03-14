# Story 2.3: Crawl/Classify Analysis Method

Status: done

## Story

As an admin,
I want the system to crawl and classify page content to identify job listings,
So that sites with non-standard layouts can still be analyzed for field mappings.

## Acceptance Criteria

1. **Given** a site URL has been submitted and the analysis job is running **When** the crawl/classify method runs **Then** Playwright navigates the site, identifies the jobs listing page, and classifies content blocks by their semantic role (job title, company name, location, etc.)

2. **Given** the crawl/classify analysis executes **When** content classification completes **Then** the system produces field mappings with CSS selectors and per-field confidence scores based on content classification heuristics (text patterns, element positioning, label proximity)

3. **Given** the crawl/classify analysis completes **When** results are produced **Then** an AnalysisResult record is created with method `CRAWL_CLASSIFY`, the detected field mappings, per-field confidence scores, and the overall method confidence **And** the analysis result is stored in the database linked to the site

4. **Given** the target site has dynamic content loaded via JavaScript **When** crawl/classify analysis runs **Then** Playwright waits for dynamic content to render before classifying (using networkidle or DOM stability checks)

5. **Given** the target site fails to load or the crawler encounters an error **When** crawl/classify analysis runs **Then** the method returns a partial result with zero confidence rather than failing the entire pipeline (NFR10) **And** the error is logged with context but does NOT throw an exception up to the caller

6. **Given** the analysis method is implemented **When** I inspect the codebase **Then** the crawl/classify logic is in `worker/analysis/crawlClassify.ts` **And** `worker/jobs/analyze.ts` is updated to call BOTH the pattern matching method AND the crawl/classify method, storing results for each

## Tasks / Subtasks

- [x] Task 1: Create the crawl/classify analysis module (AC: #1, #2, #3, #6)
  - [x] 1.1: Create file `worker/analysis/crawlClassify.ts`
  - [x] 1.2: Implement `analyzeWithCrawlClassify(page: Page, siteUrl: string): Promise<CrawlClassifyResult>` function as the public entry point
  - [x] 1.3: Implement `runCrawlClassifyAnalysis(page: Page, siteUrl: string): Promise<CrawlClassifyResult>` internal pipeline function
  - [x] 1.4: Export the `CrawlClassifyResult` interface (same shape as `PatternMatchResult` for consistency)

- [x] Task 2: Implement page crawling and link discovery (AC: #1, #4)
  - [x] 2.1: Implement `discoverJobsPage(page: Page, siteUrl: string): Promise<DiscoveredPage>` to detect whether the current page is a job listing page or if internal links lead to one
  - [x] 2.2: Extract all internal links from the current page and score them for job-listing likelihood based on URL patterns (e.g., `/jobs`, `/careers`, `/positions`, `/vacancies`, Hebrew equivalents: `/משרות`, `/דרושים`)
  - [x] 2.3: If the current page does NOT appear to be a job listing page (few repeating structures, no job keywords), navigate to the highest-scoring internal link (up to 2 hops max) to find the actual listings page
  - [x] 2.4: Wait for dynamic content to load after each navigation using `page.waitForLoadState("networkidle")` with a 15-second timeout per page (AC #4)
  - [x] 2.5: Return the final page URL and a flag indicating whether crawling was needed

- [x] Task 3: Implement semantic content classification (AC: #2)
  - [x] 3.1: Implement `classifyContentBlocks(page: Page): Promise<ContentBlock[]>` to break the page into semantic blocks based on DOM hierarchy and visual layout
  - [x] 3.2: For each content block, analyze text content, element attributes, surrounding context, and label proximity to classify as: job_title, company_name, location, salary, description, date_posted, job_type, or unknown
  - [x] 3.3: Use label proximity heuristics: look for label elements, headings, or descriptive text within 50px vertical distance of data elements. If a label says "Company:" or "חברה:" and the adjacent element contains text, classify that element as company_name
  - [x] 3.4: Use text pattern heuristics: analyze the actual text content to infer type -- currency patterns for salary, city names for location, short descriptive phrases for title, long paragraphs for description
  - [x] 3.5: Use structural heuristics: elements in list/table/grid patterns that repeat with similar structure are likely listing items; classify their sub-elements based on position within the repeating unit

- [x] Task 4: Implement link-text and anchor analysis (AC: #1, #2)
  - [x] 4.1: Implement `analyzeLinks(page: Page): Promise<LinkAnalysis[]>` to identify links that point to individual job detail pages
  - [x] 4.2: Score links by: URL containing job-related path segments, link text length (typical job titles are 5-80 chars), link density within a repeating container, and whether the link's parent has sibling data elements (company, location)
  - [x] 4.3: Use link structure to infer the listing page layout -- if many links in a container point to similar URL patterns (e.g., `/jobs/123`, `/jobs/456`), classify the container as a job listings section
  - [x] 4.4: Extract detail page URL pattern from discovered links for future use in scraping navigation flow

- [x] Task 5: Build field mappings from classified content (AC: #2, #3)
  - [x] 5.1: Implement `buildCrawlClassifyMappings(blocks: ContentBlock[], page: Page): CrawlClassifyResult` to convert classified content blocks into the standard field mapping format
  - [x] 5.2: For each classified block, generate a stable CSS selector (reuse the same `generateSelector` / `relativeSelector` pattern from patternMatch.ts, duplicated inside `page.evaluate()`)
  - [x] 5.3: Calculate per-field confidence scores based on classification strength: strong label match = 0.8+, text pattern match = 0.6-0.8, positional guess = 0.3-0.5
  - [x] 5.4: Calculate overall confidence using the same weighted formula as pattern matching (title: 0.40, company: 0.30, location: 0.30, with optional bonus for salary/description)
  - [x] 5.5: Include `listingSelector`, `itemSelector`, `itemCount`, and `detailPagePattern` in the result

- [x] Task 6: Handle error resilience and timeouts (AC: #5)
  - [x] 6.1: Wrap the entire `analyzeWithCrawlClassify()` function body in try/catch -- NEVER throw to caller
  - [x] 6.2: On any error, log with `[worker] Crawl/classify failed:` prefix and return a zero-confidence result
  - [x] 6.3: Set a per-method analysis timeout of 90 seconds using `Promise.race` (crawl/classify is allowed more time than pattern matching since it may navigate to additional pages)
  - [x] 6.4: Handle pages with no classifiable content gracefully (return zero-confidence result, not an error)
  - [x] 6.5: Handle navigation failures during crawling (failed link follow) gracefully -- fall back to analyzing the original page

- [x] Task 7: Define TypeScript types for crawl/classify (AC: #2, #3)
  - [x] 7.1: Define `CrawlClassifyResult` interface (identical shape to `PatternMatchResult` plus optional `detailPagePattern: string | null`):
    ```typescript
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
    ```
  - [x] 7.2: Define `ContentBlock` interface for classified content blocks
  - [x] 7.3: Define `DiscoveredPage` interface for page crawling results
  - [x] 7.4: Define `LinkAnalysis` interface for link scoring results

- [x] Task 8: Update the analysis job handler to run both methods (AC: #6)
  - [x] 8.1: Modify `worker/jobs/analyze.ts` to import `analyzeWithCrawlClassify` from `../analysis/crawlClassify`
  - [x] 8.2: After the existing pattern matching call, call `analyzeWithCrawlClassify(page, site.siteUrl)` using the **same page instance** (do NOT create a new browser -- reuse the existing one)
  - [x] 8.3: Create a second `AnalysisResult` record with method `CRAWL_CLASSIFY` and the crawl/classify results
  - [x] 8.4: Update the site's `confidenceScore` to the **maximum** of pattern matching and crawl/classify confidence (interim logic -- story 2-5 will implement the proper combination)
  - [x] 8.5: Update the WorkerJob `result` JSON to include results from both methods
  - [x] 8.6: Navigate the page back to the original `site.siteUrl` before running crawl/classify (since pattern matching may not have navigated away, but for safety, ensure we start from the original URL)

- [x] Task 9: Verify build, lint, and end-to-end functionality (AC: #1-6)
  - [x] 9.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x] 9.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x] 9.3: Start the Next.js dev server (`pnpm dev`) and worker (`pnpm worker:dev`)
  - [x] 9.4: Submit a real job site URL and verify the worker runs BOTH pattern matching AND crawl/classify
  - [x] 9.5: Check the database -- verify TWO AnalysisResult records are created for the site (one PATTERN_MATCH, one CRAWL_CLASSIFY)
  - [x] 9.6: Submit an unreachable URL and verify both methods return zero-confidence without crashing the worker
  - [x] 9.7: Submit a URL for a non-job-listing page and verify the crawl/classify method attempts crawling (follows links) and either finds a jobs page or returns low/zero confidence gracefully

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Import enums from `@/generated/prisma/enums`. Requires driver adapter. Generator output is `../src/generated/prisma`.
- **Worker accesses Prisma directly** -- the worker does NOT call API routes. It imports `prisma` from `@/lib/prisma` and reads/writes the database directly.
- **Logging convention**: All worker logs use `[worker]` prefix. Use `console.info`, `console.warn`, `console.error` with structured data objects.

### What This Story Changes

This story adds a **second analysis method** (`CRAWL_CLASSIFY`) to the analysis pipeline. After story 2-2 implemented pattern matching, the analysis job handler (`worker/jobs/analyze.ts`) now runs a real pattern matching analysis. This story extends it to also run crawl/classify.

**Before (current state after story 2-2):**
1. Launch Playwright, navigate to the URL
2. Run pattern matching analysis (real implementation)
3. Create ONE AnalysisResult record (method: PATTERN_MATCH)
4. Update site status to REVIEW with pattern matching confidence

**After this story:**
1. Launch Playwright, navigate to the URL
2. Run pattern matching analysis (existing code, unchanged)
3. Create AnalysisResult record for PATTERN_MATCH (existing code, unchanged)
4. Navigate back to original URL (safety measure)
5. Run crawl/classify analysis (NEW code)
6. Create AnalysisResult record for CRAWL_CLASSIFY (NEW code)
7. Update site status to REVIEW with the MAX confidence from both methods (interim logic)

### How Crawl/Classify Differs from Pattern Matching

The two analysis methods take fundamentally different approaches:

| Aspect | Pattern Matching (2-2) | Crawl/Classify (2-3) |
|--------|----------------------|---------------------|
| Strategy | Find repeating DOM structures and classify sub-elements | Crawl the site to find the right page, then classify content semantically |
| Page navigation | Stays on the submitted URL | May follow links to find the actual job listing page |
| Classification | Positional (top of card = title, secondary = company) | Semantic (label proximity, text patterns, content analysis) |
| Strength | Good for well-structured pages with clear repeating patterns | Good for non-standard layouts, JavaScript-heavy sites, sites where the submitted URL is a homepage not a listing page |
| Weakness | Fails on pages without clear repeating structure | Slower (may need multiple page loads), more complex logic |
| Timeout | 60 seconds | 90 seconds (needs time for crawling) |

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Prisma client singleton | `src/lib/prisma.ts` | Import: `import { prisma } from "@/lib/prisma"` |
| Playwright utilities | `worker/lib/playwright.ts` | `launchBrowser()`, `createPage(browser)`, `closeBrowser(browser)` |
| Pattern matching module | `worker/analysis/patternMatch.ts` | `PatternMatchResult` interface, `calculateOverallConfidence()` function. The crawl/classify module should use the same confidence formula. **Copy `calculateOverallConfidence()` into crawlClassify.ts** (or extract to shared helper -- dev's choice) |
| Analysis job handler | `worker/jobs/analyze.ts` | MODIFY -- add crawl/classify call after pattern matching |
| Worker entry point | `worker/index.ts` | DO NOT MODIFY |
| Job dispatcher | `worker/jobDispatcher.ts` | DO NOT MODIFY |
| Error classes | `src/lib/errors.ts` | `AppError`, `NotFoundError`, `ConflictError` etc. |
| Constants | `src/lib/constants.ts` | `CONFIDENCE_THRESHOLD = 70`, `ANALYSIS_METHOD_LABELS` |
| Types | `src/lib/types.ts` | `FieldMapping`, `FieldType`, `SiteConfig` |

### Prisma Model Reference (AnalysisResult)

```prisma
model AnalysisResult {
  id                String         @id @default(cuid())
  siteId            String
  site              Site           @relation(fields: [siteId], references: [id])
  method            AnalysisMethod
  fieldMappings     Json           // { title: { selector: "h2.job-title", sample: "Senior Developer" }, ... }
  confidenceScores  Json           // { title: 0.85, company: 0.72, location: 0.60, ... }
  overallConfidence Float          // 0.0 to 1.0 (as decimal, NOT percentage)
  apiEndpoint       String?        // Not used by CRAWL_CLASSIFY, used by NETWORK_INTERCEPT
  createdAt         DateTime       @default(now())

  @@index([siteId])
}

enum AnalysisMethod {
  PATTERN_MATCH
  CRAWL_CLASSIFY
  NETWORK_INTERCEPT
}
```

**IMPORTANT:** `overallConfidence` is stored as a **decimal (0.0 to 1.0)**, NOT a percentage. The `CONFIDENCE_THRESHOLD` constant is 70 (percentage). When comparing, multiply: `overallConfidence * 100 >= CONFIDENCE_THRESHOLD`. However, the `site.confidenceScore` field stores the value as a decimal 0.0-1.0 for consistency.

### fieldMappings JSON Structure

Same structure as pattern matching (must be consistent for story 2-5 combination):

```typescript
{
  "title": {
    "selector": "h2.job-title a",
    "sample": "Senior Software Developer"
  },
  "company": {
    "selector": ".company-name span",
    "sample": "Microsoft Israel"
  },
  "location": {
    "selector": ".job-location",
    "sample": "Tel Aviv"
  },
  "salary": {
    "selector": ".salary-range",
    "sample": "25,000 - 35,000 ILS"
  },
  "description": {
    "selector": ".job-description p",
    "sample": "We are looking for an experienced..."
  }
}
```

### Algorithm Design: Crawl/Classify

The crawl/classify analysis follows this pipeline:

#### Step 1: Discover the Job Listings Page

The submitted URL might be a homepage, an "about" page, or any page on a job site. The crawler needs to find the actual job listings page.

```typescript
async function discoverJobsPage(page: Page, siteUrl: string): Promise<DiscoveredPage> {
  // 1. Check if the current page already has job-listing characteristics
  //    (repeating structures, job keywords in headings, multiple job links)
  const isJobsPage = await evaluateJobsPageLikelihood(page);

  if (isJobsPage.score >= 0.6) {
    return { url: siteUrl, crawled: false, hops: 0 };
  }

  // 2. Extract and score internal links
  const links = await extractAndScoreLinks(page, siteUrl);

  // 3. Navigate to the best candidate (max 2 hops)
  for (const link of links.slice(0, 3)) {
    try {
      await page.goto(link.url, { waitUntil: "networkidle", timeout: 15_000 });
      const checkResult = await evaluateJobsPageLikelihood(page);

      if (checkResult.score >= 0.5) {
        return { url: link.url, crawled: true, hops: 1 };
      }
    } catch {
      // Navigation to this link failed -- try next candidate
      continue;
    }
  }

  // 4. If no good page found, return to original URL and analyze it anyway
  try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch {
    // Could not return -- continue with whatever page we're on
  }
  return { url: siteUrl, crawled: true, hops: 0 };
}
```

**Link scoring heuristics for job page discovery:**
- +5 points: URL path contains `/jobs`, `/careers`, `/positions`, `/vacancies`, `/openings`, `/hiring`
- +5 points: URL path contains Hebrew job terms: `/משרות`, `/דרושים`, `/קריירה`
- +3 points: Link text contains job-related words: "Jobs", "Careers", "Positions", "משרות", "דרושים"
- +2 points: Link is in the main navigation or header area
- +1 point: Link is prominently positioned (within first 500px vertical)
- -3 points: URL contains `/about`, `/contact`, `/login`, `/register`, `/blog`, `/news`
- -2 points: Link is in footer area (> 80% down the page)

#### Step 2: Classify Content Blocks Semantically

Unlike pattern matching which looks for repeating structures first and then classifies sub-elements, crawl/classify treats each visible text element as a candidate and classifies it based on content analysis:

```typescript
async function classifyContentBlocks(page: Page): Promise<ContentBlock[]> {
  return page.evaluate(() => {
    // Get all visible text-containing elements
    const elements = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, dd, dt, label, div, strong, em, b, i"
    );

    const blocks: ContentBlock[] = [];

    for (const el of elements) {
      const text = (el.textContent || "").trim();
      if (text.length === 0 || text.length > 500) continue;

      // Skip elements whose text is identical to a child's text (avoid double-counting)
      const hasChildWithSameText = Array.from(el.children).some(
        c => (c.textContent || "").trim() === text
      );
      if (hasChildWithSameText && el.children.length > 0) continue;

      // Classify this block based on multiple heuristic signals
      const classification = classifyBlock(el, text);

      blocks.push({
        element: el,
        text,
        classification: classification.type,
        confidence: classification.confidence,
        selector: generateSelector(el),
      });
    }

    return blocks;
  });
}
```

**Classification heuristics (label proximity + text patterns + element attributes):**

For **job_title**:
- Label proximity: preceding element or aria-label contains "title", "position", "role", "תפקיד", "משרה"
- Text pattern: 5-80 characters, no currency symbols, no city names, reads like a job title
- Element: heading element (h1-h6), or link (`<a>`) with job-related href
- Confidence: 0.85 for label + pattern match, 0.65 for pattern only, 0.45 for positional guess

For **company_name**:
- Label proximity: preceding element contains "company", "employer", "organization", "חברה", "מעסיק"
- Text pattern: 3-60 characters, capitalized words, no numbers (unless "Tech Ltd" style)
- Element: not a heading, not the longest text block
- Confidence: 0.80 for label match, 0.55 for pattern only

For **location**:
- Label proximity: preceding element contains "location", "city", "area", "מיקום", "אזור"
- Text pattern: contains known city names (Hebrew or English), or "Remote"/"Hybrid"/"היברידי"
- Element: often near an icon (SVG, i, img sibling)
- Confidence: 0.85 for label + city match, 0.65 for city name match only

For **salary**:
- Label proximity: preceding element contains "salary", "pay", "compensation", "שכר", "משכורת"
- Text pattern: contains currency symbols (₪, $, €, £), number ranges, "NIS", "ILS", "ש"ח"
- Confidence: 0.90 for label + currency pattern, 0.70 for currency pattern only

For **description**:
- Label proximity: preceding element contains "description", "details", "about", "תיאור", "פירוט"
- Text pattern: 80+ characters, sentence structure, paragraph content
- Element: `<p>`, `<div>` with substantial text
- Confidence: 0.75 for label + long text, 0.50 for longest text block

#### Step 3: Group Classified Blocks into Listing Items

After classifying individual blocks, group them into job listing items by proximity and container analysis:

```typescript
function groupIntoListings(blocks: ContentBlock[]): ListingGroup[] {
  // 1. Find blocks that are siblings or share a common parent container
  // 2. A valid listing item should have at least a title
  // 3. Group by common ancestor -- blocks sharing a close ancestor form one listing
  // 4. Multiple listing groups with similar structure = confirmed job listing page
}
```

### Current analyze.ts That Needs Modification

The current `worker/jobs/analyze.ts` runs pattern matching and creates an AnalysisResult. It needs to be extended to also run crawl/classify:

**CURRENT (after story 2-2):**
```typescript
// Run pattern matching analysis
const patternResult = await analyzeWithPatternMatching(page, site.siteUrl);

// Create AnalysisResult with pattern match data
await prisma.analysisResult.create({
  data: {
    siteId: site.id,
    method: "PATTERN_MATCH",
    fieldMappings: patternResult.fieldMappings,
    confidenceScores: patternResult.confidenceScores,
    overallConfidence: patternResult.overallConfidence,
  },
});

// Update site status based on pattern matching confidence
await prisma.site.update({
  where: { id: site.id },
  data: {
    status: "REVIEW",
    reviewAt: new Date(),
    confidenceScore: patternResult.overallConfidence,
  },
});
```

**AFTER (with crawl/classify added):**
```typescript
import { analyzeWithPatternMatching } from "../analysis/patternMatch";
import { analyzeWithCrawlClassify } from "../analysis/crawlClassify";

// --- Run pattern matching analysis ---
const patternResult = await analyzeWithPatternMatching(page, site.siteUrl);

console.info("[worker] Pattern matching complete:", {
  siteUrl: site.siteUrl,
  overallConfidence: patternResult.overallConfidence,
  fieldsDetected: Object.keys(patternResult.fieldMappings),
  itemCount: patternResult.itemCount,
});

await prisma.analysisResult.create({
  data: {
    siteId: site.id,
    method: "PATTERN_MATCH",
    fieldMappings: patternResult.fieldMappings,
    confidenceScores: patternResult.confidenceScores,
    overallConfidence: patternResult.overallConfidence,
  },
});

// --- Navigate back to original URL before crawl/classify ---
try {
  await page.goto(site.siteUrl, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
} catch (navError) {
  console.warn("[worker] Failed to navigate back for crawl/classify:", {
    siteUrl: site.siteUrl,
    error: navError instanceof Error ? navError.message : String(navError),
  });
  // Continue anyway -- crawl/classify will handle its own navigation
}

// --- Run crawl/classify analysis ---
const crawlResult = await analyzeWithCrawlClassify(page, site.siteUrl);

console.info("[worker] Crawl/classify complete:", {
  siteUrl: site.siteUrl,
  overallConfidence: crawlResult.overallConfidence,
  fieldsDetected: Object.keys(crawlResult.fieldMappings),
  crawledPages: crawlResult.crawledPages,
});

await prisma.analysisResult.create({
  data: {
    siteId: site.id,
    method: "CRAWL_CLASSIFY",
    fieldMappings: crawlResult.fieldMappings,
    confidenceScores: crawlResult.confidenceScores,
    overallConfidence: crawlResult.overallConfidence,
  },
});

// --- Update site with best confidence from either method ---
const bestConfidence = Math.max(
  patternResult.overallConfidence,
  crawlResult.overallConfidence
);

await prisma.site.update({
  where: { id: site.id },
  data: {
    status: "REVIEW",
    reviewAt: new Date(),
    confidenceScore: bestConfidence,
  },
});

console.info(`[worker] Analysis complete for site: ${site.siteUrl} (best confidence: ${bestConfidence})`);

return {
  pageTitle,
  methods: {
    patternMatch: {
      confidence: patternResult.overallConfidence,
      fieldsDetected: Object.keys(patternResult.fieldMappings),
      itemCount: patternResult.itemCount,
    },
    crawlClassify: {
      confidence: crawlResult.overallConfidence,
      fieldsDetected: Object.keys(crawlResult.fieldMappings),
      crawledPages: crawlResult.crawledPages,
      detailPagePattern: crawlResult.detailPagePattern,
    },
  },
  bestConfidence,
};
```

### Navigation Failure Handling in analyze.ts

The existing navigation failure block in `analyze.ts` creates a PATTERN_MATCH result with zero confidence and marks the site as FAILED. This block should be updated to create BOTH a PATTERN_MATCH and a CRAWL_CLASSIFY result with zero confidence (since if the initial navigation fails, neither method can run):

```typescript
// In the catch(navError) block, after the existing PATTERN_MATCH result:
await prisma.analysisResult.create({
  data: {
    siteId: site.id,
    method: "CRAWL_CLASSIFY",
    fieldMappings: {},
    confidenceScores: {},
    overallConfidence: 0.0,
  },
});
```

### Implementation Guidance: page.evaluate()

Same rules as pattern matching apply:
- All DOM analysis must run inside `page.evaluate()` to execute in the browser context
- Helper functions used inside `page.evaluate()` must be defined INSIDE the evaluate callback
- Cannot reference Node.js variables or imports from inside `page.evaluate()`
- Pass data in via the second argument: `page.evaluate((data) => { ... }, dataToPass)`
- Return plain JSON-serializable objects only

### Key Difference: Page Navigation

Unlike pattern matching which only analyzes the submitted URL's page, crawl/classify may **navigate to different pages** during analysis. This means:

1. The `page` object's current URL may change during `analyzeWithCrawlClassify()`
2. Any `page.evaluate()` calls after navigation will see the NEW page's DOM
3. After crawl/classify completes, the page may be on a different URL than where it started
4. The caller (`analyze.ts`) should navigate back to the original URL before calling crawl/classify (Task 8.6) to give crawl/classify a clean starting point

### Reusing the Page Instance

Both analysis methods should use the **same Playwright page instance** to avoid launching multiple browsers. The page is created once in `analyze.ts` and passed to both methods:

```typescript
// In analyze.ts:
browser = await launchBrowser();
const { page } = await createPage(browser);

// Navigate to URL
await page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

// Pass the same page to both methods
const patternResult = await analyzeWithPatternMatching(page, site.siteUrl);
// ... navigate back ...
const crawlResult = await analyzeWithCrawlClassify(page, site.siteUrl);
```

### Overall Confidence Calculation

Use the **same formula** as pattern matching to ensure consistency across methods (story 2-5 depends on consistent scoring):

```typescript
function calculateOverallConfidence(scores: Record<string, number>): number {
  const coreWeights: Record<string, number> = {
    title: 0.40,      // Title is the most important field
    company: 0.30,    // Company is critical
    location: 0.30,   // Location is critical
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [field, weight] of Object.entries(coreWeights)) {
    const score = scores[field] || 0;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  let overall = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Bonus for optional fields (up to 0.10 additional)
  const optionalBonus =
    ((scores.salary || 0) * 0.05) +
    ((scores.description || 0) * 0.05);
  overall = Math.min(1.0, overall + optionalBonus);

  return Math.round(overall * 100) / 100; // Round to 2 decimal places
}
```

**Dev choice:** Either copy this function into `crawlClassify.ts` or extract it into a shared utility (e.g., `worker/lib/confidence.ts`). If extracting, also update `patternMatch.ts` to import from the shared location. Note that story 2-5 plans to create `worker/lib/confidence.ts` anyway, so extracting now is a reasonable forward step.

### Hebrew Content Considerations

Same Hebrew content patterns as pattern matching apply. Additionally, crawl/classify should recognize Hebrew link text when discovering the job listings page:

**Navigation link text:**
- "משרות" (positions), "דרושים" (wanted/hiring), "קריירה" (career), "עבודות" (jobs)
- "כל המשרות" (all positions), "חיפוש משרות" (search positions)

**Label text for classification:**
- "תפקיד" or "שם המשרה" (title/position name)
- "חברה" or "מעסיק" (company/employer)
- "מיקום" or "עיר" or "אזור" (location/city/area)
- "שכר" or "משכורת" or "שכר ברוטו" (salary/wages/gross salary)
- "תיאור" or "תיאור המשרה" or "פירוט" (description/details)

### Error Handling Strategy

Identical to pattern matching -- crawl/classify should NEVER throw an exception up to the caller:

```typescript
export async function analyzeWithCrawlClassify(
  page: Page,
  siteUrl: string,
): Promise<CrawlClassifyResult> {
  try {
    const result = await Promise.race<CrawlClassifyResult>([
      runCrawlClassifyAnalysis(page, siteUrl),
      new Promise<CrawlClassifyResult>((_, reject) =>
        setTimeout(() => reject(new Error("Crawl/classify timed out after 90s")), 90_000),
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
```

### File Structure After This Story

```
worker/
  index.ts                    # UNCHANGED -- poll loop entry point
  jobDispatcher.ts            # UNCHANGED -- routes jobs to handlers
  jobs/
    analyze.ts                # MODIFIED -- calls BOTH patternMatch AND crawlClassify
  analysis/
    patternMatch.ts           # UNCHANGED -- pattern matching analysis (story 2-2)
    crawlClassify.ts          # NEW -- crawl/classify analysis logic
  lib/
    playwright.ts             # UNCHANGED -- Playwright browser utilities
```

### CSS Selector Generation Strategy

Use the **same selector generation approach** as pattern matching for consistency. The CSS selectors generated by crawl/classify will be compared/merged with pattern matching selectors in story 2-5. Key rules:

1. **Prefer semantic selectors**: `.job-title`, `[data-role="company"]`, `h2 > a`
2. **Avoid fragile selectors**: `:nth-child(3) > div:nth-child(2) > span`
3. **Avoid hash-based class names**: `.css-1a2b3c`, `.sc-abcdef` (CSS-in-JS generated)
4. **Test selector validity**: Use `document.querySelector(selector)` to verify
5. **Generate relative selectors**: Relative to the listing item container

Hash class detection patterns (same as patternMatch.ts):
- `/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/` (e.g., `sc-1a2b3c`)
- `/^css-[a-zA-Z0-9]+$/` (e.g., `css-abcdef`)
- `/^[A-Z][a-zA-Z]+__[a-zA-Z]+-[a-zA-Z0-9]+$/` (CSS modules)

### Anti-Patterns to AVOID

- Do NOT put the crawl/classify logic in `worker/jobs/analyze.ts` -- create a separate `worker/analysis/crawlClassify.ts` module
- Do NOT modify `worker/index.ts` or `worker/jobDispatcher.ts` -- these are stable infrastructure from story 2-1
- Do NOT modify `worker/lib/playwright.ts` -- it already has the utilities needed
- Do NOT modify `worker/analysis/patternMatch.ts` -- it is complete from story 2-2 (unless extracting `calculateOverallConfidence` to shared utility)
- Do NOT use `any` type -- define proper TypeScript interfaces for all intermediate data
- Do NOT use `page.$()` or `page.$$()` for bulk DOM analysis -- use `page.evaluate()` for performance
- Do NOT reference Node.js variables inside `page.evaluate()` callbacks -- they run in browser context
- Do NOT throw exceptions from `analyzeWithCrawlClassify()` -- always return a result (NFR10)
- Do NOT hardcode CSS selectors for specific job sites -- the analysis must be generic
- Do NOT use `innerHTML` for text extraction -- use `textContent` or `innerText`
- Do NOT process more than 100 elements in detail -- use sampling for classification
- Do NOT install any new npm packages -- Playwright and all needed dependencies are already installed
- Do NOT import from `@prisma/client` -- import from `@/generated/prisma/client`
- Do NOT forget that `page.evaluate()` callbacks cannot use closures over Node.js variables
- Do NOT create a new browser/page for crawl/classify -- reuse the one from analyze.ts
- Do NOT navigate to more than 3 pages total (original + 2 hops) during crawling -- keep the method fast
- Do NOT use `page.waitForNavigation()` (deprecated) -- use `page.goto()` which handles navigation internally
- Do NOT forget to handle the case where crawling follows a link but the resulting page is not a job listing page -- fall back gracefully

### Previous Story Learnings (from Stories 1-1 through 2-2)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy` (not `middleware`).
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path configured in schema.prisma generator block. Enums from `@/generated/prisma/enums`.
3. **Prisma 7.4 requires driver adapter** -- PrismaPg driver adapter. Uses `@prisma/adapter-pg` + `pg` pool.
4. **`sonner` is used for toasts** -- `toast.success()`, `toast.error()`. Already mounted in root layout.
5. **shadcn/ui v4 uses Base UI** (NOT Radix).
6. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
7. **Always run `pnpm build`** before marking story as done.
8. **Services layer pattern established** -- `src/services/siteService.ts` has all site CRUD.
9. **Worker accesses Prisma directly** -- does NOT call API routes.
10. **`tsx` for development** -- worker runs via `npx tsx --watch worker/index.ts`.
11. **ESLint `no-explicit-any`** -- avoid `any` from the start.
12. **`dotenv` imported at top of `worker/index.ts`** -- env vars available to all worker modules.
13. **Worker creates WorkerJob on re-analyze** -- story 1-4 already creates WorkerJob when `updateSiteStatus()` transitions to ANALYZING.
14. **Browser cleanup in finally block** -- `closeBrowser()` called in finally, browser variable declared outside try block.
15. **Navigation failure handling** -- already handled in `analyze.ts` with try/catch around `page.goto()`.
16. **Confidence stored as decimal 0.0-1.0** -- NOT as percentage 0-100.
17. **Existing analysis results for a site**: When a site is re-analyzed, a NEW AnalysisResult record is created alongside any existing ones. The system does not delete old results. Story 2-5 will handle combining results.
18. **page.evaluate() helper duplication**: All helper functions used inside `page.evaluate()` must be defined INSIDE the evaluate callback. They cannot reference outer Node.js scope. This means some helper functions (like `isHashClass`, `stableClasses`, `generateSelector`) will be duplicated between patternMatch.ts and crawlClassify.ts. This is intentional and required by the Playwright API.
19. **Pattern matching creates PatternMatchResult interface** with: `fieldMappings`, `confidenceScores`, `overallConfidence`, `listingSelector`, `itemSelector`, `itemCount`. Crawl/classify should use a compatible interface.
20. **analyze.ts currently does NOT navigate back** after pattern matching -- the page may still be on the original URL or may have been scrolled/interacted with by page.evaluate(). For safety, navigate back before crawl/classify.

### Project Structure Notes

- `worker/analysis/crawlClassify.ts` aligns with the planned file in the architecture: `worker/analysis/crawlClassify.ts`
- Story 2-4 will add `worker/analysis/networkIntercept.ts` following the same pattern
- Story 2-5 will add `worker/analysis/combineResults.ts` and `worker/lib/confidence.ts` to merge all three methods
- If `calculateOverallConfidence()` is extracted to `worker/lib/confidence.ts` in this story, that is a forward-looking optimization that aligns with the 2-5 plan

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. `worker/analysis/crawlClassify.ts` exists and exports `analyzeWithCrawlClassify()`
4. `worker/analysis/crawlClassify.ts` exports `CrawlClassifyResult` interface
5. `worker/jobs/analyze.ts` calls both `analyzeWithPatternMatching()` AND `analyzeWithCrawlClassify()`
6. Worker starts with `pnpm worker:dev` and processes analysis jobs
7. Submitting a real job site URL produces TWO AnalysisResult records (one PATTERN_MATCH, one CRAWL_CLASSIFY)
8. Both AnalysisResult records have non-empty `fieldMappings` (where fields were detected)
9. Both AnalysisResult records have appropriate `confidenceScores` and `overallConfidence` values
10. Site `confidenceScore` is set to the MAX of both methods' confidence
11. Submitting an unreachable URL returns two zero-confidence results WITHOUT crashing the worker
12. Submitting a non-job page triggers crawling attempt and completes gracefully
13. The worker continues polling and processing after any individual analysis succeeds or fails
14. No browser processes left hanging after job completion
15. No `any` types used in the codebase (eslint enforced)
16. No new npm packages installed (all dependencies already available)
17. Navigation failure block in analyze.ts creates BOTH PATTERN_MATCH and CRAWL_CLASSIFY zero-confidence results

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3: Crawl/Classify Analysis Method]
- [Source: _bmad-output/planning-artifacts/prd.md#FR8 -- Crawl/classify analysis]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR1 -- Analysis pipeline < 5 min per site]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR10 -- Failed methods produce partial results]
- [Source: _bmad-output/planning-artifacts/architecture.md#Worker Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure -- worker/analysis/crawlClassify.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/implementation-artifacts/2-1-worker-process-and-job-queue-infrastructure.md -- Worker infrastructure, Playwright utilities, analyze.ts]
- [Source: _bmad-output/implementation-artifacts/2-2-pattern-matching-analysis-method.md -- Pattern matching implementation, types, confidence calculation]
- [Source: prisma/schema.prisma -- AnalysisResult model, AnalysisMethod enum]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- `pnpm build` -- passed with zero errors
- `pnpm lint` -- passed with zero errors/warnings

### Completion Notes List

- Created `worker/analysis/crawlClassify.ts` with full crawl/classify analysis pipeline
- Implemented page crawling with link discovery: `discoverJobsPage()`, `evaluateJobsPageLikelihood()`, `extractAndScoreLinks()`
- Implemented semantic content classification: `classifyContentBlocks()` with label proximity, text pattern, and structural heuristics for job_title, company_name, location, salary, description
- Implemented link analysis: `analyzeLinks()` for job detail page link detection and `extractDetailPagePattern()` for URL pattern extraction
- Implemented field mapping builder: `buildCrawlClassifyMappings()` with listing structure detection via `detectListingStructure()`
- Duplicated `calculateOverallConfidence()` (same formula as patternMatch.ts) for consistent scoring
- Full error resilience: try/catch wrapper with 90s timeout via `Promise.race`, zero-confidence fallback on any error
- All helper functions (isHashClass, stableClasses, generateSelector, classifyBlock, getNearbyLabelText) defined inside `page.evaluate()` callbacks per Playwright requirement
- Hebrew content support: city names, job-related terms, label text patterns for all classification types
- Updated `worker/jobs/analyze.ts` to call both pattern matching AND crawl/classify, create two AnalysisResult records, and use max confidence
- Navigation failure block updated to create both PATTERN_MATCH and CRAWL_CLASSIFY zero-confidence results
- No new npm packages installed; no `any` types used

### File List

- `worker/analysis/crawlClassify.ts` (NEW) -- crawl/classify analysis module
- `worker/jobs/analyze.ts` (MODIFIED) -- calls both analysis methods, creates two AnalysisResult records
- `_bmad-output/implementation-artifacts/2-3-crawl-classify-analysis-method.md` (MODIFIED) -- status updated to done
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED) -- story 2-3 marked done
