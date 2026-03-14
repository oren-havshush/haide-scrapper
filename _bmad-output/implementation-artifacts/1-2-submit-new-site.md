# Story 1.2: Submit New Site

Status: done

## Story

As an admin,
I want to submit a site URL through the dashboard,
So that I can start the onboarding process for a new job site.

## Acceptance Criteria

1. **Given** I am on the Sites page **When** I paste a valid URL into the Add Site input and press Enter or click Submit **Then** a new site record is created with status ANALYZING, the input clears, and I see a toast notification "Site submitted. Analyzing..."
   - The API returns `{ data }` with the site record including id, siteUrl, status, and createdAt
   - The site's `analyzingAt` timestamp is set on creation
   - A WorkerJob record with type ANALYSIS and status PENDING is created (for future story 2-1 to pick up)

2. **Given** I am on the Sites page **When** I submit a URL with an invalid format (not a valid URL) **Then** I see an inline validation error below the input in red text and no API call is made

3. **Given** a site with URL "https://example.co.il/jobs" already exists **When** I submit the same URL **Then** I see an error toast "This site already exists" and no duplicate record is created
   - The API returns 409 with `{ error: { code: "DUPLICATE_SITE", message: "A site with this URL already exists" } }`

4. **Given** I submit a valid URL **When** the site is created successfully **Then** the site appears in the Sites table with status ANALYZING (blue StatusBadge) and the site status lifecycle timestamp for ANALYZING is recorded
   - The TanStack Query `["sites"]` cache is invalidated so the table refreshes automatically
   - The site configuration JSON fields (fieldMappings, pageFlow) remain null at this stage (FR36)
   - The site status lifecycle timestamp `analyzingAt` is recorded (FR38)

## Tasks / Subtasks

