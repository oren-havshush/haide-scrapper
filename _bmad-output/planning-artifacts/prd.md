---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain-skipped
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
inputDocuments:
  - '_bmad-output/planning-artifacts/product-brief-scrapnew-2026-03-10.md'
workflowType: 'prd'
documentCounts:
  briefs: 1
  research: 0
  projectDocs: 0
  projectContext: 0
classification:
  projectType: 'multi-surface-platform'
  domain: 'data-infrastructure-web-scraping'
  complexity: 'medium'
  projectContext: 'greenfield'
  priorAttemptLessons: 'Failed prior attempt - no teachability mechanism, poor scrape reliability/performance'
---

# Product Requirements Document - scrapnew

**Author:** Oren
**Date:** 2026-03-10

## Executive Summary

scrapnew is a job scraping infrastructure platform that aggregates and stores job listings from 5000+ Israeli job sites. The end goal is fully automated daily scraping at scale — zero human involvement in steady state. To get there, the platform employs an AI-first site learning pipeline where automated analysis handles the bulk of site structure detection, with a targeted human correction loop (Chrome extension) that trains the system where AI confidence falls short. A single admin operator manages the entire platform through a dedicated dashboard.

The system is informed by a failed prior attempt where full automation proved unreliable and slow, and the admin had no mechanism to teach the platform how to scrape a site correctly. scrapnew solves this by inserting a human correction step at the precise moment it's needed — after AI analysis, before config goes live — with the explicit goal of progressively reducing that human involvement over time.

### What Makes This Special

- **Teaching mechanism as the unlock** — The previous attempt failed because the system couldn't learn from corrections. scrapnew's Chrome extension lets the admin teach the AI where it's wrong, creating a feedback loop that improves accuracy with each site configured.
- **Automation is the destination, not the starting point** — Rather than promising full automation upfront (and failing), the platform starts with AI + human correction, and systematically reduces the human component as the system learns.
- **Scale economics for a solo operator** — AI analysis drops per-site configuration time from 15-20 minutes (manual) to 2-3 minutes (correction only), making 5000+ sites feasible for one person during the ramp-up phase.

### Project Classification

- **Project Type:** Multi-surface platform (Web Admin Dashboard + Backend API/Scraping Engine + Chrome Extension)
- **Domain:** Data Infrastructure / Web Scraping
- **Complexity:** Medium — no regulatory constraints, but technically non-trivial due to AI analysis pipeline, diversity of target sites, and human-in-the-loop correction model
- **Project Context:** Greenfield — new build informed by lessons from a failed prior automation attempt

## Success Criteria

### User Success

- **Site onboarding feels effortless:** Admin submits a URL, AI analysis returns a usable field mapping, and the Chrome extension correction flow takes under 3 minutes per site
- **Dashboard is glanceable:** Daily operational check takes under 10 minutes — alerts surface only when action is needed
- **The system learns:** As more sites are configured and corrected, AI confidence on new sites measurably improves — the admin's correction burden decreases over time
- **Trust in the scrape:** Admin can spot-check scraped jobs in the dashboard and confirm data quality without digging into raw output

### Business Success

| Metric | 3-Month Target | 12-Month Target |
|--------|---------------|-----------------|
| Active sites scraping daily | 500+ | 5000+ |
| Daily scrape success rate | 90%+ | 95%+ |
| Average AI confidence (new sites) | 70%+ | 85%+ (learning effect) |
| Sites needing monthly re-review | <10% | <5% |
| Admin daily operational time | <30 min | <10 min |

### Technical Success

- **Scrape reliability:** 95%+ of configured sites complete daily scrape without errors at steady state
- **Data quality:** Scraped records pass schema validation — required fields present (title, company, location at minimum), correct formats, no garbage data
- **AI analysis pipeline:** Produces field mappings with confidence scores within reasonable time per site
- **Config durability:** Site configs remain valid without re-intervention for 30+ days on average

### Measurable Outcomes

- End-to-end flow works: URL → AI analysis → extension correction → config saved → test scrape → valid jobs in DB
- AI confidence improves with scale: measurable accuracy increase after every 100 sites corrected
- Solo operator can sustain 10+ new site onboardings per day during ramp-up phase

