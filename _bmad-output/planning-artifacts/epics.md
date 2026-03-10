---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
---

# scrapnew - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for scrapnew, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Site Management**
- FR1: Admin can submit a site URL for AI analysis
- FR2: Admin can view a list of all sites with their current status (analyzing, review, active, failed, skipped)
- FR3: Admin can filter and sort the site list by status, confidence score, and date added
- FR4: Admin can mark a site as "skipped" to defer it from the active pipeline
- FR5: Admin can re-enable a skipped or failed site for AI re-analysis
- FR6: Admin can delete a site from the platform entirely

**AI Analysis Pipeline**
- FR7: System can automatically analyze a submitted site URL using pattern matching
- FR8: System can automatically analyze a submitted site URL using crawl/classify method
- FR9: System can automatically analyze a submitted site URL using network interception
- FR10: System can combine results from all three analysis methods into a unified field mapping with per-field confidence scores
- FR11: System can produce an overall confidence score for a site's field mapping
- FR12: System can route sites above the confidence threshold to the admin review queue
- FR13: System can store corrections as structured training data for future AI improvement

**Review Queue**
- FR14: Admin can view a queue of sites that have completed AI analysis and are ready for review
- FR15: Admin can prioritize the review queue by confidence score or submission date
- FR16: Admin can access a site's AI-generated field mapping from the review queue

**Chrome Extension — Field Mapping Correction**
- FR17: Admin can view AI-detected field mappings overlaid on the live target site (Review Mode)
- FR18: Admin can confirm, reject, or remap individual field mappings on the live page
- FR19: Admin can add new field mappings that the AI missed
- FR20: Admin can record the listing → detail → apply page navigation flow (Navigate Mode)
- FR21: Admin can capture form field mappings during interaction with the target site (Form Record Mode)
- FR22: Admin can save a completed site configuration to the platform backend
- FR23: Extension can authenticate to the backend API using a stored token

**Scraping & Data Collection**
- FR24: Admin can trigger an on-demand test scrape for a configured site
- FR25: System can execute a scrape using the saved site configuration and produce job records
- FR26: System can normalize scraped job data into the standard schema (title, company, location, salary, description, and additional fields)
- FR27: System can store both normalized and raw scraped data per job record
- FR28: System can validate scraped records against the job schema and flag records with missing required fields

**Data Review & Quality**
- FR29: Admin can view scraped job listings per site in the dashboard
- FR30: Admin can filter and browse job records to spot-check data quality
- FR31: Admin can identify which site a job record came from

**Dashboard & Operations**
- FR32: Admin can view a system status overview showing scrape success/failure counts
- FR33: Admin can view categorized failure alerts (timeouts, structure changes, empty results)
- FR34: Admin can trigger a re-scrape for failed sites directly from the dashboard
- FR35: Admin can receive real-time status updates for active AI analysis and scrape operations

**Configuration & Data Model**
- FR36: System can store site configurations as structured JSON (selectors, page flow, field mappings)
- FR37: System can store the full job schema with core fields (title, company, location), application fields, and meta fields
- FR38: System can maintain a site status lifecycle with timestamps for each state transition

### NonFunctional Requirements

**Performance**
- NFR1: AI analysis pipeline (all 3 methods) completes within 5 minutes per site
- NFR2: On-demand test scrape for a single site returns results within 2 minutes
- NFR3: Dashboard pages load and respond to interactions within 1 second
- NFR4: Status changes propagate to dashboard within 3 seconds via SSE

**Scalability**
- NFR5: MVP handles up to 100 configured sites with on-demand scraping without degradation
- NFR6: Phase 2 handles 500+ sites with automated daily scheduling
- NFR7: Phase 3 handles 5000+ sites via distributed worker pool
- NFR8: Job records storage scales to millions of records without query degradation on per-site views

**Reliability**
- NFR9: Individual site scrape failures do not affect other sites — failures are isolated and reported
- NFR10: If one analysis method fails, remaining methods still produce partial results
- NFR11: Completed scrape results are committed to storage before reporting success
- NFR12: Backend recovers gracefully from crashes — in-progress scrapes are marked as failed, not silently lost

### Additional Requirements

**From Architecture:**
- Starter Template: shadcn CLI v4 + Prisma 7.4.x — project scaffolding must be Epic 1 Story 1
- Worker Process: Separate Node.js background worker polling PostgreSQL `jobs` table for pending tasks
- Chrome Extension Framework: WXT (Vite-based, TypeScript-first, Manifest V3)
- Real-time: SSE for server-to-client status updates; TanStack Query cache invalidation on SSE events
- Auth: Bearer token from .env; httpOnly cookie for dashboard; token in `chrome.storage.local` for extension
- Data Fetching: TanStack Query for all client-side server state
- Validation: Zod schemas for all API input validation
- API Response Format: `{ data, meta }` wrapper for all endpoints; structured `{ error }` responses
- Database: PostgreSQL with Prisma ORM; site configs as Json fields; normalized + raw job data
- Project Structure: Two projects — Next.js app (dashboard + API + worker) and Chrome extension (separate repo)
- Shared Code: Prisma client singleton, shared types, constants, and validators in `src/lib/`
- Services Layer: Business logic in `src/services/`, not in API route handlers

