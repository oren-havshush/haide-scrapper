---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-03-10'
inputDocuments:
  - '_bmad-output/planning-artifacts/product-brief-scrapnew-2026-03-10.md'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
workflowType: 'architecture'
project_name: 'scrapnew'
user_name: 'Oren'
date: '2026-03-10'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

38 FRs across 8 capability areas:

| Category | FRs | Architectural Implication |
|----------|-----|--------------------------|
| Site Management (FR1-6) | CRUD + status lifecycle | Core data model, state machine for site lifecycle |
| AI Analysis Pipeline (FR7-13) | 3 analysis methods, confidence scoring, training data | Heaviest backend component — async job processing, Playwright orchestration, AI/ML integration |
| Review Queue (FR14-16) | Filtered views, prioritization | Query patterns on site data, filtered by confidence threshold |
| Chrome Extension (FR17-23) | DOM overlay, field mapping, multi-mode, API auth | Standalone deployment, content script architecture, cross-origin API calls |
| Scraping & Data (FR24-28) | On-demand scraping, normalization, validation | Playwright execution, data transformation pipeline, schema validation |
| Data Review (FR29-31) | Per-site job browsing, quality spot-check | Query patterns for paginated job data with site filtering |
| Dashboard & Operations (FR32-35) | Status overview, failure categorization, real-time updates | Real-time event system, alert aggregation |
| Config & Data Model (FR36-38) | Site config JSON, job schema, status lifecycle timestamps | Schema design — flexible config storage, normalized + raw job records |

**Non-Functional Requirements:**

| NFR | Target | Architectural Impact |
|-----|--------|---------------------|
| AI analysis time | < 5 min per site | Async processing, progress reporting, timeout management |
| On-demand scrape | < 2 min per site | Playwright execution optimization, resource cleanup |
| Dashboard responsiveness | < 1 second | Frontend performance, efficient API queries, client-side caching |
| Real-time propagation | < 3 seconds | SSE or WebSocket infrastructure, event bus |
| MVP scale | 100 sites | Single-process viable, no distributed workers needed |
| Data growth | Millions of job records | Database indexing strategy, paginated queries, per-site partitioning |
| Fault isolation | Per-site failure containment | Error boundaries in scraping, isolated job execution |
| Data persistence | No loss on crash | Transaction-based writes, scrape results committed before success |

**Scale & Complexity:**

- Primary domain: Full-stack web platform with browser automation
- Complexity level: Medium
- Estimated architectural components: 6 major components (Dashboard SPA, Backend API, AI Analysis Engine, Scraping Engine, Chrome Extension, Data Store)

### Technical Constraints & Dependencies

- **Playwright** — central dependency for both AI analysis and scraping. Resource-intensive (headless browser instances). Drives server resource requirements.
- **Chrome Extension APIs** — constrained by Manifest V3 limitations (service workers, content script isolation, cross-origin permissions)
- **Single operator** — simplifies auth but means no redundancy in operations. System must be resilient to unattended operation.
- **Israeli job sites** — potential Hebrew content, RTL text in scraped data (not in the admin UI). URL structures may include Hebrew characters.
- **Prior failed attempt** — architecture must prioritize the human correction loop and teachability. Full automation is a future goal, not a current requirement.

### Cross-Cutting Concerns Identified

1. **Shared type system** — Job schema, site config schema, API contracts, and site status enum must be defined once and shared across dashboard, backend, and extension. Monorepo structure is the natural solution.
2. **Async job lifecycle** — Analysis and scraping both follow the same pattern: trigger → in-progress → success/failure. A unified job tracking model prevents inconsistency.
3. **Real-time event propagation** — Status changes originate in the backend and must reach the dashboard. SSE is simpler than WebSocket for this uni-directional pattern.
4. **Error categorization** — Failures must be classified (timeout, structure change, empty results) at the backend level and surfaced consistently in the dashboard and extension.
5. **Site status state machine** — The lifecycle (analyzing → review → active → failed → skipped) with valid transitions must be enforced at the data layer, not just in the UI.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web platform (Next.js) with browser automation (Playwright) and Chrome extension. Two separate projects: Next.js app for dashboard + API, Chrome extension as a standalone package.