- [x] Task 1: Add ConflictError and DuplicateSiteError to error classes (AC: #3)
  - [x] 1.1: Add `ConflictError` class to `src/lib/errors.ts` extending AppError with code "CONFLICT" and status 409
  - [x] 1.2: Add `DuplicateSiteError` class extending ConflictError with code "DUPLICATE_SITE" and a user-friendly message

- [x] Task 2: Create siteService.ts business logic layer (AC: #1, #3, #4)
  - [x] 2.1: Create `src/services/siteService.ts`
  - [x] 2.2: Implement `createSite(siteUrl: string)` -- creates Site with status ANALYZING and sets `analyzingAt` timestamp
  - [x] 2.3: Handle duplicate URL via Prisma P2002 unique constraint error -- throw DuplicateSiteError
  - [x] 2.4: Create WorkerJob record (type: ANALYSIS, status: PENDING) alongside the site
  - [x] 2.5: Implement `listSites(params: { page, pageSize, status? })` -- paginated query ordered by createdAt desc
  - [x] 2.6: Return both `sites` array and `total` count for pagination metadata

- [x] Task 3: Implement POST /api/sites endpoint (AC: #1, #2, #3)
  - [x] 3.1: Add POST handler to existing `src/app/api/sites/route.ts`
  - [x] 3.2: Parse request body with `request.json()`
  - [x] 3.3: Validate with `createSiteSchema.safeParse()` -- return 400 on failure
  - [x] 3.4: Call `siteService.createSite()` -- return `successResponse(site, 201)` on success
  - [x] 3.5: Catch and format all errors via `formatErrorResponse()`

- [x] Task 4: Update GET /api/sites to return real data (AC: #4)
  - [x] 4.1: Replace stub GET handler with call to `siteService.listSites()`
  - [x] 4.2: Parse query params (page, pageSize) using `paginationSchema`
  - [x] 4.3: Accept optional `status` query parameter for filtering
  - [x] 4.4: Return `listResponse(sites, { total, page, pageSize })`

- [x] Task 5: Create useSites TanStack Query hook (AC: #1, #4)
  - [x] 5.1: Create `src/hooks/useSites.ts`
  - [x] 5.2: Implement `useSites(params?)` -- `useQuery` with key `["sites", params]`
  - [x] 5.3: Implement `useCreateSite()` -- `useMutation` that invalidates `["sites"]` on success
  - [x] 5.4: Create `apiFetch` helper for authenticated fetch calls (handle auth token for same-origin requests)

- [x] Task 6: Build AddSiteInput component (AC: #1, #2, #3)
  - [x] 6.1: Create `src/components/sites/AddSiteInput.tsx`
  - [x] 6.2: Implement single-line URL input (monospace font) + Submit button in a flex row
  - [x] 6.3: Client-side validation using `z.url()` before API call -- show inline error in red text (#ef4444, 12px)
  - [x] 6.4: Submit on Enter key press (onKeyDown handler)
  - [x] 6.5: Clear input on successful submission
  - [x] 6.6: Show spinner + disable button/input during mutation pending state
  - [x] 6.7: Call `toast.success("Site submitted. Analyzing...")` on success
  - [x] 6.8: Call `toast.error("This site already exists")` on 409 duplicate
  - [x] 6.9: Call `toast.error(message)` for other server errors

- [x] Task 7: Build SitesTable component (AC: #4)
  - [x] 7.1: Create `src/components/sites/SitesTable.tsx`
  - [x] 7.2: Render data table with columns: URL (monospace, flexible width), Status (StatusBadge), Confidence (ConfidenceBar compact), Date Added, Actions
  - [x] 7.3: Row height 40px, hover background `#18181b`
  - [x] 7.4: Handle null confidenceScore gracefully -- show dash when null
  - [x] 7.5: Format Date Added as localized date string
  - [x] 7.6: Actions column: placeholder dash for now (full actions built in story 1-4)
  - [x] 7.7: Empty state: "No sites yet. Paste a URL above to add your first site." in muted text, centered
  - [x] 7.8: Skeleton loading state while query is loading

- [x] Task 8: Wire up Sites page (AC: #1, #2, #3, #4)
  - [x] 8.1: Update `src/app/(dashboard)/sites/page.tsx` from placeholder to real page
  - [x] 8.2: Mark as client component (`"use client"`) for TanStack Query hooks
  - [x] 8.3: Page heading: "Sites" (h2, text-2xl, font-semibold, color #fafafa)
  - [x] 8.4: Place AddSiteInput below heading
  - [x] 8.5: Place SitesTable below AddSiteInput
  - [x] 8.6: Wire `useSites()` hook to SitesTable
  - [x] 8.7: Wire `useCreateSite()` mutation to AddSiteInput
  - [x] 8.8: Ensure table refreshes after successful creation via query invalidation

- [x] Task 9: Ensure Sonner Toaster is in root layout (AC: #1, #3)
  - [x] 9.1: Check if `<Toaster />` from sonner is already rendered in `src/app/layout.tsx` or `src/app/providers.tsx`
  - [x] 9.2: If missing, add `<Toaster position="top-right" theme="dark" richColors />` to the root layout
  - [x] 9.3: Import from `sonner` directly (not from `src/components/ui/sonner.tsx` -- check which works)

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Requires driver adapter.
- **Zod 4.x** (v4.3.6): Uses `z.url()` for URL validation (already in validators.ts). For safeParse errors, access `parsed.error.issues` for individual messages.
- **TanStack Query v5** (`@tanstack/react-query` v5.90.21): Use `useMutation` with `onSuccess` for cache invalidation.
- **Sonner** (v2.0.7): Use `toast.success()`, `toast.error()`. Component at `src/components/ui/sonner.tsx`.
- **Services layer**: ALL business logic in `src/services/`, NOT in API route handlers. Route handlers: validate input -> call service -> format response.

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Zod schema for site creation | `src/lib/validators.ts` -> `createSiteSchema` | Already validates `siteUrl` with `z.url()` |
| Zod schema for pagination | `src/lib/validators.ts` -> `paginationSchema` | page/pageSize with defaults |
| API response helpers | `src/lib/api-utils.ts` -> `successResponse()`, `listResponse()`, `errorResponse()` | Consistent response wrappers |
| Error formatting | `src/lib/errors.ts` -> `formatErrorResponse()`, `AppError`, `ValidationError` | Central error handling |
| StatusBadge component | `src/components/shared/StatusBadge.tsx` | Accepts `status: SiteStatusValue` prop ("ANALYZING" / "REVIEW" / "ACTIVE" / "FAILED" / "SKIPPED") |
| ConfidenceBar component | `src/components/shared/ConfidenceBar.tsx` | Accepts `confidence: number` and `compact?: boolean` props |
| Prisma client singleton | `src/lib/prisma.ts` | Already configured with PrismaPg driver adapter |
| Constants | `src/lib/constants.ts` | `CONFIDENCE_THRESHOLD`, `DEFAULT_PAGE_SIZE`, status labels |
| TypeScript types | `src/lib/types.ts` | `ApiResponse<T>`, `ApiListResponse<T>`, `ApiErrorResponse`, `SiteConfig`, `PaginationParams` |
| shadcn/ui components | `src/components/ui/` | button, input, table, badge, card, sonner, tabs, tooltip, select, dropdown-menu, skeleton, separator, sheet, progress, sidebar, dialog |

### Prisma Model Reference

The Site model is already defined in `prisma/schema.prisma`:

```prisma
model Site {
  id              String       @id @default(cuid())
  siteUrl         String       @unique
  status          SiteStatus   @default(ANALYZING)
  confidenceScore Float?
  fieldMappings   Json?
  pageFlow        Json?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  analyzingAt     DateTime?
  reviewAt        DateTime?
  activeAt        DateTime?
  failedAt        DateTime?
  skippedAt       DateTime?
  jobs            Job[]
  scrapeRuns      ScrapeRun[]
  analysisResults AnalysisResult[]
  workerJobs      WorkerJob[]
}

model WorkerJob {
  id          String          @id @default(cuid())
  siteId      String
  site        Site            @relation(fields: [siteId], references: [id])
  type        WorkerJobType   // ANALYSIS or SCRAPE
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
```

Key: `siteUrl` has `@unique` constraint. Prisma throws error with code `P2002` on duplicate insert.

### Implementation Patterns (Code Samples)

#### Error Classes Addition (src/lib/errors.ts)

Add these below the existing ValidationError class:

```typescript
export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class DuplicateSiteError extends ConflictError {
  constructor() {
    super("A site with this URL already exists");
    this.code = "DUPLICATE_SITE";
    this.name = "DuplicateSiteError";
  }
}
```

#### Service Layer Pattern (src/services/siteService.ts)

This is the FIRST service file. It establishes the services layer pattern for the entire project.

```typescript
import { prisma } from "@/lib/prisma";
import { DuplicateSiteError } from "@/lib/errors";
import type { PaginationParams } from "@/lib/types";

export async function createSite(siteUrl: string) {
  try {
    const site = await prisma.site.create({
      data: {
        siteUrl,
        status: "ANALYZING",
        analyzingAt: new Date(),
      },
    });

    // Create worker job for background AI analysis (picked up by story 2-1)
    await prisma.workerJob.create({
      data: {
        siteId: site.id,
        type: "ANALYSIS",
        status: "PENDING",
      },
    });

    return site;
  } catch (error: unknown) {
    // Handle Prisma unique constraint violation (P2002)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as Record<string, unknown>).code === "P2002"
    ) {
      throw new DuplicateSiteError();
    }
    throw error;
  }
}

export async function listSites(
  params: PaginationParams & { status?: string }
) {
  const { page, pageSize, status } = params;
  const where = status ? { status: status as any } : {};

  const [sites, total] = await Promise.all([
    prisma.site.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.site.count({ where }),
  ]);

  return { sites, total };
}
```

#### Route Handler Pattern (src/app/api/sites/route.ts)

Replace the existing stub with full GET + POST handlers:

```typescript
import { NextRequest } from "next/server";
import { successResponse, listResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { createSiteSchema, paginationSchema } from "@/lib/validators";
import { createSite, listSites } from "@/services/siteService";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const params = paginationSchema.parse({
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });
    const status = searchParams.get("status") ?? undefined;

    const { sites, total } = await listSites({ ...params, status });
    return listResponse(sites, {
      total,
      page: params.page,
      pageSize: params.pageSize,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSiteSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
      );
    }

    const site = await createSite(parsed.data.siteUrl);
    return successResponse(site, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
```

#### TanStack Query Hook Pattern (src/hooks/useSites.ts)

```typescript
"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

// Fetch helper for API calls.
// proxy.ts requires Bearer token for ALL /api/* routes.
// For MVP: expose token via NEXT_PUBLIC_API_TOKEN env variable.
async function apiFetch(url: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  const token =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_API_TOKEN
      : undefined;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const error = new Error(
      errorBody?.error?.message ?? `Request failed with status ${res.status}`
    );
    (error as any).code = errorBody?.error?.code;
    (error as any).status = res.status;
    throw error;
  }

  return res.json();
}

interface UseSitesParams {
  page?: number;
  pageSize?: number;
  status?: string;
}

export function useSites(params: UseSitesParams = {}) {
  const { page = 1, pageSize = 50, status } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("pageSize", String(pageSize));
  if (status) searchParams.set("status", status);

  return useQuery({
    queryKey: ["sites", { page, pageSize, status }],
    queryFn: () => apiFetch(`/api/sites?${searchParams.toString()}`),
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteUrl: string) =>
      apiFetch("/api/sites", {
        method: "POST",
        body: JSON.stringify({ siteUrl }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}
```

#### AddSiteInput Component Pattern (src/components/sites/AddSiteInput.tsx)

```typescript
"use client";

import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateSite } from "@/hooks/useSites";

const urlSchema = z.url();

export function AddSiteInput() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createSite = useCreateSite();

  const handleSubmit = () => {
    setError(null);

    const result = urlSchema.safeParse(url.trim());
    if (!result.success) {
      setError("Please enter a valid URL (e.g. https://example.co.il/jobs)");
      return;
    }

    createSite.mutate(result.data, {
      onSuccess: () => {
        setUrl("");
        toast.success("Site submitted. Analyzing...");
      },
      onError: (err: any) => {
        if (err.code === "DUPLICATE_SITE" || err.status === 409) {
          toast.error("This site already exists");
        } else {
          toast.error(err.message ?? "Failed to create site");
        }
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="mb-6">
      <div className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://example.co.il/jobs"
          className="font-mono text-[13px] flex-1"
          disabled={createSite.isPending}
        />
        <Button
          onClick={handleSubmit}
          disabled={createSite.isPending || !url.trim()}
        >
          {createSite.isPending ? "Submitting..." : "Submit"}
        </Button>
      </div>
      {error && (
        <p className="text-xs mt-1" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}
    </div>
  );
}
```

#### SitesTable Component Pattern (src/components/sites/SitesTable.tsx)

```typescript
"use client";

import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfidenceBar } from "@/components/shared/ConfidenceBar";
import { Skeleton } from "@/components/ui/skeleton";

interface Site {
  id: string;
  siteUrl: string;
  status: "ANALYZING" | "REVIEW" | "ACTIVE" | "FAILED" | "SKIPPED";
  confidenceScore: number | null;
  createdAt: string;
}

interface SitesTableProps {
  sites: Site[];
  isLoading: boolean;
}

export function SitesTable({ sites, isLoading }: SitesTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm" style={{ color: "#71717a" }}>
          No sites yet. Paste a URL above to add your first site.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-auto">URL</TableHead>
          <TableHead className="w-[120px]">Status</TableHead>
          <TableHead className="w-[150px]">Confidence</TableHead>
          <TableHead className="w-[140px]">Date Added</TableHead>
          <TableHead className="w-[100px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sites.map((site) => (
          <TableRow key={site.id} className="h-10 hover:bg-[#18181b]">
            <TableCell className="font-mono text-[13px]">
              {site.siteUrl}
            </TableCell>
            <TableCell>
              <StatusBadge status={site.status} />
            </TableCell>
            <TableCell>
              {site.confidenceScore != null ? (
                <ConfidenceBar confidence={site.confidenceScore} compact />
              ) : (
                <span style={{ color: "#71717a" }}>&mdash;</span>
              )}
            </TableCell>
            <TableCell className="text-sm" style={{ color: "#a1a1aa" }}>
              {new Date(site.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <span style={{ color: "#71717a" }}>&mdash;</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

#### Sites Page Composition (src/app/(dashboard)/sites/page.tsx)

```typescript
"use client";

import { AddSiteInput } from "@/components/sites/AddSiteInput";
import { SitesTable } from "@/components/sites/SitesTable";
import { useSites } from "@/hooks/useSites";

export default function SitesPage() {
  const { data, isLoading } = useSites();

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4" style={{ color: "#fafafa" }}>
        Sites
      </h2>
      <AddSiteInput />
      <SitesTable
        sites={data?.data ?? []}
        isLoading={isLoading}
      />
    </div>
  );
}
```

### Frontend Auth Strategy (IMPORTANT)

The `src/proxy.ts` requires a Bearer token for ALL `/api/*` routes. The dashboard frontend makes same-origin API calls from the browser. There are two approaches:

**Option A (Recommended for MVP):** Add `NEXT_PUBLIC_API_TOKEN` to `.env.local` and `.env.example`. The frontend `apiFetch` helper includes this in the `Authorization` header. This is simple and works for a single-admin tool.

```
# .env.local (add this line)
NEXT_PUBLIC_API_TOKEN=your-secret-token-here

# .env.example (add this line)
NEXT_PUBLIC_API_TOKEN=your-api-token
```

**Option B (Better security):** Update `proxy.ts` to skip auth for same-origin requests by checking the referer/origin header or using cookies. This is architecturally cleaner but more work.

The dev agent should implement Option A unless they have a strong reason for Option B.

### UX Requirements

**AddSiteInput:**
- Single-line input + Submit button on the same row (flex)
- Input: monospace font (`font-mono text-[13px]`), placeholder "https://example.co.il/jobs"
- Button: primary style (the one primary button on this page), text "Submit"
- Submit on Enter key (in addition to button click)
- Input clears on success
- Button disabled + shows "Submitting..." during pending state
- Inline validation error below input in red (#ef4444, 12px text)
- No confirmation dialog (zero-confirmation for non-destructive actions per UX spec)

**SitesTable:**
- Columns: URL (flexible width, monospace 13px), Status (StatusBadge), Confidence (ConfidenceBar compact), Date Added, Actions
- Row height: 40px (`h-10`)
- Hover: background `#18181b`
- Default sort: most recent first (handled by API, `orderBy: { createdAt: "desc" }`)
- Empty state: "No sites yet. Paste a URL above to add your first site." in muted text (#71717a), centered
- Skeleton loading while data is fetching
- null confidenceScore renders as em-dash
- Actions column: placeholder dash (full actions in story 1-4)

**Toast Notifications:**
- Position: top-right, below 48px top bar
- Use sonner: `toast.success("Site submitted. Analyzing...")` on creation
- Use sonner: `toast.error("This site already exists")` on 409 duplicate
- Use sonner: `toast.error(message)` for other errors
- Auto-dismiss after 4 seconds for success

### HTTP Status Codes for This Story

| Scenario | Code |
|----------|------|
| Site created successfully | 201 |
| Sites list retrieved | 200 |
| Invalid URL format | 400 |
| Duplicate URL | 409 |
| Unauthorized (no/bad token) | 401 (handled by proxy.ts) |
| Server error | 500 |

### Project Structure (Files to Create/Modify)

```
src/
  services/
    siteService.ts             # NEW -- site business logic (createSite, listSites)
  hooks/
    useSites.ts                # NEW -- TanStack Query hooks for sites
  components/
    sites/
      AddSiteInput.tsx         # NEW -- URL submission input + button
      SitesTable.tsx           # NEW -- sites data table
  app/
    layout.tsx                 # MODIFY -- add Toaster if missing
    (dashboard)/
      sites/page.tsx           # MODIFY -- replace placeholder with real page
    api/
      sites/route.ts           # MODIFY -- add POST handler, implement real GET
  lib/
    errors.ts                  # MODIFY -- add ConflictError, DuplicateSiteError
```

### Anti-Patterns to AVOID

- Do NOT put Prisma queries directly in route handlers -- always go through `src/services/`
- Do NOT use `useState` to store the sites list -- use `useSites()` hook with TanStack Query
- Do NOT use `any` type -- all functions must have proper TypeScript types
- Do NOT create separate validation for client vs server -- reuse `createSiteSchema` from `src/lib/validators.ts`
- Do NOT skip the `analyzingAt` timestamp when creating a site -- FR38 requires lifecycle timestamps
- Do NOT skip creating the WorkerJob record -- it is needed for story 2-1 to work
- Do NOT use `middleware.ts` -- Next.js 16 renamed it to `proxy.ts`
- Do NOT import Prisma from `@prisma/client` -- import from `@/generated/prisma/client`
- Do NOT use `z.string().url()` -- Zod 4 uses `z.url()` (already correct in validators.ts)
- Do NOT create new response format helpers -- use existing `successResponse`, `listResponse`, `errorResponse` from `src/lib/api-utils.ts`
- Do NOT create a separate detail page for sites -- keep everything in the list view per UX spec
- Do NOT add a confirmation dialog for site submission -- non-destructive action, zero-confirmation per UX spec
- Do NOT use `window.alert()` -- use sonner toasts

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. Navigate to `/sites` -- page renders with heading, input, and empty table (or skeleton)
3. Submit a valid URL -- toast appears, table shows new site with ANALYZING StatusBadge
4. Submit an invalid URL -- inline red error appears below input, no API call made
5. Submit the same URL again -- error toast "This site already exists"
6. Check database (Prisma Studio: `npx prisma studio`) -- Site record has correct status, `analyzingAt` set, WorkerJob record with PENDING status exists
7. Refresh the page -- previously created sites appear in the table
8. Empty state message appears when no sites exist

### Previous Story Learnings (from Story 1-1)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy` (not `middleware`).
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path configured in schema.prisma generator block.
3. **Prisma 7.4 requires driver adapter** -- PrismaClient instantiated with `{ adapter }` in `src/lib/prisma.ts`.
4. **No local PostgreSQL was available during story 1-1** -- migration SQL was generated via `prisma migrate diff` but not applied. Check if a database is available and run `npx prisma migrate dev` if possible.
5. **`sonner` is used for toasts** -- import `{ toast }` from "sonner" and use `<Toaster />` component.
6. **shadcn/ui v4 components already installed** -- 16 components: button, input, table, badge, card, dialog, sonner, tabs, tooltip, select, dropdown-menu, sidebar, progress, separator, skeleton, sheet.
7. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
8. **Always run `pnpm build`** before marking story as done.
9. **Code review found issues in story 1-1** including: missing migration SQL, loose string types in component props, dead code connections. Be vigilant about type safety and following established patterns.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: Submit New Site]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Form Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Empty States]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Table Patterns]
- [Source: _bmad-output/planning-artifacts/prd.md#FR1, FR36, FR38]
- [Source: _bmad-output/implementation-artifacts/1-1-project-scaffolding-and-dashboard-shell.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

None required -- all tasks completed without issues.

### Completion Notes List

- All 9 tasks (28 subtasks) implemented following the story's code patterns exactly.
- Fixed 4 ESLint `no-explicit-any` violations by introducing proper types: `SiteStatus` from generated Prisma enums, `ApiError` interface in useSites.ts, and `Error & { code?: string; status?: number }` in AddSiteInput.tsx.
- `pnpm build` passes successfully with no TypeScript or build errors.
- `pnpm lint` passes with zero warnings or errors.
- Sonner Toaster imported directly from `sonner` (not shadcn wrapper) to avoid dependency on ThemeProvider.
- Added `NEXT_PUBLIC_API_TOKEN` to `.env.example` for frontend auth (Option A MVP strategy).
- Service layer pattern established in `src/services/siteService.ts` -- first service file in the project.
- WorkerJob record creation included in createSite for story 2-1 pickup.

### File List

- `src/lib/errors.ts` -- MODIFIED: Added ConflictError and DuplicateSiteError classes
- `src/services/siteService.ts` -- NEW: Site business logic (createSite, listSites)
- `src/app/api/sites/route.ts` -- MODIFIED: Full GET + POST handlers replacing stub
- `src/hooks/useSites.ts` -- NEW: TanStack Query hooks (useSites, useCreateSite) with apiFetch helper
- `src/components/sites/AddSiteInput.tsx` -- NEW: URL submission input + button with validation
- `src/components/sites/SitesTable.tsx` -- NEW: Sites data table with StatusBadge, ConfidenceBar, skeleton, empty state
- `src/app/(dashboard)/sites/page.tsx` -- MODIFIED: Wired up client component with hooks and components
- `src/app/layout.tsx` -- MODIFIED: Added Sonner Toaster component
- `.env.example` -- MODIFIED: Added NEXT_PUBLIC_API_TOKEN