**From UX:**
- Dark mode default with traffic light color system for status indicators
- Compact icon sidebar (56px) with 5 navigation items: Home, Sites, Review Queue, Jobs, Status
- Tab-based status filtering within table views (All | Active | Review | Failed | Analyzing | Skipped)
- Desktop-only — minimum 1280px viewport, no responsive/mobile design
- Custom components to build: ConfidenceBar, StatusBadge, StatusPill, FieldHighlight, FieldMappingPanel, NeedsAttentionTable
- Extension layout: Right-docked panel (320px), field highlights as colored overlays on target page DOM
- Auto-cascade behavior: Save Config automatically triggers test scrape
- Zero-confirmation actions for non-destructive operations (Skip, Retry, Re-analyze)
- Empty states with contextual messages and actions for all views

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 1 | Submit site URL for analysis |
| FR2 | Epic 1 | View site list with status |
| FR3 | Epic 1 | Filter/sort site list |
| FR4 | Epic 1 | Mark site as skipped |
| FR5 | Epic 1 | Re-enable skipped/failed site |
| FR6 | Epic 1 | Delete site |
| FR7 | Epic 2 | Pattern matching analysis |
| FR8 | Epic 2 | Crawl/classify analysis |
| FR9 | Epic 2 | Network interception analysis |
| FR10 | Epic 2 | Combine results into unified mapping |
| FR11 | Epic 2 | Overall confidence score |
| FR12 | Epic 2 | Route to review queue by confidence |
| FR13 | Epic 2 | Store corrections as training data |
| FR14 | Epic 3 | View review queue |
| FR15 | Epic 3 | Prioritize review queue |
| FR16 | Epic 3 | Access field mapping from queue |
| FR17 | Epic 3 | View field mappings in extension (Review Mode) |
| FR18 | Epic 3 | Confirm/reject/remap fields |
| FR19 | Epic 3 | Add missing field mappings |
| FR20 | Epic 3 | Navigate Mode (page flow recording) |
| FR21 | Epic 3 | Form Record Mode |
| FR22 | Epic 3 | Save config to backend |
| FR23 | Epic 3 | Extension API authentication |
| FR24 | Epic 4 | Trigger on-demand test scrape |
| FR25 | Epic 4 | Execute scrape with config |
| FR26 | Epic 4 | Normalize job data |
| FR27 | Epic 4 | Store normalized + raw data |
| FR28 | Epic 4 | Validate against schema |
| FR29 | Epic 5 | View jobs per site |
| FR30 | Epic 5 | Filter/browse job records |
| FR31 | Epic 5 | Identify job source site |
| FR32 | Epic 5 | System status overview |
| FR33 | Epic 5 | Categorized failure alerts |
| FR34 | Epic 5 | Re-scrape from dashboard |
| FR35 | Epic 5 | Real-time status updates |
| FR36 | Epic 1 | Site config storage (JSON) |
| FR37 | Epic 1 | Job schema definition |
| FR38 | Epic 1 | Site status lifecycle |

## Epic List

### Epic 1: Project Foundation & Site Management
Admin can add sites, view and filter the site list, and manage the site lifecycle (skip, re-enable, delete). Establishes the platform with dashboard shell, database, auth, and site CRUD.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR36, FR37, FR38

### Epic 2: AI Site Analysis Pipeline
When admin submits a URL, the system automatically analyzes the site structure using three methods, produces field mappings with per-field confidence scores, and routes sites above the confidence threshold to the review queue.
**FRs covered:** FR7, FR8, FR9, FR10, FR11, FR12, FR13

### Epic 3: Review Queue & Chrome Extension
Admin can view sites pending review in a prioritized queue, open them in the Chrome extension, see AI-detected field mappings overlaid on live pages, correct/add mappings across three modes (Review, Navigate, Form Record), and save completed configurations.
**FRs covered:** FR14, FR15, FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23

### Epic 4: Scraping Engine & Data Collection
Admin can trigger on-demand test scrapes for configured sites. The system executes scrapes, normalizes job data into the standard schema, validates records, and stores both normalized and raw data.
**FRs covered:** FR24, FR25, FR26, FR27, FR28

### Epic 5: Data Review & Operations Dashboard
Admin can view scraped jobs per site for quality spot-checks, monitor system health with categorized failure alerts, trigger re-scrapes from the dashboard, and receive real-time status updates across all operations.
**FRs covered:** FR29, FR30, FR31, FR32, FR33, FR34, FR35

## Epic 1: Project Foundation & Site Management

Admin can add sites, view and filter the site list, and manage the site lifecycle (skip, re-enable, delete). Establishes the platform with dashboard shell, database, auth, and site CRUD.

### Story 1.1: Project Scaffolding & Dashboard Shell

As an admin,
I want the platform initialized with a working dashboard and database,
So that I have a foundation to manage my scraping pipeline.

**Acceptance Criteria:**

