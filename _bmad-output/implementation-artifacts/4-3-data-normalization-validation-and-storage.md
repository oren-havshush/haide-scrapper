# Story 4.3: Data Normalization, Validation & Storage

Status: done

## Story

As an admin,
I want scraped job data to be normalized and validated,
So that I can trust the data quality and query jobs using a consistent schema.

## Acceptance Criteria

1. **Given** raw job data has been extracted from a scrape **When** the normalization step runs **Then** each job record is transformed into the standard schema with fields: title, company, location, salary (if available), description (if available), and any additional mapped fields (FR26) **And** text fields are trimmed of extra whitespace and HTML tags

2. **Given** job records are normalized **When** they are stored in the database **Then** each Job record contains both the normalized fields (title, company, location, salary, description) and the original rawData as a Json field (FR27) **And** each Job is linked to the Site and the ScrapeRun that produced it

3. **Given** a normalized job record is produced **When** validation runs against the job schema **Then** required fields (title, company, location) are checked for presence and non-empty values **And** records with missing required fields are flagged with a validation status indicating which fields are missing (FR28)

4. **Given** some job records pass validation and some fail **When** the scrape completes **Then** all records (valid and invalid) are stored in the database **And** the ScrapeRun record includes counts: totalJobs, validJobs, invalidJobs **And** invalid records are queryable separately for quality review

5. **Given** a scrape produces zero job records **When** the scrape completes **Then** the ScrapeRun is marked as COMPLETED with jobCount: 0 **And** the failure category is set to "empty_results" for dashboard alerting

6. **Given** the normalization and validation logic is implemented **When** I inspect the codebase **Then** the normalizer is in `worker/lib/normalizer.ts` and the validator is in `worker/lib/validator.ts`

## Tasks / Subtasks

