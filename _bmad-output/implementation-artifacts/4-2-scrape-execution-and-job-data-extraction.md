# Story 4.2: Scrape Execution & Job Data Extraction

Status: done

## Story

As an admin,
I want the system to execute scrapes using my saved site configurations,
So that job listings are automatically extracted from target sites.

## Acceptance Criteria

1. **Given** a PENDING scrape job exists in the WorkerJob table **When** the worker picks it up **Then** the worker loads the site's saved configuration (field mappings, page flow, selectors) from the Site record and launches a Playwright browser instance

2. **Given** the site configuration includes a page navigation flow (listing -> detail) **When** the scrape executes **Then** Playwright navigates to the listing page, identifies all job entries using configured selectors, and follows each job link to the detail page to extract full job data

3. **Given** the site configuration is a single-page listing (no navigation flow / empty pageFlow) **When** the scrape executes **Then** Playwright extracts all job records directly from the listing page using configured selectors

4. **Given** the scrape is executing **When** data is extracted from each job listing **Then** the raw HTML/text content for each configured field is captured per job record, and the raw data is preserved exactly as extracted before any normalization

5. **Given** the scrape completes successfully **When** job records have been extracted **Then** the ScrapeRun record is updated with status COMPLETED, jobCount, totalJobs, and completedAt timestamp, and all data is committed to the database before reporting success (NFR11)

6. **Given** the scrape fails (site unreachable, timeout, selector errors) **When** an error occurs during execution **Then** the ScrapeRun status is set to FAILED with the error message and failureCategory (timeout, structure_changed, empty_results, other), and the site status is updated to FAILED, and the failure does not affect other sites or scrape jobs (NFR9)

7. **Given** a scrape is running **When** execution exceeds 2 minutes **Then** the scrape is terminated with a timeout error (NFR2) and the Playwright browser instance is fully cleaned up

8. **Given** the scrape produces zero job records (page loads but no items match selectors) **When** the scrape completes **Then** the ScrapeRun is marked as COMPLETED with jobCount 0, totalJobs 0, and failureCategory set to "empty_results" for dashboard alerting

9. **Given** the scrape handler is implemented **When** I inspect the codebase **Then** the scrape execution logic is in `worker/jobs/scrape.ts` and the job dispatcher routes SCRAPE jobs to it

## Tasks / Subtasks