**Given** the project is not yet created
**When** the scaffolding is completed
**Then** a Next.js app is initialized with shadcn CLI v4 (dark mode), Prisma with PostgreSQL, and all core database models (Site, Job, ScrapeRun, AnalysisResult) are created with proper migrations
**And** the Prisma schema includes Site model with fields: id, siteUrl, status (enum: ANALYZING, REVIEW, ACTIVE, FAILED, SKIPPED), confidenceScore, fieldMappings (Json), createdAt, updatedAt, and status transition timestamps
**And** the Prisma schema includes Job model with normalized fields (title, company, location, salary, description) plus rawData (Json) and a relation to Site
**And** the Prisma schema includes ScrapeRun model tracking scrape executions per site with status, jobCount, error details, and timestamps
**And** the Prisma schema includes AnalysisResult model storing AI analysis output per site with confidence scores and field mappings

**Given** the app is running
**When** I open the dashboard in a browser
**Then** I see a dark-mode layout with a compact icon sidebar (56px) containing navigation icons for Home, Sites, Review Queue, Jobs, and Status
**And** the top bar (48px) displays the project name
**And** the main content area is fluid width with a max of 1400px

**Given** the app is running
**When** an API request is made to any `/api/*` route without a valid Bearer token
**Then** the request is rejected with a 401 Unauthorized structured error response `{ error: { code, message } }`

**Given** the app is running
**When** an API request includes a valid Bearer token matching the `.env` configured token
**Then** the request is authorized and proceeds normally

**Given** the project is set up
**When** I inspect the codebase
**Then** shared utilities exist in `src/lib/` (prisma.ts, types.ts, constants.ts, validators.ts, errors.ts, config.ts)
**And** shared custom components StatusBadge and ConfidenceBar exist in `src/components/shared/`
**And** TanStack Query provider is configured in the root layout
**And** Zod is installed for API input validation
**And** the API response format uses `{ data }` for single items and `{ data, meta }` for lists

### Story 1.2: Submit New Site

As an admin,
I want to submit a site URL through the dashboard,
So that I can start the onboarding process for a new job site.

**Acceptance Criteria:**

**Given** I am on the Sites page
**When** I paste a valid URL into the Add Site input and press Enter or click Submit
**Then** a new site record is created with status ANALYZING, the input clears, and I see a toast notification "Site submitted. Analyzing..."
**And** the API returns a `{ data }` response with the site record including id, siteUrl, status, and createdAt

**Given** I am on the Sites page
**When** I submit a URL with an invalid format (not a valid URL)
**Then** I see an inline validation error below the input in red text and no site record is created

**Given** a site with URL "https://example.co.il/jobs" already exists
**When** I submit the same URL
**Then** I see an error toast indicating the site already exists and no duplicate record is created

**Given** I submit a valid URL
**When** the site is created successfully
**Then** the site appears in the Sites table with status ANALYZING (blue StatusBadge) and the site status lifecycle timestamp for ANALYZING is recorded
**And** the site configuration is stored as structured JSON (FR36)
**And** the site status lifecycle maintains timestamps for each state transition (FR38)

### Story 1.3: View & Filter Site List

As an admin,
I want to view all my sites and filter them by status,
So that I can efficiently manage my scraping pipeline.

**Acceptance Criteria:**

**Given** sites exist in the database with various statuses
**When** I navigate to the Sites page
**Then** I see a data table (SitesTable) with columns: URL (monospace, flexible width), Status (StatusBadge), Confidence (ConfidenceBar), Date Added, and Actions
**And** rows have 40px height with hover background change
**And** the default sort is most recent first

**Given** sites exist with different statuses
**When** I click a status tab (All | Analyzing | Review | Active | Failed | Skipped)
**Then** the table filters to show only sites matching that status
**And** each tab displays a count badge showing the number of sites in that status

**Given** multiple sites exist
**When** I click a sortable column header (Confidence, Date Added)
**Then** the table sorts by that column and shows an arrow indicator for sort direction

**Given** more than 50 sites exist in the selected filter
**When** I view the table
**Then** pagination shows "Showing 1-50 of N" with Previous/Next controls

**Given** no sites exist in the database
**When** I navigate to the Sites page
**Then** I see an empty state message: "No sites yet. Paste a URL above to add your first site." in muted text, centered

**Given** sites exist but none match the selected status filter tab
**When** I click a status tab with zero count
**Then** I see an appropriate empty state for that filter (e.g., "No failures. All sites are healthy." for the Failed tab)

### Story 1.4: Manage Site Lifecycle

As an admin,
I want to skip, re-enable, and delete sites,
So that I can control which sites are in my active pipeline.

**Acceptance Criteria:**

**Given** a site with status ACTIVE, REVIEW, or FAILED is visible in the Sites table
**When** I click the "Skip" action button in the table row
**Then** the site status changes to SKIPPED immediately without a confirmation dialog
**And** the StatusBadge updates to grey "Skipped"
**And** the status transition timestamp is recorded

**Given** a site with status SKIPPED or FAILED is visible in the Sites table
**When** I click the "Re-analyze" action button
**Then** the site status changes to ANALYZING
**And** I see a toast confirmation "Re-analysis triggered for [site URL]"
**And** the status transition timestamp is recorded

**Given** any site is visible in the Sites table
**When** I click "Delete" from the overflow menu ("..." dropdown)
**Then** a confirmation dialog appears: "Delete this site? This cannot be undone." with Cancel and Delete buttons
**And** the Delete button is styled as destructive (red)

**Given** the delete confirmation dialog is shown
**When** I click "Delete" to confirm
**Then** the site and all associated data (analysis results, scrape runs, jobs) are permanently removed
**And** the table updates to reflect the deletion
**And** I see a toast confirmation "Site deleted"

