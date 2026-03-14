# Story 4.1: Trigger On-Demand Test Scrape

Status: done

## Story

As an admin,
I want to trigger a test scrape for a configured site from the dashboard and see scrape status updates,
So that I can validate the site configuration produces correct job data before relying on it.

## Acceptance Criteria

1. **Given** a site has status ACTIVE or REVIEW and has a saved configuration (field mappings not null) **When** I click the "Scrape" action button on the site row in the Sites table **Then** a scrape job is created in the WorkerJob table with type SCRAPE and status PENDING, and a ScrapeRun record is created linked to the site with status IN_PROGRESS, and I see a toast: "Test scrape started for [site URL]"

2. **Given** the config save in the Chrome extension auto-triggers a scrape **When** the POST /api/sites/[id]/scrape endpoint is called **Then** the same scrape job creation flow executes as a manual trigger, and the API returns `{ data }` with the ScrapeRun record including id, siteId, status, and createdAt

3. **Given** a scrape is already in progress for a site (existing ScrapeRun with status IN_PROGRESS) **When** I attempt to trigger another scrape for the same site **Then** the API returns a 409 error: "A scrape is already in progress for this site" and no duplicate scrape job is created

4. **Given** a site has no saved configuration (fieldMappings is null or empty) **When** I attempt to trigger a scrape **Then** the API returns a 409 validation error: "Site has no field mappings configured. Save config before triggering a scrape."

5. **Given** a scrape has been triggered **When** I view the site in the Sites table **Then** the site row shows a visual indicator that a scrape is in progress (e.g., a spinner or "Scraping..." badge), and the Scrape button is disabled to prevent duplicate triggers

6. **Given** scrape runs exist for a site **When** I view the site details or dashboard **Then** I can see the latest scrape run status (IN_PROGRESS, COMPLETED, FAILED) for each site

7. **Given** the POST /api/sites/[id]/scrape endpoint is called **When** the ScrapeRun and WorkerJob are created **Then** the ScrapeRun includes a reference to the siteId, and the WorkerJob includes a payload with the scrapeRunId so the worker can update it later

## Tasks / Subtasks