## User Journeys

### Journey 1: Oren Onboards a New Site (Happy Path)

Oren has a list of Israeli job sites he's working through, one by one. He grabs the next URL — a mid-size recruitment agency site — and pastes it into the dashboard's "Add Site" input. He hits submit and moves on to something else.

Minutes later, the AI analysis completes. The dashboard shows a notification: site analyzed, confidence 82%. Oren clicks through to the review queue, opens the Chrome extension on the target site, and sees the AI's field mapping overlaid on the live page — job title, company, location, salary all highlighted. The title and company are correct. Location is mapped to the wrong element. Salary wasn't detected.

Oren clicks the correct location element, remaps it. Adds the salary field manually. Total time: 90 seconds. He saves the config and triggers a test scrape. A few minutes later, 15 job listings appear in the dashboard, properly normalized. Done. Site is live.

**Capabilities revealed:** URL submission, AI analysis with confidence scoring, review queue, Chrome extension overlay/correction, config save, on-demand test scrape, job results viewer.

### Journey 2: Oren Fights a Difficult Site (Edge Case — Low Confidence)

Oren submits a URL for a site with an unusual JavaScript-heavy structure. AI analysis comes back at 45% confidence — well below the 70% threshold. It doesn't appear in the review queue automatically, but Oren can see it in the site list with a "low confidence" status.

He decides to try anyway. Opens the Chrome extension on the site, but the AI's mapping is mostly wrong — half the fields are misidentified. He manually corrects them, saves, and triggers a test scrape. The results come back with missing fields. He tweaks the config, retries. After the third attempt the results still aren't clean.

Oren marks the site as "skipped" and moves on. Maybe he'll revisit it later when the AI is smarter, or maybe this site just isn't worth the effort. Either way, it's not blocking his pipeline.

**Capabilities revealed:** Low-confidence handling, manual override of review threshold, retry workflow, skip/defer site action, site status management.

### Journey 3: Oren's Morning Operations Check

It's 8 AM. Oren opens the dashboard with coffee. The overnight status shows 487 out of 500 sites scraped successfully. 13 failures are flagged — 8 are timeouts (probably transient), 3 show "structure changed" warnings, 2 returned empty results.

He triggers a re-scrape on the 8 timeouts. For the 3 structure-changed sites, he opens each in the Chrome extension to see what shifted — one just moved a div wrapper, easy fix. The other two need more work; he re-enables them for AI re-analysis. The 2 empty results he marks for investigation later.

Total dashboard time: 7 minutes. Back to his day.

**Capabilities revealed:** Dashboard status overview, failure categorization, re-scrape trigger, re-enable for AI re-analysis, site investigation queue, operational alerts.

### Journey 4: Oren Validates Data Quality

Oren has 50 sites running. Before scaling further, he wants to confirm the data is actually good. He opens the dashboard's jobs viewer, picks 5 random sites, and reviews the scraped listings. He checks: Are titles sensible? Are companies real names (not HTML artifacts)? Are locations parseable Israeli cities? Is salary present when the listing shows one?

Three sites look clean. One has company names that include extra text from a nearby element — a mapping issue. He opens the Chrome extension, fixes the selector, and re-scrapes. The fifth site has duplicate listings — the scraper is picking up both the list view and detail view. He notes it needs pagination/dedup logic.

**Capabilities revealed:** Jobs viewer with per-site filtering, data quality spot-check workflow, quick-fix via extension, issue identification and tracking.

### Journey Requirements Summary

| Capability Area | Revealed By Journeys |
|----------------|---------------------|
| URL submission & site management | 1, 2, 3 |
| AI analysis pipeline with confidence scoring | 1, 2 |
| Review queue (filtered by confidence threshold) | 1, 2 |
| Chrome extension (overlay, correction, save) | 1, 2, 4 |
| On-demand test scraping | 1, 2 |
| Jobs viewer with per-site filtering | 1, 4 |
| Dashboard status overview & alerts | 3 |
| Failure categorization & re-scrape trigger | 3 |
| Re-enable site for AI re-analysis | 3 |
| Skip/defer site action | 2 |
| Site status lifecycle (analyzing → review → active → failed → skipped) | 1, 2, 3 |