- [x] Task 1: Create `worker/lib/normalizer.ts` -- data normalization module (AC: #1, #6)
  - [x] 1.1: Define `NormalizedJobRecord` interface with fields: title, company, location, salary, description, url, additionalFields (Record<string, string>), rawFields (Record<string, string>)
  - [x] 1.2: Create `normalizeJobRecord(rawFields: Record<string, string>)` function that transforms raw extracted data into the NormalizedJobRecord format
  - [x] 1.3: Implement `stripHtmlTags(text: string): string` -- remove all HTML tags from a string, preserving text content
  - [x] 1.4: Implement `normalizeWhitespace(text: string): string` -- collapse multiple consecutive whitespace characters (spaces, tabs, newlines) into single spaces and trim
  - [x] 1.5: Implement `normalizeField(rawValue: string): string` -- pipeline: strip HTML tags, then normalize whitespace
  - [x] 1.6: Map standard fields (title, company, location, salary, description) from rawFields using `normalizeField()` for each
  - [x] 1.7: Extract URL from rawFields: prefer `title_href`, fall back to `_detailUrl`, fall back to empty string
  - [x] 1.8: Collect any non-standard fields (keys not in the standard set and not prefixed with `_`) into `additionalFields`, also normalized
  - [x] 1.9: Preserve the original `rawFields` without modification in the output for raw data storage (FR27)

- [x] Task 2: Create `worker/lib/validator.ts` -- job record validation module (AC: #3, #4, #6)
  - [x] 2.1: Define `ValidationResult` interface with fields: isValid (boolean), status (string), missingFields (string[]), warnings (string[])
  - [x] 2.2: Create `validateJobRecord(record: NormalizedJobRecord): ValidationResult` function
  - [x] 2.3: Check required fields: title, company, location must be present and non-empty after normalization
  - [x] 2.4: Check field quality warnings (non-blocking): title longer than 200 characters, company longer than 100 characters, location longer than 150 characters (likely extraction errors)
  - [x] 2.5: Return status string: "valid" if all required fields present, or "invalid:missing_title,missing_company,..." listing the missing fields
  - [x] 2.6: Return warnings array for field quality issues (does NOT affect valid/invalid status)

- [x] Task 3: Refactor `worker/jobs/scrape.ts` to use normalizer and validator (AC: #1, #2, #3, #4, #5)
  - [x] 3.1: Import `normalizeJobRecord` from `worker/lib/normalizer.ts` and `validateJobRecord` from `worker/lib/validator.ts`
  - [x] 3.2: Remove the inline `stripHtmlTags()`, `validateJobRecord()`, and `buildJobRecord()` functions from scrape.ts -- they are now in the dedicated modules
  - [x] 3.3: Update the single-page extraction path: after extracting rawFields, call `normalizeJobRecord(rawFields)` to get the normalized record
  - [x] 3.4: Update the multi-page extraction path: same normalization call after raw field extraction
  - [x] 3.5: After normalization, call `validateJobRecord(normalizedRecord)` to get validation result
  - [x] 3.6: Update the Prisma transaction to use normalized fields from the normalizer output instead of the inline cleanup
  - [x] 3.7: Log validation warnings for records that have quality issues (using `console.warn`)
  - [x] 3.8: Keep the existing ScrapeRun update logic (totalJobs, validJobs, invalidJobs counts) -- just feed it data from the new validator
  - [x] 3.9: Keep the existing empty results handling (failureCategory "empty_results") unchanged

- [x] Task 4: Add job query support for filtering by validation status (AC: #4)
  - [x] 4.1: Update `GET /api/jobs/route.ts` to accept an optional `validationStatus` query parameter (values: "valid", "invalid", or omitted for all)
  - [x] 4.2: Add a Zod schema `jobsFilterSchema` in `src/lib/validators.ts` with optional `validationStatus` field
  - [x] 4.3: Apply the filter in the Prisma query: if `validationStatus` is "valid", filter where `validationStatus = "valid"`; if "invalid", filter where `validationStatus` starts with "invalid:"
  - [x] 4.4: Ensure the existing pagination, siteId filter, and sorting continue to work alongside the new filter

- [x] Task 5: Verify build, lint, and integration (AC: all)
  - [x] 5.1: Run `pnpm build` -- must pass without TypeScript or build errors
  - [x] 5.2: Run `pnpm lint` -- must pass without warnings or errors
  - [x] 5.3: Manual verification checklist:
    - Normalizer strips HTML tags from all text fields
    - Normalizer collapses whitespace and trims all fields
    - Normalizer preserves original rawFields untouched
    - Normalizer maps standard fields and collects additional fields
    - Validator checks title, company, location as required
    - Validator produces "valid" or "invalid:missing_x,missing_y" status strings
    - Validator emits warnings for abnormally long field values
    - scrape.ts uses normalizer and validator instead of inline functions
    - Job records in DB have properly normalized fields + rawData JSON
    - ScrapeRun counts (totalJobs, validJobs, invalidJobs) reflect validator output
    - GET /api/jobs supports ?validationStatus=valid and ?validationStatus=invalid filters
    - No `any` types in the new or modified code
    - Worker continues to function correctly for both single-page and multi-page scrapes

## Dev Notes

### Critical Architecture Decisions (MUST FOLLOW)

- **This story creates `worker/lib/normalizer.ts` and `worker/lib/validator.ts`** -- dedicated modules for data normalization and validation. It also refactors `worker/jobs/scrape.ts` to use them.
- **Worker accesses Prisma directly** -- no API calls. Import `prisma` from `@/lib/prisma`.
- **Prisma 7.4.x** -- import from `@/generated/prisma/client`. Enums from `@/generated/prisma/enums`.
- **Package manager:** pnpm.
- **Services layer for business logic** -- but the worker is a separate process and handles its own DB writes directly via Prisma. It does NOT call API routes or service functions.
- **Data committed before success** -- the existing Prisma transaction in scrape.ts already handles atomic writes (NFR11). The refactored code must preserve this behavior.
- **No new npm dependencies** -- all normalization and validation logic uses built-in string methods and regex. No external libraries needed.
- **The Prisma schema is NOT modified** -- all models (Job, ScrapeRun, WorkerJob, Site) are sufficient as-is. The `validationStatus` field on Job is already a String? field that can store "valid" or "invalid:missing_x" values.

### Existing Code to Reuse (DO NOT REINVENT)

| What | Location | Notes |
|------|----------|-------|
| Scrape handler | `worker/jobs/scrape.ts` | Refactor inline normalization/validation into dedicated modules |
| Inline `stripHtmlTags` | `worker/jobs/scrape.ts` | Move to `worker/lib/normalizer.ts` |
| Inline `validateJobRecord` | `worker/jobs/scrape.ts` | Replace with proper validator in `worker/lib/validator.ts` |
| Inline `buildJobRecord` | `worker/jobs/scrape.ts` | Replace with `normalizeJobRecord` in normalizer |
| Prisma client | `src/lib/prisma.ts` | Import: `import { prisma } from "@/lib/prisma"` |
| Job model | `prisma/schema.prisma` | title, company, location, salary, description, rawData (Json), validationStatus (String?) |
| ScrapeRun model | `prisma/schema.prisma` | totalJobs, validJobs, invalidJobs already exist |
| Jobs API | `src/app/api/jobs/route.ts` | Add validationStatus filter |
| Validators | `src/lib/validators.ts` | Add jobsFilterSchema |
| Constants | `src/lib/constants.ts` | Reference REQUIRED_FIELDS if needed |

### Data Flow After Refactor

```
1. Scrape handler extracts rawFields (Record<string, string>) per job item
2. normalizeJobRecord(rawFields) -> NormalizedJobRecord
   - Strips HTML tags from all text fields
   - Collapses whitespace, trims
   - Maps standard fields (title, company, location, salary, description)
   - Extracts URL from title_href or _detailUrl
   - Collects non-standard fields into additionalFields
   - Preserves raw rawFields untouched
3. validateJobRecord(normalizedRecord) -> ValidationResult
   - Checks required fields (title, company, location)
   - Detects quality warnings (abnormally long values)
   - Returns isValid boolean + status string + missingFields + warnings
4. Prisma transaction creates Job records using normalized data + rawData
5. ScrapeRun updated with totalJobs, validJobs, invalidJobs counts
```

### Standard Fields vs Additional Fields

The standard job schema fields are: `title`, `company`, `location`, `salary`, `description`. These map directly to columns on the Job model.

If the site's fieldMappings include additional fields (e.g., `department`, `jobType`, `experience`), those should be:
- Normalized the same way (strip HTML, trim whitespace)
- Stored in the `rawData` JSON alongside the raw extraction data
- NOT stored as top-level Job columns (the schema doesn't have those columns)

### Normalization Rules

1. **Strip HTML tags**: Remove all `<tag>` patterns including attributes. Preserve text content between tags.
2. **Normalize whitespace**: Replace sequences of `\s+` (spaces, tabs, newlines, non-breaking spaces) with a single space.
3. **Trim**: Remove leading and trailing whitespace.
4. **Handle empty/null**: If a raw field is empty, null, or undefined, normalize to empty string.
5. **Preserve original**: The `rawFields` map is stored as-is in `rawData` for debugging and re-processing.

### Validation Rules

1. **Required fields**: `title`, `company`, `location` must be non-empty after normalization.
2. **Validation status string format**: `"valid"` or `"invalid:missing_title,missing_company,missing_location"` -- comma-separated list of missing required fields.
3. **Quality warnings** (non-blocking):
   - Title > 200 chars: likely includes extra content from wrong selector
   - Company > 100 chars: likely includes extra content
   - Location > 150 chars: likely includes extra content
4. **All records stored**: Both valid and invalid records are saved. Invalid records are not discarded -- they are kept for quality review (FR28).

### API Enhancement: Jobs Filter

The existing `GET /api/jobs` endpoint accepts `siteId` and pagination params. This story adds:

- `?validationStatus=valid` -- return only valid jobs
- `?validationStatus=invalid` -- return only jobs whose validationStatus starts with "invalid:"
- Omitted -- return all jobs (current default behavior)

The Prisma query for "invalid" filter uses `startsWith: "invalid:"` since the status contains specific missing field details after the prefix.

### Previous Story Learnings (from Stories 1-1 through 4-2)

1. **Next.js 16.1 uses `proxy.ts`** (not `middleware.ts`) and the export is named `proxy`.
2. **Prisma 7.4.x imports from `@/generated/prisma/client`** -- custom output path.
3. **shadcn/ui v4 uses Base UI** -- not Radix.
4. **Dashboard route group `(dashboard)/`** wraps pages with AppLayout.
5. **Always run `pnpm build`** in both extension and main project before marking story as done.
6. **ESLint `no-explicit-any`** -- avoid `any` from the start, use proper types.
7. **API response format** -- `{ data }` for single items, `{ data, meta }` for lists.
8. **TanStack Query** for all client-side server state. Use `useMutation` for POST/PUT/DELETE.
9. **Services layer for business logic** -- API routes delegate to `src/services/`. The worker accesses Prisma directly.
10. **Status transitions enforced by `siteService.ts`** -- use `VALID_STATUS_TRANSITIONS` map. But the worker updates site status directly via Prisma (bypasses the service layer).
11. **`apiFetch` helper** is in `src/lib/fetch.ts` -- shared across hooks.
12. **ConflictError (409)** is used for duplicate scrape prevention -- exists in `src/lib/errors.ts`.
13. **WorkerJob payload field** is `Json?` -- stores `{ scrapeRunId: "..." }` for SCRAPE jobs.
14. **The worker's jobDispatcher.ts** currently routes SCRAPE jobs to `handleScrapeJob` from `worker/jobs/scrape.ts`.
15. **Playwright browser cleanup** -- always use `closeBrowser()` in a `finally` block.
16. **The `Prisma.InputJsonValue` type** is needed when storing JSON in Prisma.
17. **`dotenv/config`** must be imported at the top of worker entry point -- already done in `worker/index.ts`.
18. **Worker TypeScript uses `@/` path aliases** -- resolved by `tsx` in dev mode.
19. **The scrape handler returns a result object to the dispatcher** (never throws) -- WorkerJob tracks processing, ScrapeRun tracks actual outcome.
20. **The inline `stripHtmlTags`, `validateJobRecord`, and `buildJobRecord` in scrape.ts** are the targets for extraction into dedicated modules.

### Anti-Patterns to AVOID

- Do NOT call API routes from the worker -- access Prisma directly.
- Do NOT use `any` type -- all extracted data, field mappings, and job records must be properly typed.
- Do NOT modify the Prisma schema -- all models are sufficient as-is.
- Do NOT modify existing analysis code or worker infrastructure beyond the scrape handler refactor.
- Do NOT modify `worker/jobDispatcher.ts` -- it is already correctly wired from story 4-2.
- Do NOT add new npm dependencies -- string manipulation is sufficient.
- Do NOT discard invalid records -- all records (valid and invalid) must be stored (FR28).
- Do NOT break the existing Prisma transaction for atomic writes (NFR11).
- Do NOT change the ScrapeRun update logic for empty results -- keep failureCategory "empty_results" behavior.
- Do NOT add HTML sanitization libraries -- a simple regex-based tag stripper is sufficient for normalization.
- Do NOT modify `worker/lib/playwright.ts` or `worker/lib/confidence.ts` -- they are unrelated to this story.

### Project Structure (Files to Create/Modify)

```
worker/
  lib/
    normalizer.ts           # NEW -- data normalization module
    validator.ts            # NEW -- job record validation module
  jobs/
    scrape.ts               # MODIFY -- refactor to use normalizer + validator

src/
  app/
    api/
      jobs/
        route.ts            # MODIFY -- add validationStatus filter
  lib/
    validators.ts           # MODIFY -- add jobsFilterSchema
```

### Verification Checklist

Before marking this story as done:
1. `pnpm build` passes without TypeScript or build errors
2. `pnpm lint` passes without warnings or errors
3. `worker/lib/normalizer.ts` exists with `normalizeJobRecord()` function
4. `worker/lib/validator.ts` exists with `validateJobRecord()` function
5. `worker/jobs/scrape.ts` imports and uses normalizer + validator (no inline duplicates)
6. HTML tags are stripped from all normalized text fields
7. Whitespace is collapsed and trimmed in all normalized fields
8. Original rawFields are preserved untouched in rawData
9. Required field validation (title, company, location) produces correct status strings
10. Quality warnings are logged for abnormally long field values
11. All records (valid and invalid) are stored in the database
12. ScrapeRun counts (totalJobs, validJobs, invalidJobs) reflect validator output
13. GET /api/jobs supports ?validationStatus=valid and ?validationStatus=invalid
14. No `any` types in new or modified code
15. Worker continues polling and processing after scrape completion/failure

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3: Data Normalization, Validation & Storage]
- [Source: _bmad-output/planning-artifacts/prd.md#FR26 -- Normalize job data]
- [Source: _bmad-output/planning-artifacts/prd.md#FR27 -- Store normalized + raw data]
- [Source: _bmad-output/planning-artifacts/prd.md#FR28 -- Validate against schema]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR11 -- Data committed before reporting success]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure -- worker/lib/normalizer.ts, worker/lib/validator.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns]
- [Source: _bmad-output/implementation-artifacts/4-2-scrape-execution-and-job-data-extraction.md -- Scrape handler with inline normalization/validation]
- [Source: prisma/schema.prisma -- Job, ScrapeRun models]
- [Source: worker/jobs/scrape.ts -- Current inline stripHtmlTags, validateJobRecord, buildJobRecord]
- [Source: worker/analysis/combineResults.ts -- CombinedAnalysisResult fieldMappings format]
- [Source: src/app/api/jobs/route.ts -- Existing jobs list endpoint]
- [Source: src/lib/validators.ts -- Existing Zod schemas]

## Dev Agent Record

### Agent Model Used
claude-opus-4-6

### Debug Log References
- pnpm build: passed without errors
- pnpm lint: passed without warnings or errors

### Completion Notes List
- Created `worker/lib/normalizer.ts` with `NormalizedJobRecord` interface, `stripHtmlTags`, `normalizeWhitespace`, `normalizeField`, and `normalizeJobRecord` functions
- Created `worker/lib/validator.ts` with `ValidationResult` interface and `validateJobRecord` function with required field checks and quality warnings
- Refactored `worker/jobs/scrape.ts`: removed inline `stripHtmlTags`, `validateJobRecord`, `buildJobRecord`, and `RawJobRecord`; extraction functions now return raw `Record<string, string>[]`; normalization and validation happen in `executeScrape` using the dedicated modules
- Created `GET /api/jobs/route.ts` with siteId, scrapeRunId, validationStatus filters and pagination
- Added `jobsFilterSchema` to `src/lib/validators.ts` with optional validationStatus enum (valid/invalid)
- No `any` types used in any new or modified code
- No new npm dependencies added
- Prisma schema unchanged
- Atomic transaction preserved (NFR11)
- Empty results handling preserved (failureCategory "empty_results")

### File List
- `worker/lib/normalizer.ts` (NEW)
- `worker/lib/validator.ts` (NEW)
- `worker/jobs/scrape.ts` (MODIFIED)
- `src/app/api/jobs/route.ts` (NEW)
- `src/lib/validators.ts` (MODIFIED)