- [x] Task 1: Enhance POST /api/sites/[id]/scrape endpoint and service layer (AC: #2, #3, #4, #7)
  - [x] 1.1: Update `createScrapeRun()` in `src/services/siteService.ts` to include `scrapeRunId` in the WorkerJob payload so the worker can link back to the ScrapeRun when processing
  - [x] 1.2: Update `createScrapeRun()` to accept sites with status ACTIVE or REVIEW (not just any status) -- validate site status is appropriate for scraping
  - [x] 1.3: Ensure the existing POST /api/sites/[id]/scrape route handler returns proper `{ data }` response with the full ScrapeRun record (id, siteId, status, createdAt)

- [x] Task 2: Create scrape-related service function for querying latest scrape status (AC: #5, #6)
  - [x] 2.1: Add `getLatestScrapeRun(siteId: string)` function to `src/services/siteService.ts` -- returns the most recent ScrapeRun for a site (by createdAt desc), or null
  - [x] 2.2: Add `getLatestScrapeRunsBySiteIds(siteIds: string[])` batch function for efficient table rendering -- returns a map of siteId -> latest ScrapeRun
  - [x] 2.3: Create GET /api/sites/[id]/scrape endpoint (`route.ts` GET handler) that returns the latest ScrapeRun for a site in `{ data }` format

- [x] Task 3: Add `useScrapeRun` hook and `useTriggerScrape` mutation (AC: #1, #2, #5)
  - [x] 3.1: Create `src/hooks/useScrapeRuns.ts` with `useTriggerScrape()` mutation hook -- calls POST /api/sites/[id]/scrape, invalidates `['sites']` and `['scrapeRuns']` queries on success
  - [x] 3.2: Add `useLatestScrapeRuns(siteIds: string[])` query hook -- calls a batch endpoint or individual GET /api/sites/[id]/scrape to get latest scrape status per site
  - [x] 3.3: Export `apiFetch` from `useSites.ts` or extract to a shared `src/lib/fetch.ts` so both hooks can use it (currently `apiFetch` is defined inside `useSites.ts`)

- [x] Task 4: Add "Scrape" action button to SiteActions component (AC: #1, #5)
  - [x] 4.1: Add `onScrape` callback prop to `SiteActions` component interface -- triggered when admin clicks "Scrape"
  - [x] 4.2: Show "Scrape" button for sites with status ACTIVE or REVIEW (these are the statuses where scraping is meaningful)
  - [x] 4.3: Disable the Scrape button and show spinner when a scrape is in progress for that site (`isScraping` prop)
  - [x] 4.4: Include "Scrape" in the dropdown menu for FAILED sites (allows re-scrape from failed state if config exists)

- [x] Task 5: Wire SitesTable to trigger scrapes with toast feedback (AC: #1, #5)
  - [x] 5.1: Import and use `useTriggerScrape` mutation in the SitesTable parent (Sites page or SitesTable component)
  - [x] 5.2: Pass `onScrape` handler to SiteActions that calls the trigger mutation
  - [x] 5.3: Show success toast "Test scrape started for [site URL]" on mutation success
  - [x] 5.4: Show error toast with specific error message on mutation failure (duplicate scrape, no config, etc.)
  - [x] 5.5: Track which site is currently being scraped to disable the button (use mutation state or local state keyed by siteId)

- [x] Task 6: Add scrape status indicator to Sites table (AC: #5, #6)
  - [x] 6.1: Fetch latest scrape run status for visible sites (use `useLatestScrapeRuns` or include scrape status in the sites list API response)
  - [x] 6.2: Show a subtle indicator in the site row when a scrape is in progress -- e.g., a small spinner icon or "Scraping..." text next to the status badge
  - [x] 6.3: When a scrape completes (COMPLETED status), show the job count briefly or update to normal state
  - [x] 6.4: When a scrape fails (FAILED status), the site's status will transition to FAILED via the worker (handled in story 4-2), so no extra UI needed here beyond the existing FAILED StatusBadge

- [x] Task 7: Add "Review" action button for REVIEW status sites (AC: #1)
  - [x] 7.1: Add a "Review" button to SiteActions for sites with status REVIEW -- opens the site URL in a new tab (same behavior as the Review Queue table)
  - [x] 7.2: This button is secondary to the "Scrape" button for REVIEW sites -- show both

- [x] Task 8: Enhance sites list API to include latest scrape info (AC: #6)
  - [x] 8.1: Update `listSites()` in `siteService.ts` to optionally include the latest ScrapeRun status per site via a Prisma `include` or a follow-up query
  - [x] 8.2: Update the GET /api/sites response to include `latestScrapeRun` (status, jobCount, createdAt) in each site object, OR create a separate batch endpoint
  - [x] 8.3: Decision: prefer including scrape info in the sites list response for efficiency (avoids N+1 queries from the frontend)

- [x] Task 9: Verify build, lint, and integration (AC: all)
  - [x] 9.1: Run `pnpm build` in the main project root -- must pass
  - [x] 9.2: Run `pnpm lint` in the main project root -- must pass
  - [x] 9.3: Manual verification checklist:
    - Sites table shows "Scrape" button for ACTIVE and REVIEW sites
    - Clicking "Scrape" triggers POST /api/sites/[id]/scrape
    - Toast "Test scrape started for [site URL]" appears on success
    - Duplicate scrape attempt shows error toast
    - Site with no config shows error toast
    - Scrape button disables and shows spinner while scrape is pending
    - Latest scrape status is visible in the sites table
    - "Review" button opens target site URL in new tab for REVIEW sites

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **This story is DASHBOARD + BACKEND only** -- no extension changes, no worker scrape execution (that is story 4-2). This story creates the scrape trigger mechanism and status visibility.
- **The POST /api/sites/[id]/scrape endpoint already exists** (created in story 3-5 as a stub). It creates ScrapeRun + WorkerJob records. This story enhances it and wires it to the dashboard UI.
- **The worker's jobDispatcher.ts currently throws "Scrape handler not yet implemented"** for SCRAPE type jobs. This is expected -- story 4-2 will implement the actual `worker/jobs/scrape.ts` handler. This story only creates the trigger and status display.
- **Services layer for business logic** -- all scrape-related logic goes in `src/services/siteService.ts` (or a new `src/services/scrapeService.ts` if the file gets too large). API routes are thin wrappers.
- **TanStack Query for all client-side data** -- use query hooks for scrape status, mutation hooks for triggering scrapes.
- **API response format:** `{ data }` wrapper for all responses, `{ error: { code, message } }` for errors.
- **Zod validation on all API inputs** -- the POST scrape endpoint already validates via the service layer.
- **Package manager:** pnpm.

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| POST /api/sites/[id]/scrape | `src/app/api/sites/[id]/scrape/route.ts` | ALREADY EXISTS from story 3-5. Enhance, don't recreate. |
| createScrapeRun() service fn | `src/services/siteService.ts` | ALREADY EXISTS. Enhance with scrapeRunId in WorkerJob payload. |
| SiteActions component | `src/components/sites/SiteActions.tsx` | EXTEND with Scrape and Review buttons. |
| SitesTable component | `src/components/sites/SitesTable.tsx` | EXTEND with scrape trigger and status display. |
| useSites hook | `src/hooks/useSites.ts` | EXTEND or create new hook for scrape mutations. |
| apiFetch helper | `src/hooks/useSites.ts` | EXTRACT to shared location or reuse pattern. |
| Error classes | `src/lib/errors.ts` | REUSE ConflictError, NotFoundError, formatErrorResponse. |
| API utils | `src/lib/api-utils.ts` | REUSE successResponse(). |
| Toast (sonner) | `src/components/ui/sonner.tsx` | REUSE for scrape success/error feedback. |

### Data Flow: Triggering a Scrape from Dashboard

```
1. Admin clicks "Scrape" button on site row in Sites table
2. Frontend calls POST /api/sites/[id]/scrape
3. Backend validates: site exists, has config, no in-progress scrape
4. Backend creates ScrapeRun (IN_PROGRESS) + WorkerJob (SCRAPE, PENDING) in transaction
5. Backend returns { data: scrapeRun } with 201 status
6. Frontend shows toast: "Test scrape started for [site URL]"
7. Frontend invalidates queries to refresh table (show scrape in progress)
8. Worker (story 4-2) will pick up the PENDING SCRAPE job and execute it
9. Until story 4-2 is done, SCRAPE jobs will fail with "Scrape handler not yet implemented"
   -- this is expected and acceptable for this story
```

### Data Flow: Auto-Triggered Scrape from Extension Config Save

```
1. Extension saves config via PUT /api/sites/[id]/config (story 3-5)
2. Background service worker auto-triggers POST /api/sites/[id]/scrape
3. Same backend flow as manual trigger (steps 3-5 above)
4. Extension shows "Config saved. Test scrape starting..."
5. This flow already works from story 3-5 -- this story ensures the backend is robust
```

### ScrapeRun + WorkerJob Link

The WorkerJob needs to know which ScrapeRun it corresponds to so the worker (story 4-2) can update the ScrapeRun status on completion/failure. Store the scrapeRunId in the WorkerJob's `payload` JSON field:

```typescript
// Updated createScrapeRun in siteService.ts
const [scrapeRun] = await prisma.$transaction([
  prisma.scrapeRun.create({
    data: { siteId, status: "IN_PROGRESS" },
  }),
  // WorkerJob needs scrapeRunId in payload -- but we don't have it yet
]);

// Solution: create ScrapeRun first, then WorkerJob with the scrapeRunId
const scrapeRun = await prisma.scrapeRun.create({
  data: { siteId, status: "IN_PROGRESS" },
});

await prisma.workerJob.create({
  data: {
    siteId,
    type: "SCRAPE",
    status: "PENDING",
    payload: { scrapeRunId: scrapeRun.id },
  },
});
```

### Sites Table Scrape Status Display

For showing scrape status in the Sites table, the most efficient approach is to include the latest ScrapeRun in the sites list API response. Options:

**Option A (Preferred): Include in sites list API response**
```typescript
// In listSites(), add Prisma include:
const sites = await prisma.site.findMany({
  where,
  orderBy,
  skip: (page - 1) * pageSize,
  take: pageSize,
  include: {
    scrapeRuns: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { id: true, status: true, jobCount: true, createdAt: true, completedAt: true },
    },
  },
});
```

**Option B: Separate batch query**
Create a `GET /api/scrape-runs?siteIds=id1,id2,...` endpoint. More RESTful but requires a second request.

Go with Option A for simplicity and fewer round-trips.

### SiteActions Button Configuration

After this story, the SiteActions component should show:

| Site Status | Visible Buttons | Overflow Menu |
|------------|----------------|---------------|
| ANALYZING | -- (no actions) | Delete |
| REVIEW | Review, Scrape, Skip | Delete |
| ACTIVE | Scrape, Skip | Delete |
| FAILED | Re-analyze, Scrape* | Delete |
| SKIPPED | Re-analyze | Delete |

*Scrape for FAILED sites: only show if site has fieldMappings (config exists). This allows re-scraping a site that failed during scrape execution but has a valid config.

### Toast Implementation

The dashboard already uses `sonner` for toast notifications (from story 1-2). Use `toast()` from sonner:

```typescript
import { toast } from "sonner";

// On scrape trigger success
toast.success(`Test scrape started for ${siteUrl}`);

// On scrape trigger failure
toast.error(error.message || "Failed to trigger scrape");
```

### Previous Story Learnings (from Stories 1-1 through 3-5)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy`.
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path.
3. **shadcn/ui v4 uses Base UI** -- not Radix.
4. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout.
5. **Always run `pnpm build`** in both extension and main project before marking story as done.
6. **ESLint `no-explicit-any`** -- avoid `any` from the start, use proper types.
7. **API response format** -- `{ data }` for single items, `{ data, meta }` for lists.
8. **TanStack Query** for all client-side server state. Use `useMutation` for POST/PUT/DELETE.
9. **Services layer for business logic** -- API routes delegate to `src/services/`. Do not put business logic in route handlers.
10. **Status transitions enforced by `siteService.ts`** -- use `VALID_STATUS_TRANSITIONS` map.
11. **`apiFetch` helper** is defined inside `useSites.ts` -- extract to shared location for reuse by scrape hooks.
12. **Existing `SiteActions` component** has Skip, Re-analyze, and Delete actions. Extend with Scrape and Review.
13. **Toast notifications** via `sonner` -- already configured in providers.tsx.
14. **`DropdownMenuTrigger` in Base UI (shadcn v4)** uses `render` prop for custom trigger element.
15. **ConflictError (409)** is used for duplicate scrape prevention -- already exists in `src/lib/errors.ts`.
16. **WorkerJob payload field** is `Json?` -- can store arbitrary JSON like `{ scrapeRunId: "..." }`.
17. **The worker's jobDispatcher.ts** has a `case "SCRAPE"` that throws "not yet implemented" -- this story does NOT implement the worker scrape handler (that is story 4-2).

### Anti-Patterns to AVOID

- Do NOT implement the actual scrape execution -- that is story 4-2. This story only creates the trigger and status display.
- Do NOT use `any` type -- all scrape run types, API responses, and hook params must be properly typed.
- Do NOT put business logic in API route handlers -- delegate to service functions.
- Do NOT use `useState` for server state -- use TanStack Query hooks.
- Do NOT create separate detail pages for scrape status -- keep it in the Sites table with inline indicators.
- Do NOT use `window.fetch` directly in components -- use the `apiFetch` helper via hooks.
- Do NOT modify the Prisma schema -- all existing models (ScrapeRun, WorkerJob, Site) are sufficient.
- Do NOT skip Zod validation on new endpoints.
- Do NOT break existing SiteActions functionality (Skip, Re-analyze, Delete must continue working).
- Do NOT add polling for scrape status in this story -- real-time updates via SSE will come in story 5-3. For now, manual refresh or query invalidation on mutation success is sufficient.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes in the main project root
2. `pnpm lint` passes in the main project root
3. POST /api/sites/[id]/scrape creates ScrapeRun + WorkerJob with scrapeRunId in payload
4. POST /api/sites/[id]/scrape returns 409 for duplicate in-progress scrape
5. POST /api/sites/[id]/scrape returns error for site with no config
6. GET /api/sites/[id]/scrape returns latest ScrapeRun for a site
7. Sites table shows "Scrape" button for ACTIVE and REVIEW sites
8. Sites table shows "Scrape" in overflow menu for FAILED sites with config
9. Clicking "Scrape" triggers the endpoint and shows success toast
10. Error cases show appropriate error toast messages
11. Scrape button disables while scrape is being triggered
12. Latest scrape status is visible as a subtle indicator in site rows
13. "Review" button opens target site in new tab for REVIEW status sites
14. All existing SiteActions (Skip, Re-analyze, Delete) still work correctly

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1: Trigger On-Demand Test Scrape]
- [Source: _bmad-output/planning-artifacts/architecture.md#API routes -- api/sites/[id]/scrape/route.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Worker Architecture -- Job discovery]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns -- Process Patterns -- Error Handling]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Button Hierarchy]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Feedback Patterns -- Toast]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#User Journey Flows -- Journey 1 -- Auto-cascade]
- [Source: _bmad-output/planning-artifacts/prd.md#FR24 -- Trigger on-demand test scrape]
- [Source: _bmad-output/implementation-artifacts/3-5-form-record-mode-and-config-save.md -- POST /api/sites/[id]/scrape stub]
- [Source: prisma/schema.prisma -- ScrapeRun, WorkerJob models]
- [Source: src/services/siteService.ts -- createScrapeRun()]
- [Source: src/app/api/sites/[id]/scrape/route.ts -- existing POST handler]
- [Source: src/components/sites/SiteActions.tsx -- existing actions component]
- [Source: src/hooks/useSites.ts -- existing hooks and apiFetch helper]
- [Source: worker/jobDispatcher.ts -- SCRAPE case placeholder]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None required -- build and lint passed on first attempt.

### Completion Notes List
- Enhanced `createScrapeRun()` to validate site status (ACTIVE/REVIEW/FAILED) and include `scrapeRunId` in WorkerJob payload
- Added `getLatestScrapeRun()` and `getLatestScrapeRunsBySiteIds()` query functions to siteService.ts
- Created GET /api/sites/[id]/scrape endpoint returning latest ScrapeRun
- Extracted `apiFetch` to shared `src/lib/fetch.ts` for reuse across hooks
- Created `useTriggerScrape()` mutation hook in `src/hooks/useScrapeRuns.ts`
- Extended SiteActions with Scrape button (ACTIVE/REVIEW), Scrape in overflow menu (FAILED with config), Review button (REVIEW), and spinner/disable states
- Wired SitesTable with scrape triggers, toast feedback, and scrape status indicators (spinner for IN_PROGRESS, job count for COMPLETED)
- Enhanced `listSites()` to include `latestScrapeRun` in the sites list API response via Prisma include
- Both `pnpm build` and `pnpm lint` pass cleanly

### File List
- `src/services/siteService.ts` -- enhanced createScrapeRun, added getLatestScrapeRun, getLatestScrapeRunsBySiteIds, updated listSites with scrapeRun include
- `src/app/api/sites/[id]/scrape/route.ts` -- added GET handler for latest scrape run
- `src/lib/fetch.ts` -- new shared apiFetch helper extracted from useSites.ts
- `src/hooks/useSites.ts` -- updated to import apiFetch from shared location
- `src/hooks/useScrapeRuns.ts` -- new hook with useTriggerScrape mutation
- `src/components/sites/SiteActions.tsx` -- extended with Scrape, Review buttons, isScraping/hasFieldMappings props
- `src/components/sites/SitesTable.tsx` -- wired scrape triggers, toasts, status indicators, Review action
