# Story 5.2: System Status Overview & Failure Alerts

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an admin,
I want to see a glanceable dashboard overview with system health and categorized failure alerts,
so that my morning operations check takes under 10 minutes.

## Acceptance Criteria

1. **Given** sites and scrape runs exist in the system **When** I navigate to the Home/Overview page (default landing page at `/`) **Then** I see a panel grid layout with status summary cards:
   - **Scrape Health panel**: Large percentage showing success rate + success/failure count from the most recent scrape run per site
   - **Sites by Status panel**: Counts for Active, Analyzing, Review, Failed, Skipped (reuse existing `getStatusCounts()`)
   - **Review Queue Depth panel**: Number of sites with status REVIEW awaiting admin correction
   - **Total Jobs panel**: Total job records scraped across all sites

2. **Given** failed scrape runs exist **When** I view the Needs Attention panel on the overview **Then** I see a NeedsAttentionTable (compact, 12px font) showing failed sites with columns: StatusBadge, Site URL, Failure Reason (pre-categorized), and Action button
   - Failures are categorized as: timeout, structure_changed, empty_results (FR33)
   - Max 5 rows visible with a "View all" link if more exist (navigates to `/sites` filtered to FAILED status)

3. **Given** a failure is categorized as "timeout" **When** I see the failure row in the NeedsAttentionTable **Then** the action button shows "Retry" which triggers a re-scrape for that site (FR34)

4. **Given** a failure is categorized as "structure_changed" **When** I see the failure row **Then** the action button shows "Fix" which opens the target site URL in a new tab for extension-based correction

5. **Given** a failure is categorized as "empty_results" **When** I see the failure row **Then** the action button shows "Investigate" which opens the target site URL in a new tab for manual inspection

6. **Given** no failures exist **When** I view the overview **Then** the Needs Attention panel shows: "No failures. All sites are healthy." as a positive empty state

7. **Given** the dashboard loads **When** the page renders **Then** all panels load and respond within 1 second (NFR3)
   - Skeleton loading states for each panel during data fetch
   - No full-page loading screen

## Tasks / Subtasks

