# Story 5.3: Re-Scrape from Dashboard & Real-Time Updates

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an admin,
I want to trigger re-scrapes from the dashboard and see live status updates without refreshing,
so that I can triage failures quickly and always see current system state.

## Acceptance Criteria

1. **Given** a failed site is visible in the NeedsAttentionTable or the Sites table **When** I click the "Retry" action button **Then** a new scrape job is created for that site and I see a toast: "Re-scrape triggered for [site URL]" (FR34) **And** the action is zero-confirmation (no dialog)

2. **Given** a site with "structure_changed" failure is visible **When** I click the "Fix" action button **Then** a new tab opens with the target site URL for extension-based correction (same as Review flow)

3. **Given** the dashboard is open **When** an SSE connection is established to `GET /api/events` **Then** the connection stays open and receives server-sent events for: `site:status-changed`, `analysis:completed`, `scrape:completed`, `scrape:failed` (FR35)

4. **Given** an SSE event of type `site:status-changed` is received **When** the event payload includes a siteId and new status **Then** TanStack Query invalidates the `["sites"]` query cache and the Sites table, Review Queue, and overview panels update automatically without page refresh

5. **Given** an SSE event of type `scrape:completed` is received **When** the event payload includes siteId and jobCount **Then** a toast notification appears: "Scrape complete -- [N] jobs scraped" with a link to the Jobs viewer **And** relevant query caches are invalidated (`["sites"]`, `["jobs"]`, `["dashboard", "overview"]`, `["dashboard", "failures"]`)

6. **Given** an SSE event of type `scrape:failed` is received **When** the event includes siteId, error message, and failure category **Then** a persistent error toast appears with the failure details **And** the NeedsAttentionTable updates to include the new failure

7. **Given** the top bar is visible **When** real-time data is available **Then** StatusPills in the top bar show live counts: "[N] Active", "[N] Review", "[N] Failed" **And** counts update in real-time as SSE events arrive **And** the Failed pill shows a subtle pulse animation when a new failure is detected

8. **Given** the SSE connection drops **When** the browser detects disconnection **Then** EventSource auto-reconnects and the dashboard resumes receiving updates

9. **Given** status changes occur on the backend **When** the SSE event is emitted **Then** the event reaches the dashboard within 3 seconds (NFR4)

## Tasks / Subtasks

