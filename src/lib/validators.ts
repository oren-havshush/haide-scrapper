import { z } from "zod";

export const createSiteSchema = z.object({
  siteUrl: z.url(),
});

export const updateSiteSchema = z.object({
  status: z.enum(["ANALYZING", "REVIEW", "ACTIVE", "FAILED", "SKIPPED"]).optional(),
  fieldMappings: z.record(z.string(), z.unknown()).optional(),
  pageFlow: z.array(z.unknown()).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const siteUrlFilterSchema = z.object({
  siteUrl: z.string().optional(),
});

// Partial-match search filters used by the dashboard's Filter inputs. Separate
// from `siteUrlFilterSchema` so the /addsite skill's exact-match dedupe path
// keeps working unchanged.
export const siteSearchFilterSchema = z.object({
  companyNameSearch: z.string().trim().max(120).optional(),
  urlSearch: z.string().trim().max(500).optional(),
});

export const sortSchema = z.object({
  sortBy: z.enum(["createdAt", "confidenceScore", "reviewAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const updateSiteStatusSchema = z.object({
  status: z.enum(["ANALYZING", "REVIEW", "ACTIVE", "FAILED", "SKIPPED"]),
});

export const updateSiteAdminNoteSchema = z.object({
  // null clears the note, empty string is normalized to null in the service.
  adminNote: z.string().max(2_000).nullable(),
});

export const updateSiteCompanyNameSchema = z.object({
  // null clears the name, empty/whitespace is normalized to null in the service.
  companyName: z.string().max(120).nullable(),
});

export const jobsFilterSchema = z.object({
  siteId: z.string().optional(),
  scrapeRunId: z.string().optional(),
  validationStatus: z.enum(["valid", "invalid"]).optional(),
  // Partial-match search on Site.siteUrl / Site.companyName for the Jobs page
  // dashboard filters. Caps mirror siteSearchFilterSchema.
  siteUrlSearch: z.string().trim().max(500).optional(),
  companyNameSearch: z.string().trim().max(120).optional(),
});

export const updateSiteConfigSchema = z.object({
  listingSelector: z.string().optional(),
  itemSelector: z.string().optional(),
  revealSelector: z.string().optional(),
  fieldMappings: z.record(z.string(), z.unknown()),
  pageFlow: z.array(z.object({
    url: z.string(),
    action: z.string(),
    waitFor: z.string().optional(),
  })),
  formCapture: z.object({
    formSelector: z.string(),
    actionUrl: z.string(),
    method: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      fieldType: z.string(),
      required: z.boolean(),
      tagName: z.string(),
    })),
  }).nullable(),
  originalMappings: z.record(z.string(), z.unknown()).optional(),
  // Listing-page pagination — currently only "click" type (works for MUI
  // Pagination, "Next" buttons, etc. where direct URL navigation doesn't
  // re-render the SPA). Stored under fieldMappings._meta in the DB.
  pagination: z
    .object({
      type: z.literal("click"),
      nextSelector: z.string(),
      maxPages: z.number().int().min(1).max(100).optional(),
      settleMs: z.number().int().min(100).max(10_000).optional(),
    })
    .optional(),
  // Optional JS snippet evaluated in the page context once after page load
  // and before extraction. Lets SPAs that hide most content behind app state
  // (Angular scope flags, React store slices) render the full listing so the
  // extractor sees everything. Body is executed verbatim via page.evaluate.
  setupScript: z.string().max(8_000).optional(),
  // Optional CSS selector for an append-style "Load more" button. The worker
  // clicks it repeatedly after page load until item count stabilizes or caps
  // hit. Different from `pagination` (which expects content replacement).
  loadMoreSelector: z.string().max(500).optional(),
  // Optional per-site browser-context overrides. Lets onboarders unblock
  // WAF-protected sites that reject the worker's default Playwright UA /
  // headers (e.g. bezeq.co.il, which TCP-resets bare headless Chromium).
  // Applied per scrape only — does NOT affect any other site. Worker reads
  // this in createPage(); per-site userAgent wins over SCRAPE_USER_AGENT env,
  // extraHeaders merge on top of the default Accept-Language header.
  browserOverrides: z
    .object({
      userAgent: z.string().max(500).optional(),
      extraHeaders: z.record(z.string(), z.string().max(1000)).optional(),
      // Disables CSP enforcement on the browsing context. Needed for sites
      // whose page-level CSP `connect-src` blocks the setupScript's XHR to a
      // data subdomain (bezeq.co.il pattern). Maps to Playwright's
      // `newContext({ bypassCSP: true })`.
      bypassCSP: z.boolean().optional(),
    })
    .optional(),
});