**Given** the delete confirmation dialog is shown
**When** I click "Cancel"
**Then** the dialog closes and no changes are made

**Given** I perform any status change action
**When** the action completes
**Then** the site's status lifecycle timestamps are updated in the database (FR38)
**And** the site service layer enforces valid status transitions (e.g., cannot transition from SKIPPED directly to ACTIVE)

## Epic 2: AI Site Analysis Pipeline

When admin submits a URL, the system automatically analyzes the site structure using three methods, produces field mappings with per-field confidence scores, and routes sites above the confidence threshold to the review queue.

### Story 2.1: Worker Process & Job Queue Infrastructure

As an admin,
I want submitted sites to be automatically picked up for background processing,
So that AI analysis runs without blocking the dashboard or requiring manual triggers.

**Acceptance Criteria:**

**Given** the worker process is started
**When** a site is created with status ANALYZING (via POST /api/sites)
**Then** a corresponding job record is inserted into the jobs table with status PENDING and type ANALYSIS

**Given** the worker is running and polling the jobs table
**When** a PENDING analysis job exists
**Then** the worker picks it up within 5 seconds, sets status to IN_PROGRESS, and begins execution
**And** only one job is processed at a time per worker instance

**Given** a job is IN_PROGRESS
**When** it completes successfully
**Then** the job status is set to COMPLETED with a completedAt timestamp

**Given** a job is IN_PROGRESS
**When** it fails with an error
**Then** the job status is set to FAILED with the error message stored in the job record
**And** the site status is updated to FAILED
**And** the error is logged with `[worker]` prefix and structured data

**Given** the worker process crashes or restarts
**When** it starts up again
**Then** any jobs left in IN_PROGRESS status are marked as FAILED with error "Worker interrupted"
**And** the poll loop resumes normally (NFR12)

**Given** a Playwright browser instance is launched for a job
**When** the job completes (success or failure)
**Then** the browser instance is fully closed and resources are cleaned up

**Given** the worker directory structure
**When** I inspect the codebase
**Then** the worker entry point is at `worker/index.ts` with job handlers in `worker/jobs/` and shared Playwright utilities in `worker/lib/playwright.ts`

### Story 2.2: Pattern Matching Analysis Method

As an admin,
I want the system to analyze a site's HTML structure to detect job listing patterns,
So that field mappings can be automatically generated from common page structures.

**Acceptance Criteria:**

**Given** a site URL has been submitted and the analysis job is picked up by the worker
**When** the pattern matching method runs
**Then** Playwright navigates to the site URL in a headless browser and captures the rendered HTML

**Given** the rendered HTML is captured
**When** pattern matching analysis executes
**Then** the system identifies repeating DOM structures that likely represent job listings (e.g., repeated cards, list items, table rows with similar structure)
**And** for each detected field (title, company, location, salary, description), the system records the CSS selector and a per-field confidence score

**Given** the pattern matching analysis completes
**When** results are produced
**Then** an AnalysisResult record is created with method "PATTERN_MATCH", the detected field mappings, per-field confidence scores, and the overall method confidence
**And** the analysis result is stored in the database linked to the site

**Given** the target site fails to load or times out
**When** pattern matching analysis runs
**Then** the method returns a partial result with zero confidence rather than failing the entire analysis pipeline (NFR10)

**Given** the analysis method is implemented
**When** I inspect the codebase
**Then** the pattern matching logic is in `worker/analysis/patternMatch.ts`

### Story 2.3: Crawl/Classify Analysis Method

As an admin,
I want the system to crawl and classify page content to identify job listings,
So that sites with non-standard layouts can still be analyzed for field mappings.

**Acceptance Criteria:**

**Given** a site URL has been submitted and the analysis job is running
**When** the crawl/classify method runs
**Then** Playwright navigates the site, identifies the jobs listing page, and classifies content blocks by their semantic role (job title, company name, location, etc.)

**Given** the crawl/classify analysis executes
**When** content classification completes
**Then** the system produces field mappings with CSS selectors and per-field confidence scores based on content classification heuristics (text patterns, element positioning, label proximity)

**Given** the crawl/classify analysis completes
**When** results are produced
**Then** an AnalysisResult record is created with method "CRAWL_CLASSIFY", the detected field mappings, per-field confidence scores, and the overall method confidence

**Given** the target site has dynamic content loaded via JavaScript
**When** crawl/classify analysis runs
**Then** Playwright waits for dynamic content to render before classifying (using networkidle or DOM stability checks)

**Given** the target site fails to load or the crawler encounters an error
**When** crawl/classify analysis runs
**Then** the method returns a partial result with zero confidence rather than failing the entire pipeline (NFR10)

**Given** the analysis method is implemented
**When** I inspect the codebase
**Then** the crawl/classify logic is in `worker/analysis/crawlClassify.ts`

### Story 2.4: Network Interception Analysis Method

As an admin,
I want the system to intercept network requests to discover API endpoints or data sources containing job data,
So that sites using AJAX/API-driven content can be analyzed for field mappings.

**Acceptance Criteria:**

**Given** a site URL has been submitted and the analysis job is running
**When** the network interception method runs
**Then** Playwright navigates to the site with network request interception enabled, capturing all XHR/fetch requests and their responses

