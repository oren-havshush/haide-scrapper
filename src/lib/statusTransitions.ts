/**
 * statusTransitions.ts — which site status changes are allowed.
 *
 * Pulled out of siteService.ts so it can be read and tested without a database.
 * The table is small and the consequences are not: one of these transitions
 * deletes the site's listings.
 */

/** Every status a site can hold. */
export const SITE_STATUSES = ["ANALYZING", "REVIEW", "ACTIVE", "FAILED", "SKIPPED"] as const;
export type SiteStatusName = (typeof SITE_STATUSES)[number];

/**
 * Moving a site here DELETES every Job row it has (siteService.updateSiteStatus
 * wraps the delete and the status change in one transaction). Named, because
 * the dashboard has to warn about it and a comment is easy to walk past.
 */
export const DESTRUCTIVE_STATUSES: readonly SiteStatusName[] = ["FAILED"];

export function isDestructiveStatus(status: string): boolean {
  return (DESTRUCTIVE_STATUSES as readonly string[]).includes(status);
}

export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  ANALYZING: ["REVIEW", "ACTIVE", "FAILED"],
  REVIEW: ["SKIPPED", "ACTIVE", "FAILED", "ANALYZING"],
  ACTIVE: ["SKIPPED", "FAILED", "REVIEW", "ANALYZING"],
  FAILED: ["SKIPPED", "ANALYZING", "ACTIVE"],
  // REVIEW is reachable from SKIPPED directly. A site is SKIPPED for a reason
  // outside its config — a WAF block, a login-gated apply flow, a policy — and
  // when that reason lifts the config is usually intact and wants checking, not
  // rebuilding. The two routes that existed both cost something: ANALYZING
  // throws the working config away and re-derives it, and FAILED deletes the
  // site's listings. gazit and sinaistore both came back this way on
  // 2026-09-22.
  SKIPPED: ["ANALYZING", "FAILED", "REVIEW"],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