### Technical Preferences

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Full-stack framework | Next.js 16.1 | Unifies dashboard SPA and backend API in one deployment |
| Database | PostgreSQL | Relational, handles millions of records, strong JSON support for site configs |
| ORM | Prisma 7.4.x | Type-safe database access, migration management, schema-first workflow |
| Package manager | pnpm | Fast, disk-efficient, good monorepo support if needed later |
| Deployment | Render (likely) | Simple deployment for Next.js + PostgreSQL |
| Monorepo | No | Two separate projects — shared types copied or published as needed |

### Starter Options Considered

| Option | Stack | Verdict |
|--------|-------|---------|
| `shadcn init` (CLI v4) | Next.js + Tailwind + shadcn/ui + dark mode | **Selected** — matches UX spec exactly |
| `create-next-app` + `shadcn init` | Same end result, two steps | Viable but redundant given shadcn v4 |
| `create-t3-app` | Next.js + Prisma + tRPC + Tailwind | Rejected — tRPC adds complexity, Chrome extension needs REST |

### Selected Starter: shadcn CLI v4 + Prisma

**Rationale:** shadcn CLI v4 scaffolds the exact design system chosen in the UX specification (Next.js + Tailwind + shadcn/ui + dark mode). Prisma added separately for database access. No unnecessary abstractions — API routes are plain Next.js Route Handlers consumable by both the dashboard and Chrome extension.

**Initialization Commands:**