**Given** network requests are captured
**When** the interception analysis executes
**Then** the system identifies JSON or structured data responses that contain job-like data (arrays of objects with title/company/location fields)
**And** maps discovered API fields to the standard job schema fields with per-field confidence scores

**Given** the network interception analysis completes
**When** results are produced
**Then** an AnalysisResult record is created with method "NETWORK_INTERCEPT", the discovered API endpoint URL, response field mappings, per-field confidence scores, and the overall method confidence

**Given** no API endpoints with job data are discovered
**When** network interception analysis completes
**Then** the method returns a result with zero confidence and empty field mappings rather than failing (NFR10)

**Given** the analysis method is implemented
**When** I inspect the codebase
**Then** the network interception logic is in `worker/analysis/networkIntercept.ts`

### Story 2.5: Combined Results & Confidence Scoring

As an admin,
I want the system to combine all analysis results into a single unified field mapping with an overall confidence score,
So that sites are automatically routed to the review queue when confidence is high enough.

**Acceptance Criteria:**

**Given** all three analysis methods have completed for a site (including partial/zero results from failed methods)
**When** the combination step runs
**Then** the system merges field mappings from all three methods, selecting the highest-confidence mapping for each field, and produces a unified field mapping with per-field confidence scores (FR10)

**Given** the unified field mapping is produced
**When** the overall confidence score is calculated
**Then** the score is a weighted average of per-field confidence scores for core fields (title, company, location) and the result is stored on the Site record (FR11)

**Given** the overall confidence score is calculated
**When** the score is >= 70%
**Then** the site status is automatically updated from ANALYZING to REVIEW and the site appears in the review queue (FR12)

**Given** the overall confidence score is calculated
**When** the score is < 70%
**Then** the site status remains as a low-confidence variant visible in the Sites table but NOT in the review queue

**Given** analysis is complete and results are stored
**When** the admin later makes corrections via the Chrome extension
**Then** the original AI mappings and the corrections are stored as structured training data for future AI improvement (FR13)

**Given** the entire analysis pipeline runs for a site
**When** all steps complete
**Then** the total pipeline time is within 5 minutes per site (NFR1)
**And** the analysis results are committed to the database before reporting success

**Given** the combination logic is implemented
**When** I inspect the codebase
**Then** the combination and scoring logic is in `worker/analysis/combineResults.ts` and the confidence scoring logic is in `worker/lib/confidence.ts`

## Epic 3: Review Queue & Chrome Extension

Admin can view sites pending review in a prioritized queue, open them in the Chrome extension, see AI-detected field mappings overlaid on live pages, correct/add mappings across three modes (Review, Navigate, Form Record), and save completed configurations.

### Story 3.1: Review Queue Dashboard View

As an admin,
I want to view a prioritized queue of sites ready for review,
So that I can efficiently work through analyzed sites and correct their field mappings.

**Acceptance Criteria:**

**Given** sites exist with status REVIEW (confidence >= 70%)
**When** I navigate to the Review Queue page via the sidebar
**Then** I see a data table (ReviewQueueTable) showing only sites with REVIEW status, with columns: URL (monospace), Confidence (ConfidenceBar), Date Analyzed, and Actions
**And** the default sort is by confidence score descending (highest confidence first)

**Given** the Review Queue has sites
**When** I click the "Confidence" or "Date Analyzed" column header
**Then** the table re-sorts by that column with an arrow indicator (FR15)

**Given** a site is listed in the review queue
**When** I click the "Review" action button on a table row
**Then** a new browser tab opens with the target site URL
**And** the site's AI-generated field mapping data is accessible via GET /api/sites/[id]/config (FR16)

**Given** no sites have REVIEW status
**When** I navigate to the Review Queue page
**Then** I see an empty state: "No sites pending review. Add more sites or wait for AI analysis to complete." with a link to the Sites view

**Given** the review queue API endpoint exists
**When** I request GET /api/sites with status filter REVIEW
**Then** the response returns sites in `{ data, meta }` format with only REVIEW status sites included

### Story 3.2: Chrome Extension Scaffolding & Authentication

As an admin,
I want the Chrome extension installed and authenticated to my backend,
So that I can use it to review and correct field mappings on target sites.

**Acceptance Criteria:**

**Given** the extension project is not yet created
**When** the scaffolding is completed
**Then** a WXT-based Chrome extension project exists with React, Tailwind CSS (matching dashboard config), TypeScript, and Manifest V3
**And** the project structure includes entrypoints (background.ts, content.ts, sidepanel/, options/), content scripts, and shared lib/

**Given** the extension is installed in Chrome
**When** I open the extension options page
**Then** I see a token configuration input where I can paste my API Bearer token
**And** the token is stored in `chrome.storage.local` (FR23)

**Given** a valid token is configured
**When** the extension makes API calls to the backend
**Then** all requests include the `Authorization: Bearer <token>` header
**And** the backend accepts the requests (CORS configured for the extension origin)

**Given** no token is configured or the token is invalid
**When** the extension attempts an API call
**Then** the extension shows a clear error message directing the admin to configure the token in settings

**Given** the extension is installed and a valid token is configured
**When** I navigate to a site that exists in the scrapnew system with REVIEW status
**Then** the extension auto-activates and shows an indicator that the site is recognized

