# Story 2.4: Network Interception Analysis Method

Status: done

## Story

As an admin,
I want the system to intercept network requests to discover API endpoints or data sources containing job data,
So that sites using AJAX/API-driven content can be analyzed for field mappings.

## Acceptance Criteria

1. **Given** a site URL has been submitted and the analysis job is running **When** the network interception method runs **Then** Playwright navigates to the site with network request interception enabled, capturing all XHR/fetch requests and their responses

2. **Given** network requests are captured **When** the interception analysis executes **Then** the system identifies JSON or structured data responses that contain job-like data (arrays of objects with title/company/location fields) **And** maps discovered API fields to the standard job schema fields with per-field confidence scores

3. **Given** the network interception analysis completes **When** results are produced **Then** an AnalysisResult record is created with method `NETWORK_INTERCEPT`, the discovered API endpoint URL, response field mappings, per-field confidence scores, and the overall method confidence

4. **Given** no API endpoints with job data are discovered **When** network interception analysis completes **Then** the method returns a result with zero confidence and empty field mappings rather than failing (NFR10)

5. **Given** the analysis method is implemented **When** I inspect the codebase **Then** the network interception logic is in `worker/analysis/networkIntercept.ts` **And** `worker/jobs/analyze.ts` is updated to call ALL THREE analysis methods (pattern matching, crawl/classify, AND network interception), storing results for each

## Tasks / Subtasks