- [x]Task 1: Create scrape job handler with site config loading (AC: #1, #9)
  - [x]1.1: Create `worker/jobs/scrape.ts` with `handleScrapeJob(job, site)` async function
  - [x]1.2: Extract scrapeRunId from `job.payload` JSON field (set by `createScrapeRun()` in siteService.ts)
  - [x]1.3: Load site's `fieldMappings` and `pageFlow` from the Site record (already fetched as `site` param)
  - [x]1.4: Parse fieldMappings JSON to extract per-field selectors (skip `_meta` key which contains training data)
  - [x]1.5: Determine scrape strategy: if `pageFlow` is non-empty and has entries, use multi-page flow; otherwise use single-page extraction
  - [x]1.6: Launch Playwright browser via `launchBrowser()` and `createPage()` from `worker/lib/playwright.ts`

- [x]Task 2: Implement single-page listing extraction (AC: #3, #4)
  - [x]2.1: Create `extractJobsFromListingPage(page, fieldMappings, listingSelector, itemSelector)` function in `worker/jobs/scrape.ts`
  - [x]2.2: Use `listingSelector` and `itemSelector` from the combined analysis result (stored in `fieldMappings` from combineResults) to locate the container and individual job items on the page
  - [x]2.3: For each job item element, extract text content for each mapped field using the field's CSS selector relative to the item element
  - [x]2.4: If selectors are absolute (not relative to item), fall back to extracting from the full page context
  - [x]2.5: Capture raw text content per field per job, preserving the original extracted value before any normalization
  - [x]2.6: Return an array of raw job records, each containing a map of field name -> extracted text/HTML value

- [x]Task 3: Implement multi-page navigation flow extraction (AC: #2, #4)
  - [x]3.1: Create `extractJobsWithPageFlow(page, fieldMappings, pageFlow, listingSelector, itemSelector)` function
  - [x]3.2: Navigate to the first pageFlow URL (listing page) using `page.goto()` with timeout
  - [x]3.3: On the listing page, identify all job entry elements using configured selectors
  - [x]3.4: For each job entry, extract the detail page link URL
  - [x]3.5: Navigate to each detail page URL and extract full field data using the configured selectors
  - [x]3.6: After extracting from the detail page, navigate back to the listing page (or store all URLs first, then visit sequentially)
  - [x]3.7: Collect raw job records from all detail pages into a single array
  - [x]3.8: Apply a per-detail-page timeout of 15 seconds to prevent one slow page from blocking the entire scrape

- [x]Task 4: Implement timeout management and error categorization (AC: #6, #7)
  - [x]4.1: Wrap the entire scrape execution in a timeout of 2 minutes (120,000ms) using `AbortController` or a race with `setTimeout`
  - [x]4.2: If the timeout fires, close the browser, update ScrapeRun to FAILED with failureCategory "timeout", update site to FAILED
  - [x]4.3: Categorize errors into failureCategory values: "timeout" (scrape exceeded 2 min or page navigation timeout), "structure_changed" (selectors found zero matching elements on a page that loaded successfully), "empty_results" (page loaded, selectors matched container but zero items found), "other" (unexpected errors)
  - [x]4.4: Ensure Playwright browser cleanup happens in a `finally` block regardless of error type

- [x]Task 5: Implement job record creation and ScrapeRun update (AC: #4, #5, #8)
  - [x]5.1: For each extracted raw job record, create a Job record in the database with: title (from raw), company (from raw), location (from raw), salary (from raw, nullable), description (from raw, nullable), rawData (full raw extraction as JSON), siteId, scrapeRunId
  - [x]5.2: Apply basic text cleanup to normalized fields: trim whitespace, strip HTML tags (use a simple regex or text extraction, NOT a full HTML parser)
  - [x]5.3: Validate each job record: check that required fields (title, company, location) are present and non-empty after cleanup; set validationStatus to "valid" or "invalid" with details of which fields are missing
  - [x]5.4: Store ALL records (valid and invalid) in the database
  - [x]5.5: Update the ScrapeRun record with: status COMPLETED, jobCount (total records created), totalJobs, validJobs (count of valid records), invalidJobs (count of invalid records), completedAt timestamp
  - [x]5.6: If zero records were extracted, set ScrapeRun status to COMPLETED with jobCount 0 and failureCategory "empty_results"
  - [x]5.7: Use a Prisma transaction to create all Job records and update ScrapeRun atomically (NFR11 -- data committed before reporting success)

- [x]Task 6: Wire scrape handler into job dispatcher (AC: #9)
  - [x]6.1: Update `worker/jobDispatcher.ts`: replace the `throw new Error("Scrape handler not yet implemented")` with a call to `handleScrapeJob(job, site)` from `worker/jobs/scrape.ts`
  - [x]6.2: Import `handleScrapeJob` at the top of `jobDispatcher.ts`
  - [x]6.3: The scrape handler must update the ScrapeRun status itself (not rely on the dispatcher), because the dispatcher's catch block would set site to FAILED but not update ScrapeRun with failure details and category

- [x]Task 7: Handle ScrapeRun failure updates in scrape handler (AC: #6)
  - [x]7.1: On scrape failure, update the ScrapeRun record (using scrapeRunId from payload) with: status FAILED, error message, failureCategory
  - [x]7.2: On scrape failure, update the site status to FAILED with failedAt timestamp
  - [x]7.3: Ensure the ScrapeRun update happens BEFORE the error propagates to the dispatcher (so the dispatcher's generic failure handler doesn't conflict)
  - [x]7.4: If the scrape handler handles its own errors cleanly, return a result object (even on failure) so the dispatcher marks the WorkerJob as COMPLETED (the ScrapeRun captures the actual scrape status -- the WorkerJob just tracks that the job was processed)

- [x]Task 8: Verify build, lint, and integration (AC: all)
  - [x]8.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x]8.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x]8.3: Manual verification checklist:
    - Worker dispatches SCRAPE jobs to `handleScrapeJob` (no more "not yet implemented" error)
    - Triggering a scrape from the dashboard creates WorkerJob and ScrapeRun
    - Worker picks up the SCRAPE job and executes Playwright navigation
    - For sites with field mappings, job records are extracted and stored in the Job table
    - For sites with page flow, the worker navigates listing -> detail pages
    - ScrapeRun is updated with COMPLETED status, jobCount, and completedAt
    - Failed scrapes set ScrapeRun to FAILED with error and failureCategory
    - Scrapes exceeding 2 minutes are terminated with timeout error
    - Empty results set failureCategory to "empty_results"
    - Browser instances are cleaned up after every scrape (success or failure)
    - Worker continues polling after scrape completion/failure

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **This story implements `worker/jobs/scrape.ts`** -- the core scraping engine. It replaces the `throw new Error("Scrape handler not yet implemented")` in `worker/jobDispatcher.ts`.
- **Worker accesses Prisma directly** -- no API calls. Import `prisma` from `@/lib/prisma`.
- **Prisma 7.4.x** -- import from `@/generated/prisma/client`. Enums from `@/generated/prisma/enums`.
- **Package manager:** pnpm.
- **Services layer for business logic** -- but the worker is a separate process and handles its own DB writes directly via Prisma. It does NOT call API routes or service functions.
- **Browser cleanup in `finally` blocks** -- Playwright browser instances MUST be closed. Use the existing `closeBrowser()` utility.
- **Timeout: 2 minutes (120,000ms)** for the entire scrape execution per NFR2.
- **Data committed before success** -- use a Prisma transaction to atomically write all Job records and update ScrapeRun (NFR11).

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Playwright utilities | `worker/lib/playwright.ts` | `launchBrowser()`, `createPage()`, `closeBrowser()` -- REUSE exactly |
| Job dispatcher | `worker/jobDispatcher.ts` | Replace SCRAPE throw with handler call |
| Prisma client | `src/lib/prisma.ts` | Import: `import { prisma } from "@/lib/prisma"` |
| Site model | `prisma/schema.prisma` | `fieldMappings` (Json), `pageFlow` (Json) contain scrape config |
| Job model | `prisma/schema.prisma` | Create Job records with normalized fields + rawData |
| ScrapeRun model | `prisma/schema.prisma` | Update status, jobCount, totalJobs, validJobs, invalidJobs, error, failureCategory |
| WorkerJob model | `prisma/schema.prisma` | `payload` contains `{ scrapeRunId }` -- critical link |
| Combined results structure | `worker/analysis/combineResults.ts` | Field mappings format: `{ selector, sample, sourceMethod, methodsDetected }` |
| createScrapeRun | `src/services/siteService.ts` | Creates ScrapeRun + WorkerJob with scrapeRunId in payload |

### Data Model Context

**Site.fieldMappings JSON structure** (set by combineResults + extension corrections):
```json
{
  "title": { "selector": "h2.job-title", "sample": "Software Engineer", "sourceMethod": "PATTERN_MATCH", "methodsDetected": 2 },
  "company": { "selector": "span.company-name", "sample": "Acme Corp", "sourceMethod": "CRAWL_CLASSIFY", "methodsDetected": 1 },
  "location": { "selector": "span.location", "sample": "Tel Aviv", "sourceMethod": "PATTERN_MATCH", "methodsDetected": 3 },
  "salary": { "selector": "span.salary", "sample": "$100k", "sourceMethod": "PATTERN_MATCH", "methodsDetected": 1 },
  "description": { "selector": "div.description", "sample": "We are looking for...", "sourceMethod": "CRAWL_CLASSIFY", "methodsDetected": 1 },
  "_meta": { "originalMappings": {...}, "formFields": [...], "savedAt": "2026-03-10T..." }
}
```

**Site.pageFlow JSON structure** (set by Navigate Mode in extension):
```json
[
  { "url": "https://example.com/jobs", "action": "navigate", "waitFor": ".jobs-list" },
  { "url": "https://example.com/jobs/{id}", "action": "navigate", "waitFor": ".job-detail" }
]
```
If `pageFlow` is null, empty, or has no entries, the scrape uses single-page extraction.

**WorkerJob.payload** for SCRAPE jobs:
```json
{ "scrapeRunId": "cuid_value" }
```
The scrapeRunId is essential for the scrape handler to update the ScrapeRun record.

**Combined analysis `listingSelector` and `itemSelector`**: These are stored on the site's fieldMappings if the analysis detected them, or they may be absent. The scrape handler needs to handle both cases -- when selectors are present and when they're not. If no itemSelector exists, the handler should try to use the first field's selector context to identify items.

### Scrape Execution Flow

```
1. Worker picks up PENDING SCRAPE WorkerJob
2. jobDispatcher calls handleScrapeJob(job, site)
3. Handler extracts scrapeRunId from job.payload
4. Handler loads fieldMappings + pageFlow from site record
5. Handler launches Playwright browser with 2-minute overall timeout
6. Decision: pageFlow empty? -> single-page extraction : multi-page flow
7. Single-page: navigate to siteUrl, find items, extract fields per item
8. Multi-page: navigate to listing, find items, follow detail links, extract fields per detail page
9. For each extracted record: basic text cleanup, validate required fields
10. Transaction: create all Job records + update ScrapeRun (COMPLETED, counts)
11. Handler returns result summary (doesn't throw on success or handled failure)
12. On error: update ScrapeRun (FAILED, error, category), update site (FAILED)
13. Always: close Playwright browser in finally block
```

### Field Extraction Strategy

The scrape handler should extract fields using this priority:

1. **Item-scoped extraction**: If `itemSelector` exists, find all item elements and extract each field relative to the item. Use `element.querySelector(fieldSelector)` within each item.

2. **Absolute extraction**: If no `itemSelector` or if item-scoped extraction fails, try extracting fields using absolute selectors from the page root via `page.$$eval(fieldSelector, ...)`.

3. **Handle missing selectors gracefully**: If a field's selector matches nothing, set the field value to empty string and mark it as missing in validation.

4. **Text extraction**: For each matched element, extract `textContent.trim()`. For links, also extract `href`. Store both in rawData.

### Error Categorization Logic

```typescript
function categorizeError(error: Error, context: { pageLoaded: boolean; selectorsMatched: boolean; itemsFound: number }): string {
  if (error.message.includes("timeout") || error.message.includes("Timeout")) return "timeout";
  if (context.pageLoaded && !context.selectorsMatched) return "structure_changed";
  if (context.pageLoaded && context.selectorsMatched && context.itemsFound === 0) return "empty_results";
  return "other";
}
```

### WorkerJob vs ScrapeRun Status

Important distinction: the **WorkerJob** tracks whether the background job was processed, while the **ScrapeRun** tracks the actual scrape outcome.

- If the scrape executes but finds zero results: WorkerJob = COMPLETED, ScrapeRun = COMPLETED (with jobCount 0, failureCategory "empty_results")
- If the scrape executes but times out: WorkerJob = COMPLETED (job was processed), ScrapeRun = FAILED (scrape failed)
- If the scrape handler throws unexpectedly: WorkerJob = FAILED (job failed), ScrapeRun = FAILED

The scrape handler should catch its own errors and always return a result to the dispatcher. The dispatcher marks WorkerJob as COMPLETED. The ScrapeRun status is managed entirely by the scrape handler.

### Previous Story Learnings (from Stories 1-1 through 4-1)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy`.
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path.
3. **shadcn/ui v4 uses Base UI** -- not Radix.
4. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout.
5. **Always run `pnpm build`** in both extension and main project before marking story as done.
6. **ESLint `no-explicit-any`** -- avoid `any` from the start, use proper types.
7. **API response format** -- `{ data }` for single items, `{ data, meta }` for lists.
8. **TanStack Query** for all client-side server state. Use `useMutation` for POST/PUT/DELETE.
9. **Services layer for business logic** -- API routes delegate to `src/services/`. The worker accesses Prisma directly.
10. **Status transitions enforced by `siteService.ts`** -- use `VALID_STATUS_TRANSITIONS` map. But the worker updates site status directly via Prisma (bypasses the service layer).
11. **`apiFetch` helper** is in `src/lib/fetch.ts` -- shared across hooks.
12. **ConflictError (409)** is used for duplicate scrape prevention -- exists in `src/lib/errors.ts`.
13. **WorkerJob payload field** is `Json?` -- stores `{ scrapeRunId: "..." }` for SCRAPE jobs.
14. **The worker's jobDispatcher.ts** currently has `case "SCRAPE"` that throws "not yet implemented" -- THIS STORY replaces that throw.
15. **Playwright browser cleanup** -- always use `closeBrowser()` in a `finally` block. Browser leaks are a critical resource issue.
16. **The `Prisma.InputJsonValue` type** is needed when storing JSON in Prisma -- use it for `result` field.
17. **`dotenv/config`** must be imported at the top of worker entry point -- already done in `worker/index.ts`.
18. **Worker TypeScript uses `@/` path aliases** -- resolved by `tsx` in dev mode.

### Anti-Patterns to AVOID

- Do NOT call API routes from the worker -- access Prisma directly.
- Do NOT use `any` type -- all extracted data, field mappings, and job records must be properly typed.
- Do NOT forget browser cleanup in `finally` blocks -- browser leaks will crash the server.
- Do NOT let the scrape handler throw unhandled errors to the dispatcher -- catch errors, update ScrapeRun, and return a result.
- Do NOT skip the 2-minute timeout -- NFR2 requires it.
- Do NOT create Job records outside a transaction -- all records must be committed atomically (NFR11).
- Do NOT modify the Prisma schema -- all models (Job, ScrapeRun, WorkerJob, Site) are sufficient as-is.
- Do NOT modify existing analysis code or worker infrastructure -- only add `worker/jobs/scrape.ts` and update the dispatcher's SCRAPE case.
- Do NOT modify `src/services/siteService.ts` -- the `createScrapeRun()` function is complete from story 4-1.
- Do NOT implement normalization beyond basic text cleanup (trim + strip HTML tags) -- full normalization is story 4-3.
- Do NOT implement validation beyond required field presence checks -- full validation is story 4-3.
- Do NOT add new npm dependencies -- Playwright and all needed packages are already installed.
- Do NOT process detail pages concurrently -- process them sequentially to avoid overwhelming target sites and to maintain predictable resource usage.

### Project Structure (Files to Create/Modify)

```
worker/
  jobs/
    scrape.ts              # NEW -- scrape execution handler (core of this story)
  jobDispatcher.ts         # MODIFY -- wire SCRAPE case to handleScrapeJob
```

No other files should be created or modified. This is a worker-only story.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. Worker dispatches SCRAPE jobs to `handleScrapeJob` (no more "not yet implemented")
4. Triggering a scrape from the dashboard -> worker picks up SCRAPE job -> executes Playwright
5. Single-page extraction: field selectors locate items and extract raw text per field
6. Multi-page extraction: listing -> detail page navigation and extraction
7. Job records are created in the database with normalized fields + rawData
8. ScrapeRun is updated with COMPLETED, jobCount, totalJobs, validJobs, invalidJobs, completedAt
9. Failed scrapes set ScrapeRun to FAILED with error message and failureCategory
10. 2-minute timeout terminates long-running scrapes
11. Empty results set failureCategory to "empty_results" on the ScrapeRun
12. Browser instances are always cleaned up (success and failure paths)
13. Worker continues polling for next jobs after scrape completion/failure
14. No `any` types in the codebase
15. Job records include validationStatus ("valid" or "invalid:missing_title,missing_company" etc.)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2: Scrape Execution & Job Data Extraction]
- [Source: _bmad-output/planning-artifacts/prd.md#FR25 -- Execute scrape with config]
- [Source: _bmad-output/planning-artifacts/prd.md#FR26 -- Normalize job data (basic cleanup only in this story)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR27 -- Store normalized + raw data]
- [Source: _bmad-output/planning-artifacts/prd.md#FR28 -- Validate against schema (basic presence check only in this story)]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR2 -- On-demand scrape within 2 minutes]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR9 -- Scrape failures isolated per site]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR11 -- Data committed before reporting success]
- [Source: _bmad-output/planning-artifacts/architecture.md#Worker Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure -- worker/jobs/scrape.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns -- Process Patterns]
- [Source: _bmad-output/implementation-artifacts/2-1-worker-process-and-job-queue-infrastructure.md -- Worker infrastructure]
- [Source: _bmad-output/implementation-artifacts/4-1-trigger-on-demand-test-scrape.md -- ScrapeRun + WorkerJob creation]
- [Source: prisma/schema.prisma -- Job, ScrapeRun, WorkerJob, Site models]
- [Source: worker/jobDispatcher.ts -- SCRAPE case placeholder to replace]
- [Source: worker/lib/playwright.ts -- Browser utilities to reuse]
- [Source: worker/analysis/combineResults.ts -- CombinedAnalysisResult fieldMappings format]
- [Source: src/services/siteService.ts -- createScrapeRun() with scrapeRunId in payload]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None

### Completion Notes List

- Created `worker/jobs/scrape.ts` with complete scrape execution handler
- Implemented single-page extraction (item-scoped and absolute selector strategies)
- Implemented multi-page navigation flow extraction (listing -> detail pages)
- 2-minute overall timeout (NFR2) using Promise.race
- 15-second per-detail-page timeout
- Error categorization: timeout, structure_changed, empty_results, other
- Prisma transaction for atomic Job creation + ScrapeRun update (NFR11)
- Job validation: checks required fields (title, company, location)
- Empty results handled with failureCategory "empty_results"
- Browser cleanup in finally block using closeBrowser()
- Handler catches all errors and returns result to dispatcher (never throws)
- Updated `worker/jobDispatcher.ts` to route SCRAPE jobs to handleScrapeJob

### File List

- `worker/jobs/scrape.ts` (NEW) -- scrape execution handler
- `worker/jobDispatcher.ts` (MODIFIED) -- wired SCRAPE case to handleScrapeJob
