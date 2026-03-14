# Story 2.5: Combined Results & Confidence Scoring

Status: done

## Story

As an admin,
I want the system to combine all analysis results into a single unified field mapping with an overall confidence score,
So that sites are automatically routed to the review queue when confidence is high enough.

## Acceptance Criteria

1. **Given** all three analysis methods have completed for a site (including partial/zero results from failed methods) **When** the combination step runs **Then** the system merges field mappings from all three methods, selecting the highest-confidence mapping for each field, and produces a unified field mapping with per-field confidence scores (FR10)
   - For each standard field (title, company, location, salary, description), pick the mapping from the method that reported the highest per-field confidence
   - If two methods tie on confidence for a field, prefer the DOM-based selector (CSS) over the API-based selector (JSON path starting with `$.`) since DOM selectors are more universally usable by the scraper
   - If a field was detected by multiple methods, apply a **cross-method agreement bonus**: +0.10 if 2 methods detected the field, +0.15 if all 3 methods detected it (capped at 1.0)
   - The unified mapping preserves the `selector` and `sample` from the winning method for each field

2. **Given** the unified field mapping is produced **When** the overall confidence score is calculated **Then** the score is a weighted average of per-field confidence scores for core fields (title: 0.40, company: 0.30, location: 0.30) plus optional bonus (salary: 0.05, description: 0.05), stored on the Site record as `confidenceScore` (decimal 0.0-1.0) (FR11)
   - This uses the same `calculateOverallConfidence()` formula already used by each individual method, but applied to the **unified** per-field confidence scores (which include the cross-method agreement bonus)
   - The formula is extracted to `worker/lib/confidence.ts` as the shared canonical implementation

3. **Given** the overall confidence score is calculated **When** the score as a percentage (score * 100) is >= `CONFIDENCE_THRESHOLD` (70) **Then** the site status is automatically updated from ANALYZING to REVIEW and the site appears in the review queue (FR12)
   - The unified field mappings are stored on the Site record in the `fieldMappings` Json field
   - The `reviewAt` timestamp is set
   - Additional metadata (which method won each field, detail page pattern, API endpoint) is stored in the WorkerJob `result` JSON

4. **Given** the overall confidence score is calculated **When** the score as a percentage (score * 100) is < `CONFIDENCE_THRESHOLD` (70) **Then** the site status is updated from ANALYZING to REVIEW (low-confidence variant) with the actual confidence score stored
   - Low-confidence sites still appear in the Sites table with their real confidence score
   - They ARE still routed to REVIEW status (admin can decide to review them manually)
   - The admin can also skip them from the Sites table

