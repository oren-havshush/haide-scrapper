# Story 1.4: Manage Site Lifecycle

Status: done

## Story

As an admin,
I want to skip, re-enable, and delete sites,
So that I can control which sites are in my active pipeline.

## Acceptance Criteria

1. **Given** a site with status ACTIVE, REVIEW, or FAILED is visible in the Sites table **When** I click the "Skip" action button in the table row **Then** the site status changes to SKIPPED immediately without a confirmation dialog
   - The StatusBadge updates to grey "Skipped"
   - The status transition timestamp `skippedAt` is recorded in the database
   - A toast notification appears: "Site skipped"
   - The tab counts refresh automatically

2. **Given** a site with status SKIPPED or FAILED is visible in the Sites table **When** I click the "Re-analyze" action button **Then** the site status changes to ANALYZING
   - I see a toast confirmation "Re-analysis triggered for [site URL]"
   - The status transition timestamp `analyzingAt` is updated
   - A new WorkerJob record with type ANALYSIS and status PENDING is created
   - The tab counts refresh automatically

3. **Given** any site is visible in the Sites table **When** I click the "..." overflow menu button in the Actions column **Then** a dropdown menu appears with a "Delete" option styled with destructive red text

4. **Given** the overflow menu is open **When** I click "Delete" **Then** a confirmation dialog appears: "Delete this site?" with description "This will permanently remove the site and all associated data (analysis results, scrape runs, jobs). This cannot be undone." with Cancel and Delete buttons
   - The Delete button is styled as destructive (red)
   - The Cancel button is styled as outline/secondary

5. **Given** the delete confirmation dialog is shown **When** I click "Delete" to confirm **Then** the site and all associated data (analysis results, scrape runs, jobs, worker jobs) are permanently removed
   - The table updates to reflect the deletion (TanStack Query cache invalidation)
   - I see a toast confirmation "Site deleted"
   - The tab counts refresh automatically

6. **Given** the delete confirmation dialog is shown **When** I click "Cancel" **Then** the dialog closes and no changes are made

7. **Given** I perform any status change action **When** the action completes **Then** the site's status lifecycle timestamps are updated in the database (FR38)
   - The site service layer enforces valid status transitions:
     - ACTIVE -> SKIPPED (allowed)
     - REVIEW -> SKIPPED (allowed)
     - FAILED -> SKIPPED (allowed)
     - SKIPPED -> ANALYZING (allowed, re-analyze)
     - FAILED -> ANALYZING (allowed, re-analyze)
     - ANALYZING -> SKIPPED (NOT allowed -- must wait for analysis to complete)
     - SKIPPED -> ACTIVE (NOT allowed -- must go through ANALYZING first)
     - SKIPPED -> REVIEW (NOT allowed -- must go through ANALYZING first)
   - Invalid transitions return a 400 error with a clear message

8. **Given** the Actions column in the SitesTable **When** I view any row **Then** the visible action buttons depend on the site's current status:
   - ANALYZING: No action buttons (analysis in progress)
   - REVIEW: "Skip" button + "..." overflow menu (with Delete)
   - ACTIVE: "Skip" button + "..." overflow menu (with Delete)
   - FAILED: "Re-analyze" button + "..." overflow menu (with Delete)
   - SKIPPED: "Re-analyze" button + "..." overflow menu (with Delete)

## Tasks / Subtasks