- [x] Task 1: Create dashboard overview API endpoint (AC: #1, #7)
  - [x] 1.1: Add `getDashboardOverview()` function to `src/services/siteService.ts` (or create a new `src/services/dashboardService.ts`)
  - [x] 1.2: Query scrape health: count of sites with latest scrape run COMPLETED vs FAILED, calculate success rate percentage
  - [x] 1.3: Reuse existing `getStatusCounts()` for sites by status
  - [x] 1.4: Query total jobs count via `prisma.job.count()`
  - [x] 1.5: Create `GET /api/dashboard/overview` route at `src/app/api/dashboard/overview/route.ts`
  - [x] 1.6: Return `{ data }` response with shape: `{ scrapeHealth: { successRate, successCount, failureCount, totalSites }, statusCounts: { ANALYZING, REVIEW, ACTIVE, FAILED, SKIPPED, total }, reviewQueueDepth, totalJobs }`

- [x] Task 2: Create failed sites API endpoint for NeedsAttentionTable (AC: #2)
  - [x] 2.1: Add `getFailedSitesWithReasons()` function to the service layer
  - [x] 2.2: Query sites with status FAILED, include their latest ScrapeRun to get `failureCategory` and `error` fields
  - [x] 2.3: Return max 10 results ordered by most recent failure first
  - [x] 2.4: Create `GET /api/dashboard/failures` route at `src/app/api/dashboard/failures/route.ts`
  - [x] 2.5: Return `{ data, meta }` response with failed sites including: `id`, `siteUrl`, `failureCategory`, `error`, `latestScrapeRun`

- [x] Task 3: Create useDashboard TanStack Query hooks (AC: #1, #2, #7)
  - [x] 3.1: Create `src/hooks/useDashboard.ts`
  - [x] 3.2: Implement `useDashboardOverview()` hook querying `GET /api/dashboard/overview` with queryKey `["dashboard", "overview"]`
  - [x] 3.3: Implement `useFailedSites()` hook querying `GET /api/dashboard/failures` with queryKey `["dashboard", "failures"]`
  - [x] 3.4: Import `apiFetch` from `@/lib/fetch`

- [x] Task 4: Build StatusPanels component (AC: #1)
  - [x] 4.1: Create `src/components/dashboard/StatusPanels.tsx`
  - [x] 4.2: Render 4 cards in a CSS grid (2x2 on standard viewport, responsive):
    - **Scrape Health**: Large percentage text (text-3xl, green if >= 90%, amber if >= 70%, red below 70%), subtext "N succeeded / M failed"
    - **Sites by Status**: List of status counts with StatusBadge for each (ACTIVE, ANALYZING, REVIEW, FAILED, SKIPPED), total at bottom
    - **Review Queue Depth**: Large number (text-3xl, amber color), subtext "sites awaiting review"
    - **Total Jobs**: Large number (text-3xl), subtext "job records scraped"
  - [x] 4.3: Use shadcn `Card` component (CardHeader, CardTitle, CardContent)
  - [x] 4.4: Skeleton loading state for each card while data loads

- [x] Task 5: Build NeedsAttentionTable component (AC: #2, #3, #4, #5, #6)
  - [x] 5.1: Create `src/components/dashboard/NeedsAttentionTable.tsx`
  - [x] 5.2: Render compact table (12px font) with columns: Status (StatusBadge), Site URL (monospace 13px), Failure Reason, Action
  - [x] 5.3: Failure reason column: display `failureCategory` in human-readable form ("Timeout", "Structure Changed", "Empty Results")
  - [x] 5.4: Action button logic:
    - `timeout` -> "Retry" button (triggers `POST /api/sites/[id]/scrape`)
    - `structure_changed` -> "Fix" button (opens `siteUrl` in new tab)
    - `empty_results` -> "Investigate" button (opens `siteUrl` in new tab)
  - [x] 5.5: Max 5 rows visible; if `meta.total > 5`, show "View all" link to `/sites?status=FAILED`
  - [x] 5.6: Empty state: "No failures. All sites are healthy." in muted green text, centered
  - [x] 5.7: Use `useTriggerScrape()` mutation from `src/hooks/useScrapeRuns.ts` for the Retry action
  - [x] 5.8: Show toast on retry success/error via Sonner

- [x] Task 6: Wire up Home/Overview page (AC: #1-7)
  - [x] 6.1: Update `src/app/(dashboard)/page.tsx` from placeholder to real overview page
  - [x] 6.2: Mark as client component (`"use client"`)
  - [x] 6.3: Page heading: "Overview" (h2, text-2xl, font-semibold, color #fafafa)
  - [x] 6.4: Render StatusPanels below heading (pass overview data from `useDashboardOverview()`)
  - [x] 6.5: Render section heading "Needs Attention" below panels (h3, text-lg, font-semibold, color #fafafa, mt-8 mb-4)
  - [x] 6.6: Render NeedsAttentionTable below section heading (pass data from `useFailedSites()`)

- [x] Task 7: Verify build and lint (AC: #1-7)
  - [x] 7.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x] 7.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x] 7.3: Navigate to `/` -- page renders with Overview heading, 4 status panels, and NeedsAttentionTable (or empty state)
  - [x] 7.4: Verify panels display correct data from database queries
  - [x] 7.5: Verify NeedsAttentionTable shows failed sites with correct action buttons
  - [x] 7.6: Verify "Retry" action triggers a scrape and shows toast
  - [x] 7.7: Verify "Fix" and "Investigate" actions open target site in new tab
  - [x] 7.8: Verify empty state shows "No failures. All sites are healthy."
  - [x] 7.9: Verify skeleton loading states appear during data fetch
  - [x] 7.10: Update story status to `done` if all checks pass

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Import enums from `@/generated/prisma/enums`. Requires driver adapter.
- **Zod 4.x** (v4.3.6): Uses `z.enum()` for enum validation. Schemas already defined in `src/lib/validators.ts`.
- **TanStack Query v5** (`@tanstack/react-query` v5.90.21): Use `useQuery` with queryKey arrays. Invalidation via `queryClient.invalidateQueries({ queryKey: [...] })`.
- **Sonner** (v2.0.7): Use `toast.success()`, `toast.error()`. Already mounted in root layout.
- **Services layer**: ALL business logic in `src/services/`, NOT in API route handlers. Route handlers: validate input -> call service -> format response.

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| `getStatusCounts()` | `src/services/siteService.ts` | Already returns `{ ANALYZING, REVIEW, ACTIVE, FAILED, SKIPPED, total }`. Reuse directly for Sites by Status panel and Review Queue Depth. |
| `createScrapeRun()` | `src/services/siteService.ts` | Creates a scrape run + worker job. Used by the Retry action. |
| `useTriggerScrape()` | `src/hooks/useScrapeRuns.ts` | Mutation hook for `POST /api/sites/[id]/scrape`. Use for the NeedsAttentionTable Retry button. |
| `useSiteStatusCounts()` | `src/hooks/useSites.ts` | Fetches `GET /api/sites/counts`. Could be reused but the new overview endpoint will aggregate all data in one call for efficiency. |
| StatusBadge component | `src/components/shared/StatusBadge.tsx` | Accepts `status: SiteStatusValue` prop. Use in NeedsAttentionTable. |
| ConfidenceBar component | `src/components/shared/ConfidenceBar.tsx` | Not directly needed for this story but available if needed. |
| `apiFetch` helper | `src/lib/fetch.ts` | Shared fetch with auth token + error handling + 204 support. |
| API response helpers | `src/lib/api-utils.ts` -> `successResponse()`, `listResponse()` | Consistent response wrappers. |
| Error formatting | `src/lib/errors.ts` -> `formatErrorResponse()`, `AppError` | Central error handling. |
| Constants | `src/lib/constants.ts` | `DEFAULT_PAGE_SIZE`, status labels, etc. |
| TypeScript types | `src/lib/types.ts` | `ApiResponse<T>`, `ApiListResponse<T>`, `PaginationParams`. |
| shadcn/ui components | `src/components/ui/` | card, badge, button, table, skeleton, separator, tooltip all installed. |
| Prisma client | `src/lib/prisma.ts` | Singleton instance. |

### Data Sources for Dashboard Panels

**Scrape Health Panel:**
The scrape health calculation requires determining the most recent scrape run per site and counting successes vs failures. Approach:
1. Query all sites that have at least one scrape run.
2. For each site, get the latest scrape run status (COMPLETED vs FAILED).
3. Calculate: `successRate = successCount / (successCount + failureCount) * 100`.
4. Sites with no scrape runs are excluded from the health calculation.

Implementation in service layer:
```typescript
// Get latest scrape run per site and aggregate
const sites = await prisma.site.findMany({
  where: { scrapeRuns: { some: {} } },
  include: {
    scrapeRuns: {
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { status: true },
    },
  },
});

let successCount = 0;
let failureCount = 0;
for (const site of sites) {
  const latestRun = site.scrapeRuns[0];
  if (latestRun?.status === "COMPLETED") successCount++;
  else if (latestRun?.status === "FAILED") failureCount++;
  // IN_PROGRESS runs are excluded from the health metric
}
```

**Failed Sites for NeedsAttentionTable:**
```typescript
const failedSites = await prisma.site.findMany({
  where: { status: "FAILED" },
  include: {
    scrapeRuns: {
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, failureCategory: true, error: true, createdAt: true },
    },
  },
  orderBy: { failedAt: "desc" },
  take: 10,
});
```

The `failureCategory` field on ScrapeRun is a string (`"timeout"`, `"structure_changed"`, `"empty_results"`, or `null`). It was set by the scrape worker in story 4-2 when a scrape fails. Render human-readable labels in the table.

### Prisma Model References

**ScrapeRun** (relevant fields):
```prisma
model ScrapeRun {
  id              String          @id @default(cuid())
  siteId          String
  status          ScrapeRunStatus @default(IN_PROGRESS) // IN_PROGRESS | COMPLETED | FAILED
  jobCount        Int             @default(0)
  error           String?
  failureCategory String?         // "timeout" | "structure_changed" | "empty_results" | null
  createdAt       DateTime        @default(now())
  completedAt     DateTime?
}
```

**Site** (relevant fields for dashboard):
```prisma
model Site {
  id              String      @id @default(cuid())
  siteUrl         String      @unique
  status          SiteStatus  // ANALYZING | REVIEW | ACTIVE | FAILED | SKIPPED
  failedAt        DateTime?
}
```

**Job** (for total count):
```prisma
model Job {
  id String @id @default(cuid())
  // Total count via prisma.job.count()
}
```

### API Endpoint Design

**GET /api/dashboard/overview**

Response:
```json
{
  "data": {
    "scrapeHealth": {
      "successRate": 95.2,
      "successCount": 487,
      "failureCount": 25,
      "totalSites": 512
    },
    "statusCounts": {
      "ANALYZING": 3,
      "REVIEW": 12,
      "ACTIVE": 487,
      "FAILED": 8,
      "SKIPPED": 2,
      "total": 512
    },
    "reviewQueueDepth": 12,
    "totalJobs": 15432
  }
}
```

**GET /api/dashboard/failures**

Response:
```json
{
  "data": [
    {
      "id": "cuid...",
      "siteUrl": "https://example.co.il/jobs",
      "status": "FAILED",
      "failedAt": "2026-03-10T08:00:00.000Z",
      "latestScrapeRun": {
        "id": "cuid...",
        "failureCategory": "timeout",
        "error": "Navigation timeout after 120000ms",
        "createdAt": "2026-03-10T07:55:00.000Z"
      }
    }
  ],
  "meta": {
    "total": 8,
    "showing": 5
  }
}
```

### UX Requirements

**Panel Grid Layout:**
- 4 cards in a 2x2 CSS grid (`grid grid-cols-2 gap-4`)
- On wide viewports (> 1400px), could be 4 columns (`grid-cols-4`) but 2x2 is the default
- Cards use shadcn Card component with dark surface background (`#18181b`)
- Card titles: text-sm, font-medium, muted text (`#a1a1aa`)
- Large numbers: text-3xl, font-bold, primary text (`#fafafa`)

**Scrape Health Panel:**
- Large percentage: text-3xl, font-bold, color based on value (green >= 90%, amber >= 70%, red < 70%)
- Subtext: "N succeeded / M failed" in muted text
- If no scrape runs exist: show "No data yet" in muted text

**Sites by Status Panel:**
- Vertical list of status counts, each with a StatusBadge and count number
- Total at bottom in slightly larger text

**Review Queue Depth Panel:**
- Large number in amber color (`#f59e0b`) when > 0, muted grey when 0
- Subtext: "sites awaiting review"

**Total Jobs Panel:**
- Large number in primary text color
- Subtext: "job records scraped"

**NeedsAttentionTable:**
- Compact table: 12px font (`text-xs`), tight row height (32px)
- Columns: Status (StatusBadge FAILED variant, compact), Site URL (monospace 13px, truncated with `max-w-[300px] truncate`), Failure Reason (human-readable text), Action (ghost button)
- Max 5 rows visible
- "View all" link: text-xs, blue text, navigates to `/sites` (admin can filter to FAILED status there)
- Empty state: "No failures. All sites are healthy." in muted text (`#71717a`), centered in the card
- Section heading "Needs Attention" above the table (h3, text-lg)

**Action Buttons in NeedsAttentionTable:**
- All action buttons are ghost variant, text-xs, with appropriate colors:
  - "Retry" (timeout): default text color, triggers `useTriggerScrape()` with the site ID
  - "Fix" (structure_changed): blue text (`#3b82f6`), opens `window.open(siteUrl, '_blank')`
  - "Investigate" (empty_results): amber text (`#f59e0b`), opens `window.open(siteUrl, '_blank')`
- Zero-confirmation for Retry (non-destructive, per UX spec)
- Toast on Retry: `toast.success("Re-scrape triggered for [siteUrl]")`
- Toast on Retry error: `toast.error(error.message)`

**Failure Category Labels:**

| `failureCategory` value | Display Label | Action |
|--------------------------|---------------|--------|
| `"timeout"` | "Timeout" | Retry |
| `"structure_changed"` | "Structure Changed" | Fix |
| `"empty_results"` | "Empty Results" | Investigate |
| `null` or unknown | "Unknown Error" | Retry |

**General UX Rules (from previous stories):**
- No confirmation dialogs for non-destructive actions (Retry)
- Loading: skeleton for initial load per panel; no full-page loading screen
- Toast notifications for async action feedback (Retry)
- Desktop-only layout, minimum 1280px viewport

### Project Structure (Files to Create/Modify)

```
src/
  services/
    dashboardService.ts              # NEW -- dashboard aggregation queries
  app/
    api/
      dashboard/
        overview/route.ts            # NEW -- GET /api/dashboard/overview
        failures/route.ts            # NEW -- GET /api/dashboard/failures
    (dashboard)/
      page.tsx                       # MODIFY -- replace placeholder with real overview page
  hooks/
    useDashboard.ts                  # NEW -- TanStack Query hooks for dashboard data
  components/
    dashboard/
      StatusPanels.tsx               # NEW -- 4-card status panel grid
      NeedsAttentionTable.tsx        # NEW -- compact failed sites table with actions
```

### Anti-Patterns to AVOID

- Do NOT put Prisma queries in API route handlers -- extract to `src/services/dashboardService.ts`
- Do NOT put Prisma queries in frontend components -- use API endpoints via `apiFetch`
- Do NOT use `useState` for API data -- use TanStack Query hooks
- Do NOT use `any` type -- all functions must have proper TypeScript types
- Do NOT create a new `apiFetch` -- import from `@/lib/fetch`
- Do NOT modify existing API endpoints or service functions -- create new ones for dashboard aggregation
- Do NOT install new packages -- all required packages are already installed
- Do NOT modify the sidebar navigation -- the Home icon already exists and links to `/`
- Do NOT add SSE/real-time updates in this story -- story 5-3 handles real-time. This story is read-on-demand.
- Do NOT implement the StatusPill top bar component in this story -- that is part of story 5-3 (real-time updates)
- Do NOT add sparkline trends or 7-day history charts -- those are Phase 2

### Previous Story Learnings (from Stories 1-1 through 5-1)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy` (not `middleware`).
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path configured in schema.prisma generator block.
3. **`apiFetch` lives in `src/lib/fetch.ts`** -- extracted from the original `useSites.ts` hook. All hooks import from there.
4. **Sonner** is used for toasts -- already mounted in root layout. Use `toast.success()` and `toast.error()`.
5. **shadcn/ui v4 uses Base UI** -- component props may differ from older shadcn versions.
6. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
7. **Always run `pnpm build`** before marking story as done.
8. **ESLint `no-explicit-any`** -- avoid `any` from the start. Use proper TypeScript interfaces for all data shapes.
9. **Pagination pattern** is established in SitesTable and JobsTable -- reuse for NeedsAttentionTable "View all" link.
10. **Card component** from shadcn/ui is already installed at `src/components/ui/card.tsx`.
11. **The `useTriggerScrape()` hook** already exists in `src/hooks/useScrapeRuns.ts` and invalidates `["sites"]` queries on success.
12. **Service functions** like `getStatusCounts()` already exist and should be reused, not duplicated.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. Navigate to `/` -- page renders with "Overview" heading, 4 status panels, and "Needs Attention" section
4. Scrape Health panel shows percentage with correct color coding and success/failure counts
5. Sites by Status panel shows counts with StatusBadges
6. Review Queue Depth panel shows count of REVIEW status sites
7. Total Jobs panel shows total job count
8. NeedsAttentionTable shows failed sites with correct failure categories and action buttons
9. "Retry" button triggers a scrape and shows success toast
10. "Fix" button opens target site URL in new tab
11. "Investigate" button opens target site URL in new tab
12. Max 5 rows in NeedsAttentionTable with "View all" link when more exist
13. Empty state shows "No failures. All sites are healthy." when no failed sites
14. Skeleton loading states appear during initial data fetch
15. All data loads within 1 second (efficient queries, no N+1)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2: System Status Overview & Failure Alerts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Design Direction Decision -- Dashboard-First overview]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- NeedsAttentionTable]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- StatusPill (deferred to 5-3)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#User Journey Flows -- Journey 3: Morning Operations Check]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Empty States]
- [Source: _bmad-output/planning-artifacts/prd.md#FR32, FR33, FR34]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR3 (dashboard < 1s)]
- [Source: src/services/siteService.ts] (getStatusCounts, createScrapeRun)
- [Source: src/hooks/useScrapeRuns.ts] (useTriggerScrape)
- [Source: src/hooks/useSites.ts] (useSiteStatusCounts)
- [Source: src/components/shared/StatusBadge.tsx] (StatusBadge component)
- [Source: prisma/schema.prisma] (ScrapeRun.failureCategory, Site.status)
- [Source: _bmad-output/implementation-artifacts/5-1-jobs-viewer-and-data-quality-review.md] (established patterns)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None.

### Completion Notes List

- Created dashboard service layer with getDashboardOverview() and getFailedSitesWithReasons() functions
- Reused existing getStatusCounts() from siteService.ts for Sites by Status and Review Queue Depth
- Scrape health calculated by getting latest scrape run per site, counting COMPLETED vs FAILED
- Two new API endpoints: GET /api/dashboard/overview and GET /api/dashboard/failures
- TanStack Query hooks: useDashboardOverview() and useFailedSites() in src/hooks/useDashboard.ts
- StatusPanels component: 2x2 grid with Scrape Health (color-coded), Sites by Status (StatusBadges), Review Queue Depth, Total Jobs
- NeedsAttentionTable component: compact table with failure categorization and action buttons (Retry/Fix/Investigate)
- Retry action uses existing useTriggerScrape() hook with toast feedback
- Fix and Investigate actions open site URL in new tab
- Skeleton loading states for all panels
- Empty state: "No failures. All sites are healthy." when no failed sites
- Max 5 rows in NeedsAttentionTable with "View all" link when more exist
- pnpm build and pnpm lint both pass cleanly

### File List

- src/services/dashboardService.ts (NEW)
- src/app/api/dashboard/overview/route.ts (NEW)
- src/app/api/dashboard/failures/route.ts (NEW)
- src/hooks/useDashboard.ts (NEW)
- src/components/dashboard/StatusPanels.tsx (NEW)
- src/components/dashboard/NeedsAttentionTable.tsx (NEW)
- src/app/(dashboard)/page.tsx (MODIFIED)
