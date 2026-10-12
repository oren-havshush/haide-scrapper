// Per-site limits (big-lane design, item 3, 2026-10-13).
//
// `_meta.limits = { timeBudgetMinutes, maxItems, maxPages }`, set through the
// config schema's top-level `limits` key. Absent limits give exactly the fleet's
// constants: a 15-minute run, 2,000 items, 100 listing pages, and the sweep
// waiting its usual perSiteTimeoutMinutes. A site given limits gets its own:
// the scrape's deadline, the dedupe cap (and so the item_cap_reached warning),
// the page cap, and how long the sweep waits for it (its budget + 3 minutes).
//
// The time ceiling is 180 minutes (owner, 2026-10-13, finding 2: Maof's full
// read at 4 s a page is 175 minutes). A budget above the fleet's 15 is for the
// big lane only; the schema refuses it on a nightly site, whose window is
// budgeted at 15 a site (worker/lib/sweepBudget.test.ts).

import { MAX_EXTRACTED_ITEMS } from "./itemCap";

export const FLEET_TIME_BUDGET_MINUTES = 15;
export const FLEET_MAX_PAGES = 100;
export const LIMIT_CEILINGS = { timeBudgetMinutes: 180, maxItems: 5000, maxPages: 300 } as const;
/** The sweep waits a site's budget plus this, so the scrape's own deadline fires first. */
export const SWEEP_WAIT_MARGIN_MINUTES = 3;

export type SiteLimits = { timeBudgetMinutes?: number; maxItems?: number; maxPages?: number };
export type ResolvedLimits = {
  /** The scrape's deadline. */
  timeoutMs: number;
  /** near_timeout warns from here: a minute before the deadline. */
  nearTimeoutMs: number;
  maxItems: number;
  maxPages: number;
};

const isLimit = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;

/** The site's limits from its stored fieldMappings. A value outside its range is ignored, as absent. */
export function readSiteLimits(fieldMappings: unknown): SiteLimits {
  if (!fieldMappings || typeof fieldMappings !== "object") return {};
  const meta = (fieldMappings as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== "object") return {};
  const raw = (meta as Record<string, unknown>).limits;
  if (!raw || typeof raw !== "object") return {};
  const l = raw as Record<string, unknown>;
  const out: SiteLimits = {};
  for (const key of ["timeBudgetMinutes", "maxItems", "maxPages"] as const) {
    if (isLimit(l[key], LIMIT_CEILINGS[key])) out[key] = l[key] as number;
  }
  return out;
}

/** The numbers a run uses. */
export function resolveLimits(limits: SiteLimits): ResolvedLimits {
  const minutes = limits.timeBudgetMinutes ?? FLEET_TIME_BUDGET_MINUTES;
  return {
    timeoutMs: minutes * 60_000,
    nearTimeoutMs: (minutes - 1) * 60_000,
    maxItems: limits.maxItems ?? MAX_EXTRACTED_ITEMS,
    maxPages: limits.maxPages ?? FLEET_MAX_PAGES,
  };
}

/** Today's constants: what every site without limits gets. */
export const FLEET_LIMITS: ResolvedLimits = resolveLimits({});

/** The listing page cap: the pagination's own maxPages, never above the site's (or the fleet's) ceiling. */
export function pageCap(configuredMaxPages: number, limits: SiteLimits): number {
  return Math.min(configuredMaxPages, limits.maxPages ?? FLEET_MAX_PAGES);
}

/** How long the sweep waits for this site: its budget + 3, else the fleet's wait. */
export function sweepWaitMinutes(limits: SiteLimits, fleetWaitMinutes: number): number {
  return limits.timeBudgetMinutes !== undefined ? limits.timeBudgetMinutes + SWEEP_WAIT_MARGIN_MINUTES : fleetWaitMinutes;
}
