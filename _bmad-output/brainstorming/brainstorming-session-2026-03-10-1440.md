---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Full-stack job scraping platform with Chrome extension-based site learning, scalable scraping engine, admin dashboard, and consumer-facing job site'
session_goals: 'Define architecture, approach, and implementation strategy for a human-in-the-loop job scraping platform handling 5000+ diverse sites with AI-assisted site structure learning'
selected_approach: 'user-selected'
techniques_used: ['Solution Matrix']
ideas_generated: [10]
context_file: ''
technique_execution_complete: true
session_active: false
workflow_completed: true
facilitation_notes: 'Oren is highly decisive and clear on priorities — focuses on what matters most (AI analysis + admin correction loop) and cuts through secondary concerns quickly. Strong product instinct for the two-phase approach.'
---

# Brainstorming Session Results

**Facilitator:** Oren
**Date:** 2026-03-10

## Session Overview

**Topic:** Full-stack job scraping platform with Chrome extension-based site learning, scalable scraping engine, admin dashboard, and consumer-facing job site

**Goals:**
- Design a site learning system via Chrome extension for admins to visually map job site structures
- Architect a scalable scraping engine handling 5000+ diverse sites (JS/React/static/WordPress) with daily runs
- Full job data extraction including application form fields for API submission
- Admin dashboard for managing site list, learning configs, and scraping oversight
- Consumer-facing site displaying scraped jobs to end users
- AI-assisted learning to speed up site mapping phase
- Learn from failed previous attempt and take a fundamentally different approach

### Session Setup

_Oren described a comprehensive job scraping platform vision. Previous attempt at /Users/oren/code/Crymbo/POC/bmad was unsuccessful with a fully automated approach. New strategy: human-in-the-loop site structure definition via Chrome extension, with AI assistance to accelerate the learning phase. Tech stack: Next.js, PostgreSQL, Google/email auth._

## Technique Selection

**Approach:** User-Selected Techniques
**Selected Techniques:**

- **Solution Matrix**: Systematic grid of problem variables and solution approaches — ideal for mapping the multi-variable architecture of a 5000+ site scraping platform with diverse tech layers, site structures, and extraction strategies

**Selection Rationale:** The Solution Matrix was chosen for its ability to systematically explore all variable/solution combinations across the platform's many dimensions, finding optimal pairings while uncovering gaps and blind spots.

## Technique Execution Results

**Solution Matrix:**

- **Interactive Focus:** Core site learning pipeline, Chrome extension UX, scraper reliability, data model
- **Key Breakthroughs:** Two-phase AI-first/admin-corrects approach, parallel analysis with confidence threshold, three-mode Chrome extension, dual schema (standard + raw)
- **User Creative Strengths:** Decisive prioritization, clear product vision, strong instinct for hybrid human+AI approaches
- **Energy Level:** Focused and efficient — cut through secondary concerns to nail the core architecture

### Ideas Generated

