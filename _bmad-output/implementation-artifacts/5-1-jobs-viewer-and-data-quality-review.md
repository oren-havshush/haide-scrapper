# Story 5.1: Jobs Viewer & Data Quality Review

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an admin,
I want to view scraped job listings per site and spot-check data quality,
so that I can verify the scraped data is correct before scaling to more sites.

## Acceptance Criteria

1. **Given** jobs have been scraped from configured sites **When** I navigate to the Jobs page via the sidebar **Then** I see a data table (JobsTable) with columns: Title, Company, Location, Salary, Site (linked), Scraped Date
   - Rows display normalized field values from the job records
   - The default sort is most recent first (`createdAt` descending)
   - Row height is 40px with hover background `#18181b`

2. **Given** multiple sites have scraped jobs **When** I select a site from the SiteFilter dropdown above the table **Then** the table filters to show only jobs from the selected site (FR29)
   - The dropdown shows all sites that have at least one scraped job
   - An "All Sites" option clears the filter
   - The filter passes the `siteId` query parameter to GET /api/jobs

3. **Given** jobs are displayed in the table **When** I browse through the records **Then** I can visually spot-check whether titles are sensible, companies are real names, locations are parseable cities, and salary is present when expected (FR30)
   - Title column: default text, flexible width
   - Company column: default text, 160px
   - Location column: default text, 140px
   - Salary column: default text or em-dash when null, 120px
   - All text is 14px body font (not monospace)

4. **Given** a job record is displayed in the table **When** I look at the Site column **Then** I can identify which site the job came from via a linked site name/URL (FR31)
   - The Site column displays the site URL in monospace 13px
   - Clicking the site name navigates to the Sites view (`/sites`) -- in the future this could filter to that site, but for MVP just navigate to `/sites`

5. **Given** more than 50 jobs exist for the current filter **When** I view the table **Then** pagination shows "Showing 1-50 of N" with Previous/Next controls
   - Page size is fixed at 50 (per `DEFAULT_PAGE_SIZE` constant)
   - Previous button disabled on first page; Next button disabled on last page
   - Pagination text and buttons styled with muted text (`#a1a1aa`)

6. **Given** no jobs have been scraped yet **When** I navigate to the Jobs page **Then** I see an empty state: "No jobs scraped yet. Complete a site review and save config to trigger a test scrape." with a link to the Review Queue
   - Empty state uses muted text (`#71717a`), centered, `py-12`

7. **Given** the Jobs API endpoint exists **When** I request GET /api/jobs with an optional siteId query parameter **Then** the response returns jobs in `{ data, meta }` format with pagination metadata
   - The API already exists at `src/app/api/jobs/route.ts` (created in story 4-3) -- this story wires the frontend to consume it

## Tasks / Subtasks