```bash
# 1. Scaffold Next.js app with shadcn/ui
pnpm dlx shadcn@latest init
# Select: Next.js template, dark mode

# 2. Add Prisma ORM
pnpm add prisma @prisma/client
npx prisma init --datasource-provider postgresql

# 3. Chrome extension (separate project)
# Initialize separately with Vite + React + Tailwind for extension popup/panel
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript with strict mode, Node.js runtime
- **Styling Solution:** Tailwind CSS with shadcn/ui component system (Radix UI primitives)
- **Build Tooling:** Turbopack (dev), Next.js compiler (production)
- **Code Organization:** App Router with file-based routing, Route Handlers for API
- **Development Experience:** Hot reload via Turbopack, TypeScript checking, ESLint

**Architectural Decisions NOT Provided (to be made in subsequent steps):**

- Database schema design
- API route structure and conventions
- Authentication approach (token-based)
- Real-time communication (SSE vs WebSocket)
- Background job processing for AI analysis and scraping
- Chrome extension architecture
- State management approach
- Testing framework

**Note:** Project initialization using this command should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Background job processing: Separate Node.js worker process
- Data fetching: TanStack Query for client-side state
- Real-time: SSE for server → client updates
- Chrome extension framework: WXT

**Important Decisions (Shape Architecture):**
- Site config storage: Prisma Json fields
- Auth: Bearer token from .env, httpOnly cookie for dashboard
- Client state: React Context (upgrade to Zustand if needed)

**Deferred Decisions (Post-MVP):**
- Distributed job queue (BullMQ + Redis) — Phase 3
- Proxy rotation / anti-bot strategy — Phase 2
- AI model retraining pipeline — Phase 2

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | PostgreSQL | Already decided — relational, JSON support, scales to millions of records |
| ORM | Prisma 7.4.x | Already decided — type-safe, migration management, schema-first |
| Site configs | Prisma `Json` field | Configs are dynamic per-site, don't benefit from relational normalization |
| Job data | Normalized fields + `Json` raw column | Dual schema per PRD — standard fields for querying, raw data preserved |
| Client caching | TanStack Query | Handles server state caching, revalidation, loading states. Cache invalidation on SSE events. |
| Migration strategy | Prisma Migrate | Default with Prisma — version-controlled, reproducible migrations |

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth method | Bearer token (env variable) | Single admin, no multi-user. Simple, secure for personal infrastructure |
| Dashboard auth | httpOnly cookie (same-origin) | Set on first load, no login UI needed |
| Extension auth | Token in `chrome.storage.local` | One-time setup in extension settings |
| API security | `Authorization: Bearer <token>` header | All API routes check token via middleware |
| CORS | Allow extension origin only | Dashboard is same-origin; extension needs explicit CORS |

### API & Communication Patterns

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API style | REST with JSON (Next.js Route Handlers) | Already decided — consumed by both dashboard and Chrome extension |
| Real-time | Server-Sent Events (SSE) | Uni-directional (server → client), simpler than WebSocket, native in Next.js Route Handlers |
| Error format | Structured JSON errors `{ error, code, message, details }` | Consistent error handling across dashboard and extension |
| API versioning | None for MVP | Single consumer, single developer — versioning adds overhead without value |

### Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data fetching | TanStack Query | Server state management with caching, revalidation, DevTools |
| Client state | React Context + useState | Minimal client state (UI preferences, active filters). Upgrade to Zustand if needed |
| Routing | Next.js App Router (file-based) | Provided by starter — pages for each dashboard view |
| Components | shadcn/ui (Radix primitives) | Already decided — accessible, composable, copy-paste ownership |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Web service | Next.js on Render (Web Service) | Dashboard + API in one deployment |
| Worker service | Node.js on Render (Background Worker) | Separate process for Playwright-based AI analysis and scraping |
| Database | PostgreSQL on Render | Managed PostgreSQL alongside the app services |
| Background jobs | PostgreSQL-based job queue (poll model) | Worker polls `jobs` table for pending tasks. Simple, no Redis needed for MVP |
| Logging | `console.log` + Render log aggregation | Sufficient for MVP single-operator monitoring |
| Environment config | `.env` files + Render environment variables | Standard Next.js env approach |

### Chrome Extension Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | WXT | Modern, Vite-based, TypeScript-first, Manifest V3, hot reload |
| UI framework | React + Tailwind (same as dashboard) | Visual consistency, shared component patterns |
| Build tool | Vite (via WXT) | Fast builds, HMR during development |
| Communication | REST API calls to Next.js backend | Same endpoints as dashboard, Bearer token auth |
| Content scripts | Injected overlay for field highlights | DOM manipulation on target sites for review mode |
| Side panel | WXT side panel API | 320px docked panel for field mapping UI |

### Worker Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Node.js (plain TypeScript) | Same language as Next.js app, shares Prisma client and types |
| Job discovery | Poll PostgreSQL `jobs` table | Check for `status: pending` on interval (e.g., every 5 seconds) |
| Execution | Playwright (headless Chromium) | Required for JS-heavy Israeli job sites |
| Isolation | One Playwright instance per job | Per-site failure containment, resource cleanup after each job |
| Shared code | Same Prisma schema and TypeScript types as Next.js app | Single repo, different entry points (`next start` vs `node worker/index.ts`) |

### Decision Impact Analysis

**Implementation Sequence:**
1. Project scaffolding (shadcn init + Prisma setup)
2. Database schema (Prisma models for Site, Job, ScrapeRun, AnalysisResult)
3. API routes (CRUD for sites, trigger analysis/scrape)
4. SSE endpoint for real-time updates
5. Dashboard views (sites, review queue, jobs)
6. Worker process (job polling + Playwright execution)
7. AI analysis pipeline (3 methods)
8. Chrome extension (WXT + content scripts + side panel)

**Cross-Component Dependencies:**
- Worker and Next.js app share Prisma client — schema changes affect both
- SSE events drive TanStack Query cache invalidation — event types must be consistent
- Chrome extension consumes the same API as dashboard — API contracts are shared
- Site config JSON schema is written by the extension and read by the worker — format must be stable

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 5 categories where AI agents could make different choices — naming, structure, format, communication, and process patterns.

### Naming Patterns

**Database Naming (Prisma):**

| Element | Convention | Example |
|---------|-----------|---------|
| Models | PascalCase | `Site`, `Job`, `ScrapeRun`, `AnalysisResult` |
| Fields | camelCase | `siteUrl`, `confidenceScore`, `createdAt` |
| Enums | PascalCase name, SCREAMING_SNAKE values | `enum SiteStatus { ANALYZING, REVIEW, ACTIVE, FAILED, SKIPPED }` |
| Relations | camelCase, descriptive | `site.jobs`, `job.scrapeRun` |
| JSON fields | camelCase key | `fieldMappings`, `rawData` |

**API Naming (Next.js Route Handlers):**

| Element | Convention | Example |
|---------|-----------|---------|
| Endpoints | Plural, kebab-case | `/api/sites`, `/api/scrape-runs`, `/api/analysis-results` |
| Route params | `[id]` | `/api/sites/[id]` |
| Query params | camelCase | `?siteId=123&status=active` |
| Request/response body | camelCase JSON | `{ siteUrl, confidenceScore }` |

**Code Naming (TypeScript/React):**

| Element | Convention | Example |
|---------|-----------|---------|
| React components | PascalCase file + export | `ConfidenceBar.tsx` → `export function ConfidenceBar()` |
| Hooks | camelCase with `use` prefix | `useSites.ts` → `export function useSites()` |
| Utilities | camelCase file + export | `formatConfidence.ts` |
| Types/interfaces | PascalCase | `interface SiteConfig { }` |
| Constants | SCREAMING_SNAKE | `const MAX_CONFIDENCE = 100` |
| Directories | kebab-case | `components/`, `field-mapping/` |

### Structure Patterns

**Tests:** Co-located with source files using `.test.ts` suffix:
```
src/lib/utils.ts
src/lib/utils.test.ts
```

**Components:** Organized by feature, not by type:
```
src/components/sites/         # Site-related components
src/components/review-queue/  # Review queue components
src/components/jobs/          # Jobs viewer components
src/components/shared/        # Reusable across features (ConfidenceBar, StatusBadge)
```

**API routes:** Mirror resource structure:
```
src/app/api/sites/route.ts              # GET (list), POST (create)
src/app/api/sites/[id]/route.ts         # GET, PATCH, DELETE
src/app/api/sites/[id]/scrape/route.ts  # POST (trigger scrape)
src/app/api/events/route.ts             # SSE endpoint
```

**Worker:** Separate top-level directory:
```
worker/
  index.ts          # Entry point, poll loop
  jobs/
    analyze.ts      # AI analysis job handler
    scrape.ts       # Scrape execution job handler
  lib/
    playwright.ts   # Shared Playwright utilities
    confidence.ts   # Confidence scoring logic