- [x] Task 1: Add status transition logic and validation to siteService.ts (AC: #1, #2, #7)
  - [x] 1.1: Add a `VALID_STATUS_TRANSITIONS` map defining allowed transitions in `src/services/siteService.ts`
    - Map structure: `Record<SiteStatus, SiteStatus[]>` where the value is the list of statuses the site can transition TO
    - ANALYZING: [REVIEW, ACTIVE, FAILED] (system-driven only)
    - REVIEW: [SKIPPED, ACTIVE, FAILED, ANALYZING]
    - ACTIVE: [SKIPPED, FAILED]
    - FAILED: [SKIPPED, ANALYZING]
    - SKIPPED: [ANALYZING]
  - [x] 1.2: Add `InvalidTransitionError` class to `src/lib/errors.ts`
    - Extends `AppError` with code `"INVALID_TRANSITION"`, status 400
    - Message: `Cannot transition from ${from} to ${to}`
  - [x] 1.3: Add `updateSiteStatus(siteId: string, newStatus: SiteStatus)` to `src/services/siteService.ts`
    - Fetch current site by ID (throw `NotFoundError` if not found)
    - Validate the transition against `VALID_STATUS_TRANSITIONS` (throw `InvalidTransitionError` if invalid)
    - Update status and set the corresponding timestamp field (`analyzingAt`, `reviewAt`, `activeAt`, `failedAt`, `skippedAt`) to `new Date()`
    - If transitioning to ANALYZING (re-analyze), also create a new WorkerJob record with type ANALYSIS, status PENDING
    - Return the updated site
  - [x] 1.4: Add `deleteSite(siteId: string)` to `src/services/siteService.ts`
    - Fetch current site by ID (throw `NotFoundError` if not found)
    - Delete all related records in order: WorkerJob, AnalysisResult, Job, ScrapeRun, then Site (cascade via Prisma relations or explicit deletes)
    - Use a Prisma transaction (`prisma.$transaction`) to ensure atomicity
    - Return void

- [x] Task 2: Create API routes for site status update and deletion (AC: #1, #2, #3, #4, #5, #7)
  - [x] 2.1: Create `src/app/api/sites/[id]/route.ts` with PATCH and DELETE handlers
  - [x] 2.2: PATCH handler:
    - Parse request body with `updateSiteStatusSchema.safeParse()` (see Task 3)
    - Call `siteService.updateSiteStatus(id, status)`
    - Return `successResponse(site)` on success
    - Catch and format errors via `formatErrorResponse()`
  - [x] 2.3: DELETE handler:
    - Call `siteService.deleteSite(id)`
    - Return `NextResponse` with status 204 (no content)
    - Catch and format errors via `formatErrorResponse()`

- [x] Task 3: Add Zod schema for status update (AC: #7)
  - [x] 3.1: Add `updateSiteStatusSchema` to `src/lib/validators.ts`
    - `z.object({ status: z.enum(["ANALYZING", "REVIEW", "ACTIVE", "FAILED", "SKIPPED"]) })`
    - This is separate from the existing `updateSiteSchema` -- this one validates a single status field for explicit status changes

- [x] Task 4: Add mutation hooks for site actions (AC: #1, #2, #5)
  - [x] 4.1: Add `useUpdateSiteStatus()` mutation to `src/hooks/useSites.ts`
    - `mutationFn: ({ siteId, status }: { siteId: string; status: string }) => apiFetch(\`/api/sites/\${siteId}\`, { method: "PATCH", body: JSON.stringify({ status }) })`
    - `onSuccess`: invalidate `["sites"]` query key (cascades to counts)
  - [x] 4.2: Add `useDeleteSite()` mutation to `src/hooks/useSites.ts`
    - `mutationFn: (siteId: string) => apiFetch(\`/api/sites/\${siteId}\`, { method: "DELETE" })`
    - Handle 204 response (no JSON body): modify `apiFetch` to return `null` for 204 status or check `res.status === 204` before calling `res.json()`
    - `onSuccess`: invalidate `["sites"]` query key (cascades to counts)

- [x] Task 5: Build SiteActions component with inline buttons and overflow menu (AC: #1, #2, #3, #8)
  - [x] 5.1: Create `src/components/sites/SiteActions.tsx`
  - [x] 5.2: Accept props: `site: Site` (with id, siteUrl, status), `onSkip`, `onReanalyze`, `onDelete` callbacks
  - [x] 5.3: Render inline action buttons based on site status:
    - ANALYZING: no buttons (empty cell or muted dash)
    - REVIEW: "Skip" button (ghost/secondary style) + "..." overflow trigger
    - ACTIVE: "Skip" button + "..." overflow trigger
    - FAILED: "Re-analyze" button + "..." overflow trigger
    - SKIPPED: "Re-analyze" button + "..." overflow trigger
  - [x] 5.4: "Skip" button: text "Skip", ghost variant, calls `onSkip(site.id)` with no confirmation (zero-confirmation per UX spec)
  - [x] 5.5: "Re-analyze" button: text "Re-analyze", ghost variant, calls `onReanalyze(site.id, site.siteUrl)` with no confirmation
  - [x] 5.6: "..." overflow button: renders a `DropdownMenu` with:
    - `DropdownMenuTrigger` as a ghost icon button (`MoreHorizontal` icon from lucide-react)
    - `DropdownMenuContent` with a single item:
      - `DropdownMenuItem` with variant="destructive": "Delete" with `Trash2` icon from lucide-react
      - onClick calls `onDelete(site.id)` (which triggers the dialog)
  - [x] 5.7: Buttons are compact: size="sm", max height 28px, to fit within the 40px row height
  - [x] 5.8: Buttons show loading/disabled state while the corresponding mutation is pending

- [x] Task 6: Build DeleteSiteDialog confirmation component (AC: #4, #5, #6)
  - [x] 6.1: Create `src/components/sites/DeleteSiteDialog.tsx`
  - [x] 6.2: Accept props: `open: boolean`, `onOpenChange: (open: boolean) => void`, `onConfirm: () => void`, `isDeleting: boolean`
  - [x] 6.3: Use shadcn Dialog components: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`
  - [x] 6.4: Dialog content:
    - Title: "Delete this site?"
    - Description: "This will permanently remove the site and all associated data (analysis results, scrape runs, jobs). This cannot be undone."
  - [x] 6.5: Footer buttons:
    - Cancel button: `variant="outline"`, text "Cancel", calls `onOpenChange(false)`
    - Delete button: `variant="destructive"` (red), text "Delete" (or "Deleting..." when `isDeleting` is true), calls `onConfirm()`, disabled while `isDeleting`
  - [x] 6.6: Dialog closes when Cancel is clicked or when clicking outside/pressing Escape (default Dialog behavior)

- [x] Task 7: Update SitesTable to render SiteActions and wire delete dialog (AC: #1-8)
  - [x] 7.1: Replace the placeholder dash in the Actions column with the `SiteActions` component
  - [x] 7.2: Add state management for delete dialog: `deleteTargetId: string | null`
  - [x] 7.3: Wire action callbacks:
    - `onSkip`: call `updateSiteStatus.mutate({ siteId, status: "SKIPPED" })`, show `toast.success("Site skipped")`
    - `onReanalyze`: call `updateSiteStatus.mutate({ siteId, status: "ANALYZING" })`, show `toast.success(\`Re-analysis triggered for \${siteUrl}\`)`
    - `onDelete`: set `deleteTargetId` to the site's id (opens the dialog)
  - [x] 7.4: Render `DeleteSiteDialog` controlled by `deleteTargetId !== null`
    - `onConfirm`: call `deleteSite.mutate(deleteTargetId)`, show `toast.success("Site deleted")`, set `deleteTargetId = null`
    - `onOpenChange`: set `deleteTargetId = null` when dialog closes
  - [x] 7.5: Pass `useUpdateSiteStatus()` and `useDeleteSite()` mutations through props from the Sites page, or call them directly inside SitesTable (the component is already a client component)
  - [x] 7.6: Widen the Actions column from `w-[100px]` to `w-[160px]` to accommodate the buttons + overflow menu

- [x] Task 8: Handle 204 No Content in apiFetch (AC: #5)
  - [x] 8.1: Update the `apiFetch` helper in `src/hooks/useSites.ts` to handle 204 responses
    - After the `!res.ok` check, add: `if (res.status === 204) return null;`
    - This prevents `res.json()` from failing on empty 204 responses (DELETE returns no body)

- [x] Task 9: Verify and test (AC: #1-8)
  - [x] 9.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x] 9.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x] 9.3: Navigate to `/sites` -- Actions column shows contextual buttons per site status
  - [x] 9.4: Click "Skip" on an ACTIVE/REVIEW/FAILED site -- status changes to SKIPPED, toast appears, counts update
  - [x] 9.5: Click "Re-analyze" on a SKIPPED/FAILED site -- status changes to ANALYZING, toast appears, counts update
  - [x] 9.6: Click "..." then "Delete" -- dialog appears with destructive styling
  - [x] 9.7: Click "Cancel" on delete dialog -- dialog closes, no changes
  - [x] 9.8: Click "Delete" on delete dialog -- site removed, toast appears, counts update
  - [x] 9.9: Verify ANALYZING sites show no action buttons (analysis in progress)
  - [x] 9.10: Verify invalid transitions are rejected (e.g., cannot skip an ANALYZING site)

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Uses App Router. Auth middleware is `src/proxy.ts` (NOT middleware.ts), exported as `proxy()`.
- **Prisma 7.4.x**: Import from `@/generated/prisma/client` (NOT `@prisma/client`). Import enums from `@/generated/prisma/enums`. Requires driver adapter.
- **Zod 4.x** (v4.3.6): Uses `z.enum()` for enum validation. Do NOT use `z.string().url()` -- use `z.url()`.
- **TanStack Query v5** (`@tanstack/react-query` v5.90.21): Use `useMutation` with `onSuccess` for cache invalidation via `queryClient.invalidateQueries({ queryKey: ["sites"] })`.
- **Sonner** (v2.0.7): Use `toast.success()`, `toast.error()`. Already mounted in root layout.
- **Services layer**: ALL business logic in `src/services/`, NOT in API route handlers. Route handlers: validate input -> call service -> format response.
- **shadcn/ui uses Base UI (NOT Radix)**: Dialog is `@base-ui/react/dialog`, DropdownMenu is `@base-ui/react/menu`. Props may differ from Radix-based shadcn docs. Use the existing component wrappers from `src/components/ui/`.

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Site service | `src/services/siteService.ts` | Already has `createSite()`, `listSites()`, `getStatusCounts()` -- ADD new functions here |
| Sites API route | `src/app/api/sites/route.ts` | Already has GET + POST -- DO NOT modify this file |
| Sites hooks | `src/hooks/useSites.ts` | Already has `useSites()`, `useCreateSite()`, `useSiteStatusCounts()`, `apiFetch()` -- ADD new hooks here |
| SitesTable component | `src/components/sites/SitesTable.tsx` | Already has full table with sorting, pagination, empty states -- MODIFY to add actions |
| Sites page | `src/app/(dashboard)/sites/page.tsx` | Already has state management for filter/sort/page -- MAY need minor updates |
| Zod validators | `src/lib/validators.ts` | Already has `createSiteSchema`, `updateSiteSchema`, `paginationSchema`, `sortSchema` |
| Error classes | `src/lib/errors.ts` | Already has `AppError`, `NotFoundError`, `ValidationError`, `ConflictError`, `DuplicateSiteError` |
| API response helpers | `src/lib/api-utils.ts` | `successResponse()`, `listResponse()`, `errorResponse()`, `formatErrorResponse()` |
| StatusBadge | `src/components/shared/StatusBadge.tsx` | Accepts `status: SiteStatusValue` prop |
| ConfidenceBar | `src/components/shared/ConfidenceBar.tsx` | Accepts `confidence: number` and `compact?: boolean` |
| Dialog component | `src/components/ui/dialog.tsx` | Uses `@base-ui/react/dialog`. Exports: Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose |
| DropdownMenu component | `src/components/ui/dropdown-menu.tsx` | Uses `@base-ui/react/menu`. Exports: DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator. DropdownMenuItem supports `variant="destructive"` |
| Button component | `src/components/ui/button.tsx` | Supports `variant="ghost"`, `variant="destructive"`, `variant="outline"`, `size="sm"`, `size="icon-sm"` |
| Prisma client | `src/lib/prisma.ts` | Singleton with PrismaPg driver adapter |
| Constants | `src/lib/constants.ts` | `CONFIDENCE_THRESHOLD`, `DEFAULT_PAGE_SIZE`, status labels |
| TypeScript types | `src/lib/types.ts` | `ApiResponse<T>`, `ApiErrorResponse`, `PaginationParams` |

### Prisma Model Reference

The Site model and its relations (from `prisma/schema.prisma`):

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

  jobs            Job[]
  scrapeRuns      ScrapeRun[]
  analysisResults AnalysisResult[]
  workerJobs      WorkerJob[]
}
```

**Cascade deletion order:** When deleting a site, related records must be deleted FIRST to avoid foreign key violations:
1. WorkerJob (has `siteId` FK)
2. AnalysisResult (has `siteId` FK)
3. Job (has `siteId` FK AND `scrapeRunId` FK -- delete jobs before scrape runs)
4. ScrapeRun (has `siteId` FK)
5. Site

**Status timestamp mapping:** Each status has a corresponding timestamp field:

| Status | Timestamp Field |
|--------|----------------|
| ANALYZING | `analyzingAt` |
| REVIEW | `reviewAt` |
| ACTIVE | `activeAt` |
| FAILED | `failedAt` |
| SKIPPED | `skippedAt` |

### Implementation Patterns (Code Samples)

#### InvalidTransitionError (src/lib/errors.ts)

Add this after the existing `DuplicateSiteError` class:

```typescript
export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super("INVALID_TRANSITION", `Cannot transition from ${from} to ${to}`, 400);
    this.name = "InvalidTransitionError";
  }
}
```

#### Status transition logic (src/services/siteService.ts)

Add these to the existing file:

```typescript
import { InvalidTransitionError, NotFoundError } from "@/lib/errors";
import type { SiteStatus } from "@/generated/prisma/enums";

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  ANALYZING: ["REVIEW", "ACTIVE", "FAILED"],
  REVIEW: ["SKIPPED", "ACTIVE", "FAILED", "ANALYZING"],
  ACTIVE: ["SKIPPED", "FAILED"],
  FAILED: ["SKIPPED", "ANALYZING"],
  SKIPPED: ["ANALYZING"],
};

// Map status to its corresponding timestamp field name
const STATUS_TIMESTAMP_MAP: Record<string, string> = {
  ANALYZING: "analyzingAt",
  REVIEW: "reviewAt",
  ACTIVE: "activeAt",
  FAILED: "failedAt",
  SKIPPED: "skippedAt",
};

export async function updateSiteStatus(siteId: string, newStatus: SiteStatus) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  const currentStatus = site.status;
  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
    throw new InvalidTransitionError(currentStatus, newStatus);
  }

  // Build update data with status and corresponding timestamp
  const timestampField = STATUS_TIMESTAMP_MAP[newStatus];
  const updateData: Record<string, unknown> = {
    status: newStatus,
    [timestampField]: new Date(),
  };

  const updatedSite = await prisma.site.update({
    where: { id: siteId },
    data: updateData,
  });

  // If re-analyzing, create a new worker job
  if (newStatus === "ANALYZING") {
    await prisma.workerJob.create({
      data: {
        siteId: siteId,
        type: "ANALYSIS",
        status: "PENDING",
      },
    });
  }

  return updatedSite;
}

export async function deleteSite(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  // Delete all related records in a transaction, respecting FK order
  await prisma.$transaction([
    prisma.workerJob.deleteMany({ where: { siteId } }),
    prisma.analysisResult.deleteMany({ where: { siteId } }),
    prisma.job.deleteMany({ where: { siteId } }),
    prisma.scrapeRun.deleteMany({ where: { siteId } }),
    prisma.site.delete({ where: { id: siteId } }),
  ]);
}
```

#### API route handler (src/app/api/sites/[id]/route.ts)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { updateSiteStatusSchema } from "@/lib/validators";
import { updateSiteStatus, deleteSite } from "@/services/siteService";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSiteStatusSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
      );
    }

    const site = await updateSiteStatus(id, parsed.data.status);
    return successResponse(site);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteSite(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
```

**IMPORTANT -- Next.js 16 dynamic route params:** In Next.js 16.1, route handler params are wrapped in a `Promise`. You MUST `await params` before accessing `params.id`. The signature is `{ params: Promise<{ id: string }> }`, NOT `{ params: { id: string } }`.

#### Zod schema addition (src/lib/validators.ts)

Add this to the existing file:

```typescript
export const updateSiteStatusSchema = z.object({
  status: z.enum(["ANALYZING", "REVIEW", "ACTIVE", "FAILED", "SKIPPED"]),
});
```

Note: The existing `updateSiteSchema` is a broader schema for general site updates. The new `updateSiteStatusSchema` is specifically for the status change action where only `status` is required.

#### Mutation hooks addition (src/hooks/useSites.ts)

Add these to the existing file:

```typescript
export function useUpdateSiteStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, status }: { siteId: string; status: string }) =>
      apiFetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteId: string) =>
      apiFetch(`/api/sites/${siteId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}
```

#### apiFetch 204 handling (src/hooks/useSites.ts)

Update the existing `apiFetch` function to handle 204 responses. Add this line AFTER the `!res.ok` error check block and BEFORE the `return res.json()` line:

```typescript
  // Handle 204 No Content (e.g., DELETE responses)
  if (res.status === 204) return null;
```

#### SiteActions component (src/components/sites/SiteActions.tsx)

```typescript
"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2 } from "lucide-react";

interface SiteActionsProps {
  siteId: string;
  siteUrl: string;
  status: "ANALYZING" | "REVIEW" | "ACTIVE" | "FAILED" | "SKIPPED";
  onSkip: (siteId: string) => void;
  onReanalyze: (siteId: string, siteUrl: string) => void;
  onDelete: (siteId: string) => void;
  isSkipping?: boolean;
  isReanalyzing?: boolean;
}

export function SiteActions({
  siteId,
  siteUrl,
  status,
  onSkip,
  onReanalyze,
  onDelete,
  isSkipping,
  isReanalyzing,
}: SiteActionsProps) {
  // ANALYZING sites have no actions (analysis in progress)
  if (status === "ANALYZING") {
    return <span style={{ color: "#71717a" }}>&mdash;</span>;
  }

  const showSkip = status === "ACTIVE" || status === "REVIEW";
  const showReanalyze = status === "FAILED" || status === "SKIPPED";

  return (
    <div className="flex items-center gap-1">
      {showSkip && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onSkip(siteId)}
          disabled={isSkipping}
        >
          {isSkipping ? "..." : "Skip"}
        </Button>
      )}
      {showReanalyze && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onReanalyze(siteId, siteUrl)}
          disabled={isReanalyzing}
        >
          {isReanalyzing ? "..." : "Re-analyze"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" />
          }
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">More actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(siteId)}
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

**IMPORTANT -- shadcn/ui DropdownMenuTrigger with Base UI:** The `DropdownMenuTrigger` in this project uses `@base-ui/react/menu` (NOT Radix). To render a custom button as the trigger, use the `render` prop pattern:
```tsx
<DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
  <MoreHorizontal className="size-4" />
</DropdownMenuTrigger>
```

If `render` prop is not available in the Base UI Menu Trigger, use `asChild` or wrap with a plain `<button>` element:
```tsx
<DropdownMenuTrigger>
  <button className="inline-flex items-center justify-center rounded-md h-7 w-7 hover:bg-accent">
    <MoreHorizontal className="size-4" />
  </button>
</DropdownMenuTrigger>
```

The dev agent should inspect `src/components/ui/dropdown-menu.tsx` to verify which approach the DropdownMenuTrigger component supports and adjust accordingly.

#### DeleteSiteDialog component (src/components/sites/DeleteSiteDialog.tsx)

```typescript
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteSiteDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteSiteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete this site?</DialogTitle>
          <DialogDescription>
            This will permanently remove the site and all associated data
            (analysis results, scrape runs, jobs). This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**IMPORTANT -- Dialog `open` prop with Base UI:** The shadcn Dialog component wraps `@base-ui/react/dialog` which uses `open` and `onOpenChange` props for controlled mode. Verify this works by checking the `Dialog` component in `src/components/ui/dialog.tsx` -- the `DialogPrimitive.Root` passes `...props` which should include `open` and `onOpenChange`.

#### Updated SitesTable with actions (src/components/sites/SitesTable.tsx)

The SitesTable component needs to:
1. Import and render `SiteActions` in the Actions column
2. Import and render `DeleteSiteDialog`
3. Use `useUpdateSiteStatus()` and `useDeleteSite()` mutations
4. Manage `deleteTargetId` state for the dialog

Key changes to the existing SitesTable:

```typescript
// Add these imports
import { useState } from "react";
import { toast } from "sonner";
import { SiteActions } from "@/components/sites/SiteActions";
import { DeleteSiteDialog } from "@/components/sites/DeleteSiteDialog";
import { useUpdateSiteStatus, useDeleteSite } from "@/hooks/useSites";

// Inside the SitesTable component function, add:
const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
const updateStatus = useUpdateSiteStatus();
const deleteSiteMutation = useDeleteSite();

const handleSkip = (siteId: string) => {
  updateStatus.mutate(
    { siteId, status: "SKIPPED" },
    {
      onSuccess: () => toast.success("Site skipped"),
      onError: (err: Error) => toast.error(err.message),
    }
  );
};

const handleReanalyze = (siteId: string, siteUrl: string) => {
  updateStatus.mutate(
    { siteId, status: "ANALYZING" },
    {
      onSuccess: () => toast.success(`Re-analysis triggered for ${siteUrl}`),
      onError: (err: Error) => toast.error(err.message),
    }
  );
};

const handleDeleteConfirm = () => {
  if (!deleteTargetId) return;
  deleteSiteMutation.mutate(deleteTargetId, {
    onSuccess: () => {
      toast.success("Site deleted");
      setDeleteTargetId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });
};

// Replace the Actions column TableCell content (currently placeholder dash) with:
<TableCell>
  <SiteActions
    siteId={site.id}
    siteUrl={site.siteUrl}
    status={site.status}
    onSkip={handleSkip}
    onReanalyze={handleReanalyze}
    onDelete={(id) => setDeleteTargetId(id)}
  />
</TableCell>

// Add DeleteSiteDialog after the closing </Table> tag (inside the main <div>):
<DeleteSiteDialog
  open={deleteTargetId !== null}
  onOpenChange={(open) => {
    if (!open) setDeleteTargetId(null);
  }}
  onConfirm={handleDeleteConfirm}
  isDeleting={deleteSiteMutation.isPending}
/>
```

**Widen the Actions column:** Change `w-[100px]` to `w-[160px]` on the Actions `<TableHead>` to accommodate the inline buttons + overflow menu.

### shadcn/ui Dialog Component Usage Notes

The shadcn Dialog in this project uses `@base-ui/react/dialog` (NOT Radix). Key details:

- `Dialog` root accepts `open` and `onOpenChange` for controlled mode (verify in source)
- `DialogContent` renders inside a Portal with an Overlay backdrop
- `DialogContent` has `showCloseButton` prop (default `true`) -- set to `false` for the delete confirmation dialog since we have explicit Cancel/Delete buttons
- `DialogFooter` renders buttons in a footer area with border-top
- The `DialogFooter` has an optional `showCloseButton` prop that renders a "Close" button -- do NOT use this; we render explicit Cancel/Delete buttons instead
- Dialog closes automatically when the backdrop is clicked or Escape is pressed (built-in behavior)

### shadcn/ui DropdownMenu Component Usage Notes

The shadcn DropdownMenu in this project uses `@base-ui/react/menu` (NOT Radix). Key details:

- `DropdownMenuItem` supports `variant="destructive"` for red-styled items
- `DropdownMenuTrigger` wraps the trigger element
- `DropdownMenuContent` supports `align` ("start" | "end") and `side` ("bottom" | "top" | "left" | "right") props
- Use `align="end"` for the actions dropdown so it aligns to the right of the trigger button

### API Endpoints for This Story

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| PATCH | `/api/sites/[id]` | Update site status | `{ status: "SKIPPED" }` | `{ data: Site }` (200) |
| DELETE | `/api/sites/[id]` | Delete site and all related data | (none) | 204 No Content |

### HTTP Status Codes for This Story

| Scenario | Code |
|----------|------|
| Status updated successfully | 200 |
| Site deleted successfully | 204 |
| Invalid status value | 400 |
| Invalid status transition | 400 |
| Unauthorized (no/bad token) | 401 (handled by proxy.ts) |
| Site not found | 404 |
| Server error | 500 |

### UX Requirements

**Action Buttons (per status):**

| Site Status | Inline Button | Overflow Menu |
|-------------|--------------|---------------|
| ANALYZING | (none -- show dash) | (none) |
| REVIEW | Skip | ... -> Delete |
| ACTIVE | Skip | ... -> Delete |
| FAILED | Re-analyze | ... -> Delete |
| SKIPPED | Re-analyze | ... -> Delete |

**Zero-confirmation actions (per UX spec):**
- Skip: no confirmation dialog, action executes immediately
- Re-analyze: no confirmation dialog, action executes immediately
- These are non-destructive/reversible actions

**Confirmation required (per UX spec):**
- Delete: destructive/irreversible action, requires confirmation dialog
- Dialog has Cancel + destructive Delete button
- Delete button styled red (variant="destructive")

**Toast notifications:**
- Skip: `toast.success("Site skipped")`
- Re-analyze: `toast.success(\`Re-analysis triggered for \${siteUrl}\`)`
- Delete: `toast.success("Site deleted")`
- Errors: `toast.error(errorMessage)`

**Button styling:**
- Inline action buttons: `variant="ghost"`, `size="sm"`, compact height (`h-7 px-2 text-xs`)
- Overflow trigger: `variant="ghost"`, `size="sm"`, icon-only (`h-7 w-7 p-0`)
- Delete in overflow: `variant="destructive"` on the DropdownMenuItem
- Buttons disabled while mutation is pending
- Max 2 visible buttons per row (1 inline action + 1 overflow trigger)

**Actions column width:** `w-[160px]` (increased from `w-[100px]` in story 1-3)

### Project Structure (Files to Create/Modify)

```
src/
  services/
    siteService.ts               # MODIFY -- add updateSiteStatus(), deleteSite(), VALID_STATUS_TRANSITIONS
  hooks/
    useSites.ts                  # MODIFY -- add useUpdateSiteStatus(), useDeleteSite(), update apiFetch for 204
  components/
    sites/
      SiteActions.tsx            # NEW -- inline action buttons + overflow dropdown
      DeleteSiteDialog.tsx       # NEW -- delete confirmation dialog
      SitesTable.tsx             # MODIFY -- replace placeholder Actions with SiteActions + DeleteSiteDialog
      AddSiteInput.tsx           # NO CHANGE
      SiteStatusTabs.tsx         # NO CHANGE
  app/
    (dashboard)/
      sites/page.tsx             # LIKELY NO CHANGE (SitesTable handles mutations internally)
    api/
      sites/
        route.ts                 # NO CHANGE
        counts/route.ts          # NO CHANGE
        [id]/
          route.ts               # NEW -- PATCH and DELETE handlers
  lib/
    errors.ts                    # MODIFY -- add InvalidTransitionError
    validators.ts                # MODIFY -- add updateSiteStatusSchema
    api-utils.ts                 # NO CHANGE
    constants.ts                 # NO CHANGE
    types.ts                     # NO CHANGE
```

### Query Invalidation Strategy

All three mutations (`useUpdateSiteStatus`, `useDeleteSite`, and existing `useCreateSite`) invalidate `["sites"]`. This cascades to:
- `useSites()` -- refreshes the table data (queryKey starts with `["sites"]`)
- `useSiteStatusCounts()` -- refreshes tab counts (queryKey is `["sites", "counts"]`, a sub-key of `["sites"]`)

No additional invalidation code is needed. The existing pattern established in stories 1-2 and 1-3 handles everything.

### Anti-Patterns to AVOID

- Do NOT put business logic (status validation, cascade deletion) in API route handlers -- use `src/services/siteService.ts`
- Do NOT use `any` type -- all functions must have proper TypeScript types
- Do NOT use `useState` for server data -- use TanStack Query mutations
- Do NOT skip the `InvalidTransitionError` for invalid transitions -- the service layer MUST enforce valid transitions
- Do NOT use `middleware.ts` -- Next.js 16 uses `proxy.ts`
- Do NOT import Prisma from `@prisma/client` -- import from `@/generated/prisma/client`, enums from `@/generated/prisma/enums`
- Do NOT create bare API responses -- always use `successResponse()`, `errorResponse()`, or `formatErrorResponse()`
- Do NOT add a confirmation dialog for Skip or Re-analyze -- these are zero-confirmation actions per UX spec
- Do NOT skip creating a WorkerJob when re-analyzing -- story 2-1 needs it to pick up the analysis
- Do NOT use Prisma `onDelete: Cascade` -- use explicit `deleteMany()` in a transaction for clear control over deletion order
- Do NOT forget to handle 204 No Content in `apiFetch` -- DELETE returns no body, calling `res.json()` on 204 will throw
- Do NOT use `{ params: { id: string } }` in route handlers -- Next.js 16.1 wraps params in a Promise: `{ params: Promise<{ id: string }> }`
- Do NOT install new packages -- all required packages are already installed
- Do NOT change the `AddSiteInput` or `SiteStatusTabs` components -- they are complete from previous stories
- Do NOT modify `src/app/api/sites/route.ts` -- create a new `[id]/route.ts` for per-site operations

### Previous Story Learnings (from Stories 1-1, 1-2, and 1-3)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy` (not `middleware`).
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path configured in schema.prisma generator block. Enums from `@/generated/prisma/enums`.
3. **Prisma 7.4 requires driver adapter** -- PrismaClient instantiated with `{ adapter }` in `src/lib/prisma.ts`.
4. **`sonner` is used for toasts** -- import `{ toast }` from "sonner" and use `<Toaster />` component (already in root layout).
5. **shadcn/ui v4 uses Base UI** -- Dialog is `@base-ui/react/dialog`, DropdownMenu is `@base-ui/react/menu`. NOT Radix. Props and behavior may differ from Radix-based shadcn docs.
6. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
7. **Always run `pnpm build`** before marking story as done.
8. **Code review found issues in story 1-1** including loose string types. Use specific union types (e.g., `SiteStatusValue`) instead of `string`.
9. **Service layer pattern established in story 1-2** -- `src/services/siteService.ts` already exists with `createSite()`, `listSites()`, `getStatusCounts()`. Add new functions to this file.
10. **`apiFetch` helper already exists** in `src/hooks/useSites.ts` -- reuse it for all API calls. Add 204 handling.
11. **ESLint `no-explicit-any`** -- avoid `any` from the start. Use proper typed error handling.
12. **Zod 4.x uses `z.enum([...])`** for enum validation.
13. **Query invalidation cascades** -- invalidating `["sites"]` automatically refreshes both table data and tab counts.
14. **Next.js 16 dynamic route params are Promises** -- must `await params` in route handlers. Signature: `{ params: Promise<{ id: string }> }`.
15. **Dialog `open` prop** -- the Dialog component wraps `DialogPrimitive.Root` which passes `...props`, so `open` and `onOpenChange` should work for controlled mode.
16. **DropdownMenuItem `variant="destructive"`** -- supported in the current dropdown-menu component for red-styled items.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. Navigate to `/sites` -- Actions column shows contextual buttons per status
4. ANALYZING sites show no action buttons (just a dash)
5. REVIEW and ACTIVE sites show "Skip" button + "..." overflow menu
6. FAILED and SKIPPED sites show "Re-analyze" button + "..." overflow menu
7. Clicking "Skip" immediately changes status to SKIPPED, toast "Site skipped" appears
8. Clicking "Re-analyze" immediately changes status to ANALYZING, toast "Re-analysis triggered for [url]" appears
9. Clicking "..." then "Delete" shows confirmation dialog
10. Dialog shows destructive styling with Cancel and Delete buttons
11. Clicking Cancel closes dialog without changes
12. Clicking Delete removes site, toast "Site deleted" appears, table and counts update
13. Tab counts update after all status changes
14. Buttons are disabled during pending mutations
15. API returns 400 for invalid status transitions (e.g., trying to skip an ANALYZING site)
16. API returns 404 for non-existent site ID
17. Database: WorkerJob record created when re-analyzing a site
18. Database: All related records deleted when a site is deleted (check AnalysisResult, Job, ScrapeRun, WorkerJob tables are clean)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4: Manage Site Lifecycle]
- [Source: _bmad-output/planning-artifacts/prd.md#FR4, FR5, FR6, FR38]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Button Hierarchy]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Table Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#User Journey Flows -- Flow Optimization Principles]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- Design System Components]
- [Source: _bmad-output/implementation-artifacts/1-1-project-scaffolding-and-dashboard-shell.md]
- [Source: _bmad-output/implementation-artifacts/1-2-submit-new-site.md]
- [Source: _bmad-output/implementation-artifacts/1-3-view-and-filter-site-list.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

None required -- build and lint passed on first attempt.

### Completion Notes List

- Task 1: Added `InvalidTransitionError` to `src/lib/errors.ts`. Added `VALID_STATUS_TRANSITIONS` map, `STATUS_TIMESTAMP_MAP`, `updateSiteStatus()`, and `deleteSite()` to `src/services/siteService.ts`. Transition validation enforces all allowed/disallowed transitions per spec. Cascade deletion uses `prisma.$transaction` with correct FK ordering.
- Task 2: Created `src/app/api/sites/[id]/route.ts` with PATCH and DELETE handlers. Uses Next.js 16.1 Promise-wrapped params pattern (`await params`). PATCH validates body with `updateSiteStatusSchema`, calls `updateSiteStatus()`. DELETE calls `deleteSite()` and returns 204 No Content.
- Task 3: Added `updateSiteStatusSchema` to `src/lib/validators.ts` using `z.enum()` for the five site statuses.
- Task 4: Added `useUpdateSiteStatus()` and `useDeleteSite()` mutation hooks to `src/hooks/useSites.ts`. Both invalidate `["sites"]` query key on success. Updated `apiFetch` to handle 204 No Content responses by returning `null` before calling `res.json()`.
- Task 5: Created `src/components/sites/SiteActions.tsx` with inline Skip/Re-analyze buttons and overflow dropdown with Delete option. Uses `render` prop on `DropdownMenuTrigger` for custom button rendering. Buttons conditionally shown based on site status.
- Task 6: Created `src/components/sites/DeleteSiteDialog.tsx` with controlled Dialog using `open`/`onOpenChange`. Shows Cancel (outline) and Delete (destructive) buttons. Delete button shows "Deleting..." loading state.
- Task 7: Updated `src/components/sites/SitesTable.tsx` to wire SiteActions, DeleteSiteDialog, mutation hooks, and toast notifications. Widened Actions column to `w-[160px]`.
- Task 8: `pnpm build` passed without errors. `pnpm lint` passed without warnings. Updated story status to done. Updated sprint-status.yaml.

### File List

- `src/lib/errors.ts` -- MODIFIED: Added `InvalidTransitionError` class
- `src/lib/validators.ts` -- MODIFIED: Added `updateSiteStatusSchema`
- `src/services/siteService.ts` -- MODIFIED: Added `VALID_STATUS_TRANSITIONS`, `STATUS_TIMESTAMP_MAP`, `updateSiteStatus()`, `deleteSite()`
- `src/app/api/sites/[id]/route.ts` -- NEW: PATCH and DELETE handlers for individual sites
- `src/hooks/useSites.ts` -- MODIFIED: Added 204 handling in `apiFetch`, added `useUpdateSiteStatus()`, `useDeleteSite()` hooks
- `src/components/sites/SiteActions.tsx` -- NEW: Inline action buttons + overflow dropdown menu
- `src/components/sites/DeleteSiteDialog.tsx` -- NEW: Delete confirmation dialog
- `src/components/sites/SitesTable.tsx` -- MODIFIED: Integrated SiteActions, DeleteSiteDialog, mutations, toast notifications