**Given** the extension project structure
**When** I inspect the codebase
**Then** the API client is in `src/lib/api.ts`, auth handling in `src/lib/auth.ts`, and shared types/constants are in `src/lib/`

### Story 3.3: Review Mode — Field Mapping Overlay & Correction

As an admin,
I want to see AI-detected field mappings overlaid on the live target site and correct any errors,
So that I can quickly verify and fix the AI's analysis in under 3 minutes per site.

**Acceptance Criteria:**

**Given** I open a target site that has REVIEW status and the extension is active
**When** the extension loads in Review Mode
**Then** the side panel (320px) slides in from the right showing the FieldMappingPanel with: site URL, overall confidence score, mode tabs (Review/Navigate/Form Record), a list of detected fields with per-field confidence, and action buttons
**And** colored overlay highlights (FieldHighlight) appear on the detected page elements — green solid border for high confidence fields, amber dashed border for low confidence fields

**Given** field highlights are visible on the page
**When** I hover over a highlighted element
**Then** the border thickens and a label shows the field name and confidence percentage

**Given** a field mapping is correct
**When** I click the checkmark/confirm action for that field in the side panel
**Then** the highlight turns solid green with a checkmark label and the field is marked as confirmed
**And** the progress indicator updates (e.g., "3/7 fields verified")

**Given** a field mapping is incorrect
**When** I click the field in the side panel or click the highlight on the page
**Then** the highlight enters edit mode (blue thick border) and the cursor changes to a crosshair/picker on the page
**And** I can click the correct element on the page to remap the field (FR18)

**Given** I click a new element during edit/picker mode
**When** the element is selected
**Then** the field mapping updates to point to the newly selected element with its CSS selector
**And** the highlight moves to the correct element
**And** the side panel updates with the new mapping

**Given** the AI missed a field that exists on the page
**When** I click "Add Field" in the side panel
**Then** the extension enters picker mode — I click an element on the page and then select the field type from a dropdown (title, company, location, salary, description, etc.) (FR19)
**And** the new field appears in the side panel list and a highlight appears on the page

**Given** a field mapping exists but is a false positive
**When** I click "Remove" on that field in the side panel
**Then** the field is removed from the mapping list and the highlight is removed from the page

**Given** I am reviewing fields
**When** I look at the side panel
**Then** each FieldRow shows a status dot (green/amber/red), field name, confidence percentage, and action icons (edit, remove) on hover

### Story 3.4: Navigate Mode — Page Flow Recording

As an admin,
I want to record the page navigation flow from listing page to detail page to apply page,
So that the scraper knows how to navigate multi-page job sites.

**Acceptance Criteria:**

**Given** I am in the extension on a target site
**When** I click the "Navigate" mode tab in the side panel
**Then** the extension switches to Navigate Mode and displays instructions: "Click a job link to record the listing → detail page flow"

**Given** Navigate Mode is active
**When** I click a job listing link on the page
**Then** the browser navigates to the detail page and the extension records the URL pattern for the detail page
**And** the side panel shows: "Listing page: [URL pattern] → Detail page: [URL pattern]"

**Given** the detail page is recorded
**When** I click an "Apply" or external link on the detail page (if exists)
**Then** the extension records the apply page URL pattern as the third step in the navigation flow
**And** the side panel shows the complete flow: Listing → Detail → Apply (FR20)

**Given** the navigation flow is recorded
**When** I switch back to Review Mode
**Then** the recorded page flow is preserved and included in the site configuration

**Given** the navigation flow has been recorded incorrectly
**When** I click "Reset Navigation" in Navigate Mode
**Then** the recorded flow is cleared and I can start recording again

### Story 3.5: Form Record Mode & Config Save

As an admin,
I want to capture form field mappings and save the complete site configuration,
So that the scraper has everything it needs to extract job data from this site.

**Acceptance Criteria:**

**Given** I am in the extension on a target site
**When** I click the "Form Record" mode tab in the side panel
**Then** the extension switches to Form Record Mode and displays instructions for interacting with form fields on the page

**Given** Form Record Mode is active
**When** I interact with form fields on the target site (click inputs, select dropdowns, check boxes)
**Then** the extension captures each form field's selector, type, and label
**And** the captured fields appear in the side panel list (FR21)

**Given** I have completed field mapping corrections, navigation recording, and/or form recording
**When** I click "Save Config" in the side panel
**Then** the complete site configuration (field mappings, page flow, form fields) is sent to the backend via PUT /api/sites/[id]/config (FR22)
**And** I see a toast: "Config saved. Test scrape starting..."
**And** a test scrape is automatically triggered (auto-cascade behavior)

**Given** the config save succeeds
**When** the test scrape is triggered
**Then** a POST /api/sites/[id]/scrape request is sent automatically
**And** the site status transitions from REVIEW to ACTIVE (pending scrape validation)

**Given** the config save fails (network error, validation error)
**When** I click "Save Config"
**Then** I see an error toast with the specific failure reason and the config is not lost — I can retry saving

**Given** I have made corrections to the AI's original mappings
**When** the config is saved
**Then** both the original AI mappings and the admin's corrections are stored as structured training data for future AI improvement (FR13)

## Epic 4: Scraping Engine & Data Collection

