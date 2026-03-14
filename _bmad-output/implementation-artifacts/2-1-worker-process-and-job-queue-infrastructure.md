# Story 2.1: Worker Process & Job Queue Infrastructure

Status: done

## Story

As an admin,
I want submitted sites to be automatically picked up for background processing,
So that AI analysis runs without blocking the dashboard or requiring manual triggers.

## Acceptance Criteria

1. **Given** the worker process is started **When** a site is created with status ANALYZING (via POST /api/sites) **Then** a corresponding WorkerJob record already exists in the database with status PENDING and type ANALYSIS (created by the existing `createSite()` service function in story 1-2)

2. **Given** the worker is running and polling the jobs table **When** a PENDING analysis job exists **Then** the worker picks it up within 5 seconds, sets status to IN_PROGRESS, sets `startedAt` to current timestamp, and begins execution
   - Only one job is processed at a time per worker instance (sequential polling -- no concurrency)
   - The worker uses `SELECT ... FOR UPDATE SKIP LOCKED` semantics (or Prisma equivalent) to prevent multiple worker instances from picking up the same job

3. **Given** a job is IN_PROGRESS **When** it completes successfully **Then** the job status is set to COMPLETED with a `completedAt` timestamp and the `result` JSON field stores any output data

4. **Given** a job is IN_PROGRESS **When** it fails with an error **Then** the job status is set to FAILED with the error message stored in the `error` field of the WorkerJob record
   - The site status is updated to FAILED with `failedAt` timestamp
   - The error is logged with `[worker]` prefix and structured data (siteId, jobId, error)

5. **Given** the worker process crashes or restarts **When** it starts up again **Then** any WorkerJob records left in IN_PROGRESS status are marked as FAILED with error "Worker interrupted" (NFR12)
   - The corresponding sites are updated to FAILED status with `failedAt` timestamp
   - The poll loop resumes normally after recovery

6. **Given** a Playwright browser instance is launched for a job **When** the job completes (success or failure) **Then** the browser instance is fully closed and resources are cleaned up
   - Browser cleanup happens in a `finally` block so it runs even on unhandled errors

7. **Given** the analysis job handler is invoked **When** the handler runs **Then** it executes a STUB implementation that:
   - Logs `[worker] Starting analysis for site: {siteUrl}`
   - Launches a Playwright browser instance
   - Navigates to the site URL
   - Waits 2 seconds (simulating analysis work)
   - Takes a screenshot (for verification, stored in `result` JSON as base64 or file path -- optional)
   - Closes the browser
   - Creates an AnalysisResult record with method PATTERN_MATCH, empty fieldMappings `{}`, empty confidenceScores `{}`, and overallConfidence 0.0
   - Updates the site status to REVIEW with `reviewAt` timestamp (stub always routes to review)
   - Updates the site's `confidenceScore` to 0.0
   - Returns a success result

   NOTE: This stub will be replaced by the real analysis pipeline in stories 2-2 through 2-5. The goal here is to prove the worker infrastructure works end-to-end.

8. **Given** the worker directory structure **When** I inspect the codebase **Then**:
   - The worker entry point is at `worker/index.ts` (poll loop, startup recovery, graceful shutdown)
   - Job handler dispatch is in `worker/jobDispatcher.ts` (routes job types to handlers)
   - Analysis job handler stub is in `worker/jobs/analyze.ts`
   - Shared Playwright utilities are in `worker/lib/playwright.ts` (browser launch, page creation, cleanup)
   - A `tsconfig.worker.json` extends the root tsconfig with settings appropriate for the Node.js worker (not Next.js)
   - `package.json` has scripts: `worker:dev` (development with watch) and `worker:build` + `worker:start` (production)

9. **Given** the worker is running **When** the admin creates a new site via the dashboard **Then** the full end-to-end flow works:
   - POST /api/sites creates Site (status: ANALYZING) + WorkerJob (status: PENDING, type: ANALYSIS)
   - Worker polls, picks up the PENDING job
   - Worker runs the stub analysis handler
   - Worker updates WorkerJob to COMPLETED
   - Worker updates Site status from ANALYZING to REVIEW
   - The site appears in the Sites table with REVIEW status

10. **Given** the worker process needs to shut down gracefully **When** a SIGINT or SIGTERM signal is received **Then** the worker:
    - Stops polling for new jobs
    - Waits for any in-progress job to complete (with a 30-second timeout)
    - Closes any open Playwright browser instances
    - Exits cleanly with code 0

## Tasks / Subtasks