```

**Shared code:**
```
src/lib/           # Shared utilities (used by both Next.js app and worker)
  prisma.ts        # Prisma client singleton
  types.ts         # Shared TypeScript types
  constants.ts     # Shared constants (status values, field types)
  validators.ts    # Zod schemas for validation
```

### Format Patterns

**API Success Response:**
```json
{
  "data": { "id": "...", "siteUrl": "..." },
  "meta": { "total": 50, "page": 1, "pageSize": 50 }
}
```
- Single item: `{ "data": { ... } }`
- List: `{ "data": [...], "meta": { ... } }`

**API Error Response:**
```json
{
  "error": {
    "code": "SITE_NOT_FOUND",
    "message": "Site with ID abc123 not found",
    "details": null
  }
}
```

**HTTP Status Codes:**

| Scenario | Status Code |
|----------|-------------|
| Success (GET) | 200 |
| Created (POST) | 201 |
| No content (DELETE) | 204 |
| Validation error | 400 |
| Unauthorized | 401 |
| Not found | 404 |
| Server error | 500 |

**Dates:** ISO 8601 strings throughout — `"2026-03-10T14:30:00.000Z"`. Prisma handles this natively.

**Validation:** Zod schemas for all API input validation. Shared between frontend (form validation) and backend (route handler validation).

### Communication Patterns

**SSE Event Types:**

```typescript
type SSEEvent =
  | { type: 'site:status-changed'; payload: { siteId: string; status: SiteStatus } }
  | { type: 'analysis:completed'; payload: { siteId: string; confidence: number } }
  | { type: 'scrape:completed'; payload: { siteId: string; jobCount: number } }
  | { type: 'scrape:failed'; payload: { siteId: string; error: string; category: FailureCategory } }