**[Architecture #1]**: Two-Phase Site Learning
_Concept_: Automated-first, human-corrected. Phase 1: System analyzes the site URL using Playwright + pattern library matching + crawl/classify + network interception. Phase 2: Admin opens Chrome extension, sees what the AI mapped, clicks to fix/align fields that are wrong.
_Novelty_: The AI does the heavy lifting for 5000 sites — admin only intervenes where needed, not from scratch every time.

**[Architecture #2]**: Parallel Analysis + Confidence Threshold
_Concept_: Run all analysis methods (pattern match, crawl/classify, network intercept) simultaneously against a site URL. Score each result's confidence. Merge the best signals into a unified field mapping. When confidence hits 70%+, push to admin queue for review/confirmation via Chrome extension.
_Novelty_: No single method needs to be perfect — the system combines strengths. Below 70% gets flagged as "needs manual mapping."

**[Architecture #3]**: AI-Detected Navigation + Admin Override
_Concept_: AI analyzes the site's navigation flow — detects listing page, identifies clickable elements leading to detail pages, maps the journey. Admin sees the proposed flow and can reconfigure the path.
_Novelty_: Navigation flow detection is the hardest part to automate but also the most tedious to do manually. Even 50% accurate auto-detection saves massive time across 5000 sites.

**[Pipeline #4]**: End-to-End Site Learning Pipeline
_Concept_: URL submitted → Playwright loads site → Parallel analysis (pattern match + crawl/classify + network intercept) → Confidence scoring → Field mapping merged → Navigation flow detected → If 70%+ confidence → pushed to admin review queue → Admin opens Chrome extension → sees overlay of AI's mapping + navigation flow → confirms/fixes → saves config JSON → scraper uses config for daily runs.
_Novelty_: The admin never starts from zero. Even worst-case gives them a partial map to work from.

**[Reliability #5]**: Schema Validation + Statistical Drift Detection
_Concept_: Every scrape run validates results against expected field schema (title present, salary format correct, URL valid) AND tracks statistical baselines per site (normal job count range, typical field completion rates). When validation fails or stats drift beyond threshold — auto-flag the site, pause scraping, push to admin re-review queue.
_Novelty_: Two complementary signals — schema catches individual record corruption, statistical drift catches wholesale structural changes.

**[Infrastructure #6]**: Self-Hosted Distributed Worker Pool
_Concept_: Queue-based architecture on self-hosted server — job queue (Redis/BullMQ) distributes scrape tasks across parallel Playwright workers. Hybrid approach: lightweight HTTP fetch for static sites, Playwright only when JS rendering needed. Site classification happens during learning phase.
_Novelty_: Learning phase tags each site with its required scraping method — avoids expensive browser instances for sites that don't need them. Could cut execution time by 50-60%.

**[Infrastructure #7]**: Anti-Block Strategy Stack
_Concept_: Proxy rotation + per-domain rate limiting + browser fingerprint randomization + scheduling spread. Each site config stores its "sensitivity level" — aggressive sites get more careful treatment, lenient sites get blasted through fast.
_Novelty_: Per-site sensitivity tuning learned over time — if a site blocks you, auto-increase its sensitivity level for next run.

**[Data Model #8]**: DOM Form Extraction + Admin Recording
_Concept_: Phase 1: AI parses all form elements — inputs, selects, textareas, file uploads — captures field names, types, labels, validation rules, required flags. Phase 2: When AI can't confidently map a field, admin fills the form once in Chrome extension while system records which field maps to what standard category.
_Novelty_: Most forms share 80% common fields (name, email, phone, resume). AI handles those automatically. Admin only records the weird 20%.

**[Extension #9]**: Three-Mode Chrome Extension
_Concept_: Extension operates in three modes: Review Mode (confirm/fix AI's auto-detected structure), Navigate Mode (walk listing→detail→apply flow, extension records path), Form Record Mode (admin interacts with form, extension captures field mapping).
_Novelty_: Single tool, three focused workflows. Each mode guides admin through one specific task.

**[Data Model #10]**: Dual Schema — Standard Mapped + Raw Preserved
_Concept_: Every job record stores both: a normalized standard schema (title, company, location, salary, description, etc.) for uniform display on consumer site, AND the raw site-specific form structure for actual application submission. AI does semantic matching automatically.
_Novelty_: Decouples display from action. Consumer site works with clean uniform data. Application engine works with real form structure.

### Standard Job Schema (Draft)

**Core Job Fields:**
- title, company_name, location (city/state/country/remote flag)
- salary_min, salary_max, salary_currency, salary_period
- job_type (full-time/part-time/contract/freelance/internship)
- experience_level (entry/mid/senior/lead/executive)
- date_posted, date_expires
- description, requirements, benefits, qualifications

**Application Fields:**
- application_url, application_method (form/email/external)
- form_fields[] — {field_name, field_type, label, required, options[], mapped_standard_field}

**Meta Fields:**
- source_site_id, source_url, scrape_date, last_verified
- confidence_score, status (active/expired/flagged/needs_review)

### Creative Facilitation Narrative

_Oren came in with a clear vision shaped by a failed previous attempt. The key breakthrough was reframing the Chrome extension from a blank-canvas mapping tool to a review/correction interface for AI-generated analysis. The session quickly converged on a two-phase architecture (automated analysis → human correction) with parallel analysis methods and confidence thresholds. Oren's decisiveness kept the session focused on the core pipeline rather than secondary concerns._

### Session Highlights

**User Creative Strengths:** Decisive prioritization, clear product instinct, hybrid human+AI thinking
**Breakthrough Moments:** Reframing extension as correction tool not creation tool; parallel analysis with confidence merging; three-mode extension concept
**Energy Flow:** Focused and efficient throughout — strong signal on what matters, quick cuts on what doesn't

## Idea Organization and Prioritization

**Thematic Organization:**

### Theme 1: Core Learning Pipeline
_The AI-first, human-corrects approach — the heart of the platform_
- **[#1] Two-Phase Site Learning** — AI analyzes first, admin corrects via extension
- **[#2] Parallel Analysis + Confidence Threshold** — Run all methods simultaneously, merge best results, 70%+ triggers admin review
- **[#3] AI-Detected Navigation + Admin Override** — AI maps page flow, admin adjusts
- **[#4] End-to-End Pipeline** — Full URL-to-config pipeline tying all phases together

### Theme 2: Chrome Extension UX
_The admin's primary tool for reviewing and correcting AI analysis_
- **[#9] Three-Mode Extension** — Review Mode, Navigate Mode, Form Record Mode
- **[#8] DOM Form Extraction + Admin Recording** — AI handles 80% common fields, admin records the unique 20%

### Theme 3: Reliability & Operations
_Keeping 5000 sites scraping correctly every day_
- **[#5] Schema Validation + Statistical Drift** — Dual detection for broken records and structural changes
- **[#6] Self-Hosted Distributed Worker Pool** — BullMQ queue, parallel workers, hybrid fetch/Playwright
- **[#7] Anti-Block Strategy Stack** — Per-site sensitivity tuning, proxy rotation, fingerprint randomization

### Theme 4: Data Architecture
_How job data is stored and served_
- **[#10] Dual Schema** — Standard normalized schema for display + raw form structure for submission
- **Standard Job Schema (Draft)** — Core fields, application fields, meta fields

### Breakthrough Concept
- **Extension as correction tool, not creation tool** — This single reframe makes 5000-site scale feasible. Admin effort drops from 15-20 minutes to 2-3 minutes per high-confidence site.

**Prioritization Results:**

- **Top Priority Ideas:** #1 (Two-Phase Learning), #2 (Parallel Analysis), #9 (Three-Mode Extension)
- **Quick Win Opportunity:** #10 (Dual Schema) — define the data model early, everything builds on it
- **Most Innovative:** #2 (Parallel Analysis with confidence merging) — makes 5000 sites feasible

## Action Plans

### Priority 1: Dual Schema — Define the Data Model First
_Everything else builds on this foundation_

**Next Steps:**
1. Finalize the standard job schema (core fields, application fields, meta fields)
2. Design PostgreSQL tables — jobs, sites, site_configs, scrape_runs, form_mappings
3. Build the site_config JSON structure that learning pipeline produces and scraper consumes

**Success Indicator:** Any job from any site described using one unified schema

### Priority 2: Two-Phase Learning Pipeline + Parallel Analysis
_The core differentiator of the platform_

**Next Steps:**
1. Build Playwright-based site analyzer — takes a URL, renders the page, extracts DOM structure
2. Implement three parallel analysis methods: pattern matching (known ATS), crawl/classify (multi-page comparison), network traffic interception (API discovery)
3. Build confidence scoring and merging logic — combine results, produce unified field mapping with confidence scores
4. Build admin review queue — sites at 70%+ confidence pushed for review

**Success Indicator:** Feed a job site URL in, get a JSON config with field mappings and confidence scores out

### Priority 3: Three-Mode Chrome Extension
_The admin's daily tool_

**Next Steps:**
1. Scaffold Chrome extension with Next.js-compatible architecture
2. Build Review Mode — overlay AI's detected fields on live page, admin confirms/fixes
3. Add Navigate Mode — record listing→detail→apply page flow
4. Add Form Record Mode — capture form field mapping during admin interaction
5. Build export/sync — extension saves config JSON to platform API

**Success Indicator:** Admin reviews an AI-analyzed site and produces working scraper config in under 3 minutes

### Priority 4: Distributed Scraper Engine
_Makes it all run at scale_

**Next Steps:**
1. Set up BullMQ job queue with Redis
2. Build worker pool — hybrid fetch/Playwright based on site classification
3. Implement schema validation + statistical drift detection per scrape run
4. Add per-site anti-block strategy (proxy rotation, rate limiting, fingerprint randomization)

**Success Indicator:** 5000 sites scraped daily with <5% failure rate

## Session Summary and Insights

**Key Achievements:**
- 10 architectural ideas generated covering the full platform
- 4 organized themes from data model to operations
- 4 prioritized action plans with concrete next steps and success indicators
- Clear build order: Data Model → Learning Pipeline → Chrome Extension → Scraper Engine

**Session Reflections:**
The breakthrough insight was reframing the Chrome extension from a blank-canvas mapping tool to a review/correction interface for AI-generated analysis. This single architectural decision makes the entire 5000-site vision feasible by reducing per-site admin effort by 80-90%. The two-phase approach (automated analysis → human correction) with parallel analysis methods and confidence thresholds creates a system where accuracy improves over time as pattern libraries grow.

**Recommended Build Order:**
1. Data Model & Schema (foundation)
2. AI Analysis Pipeline (core engine)
3. Chrome Extension (human-in-the-loop)
4. Scraper Engine (daily execution)
5. Admin Dashboard (management layer)
6. Consumer Site (end-user facing)