## Innovation & Novel Patterns

### Detected Innovation Areas

**Active Learning Architecture for Web Scraping**

scrapnew treats site configuration as an active learning problem — a fundamentally different approach from fully manual setup (infeasible at 5000+ sites) or fully automated detection (proven unreliable):

- AI analyzes each new site and produces field mappings with confidence scores
- Sites above the confidence threshold enter a human review queue
- Admin corrections via Chrome extension serve as training data
- The AI model improves with each correction, progressively raising accuracy on unseen sites
- The human correction burden decreases over time as the model learns common patterns

This creates a **flywheel effect**: more sites configured → more training data → higher AI accuracy → less human correction → faster onboarding → more sites configured.

**Novel Combination: Playwright + AI + Active Learning + Browser Extension**

No existing scraping platform combines all four: headless browser automation for site analysis, AI-driven field mapping, an active learning feedback loop, and a browser extension as the human correction interface. Each component exists independently; the combination is new.

### Validation Approach

- **Early signal:** Track AI confidence scores across the first 50 sites. If average confidence increases measurably (e.g., from 70% to 78%), the learning loop is working.
- **Correction rate tracking:** Measure average fields corrected per site over time. Decreasing trend validates the flywheel.
- **Plateau detection:** Identify when learning gains flatten — indicates the AI has absorbed most learnable patterns and remaining failures are genuinely hard sites.

### Risk Mitigation

- **Risk:** AI learning doesn't generalize — each site is too unique for patterns to transfer.
  **Mitigation:** Start with site clustering (similar CMS platforms, similar industries) to maximize pattern reuse. Even partial learning (CMS-specific patterns) provides value.
- **Risk:** Corrections are too noisy to serve as clean training data.
  **Mitigation:** Structure the Chrome extension to capture precise, structured corrections (element selectors, field types) rather than free-form feedback.
- **Fallback:** If learning proves insufficient, the platform still works as a high-efficiency manual configuration tool (3 min vs 15-20 min per site). The floor is useful even if the ceiling isn't reached.

## Multi-Surface Platform Requirements

### Project-Type Overview

scrapnew is a three-surface platform with distinct technical profiles:

1. **Admin Dashboard (SPA)** — Single-page application for site management, monitoring, and data review. Real-time updates for scrape progress and system status.
2. **Backend API/Scraping Engine** — REST/JSON API powering the dashboard and Chrome extension. Manages AI analysis pipeline, scrape execution, and data storage.
3. **Chrome Extension** — Independent browser extension communicating with the backend via API calls. Provides field mapping overlay, correction interface, and config submission.

### Technical Architecture Considerations

**Authentication & Access:**
- Single admin operator — no multi-user auth needed for MVP
- Backend API secured via environment variable token (.env configuration)
- Chrome extension authenticates to backend API using the same token mechanism
- No login UI required — admin configures token once

**Real-Time Communication:**
- Dashboard receives real-time updates for: scrape progress, AI analysis status, system alerts
- Implementation options: WebSockets or Server-Sent Events (SSE)
- Real-time scope: status changes and progress indicators, not full data streaming

**API Design:**
- REST with JSON payloads
- Core resource endpoints: sites, scrape-runs, jobs, configs, analysis-results
- Chrome extension consumes the same API as the dashboard — no separate extension API

### Dashboard (SPA) Requirements

- **Framework:** Modern SPA framework (React/Vue/similar)
- **Real-time:** Live status updates for active scrapes and AI analysis
- **Views:** Site list, review queue, jobs viewer (per-site filtering), system status/alerts
- **Responsive:** Desktop-optimized (admin tool, not consumer-facing)
- **Browser support:** Modern evergreen browsers only (Chrome primary, given extension dependency)

### Backend API Requirements

- **Endpoints:** CRUD for sites, trigger analysis, trigger scrape, fetch jobs, fetch configs, system status
- **Data schemas:** Job schema (normalized + raw), site config schema, analysis result schema
- **Error handling:** Structured error responses with actionable messages
- **Rate limiting:** Not needed for MVP (single user), but API structure should not preclude it later
- **Background processing:** AI analysis and scraping run asynchronously — API triggers jobs and returns status

