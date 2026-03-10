---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - '_bmad-output/brainstorming/brainstorming-session-2026-03-10-1440.md'
date: 2026-03-10
author: Oren
---

# Product Brief: scrapnew

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

scrapnew is a job scraping infrastructure platform designed to aggregate and store job listings from thousands of Israeli job sites. The platform is operated by a single admin who manages a curated list of target sites through a full admin dashboard, with an AI-powered analysis pipeline that automates site structure learning and a Chrome extension for field mapping corrections.

---

## Core Vision

### Problem Statement

Scraping job listings at scale across thousands of diverse websites — each with different technology stacks, page structures, and anti-bot measures — is an unsolved infrastructure challenge. Fully automated approaches fail due to the sheer diversity of site implementations, while fully manual mapping is infeasible beyond a handful of sites.

### Problem Impact

Without a scalable scraping solution, comprehensive job data aggregation across the Israeli market remains impossible. The volume of sites (5000+) makes pure manual configuration impractical for a single operator, while pure automation has already been proven insufficient through a failed previous attempt.

### Why Existing Solutions Fall Short

Generic scraping tools lack job-domain intelligence — they can extract HTML but cannot semantically normalize job data across wildly different site structures. No existing solution combines automated AI analysis with a targeted human correction loop designed specifically for job data extraction.

### Proposed Solution

A two-phase site learning platform: Phase 1 — AI automatically analyzes a submitted site URL using Playwright, pattern matching, and network interception, producing field mappings with confidence scores. Phase 2 — When confidence exceeds 70%, the site enters the admin review queue where the operator uses a Chrome extension to verify and correct the AI's field mapping. The resulting configuration drives daily automated scraping, with an admin dashboard providing full operational oversight of the site list, scrape runs, and system health.

### Key Differentiators

- **AI-first, human-corrects model** — Admin effort drops from 15-20 minutes per site (manual mapping) to 2-3 minutes (correcting AI output), making 5000+ sites feasible for a single operator
- **Failed-attempt-informed architecture** — Built on the hard lesson that full automation doesn't work; the human-in-the-loop at the right moment is the unlock
- **Clear separation of concerns** — Admin dashboard for operations management, Chrome extension solely for field mapping, scraping engine for daily execution

---

## Target Users

### Primary Users

**Admin Operator (Solo)**

- **Profile:** Single admin who owns and operates the entire scraping platform. Technically capable, built the system, understands the architecture.
- **Goals:** Spend as little time as possible on daily operations. Add sites one by one initially, with batch-adding planned for a later stage. Maximize AI accuracy to minimize manual correction time.
- **Daily Workflow:**
  1. Submit a new site URL to the system
  2. AI analyzes the site automatically — field mapping, structure detection
  3. Sites above 70% confidence appear in the review queue
  4. Open Chrome extension on the target site, review AI's field mapping, correct what's wrong
  5. Save config — scraper runs daily from that point
  6. Check dashboard for alerts on failed scrapes, structural drift, or sites needing re-review
- **Success Moment:** Adding a new site and the AI nails the mapping with minimal corrections. Checking the dashboard and seeing 5000 sites scraped cleanly overnight.
- **Pain Points:** Time spent on manual corrections, dealing with sites that break frequently, having to re-map sites after structural changes.

### Secondary Users

N/A — Single operator system at this stage. No secondary users identified.

### User Journey

1. **Onboarding:** Admin adds first site URL, sees AI analysis results, corrects via extension — learns the workflow
2. **Core Usage:** Daily routine of adding new sites (one by one), reviewing AI queue, quick dashboard check for alerts
3. **Scaling:** Transition to batch-adding sites as confidence in system grows
4. **Steady State:** Minimal daily involvement — dashboard alerts only surface when action is needed

---

## Success Metrics

- **AI Analysis Accuracy:** 70%+ field mapping confidence on initial site analysis — reducing manual correction to ~30% of fields
- **Admin Time Per Site:** Under 3 minutes average to review and correct AI mapping via Chrome extension
- **Daily Scrape Success Rate:** 95%+ of configured sites complete their daily scrape without errors
- **Site Onboarding Velocity:** Ability to add and configure at least 10 new sites per day as a solo admin
- **Data Quality:** Scraped job records pass schema validation (required fields present, correct formats)

### Business Objectives

- **3-month target:** 500+ sites actively scraping daily with stable pipeline
- **12-month target:** 5000+ sites actively scraping daily with <5% failure rate
- **Operational efficiency:** Dashboard check takes under 10 minutes daily during steady state

### Key Performance Indicators

| KPI | Target | Measurement |
|-----|--------|-------------|
| AI confidence score | 70%+ average | Per-site analysis output |
| Scrape success rate | 95%+ daily | Failed vs completed scrape runs |
| Sites needing re-review | <5% per month | Drift detection alerts |
| Admin time per site | <3 min | Extension session duration |
| Total active sites | 5000+ at 12 months | Dashboard site count |

---

## MVP Scope

### Core Features

1. **AI Site Analysis Pipeline**
   - Submit a site URL for automated analysis
   - All three analysis methods: pattern matching, crawl/classify, network interception
   - Confidence scoring and field mapping generation
   - Sites at 70%+ confidence pushed to admin review queue

2. **Chrome Extension (Full)**
   - Review Mode: overlay AI's detected fields on live page, confirm/fix mappings
   - Navigate Mode: record listing → detail → apply page flow
   - Form Record Mode: capture form field mapping during admin interaction
   - Save completed config to platform API

3. **Admin Dashboard**
   - Manage site list (add sites one by one)
   - AI review queue management
   - View scraped jobs per site for validation
   - Dashboard alerts for system status

4. **Data Model & Storage**
   - Full job schema (core fields, application fields, meta fields)
   - Site config storage (the JSON config that learning pipeline produces)
   - Dual schema: normalized standard fields + raw site-specific structure

5. **On-Demand Test Scraping**
   - Manual scrape trigger per site after config is saved
   - Limited number of jobs per site — enough to validate config correctness
   - Jobs stored in DB and viewable in dashboard

### Out of Scope for MVP

- Automated daily scrape scheduling
- Batch site adding
- Anti-block strategy (proxy rotation, fingerprint randomization, per-site sensitivity)
- Statistical drift detection
- Scale optimization (hybrid HTTP fetch/Playwright classification)
- Distributed worker pool (BullMQ/Redis)

### MVP Success Criteria

- Admin can add a site URL, AI produces a field mapping with 70%+ confidence
- Admin can review and correct the mapping via Chrome extension in under 3 minutes
- On-demand scrape produces valid, normalized job records viewable in dashboard
- End-to-end flow works: URL → AI analysis → extension correction → config saved → test scrape → jobs in DB

### Future Vision

- Automated daily scraping engine with scheduling
- Batch site adding for rapid onboarding
- Distributed worker pool for 5000+ site scale
- Anti-block strategy stack with per-site sensitivity tuning
- Statistical drift detection with automatic re-review flagging
- Hybrid fetch/Playwright optimization based on site classification