- [x] Task 1: Create worker TypeScript configuration (AC: #8)
  - [x] 1.1: Create `tsconfig.worker.json` in the project root
    - Extends the root `tsconfig.json`
    - Override `compilerOptions`: set `module` to `"commonjs"`, `moduleResolution` to `"node"`, `outDir` to `"dist/worker"`, `rootDir` to `"."`, remove `noEmit` (set to `false`), add `esModuleInterop: true`
    - Set `include` to `["worker/**/*.ts", "src/lib/**/*.ts", "src/services/**/*.ts", "src/generated/**/*.ts"]`
    - Set `exclude` to `["node_modules"]`
    - The `@/*` path alias must resolve correctly for the worker to import from `src/lib/` and `src/services/`
  - [x] 1.2: Add scripts to `package.json`:
    - `"worker:dev": "npx tsx --watch worker/index.ts"` -- for development with auto-reload
    - `"worker:build": "npx tsc -p tsconfig.worker.json"` -- compile for production
    - `"worker:start": "node dist/worker/index.js"` -- run compiled worker
  - [x] 1.3: Install `tsx` as a dev dependency: `pnpm add -D tsx`
    - `tsx` provides TypeScript execution with path alias support (reads `tsconfig.json` paths)
    - This is the recommended way to run TypeScript workers in development

- [x] Task 2: Create Playwright browser management utilities (AC: #6, #8)
  - [x] 2.1: Install Playwright: `pnpm add playwright`
    - Also run `pnpm exec playwright install chromium` to install the Chromium browser binary
    - Only install `chromium` (not firefox/webkit) to save disk space
  - [x] 2.2: Create `worker/lib/playwright.ts` with:
    - `launchBrowser()`: launches headless Chromium with safe defaults
      - `chromium.launch({ headless: true })` from `playwright`
      - Returns the `Browser` instance
    - `createPage(browser: Browser)`: creates a new browser context and page
      - Sets a reasonable viewport (1280x800)
      - Sets a standard user agent
      - Returns `{ context, page }`
    - `closeBrowser(browser: Browser | null)`: safely closes a browser instance
      - Wraps `browser.close()` in try/catch to prevent errors during cleanup
      - Logs cleanup with `[worker]` prefix
    - All functions use the `playwright` package (NOT `playwright-core`)

- [x] Task 3: Create the worker poll loop and job dispatcher (AC: #2, #3, #4, #5, #8, #10)
  - [x] 3.1: Create `worker/index.ts` (entry point) with:
    - `main()` async function that:
      1. Logs `[worker] Starting worker process...`
      2. Calls `recoverInterruptedJobs()` to handle crash recovery (AC #5)
      3. Enters the poll loop calling `pollForJobs()` on a 5-second interval
      4. Sets up signal handlers for SIGINT and SIGTERM for graceful shutdown (AC #10)
    - `recoverInterruptedJobs()` async function:
      - Queries WorkerJob records with `status: "IN_PROGRESS"`
      - For each found job, updates status to FAILED with error "Worker interrupted"
      - For each found job, updates the associated Site status to FAILED with `failedAt: new Date()`
      - Logs count of recovered jobs: `[worker] Recovered N interrupted jobs`
    - `pollForJobs()` async function:
      - Queries for one WorkerJob with `status: "PENDING"`, ordered by `createdAt` ASC (FIFO)
      - If no job found, return silently
      - If job found, call `processJob(job)`
    - Graceful shutdown handler:
      - Sets a `isShuttingDown` flag to stop the poll loop
      - Waits for in-progress job with 30-second timeout
      - Calls `closeBrowser()` if any browser is active
      - Exits with `process.exit(0)`
    - The poll loop uses `setInterval` with 5-second interval (NOT recursive setTimeout)
    - The poll loop is guarded by `isProcessing` flag to prevent overlapping job processing
  - [x] 3.2: Create `worker/jobDispatcher.ts` with:
    - `processJob(job: WorkerJob)` async function:
      1. Update job status to IN_PROGRESS with `startedAt: new Date()` and increment `attempts`
      2. Fetch the associated Site record (need `siteUrl` for the handler)
      3. Dispatch to handler based on `job.type`:
         - `"ANALYSIS"` -> call `handleAnalysisJob(job, site)`
         - `"SCRAPE"` -> log `[worker] Scrape handler not yet implemented` and throw (for future story 4-2)
      4. On success: update job status to COMPLETED with `completedAt: new Date()` and store result in `result` JSON field
      5. On failure (catch): update job status to FAILED with error message in `error` field, update site status to FAILED with `failedAt`
      6. All status updates use direct Prisma calls (worker does NOT use API routes)
    - Import job handlers from `worker/jobs/`
    - Use try/catch/finally pattern for robust error handling

- [ ] Task 4: Create the analysis job handler stub (AC: #7, #6, #9)
  - [ ] 4.1: Create `worker/jobs/analyze.ts` with:
    - `handleAnalysisJob(job: WorkerJob, site: Site)` async function:
      1. Log `[worker] Starting analysis for site: ${site.siteUrl}`
      2. Call `launchBrowser()` from `worker/lib/playwright.ts`
      3. Create a page with `createPage(browser)`
      4. Navigate to `site.siteUrl` with `page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 })`
      5. Wait 2 seconds: `await new Promise(resolve => setTimeout(resolve, 2000))`
      6. Get the page title: `const title = await page.title()`
      7. Close browser in `finally` block via `closeBrowser(browser)`
      8. Create an AnalysisResult record:
         ```
         prisma.analysisResult.create({
           data: {
             siteId: site.id,
             method: "PATTERN_MATCH",
             fieldMappings: {},
             confidenceScores: {},
             overallConfidence: 0.0,
           }
         })
         ```
      9. Update the site: set `confidenceScore: 0.0`, `status: "REVIEW"`, `reviewAt: new Date()`
      10. Log `[worker] Analysis complete for site: ${site.siteUrl} (stub)`
      11. Return `{ pageTitle: title, method: "PATTERN_MATCH", confidence: 0.0 }` as the job result
    - The browser variable must be declared OUTSIDE the try block and cleaned up in `finally`
    - Wrap `page.goto()` in its own try/catch so navigation failures are handled gracefully (site might be unreachable)
    - If navigation fails, still create an AnalysisResult with overallConfidence 0.0 and update site to FAILED (not REVIEW)

- [ ] Task 5: Wire imports and ensure Prisma access from worker (AC: #8, #9)
  - [ ] 5.1: Verify the worker can import from `src/lib/prisma.ts` using the `@/*` path alias
    - `tsx` reads `tsconfig.json` paths and resolves `@/*` correctly
    - For production `worker:build`, path aliases need `tsc-alias` or equivalent. Add `pnpm add -D tsc-alias` and update `worker:build` to: `"tsc -p tsconfig.worker.json && tsc-alias -p tsconfig.worker.json"`
    - Alternatively, the worker can use relative imports from `../../src/lib/prisma` instead of `@/lib/prisma` to avoid alias issues in compiled output. DECISION: Use `@/*` aliases in source code (works with `tsx`); handle production build alias resolution later (Phase 2 deployment concern).
  - [ ] 5.2: Verify the worker can import `WorkerJob` and `Site` types from `@/generated/prisma/client`
    - Import: `import type { WorkerJob, Site } from "@/generated/prisma/client"`
    - Import enums: `import { WorkerJobStatus, WorkerJobType, SiteStatus, AnalysisMethod } from "@/generated/prisma/enums"`
  - [ ] 5.3: Ensure the worker loads environment variables:
    - Add `import "dotenv/config"` at the very top of `worker/index.ts` (before any other imports)
    - The `dotenv` package is already a devDependency (used by `prisma.config.ts`)
    - This ensures `DATABASE_URL` and other env vars are available when the worker starts

- [ ] Task 6: Add an API endpoint to trigger analysis (AC: #9)
  - [ ] 6.1: Create `src/app/api/sites/[id]/analyze/route.ts` with a POST handler:
    - Parse the site ID from params (using `await params` pattern)
    - Fetch the site by ID (throw NotFoundError if not found)
    - Validate the site is in a state that allows analysis (status must be ANALYZING or use the existing `updateSiteStatus` to transition)
    - Create a new WorkerJob record: `{ siteId, type: "ANALYSIS", status: "PENDING" }`
    - Return `successResponse({ jobId, siteId, type: "ANALYSIS", status: "PENDING" }, 201)`
    - This endpoint is not strictly needed for the primary flow (createSite already creates the WorkerJob), but provides a way to manually trigger re-analysis from the API
  - [ ] 6.2: Add `createAnalysisJob(siteId: string)` to `src/services/siteService.ts`
    - Verify no PENDING or IN_PROGRESS analysis job already exists for this site (prevent duplicates)
    - If duplicate found, throw a new `ConflictError("An analysis is already in progress for this site")`
    - Create and return the WorkerJob record

- [ ] Task 7: Verify end-to-end flow (AC: #1-10)
  - [ ] 7.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [ ] 7.2: Run `pnpm lint` -- must pass without warnings or errors
  - [ ] 7.3: Start the Next.js dev server: `pnpm dev`
  - [ ] 7.4: Start the worker in a separate terminal: `pnpm worker:dev`
  - [ ] 7.5: Create a new site via the dashboard (paste any URL)
  - [ ] 7.6: Observe worker logs: should show pickup, Playwright launch, navigation, analysis stub, completion
  - [ ] 7.7: Verify in the database (Prisma Studio `pnpm prisma:studio` or psql):
    - WorkerJob record has status COMPLETED, completedAt set, result JSON populated
    - Site record has status REVIEW, reviewAt set, confidenceScore 0.0
    - AnalysisResult record exists with method PATTERN_MATCH, overallConfidence 0.0
  - [ ] 7.8: Verify error handling: submit a site with an unreachable URL (e.g., `https://this-does-not-exist-12345.com`)
    - Worker should handle the navigation failure gracefully
    - Site should transition to FAILED (or REVIEW with 0 confidence, depending on stub behavior)
    - WorkerJob should complete (not crash the worker)
    - Worker should continue polling for next jobs
  - [ ] 7.9: Test crash recovery: kill the worker while it's processing (Ctrl+C during a job)
    - Restart worker
    - Verify interrupted job is marked FAILED with "Worker interrupted"
  - [ ] 7.10: Test graceful shutdown: send SIGTERM while idle -- worker exits cleanly

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Import enums from `@/generated/prisma/enums`. Requires driver adapter. Generator output is `../src/generated/prisma`.
- **Zod 4.x** (v4.3.6): Uses `z.enum()` for enum validation. Do NOT use `z.string().url()` -- use `z.url()`.
- **TanStack Query v5** (`@tanstack/react-query` v5.90.21): Use `useMutation` with `onSuccess` for cache invalidation.
- **Sonner** (v2.0.7): Use `toast.success()`, `toast.error()`. Already mounted in root layout.
- **Services layer**: ALL business logic in `src/services/`, NOT in API route handlers. Route handlers: validate input -> call service -> format response.
- **shadcn/ui uses Base UI (NOT Radix)**: Dialog is `@base-ui/react/dialog`, DropdownMenu is `@base-ui/react/menu`.
- **Worker accesses Prisma directly** -- the worker does NOT call API routes. It imports `prisma` from `@/lib/prisma` and reads/writes the database directly. This is per the architecture document: "Worker does **not** use API routes -- it accesses Prisma directly (same process boundary as the DB)".

### Worker Architecture Overview

The worker is a **separate Node.js process** that runs alongside the Next.js app. It shares the same codebase, database, and Prisma client, but runs as an independent process.

```
┌─────────────────────────────┐    ┌──────────────────────────┐
│   Next.js App               │    │   Worker Process          │
│   (Dashboard + API)         │    │   (Background Jobs)       │
│                             │    │                          │
│   POST /api/sites           │    │   Poll Loop (5s)          │
│   → createSite()            │    │   → Query PENDING jobs    │
│   → Creates WorkerJob       │    │   → Process one at a time │
│     (PENDING, ANALYSIS)     │    │   → Update job status     │
│                             │    │   → Update site status    │
└──────────┬──────────────────┘    └─────────┬────────────────┘
           │                                  │
           │     ┌─────────────────────┐      │
           └────►│   PostgreSQL        │◄─────┘
                 │   (jobs table)       │
                 └─────────────────────┘
```

**Data Flow:**
1. Dashboard POST /api/sites → `createSite()` creates Site + WorkerJob (PENDING)
2. Worker polls `WorkerJob` table every 5 seconds
3. Worker picks up PENDING job (FIFO), sets IN_PROGRESS
4. Worker dispatches to handler (analyze or scrape)
5. Handler runs (Playwright for analysis), creates results
6. Worker updates job status (COMPLETED/FAILED)
7. Worker updates site status (REVIEW/FAILED)

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Prisma client singleton | `src/lib/prisma.ts` | Uses PrismaPg driver adapter. Import: `import { prisma } from "@/lib/prisma"` |
| Site service | `src/services/siteService.ts` | Has `createSite()`, `listSites()`, `getStatusCounts()`, `updateSiteStatus()`, `deleteSite()`. ADD new functions here. |
| Error classes | `src/lib/errors.ts` | `AppError`, `NotFoundError`, `ValidationError`, `ConflictError`, `DuplicateSiteError`, `InvalidTransitionError` |
| API response helpers | `src/lib/api-utils.ts` | `successResponse()`, `listResponse()`, `errorResponse()`, `formatErrorResponse()` |
| Constants | `src/lib/constants.ts` | `CONFIDENCE_THRESHOLD = 70`, `DEFAULT_PAGE_SIZE = 50`, status labels |
| Config | `src/lib/config.ts` | `config.apiToken`, `config.databaseUrl` |
| Types | `src/lib/types.ts` | `ApiResponse<T>`, `ApiErrorResponse`, `PaginationParams`, `SiteConfig`, `FieldMapping` |
| Validators | `src/lib/validators.ts` | `createSiteSchema`, `updateSiteSchema`, `paginationSchema`, `sortSchema`, `updateSiteStatusSchema` |
| Sites API route | `src/app/api/sites/route.ts` | GET + POST -- DO NOT modify |
| Sites [id] API route | `src/app/api/sites/[id]/route.ts` | PATCH + DELETE -- DO NOT modify |
| dotenv | `devDependencies` | Already installed (used by `prisma.config.ts`). Import as `import "dotenv/config"` |

### Prisma Model Reference (WorkerJob)

```prisma
model WorkerJob {
  id          String          @id @default(cuid())
  siteId      String
  site        Site            @relation(fields: [siteId], references: [id])
  type        WorkerJobType
  status      WorkerJobStatus @default(PENDING)
  payload     Json?
  result      Json?
  error       String?
  attempts    Int             @default(0)
  createdAt   DateTime        @default(now())
  startedAt   DateTime?
  completedAt DateTime?

  @@index([siteId])
  @@index([status, type])
}

enum WorkerJobStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
}

enum WorkerJobType {
  ANALYSIS
  SCRAPE
}
```

**Key fields used by the worker:**
- `status`: PENDING -> IN_PROGRESS -> COMPLETED/FAILED
- `type`: ANALYSIS (this story) or SCRAPE (future story 4-2)
- `attempts`: incremented each time the job is picked up
- `startedAt`: set when job transitions to IN_PROGRESS
- `completedAt`: set when job transitions to COMPLETED
- `error`: set when job transitions to FAILED (human-readable error string)
- `result`: JSON output from the job handler (stored on COMPLETED)
- `payload`: optional JSON input for the job handler (not used for ANALYSIS, may be used for SCRAPE)

### Prisma Model Reference (AnalysisResult)

```prisma
model AnalysisResult {
  id                String         @id @default(cuid())
  siteId            String
  site              Site           @relation(fields: [siteId], references: [id])
  method            AnalysisMethod
  fieldMappings     Json
  confidenceScores  Json
  overallConfidence Float
  apiEndpoint       String?
  createdAt         DateTime       @default(now())

  @@index([siteId])
}

enum AnalysisMethod {
  PATTERN_MATCH
  CRAWL_CLASSIFY
  NETWORK_INTERCEPT
}
```

### Prisma Model Reference (Site -- status fields)

```prisma
model Site {
  id              String      @id @default(cuid())
  siteUrl         String      @unique
  status          SiteStatus  @default(ANALYZING)
  confidenceScore Float?
  fieldMappings   Json?
  pageFlow        Json?
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

### Implementation Patterns (Code Samples)

#### worker/index.ts (Entry Point)

```typescript
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { processJob } from "./jobDispatcher";

let isShuttingDown = false;
let isProcessing = false;

const POLL_INTERVAL_MS = 5000;

async function recoverInterruptedJobs() {
  const interrupted = await prisma.workerJob.findMany({
    where: { status: "IN_PROGRESS" },
    include: { site: true },
  });

  if (interrupted.length === 0) return;

  for (const job of interrupted) {
    await prisma.workerJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: "Worker interrupted" },
    });

    await prisma.site.update({
      where: { id: job.siteId },
      data: { status: "FAILED", failedAt: new Date() },
    });
  }

  console.info(`[worker] Recovered ${interrupted.length} interrupted job(s)`);
}

async function pollForJobs() {
  if (isShuttingDown || isProcessing) return;

  try {
    // Find the oldest PENDING job (FIFO order)
    const job = await prisma.workerJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    if (!job) return;

    isProcessing = true;
    await processJob(job);
  } catch (error) {
    console.error("[worker] Poll error:", error);
  } finally {
    isProcessing = false;
  }
}

async function main() {
  console.info("[worker] Starting worker process...");

  await recoverInterruptedJobs();

  const intervalId = setInterval(pollForJobs, POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.info(`[worker] Received ${signal}. Shutting down gracefully...`);
    isShuttingDown = true;
    clearInterval(intervalId);

    // Wait for in-progress job to complete (max 30 seconds)
    const shutdownStart = Date.now();
    while (isProcessing && Date.now() - shutdownStart < 30_000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (isProcessing) {
      console.warn("[worker] Timed out waiting for in-progress job. Forcing exit.");
    }

    console.info("[worker] Worker shut down cleanly.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.info(`[worker] Polling for jobs every ${POLL_INTERVAL_MS / 1000}s...`);
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
```

#### worker/jobDispatcher.ts (Job Dispatch)

```typescript
import { prisma } from "@/lib/prisma";
import type { WorkerJob } from "@/generated/prisma/client";
import { handleAnalysisJob } from "./jobs/analyze";

export async function processJob(job: WorkerJob) {
  console.info(`[worker] Processing job ${job.id} (type: ${job.type}, site: ${job.siteId})`);

  // Update job to IN_PROGRESS
  await prisma.workerJob.update({
    where: { id: job.id },
    data: {
      status: "IN_PROGRESS",
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  // Fetch associated site
  const site = await prisma.site.findUnique({ where: { id: job.siteId } });
  if (!site) {
    await prisma.workerJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: `Site ${job.siteId} not found` },
    });
    console.error(`[worker] Site not found for job ${job.id}: ${job.siteId}`);
    return;
  }

  try {
    let result: Record<string, unknown>;

    switch (job.type) {
      case "ANALYSIS":
        result = await handleAnalysisJob(job, site);
        break;
      case "SCRAPE":
        throw new Error("Scrape handler not yet implemented");
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    // Mark job as completed
    await prisma.workerJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        result: result as Record<string, unknown>,
      },
    });

    console.info(`[worker] Job ${job.id} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark job as failed
    await prisma.workerJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: errorMessage,
      },
    });

    // Update site to FAILED
    await prisma.site.update({
      where: { id: job.siteId },
      data: {
        status: "FAILED",
        failedAt: new Date(),
      },
    });

    console.error(`[worker] Job ${job.id} failed:`, { siteId: job.siteId, error: errorMessage });
  }
}
```

#### worker/jobs/analyze.ts (Analysis Stub Handler)

```typescript
import { prisma } from "@/lib/prisma";
import type { WorkerJob, Site } from "@/generated/prisma/client";
import { launchBrowser, createPage, closeBrowser } from "../lib/playwright";
import type { Browser } from "playwright";

export async function handleAnalysisJob(
  job: WorkerJob,
  site: Site
): Promise<Record<string, unknown>> {
  console.info(`[worker] Starting analysis for site: ${site.siteUrl}`);

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const { page } = await createPage(browser);

    // Navigate to the site
    let pageTitle = "Navigation failed";
    try {
      await page.goto(site.siteUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      pageTitle = await page.title();
    } catch (navError) {
      console.warn(`[worker] Navigation failed for ${site.siteUrl}:`, navError);
      // Navigation failure -- site may be unreachable
      // Create a result with zero confidence and mark site as FAILED
      await prisma.analysisResult.create({
        data: {
          siteId: site.id,
          method: "PATTERN_MATCH",
          fieldMappings: {},
          confidenceScores: {},
          overallConfidence: 0.0,
        },
      });

      await prisma.site.update({
        where: { id: site.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          confidenceScore: 0.0,
        },
      });

      return {
        pageTitle: "Navigation failed",
        method: "PATTERN_MATCH",
        confidence: 0.0,
        error: navError instanceof Error ? navError.message : String(navError),
      };
    }

    // Simulate analysis work (stub -- replaced in stories 2-2 through 2-5)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.info(`[worker] Page loaded: "${pageTitle}" for ${site.siteUrl}`);

    // Create stub AnalysisResult
    await prisma.analysisResult.create({
      data: {
        siteId: site.id,
        method: "PATTERN_MATCH",
        fieldMappings: {},
        confidenceScores: {},
        overallConfidence: 0.0,
      },
    });

    // Update site to REVIEW status with confidence 0.0 (stub)
    await prisma.site.update({
      where: { id: site.id },
      data: {
        status: "REVIEW",
        reviewAt: new Date(),
        confidenceScore: 0.0,
      },
    });

    console.info(`[worker] Analysis complete for site: ${site.siteUrl} (stub)`);

    return {
      pageTitle,
      method: "PATTERN_MATCH",
      confidence: 0.0,
    };
  } finally {
    await closeBrowser(browser);
  }
}
```

#### worker/lib/playwright.ts (Browser Utilities)

```typescript
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export async function launchBrowser(): Promise<Browser> {
  console.info("[worker] Launching Playwright browser...");
  const browser = await chromium.launch({
    headless: true,
  });
  return browser;
}

export async function createPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  return { context, page };
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
    console.info("[worker] Browser closed.");
  } catch (error) {
    console.warn("[worker] Error closing browser:", error);
  }
}
```

#### tsconfig.worker.json

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist/worker",
    "noEmit": false,
    "esModuleInterop": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": [
    "worker/**/*.ts",
    "src/lib/**/*.ts",
    "src/services/**/*.ts",
    "src/generated/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

**IMPORTANT -- `tsx` for development**: In development, the worker runs via `npx tsx --watch worker/index.ts`. `tsx` handles TypeScript compilation and path alias resolution automatically (reads `tsconfig.json` `paths`). No need for `ts-node`, `ts-node-dev`, or other runners. The `tsconfig.worker.json` is only needed for production builds via `tsc`.

#### API route: POST /api/sites/[id]/analyze/route.ts

```typescript
import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { createAnalysisJob } from "@/services/siteService";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workerJob = await createAnalysisJob(id);
    return successResponse(workerJob, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
```

#### Service function: createAnalysisJob (src/services/siteService.ts)

Add this function to the existing `src/services/siteService.ts`:

```typescript
export async function createAnalysisJob(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  // Check for existing pending/in-progress analysis job
  const existingJob = await prisma.workerJob.findFirst({
    where: {
      siteId,
      type: "ANALYSIS",
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });

  if (existingJob) {
    throw new ConflictError("An analysis is already in progress for this site");
  }

  const workerJob = await prisma.workerJob.create({
    data: {
      siteId,
      type: "ANALYSIS",
      status: "PENDING",
    },
  });

  return workerJob;
}
```

### package.json Script Additions

Add these scripts to the existing `package.json` `scripts` section:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "worker:dev": "npx tsx --watch worker/index.ts",
    "worker:build": "tsc -p tsconfig.worker.json",
    "worker:start": "node dist/worker/index.js"
  }
}
```

### New Dependencies

| Package | Type | Purpose |
|---------|------|---------|
| `playwright` | production | Headless browser automation for site analysis and scraping |
| `tsx` | devDependency | TypeScript execution with path alias support for worker dev mode |

Install commands:
```bash
pnpm add playwright
pnpm add -D tsx
pnpm exec playwright install chromium
```

**IMPORTANT:** After installing Playwright, you MUST run `pnpm exec playwright install chromium` to download the Chromium browser binary. Without this, `chromium.launch()` will fail with a "Executable doesn't exist" error.

### Project Structure (Files to Create/Modify)

```
worker/                              # NEW directory (top-level, alongside src/)
  index.ts                           # NEW -- poll loop entry point
  jobDispatcher.ts                   # NEW -- routes jobs to handlers
  jobs/
    analyze.ts                       # NEW -- analysis job handler (stub)
  lib/
    playwright.ts                    # NEW -- Playwright browser utilities

src/
  services/
    siteService.ts                   # MODIFY -- add createAnalysisJob()
  app/
    api/
      sites/
        [id]/
          analyze/
            route.ts                 # NEW -- POST handler for triggering analysis

tsconfig.worker.json                 # NEW -- TypeScript config for worker
package.json                         # MODIFY -- add worker scripts + new dependencies
```

### Logging Convention

All worker logs use the `[worker]` prefix for easy filtering. Structured data is passed as a second argument to console methods:

```typescript
// Info -- normal operations
console.info("[worker] Starting worker process...");
console.info("[worker] Processing job:", { jobId: job.id, type: job.type, siteId: job.siteId });
console.info("[worker] Analysis complete:", { siteId: site.id, confidence: 0.0 });

// Warning -- expected but notable
console.warn("[worker] Navigation failed:", { siteUrl: site.siteUrl, error: errorMessage });

// Error -- unexpected failures
console.error("[worker] Job failed:", { jobId: job.id, siteId: job.siteId, error: errorMessage });
console.error("[worker] Fatal error:", error);
```

### API Endpoints for This Story

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| POST | `/api/sites/[id]/analyze` | Trigger analysis job | (none) | `{ data: WorkerJob }` (201) |

The primary flow does NOT require a new API endpoint -- `POST /api/sites` (from story 1-2) already creates the WorkerJob. The analyze endpoint is provided as a convenience for manual re-triggering.

### HTTP Status Codes for This Story

| Scenario | Code |
|----------|------|
| Analysis job created successfully | 201 |
| Site not found | 404 |
| Analysis already in progress | 409 |
| Unauthorized (no/bad token) | 401 (handled by proxy.ts) |
| Server error | 500 |

### Anti-Patterns to AVOID

- Do NOT put worker business logic in API route handlers -- the worker accesses Prisma DIRECTLY
- Do NOT use `any` type -- all functions must have proper TypeScript types
- Do NOT use `middleware.ts` -- Next.js 16 uses `proxy.ts`
- Do NOT import Prisma from `@prisma/client` -- import from `@/generated/prisma/client`, enums from `@/generated/prisma/enums`
- Do NOT create bare API responses -- always use `successResponse()`, `errorResponse()`, or `formatErrorResponse()`
- Do NOT use `ts-node` or `ts-node-dev` -- use `tsx` (better ESM support, faster, path alias support)
- Do NOT use `playwright-core` -- use the full `playwright` package (includes browser binaries)
- Do NOT catch errors in the poll loop and swallow them -- always log with `[worker]` prefix
- Do NOT process multiple jobs concurrently -- one at a time per worker instance
- Do NOT forget the `finally` block for Playwright browser cleanup -- browser leaks are a serious resource issue
- Do NOT modify the existing `createSite()` function -- it already creates the WorkerJob correctly
- Do NOT install npm packages without using pnpm -- the project uses pnpm exclusively
- Do NOT forget to run `pnpm exec playwright install chromium` after adding Playwright dependency
- Do NOT use `setInterval` with async callback directly -- guard with `isProcessing` flag
- Do NOT skip the dotenv import at the top of `worker/index.ts` -- the worker needs env vars for database access
- Do NOT modify existing API routes (`src/app/api/sites/route.ts`, `src/app/api/sites/[id]/route.ts`) -- only ADD new files
- Do NOT use `process.env.DATABASE_URL` directly in the worker -- import `prisma` from `@/lib/prisma.ts` which handles the connection
- Do NOT use `{ params: { id: string } }` in route handlers -- Next.js 16.1 wraps params in a Promise: `{ params: Promise<{ id: string }> }`
- Do NOT add Playwright to `devDependencies` -- it must be in `dependencies` because the worker runs in production

### Previous Story Learnings (from Stories 1-1 through 1-4)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy` (not `middleware`).
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path configured in schema.prisma generator block. Enums from `@/generated/prisma/enums`.
3. **Prisma 7.4 requires driver adapter** -- PrismaClient instantiated with `{ adapter }` in `src/lib/prisma.ts`. Uses `@prisma/adapter-pg` + `pg` pool.
4. **`sonner` is used for toasts** -- import `{ toast }` from "sonner" and use `<Toaster />` component (already in root layout).
5. **shadcn/ui v4 uses Base UI** -- Dialog is `@base-ui/react/dialog`, DropdownMenu is `@base-ui/react/menu`. NOT Radix.
6. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
7. **Always run `pnpm build`** before marking story as done.
8. **Code review found issues in story 1-1** including loose string types. Use specific union types instead of `string`.
9. **Service layer pattern established** -- `src/services/siteService.ts` already has all site CRUD. Add new functions here.
10. **`apiFetch` helper** exists in `src/hooks/useSites.ts` -- handles auth tokens and 204 responses.
11. **ESLint `no-explicit-any`** -- avoid `any` from the start.
12. **Zod 4.x uses `z.enum([...])`** for enum validation.
13. **Query invalidation cascades** -- invalidating `["sites"]` refreshes both table data and tab counts.
14. **Next.js 16 dynamic route params are Promises** -- must `await params` in route handlers.
15. **`dotenv` is already installed** as a devDependency (used by `prisma.config.ts`).
16. **Worker creates WorkerJob on re-analyze** -- story 1-4 already creates WorkerJob when `updateSiteStatus()` transitions to ANALYZING. The worker must be ready to pick these up.
17. **`pg` package already installed** -- `pg` (v8.20.0) and `@types/pg` are in dependencies. No need to reinstall.
18. **Database connection** -- the `prisma.ts` singleton uses a `pg.Pool` with `config.databaseUrl`. The worker reuses this same singleton, so the database connection is shared.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. Worker starts with `pnpm worker:dev` and logs "Starting worker process..."
4. Worker recovers interrupted jobs on startup (if any)
5. Worker polls every 5 seconds and picks up PENDING jobs
6. Creating a new site via the dashboard triggers the analysis stub in the worker
7. Worker launches Playwright, navigates to the site URL, waits 2 seconds, closes browser
8. WorkerJob transitions: PENDING -> IN_PROGRESS -> COMPLETED (check database)
9. Site transitions: ANALYZING -> REVIEW (check database)
10. AnalysisResult record created with method PATTERN_MATCH and overallConfidence 0.0
11. Unreachable URLs are handled gracefully (site -> FAILED, worker continues)
12. Worker stops cleanly on SIGINT/SIGTERM
13. Interrupted jobs are recovered on restart (marked FAILED with "Worker interrupted")
14. POST /api/sites/[id]/analyze creates a new analysis job (201)
15. POST /api/sites/[id]/analyze returns 409 if analysis already in progress
16. POST /api/sites/[id]/analyze returns 404 for non-existent site
17. No browser processes left hanging after job completion (check `ps aux | grep chrom`)
18. Worker directory structure matches the spec: `worker/index.ts`, `worker/jobDispatcher.ts`, `worker/jobs/analyze.ts`, `worker/lib/playwright.ts`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1: Worker Process & Job Queue Infrastructure]
- [Source: _bmad-output/planning-artifacts/prd.md#FR7-FR12, NFR1, NFR9, NFR10, NFR12]
- [Source: _bmad-output/planning-artifacts/architecture.md#Worker Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Infrastructure & Deployment]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions -- Background jobs]
- [Source: _bmad-output/implementation-artifacts/1-2-submit-new-site.md -- WorkerJob creation in createSite()]
- [Source: _bmad-output/implementation-artifacts/1-4-manage-site-lifecycle.md -- WorkerJob creation on re-analyze]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