### Chrome Extension Requirements

- **Communication:** Direct REST API calls to backend (same endpoints as dashboard)
- **Authentication:** Token from extension settings, stored in extension local storage
- **Modes:** Review (overlay AI mappings), Navigate (record page flow), Form Record (capture form fields)
- **Independence:** Extension is a standalone package, loosely coupled to dashboard via shared API
- **Target browser:** Chrome only for MVP

### Implementation Considerations

- **Monorepo vs polyrepo:** Three surfaces could share types/schemas via monorepo structure
- **Shared types:** Job schema, site config schema, and API contracts should be defined once and shared across dashboard, backend, and extension
- **Deployment:** Backend + dashboard deploy together; Chrome extension distributed separately (Chrome Web Store or manual .crx for personal use)

## Scoping & Phased Development

### MVP Strategy

**MVP Approach:** Problem-solving MVP — prove the core loop works end-to-end. The minimum that makes this useful is: submit a URL, get an AI-generated field mapping that's good enough to correct quickly, save the config, and scrape valid jobs.

**Resource Requirements:** Solo developer/operator. All three surfaces built by one person. Pragmatic technology choices — no over-engineering, lean on frameworks that accelerate solo development.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Journey 1 (Happy Path): Full site onboarding flow
- Journey 2 (Edge Case): Low confidence handling with retry and skip
- Journey 4 (Validation): Basic data quality spot-checking

**Must-Have Capabilities:**

| Capability | Rationale |
|-----------|-----------|
| AI analysis pipeline (all 3 methods) | Combined methods needed to reach 70% confidence floor |
| Confidence scoring per site | Drives the review queue and admin prioritization |
| Chrome extension (Review, Navigate, Form Record modes) | The correction interface — without it, the loop doesn't close |
| Admin dashboard (site list, review queue, jobs viewer) | Operational control surface |
| On-demand test scraping | Config validation before committing a site |
| Job data model (normalized + raw) | Storage and quality validation |
| Site status lifecycle | Track sites through analyzing → review → active → failed → skipped |
| Real-time status updates | Admin needs live feedback on analysis and scrape progress |

**Explicitly NOT in MVP:**
- Automated daily scheduling (manual trigger only)
- Batch site adding (one at a time)
- Anti-bot measures (skip sites that block, revisit later)
- Drift detection (manual discovery via dashboard alerts)
- Distributed workers (single process)
- AI learning feedback loop optimization (corrections stored as training data from day one, but model improvement can be iterative)

### Phase 2 (Growth)

- Automated daily scrape scheduling with cron-like configuration
- Batch site adding for rapid onboarding (CSV upload or bulk URL input)
- Basic anti-block strategy (proxy rotation, request throttling)
- Statistical drift detection — auto-flag sites whose structure changed
- AI model retraining pipeline using accumulated correction data

### Phase 3 (Expansion)

- Distributed worker pool (BullMQ/Redis) for 5000+ site concurrency
- Hybrid HTTP fetch/Playwright optimization — classify sites and use lightweight fetch where Playwright isn't needed
- Per-site anti-bot sensitivity tuning
- Self-improving AI approaching near-zero correction rates
- Full automation steady state — dashboard alerts only

### Risk Mitigation Strategy

**Technical Risks:**
- *AI confidence too low across diverse sites* — Mitigation: all three analysis methods combined; Chrome extension makes even 50% confidence usable through fast correction
- *Scraping performance bottleneck* — Mitigation: MVP is on-demand only (no 5000-site overnight runs); performance optimization deferred to Phase 2/3
- *Chrome extension complexity* — Mitigation: three distinct modes with clear separation; build Review mode first, add Navigate and Form Record incrementally

**Market Risks:**
- Minimal — personal infrastructure tool, not a product seeking market fit. The risk is technical feasibility, not demand.

**Resource Risks:**
- *Solo developer bottleneck* — Mitigation: lean MVP, pragmatic tech choices, monorepo for shared types. If any surface falls behind, dashboard and extension can use simpler implementations while backend/AI pipeline gets priority.

## Functional Requirements

### Site Management