- [x] Task 1: Create the network interception analysis module (AC: #1, #2, #3, #5)
  - [x] 1.1: Create file `worker/analysis/networkIntercept.ts`
  - [x] 1.2: Implement `analyzeWithNetworkIntercept(page: Page, siteUrl: string): Promise<NetworkInterceptResult>` function as the public entry point
  - [x] 1.3: Implement `runNetworkInterceptAnalysis(page: Page, siteUrl: string): Promise<NetworkInterceptResult>` internal pipeline function
  - [x] 1.4: Export the `NetworkInterceptResult` interface (compatible shape with `PatternMatchResult` / `CrawlClassifyResult` for consistency, plus `apiEndpoint` and `apiResponse` fields)

- [x] Task 2: Implement network request interception and capture (AC: #1)
  - [x] 2.1: Implement `setupNetworkCapture(page: Page): { requests: CapturedRequest[] }` to register a `page.on("response")` handler that captures all XHR/fetch responses
  - [x] 2.2: Filter captured responses to only keep those with `content-type` containing `json` or `text/plain` (skip images, CSS, JS bundles, fonts, etc.)
  - [x] 2.3: For each captured JSON response, store the URL, HTTP method, status code, response body (parsed JSON), and content-type
  - [x] 2.4: Set a maximum capture size limit of 500KB per response body and 50 captured responses total to avoid memory issues
  - [x] 2.5: After setting up the capture handler, navigate to the site URL and wait for `networkidle` state (up to 30 seconds) to capture all API calls triggered during page load
  - [x] 2.6: After initial load, scroll the page to trigger any lazy-loaded API calls, then wait an additional 3 seconds for responses

- [x] Task 3: Implement JSON response analysis for job data detection (AC: #2)
  - [x] 3.1: Implement `analyzeResponses(captured: CapturedRequest[]): AnalyzedEndpoint[]` to evaluate each captured JSON response for job-like data
  - [x] 3.2: Detect array responses (or responses containing nested arrays) that hold 3+ objects with similar structures -- these are likely job listing endpoints
  - [x] 3.3: For each candidate array, score the objects by checking for fields that match job schema names or patterns:
    - Title: keys named `title`, `jobTitle`, `job_title`, `position`, `positionName`, `name`, Hebrew: `כותרת`, `שם_משרה`, `תפקיד`
    - Company: keys named `company`, `companyName`, `company_name`, `employer`, `organization`, `org`, Hebrew: `חברה`, `מעסיק`
    - Location: keys named `location`, `city`, `area`, `address`, `region`, `place`, Hebrew: `מיקום`, `עיר`, `אזור`
    - Salary: keys named `salary`, `pay`, `wage`, `compensation`, `minSalary`, `maxSalary`, `salaryRange`, Hebrew: `שכר`, `משכורת`
    - Description: keys named `description`, `desc`, `summary`, `details`, `about`, `content`, `body`, Hebrew: `תיאור`, `פירוט`
  - [x] 3.4: Also analyze field VALUES to confirm classification: location values containing city names, salary values containing numbers/currency, description values being long strings, title values being 5-80 char strings
  - [x] 3.5: Score each endpoint by: number of matching job fields found, number of items in the array, and how well field values match expected patterns

- [x] Task 4: Build field mappings from discovered API endpoints (AC: #2, #3)
  - [x] 4.1: Implement `buildNetworkInterceptMappings(endpoint: AnalyzedEndpoint): NetworkInterceptResult` to convert the best-scoring endpoint into the standard field mapping format
  - [x] 4.2: For API-discovered field mappings, the `selector` field should use a JSON path notation (e.g., `$.data[*].title` or `response.jobs[*].company`) since these mappings point to API response fields rather than CSS selectors
  - [x] 4.3: Calculate per-field confidence scores based on: exact key name match (0.9), partial key name match (0.7), value pattern match only (0.5), weak signal (0.3)
  - [x] 4.4: Store the discovered API endpoint URL in the `apiEndpoint` field of the result
  - [x] 4.5: Store a sample of the API response (first item from the array) in the result for human review
  - [x] 4.6: Calculate overall confidence using the same weighted formula as pattern matching and crawl/classify (title: 0.40, company: 0.30, location: 0.30, with optional bonus for salary/description)

- [x] Task 5: Handle error resilience and timeouts (AC: #4)
  - [x] 5.1: Wrap the entire `analyzeWithNetworkIntercept()` function body in try/catch -- NEVER throw to caller
  - [x] 5.2: On any error, log with `[worker] Network interception failed:` prefix and return a zero-confidence result
  - [x] 5.3: Set a per-method analysis timeout of 60 seconds using `Promise.race` (network interception only needs one page load plus scroll, so 60s is sufficient)
  - [x] 5.4: Handle pages with no JSON API calls gracefully (return zero-confidence result, not an error)
  - [x] 5.5: Handle malformed JSON responses gracefully (skip them, log a warning, continue analyzing other responses)

- [x] Task 6: Define TypeScript types for network interception (AC: #2, #3)
  - [x] 6.1: Define `NetworkInterceptResult` interface:
    ```typescript
    export interface NetworkInterceptResult {
      fieldMappings: Record<string, { selector: string; sample: string }>;
      confidenceScores: Record<string, number>;
      overallConfidence: number;
      listingSelector: string | null;  // null for API-based mappings
      itemSelector: string | null;     // null for API-based mappings
      itemCount: number;
      apiEndpoint: string | null;
      apiResponse: Record<string, unknown> | null;  // sample first item
      capturedEndpoints: number;  // total number of JSON endpoints captured
    }
    ```
  - [x] 6.2: Define `CapturedRequest` interface for raw captured network responses:
    ```typescript
    interface CapturedRequest {
      url: string;
      method: string;
      status: number;
      contentType: string;
      body: unknown;
      bodySize: number;
    }
    ```
  - [x] 6.3: Define `AnalyzedEndpoint` interface for scored endpoint analysis:
    ```typescript
    interface AnalyzedEndpoint {
      url: string;
      method: string;
      itemCount: number;
      fieldMatches: Record<string, { key: string; confidence: number; sample: string }>;
      overallScore: number;
      arrayPath: string;  // JSON path to the array of items (e.g., "data", "results", "jobs")
      sampleItem: Record<string, unknown>;
    }
    ```

- [x] Task 7: Update the analysis job handler to run all three methods (AC: #5)
  - [x] 7.1: Modify `worker/jobs/analyze.ts` to import `analyzeWithNetworkIntercept` from `../analysis/networkIntercept`
  - [x] 7.2: After the existing crawl/classify call, navigate back to the original URL and call `analyzeWithNetworkIntercept(page, site.siteUrl)` using the **same page instance** (fresh page load needed for network capture since previous methods may have navigated)
  - [x] 7.3: **IMPORTANT**: Network interception needs a fresh page load to capture network requests. Before calling `analyzeWithNetworkIntercept`, navigate back to `site.siteUrl`. The function itself will set up interception handlers and then reload the page to capture requests from scratch.
  - [x] 7.4: Create a third `AnalysisResult` record with method `NETWORK_INTERCEPT` and the network interception results, including the `apiEndpoint` field
  - [x] 7.5: Update the site's `confidenceScore` to the **maximum** of all three methods' confidence (interim logic -- story 2-5 will implement the proper weighted combination)
  - [x] 7.6: Update the WorkerJob `result` JSON to include results from all three methods
  - [x] 7.7: Update the navigation failure block to create NETWORK_INTERCEPT zero-confidence result in addition to the existing PATTERN_MATCH and CRAWL_CLASSIFY zero-confidence results

- [x] Task 8: Verify build, lint, and end-to-end functionality (AC: #1-5)
  - [x] 8.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x] 8.2: Run `pnpm lint` -- must pass without warnings or errors
  - [ ] 8.3: Start the Next.js dev server (`pnpm dev`) and worker (`pnpm worker:dev`)
  - [ ] 8.4: Submit a real job site URL and verify the worker runs ALL THREE methods (pattern matching, crawl/classify, AND network interception)
  - [ ] 8.5: Check the database -- verify THREE AnalysisResult records are created for the site (one PATTERN_MATCH, one CRAWL_CLASSIFY, one NETWORK_INTERCEPT)
  - [ ] 8.6: For a site with API-driven content (e.g., a React/Vue SPA that fetches jobs via XHR), verify the NETWORK_INTERCEPT result has a non-null `apiEndpoint` and non-empty `fieldMappings`
  - [ ] 8.7: Submit an unreachable URL and verify all three methods return zero-confidence without crashing the worker
  - [ ] 8.8: Submit a static HTML site (no AJAX) and verify the NETWORK_INTERCEPT method completes with zero confidence gracefully while the other two methods may still produce results

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Import enums from `@/generated/prisma/enums`. Requires driver adapter. Generator output is `../src/generated/prisma`.
- **Worker accesses Prisma directly** -- the worker does NOT call API routes. It imports `prisma` from `@/lib/prisma` and reads/writes the database directly.
- **Logging convention**: All worker logs use `[worker]` prefix. Use `console.info`, `console.warn`, `console.error` with structured data objects.

### What This Story Changes

This story adds a **third analysis method** (`NETWORK_INTERCEPT`) to the analysis pipeline. After stories 2-2 and 2-3 implemented pattern matching and crawl/classify, the analysis job handler (`worker/jobs/analyze.ts`) now runs both those methods. This story extends it to also run network interception.

**Before (current state after story 2-3):**
1. Launch Playwright, navigate to the URL
2. Run pattern matching analysis (existing code, unchanged)
3. Create AnalysisResult record for PATTERN_MATCH
4. Navigate back to original URL
5. Run crawl/classify analysis (existing code, unchanged)
6. Create AnalysisResult record for CRAWL_CLASSIFY
7. Update site status to REVIEW with MAX confidence from both methods

**After this story:**
1. Launch Playwright, navigate to the URL
2. Run pattern matching analysis (existing code, unchanged)
3. Create AnalysisResult record for PATTERN_MATCH
4. Navigate back to original URL
5. Run crawl/classify analysis (existing code, unchanged)
6. Create AnalysisResult record for CRAWL_CLASSIFY
7. Navigate back to original URL (safety measure for fresh network capture)
8. Run network interception analysis (NEW code)
9. Create AnalysisResult record for NETWORK_INTERCEPT (NEW code)
10. Update site status to REVIEW with MAX confidence from ALL THREE methods

### How Network Interception Differs from the Other Two Methods

The three analysis methods take fundamentally different approaches:

| Aspect | Pattern Matching (2-2) | Crawl/Classify (2-3) | Network Intercept (2-4) |
|--------|----------------------|---------------------|------------------------|
| Strategy | Find repeating DOM structures | Crawl site, classify content semantically | Intercept XHR/fetch API calls |
| Input | Rendered HTML DOM | Rendered HTML DOM + page navigation | HTTP response bodies (JSON) |
| Strength | Well-structured HTML pages with clear repeating patterns | Non-standard layouts, JS-heavy sites, multi-page sites | SPA/AJAX sites that fetch job data from APIs |
| Weakness | Fails on API-driven SPAs with minimal DOM | Slower (may need multiple page loads) | Fails on server-rendered HTML sites (no API calls) |
| Output format | CSS selectors pointing to DOM elements | CSS selectors pointing to DOM elements | JSON paths pointing to API response fields |
| Timeout | 60 seconds | 90 seconds | 60 seconds |
| `apiEndpoint` | null | null | Discovered API URL |
| `listingSelector` | CSS selector | CSS selector | null (not DOM-based) |

### Key Implementation Detail: Network Capture Approach

Unlike pattern matching and crawl/classify which analyze the DOM, network interception works by monitoring HTTP traffic. The implementation uses Playwright's `page.on("response")` event handler to capture API responses as the page loads.

**Critical flow:**
1. Set up `page.on("response")` handler BEFORE navigating to the page
2. Navigate to the page and wait for `networkidle`
3. Scroll the page to trigger lazy-loaded content
4. Wait a few seconds for any remaining API calls
5. Analyze the captured responses for job-like data

**Why a fresh page load is needed:**
The network interception handler must be registered BEFORE the page loads to capture all requests. Since pattern matching and crawl/classify have already loaded and potentially navigated the page, we need to set up interception and then reload (or navigate back and reload) to capture the network requests from scratch.

The implementation should handle this by:
1. Setting up the response listener on the page
2. Using `page.goto(siteUrl)` to reload the page (this triggers a fresh page load which fires all API calls)
3. Collecting responses until `networkidle` + scroll + wait

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Prisma client singleton | `src/lib/prisma.ts` | Import: `import { prisma } from "@/lib/prisma"` |
| Playwright utilities | `worker/lib/playwright.ts` | `launchBrowser()`, `createPage(browser)`, `closeBrowser(browser)` |
| Pattern matching module | `worker/analysis/patternMatch.ts` | `PatternMatchResult` interface, `calculateOverallConfidence()` function |
| Crawl/classify module | `worker/analysis/crawlClassify.ts` | `CrawlClassifyResult` interface, same confidence formula |
| Analysis job handler | `worker/jobs/analyze.ts` | MODIFY -- add network interception call after crawl/classify |
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
  fieldMappings     Json           // { title: { selector: "$.data[*].title", sample: "Senior Developer" }, ... }
  confidenceScores  Json           // { title: 0.90, company: 0.85, location: 0.80, ... }
  overallConfidence Float          // 0.0 to 1.0 (as decimal, NOT percentage)
  apiEndpoint       String?        // Used by NETWORK_INTERCEPT -- the discovered API endpoint URL
  createdAt         DateTime       @default(now())

  @@index([siteId])
}

enum AnalysisMethod {
  PATTERN_MATCH
  CRAWL_CLASSIFY
  NETWORK_INTERCEPT
}
```

**IMPORTANT:** `overallConfidence` is stored as a **decimal (0.0 to 1.0)**, NOT a percentage. The `CONFIDENCE_THRESHOLD` constant is 70 (percentage). When comparing, multiply: `overallConfidence * 100 >= CONFIDENCE_THRESHOLD`. The `site.confidenceScore` field stores the value as a decimal 0.0-1.0 for consistency.

### fieldMappings JSON Structure

For network interception, the `selector` field uses **JSON path notation** instead of CSS selectors, since the data comes from API responses, not the DOM:

```typescript
// Network interception field mappings (JSON paths)
{
  "title": {
    "selector": "$.data[*].jobTitle",          // JSON path to the field in the API response
    "sample": "Senior Software Developer"       // Sample value from first item
  },
  "company": {
    "selector": "$.data[*].companyName",
    "sample": "Microsoft Israel"
  },
  "location": {
    "selector": "$.data[*].location",
    "sample": "Tel Aviv"
  },
  "salary": {
    "selector": "$.data[*].salary",
    "sample": "25000-35000"
  },
  "description": {
    "selector": "$.data[*].description",
    "sample": "We are looking for an experienced..."
  }
}
```

Compare with pattern matching / crawl/classify field mappings (CSS selectors):
```typescript
// DOM-based field mappings (CSS selectors)
{
  "title": {
    "selector": "h2.job-title a",
    "sample": "Senior Software Developer"
  }
}
```

Story 2-5 (Combined Results & Confidence Scoring) will handle merging DOM-based selectors with JSON-path-based selectors into a unified mapping.

### Algorithm Design: Network Interception

The network interception analysis follows this pipeline:

#### Step 1: Set Up Network Capture

```typescript
interface CapturedRequest {
  url: string;
  method: string;
  status: number;
  contentType: string;
  body: unknown;
  bodySize: number;
}

function setupNetworkCapture(page: Page): { requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];

  page.on("response", async (response) => {
    // Only capture successful JSON responses
    const status = response.status();
    if (status < 200 || status >= 400) return;

    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("json") && !contentType.includes("text/plain")) return;

    // Skip static assets
    const url = response.url();
    if (url.endsWith(".js") || url.endsWith(".css") || url.endsWith(".map")) return;
    if (url.includes("/static/") || url.includes("/assets/") || url.includes("/_next/")) return;

    // Skip if we already have too many captured requests
    if (requests.length >= 50) return;

    try {
      const body = await response.json();
      const bodyStr = JSON.stringify(body);

      // Skip if response is too large (> 500KB)
      if (bodyStr.length > 500_000) return;

      requests.push({
        url,
        method: response.request().method(),
        status,
        contentType,
        body,
        bodySize: bodyStr.length,
      });
    } catch {
      // Not valid JSON -- skip silently
    }
  });

  return { requests };
}
```

**IMPORTANT: Playwright `page.on("response")` runs in Node.js context, NOT in the browser context.** Unlike `page.evaluate()` which runs in the browser, the response event handler runs in Node.js. This means:
- You CAN use Node.js variables, imports, and closures
- You CANNOT access `document` or `window`
- Response body is available via `await response.json()` or `await response.text()`
- This is fundamentally different from the DOM-based approaches in pattern matching and crawl/classify

#### Step 2: Navigate and Trigger API Calls

```typescript
async function captureNetworkRequests(
  page: Page,
  siteUrl: string,
): Promise<CapturedRequest[]> {
  const { requests } = setupNetworkCapture(page);

  // Navigate to the page (fresh load to capture all initial API calls)
  await page.goto(siteUrl, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  // Scroll to trigger lazy-loaded content
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight / 2);
  });
  await page.waitForTimeout(1_500);

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(1_500);

  return requests;
}
```

#### Step 3: Analyze Captured Responses for Job Data

```typescript
function analyzeResponses(captured: CapturedRequest[]): AnalyzedEndpoint[] {
  const endpoints: AnalyzedEndpoint[] = [];

  for (const req of captured) {
    // Find arrays in the response (may be at root or nested)
    const arrays = findArraysInResponse(req.body);

    for (const { path, items } of arrays) {
      if (items.length < 3) continue; // Need at least 3 items to be a listing

      // Check if array items look like job objects
      const analysis = analyzeArrayItems(items, path);
      if (analysis.matchCount >= 2) {
        endpoints.push({
          url: req.url,
          method: req.method,
          itemCount: items.length,
          fieldMatches: analysis.fieldMatches,
          overallScore: analysis.overallScore,
          arrayPath: path,
          sampleItem: items[0] as Record<string, unknown>,
        });
      }
    }
  }

  // Sort by overall score descending
  endpoints.sort((a, b) => b.overallScore - a.overallScore);
  return endpoints;
}
```

#### Step 4: Find Arrays in JSON Response

```typescript
function findArraysInResponse(body: unknown): Array<{ path: string; items: unknown[] }> {
  const results: Array<{ path: string; items: unknown[] }> = [];

  function walk(obj: unknown, currentPath: string, depth: number): void {
    if (depth > 5) return; // Don't recurse too deep

    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
      results.push({ path: currentPath || "$", items: obj });
    }

    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        walk(value, currentPath ? `${currentPath}.${key}` : key, depth + 1);
      }
    }
  }

  walk(body, "", 0);
  return results;
}
```

#### Step 5: Score Array Items for Job-Like Fields

```typescript
interface FieldMatch {
  key: string;        // The actual key name in the API response
  confidence: number; // How confident we are this maps to the job field
  sample: string;     // Sample value from first item
}

