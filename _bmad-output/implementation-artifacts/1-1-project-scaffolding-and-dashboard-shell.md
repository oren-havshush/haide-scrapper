# Story 1.1: Project Scaffolding & Dashboard Shell

Status: ready-for-dev

## Story

As an admin,
I want the platform initialized with a working dashboard and database,
So that I have a foundation to manage my scraping pipeline.

## Acceptance Criteria

1. **Given** the project is not yet created **When** scaffolding is completed **Then** a Next.js 16.1 app is initialized with shadcn/ui v4 (dark mode), Prisma 7.4.x with PostgreSQL, and all core database models (Site, Job, ScrapeRun, AnalysisResult) are created with proper migrations.

2. **Given** the Prisma schema is created **When** I inspect the models **Then**:
   - Site model has fields: id (String, cuid), siteUrl (String, unique), status (SiteStatus enum: ANALYZING, REVIEW, ACTIVE, FAILED, SKIPPED), confidenceScore (Float, optional), fieldMappings (Json, optional), pageFlow (Json, optional), createdAt (DateTime), updatedAt (DateTime), analyzingAt (DateTime, optional), reviewAt (DateTime, optional), activeAt (DateTime, optional), failedAt (DateTime, optional), skippedAt (DateTime, optional)
   - Job model has: id, title (String), company (String), location (String), salary (String, optional), description (String, optional), rawData (Json), validationStatus (String, optional), siteId (relation to Site), scrapeRunId (relation to ScrapeRun), createdAt
   - ScrapeRun model has: id, siteId (relation to Site), status (ScrapeRunStatus enum: IN_PROGRESS, COMPLETED, FAILED), jobCount (Int, default 0), totalJobs (Int, optional), validJobs (Int, optional), invalidJobs (Int, optional), error (String, optional), failureCategory (String, optional), createdAt, completedAt (DateTime, optional)
   - AnalysisResult model has: id, siteId (relation to Site), method (AnalysisMethod enum: PATTERN_MATCH, CRAWL_CLASSIFY, NETWORK_INTERCEPT), fieldMappings (Json), confidenceScores (Json), overallConfidence (Float), apiEndpoint (String, optional), createdAt

3. **Given** the app is running **When** I open the dashboard in a browser **Then** I see a dark-mode layout with a compact icon sidebar (56px) containing navigation icons for Home, Sites, Review Queue, Jobs, and Status, a top bar (48px) displaying the project name, and a fluid-width main content area (max 1400px).

4. **Given** the app is running **When** an API request is made to any `/api/*` route without a valid Bearer token **Then** the request is rejected with 401 and structured error response `{ error: { code: "UNAUTHORIZED", message: "..." } }`. **When** a valid Bearer token matching `.env` `API_TOKEN` is included **Then** the request proceeds normally.

5. **Given** the project is set up **When** I inspect the codebase **Then**:
   - Shared utilities exist in `src/lib/` (prisma.ts, types.ts, constants.ts, validators.ts, errors.ts, config.ts)
   - Shared custom components StatusBadge and ConfidenceBar exist in `src/components/shared/`
   - AppLayout component with sidebar + top bar exists in `src/components/shared/`
   - TanStack Query provider is configured in the root layout
   - Zod 4.x is installed for API input validation
   - API response format uses `{ data }` for single items and `{ data, meta }` for lists

## Tasks / Subtasks