```

- Event naming: `resource:action` in kebab-case
- Payload always includes the affected resource ID
- TanStack Query invalidation triggered by event type (e.g., `site:status-changed` → invalidate `['sites']` query)

**Logging:**

| Level | Usage | Example |
|-------|-------|---------|
| `error` | Unexpected failures | `console.error('[worker] Scrape failed:', { siteId, error })` |
| `warn` | Expected but notable | `console.warn('[worker] Low confidence:', { siteId, score })` |
| `info` | Status changes | `console.info('[worker] Analysis complete:', { siteId, confidence })` |

Format: `[component] Message: { structured data }`

### Process Patterns

**Error Handling:**
- API routes: try/catch with structured error response. Never leak stack traces.
- Worker: per-job try/catch. Failed jobs update status to `FAILED` with error details. Never crash the poll loop.
- Frontend: TanStack Query `onError` callbacks + toast notifications. Error boundaries for unexpected React errors.

**Loading States:**
- TanStack Query handles loading/error/success states automatically
- Button actions show inline spinner + disabled state during API calls
- No full-page loading screens — scope loading to the affected component

**Retry Policy:**
- Worker: no automatic retry for MVP. Admin manually re-triggers from dashboard.
- API calls (frontend): TanStack Query default retry (3 attempts with exponential backoff)
- SSE: auto-reconnect built into EventSource API

### Enforcement Guidelines

**All AI agents implementing this project MUST:**

1. Follow Prisma model naming exactly as defined in the schema — never create ad-hoc table names
2. Use the `{ data, meta }` response wrapper for all API endpoints — no bare responses
3. Use Zod for all API input validation — no manual validation
4. Co-locate tests with source files using `.test.ts` suffix
5. Use the established SSE event type format for all real-time events
6. Handle errors with structured error responses — never return raw error messages
7. Use TanStack Query for all server state — never use `useState` for API data

**Anti-Patterns to Avoid:**

- Creating new API response formats per endpoint
- Using `any` type instead of defined TypeScript interfaces
- Putting business logic in API route handlers (extract to `src/lib/` services)
- Mixing camelCase and snake_case in JSON payloads
- Creating global state for data that should be server state

## Project Structure & Boundaries

### Complete Project Directory Structure

**Project 1: Next.js App + Worker (single repo)**

```
scrapnew/
├── package.json
├── pnpm-lock.yaml
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.worker.json              # Separate TS config for worker
├── components.json                    # shadcn/ui config
├── .env.local                         # Local dev environment
├── .env.example                       # Template for env vars
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── prisma/
│   ├── schema.prisma                  # Database schema (all models)
│   ├── seed.ts                        # Seed script for dev data
│   └── migrations/                    # Prisma Migrate output
│
├── src/
│   ├── app/                           # Next.js App Router
│   │   ├── globals.css                # Tailwind imports + custom styles
│   │   ├── layout.tsx                 # Root layout (dark mode, fonts, providers)
│   │   ├── page.tsx                   # Home/Overview dashboard
│   │   │
│   │   ├── sites/
│   │   │   └── page.tsx               # Sites list view (FR1-6)
│   │   ├── review/
│   │   │   └── page.tsx               # Review queue view (FR14-16)
│   │   ├── jobs/
│   │   │   └── page.tsx               # Jobs viewer (FR29-31)
│   │   ├── status/
│   │   │   └── page.tsx               # System status view (FR32-33)
│   │   │
│   │   └── api/                       # API Route Handlers
│   │       ├── sites/
│   │       │   ├── route.ts           # GET (list), POST (create) — FR1-3
│   │       │   └── [id]/
│   │       │       ├── route.ts       # GET, PATCH, DELETE — FR4-6
│   │       │       ├── analyze/
│   │       │       │   └── route.ts   # POST (trigger analysis) — FR7-12
│   │       │       ├── scrape/
│   │       │       │   └── route.ts   # POST (trigger scrape) — FR24
│   │       │       └── config/
│   │       │           └── route.ts   # GET, PUT (site config) — FR36
│   │       ├── jobs/
│   │       │   ├── route.ts           # GET (list with site filter) — FR29-31
│   │       │   └── [id]/
│   │       │       └── route.ts       # GET (single job)
│   │       ├── scrape-runs/
│   │       │   ├── route.ts           # GET (list runs) — FR32
│   │       │   └── [id]/
│   │       │       └── route.ts       # GET (run details)
│   │       ├── analysis-results/
│   │       │   └── [siteId]/
│   │       │       └── route.ts       # GET (analysis for site) — FR16
│   │       └── events/
│   │           └── route.ts           # GET (SSE stream) — FR35
│   │
│   ├── components/
│   │   ├── ui/                        # shadcn/ui components (auto-generated)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── table.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── tooltip.tsx
│   │   │   ├── select.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── sidebar.tsx
│   │   │   └── progress.tsx
│   │   │
│   │   ├── shared/                    # Custom shared components
│   │   │   ├── ConfidenceBar.tsx       # Confidence score visualization
│   │   │   ├── StatusBadge.tsx         # Site status indicator
│   │   │   ├── StatusPill.tsx          # Top bar live count pill
│   │   │   └── AppLayout.tsx           # Sidebar + top bar + content layout
│   │   │
│   │   ├── sites/                     # Site management components
│   │   │   ├── SitesTable.tsx          # Data table with inline actions
│   │   │   ├── AddSiteInput.tsx        # URL submission input
│   │   │   └── SiteStatusTabs.tsx      # Tab-based status filter
│   │   │
│   │   ├── review-queue/              # Review queue components
│   │   │   └── ReviewQueueTable.tsx    # Filtered review queue table
│   │   │
│   │   ├── jobs/                      # Jobs viewer components
│   │   │   ├── JobsTable.tsx           # Job records table
│   │   │   └── SiteFilter.tsx          # Site filter dropdown
│   │   │
│   │   └── dashboard/                 # Overview/home components
│   │       ├── StatusPanels.tsx         # Scrape health, queue depth panels
│   │       └── NeedsAttentionTable.tsx  # Failed sites mini-table
│   │
│   ├── hooks/                         # Custom React hooks
│   │   ├── useSites.ts                # TanStack Query hook for sites
│   │   ├── useJobs.ts                 # TanStack Query hook for jobs
│   │   ├── useScrapeRuns.ts           # TanStack Query hook for scrape runs
│   │   ├── useSSE.ts                  # SSE connection + query invalidation
│   │   └── useAuth.ts                 # Auth token management
│   │
│   ├── lib/                           # Shared utilities (Next.js + Worker)
│   │   ├── prisma.ts                  # Prisma client singleton
│   │   ├── types.ts                   # Shared TypeScript types & interfaces
│   │   ├── constants.ts               # Status enums, field types, thresholds
│   │   ├── validators.ts             # Zod schemas (API input validation)
│   │   ├── errors.ts                  # Error classes and formatting
│   │   └── config.ts                  # Environment config access
│   │
│   ├── services/                      # Business logic layer
│   │   ├── siteService.ts             # Site CRUD + status transitions
│   │   ├── analysisService.ts         # Analysis job creation + result handling
│   │   ├── scrapeService.ts           # Scrape job creation + result handling
│   │   ├── jobService.ts              # Job record queries + normalization
│   │   └── eventService.ts            # SSE event emission
│   │
│   └── middleware.ts                  # Auth middleware (token check)
│
├── worker/                            # Background worker process
│   ├── index.ts                       # Entry point: poll loop
│   ├── jobs/
│   │   ├── analyze.ts                 # AI analysis job handler (FR7-13)
│   │   └── scrape.ts                  # Scrape execution handler (FR24-28)
│   ├── analysis/                      # AI analysis methods
│   │   ├── patternMatch.ts            # Method 1: Pattern matching (FR7)
│   │   ├── crawlClassify.ts           # Method 2: Crawl/classify (FR8)
│   │   ├── networkIntercept.ts        # Method 3: Network interception (FR9)
│   │   └── combineResults.ts          # Merge results + confidence scoring (FR10-11)
│   └── lib/
│       ├── playwright.ts              # Playwright browser management
│       ├── normalizer.ts              # Job data normalization (FR26)
│       └── validator.ts               # Schema validation for scraped data (FR28)
│
└── public/
    └── favicon.ico