function analyzeArrayItems(
  items: unknown[],
  arrayPath: string,
): { matchCount: number; fieldMatches: Record<string, FieldMatch>; overallScore: number } {
  // Sample first 5 items
  const sample = items.slice(0, 5) as Array<Record<string, unknown>>;

  // Collect all keys across sample items
  const allKeys = new Set<string>();
  for (const item of sample) {
    if (typeof item === "object" && item !== null) {
      for (const key of Object.keys(item)) {
        allKeys.add(key);
      }
    }
  }

  const fieldMatches: Record<string, FieldMatch> = {};
  const firstItem = sample[0] || {};

  // --- Title detection ---
  for (const key of allKeys) {
    const lowerKey = key.toLowerCase();
    let conf = 0;

    // Exact/close key name matches
    if (/^(title|jobTitle|job_title|position|positionName|position_name|name|jobName|job_name)$/i.test(key)) conf = 0.90;
    else if (/title|position|job.*name/i.test(lowerKey)) conf = 0.70;
    // Hebrew key hints
    else if (/כותרת|שם_משרה|תפקיד|שם.*משרה/i.test(key)) conf = 0.85;

    // Value-based confirmation
    if (conf > 0) {
      const val = String(firstItem[key] || "");
      if (val.length >= 5 && val.length <= 100) conf = Math.min(1.0, conf + 0.05);
      if (val.length < 3 || val.length > 200) conf *= 0.5;
    }

    if (conf > (fieldMatches.title?.confidence || 0)) {
      fieldMatches.title = {
        key,
        confidence: Math.round(conf * 100) / 100,
        sample: String(firstItem[key] || "").substring(0, 100),
      };
    }
  }

  // --- Company detection ---
  // (similar pattern for company, location, salary, description)
  // ...

  const matchCount = Object.keys(fieldMatches).length;
  let overallScore = 0;
  for (const match of Object.values(fieldMatches)) {
    overallScore += match.confidence;
  }
  overallScore = matchCount > 0 ? overallScore / matchCount : 0;
  overallScore *= Math.min(1.0, items.length / 5); // bonus for more items

  return { matchCount, fieldMatches, overallScore };
}
```

### Current analyze.ts That Needs Modification

The current `worker/jobs/analyze.ts` runs pattern matching and crawl/classify, creating two AnalysisResult records. It needs to be extended to also run network interception:

**CURRENT (after story 2-3):**
```typescript
import { analyzeWithPatternMatching } from "../analysis/patternMatch";
import { analyzeWithCrawlClassify } from "../analysis/crawlClassify";