5. **Given** analysis is complete and results are stored **When** the admin later makes corrections via the Chrome extension (story 3-3) **Then** the original AI mappings and the corrections are stored as structured training data for future AI improvement (FR13)
   - The `Site.fieldMappings` field stores the unified AI-generated mapping
   - When the extension saves corrections via `PUT /api/sites/[id]/config`, the API stores both the original mapping (as a new `AnalysisResult` with method indicating it's a "COMBINED" snapshot, or in a separate field) and the corrected mapping
   - The training data storage is the **responsibility of story 3-5** (Form Record Mode & Config Save). This story only ensures the original AI mapping is preserved in a queryable form so 3-5 can save the diff.
   - **Implementation for this story:** Store the original unified mapping in `Site.fieldMappings` Json field. Story 3-5 will handle the correction diff.

6. **Given** the entire analysis pipeline runs for a site **When** all steps complete **Then** the total pipeline time is within 5 minutes per site (NFR1) **And** the analysis results are committed to the database before reporting success

7. **Given** the combination logic is implemented **When** I inspect the codebase **Then** the combination and scoring logic is in `worker/analysis/combineResults.ts` and the shared confidence scoring function is in `worker/lib/confidence.ts`

## Tasks / Subtasks

- [x] Task 1: Extract shared confidence scoring to `worker/lib/confidence.ts` (AC: #2, #7)
  - [x] 1.1: Create `worker/lib/confidence.ts` with the `calculateOverallConfidence(scores: Record<string, number>): number` function
    - Core weights: title 0.40, company 0.30, location 0.30
    - Optional bonus: salary 0.05, description 0.05 (capped at 1.0 total)
    - Round to 2 decimal places
    - This is the same formula already duplicated in patternMatch.ts, crawlClassify.ts, and networkIntercept.ts
  - [x] 1.2: Export the core field weights and optional field weights as named constants for reuse:
    ```typescript
    export const CORE_FIELD_WEIGHTS: Record<string, number> = {
      title: 0.40,
      company: 0.30,
      location: 0.30,
    };
    export const OPTIONAL_FIELD_WEIGHTS: Record<string, number> = {
      salary: 0.05,
      description: 0.05,
    };
    export const CORE_FIELDS = Object.keys(CORE_FIELD_WEIGHTS);
    export const ALL_FIELDS = [...CORE_FIELDS, ...Object.keys(OPTIONAL_FIELD_WEIGHTS)];
    ```
  - [x] 1.3: Update `worker/analysis/patternMatch.ts` to import `calculateOverallConfidence` from `../lib/confidence` instead of its local copy
  - [x] 1.4: Update `worker/analysis/crawlClassify.ts` to import `calculateOverallConfidence` from `../lib/confidence` instead of its local copy
  - [x] 1.5: Update `worker/analysis/networkIntercept.ts` to import `calculateOverallConfidence` from `../lib/confidence` instead of its local copy
  - [x] 1.6: Remove the local `calculateOverallConfidence()` function definitions from all three analysis modules

- [x] Task 2: Create the combined results module `worker/analysis/combineResults.ts` (AC: #1, #2, #7)
  - [x] 2.1: Create file `worker/analysis/combineResults.ts`
  - [x] 2.2: Define `CombinedAnalysisResult` interface:
    ```typescript
    export interface CombinedAnalysisResult {
      /** Unified field mappings: for each field, the winning mapping + source method */
      fieldMappings: Record<string, {
        selector: string;
        sample: string;
        sourceMethod: string;    // "PATTERN_MATCH" | "CRAWL_CLASSIFY" | "NETWORK_INTERCEPT"
        methodsDetected: number; // how many methods detected this field (1, 2, or 3)
      }>;
      /** Per-field confidence scores (after cross-method agreement bonus) */
      confidenceScores: Record<string, number>;
      /** Overall site confidence (weighted average of core fields + optional bonus) */
      overallConfidence: number;
      /** Best listing/item selectors from any DOM-based method */
      listingSelector: string | null;
      itemSelector: string | null;
      itemCount: number;
      /** API endpoint discovered by network interception (if any) */
      apiEndpoint: string | null;
      /** Detail page URL pattern discovered by crawl/classify (if any) */
      detailPagePattern: string | null;
      /** Summary of which method contributed each field */
      methodContributions: Record<string, string>;
    }
    ```
  - [x] 2.3: Define input interfaces for the combine function:
    ```typescript
    export interface MethodResult {
      method: string; // "PATTERN_MATCH" | "CRAWL_CLASSIFY" | "NETWORK_INTERCEPT"
      fieldMappings: Record<string, { selector: string; sample: string }>;
      confidenceScores: Record<string, number>;
      overallConfidence: number;
      listingSelector: string | null;
      itemSelector: string | null;
      itemCount: number;
      apiEndpoint?: string | null;
      detailPagePattern?: string | null;
    }
    ```
  - [x] 2.4: Implement `combineAnalysisResults(results: MethodResult[]): CombinedAnalysisResult` as the main public function

- [x] Task 3: Implement the field-level merging algorithm (AC: #1)
  - [x] 3.1: Implement `mergeFieldMappings(results: MethodResult[]): MergedFields` to merge per-field mappings across all methods:
    1. For each standard field (title, company, location, salary, description), collect all methods that detected it
    2. Select the winner: highest per-field confidence score
    3. On tie: prefer DOM-based selector (does NOT start with `$.`) over API-based selector
    4. On DOM vs DOM tie: prefer the method with the higher overall confidence
  - [x] 3.2: Apply cross-method agreement bonus:
    - If 2 methods detected the same field: add +0.10 to the winning confidence (capped at 1.0)
    - If 3 methods detected the same field: add +0.15 to the winning confidence (capped at 1.0)
    - This bonus rewards fields where multiple independent methods agree, increasing trust
  - [x] 3.3: Track which method won each field in `methodContributions` for debugging and training data

- [x] Task 4: Implement metadata merging (AC: #1, #3)
  - [x] 4.1: Select the best `listingSelector` and `itemSelector`: use the DOM-based method with the highest overall confidence that has non-null listing/item selectors
  - [x] 4.2: Use the highest `itemCount` from any method as the unified item count
  - [x] 4.3: Preserve `apiEndpoint` from the network interception result (if non-null)
  - [x] 4.4: Preserve `detailPagePattern` from the crawl/classify result (if non-null)

- [x] Task 5: Update `worker/jobs/analyze.ts` to use the combine step (AC: #1, #2, #3, #4, #5, #6)
  - [x] 5.1: Import `combineAnalysisResults` from `../analysis/combineResults`
  - [x] 5.2: Import `CONFIDENCE_THRESHOLD` from `@/lib/constants`
  - [x] 5.3: After all three analysis methods have run and their AnalysisResult records have been created, call `combineAnalysisResults()` with all three method results
  - [x] 5.4: **Replace** the current `Math.max()` confidence logic with the proper combined result:
    ```typescript
    // BEFORE (current interim logic):
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

    // AFTER (proper combined results):
    const combinedResult = combineAnalysisResults([
      { method: "PATTERN_MATCH", ...patternResult },
      { method: "CRAWL_CLASSIFY", ...crawlResult, detailPagePattern: crawlResult.detailPagePattern },
      { method: "NETWORK_INTERCEPT", ...networkResult, apiEndpoint: networkResult.apiEndpoint },
    ]);

    // Store unified field mappings on the Site record
    await prisma.site.update({
      where: { id: site.id },
      data: {
        status: "REVIEW",
        reviewAt: new Date(),
        confidenceScore: combinedResult.overallConfidence,
        fieldMappings: combinedResult.fieldMappings,
      },
    });
    ```
  - [x] 5.5: Update the return value to include combined results:
    ```typescript
    return {
      pageTitle,
      methods: {
        patternMatch: { ... },
        crawlClassify: { ... },
        networkIntercept: { ... },
      },
      combined: {
        overallConfidence: combinedResult.overallConfidence,
        fieldsDetected: Object.keys(combinedResult.fieldMappings),
        methodContributions: combinedResult.methodContributions,
        listingSelector: combinedResult.listingSelector,
        itemSelector: combinedResult.itemSelector,
        itemCount: combinedResult.itemCount,
        apiEndpoint: combinedResult.apiEndpoint,
        detailPagePattern: combinedResult.detailPagePattern,
      },
    };
    ```
  - [x] 5.6: Log the combined result:
    ```typescript
    console.info("[worker] Combined analysis result:", {
      siteUrl: site.siteUrl,
      overallConfidence: combinedResult.overallConfidence,
      fieldsDetected: Object.keys(combinedResult.fieldMappings),
      methodContributions: combinedResult.methodContributions,
    });
    ```

- [ ] Task 6: Handle confidence-based routing (AC: #3, #4)
  - [ ] 6.1: After computing the combined confidence, apply routing logic:
    ```typescript
    // Both high and low confidence sites go to REVIEW status
    // (admin sees them all, sorted by confidence -- story 3-1 handles the review queue view)
    const confidencePercent = combinedResult.overallConfidence * 100;

    if (confidencePercent >= CONFIDENCE_THRESHOLD) {
      console.info("[worker] Site meets confidence threshold, routing to REVIEW:", {
        siteUrl: site.siteUrl,
        confidence: combinedResult.overallConfidence,
        threshold: CONFIDENCE_THRESHOLD,
      });
    } else {
      console.warn("[worker] Site below confidence threshold, routing to REVIEW (low confidence):", {
        siteUrl: site.siteUrl,
        confidence: combinedResult.overallConfidence,
        threshold: CONFIDENCE_THRESHOLD,
      });
    }

    // Both cases route to REVIEW -- the confidence score stored on the Site
    // record allows the review queue to sort/filter by confidence level
    await prisma.site.update({
      where: { id: site.id },
      data: {
        status: "REVIEW",
        reviewAt: new Date(),
        confidenceScore: combinedResult.overallConfidence,
        fieldMappings: combinedResult.fieldMappings,
      },
    });
    ```
  - [ ] 6.2: The navigation failure path (existing catch block at top of analyze.ts) should remain unchanged -- it already sets the site to FAILED with 0.0 confidence and creates three zero-confidence AnalysisResult records. No combine step is needed for this path since all results are zero.

- [ ] Task 7: Update the navigation failure return value in analyze.ts (AC: #6)
  - [ ] 7.1: Update the navigation failure return object to include a `combined` key for consistency:
    ```typescript
    return {
      pageTitle: "Navigation failed",
      methods: {
        patternMatch: { confidence: 0.0, fieldsDetected: [], itemCount: 0 },
        crawlClassify: { confidence: 0.0, fieldsDetected: [], crawledPages: [], detailPagePattern: null },
        networkIntercept: { confidence: 0.0, fieldsDetected: [], apiEndpoint: null, capturedEndpoints: 0 },
      },
      combined: {
        overallConfidence: 0.0,
        fieldsDetected: [],
        methodContributions: {},
        listingSelector: null,
        itemSelector: null,
        itemCount: 0,
        apiEndpoint: null,
        detailPagePattern: null,
      },
      error: navError instanceof Error ? navError.message : String(navError),
    };
    ```

- [ ] Task 8: Verify build, lint, and end-to-end functionality (AC: #1-7)
  - [ ] 8.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [ ] 8.2: Run `pnpm lint` -- must pass without warnings or errors
  - [ ] 8.3: Verify `worker/lib/confidence.ts` exists and exports `calculateOverallConfidence`, `CORE_FIELD_WEIGHTS`, `OPTIONAL_FIELD_WEIGHTS`, `CORE_FIELDS`, `ALL_FIELDS`
  - [ ] 8.4: Verify `worker/analysis/combineResults.ts` exists and exports `combineAnalysisResults`, `CombinedAnalysisResult`, `MethodResult`
  - [ ] 8.5: Verify the three analysis modules (`patternMatch.ts`, `crawlClassify.ts`, `networkIntercept.ts`) no longer define their own `calculateOverallConfidence()` function and instead import from `worker/lib/confidence`
  - [ ] 8.6: Verify `worker/jobs/analyze.ts` calls `combineAnalysisResults()` and no longer uses the raw `Math.max()` confidence logic
  - [ ] 8.7: Start the Next.js dev server (`pnpm dev`) and worker (`pnpm worker:dev`)
  - [ ] 8.8: Submit a real job site URL and verify:
    - THREE AnalysisResult records are created (one per method, same as before)
    - Site `confidenceScore` reflects the combined (not max) confidence
    - Site `fieldMappings` Json field contains the unified mapping with `sourceMethod` and `methodsDetected` per field
    - Site status is REVIEW
  - [ ] 8.9: Submit an unreachable URL and verify the site transitions to FAILED with 0.0 confidence (no combine step)
  - [ ] 8.10: Verify the total analysis time for a site is under 5 minutes (NFR1)

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Import enums from `@/generated/prisma/enums`. Requires driver adapter. Generator output is `../src/generated/prisma`.
- **Worker accesses Prisma directly** -- the worker does NOT call API routes. It imports `prisma` from `@/lib/prisma` and reads/writes the database directly.
- **Logging convention**: All worker logs use `[worker]` prefix. Use `console.info`, `console.warn`, `console.error` with structured data objects.

### What This Story Changes

This is the **final story in Epic 2**. It replaces the interim `Math.max()` confidence logic in `analyze.ts` with a proper combination algorithm that:

1. Extracts the duplicated `calculateOverallConfidence()` to a shared `worker/lib/confidence.ts`
2. Creates `worker/analysis/combineResults.ts` to merge field mappings across all three methods
3. Applies cross-method agreement bonuses to fields detected by multiple methods
4. Stores the unified field mapping on the Site record for use by the Chrome extension and scraper
5. Routes sites to REVIEW status based on the combined confidence

**Before (current state after story 2-4):**
1. Three methods run sequentially, each creates an AnalysisResult record
2. `Math.max()` of all three confidences is stored as the site's `confidenceScore`
3. Site always goes to REVIEW status
4. Site `fieldMappings` field is NOT populated by the analysis pipeline

**After this story:**
1. Three methods run sequentially, each creates an AnalysisResult record (unchanged)
2. `combineAnalysisResults()` merges all three into a unified result with cross-method bonuses
3. Combined confidence score stored on the Site record
4. **Site `fieldMappings` is populated** with the unified mapping (crucial for Chrome extension in story 3-3)
5. Site goes to REVIEW status with the combined confidence visible for queue prioritization

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Prisma client singleton | `src/lib/prisma.ts` | Import: `import { prisma } from "@/lib/prisma"` |
| Playwright utilities | `worker/lib/playwright.ts` | `launchBrowser()`, `createPage(browser)`, `closeBrowser(browser)` |
| Pattern matching module | `worker/analysis/patternMatch.ts` | MODIFY to import shared confidence. `PatternMatchResult` interface stays. |
| Crawl/classify module | `worker/analysis/crawlClassify.ts` | MODIFY to import shared confidence. `CrawlClassifyResult` interface stays. |
| Network intercept module | `worker/analysis/networkIntercept.ts` | MODIFY to import shared confidence. `NetworkInterceptResult` interface stays. |
| Analysis job handler | `worker/jobs/analyze.ts` | MODIFY -- replace Math.max with combineAnalysisResults |
| Worker entry point | `worker/index.ts` | DO NOT MODIFY |
| Job dispatcher | `worker/jobDispatcher.ts` | DO NOT MODIFY |
| Error classes | `src/lib/errors.ts` | `AppError`, `NotFoundError`, `ConflictError` etc. |
| Constants | `src/lib/constants.ts` | `CONFIDENCE_THRESHOLD = 70`, `ANALYSIS_METHOD_LABELS` |
| Types | `src/lib/types.ts` | `FieldMapping`, `FieldType`, `SiteConfig` |

### Prisma Model Reference (Site -- relevant fields)

```prisma
model Site {
  id              String      @id @default(cuid())
  siteUrl         String      @unique
  status          SiteStatus  @default(ANALYZING)
  confidenceScore Float?                // Combined overall confidence (0.0-1.0)
  fieldMappings   Json?                 // UNIFIED field mappings from combineResults
  pageFlow        Json?                 // Page navigation flow (populated later by extension)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  analyzingAt     DateTime?
  reviewAt        DateTime?
  activeAt        DateTime?
  failedAt        DateTime?
  skippedAt       DateTime?
  ...
}
```

**IMPORTANT:** The `Site.fieldMappings` Json field is populated by this story with the unified AI-generated mapping. Previously it was left as `null` during analysis. This is the field the Chrome extension (story 3-3) will read to display the overlay and the field the scraper (story 4-2) will use to extract data.

### Prisma Model Reference (AnalysisResult)

```prisma
model AnalysisResult {
  id                String         @id @default(cuid())
  siteId            String
  site              Site           @relation(fields: [siteId], references: [id])
  method            AnalysisMethod
  fieldMappings     Json           // Per-method field mappings
  confidenceScores  Json           // Per-method per-field confidence scores
  overallConfidence Float          // Per-method overall confidence (0.0-1.0)
  apiEndpoint       String?        // Used by NETWORK_INTERCEPT
  createdAt         DateTime       @default(now())

  @@index([siteId])
}

enum AnalysisMethod {
  PATTERN_MATCH
  CRAWL_CLASSIFY
  NETWORK_INTERCEPT
}
```

**IMPORTANT:** This story does NOT create a new AnalysisResult record for the combined result. The three individual AnalysisResult records (one per method) are the source of truth. The combined/unified mapping is stored on `Site.fieldMappings`. Individual method results remain queryable for debugging and training data.

### Confidence Scoring Deep Dive

#### Per-Field Scoring (within each method -- already implemented)

Each method assigns a per-field confidence score between 0.0 and 1.0 based on heuristic signals:
- **0.9+**: Multiple strong signals agree (e.g., key name match + value pattern match for network intercept)
- **0.7-0.9**: One strong signal + supporting context
- **0.5-0.7**: Moderate signal
- **0.3-0.5**: Weak signal
- **0.0**: Field not detected

#### Cross-Method Agreement Bonus (NEW in this story)

When merging, a field detected by multiple methods gets a confidence boost because independent methods agreeing increases trust:

```typescript
const AGREEMENT_BONUS_TWO = 0.10;   // 2 methods agree
const AGREEMENT_BONUS_THREE = 0.15; // 3 methods agree

function applyAgreementBonus(
  baseConfidence: number,
  methodsDetected: number,
): number {
  let bonus = 0;
  if (methodsDetected === 2) bonus = AGREEMENT_BONUS_TWO;
  else if (methodsDetected >= 3) bonus = AGREEMENT_BONUS_THREE;
  return Math.min(1.0, Math.round((baseConfidence + bonus) * 100) / 100);
}
```

**Example:** If pattern matching detected title with 0.72 confidence and crawl/classify also detected title with 0.68:
- Winner: pattern matching (0.72 > 0.68)
- Agreement bonus: +0.10 (2 methods agree)
- Final per-field confidence: 0.82
- The `selector` and `sample` come from pattern matching (the winner)

#### Overall Confidence Calculation (extracted to shared function)

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

### fieldMappings JSON Structure (Unified -- NEW)

The unified `Site.fieldMappings` JSON (stored on the Site record) has an enriched structure compared to individual method results:

```typescript
// Individual method result format (AnalysisResult.fieldMappings):
{
  "title": {
    "selector": "h2.job-title a",
    "sample": "Senior Software Developer"
  }
}

// Unified combined format (Site.fieldMappings):
{
  "title": {
    "selector": "h2.job-title a",
    "sample": "Senior Software Developer",
    "sourceMethod": "PATTERN_MATCH",
    "methodsDetected": 2
  },
  "company": {
    "selector": "$.data[*].companyName",
    "sample": "Microsoft Israel",
    "sourceMethod": "NETWORK_INTERCEPT",
    "methodsDetected": 1
  },
  "location": {
    "selector": ".job-location",
    "sample": "Tel Aviv",
    "sourceMethod": "CRAWL_CLASSIFY",
    "methodsDetected": 3
  }
}
```

Note: A field may have a CSS selector (from pattern matching or crawl/classify) or a JSON path selector (from network interception, prefixed with `$.`). The Chrome extension and scraper will need to handle both types. This convention was established in story 2-4.

### Selector Type Convention

Selectors fall into two categories:
- **CSS selectors** (from PATTERN_MATCH and CRAWL_CLASSIFY): e.g., `h2.job-title a`, `.company-name span`
- **JSON path selectors** (from NETWORK_INTERCEPT): always start with `$.`, e.g., `$.data[*].title`, `$[*].companyName`

The combine step does NOT convert between these formats. It preserves whichever selector wins the confidence comparison. Downstream consumers (extension, scraper) must check the `$.` prefix to determine the selector type.

### Algorithm Design: combineAnalysisResults()

```typescript
export function combineAnalysisResults(results: MethodResult[]): CombinedAnalysisResult {
  // 1. Collect all detected fields across all methods
  const allFields = new Set<string>();
  for (const r of results) {
    for (const field of Object.keys(r.fieldMappings)) {
      allFields.add(field);
    }
  }

  // 2. For each field, pick the winner and apply agreement bonus
  const unifiedMappings: CombinedAnalysisResult["fieldMappings"] = {};
  const unifiedScores: Record<string, number> = {};
  const contributions: Record<string, string> = {};

  for (const field of allFields) {
    // Collect all methods that detected this field
    const detections = results
      .filter(r => r.fieldMappings[field] && (r.confidenceScores[field] ?? 0) > 0)
      .map(r => ({
        method: r.method,
        selector: r.fieldMappings[field].selector,
        sample: r.fieldMappings[field].sample,
        confidence: r.confidenceScores[field] ?? 0,
        overallConfidence: r.overallConfidence,
        isApiSelector: r.fieldMappings[field].selector.startsWith("$."),
      }));

    if (detections.length === 0) continue;

    // Sort by: confidence DESC, then prefer DOM over API, then by overall method confidence DESC
    detections.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.isApiSelector !== b.isApiSelector) return a.isApiSelector ? 1 : -1;
      return b.overallConfidence - a.overallConfidence;
    });

    const winner = detections[0];
    const methodsDetected = detections.length;

    // Apply cross-method agreement bonus
    const boostedConfidence = applyAgreementBonus(winner.confidence, methodsDetected);

    unifiedMappings[field] = {
      selector: winner.selector,
      sample: winner.sample,
      sourceMethod: winner.method,
      methodsDetected,
    };
    unifiedScores[field] = boostedConfidence;
    contributions[field] = winner.method;
  }

  // 3. Calculate overall confidence from the unified (boosted) per-field scores
  const overallConfidence = calculateOverallConfidence(unifiedScores);

  // 4. Select best listing/item selectors from DOM-based methods
  const domMethods = results
    .filter(r => r.listingSelector !== null)
    .sort((a, b) => b.overallConfidence - a.overallConfidence);
  const bestDom = domMethods[0] || null;

  // 5. Get highest item count
  const maxItemCount = Math.max(...results.map(r => r.itemCount), 0);

  // 6. Extract metadata from specific methods
  const networkResult = results.find(r => r.method === "NETWORK_INTERCEPT");
  const crawlResult = results.find(r => r.method === "CRAWL_CLASSIFY");

  return {
    fieldMappings: unifiedMappings,
    confidenceScores: unifiedScores,
    overallConfidence,
    listingSelector: bestDom?.listingSelector ?? null,
    itemSelector: bestDom?.itemSelector ?? null,
    itemCount: maxItemCount,
    apiEndpoint: networkResult?.apiEndpoint ?? null,
    detailPagePattern: crawlResult?.detailPagePattern ?? null,
    methodContributions: contributions,
  };
}
```

### Current analyze.ts State (After Story 2-4)

The current code runs all three methods, creates three AnalysisResult records, and uses `Math.max()` of all three confidences. It does NOT populate `Site.fieldMappings`. This story replaces the `Math.max()` block and adds `fieldMappings` storage.

**Specific code to REPLACE (lines ~186-200 of current analyze.ts):**
```typescript
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
```

**Replace with:**
```typescript
// --- Combine all three analysis results ---
const combinedResult = combineAnalysisResults([
  { method: "PATTERN_MATCH", ...patternResult },
  { method: "CRAWL_CLASSIFY", ...crawlResult, detailPagePattern: crawlResult.detailPagePattern },
  { method: "NETWORK_INTERCEPT", ...networkResult, apiEndpoint: networkResult.apiEndpoint },
]);

console.info("[worker] Combined analysis result:", {
  siteUrl: site.siteUrl,
  overallConfidence: combinedResult.overallConfidence,
  fieldsDetected: Object.keys(combinedResult.fieldMappings),
  methodContributions: combinedResult.methodContributions,
});

const confidencePercent = combinedResult.overallConfidence * 100;
if (confidencePercent >= CONFIDENCE_THRESHOLD) {
  console.info("[worker] Site meets confidence threshold, routing to REVIEW:", {
    siteUrl: site.siteUrl,
    confidence: combinedResult.overallConfidence,
    threshold: CONFIDENCE_THRESHOLD,
  });
} else {
  console.warn("[worker] Site below confidence threshold, routing to REVIEW (low confidence):", {
    siteUrl: site.siteUrl,
    confidence: combinedResult.overallConfidence,
    threshold: CONFIDENCE_THRESHOLD,
  });
}

await prisma.site.update({
  where: { id: site.id },
  data: {
    status: "REVIEW",
    reviewAt: new Date(),
    confidenceScore: combinedResult.overallConfidence,
    fieldMappings: combinedResult.fieldMappings,
  },
});
```

### File Structure After This Story

```
worker/
  index.ts                    # UNCHANGED -- poll loop entry point
  jobDispatcher.ts            # UNCHANGED -- routes jobs to handlers
  jobs/
    analyze.ts                # MODIFIED -- uses combineAnalysisResults instead of Math.max
  analysis/
    patternMatch.ts           # MODIFIED -- imports calculateOverallConfidence from ../lib/confidence
    crawlClassify.ts          # MODIFIED -- imports calculateOverallConfidence from ../lib/confidence
    networkIntercept.ts       # MODIFIED -- imports calculateOverallConfidence from ../lib/confidence
    combineResults.ts         # NEW -- combination logic and CombinedAnalysisResult type
  lib/
    playwright.ts             # UNCHANGED -- Playwright browser utilities
    confidence.ts             # NEW -- shared confidence scoring function and constants
```

### Anti-Patterns to AVOID

- Do NOT create a new `AnalysisResult` database record for the combined result -- the combined mapping is stored on `Site.fieldMappings` only. The three individual AnalysisResult records are the source of truth per method.
- Do NOT modify `worker/index.ts` or `worker/jobDispatcher.ts` -- these are stable infrastructure from story 2-1
- Do NOT modify `worker/lib/playwright.ts` -- it already has the utilities needed
- Do NOT use `any` type -- define proper TypeScript interfaces for all data structures
- Do NOT throw exceptions from `combineAnalysisResults()` -- it processes data that is already safely fetched. If inputs are empty, return a zero-confidence result.
- Do NOT install any new npm packages -- all needed dependencies are already installed
- Do NOT import from `@prisma/client` -- import from `@/generated/prisma/client`
- Do NOT forget to import `CONFIDENCE_THRESHOLD` from `@/lib/constants` (not hardcode 70)
- Do NOT change the existing AnalysisResult creation logic -- each method still creates its own record as before
- Do NOT change how the three analysis methods are called -- only change what happens AFTER they all complete
- Do NOT modify the navigation failure block beyond adding the `combined` key to the return value
- Do NOT try to convert JSON path selectors to CSS selectors or vice versa -- preserve them as-is
- Do NOT forget to remove the local `calculateOverallConfidence()` from the three analysis modules after extracting to shared
- Do NOT add `pageFlow` to the Site update in this story -- page flow is populated by the Chrome extension (story 3-4)
- Do NOT use `CONFIDENCE_THRESHOLD` as a gating mechanism to prevent sites from going to REVIEW -- all sites go to REVIEW regardless of confidence (admin decides what to skip)

### Previous Story Learnings (from Stories 1-1 through 2-4)

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
16. **Confidence stored as decimal 0.0-1.0** -- NOT as percentage 0-100. `CONFIDENCE_THRESHOLD` is 70 (percentage). Compare: `confidence * 100 >= CONFIDENCE_THRESHOLD`.
17. **Existing analysis results for a site**: When a site is re-analyzed, NEW AnalysisResult records are created alongside any existing ones. The system does not delete old results.
18. **page.evaluate() helper duplication**: All helper functions used inside `page.evaluate()` must be defined INSIDE the evaluate callback. This applies to patternMatch.ts and crawlClassify.ts but NOT to this story's code (which is pure Node.js data processing).
19. **Pattern matching and crawl/classify use `page.evaluate()`** for DOM analysis. Network interception uses `page.on("response")` for HTTP response analysis.
20. **The `apiEndpoint` field on AnalysisResult** stores the discovered API URL for NETWORK_INTERCEPT. Pattern matching and crawl/classify leave this field null.
21. **The `calculateOverallConfidence()` function** is currently duplicated in all three analysis modules. This story extracts it to a shared location.
22. **analyze.ts currently always routes to REVIEW** -- the interim logic does not distinguish high vs low confidence. This story preserves that behavior but logs the distinction.
23. **The `CrawlClassifyResult` has `detailPagePattern`** and `crawledPages` -- the combine step preserves `detailPagePattern` for the scraper's navigation flow.
24. **The `NetworkInterceptResult` has `apiEndpoint`, `apiResponse`, `capturedEndpoints`** -- the combine step preserves `apiEndpoint` for the scraper.
25. **CSS selectors do NOT start with `$.`**. JSON path selectors from network interception ALWAYS start with `$.`. This is the reliable way to distinguish selector types.

### Project Structure Notes

- `worker/analysis/combineResults.ts` aligns with the architecture document: `worker/analysis/combineResults.ts`
- `worker/lib/confidence.ts` aligns with the architecture document: `worker/lib/confidence.ts`
- After this story, Epic 2 is complete. All files in the `worker/analysis/` directory are finalized.
- The `Site.fieldMappings` field is now populated, enabling the Chrome extension flow in Epic 3.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. `worker/lib/confidence.ts` exists and exports `calculateOverallConfidence`, `CORE_FIELD_WEIGHTS`, `OPTIONAL_FIELD_WEIGHTS`, `CORE_FIELDS`, `ALL_FIELDS`
4. `worker/analysis/combineResults.ts` exists and exports `combineAnalysisResults`, `CombinedAnalysisResult`, `MethodResult`
5. `worker/analysis/patternMatch.ts` imports `calculateOverallConfidence` from `../lib/confidence` (local copy removed)
6. `worker/analysis/crawlClassify.ts` imports `calculateOverallConfidence` from `../lib/confidence` (local copy removed)
7. `worker/analysis/networkIntercept.ts` imports `calculateOverallConfidence` from `../lib/confidence` (local copy removed)
8. `worker/jobs/analyze.ts` calls `combineAnalysisResults()` and uses the combined confidence (not `Math.max`)
9. `worker/jobs/analyze.ts` stores unified field mappings in `Site.fieldMappings`
10. Worker starts with `pnpm worker:dev` and processes analysis jobs
11. Submitting a real job site URL produces three AnalysisResult records PLUS a populated `Site.fieldMappings` JSON with `sourceMethod` and `methodsDetected` per field
12. Site `confidenceScore` reflects the combined confidence (with cross-method agreement bonuses applied)
13. Sites are routed to REVIEW status regardless of confidence level
14. The return value from `handleAnalysisJob` includes a `combined` key with the unified result
15. Submitting an unreachable URL still marks the site as FAILED with 0.0 confidence and three zero-confidence AnalysisResult records
16. No `any` types used in the codebase (eslint enforced)
17. No new npm packages installed (all dependencies already available)
18. Worker continues polling after any individual analysis succeeds or fails
19. No browser processes left hanging after job completion
20. Total analysis pipeline time is under 5 minutes per site

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5: Combined Results & Confidence Scoring]
- [Source: _bmad-output/planning-artifacts/prd.md#FR10 -- Combine results into unified mapping]
- [Source: _bmad-output/planning-artifacts/prd.md#FR11 -- Overall confidence score]
- [Source: _bmad-output/planning-artifacts/prd.md#FR12 -- Route to review queue by confidence]
- [Source: _bmad-output/planning-artifacts/prd.md#FR13 -- Store corrections as training data]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR1 -- Analysis pipeline < 5 min per site]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR10 -- Failed methods produce partial results]
- [Source: _bmad-output/planning-artifacts/architecture.md#Worker Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure -- worker/analysis/combineResults.ts, worker/lib/confidence.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/implementation-artifacts/2-1-worker-process-and-job-queue-infrastructure.md -- Worker infrastructure, analyze.ts]
- [Source: _bmad-output/implementation-artifacts/2-2-pattern-matching-analysis-method.md -- PatternMatchResult, confidence calculation]
- [Source: _bmad-output/implementation-artifacts/2-3-crawl-classify-analysis-method.md -- CrawlClassifyResult, detailPagePattern]
- [Source: _bmad-output/implementation-artifacts/2-4-network-interception-analysis-method.md -- NetworkInterceptResult, apiEndpoint, JSON path selectors]
- [Source: prisma/schema.prisma -- Site model fieldMappings field, AnalysisResult model]
- [Source: src/lib/constants.ts -- CONFIDENCE_THRESHOLD = 70]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