- [x]Task 1: Create useJobs TanStack Query hook (AC: #1, #2, #5, #7)
  - [x]1.1: Create `src/hooks/useJobs.ts`
  - [x]1.2: Implement `useJobs(params?)` -- `useQuery` with key `["jobs", { page, pageSize, siteId }]`
  - [x]1.3: Accept `page`, `pageSize`, and optional `siteId` parameters
  - [x]1.4: Build search params string and call `apiFetch("/api/jobs?...")`
  - [x]1.5: Import `apiFetch` from `@/lib/fetch`

- [x]Task 2: Create useSitesWithJobs hook for the SiteFilter dropdown (AC: #2)
  - [x]2.1: Add `useSitesWithJobs()` hook to `src/hooks/useJobs.ts`
  - [x]2.2: Fetch all sites that have at least one job -- use GET /api/sites with query parameter approach, or query a dedicated endpoint
  - [x]2.3: **Decision: Reuse existing GET /api/sites** -- fetch sites with status ACTIVE (sites that have been scraped). The dropdown shows site URLs. This is sufficient for MVP since only active/configured sites will have jobs.
  - [x]2.4: Alternatively, derive the site list from the jobs response `site` relation data already included -- the GET /api/jobs endpoint already includes `site: { id, siteUrl }` via Prisma `include`. Use a **separate lightweight query** to get the distinct site list: `useSitesWithJobs()` queries `GET /api/sites?status=ACTIVE&pageSize=100` to populate the dropdown.

- [x]Task 3: Build SiteFilter dropdown component (AC: #2)
  - [x]3.1: Create `src/components/jobs/SiteFilter.tsx`
  - [x]3.2: Use shadcn `Select` component (SelectTrigger, SelectContent, SelectItem)
  - [x]3.3: Show "All Sites" as the default/first option (value: empty string or undefined)
  - [x]3.4: List sites with their URL in monospace font
  - [x]3.5: Call `onSiteChange(siteId | undefined)` callback when selection changes
  - [x]3.6: Show skeleton loading while sites are being fetched

- [x]Task 4: Build JobsTable component (AC: #1, #3, #4, #5, #6)
  - [x]4.1: Create `src/components/jobs/JobsTable.tsx`
  - [x]4.2: Render data table with columns: Title (flexible width), Company (160px), Location (140px), Salary (120px), Site (160px, monospace 13px), Scraped Date (140px)
  - [x]4.3: Row height 40px (`h-10`), hover background `#18181b`
  - [x]4.4: Salary column: show em-dash when null/empty
  - [x]4.5: Site column: display site URL as a clickable link (use Next.js `Link` to navigate to `/sites`)
  - [x]4.6: Scraped Date column: format as localized date string, muted text color (`#a1a1aa`)
  - [x]4.7: Empty state when no jobs: "No jobs scraped yet. Complete a site review and save config to trigger a test scrape." with a Link to `/review`
  - [x]4.8: Empty state when filter returns no results: "No jobs found for this site."
  - [x]4.9: Skeleton loading state while query is loading (5 skeleton rows)
  - [x]4.10: Pagination bar below table (same pattern as SitesTable):
    - Left: "Showing X-Y of N" text in muted color (`#a1a1aa`, 12px)
    - Right: Previous/Next buttons (ghost variant)
    - Only show when total > 50

- [x]Task 5: Wire up Jobs page (AC: #1-7)
  - [x]5.1: Update `src/app/(dashboard)/jobs/page.tsx` from placeholder to real page
  - [x]5.2: Mark as client component (`"use client"`)
  - [x]5.3: Page heading: "Jobs" (h2, text-2xl, font-semibold, color #fafafa)
  - [x]5.4: Place SiteFilter below heading
  - [x]5.5: Place JobsTable below SiteFilter
  - [x]5.6: Manage state: `siteId` (string | undefined), `page` (number, default 1)
  - [x]5.7: Pass `siteId` and `page` to `useJobs()` hook
  - [x]5.8: Reset page to 1 when siteId filter changes
  - [x]5.9: Compute totalPages from `data.meta.total` and pageSize (50)
  - [x]5.10: Wire SiteFilter `onSiteChange` to `setSiteId` + `setPage(1)`
  - [x]5.11: Wire JobsTable pagination to `page` state

- [x]Task 6: Verify build and lint (AC: #1-7)
  - [x]6.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x]6.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x]6.3: Navigate to `/jobs` -- page renders with heading, SiteFilter, and JobsTable (or empty state)
  - [x]6.4: Verify SiteFilter dropdown populates with sites
  - [x]6.5: Verify selecting a site filters the jobs table
  - [x]6.6: Verify pagination appears when > 50 jobs exist
  - [x]6.7: Verify empty state message displays correctly
  - [x]6.8: Verify site link in table navigates to `/sites`
  - [x]6.9: Update story status to `done` if all checks pass

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
| Jobs API route | `src/app/api/jobs/route.ts` | Already has GET with pagination, siteId filter, scrapeRunId filter, validationStatus filter. Includes `site: { id, siteUrl }` in response. **DO NOT MODIFY.** |
| Jobs filter Zod schema | `src/lib/validators.ts` -> `jobsFilterSchema` | Validates `siteId`, `scrapeRunId`, `validationStatus` |
| Pagination Zod schema | `src/lib/validators.ts` -> `paginationSchema` | page/pageSize with defaults |
| `apiFetch` helper | `src/lib/fetch.ts` | Shared fetch with auth token + error handling + 204 support |
| Sites TanStack hook | `src/hooks/useSites.ts` | `useSites(params)` -- can reuse for SiteFilter dropdown (fetch ACTIVE sites) |
| API response helpers | `src/lib/api-utils.ts` -> `successResponse()`, `listResponse()` | Consistent response wrappers |
| Error formatting | `src/lib/errors.ts` -> `formatErrorResponse()`, `AppError` | Central error handling |
| StatusBadge component | `src/components/shared/StatusBadge.tsx` | Accepts `status: SiteStatusValue` prop |
| ConfidenceBar component | `src/components/shared/ConfidenceBar.tsx` | Accepts `confidence: number` and `compact?: boolean` props |
| Constants | `src/lib/constants.ts` | `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE` |
| TypeScript types | `src/lib/types.ts` | `ApiResponse<T>`, `ApiListResponse<T>`, `PaginationParams` |
| shadcn/ui components | `src/components/ui/` | button, input, table, select, skeleton, badge, tabs already installed |
| SitesTable pagination pattern | `src/components/sites/SitesTable.tsx` | Reference for pagination bar implementation |

### API Endpoint Reference (GET /api/jobs)

The endpoint already exists and supports these query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | number | 1 | Page number (1-indexed) |
| pageSize | number | 50 | Items per page (max 100) |
| siteId | string | (none) | Filter by site ID |
| scrapeRunId | string | (none) | Filter by scrape run ID |
| validationStatus | string | (none) | Filter by "valid" or "invalid" |

Response format:
```json
{
  "data": [
    {
      "id": "cuid...",
      "title": "Software Engineer",
      "company": "TechCo",
      "location": "Tel Aviv",
      "salary": "25000-35000 NIS",
      "description": "...",
      "rawData": { ... },
      "validationStatus": "valid",
      "siteId": "cuid...",
      "scrapeRunId": "cuid...",
      "createdAt": "2026-03-10T14:30:00.000Z",
      "site": {
        "id": "cuid...",
        "siteUrl": "https://example.co.il/jobs"
      }
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "pageSize": 50
  }
}
```

Key: Each job record includes `site: { id, siteUrl }` via Prisma `include`, so the frontend can display and link to the source site without a separate API call.

### Prisma Model Reference

The Job model (from `prisma/schema.prisma`):

```prisma
model Job {
  id               String    @id @default(cuid())
  title            String
  company          String
  location         String
  salary           String?
  description      String?
  rawData          Json
  validationStatus String?
  siteId           String
  site             Site      @relation(fields: [siteId], references: [id])
  scrapeRunId      String
  scrapeRun        ScrapeRun @relation(fields: [scrapeRunId], references: [id])
  createdAt        DateTime  @default(now())

  @@index([siteId])
  @@index([scrapeRunId])
}
```

Key fields for the table:
- `title` (String, required) -- always present
- `company` (String, required) -- always present
- `location` (String, required) -- always present
- `salary` (String?, nullable) -- show em-dash when null
- `description` (String?, nullable) -- NOT shown in table (too long), used for future detail view
- `site.siteUrl` (via relation) -- displayed in Site column
- `createdAt` (DateTime) -- displayed as Scraped Date

### Implementation Patterns (Code Samples)

#### useJobs TanStack Query hook (src/hooks/useJobs.ts)

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

interface UseJobsParams {
  page?: number;
  pageSize?: number;
  siteId?: string;
}

export function useJobs(params: UseJobsParams = {}) {
  const { page = 1, pageSize = 50, siteId } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("pageSize", String(pageSize));
  if (siteId) searchParams.set("siteId", siteId);

  return useQuery({
    queryKey: ["jobs", { page, pageSize, siteId }],
    queryFn: () => apiFetch(`/api/jobs?${searchParams.toString()}`),
  });
}
```

#### SiteFilter component (src/components/jobs/SiteFilter.tsx)

```typescript
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSites } from "@/hooks/useSites";

interface SiteFilterProps {
  selectedSiteId: string | undefined;
  onSiteChange: (siteId: string | undefined) => void;
}

export function SiteFilter({ selectedSiteId, onSiteChange }: SiteFilterProps) {
  // Fetch ACTIVE sites (most likely to have jobs) -- plus REVIEW/FAILED that may have scraped data
  const { data, isLoading } = useSites({ pageSize: 100 });
  const sites = data?.data ?? [];

  if (isLoading) {
    return <Skeleton className="h-9 w-[280px] mb-4" />;
  }

  return (
    <div className="mb-4">
      <Select
        value={selectedSiteId ?? "all"}
        onValueChange={(value) =>
          onSiteChange(value === "all" ? undefined : value)
        }
      >
        <SelectTrigger className="w-[280px]">
          <SelectValue placeholder="All Sites" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sites</SelectItem>
          {sites.map((site: { id: string; siteUrl: string }) => (
            <SelectItem key={site.id} value={site.id}>
              <span className="font-mono text-[13px]">{site.siteUrl}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

#### JobsTable component (src/components/jobs/JobsTable.tsx)

```typescript
"use client";

import Link from "next/link";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface JobSite {
  id: string;
  siteUrl: string;
}

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  createdAt: string;
  site: JobSite;
}

interface JobsTableProps {
  jobs: Job[];
  isLoading: boolean;
  hasFilter: boolean;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

const PAGE_SIZE = 50;

export function JobsTable({
  jobs,
  isLoading,
  hasFilter,
  page,
  totalPages,
  total,
  onPageChange,
}: JobsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    if (hasFilter) {
      return (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: "#71717a" }}>
            No jobs found for this site.
          </p>
        </div>
      );
    }

    return (
      <div className="text-center py-12">
        <p className="text-sm" style={{ color: "#71717a" }}>
          No jobs scraped yet. Complete a site review and save config to trigger a test scrape.{" "}
          <Link href="/review" className="underline" style={{ color: "#3b82f6" }}>
            Go to Review Queue
          </Link>
        </p>
      </div>
    );
  }

  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-auto">Title</TableHead>
            <TableHead className="w-[160px]">Company</TableHead>
            <TableHead className="w-[140px]">Location</TableHead>
            <TableHead className="w-[120px]">Salary</TableHead>
            <TableHead className="w-[160px]">Site</TableHead>
            <TableHead className="w-[140px]">Scraped Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id} className="h-10 hover:bg-[#18181b]">
              <TableCell className="text-sm">{job.title}</TableCell>
              <TableCell className="text-sm">{job.company}</TableCell>
              <TableCell className="text-sm">{job.location}</TableCell>
              <TableCell className="text-sm">
                {job.salary ? (
                  job.salary
                ) : (
                  <span style={{ color: "#71717a" }}>&mdash;</span>
                )}
              </TableCell>
              <TableCell>
                <Link
                  href="/sites"
                  className="font-mono text-[13px] hover:underline"
                  style={{ color: "#3b82f6" }}
                >
                  {job.site.siteUrl}
                </Link>
              </TableCell>
              <TableCell className="text-sm" style={{ color: "#a1a1aa" }}>
                {new Date(job.createdAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 px-2">
          <span className="text-xs" style={{ color: "#a1a1aa" }}>
            Showing {startItem}-{endItem} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

#### Jobs page composition (src/app/(dashboard)/jobs/page.tsx)

```typescript
"use client";

import { useState } from "react";
import { SiteFilter } from "@/components/jobs/SiteFilter";
import { JobsTable } from "@/components/jobs/JobsTable";
import { useJobs } from "@/hooks/useJobs";

export default function JobsPage() {
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useJobs({ page, siteId });

  const total = data?.meta?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const handleSiteChange = (newSiteId: string | undefined) => {
    setSiteId(newSiteId);
    setPage(1); // Reset to first page on filter change
  };

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4" style={{ color: "#fafafa" }}>
        Jobs
      </h2>
      <SiteFilter
        selectedSiteId={siteId}
        onSiteChange={handleSiteChange}
      />
      <JobsTable
        jobs={data?.data ?? []}
        isLoading={isLoading}
        hasFilter={siteId !== undefined}
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
```

### UX Requirements

**SiteFilter Dropdown:**
- Positioned between page heading and JobsTable
- shadcn Select component, 280px width
- First option: "All Sites" (clears the filter)
- Lists sites with monospace URL text
- Skeleton loading while fetching sites
- Selecting a site filters jobs immediately (no submit button)

**JobsTable:**
- Columns: Title (flexible), Company (160px), Location (140px), Salary (120px), Site (160px, monospace), Scraped Date (140px)
- Row height: 40px (`h-10`)
- Hover: row background `#18181b`
- Text: 14px body font for job data fields
- Site column: monospace 13px, blue link color `#3b82f6`, navigates to `/sites` on click
- Salary: em-dash when null
- Scraped Date: muted text `#a1a1aa`, localized date format
- Default sort: most recent first (handled by API `orderBy: { createdAt: "desc" }`)

**Pagination (same pattern as SitesTable):**
- Fixed 50 items per page
- Below the table: left-aligned "Showing X-Y of N" text, right-aligned Previous/Next buttons
- Text color: `#a1a1aa` (muted), 12px font size
- Button style: ghost variant, disabled when at boundary
- Only shows when total > 50

**Empty States:**
- No jobs at all: "No jobs scraped yet. Complete a site review and save config to trigger a test scrape." with link to Review Queue
- No jobs for selected site: "No jobs found for this site."
- Styling: muted text `#71717a`, centered, `py-12`

**General UX Rules (from previous stories):**
- No confirmation dialogs for non-destructive actions (filtering, pagination)
- Loading: skeleton for initial load; no full-page loading screens
- Toast notifications not needed for this story (read-only view)

### Project Structure (Files to Create/Modify)

```
src/
  hooks/
    useJobs.ts                   # NEW -- TanStack Query hook for jobs
  components/
    jobs/
      SiteFilter.tsx             # NEW -- site filter dropdown
      JobsTable.tsx              # NEW -- jobs data table with pagination
  app/
    (dashboard)/
      jobs/page.tsx              # MODIFY -- replace placeholder with real page
```

### Anti-Patterns to AVOID

- Do NOT modify the existing `src/app/api/jobs/route.ts` -- it is complete from story 4-3
- Do NOT put Prisma queries in the frontend -- use the existing API endpoint via `apiFetch`
- Do NOT use `useState` to store the jobs list -- use `useJobs()` hook with TanStack Query
- Do NOT use `any` type -- all functions must have proper TypeScript types
- Do NOT create a new `apiFetch` -- import from `@/lib/fetch`
- Do NOT create a detail page for individual jobs -- keep everything in the list view per UX spec
- Do NOT add sorting to the jobs table for MVP -- default `createdAt desc` sort is sufficient. Sorting can be added later if needed.
- Do NOT show the `description` field in the table -- it is too long. It can be shown in a future expandable row or detail view.
- Do NOT show the `rawData` field in the table -- it is for debugging/developer inspection only
- Do NOT show the `validationStatus` field in the table for this story -- quality indicators will be added if needed based on usage
- Do NOT install new packages -- all required packages are already installed
- Do NOT modify the sidebar navigation -- the Jobs icon already exists and links to `/jobs`

### Previous Story Learnings (from Stories 1-1 through 4-3)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy` (not `middleware`).
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path configured in schema.prisma generator block.
3. **`apiFetch` lives in `src/lib/fetch.ts`** -- extracted from the original `useSites.ts` hook in a later story. All hooks import from there.
4. **Sonner** is used for toasts -- already mounted in root layout. Not needed for this read-only story.
5. **shadcn/ui v4 uses Base UI** -- component props may differ from older shadcn versions.
6. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
7. **Always run `pnpm build`** before marking story as done.
8. **ESLint `no-explicit-any`** -- avoid `any` from the start. Use proper TypeScript interfaces for all data shapes.
9. **Pagination pattern** is established in `SitesTable` -- reuse the same pattern (ghost buttons, muted text, conditional display).
10. **Select component** from shadcn/ui is already installed at `src/components/ui/select.tsx`.
11. **Link component** from Next.js (`next/link`) should be used for client-side navigation to `/sites` and `/review`.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. Navigate to `/jobs` -- page renders with heading, SiteFilter dropdown, and JobsTable (or empty state)
4. SiteFilter dropdown populates with sites
5. Selecting a site from dropdown filters the table
6. Selecting "All Sites" clears the filter
7. Page resets to 1 when filter changes
8. Site URL in table is a clickable link navigating to `/sites`
9. Salary column shows em-dash for null values
10. Pagination appears when > 50 jobs, Previous/Next buttons work correctly
11. Empty state shows correct message with link to Review Queue when no jobs exist
12. Filtered empty state shows "No jobs found for this site." when selected site has no jobs

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1: Jobs Viewer & Data Quality Review]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Table Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Empty States]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#User Journey Flows -- Journey 4: Data Quality Validation]
- [Source: _bmad-output/planning-artifacts/prd.md#FR29, FR30, FR31]
- [Source: _bmad-output/implementation-artifacts/1-2-submit-new-site.md] (frontend patterns)
- [Source: _bmad-output/implementation-artifacts/1-3-view-and-filter-site-list.md] (table/pagination patterns)
- [Source: src/app/api/jobs/route.ts] (existing API endpoint)
- [Source: prisma/schema.prisma] (Job model definition)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Fixed TypeScript error: `onValueChange` callback from Base UI Select can pass `null`, added null check with `!value || value === "all"` pattern.

### Completion Notes List

- Created `useJobs` TanStack Query hook with page, pageSize, and siteId parameters
- SiteFilter reuses existing `useSites` hook (from `src/hooks/useSites.ts`) to populate dropdown
- JobsTable follows exact same pagination pattern as SitesTable (ghost buttons, muted text, conditional display)
- All empty states implemented: no jobs at all (with link to Review Queue) and no jobs for selected site
- Both `pnpm build` and `pnpm lint` pass cleanly

### File List

- `src/hooks/useJobs.ts` (NEW) - TanStack Query hook for fetching jobs with pagination and siteId filter
- `src/components/jobs/SiteFilter.tsx` (NEW) - Site filter dropdown using shadcn Select, populated via useSites hook
- `src/components/jobs/JobsTable.tsx` (NEW) - Jobs data table with columns, pagination, and empty states
- `src/app/(dashboard)/jobs/page.tsx` (MODIFIED) - Replaced placeholder with full Jobs page wiring SiteFilter, JobsTable, and useJobs