```

**Project 2: Chrome Extension (separate repo)**

```
scrapnew-extension/
├── package.json
├── pnpm-lock.yaml
├── wxt.config.ts                      # WXT framework config
├── tailwind.config.ts                 # Same Tailwind config as dashboard
├── tsconfig.json
├── .env                               # API URL config
├── .gitignore
│
├── src/
│   ├── entrypoints/
│   │   ├── background.ts             # Service worker (MV3)
│   │   ├── content.ts                # Content script — injected into target sites
│   │   ├── sidepanel/                # Side panel UI (FR17-22)
│   │   │   ├── index.html
│   │   │   ├── App.tsx               # Panel root component
│   │   │   ├── FieldMappingPanel.tsx # Field list + actions (FR17-19)
│   │   │   ├── ModeSelector.tsx      # Review / Navigate / Form Record tabs
│   │   │   └── SaveConfig.tsx        # Save + trigger test scrape (FR22)
│   │   └── options/                  # Extension settings page
│   │       ├── index.html
│   │       └── App.tsx               # Token configuration (FR23)
│   │
│   ├── components/                   # Shared extension components
│   │   ├── ui/                       # shadcn/ui subset (Button, Badge, Select)
│   │   ├── ConfidenceBar.tsx         # Same as dashboard version
│   │   └── StatusBadge.tsx           # Same as dashboard version
│   │
│   ├── content/                      # Content script modules
│   │   ├── FieldHighlight.ts         # DOM overlay for field highlights
│   │   ├── ElementPicker.ts          # Click-to-select element picker
│   │   ├── NavigateRecorder.ts       # Page flow recording (FR20)
│   │   └── FormRecorder.ts           # Form field capture (FR21)
│   │
│   ├── lib/
│   │   ├── api.ts                    # REST API client (shared endpoints)
│   │   ├── auth.ts                   # Token from chrome.storage.local
│   │   ├── types.ts                  # Shared types (copied from main project)
│   │   └── constants.ts              # Shared constants (copied from main project)
│   │
│   └── assets/
│       └── icon/                     # Extension icons (16, 32, 48, 128px)
│
└── public/
```

### Architectural Boundaries

**API Boundaries:**
- All client → server communication goes through `/api/*` Route Handlers
- Chrome extension and dashboard consume the **same** API — no separate endpoints
- Worker does **not** use API routes — it accesses Prisma directly (same process boundary as the DB)
- Auth middleware sits at `src/middleware.ts` — checks all `/api/*` requests

**Component Boundaries:**
- `src/services/` contains all business logic — API routes are thin wrappers that validate input, call a service, and format the response
- `src/components/` is purely presentational + interaction logic — no direct API calls (use hooks)
- `src/hooks/` bridges components to services via TanStack Query
- Worker `jobs/` handlers orchestrate work; `analysis/` and `lib/` contain the actual logic

**Data Boundaries:**
- Prisma is the **only** database access layer — no raw SQL
- `src/lib/prisma.ts` provides the singleton client used by both Next.js and worker
- JSON fields (`fieldMappings`, `rawData`, `siteConfig`) are typed via Zod schemas in `validators.ts`
- All data access goes through `src/services/` — components and API routes never import Prisma directly

### Requirements to Structure Mapping

| FR Category | Dashboard Pages | API Routes | Services | Worker | Extension |
|-------------|----------------|------------|----------|--------|-----------|
| Site Management (FR1-6) | `sites/page.tsx` | `api/sites/` | `siteService.ts` | — | — |
| AI Analysis (FR7-13) | — | `api/sites/[id]/analyze/` | `analysisService.ts` | `jobs/analyze.ts`, `analysis/*` | — |
| Review Queue (FR14-16) | `review/page.tsx` | `api/sites/` (filtered) | `siteService.ts` | — | — |
| Chrome Extension (FR17-23) | — | `api/sites/[id]/config/` | — | — | `sidepanel/`, `content/` |
| Scraping (FR24-28) | — | `api/sites/[id]/scrape/` | `scrapeService.ts` | `jobs/scrape.ts` | — |
| Data Review (FR29-31) | `jobs/page.tsx` | `api/jobs/` | `jobService.ts` | — | — |
| Dashboard Ops (FR32-35) | `page.tsx`, `status/page.tsx` | `api/events/`, `api/scrape-runs/` | `eventService.ts` | — | — |
| Config & Data (FR36-38) | — | `api/sites/[id]/config/` | `siteService.ts` | — | — |

### Integration Points & Data Flow

**Site Onboarding Flow:**
```
Dashboard (AddSiteInput)
  → POST /api/sites (creates Site record, status: ANALYZING)
  → Worker polls DB, picks up pending analysis job
  → Worker runs Playwright (3 analysis methods)
  → Worker writes AnalysisResult to DB, updates Site status
  → SSE event: site:status-changed
  → Dashboard auto-updates via TanStack Query invalidation
  → Admin clicks Review → opens target site in new tab
  → Extension auto-activates, loads config from GET /api/sites/[id]/config
  → Admin corrects mappings in extension
  → Extension saves via PUT /api/sites/[id]/config
  → Auto-triggers POST /api/sites/[id]/scrape
  → Worker picks up scrape job, executes with config
  → Worker writes Job records to DB
  → SSE event: scrape:completed
  → Dashboard shows jobs in Jobs viewer
```

### Development Workflow

**Dev commands:**
```bash
# Next.js app (dashboard + API)
pnpm dev                    # Start Next.js dev server (Turbopack)

# Worker (separate terminal)
pnpm worker:dev             # Start worker with ts-node --watch

# Chrome extension (separate terminal, separate repo)
pnpm dev                    # WXT dev server with hot reload

# Database
pnpm prisma:migrate         # Run migrations
pnpm prisma:studio          # Open Prisma Studio for DB inspection
pnpm prisma:seed            # Seed dev data
```

**Build & Deploy:**
```bash
# Next.js app
pnpm build                  # Build for production
# Deployed as Render Web Service: pnpm start

# Worker
pnpm worker:build           # Compile TypeScript
# Deployed as Render Background Worker: node dist/worker/index.js

# Extension
pnpm build                  # WXT production build
# Output: .output/chrome-mv3/ → load as unpacked or zip for distribution
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are compatible and well-tested together: Next.js 16.1 + TypeScript + Tailwind CSS + shadcn/ui + Prisma 7.4.x + PostgreSQL + TanStack Query + SSE. WXT for Chrome extension uses the same React + Tailwind stack. Worker shares Prisma client and TypeScript types with Next.js app. No contradictory decisions found.

**Pattern Consistency:**
Naming conventions are consistent across all components: camelCase for code/JSON, PascalCase for components/models, kebab-case for directories/endpoints. Response format (`{ data, meta }` / `{ error }`) is uniform. Feature-based component organization aligns with App Router page structure.

**Structure Alignment:**
Project tree covers all 38 FRs with explicit file mappings. Worker is a separate directory sharing `src/lib/`. API routes follow REST resource patterns. Services layer enforces business logic boundaries.

### Requirements Coverage Validation ✅

**Functional Requirements: 38/38 Covered**

All FR categories (Site Management, AI Analysis, Review Queue, Chrome Extension, Scraping, Data Review, Dashboard Ops, Config & Data) have explicit architectural support with mapped files, API routes, services, and components.

**Non-Functional Requirements: All Addressed**

- Performance: Async worker processing, TanStack Query caching, SSE for real-time
- Scalability: PostgreSQL handles millions of records; single worker sufficient for MVP 100 sites
- Reliability: Per-job fault isolation, transaction-based data persistence, SSE auto-reconnect
- Security: Bearer token auth, CORS for extension, no stack trace leaks

### Implementation Readiness Validation ✅

**Decision Completeness:** 14 decision tables across 7 categories with versions specified. All critical decisions documented.

**Structure Completeness:** Two complete project trees with all files mapped to specific FRs. Component boundaries, data boundaries, and API boundaries defined.

**Pattern Completeness:** Naming, structure, format, communication, and process patterns specified with concrete examples. Enforcement guidelines and anti-patterns documented.

### Gap Analysis Results

**No critical gaps.** Three important items for implementation phase:

1. **Testing framework:** Vitest recommended — add during project scaffolding story
2. **Shared types between repos:** Manual copy for MVP; create sync script if needed
3. **Site config JSON schema:** Define as Zod schema in `src/lib/validators.ts` during database schema story — must be specified before extension and worker implementation

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (medium)
- [x] Technical constraints identified (Playwright, MV3, single operator)
- [x] Cross-cutting concerns mapped (shared types, async jobs, SSE, error categorization, state machine)

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions (Next.js 16.1, Prisma 7.4.x, shadcn CLI v4)
- [x] Technology stack fully specified (14 decision tables across 7 categories)
- [x] Integration patterns defined (REST API, SSE, worker polling)
- [x] Performance considerations addressed (async processing, client caching, pagination)

**✅ Implementation Patterns**
- [x] Naming conventions established (database, API, code)
- [x] Structure patterns defined (feature-based components, co-located tests)
- [x] Communication patterns specified (SSE events, logging format)
- [x] Process patterns documented (error handling, loading states, retry policy)

**✅ Project Structure**
- [x] Complete directory structure defined (two projects, all files mapped)
- [x] Component boundaries established (API → Services → Prisma)
- [x] Integration points mapped (site onboarding data flow)
- [x] Requirements to structure mapping complete (38 FRs → specific files)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all 38 FRs have architectural support, no contradictions found, patterns are comprehensive.

**Key Strengths:**
- Clean separation of concerns: Next.js (UI + API), Worker (heavy processing), Extension (field mapping)
- Same language (TypeScript) and ORM (Prisma) across all components — no translation overhead
- Standard technology choices with large ecosystems — AI agents will have ample context
- Explicit patterns prevent the most common AI agent conflicts (naming, response format, file organization)

**Areas for Future Enhancement (Post-MVP):**
- Distributed job queue (BullMQ + Redis) for Phase 3 scale
- Shared types package between repos if manual sync becomes burdensome
- Monitoring and alerting beyond console logs (Sentry, Datadog)
- CI/CD pipeline optimization for the two-repo setup

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions
- When in doubt, check the enforcement guidelines and anti-patterns

**First Implementation Priority:**
```bash
pnpm dlx shadcn@latest init    # Scaffold Next.js + shadcn/ui + dark mode
pnpm add prisma @prisma/client
npx prisma init --datasource-provider postgresql
```