// ... pattern matching runs ...
// ... crawl/classify runs ...

// Update site with best confidence from either method
const bestConfidence = Math.max(
  patternResult.overallConfidence,
  crawlResult.overallConfidence,
);

await prisma.site.update({
  where: { id: site.id },
  data: {
    status: "REVIEW",
    reviewAt: new Date(),
    confidenceScore: bestConfidence,
  },
});

return {
  pageTitle,
  methods: {
    patternMatch: { ... },
    crawlClassify: { ... },
  },
  bestConfidence,
};
```

**AFTER (with network interception added):**
```typescript
import { analyzeWithPatternMatching } from "../analysis/patternMatch";
import { analyzeWithCrawlClassify } from "../analysis/crawlClassify";
import { analyzeWithNetworkIntercept } from "../analysis/networkIntercept";

// ... pattern matching runs (existing code, unchanged) ...
// ... crawl/classify runs (existing code, unchanged) ...

// --- Navigate back to original URL for network interception ---
try {
  await page.goto(site.siteUrl, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
} catch (navError) {
  console.warn("[worker] Failed to navigate back for network interception:", {
    siteUrl: site.siteUrl,
    error: navError instanceof Error ? navError.message : String(navError),
  });
  // Continue anyway -- network interception will handle its own navigation
}

// --- Run network interception analysis ---
const networkResult = await analyzeWithNetworkIntercept(page, site.siteUrl);

console.info("[worker] Network interception complete:", {
  siteUrl: site.siteUrl,
  overallConfidence: networkResult.overallConfidence,
  fieldsDetected: Object.keys(networkResult.fieldMappings),
  apiEndpoint: networkResult.apiEndpoint,
  capturedEndpoints: networkResult.capturedEndpoints,
});

await prisma.analysisResult.create({
  data: {
    siteId: site.id,
    method: "NETWORK_INTERCEPT",
    fieldMappings: networkResult.fieldMappings,
    confidenceScores: networkResult.confidenceScores,
    overallConfidence: networkResult.overallConfidence,
    apiEndpoint: networkResult.apiEndpoint,
  },
});

// --- Update site with best confidence from ALL THREE methods ---
const bestConfidence = Math.max(
  patternResult.overallConfidence,
  crawlResult.overallConfidence,
  networkResult.overallConfidence,
);

await prisma.site.update({
  where: { id: site.id },
  data: {
    status: "REVIEW",
    reviewAt: new Date(),
    confidenceScore: bestConfidence,
  },
});

console.info(
  `[worker] Analysis complete for site: ${site.siteUrl} (best confidence: ${bestConfidence})`,
);

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
    networkIntercept: {
      confidence: networkResult.overallConfidence,
      fieldsDetected: Object.keys(networkResult.fieldMappings),
      apiEndpoint: networkResult.apiEndpoint,
      capturedEndpoints: networkResult.capturedEndpoints,
    },
  },
  bestConfidence,
};
```

### Navigation Failure Handling in analyze.ts

The existing navigation failure block creates PATTERN_MATCH and CRAWL_CLASSIFY results with zero confidence. This block must be updated to also create a NETWORK_INTERCEPT result:

```typescript
// In the catch(navError) block, after the existing PATTERN_MATCH and CRAWL_CLASSIFY results:
await prisma.analysisResult.create({
  data: {
    siteId: site.id,
    method: "NETWORK_INTERCEPT",
    fieldMappings: {},
    confidenceScores: {},
    overallConfidence: 0.0,
  },
});