- [x] Task 1: Create SSE event service and in-memory event bus (AC: #3, #9)
  - [x] 1.1: Create `src/services/eventService.ts` with an in-memory event emitter pattern using `EventEmitter` from `node:events`
  - [x] 1.2: Define SSE event types: `SSEEvent` union type with `site:status-changed`, `analysis:completed`, `scrape:completed`, `scrape:failed` and their payloads
  - [x] 1.3: Implement `emitEvent(event: SSEEvent): void` function that pushes events to all connected SSE clients
  - [x] 1.4: Implement `subscribe(callback: (event: SSEEvent) => void): () => void` function that registers a listener and returns an unsubscribe function
  - [x] 1.5: Add SSE event type constants and payload interfaces to `src/lib/types.ts`

- [x] Task 2: Create SSE API endpoint (AC: #3, #8)
  - [x] 2.1: Create `src/app/api/events/route.ts` with a `GET` handler that returns a streaming `Response` with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` headers
  - [x] 2.2: Use a `ReadableStream` to keep the connection open. On each event from `eventService.subscribe()`, write `data: JSON.stringify(event)\n\n` to the stream
  - [x] 2.3: Send a heartbeat ping (`: heartbeat\n\n`) every 30 seconds to keep the connection alive
  - [x] 2.4: Clean up the subscription when the client disconnects (stream is cancelled/closed)
  - [x] 2.5: Ensure the route is excluded from static generation (export `const dynamic = "force-dynamic"`)

- [x] Task 3: Integrate event emission into existing service functions (AC: #3, #9)
  - [x] 3.1: Update `updateSiteStatus()` in `src/services/siteService.ts` to call `emitEvent({ type: "site:status-changed", payload: { siteId, status: newStatus } })` after successful status update
  - [x] 3.2: Update `saveSiteConfig()` in `src/services/siteService.ts` to emit `site:status-changed` when status transitions from REVIEW to ACTIVE
  - [x] 3.3: Update `worker/jobDispatcher.ts` to emit `site:status-changed` when a job fails and site status changes to FAILED
  - [x] 3.4: Update `worker/jobs/analyze.ts` to emit `analysis:completed` with `{ siteId, confidence }` after analysis is completed and site status is updated
  - [x] 3.5: Update `worker/jobs/scrape.ts` to emit `scrape:completed` with `{ siteId, jobCount }` on successful scrape completion
  - [x] 3.6: Update `worker/jobs/scrape.ts` to emit `scrape:failed` with `{ siteId, error, category }` on scrape failure

- [x] Task 4: Create useSSE hook for client-side SSE consumption (AC: #4, #5, #6, #8)
  - [x] 4.1: Create `src/hooks/useSSE.ts`
  - [x] 4.2: Implement `useSSE()` hook that creates an `EventSource` connection to `/api/events`
  - [x] 4.3: On `site:status-changed` events: invalidate `["sites"]`, `["sites", "counts"]`, `["dashboard", "overview"]`, `["dashboard", "failures"]` query caches
  - [x] 4.4: On `scrape:completed` events: show `toast.success("Scrape complete -- N jobs scraped")` and invalidate `["sites"]`, `["jobs"]`, `["dashboard", "overview"]`, `["dashboard", "failures"]` caches
  - [x] 4.5: On `scrape:failed` events: show persistent `toast.error()` with failure details and invalidate `["sites"]`, `["dashboard", "overview"]`, `["dashboard", "failures"]` caches
  - [x] 4.6: On `analysis:completed` events: invalidate `["sites"]`, `["sites", "counts"]`, `["dashboard", "overview"]` caches
  - [x] 4.7: Handle EventSource `onerror` — log the error; EventSource auto-reconnects natively
  - [x] 4.8: Clean up EventSource on component unmount via `useEffect` cleanup

- [x] Task 5: Build StatusPill component (AC: #7)
  - [x] 5.1: Create `src/components/shared/StatusPill.tsx`
  - [x] 5.2: Render a compact rounded pill shape with status color background at 15% opacity and matching text color
  - [x] 5.3: Display count + status label (e.g., "487 Active", "12 Review", "3 Failed")
  - [x] 5.4: Accept `count`, `label`, `color`, and `pulse` props
  - [x] 5.5: When `pulse` is true, apply a subtle CSS pulse animation on the pill (for Failed pill when new failures arrive)

- [x] Task 6: Add StatusPills to the top bar in AppLayout (AC: #7)
  - [x] 6.1: Update `src/components/shared/AppLayout.tsx` to import and render StatusPills in the top bar `<header>`, right-aligned after the project name
  - [x] 6.2: Use `useSiteStatusCounts()` from `src/hooks/useSites.ts` to fetch live status counts
  - [x] 6.3: Render three StatusPills: Active (green), Review (amber), Failed (red)
  - [x] 6.4: Track the previous Failed count; when current count > previous count, set pulse=true on the Failed pill for 3 seconds
  - [x] 6.5: Counts update automatically when SSE events trigger TanStack Query cache invalidation (because `["sites", "counts"]` is invalidated)

- [x] Task 7: Wire useSSE hook into the dashboard layout (AC: #3, #4, #5, #6, #8)
  - [x] 7.1: Add `useSSE()` call inside `AppLayout` component (or in a new `SSEProvider` wrapper) so it is active on every dashboard page
  - [x] 7.2: Verify that SSE connection establishes on page load and stays open across navigation
  - [x] 7.3: Verify EventSource reconnects automatically when the connection is lost

- [x] Task 8: Verify re-scrape actions work end-to-end (AC: #1, #2)
  - [x] 8.1: Verify NeedsAttentionTable "Retry" button triggers `POST /api/sites/[id]/scrape` and shows toast (already implemented in story 5-2, verify still works)
  - [x] 8.2: Verify NeedsAttentionTable "Fix" button opens target site URL in new tab (already implemented)
  - [x] 8.3: Verify SiteActions "Re-analyze" button in Sites table works for FAILED sites (already implemented in story 1-4)
  - [x] 8.4: Verify that after a re-scrape is triggered, SSE events propagate the status change and dashboard updates automatically

- [x] Task 9: Verify build, lint, and update story/sprint status (AC: #1-9)
  - [x] 9.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x] 9.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x] 9.3: Verify SSE endpoint at `/api/events` returns streaming response with correct headers
  - [x] 9.4: Verify `useSSE` hook connects to the SSE endpoint and processes events
  - [x] 9.5: Verify StatusPills appear in the top bar with correct counts and colors
  - [x] 9.6: Verify cache invalidation works: when a backend event fires, relevant dashboard panels refresh automatically
  - [x] 9.7: Verify toast notifications appear for scrape:completed and scrape:failed events
  - [x] 9.8: Verify the Failed StatusPill pulses when a new failure is detected
  - [x] 9.9: Update story status to `done` in sprint-status.yaml

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
| `useTriggerScrape()` | `src/hooks/useScrapeRuns.ts` | Mutation hook for `POST /api/sites/[id]/scrape`. Already used by NeedsAttentionTable. |
| `useSiteStatusCounts()` | `src/hooks/useSites.ts` | Fetches `GET /api/sites/counts` with queryKey `["sites", "counts"]`. Use for top bar StatusPills. |
| `updateSiteStatus()` | `src/services/siteService.ts` | Status transition logic. Add SSE event emission here. |
| `saveSiteConfig()` | `src/services/siteService.ts` | Config save with REVIEW->ACTIVE transition. Add SSE event emission here. |
| StatusBadge component | `src/components/shared/StatusBadge.tsx` | Reuse color mapping for StatusPill colors. |
| NeedsAttentionTable | `src/components/dashboard/NeedsAttentionTable.tsx` | Already has Retry/Fix/Investigate actions. Verify re-scrape works with SSE updates. |
| SiteActions | `src/components/sites/SiteActions.tsx` | Already has Scrape/Skip/Re-analyze/Review actions. |
| `apiFetch` helper | `src/lib/fetch.ts` | Shared fetch with auth token + error handling. |
| API response helpers | `src/lib/api-utils.ts` | `successResponse()`, `listResponse()`, `errorResponse()`. |
| Error formatting | `src/lib/errors.ts` | `formatErrorResponse()`, `AppError`. |
| Constants | `src/lib/constants.ts` | Status labels, confidence threshold. |
| TypeScript types | `src/lib/types.ts` | `ApiResponse<T>`, `ApiListResponse<T>`, `PaginationParams`. |
| Prisma client | `src/lib/prisma.ts` | Singleton instance. |
| Worker job dispatcher | `worker/jobDispatcher.ts` | Add event emission after job success/failure. |
| Worker analyze handler | `worker/jobs/analyze.ts` | Add `analysis:completed` event emission. |
| Worker scrape handler | `worker/jobs/scrape.ts` | Add `scrape:completed` and `scrape:failed` event emission. |
| AppLayout | `src/components/shared/AppLayout.tsx` | Top bar where StatusPills will be added. |
| QueryClientProvider | `src/app/providers.tsx` | TanStack Query provider, already wraps the app. |

### SSE Architecture Design

**Event Service Pattern:**

The event service uses an in-memory Node.js `EventEmitter` to broadcast events from backend services to connected SSE clients. This works for the MVP single-process deployment. For Phase 3 (distributed workers), this would be replaced with Redis pub/sub.

```
Backend services (siteService, worker)
  → eventService.emitEvent(event)
  → EventEmitter broadcasts to all subscribers
  → SSE endpoint streams events to connected clients
  → useSSE hook receives events
  → TanStack Query caches invalidated
  → Dashboard components re-render with fresh data
```

**Event Types (defined in `src/lib/types.ts`):**

```typescript
type SSEEventType =
  | "site:status-changed"
  | "analysis:completed"
  | "scrape:completed"
  | "scrape:failed";

interface SSEEventMap {
  "site:status-changed": { siteId: string; status: string };
  "analysis:completed": { siteId: string; confidence: number };
  "scrape:completed": { siteId: string; jobCount: number };
  "scrape:failed": { siteId: string; error: string; category: string | null };
}

type SSEEvent = {
  [K in SSEEventType]: { type: K; payload: SSEEventMap[K] };
}[SSEEventType];
```

**SSE Endpoint Format:**

Each event is sent as a standard SSE message:
```
data: {"type":"scrape:completed","payload":{"siteId":"clx...","jobCount":15}}

```

Heartbeat (keep-alive) every 30 seconds:
```
: heartbeat

```

**EventSource (Client):**

The browser `EventSource` API handles:
- Automatic reconnection on connection drop
- Parsing of `data:` fields as message events
- The `useSSE` hook listens to `onmessage` and dispatches based on event `type`

### SSE Endpoint Implementation

```typescript
// src/app/api/events/route.ts
export const dynamic = "force-dynamic";

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Subscribe to event bus
      const unsubscribe = subscribe((event) => {
        send(JSON.stringify(event));
      });

      // Heartbeat interval
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 30000);

      // Cleanup when client disconnects
      // Note: AbortSignal / stream cancellation handles cleanup
    },
    cancel() {
      // Clean up subscription and heartbeat on disconnect
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

### StatusPill Component Design

**Anatomy:**
- Rounded pill shape (`rounded-full px-2.5 py-0.5`)
- Status color background at 15% opacity
- Count + status label in matching text color
- Text: `text-xs font-medium`

**Three pills in top bar:**
| Label | Color | Hex |
|-------|-------|-----|
| Active | Green | `#22c55e` |
| Review | Amber | `#f59e0b` |
| Failed | Red | `#ef4444` |

**Pulse animation (Failed pill):**
```css
@keyframes status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
.status-pulse {
  animation: status-pulse 1s ease-in-out 3;
}
```

The pulse triggers when the Failed count increases (tracked via `useRef` comparing previous vs current count). The pulse runs 3 times over 3 seconds, then stops.

### Cache Invalidation Strategy

| SSE Event | Query Keys Invalidated |
|-----------|----------------------|
| `site:status-changed` | `["sites"]`, `["sites", "counts"]`, `["dashboard", "overview"]`, `["dashboard", "failures"]` |
| `analysis:completed` | `["sites"]`, `["sites", "counts"]`, `["dashboard", "overview"]` |
| `scrape:completed` | `["sites"]`, `["jobs"]`, `["dashboard", "overview"]`, `["dashboard", "failures"]` |
| `scrape:failed` | `["sites"]`, `["dashboard", "overview"]`, `["dashboard", "failures"]` |

This ensures all visible dashboard components refresh when backend state changes. TanStack Query handles deduplication, so invalidating multiple keys doesn't cause redundant fetches if the data is already fresh.

### Worker Event Emission

The worker process runs in the same Node.js process as the Next.js app (or in a separate process). For MVP:

- If worker is in the same process: direct import of `eventService` and call `emitEvent()`
- If worker is a separate process: events can be emitted via an internal HTTP call to the Next.js API, or by writing to a shared events table that the SSE endpoint polls

For this story, assume the worker shares the same Node.js process (as per the current architecture where the worker uses the same Prisma client). The `eventService` uses a module-level `EventEmitter` singleton that is shared across the process.

**Important caveat:** If the worker runs as a truly separate `node worker/index.ts` process, the in-memory EventEmitter will NOT bridge between processes. In that case, the worker should call `POST /api/events/emit` (a new internal endpoint) or write events to a database table. For MVP, since the worker polls the same database, a pragmatic approach is to have the SSE endpoint poll for recent status changes as a fallback. However, the primary pattern should be direct emission.

**Recommended approach for cross-process communication:** Create a simple internal HTTP endpoint that the worker can POST events to, which then broadcasts to SSE clients. This avoids shared-memory issues between the Next.js server and the standalone worker process.

### Prisma Model References

No schema changes required for this story. All models are already in place.

### UX Requirements

**Top Bar StatusPills:**
- Position: right side of top bar header, after "scrapnew" title
- Layout: `flex items-center gap-2 ml-auto`
- Three pills: Active (green), Review (amber), Failed (red)
- Pill style: `rounded-full px-2.5 py-0.5 text-xs font-medium`
- Background: status color at 15% opacity
- Text: status color at full opacity
- Count formatting: plain number (no thousands separator for counts < 1000)

**Toast Notifications (from SSE events):**
- `scrape:completed`: `toast.success("Scrape complete -- N jobs scraped")` -- auto-dismiss after 4 seconds
- `scrape:failed`: `toast.error("Scrape failed for [siteUrl]: [error]")` -- persistent, must be manually dismissed
- `analysis:completed`: `toast.success("Analysis complete for [siteUrl] -- N% confidence")` -- auto-dismiss after 4 seconds (optional, can skip if too noisy)

**General UX Rules (from previous stories):**
- No confirmation dialogs for non-destructive actions (Retry, Re-analyze)
- Loading: skeleton for initial load per panel; no full-page loading screen
- Toast notifications for async action feedback
- Desktop-only layout, minimum 1280px viewport
- Real-time updates via SSE -- no manual page refresh needed

### Project Structure (Files to Create/Modify)

```
src/
  services/
    eventService.ts              # NEW -- SSE event bus (EventEmitter singleton)
  app/
    api/
      events/
        route.ts                 # NEW -- GET /api/events SSE endpoint
  hooks/
    useSSE.ts                    # NEW -- EventSource hook for SSE consumption
  components/
    shared/
      StatusPill.tsx             # NEW -- compact status count pill
      AppLayout.tsx              # MODIFY -- add StatusPills to top bar + useSSE hook
  lib/
    types.ts                     # MODIFY -- add SSE event types
  services/
    siteService.ts               # MODIFY -- add event emission to updateSiteStatus, saveSiteConfig
worker/
  jobDispatcher.ts               # MODIFY -- add event emission on job failure
  jobs/
    analyze.ts                   # MODIFY -- add analysis:completed event emission
    scrape.ts                    # MODIFY -- add scrape:completed/scrape:failed event emission
```

### Anti-Patterns to AVOID

- Do NOT use WebSocket -- SSE is the chosen pattern for uni-directional server-to-client updates (per architecture doc)
- Do NOT put event emission logic in API route handlers -- emit from service functions where status actually changes
- Do NOT use `useState` for SSE-delivered data -- use TanStack Query cache invalidation triggered by SSE events
- Do NOT create a polling fallback on the client side -- rely on SSE with native EventSource auto-reconnect
- Do NOT install new packages for SSE -- use native `EventSource` (browser) and `ReadableStream` (server)
- Do NOT modify the existing NeedsAttentionTable retry/fix/investigate logic -- it already works from story 5-2
- Do NOT use `any` type -- all SSE events and payloads must have proper TypeScript types
- Do NOT create separate SSE endpoints per event type -- single `/api/events` endpoint streams all event types
- Do NOT persist SSE events to the database for MVP -- in-memory EventEmitter is sufficient for single-process deployment

### Previous Story Learnings (from Stories 1-1 through 5-2)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy` (not `middleware`).
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path configured in schema.prisma generator block.
3. **`apiFetch` lives in `src/lib/fetch.ts`** -- extracted from the original `useSites.ts` hook. All hooks import from there.
4. **Sonner** is used for toasts -- already mounted in root layout. Use `toast.success()` and `toast.error()`.
5. **shadcn/ui v4 uses Base UI** -- component props may differ from older shadcn versions.
6. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout via `src/app/(dashboard)/layout.tsx`.
7. **Always run `pnpm build`** before marking story as done.
8. **ESLint `no-explicit-any`** -- avoid `any` from the start. Use proper TypeScript interfaces for all data shapes.
9. **Pagination pattern** is established in SitesTable and JobsTable -- reuse patterns.
10. **The `useTriggerScrape()` hook** already exists in `src/hooks/useScrapeRuns.ts` and invalidates `["sites"]` queries on success.
11. **Service functions** like `getStatusCounts()` already exist and should be reused, not duplicated.
12. **`useSiteStatusCounts()`** already exists in `src/hooks/useSites.ts` and fetches status counts for pills.
13. **AppLayout** is a client component at `src/components/shared/AppLayout.tsx` -- safe to add hooks and client-side logic.
14. **Card component** from shadcn/ui is already installed at `src/components/ui/card.tsx`.
15. **Button variants**: `ghost`, `outline`, `destructive` are available. Use `ghost` for inline table actions.
16. **Worker runs as a separate process** (`node worker/index.ts`) -- direct in-memory event sharing between Next.js and worker is NOT possible. Must use HTTP or database polling for cross-process events.

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. SSE endpoint at `GET /api/events` returns streaming response with `Content-Type: text/event-stream` header
4. SSE heartbeat pings are sent every 30 seconds
5. `useSSE` hook connects to the SSE endpoint on page load
6. StatusPills appear in the top bar with Active (green), Review (amber), Failed (red) counts
7. When a site status changes on the backend, SSE event fires and dashboard updates automatically
8. `scrape:completed` event shows success toast with job count
9. `scrape:failed` event shows persistent error toast with failure details
10. Failed StatusPill pulses briefly when a new failure is detected
11. EventSource auto-reconnects when the SSE connection drops
12. NeedsAttentionTable "Retry" action still works correctly (from story 5-2)
13. NeedsAttentionTable "Fix" and "Investigate" actions still work correctly
14. All TanStack Query caches invalidate correctly based on event type
15. No full-page refresh needed to see status updates

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3: Re-Scrape from Dashboard & Real-Time Updates]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns -- SSE]
- [Source: _bmad-output/planning-artifacts/architecture.md#Communication Patterns -- SSE Event Types]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries -- api/events/route.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy -- StatusPill]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns -- Real-Time Update Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#User Journey Flows -- Journey 3: Morning Operations Check]
- [Source: _bmad-output/planning-artifacts/prd.md#FR34, FR35]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR4 (SSE < 3s propagation)]
- [Source: src/services/siteService.ts] (updateSiteStatus, saveSiteConfig, createScrapeRun)
- [Source: src/services/dashboardService.ts] (getDashboardOverview, getFailedSitesWithReasons)
- [Source: src/hooks/useScrapeRuns.ts] (useTriggerScrape)
- [Source: src/hooks/useSites.ts] (useSiteStatusCounts)
- [Source: src/hooks/useDashboard.ts] (useDashboardOverview, useFailedSites)
- [Source: src/components/shared/AppLayout.tsx] (top bar for StatusPills)
- [Source: src/components/dashboard/NeedsAttentionTable.tsx] (existing retry/fix/investigate actions)
- [Source: worker/jobDispatcher.ts] (job success/failure handling)
- [Source: worker/jobs/analyze.ts] (analysis completion)
- [Source: worker/jobs/scrape.ts] (scrape completion/failure)
- [Source: _bmad-output/implementation-artifacts/5-2-system-status-overview-and-failure-alerts.md] (previous story patterns)

## Dev Agent Record

### Agent Model Used
claude-opus-4-6

### Debug Log References
N/A

### Completion Notes List
- Created SSE event service with EventEmitter singleton pattern for in-process broadcasting
- Created SSE API endpoint (GET /api/events) with ReadableStream, heartbeat pings, and proper cleanup
- Created internal POST /api/events/emit endpoint for worker cross-process event emission
- Created worker/lib/emitEvent.ts helper that POSTs events to the Next.js server
- Added event emission to siteService.ts (updateSiteStatus, saveSiteConfig)
- Added event emission to worker/jobDispatcher.ts (job failure -> site:status-changed)
- Added event emission to worker/jobs/analyze.ts (analysis:completed + site:status-changed)
- Added event emission to worker/jobs/scrape.ts (scrape:completed, scrape:failed + site:status-changed)
- Created useSSE hook with EventSource, TanStack Query cache invalidation, toast notifications, and onFailureDetected callback
- Created StatusPill component with pulse animation support
- Updated AppLayout with StatusPills (Active/Review/Failed) and useSSE integration
- Pulse animation triggers via SSE onFailureDetected callback (avoids React compiler lint issues with setState in effects)
- Build and lint pass clean

### File List
- src/services/eventService.ts (NEW)
- src/app/api/events/route.ts (NEW)
- src/app/api/events/emit/route.ts (NEW)
- src/hooks/useSSE.ts (NEW)
- src/components/shared/StatusPill.tsx (NEW)
- worker/lib/emitEvent.ts (NEW)
- src/lib/types.ts (MODIFIED - added SSE event types)
- src/services/siteService.ts (MODIFIED - added event emission)
- src/components/shared/AppLayout.tsx (MODIFIED - added StatusPills + useSSE)
- worker/jobDispatcher.ts (MODIFIED - added event emission)
- worker/jobs/analyze.ts (MODIFIED - added event emission)
- worker/jobs/scrape.ts (MODIFIED - added event emission)