Admin can trigger on-demand test scrapes for configured sites. The system executes scrapes, normalizes job data into the standard schema, validates records, and stores both normalized and raw data.

### Story 4.1: Trigger On-Demand Test Scrape

As an admin,
I want to trigger a test scrape for a configured site,
So that I can validate the site configuration produces correct job data before relying on it.

**Acceptance Criteria:**

**Given** a site has status ACTIVE or REVIEW and has a saved configuration
**When** I click "Scrape" action on the site row in the Sites table
**Then** a scrape job is created in the jobs table with type SCRAPE and status PENDING
**And** a ScrapeRun record is created linked to the site with status IN_PROGRESS
**And** I see a toast: "Test scrape started for [site URL]"

**Given** the config save in the Chrome extension auto-triggers a scrape
**When** the POST /api/sites/[id]/scrape endpoint is called
**Then** the same scrape job creation flow executes as a manual trigger
**And** the API returns `{ data }` with the ScrapeRun record including id, siteId, status, and createdAt

**Given** a scrape is already in progress for a site
**When** I attempt to trigger another scrape for the same site
**Then** the API returns an error: "A scrape is already in progress for this site"
**And** no duplicate scrape job is created

**Given** a site has no saved configuration (no field mappings)
**When** I attempt to trigger a scrape
**Then** the API returns a validation error: "Site has no configuration. Complete the review first."

### Story 4.2: Scrape Execution & Job Data Extraction

As an admin,
I want the system to execute scrapes using my saved site configurations,
So that job listings are automatically extracted from target sites.

**Acceptance Criteria:**

**Given** a PENDING scrape job exists in the jobs table
**When** the worker picks it up
**Then** the worker loads the site's saved configuration (field mappings, page flow, selectors) and launches a Playwright browser instance

**Given** the site configuration includes a page navigation flow (listing → detail)
**When** the scrape executes
**Then** Playwright navigates to the listing page, identifies all job entries using configured selectors, and follows each job link to the detail page to extract full job data

**Given** the site configuration is a single-page listing (no navigation flow)
**When** the scrape executes
**Then** Playwright extracts all job records directly from the listing page using configured selectors

**Given** the scrape is executing
**When** data is extracted from each job listing
**Then** the raw HTML/text content for each configured field is captured per job record
**And** the raw data is preserved exactly as extracted before any normalization

**Given** the scrape completes successfully
**When** job records have been extracted
**Then** the ScrapeRun record is updated with status COMPLETED, jobCount, and completedAt timestamp
**And** all data is committed to the database before reporting success (NFR11)

**Given** the scrape fails (site unreachable, timeout, selector errors)
**When** an error occurs during execution
**Then** the ScrapeRun status is set to FAILED with the error message and failure category (timeout, structure_changed, empty_results, other)
**And** the site status is updated to FAILED
**And** the failure does not affect other sites or scrape jobs (NFR9)

**Given** a scrape is running
**When** execution exceeds 2 minutes
**Then** the scrape is terminated with a timeout error (NFR2)
**And** the Playwright browser instance is fully cleaned up

**Given** the scrape handler is implemented
**When** I inspect the codebase
**Then** the scrape execution logic is in `worker/jobs/scrape.ts`

### Story 4.3: Data Normalization, Validation & Storage

As an admin,
I want scraped job data to be normalized and validated,
So that I can trust the data quality and query jobs using a consistent schema.

**Acceptance Criteria:**

**Given** raw job data has been extracted from a scrape
**When** the normalization step runs
**Then** each job record is transformed into the standard schema with fields: title, company, location, salary (if available), description (if available), and any additional mapped fields (FR26)
**And** text fields are trimmed of extra whitespace and HTML tags

**Given** job records are normalized
**When** they are stored in the database
**Then** each Job record contains both the normalized fields (title, company, location, salary, description) and the original rawData as a Json field (FR27)
**And** each Job is linked to the Site and the ScrapeRun that produced it

**Given** a normalized job record is produced
**When** validation runs against the job schema
**Then** required fields (title, company, location) are checked for presence and non-empty values
**And** records with missing required fields are flagged with a validation status indicating which fields are missing (FR28)

**Given** some job records pass validation and some fail
**When** the scrape completes
**Then** all records (valid and invalid) are stored in the database
**And** the ScrapeRun record includes counts: totalJobs, validJobs, invalidJobs
**And** invalid records are queryable separately for quality review

**Given** a scrape produces zero job records
**When** the scrape completes
**Then** the ScrapeRun is marked as COMPLETED with jobCount: 0
**And** the failure category is set to "empty_results" for dashboard alerting

**Given** the normalization and validation logic is implemented
**When** I inspect the codebase
**Then** the normalizer is in `worker/lib/normalizer.ts` and the validator is in `worker/lib/validator.ts`

## Epic 5: Data Review & Operations Dashboard

Admin can view scraped jobs per site for quality spot-checks, monitor system health with categorized failure alerts, trigger re-scrapes from the dashboard, and receive real-time status updates across all operations.

### Story 5.1: Jobs Viewer & Data Quality Review

As an admin,
I want to view scraped job listings per site and spot-check data quality,
So that I can verify the scraped data is correct before scaling to more sites.

**Acceptance Criteria:**