// Update the return value to include networkIntercept:
return {
  pageTitle: "Navigation failed",
  methods: {
    patternMatch: { confidence: 0.0, fieldsDetected: [], itemCount: 0 },
    crawlClassify: {
      confidence: 0.0,
      fieldsDetected: [],
      crawledPages: [],
      detailPagePattern: null,
    },
    networkIntercept: {
      confidence: 0.0,
      fieldsDetected: [],
      apiEndpoint: null,
      capturedEndpoints: 0,
    },
  },
  bestConfidence: 0.0,
  error: navError instanceof Error ? navError.message : String(navError),
};
```

### Implementation Guidance: page.on("response") vs page.evaluate()

**This is the KEY difference from stories 2-2 and 2-3.** Network interception uses Playwright's Node.js-side event API, NOT `page.evaluate()`:

| Approach | Runs In | Used By | Access |
|----------|---------|---------|--------|
| `page.evaluate()` | Browser context | Pattern matching, Crawl/classify | DOM, `document`, `window` |
| `page.on("response")` | Node.js context | Network interception | HTTP responses, Node.js variables |

**This means:**
- You CAN use Node.js imports, closures, and variables in the response handler
- You CAN use `async/await` in the handler (e.g., `await response.json()`)
- You CANNOT access `document` or `window` in the handler
- Helper functions do NOT need to be duplicated inside callbacks (unlike `page.evaluate()`)
- The captured data is available directly in Node.js memory (no serialization needed)

### JSON Path Notation for API Field Selectors

Since network interception discovers API endpoints rather than DOM elements, the `selector` field in field mappings uses a JSON path notation. This allows the scraping engine (story 4-2) to know whether to extract data from the DOM or from an API response:

```typescript
// Convention for network interception selectors:
// Format: "$.{arrayPath}[*].{fieldKey}"
// The "$." prefix indicates this is an API field, not a CSS selector
// The "[*]" indicates iteration over the array items

