# Tnuva — https://www.tnuva.co.il/jobs/

**Status:** ACTIVE  
**Site ID:** `cmqyh9j7k002n01nzpb7145ri`

## Gotchas

- Listing uses infinite scroll (~99 jobs). `setupScript` scrolls to bottom before enriching cards (worker runs setupScript before its own autoScroll, so scroll must be in-script).
- Location: when title ends with `ב<city>` (e.g. "…בפתח תקווה"), use that city; otherwise fall back to `.location` on the card.
- Job description lives on detail pages; setupScript fetches `.job-content section.free-content` only (excludes "משרות נוספות שאולי יעניינו אותך").
- `externalJobId` comes from `.jobIdNum` on the detail page (e.g. `198417`), not the URL slug.
- Apply form is Gravity Forms `#gform_12` (POST to admin-ajax.php). Required: name, email, ID number, phone, CV, privacy checkbox.

## Scripts

- `setup-script.js` — listing scroll + per-card enrichment
- `apply-config.ts` — PUT config + trigger scrape