**Given** jobs have been scraped from configured sites
**When** I navigate to the Jobs page via the sidebar
**Then** I see a data table (JobsTable) with columns: Title, Company, Location, Salary, Site (linked), Scraped Date
**And** rows display normalized field values from the job records
**And** the default sort is most recent first

**Given** multiple sites have scraped jobs
**When** I select a site from the SiteFilter dropdown above the table
**Then** the table filters to show only jobs from the selected site (FR29)
**And** the dropdown shows all sites that have at least one scraped job

**Given** jobs are displayed in the table
**When** I browse through the records
**Then** I can visually spot-check whether titles are sensible, companies are real names, locations are parseable cities, and salary is present when expected (FR30)

**Given** a job record is displayed in the table
**When** I look at the Site column
**Then** I can identify which site the job came from via a linked site name/URL (FR31)
**And** clicking the site name navigates to the Sites view with that site selected

**Given** more than 50 jobs exist for the current filter
**When** I view the table
**Then** pagination shows "Showing 1-50 of N" with Previous/Next controls

**Given** no jobs have been scraped yet
**When** I navigate to the Jobs page
**Then** I see an empty state: "No jobs scraped yet. Complete a site review and save config to trigger a test scrape." with a link to the Review Queue

**Given** the Jobs API endpoint exists
**When** I request GET /api/jobs with an optional siteId query parameter
**Then** the response returns jobs in `{ data, meta }` format with pagination metadata

### Story 5.2: System Status Overview & Failure Alerts

As an admin,
I want to see a glanceable dashboard overview with system health and categorized failure alerts,
So that my morning operations check takes under 10 minutes.

**Acceptance Criteria:**

**Given** sites and scrape runs exist in the system
**When** I navigate to the Home/Overview page (default landing page)
**Then** I see a panel grid layout with status summary cards:
- **Scrape Health panel**: Large percentage showing success rate + success/failure count
- **Sites by Status panel**: Counts for Active, Analyzing, Review, Failed, Skipped
- **Review Queue Depth panel**: Number of sites awaiting review
- **Total Jobs panel**: Total job records scraped across all sites

**Given** failed scrape runs exist
**When** I view the Needs Attention panel on the overview
**Then** I see a NeedsAttentionTable (compact, 12px font) showing failed sites with columns: StatusBadge, Site URL, Failure Reason (pre-categorized), and Action button
**And** failures are categorized as: timeout, structure_changed, empty_results (FR33)
**And** max 5 rows are visible with a "View all →" link if more exist

**Given** a failure is categorized as "timeout"
**When** I see the failure row in the NeedsAttentionTable
**Then** the action button shows "Retry" (FR32)

**Given** a failure is categorized as "structure_changed"
**When** I see the failure row
**Then** the action button shows "Fix" (which opens the extension on the site)

**Given** a failure is categorized as "empty_results"
**When** I see the failure row
**Then** the action button shows "Investigate"

**Given** no failures exist
**When** I view the overview
**Then** the Needs Attention panel shows: "No failures. All sites are healthy." as a positive empty state

**Given** the dashboard loads
**When** the page renders
**Then** all panels load and respond within 1 second (NFR3)

### Story 5.3: Re-Scrape from Dashboard & Real-Time Updates

As an admin,
I want to trigger re-scrapes from the dashboard and see live status updates without refreshing,
So that I can triage failures quickly and always see current system state.

**Acceptance Criteria:**

**Given** a failed site is visible in the NeedsAttentionTable or the Sites table
**When** I click the "Retry" action button
**Then** a new scrape job is created for that site and I see a toast: "Re-scrape triggered for [site URL]" (FR34)
**And** the action is zero-confirmation (no dialog)

**Given** a site with "structure_changed" failure is visible
**When** I click the "Fix" action button
**Then** a new tab opens with the target site URL for extension-based correction (same as Review flow)

**Given** the dashboard is open
**When** an SSE connection is established to GET /api/events
**Then** the connection stays open and receives server-sent events for: site:status-changed, analysis:completed, scrape:completed, scrape:failed (FR35)

**Given** an SSE event of type `site:status-changed` is received
**When** the event payload includes a siteId and new status
**Then** TanStack Query invalidates the `['sites']` query cache and the Sites table, Review Queue, and overview panels update automatically without page refresh

**Given** an SSE event of type `scrape:completed` is received
**When** the event payload includes siteId and jobCount
**Then** a toast notification appears: "Scrape complete — [N] jobs scraped" with a link to the Jobs viewer
**And** relevant query caches are invalidated

**Given** an SSE event of type `scrape:failed` is received
**When** the event includes siteId, error message, and failure category
**Then** a persistent error toast appears with the failure details
**And** the NeedsAttentionTable updates to include the new failure

**Given** the top bar is visible
**When** real-time data is available
**Then** StatusPills in the top bar show live counts: "[N] Active", "[N] Review", "[N] Failed"
**And** counts update in real-time as SSE events arrive
**And** the Failed pill shows a subtle pulse animation when a new failure is detected

**Given** the SSE connection drops
**When** the browser detects disconnection
**Then** EventSource auto-reconnects and the dashboard resumes receiving updates

**Given** status changes occur on the backend
**When** the SSE event is emitted
**Then** the event reaches the dashboard within 3 seconds (NFR4)