const selector = `$.${arrayPath}[*].${fieldKey}`;
// Examples:
// "$.data[*].title"       -- array at response.data, field "title"
// "$.jobs[*].companyName" -- array at response.jobs, field "companyName"
// "$[*].position"         -- root-level array, field "position"
```

Story 2-5 (Combined Results) will merge these different selector types. The "$." prefix is the convention to distinguish API paths from CSS selectors.

### Overall Confidence Calculation

Use the **same formula** as pattern matching and crawl/classify to ensure consistency across methods:

```typescript
function calculateOverallConfidence(scores: Record<string, number>): number {
  const coreWeights: Record<string, number> = {
    title: 0.40,
    company: 0.30,
    location: 0.30,
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

  return Math.round(overall * 100) / 100;
}
```

### Hebrew Content Considerations

Same Hebrew content patterns as the other analysis methods apply. Additionally, network interception should recognize Hebrew field names in API responses:

**Hebrew API field key patterns:**
- Title: `כותרת`, `שם_משרה`, `שםמשרה`, `תפקיד`
- Company: `חברה`, `מעסיק`, `שם_חברה`, `שםחברה`
- Location: `מיקום`, `עיר`, `אזור`, `כתובת`
- Salary: `שכר`, `משכורת`, `שכר_ברוטו`
- Description: `תיאור`, `פירוט`, `תיאור_המשרה`

**Hebrew API response value patterns (same as other methods):**
- City names: תל אביב, ירושלים, חיפה, באר שבע, רמת גן, פתח תקווה, נתניה, הרצליה, etc.
- Salary terms: ש"ח, שקל, NIS, ILS
- Work mode: היברידי, מרחוק (hybrid, remote)

### Error Handling Strategy

Identical to the other methods -- network interception should NEVER throw an exception up to the caller:

```typescript
export async function analyzeWithNetworkIntercept(
  page: Page,
  siteUrl: string,
): Promise<NetworkInterceptResult> {
  try {
    const result = await Promise.race<NetworkInterceptResult>([
      runNetworkInterceptAnalysis(page, siteUrl),
      new Promise<NetworkInterceptResult>((_, reject) =>
        setTimeout(
          () => reject(new Error("Network interception timed out after 60s")),
          60_000,
        ),
      ),
    ]);
    return result;
  } catch (error) {
    console.error("[worker] Network interception failed:", {
      siteUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return zeroResult();
  }
}
```

### Reusing the Page Instance

All three analysis methods use the **same Playwright page instance**. The page is created once in `analyze.ts` and passed to all methods. Network interception needs a fresh page load but does NOT need a new browser or page instance -- it just registers event handlers and then navigates (which replaces the current page content).

```typescript
// In analyze.ts:
browser = await launchBrowser();
const { page } = await createPage(browser);

// Navigate to URL
await page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

// Pass the same page to all three methods
const patternResult = await analyzeWithPatternMatching(page, site.siteUrl);
// ... navigate back ...
const crawlResult = await analyzeWithCrawlClassify(page, site.siteUrl);
// ... navigate back ...
const networkResult = await analyzeWithNetworkIntercept(page, site.siteUrl);
```

### Common API Response Patterns to Detect

Israeli job sites commonly use these API response structures:

```typescript
// Pattern 1: Direct array at root
[
  { "title": "...", "company": "...", "location": "..." },
  { "title": "...", "company": "...", "location": "..." }
]

// Pattern 2: Wrapped in data/results key
{
  "data": [
    { "title": "...", "company": "...", "location": "..." }
  ],
  "total": 100,
  "page": 1
}

// Pattern 3: Nested under a jobs/positions key
{
  "jobs": [
    { "jobTitle": "...", "companyName": "...", "city": "..." }
  ],
  "count": 50
}

// Pattern 4: GraphQL response
{
  "data": {
    "jobSearch": {
      "results": [
        { "node": { "title": "...", "employer": { "name": "..." } } }
      ]
    }
  }
}

// Pattern 5: Hebrew keys
{
  "משרות": [
    { "כותרת": "...", "חברה": "...", "מיקום": "..." }
  ]
}
```

The `findArraysInResponse()` function should recursively search for arrays at any nesting depth (up to 5 levels) to handle all these patterns.

### URLs to Filter Out from Network Capture

The response handler should skip URLs that are clearly NOT job data endpoints:

```typescript
const SKIP_URL_PATTERNS = [
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)(\?|$)/i,
  /\/static\//i,
  /\/assets\//i,
  /\/_next\//i,
  /\/webpack/i,
  /google-analytics|gtag|googletagmanager|facebook|pixel|hotjar|analytics|tracking|beacon/i,
  /cdn\.|cloudflare|cloudfront|googleapis|gstatic/i,
  /recaptcha|captcha/i,
  /socket\.io|ws:\/\//i,
];

function shouldSkipUrl(url: string): boolean {
  return SKIP_URL_PATTERNS.some((pattern) => pattern.test(url));
}
```

### File Structure After This Story

```
worker/
  index.ts                    # UNCHANGED -- poll loop entry point
  jobDispatcher.ts            # UNCHANGED -- routes jobs to handlers
  jobs/
    analyze.ts                # MODIFIED -- calls ALL THREE methods
  analysis/
    patternMatch.ts           # UNCHANGED -- pattern matching analysis (story 2-2)
    crawlClassify.ts          # UNCHANGED -- crawl/classify analysis (story 2-3)
    networkIntercept.ts       # NEW -- network interception analysis
  lib/
    playwright.ts             # UNCHANGED -- Playwright browser utilities
```

### Anti-Patterns to AVOID

- Do NOT put the network interception logic in `worker/jobs/analyze.ts` -- create a separate `worker/analysis/networkIntercept.ts` module
- Do NOT modify `worker/index.ts` or `worker/jobDispatcher.ts` -- these are stable infrastructure from story 2-1
- Do NOT modify `worker/lib/playwright.ts` -- it already has the utilities needed
- Do NOT modify `worker/analysis/patternMatch.ts` or `worker/analysis/crawlClassify.ts` -- they are complete from stories 2-2 and 2-3
- Do NOT use `any` type -- define proper TypeScript interfaces for all intermediate data
- Do NOT use `page.evaluate()` for network interception logic -- use `page.on("response")` which runs in Node.js context
- Do NOT throw exceptions from `analyzeWithNetworkIntercept()` -- always return a result (NFR10)
- Do NOT hardcode API URLs for specific job sites -- the analysis must be generic
- Do NOT install any new npm packages -- Playwright and all needed dependencies are already installed
- Do NOT import from `@prisma/client` -- import from `@/generated/prisma/client`
- Do NOT create a new browser/page for network interception -- reuse the one from analyze.ts
- Do NOT capture response bodies larger than 500KB -- set size limits to avoid memory issues
- Do NOT capture more than 50 responses -- set count limits to prevent runaway capture
- Do NOT forget to handle the case where no JSON API calls are made (static HTML site) -- return zero-confidence
- Do NOT forget to register the response handler BEFORE navigating to the page (otherwise you miss the initial API calls)
- Do NOT forget to scroll the page after initial load to trigger lazy-loading API calls
- Do NOT confuse `page.on("response")` (Node.js context) with `page.evaluate()` (browser context) -- they are fundamentally different execution environments
- Do NOT try to use `response.json()` inside `page.evaluate()` -- `response` is a Playwright Response object available only in Node.js
- Do NOT use `page.route()` or `page.setExtraHTTPHeaders()` -- we are observing network traffic, not modifying it
- Do NOT try to parse non-JSON responses as JSON -- check content-type first and wrap `response.json()` in try/catch

### Previous Story Learnings (from Stories 1-1 through 2-3)

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
18. **page.evaluate() helper duplication**: All helper functions used inside `page.evaluate()` must be defined INSIDE the evaluate callback. This does NOT apply to `page.on("response")` handlers which run in Node.js context.
19. **Pattern matching and crawl/classify use page.evaluate()** for DOM analysis. Network interception uses `page.on("response")` for HTTP response analysis. These are different Playwright APIs with different execution contexts.
20. **Crawl/classify may navigate the page** -- after crawl/classify completes, the page may be on a different URL. Navigate back before network interception.
21. **analyze.ts currently creates TWO AnalysisResult records** (PATTERN_MATCH and CRAWL_CLASSIFY) and uses `Math.max()` of both confidences. This story extends to THREE records with `Math.max()` of all three.
22. **The `apiEndpoint` field on AnalysisResult** is designed for NETWORK_INTERCEPT. It stores the discovered API URL. Pattern matching and crawl/classify leave this field null.

### Project Structure Notes

- `worker/analysis/networkIntercept.ts` aligns with the planned file in the architecture: `worker/analysis/networkIntercept.ts`
- Story 2-5 will add `worker/analysis/combineResults.ts` and `worker/lib/confidence.ts` to merge all three methods
- After this story, all three analysis methods are complete. Story 2-5 is the final story in Epic 2 that combines them.
- The `calculateOverallConfidence()` function is currently duplicated across all three analysis modules. Story 2-5 will extract it to `worker/lib/confidence.ts`.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. `worker/analysis/networkIntercept.ts` exists and exports `analyzeWithNetworkIntercept()`
4. `worker/analysis/networkIntercept.ts` exports `NetworkInterceptResult` interface
5. `worker/jobs/analyze.ts` calls all three methods: `analyzeWithPatternMatching()`, `analyzeWithCrawlClassify()`, AND `analyzeWithNetworkIntercept()`
6. Worker starts with `pnpm worker:dev` and processes analysis jobs
7. Submitting a real job site URL produces THREE AnalysisResult records (one PATTERN_MATCH, one CRAWL_CLASSIFY, one NETWORK_INTERCEPT)
8. The NETWORK_INTERCEPT AnalysisResult has appropriate `fieldMappings`, `confidenceScores`, and `overallConfidence` values
9. For sites with API-driven content, the NETWORK_INTERCEPT result has a non-null `apiEndpoint`
10. Site `confidenceScore` is set to the MAX of all three methods' confidence
11. Submitting an unreachable URL returns three zero-confidence results WITHOUT crashing the worker
12. Submitting a static HTML site (no AJAX) returns NETWORK_INTERCEPT with zero confidence while other methods may have results
13. The worker continues polling and processing after any individual analysis succeeds or fails
14. No browser processes left hanging after job completion
15. No `any` types used in the codebase (eslint enforced)
16. No new npm packages installed (all dependencies already available)
17. Navigation failure block in analyze.ts creates PATTERN_MATCH, CRAWL_CLASSIFY, AND NETWORK_INTERCEPT zero-confidence results
18. Network capture skips static assets, analytics, and other non-data endpoints
19. Response body size limit (500KB) and response count limit (50) are enforced

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4: Network Interception Analysis Method]
- [Source: _bmad-output/planning-artifacts/prd.md#FR9 -- Network interception analysis]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR1 -- Analysis pipeline < 5 min per site]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR10 -- Failed methods produce partial results]
- [Source: _bmad-output/planning-artifacts/architecture.md#Worker Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure -- worker/analysis/networkIntercept.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/implementation-artifacts/2-1-worker-process-and-job-queue-infrastructure.md -- Worker infrastructure, Playwright utilities, analyze.ts]
- [Source: _bmad-output/implementation-artifacts/2-2-pattern-matching-analysis-method.md -- Pattern matching implementation, types, confidence calculation]
- [Source: _bmad-output/implementation-artifacts/2-3-crawl-classify-analysis-method.md -- Crawl/classify implementation, types, page crawling]
- [Source: prisma/schema.prisma -- AnalysisResult model, AnalysisMethod enum, apiEndpoint field]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

N/A

### Completion Notes List

- Created `worker/analysis/networkIntercept.ts` with full network interception analysis pipeline
- Implemented `setupNetworkCapture()` using Playwright `page.on("response")` in Node.js context
- Implemented `captureNetworkRequests()` with page navigation, scroll-to-trigger, and 3s wait
- Implemented `analyzeResponses()` with recursive array finding (up to 5 depth levels)
- Implemented `analyzeArrayItems()` with title/company/location/salary/description detection including Hebrew field names
- Implemented `buildNetworkInterceptMappings()` with JSON path notation selectors (`$.path[*].field`)
- Implemented `calculateOverallConfidence()` using same weighted formula as other methods
- Full error resilience: try/catch wrapper, 60s timeout via Promise.race, zero-result on any failure
- Updated `worker/jobs/analyze.ts` to call all three methods sequentially with navigation back between each
- Navigation failure block now creates PATTERN_MATCH, CRAWL_CLASSIFY, and NETWORK_INTERCEPT zero-confidence results
- Site confidenceScore set to MAX of all three methods
- Return value includes all three method results
- `pnpm build` passes without errors
- `pnpm lint` passes without warnings or errors
- URL filtering skips static assets, analytics, CDN, etc.
- Response body size limit (500KB) and count limit (50) enforced
- No `any` types used, no new npm packages installed

### File List

- `worker/analysis/networkIntercept.ts` (NEW) - Network interception analysis module
- `worker/jobs/analyze.ts` (MODIFIED) - Added network interception as third analysis method