- **FR1:** Admin can submit a site URL for AI analysis
- **FR2:** Admin can view a list of all sites with their current status (analyzing, review, active, failed, skipped)
- **FR3:** Admin can filter and sort the site list by status, confidence score, and date added
- **FR4:** Admin can mark a site as "skipped" to defer it from the active pipeline
- **FR5:** Admin can re-enable a skipped or failed site for AI re-analysis
- **FR6:** Admin can delete a site from the platform entirely

### AI Analysis Pipeline

- **FR7:** System can automatically analyze a submitted site URL using pattern matching
- **FR8:** System can automatically analyze a submitted site URL using crawl/classify method
- **FR9:** System can automatically analyze a submitted site URL using network interception
- **FR10:** System can combine results from all three analysis methods into a unified field mapping with per-field confidence scores
- **FR11:** System can produce an overall confidence score for a site's field mapping
- **FR12:** System can route sites above the confidence threshold to the admin review queue
- **FR13:** System can store corrections as structured training data for future AI improvement

### Review Queue

- **FR14:** Admin can view a queue of sites that have completed AI analysis and are ready for review
- **FR15:** Admin can prioritize the review queue by confidence score or submission date
- **FR16:** Admin can access a site's AI-generated field mapping from the review queue

### Chrome Extension — Field Mapping Correction

- **FR17:** Admin can view AI-detected field mappings overlaid on the live target site (Review Mode)
- **FR18:** Admin can confirm, reject, or remap individual field mappings on the live page
- **FR19:** Admin can add new field mappings that the AI missed
- **FR20:** Admin can record the listing → detail → apply page navigation flow (Navigate Mode)
- **FR21:** Admin can capture form field mappings during interaction with the target site (Form Record Mode)
- **FR22:** Admin can save a completed site configuration to the platform backend
- **FR23:** Extension can authenticate to the backend API using a stored token

### Scraping & Data Collection

- **FR24:** Admin can trigger an on-demand test scrape for a configured site
- **FR25:** System can execute a scrape using the saved site configuration and produce job records
- **FR26:** System can normalize scraped job data into the standard schema (title, company, location, salary, description, and additional fields)
- **FR27:** System can store both normalized and raw scraped data per job record
- **FR28:** System can validate scraped records against the job schema and flag records with missing required fields

### Data Review & Quality

- **FR29:** Admin can view scraped job listings per site in the dashboard
- **FR30:** Admin can filter and browse job records to spot-check data quality
- **FR31:** Admin can identify which site a job record came from

### Dashboard & Operations

- **FR32:** Admin can view a system status overview showing scrape success/failure counts
- **FR33:** Admin can view categorized failure alerts (timeouts, structure changes, empty results)
- **FR34:** Admin can trigger a re-scrape for failed sites directly from the dashboard
- **FR35:** Admin can receive real-time status updates for active AI analysis and scrape operations

### Configuration & Data Model

- **FR36:** System can store site configurations as structured JSON (selectors, page flow, field mappings)
- **FR37:** System can store the full job schema with core fields (title, company, location), application fields, and meta fields
- **FR38:** System can maintain a site status lifecycle with timestamps for each state transition

## Non-Functional Requirements

### Performance

- **AI analysis completion:** Site analysis pipeline (all 3 methods) completes within 5 minutes per site
- **On-demand scrape execution:** Test scrape for a single site returns results within 2 minutes
- **Dashboard responsiveness:** Dashboard pages load and respond to interactions within 1 second
- **Real-time updates:** Status changes propagate to dashboard within 3 seconds of occurring on the backend

### Scalability

- **MVP scale target:** System handles up to 100 configured sites with on-demand scraping without degradation
- **Phase 2 scale target:** System handles 500+ sites with automated daily scheduling
- **Phase 3 scale target:** System handles 5000+ sites via distributed worker pool
- **Data growth:** Job records storage scales to millions of records without query performance degradation on per-site views

### Reliability

- **Scrape fault tolerance:** Individual site scrape failures do not affect other sites — failures are isolated and reported
- **AI pipeline resilience:** If one analysis method fails for a site, remaining methods still produce partial results
- **Data persistence:** No scraped data loss — completed scrape results are committed to storage before reporting success
- **System recovery:** Backend recovers gracefully from crashes — in-progress scrapes are marked as failed, not silently lost
