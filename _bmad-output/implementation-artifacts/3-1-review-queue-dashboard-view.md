# Story 3.1: Review Queue Dashboard View

Status: done

## Story

As an admin,
I want to view a prioritized queue of sites ready for review,
So that I can efficiently work through analyzed sites and correct their field mappings.

## Acceptance Criteria

1. **Given** sites exist with status REVIEW (confidence >= 70%) **When** I navigate to the Review Queue page via the sidebar **Then** I see a data table (ReviewQueueTable) showing only sites with REVIEW status, with columns: URL (monospace), Confidence (ConfidenceBar), Date Analyzed, and Actions
   - The default sort is by confidence score descending (highest confidence first)
   - The table uses the same row height (40px), hover style (`#18181b`), and visual conventions as SitesTable

2. **Given** the Review Queue has sites **When** I click the "Confidence" or "Date Analyzed" column header **Then** the table re-sorts by that column with an arrow indicator (FR15)
   - Sorting is server-side via API query parameters (same pattern as SitesTable)
   - Clicking already-sorted column toggles direction; clicking different column defaults to descending
   - Confidence sort handles null values with nulls last (though REVIEW sites should always have confidence)

3. **Given** a site is listed in the review queue **When** I click the "Review" action button on a table row **Then** a new browser tab opens with the target site URL
   - The site's AI-generated field mapping data is accessible via GET /api/sites/[id]/config (FR16)
   - The "Review" button is secondary style (outlined), single-click, no confirmation dialog

4. **Given** no sites have REVIEW status **When** I navigate to the Review Queue page **Then** I see an empty state: "No sites pending review. Add more sites or wait for AI analysis to complete." with a link to the Sites view
   - Empty state styled: centered, `py-12`, muted text `#71717a`, 14px
   - The link to Sites view is clickable and navigates to `/sites`

5. **Given** the review queue API endpoint exists **When** I request GET /api/sites with status filter REVIEW **Then** the response returns sites in `{ data, meta }` format with only REVIEW status sites included
   - The existing GET /api/sites endpoint already supports `?status=REVIEW` -- no new endpoint needed
   - Default sort for review queue: `confidenceScore` descending

6. **Given** the review queue has more than 50 sites **When** I view the table **Then** pagination shows "Showing 1-50 of N" with Previous/Next controls
   - Same pagination pattern as SitesTable (50 per page, ghost buttons, muted text)

7. **Given** a site is listed in the review queue **When** I inspect the API response **Then** the site's config data is accessible via GET /api/sites/[id]/config
   - This is a NEW API endpoint that returns the site's fieldMappings and pageFlow as `{ data }` response
   - Returns 404 if the site has no config yet (fieldMappings and pageFlow are both null)
   - This endpoint is needed by the Chrome extension (story 3-2+) to load field mappings

## Tasks / Subtasks