- [ ] Task 1: Create Next.js project and install dependencies (AC: #1)
  - [ ] Run `pnpm create next-app@latest scrapnew` (App Router, TypeScript, Tailwind, ESLint, `@/*` alias)
  - [ ] Run `pnpm dlx shadcn@latest init` inside the project (dark mode, default style)
  - [ ] Install Prisma: `pnpm add prisma @prisma/client @prisma/adapter-pg pg`
  - [ ] Run `npx prisma init --datasource-provider postgresql`
  - [ ] Create `prisma.config.ts` with PostgreSQL driver adapter configuration
  - [ ] Install TanStack Query: `pnpm add @tanstack/react-query`
  - [ ] Install Zod: `pnpm add zod`
  - [ ] Set up `.env.local` with DATABASE_URL and API_TOKEN
  - [ ] Create `.env.example` template

- [ ] Task 2: Define Prisma schema with all core models (AC: #2)
  - [ ] Define SiteStatus, ScrapeRunStatus, AnalysisMethod, JobStatus enums
  - [ ] Define Site model with all fields and status transition timestamps
  - [ ] Define Job model with normalized fields + rawData Json
  - [ ] Define ScrapeRun model with status tracking and failure categorization
  - [ ] Define AnalysisResult model with per-method results
  - [ ] Define WorkerJob model for the background job queue (status: PENDING, IN_PROGRESS, COMPLETED, FAILED; type: ANALYSIS, SCRAPE)
  - [ ] Run `npx prisma migrate dev --name init` to generate initial migration
  - [ ] Create Prisma client singleton in `src/lib/prisma.ts`

- [ ] Task 3: Create shared utilities in src/lib/ (AC: #5)
  - [ ] `prisma.ts` — Prisma client singleton with driver adapter
  - [ ] `types.ts` — Shared TypeScript types/interfaces (ApiResponse, ApiError, SiteConfig, etc.)
  - [ ] `constants.ts` — Status enums, field types, confidence thresholds (CONFIDENCE_THRESHOLD = 70)
  - [ ] `validators.ts` — Zod schemas for API input validation (createSiteSchema, etc.)
  - [ ] `errors.ts` — Error classes (AppError, NotFoundError, ValidationError) and formatErrorResponse helper
  - [ ] `config.ts` — Environment config access (API_TOKEN, DATABASE_URL)

- [ ] Task 4: Create auth middleware (AC: #4)
  - [ ] Create `src/proxy.ts` (Next.js 16 renamed middleware.ts to proxy.ts)
  - [ ] Implement Bearer token check for all `/api/*` routes
  - [ ] Return structured error `{ error: { code, message } }` on 401
  - [ ] Allow non-API routes (dashboard pages) through without auth

- [ ] Task 5: Create dashboard shell layout (AC: #3)
  - [ ] Create `src/components/shared/AppLayout.tsx` — sidebar + top bar + content area
  - [ ] Implement compact icon sidebar (56px) with 5 nav items: Home, Sites, Review Queue, Jobs, Status
  - [ ] Implement top bar (48px) with project name "scrapnew"
  - [ ] Main content area: fluid width, max-w-[1400px], centered
  - [ ] Wire dark mode in `src/app/layout.tsx` (class="dark" on html element)
  - [ ] Configure Inter font via next/font/google
  - [ ] Set up TanStack QueryClientProvider in root layout

- [ ] Task 6: Create shared custom components (AC: #5)
  - [ ] `src/components/shared/StatusBadge.tsx` — 5 variants matching status colors
  - [ ] `src/components/shared/ConfidenceBar.tsx` — horizontal bar with color gradient
  - [ ] Install required shadcn/ui components: `pnpm dlx shadcn@latest add button input table badge card dialog toast tabs tooltip select dropdown-menu sidebar progress`

- [ ] Task 7: Create placeholder pages (AC: #3)
  - [ ] `src/app/page.tsx` — Home/Overview (placeholder content)
  - [ ] `src/app/sites/page.tsx` — Sites list (placeholder)
  - [ ] `src/app/review/page.tsx` — Review queue (placeholder)
  - [ ] `src/app/jobs/page.tsx` — Jobs viewer (placeholder)
  - [ ] `src/app/status/page.tsx` — System status (placeholder)

- [ ] Task 8: Create API response helpers and sample endpoint (AC: #4, #5)
  - [ ] Create response wrapper helpers in `src/lib/api-utils.ts`: `successResponse(data)`, `listResponse(data, meta)`, `errorResponse(error)`
  - [ ] Create `src/app/api/sites/route.ts` with GET (empty list) to verify auth + response format
  - [ ] Verify 401 on unauthenticated request
  - [ ] Verify `{ data, meta }` response format on authenticated request

## Dev Notes

### Critical Architecture Decisions

- **Package manager:** pnpm (NOT npm or yarn)
- **Next.js 16.1**: Turbopack is default dev server. App Router is default. `middleware.ts` has been RENAMED to `proxy.ts` — use `proxy.ts` for auth middleware.
- **Prisma 7.4.x BREAKING CHANGES from 6.x:**
  - Requires explicit driver adapters — Prisma no longer handles DB connections internally
  - New `prisma.config.ts` file required at project root
  - Ships as ESM only
  - Install `@prisma/adapter-pg` and `pg` packages for PostgreSQL
- **shadcn CLI v4** does NOT scaffold a Next.js project — it adds components to an existing project. Run `create-next-app` FIRST, then `shadcn init`.
- **Zod 4.x** (not 3.x) — 14x faster string parsing, JSON Schema conversion support
- **TanStack Query v5** — package is `@tanstack/react-query` (NOT react-query)

### Naming Conventions (MUST FOLLOW)

| Element | Convention | Example |
|---------|-----------|---------|
| Prisma models | PascalCase | `Site`, `Job`, `ScrapeRun` |
| Prisma fields | camelCase | `siteUrl`, `confidenceScore` |
| Prisma enums | PascalCase name, SCREAMING_SNAKE values | `enum SiteStatus { ANALYZING }` |
| React components | PascalCase file + export | `StatusBadge.tsx` |
| Utilities | camelCase file + export | `formatConfidence.ts` |
| Directories | kebab-case | `review-queue/` |
| API endpoints | Plural, kebab-case | `/api/sites`, `/api/scrape-runs` |
| Constants | SCREAMING_SNAKE | `const CONFIDENCE_THRESHOLD = 70` |

### API Response Format (MUST FOLLOW)

```typescript
// Single item
{ data: { id: "...", siteUrl: "..." } }

// List with pagination
{ data: [...], meta: { total: 50, page: 1, pageSize: 50 } }

// Error
{ error: { code: "SITE_NOT_FOUND", message: "Site with ID abc123 not found" } }
```

### HTTP Status Codes

| Scenario | Code |
|----------|------|
| Success (GET) | 200 |
| Created (POST) | 201 |
| No content (DELETE) | 204 |
| Validation error | 400 |
| Unauthorized | 401 |
| Not found | 404 |
| Server error | 500 |

### Project Structure (THIS STORY)

```
scrapnew/
├── package.json
├── pnpm-lock.yaml
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── components.json               # shadcn/ui config
├── prisma.config.ts              # Prisma 7.x config with driver adapter
├── .env.local                    # DATABASE_URL, API_TOKEN
├── .env.example
├── prisma/
│   ├── schema.prisma             # All models: Site, Job, ScrapeRun, AnalysisResult, WorkerJob
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx            # Root layout: dark mode, Inter font, QueryClientProvider
│   │   ├── page.tsx              # Home/Overview placeholder
│   │   ├── sites/page.tsx        # Sites placeholder
│   │   ├── review/page.tsx       # Review queue placeholder
│   │   ├── jobs/page.tsx         # Jobs placeholder
│   │   ├── status/page.tsx       # Status placeholder
│   │   └── api/
│   │       └── sites/
│   │           └── route.ts      # GET (list) — verify auth + format
│   ├── components/
│   │   ├── ui/                   # shadcn/ui auto-generated
│   │   └── shared/
│   │       ├── AppLayout.tsx     # Sidebar + top bar + content
│   │       ├── StatusBadge.tsx   # Site status indicator
│   │       └── ConfidenceBar.tsx # Confidence score bar
│   ├── lib/
│   │   ├── prisma.ts            # Prisma client singleton
│   │   ├── types.ts             # Shared TypeScript types
│   │   ├── constants.ts         # Enums, thresholds, field types
│   │   ├── validators.ts        # Zod schemas
│   │   ├── errors.ts            # Error classes + formatErrorResponse
│   │   ├── config.ts            # Environment config
│   │   └── api-utils.ts         # Response wrapper helpers
│   └── proxy.ts                 # Auth middleware (Next.js 16: proxy.ts, NOT middleware.ts)
```

### UX Requirements for Dashboard Shell

- **Background:** `#0a0a0b` (near-black)
- **Surface:** `#18181b` (cards, panels)
- **Border:** `#3f3f46`
- **Text primary:** `#fafafa`
- **Text secondary:** `#a1a1aa`
- **Sidebar:** 56px collapsed, icons only. 5 items: Home (LucideHome), Sites (LucideGlobe), Review Queue (LucideClipboardCheck), Jobs (LucideBriefcase), Status (LucideActivity)
- **Top bar:** 48px height, project name "scrapnew" left-aligned
- **Content:** fluid width, max-w-[1400px], mx-auto
- **Font:** Inter via next/font/google, 14px body
- **Dark mode:** Set `class="dark"` on `<html>` element in root layout

### StatusBadge Variants

| Status | Text Color | Background |
|--------|-----------|------------|
| ANALYZING | `#3b82f6` (blue) | `rgba(59,130,246,0.15)` |
| REVIEW | `#f59e0b` (amber) | `rgba(245,158,11,0.15)` |
| ACTIVE | `#22c55e` (green) | `rgba(34,197,94,0.15)` |
| FAILED | `#ef4444` (red) | `rgba(239,68,68,0.15)` |
| SKIPPED | `#6b7280` (grey) | `rgba(107,114,128,0.15)` |

### ConfidenceBar Color Logic

| Range | Color |
|-------|-------|
| 0-40% | `#ef4444` (red) |
| 41-69% | `#f59e0b` (amber) |
| 70-89% | `#22c55e` (green) |
| 90-100% | `#16a34a` (bright green) |

Bar: 6px height background `#27272a`, fill width = confidence %. Compact variant: 4px, no label.

### Prisma 7.4 Setup Details

```typescript
// prisma.config.ts (project root)
import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
})
```

```typescript
// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL!
const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

### Auth Proxy Setup (Next.js 16)

```typescript
// src/proxy.ts (NOT middleware.ts — renamed in Next.js 16)
import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next()
  }
  // Check Bearer token...
}

export const config = {
  matcher: '/api/:path*',
}
```

### Anti-Patterns to AVOID

- Do NOT put business logic in API route handlers — extract to `src/services/` (future stories)
- Do NOT use `any` type — define proper TypeScript interfaces
- Do NOT use `useState` for server data — use TanStack Query
- Do NOT create bare API responses — always use `{ data }` or `{ data, meta }` wrappers
- Do NOT use `middleware.ts` filename — Next.js 16 uses `proxy.ts`
- Do NOT install Prisma without driver adapter — Prisma 7.x requires `@prisma/adapter-pg`

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Design Direction Decision]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

### File List