- [x] Task 1: Create GET /api/sites/[id]/config endpoint (AC: #7)
  - [x] 1.1: Create `src/app/api/sites/[id]/config/route.ts` with GET handler
  - [x] 1.2: Look up the site by ID using `prisma.site.findUnique()` -- return 404 if not found
  - [x] 1.3: Return `successResponse({ fieldMappings: site.fieldMappings, pageFlow: site.pageFlow })` using the standard response wrapper
  - [x] 1.4: Handle errors via `formatErrorResponse()`

- [x] Task 2: Build ReviewQueueTable component (AC: #1, #2, #6)
  - [x] 2.1: Create `src/components/review-queue/ReviewQueueTable.tsx`
  - [x] 2.2: Render data table with columns: URL (monospace `font-mono text-[13px]`, flexible width), Confidence (ConfidenceBar compact), Date Analyzed (`reviewAt` timestamp), Actions
  - [x] 2.3: Row height 40px (`h-10`), hover background `#18181b` -- matching SitesTable
  - [x] 2.4: Make Confidence and Date Analyzed column headers clickable for sorting with chevron indicators (reuse SortIndicator pattern from SitesTable)
  - [x] 2.5: Add pagination bar below the table: "Showing X-Y of N" left-aligned, Previous/Next buttons right-aligned -- same pattern as SitesTable
  - [x] 2.6: Add `sortBy`, `sortOrder`, `onSort`, `page`, `totalPages`, `total`, `onPageChange` controlled state props
  - [x] 2.7: Skeleton loading state while query is loading (5 skeleton rows)

- [x] Task 3: Add "Review" action button to ReviewQueueTable rows (AC: #3)
  - [x] 3.1: Actions column contains a single "Review" button (secondary/outlined variant, ghost size sm)
  - [x] 3.2: On click, opens `window.open(site.siteUrl, '_blank')` -- opens the target site in a new tab
  - [x] 3.3: No confirmation dialog -- zero-confirmation for non-destructive action per UX spec

- [x] Task 4: Add empty state for review queue (AC: #4)
  - [x] 4.1: When `sites.length === 0` and `isLoading` is false, display empty state
  - [x] 4.2: Message: "No sites pending review. Add more sites or wait for AI analysis to complete."
  - [x] 4.3: Include a clickable link "Go to Sites" that navigates to `/sites`
  - [x] 4.4: Styled: centered, `py-12`, muted text `#71717a`, 14px, link in blue `#3b82f6`

- [x] Task 5: Wire up Review Queue page (AC: #1, #2, #3, #4, #5, #6)
  - [x] 5.1: Update `src/app/(dashboard)/review/page.tsx` from placeholder to real implementation
  - [x] 5.2: Mark as client component (`"use client"`) for TanStack Query hooks
  - [x] 5.3: Page heading: "Review Queue" (h2, `text-2xl font-semibold`, color `#fafafa`)
  - [x] 5.4: Manage state: `page` (default 1), `sortBy` (default `"confidenceScore"`), `sortOrder` (default `"desc"`)
  - [x] 5.5: Use existing `useSites({ status: "REVIEW", page, sortBy, sortOrder })` hook -- no new hook needed
  - [x] 5.6: Compute totalPages from `data.meta.total` and pageSize (50)
  - [x] 5.7: Connect sort changes to state (reset page to 1 on sort change)
  - [x] 5.8: Pass all props to ReviewQueueTable

- [x] Task 6: Verify build and lint (AC: all)
  - [x] 6.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x] 6.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x] 6.3: Manual verification checklist (requires running server):
    - Navigate to `/review` -- page renders with heading and table (or empty state)
    - Empty state shows correct message with link to Sites view
    - If REVIEW sites exist: table shows with URL, Confidence, Date Analyzed, and Review button
    - Click "Review" button -- new tab opens with the target site URL
    - Click Confidence column header -- sorts by confidence, arrow indicator appears
    - Click Date Analyzed column header -- sorts by date, arrow indicator appears
    - GET /api/sites/[id]/config returns site's field mappings and page flow

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Import enums from `@/generated/prisma/enums`. Requires driver adapter.
- **TanStack Query v5** (`@tanstack/react-query` v5.90.21): Use `useQuery` with queryKey arrays.
- **Sonner** (v2.0.7): Use `toast.success()`, `toast.error()`. Already mounted in root layout.
- **Services layer**: ALL business logic in `src/services/`, NOT in API route handlers. Route handlers: validate input -> call service -> format response.
- **API response format**: Always use `{ data }` for single items and `{ data, meta }` for lists.

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Sites API route with status filter | `src/app/api/sites/route.ts` | Already supports `?status=REVIEW&sortBy=confidenceScore&sortOrder=desc` -- no new endpoint needed for the list |
| Site service | `src/services/siteService.ts` | Already has `listSites()` with pagination, status filter, and sorting |
| Sites TanStack hook | `src/hooks/useSites.ts` | Already has `useSites({ status: "REVIEW", sortBy, sortOrder })` -- reuse directly |
| `apiFetch` helper | `src/hooks/useSites.ts` | Already handles auth token + error formatting |
| StatusBadge component | `src/components/shared/StatusBadge.tsx` | Not needed in review queue (all items are REVIEW status) |
| ConfidenceBar component | `src/components/shared/ConfidenceBar.tsx` | Accepts `confidence: number` and `compact?: boolean` props |
| SitesTable component | `src/components/sites/SitesTable.tsx` | Reference for table pattern: sorting, pagination, skeleton, empty state. Do NOT reuse directly -- build ReviewQueueTable as a simpler dedicated component |
| SortIndicator pattern | `src/components/sites/SitesTable.tsx` | Reuse the ChevronUp/ChevronDown sort indicator pattern |
| API response helpers | `src/lib/api-utils.ts` | `successResponse()`, `listResponse()` |
| Error formatting | `src/lib/errors.ts` | `formatErrorResponse()`, `NotFoundError` |
| Zod schemas | `src/lib/validators.ts` | `paginationSchema`, `sortSchema` |
| Constants | `src/lib/constants.ts` | `DEFAULT_PAGE_SIZE` |
| TypeScript types | `src/lib/types.ts` | `ApiResponse<T>`, `ApiListResponse<T>`, `PaginationParams` |
| shadcn/ui components | `src/components/ui/` | table, button, skeleton |

### Prisma Model Reference

The Site model fields relevant to this story:

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
  reviewAt        DateTime?   // Timestamp when site entered REVIEW status
}
```

Key: `reviewAt` is the timestamp for "Date Analyzed" column (set when analysis completes and site transitions to REVIEW). Use `createdAt` as fallback if `reviewAt` is null.

### Implementation Patterns (Code Samples)

#### GET /api/sites/[id]/config endpoint

```typescript
import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({
      where: { id },
      select: { fieldMappings: true, pageFlow: true },
    });

    if (!site) {
      throw new NotFoundError("Site", id);
    }

    return successResponse({
      fieldMappings: site.fieldMappings,
      pageFlow: site.pageFlow,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
```

#### ReviewQueueTable component pattern

```typescript
"use client";

import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { ConfidenceBar } from "@/components/shared/ConfidenceBar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";
import Link from "next/link";

interface ReviewSite {
  id: string;
  siteUrl: string;
  confidenceScore: number | null;
  reviewAt: string | null;
  createdAt: string;
}

type SortableColumn = "confidenceScore" | "reviewAt";

interface ReviewQueueTableProps {
  sites: ReviewSite[];
  isLoading: boolean;
  sortBy: SortableColumn;
  sortOrder: "asc" | "desc";
  onSort: (column: SortableColumn) => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

// ... component implementation follows SitesTable pattern
```

#### Review Queue page composition

```typescript
"use client";

import { useState } from "react";
import { ReviewQueueTable } from "@/components/review-queue/ReviewQueueTable";
import { useSites } from "@/hooks/useSites";

export default function ReviewPage() {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"confidenceScore" | "reviewAt">("confidenceScore");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useSites({
    page,
    status: "REVIEW",
    sortBy,
    sortOrder,
  });

  // ... state management and sort handler follow SitesPage pattern
}
```

### Sorting by reviewAt -- Backend Support

The existing `listSites()` in `siteService.ts` accepts `sortBy: "createdAt" | "confidenceScore"`. This story needs to add `"reviewAt"` as a valid sort option.

**Changes needed:**
1. Update the `sortBy` union type in `siteService.ts` `listSites()` to accept `"reviewAt"`
2. Update the `sortSchema` in `src/lib/validators.ts` to accept `"reviewAt"` as a valid `sortBy` value
3. Handle null `reviewAt` values: use `{ sort: sortOrder, nulls: "last" }` (same pattern as confidenceScore)

```typescript
// In validators.ts - updated sortSchema
export const sortSchema = z.object({
  sortBy: z.enum(["createdAt", "confidenceScore", "reviewAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
```

```typescript
// In siteService.ts - updated listSites orderBy logic
const orderBy =
  sortBy === "confidenceScore" || sortBy === "reviewAt"
    ? { [sortBy]: { sort: sortOrder, nulls: "last" as const } }
    : { [sortBy]: sortOrder };
```

### UX Requirements

**ReviewQueueTable:**
- Columns: URL (flexible width, monospace 13px), Confidence (ConfidenceBar compact, 150px), Date Analyzed (140px), Actions (100px)
- No Status column -- all items are REVIEW status, no need to show it
- Row height: 40px (`h-10`)
- Hover: background `#18181b`
- Default sort: confidence score descending (highest first) -- FR15
- Skeleton loading while data is fetching (5 rows)
- Pagination: same pattern as SitesTable (50 per page, ghost Previous/Next, muted "Showing X-Y of N")

**Review Button:**
- Secondary/ghost button, size sm
- Opens target site URL in new tab via `window.open(siteUrl, '_blank')`
- No confirmation dialog -- non-destructive action
- Text: "Review"

**Empty State:**
- Message: "No sites pending review. Add more sites or wait for AI analysis to complete."
- Include link to Sites page (`/sites`)
- Styled: centered, `py-12`, muted text `#71717a`, 14px

**Page Title:**
- "Review Queue" -- h2, `text-2xl font-semibold`, color `#fafafa`
- Matches SitesPage heading style

### Project Structure (Files to Create/Modify)

```
src/
  components/
    review-queue/
      ReviewQueueTable.tsx       # NEW -- review queue data table
  app/
    (dashboard)/
      review/page.tsx            # MODIFY -- replace placeholder with real implementation
    api/
      sites/[id]/
        config/
          route.ts               # NEW -- GET site config endpoint
  services/
    siteService.ts               # MODIFY -- update listSites sortBy type
  lib/
    validators.ts                # MODIFY -- add "reviewAt" to sortSchema
```

### HTTP Status Codes for This Story

| Scenario | Code |
|----------|------|
| Review queue list retrieved | 200 |
| Site config retrieved | 200 |
| Site not found (config) | 404 |
| Invalid sort/pagination params | 400 |
| Unauthorized (no/bad token) | 401 (handled by proxy.ts) |
| Server error | 500 |

### Anti-Patterns to AVOID

- Do NOT create a new API endpoint for the review queue list -- reuse GET /api/sites with `?status=REVIEW`
- Do NOT create a new TanStack Query hook for review queue -- reuse `useSites({ status: "REVIEW" })`
- Do NOT copy-paste SitesTable component -- build ReviewQueueTable as a simpler, focused component (no status column, no SiteActions, no delete dialog, no status tabs)
- Do NOT put business logic in API route handlers -- use `src/services/` for any business logic
- Do NOT use `any` type -- all functions must have proper TypeScript types
- Do NOT use `middleware.ts` -- Next.js 16 renamed it to `proxy.ts`
- Do NOT import Prisma from `@prisma/client` -- import from `@/generated/prisma/client`
- Do NOT create separate response format helpers -- use existing `successResponse()` from `src/lib/api-utils.ts`
- Do NOT add a StatusBadge column to the review queue table -- all items are REVIEW status, it's redundant
- Do NOT add a confirmation dialog for the Review button -- non-destructive action, zero-confirmation per UX spec
- Do NOT install new packages -- all required packages are already installed (lucide-react for chevrons, etc.)

### Previous Story Learnings (from Stories 1-1 through 2-5)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy`.
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path.
3. **Prisma 7.4 requires driver adapter** -- PrismaClient instantiated with `{ adapter }` in `src/lib/prisma.ts`.
4. **shadcn/ui v4 uses Base UI** -- not Radix. Component props may differ from older docs.
5. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
6. **Always run `pnpm build`** before marking story as done.
7. **ESLint `no-explicit-any`** -- avoid `any` from the start, use proper types.
8. **Zod 4.x uses `z.url()`** not `z.string().url()`. `z.enum([...])` works directly.
9. **Service layer pattern** -- established in `src/services/siteService.ts`. Extend this file for site-related business logic.
10. **`apiFetch` helper** in `src/hooks/useSites.ts` handles auth token + error formatting -- reuse for all API calls.
11. **Sort with nulls** -- Prisma `{ sort: sortOrder, nulls: "last" }` pattern works for nullable fields.
12. **API route params** -- Next.js 16 uses `{ params }: { params: Promise<{ id: string }> }` -- must `await params`.
13. **Query invalidation** -- `useCreateSite()` already invalidates `["sites"]` which cascades to sub-keys. Review queue data will auto-refresh when sites are created.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. Navigate to `/review` -- page renders with heading "Review Queue"
4. If no REVIEW sites: empty state shows "No sites pending review..." with link to Sites
5. Clicking the Sites link in empty state navigates to `/sites`
6. If REVIEW sites exist: table shows URL, Confidence, Date Analyzed, and Review button
7. Click "Review" button -- new tab opens with the target site URL
8. Click Confidence column header -- table re-sorts, arrow indicator appears
9. Click Date Analyzed column header -- table re-sorts, arrow indicator appears
10. Clicking same column toggles sort direction
11. GET /api/sites?status=REVIEW returns only REVIEW sites
12. GET /api/sites/[id]/config returns field mappings and page flow
13. GET /api/sites/[nonexistent-id]/config returns 404

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1: Review Queue Dashboard View]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Table Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Empty States]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Button Hierarchy]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- Custom Components -- ReviewQueueTable]
- [Source: _bmad-output/planning-artifacts/prd.md#FR14, FR15, FR16]
- [Source: _bmad-output/implementation-artifacts/1-2-submit-new-site.md]
- [Source: _bmad-output/implementation-artifacts/1-3-view-and-filter-site-list.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

None -- all tasks completed without errors.

### Completion Notes List

- Created GET /api/sites/[id]/config endpoint returning fieldMappings and pageFlow
- Updated sortSchema in validators.ts to accept "reviewAt" as valid sortBy value
- Updated listSites() in siteService.ts to handle "reviewAt" sort with nulls-last
- Built ReviewQueueTable component with sorting, pagination, skeleton loading, empty state, and Review button
- Wired up Review Queue page as client component using existing useSites hook with status="REVIEW"
- pnpm build passes -- zero TypeScript or build errors
- pnpm lint passes -- zero warnings or errors

### File List

- `src/app/api/sites/[id]/config/route.ts` -- NEW: GET site config endpoint
- `src/components/review-queue/ReviewQueueTable.tsx` -- NEW: review queue data table
- `src/app/(dashboard)/review/page.tsx` -- MODIFIED: replaced placeholder with real implementation
- `src/services/siteService.ts` -- MODIFIED: added "reviewAt" to listSites sortBy type
- `src/lib/validators.ts` -- MODIFIED: added "reviewAt" to sortSchema enum
